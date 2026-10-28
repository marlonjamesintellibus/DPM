// Phase P (conversational plan, section 18): a person's leave and their own work, read as they may see it now (P10).
// What is due while they are away: their open work items due then and their milestones due or forecast then, on
// projects they read now (LV7), and their live promises due then (private, CD3). Under the message that said the
// leave, each thing with who was asked or covers it, and the teammates who could be asked, with only what phase H's
// rule shows of them (CD9: open work and past due counts, and leave where the project shows it). The teammate sees
// an ask only while they read its project. Every fact comes from the per-viewer queries; nothing here writes.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { coverOf, leaveRecordOf } from "../db/records";
import * as t from "../db/schema";
import { whileAway, type AwayRange } from "../domain/away";
import { daysBetween, type IsoDate } from "../domain/dates";
import { itemKey, LIVE_HANDOVER, type CoverItem, type CoverRecord } from "../domain/machines/cover-request";
import { LIVE_COMMITMENT } from "../domain/machines/commitment";
import type { ExtractedItem } from "../domain/machines/extracted-item";
import { LIVE_LEAVE } from "../domain/machines/leave";
import { leaveRangeOf } from "../domain/away";
import { counted, dayDate, milestonesOf, projectsAsked, workOf, workTitle } from "./answers/shared";
import { awayDuring, peopleSeenBy } from "./people";
import { firstName, getProject, projectReader, todayIn, type PersonRef, type ProjectView } from "./project";

/** One thing of theirs due while away: "#152 Store feed connector is due Tue 27 Oct". */
export type AwayThing = { key: string; item: CoverItem; project: { id: string; name: string }; label: string; day: IsoDate; when: string };
/** One of their live promises due while away (CD3: theirs alone, so nobody can cover it; LV10 moves it). */
export type AwayPromise = { id: string; what: string; dueOn: IsoDate; when: string };

/** "Mon 26 Oct to Fri 30 Oct", or one day. */
export function awayLabel(range: AwayRange): string {
  return range.start === range.end ? dayDate(range.start) : `${dayDate(range.start)} to ${dayDate(range.end)}`;
}

function thingsIn(v: ProjectView, personId: string, range: AwayRange): AwayThing[] {
  const project = { id: v.project.id, name: v.project.name };
  const out: AwayThing[] = [];
  for (const w of workOf(v)) {
    if (w.owner?.id !== personId || w.state === "done" || w.state === "cancelled" || !whileAway(w.dueDate, range)) continue;
    out.push({ key: itemKey({ type: "work_item", id: w.id }), item: { type: "work_item", id: w.id, projectId: project.id }, project, label: workTitle(w), day: w.dueDate!, when: `is due ${dayDate(w.dueDate!)}` });
  }
  for (const m of milestonesOf(v)) {
    if (m.owner?.id !== personId || m.state === "done" || !whileAway(m.forecastDate, range)) continue;
    const when = m.forecastDate === m.targetDate ? `is due ${dayDate(m.targetDate)}` : `is forecast ${dayDate(m.forecastDate)}`;
    out.push({ key: itemKey({ type: "milestone", id: m.id }), item: { type: "milestone", id: m.id, projectId: project.id }, project, label: m.name, day: m.forecastDate, when });
  }
  return out;
}

/** What the person has due while away, on the projects they read now (LV7), soonest first. */
export async function awayFor(conn: Conn, personId: string, range: AwayRange, now: Date): Promise<{ things: AwayThing[]; promises: AwayPromise[] }> {
  const views = await projectsAsked(conn, personId, null, now);
  const things = views.flatMap((v) => thingsIn(v, personId, range)).sort((a, b) => a.day.localeCompare(b.day) || a.label.localeCompare(b.label));
  const promises = (await conn.select().from(t.commitments).where(and(eq(t.commitments.ownerId, personId), inArray(t.commitments.state, [...LIVE_COMMITMENT]))))
    .filter((c) => whileAway(c.dueOn, range))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))
    .map((c) => ({ id: c.id, what: c.what, dueOn: c.dueOn, when: `is due ${dayDate(c.dueOn)}` }));
  return { things, promises };
}

