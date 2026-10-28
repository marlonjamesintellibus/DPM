// Phase G, drafts (conversational plan, section 9): what a draft is made of and the checks on it, with no
// database. DPM gathers the facts through the asker's own reads (queries/drafts.ts); Atlas only words them,
// and every record, date, number and name in what it writes must be one of those facts (rule 2, DR2), or
// the draft is refused and tried again, and after the tries the plain template from the facts is used. The
// template is DPM's own words, so a draft always reaches ready (DR6: with no model connected it is the
// template at once). A client status holds only what the client view shows (rule 8, DR4), and its copy is
// checked against that view again when it runs. No draft ever holds a quote from anyone's update (CD8).
import { saysHealthOrJudgement } from "./atlas-checks/checks";

export const DRAFT_KINDS = ["standup", "client", "weekly"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/** What the chat calls each kind. */
export const DRAFT_LABEL: Record<DraftKind, string> = { standup: "standup", client: "client status", weekly: "weekly summary" };

/**
 * One fact, as DPM words it in the template. `key` says what it is about, so a copy can compare it with the
 * same fact read now ("release:ms-release-1", "status:forager"); `name` is how a draft mentions it, when it is a
 * record (DR4: the copy check looks for it in the text).
 */
export type DraftFact = { key: string; text: string; name?: string };

/** A part of the draft: "In progress", "Releases". `none` is said when it has no facts (DR1). */
export type DraftSection = { title: string; facts: DraftFact[]; none: string | null };

/**
 * Everything a draft may say, read for its asker when the request ran (P10), as of `asOf`. Never a quote
 * from anyone's update (CD8, DR7): only records, dates, states and names from DPM's tables.
 */
export type DraftFacts = {
  kind: DraftKind;
  /** The first line: "Kemar's standup, Tue 20 Oct", "Forager 2.0: client status, Tue 20 Oct". */
  heading: string;
  sections: DraftSection[];
  asOf: string;
};

/** The plain template: the facts as DPM words them, section by section (DR2's fallback, DR6). */
export function draftTemplate(facts: Pick<DraftFacts, "heading" | "sections">): string {
  const parts = [facts.heading];
  for (const s of facts.sections) {
    if (!s.facts.length && s.none === null) continue;
    parts.push(s.facts.length ? [`${s.title}:`, ...s.facts.map((f) => `- ${f.text}`)].join("\n") : `${s.title}: ${s.none}`);
  }
  return parts.join("\n\n");
}

// ---- The facts check (rule 2, DR2) ----

const WEEKDAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// "Fri", "Friday", "Sept": each counts as the day or month it is
const DAY_WORD = new RegExp(String.raw`\b(${WEEKDAY.map((d) => `${d.slice(0, 3)}(?:${d.slice(3)})?`).join("|")}|tues|thurs)\b`, "gi");
const MONTH_WORD = new RegExp(String.raw`\b(${MONTH.filter((m) => m !== "may").map((m) => `${m.slice(0, 3)}(?:${m.slice(3)})?`).join("|")}|sept)\b`, "gi");
// May is also a word ("the model may slip"): only a capital May next to a day number is the month
const MAY = /\bMay\s+\d|\d\s+May\b/g;
const short = (w: string) => w.toLowerCase().slice(0, 3);

const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).map((w) => w.replace(/'s$/, "")));
const dayWords = (s: string) => new Set([...s.matchAll(DAY_WORD)].map((m) => short(m[1])));
const monthWords = (s: string) => new Set([...[...s.matchAll(MONTH_WORD)].map((m) => short(m[1])), ...(s.match(MAY) ? ["may"] : [])]);
// A count said in words is a number too: "three releases" needs a 3 in the facts
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const COUNTED = new RegExp(String.raw`\b(${COUNT_WORDS.slice(2).join("|")})\b`, "gi");
const numbers = (s: string) => new Set([...(s.match(/\d+/g) ?? []), ...[...s.matchAll(COUNTED)].map((m) => String(COUNT_WORDS.indexOf(m[1].toLowerCase())))]);
const refs = (s: string) => new Set(s.match(/#\d+/g) ?? []);

// Words a sentence may give a capital mid-way without naming anything
const ORDINARY = new Set(["I", "I'm", "I've", "I'll", "I'd", "OK"]);

/**
 * Capitalised words that do not start a sentence or a line: the names in the text ("Kyle", "Sprouts IT").
 * A word after ".", "!", "?", ":" or a list mark starts something, so it is not counted.
 */
function namedWords(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const tokens = line.trim().replace(/^[-*•\d.)\s]+/, "").split(/\s+/).filter(Boolean);
    tokens.forEach((raw, i) => {
      const w = raw.replace(/^[("'“‘[]+|[)"'”’\],.;:!?]+$/g, "");
      if (!w || !/^\p{Lu}/u.test(w) || ORDINARY.has(w)) return;
      const before = i === 0 ? "" : tokens[i - 1];
      if (i === 0 || /[.!?:]["'”’)]*$/.test(before)) return;
      out.push(w.replace(/'s$|’s$/, ""));
    });
  }
  return out;
}

const includesWords = (haystack: string, phrase: string) => {
  const p = phrase.trim().toLowerCase();
  if (!p) return false;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, "u").test(haystack.toLowerCase());
};

/** The most a draft may be: a standup or a status a person would paste. */
export const DRAFT_MAX_CHARS = 2000;

/**
 * Why Atlas's draft cannot be used, or null when every record, date, number and name in it is one of the
 * facts it was given (rule 2, DR2). `known` are the names DPM knows for the asker (their projects' records
 * and people, read for them): one that is in the text but not in the facts is refused, even when the asker
 * may read it, because it was not given (DR4: a milestone the client view does not show). A quote is
 * refused unless its words are in the facts (CD8); judging a person or naming health is refused (M11).
 */
export function draftProblem(facts: Pick<DraftFacts, "heading" | "sections">, text: string, known: readonly string[] = []): string | null {
  const draft = text.trim();
  if (!draft) return "empty";
  if (draft.length > DRAFT_MAX_CHARS) return "too long";
  const given = draftTemplate(facts);
  const givenRefs = refs(given);
  for (const r of refs(draft)) if (!givenRefs.has(r)) return `names ${r}, which is not in the facts`;
  const givenNumbers = numbers(given);
  for (const n of numbers(draft)) if (!givenNumbers.has(n)) return `adds the number ${n}`;
  const givenDays = dayWords(given);
  for (const d of dayWords(draft)) if (!givenDays.has(d)) return `adds a day (${d})`;
  const givenMonths = monthWords(given);
  for (const m of monthWords(draft)) if (!givenMonths.has(m)) return `adds a month (${m})`;
  const givenWords = words(given);
  for (const w of namedWords(draft)) {
    // A day or month was checked above; any other name must be a word of the facts
    if (dayWords(w).size || monthWords(w).size) continue;
    if (!givenWords.has(w.toLowerCase())) return `names ${w}, which is not in the facts`;
  }
  for (const name of known) if (includesWords(draft, name) && !includesWords(given, name)) return `names ${name}, which it was not given`;
  for (const q of draft.matchAll(/["“]([^"”]{3,})["”]/g)) if (!includesWords(given, q[1])) return "quotes words that are not in the facts";
  if (saysHealthOrJudgement(draft)) return "mentions health or judges a person";
  return null;
}

/** Plain punctuation, as for every text Atlas writes: an em dash becomes a comma; line breaks are kept. */
export function plainDraft(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/\s*—\s*/g, ", ").replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---- The copy check of a client status (rule 8, DR4, the model check's ReaderCheck) ----

/**
 * Why a client status may not be copied now, or null. `now` is the client view read again: each fact the
 * draft was given that is no longer there as it was (a release hidden, renamed or moved, the status no
 * longer shared) refuses the copy when the draft still mentions it; and so does any name of the project's
 * that the client view does not show (`hidden`: milestones that are not releases, work, BRAID entries),
 * even one the person typed in (DR4). The person may always Refresh.
 */
export function clientCopyProblem(given: Pick<DraftFacts, "sections">, now: Pick<DraftFacts, "sections">, text: string, hidden: readonly string[]): string | null {
  const shown = new Map(now.sections.flatMap((s) => s.facts.map((f) => [f.key, f.text] as const)));
  for (const f of given.sections.flatMap((s) => s.facts)) {
    if (shown.get(f.key) === f.text) continue;
    if (mentions(text, f)) return "it says something the client view no longer shows";
  }
  for (const name of hidden) if (includesWords(text, name)) return "it names something the client view does not show";
  return null;
}

/**
 * Whether a draft still mentions a fact: the status by its label or the word status; a release by its name, any
 * part of its name ("Buyer pilot (Release 1)" for "Buyer pilot · Release 1"), or the date its fact gives. Atlas
 * rewords names, so a part is enough: a copy is refused rather than let a gone release through (rule 8).
 */
function mentions(text: string, f: DraftFact): boolean {
  if (f.key.startsWith("status:")) return /\bstatus\b/i.test(text) || (!!f.name && includesWords(text, f.name));
  if (!f.name) return includesWords(text, f.text);
  const parts = [f.name, ...f.name.split(/\s*[·(),:|/-]\s*/).filter((p) => p.trim().length >= 4)];
  const dates = f.text.match(DATE) ?? [];
  return [...parts, ...dates].some((m) => includesWords(text, m));
}
const DATE = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g;

// ---- Which draft the words ask for (no model needed) ----

// "Draft my standup", "Write up the weekly summary for Forager", "Can you draft a client status for GQ?".
// The verb must say draft or write: "Let's do my standup" is phase J's standup, never a draft
const VERB = String.raw`(?:(?:please|pls|atlas|ok|okay|hi|hey)[\s,]+)?(?:(?:can|could|would) you |pls |please )?(?:draft|write(?: up)?|prep(?:are)?|put together)(?: me| us)?`;
const DET = String.raw`(?: (?:a|an|the|my|our|mi|di|today'?s))?`;
const KIND_WORDS: Record<DraftKind, string> = {
  standup: String.raw`stand-?up(?: update| note| message)?`,
  client: String.raw`(?:client(?:'s)? (?:status|update|report)(?: update| report| note| email| message)?|status (?:update |report |note |email )?for (?:the )?client)`,
  weekly: String.raw`(?:weekly (?:summary|update|report|status)(?: update| report)?|(?:this )?week'?s (?:summary|update|report)|summary (?:of|for) (?:the|this) week)`,
};
// "for Forager 2.0": a dot between digits is part of a name
const REST = String.raw`(?:\s+(?:for|on|about|of|in|pon|fi)\s+(?:[^.!?\n]|\.(?=\d)){1,60}?)?(?:,? (?:please|pls|atlas))?[\s.!?]*`;

/** The kind of draft a whole message asks for, or null when it is not a request for a draft. */
export function draftKindOf(text: string): DraftKind | null {
  const t = text.trim().toLowerCase().replace(/[‘’]/g, "'");
  for (const kind of DRAFT_KINDS) if (new RegExp(`^${VERB}${DET} ${KIND_WORDS[kind]}${REST}$`).test(t)) return kind;
  return null;
}
