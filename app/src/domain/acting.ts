// Acting from an answer in words (conversational plan, phase B). Atlas reads a reply with the open
// answer's lines and says what it decides ("Approve the Kyle risk"): an act and the lines it could mean.
// What Atlas says is untrusted, like a question (section 15): checkCommands keeps a command only for one
// line of the open answer that offers that act to the asker (AC6, AC9), one card per line (AC8, CD1),
// and never guesses between lines (AC7). Phase D's clarification is not built, so for now DPM says which
// lines it could mean and asks for the name. A change to a record said in words ("Mark the second one
// done") is never a command here: it is an update in items, reviewed as any other.
import type { CheckContext, OpenAnswer } from "./atlas-checks/types";
import { WORD_ACTS, type WordAct } from "./machines/chat-command";

/**
 * What Atlas said a reply decides, before the checks: the act, every line it could mean, and who decides
 * it: the author, or another person whose decision the reply only reports ("Alicia approved the Kyle
 * risk"). Left out, it is the author's.
 */
export type RawCommand = { act: string; lines: readonly number[]; reason?: string | null; by?: "author" | "other" | null };

/** A command that passed the checks: one act on one line of the open answer. */
export type SaidCommand = { act: WordAct; line: number; reason: string | null };

/** Why a reply that decides something made no card. */
export type CommandNote =
  /** AC6: there is no answer open in this conversation, or it has no lines. */
  | { kind: "no_answer" }
  /** AC6, AC7: no line fits, or more than one could; `lines` are the ones it could mean. */
  | { kind: "which"; lines: readonly number[] }
  /** The line offers no such act to the asker ("Approve #145"). */
  | { kind: "not_offered"; act: WordAct; line: number }
  /** The model check's fix lines_now: the only lines it could mean are on projects the asker can no longer read. */
  | { kind: "out_of_date" };

export type CheckedCommands = { kept: SaidCommand[]; note: CommandNote | null };

const isWordAct = (act: string): act is WordAct => (WORD_ACTS as readonly string[]).includes(act);

/** AC6 to AC9: what of Atlas's reading is a command. The first problem found is the note. */
export function checkCommands(raw: readonly RawCommand[] | null | undefined, open: OpenAnswer | null | undefined): CheckedCommands {
  // A record change said in words is an update, never a command (phase B). Rule 10, E96: words that
  // report someone else's decision are never the asker's, even when the asker holds the same right
  const said = (raw ?? []).filter((c) => isWordAct(c.act) && c.by !== "other");
  if (!said.length) return { kept: [], note: null };
  if (!open?.lines.length && !open?.gone?.length) return { kept: [], note: { kind: "no_answer" } };
  const kept: SaidCommand[] = [];
  let note: CommandNote | null = null;
  for (const c of said) {
    const act = c.act as WordAct;
    // AC9: only a line of this answer; Atlas cannot name a record, only a line number
    const named = [...new Set(c.lines)].filter((n) => open.lines.some((l) => l.line === n));
    // P10: a line no longer theirs to read is out of date, and nothing about it is named. Neither Atlas
    // nor the rule saw its words, so words that fit no line still shown may mean it: out of date too
    if (!named.length && open.gone?.length) {
      note ??= { kind: "out_of_date" };
      continue;
    }
    // Words that fit two lines of which only one offers the act ("Resolve the feed blocker" beside the
    // blocked #151) mean that one; two that both offer it are never guessed (AC7)
    const offering = named.filter((n) => open.lines.some((l) => l.line === n && l.acts.includes(act)));
    const lines = offering.length ? offering : named;
    if (lines.length !== 1) {
      note ??= { kind: "which", lines };
      continue;
    }
    const line = open.lines.find((l) => l.line === lines[0])!;
    if (!line.acts.includes(act)) {
      note ??= { kind: "not_offered", act, line: line.line };
      continue;
    }
    // Once only (rule 6): the same act on the same line twice in a message is one card
    if (kept.some((k) => k.act === act && k.line === line.line)) continue;
    kept.push({ act, line: line.line, reason: c.reason?.trim() || null });
  }
  return { kept, note };
}

const VERB: Record<WordAct, string> = { approve: "approve", decline: "decline", resolve: "resolve", give_reason: "give a reason for" };

/** "A", "A or B", "A, B or C", each in quotes. */
function either(names: readonly string[]): string {
  const q = names.map((n) => `"${n}"`);
  return q.length > 1 ? `${q.slice(0, -1).join(", ")} or ${q.at(-1)}` : (q[0] ?? "");
}

/**
 * What the chat says when a reply made no card. `names` are the titles of the lines it could mean that
 * the asker may still read; a line they can no longer read is never named (P10).
 */
