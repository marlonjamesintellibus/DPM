// Conversational plan, phase C: why something is as it is (WY1 to WY8). A why question has a subject: a
// project, work item, milestone, BRAID entry or decision. Atlas says it as an id from the lists it is
// given; the rule finds it in the words. Either way it is kept only when it is in a project the asker can
// read (WY1), as checkQuestion keeps a projectId. The answer (queries/answers/why.ts) walks the links
// DPM already keeps: the status rules, blocked work and its links, decisions and the audit trail.
import type { CandidateProject } from "../atlas-checks/types";
import type { Topic } from "./topic";

export const why = {
  id: "why",
  // "Why is Forager at risk?", "What's holding up the trend model?", "When did we decide to drop the TikTok
  // scrape?". Phase R: "Wha mek Forager at risk?". Not "A wah a hold up di feed?", which stays blocked.
  // A why that ends the question tags another one ("Who mentioned me and why?", "What's due this week,
  // and why?"), so it keeps its own topic: why asks only with words after it
  rule: /\b(why|how come|wha mek|wah mek|wa mek)\b(?=\s*\w)|^(?:what|what's|what is|what are)\b.*\b(?:holding|keeping)\b.*\b(?:up|back)\b|\b(?:when|who)\b.*\b(?:decide|decided|decision|agreed|approved)\b/,
  prompt: "why something is as it is: a status, what holds it up, when something was decided, or why a field changed",
  suggest: ["What's blocked?", "What needs me today?"],
} as const satisfies Topic;

export type WhySubjectType = "project" | "work_item" | "milestone" | "braid_entry";

/** What a why question is about, in a project the asker could read when it was asked. */
export type WhySubject = { type: WhySubjectType; id: string; projectId: string };

/** The four answers in the plan's table. */
export type WhyAsks = "status" | "holdup" | "decided" | "changed";

/** WY1: the subject Atlas named, only when it is in the asker's lists; anything else is no subject. */
export function subjectById(id: string | null | undefined, projects: readonly CandidateProject[]): WhySubject | null {
  if (!id) return null;
  for (const p of projects) {
    if (p.id === id) return { type: "project", id, projectId: p.id };
    const record = p.records.find((r) => r.id === id && (r.type === "work_item" || r.type === "milestone"));
    if (record) return { type: record.type as "work_item" | "milestone", id, projectId: p.id };
    if (p.braid.some((e) => e.id === id)) return { type: "braid_entry", id, projectId: p.id };
  }
  return null;
}

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const plain = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'");

/**
 * What subjectIn reads of one project: its work items and milestones, and its BRAID entries. Atlas's
 * lists (CandidateProject) have this shape, and so do the projects the asker reads now: the answer
 * searches those too, since Atlas's lists leave out cancelled work (D2) that the asker can still read.
 */
export type SubjectLists = {
  id: string;
  records: readonly { type: string; id: string; number?: string; title: string }[];
  braid: readonly { id: string; kind: string; title: string }[];
};

/**
 * The subject the words name, without a model: a work item by its number ("#151"), else the longest
 * record or entry title said in full ("the trend model"), else the project named. Only the asker's
 * projects are searched, so nothing else can be found (WY1). A record and an entry with the same title
 * read as the record, unless the words say the entry's kind ("the store sales feed access blocker").
 */
export function subjectIn(text: string, projects: readonly SubjectLists[], namedProjectId: string | null): WhySubject | null {
  for (const n of text.match(/#\d+/g) ?? []) {
    for (const p of projects) {
      const w = p.records.find((r) => r.type === "work_item" && r.number === n);
      if (w) return { type: "work_item", id: w.id, projectId: p.id };
    }
  }
  const lower = plain(text);
  const said = (title: string) => title.length >= 4 && new RegExp(`(?<!\\w)${escaped(title.toLowerCase())}(?!\\w)`).test(lower);
  const kindSaid = (kind: string) => new RegExp(`\\b${kind}s?\\b`).test(lower);
  // Records before entries, so a work item and its blocker with the same title read as the work
  const titled = projects.flatMap((p) => [
    ...p.records
      .filter((r) => (r.type === "work_item" || r.type === "milestone") && said(r.title))
      .map((r) => ({ type: r.type as WhySubjectType, id: r.id, projectId: p.id, title: r.title, named: r.type === "milestone" && kindSaid("milestone") })),
    ...p.braid.filter((e) => said(e.title)).map((e) => ({ type: "braid_entry" as const, id: e.id, projectId: p.id, title: e.title, named: kindSaid(e.kind) })),
  ]);
  // Phase C, WY1: the kind the words say first, then the longest title; a stable sort keeps records first
  const best = [...titled].sort((a, b) => Number(b.named) - Number(a.named) || b.title.length - a.title.length)[0];
  if (best) return { type: best.type, id: best.id, projectId: best.projectId };
  return namedProjectId ? { type: "project", id: namedProjectId, projectId: namedProjectId } : null;
}

const DECIDED = /\b(decide|decided|decision|decisions|agree|agreed|approve|approved)\b/;
const HOLDUP = /\b(hold(?:ing)?|held|keeping)\b.*\b(up|back)\b|\b(block|blocked|blocking|stuck|waiting|wait pon)\b/;
const CHANGED = /\b(move|moved|change|changed|pushed|slipped|slip|delayed|rescheduled|bumped|marked|set to|reopened|closed|resolved|switched|cancelled|canceled|missed|approved|declined)\b/;
const STATUS = /\b(at risk|off[ -]track|on track|not started|status|late|behind)\b/;

/**
 * CV8, CQ14: the words that say which of the four is asked. A follow-up's own when they say one ("and
 * why is #152 late?"); otherwise those of the newest question it follows that does, so "and on GQ &
 * Academy?" after "What's holding up Forager?" asks what holds GQ up, not how it stands.
 */
export function whyWords(asked: string, follows: readonly string[] = []): string {
  return [asked, ...follows].find((w) => [DECIDED, HOLDUP, CHANGED, STATUS].some((re) => re.test(plain(w)))) ?? asked;
}

/**
 * Which of the four answers the words ask for. A decision is always "when was it decided"; a project
 * has no field of its own to change, so a change on it is its status (who set it). Anything else asks
 * why it has its status. "Who approved ..." with no record is a decision (WY4); on a record it is a change.
 */
export function whyAsks(asked: string, subject: { type: WhySubjectType; kind?: string } | null): WhyAsks {
  const t = plain(asked);
  if (subject?.kind === "decision" || (DECIDED.test(t) && (!subject || subject.type === "project"))) return "decided";
  if (HOLDUP.test(t)) return "holdup";
  if (subject?.type === "braid_entry") return "changed"; // an entry has no status, only its history
  if (CHANGED.test(t) && subject?.type !== "project") return "changed";
  return "status";
}

/** The field a why-it-changed question is about; null when the words do not say (any change answers). */
export type WhyField = "date" | "note" | "state";

const SAYS_DATE_FIELD = /\b(date|dates|due|deadline|forecast|expected)\b/;
const SAYS_STATE = /\b(done|blocked|unblocked|cancelled|canceled|in progress|to do|missed|reopened|closed|resolved|approved|declined|marked|started|finished|open|state)\b/;
const SAYS_DATE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|next week|later|earlier|pushed|slipped|slip|delayed|rescheduled|bumped|postponed)\b/;

/**
 * Phase C, WY6: "Why was #145 moved to Friday?" asks about its date, not its state; "Why was #151
 * moved to blocked?" about its state. A field the words name ("its due date") wins over a state word
 * said with it, and a state word over a day ("marked done on Friday" is about its state).
 */
export function whyField(asked: string): WhyField | null {
  const t = plain(asked);
  if (/\bnote\b/.test(t)) return "note";
  if (SAYS_DATE_FIELD.test(t)) return "date";
  if (SAYS_STATE.test(t)) return "state";
  if (SAYS_DATE.test(t)) return "date";
  return null;
}
