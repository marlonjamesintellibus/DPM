// Phase G, M25: the facts a draft is written from, read for its asker through the same per-viewer reads as
// the screens (getProject per project they can read, P10), and the draft as the chat shows it. A standup is
// what they saved since their last standup, what is in progress and what is blocked (their due commitments
// come with phase E); a client status is only what the client view shows (client-visible milestones by their
// target date, CD49, and the displayed status with its reason when the PM marked it shareable; never BRAID
// internals, DR4); a weekly summary is the project's week. Never a quote from anyone's update (CD8, DR7):
// each fact is a record, a date, a state or a name from DPM's tables.
import { and, eq, inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { itemOf } from "../db/records";
import * as t from "../db/schema";
import { addDays, addWorkingDays, daysBetween, WEEKDAYS, weekday, type IsoDate } from "../domain/dates";
import { DRAFT_LABEL, type DraftFact, type DraftFacts, type DraftKind, type DraftSection, type KnownNames } from "../domain/drafts";
import { ON_LOG_STATES } from "../domain/machines/braid-entry";
import { DRAFT_FINAL, draftEndText, type DraftBy, type DraftRecord, type DraftState } from "../domain/machines/draft";
import { withArticle } from "../domain/shared";
import { namesPerson, namesRecord } from "../domain/names";
import type { SettableStatus } from "../domain/status/status";
import { dayDate, milestonesOf, projectsAsked, workOf, workTitle } from "./answers/shared";
import { clockTime, ENTRY_STATE_LABEL, firstName, getProject, KIND_LABEL, peopleById, projectReader, STATUS_LABEL, todayIn, WORK_STATE_LABEL, type ProjectView } from "./project";
import { sharedPeople } from "./people";
import { loadTargetRecords, targetChange, type TargetRecords } from "./review";

type Row = typeof t.drafts.$inferSelect;

/** The machine's record, from its row. */
export function draftOf(row: Row): DraftRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    kind: row.kind,
    projectId: row.projectId,
    captureId: row.captureId,
    state: row.state,
    attempt: row.attempt,
    attemptAt: row.attemptAt,
    facts: row.facts,
    text: row.text,
    by: row.by,
    edited: row.edited,
    aside: row.aside,
    readyAt: row.readyAt,
    endedAt: row.endedAt,
  };
}

/**
 * DR3, rule 4: who may ask for a draft, read now. A standup is anyone's own; a client status or weekly summary
 * is for a PM or Lead of a project they can read now (a member, of a group still connected to DPM).
 */
export async function mayDraft(conn: Conn, viewerId: string, kind: DraftKind, projectId: string | null): Promise<boolean> {
  if (kind === "standup") return true;
  if (!projectId) return false;
  const { world, mayRead } = await projectReader(conn, viewerId);
  // Phase O, MT10: a call brief is any member's, from their own read of the project, client-safe all the same
  if (kind === "prep") return mayRead(projectId);
  return mayRead(projectId) && world.memberships.some((m) => m.personId === viewerId && m.projectId === projectId && m.state === "member" && (m.role === "pm" || m.role === "lead"));
}

// ---- My standup ----

/**
 * DR1: "since your last standup": the end of their latest standup with Atlas (M28, composed) or the copy of
 * their latest standup draft, whichever is later; with neither, the start of the previous working day.
 * `label` says it as the draft does: "since yesterday", "since 9:41am", "since Fri 16 Oct".
 */
export async function standupSince(conn: Conn, personId: string, now: Date): Promise<{ at: Date | null; day: IsoDate; label: string }> {
  const today = todayIn(now);
  const [standups, drafts] = await Promise.all([
    conn.select({ at: t.standups.updatedAt }).from(t.standups).where(and(eq(t.standups.personId, personId), eq(t.standups.state, "composed"))),
    conn.select({ at: t.drafts.endedAt }).from(t.drafts).where(and(eq(t.drafts.ownerId, personId), eq(t.drafts.kind, "standup"), eq(t.drafts.state, "copied"))),
  ]);
  const at = [...standups.map((s) => s.at), ...drafts.map((d) => d.at)].filter((x): x is Date => !!x && x < now).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const day = at ? todayIn(at) : addWorkingDays(today, -1);
  const ago = daysBetween(day, today);
  const label = at && ago === 0 ? `since ${clockTime(at)}` : ago === 1 ? "since yesterday" : `since ${dayDate(day)}`;
  return { at, day, label };
}

