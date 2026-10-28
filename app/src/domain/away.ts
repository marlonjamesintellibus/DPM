// Phase P (conversational plan, section 18): what a person's leave means for their own work, as days. What is due
// while away (LV1, LV3), the first working day back, and LV10: a promise of theirs due while away is proposed to move
// to that day, with their OK in the review of the same message. Pure: the checks and the queries call it.
import { addWorkingDays, daysBetween, isIsoDate, type IsoDate } from "./dates";
import type { CheckContext } from "./atlas-checks/types";
import type { ExtractedItemDraft } from "./shared";

export type AwayRange = { start: IsoDate; end: IsoDate };

/** The day falls on or between the leave's first and last day. */
export function whileAway(day: IsoDate | null, range: AwayRange): boolean {
  return !!day && daysBetween(range.start, day) >= 0 && daysBetween(day, range.end) >= 0;
}

/** LV10, CM7: the first working day after the leave ends (Friday 30 Oct is Monday 2 Nov). */
export function firstDayBack(range: AwayRange): IsoDate {
  return addWorkingDays(range.end, 1);
}

/** A leave item's dates as the checks stored them ("2026-10-26/2026-10-30"), or null for an open end. */
export function leaveRangeOf(draft: ExtractedItemDraft): AwayRange | null {
  if (draft.target?.type !== "leave" || !draft.leave) return null;
  const [start, end] = draft.target.newValue.split("/");
  return isIsoDate(start) && isIsoDate(end ?? "") ? { start, end } : null;
}

/**
 * LV10: for each leave in a message, each live promise of the author's due while away, and not already in the
 * message, becomes a commitment item that moves it to the first working day back (CM5's same promise with a new
 * day). It needs the author's OK: DPM proposes it, nobody said the day. It quotes the leave's own words.
 */
export function leaveMoves(drafts: readonly ExtractedItemDraft[], ctx: Pick<CheckContext, "commitments">): ExtractedItemDraft[] {
  const moved = new Set(drafts.flatMap((d) => (d.commitment?.commitmentId ? [d.commitment.commitmentId] : [])));
  const out: ExtractedItemDraft[] = [];
  for (const leave of drafts) {
    const range = leaveRangeOf(leave);
    // LV6: back early moves no promise; the days left are working days again
    if (!range || leave.leave?.back) continue;
    const back = firstDayBack(range);
    for (const c of ctx.commitments ?? []) {
      if (moved.has(c.id) || !whileAway(c.dueOn, range)) continue;
      moved.add(c.id);
      out.push({
        ordinal: drafts.length + out.length + 1,
        kind: "commitment",
        scope: "personal",
        projectId: null,
        routing: "routed",
        routingReason: "Only you see your promises",
        spans: leave.spans,
        confidence: "high",
        mark: "needs_ok",
        rationale: "It is due while you're away, so DPM proposes your first working day back.",
        commitment: { act: "promise", what: c.what, dueOn: back, dueFrom: "leave", dueWords: null, link: null, commitmentId: c.id, seenDue: c.dueOn },
      });
    }
  }
  return out;
}
