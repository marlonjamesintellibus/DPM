// Why something is as it is (conversational plan, phase C, WY1 to WY8). The subject is read again now
// through getProject, so a project the asker can no longer read is no subject, answered exactly as one
// that never existed (WY1, P10). Four answers, as the plan's table has them: why a status (the set
// status with its reason, or the facts the rules read), what holds something up (blocked work and its
// links, with owners), when something was decided (up to three decisions, newest first), and why a field
// changed (the audit trail). A quote is shown only where rule 9 lets this viewer read it (WY5).
import { and, eq, inArray } from "drizzle-orm";
import type { Conn } from "../../db/conn";
import * as t from "../../db/schema";
import { isIsoDate, type IsoDate } from "../../domain/dates";
import type { AnswerCard } from "../../domain/question";
import { explainPlan, milestoneWhy, workItemWhy, type MilestoneWhy, type WorkItemWhy } from "../../domain/status/rules";
import type { Status } from "../../domain/status/status";
import { namesPerson } from "../../domain/names";
import { whyAsks, type WhySubject } from "../../domain/topics/why";
import { getAuditTrail, type AuditRow } from "../audit";
import {
  clockTime,
  ENTRY_STATE_LABEL,
  firstName,
  getProject,
  KIND_LABEL,
  MILESTONE_STATE_LABEL,
  peopleById,
  projectReader,
  STATUS_LABEL,
  todayIn,
  visibleQuotes,
  WORK_STATE_LABEL,
  type PersonRef,
  type ProjectBraidEntry,
  type ProjectMilestone,
  type ProjectView,
  type ProjectWorkItem,
} from "../project";
import { capped, counted, dayDate, milestonesOf, projectsAsked, workOf, workTitle, type AnswerBuilder, type Body } from "./shared";

/** WY1: the same words whether the subject is not theirs, gone, or never was. */
export const NOT_FOUND = "I can't find that in your projects. Ask about a project, a piece of work, a milestone or an entry on the BRAID log.";
/** WY8: a why about a person is not a why about a record (phase H decides what may be said of people). */
export const NOT_PEOPLE = "I can tell you about records, not people. Ask about a project, a piece of work or an entry on the BRAID log instead.";

const none = (text: string): Body => ({ text, cards: [], more: null });
const days = (n: number) => counted(n, "day", "days");
const who = (p: PersonRef | null, fallback = "Someone") => (p ? firstName(p.name) : fallback);
/** "Tue 20 Oct at 9:02am" */
const when = (at: Date) => `${dayDate(todayIn(at))} at ${clockTime(at)}`;
const logHref = (v: ProjectView, e: Pick<ProjectBraidEntry, "kind">) => `/projects/${v.project.id}?view=table&log=${e.kind}`;

type Found =
  | { type: "project" }
  | { type: "work_item"; w: ProjectWorkItem }
  | { type: "milestone"; m: ProjectMilestone }
  | { type: "braid_entry"; e: ProjectBraidEntry };

/** The subject in the project as this viewer reads it now, or null (WY1). */
function locate(v: ProjectView, s: WhySubject): Found | null {
  switch (s.type) {
    case "project":
      return v.project.id === s.id ? { type: "project" } : null;
    case "work_item": {
      const w = workOf(v).find((x) => x.id === s.id);
      return w ? { type: "work_item", w } : null;
    }
    case "milestone": {
      const m = milestonesOf(v).find((x) => x.id === s.id);
      return m ? { type: "milestone", m } : null;
    }
    case "braid_entry": {
      const e = v.braid.entries.find((x) => x.id === s.id);
      return e ? { type: "braid_entry", e } : null;
    }
  }
}

