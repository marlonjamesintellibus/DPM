// What one person may see of another (conversational plan, phase H, decision CD9), in one place: phase
// H's answers read it, and so will phase N's "who's free". A viewer sees another person's work items,
// milestones and BRAID entries they own, only on projects the two share: projects the viewer reads now
// (getProject, P10) where the other is a current member or an outside contact. For an outside contact,
// what they are tied to there (PP3). Never their captures, commitments, inbox, nudges or settings: nothing
// here reads them (PP8). Leave shows only as the day it ends, or the dates of the next one (W3-D5), and only
// where the project already shows the viewer what that person's leave touches (D6: its PMs, Leads and admin). Someone who shares no
// project with the viewer is not here at all, so they read exactly as a name nobody has (PP1).
import { eq, inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { leaveRecordOf } from "../db/records";
import * as t from "../db/schema";
import type { IsoDate } from "../domain/dates";
import { isMember } from "../domain/machines/membership";
import { DECIDED_LEAVE, leaveAhead, leaveImpactOwners, onLeaveUntil, type LeaveRange } from "../domain/machines/leave";
import { namesPerson } from "../domain/names";
import { milestonesOf, projectsAsked, workOf } from "./answers/shared";
import { projectReader, todayIn, type PersonRef, type ProjectBraidEntry, type ProjectMilestone, type ProjectReader, type ProjectView, type ProjectWorkItem } from "./project";

/** Someone the viewer shares a project with, the viewer too, and the shared projects. */
export type SharedPerson = PersonRef & { projectIds: string[] };

type Project = { id: string; name: string };

/** What the viewer may see of one person on the projects they share (CD9). */
export type PersonSeen = {
  person: PersonRef;
  /** The shared projects in the question's scope. */
  projects: Project[];
  /** Work items they own that are not Done or cancelled. */
  work: { project: Project; w: ProjectWorkItem }[];
  /** Milestones they own that are not done. */
  milestones: { project: Project; m: ProjectMilestone }[];
  /** Entries on the BRAID log they own. */
  entries: { project: Project; e: ProjectBraidEntry }[];
  /** PP3, an outside contact: their tie, and the work it names and the entries on the log that name them. */
  ties: { project: Project; tie: string; work: ProjectWorkItem[]; entries: ProjectBraidEntry[] }[];
  /** PP7: the last day of the leave they are on today, where a shared project shows the viewer its impact. */
  onLeaveUntil: IsoDate | null;
  /** W3-D5: when they are not on leave today, the next leave decided, shown to the same viewers as onLeaveUntil. */
  leaveAhead: LeaveRange | null;
};

/** Everyone the viewer shares a project with: the members and outside contacts of the projects they read now. */
export async function sharedPeople(conn: Conn, viewerId: string): Promise<SharedPerson[]> {
  const { world, mayRead } = await projectReader(conn, viewerId);
  const ids = world.projects.filter((p) => mayRead(p.id)).map((p) => p.id);
  if (!ids.length) return [];
  const contacts = await conn.select({ projectId: t.projectContacts.projectId, personId: t.projectContacts.personId }).from(t.projectContacts).where(inArray(t.projectContacts.projectId, ids));
  const ties = [...world.memberships.filter((m) => ids.includes(m.projectId) && m.state === "member"), ...contacts];
  const people = await conn.select({ id: t.people.id, name: t.people.name }).from(t.people).where(inArray(t.people.id, [...new Set(ties.map((x) => x.personId))]));
  return people
    .map((p) => ({ ...p, projectIds: [...new Set(ties.filter((x) => x.personId === p.id).map((x) => x.projectId))].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What the viewer may see of one person now, on the projects the two share (only the one named, when
 * the question names one the viewer reads); null when they share none (PP1). Read through getProject,
 * so the records are exactly as the viewer's own screens show them.
 */
export async function personSeenBy(conn: Conn, viewerId: string, personId: string, now: Date, projectId: string | null = null): Promise<PersonSeen | null> {
  return (await peopleSeenBy(conn, viewerId, [personId], now, projectId)).get(personId) ?? null;
}

/**
 * personSeenBy for several people at once, by id; someone who shares no project with the viewer is not
 * in it (PP1). The viewer's projects, and the people's contacts and leave, are read once for all of them
 * (phase N's who_free reads every teammate).
 */
export async function peopleSeenBy(conn: Conn, viewerId: string, personIds: readonly string[], now: Date, projectId: string | null = null): Promise<Map<string, PersonSeen>> {
  const seen = new Map<string, PersonSeen>();
  const ids = [...new Set(personIds)];
  if (!ids.length) return seen;
  const reader = await projectReader(conn, viewerId);
  const people = await conn.select({ id: t.people.id, name: t.people.name }).from(t.people).where(inArray(t.people.id, ids));
  if (!people.length) return seen;
  const allContacts = await conn.select().from(t.projectContacts).where(inArray(t.projectContacts.personId, ids));
  const allLeave = await conn.select().from(t.leave).where(inArray(t.leave.personId, ids));
  const readable = await projectsAsked(conn, viewerId, null, now);
  const of = (v: ProjectView): Project => ({ id: v.project.id, name: v.project.name });

  for (const person of people) {
    const contactRows = allContacts.filter((c) => c.personId === person.id);
    const onIt = (v: ProjectView) => isMember(person.id, v.project.id, reader.world.memberships) || contactRows.some((c) => c.projectId === v.project.id);
    const shared = readable.filter(onIt);
    if (!shared.length) continue;
    const views = projectId ? shared.filter((v) => v.project.id === projectId) : shared;
    const projects = views.map(of);

    const ties = views.flatMap((v) => {
      const c = contactRows.find((x) => x.projectId === v.project.id);
      if (!c) return [];
      // PP3: the records the tie names ("contact on #151"), and the entries on the log that name them
      const numbers: string[] = c.tie.match(/#\d+/g) ?? [];
      const work = workOf(v).filter((w) => w.number && numbers.includes(w.number));
      const entries = v.braid.entries.filter((e) => e.onLog && namesPerson(e.title, person.name, false));
      return [{ project: of(v), tie: c.tie, work, entries }];
    });

    const theirs = <T extends { owner: PersonRef | null }>(x: T) => x.owner?.id === person.id;
    seen.set(person.id, {
      person,
      projects,
      work: views.flatMap((v) => ownedOn(v).work.filter(theirs).map((w) => ({ project: of(v), w }))),
      milestones: views.flatMap((v) => ownedOn(v).milestones.filter(theirs).map((m) => ({ project: of(v), m }))),
      entries: views.flatMap((v) => ownedOn(v).entries.filter(theirs).map((e) => ({ project: of(v), e }))),
      ties,
      ...leaveOf(viewerId, person.id, projects.map((p) => p.id), now, reader, allLeave.filter((l) => l.personId === person.id)),
    });
  }
  return seen;
}

/**
 * CD9: what a project shows as someone's, so what may be said of whoever owns it, in one place for
 * "What is Kemar working on?" and "Who owns the store feed?": work that is not Done or cancelled,
 * milestones that are not done, and entries live on the BRAID log (never one still proposed, closed
 * or replaced).
 */
export function ownedOn(v: ProjectView): { work: ProjectWorkItem[]; milestones: ProjectMilestone[]; entries: ProjectBraidEntry[] } {
  return {
    work: workOf(v).filter((w) => w.state !== "done" && w.state !== "cancelled"),
    milestones: milestonesOf(v).filter((m) => m.state !== "done"),
    entries: v.braid.entries.filter((e) => e.onLog),
  };
}

/**
 * PP7: the last day of the leave the person is on today, as this viewer may see it: only where one of
 * these projects shows the viewer what that person's leave touches (D6: its PMs, Leads and admin);
 * otherwise null, as if there were none. A caller that has the viewer's reader passes it.
 */
export async function leaveShownTo(
  conn: Conn,
  viewerId: string,
  personId: string,
  projectIds: readonly string[],
  now: Date,
  reader?: ProjectReader,
): Promise<IsoDate | null> {
  const r = reader ?? (await projectReader(conn, viewerId));
  if (!showsLeave(viewerId, personId, projectIds, r)) return null;
  const leave = await conn.select().from(t.leave).where(eq(t.leave.personId, personId));
  return leaveOf(viewerId, personId, projectIds, now, r, leave).onLeaveUntil;
}

/**
 * Phase P, LV2: the decided leave of each of these people that overlaps the given days, only where one of these
 * projects shows the viewer that person's leave (D6, as PP7); someone whose leave the viewer is not shown is not in it.
 * A request still waiting on the admin is not their leave yet.
 */
export async function awayDuring(conn: Conn, viewerId: string, personIds: readonly string[], projectIds: readonly string[], days: LeaveRange, reader?: ProjectReader): Promise<Map<string, LeaveRange>> {
  const out = new Map<string, LeaveRange>();
  if (!personIds.length) return out;
  const r = reader ?? (await projectReader(conn, viewerId));
  const rows = await conn.select().from(t.leave).where(inArray(t.leave.personId, [...personIds]));
  for (const personId of personIds) {
    if (!showsLeave(viewerId, personId, projectIds, r)) continue;
    const overlap = rows
      .filter((l) => l.personId === personId)
      .map(leaveRecordOf)
      .find((l) => DECIDED_LEAVE.includes(l.state) && l.start <= days.end && days.start <= l.end);
    if (overlap) out.set(personId, { start: overlap.start, end: overlap.end });
  }
  return out;
}

/** PP7, D6: whether one of these projects shows the viewer what this person's leave touches. */
function showsLeave(viewerId: string, personId: string, projectIds: readonly string[], { world, mayRead }: ProjectReader): boolean {
  return leaveImpactOwners(personId, world).some((o) => o.ownerId === viewerId && projectIds.includes(o.projectId) && mayRead(o.projectId));
}

/** PP7 and W3-D5: the leave they are on today, or else the next one, as the viewer may see it. */
function leaveOf(viewerId: string, personId: string, projectIds: readonly string[], now: Date, reader: ProjectReader, leave: (typeof t.leave.$inferSelect)[]): Pick<PersonSeen, "onLeaveUntil" | "leaveAhead"> {
  if (!showsLeave(viewerId, personId, projectIds, reader)) return { onLeaveUntil: null, leaveAhead: null };
  const records = leave.map(leaveRecordOf);
  const until = onLeaveUntil(records, todayIn(now));
  return { onLeaveUntil: until, leaveAhead: until ? null : leaveAhead(records, todayIn(now)) };
}