const joined = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? ""));

/** "While you're away (Mon 26 Oct to Fri 30 Oct): Trend model is forecast Mon 26 Oct." LV1 when nothing is. */
export function awayLine(range: AwayRange, things: readonly AwayThing[], promises: readonly AwayPromise[]): string {
  if (!things.length && !promises.length) return "Nothing of yours is due while you're away.";
  const parts = [...things.map((x) => `${x.label} ${x.when}`), ...promises.map((p) => `your promise "${p.what}" ${p.when}`)];
  return `While you're away (${awayLabel(range)}): ${joined(parts)}.`;
}

export type CoverStatus = { kind: "free" } | { kind: "asked"; who: string } | { kind: "covered"; who: string; waiting: boolean };

/** Someone who could be asked, with only what phase H's rule shows of them (CD9, PP6: facts, never a pick). */
export type Teammate = { id: string; name: string; facts: string; away: string | null };

export type AwayView = {
  /** Null before the update is saved: there is no leave to ask cover for yet. */
  leaveId: string | null;
  rangeLabel: string;
  line: string;
  things: (AwayThing & { status: CoverStatus; note: string | null })[];
  promises: AwayPromise[];
  /** Per project of the things: the other members, by name. */
  teammates: Record<string, Teammate[]>;
  /** Cover may be asked now: saved, the leave live, and not started (the model's suggestedWayOut). */
  open: boolean;
  /** Atlas's offer open now, which "No cover needed" ends by its id (rule 6); null when none is. */
  offerId: string | null;
  /** They said no cover is needed, and nothing is offered since. */
  dismissed: boolean;
};