/**
 * Phase E's hook: the person's commitments due (M22), as facts for their standup ("Send Kyle the request,
 * due today"). Phase E is built in parallel; until it is wired here a standup has none, and its section is
 * left out of the template.
 */
export async function commitmentsDue(_conn: Conn, _personId: string, _now: Date): Promise<DraftFact[]> {
  return [];
}

const where = (multi: boolean, v: ProjectView) => (multi ? ` (${v.project.name})` : "");

/** One saved change, as the review tells it, without anyone's words (CD8): "#145 Google Trends connector: In progress to Done". */
function savedLine(row: typeof t.extractions.$inferSelect, records: TargetRecords): string | null {
  const d = row.draft;
  if (d.braid && (row.kind === "braid_new" || row.kind === "braid_same")) return `Reported ${withArticle(KIND_LABEL[d.braid.kind].toLowerCase())}: ${d.braid.title}`;
  if (d.braid && row.kind === "braid_resolve") return `Reported as ended: ${d.braid.title}`;
  const target = d.target;
  // An ask (U5) changed nothing of theirs; a note is someone's words; leave is personal
  if (row.kind !== "update" || !target || d.ask || target.field === "blocked_note" || target.type === "leave") return null;
  const value = row.value ?? target.newValue;
  if (target.type === "work_item") {
    const w = records.workItems.find((x) => x.id === target.id);
    const title = w ? workTitle(w) : null;
    if (!title) return null;
    if (target.field === "forecast") return `${title}: forecast ${dayDate(value)}`;
    const label = (s: string | null) => (s ? (WORK_STATE_LABEL[s as keyof typeof WORK_STATE_LABEL] ?? s) : "none");
    return `${title}: ${label(target.oldValue)} to ${label(value)}`;
  }
  if (target.type === "milestone") {
    const name = records.milestones.find((x) => x.id === target.id)?.name;
    return name ? `${name}: forecast ${dayDate(value)}` : null;
  }
  const step = records.steps.find((x) => x.id === target.id)?.title;
  return step ? `${step}: ${targetChange(itemOf(row), records)}` : null;
}

export async function standupFacts(conn: Conn, personId: string, projectId: string | null, now: Date): Promise<DraftFacts> {
  const views = await projectsAsked(conn, personId, projectId, now);
  const multi = views.length > 1;
  const viewOf = new Map(views.map((v) => [v.project.id, v]));
  const since = await standupSince(conn, personId, now);
  const fresh = (at: Date | null) => !!at && at <= now && (since.at ? at > since.at : todayIn(at) >= since.day);

  // What they saved, into projects they can read now (P10), oldest first
  const applied = viewOf.size
    ? (
        await conn
          .select({ row: t.extractions })
          .from(t.extractions)
          .innerJoin(t.captures, eq(t.captures.id, t.extractions.captureId))
          .where(and(eq(t.captures.authorId, personId), eq(t.extractions.state, "applied"), inArray(t.extractions.projectId, [...viewOf.keys()])))
      )
        .map((r) => r.row)
        .filter((r) => fresh(r.appliedAt))
        .sort((a, b) => a.appliedAt!.getTime() - b.appliedAt!.getTime() || a.ordinal - b.ordinal)
    : [];
  const records = await loadTargetRecords(conn, applied.map((r) => r.draft));
  const saved: DraftFact[] = applied.flatMap((r) => {
    const line = savedLine(r, records);
    return line ? [{ key: `saved:${r.id}`, text: `${line}${where(multi, viewOf.get(r.projectId!)!)}` }] : [];
  });

  const mine = views.flatMap((v) => workOf(v).filter((w) => w.owner?.id === personId).map((w) => ({ v, w })));
  const going: DraftFact[] = mine
    .filter(({ w }) => w.state === "in_progress")
    .map(({ v, w }) => {
      const due = w.forecastDate ?? w.dueDate;
      return { key: `work:${w.id}`, name: w.title, text: `${workTitle(w)}${where(multi, v)}${due ? `, due ${dayDate(due)}` : ""}` };
    });
  // What it waits on is the BRAID entries it links on the log, by their titles; the note is left out (CD8)
  const blocked: DraftFact[] = mine
    .filter(({ w }) => w.state === "blocked")
    .map(({ v, w }) => {
      const on = w.blockedLinks.flatMap((id) => v.braid.entries.filter((e) => e.id === id).map((e) => e.title));
      return { key: `work:${w.id}`, name: w.title, text: `${workTitle(w)}${where(multi, v)}${on.length ? `, waiting on ${on.join(" and ")}` : ""}` };
    });

  // P10: the projects these facts come from, so the draft closes once its owner can no longer read one of them
  // (phase E's commitments, once wired, add theirs)
  const projectIds = [...new Set([...applied.map((r) => r.projectId!), ...mine.filter(({ w }) => w.state === "in_progress" || w.state === "blocked").map(({ v }) => v.project.id)])].sort();
  const [person] = await conn.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, personId));
  const sinceTitle = since.label[0].toUpperCase() + since.label.slice(1);
  const sections: DraftSection[] = [
    // DR1: "No changes since yesterday", and what is in progress still follows
    { title: sinceTitle, facts: saved, none: `No changes ${since.label}.` },
    { title: "In progress", facts: going, none: "Nothing in progress." },
    { title: "Blocked", facts: blocked, none: "Nothing blocked." },
    { title: "Due", facts: await commitmentsDue(conn, personId, now), none: null },
  ];
  return { kind: "standup", heading: `${firstName(person?.name ?? "")}'s standup, ${dayDate(todayIn(now))}`, sections, asOf: now.toISOString(), projectIds };
}

