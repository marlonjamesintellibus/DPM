// The candidate data each evaluation author has, loaded from the 20 Oct seed (world only, before
// anyone speaks) through the same loader the app uses, so the cases and the seed stay in step (D22).
import type { Conn } from "../../db/conn";
import type { CheckContext } from "../../domain/atlas-checks/types";
import { KEMAR_NOTE_AT } from "../../domain/atlas-checks/kemar-note.fixture";
import { loadCheckContext } from "../../queries/check-context";
import type { EvalAuthor } from "./cases";

export const EVAL_AUTHORS: readonly EvalAuthor[] = ["kemar", "alicia", "andre"];

export async function evalContexts(conn: Conn): Promise<Record<EvalAuthor, CheckContext>> {
  const out = {} as Record<EvalAuthor, CheckContext>;
  for (const author of EVAL_AUTHORS) out[author] = await loadCheckContext(conn, { authorId: author, text: "", messageAt: KEMAR_NOTE_AT, transcriptConfidence: null });
  return out;
}
