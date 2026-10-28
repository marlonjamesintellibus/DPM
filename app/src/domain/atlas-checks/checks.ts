// Server checks on Atlas output (machines doc, section 4, checks 1 to 14). Atlas proposes; these
// rules decide which proposals become extracted items, in which project, with what confidence
// and mark. They are rules over the candidate data the caller read from the database (P6):
// nothing here asks a model, and nothing the model says about current values or states is used.
import { config } from "../config";
import { OUTCOME_FROM, OUTCOMES, type BraidEntryState, type ResolveOutcome } from "../machines/braid-entry";
import { fitLeave, type LeaveFit } from "../machines/leave";
import { namesPerson } from "../names";
import { BRAID_KINDS, BRAID_RIGHTS, PROJECT_ROLES, mayReport as rightsMayReport, type BraidKind, type ProjectRole } from "../rights";
import { CONFIDENCES, lowerTo, NEW_WORK_STATES, type Confidence, type ExtractedItemDraft, type ItemKind, type Mark, type MatchState, type NewWorkState, type RoutingState, type SourceSpan } from "../shared";

export { lowerTo };
import { daysBetween } from "../dates";
import { messageDay, readDateValue, readLeaveRange, resolveDate, type LeaveRange, type ResolvedDate } from "./resolve-dates";
import type {
  CandidateProject,
  CandidateRecord,
  CheckContext,
  CheckId,
  CheckOptions,
  CheckResult,
  DroppedProposal,
  OpenBraidEntry,
  RawProposal,
} from "./types";


/** Words that make a value a guess (E12). Phase R: the same guesses as the team says them ("mi tink", "mussi"). */
export const HEDGES = [
  "i think", "maybe", "probably", "should", "might", "perhaps", "i guess", "not sure",
  "mi tink", "mi think", "a tink", "mi feel seh", "mi feel like", "mebbe", "mussi", "mi guess", "nuh sure", "nah sure", "mi nuh know",
];
/** Phase R, JA2: words that say a thing is nearly finished, so a done or handed over value is a guess. */
const NOT_YET = ["soon done", "soon finish", "almost done", "almost finished", "nearly done", "nearly finished", "a go done", "a go finish", "likkle more"];
const FINISHED = ["done", "handed_over"];

// Check 13 and E17. A floor, not a classifier: phase 4 evaluation measures what it misses.
const HEALTH = [
  "sick", "ill", "illness", "unwell", "not feeling well", "not well", "doctor", "hospital", "surgery", "burnt out",
  "burned out", "burnout", "exhausted", "stressed", "anxious", "anxiety", "depressed", "depression", "migraine",
  "flu", "covid", "fever", "therapy", "therapist", "mental health", "medical", "medication", "pregnant", "injured",
];
const JUDGEMENTS = [
  "keeps missing", "keeps forgetting", "always late", "never on time", "never shows up", "never replies",
  "never responds", "lazy", "useless", "incompetent", "unreliable", "careless", "sloppy", "rude", "hopeless",
  "doesn't care", "does not care", "can't be trusted", "cannot be trusted", "not pulling his weight",
  "not pulling her weight", "not pulling their weight", "slacking", "bad at", "terrible at", "difficult to work with",
];

/** E17: health words, for text DPM shows back even to the author (section 20, SA6). */
export function saysHealth(text: string): boolean {
  return HEALTH.some((h) => mentions(text, h));
}

/** Check 13's word lists, for any text Atlas writes that people will read (a reason draft). */
export function saysHealthOrJudgement(text: string): boolean {
  return HEALTH.some((h) => mentions(text, h)) || JUDGEMENTS.some((j) => mentions(text, j));
}

type FieldRule = { who: "owner" | "owner_or_lead"; values?: readonly string[]; date?: true };

// Check 3: what an author may change from a message, per target type (machines doc, section 4)
const FIELDS: Record<CandidateRecord["type"], Record<string, FieldRule>> = {
  work_item: {
    state: { who: "owner_or_lead", values: ["to_do", "in_progress", "blocked", "done"] },
    blocked_note: { who: "owner_or_lead" },
    // Section 20, U6: when its owner now expects it done; the due date is the plan, never from a message
    forecast: { who: "owner", date: true },
  },
  // S5: only the owner moves a forecast. The target never moves from a capture (M6).
  milestone: { forecast: { who: "owner", date: true } },
  handover: { state: { who: "owner", values: ["not_done", "in_progress", "handed_over"] } },
};

/**
 * Check 3's rule, read again when Save runs (phase J, the model check's fix to M28, for every update): whether
 * the author may change this field of the record themselves now, as its owner, or as a PM or Lead where the
 * field allows it. When they may not, saving asks the record's owner (section 20, U5, M37), never writes it.
 */
export function mayChangeField(type: CandidateRecord["type"], field: string, who: { isOwner: boolean; role: ProjectRole | null }): boolean {
  const rule = FIELDS[type][field];
  if (!rule || !who.role) return false;
  return who.isOwner || (rule.who === "owner_or_lead" && (who.role === "pm" || who.role === "lead"));
}

type Target =
  | { type: "record"; project: CandidateProject; record: CandidateRecord }
  | { type: "entry"; project: CandidateProject; entry: OpenBraidEntry }
  | { type: "project"; project: CandidateProject }
  | { type: "leave" };