// ---- Client status ----

/**
 * The client view of one project, read through the asker's own view of it: the milestones marked as releases,
 * by their target date (CD49), and the displayed status with its reason only when its PM marked that reason
 * shareable. `hidden` is every name of the project the client view does not show (milestones that are not
 * releases, work, BRAID entries), so no draft or copy carries one (DR4). null when they cannot read it.
 */
export async function clientStatusFacts(conn: Conn, viewerId: string, projectId: string, now: Date): Promise<{ facts: DraftFacts; hidden: string[] } | null> {
  const v = await getProject(conn, viewerId, projectId, now);
  if (!v.found) return null;
  const milestones = milestonesOf(v);
  const releases: DraftFact[] = milestones
    .filter((m) => m.clientVisible)
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate) || a.name.localeCompare(b.name))
    .map((m) => ({ key: `release:${m.id}`, name: m.name, text: m.state === "done" ? `${m.name}: done` : `${m.name}: planned ${dayDate(m.targetDate)}` }));
  const shared = v.displayed.from === "set" && v.reason?.clientShareable ? v.reason : null;
  const status: DraftFact[] = shared ? [{ key: `status:${projectId}`, name: v.displayed.label, text: `${v.displayed.label}: ${shared.text.trim().replace(/\.$/, "")}` }] : [];
  const hidden = [
    ...milestones.filter((m) => !m.clientVisible).map((m) => m.name),
    ...workOf(v).flatMap((w) => [w.title, ...(w.number ? [w.number] : [])]),
    ...v.braid.entries.map((e) => e.title),
  ];
  const heading = `${v.project.name}${v.project.customer ? ` for ${v.project.customer}` : ""}: client status, ${dayDate(todayIn(now))}`;
  return {
    facts: {
      kind: "client",
      heading,
      sections: [
        { title: "Releases", facts: releases, none: "No releases are shared with the client yet." },
        { title: "Status", facts: status, none: null },
      ],
      asOf: now.toISOString(),
      projectIds: [projectId],
    },
    hidden,
  };
}

// ---- Weekly summary ----

/** The Monday of the week a day is in. */
export function weekStart(day: IsoDate): IsoDate {
  return addDays(day, -((WEEKDAYS.indexOf(weekday(day)) + 6) % 7));
}

const CLOSED: readonly string[] = ["resolved", "closed", "realised", "confirmed", "broken", "met", "late", "superseded"];
const onLog = (state: string | null) => (ON_LOG_STATES as readonly (string | null)[]).includes(state);

/**
 * The project's week so far, from Monday, as the asker reads the project: work marked done, milestones whose
 * forecast moved or that were done, BRAID entries that went on the log and that ended, and status changes.
 * Each is dated by its move in the audit trail, and is listed only as it stands now (an undone change is not).
 */
