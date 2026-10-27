// M20 Chat command (conversational plan, phase B): acting from an answer in the chat. A button on an
// answer line is a command confirmed in the same tap; a reply in words that decides a line ("Approve the
// Kyle risk") is a card the asker confirms or cancels within config.commandExpiryMinutes. Either way the
// right is checked now, then the version the answer showed (the model check's order, AC1 before AC2 and
// AC3), and done runs the very command the line's screen runs, in this transaction, with the message's
// capture id on its audit entries. A refusal changes nothing and says why; once only by its dedup key (AC4).
import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import * as t from "../db/schema";
import { commandNoteText, noLinkText, OUT_OF_DATE_TEXT, type CheckedCommands, type SaidCommand } from "../domain/acting";
import type { OpenAnswer } from "../domain/atlas-checks/types";
import { config } from "../domain/config";
import type { Outcome } from "../domain/machine";
import {
  applyChatCommandEvent,
  commandExpired,
  commandOutcomeText,
  draftCommand,
  rightLostText,
  type ChatCommandEvent,
  type ChatCommandRecord,
  type ChatCommandState,
  type CommandAct,
  type CommandInput,
  type Standing,
  type WordAct,
} from "../domain/machines/chat-command";
import { aboutOf, onlyBookkeepingSince, standingOf, whatChanged } from "../queries/acting";
import { projectReader } from "../queries/project";
import { decideBraidEntryIn, keepOpenIn, resolveBraidEntryIn } from "./braid";
import { audit, CommandRefused, expectOne, moved, nextVersion, runCommand, StaleVersion, type CommandCtx } from "./core";
import { draftReason, saveReasonIn } from "./status";
import { moveWorkItemIn } from "./work";

export type CommandRun = { record: ChatCommandRecord; message: string };

type Row = typeof t.chatCommands.$inferSelect;

