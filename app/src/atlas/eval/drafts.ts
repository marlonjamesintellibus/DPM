// Phase G's evaluation of drafting (M25): Atlas writes a draft from the facts DPM read for its asker, at 8:58am
// on Tuesday 20 Oct against the seed, and the case passes only when the draft passes the same facts check the
// machine runs (DR2: every record, date, number and name is one it was given; DR4: a client status names no
// milestone the client view does not show; CD8: no quotes). A draft that fails is what a person would see as
// the plain template instead, so the score counts how often Atlas's own words reach them.
import type { Conn } from "../../db/conn";
import { KEMAR_NOTE_AT } from "../../domain/atlas-checks/kemar-note.fixture";
import { draftProblem, plainDraft, type DraftFacts, type DraftKind, type KnownNames } from "../../domain/drafts";
import { draftFacts, knownNames } from "../../queries/drafts";
import type { EvalAuthor } from "./cases";

export type DraftEvalCase = {
  id: string;
  about: string;
  author: EvalAuthor;
  kind: DraftKind;
  projectId: string | null;
  /** Words that must never be in the draft, whatever the facts check says (DR4: internal names). */
  forbidWords?: string[];
};

export const DRAFT_EVAL_CASES: DraftEvalCase[] = [
  { id: "g-write-standup", about: "DR1 a standup with nothing saved since yesterday keeps to the facts", author: "kemar", kind: "standup", projectId: null },
  { id: "g-write-standup-forager", about: "a standup for one project says nothing of the others", author: "kemar", kind: "standup", projectId: "forager", forbidWords: ["Store Insights", "#208"] },
  { id: "g-write-client", about: "DR4 a client status holds only the releases", author: "alicia", kind: "client", projectId: "forager", forbidWords: ["Trend model", "Data sources", "#151", "Kemar", "blocker"] },
  { id: "g-write-weekly", about: "a quiet week is said as it is, with nothing added", author: "alicia", kind: "weekly", projectId: "forager" },
];

/** The facts a case's draft is written from, and the names the check knows for its author, as the app reads them. */
export async function draftCaseFacts(conn: Conn, c: DraftEvalCase): Promise<{ facts: DraftFacts; known: KnownNames }> {
  const facts = await draftFacts(conn, c.author, c.kind, c.projectId, KEMAR_NOTE_AT);
  if (!facts) throw new Error(`${c.id}: ${c.author} cannot read ${c.projectId}`);
  return { facts, known: await knownNames(conn, c.author, KEMAR_NOTE_AT) };
}

export type DraftScore = { pass: boolean; problem: string | null; forbidden: string[] };

export function scoreDraft(c: DraftEvalCase, facts: DraftFacts, known: KnownNames, written: string): DraftScore {
  const text = plainDraft(written);
  const problem = draftProblem(facts, text, known);
  const forbidden = (c.forbidWords ?? []).filter((w) => text.toLowerCase().includes(w.toLowerCase()));
  return { pass: !problem && !forbidden.length, problem, forbidden };
}
