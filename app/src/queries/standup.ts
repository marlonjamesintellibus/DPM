// Phase J, M28: what a standup reads and shows. The person's open work comes through the same per-viewer
// reads as "What am I working on?" (getProject per project they can read), so a question only names work of
// theirs on a project they can open now (P10, SU8). The chat shows each question under the message it was
// asked after, and only the person's own standup is ever read (M1).
import { and, eq, gte } from "drizzle-orm";
import type { Conn } from "../db/conn";
import * as t from "../db/schema";
import { STANDUP_FINAL, TAP_LABEL, TAPS, type StandupRecord, type StandupState, type TapAnswer } from "../domain/machines/standup";
import { answerLabel, composeText, readComposed, type OpenWork, type StandupRead } from "../domain/standup";
import { milestonesOf, projectsAsked, workOf, workTitle } from "./answers/shared";
import { firstName, projectReader, todayIn } from "./project";

/** The machine's record, from its row. */
export function standupOf(row: typeof t.standups.$inferSelect): StandupRecord {
  return {
    id: row.id,
    personId: row.personId,
    day: row.day,
    conversationId: row.conversationId,
    state: row.state,
    steps: row.steps,
    current: row.current,
    askedAt: row.askedAt,
    endedBy: row.endedBy,
  };
}

/** Today's standup of theirs, if there is one (SU10: one per person per day). */
export async function standupToday(conn: Conn, personId: string, now: Date) {
  const [row] = await conn.select().from(t.standups).where(and(eq(t.standups.personId, personId), eq(t.standups.day, todayIn(now))));
  return row ?? null;
}

/**
 * The person's open work, as their own reads show it now: work items they own that are To do, In progress
 * or Blocked, and milestones they own that are not done, on projects they can read (CQ3, SU8).
 */
export async function openWorkOf(conn: Conn, personId: string, now: Date): Promise<OpenWork[]> {
  const views = await projectsAsked(conn, personId, null, now);
  return views.flatMap((v) => [
    ...workOf(v)
      .filter((w) => w.owner?.id === personId && (w.state === "to_do" || w.state === "in_progress" || w.state === "blocked"))
      .map((w): OpenWork => ({ type: "work_item", id: w.id, projectId: v.project.id, label: workTitle(w), number: w.number, state: w.state, due: w.forecastDate ?? w.dueDate, blockedNote: w.blockedNote })),
    ...milestonesOf(v)
      .filter((m) => m.owner?.id === personId && m.state !== "done")
      .map((m): OpenWork => ({ type: "milestone", id: m.id, projectId: v.project.id, label: m.name, number: null, state: "milestone", due: m.forecastDate, blockedNote: null })),
  ]);
}

/**
 * The records a same-day update of theirs already speaks to: an item of it, still standing, targets them.
 * The standup only fills the gaps, so it does not ask about these (section 12).
 */
export async function coveredToday(conn: Conn, personId: string, now: Date): Promise<Set<string>> {
  const day = todayIn(now);
  const since = new Date(now.getTime() - 2 * 86_400_000);
  const captures = (await conn.select({ id: t.captures.id, at: t.captures.messageAt }).from(t.captures).where(and(eq(t.captures.authorId, personId), gte(t.captures.messageAt, since)))).filter((c) => todayIn(c.at) === day);
  const covered = new Set<string>();
  for (const c of captures) {
    for (const x of await conn.select({ draft: t.extractions.draft, state: t.extractions.state }).from(t.extractions).where(eq(t.extractions.captureId, c.id))) {
      if (x.state !== "withdrawn" && x.state !== "rejected" && x.draft.target) covered.add(x.draft.target.id);
    }
  }
  return covered;
}

/**
 * Phase J: the capture a standup composed, read as its answers: what the taps propose, the typed answers
 * Atlas reads with their questions, and where check 2 looks for quotes. null for any other capture.
 */
export async function composedRead(conn: Conn, captureId: string): Promise<StandupRead | null> {
  const [row] = await conn.select().from(t.standups).where(eq(t.standups.captureId, captureId));
  if (!row) return null;
  const [[capture], [person]] = await Promise.all([
    conn.select({ text: t.captures.text }).from(t.captures).where(eq(t.captures.id, captureId)),
    conn.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, row.personId)),
  ]);
  const composed = composeText(firstName(person?.name ?? ""), row.steps);
  // The capture holds what was composed; were it ever different, Atlas reads it all as their words
  const all = [{ start: 0, end: capture?.text.length ?? 0 }];
  if (composed.text !== capture?.text) return { tapped: [], typed: capture?.text ?? "", quoteIn: all, ownWords: all };
  return readComposed(composed);
}

/**
 * A standup in the chat, under one message: the questions asked after it, each with the tap that answered it,
 * "Skipped", or nothing when their own words follow as the next message; the question waiting now when it is
 * asked here, with its buttons; and how it ended, under the message where it ended. A question about a
 * project they can no longer read is not shown, nor named (P10); one still waiting offers only Skip.
 */
export type StandupView = {
  id: string;
  state: StandupState;
  steps: { n: number; text: string; answer: string | null }[];
  current: { n: number; text: string | null; taps: { answer: TapAnswer; label: string }[] } | null;
  ended: string | null;
};

/** How a standup ended, in plain words, as the chat says it under the last message. */
export function standupEndText(r: Pick<StandupRecord, "state" | "endedBy">): string | null {
  if (r.state === "composed") {
    return r.endedBy === "idle"
      ? "You stopped answering, so I put together what you had answered. It's below for you to review."
      : "That's your standup. I put your answers together below for you to review.";
  }
  if (r.state === "abandoned") return r.endedBy === "idle" ? "You didn't answer, so I closed your standup. Nothing was saved." : "Nothing was answered, so there's nothing to review.";
  return null;
}

export async function standupViewOf(conn: Conn, capture: Pick<typeof t.captures.$inferSelect, "id" | "authorId" | "conversationId">): Promise<StandupView | null> {
  if (!capture.conversationId) return null;
  const rows = await conn.select().from(t.standups).where(and(eq(t.standups.personId, capture.authorId), eq(t.standups.conversationId, capture.conversationId)));
  const row = rows.find((r) => r.startedBy === capture.id || r.steps.some((s) => s.askedIn === capture.id) || r.current?.askedIn === capture.id || r.shownIn === capture.id);
  if (!row) return null;
  const reader = await projectReader(conn, capture.authorId);
  const readable = (s: { subject: { projectId: string } | null }) => !s.subject || reader.mayRead(s.subject.projectId);
  const steps = row.steps.filter((s) => s.askedIn === capture.id && readable(s)).map((s) => ({ n: s.n, text: s.text, answer: answerLabel(s.answer) }));
  const q = row.current;
  const current = q && q.askedIn === capture.id ? { n: q.n, text: readable(q) ? q.text : null, taps: readable(q) ? TAPS[q.kind].map((answer) => ({ answer, label: TAP_LABEL[answer] })) : [] } : null;
  const ended = STANDUP_FINAL.includes(row.state) && row.shownIn === capture.id ? standupEndText(row) : null;
  if (!steps.length && !current && !ended) return null;
  return { id: row.id, state: row.state, steps, current, ended };
}

/** Phase J: the standup this capture holds the answers of, if it is one; the chat shows it as Atlas's, not theirs. */
export async function composedFrom(conn: Conn, captureId: string): Promise<string | null> {
  const [row] = await conn.select({ id: t.standups.id }).from(t.standups).where(eq(t.standups.captureId, captureId));
  return row?.id ?? null;
}
