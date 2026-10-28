// What the server checks read for one author (CheckContext, server checks section 4). Only projects
// the author can file into are loaded at all, so nothing about other projects reaches Atlas (check 9).
import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { loadItems, loadWorld, orgTagsOf } from "../db/records";
import * as t from "../db/schema";
import type { CandidateProject, CandidateRecord, CheckContext, EarlierTurn, OpenAnswer, ProjectPerson } from "../domain/atlas-checks/types";
import { OPEN_ITEM_STATES, type ItemState } from "../domain/machines/extracted-item";
import { LIVE_COMMITMENT } from "../domain/machines/commitment";
import { LIVE_LEAVE } from "../domain/machines/leave";
import { candidateProjects } from "../domain/machines/membership";
import type { AnswerCard } from "../domain/question";
import type { Confidence } from "../domain/shared";
import { projectReader } from "./project";
import { composedRead } from "./standup";
import { meetingContextOf } from "./meeting";

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
        // Section 20, U6: a work forecast starts from the due date, as a milestone's from its target
        values: { state: w.state, blocked_note: w.blockedNote, forecast: w.forecastDate ?? w.dueDate, due: w.dueDate },
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
  // Phase O: a meeting note is read with who was there, and on its own: it follows up nothing and decides no line
  const meeting = input.captureId ? await meetingContextOf(conn, input.captureId) : null;
  const earlier = input.captureId && !meeting ? await loadEarlierTurns(conn, input.captureId) : [];
  const openAnswer = input.captureId && !meeting ? await loadOpenAnswer(conn, input.captureId) : null;
  // Phase J: a standup's answers are quoted only from the answers, and the questions taps answered
  const standup = input.captureId ? await composedRead(conn, input.captureId) : null;
  // Phase E, CM5 and CM6: the author's own live commitments, each naming its record only on a project they file into
  const promises = await conn.select().from(t.commitments).where(and(eq(t.commitments.ownerId, input.authorId), inArray(t.commitments.state, [...LIVE_COMMITMENT])));
  const commitments = promises
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id))
    .map((c) => ({ id: c.id, what: c.what, dueOn: c.dueOn, state: c.state, linkId: c.linkProjectId && projects.some((p) => p.id === c.linkProjectId) ? c.linkId : null }));
  return {
    ...(earlier.length ? { earlier } : {}),
    ...(commitments.length ? { commitments } : {}),
    ...(openAnswer ? { openAnswer } : {}),
    ...(standup ? { standup: { quoteIn: standup.quoteIn } } : {}),
    ...(meeting ? { meeting } : {}),
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
      // Phase J, P10: a standup's answers without the questions about a project the author has since left
      text: (await composedRead(conn, r.id))?.shown.text ?? r.text,
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

/**
 * Phase B: the answer open in the conversation, whose lines a reply may act on. It is the newest earlier
 * answer of the author's own in the same conversation, however old (AC5: it still says "as of" its time);
 * small talk ("Thanks!") does not close it. Lines are numbered as the chat shows them, with the acts each
 * offered the asker then; the commands check them again when they run. A line on a project the asker can
 * no longer read is left out here, before anything reaches Atlas (P10, the model check's fix lines_now):
 * only its number is kept, so a reply that means it is told the answer is out of date.
 */
export async function loadOpenAnswer(conn: Conn, captureId: string): Promise<OpenAnswer | null> {
  const [c] = await conn.select().from(t.captures).where(eq(t.captures.id, captureId));
  if (!c?.conversationId) return null;
  const rows = (await conn.select().from(t.captures).where(and(eq(t.captures.conversationId, c.conversationId), eq(t.captures.authorId, c.authorId), ne(t.captures.id, captureId))))
    .filter((r) => r.answer && r.answer.topic !== "small_talk")
    .filter((r) => r.messageAt < c.messageAt || (r.messageAt.getTime() === c.messageAt.getTime() && r.receivedAt < c.receivedAt))
    .sort((a, b) => b.messageAt.getTime() - a.messageAt.getTime() || b.receivedAt.getTime() - a.receivedAt.getTime());
  const open = rows[0];
  if (!open?.answer) return null;
  const reader = await projectReader(conn, c.authorId);
  const lines = open.answer.cards.map((card, i) => ({ line: i + 1, card, projectId: lineProjectOf(card) }));
  const readable = lines.filter((l) => l.projectId === null || reader.mayRead(l.projectId));
  const gone = lines.filter((l) => !readable.includes(l)).map((l) => l.line);
  return {
    captureId: open.id,
    asked: open.question?.asked ?? open.text,
    asOf: open.answer.asOf,
    lines: readable.map(({ line, card }) => ({ line, title: card.title, detail: card.detail, subject: card.subject ?? null, acts: (card.actions ?? []).map((a) => a.act) })),
    ...(gone.length ? { gone } : {}),
  };
}

/**
 * The project a line is about: its record's, or the project its link opens. A line with neither is the
 * asker's own (their inbox, their update waiting for review).
 */
export function lineProjectOf(card: Pick<AnswerCard, "subject" | "href">): string | null {
  return card.subject?.projectId ?? /^\/projects\/([^/?#]+)/.exec(card.href)?.[1] ?? null;
}
