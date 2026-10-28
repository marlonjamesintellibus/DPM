// Phase G, drafts (conversational plan, section 9): what a draft is made of and the checks on it, with no
// database. DPM gathers the facts through the asker's own reads (queries/drafts.ts); Atlas only words them,
// and every record, date, number and name in what it writes must be one of those facts (rule 2, DR2), or
// the draft is refused and tried again, and after the tries the plain template from the facts is used. The
// template is DPM's own words, so a draft always reaches ready (DR6: with no model connected it is the
// template at once). A client status holds only what the client view shows (rule 8, DR4), and its copy is
// checked against that view again when it runs. No draft ever holds a quote from anyone's update (CD8).
import { saysHealthOrJudgement } from "./atlas-checks/checks";
import { namesPerson, namesRecord } from "./names";

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
  /**
   * The projects its facts come from (P10): a draft is closed once its owner can no longer read one of them.
   * A standup asked for with no project can hold several.
   */
  projectIds?: string[];
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

// Words a sentence or a line often starts with. Any other capital there that is not a word of the facts is
// taken as a name Atlas made up ("Marcus sent the feed."): refusing a plain word costs only the template
const STARTS = new Set(
  (
    "a about across after again ahead all also although an and another any as at because before behind both but by currently " +
    "during each either every few finally first for from good great hello here here's hey hi how however if in instead into it it's " +
    "its just last later meanwhile more most much my next no none not nothing now of on once one only or other our over overall " +
    "per please plus quick since so some still that the their then there there's these they this those though thanks through to " +
    "today tomorrow until up we we're we've we'll what when where which while who why with without yes yesterday yet you your " +
    "added done finished fixed got handed kept made moved opened picked raised reported sent set spent started updated wrapped " +
    "note plan summary update updates week work milestones releases waiting " +
    // A note's own lines: "Subject: ...", "Hi team,", "Best regards,"
    "subject dear team everyone all best kind regards cheers thank warm"
  )
    .split(" ")
    // "Two releases are planned": the number check reads a count
    .concat(COUNT_WORDS),
);

/**
 * The capitalised words in the text, as names ("Kyle", "Sprouts IT"), each with whether it starts a sentence
 * or a line: a word after ".", "!", "?", ":" or a list mark starts something, and is a name there only when it
 * is not an ordinary start (STARTS, or a word in -ing).
 */
