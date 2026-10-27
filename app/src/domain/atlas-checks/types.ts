// Shapes for the server checks on Atlas output (machines doc, section 4). A RawProposal is what
// the model returns through its tool call (build plan 5.1 step 3), untrusted. A CheckContext is
// what the caller reads from the database for the author: only projects they can file into.
import type { IsoDate } from "../dates";
import type { LeaveState } from "../machines/leave";
import type { BraidKind, ProjectRole } from "../rights";
import type { Confidence, ExtractedItemDraft, ItemKind, TargetType } from "../shared";

/**
 * Why Atlas filed a proposal in its project. `basis` names the kind of evidence so check 14 can
 * test it against the text and the candidate data (M14, strongest first: an explicit reference,
 * a record the author owns, a person tied to one project).
 */
export type RawRoutingReason = {
  /**
   * target: the record or BRAID entry itself is in the project ("#145").
   * reference: words in the message name the project or one of its records ("On Store Insights").
   * owned_record: the target is the author's own record ("Kemar owns it").
   * tied_person: a person named in the quote is tied to the project ("Kyle is the contact on #151").
   * same_quote: another item from the same words is filed there ("Same quote as #4").
   * personal: the author's own leave ("You").
   * ambiguous: the model saw more than one project fit (E71).
   */
  basis: "target" | "reference" | "owned_record" | "tied_person" | "same_quote" | "personal" | "ambiguous";
  /** The words that prove it: "#151", "Store Insights", "Kyle". */
  evidence: string;
  /** What the card says: "Kyle is the contact on #151". */
  label: string;
};

export type RawProposal = {
  kind: ItemKind;
  /** The project Atlas chose; null for personal items or when none fits. */
  projectId: string | null;
  routingReason: RawRoutingReason;
  /** update: the record to change (a candidate record id, or the author's leave target). */
  targetId?: string | null;
  field?: string | null;
  newValue?: string | null;
  /** Ignored: the old value is always read from the database (check 7). */
  oldValue?: string | null;
  /** braid_new and braid_same: the BRAID kind as the model gave it. */
  braidKind?: string | null;
  /** braid_new: a short title for the new entry. */
  braidTitle?: string | null;
  /** braid_same: the entry this report joins. braid_new: an entry of another kind it relates to. */
  matchEntryId?: string | null;
  /** Ignored: a capture only ever reports or adds a source; the state is never the model's (check 12). */
  braidState?: string | null;
  /** update to state "blocked": what the work waits on ("waiting on Kyle (Sprouts IT)"). */
  note?: string | null;
  /** routing basis "ambiguous": the projects the model thinks it could be (filtered to candidates). */
  options?: readonly string[] | null;
  /** The exact words, found in the capture text by check 2. */
  quote: string;
  confidence: Confidence;
  rationale: string;
};

/** A record the author may update from a message, with its current values as stored. */
export type CandidateRecord = {
  type: Exclude<TargetType, "leave">;
  id: string;
  /** Work items: the issue number, "#151". */
  number?: string;
  title: string;
  /** Work items and milestones: the owner. Handovers: the person handing over. */
  ownerId: string | null;
  /** Current values by field: state, blocked_note, forecast, target. */
  values: Record<string, string | null>;
};

/** Someone tied to a project: members with their role, and outside contacts ("contact on #151"). */
export type ProjectPerson = { personId: string; name: string; role: ProjectRole | null; tie: string };

/** An entry on a project's BRAID log that a new report can match (M16 candidates). */
export type OpenBraidEntry = { id: string; kind: BraidKind; title: string; state: string };

/** A project the author can file into: member, connected to DPM by the group owner, same org tag (M13). */
export type CandidateProject = {
  id: string;
  name: string;
  /** Other names people use for it ("Forager", "Sprouts Store Insights"). */
  aliases: readonly string[];
  /** The author's role in this project. */
  role: ProjectRole;
  records: readonly CandidateRecord[];
  people: readonly ProjectPerson[];
  braid: readonly OpenBraidEntry[];
};

/** The author's live leave, requested or approved, with any change waiting (D6). Dates only. */
export type ExistingLeave = { id: string; start: IsoDate; end: IsoDate; state: LeaveState; change?: { start: IsoDate; end: IsoDate } | null };

export type CheckContext = {
  /** The capture text, stored as received and never edited. */
  text: string;
  /** When the author spoke (M1), not when Atlas read it. Dates resolve in config.timeZone. */
  messageAt: Date;
  /** Voice only: how sure the transcriber was. Low lowers every item to at most Medium (E5). */
  transcriptConfidence: Confidence | null;
  author: { id: string; name: string };
  /** Already filtered for membership, connection and org; check 9 only tests membership in this list. */
  projects: readonly CandidateProject[];
  /** The author's projects whose group is not connected to DPM. Safe to name to the author (E75). */
  notConnected: readonly { id: string; name: string }[];
  /** The author's leave target ("Leave Kemar Brown") and their approved leave (M8). */
  leave: { targetId: string; existing: readonly ExistingLeave[] };
};

export const CHECK_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
/** The machines doc check that dropped a proposal, or "cap" for proposals past the S8 limit. */
export type CheckId = (typeof CHECK_IDS)[number] | "cap";

/** Logged with its reason so the model can be measured (phase 4 evaluation). */
export type DroppedProposal = { proposal: RawProposal; check: CheckId; reason: string };

export type CheckResult = { items: ExtractedItemDraft[]; dropped: DroppedProposal[] };

export type CheckOptions = {
  /** The rights table's report column (rights.ts by default); passed in because rights are data. */
  mayReport?: (role: ProjectRole, kind: BraidKind) => boolean;
};
