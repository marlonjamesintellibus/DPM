// The client view of a project (KB A7.2 and A7.3, "Client visible"): what an outside contact may read of
// a project they are tied to. Releases and their dates only: no internal status, no people, no BRAID log,
// no work. Conversational plan, phase Q, EX4: an outside contact who asks what a project is gets this and
// nothing more. Privacy is applied here, from the viewer (P10): only someone with no org role (orgRole null,
// as Kyle at Sprouts IT) tied to the project as its contact, with the client view on for them (A7.3, "if
// client view is on"), reads it; a member reads the project view instead. A tie routing made ("contact on
// #151") is not enough, and neither is a project whose group is no longer connected to DPM (M13).
import { and, eq, inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import * as t from "../db/schema";
import type { IsoDate } from "../domain/dates";

export type ClientRelease = { name: string; date: IsoDate; done: boolean };

export type ClientView = {
  project: { id: string; name: string; aliases: readonly string[]; customer: string | null; startDate: IsoDate | null; endDate: IsoDate | null };
  /** The milestones marked as releases, by their planned date: the date the plan gives, never the forecast. */
  releases: ClientRelease[];
};

/** The projects whose client view the viewer reads: none unless they are an outside contact it is on for. */
export async function clientViews(conn: Conn, viewerId: string): Promise<ClientView[]> {
  const [person] = await conn.select({ orgRole: t.people.orgRole }).from(t.people).where(eq(t.people.id, viewerId));
  // Someone in the org reads projects as a member, through getProject, or not at all
  if (!person || person.orgRole !== null) return [];
  // Phase Q fix, EX4: the project's group must still be connected to DPM, as a member's read needs (isCandidate).
  // The contact is in none of the org's groups; the tie, made by someone in the org, is their link to it.
  const ties = await conn
    .select({ projectId: t.projectContacts.projectId })
    .from(t.projectContacts)
    .innerJoin(t.projects, eq(t.projects.id, t.projectContacts.projectId))
    .innerJoin(t.groups, eq(t.groups.id, t.projects.groupId))
    .where(and(eq(t.projectContacts.personId, viewerId), eq(t.projectContacts.clientView, true), eq(t.groups.connectedToDpm, true)));
  if (!ties.length) return [];
  const ids = ties.map((x) => x.projectId);
  const [projects, releases] = await Promise.all([
    conn.select().from(t.projects).where(inArray(t.projects.id, ids)).orderBy(t.projects.name),
    conn
      .select()
      .from(t.milestones)
      .where(and(inArray(t.milestones.projectId, ids), eq(t.milestones.clientVisible, true)))
      .orderBy(t.milestones.targetDate, t.milestones.name),
  ]);
  return projects.map((p) => ({
    project: { id: p.id, name: p.name, aliases: p.aliases, customer: p.customer, startDate: p.startDate, endDate: p.endDate },
    releases: releases.filter((m) => m.projectId === p.id).map((m) => ({ name: m.name, date: m.targetDate, done: m.state === "done" })),
  }));
}
