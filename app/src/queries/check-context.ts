// What the server checks read for one author (CheckContext, server checks section 4). Only projects
// the author can file into are loaded at all, so nothing about other projects reaches Atlas (check 9).
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { loadWorld, orgTagsOf } from "../db/records";
import * as t from "../db/schema";
import type { CandidateProject, CandidateRecord, CheckContext, ProjectPerson } from "../domain/atlas-checks/types";
import { candidateProjects } from "../domain/machines/membership";
import type { Confidence } from "../domain/shared";

export async function loadCheckContext(
  conn: Conn,
  input: { authorId: string; text: string; messageAt: Date; transcriptConfidence: Confidence | null },
): Promise<CheckContext> {
  const [author] = await conn.select().from(t.people).where(eq(t.people.id, input.authorId));
  if (!author) throw new Error(`no person ${input.authorId}`);
  const [world, orgTags] = await Promise.all([loadWorld(conn), orgTagsOf(conn, input.authorId)]);
  const candidateIds = candidateProjects(input.authorId, orgTags, world);

  const projects: CandidateProject[] = [];
  for (const id of candidateIds) {
    const [project] = await conn.select().from(t.projects).where(eq(t.projects.id, id));
    const [workItems, milestones, handovers, memberships, contacts, braid] = await Promise.all([
      conn.select().from(t.workItems).where(eq(t.workItems.projectId, id)).orderBy(t.workItems.number),
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

  const approved = await conn.select().from(t.leave).where(eq(t.leave.personId, input.authorId));
  return {
    text: input.text,
    messageAt: input.messageAt,
    transcriptConfidence: input.transcriptConfidence,
    author: { id: author.id, name: author.name },
    projects,
    notConnected,
    leave: {
      targetId: `leave-${input.authorId}`,
      approved: approved.filter((l) => l.state !== "requested").map((l) => ({ id: l.id, start: l.startDate, end: l.endDate })),
    },
  };
}