/** Whose name a status says, first name only. */
async function namesOf(conn: Conn, ids: readonly string[]): Promise<Map<string, string>> {
  const rows = ids.length ? await conn.select({ id: t.people.id, name: t.people.name }).from(t.people).where(inArray(t.people.id, [...new Set(ids)])) : [];
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Where each thing stands: asked of someone, covered (waiting on the approval or handed over), or free; and why a free one is free again. */
function statusOf(key: string, requests: readonly CoverRecord[], names: Map<string, string>): { status: CoverStatus; note: string | null } {
  const name = (id: string | null) => firstName(names.get(id ?? "") ?? "Someone");
  const has = (r: CoverRecord) => r.items.some((i) => itemKey(i) === key);
  const live = requests.find((r) => has(r) && (r.state === "asked" || (r.state === "accepted" && LIVE_HANDOVER.includes(r.handover))));
  if (live?.state === "asked") return { status: { kind: "asked", who: name(live.toId) }, note: null };
  if (live) return { status: { kind: "covered", who: name(live.toId), waiting: live.handover === "waiting" }, note: null };
  // The newest ask that ended for it says why it is free again
  const ended = requests.find((r) => (has(r) && (r.state === "declined" || r.state === "unanswered")) || r.declined.some((i) => itemKey(i) === key));
  const note = !ended ? null : ended.state === "unanswered" && has(ended) ? `${name(ended.toId)} didn't answer` : `${name(ended.toId)} can't`;
  return { status: { kind: "free" }, note };
}

/** The other members of each project, with the facts who_free gives (CD9), and leave where the project shows it (LV2). */
async function teammatesFor(conn: Conn, viewerId: string, projectIds: readonly string[], range: AwayRange, now: Date): Promise<Record<string, Teammate[]>> {
  const reader = await projectReader(conn, viewerId);
  const today = todayIn(now);
  const out: Record<string, Teammate[]> = {};
  for (const projectId of projectIds) {
    const ids = reader.world.memberships.filter((m) => m.projectId === projectId && m.state === "member" && m.personId !== viewerId).map((m) => m.personId);
    const seen = await peopleSeenBy(conn, viewerId, ids, now);
    const away = await awayDuring(conn, viewerId, ids, [projectId], range, reader);
    out[projectId] = [...seen.values()]
      .map(({ person, work }) => {
        const late = work.filter(({ w }) => !!w.dueDate && w.dueDate < today).length;
        const off = away.get(person.id);
        return { id: person.id, name: person.name, facts: `${counted(work.length, "open work item", "open work items")}, ${late ? `${late} past due` : "none past due"}`, away: off ? `away ${awayLabel(off)}` : null };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

/**
 * Under a message that says leave: once saved, the leave as it is now (LV3: its dates read again), what is due then,
 * where each thing stands and who could be asked; before it is saved, the same facts from the dates on its card, to
 * read only. Null for a message with no leave in it, or a leave rejected, withdrawn or no longer live.
 */
export async function awayViewOf(conn: Conn, capture: Pick<typeof t.captures.$inferSelect, "authorId" | "state">, items: readonly ExtractedItem[], now: Date): Promise<AwayView | null> {
  const leaveItem = items.find((i) => i.draft.target?.type === "leave" && i.draft.leave);
  // LV6: back early is not time away to cover; "Catch me up" reads the days they were away
  if (!leaveItem || leaveItem.draft.leave!.back) return null;
  const personId = capture.authorId;
  let range: AwayRange | null = null;
  let leaveId: string | null = null;
  // D6: leave that matches live leave has nothing to save, so cover is asked for that leave at once
  const matched =
    leaveItem.draft.leave!.fit === "matches" && (capture.state === "proposed" || capture.state === "reviewing") && leaveItem.state !== "rejected" && leaveItem.state !== "withdrawn";
  if (capture.state === "saved" || matched) {
    if (!matched && leaveItem.state !== "applied" && leaveItem.state !== "no_change") return null;
    leaveId = leaveItem.draft.leave!.leaveId ?? `lv-${leaveItem.id}`;
    const [row] = await conn.select().from(t.leave).where(eq(t.leave.id, leaveId));
    if (!row || row.personId !== personId || !LIVE_LEAVE.includes(row.state)) return null;
    // LV3, D6: the approved dates stand while a change waits on the admin, so what is due is read from them
    const l = leaveRecordOf(row);
    range = { start: l.start, end: l.end };
  } else if (capture.state === "proposed" || capture.state === "reviewing") {
    if (leaveItem.state === "rejected" || leaveItem.state === "withdrawn") return null;
    const [start, end] = (leaveItem.value ?? "").split("/");
    range = start && end && end !== ".." ? { start, end } : leaveRangeOf(leaveItem.draft);
  }
  if (!range) return null;
  return awayView(conn, personId, leaveId, range, now);
}

async function awayView(conn: Conn, personId: string, leaveId: string | null, range: AwayRange, now: Date): Promise<AwayView> {
  const { things, promises } = await awayFor(conn, personId, range, now);
  const requests = leaveId ? (await conn.select().from(t.coverRequests).where(eq(t.coverRequests.leaveId, leaveId)).orderBy(desc(t.coverRequests.createdAt), desc(t.coverRequests.id))).map(coverOf) : [];
  const names = await namesOf(conn, requests.flatMap((r) => (r.toId ? [r.toId] : [])));
  const shown = things.map((x) => ({ ...x, ...statusOf(x.key, requests, names) }));
  const started = daysBetween(range.start, todayIn(now)) >= 0;
  const open = !!leaveId && !started && things.length > 0;
  const projects = [...new Set(shown.filter((x) => x.status.kind === "free").map((x) => x.project.id))];
  const latest = requests[0];
  return {
    leaveId,
    rangeLabel: awayLabel(range),
    line: awayLine(range, things, promises),
    things: shown,
    promises,
    teammates: open ? await teammatesFor(conn, personId, projects, range, now) : {},
    open,
    dismissed: latest?.state === "withdrawn" && latest.endedWhy === "dismissed",
    offerId: requests.find((r) => r.state === "suggested")?.id ?? null,
  };
}

/** One request as the teammate asked sees it: only while they read its project now (P10), with only its own items. */
export type CoverAskView = {
  id: string;
  state: CoverRecord["state"];
  asker: PersonRef;
  project: { id: string; name: string };
  rangeLabel: string;
  items: { key: string; label: string; when: string }[];
  askedAt: Date | null;
};

export async function describeCoverAsk(conn: Conn, viewerId: string, requestId: string, now: Date): Promise<CoverAskView | null> {
  const [row] = await conn.select().from(t.coverRequests).where(eq(t.coverRequests.id, requestId));
  if (!row || !row.projectId || (row.toId !== viewerId && row.askerId !== viewerId)) return null;
  const r = coverOf(row);
  const v = await getProject(conn, viewerId, row.projectId, now);
  const [leave] = await conn.select().from(t.leave).where(eq(t.leave.id, row.leaveId));
  const [asker] = await conn.select({ id: t.people.id, name: t.people.name }).from(t.people).where(eq(t.people.id, row.askerId));
  if (!v.found || !leave || !asker) return null;
  // D6: the approved dates, as the ask was made for them
  const l = leaveRecordOf(leave);
  const range = { start: l.start, end: l.end };
  const all = thingsIn(v, row.askerId, { start: "1970-01-01", end: "2999-12-31" });
  const items = r.items.flatMap((i) => {
    const x = all.find((a) => a.key === itemKey(i));
    return x ? [{ key: x.key, label: x.label, when: x.when }] : [];
  });
  return { id: r.id, state: r.state, asker, project: { id: v.project.id, name: v.project.name }, rangeLabel: awayLabel(range), items, askedAt: r.askedAt };
}

/** One thing a teammate covered while the viewer was away, as it stands now. */
export type HandedOver = { label: string; project: { id: string; name: string }; who: string; now: string };

/**
 * Phase P, catch-up: each thing a teammate accepted to cover for this leave of the viewer's (its handover not
 * cancelled), and where it stands now, read through the viewer's own project view: a project they left is not
 * shown (LV7), and a thing no longer on its project is left out.
 */
export async function handedOver(conn: Conn, viewerId: string, leaveId: string, now: Date): Promise<HandedOver[]> {
  const rows = (await conn.select().from(t.coverRequests).where(and(eq(t.coverRequests.leaveId, leaveId), eq(t.coverRequests.askerId, viewerId), eq(t.coverRequests.state, "accepted"))))
    .map(coverOf)
    .filter((r) => r.handover !== "cancelled" && r.projectId);
  const names = await namesOf(conn, rows.map((r) => r.toId!));
  const out: HandedOver[] = [];
  for (const r of rows) {
    const v = await getProject(conn, viewerId, r.projectId!, now);
    if (!v.found) continue;
    const project = { id: v.project.id, name: v.project.name };
    const who = firstName(names.get(r.toId!) ?? "Someone");
    for (const i of r.items) {
      if (i.type === "work_item") {
        const w = workOf(v).find((x) => x.id === i.id);
        if (w) out.push({ label: workTitle(w), project, who, now: `${w.stateLabel}${w.dueDate ? `, due ${dayDate(w.dueDate)}` : ""}` });
      } else {
        const m = milestonesOf(v).find((x) => x.id === i.id);
        if (m) out.push({ label: m.name, project, who, now: `${m.stateLabel}, ${m.state === "done" ? "done" : `forecast ${dayDate(m.forecastDate)}`}` });
      }
    }
  }
  return out;
}

/** "Trend model and #152 Store feed connector" */
export function itemsSaid(items: readonly { label: string }[]): string {
  return joined(items.map((i) => i.label));
}
