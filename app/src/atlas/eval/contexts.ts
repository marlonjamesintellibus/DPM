// The candidate data each evaluation author has, loaded from the 20 Oct seed (world only, before
// anyone speaks) through the same loader the app uses, so the cases and the seed stay in step (D22).
import type { Conn } from "../../db/conn";
import type { CheckContext } from "../../domain/atlas-checks/types";
import type { SourceSpan } from "../../domain/shared";
import { KEMAR_NOTE_AT } from "../../domain/atlas-checks/kemar-note.fixture";
import { loadCheckContext } from "../../queries/check-context";
import type { EvalAuthor, EvalCase } from "./cases";

export const EVAL_AUTHORS: readonly EvalAuthor[] = ["kemar", "alicia", "andre"];

export async function evalContexts(conn: Conn): Promise<Record<EvalAuthor, CheckContext>> {
  const out = {} as Record<EvalAuthor, CheckContext>;
  for (const author of EVAL_AUTHORS) out[author] = await loadCheckContext(conn, { authorId: author, text: "", messageAt: KEMAR_NOTE_AT, transcriptConfidence: null });
  return out;
}

/** One case's candidate data: its author's, with any BRAID entries the case adds, its earlier messages and its open answer. */
export function caseContext(c: EvalCase, contexts: Record<EvalAuthor, CheckContext>): CheckContext {
  const base = contexts[c.author ?? "kemar"];
  const projects = c.braid ? base.projects.map((p) => ({ ...p, braid: [...p.braid, ...c.braid!.filter((b) => b.projectId === p.id).map(({ projectId: _, ...e }) => e)] })) : base.projects;
  return {
    ...base,
    projects,
    text: c.text,
    ...(c.earlier ? { earlier: c.earlier } : {}),
    ...(c.answer ? { openAnswer: c.answer } : {}),
    ...(c.standup ? { standup: { quoteIn: answerSpans(c.text) } } : {}),
    // Phase O: a meeting note is read with who was there (M33)
    ...(c.meeting ? { meeting: c.meeting } : {}),
  };
}

/** Phase J: a standup case's answers, each line after its "Atlas:" question, as check 2 looks for quotes in them. */
export function answerSpans(text: string): SourceSpan[] {
  const spans: SourceSpan[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    const said = /^(?!Atlas: )[^:\n]+: /.exec(line);
    if (said) spans.push({ start: at + said[0].length, end: at + line.length });
    at += line.length + 1;
  }
  return spans;
}