export const why: AnswerBuilder = async (conn, viewerId, question, now) => {
  const subject: WhySubject | null = question.subject ?? (question.projectId ? { type: "project", id: question.projectId, projectId: question.projectId } : null);
  if (!subject) {
    // WY4: "When did we decide to drop the TikTok scrape?" names no record; its words search the decisions
    if (whyAsks(question.asked, null) === "decided") return decided(await projectsAsked(conn, viewerId, null, now), question.asked, null, null);
    return none((await namesSomeone(conn, viewerId, question.asked)) ? NOT_PEOPLE : NOT_FOUND);
  }
  // Rule 4: read now, not when it was asked; a project they have left reads as one that never was
  const read = await getProject(conn, viewerId, subject.projectId, now);
  const found = read.found ? locate(read, subject) : null;
  if (!read.found || !found) return none(NOT_FOUND);
  const v = read;
  const today = todayIn(now);
  switch (whyAsks(question.asked, { type: found.type, kind: found.type === "braid_entry" ? found.e.kind : undefined })) {
    case "decided":
      return decided([v], question.asked, found.type === "braid_entry" ? found.e : null, v);
    case "holdup":
      return holdup(conn, v, found);
    case "changed":
      return changed(conn, viewerId, v, found, today);
    case "status":
      if (found.type === "work_item") return workStatus(v, found.w, today, question.asked);
      if (found.type === "milestone") return milestoneStatusAnswer(v, found.m, question.asked);
      if (found.type === "project") return projectStatus(v, today, question.asked);
      return changed(conn, viewerId, v, found, today);
  }
};

/** WY8: the words name someone in the asker's projects (members and contacts), by the one rule for names. */
async function namesSomeone(conn: Conn, viewerId: string, asked: string): Promise<boolean> {
  const { world, mayRead } = await projectReader(conn, viewerId);
  const ids = world.projects.filter((p) => mayRead(p.id)).map((p) => p.id);
  if (!ids.length) return false;
  const contacts = await conn.select({ personId: t.projectContacts.personId }).from(t.projectContacts).where(inArray(t.projectContacts.projectId, ids));
  const people = await peopleById(conn, [...world.memberships.filter((m) => ids.includes(m.projectId) && m.state === "member").map((m) => m.personId), ...contacts.map((c) => c.personId)]);
  return [...people.values()].some((p) => namesPerson(asked, p.name, false));
}

// ---- Why a status ----

const SAID_STATUS: [RegExp, Status][] = [
  [/\boff[ -]track\b/, "off_track"],
  [/\bat risk\b/, "at_risk"],
  [/\bon track\b/, "on_track"],
  [/\bnot started\b/, "not_started"],
];

/** "Forager 2.0 is On track" or, when they asked about another status, "Forager 2.0 is On track, not At risk" (WY2). */
function isStatus(name: string, status: Status | null, asked: string): string {
  const label = status ? STATUS_LABEL[status] : "without a status";
  const said = SAID_STATUS.find(([re]) => re.test(asked.toLowerCase()))?.[1];
  return `${name} is ${label}${said && said !== status ? `, not ${STATUS_LABEL[said]}` : ""}`;
}

function workFact(w: Pick<ProjectWorkItem, "dueDate" | "blockedNote" | "stateLabel">, why: WorkItemWhy): string {
  switch (why.because) {
    case "no_target":
      return "it has no due date, so it has no status";
    case "done":
      return "it is done";
    case "past_due":
      return `it is past its due date of ${dayDate(w.dueDate!)}, by ${days(why.daysLate)}`;
    case "blocked":
      return `it is blocked${w.blockedNote ? ` (${w.blockedNote})` : ""}`;
    case "to_do":
      return `it is still To do, due ${dayDate(w.dueDate!)}`;
    case "moving":
      return `it is ${w.stateLabel} and due ${dayDate(w.dueDate!)}`;
  }
}

function milestoneFact(m: Pick<ProjectMilestone, "targetDate" | "forecastDate">, why: MilestoneWhy): string {
  switch (why.because) {
    case "done":
      return "it is done";
    case "missed":
      return `it missed its target of ${dayDate(m.targetDate)}`;
    case "beyond_tolerance":
      return `it is forecast ${dayDate(m.forecastDate)}, ${days(why.daysLate)} after its target ${dayDate(m.targetDate)}, more than the ${days(why.toleranceDays)} allowed`;
    case "after_target":
      return `it is forecast ${dayDate(m.forecastDate)}, ${days(why.daysLate)} after its target ${dayDate(m.targetDate)}`;
    case "on_target":
      return `it is forecast ${dayDate(m.forecastDate)}, on or before its target ${dayDate(m.targetDate)}`;
  }
}

