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
  // scrape?". Phase R: "Wha mek Forager at risk?". Not "A wah a hold up di feed?", which stays blocked
  rule: /\b(why|how come|wha mek|wah mek|wa mek)\b|^(?:what|what's|what is|what are)\b.*\b(?:holding|keeping)\b.*\b(?:up|back)\b|\b(?:when|who)\b.*\b(?:decide|decided|decision|agreed|approved)\b/,
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

/**
 * The subject the words name, without a model: a work item by its number ("#151"), else the longest
 * record or entry title said in full ("the trend model"), else the project named. Only the asker's
 * projects are searched, so nothing else can be found (WY1).
 */
export function subjectIn(text: string, projects: readonly CandidateProject[], namedProjectId: string | null): WhySubject | null {
  for (const n of text.match(/#\d+/g) ?? []) {
    for (const p of projects) {
      const w = p.records.find((r) => r.type === "work_item" && r.number === n);
      if (w) return { type: "work_item", id: w.id, projectId: p.id };
    }
  }
  const lower = text.toLowerCase().replace(/[‘’]/g, "'");
  const said = (title: string) => title.length >= 4 && new RegExp(`(?<!\\w)${escaped(title.toLowerCase())}(?!\\w)`).test(lower);
  // Records before entries, so a work item and its blocker with the same title read as the work
  const titled = projects.flatMap((p) => [
    ...p.records.filter((r) => (r.type === "work_item" || r.type === "milestone") && said(r.title)).map((r) => ({ type: r.type as WhySubjectType, id: r.id, projectId: p.id, title: r.title })),
    ...p.braid.filter((e) => said(e.title)).map((e) => ({ type: "braid_entry" as const, id: e.id, projectId: p.id, title: e.title })),
  ]);
  const best = titled.reduce<(typeof titled)[number] | null>((a, b) => (!a || b.title.length > a.title.length ? b : a), null);
  if (best) return { type: best.type, id: best.id, projectId: best.projectId };
  return namedProjectId ? { type: "project", id: namedProjectId, projectId: namedProjectId } : null;
}

const DECIDED = /\b(decide|decided|decision|decisions|agree|agreed)\b/;
const HOLDUP = /\b(hold(?:ing)?|held|keeping)\b.*\b(up|back)\b|\b(block|blocked|blocking|stuck|waiting|wait pon)\b/;
const CHANGED = /\b(move|moved|change|changed|pushed|slipped|slip|delayed|rescheduled|bumped|marked|set to|reopened|closed|resolved|switched|cancelled|missed|approved|declined)\b/;

/**
 * Which of the four answers the words ask for. A decision is always "when was it decided"; a project
 * has no field of its own to change, so a change on it is its status (who set it). Anything else asks
 * why it has its status.
 */
export function whyAsks(asked: string, subject: { type: WhySubjectType; kind?: string } | null): WhyAsks {
  const t = asked.toLowerCase().replace(/[‘’]/g, "'");
  if (subject?.kind === "decision" || (DECIDED.test(t) && (!subject || subject.type === "project"))) return "decided";
  if (HOLDUP.test(t)) return "holdup";
  if (subject?.type === "braid_entry") return "changed"; // an entry has no status, only its history
  if (CHANGED.test(t) && subject?.type !== "project") return "changed";
  return "status";
}
