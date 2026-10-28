// Section 20, U1: what Atlas set aside from a message. Two lists for the author only (M1): what the
// server checks refused, in the author's words rather than the check's, and the stretches of the
// message that fed nothing. Read from what is already stored (item spans and the PROPOSALS_READY
// audit detail); no machine, and nothing here changes a project.
import { locateQuote, saysHealth } from "./atlas-checks/checks";
import type { CheckId } from "./atlas-checks/types";
import type { SourceSpan } from "./shared";

/** A refused proposal as the audit log keeps it (DroppedProposal, read back from JSON). */
export type StoredDrop = { check: CheckId; reason: string; proposal: { quote?: string | null } };

export type SetAside = {
  /** What the checks refused: why, and the words it came from when it is safe to show them. */
  refused: { reason: string; quote: string | null }[];
  /** Stretches of the message no item, refusal or question used. */
  unused: (SourceSpan & { text: string })[];
};

/** Fewer words than this, after fillers, is not worth listing (SA4). */
export const MIN_UNUSED_WORDS = 4;

// Connectors and small talk: dropped before counting a stretch's words (SA4)
const FILLER = new Set(
  (
    "so and but as also then too well anyway um uh yeah ok okay oh lol " +
    "thanks thank you cheers hi hello hey morning afternoon evening everyone"
  ).split(" "),
);

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".") : s);

/** The author's words for a check's refusal, or null when there is nothing for them to do (check 2). */
export function refusalReason(drop: StoredDrop): string | null {
  switch (drop.check) {
    case 2:
      return null; // Atlas misquoted; counted for evaluation, nothing for the author to act on
    case 1:
      return "I couldn't find that in your projects."; // the reason carries the model's raw id
    case "cap":
      return "There's more in this message than one review holds. Send the rest as a new message.";
    case 11:
      // knownKind quotes the model's kind; the rights refusal is already in plain words
      return drop.reason.startsWith('"') ? "That isn't something Atlas can propose from a message." : sentence(drop.reason);
    default:
      return sentence(drop.reason);
  }
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}'’]+/gu) ?? [];
}

/** Gaps in `covered` within [0, length), split where a sentence ends. */
function gaps(length: number, covered: readonly SourceSpan[], text: string): SourceSpan[] {
  const out: SourceSpan[] = [];
  let at = 0;
  for (const c of [...covered].sort((a, b) => a.start - b.start)) {
    if (c.start > at) out.push({ start: at, end: c.start });
    at = Math.max(at, c.end);
  }
  if (at < length) out.push({ start: at, end: length });
  return out.flatMap((g) => {
    const pieces: SourceSpan[] = [];
    let from = g.start;
    for (const m of text.slice(g.start, g.end).matchAll(/[.!?\n]+/g)) {
      pieces.push({ start: from, end: g.start + m.index! });
      from = g.start + m.index! + m[0].length;
    }
    pieces.push({ start: from, end: g.end });
    return pieces;
  });
}

/** Trims spaces, punctuation and leading or trailing fillers, keeping the positions in the message. */
function trimmed(text: string, span: SourceSpan): SourceSpan | null {
  let { start, end } = span;
  const edge = /^[\s,;:()"'“”‘’-]+/;
  for (;;) {
    const before = [start, end];
    const head = text.slice(start, end).match(edge);
    if (head) start += head[0].length;
    const tail = text.slice(start, end).match(/[\s,;:()"'“”‘’-]+$/);
    if (tail) end -= tail[0].length;
    const first = text.slice(start, end).match(/^[\p{L}'’]+/u);
    if (first && FILLER.has(first[0].toLowerCase()) && words(text.slice(start, end)).length > 1) start += first[0].length;
    const last = text.slice(start, end).match(/[\p{L}'’]+$/u);
    if (last && FILLER.has(last[0].toLowerCase()) && words(text.slice(start, end)).length > 1) end -= last[0].length;
    if (before[0] === start && before[1] === end) break;
  }
  return end > start ? { start, end } : null;
}

/**
 * onlyIn (phase J): a standup's answers, where only the words the author typed can go unused; DPM's questions
 * and their taps are never listed as their words.
 */
export function setAside(input: { text: string; used: readonly SourceSpan[]; dropped: readonly StoredDrop[]; asked: string | null; onlyIn?: readonly SourceSpan[] }): SetAside {
  const { text } = input;
  const covered: SourceSpan[] = [...input.used];
  if (input.onlyIn) covered.push(...gaps(text.length, input.onlyIn, ""));

  const refused: SetAside["refused"] = [];
  const seen = new Set<string>();
  for (const d of input.dropped) {
    const at = d.proposal.quote ? locateQuote(text, d.proposal.quote) : null;
    // A refusal's words are explained by its reason, so they are not "not used" as well
    if (at) covered.push(at);
    const reason = refusalReason(d);
    if (!reason) continue;
    const said = at ? text.slice(at.start, at.end) : null;
    // SA6: health words are never shown back, and neither is what was said about a person (check 13)
    const quote = d.check === 13 || (said && saysHealth(said)) ? null : said;
    const key = `${reason}|${quote ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refused.push({ reason, quote });
  }

  // SA5: the question asked was answered, so it was used
  const asked = input.asked ? locateQuote(text, input.asked) : null;
  if (asked) covered.push(asked);

  const unused = gaps(text.length, covered, text)
    .map((g) => trimmed(text, g))
    .filter((s): s is SourceSpan => s !== null)
    .map((s) => ({ ...s, text: text.slice(s.start, s.end) }))
    .filter((s) => words(s.text).filter((w) => !FILLER.has(w)).length >= MIN_UNUSED_WORDS)
    // SA6: E17 keeps health words out of everything DPM shows, the author's own view included
    .filter((s) => !saysHealth(s.text));

  return { refused, unused };
}
