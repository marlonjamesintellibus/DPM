// Phase J, M28: what a standup reads and shows. The person's open work comes through the same per-viewer
// reads as "What am I working on?" (getProject per project they can read), so a question only names work of
// theirs on a project they can open now (P10, SU8). The chat shows each question under the message it was
// asked after, and only the person's own standup is ever read (M1).
import { and, eq } from "drizzle-orm";
import type { Conn } from "../db/conn";
import * as t from "../db/schema";
import { STANDUP_FINAL, TAP_LABEL, TAPS, type StandupRecord, type StandupState, type TapAnswer } from "../domain/machines/standup";
import { answerLabel, composeText, readableLines, readComposed, shownText, type OpenWork, type ShownText, type StandupRead } from "../domain/standup";
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
      .map(
        (w): OpenWork => ({
          type: "work_item",
          id: w.id,
          projectId: v.project.id,
          label: workTitle(w),
          number: w.number,
          // SU3: what the question shows, as the checks read it (a work forecast starts from the due date)
          saw: { state: w.state, forecast: w.forecastDate ?? w.dueDate },
          state: w.state,
          due: w.forecastDate ?? w.dueDate,
          blockedNote: w.blockedNote,
        }),
      ),
    ...milestonesOf(v)
      .filter((m) => m.owner?.id === personId && m.state !== "done")
      .map((m): OpenWork => ({ type: "milestone", id: m.id, projectId: v.project.id, label: m.name, number: null, saw: { forecast: m.forecastDate }, state: "milestone", due: m.forecastDate, blockedNote: null })),
  ]);
}

/**
 * Phase J: the capture a standup composed, read as its answers: what the taps propose, the typed answers
 * Atlas reads with their questions, and where check 2 looks for quotes; and the text as its author may read
 * it now (P10: a question about a project they have since left is left out, with its answer, everywhere it
 * would be shown or read). null for any other capture.
 */
export async function composedRead(conn: Conn, captureId: string): Promise<(StandupRead & { shown: ShownText }) | null> {
  const [row] = await conn.select().from(t.standups).where(eq(t.standups.captureId, captureId));
  if (!row) return null;
  const [[capture], [person], reader] = await Promise.all([
    conn.select({ text: t.captures.text }).from(t.captures).where(eq(t.captures.id, captureId)),
    conn.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, row.personId)),
    projectReader(conn, row.personId),
  ]);
  const composed = composeText(firstName(person?.name ?? ""), row.steps);
  // The capture holds what was composed; were it ever different, Atlas reads it all as their words
  const text = capture?.text ?? "";
  const all = [{ start: 0, end: text.length }];
  if (composed.text !== text) return { tapped: [], typed: text, quoteIn: all, ownWords: all, saw: {}, shown: { text, at: (span) => span } };
  const readable = readableLines(composed, reader.mayRead);
  return { ...readComposed(readable), shown: shownText(readable) };
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