function workStatus(v: ProjectView, w: ProjectWorkItem, today: IsoDate, asked: string): Body {
  const why = workItemWhy(w, today);
  const card: AnswerCard = { title: workTitle(w), detail: `${v.project.name}: ${w.stateLabel}${w.owner ? `, owner ${who(w.owner)}` : ""}`, tag: w.statusLabel, href: `/projects/${v.project.id}` };
  const lead = why.status === null ? workTitle(w) : isStatus(workTitle(w), why.status, asked);
  return { text: `${lead}: ${workFact(w, why)}.`, cards: [card], more: null };
}

function milestoneStatusAnswer(v: ProjectView, m: ProjectMilestone, asked: string): Body {
  const why = milestoneWhy(m);
  const card: AnswerCard = { title: m.name, detail: `${v.project.name}: ${m.stateLabel}${m.owner ? `, owner ${who(m.owner)}` : ""}`, tag: m.statusLabel, href: `/projects/${v.project.id}` };
  return { text: `${isStatus(m.name, why.status, asked)}: ${milestoneFact(m, why)}.`, cards: [card], more: null };
}

/**
 * A set status: who set it, when, the reason and the entries it links, and whether the plan moved
 * since (WY3). A calculated one: the rows the rules read to give it ("Needed first", M12).
 */
function projectStatus(v: ProjectView, today: IsoDate, asked: string): Body {
  const name = v.project.name;
  const set = v.setStatus;
  if (v.displayed.from === "set" && set && v.reason) {
    const r = v.reason;
    const parts = [
      `${isStatus(name, v.displayed.status, asked)}: ${who(set.setBy, "its owner")} set it${set.setAt ? ` on ${when(set.setAt)}` : ""}, with the reason "${r.text}".`,
      // WY3: the reason stands, and says the plan has moved since
      r.stale ? `That reason was ${r.staleNote}; the plan says ${v.calculated.label} now.` : set.differsFromPlan ? `The plan says ${v.calculated.label}.` : null,
    ];
    const cards: AnswerCard[] = r.links.map((l) => ({
      title: l.title,
      detail: `${name}: linked to the reason, ${l.stateLabel}`,
      tag: KIND_LABEL[l.kind],
      href: `/projects/${v.project.id}?view=table&log=${l.kind}`,
    }));
    return { text: parts.filter(Boolean).join(" "), ...capped(cards, { label: "on the BRAID log", href: `/projects/${v.project.id}?view=table` }) };
  }

  const rows = {
    threads: v.threads.map((th) => ({ id: th.id })),
    milestones: [...v.threads.flatMap((th) => th.milestones.map((m) => ({ ...m, threadId: th.id as string | null }))), ...v.unthreaded.milestones.map((m) => ({ ...m, threadId: null }))],
    workItems: [...v.threads.flatMap((th) => th.workItems.map((w) => ({ ...w, threadId: th.id as string | null }))), ...v.unthreaded.workItems.map((w) => ({ ...w, threadId: null }))],
  };
  const plan = explainPlan(rows, today);
  // A status set with no reason yet does not show (A4.3); say so before the plan's own
  const waiting = set?.waitingForReason ? `${who(set.setBy, "Its owner")} set it ${set.label}${set.setAt ? ` on ${when(set.setAt)}` : ""} with no reason yet, so it shows the plan's status. ` : "";
  const lead = isStatus(name, plan.project, asked);
  switch (plan.project) {
    case null:
      return none(`${waiting}${name} has no target yet: nothing on its plan has a date.`);
    case "done":
      return none(`${waiting}${lead}: everything on its plan with a date is done.`);
    case "not_started":
      return none(`${waiting}${lead}: nothing on its plan with a date has started.`);
    case "on_track":
      return none(`${waiting}${lead}: every open milestone is forecast on or before its target, and no work is late or blocked.`);
  }
  // "Trend model is forecast Sat 24 Oct, 1 day after its target Fri 23 Oct"
  const facts = plan.facts.map((f) =>
    f.type === "milestone" ? { title: f.row.name, fact: milestoneFact(f.row, f.why).replace(/^it /, "") } : { title: workTitle(f.row), fact: workFact(f.row, f.why).replace(/^it /, "") },
  );
  const cards: AnswerCard[] = facts.map((f) => ({ title: f.title, detail: `${name}: ${f.fact}`, tag: STATUS_LABEL[plan.project!], href: `/projects/${v.project.id}` }));
  const said = facts.length === 1 ? `${facts[0].title} ${facts[0].fact}` : `${counted(facts.length, "thing on it is", "things on it are")} ${STATUS_LABEL[plan.project]}`;
  return { text: `${waiting}${lead}, worked out from its plan: ${said}.`, ...capped(cards, { label: "on the plan", href: `/projects/${v.project.id}` }) };
}

