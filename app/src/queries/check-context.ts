// What the server checks read for one author (CheckContext, server checks section 4). Only projects
// the author can file into are loaded at all, so nothing about other projects reaches Atlas (check 9).
import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { loadItems, loadWorld, orgTagsOf } from "../db/records";
import * as t from "../db/schema";
import type { CandidateProject, CandidateRecord, CheckContext, EarlierTurn, ProjectPerson } from "../domain/atlas-checks/types";
import { OPEN_ITEM_STATES, type ItemState } from "../domain/machines/extracted-item";
import { LIVE_LEAVE } from "../domain/machines/leave";
import { candidateProjects } from "../domain/machines/membership";
import type { Confidence } from "../domain/shared";

export async function loadCheckContext(
  conn: Conn,
  input: { authorId: string; text: string; messageAt: Date; transcriptConfidence: Confidence | null; captureId?: string },
): Promise<CheckContext> {
  const [author] = await conn.select().from(t.people).where(eq(t.people.id, input.authorId));
  if (!author) throw new Error(`no person ${input.authorId}`);
  const [world, orgTags] = await Promise.all([loadWorld(conn), orgTagsOf(conn, input.authorId)]);
  const candidateIds = candidateProjects(input.authorId, orgTags, world);

  const projects: CandidateProject[] = [];
  for (const id of candidateIds) {
    const [project] = await conn.select().from(t.projects).where(eq(t.projects.id, id));
    const [workItems, milestones, handovers, memberships, contacts, braid] = await Promise.all([
      // D2: cancelled work is never offered to Atlas; nothing more can happen to it
      conn.select().from(t.workItems).where(and(eq(t.workItems.projectId, id), ne(t.workItems.state, "cancelled"))).orderBy(t.workItems.number),
      conn.select().from(t.milestones).where(eq(t.milestones.projectId, id)),
      conn.select().from(t.handovers).where(eq(t.handovers.projectId, id)),
      conn
        .select({ personId: t.people.id, name: t.people.name, title: t.people.title, role: t.projectMemberships.role })
        .from(t.projectMemberships)
        .innerJoin(t.people, eq(t.people.id, t.projectMemberships.personId))
        .where(and(eq(t.projectMemberships.projectId, id), eq(t.projectMemberships.state, "member"))),
      conn
        .select({ personId: t.people.id, name: t.people.name, tie: t.projectContacts.tie })
        .from(t.projectContacts)
        .innerJoin(t.people, eq(t.people.id, t.projectContacts.personId))
        .where(eq(t.projectContacts.projectId, id)),
      conn
        .select()
        .from(t.braidEntries)
        .where(and(eq(t.braidEntries.projectId, id), notInArray(t.braidEntries.state, ["none", "merged", "withdrawn"]))),
    ]);
    const steps = handovers.length
      ? await conn.select().from(t.handoverSteps).where(inArray(t.handoverSteps.handoverId, handovers.map((h) => h.id))).orderBy(t.handoverSteps.position)
      : [];
    const records: CandidateRecord[] = [
      ...workItems.map((w) => ({
        type: "work_item" as const,
        id: w.id,
        number: w.number ?? undefined,
        title: w.title,
        ownerId: w.ownerId,
        values: { state: w.state, blocked_note: w.blockedNote },
      })),
      ...milestones.map((m) => ({
        type: "milestone" as const,
        id: m.id,
        title: m.name,
        ownerId: m.ownerId,
        values: { forecast: m.forecastDate ?? m.targetDate, target: m.targetDate },
      })),
      // An update to a handover targets one of its steps ("the runbook"); the owner is the person handing over
      ...steps.map((s) => ({
        type: "handover" as const,
        id: s.id,
        title: s.title,
        ownerId: handovers.find((h) => h.id === s.handoverId)!.fromPersonId,
        values: { state: s.state },
      })),
    ];
    const people: ProjectPerson[] = [
      ...memberships.map((m) => ({ personId: m.personId, name: m.name, role: m.role, tie: m.title ?? m.role })),
      ...contacts.map((c) => ({ personId: c.personId, name: c.name, role: null, tie: c.tie })),
    ];
    projects.push({
      id,
      name: project.name,
      aliases: project.aliases,
      role: world.memberships.find((m) => m.projectId === id && m.personId === input.authorId)!.role,
      records,
      people,
      braid: braid.map((e) => ({ id: e.id, kind: e.kind, title: e.title, state: e.state })),
    });
  }

  // E75: the author's own projects whose group owner has not connected them; safe to name to the author
  const notConnected = world.projects
    .filter((p) => !p.connected && world.memberships.some((m) => m.projectId === p.id && m.personId === input.authorId && m.state === "member"))
    .map((p) => ({ id: p.id, name: p.name }));

  const leave = await conn.select().from(t.leave).where(eq(t.leave.personId, input.authorId));
  const earlier = input.captureId ? await loadEarlierTurns(conn, input.captureId) : [];
  return {
    ...(earlier.length ? { earlier } : {}),
    text: input.text,
    messageAt: input.messageAt,
    transcriptConfidence: input.transcriptConfidence,
    author: { id: author.id, name: author.name },
    projects,
    notConnected,
    leave: {
      targetId: `leave-${input.authorId}`,
      // D6: every live leave, requested or approved, so saying it again matches instead of asking twice
      existing: leave
        .filter((l) => LIVE_LEAVE.includes(l.state))
        .map((l) => ({ id: l.id, start: l.startDate, end: l.endDate, state: l.state, change: l.changeStart && l.changeEnd ? { start: l.changeStart, end: l.changeEnd } : null })),
    },
  };
}

/** Section 16: how many earlier messages Atlas reads with a new one. */
export const EARLIER_SHOWN = 6;

/**
 * The author's earlier messages in the same conversation, oldest first (CV11: their own only, never
 * someone else's), with what each asked and the items of an unsaved update that a later message may
 * correct (CV10). Nothing from another conversation is read (CV12).
 */
export async function loadEarlierTurns(conn: Conn, captureId: string): Promise<EarlierTurn[]> {
  const [c] = await conn.select().from(t.captures).where(eq(t.captures.id, captureId));
  if (!c?.conversationId) return [];
  const rows = (await conn.select().from(t.captures).where(and(eq(t.captures.conversationId, c.conversationId), eq(t.captures.authorId, c.authorId), ne(t.captures.id, captureId))))
    .filter((r) => r.messageAt < c.messageAt || (r.messageAt.getTime() === c.messageAt.getTime() && r.receivedAt < c.receivedAt))
    .sort((a, b) => a.messageAt.getTime() - b.messageAt.getTime() || a.receivedAt.getTime() - b.receivedAt.getTime())
    .slice(-EARLIER_SHOWN);
  const turns: EarlierTurn[] = [];
  for (const r of rows) {
    const unsaved = r.state === "proposed" || r.state === "reviewing";
    const items = unsaved ? (await loadItems(conn, r.id)).items.filter((i) => (OPEN_ITEM_STATES as readonly ItemState[]).includes(i.state)) : [];
    turns.push({
      captureId: r.id,
      at: r.messageAt,
      text: r.text,
      asked: r.question ? { topic: r.question.topic, projectId: r.question.projectId } : null,
      openItems: items.map((i) => ({
        id: i.id,
        summary: i.draft.target
          ? `update ${i.draft.target.type} ${i.draft.target.id}: ${i.draft.target.field} to ${i.draft.target.newValue}`
          : `${i.draft.kind} ${i.draft.braid?.kind ?? ""} "${i.draft.braid?.title ?? ""}"`.replace(/\s+/g, " "),
      })),
    });
  }
  return turns;
}