/** One proposal on its way through the checks (several, once check 6 merges them). */
type Work = {
  /** The proposal whose values the item carries: the later one said, after a merge. */
  p: RawProposal;
  all: RawProposal[];
  kind: ItemKind;
  target: Target | null;
  field: string;
  newValue: string | null;
  oldValue: string | null;
  match: { project: CandidateProject; entry: OpenBraidEntry } | null;
  matchState: MatchState;
  braidKind: string | null;
  spans: SourceSpan[];
  confidence: Confidence;
  date: ResolvedDate | null;
  leave: LeaveRange | null;
  leaveFit: LeaveFit | null;
  needsOk: boolean;
  mark: Mark;
  scope: "project" | "personal";
  routing: RoutingState;
  projectId: string | null;
  routingReason: string;
  /** For choose_project: the projects offered to the author (E71). */
  options: string[] | null;
  /** Section 20, U3: how a risk, assumption or dependency ended. */
  outcome: ResolveOutcome | null;
  /** Section 20, U4: the decision a new decision reverses. */
  supersedes: { project: CandidateProject; entry: OpenBraidEntry } | null;
  /** Section 20, U5: the owner to ask, when the author may not change the record themselves. */
  ask: string | null;
  /** Phase L, CD14: the name or person check 14 confirmed as the reason for the project. */
  routedBy: { basis: "reference" | "tied_person"; word: string; personId: string | null } | null;
  /** Phase D: every record the words could mean, the target first, when there are two or more. */
  closeMatches: string[] | null;
};