export async function weeklyFacts(conn: Conn, viewerId: string, projectId: string, now: Date): Promise<DraftFacts | null> {
  const v = await getProject(conn, viewerId, projectId, now);
  if (!v.found) return null;
  const monday = weekStart(todayIn(now));
  const thisWeek = (at: Date) => at <= now && todayIn(at) >= monday;
  const work = workOf(v);
  const milestones = milestonesOf(v);
  const entries = v.braid.entries;
  const ids = [projectId, ...work.map((w) => w.id), ...milestones.map((m) => m.id), ...entries.map((e) => e.id)];
  const moves = (await conn.select().from(t.auditEntries).where(inArray(t.auditEntries.subjectId, ids))).filter((a) => thisWeek(a.at)).sort((a, b) => a.at.getTime() - b.at.getTime() || a.id - b.id);
  const movesOf = (id: string, machine: string) => moves.filter((a) => a.subjectId === id && a.machine === machine);

  const done: DraftFact[] = work.filter((w) => w.state === "done" && movesOf(w.id, "work_item").some((a) => a.toState === "done")).map((w) => ({ key: `done:${w.id}`, name: w.title, text: workTitle(w) }));

  const moved: DraftFact[] = milestones.flatMap((m) => {
    const mine = movesOf(m.id, "milestone");
    if (m.state === "done" && mine.some((a) => a.toState === "done")) return [{ key: `ms:${m.id}`, name: m.name, text: `${m.name}: done` }];
    const forecasts = mine.filter((a) => a.action === "FORECAST_CHANGED");
    const was = (forecasts[0]?.detail?.forecast as { from?: string } | undefined)?.from;
    if (!forecasts.length || !was || was === m.forecastDate) return [];
    return [{ key: `ms:${m.id}`, name: m.name, text: `${m.name}: forecast ${dayDate(m.forecastDate)}, was ${dayDate(was)}` }];
  });

  // Onto the log: the first move onto it, or for an entry with none on record (the seed), its first report
  const opened: DraftFact[] = [];
  const ended: DraftFact[] = [];
  for (const e of entries) {
    const mine = movesOf(e.id, "braid_entry");
    const wentOn = mine.find((a) => onLog(a.toState) && !onLog(a.fromState));
    const firstReport = e.sources[0]?.at;
    const anyBefore = e.sources.some((s) => todayIn(s.at) < monday);
    if (e.onLog && (wentOn || (!anyBefore && firstReport && thisWeek(firstReport) && !mine.length))) opened.push({ key: `on:${e.id}`, name: e.title, text: `${e.kindLabel}: ${e.title}` });
    if (CLOSED.includes(e.state) && mine.some((a) => a.toState === e.state)) ended.push({ key: `off:${e.id}`, name: e.title, text: `${e.kindLabel}, ${ENTRY_STATE_LABEL[e.state].toLowerCase()}: ${e.title}` });
  }

  // A status set or cleared, or the plan clearing it (M9), told as "Any updates?" tells it
  const statusMoves = movesOf(projectId, "set_status");
  const movers = await peopleById(conn, statusMoves.map((a) => a.actorId));
  const status: DraftFact[] = statusMoves.flatMap((a) => {
    const who = a.actorId ? firstName(movers.get(a.actorId)?.name ?? "Someone") : "Someone";
    const set = (a.detail?.setStatus ?? a.detail?.status) as SettableStatus | undefined;
    const when = dayDate(todayIn(a.at));
    if (a.action === "OWNER_SETS" && a.toState !== "calculated_only" && set) return [{ key: `status:${a.id}`, text: `${who} set it ${STATUS_LABEL[set]}, ${when}` }];
    if (a.action === "OWNER_SETS" && a.toState === "calculated_only") return [{ key: `status:${a.id}`, text: `${who} cleared the set status, ${when}` }];
    if (a.action === "CALCULATED_CHANGED" && a.toState === "calculated_only" && a.fromState !== "calculated_only") return [{ key: `status:${a.id}`, text: `The set status ended: the plan agrees with it now, ${when}` }];
    return [];
  });

  const none = "None this week.";
  return {
    kind: "weekly",
    heading: `${v.project.name}: weekly summary, week of ${dayDate(monday)}, as of ${dayDate(todayIn(now))}`,
    sections: [
      { title: "Work done", facts: done, none },
      { title: "Milestones", facts: moved, none },
      { title: "On the BRAID log", facts: opened, none },
      { title: "Ended", facts: ended, none },
      { title: "Status", facts: status, none: `${v.displayed.label}, no change this week.` },
    ],
    asOf: now.toISOString(),
    projectIds: [projectId],
  };
}

// ---- A call brief (phase O) ----

/**
 * Phase O, MT9: the projects a call brief could be about, among those the asker reads (P10): one whose name or
 * alias the words say, else those whose customer they name ("Sprouts"), else those with a contact they name
 * ("Kyle"). Never a project the asker cannot read, so two that fit can only be two of theirs.
 */