// ---- What holds something up ----

async function holdup(conn: Conn, v: ProjectView, found: Found): Promise<Body> {
  const rows = await conn.select({ id: t.workItems.id, blockedLinks: t.workItems.blockedLinks }).from(t.workItems).where(eq(t.workItems.projectId, v.project.id));
  const linksOf = (id: string) => rows.find((r) => r.id === id)?.blockedLinks ?? [];
  const live = (ids: Iterable<string>) => v.braid.entries.filter((e) => [...ids].includes(e.id) && e.onLog);
  // Open blockers and dependencies linked to these entries (the feed blocker to the Sprouts IT dependency)
  const around = (entries: readonly ProjectBraidEntry[]) => live(entries.flatMap((e) => e.links.map((l) => l.entryId))).filter((e) => e.kind === "blocker" || e.kind === "dependency");

  let name: string;
  let work: ProjectWorkItem[] = [];
  let entries: ProjectBraidEntry[] = [];
  switch (found.type) {
    case "work_item":
      name = workTitle(found.w);
      work = found.w.state === "blocked" ? [found.w] : [];
      entries = live(linksOf(found.w.id));
      break;
    case "milestone":
      name = found.m.name;
      work = workOf(v).filter((w) => w.milestoneId === found.m.id && w.state === "blocked");
      entries = live(work.flatMap((w) => linksOf(w.id)));
      break;
    case "project":
      name = v.project.name;
      work = workOf(v).filter((w) => w.state === "blocked");
      entries = v.braid.entries.filter((e) => e.onLog && (e.kind === "blocker" || e.kind === "dependency"));
      break;
    case "braid_entry":
      name = found.e.title;
      work = workOf(v).filter((w) => w.state === "blocked" && linksOf(w.id).includes(found.e.id));
      entries = found.e.kind === "blocker" || found.e.kind === "dependency" ? (found.e.onLog ? [found.e] : []) : [];
      break;
  }
  entries = [...entries, ...around(entries), ...(found.type === "braid_entry" ? around([found.e]) : [])].filter((e, i, all) => all.findIndex((x) => x.id === e.id) === i);
  // WY7: nothing linked is said plainly, never guessed
  if (!work.length && !entries.length) return none(`Nothing is recorded as holding up ${name}.`);

  const cards: AnswerCard[] = [
    ...work.map((w) => ({
      title: workTitle(w),
      detail: `${v.project.name}: Blocked${w.blockedNote ? `, ${w.blockedNote}` : ""}${w.owner ? `; owner ${who(w.owner)}` : ""}`,
      tag: "Blocked work",
      href: `/projects/${v.project.id}`,
    })),
    ...entries.map((e) => ({
      title: e.title,
      detail: `${v.project.name}: ${e.stateLabel}${e.owner ? `; owner ${who(e.owner)}` : ""}`,
      tag: e.kindLabel,
      href: logHref(v, e),
    })),
  ];
  const blockers = entries.filter((e) => e.kind === "blocker").length;
  const deps = entries.filter((e) => e.kind === "dependency").length;
  const said = [
    work.length === 1 && found.type === "work_item" ? `${name} is blocked${work[0].blockedNote ? ` (${work[0].blockedNote})` : ""}` : work.length ? `${counted(work.length, "work item is", "work items are")} blocked` : null,
    blockers || deps ? `${[blockers ? counted(blockers, "open blocker", "open blockers") : null, deps ? counted(deps, "open dependency", "open dependencies") : null].filter(Boolean).join(" and ")} ${blockers + deps === 1 ? "is" : "are"} linked` : null,
  ].filter(Boolean);
  const on = found.type === "work_item" ? "" : ` on ${name}`;
  return { text: `${said.join(", and ")}${on}.`.replace(/^./, (c) => c.toUpperCase()), ...capped(cards, { label: "on the BRAID log", href: `/projects/${v.project.id}?view=table` }) };
}

