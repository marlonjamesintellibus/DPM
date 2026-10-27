// Scores one Atlas read against an evaluation case, after the server checks (phase 4 step 7).
import { runChecks } from "../../domain/atlas-checks/checks";
import type { CheckContext, RawProposal } from "../../domain/atlas-checks/types";
import type { ExtractedItemDraft } from "../../domain/shared";
import type { EvalCase } from "./cases";

export function itemKey(i: ExtractedItemDraft): string {
  if (i.target) return `upd:${i.target.id}.${i.target.field}=${i.target.newValue}`;
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
};

export function scoreCase(c: EvalCase, proposals: readonly RawProposal[], ctx: CheckContext): CaseScore {
  const items = runChecks(proposals, { ...ctx, text: c.text }).items;
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
  const words = items.flatMap((i) => [i.braid?.title ?? "", i.target?.note ?? "", i.rationale]).join(" \n ").toLowerCase();
  for (const w of c.forbidWords ?? []) if (words.includes(w.toLowerCase())) forbidden.push(`says "${w}"`);
  const extra = keys.filter((k, i) => !used.has(i) && !(c.allow ?? []).some((p) => matches(p, k)) && !forbidden.includes(k));
  return {
    id: c.id,
    pass: missing.length === 0 && forbidden.length === 0,
    expected: c.expect.length,
    hit: c.expect.length - missing.length,
    missing,
    extra,
    forbidden,
    chooseProject: items.filter((i) => i.routing === "choose_project").length,
    keys,
  };
}