export async function prepProjects(conn: Conn, viewerId: string, who: string): Promise<{ id: string; name: string }[]> {
  const { mayRead } = await projectReader(conn, viewerId);
  const projects = (await conn.select().from(t.projects).orderBy(t.projects.name)).filter((p) => mayRead(p.id));
  const said = who.trim().toLowerCase();
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const named = projects.filter((p) => [p.name, ...p.aliases].some((n) => n.toLowerCase() === said || words(said).join(" ") === words(n).join(" ")));
  if (named.length) return named.map((p) => ({ id: p.id, name: p.name }));
  const customers = projects.filter((p) => p.customer && words(said).some((w) => words(p.customer!).includes(w)));
  if (customers.length) return customers.map((p) => ({ id: p.id, name: p.name }));
  const ids = projects.map((p) => p.id);
  const contacts = ids.length
    ? await conn.select({ projectId: t.projectContacts.projectId, name: t.people.name }).from(t.projectContacts).innerJoin(t.people, eq(t.people.id, t.projectContacts.personId)).where(inArray(t.projectContacts.projectId, ids))
    : [];
  const byContact = new Set(contacts.filter((c) => namesPerson(who, c.name, false)).map((c) => c.projectId));
  return projects.filter((p) => byContact.has(p.id)).map((p) => ({ id: p.id, name: p.name }));
}

/**
 * Phase O: a brief for a call with the client (M25's prep), client-safe by default (rule 8): what the client view
 * shows (the releases by their target date, CD49), the displayed status only once its PM shared the reason, and
 * the open dependencies on the client's people (its contacts, or the customer by name) with the dates they were
 * expected. Two hooks wait: chases waiting on the client come with phase M (outbound asks, not built), and recent
 * decisions only once the client view shows decisions (KB A7.2 shows releases and dates only). Read through the
 * asker's own view of the project (P10, MT10); `hidden` are the names it must not carry, as for a client status.
 */