// ---- When something was decided ----

const STOP = new Set(
  "when did do does we they you i us our was were is it that this the a an to of on in for and or who what why decide decided decision decisions agree agreed approved about with at by from have has had ever di wi fi mi dem unu".split(" "),
);
const wordsOf = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").split(/[^a-z0-9#]+/).filter((w) => w.length >= 3 && !STOP.has(w));
// "drop" and "dropping", "scrape" and "scraping": the same word at four letters or more
const same = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a) || (a.length >= 5 && a.slice(0, 5) === b.slice(0, 5))));
const DECIDED_STATES = ["approved", "superseded", "proposed", "more_info"];

/**
 * WY4: decisions the words name, newest first, at most three, each linked to its log; the one Atlas named
 * is always among them. WY5: the quote only when rule 9 lets this viewer read it (getProject has applied it).
 */
function decided(views: readonly ProjectView[], asked: string, subject: ProjectBraidEntry | null, scope: ProjectView | null): Body {
  const words = wordsOf(asked);
  const all = views.flatMap((v) => v.braid.entries.filter((e) => e.kind === "decision" && DECIDED_STATES.includes(e.state)).map((e) => ({ v, e })));
  const dated = (e: ProjectBraidEntry) => e.decidedOn ?? e.updatedOn;
  const matching = all
    .filter(({ e }) => e.id === subject?.id || wordsOf(e.title).some((tw) => words.some((w) => same(w, tw))))
    .sort((a, b) => dated(b.e).localeCompare(dated(a.e)) || a.e.title.localeCompare(b.e.title));
  let top = matching.slice(0, 3);
  const named = matching.find(({ e }) => e.id === subject?.id);
  if (named && !top.includes(named)) top = [...top.slice(0, 2), named].sort((a, b) => dated(b.e).localeCompare(dated(a.e)));
  const where = scope ? `on ${scope.project.name}` : "in your projects";
  if (!top.length) return none(`I can't find a decision about that ${where}.`);

  const line = (e: ProjectBraidEntry) => {
    if (e.state === "approved") return `approved by ${who(e.decidedBy)}${e.decidedOn ? ` on ${dayDate(e.decidedOn)}` : ""}`;
    if (e.state === "superseded") return `approved by ${who(e.decidedBy)}${e.decidedOn ? ` on ${dayDate(e.decidedOn)}` : ""}, and replaced since by a later decision`;
    return `proposed by ${who(e.reportedBy)}, not decided yet`;
  };
  const cards: AnswerCard[] = top.map(({ v, e }) => {
    const quote = e.sources.find((s) => s.quote)?.quote;
    return { title: e.title, detail: `${v.project.name}: ${line(e)}${quote ? `. From: "${quote}"` : ""}`, tag: `Decision · ${e.stateLabel}`, href: logHref(v, e) };
  });
  if (top.length > 1) return { text: `${counted(top.length, "decision matches", "decisions match")}, newest first.`, cards, more: null };
  const { v, e } = top[0];
  const text =
    e.state === "approved" || e.state === "superseded"
      ? `${who(e.decidedBy)} approved "${e.title}" on ${v.project.name}${e.decidedOn ? ` on ${dayDate(e.decidedOn)}` : ""}${e.state === "superseded" ? "; a later decision replaced it" : ""}.`
      : `"${e.title}" on ${v.project.name} is not decided yet: ${who(e.reportedBy)} proposed it.`;
  return { text, cards, more: null };
}

// ---- Why a field changed ----

const LABELS: Record<string, Record<string, string>> = { work_item: WORK_STATE_LABEL, milestone: MILESTONE_STATE_LABEL, braid_entry: ENTRY_STATE_LABEL };