function recordOf(row: Row): ChatCommandRecord {
  return {
    id: row.id,
    askerId: row.askerId,
    via: row.via,
    captureId: row.captureId,
    answerCaptureId: row.answerCaptureId,
    line: row.line,
    act: row.act,
    subject: { type: row.subjectType, id: row.subjectId, projectId: row.projectId },
    proposal: row.proposal,
    outcome: row.outcome,
    about: row.about,
    seenVersion: row.seenVersion,
    input: row.input,
    state: row.state,
    refusedWhy: row.refusedWhy,
    refusal: row.refusal,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

const fieldsOf = (r: ChatCommandRecord) => ({
  proposal: r.proposal,
  outcome: r.outcome,
  about: r.about,
  seenVersion: r.seenVersion,
  input: r.input,
  state: r.state,
  refusedWhy: r.refusedWhy,
  refusal: r.refusal,
  decidedAt: r.decidedAt,
});

async function insertCommand(tx: Tx, now: Date, r: ChatCommandRecord, dedupKey: string): Promise<boolean> {
  const rows = await tx
    .insert(t.chatCommands)
    .values({
      id: r.id,
      askerId: r.askerId,
      via: r.via,
      captureId: r.captureId,
      answerCaptureId: r.answerCaptureId,
      line: r.line,
      act: r.act,
      subjectType: r.subject.type,
      subjectId: r.subject.id,
      projectId: r.subject.projectId,
      ...fieldsOf(r),
      dedupKey,
      createdAt: r.createdAt,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: t.chatCommands.id });
  return rows.length === 1;
}

async function persist(tx: Tx, now: Date, row: Row, r: ChatCommandRecord): Promise<void> {
  const rows = await tx
    .update(t.chatCommands)
    .set({ ...fieldsOf(r), version: nextVersion(t.chatCommands.version), updatedAt: now })
    .where(and(eq(t.chatCommands.id, row.id), eq(t.chatCommands.version, row.version)))
    .returning({ id: t.chatCommands.id });
  expectOne(rows, `chat command ${row.id}`);
}

type Actor = { actorType: "person" | "rule"; actorId: string | null };

function auditMove(tx: Tx, now: Date, r: ChatCommandRecord, outcome: Extract<Outcome<ChatCommandState>, { ok: true }>, by: Actor) {
  return audit(tx, now, {
    ...by,
    action: outcome.event,
    machine: "chat_command",
    subjectType: "chat_command",
    subjectId: r.id,
    fromState: outcome.from,
    toState: outcome.to,
    captureId: r.captureId,
    detail: { act: r.act, via: r.via, line: r.line, subject: r.subject, answer: r.answerCaptureId, ...(r.refusedWhy ? { refusedWhy: r.refusedWhy } : {}) },
  });
}

/** When the answer the command came from was given: what "changed since" is measured from. */
async function answeredAt(tx: Tx, r: ChatCommandRecord): Promise<Date> {
  const [answer] = await tx.select({ answer: t.captures.answer }).from(t.captures).where(eq(t.captures.id, r.answerCaptureId));
  return answer?.answer ? new Date(answer.answer.asOf) : r.createdAt;
}

/**
 * The command's own words for a refusal, read now: AC1 names nothing; AC2 and AC3 say who changed it and
 * when, from what happened to it after the answer was given.
 */
async function refusalOf(tx: Tx, r: ChatCommandRecord, standing: Standing, now: Date): Promise<string> {
  switch (r.refusedWhy) {
    case "right_lost":
      return rightLostText(r.act);
    case "changed":
      return `${await whatChanged(tx, r.askerId, r.subject, await answeredAt(tx, r), now)} Ask again for a fresh answer.`;
    default: {
      const why = standing.refusedBy ?? "it could not be done";
      return `${why.charAt(0).toUpperCase()}${why.slice(1)}${/[.!?]$/.test(why) ? "" : "."}`;
    }
  }
}

/** The screen's own command for the act, in the command's transaction (rule 1: done runs nothing else). */
async function runAct(tx: Tx, ctx: CommandCtx, r: ChatCommandRecord): Promise<void> {
  const opts = { seenVersion: r.seenVersion, captureId: r.captureId };
  const id = r.subject.id;
  switch (r.act) {
    case "approve":
      // Section 20: approving a decision supersedes the approved one it replaces (U4); a proposed outcome ends it as said (U3)
      if (r.proposal === "entry") await decideBraidEntryIn(tx, ctx, id, { type: "approve" }, opts);
      else await resolveBraidEntryIn(tx, ctx, id, r.proposal === "outcome" ? (r.outcome ?? undefined) : undefined, opts);
      return;
    case "decline":
      if (r.proposal === "entry") await decideBraidEntryIn(tx, ctx, id, { type: "decline", reason: r.input?.reason ?? "" }, opts);
      else await keepOpenIn(tx, ctx, id, opts);
      return;
    case "resolve":
      await resolveBraidEntryIn(tx, ctx, id, undefined, opts);
      return;
    case "mark_done":
    case "unblock":
      await moveWorkItemIn(tx, ctx, id, r.act, opts);
      return;
    case "give_reason":
      await saveReasonIn(
        tx,
        ctx,
        id,
        { text: r.input?.reason ?? "", entryIds: r.input?.entryIds ?? [], draftedByAtlas: r.input?.draftedByAtlas ?? false, edited: r.input?.edited ?? true },
        opts,
      );
      return;
  }
}

/**
 * TAP or CONFIRM: the guard reads the right and the version now; when both hold, the screen's command runs
 * in a savepoint, and its own refusal ("a decline needs a reason", a self-approval the project forbids)
 * makes the command refused with nothing changed. Words still missing leave a card as it was.
 */
async function decide(tx: Tx, ctx: CommandCtx, seen: ChatCommandRecord, event: Extract<ChatCommandEvent, { type: "TAP" | "CONFIRM" }>): Promise<{ record: ChatCommandRecord; outcome: Extract<Outcome<ChatCommandState>, { ok: true }> }> {
  const standing: Standing = await standingOf(tx, ctx.actorId, seen);
  // W2-D3: a version moved only by a reminder is the same record the asker decided on; it runs against the version now
  const bookkeeping = standing.version !== null && standing.version !== seen.seenVersion && (await onlyBookkeepingSince(tx, seen.subject, await answeredAt(tx, seen)));
  const r = bookkeeping ? { ...seen, seenVersion: standing.version! } : seen;
  const at = { actorId: ctx.actorId, now: ctx.now, readable: true };
  let next = applyChatCommandEvent(r, event, { ...at, standing });
  if (!next.outcome.ok) throw new CommandRefused(next.outcome.reason);
  if (next.record.state === "done") {
    try {
      await tx.transaction((sp) => runAct(sp, ctx, next.record));
    } catch (e) {
      if (!(e instanceof CommandRefused) && !(e instanceof StaleVersion)) throw e;
      // A change that landed between the guard's read and the command is a change like any other (AC3)
      if (e instanceof StaleVersion) standing.version = null;
      else standing.refusedBy = e.reason;
      next = applyChatCommandEvent(r, event, { ...at, standing });
    }
  }
  if (!next.outcome.ok) throw new CommandRefused(next.outcome.reason);
  const record = next.record.state === "refused" ? { ...next.record, refusal: await refusalOf(tx, next.record, standing, ctx.now) } : next.record;
  return { record, outcome: next.outcome };
}

const messageOf = (r: ChatCommandRecord) => commandOutcomeText(r) ?? "";

/**
 * A button on an answer line (section 17's cards, phase B): the asker's own answer, a line that offered
 * this act, confirmed in the same tap. Someone else's answer reads as not found (P10). The same button
 * again changes nothing and says what happened the first time (AC4).
 */
export function tapLine(ctx: CommandCtx, answerCaptureId: string, line: number, act: CommandAct, input: CommandInput | null = null): Promise<CommandRun> {
  return runCommand(ctx, async (tx) => {
    const [capture] = await tx.select().from(t.captures).where(eq(t.captures.id, answerCaptureId));
    if (!capture || capture.authorId !== ctx.actorId || !capture.answer) throw new CommandRefused("no answer to act on", "not_found");
    const card = capture.answer.cards[line - 1];
    const action = card?.actions?.find((a) => a.act === act);
    if (!card?.subject || !action) throw new CommandRefused("that line has nothing to do", "not_found");
    const dedupKey = `tap:${answerCaptureId}:${line}:${act}`;
    const [seen] = await tx.select().from(t.chatCommands).where(eq(t.chatCommands.dedupKey, dedupKey));
    if (seen) return { record: recordOf(seen), message: messageOf(recordOf(seen)) };
    const draft = draftCommand({
      id: `cmd-${randomUUID()}`,
      askerId: ctx.actorId,
      via: "tap",
      captureId: answerCaptureId,
      answerCaptureId,
      line,
      act,
      subject: card.subject,
      proposal: action.proposal ?? null,
      outcome: action.outcome ?? null,
      about: (await aboutOf(tx, card.subject)) ?? { kind: null, name: card.title, project: "" },
      seenVersion: action.version,
      createdAt: ctx.now,
    });
    const { record, outcome } = await decide(tx, ctx, draft, { type: "TAP", input });
    if (!(await insertCommand(tx, ctx.now, record, dedupKey))) throw new StaleVersion(`chat command ${dedupKey}`);
    await auditMove(tx, ctx.now, record, outcome, { actorType: "person", actorId: ctx.actorId });
    return { record, message: messageOf(record) };
  });
}

/** The asker's own command; anyone else's reads as not found (P10). */
async function ownCommand(tx: Tx, ctx: CommandCtx, commandId: string): Promise<Row> {
  const [row] = await tx.select().from(t.chatCommands).where(eq(t.chatCommands.id, commandId));
  if (!row || row.askerId !== ctx.actorId) throw new CommandRefused("no such command", "not_found");
  return row;
}

/**
 * CONFIRM on a card made from words. A second tap, or a tap after it ended, changes nothing and says how
 * it ended (AC4, AC10). A card past its time expires when touched, as the timer would a minute later.
 */
export function confirmCommand(ctx: CommandCtx, commandId: string, input: CommandInput | null = null): Promise<CommandRun> {
  return runCommand(ctx, async (tx) => {
    const row = await ownCommand(tx, ctx, commandId);
    if (row.state !== "proposed") return { record: recordOf(row), message: messageOf(recordOf(row)) };
    if (commandExpired(row, ctx.now)) {
      const r = await expire(tx, ctx.now, row);
      return { record: r, message: messageOf(r) };
    }
    const { record, outcome } = await decide(tx, ctx, recordOf(row), { type: "CONFIRM", input });
    await persist(tx, ctx.now, row, record);
    await auditMove(tx, ctx.now, record, outcome, { actorType: "person", actorId: ctx.actorId });
    return { record, message: messageOf(record) };
  });
}

/** CANCEL: nothing changes, and the card says so. */
export function cancelCommand(ctx: CommandCtx, commandId: string): Promise<CommandRun> {
  return runCommand(ctx, async (tx) => {
    const row = await ownCommand(tx, ctx, commandId);
    if (row.state !== "proposed") return { record: recordOf(row), message: messageOf(recordOf(row)) };
    const r = applyChatCommandEvent(recordOf(row), { type: "CANCEL" }, { actorId: ctx.actorId, now: ctx.now, readable: true, standing: { right: false, version: null } });
    if (!r.outcome.ok) throw new CommandRefused(r.outcome.reason);
    await persist(tx, ctx.now, row, r.record);
    await auditMove(tx, ctx.now, r.record, r.outcome, { actorType: "person", actorId: ctx.actorId });
    return { record: r.record, message: messageOf(r.record) };
  });
}

/** Phase D: the lines a reply could mean (AC6, AC7), as the asker may read them now, for a clarification (M21). */
export type WhichLines = { answerCaptureId: string; act: WordAct; reason: string | null; lines: { line: number; title: string; projectId: string }[]; text: string };

/**
 * PROPOSE on one line of the open answer: a card only when its record is one the asker may read now (the
 * model check's fix lines_now, AC9). Returns the card, or the words the chat says when none was made; null
 * when the line offers no such act, or the same reply already made it (once only).
 */
export async function proposeLine(
  tx: Tx,
  now: Date,
  reply: { id: string; authorId: string },
  answer: typeof t.captures.$inferSelect | undefined,
  said: SaidCommand,
  reader: { mayRead: (projectId: string) => boolean },
): Promise<{ made: ChatCommandRecord } | { note: string } | null> {
  const card = answer?.authorId === reply.authorId ? answer.answer?.cards[said.line - 1] : undefined;
  const action = card?.actions?.find((a) => a.act === said.act);
  if (!card?.subject || !action) return null;
  const about = await aboutOf(tx, card.subject);
  const readable = reader.mayRead(card.subject.projectId) && about !== null;
  // A status reason links what DPM's draft links, so the card can say what it will link (M9, M11)
  const input: CommandInput | null =
    said.act === "give_reason" && readable
      ? { reason: said.reason ?? "", entryIds: (await draftReason(tx, card.subject.projectId, now)).entryIds, draftedByAtlas: false, edited: true }
      : said.reason
        ? { reason: said.reason }
        : null;
  const draft = draftCommand({
    id: `cmd-${randomUUID()}`,
    askerId: reply.authorId,
    via: "words",
    captureId: reply.id,
    answerCaptureId: answer!.id,
    line: said.line,
    act: said.act,
    subject: card.subject,
    proposal: action.proposal ?? null,
    outcome: action.outcome ?? null,
    about: about ?? { kind: null, name: card.title, project: "" },
    seenVersion: action.version,
    input,
    createdAt: now,
  });
  const r = applyChatCommandEvent(draft, { type: "PROPOSE" }, { actorId: reply.authorId, now, readable, standing: { right: false, version: null } });
  if (!r.outcome.ok) return { note: OUT_OF_DATE_TEXT };
  // M9, D17: a reason links an entry on the log, and the card cannot add one; with nothing to link, a
  // card could never be confirmed, so the chat says where to add one instead
  if (said.act === "give_reason" && !input?.entryIds?.length) return { note: noLinkText(about!.project) };
  // Once only: the same reply read again makes no second card
  if (!(await insertCommand(tx, now, r.record, `words:${reply.id}:${said.line}:${said.act}`))) return null;
  await auditMove(tx, now, r.record, r.outcome, { actorType: "person", actorId: reply.authorId });
  return { made: r.record };
}

/**
 * A reply that decides lines of the open answer, read by Atlas and kept by checkCommands: one card per
 * line (AC8), each made by PROPOSE only when its record is one the asker may read now (the model check's
 * fix lines_now, AC9). Runs inside the read's transaction; returns what the chat says when a reply made
 * no card, naming only lines the asker may still read (P10). When it could mean more than one line, `which`
 * holds them for phase D's question (M21), with the words to say instead when no question is asked.
 */
export async function commandsFromWords(
  tx: Tx,
  now: Date,
  reply: { id: string; authorId: string },
  checked: CheckedCommands,
  open: OpenAnswer | null | undefined,
): Promise<{ made: ChatCommandRecord[]; note: string | null; which: WhichLines | null }> {
  const made: ChatCommandRecord[] = [];
  const notes: string[] = [];
  const [answer] = open ? await tx.select().from(t.captures).where(eq(t.captures.id, open.captureId)) : [];
  const reader = await projectReader(tx, reply.authorId);
  const readableLine = async (n: number) => {
    const card = answer?.answer?.cards[n - 1];
    if (!card?.subject || !reader.mayRead(card.subject.projectId) || !(await aboutOf(tx, card.subject))) return null;
    return card;
  };
  for (const said of checked.kept) {
    const r = await proposeLine(tx, now, reply, answer, said, reader);
    if (r && "made" in r) made.push(r.made);
    else if (r) notes.push(r.note);
  }
  let which: WhichLines | null = null;
  if (checked.note) {
    const note = checked.note;
    const lines = note.kind === "which" ? note.lines : note.kind === "not_offered" ? [note.line] : [];
    const names: string[] = [];
    for (const n of lines) {
      const card = await readableLine(n);
      if (card) names.push(card.title);
    }
    if (note.kind === "which" && open) {
      // AC6: words that fit no line could mean any line that offers the act
      const could = note.lines.length ? note.lines : (open?.lines ?? []).filter((l) => l.acts.includes(note.act)).map((l) => l.line);
      const readable: WhichLines["lines"] = [];
      for (const n of could) {
        const card = await readableLine(n);
        if (card?.subject) readable.push({ line: n, title: card.title, projectId: card.subject.projectId });
      }
      which = { answerCaptureId: open.captureId, act: note.act, reason: note.reason, lines: readable, text: commandNoteText(note, names) };
    } else notes.push(commandNoteText(note, names));
  }
  return { made, note: notes.length ? [...new Set(notes)].join(" ") : null, which };
}

/** Timer command_expiry (rule 5, AC10): a card nobody answered expires; nothing changes. */
export function runChatCommandTimers(ctx: { db: Db; now: Date }): Promise<{ expired: string[] }> {
  return ctx.db.transaction(async (tx) => {
    const cutoff = new Date(ctx.now.getTime() - config.commandExpiryMinutes * 60_000);
    const due = await tx.select().from(t.chatCommands).where(and(eq(t.chatCommands.state, "proposed"), lte(t.chatCommands.createdAt, cutoff)));
    for (const row of due) await expire(tx, ctx.now, row);
    return { expired: due.map((r) => r.id) };
  });
}

async function expire(tx: Tx, now: Date, row: Row): Promise<ChatCommandRecord> {
  const r = applyChatCommandEvent(recordOf(row), { type: "EXPIRE" }, { actorId: row.askerId, now, readable: true, standing: { right: false, version: null } });
  const outcome = moved(r.outcome);
  await persist(tx, now, row, r.record);
  await auditMove(tx, now, r.record, outcome, { actorType: "rule", actorId: null });
  return r.record;
}
