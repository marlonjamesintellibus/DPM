// Scores one Atlas read against an evaluation case, after the server checks (phase 4 step 7).
import { runChecks } from "../../domain/atlas-checks/checks";
import type { CheckContext, RawProposal } from "../../domain/atlas-checks/types";
import type { ExtractedItemDraft } from "../../domain/shared";
import { checkQuestion, type RawQuestion } from "../../domain/question";
import type { EvalCase } from "./cases";

export function itemKey(i: ExtractedItemDraft): string {
  if (i.target) return `upd:${i.target.id}.${i.target.field}=${i.target.newValue}`;
  if (i.kind === "braid_resolve") return `resolve:${i.braid?.matchEntryId}`;
  if (i.braid?.match === "same_as") return `same:${i.braid.matchEntryId}`;
  return `new:${i.braid?.kind}:${i.projectId ?? "none"}`;
}

const matches = (pattern: string, key: string) => (pattern.endsWith("*") ? key.startsWith(pattern.slice(0, -1)) : key === pattern);

export type CaseScore = {
  id: string;
  /** Every expected item passed the checks and nothing forbidden did. */
  pass: boolean;
  expected: number;
  hit: number;
  missing: string[];
  /** Items that passed but were neither expected nor allowed, or repeat one that was. */
  extra: string[];
  forbidden: string[];
  /** Items the checks held back for a project choice (E71); counted, not failed. */
  chooseProject: number;
  keys: string[];
  /** Section 15: "topic@project" as asked after the checks, or null. */
  asked: string | null;
};

export function scoreCase(c: EvalCase, proposals: readonly RawProposal[], ctx: CheckContext, question: RawQuestion | null = null): CaseScore {
  const items = runChecks(proposals, { ...ctx, text: c.text, ...(c.earlier ? { earlier: c.earlier } : {}) }).items;
  const keys = items.map(itemKey);
  const used = new Set<number>();
  const missing: string[] = [];
  for (const e of c.expect) {
    const any = Array.isArray(e) ? e : [e];
    const at = keys.findIndex((k, i) => !used.has(i) && any.some((p) => matches(p, k)));
    if (at < 0) missing.push(any.join(" | "));
    else used.add(at);
  }
  const forbidden = keys.filter((k) => (c.forbid ?? []).some((p) => matches(p, k)));
  // E12: a guess, in English or Patois, comes through held for the author's OK, never at High
  items.forEach((item, i) => {
    if (item.confidence === "high" && (c.held ?? []).some((p) => matches(p, keys[i]))) forbidden.push(`${keys[i]} at high`);
  });
  const words = items.flatMap((i) => [i.braid?.title ?? "", i.target?.note ?? "", i.rationale]).join(" \n ").toLowerCase();
  for (const w of c.forbidWords ?? []) if (words.includes(w.toLowerCase())) forbidden.push(`says "${w}"`);
  const extra = keys.filter((k, i) => !used.has(i) && !(c.allow ?? []).some((p) => matches(p, k)) && !forbidden.includes(k));
  // Section 15: a case without ask must ask nothing; one with ask must ask that, about that project
  const q = checkQuestion(question, { ...ctx, text: c.text });
  const asked = q ? `${q.topic}@${q.projectId ?? "none"}` : null;
  if (!c.ask && q) forbidden.push(`asks ${asked}`);
  // Section 16: a correction must name the earlier item it replaces (the checks keep only listed ones)
  if (c.replaces && !items.some((i) => i.replaces === c.replaces)) missing.push(`replaces ${c.replaces}`);
  if (c.ask) {
    const topics = Array.isArray(c.ask.topic) ? c.ask.topic : [c.ask.topic];
    if (!q || !topics.includes(q.topic) || q.projectId !== c.ask.projectId) missing.push(`ask ${topics.join("|")}@${c.ask.projectId ?? "none"}`);
  }
  return {
    id: c.id,
    pass: missing.length === 0 && forbidden.length === 0,
    expected: c.expect.length + (c.ask ? 1 : 0),
    hit: c.expect.length + (c.ask ? 1 : 0) - missing.length,
    missing,
    extra,
    forbidden,
    chooseProject: items.filter((i) => i.routing === "choose_project").length,
    keys,
    asked,
  };
}
