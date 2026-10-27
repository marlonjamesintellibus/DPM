// Vocabulary shared by capture (M2 to M4), routing (M14), matching (M16) and the server
// checks on Atlas output (machines doc, section 4). Kept in the core so each part agrees on it.
import type { BraidKind } from "./rights";

export const CONFIDENCES = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** The lower of two confidences. Rules lower confidence and never raise it (check 4, NoAutoAcceptBelowHigh). */
export function lowerTo(confidence: Confidence, cap: Confidence): Confidence {
  return CONFIDENCE_RANK[confidence] <= CONFIDENCE_RANK[cap] ? confidence : cap;
}

/** update: changes a record. braid_new: proposes a new BRAID entry. braid_same: adds a source to an existing one. */
/** braid_resolve (D7, E93): "Kyle sent the feed" resolves a blocker or issue, or proposes it to those who may. */
export type ItemKind = "update" | "braid_new" | "braid_same" | "braid_resolve";

/** M14. routed: filed in a project (or personal). choose_project: two or more fit. not_filed: none fits; stays private. */
export type RoutingState = "routed" | "choose_project" | "not_filed";

/** M16, for BRAID items. same_as merges into an entry of the same kind; related_to only links across kinds. */
export type MatchState = "new" | "same_as" | "related_to";

/** How an item starts on the review page (server check 8). */
export type Mark = "no_change" | "matches_leave" | "pre_accepted" | "needs_ok";

export type TargetType = "work_item" | "milestone" | "handover" | "leave";

/** A character range in the capture text: [start, end). Captures are never edited, so spans stay valid. */
export type SourceSpan = { start: number; end: number };

/** What the server checks produce from one Atlas proposal. The capture machine (M3) takes it from here. */
export type ExtractedItemDraft = {
  ordinal: number;
  kind: ItemKind;
  /** project: filed in projectId. personal: the author's own records, such as leave ("You"). */
  scope: "project" | "personal";
  projectId: string | null;
  routing: RoutingState;
  /** Why Atlas filed it there, shown on the card ("#151", "you said 'On Store Insights'"). */
  routingReason: string;
  /** For choose_project: the candidate projects the author can pick from (E71). */
  options?: string[];
  /** One or more quotes; one quote may feed several items, in one project or several. */
  spans: SourceSpan[];
  confidence: Confidence;
  mark: Mark;
  rationale: string;
  /** For update items. oldValue always comes from the database, never from the model (check 7). */
  target?: { type: TargetType; id: string; field: string; oldValue: string | null; newValue: string; note?: string };
  /** For BRAID items. seenState: the matched entry's state when Atlas proposed the match, compared again at save (E83). */
  braid?: { kind: BraidKind; title: string; match: MatchState; matchEntryId: string | null; seenState?: string | null };
  /** Leave items (D6): it matches live leave, changes it, or is a new request. */
  leave?: { fit: "matches" | "change" | "new"; leaveId: string | null; requested: boolean };
  /** Section 16: the earlier unsaved item this one corrects; it is withdrawn as replaced when this one is proposed. */
  replaces?: string;
};

/** "a risk", "an issue". */
export function withArticle(kind: string): string {
  return /^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`;
}