export async function prepFacts(conn: Conn, viewerId: string, projectId: string, now: Date): Promise<{ facts: DraftFacts; hidden: string[] } | null> {
  const client = await clientStatusFacts(conn, viewerId, projectId, now);
  const v = await getProject(conn, viewerId, projectId, now);
  if (!client || !v.found) return null;
  const contacts = await conn.select({ name: t.people.name }).from(t.projectContacts).innerJoin(t.people, eq(t.people.id, t.projectContacts.personId)).where(eq(t.projectContacts.projectId, projectId));
  const customer = v.project.customer;
  const onClient = (title: string) => contacts.some((c) => namesPerson(title, c.name, false)) || (!!customer && new RegExp(`\\b${customer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(title));
  const waiting = v.braid.entries.filter((e) => e.kind === "dependency" && e.onLog && !["met", "late", "closed", "resolved"].includes(e.state) && onClient(e.title));
  const facts: DraftFact[] = waiting.map((e) => ({ key: `dep:${e.id}`, name: e.title, text: `${e.title}${e.expectedOn ? `, expected ${dayDate(e.expectedOn)}` : ""}` }));
  const given = new Set(waiting.map((e) => e.title));
  const [releases, status] = client.facts.sections;
  return {
    facts: {
      kind: "prep",
      heading: `${v.project.name}: brief for your call${customer ? ` with ${customer}` : ""}, ${dayDate(todayIn(now))}`,
      sections: [
        releases,
        status,
        { title: `Waiting on ${customer ?? "the client"}`, facts, none: "Nothing waits on them now." },
        // Phase M's hook: chases waiting on the client's people; and decisions, once the client view shows them
        { title: "Chases", facts: await chasesWaitingOn(conn, viewerId, projectId), none: null },
      ],
      asOf: now.toISOString(),
      projectIds: [projectId],
    },
    // A name inside a dependency it gives ("Store sales feed access" in "... from Sprouts IT") says nothing new
    hidden: client.hidden.filter((n) => !given.has(n) && ![...given].some((g) => namesRecord(g, n))),
  };
}

/** Phase M's hook (outbound asks, M32, not built yet): what the asker chased the client for, still waiting. None until then. */
export async function chasesWaitingOn(_conn: Conn, _viewerId: string, _projectId: string): Promise<DraftFact[]> {
  return [];
}

// ---- Any kind ----

/** The facts for a draft, read for the asker now; null when the project is not theirs to read (P10). */
export async function draftFacts(conn: Conn, viewerId: string, kind: DraftKind, projectId: string | null, now: Date): Promise<DraftFacts | null> {
  if (kind === "standup") return standupFacts(conn, viewerId, projectId, now);
  if (!projectId) return null;
  if (kind === "prep") return (await prepFacts(conn, viewerId, projectId, now))?.facts ?? null;
  return kind === "client" ? ((await clientStatusFacts(conn, viewerId, projectId, now))?.facts ?? null) : weeklyFacts(conn, viewerId, projectId, now);
}

/** Rule 8, DR4: a client-safe draft read again now, with the names it must not carry; null when not readable now. */
export async function clientSafeNow(conn: Conn, viewerId: string, kind: DraftKind, projectId: string, now: Date): Promise<{ facts: DraftFacts; hidden: string[] } | null> {
  return kind === "prep" ? prepFacts(conn, viewerId, projectId, now) : clientStatusFacts(conn, viewerId, projectId, now);
}

/**
 * DR2, DR4: every name DPM knows for the asker: on the projects they read now, the projects, milestones, work
 * and BRAID entries; and the people they share one of those projects with, members and contacts alike ("Kyle
 * sent the feed" names Kyle even at the start of a sentence), never someone from another org (P10). A draft that
 * names one it was not given is refused, by the CD30 rule (domain/names.ts): "I will keep going" names nobody
 * called Will, and "the data sources" is not the milestone Data sources.
 */
export async function knownNames(conn: Conn, viewerId: string, now: Date): Promise<KnownNames> {
  const [views, people] = await Promise.all([projectsAsked(conn, viewerId, null, now), sharedPeople(conn, viewerId)]);
  const records = views.flatMap((v) => [
    v.project.name,
    ...milestonesOf(v).map((m) => m.name),
    ...workOf(v).flatMap((w) => [w.title, ...(w.number ? [w.number] : [])]),
    ...v.braid.entries.map((e) => e.title),
  ]);
  return { records: [...new Set(records)].filter((n) => n.trim().length > 2), people: [...new Set(people.map((p) => p.name))].filter((n) => n.trim().length > 2) };
}

// ---- In the chat ----

/**
 * A draft under the message that asked for it: its text while ready (the edits kept with it), what was kept
 * aside by a Refresh (DR5), "as of" the facts' time, and how it ended. A draft whose facts come from a project
 * its owner can no longer read shows no text (P10, draftClosed).
 */
export type DraftView = {
  id: string;
  kind: DraftKind;
  label: string;
  state: DraftState;
  /** The project it is about, as named when they could read it; null for a standup. */
  project: string | null;
  text: string | null;
  by: DraftBy | null;
  aside: string | null;
  /** DR5: "9:41am", when its facts were read. */
  asOf: string;
  /** P10: the project is no longer theirs to read, so nothing of it is shown. */
  closed: boolean;
  ended: string | null;
};

/**
 * P10: whether its owner can no longer read a project the draft's facts come from: the project it is about, or
 * for a standup asked for with no project, each project its work came from. Either way it is closed alike.
 */
export async function draftClosed(conn: Conn, row: Pick<Row, "ownerId" | "projectId" | "facts">): Promise<boolean> {
  const ids = [...new Set([...(row.projectId ? [row.projectId] : []), ...(row.facts.projectIds ?? [])])];
  if (!ids.length) return false;
  const { mayRead } = await projectReader(conn, row.ownerId);
  return ids.some((id) => !mayRead(id));
}

export async function draftViewOf(conn: Conn, capture: Pick<typeof t.captures.$inferSelect, "id" | "authorId">): Promise<DraftView | null> {
  const [row] = await conn.select().from(t.drafts).where(and(eq(t.drafts.captureId, capture.id), eq(t.drafts.ownerId, capture.authorId)));
  if (!row) return null;
  const closed = await draftClosed(conn, row);
  const [project] = row.projectId && !closed ? await conn.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, row.projectId)) : [];
  return {
    id: row.id,
    kind: row.kind,
    label: DRAFT_LABEL[row.kind],
    state: row.state,
    project: project?.name ?? null,
    text: closed ? null : row.text,
    by: row.by,
    aside: closed ? null : row.aside,
    asOf: clockTime(new Date(row.facts.asOf)),
    closed,
    ended: DRAFT_FINAL.includes(row.state) ? draftEndText(row) : null,
  };
}
