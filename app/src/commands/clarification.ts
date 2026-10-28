// M21 Clarification (conversational plan, phase D): when Atlas is unsure which project or record an item of
// an update means, or which line of the open answer a reply decides (AC6, AC7), DPM asks in the author's own
// chat ("For "Worked on the store feed", do you mean #151 or #152?") with 2 or 3 options as buttons, instead
// of only leaving it for the review card. It lives inside the capture's review: answering only chooses,
// through the item's own machines (M14 PICK, or the record read again by the checks) or as the M20 card for
// the line, and every option is checked again when it is chosen (rule 4, CL5). Opening the review hands an
// item's question to it (CL3); its timer does the same after config.clarifyExpiryHours, or closes a line's,
// which has no review card ("Nothing was done; ask again"). A correction that withdraws the item closes its
// question (CV10), and a later reply that makes the card for one of a line question's options answers it
// (CL1). Wave 4 (CD50): a question whose words fit 2 or 3 of the asker's projects or people (EX5, PP2) is
// asked the same way; choosing one answers it as if it had named that one, and its timer closes it quietly
// ("Nothing was chosen; ask me again"), as a line's. Nothing here changes a record (rule 1).
import { and, desc, eq, inArray, lte, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import { itemOf } from "../db/records";
import * as t from "../db/schema";
import type { CheckContext } from "../domain/atlas-checks/types";
import { config } from "../domain/config";
import type { Moved } from "../domain/machine";
import { WORD_ACTS, type ChatCommandRecord, type WordAct } from "../domain/machines/chat-command";
import {
  applyClarificationEvent,
  askable,
  clarificationExpired,
  clarifyOutcomeText,
  draftClarification,
  isOwnChat,
  optionGoneText,
  readTypedAnswer,
  type ClarificationRecord,
  type ClarificationState,
  type ClarifyAbout,
  type ClarifyOption,
} from "../domain/machines/clarification";
import type { ExtractedItem } from "../domain/machines/extracted-item";
import { chosenQuestion, type AskedQuestion, type Which } from "../domain/question";
import { mayReport } from "../domain/rights";
import { topicById } from "../domain/topics";
import { answerFor, fitsReadBy } from "../queries/answer";
import { chosenLabel, optionsShown } from "../queries/clarification";
import { projectReader } from "../queries/project";
import { retargetItemIn, routeItemIn } from "./capture";
import { proposeLine, type WhichLines } from "./chat-command";
import { audit, CommandRefused, expectOne, moved, nextVersion, runCommand, type CommandCtx } from "./core";

type Row = typeof t.clarifications.$inferSelect;
type CaptureRow = typeof t.captures.$inferSelect;
type Actor = { actorType: "person" | "atlas" | "rule"; actorId: string | null };

/** CD50: answeredIn is the message now holding a chosen question's answer, for Atlas to word when it waits to be. */
export type ClarifyRun = { record: ClarificationRecord; message: string; answeredIn: string | null };

/** Section 17: with Atlas connected, a chosen question's answer waits to be worded, as a read's does. */
type Wording = { wordWithAtlas?: boolean };

function recordOf(row: Row): ClarificationRecord {
  return {
    id: row.id,
    captureId: row.captureId,
    authorId: row.authorId,
    about: row.about,
    extractionId: row.extractionId,
    command: row.answerCaptureId && row.act ? { answerCaptureId: row.answerCaptureId, act: row.act, reason: row.reason } : null,
    question: row.question ?? null,
    quote: row.quote,
    options: row.options,
    state: row.state,
    chosen: row.chosen,
    answeredBy: row.answeredBy,
    endedBy: row.endedBy,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

async function persist(tx: Tx, now: Date, row: Row, r: ClarificationRecord): Promise<void> {
  const rows = await tx
    .update(t.clarifications)
    .set({ state: r.state, chosen: r.chosen, answeredBy: r.answeredBy, endedBy: r.endedBy, decidedAt: r.decidedAt, version: nextVersion(t.clarifications.version), updatedAt: now })
    .where(and(eq(t.clarifications.id, row.id), eq(t.clarifications.version, row.version)))
    .returning({ id: t.clarifications.id });
  expectOne(rows, `clarification ${row.id}`);
}

function auditMove(tx: Tx, now: Date, r: ClarificationRecord, outcome: Moved<ClarificationState>, by: Actor, detail: Record<string, unknown> = {}) {
  return audit(tx, now, {
    ...by,
    action: outcome.event,
    machine: "clarification",
    subjectType: "clarification",
    subjectId: r.id,
    fromState: outcome.from,
    toState: outcome.to,
    captureId: r.captureId,
    extractionId: r.extractionId,
    detail: { about: r.about, options: r.options.map((o) => o.id), ...(r.chosen ? { chosen: r.chosen } : {}), ...(r.answeredBy ? { answeredBy: r.answeredBy } : {}), ...detail },
  });
}

/**
 * How it ended, naming the one chosen only while its author may still see it (CL5, P10), as the chat shows
 * it: a second tap after they left its project, or stopped sharing one with that person, says "Got it." alone.
 */
const messageOf = async (tx: Tx, r: ClarificationRecord) => clarifyOutcomeText(r, await chosenLabel(tx, r.authorId, r)) ?? "";

/** The words an item came from, as the author said them. */
const quoteOf = (text: string, item: ExtractedItem) => item.draft.spans.map((s) => text.slice(s.start, s.end)).join(" … ");

/** "#152 Store feed connector", as the author's own candidate data names it, with its project. */
function recordOption(ctx: CheckContext, id: string): ClarifyOption | null {
  for (const p of ctx.projects) {
    const r = p.records.find((x) => x.id === id);
    if (r) return { id, label: r.number ? `${r.number} ${r.title}` : r.title, projectId: p.id };
  }
  return null;
}

/** What one unsure item would ask, with its options as the author may read them now; null when it is sure. */
function unsureAbout(item: ExtractedItem, ctx: CheckContext): { about: ClarifyAbout; options: ClarifyOption[] } | null {
  const d = item.draft;
  if (d.routing === "choose_project" && d.options) {
    // Never an option the checks would refuse: an update stays in its record's project (D13), and a BRAID
    // item goes only where the author may report its kind (check 11)
    const fits = (p: CheckContext["projects"][number]) => (!d.target || p.records.some((r) => r.id === d.target!.id)) && (!d.braid || mayReport(p.role, d.braid.kind));
    const options = d.options.flatMap((id) => {
      const p = ctx.projects.find((x) => x.id === id);
      return p && fits(p) ? [{ id, label: p.name, projectId: id }] : [];
    });
    return { about: "project", options };
  }
  if (d.closeMatches && !d.closeMatches.chosen) return { about: "record", options: d.closeMatches.ids.flatMap((id) => recordOption(ctx, id) ?? []) };
  return null;
}

/**
 * CHECKS_DONE, in the read's transaction: at most one question per capture (section 6). The first item in
 * the message that is choose_project or has close matches, with 2 or 3 options (CD23, ProjectCap: with more,
 * only the review card asks); with none, a reply that could mean 2 or 3 lines of the open answer (phase B's
 * AC6 and AC7), whether or not the reply also holds an update: the review card holds only its items' choices
 * (the model check's item 1). Asked only in the author's own chat (rules 3 and 8).
 *
 * CL8 says no model, no question, because the rule path makes no proposals, so no item is ever asked about
 * without one. DPM's own rule does read a reply that decides lines (ruleCommands), and the lines it could
 * mean are asked about here as with a model: the same options the checks keep, as buttons in place of
 * "Say it again with its name".
 */
export async function askIfUnsure(tx: Tx, now: Date, capture: Pick<CaptureRow, "id" | "authorId" | "conversationId" | "channel" | "text">, items: readonly ExtractedItem[], which: WhichLines | null, ctx: CheckContext): Promise<ClarificationRecord | null> {
  const first = (i: ExtractedItem) => i.draft.spans[0]?.start ?? 0;
  const unsure = [...items]
    .sort((a, b) => first(a) - first(b))
    .map((item) => ({ item, ask: unsureAbout(item, ctx) }))
    .find((u) => u.ask && askable(u.ask.options.length));
  const fields = unsure?.ask
    ? { about: unsure.ask.about, extractionId: unsure.item.id, command: null, quote: quoteOf(capture.text, unsure.item), options: unsure.ask.options }
    : which
      ? {
          about: "line" as const,
          extractionId: null,
          command: { answerCaptureId: which.answerCaptureId, act: which.act, reason: which.reason },
          quote: capture.text,
          options: which.lines.map((l) => ({ id: String(l.line), label: l.title, projectId: l.projectId })),
        }
      : null;
  if (!fields || !askable(fields.options.length)) return null;
  return ask(tx, now, capture, fields);
}

/**
 * CD50, M21 CHECKS_DONE for a question: the words fit 2 or 3 of the asker's own projects (EX5) or people
 * (PP2), and nothing else in the message was asked about (CD23: one question per message, so an unsure
 * item or line goes first). The options are what the topic read for them now (P10). Asked only in the
 * author's own chat (rules 3 and 8); elsewhere the answer's own words ask for the name again. Asked with
 * no model too: the question and its fits are DPM's own reading (CL8).
 */
export async function askWhich(tx: Tx, now: Date, capture: Pick<CaptureRow, "id" | "authorId" | "conversationId" | "channel">, asked: AskedQuestion, which: Which): Promise<ClarificationRecord | null> {
  if (!askable(which.options.length)) return null;
  const options = which.options.map((o) => ({ ...o, projectId: null }));
  return ask(tx, now, capture, { about: "question", extractionId: null, command: null, question: { asked, fits: which.fits }, quote: asked.asked, options });
}

/** ASK, then stored once (rule 6); null when it is not asked (another chat, or asked already). */
async function ask(tx: Tx, now: Date, capture: Pick<CaptureRow, "id" | "authorId" | "conversationId" | "channel">, fields: Pick<ClarificationRecord, "about" | "extractionId" | "command" | "quote" | "options"> & Partial<Pick<ClarificationRecord, "question">>): Promise<ClarificationRecord | null> {
  const draft = draftClarification({ id: `clr-${capture.id}`, captureId: capture.id, authorId: capture.authorId, ...fields, createdAt: now });
  // Rules 3 and 8: which Atlas chat it came from is the conversation's (phase I's groups are other chats)
  const [conversation] = capture.conversationId ? await tx.select({ atlasChatId: t.conversations.atlasChatId }).from(t.conversations).where(eq(t.conversations.id, capture.conversationId)) : [];
  const r = applyClarificationEvent(draft, { type: "ASK" }, { actorId: capture.authorId, now, ownChat: isOwnChat(capture.channel, conversation?.atlasChatId) });
  if (!r.outcome.ok) return null;
  // Once only (rule 6): a read delivered twice asks once
  const inserted = await tx
    .insert(t.clarifications)
    .values({
      id: r.record.id,
      captureId: capture.id,
      authorId: capture.authorId,
      conversationId: capture.conversationId,
      about: r.record.about,
      extractionId: r.record.extractionId,
      answerCaptureId: r.record.command?.answerCaptureId ?? null,
      act: r.record.command?.act ?? null,
      reason: r.record.command?.reason ?? null,
      question: r.record.question,
      quote: r.record.quote,
      options: r.record.options,
      state: r.record.state,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: t.clarifications.id });
  if (!inserted.length) return null;
  await auditMove(tx, now, r.record, r.outcome, { actorType: "atlas", actorId: null });
  return r.record;
}

/**
 * The choice, in a savepoint of the answer's transaction, through the item's own machines or as the M20 card
 * (rule 1: nothing else). A refusal there is an option no longer allowed (CL5), and nothing changes.
 */
async function choose(tx: Tx, ctx: Pick<CommandCtx, "now" | "actorId">, r: ClarificationRecord, option: string): Promise<void> {
  if (r.about === "question") {
    // CD50, P10: a project they no longer read, or someone they no longer share one with, is refused with the
    // words of any gone option, and never named
    if (!(await fitsReadBy(tx, r.authorId, r.question!.fits)).has(option)) throw new CommandRefused("that one can no longer be asked about");
    return;
  }
  const [capture] = await tx.select().from(t.captures).where(eq(t.captures.id, r.captureId));
  if (r.about === "line") {
    const [answer] = await tx.select().from(t.captures).where(eq(t.captures.id, r.command!.answerCaptureId));
    const made = await proposeLine(tx, ctx.now, { id: r.captureId, authorId: r.authorId }, answer, { act: r.command!.act, line: Number(option), reason: r.command!.reason }, await projectReader(tx, r.authorId));
    if (!made || "note" in made) throw new CommandRefused(made?.note ?? "that line has nothing to do");
    return;
  }
  // It lives inside the capture's review (M2 proposed): once the review is open, the review holds it
  if (capture.state !== "proposed") throw new CommandRefused(`the update is ${capture.state}`);
  const [row] = await tx.select().from(t.extractions).where(eq(t.extractions.id, r.extractionId!));
  const item = itemOf(row);
  if (r.about === "project") await routeItemIn(tx, ctx, row, item, capture.text, { projectId: option }, "chat");
  else await retargetItemIn(tx, ctx, row, item, capture, option, "chat");
}

/**
 * CD50: a question answered as if it had named the one chosen, read now from the asker's own data (rule 4),
 * and kept with the message that chose: the question's own for a button, the reply for typed words (CL2),
 * so the answer follows what was said. With Atlas connected it waits to be worded, as any answer does.
 */
async function answerChosen(tx: Tx, now: Date, r: ClarificationRecord, captureId: string, words: Wording): Promise<string> {
  const asked = chosenQuestion(r.question!.asked, r.question!.fits, r.chosen!);
  const found = await answerFor(tx, r.authorId, asked, now);
  const answer = words.wordWithAtlas && topicById(found.topic).worded !== false ? { ...found, wording: "pending" as const, rulesText: found.text } : found;
  await tx.update(t.captures).set({ question: asked, answer }).where(eq(t.captures.id, captureId));
  return captureId;
}

/** ANSWER: a button, or typed words that fit one option. A second answer changes nothing and says how it ended. */
async function answerIn(tx: Tx, ctx: Pick<CommandCtx, "now" | "actorId">, row: Row, option: string, answeredBy: string | null, words: Wording = {}): Promise<ClarifyRun> {
  const seen = recordOf(row);
  if (seen.state !== "asked") return { record: seen, message: await messageOf(tx, seen), answeredIn: null };
  // A question past its time ends when touched, as the timer would a minute later
  if (clarificationExpired(seen, ctx.now)) {
    const r = await expire(tx, ctx.now, row);
    return { record: r, message: await messageOf(tx, r), answeredIn: null };
  }
  if (!seen.options.some((o) => o.id === option)) throw new CommandRefused("that is not one of the options");
  let allowed = true;
  try {
    await tx.transaction((sp) => choose(sp, ctx, seen, option));
  } catch (e) {
    if (!(e instanceof CommandRefused)) throw e;
    allowed = false;
  }
  const r = applyClarificationEvent(seen, { type: "ANSWER", option, answeredBy }, { actorId: ctx.actorId, now: ctx.now, allowed });
  if (!r.outcome.ok) throw new CommandRefused(allowed ? r.outcome.reason : optionGoneText(seen.about));
  await persist(tx, ctx.now, row, r.record);
  await auditMove(tx, ctx.now, r.record, r.outcome, { actorType: "person", actorId: ctx.actorId });
  const answeredIn = r.record.about === "question" ? await answerChosen(tx, ctx.now, r.record, answeredBy ?? r.record.captureId, words) : null;
  return { record: r.record, message: await messageOf(tx, r.record), answeredIn };
}

/** The author's own question; anyone else's reads as not found (P10). */
async function ownClarification(tx: Tx, actorId: string, id: string): Promise<Row> {
  const [row] = await tx.select().from(t.clarifications).where(eq(t.clarifications.id, id));
  if (!row || row.authorId !== actorId) throw new CommandRefused("no such question", "not_found");
  return row;
}

/** A button under the question (it carries the question, so the capture, CL4). */
export function answerClarification(ctx: CommandCtx, clarificationId: string, option: string, words: Wording = {}): Promise<ClarifyRun> {
  return runCommand(ctx, async (tx) => answerIn(tx, ctx, await ownClarification(tx, ctx.actorId, clarificationId), option, null, words));
}

/**
 * CL2, CL4: a reply in the same conversation whose words fit exactly one option of the newest open question
 * there is that answer, read against the options the chat shows (only those the author may still read, P10).
 * Returns null when they are not (CL1: the reply is read as a new message, and the question stays); a note
 * when the option they named can no longer be chosen (CL5).
 */
export async function answerInWords(tx: Tx, now: Date, reply: Pick<CaptureRow, "id" | "authorId" | "conversationId" | "text">, words: Wording = {}): Promise<{ id: string; note: string | null } | null> {
  if (!reply.conversationId) return null;
  const [open] = await tx
    .select()
    .from(t.clarifications)
    .where(and(eq(t.clarifications.authorId, reply.authorId), eq(t.clarifications.conversationId, reply.conversationId), eq(t.clarifications.state, "asked"), ne(t.clarifications.captureId, reply.id)))
    .orderBy(desc(t.clarifications.createdAt))
    .limit(1);
  if (!open) return null;
  if (clarificationExpired(recordOf(open), now)) {
    await expire(tx, now, open);
    return null;
  }
  // CL5, P10: "the second one" counts over the options shown, and an option no longer shown is not named
  const shown = await optionsShown(tx, reply.authorId, recordOf(open));
  // A project is also named by the other names people use for it ("Sprouts"), as an item's or a question's (CD50)
  const ids = shown.map((o) => o.id);
  const projects = open.about === "project" || open.question?.fits === "project";
  const aliases = projects && ids.length ? Object.fromEntries((await tx.select({ id: t.projects.id, aliases: t.projects.aliases }).from(t.projects).where(inArray(t.projects.id, ids))).map((p) => [p.id, p.aliases])) : {};
  const option = readTypedAnswer(reply.text, shown, aliases);
  if (!option) return null;
  try {
    await answerIn(tx, { now, actorId: reply.authorId }, open, option, reply.id, words);
    return { id: open.id, note: null };
  } catch (e) {
    if (e instanceof CommandRefused) return { id: open.id, note: optionGoneText(open.about) };
    throw e;
  }
}

/** CL3, M2 OPEN_REVIEW: the review card holds an item's choice from here; a line's question has none and stays. */
export async function handToReview(tx: Tx, now: Date, captureId: string, actorId: string): Promise<void> {
  const [row] = await tx.select().from(t.clarifications).where(and(eq(t.clarifications.captureId, captureId), eq(t.clarifications.state, "asked")));
  if (!row) return;
  const r = applyClarificationEvent(recordOf(row), { type: "REVIEW_OPENED" }, { actorId, now });
  if (!r.outcome.ok) return;
  await persist(tx, now, row, r.record);
  await auditMove(tx, now, r.record, r.outcome, { actorType: "person", actorId });
}

/** CL6: the capture is discarded or expires, and its open question closes with it. */
export async function closeWithCapture(tx: Tx, now: Date, captureId: string, by: Actor): Promise<void> {
  const [row] = await tx.select().from(t.clarifications).where(and(eq(t.clarifications.captureId, captureId), eq(t.clarifications.state, "asked")));
  if (!row) return;
  const r = applyClarificationEvent(recordOf(row), { type: "CLOSE" }, { actorId: by.actorId ?? row.authorId, now });
  await persist(tx, now, row, r.record);
  await auditMove(tx, now, r.record, moved(r.outcome), by);
}

/**
 * CV10, rule 5: a later correction withdrew the item a question asks about. Its options would all be refused
 * from here, so it closes ("You corrected this in a later message") rather than wait for its timer.
 */
export async function closeWithItem(tx: Tx, now: Date, extractionId: string): Promise<void> {
  const [row] = await tx.select().from(t.clarifications).where(and(eq(t.clarifications.extractionId, extractionId), eq(t.clarifications.state, "asked")));
  if (!row) return;
  const r = applyClarificationEvent(recordOf(row), { type: "CLOSE", because: "corrected" }, { actorId: row.authorId, now });
  await persist(tx, now, row, r.record);
  await auditMove(tx, now, r.record, moved(r.outcome), { actorType: "atlas", actorId: null });
}

/**
 * CL1, phase B: the author passed over a line question and said it again more clearly ("Approve the slip
 * one"), and that reply made the M20 card for one of its options, on the same answer and act. That is the
 * answer, in their own words: the question ends chosen and makes no second card, so it never says
 * "Nothing was done" under a card that was made.
 */
export async function answeredByCards(tx: Tx, now: Date, reply: { id: string; authorId: string }, made: readonly ChatCommandRecord[]): Promise<void> {
  const said = (c: ChatCommandRecord): c is ChatCommandRecord & { act: WordAct } => (WORD_ACTS as readonly string[]).includes(c.act);
  for (const card of made.filter(said)) {
    const open = await tx
      .select()
      .from(t.clarifications)
      .where(and(eq(t.clarifications.authorId, reply.authorId), eq(t.clarifications.about, "line"), eq(t.clarifications.state, "asked"), eq(t.clarifications.answerCaptureId, card.answerCaptureId), eq(t.clarifications.act, card.act), ne(t.clarifications.captureId, reply.id)));
    for (const row of open) {
      const option = String(card.line);
      // Past its time it ends as the timer would (answerIn)
      if (!row.options.some((o) => o.id === option) || clarificationExpired(recordOf(row), now)) continue;
      const r = applyClarificationEvent(recordOf(row), { type: "ANSWER", option, answeredBy: reply.id }, { actorId: reply.authorId, now, allowed: true });
      if (!r.outcome.ok) continue;
      await persist(tx, now, row, r.record);
      await auditMove(tx, now, r.record, r.outcome, { actorType: "person", actorId: reply.authorId }, { commandId: card.id });
    }
  }
}

/** Timer clarify_expiry (rule 5, CD2): an item's question goes to its review; a line's closes. */
export function runClarificationTimers(ctx: { db: Db; now: Date }): Promise<{ expired: string[] }> {
  return ctx.db.transaction(async (tx) => {
    const cutoff = new Date(ctx.now.getTime() - config.clarifyExpiryHours * 3_600_000);
    const due = await tx.select().from(t.clarifications).where(and(eq(t.clarifications.state, "asked"), lte(t.clarifications.createdAt, cutoff)));
    for (const row of due) await expire(tx, ctx.now, row);
    return { expired: due.map((r) => r.id) };
  });
}

async function expire(tx: Tx, now: Date, row: Row): Promise<ClarificationRecord> {
  const r = applyClarificationEvent(recordOf(row), { type: "EXPIRE" }, { actorId: row.authorId, now });
  const outcome = moved(r.outcome);
  await persist(tx, now, row, r.record);
  await auditMove(tx, now, r.record, outcome, { actorType: "rule", actorId: null });
  return r.record;
}
