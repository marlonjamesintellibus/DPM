// M21 (conversational plan, phase D): the options of a question Atlas asked, as its author may read them now
// (CL5, P10). The chat shows only these, a typed answer is read against only these ("the second one" counts
// over what is shown), and an option left out is never named.
import type { Conn } from "../db/conn";
import type { ClarificationRecord, ClarifyOption } from "../domain/machines/clarification";
import { fitsReadBy } from "./answer";
import { projectReader } from "./project";

/**
 * An item's or a line's option is shown while its project is one the author reads. CD50: a question's, while
 * it still fits what the topic that asked would read for them (a project they read or are shown as a client,
 * or a person they share a project with).
 */
export async function optionsShown(conn: Conn, viewerId: string, r: Pick<ClarificationRecord, "about" | "question" | "options">): Promise<ClarifyOption[]> {
  if (r.about === "question" && r.question) {
    const fits = await fitsReadBy(conn, viewerId, r.question.fits);
    return r.options.filter((o) => fits.has(o.id));
  }
  const reader = await projectReader(conn, viewerId);
  return r.options.filter((o) => o.projectId !== null && reader.mayRead(o.projectId));
}