export function commandNoteText(note: CommandNote, names: readonly string[]): string {
  switch (note.kind) {
    case "no_answer":
      return "There's no answer here to act on yet. Ask me first, for example What needs me today?";
    case "which":
      return names.length > 1 ? `Did you mean ${either(names)}? Say it again with its name.` : "I'm not sure which one you mean. Say it again with its name.";
    case "not_offered":
      return names.length ? `You can't ${VERB[note.act]} ${either(names)} here.` : OUT_OF_DATE_TEXT;
    case "out_of_date":
      return OUT_OF_DATE_TEXT;
  }
}

/** The model check's fix: a line no longer theirs to read is not a command, and nothing is named. */
export const OUT_OF_DATE_TEXT = "That answer is out of date. Ask again.";

/** M9, D17: a status reason links an entry on the log, and the chat cannot add one; the inbox's editor can. */
export function noLinkText(project?: string): string {
  return `Nothing on ${project ? `${project}'s` : "the"} BRAID log explains ${project ? "its" : "this"} status yet. Add an entry to the log from your inbox, then give the reason.`;
}

// ---- The rule, without a model (QA8's counterpart for commands) ----

// "Approve the refresh decision", "Decline the second one, we track that already", "Resolve it"
const COMMAND = /^\s*(?:please\s+)?(approve|decline|reject|resolve|clear)\b\s*(.*?)\s*[.!]?\s*$/i;
const ACT_OF: Record<string, WordAct> = { approve: "approve", decline: "decline", reject: "decline", resolve: "resolve", clear: "resolve" };
// The reason follows a comma, a colon, a dash or "because"
const REASON = /\s*(?:[,;:]|\s-\s|\bbecause\b|\bsince\b)\s*(.*)$/i;
// AC8: only when "all" or "both" is the whole of what it names ("all of them", "both"), never a word in a
// name ("the all-hands decision") or a count of named lines ("both of the feed blockers")
const ALL = /^(?:(?:all|both|each|every one|everything)(?: of)?(?: them| these| those)?|them all|them both)$/i;
const ORDINALS: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5 };
const ONE = /^(it|this|that|this one|that one|the one)$/i;
// Words that say which kind of thing, or how many, not which one
const NOT_A_NAME = new Set(
  "the a an one ones it this that these those them all both each every please on for of to in from by and my our your risk risks decision decisions blocker blockers issue issues dependency dependencies assumption assumptions entry entries item items line thing".split(
    " ",
  ),
);

/**
 * Without a model, a one-sentence reply that starts with approve, decline, resolve (or reject, clear) is
 * read by rule: "all of them", an ordinal ("the second one", "the last one"), "it" when one line offers
 * the act, or the line whose title and details hold every name word ("the refresh decision"). Lines are
 * numbered as the answer shows them. With no open answer the command has no lines, and the note says so.
 */
export function ruleCommands(ctx: Pick<CheckContext, "text" | "openAnswer">): RawCommand[] {
  const m = COMMAND.exec(ctx.text);
  if (!m || /[.!?]\s+\S/.test(ctx.text.trim())) return [];
  const act = ACT_OF[m[1].toLowerCase()];
  const [rest, reason] = splitReason(m[2]);
  const lines = ctx.openAnswer?.lines ?? [];
  const offering = lines.filter((l) => l.acts.includes(act)).map((l) => l.line);
  const said = rest.toLowerCase().trim();
  if (ALL.test(said)) return offering.length ? offering.map((line) => ({ act, lines: [line], reason })) : [{ act, lines: [], reason }];
  const ordinal = said.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\b/)?.[1];
  // Places count every line the answer showed, the ones no longer readable too (their numbers only)
  const last = Math.max(0, ...lines.map((l) => l.line), ...(ctx.openAnswer?.gone ?? []));
  if (ordinal) return [{ act, lines: [ordinal === "last" ? last : ORDINALS[ordinal]], reason }];
  if (ONE.test(said)) return [{ act, lines: offering.length === 1 ? offering : [], reason }];
  const names = said.split(/[^\p{L}\p{N}#]+/u).filter((w) => w.length > 2 && !NOT_A_NAME.has(w));
  const fits = names.length ? lines.filter((l) => names.every((w) => `${l.title} ${l.detail ?? ""}`.toLowerCase().includes(w))).map((l) => l.line) : [];
  return [{ act, lines: fits, reason }];
}

function splitReason(rest: string): [string, string | null] {
  const m = REASON.exec(rest);
  if (!m || m.index === undefined) return [rest, null];
  return [rest.slice(0, m.index), m[1].trim() || null];
}
