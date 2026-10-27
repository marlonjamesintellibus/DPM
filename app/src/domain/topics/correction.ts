// Phase L, M31 (conversational plan, section 14): a correction that teaches Atlas how the team names things.
// "GQ also means the Guild" proposes another name for a project; "Kyle is Store Insights, not Forager"
// proposes Kyle as a contact on Store Insights and off Forager. Each is only a proposal, for a PM or Lead
// of that project to approve (UN8). What Atlas says is untrusted: checkCorrection keeps a project the asker
// is in, a word that is in the message and a person tied to one of their projects, or nothing.
import type { CheckContext } from "../atlas-checks/types";
import { namesPerson } from "../names";
import type { Topic } from "./topic";

export const correction = {
  id: "correction",
  rule: null,
  prompt: "a correction to how you read names (\"GQ also means the Guild\", \"Kyle is Store Insights, not Forager\"), with correction filled",
  suggest: ["What am I working on?", "What needs me today?"],
} as const satisfies Topic;

/** What Atlas says the correction is, before the checks. */
export type RawCorrection = { kind: string; projectId: string | null; word?: string | null; personId?: string | null; notProjectId?: string | null };

/** A correction that passed the checks: safe to propose for the asker. */
export type Correction = { kind: "alias" | "contact"; projectId: string; word: string | null; personId: string | null; notProjectId: string | null };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** P10: only the asker's projects; the word must be theirs; a contact must be someone tied to one of their projects, named in the words. */
export function checkCorrection(raw: RawCorrection | null | undefined, ctx: Pick<CheckContext, "text" | "projects">): Correction | null {
  if (!raw || !ctx.projects.some((p) => p.id === raw.projectId)) return null;
  const notProjectId = raw.notProjectId && raw.notProjectId !== raw.projectId && ctx.projects.some((p) => p.id === raw.notProjectId) ? raw.notProjectId : null;
  if (raw.kind === "alias") {
    const word = (raw.word ?? "").trim().replace(/^the\s+/i, "");
    if (word.length < 2 || word.length > 40 || !norm(ctx.text).includes(norm(word))) return null;
    return { kind: "alias", projectId: raw.projectId!, word, personId: null, notProjectId };
  }
  if (raw.kind === "contact") {
    const person = ctx.projects.flatMap((p) => p.people).find((x) => x.personId === raw.personId);
    if (!person || !(namesPerson(ctx.text, person.name, false) || namesPerson(ctx.text, person.name.split(" ")[0], false))) return null;
    return { kind: "contact", projectId: raw.projectId!, word: null, personId: person.personId, notProjectId };
  }
  return null;
}

const named = (projects: CheckContext["projects"], words: string) => projects.find((p) => [p.name, ...p.aliases].some((n) => norm(n) === norm(words)));

/**
 * QA8 for corrections: without a model, the two shapes the plan names, as the whole message. "<project> also
 * means <word>" (either way round), and "<person> is <project>, not <project>" or "<person> is on <project>".
 */
export function ruleCorrection(ctx: Pick<CheckContext, "text" | "projects">): Correction | null {
  const text = ctx.text.trim().replace(/[.!]+$/, "");
  const also = /^(.+?)\s+(?:also means|means|is also)\s+(?:the\s+)?(.+?)(?:\s+too)?$/i.exec(text);
  if (also) {
    const [left, right] = [also[1], also[2]];
    const project = named(ctx.projects, left) ?? named(ctx.projects, right);
    const word = project && named(ctx.projects, left) === project ? right : left;
    return project ? checkCorrection({ kind: "alias", projectId: project.id, word }, ctx) : null;
  }
  const tie = /^(.+?)\s+is\s+(?:on\s+|with\s+)?(.+?)(?:,?\s+not\s+(?:on\s+|with\s+)?(.+))?$/i.exec(text);
  if (tie) {
    const person = ctx.projects.flatMap((p) => p.people).find((x) => norm(x.name) === norm(tie[1]) || norm(x.name.split(" ")[0]) === norm(tie[1]));
    const project = named(ctx.projects, tie[2]);
    const not = tie[3] ? named(ctx.projects, tie[3]) : undefined;
    if (person && project) return checkCorrection({ kind: "contact", projectId: project.id, personId: person.personId, notProjectId: not?.id ?? null }, ctx);
  }
  return null;
}
