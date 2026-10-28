// The client view of a project (KB A7.2 and A7.3, "Client visible"): what an outside contact may read of
// a project they are tied to. Releases and their dates only: no internal status, no people, no BRAID log,
// no work; CD52 (W4-D6): a status its PM set shows too, once the PM shares its reason with the client.
// Conversational plan, phase Q, EX4: an outside contact who asks what a project is gets this and nothing more. Privacy is applied here, from the viewer (P10): only someone with no org role (orgRole null,
// as Kyle at Sprouts IT) tied to the project as its contact, with the client view on for them (A7.3, "if
// client view is on"), reads it; a member reads the project view instead. A tie routing made ("contact on
// #151") is not enough, and neither is a project whose group is no longer connected to DPM (M13).
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import * as t from "../db/schema";
import type { IsoDate } from "../domain/dates";
import { projectReader, STATUS_LABEL } from "./project";

export type ClientRelease = { name: string; date: IsoDate; done: boolean };

export type ClientView = {
  project: { id: string; name: string; aliases: readonly string[]; customer: string | null; startDate: IsoDate | null; endDate: IsoDate | null };
  /** The milestones marked as releases, by their planned date: the date the plan gives, never the forecast. */
  releases: ClientRelease[];
  /** CD52: the status the PM set, with its reason, only while the reason on show is shared with the client. */
  status: { label: string; reason: string } | null;
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
  const [projects, releases, reasons] = await Promise.all([
    conn.select().from(t.projects).where(inArray(t.projects.id, ids)).orderBy(t.projects.name),
    conn
      .select()
      .from(t.milestones)
      .where(and(inArray(t.milestones.projectId, ids), eq(t.milestones.clientVisible, true)))
      .orderBy(t.milestones.targetDate, t.milestones.name),
    conn.select().from(t.statusReasons).where(inArray(t.statusReasons.projectId, ids)).orderBy(desc(t.statusReasons.savedAt)),
  ]);
  // The reason on show is the project's latest, and only while its set status shows (explained, or kept while stale)
  const shared = (p: (typeof projects)[number]): ClientView["status"] => {
    const reason = reasons.find((r) => r.projectId === p.id);
    const shows = (p.setOverride === "explained" || p.setOverride === "reason_stale") && p.setStatus;
    return shows && reason?.clientShareable ? { label: STATUS_LABEL[p.setStatus!], reason: reason.text.trim() } : null;
  };
  return projects.map((p) => ({
    project: { id: p.id, name: p.name, aliases: p.aliases, customer: p.customer, startDate: p.startDate, endDate: p.endDate },
    releases: releases.filter((m) => m.projectId === p.id).map((m) => ({ name: m.name, date: m.targetDate, done: m.state === "done" })),
    status: shared(p),
  }));
}

/** One contact on a project, as its members see it on the project's contacts (CD49). */
export type ProjectContact = {
  person: { id: string; name: string; title: string | null };
  /** What ties them to the project ("contact on #151 (Sprouts IT)"). */
  tie: string;
  /** No role in the org, so the client view is theirs to have. Someone in the org has none. */
  outside: boolean;
  /** Whether they can see the client view now; never for someone in the org. */
  clientView: boolean;
};

/**
 * Decision CD49: the project's contacts, each with whether they can see its client view, for someone who
 * reads the project now (P10, as getProject); anyone else gets none. Its members already see who its
 * contacts are (CD9). The switch is the PM's, through commands/client-view.ts.
 */
export async function contactsOf(conn: Conn, viewerId: string, projectId: string): Promise<ProjectContact[]> {
  const { mayRead } = await projectReader(conn, viewerId);
  if (!mayRead(projectId)) return [];
  const rows = await conn
    .select({ id: t.people.id, name: t.people.name, title: t.people.title, orgRole: t.people.orgRole, tie: t.projectContacts.tie, clientView: t.projectContacts.clientView })
    .from(t.projectContacts)
    .innerJoin(t.people, eq(t.people.id, t.projectContacts.personId))
    .where(eq(t.projectContacts.projectId, projectId))
    .orderBy(t.people.name);
  return rows.map((r) => ({ person: { id: r.id, name: r.name, title: r.title }, tie: r.tie, outside: r.orgRole === null, clientView: r.clientView && r.orgRole === null }));
}
