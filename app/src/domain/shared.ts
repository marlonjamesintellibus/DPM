// Vocabulary shared by capture (M2 to M4), routing (M14), matching (M16) and the server
// checks on Atlas output (machines doc, section 4). Kept in the core so each part agrees on it.
import type { IsoDate } from "./dates";
import type { ResolveOutcome } from "./machines/braid-entry";
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
/** new_work (section 20, U7): work with no record, proposed to the PM and Leads. */
/** commitment (conversational plan, phase E, M22): the author's own promise, or that one of theirs is done (CM6). */
export type ItemKind = "update" | "braid_new" | "braid_same" | "braid_resolve" | "new_work" | "commitment";

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
  /**
   * For BRAID items. seenState: the matched entry's state when Atlas proposed the match, compared again at save (E83).
   * expectedOn: a new dependency's promised date, read from the quote by the server (section 20, U2).
   * outcome: how a risk, assumption or dependency ended, for a braid_resolve item (section 20, U3).
   * supersedes: the decision a new decision reverses; approving the new one supersedes it (section 20, U4).
   */
  braid?: {
    kind: BraidKind;
    title: string;
    match: MatchState;
    matchEntryId: string | null;
    seenState?: string | null;
    expectedOn?: IsoDate | null;
    outcome?: ResolveOutcome;
    supersedes?: string;
  };
  /**
   * Leave items (D6): it matches live leave, changes it, or is a new request. back (phase P, LV6): they said they are
   * back early, so the value is the leave they are on with its new, earlier end.
   */
  leave?: { fit: "matches" | "change" | "new"; leaveId: string | null; requested: boolean; back?: true };
  /**
   * Phase L, CD14: the word that decided the project, when it was a name (reference) or a person tied to it
   * (tied_person) and check 14 confirmed it. Moving items routed by the same word twice proposes a correction.
   */
  routedBy?: { basis: "reference" | "tied_person"; word: string; personId: string | null };
  /** Section 16: the earlier unsaved item this one corrects; it is withdrawn as replaced when this one is proposed. */
  replaces?: string;
  /** Section 20, U5: the record is someone else's; saving asks its owner (M37) instead of changing it. */
  ask?: { ownerId: string };
  /** Section 20, U7: work with no record, proposed to the PM and Leads (M37), owned by the author. */
  newWork?: { title: string; state: NewWorkState };
  /**
   * Phase D: an update whose words fit two or more of the author's records ("Worked on the feed" when #151
   * and #152 both fit). ids: every record they could mean, each one the checks accept, the target first.
   * chosen: where the author said which (M21 in the chat, or the review); until then it needs their OK.
   */
  closeMatches?: { ids: string[]; chosen: "chat" | "review" | null };
  /** Phase E, M22: the author's own promise (act promise), or that a live one of theirs is done (act done, CM6). */
  commitment?: CommitmentDraft;
  /**
   * Phase O, a meeting note only: who made the promise, an attendee or the recorder, and whether Atlas was sure
   * (MT2). personId is null when Atlas could not say. Someone else's promise is never the recorder's (CD5): it
   * goes to them to confirm (M34), or is a dependency in the recorder's review (MT1).
   */
  speaker?: { personId: string | null; sure: boolean };
};

/**
 * Phase E. A promise is private to its author (CD3), so its item is personal ("You"), whatever it names.
 * dueOn: the day it is due by, read by the server; the item's value, which the author corrects on the card (CM2).
 * dueFrom: said (the words name a day), vague ("next week", read as a day, CM2) or none (CD4: the next working day).
 * Phase P, LV10: leave, a live promise due while the author is away, moved by DPM to their first working day back.
 * link: the record or BRAID entry the words name, one the author can open (CM9); label as the card shows it.
 * commitmentId: CM5, the live commitment the same promise matches (its date moves); CM6, the one said to be done.
 */
export type CommitmentDraft = {
  act: "promise" | "done";
  what: string;
  dueOn: IsoDate | null;
  dueFrom: "said" | "vague" | "none" | "leave" | null;
  dueWords: string | null;
  link: { type: "work_item" | "milestone" | "braid_entry"; id: string; projectId: string; label: string } | null;
  commitmentId: string | null;
  /** The matched commitment's due date when Atlas read it, so the card says what moves. */
  seenDue: IsoDate | null;
};

/** The states new work may start in: what the author said they are doing. */
export const NEW_WORK_STATES = ["to_do", "in_progress"] as const;
export type NewWorkState = (typeof NEW_WORK_STATES)[number];

/** "a risk", "an issue". */
export function withArticle(kind: string): string {
  return /^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`;
}