function namedWords(text: string): { word: string; starts: boolean }[] {
  const out: { word: string; starts: boolean }[] = [];
  for (const line of text.split("\n")) {
    const tokens = line.trim().replace(/^[-*•\d.)\s]+/, "").split(/\s+/).filter(Boolean);
    tokens.forEach((raw, i) => {
      const w = raw.replace(/^[("'“‘[]+|[)"'”’\],.;:!?]+$/g, "");
      if (!w || !/^\p{Lu}/u.test(w) || ORDINARY.has(w)) return;
      const before = i === 0 ? "" : tokens[i - 1];
      out.push({ word: w.replace(/'s$|’s$/, ""), starts: i === 0 || /[.!?:]["'”’)]*$/.test(before) });
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

// A time said without a date ("tomorrow", "next week", "by end of day") is a date too (rule 2): a draft may say
// one only when its facts do. "Today" is the day every draft is as of, its heading's date, except as a deadline
// ("due today", "by today"); "this week" is a weekly summary's own week
const WHEN = new RegExp(
  String.raw`\b(${[
    "tomorrow",
    "tonight",
    "yesterday",
    "today",
    "this (?:morning|afternoon|evening|weekend|week|month|sprint)",
    "(?:next|last) (?:week|weekend|month|sprint)",
    "end of (?:the )?(?:day|week|month|sprint)",
    "close of business",
    "eod",
    "eow",
    "cob",
    "asap",
    "soon",
    "shortly",
    "later (?:today|this week|this month)",
    "in a (?:few|couple of) (?:days|weeks)",
  ].join("|")})\b`,
  "gi",
);
const DEADLINE_TODAY = /\b(?:due|by|until|till|before)\s+(?:the\s+end\s+of\s+)?today\b/i;
const whenWords = (s: string) => new Set([...s.matchAll(WHEN)].map((m) => m[1].toLowerCase().replace(/\s+/g, " ").replace("end of the ", "end of ")));

// A status said of something ("#151 is done", "the project is on track", "Release 1 slipped"): each word here
// counts as its status, and a draft may say it of a record only when a fact about that record says it (rule 2;
// DR4: a client status says only the status the client view shows). "Not started" is read before "started"
const STATUSES: { status: string; re: RegExp }[] = [
  { status: "not started", re: /\bnot (?:yet )?started\b/gi },
  { status: "done", re: /\b(?:done|finish(?:ed|es)?|complete[ds]?|shipped|delivered|land(?:ed|s)?|wrapped up)\b/gi },
  { status: "in progress", re: /\b(?:in progress|under ?way|started|ongoing)\b/gi },
  { status: "blocked", re: /\b(?:blocked|stuck)\b/gi },
  { status: "unblocked", re: /\bunblocked\b/gi },
  { status: "on track", re: /\b(?:on track|on schedule|on time|on target)\b/gi },
  { status: "off track", re: /\b(?:off track|behind(?: schedule)?|delayed|late|slipp(?:ed|ing)|slips?|overdue)\b/gi },
  { status: "at risk", re: /\bat risk\b/gi },
  { status: "ended", re: /\b(?:ended|resolved|closed|cleared)\b/gi },
  { status: "cancelled", re: /\b(?:cancell?ed|dropped|on hold|paused)\b/gi },
];
function statusesIn(text: string): Set<string> {
  const out = new Set<string>();
  let rest = text;
  for (const { status, re } of STATUSES) {
    if (!rest.match(re)) continue;
    out.add(status);
    rest = rest.replace(re, " ");
  }
  return out;
}

/** How a draft may mention a record's fact: its name, or a part of it ("Release 1" of "Buyer pilot · Release 1"). */
const nameParts = (name: string) => [name, ...name.split(/\s*[·(),:|/-]\s*/).filter((p) => p.trim().length >= 4)];

/**
 * A status no fact gives, or null. The draft is read clause by clause (a sentence, a line, either side of
 * "and" or "but"). A clause that names records (#151, a release by its name, the status by the status fact's
 * name) may say only the statuses their facts say, the section's title included ("Blocked: #151 ..."); a clause
 * that names none may say only a status the facts say somewhere ("Nothing blocked.").
 */
function addedStatus(facts: Pick<DraftFacts, "sections">, given: string, draft: string): string | null {
  const said = facts.sections.flatMap((s) => s.facts.map((f) => ({ line: `${s.title}: ${f.text}`, refs: refs(f.text), names: f.name ? nameParts(f.name) : [] })));
  for (const clause of draft.split(/(?<=[.!?])\s+|[;\n]|,?\s+(?:and|but|while|whereas|so)\s+/i)) {
    const statuses = statusesIn(clause);
    if (!statuses.size) continue;
    const clauseRefs = refs(clause);
    const about = said.filter((f) => [...clauseRefs].some((r) => f.refs.has(r)) || f.names.some((n) => includesWords(clause, n)));
    const lines = about.length ? about.map((f) => f.line) : [given];
    for (const status of statuses) if (!lines.some((l) => statusesIn(l).has(status))) return status;
  }
  return null;
}

/** DR2, DR4: the names DPM knows for the asker, read for them (P10), so a draft that names one it was not given is refused. */
export type KnownNames = { records: readonly string[]; people: readonly string[] };

/** The most a draft may be: a standup or a status a person would paste. */
export const DRAFT_MAX_CHARS = 2000;

/**
 * Why Atlas's draft cannot be used, or null when every record, date, time, status, number and name in it is
 * one of the facts it was given (rule 2, DR2). `known` are the names DPM knows for the asker (the records of
 * the projects they read, and the people they share one with): one that is in the text but not in the facts is
 * refused, even when the asker may read it, because it was not given (DR4: a milestone the client view does
 * not show). Names follow CD30 (domain/names.ts): "will" is not Will, and "the data sources" is not the
 * milestone Data sources. A quote is refused unless its words are in the facts (CD8); judging a person or
 * naming health is refused (M11).
 */
export function draftProblem(facts: Pick<DraftFacts, "heading" | "sections">, text: string, known: KnownNames = { records: [], people: [] }): string | null {
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
  const givenWhen = whenWords(given);
  for (const w of whenWords(draft)) {
    if (w === "today" && !DEADLINE_TODAY.test(draft)) continue;
    if (w === "this week" && /\bweek of\b/.test(given)) continue;
    if (!givenWhen.has(w)) return `adds a time (${w})`;
  }
  const status = addedStatus(facts, given, draft);
  if (status) return `says ${status} where the facts do not`;
  const givenWords = words(given);
  for (const { word, starts } of namedWords(draft)) {
    // A day or month was checked above; any other name must be a word of the facts
    if (dayWords(word).size || monthWords(word).size || givenWords.has(word.toLowerCase())) continue;
    if (starts && (STARTS.has(word.toLowerCase()) || /\p{Ll}{2}ing$/u.test(word))) continue;
    return `names ${word}, which is not in the facts`;
  }
  for (const name of known.records) if (namesRecord(draft, name) && !includesWords(given, name)) return `names ${name}, which it was not given`;
  for (const name of known.people) if (namesPerson(draft, name, false) && !namesPerson(given, name, false)) return `names ${name}, which it was not given`;
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
  // CD30: "the trend model" in lower case is the words, not the milestone Trend model
  for (const name of hidden) if (namesRecord(text, name)) return "it names something the client view does not show";
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
  const dates = f.text.match(DATE) ?? [];
  return [...nameParts(f.name), ...dates].some((m) => includesWords(text, m));
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
