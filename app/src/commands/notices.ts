// D15: Atlas tells the people who reported a BRAID entry what happened to it ("Alicia approved your
// risk: ..."), in their chat. A notice is not an inbox item: there is nothing to do. Asked for more
// stays an inbox item, because there is (more_info).
import { inArray } from "drizzle-orm";
import type { Tx } from "../db/conn";
import * as t from "../db/schema";
import type { BraidEntryRecord } from "../domain/machines/braid-entry";
import type { BraidKind } from "../domain/rights";
import { withArticle } from "../domain/shared";

export { withArticle };

const KIND: Record<string, string> = { blocker: "blocker", issue: "issue", risk: "risk", assumption: "assumption", dependency: "dependency", decision: "decision" };

export type NoticeAct = { act: "approved"; note?: string } | { act: "declined"; reason: string } | { act: "resolved" } | { act: "switched"; from: BraidKind; why: string };

/** A notice to named people about one subject (section 13: answers to kind change requests). */
export async function notice(
  tx: Tx,
  now: Date,
  to: readonly string[],
  text: string,
  subject: { type: string; id: string; projectId: string | null; act: string },
): Promise<void> {
  const people = [...new Set(to)].sort();
  if (!people.length) return;
  await tx.insert(t.notices).values(
    people.map((personId) => ({ id: `ntc-${subject.id}-${subject.act}-${personId}-${now.getTime()}`, personId, at: now, text, subjectType: subject.type, subjectId: subject.id, projectId: subject.projectId })),
  );
}

/** Everyone who reported the entry, except the person who acted. */
export async function noticeReporters(tx: Tx, now: Date, entry: BraidEntryRecord, actorId: string, what: NoticeAct): Promise<string[]> {
  const to = [...new Set([...(entry.reportedBy ? [entry.reportedBy] : []), ...entry.sources.map((s) => s.personId)])].filter((id) => id !== actorId).sort();
  if (!to.length) return [];
  const [actor] = await tx.select({ name: t.people.name }).from(t.people).where(inArray(t.people.id, [actorId]));
  const who = actor?.name.split(" ")[0] ?? "Someone";
  const kind = KIND[entry.kind];
  const text =
    what.act === "approved"
      ? `${who} approved your ${kind}: ${entry.title}.${what.note?.trim() ? ` Note: ${what.note.trim()}` : ""}`
      : what.act === "declined"
        ? `${who} declined your ${kind}: ${entry.title}. Reason: ${what.reason}`
        : what.act === "switched"
          ? `${who} now logs the ${KIND[what.from]} you reported as ${withArticle(kind)}: ${entry.title}. Why: ${what.why}`
          : `${who} resolved the ${kind} you reported: ${entry.title}.`;
  await tx.insert(t.notices).values(
    to.map((personId) => ({
      id: `ntc-${entry.id}-${what.act}-${personId}-${now.getTime()}`,
      personId,
      at: now,
      text,
      subjectType: "braid_entry",
      subjectId: entry.id,
      projectId: entry.projectId,
    })),
  );
  return to;
}