/** What one audited move did, in words: "moved the forecast from Fri 23 Oct to Sat 24 Oct". */
function didWhat(r: AuditRow): string | null {
  const labels = LABELS[r.subject.type] ?? {};
  const label = (s: string | null) => (s ? (labels[s] ?? s) : null);
  const forecast = r.detail?.forecast as { from?: string; to?: string } | undefined;
  if (r.action === "FORECAST_CHANGED" && forecast?.to && isIsoDate(forecast.to)) {
    return `moved the forecast ${forecast.from && isIsoDate(forecast.from) ? `from ${dayDate(forecast.from)} ` : ""}to ${dayDate(forecast.to)}`;
  }
  // WY6: the milestone timer, not a person
  if (r.action === "TARGET_PASSED") return `marked it ${label(r.to)} when its target date ${typeof r.detail?.target === "string" && isIsoDate(r.detail.target) ? `of ${dayDate(r.detail.target)} ` : ""}passed`;
  if (r.detail?.field === "blocked_note") return "changed the blocked note on it";
  if (r.from === "none" && r.to) return `reported it, as ${label(r.to)}`;
  if (r.from && r.to && r.from !== r.to) return `moved it from ${label(r.from)} to ${label(r.to)}`;
  if (r.to && r.from !== r.to) return `moved it to ${label(r.to)}`;
  return null;
}

/** The newest changes to the subject, up to three, with the rule or person and when, and the words they came from when visible. */
async function changed(conn: Conn, viewerId: string, v: ProjectView, found: Found, today: IsoDate): Promise<Body> {
  // A project has no field of its own: what changes it is its status, set or worked out
  if (found.type === "project") return projectStatus(v, today, "");
  const id = found.type === "work_item" ? found.w.id : found.type === "milestone" ? found.m.id : found.e.id;
  const name = found.type === "work_item" ? workTitle(found.w) : found.type === "milestone" ? found.m.name : found.e.title;
  const trail = await getAuditTrail(conn, viewerId, found.type === "braid_entry" ? { type: "braid_entry", id } : { type: "project", id: v.project.id });
  if (!trail.found) return none(NOT_FOUND);
  const moves = trail.entries
    .filter((r) => r.subject.id === id)
    .map((r) => ({ r, what: didWhat(r) }))
    .filter((x): x is { r: AuditRow; what: string } => x.what !== null)
    .slice(0, 3);
  if (!moves.length) return none(`No change to ${name} is recorded.`);

  // The update each came from, as this project may show it (rule 9): never the rest of the message
  const extractionIds = moves.map((m) => m.r.extractionId).filter((x): x is string => !!x);
  const extractions = extractionIds.length ? await conn.select().from(t.extractions).where(and(inArray(t.extractions.id, extractionIds), eq(t.extractions.projectId, v.project.id))) : [];
  const { world } = await projectReader(conn, viewerId);
  const quotes = await visibleQuotes(
    conn,
    viewerId,
    v.project.id,
    world,
    extractions.flatMap((x) => x.draft.spans.map((span, i) => ({ id: `${x.id}:${i}`, captureId: x.captureId, extractionId: x.id, span }))),
  );
  const quoteOf = (r: AuditRow) => (r.extractionId ? [...quotes.entries()].find(([k]) => k.startsWith(`${r.extractionId}:`))?.[1] : undefined);
  const actor = (r: AuditRow) => (r.actor.type === "person" ? (r.actor.name ? firstName(r.actor.name) : "Someone") : r.actor.type === "rule" ? "A rule" : r.actor.type === "atlas" ? "Atlas" : "DPM");

  const cards: AnswerCard[] = moves.map(({ r, what }) => {
    const quote = quoteOf(r);
    return {
      title: name,
      detail: `${v.project.name}: ${actor(r)} ${what}, ${when(r.at)}${quote ? `. From an update: "${quote}"` : ""}`,
      tag: r.actor.type === "rule" ? "By a rule" : r.captureId ? "From an update" : "Changed",
      href: found.type === "braid_entry" ? logHref(v, found.e) : `/projects/${v.project.id}`,
    };
  });
  const { r, what } = moves[0];
  const text = `${actor(r)} ${what.replace(/\bit\b/, name)} on ${when(r.at)}${r.actor.type === "rule" ? ", not a person" : ""}.`;
  return { text, cards, more: null };
}
