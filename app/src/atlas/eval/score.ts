// Scores one Atlas read against an evaluation case, after the server checks (phase 4 step 7).
import { runChecks } from "../../domain/atlas-checks/checks";
import type { CheckContext, RawProposal } from "../../domain/atlas-checks/types";
import type { ExtractedItemDraft } from "../../domain/shared";
import { checkCommands, type CommandNote, type RawCommand } from "../../domain/acting";
import { checkQuestion, type RawQuestion } from "../../domain/question";
import type { EvalCase } from "./cases";

export function itemKey(i: ExtractedItemDraft): string {
  // Section 20, U5 and U7: someone else's record asks its owner; work with no record is new work
  if (i.target && i.ask) return `ask:${i.target.id}.${i.target.field}=${i.target.newValue}`;
  if (i.target) return `upd:${i.target.id}.${i.target.field}=${i.target.newValue}`;
  if (i.newWork) return `track:${i.projectId ?? "none"}`;
  // Phase E: the author's own promise, with what it names and the day the server read; the same promise again
  // (CM5) names the commitment it moves, and one said done (CM6) the commitment it ends
  if (i.commitment) {
    const c = i.commitment;
    // Phase O: a meeting note's promise by someone else, or by someone Atlas could not tell (MT2)
    if (i.speaker) return `promise-by:${i.speaker.sure && i.speaker.personId ? i.speaker.personId : "unsure"}@${c.dueOn}`;
    if (c.act === "done") return `promise-done:${c.commitmentId}`;
    return c.commitmentId ? `same-promise:${c.commitmentId}@${c.dueOn}` : `promise:${c.link?.id ?? "none"}@${c.dueOn}`;
  }
  // Section 20, U3: a risk, assumption or dependency says how it ended
  if (i.kind === "braid_resolve") return i.braid?.outcome ? `outcome:${i.braid.matchEntryId}=${i.braid.outcome}` : `resolve:${i.braid?.matchEntryId}`;
  if (i.braid?.match === "same_as") return `same:${i.braid.matchEntryId}`;
  // Section 20, U4: a decision that reverses another
  if (i.braid?.supersedes) return `supersede:${i.braid.supersedes}`;
  // Section 20, U2: a dependency's promised date, as the server read it
  return `new:${i.braid?.kind}:${i.projectId ?? "none"}${i.braid?.expectedOn ? `@${i.braid.expectedOn}` : ""}`;
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
  /** Section 15: "topic@project" as asked after the checks, or null; phase C adds "#subject" when one is kept. */
  asked: string | null;
  /** Phase B: what the reply decides after the checks: "approve@1", or the note when it made no card. */
  commands: string[];
  /** Phase D: the records DPM would ask the author to choose between, "records:wi-151,wi-152", or null. */
  unsure: string | null;
};

/** Phase D: the first item in the message whose words fit 2 or 3 records, as the question would offer them (M21). */
function unsureKey(items: readonly ExtractedItemDraft[]): string | null {
  const first = [...items].sort((a, b) => (a.spans[0]?.start ?? 0) - (b.spans[0]?.start ?? 0)).find((i) => i.closeMatches && i.closeMatches.ids.length <= 3);
  return first ? `records:${[...first.closeMatches!.ids].sort().join(",")}` : null;
}

/** Phase B: a note's key, "note:which@1,2". */
function noteKey(note: CommandNote): string {
  if (note.kind === "which") return `note:which${note.lines.length ? `@${[...note.lines].sort((a, b) => a - b).join(",")}` : ""}`;
  return note.kind === "not_offered" ? `note:not_offered@${[...note.lines].sort((a, b) => a - b).join(",")}` : `note:${note.kind}`;
}

export function scoreCase(c: EvalCase, proposals: readonly RawProposal[], ctx: CheckContext, question: RawQuestion | null = null, said: readonly RawCommand[] = []): CaseScore {
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
  const asked = q ? `${q.topic}@${q.projectId ?? "none"}${q.subject ? `#${q.subject.id}` : ""}` : null;
  if (!c.ask && !c.correct && q) forbidden.push(`asks ${asked}`);
  // Phase L, M31: a correction, as the checks keep it
  if (c.correct) {
    const got = q?.topic === "correction" ? q.correction : undefined;
    const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? null)?.toLowerCase() === (b ?? null)?.toLowerCase();
    const ok = !!got && got.kind === c.correct.kind && got.projectId === c.correct.projectId && same(got.word, c.correct.word) && same(got.personId, c.correct.personId) && same(got.notProjectId, c.correct.notProjectId);
    if (!ok) missing.push(`correct ${JSON.stringify(c.correct)}${got ? ` (got ${JSON.stringify(got)})` : ""}`);
  }
  // Section 16: a correction must name the earlier item it replaces (the checks keep only listed ones)
  if (c.replaces && !items.some((i) => i.replaces === c.replaces)) missing.push(`replaces ${c.replaces}`);
  // Phase B: exactly the commands expected, one card per line; a case without them must decide nothing
  const decided = checkCommands(said, c.answer);
  const commands = [...decided.kept.map((k) => `${k.act}@${k.line}`), ...(decided.note ? [noteKey(decided.note)] : [])];
  for (const k of c.commands ?? []) if (!commands.includes(k)) missing.push(k);
  for (const k of commands) if (!(c.commands ?? []).includes(k)) forbidden.push(`decides ${k}`);
  // Phase D: exactly the records it is unsure between; a case without them must be sure
  const unsure = unsureKey(items);
  if (c.unsure && unsure !== c.unsure) missing.push(`unsure ${c.unsure}${unsure ? ` (got ${unsure})` : ""}`);
  if (!c.unsure && unsure) forbidden.push(`unsure ${unsure}`);
  if (c.ask) {
    const topics = Array.isArray(c.ask.topic) ? c.ask.topic : [c.ask.topic];
    const projects = Array.isArray(c.ask.projectId) ? c.ask.projectId : [c.ask.projectId];
    if (!q || !topics.includes(q.topic) || !projects.includes(q.projectId)) missing.push(`ask ${topics.join("|")}@${projects.map((p) => p ?? "none").join("|")}`);
    // Phase C: what a why question is about, as the checks kept it (WY1)
    if (c.ask.subject !== undefined) {
      const subjects = Array.isArray(c.ask.subject) ? c.ask.subject : [c.ask.subject];
      if (!q || !subjects.includes(q.subject?.id ?? null)) missing.push(`subject ${subjects.map((s) => s ?? "none").join("|")}`);
    }
  }
  return {
    id: c.id,
    pass: missing.length === 0 && forbidden.length === 0,
    expected: c.expect.length + (c.ask ? 1 : 0) + (c.commands?.length ?? 0) + (c.correct ? 1 : 0) + (c.unsure ? 1 : 0),
    hit: c.expect.length + (c.ask ? 1 : 0) + (c.commands?.length ?? 0) + (c.correct ? 1 : 0) + (c.unsure ? 1 : 0) - missing.length,
    missing,
    extra,
    forbidden,
    chooseProject: items.filter((i) => i.routing === "choose_project").length,
    keys,
    asked,
    commands,
    unsure,
  };
}