type Scope = ReturnType<typeof scopeOf>;
type Check = [CheckId, (w: Work, s: Scope) => string | null];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole words or phrases, ignoring case; "#151" counts as a word. */
function mentions(haystack: string, needle: string): boolean {
  const n = needle.trim();
  if (!n) return false;
  return new RegExp(`(?<![\\w#])${escapeRegex(n).replace(/\s+/g, "\\s+")}(?!\\w)`, "i").test(haystack);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Phase R, JA7: a project's name or alias in the words names the project only in the shape of a
 * reference: written with its capital, as it is stored ("Academy", "GQ"), or right next to one of the
 * project's record numbers ("academy #301"). In "a class at di academy" it is a word, not GQ & Academy.
 */
export function namesProject(text: string, name: string, numbers: readonly string[] = []): boolean {
  const n = name.trim();
  if (!n) return false;
  const near = numbers.filter(Boolean).map(escapeRegex).join("|");
  for (const m of text.matchAll(new RegExp(`(?<![\\w#])${escapeRegex(n).replace(/\s+/g, "\\s+")}(?!\\w)`, "gi"))) {
    const first = m[0][0];
    if (first === n[0] || first !== first.toLowerCase()) return true;
    if (!near) continue;
    const before = text.slice(0, m.index);
    const after = text.slice(m.index + m[0].length);
    if (new RegExp(`(?:${near})\\W{0,3}$`).test(before) || new RegExp(`^\\W{0,3}(?:${near})(?!\\d)`).test(after)) return true;
  }
  return false;
}

/** The record numbers of a project, for namesProject. */
export const numbersOf = (p: CandidateProject): string[] => p.records.flatMap((r) => (r.number ? [r.number] : []));

function scopeOf(ctx: CheckContext, options: CheckOptions) {
  const mayReport = options.mayReport ?? rightsMayReport;
  const project = (id: string | null) => ctx.projects.find((p) => p.id === id) ?? null;
  const nameOf = (personId: string | null) => {
    if (personId === ctx.author.id) return ctx.author.name;
    for (const p of ctx.projects) for (const person of p.people) if (person.personId === personId) return person.name;
    return "its owner";
  };
  const leadOf = (p: CandidateProject) => p.people.find((x) => x.role === "pm")?.name ?? p.people.find((x) => x.role === "lead")?.name ?? "the PM";
  return {
    ctx,
    mayReport,
    project,
    nameOf,
    leadOf,
    findTarget(id: string): Target | null {
      for (const p of ctx.projects) {
        const record = p.records.find((r) => r.id === id);
        if (record) return { type: "record", project: p, record };
      }
      for (const p of ctx.projects) {
        const entry = p.braid.find((e) => e.id === id);
        if (entry) return { type: "entry", project: p, entry };
      }
      const p = project(id);
      if (p) return { type: "project", project: p };
      return id === ctx.leave.targetId ? { type: "leave" } : null;
    },
    findEntry(id: string) {
      for (const p of ctx.projects) {
        const entry = p.braid.find((e) => e.id === id);
        if (entry) return { project: p, entry };
      }
      return null;
    },
    quoteText: (w: Work) => w.spans.map((sp) => ctx.text.slice(sp.start, sp.end)).join(" … "),
    /** The quotes and the sentences they sit in: a leading "On Store Insights," covers its sentence. */
    nearText(w: Work) {
      return w.spans.map((sp) => {
        let a = sp.start;
        while (a > 0 && !/[.!?\n]/.test(ctx.text[a - 1])) a--;
        let b = sp.end;
        if (!/[.!?\n]/.test(ctx.text[b - 1] ?? "")) while (b < ctx.text.length && !/[.!?\n]/.test(ctx.text[b])) b++;
        return ctx.text.slice(a, b);
      }).join("\n");
    },
  };
}

function describe(t: Target): string {
  if (t.type === "record") return t.record.number ? `${t.record.number} ${t.record.title}` : t.record.title;
  if (t.type === "entry") return `"${t.entry.title}"`;
  if (t.type === "project") return t.project.name;
  return "your leave";
}

/** Find the quote in the capture: exact first, then ignoring case. Its position becomes the span. */
export function locateQuote(text: string, quote: string): SourceSpan | null {
  const q = quote.trim();
  if (!q) return null;
  const at = text.indexOf(q);
  if (at >= 0) return { start: at, end: at + q.length };
  const m = new RegExp(escapeRegex(q), "i").exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

function isDateField(w: Work): boolean {
  if (w.target?.type === "leave") return true;
  return w.target?.type === "record" && FIELDS[w.target.record.type][w.field]?.date === true;
}

const leaveValue = (start: string, end: string | null) => `${start}/${end ?? ".."}`;

// D6: matched against every live leave of the author's, requested or approved (fitLeave, M8)
function leaveFitOf(range: LeaveRange | null, ctx: CheckContext): LeaveFit | null {
  if (!range) return null;
  const leaves = ctx.leave.existing.map((l) => ({ ...l, personId: ctx.author.id }));
  return fitLeave({ personId: ctx.author.id, start: range.start, end: range.end }, leaves);
}

// ---- Checks 1 to 5: one proposal at a time ----

const ITEM_KINDS: readonly string[] = ["update", "braid_new", "braid_same", "braid_resolve", "new_work"];

// Kind is tested before anything else because every later check depends on it (check 11 owns it)
const knownKind: Check = [11, (w) => (ITEM_KINDS.includes(w.kind) ? null : `"${w.kind}" is not something Atlas may propose`)];

const targetInScope: Check = [
  1,
  (w, s) => {
    const p = w.p;
    if (w.kind === "update") {
      if (!p.targetId) return null; // nothing named: at most a private note (check 9)
      const t = s.findTarget(p.targetId);
      if (!t) return `"${p.targetId}" is not one of your records`;
      w.target = t;
      return null;
    }
    if (!p.matchEntryId) {
      if (w.kind === "braid_same") return "a same-as report needs the entry it joins";
      return w.kind === "braid_resolve" ? "a resolve item needs the entry it resolves" : null;
    }
    if (w.kind === "braid_resolve") w.needsOk = true; // the author always confirms a resolution (E93)
    const m = s.findEntry(p.matchEntryId);
    if (!m) return `BRAID entry "${p.matchEntryId}" is not in your projects`;
    w.match = m;
    return null;
  },
];

/** Phase J: the quote, looked for only inside these spans (a standup's answers, and the questions taps answered). */
export function locateQuoteIn(text: string, quote: string, spans: readonly SourceSpan[]): SourceSpan | null {
  for (const sp of spans) {
    const at = locateQuote(text.slice(sp.start, sp.end), quote);
    if (at) return { start: sp.start + at.start, end: sp.start + at.end };
  }
  return null;
}

const quoteIsReal: Check = [
  2,
  (w, s) => {
    const quote = w.p.quote ?? "";
    const span = s.ctx.standup ? locateQuoteIn(s.ctx.text, quote, s.ctx.standup.quoteIn) : locateQuote(s.ctx.text, quote);
    if (!span) return s.ctx.standup ? "the quoted words are not in your answers" : "the quoted words are not in the message";
    w.spans = [span];
    return null;
  },
];

const fieldAllowed: Check = [
  3,
  (w, s) => {
    const t = w.target;
    if (w.kind !== "update" || !t || t.type === "entry") return null; // BRAID entries: check 12
    if (t.type === "project") return `${t.project.name}'s status is set by ${s.leadOf(t.project)} on the project, not from a message`;
    if (t.type === "leave") return w.field === "dates" ? null : `only leave dates can be read from a message`;
    const rule = FIELDS[t.record.type][w.field];
    if (!rule) {
      if (t.record.type === "milestone" && w.field === "target")
        return `moving ${t.record.title}'s target is a decision for ${s.leadOf(t.project)}`;
      // WF7: a due date is the plan, as a milestone's target is
      if (t.record.type === "work_item" && (w.field === "due" || w.field === "due_date"))
        return `${describe(t)}'s due date is the plan; ask ${s.leadOf(t.project)} to move it, or say when you now expect it done`;
      return `${w.field || "that field"} on ${describe(t)} cannot change from a message`;
    }
    if (!mayChangeField(t.record.type, w.field, { isOwner: t.record.ownerId === s.ctx.author.id, role: t.project.role })) {
      // Section 20, U5 (S5): saving asks the owner instead (M37), when they are on the project to ask
      const owner = t.record.ownerId ? t.project.people.find((p) => p.personId === t.record.ownerId && p.role !== null) : undefined;
      if (!owner) return `${describe(t)} belongs to ${s.nameOf(t.record.ownerId)}; ask them to change its ${w.field}`;
      w.ask = owner.personId;
      w.needsOk = true; // it sends something to someone, so the author confirms it whatever the confidence
    }
    if (rule.date) return null; // the value comes from check 5
    const value = w.newValue?.trim() ?? "";
    if (!value) return `no new ${w.field} for ${describe(t)}`;
    if (rule.values && !rule.values.includes(value)) return `"${value}" is not a ${w.field} of a ${t.record.type.replace("_", " ")}`;
    w.newValue = value;
    return null;
  },
];

// Date fields are read here once; check 4 needs to know if the date was relative, check 5 uses it
function readDates(w: Work, s: Scope): void {
  if (!isDateField(w)) return;
  const span = w.spans[0];
  const quote = s.ctx.text.slice(span.start, span.end);
  if (w.target?.type === "leave") {
    const r = readLeaveRange(quote, s.ctx.messageAt);
    w.leave = r && { ...r, span: { start: span.start + r.span.start, end: span.start + r.span.end } };
  } else if (w.target?.type === "record") {
    w.date = readDateValue(quote, s.ctx.messageAt, w.target.record.values[w.field] ?? null);
  }
}

const confidenceFloor: Check = [
  4,
  (w, s) => {
    // Anything the model sends outside the three levels counts as the lowest
    let c: Confidence = (CONFIDENCES as readonly string[]).includes(w.p.confidence) ? w.p.confidence : "low";
    const quote = s.quoteText(w);
    if (HEDGES.some((h) => mentions(quote, h))) c = lowerTo(c, "medium");
    // JA2: "#208 soon done" is still in progress; if Atlas says done, the author decides
    if (w.newValue && FINISHED.includes(w.newValue) && NOT_YET.some((n) => mentions(quote, n))) c = lowerTo(c, "medium");
    if (s.ctx.transcriptConfidence === "low") c = lowerTo(c, "medium"); // E5
    readDates(w, s);
    const d = w.leave ?? w.date;
    if (d && (d.relative || d.weekdayMismatch)) c = lowerTo(c, "medium"); // E13
    w.confidence = c;
    return null;
  },
];

const datesResolve: Check = [
  5,
  (w, s) => {
    if (!isDateField(w)) return null;
    if (w.target?.type === "leave") {
      if (!w.leave) return "no leave dates found in what you said";
      w.newValue = leaveValue(w.leave.start, w.leave.end);
      if (w.leave.weekdayMismatch) w.needsOk = true;
      return null;
    }
    if (!w.date) return "no date found in what you said";
    // WF2: a work forecast is when it will be done, so never a day already past
    if (w.target?.type === "record" && w.target.record.type === "work_item" && daysBetween(messageDay(s.ctx.messageAt), w.date.date) < 0)
      return `a forecast for ${describe(w.target)} is a day still to come`;
    w.newValue = w.date.date;
    if (w.date.weekdayMismatch) w.needsOk = true;
    return null;
  },
];

// ---- Check 6: one card per target and field ----

function mergeKey(w: Work): string | null {
  if (w.kind === "update" && w.target) {
    const t = w.target;
    const id = t.type === "record" ? t.record.id : t.type === "entry" ? t.entry.id : t.type === "project" ? t.project.id : "leave";
    return `${id}|${w.field}`;
  }
  if (w.kind === "braid_same" && w.match) return `entry|${w.match.entry.id}`;
  if (w.kind === "braid_resolve" && w.match) return `resolve|${w.match.entry.id}`;
  return null;
}

/** E14: the later value wins, every quote is kept, and the author confirms it. */
function mergeSameField(works: Work[]): Work[] {
  const out: Work[] = [];
  const byKey = new Map<string, Work[]>();
  for (const w of works) {
    const key = mergeKey(w);
    if (key === null) out.push(w);
    else if (byKey.has(key)) byKey.get(key)!.push(w);
    else {
      byKey.set(key, [w]);
      out.push(w);
    }
  }
  return out.map((w) => {
    const group = byKey.get(mergeKey(w) ?? "");
    if (!group || group.length === 1) return w;
    const later = [...group].sort((a, b) => a.spans[0].start - b.spans[0].start).at(-1)!;
    const spans = [...new Map(group.flatMap((g) => g.spans).map((sp) => [`${sp.start}:${sp.end}`, sp])).values()].sort(
      (a, b) => a.start - b.start,
    );
    const values = new Set(group.map((g) => g.newValue));
    return {
      ...later,
      all: group.flatMap((g) => g.all),
      spans,
      confidence: group.map((g) => g.confidence).reduce(lowerTo),
      // Exact repeats collapse quietly; two different quotes or values need the author's OK
      needsOk: group.some((g) => g.needsOk) || spans.length > 1 || values.size > 1,
    };
  });
}

// ---- Checks 7 to 13: one item at a time ----

const oldValueFromDatabase: Check = [
  7,
  (w) => {
    const t = w.target;
    w.oldValue = t?.type === "record" ? (t.record.values[w.field] ?? null) : t?.type === "entry" ? t.entry.state : null;
    // Phase J, SU3: a standup answer is compared at save with what its question showed, not what is there now
    if (t?.type === "record" && t.record.id === w.p.targetId && w.p.shownValue !== undefined) w.oldValue = w.p.shownValue;
    return null;
  },
];

const mark: Check = [
  8,
  (w, s) => {
    if (w.target?.type === "leave") {
      // M8, D6: leave that matches live leave changes nothing; a change or a new request needs the author's OK
      const fit = leaveFitOf(w.leave, s.ctx);
      w.leaveFit = fit;
      if (fit?.kind === "matches") w.newValue = leaveValue(fit.range.start, fit.range.end);
      if (fit?.kind === "change") w.newValue = leaveValue(fit.to.start, fit.to.end);
      if (fit?.kind === "matches" || fit?.kind === "change") w.oldValue = leaveValue(fit.kind === "matches" ? fit.range.start : fit.from.start, fit.kind === "matches" ? fit.range.end : fit.from.end);
      w.mark = fit?.kind === "matches" ? "matches_leave" : "needs_ok";
    } else if (w.target?.type === "record" && w.target.record.type === "work_item" && w.field === "forecast" && w.target.record.values.state === "done") {
      w.mark = "no_change"; // WF3: finished work has nothing left to forecast
    } else if (w.target?.type === "record" && w.newValue !== null && w.oldValue !== null && norm(w.newValue) === norm(w.oldValue)) {
      w.mark = "no_change";
    } else if (w.kind === "braid_resolve" && w.match?.entry.state === (w.p.outcome ?? "resolved")) {
      // OC4: already so (check 10 reads the outcome later, and drops one that does not fit)
      w.mark = "no_change";
    } else {
      // D20: handing a step over changes who covers the work while someone is away; a person confirms it
      if (w.target?.type === "record" && w.target.record.type === "handover" && w.newValue === "handed_over") w.needsOk = true;
      w.mark = !w.needsOk && w.confidence === "high" ? "pre_accepted" : "needs_ok";
    }
    return null;
  },
];

const projectIsCandidate: Check = [
  9,
  (w, s) => {
    const p = w.p;
    const route = (routing: RoutingState, projectId: string | null, reason: string) => {
      w.routing = routing;
      w.projectId = projectId;
      w.routingReason = reason;
    };
    w.scope = "project";
    if (w.target?.type === "leave") {
      // E80: leave goes to "You" whatever project the model named
      w.scope = "personal";
      route("routed", null, "Personal");
    } else if (w.kind === "update" && !w.target) route("not_filed", null, "Not filed: no record to update");
    else if (p.routingReason?.basis === "ambiguous") {
      route("choose_project", null, "Choose a project");
      // Offer the model's options that are candidates, or every candidate when it named none that fit
      const fit = (p.options ?? []).filter((id) => s.project(id));
      w.options = fit.length ? fit : s.ctx.projects.map((x) => x.id);
    }
    else if (!p.projectId) route("not_filed", null, "Not filed: none of your projects fits");
    else if (!s.project(p.projectId)) {
      // E75: naming a project the author is in leaks nothing; any other id is never echoed (E78)
      const off = s.ctx.notConnected.find((x) => x.id === p.projectId);
      route("not_filed", null, off ? `Not filed: ${off.name} isn't connected to DPM yet` : "Not filed: not one of your projects");
    } else route("routed", p.projectId, p.routingReason.label.trim() || p.routingReason.evidence);
    return null;
  },
];

const targetBelongs: Check = [
  10,
  (w) => {
    const t = w.target;
    if (w.kind === "update" && t && t.type !== "leave") {
      const home = t.type === "record" || t.type === "entry" || t.type === "project" ? t.project : null;
      if (home && (w.routing !== "routed" || w.projectId !== home.id)) return `${describe(t)} is in ${home.name}; it can only be updated there`;
    }
    if (!w.match) return null;
    const { project, entry } = w.match;
    const sameProject = w.routing === "routed" && w.projectId === project.id;
    if (w.kind === "braid_resolve") {
      // D7: only blockers and issues are resolved by what someone says; the rest are decided (check 12)
      if (!sameProject) return `"${entry.title}" is on ${project.name}'s log; it can only be resolved there`;
      if (entry.kind !== "blocker" && entry.kind !== "issue") {
        // Section 20, U3: the words say how it ended; a PM or Lead decides, unless they said it themselves
        const outcomes = OUTCOMES[entry.kind];
        if (!outcomes) return `a ${entry.kind} is not resolved from a message; its PM or Lead decides it`;
        const outcome = outcomes.find((o) => o === w.p.outcome);
        if (!outcome) return `say whether the ${entry.kind} ${outcomes.join(" or ")}`;
        // OC4: already so is "No change"; OC5: one still waiting for approval, or already ended, is not
        if (entry.state !== outcome && !OUTCOME_FROM.includes(entry.state as BraidEntryState))
          return entry.state === "proposed" || entry.state === "more_info" ? `"${entry.title}" isn't on the log yet; its PM or Lead decides it first` : `"${entry.title}" has already ended`;
        w.outcome = outcome;
      }
      w.braidKind = entry.kind;
      w.matchState = "same_as";
      return null;
    }
    if (w.kind === "braid_same") {
      if (!sameProject) return `"${entry.title}" is on ${project.name}'s log; a report can only join it there`;
      // M16: kinds never merge. A report about the same subject in another kind is new, and linked.
      if (w.braidKind && w.braidKind !== entry.kind) {
        w.kind = "braid_new";
        w.matchState = "related_to";
      } else {
        w.braidKind = entry.kind;
        w.matchState = "same_as";
      }
    } else if (sameProject && w.braidKind !== entry.kind) {
      w.matchState = "related_to";
    } else {
      w.match = null; // a link only within the project and across kinds; the author can match on review
    }
    return null;
  },
];

// Decisions a reversal can replace: approved ones, and (E88) ones still waiting, which the decider then sees side by side
const REPLACEABLE: readonly string[] = ["approved", "proposed", "more_info"];

/**
 * Section 20, U4: "we're going back to 5am" names the decision it reverses. It must be a decision in the
 * same project (SD5); one already replaced or withdrawn is not linked, and the new decision stands alone (SD2).
 */
const supersedesDecision: Check = [
  10,
  (w, s) => {
    const id = w.p.supersedes;
    if (!id || w.kind !== "braid_new" || w.braidKind !== "decision") return null;
    const m = s.findEntry(id);
    if (!m || m.entry.kind !== "decision") return null;
    if (w.routing !== "routed" || w.projectId !== m.project.id) return `"${m.entry.title}" is on ${m.project.name}'s log; a decision there can only be replaced there`;
    if (REPLACEABLE.includes(m.entry.state)) w.supersedes = m;
    return null;
  },
];

// Section 20, U7: new work needs a title and a state it can start in; a PM or Lead decides it (M37)
function newWorkGuard(w: Work): string | null {
  const title = w.p.workTitle?.trim();
  if (!title) return "new work needs a short title";
  const state = (w.p.newValue?.trim() || "in_progress") as NewWorkState;
  if (!NEW_WORK_STATES.includes(state)) return `new work starts as to do or in progress, not "${state}"`;
  w.newValue = state;
  w.needsOk = true;
  return null;
}

const kindAllowed: Check = [
  11,
  (w, s) => {
    if (w.kind === "update") return null;
    if (w.kind === "new_work") return newWorkGuard(w);
    const kind = w.braidKind as BraidKind;
    if (!BRAID_KINDS.includes(kind)) return `"${w.braidKind ?? ""}" is not a BRAID kind`;
    // Any member may say it is cleared: with the right it resolves, without it it is a proposal (S13)
    if (w.kind === "braid_resolve") return null;
    const project = s.project(w.projectId);
    if (!project || s.mayReport(project.role, kind)) return null;
    const who = PROJECT_ROLES.filter((r) => s.mayReport(r, kind)).join(" or ") || "no one";
    return `on ${project.name}, a ${kind} is reported by: ${who}`;
  },
];

const proposalsStayProposals: Check = [
  12,
  (w) => {
    // A capture only reports (braid_new) or adds a source (braid_same). Any state the model gave a
    // BRAID item is never read, so "we agreed" or "approved" still lands as a proposal (E96).
    if (w.kind === "update" && w.target?.type === "entry") {
      const deciders = BRAID_RIGHTS[w.target.entry.kind].decide;
      const who = deciders ? deciders.join(" or ") : "its owner";
      return `a message cannot change ${describe(w.target)} (${w.field} to ${w.newValue ?? "?"}); only a ${who} decides it`;
    }
    return null;
  },
];

const noHealthNoJudgement: Check = [
  13,
  (w, s) => {
    const quote = s.quoteText(w);
    if (w.target?.type === "leave") {
      // E17: leave dates may be kept; the health words never travel with them
      if (w.leave && HEALTH.some((h) => mentions(quote, h))) {
        const from = w.spans[0].start;
        const upTo = s.ctx.text.slice(from, w.leave.span.end);
        w.spans = [HEALTH.some((h) => mentions(upTo, h)) ? w.leave.span : { start: from, end: w.leave.span.end }];
      }
      return null;
    }
    if (w.kind === "update") return null;
    const said = `${quote}\n${w.p.braidTitle ?? ""}\n${w.p.workTitle ?? ""}`;
    if (HEALTH.some((h) => mentions(said, h))) return "Atlas keeps health out of project logs; the private care route is there if you want it";
    if (JUDGEMENTS.some((j) => mentions(said, j))) {
      const named = s.ctx.projects.flatMap((p) => p.people).find((person) => mentions(said, person.name) || mentions(said, person.name.split(" ")[0]));
      if (named) return `Atlas left out what you said about ${named.name}`;
    }
    return null;
  },
];

// ---- Check 14: the routing reason is real ----

// M14 "a thing tied to one project": the words name a record by its title or number ("TikTok
// ingest" names "TikTok trend ingest"). Every content word of the evidence must be in the record.
const STOPWORDS = new Set(["a", "an", "the", "for", "of", "on", "in", "to", "and", "my", "our", "is"]);
const contentWords = (s: string) => norm(s).split(/[^a-z0-9#]+/).filter((x) => x && !STOPWORDS.has(x));

function namesRecord(p: CandidateProject, evidence: string): boolean {
  const ev = contentWords(evidence);
  if (!ev.length || ev.join("").length < 4) return false;
  return p.records.some((r) => {
    const own = new Set([...contentWords(r.title), ...(r.number ? [norm(r.number)] : [])]);
    return ev.every((x) => own.has(x));
  });
}

function reasonHolds(w: Work, s: Scope): boolean {
  const reason = w.p.routingReason;
  const project = s.project(w.projectId);
  if (!project || !reason) return false;
  const near = s.nearText(w);
  const others = s.ctx.projects.filter((p) => p.id !== project.id);
  // A BRAID item has no target record; naming one of this project's records, and none of another's, ties it here (G19)
  const thingHere = () => mentions(near, reason.evidence) && namesRecord(project, reason.evidence) && !others.some((p) => namesRecord(p, reason.evidence));
  switch (reason.basis) {
    case "target": {
      const t = w.target;
      if (t?.type === "record" && t.project.id === project.id) {
        // E82: a title shared with another project's record does not decide; the number does
        const shared = others.some((p) => p.records.some((r) => norm(r.title) === norm(t.record.title)));
        return !shared || (!!t.record.number && mentions(near, t.record.number));
      }
      if (w.match) return w.match.project.id === project.id;
      return w.kind !== "update" && thingHere();
    }
    case "reference": {
      const name = [project.name, ...project.aliases].find((n) => norm(n) === norm(reason.evidence));
      const names = (p: CandidateProject) =>
        [p.name, ...p.aliases].some((n) => norm(n) === norm(reason.evidence)) ||
        p.records.some((r) => !!r.number && norm(r.number) === norm(reason.evidence));
      // JA7: a name that is also a word counts only in the shape of a reference ("di academy" is not GQ & Academy)
      const said = name ? namesProject(near, name, numbersOf(project)) : mentions(near, reason.evidence);
      return (said && names(project) && !others.some(names)) || (w.kind !== "update" && thingHere());
    }
    case "owned_record":
      if (w.target) return w.target.type === "record" && w.target.record.ownerId === s.ctx.author.id;
      return w.kind !== "update" && thingHere();
    case "tied_person": {
      const isNamed = (n: string) => norm(n) === norm(reason.evidence) || norm(n.split(" ")[0]) === norm(reason.evidence);
      const person = project.people.find((x) => isNamed(x.name));
      // W-D4: the name must be said as a name, by the rule mentions use ("mi will send it" ties nobody named Will)
      if (!person || !mentions(near, reason.evidence) || !namesPerson(near, person.name, false)) return false;
      // A person tied to two of the author's projects does not decide between them
      return !others.some((p) => p.people.some((x) => x.personId === person.personId));
    }
    default:
      return false;
  }
}

/** Phase L, CD14: the deciding word of a confirmed reference or tied person, and who that person is. */
function routedByOf(w: Work, s: Scope): Work["routedBy"] {
  const reason = w.p.routingReason;
  if (reason.basis !== "reference" && reason.basis !== "tied_person") return null;
  const word = reason.evidence.trim();
  const person = reason.basis === "tied_person" ? s.project(w.projectId)?.people.find((x) => norm(x.name) === norm(word) || norm(x.name.split(" ")[0]) === norm(word)) : undefined;
  return { basis: reason.basis, word, personId: person?.personId ?? null };
}

function checkRoutingReasons(works: Work[], s: Scope): void {
  const routed = (w: Work) => w.routing === "routed" && w.scope === "project";
  const downgrade = (w: Work) => {
    w.routingReason = `Choose a project: Atlas could not confirm "${w.routingReason}"`;
    w.routing = "choose_project";
    w.options = s.ctx.projects.map((x) => x.id);
    w.projectId = null;
  };
  // An explicit reference is the strongest routing signal (M14): when the target record alone pins
  // the project, the item stays filed there and the server states the reason, whatever Atlas said.
  const pinnedByTarget = (w: Work): string | null => {
    const t = w.target;
    if (w.kind !== "update" || t?.type !== "record" || t.project.id !== w.projectId) return null;
    const asTarget: Work = { ...w, p: { ...w.p, routingReason: { basis: "target", evidence: "", label: "" } } };
    return reasonHolds(asTarget, s) ? (t.record.number ?? `${t.record.title} is in ${t.project.name}`) : null;
  };
  const sameQuote = works.filter((w) => routed(w) && w.p.routingReason.basis === "same_quote");
  for (const w of works) {
    if (routed(w) && !sameQuote.includes(w) && reasonHolds(w, s)) {
      w.routedBy = routedByOf(w, s);
      continue;
    }
    if (!routed(w) || sameQuote.includes(w)) continue;
    const pinned = pinnedByTarget(w);
    if (pinned) w.routingReason = pinned;
    else downgrade(w);
  }
  // "Same quote as #4" holds when an item from overlapping words is filed in that project for its own reason
  for (const w of sameQuote) {
    const overlaps = (o: Work) => o.spans.some((a) => w.spans.some((b) => a.start < b.end && b.start < a.end));
    const anchor = works.find((o) => o !== w && !sameQuote.includes(o) && routed(o) && o.projectId === w.projectId && overlaps(o));
    if (!anchor) downgrade(w);
  }
}

// ---- Putting it together ----

function toDraft(w: Work, ordinal: number, s: Scope): ExtractedItemDraft {
  const t = w.target;
  const draft: ExtractedItemDraft = {
    ordinal,
    kind: w.kind,
    scope: w.scope,
    projectId: w.projectId,
    routing: w.routing,
    routingReason: w.routingReason,
    ...(w.routing === "choose_project" && w.options ? { options: w.options } : {}),
    spans: w.spans,
    confidence: w.confidence,
    mark: w.mark,
    // Leave rationale is the server's own words, so nothing said around the dates is stored (E17)
    rationale: t?.type === "leave" ? "Leave dates you mentioned" : w.p.rationale,
  };
  if (w.routedBy && w.routing === "routed") draft.routedBy = w.routedBy;
  // CV10, CV12: a correction replaces only an open item of an earlier message in this conversation
  const replaces = w.p.replacesItemId;
  if (replaces && s.ctx.earlier?.some((turn) => turn.openItems.some((i) => i.id === replaces))) draft.replaces = replaces;
  if (w.kind === "update" && t) {
    if (t.type === "record") {
      draft.target = { type: t.record.type, id: t.record.id, field: w.field, oldValue: w.oldValue, newValue: w.newValue ?? "" };
      // A blocked work item carries what it waits on (M5), from the model's note
      const note = w.p.note?.trim();
      if (note && w.newValue === "blocked") draft.target.note = note;
    }
    else if (t.type === "leave") {
      draft.target = { type: "leave", id: s.ctx.leave.targetId, field: "dates", oldValue: w.oldValue, newValue: w.newValue ?? "" };
      const fit = w.leaveFit;
      if (fit && fit.kind !== "refused") draft.leave = { fit: fit.kind, leaveId: fit.kind === "new" ? null : fit.leaveId, requested: fit.kind !== "new" && fit.requested };
    }
    // Checks 3 and 12 drop every other target; reaching here means one of them was skipped
    else throw new Error(`check ${t.type === "entry" ? 12 : 3} let through an update to ${describe(t)}`);
  }
  if (w.ask) draft.ask = { ownerId: w.ask };
  if (w.closeMatches) draft.closeMatches = { ids: w.closeMatches, chosen: null };
  if (w.kind === "new_work") draft.newWork = { title: w.p.workTitle!.trim(), state: w.newValue as NewWorkState };
  if (w.kind !== "update" && w.kind !== "new_work") {
    const title = w.match && w.matchState === "same_as" ? w.match.entry.title : w.p.braidTitle?.trim() || s.quoteText(w);
    draft.braid = { kind: w.braidKind as BraidKind, title, match: w.matchState, matchEntryId: w.match?.entry.id ?? null };
    if (w.match) draft.braid.seenState = w.match.entry.state; // compared again at save (E83)
    if (w.outcome) draft.braid.outcome = w.outcome;
    if (w.supersedes) draft.braid.supersedes = w.supersedes.entry.id;
    // Section 20, U2: a new dependency keeps the date its promise names, read by the server, never the model.
    // A date already past is what happened, not a promise (DP1: none at all is fine).
    if (w.kind === "braid_new" && w.braidKind === "dependency") {
      const said = resolveDate(s.quoteText(w), s.ctx.messageAt);
      draft.braid.expectedOn = said && daysBetween(messageDay(s.ctx.messageAt), said.date) >= 0 ? said.date : null;
    }
  }
  return draft;
}

function start(p: RawProposal): Work {
  return {
    p,
    all: [p],
    kind: p.kind,
    target: null,
    field: p.field?.trim() ?? "",
    newValue: p.newValue ?? null,
    oldValue: null,
    match: null,
    matchState: "new",
    braidKind: p.braidKind ?? null,
    spans: [],
    confidence: "low",
    date: null,
    leave: null,
    leaveFit: null,
    needsOk: false,
    mark: "needs_ok",
    scope: "project",
    routing: "not_filed",
    projectId: null,
    routingReason: "",
    options: null,
    outcome: null,
    supersedes: null,
    ask: null,
    routedBy: null,
    closeMatches: null,
  };
}

/**
 * Phase D: the other records an update's words could mean (targetOptions), each read through checks 1 to 13
 * as if Atlas had named it, so every option is one the checks accept for this author (section 6). The
 * target first; null unless at least two fit. Nothing Atlas names outside the author's records survives.
 * Nor does a field another item of the message already changes (`others`): two items on one field would
 * never save (E14 merges them only as Atlas reads them), so choosing it would leave the update stuck.
 */
function closeMatchesOf(w: Work, s: Scope, others: readonly Work[]): string[] | null {
  const t = w.target;
  if (w.kind !== "update" || t?.type !== "record") return null;
  const quiet = (v: Work, checks: Check[]) => checks.every(([, run]) => run(v, s) === null);
  const taken = new Set(others.filter((o) => o !== w).map(mergeKey));
  const fits = [...new Set(w.p.targetOptions ?? [])].filter((id) => {
    if (id === t.record.id || taken.has(`${id}|${w.field}`)) return false;
    const found = s.findTarget(id);
    if (found?.type !== "record") return false;
    const v = start({ ...w.p, ...asTarget(found.project, found.record), targetOptions: null });
    return quiet(v, PER_PROPOSAL) && quiet(v, PER_ITEM);
  });
  return fits.length ? [t.record.id, ...fits] : null;
}

/** A proposal's project and reason when the record itself decides them ("#152"). */
const asTarget = (project: CandidateProject, record: CandidateRecord): Pick<RawProposal, "targetId" | "projectId" | "routingReason"> => {
  const name = record.number ?? record.title;
  return { targetId: record.id, projectId: project.id, routingReason: { basis: "target", evidence: name, label: name } };
};

/**
 * Phase D: the author said which record an unsure update means (M21 in the chat, or on the review). The item
 * is read again as if Atlas had named that record, through every check as things stand now (rule 4, CL5):
 * the old value, the owner to ask, the project and the mark are the chosen record's. Its words, its place
 * in the message and the records it could mean stay. A check that drops it says why.
 */
export function retarget(draft: ExtractedItemDraft, recordId: string, ctx: CheckContext): { draft: ExtractedItemDraft } | { refused: string } {
  const t = draft.target;
  if (draft.kind !== "update" || !t || !draft.closeMatches?.ids.includes(recordId)) return { refused: "that is not one of the records it could mean" };
  const found = scopeOf(ctx, {}).findTarget(recordId);
  if (found?.type !== "record") return { refused: "that record is no longer one of yours" };
  const span = draft.spans[0];
  const p: RawProposal = {
    kind: "update",
    ...asTarget(found.project, found.record),
    field: t.field,
    newValue: t.newValue,
    note: t.note ?? null,
    quote: ctx.text.slice(span.start, span.end),
    confidence: draft.confidence,
    rationale: draft.rationale,
  };
  const { items, dropped } = runChecks([p], ctx);
  if (!items.length) return { refused: dropped[0]?.reason ?? "that record cannot take this change" };
  return { draft: { ...items[0], ordinal: draft.ordinal, spans: draft.spans, closeMatches: draft.closeMatches } };
}

const PER_PROPOSAL: Check[] = [knownKind, targetInScope, quoteIsReal, fieldAllowed, confidenceFloor, datesResolve];
const PER_ITEM: Check[] = [
  oldValueFromDatabase,
  mark,
  projectIsCandidate,
  targetBelongs,
  supersedesDecision,
  kindAllowed,
  proposalsStayProposals,
  noHealthNoJudgement,
];

/**
 * Applies checks 1 to 14 in the documented order to what Atlas returned for one capture.
 * Items keep the model's order; a merged item (check 6) takes the place of its first proposal.
 */
export function runChecks(proposals: readonly RawProposal[], ctx: CheckContext, options: CheckOptions = {}): CheckResult {
  const s = scopeOf(ctx, options);
  const dropped: DroppedProposal[] = [];
  const pass = (w: Work, checks: Check[]) => {
    for (const [check, run] of checks) {
      const reason = run(w, s);
      if (reason !== null) {
        for (const proposal of w.all) dropped.push({ proposal, check, reason });
        return false;
      }
    }
    return true;
  };

  const read = proposals.map(start).filter((w) => pass(w, PER_PROPOSAL));
  const kept = mergeSameField(read).filter((w) => pass(w, PER_ITEM));
  checkRoutingReasons(kept, s);
  for (const w of kept) {
    w.closeMatches = closeMatchesOf(w, s, kept);
    // Phase D: Atlas only guessed which record, so the author says which, or accepts the guess, before it saves
    if (w.closeMatches) w.mark = "needs_ok";
  }

  // S8, E7: past the cap, Atlas says "I found more; review these first"
  const limit = config.maxProposalsPerCapture;
  for (const w of kept.slice(limit)) for (const proposal of w.all) dropped.push({ proposal, check: "cap", reason: "I found more; review these first" });
  return { items: kept.slice(0, limit).map((w, i) => toDraft(w, i + 1, s)), dropped };
}
