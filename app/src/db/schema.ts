// The use case 1 schema (build-plan.md, section 4). Columns mirror the domain records in
// src/domain, so commands store what the machines return without translating it.
// Rules kept in the shape of the data:
// - Calculated statuses are never stored (P6). Only a project's set status is.
// - Leave has no reason column at all (A5.2): what someone says about why stays out.
// - Inbox items store their cause, not their text; titles are worked out when read (M10).
// - Every row a machine moves has a version, for "a stale version means reload, never overwrite".
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { BraidAnswer, BraidEntryState, BraidLinkRelation, ProposedOutcome, ResolveOutcome } from "../domain/machines/braid-entry";
import type { CaptureState } from "../domain/machines/capture";
import type { ChatCommandState, CommandAbout, CommandAct, CommandInput, CommandProposal, RefusedWhy, WordAct } from "../domain/machines/chat-command";
import type { ClarificationState, ClarifyAbout, ClarifyOption, EndedBy } from "../domain/machines/clarification";
import type { DraftBy, DraftState } from "../domain/machines/draft";
import type { DraftFacts, DraftKind } from "../domain/drafts";
import type { ItemState, WithdrawReason } from "../domain/machines/extracted-item";
import type { HandoverState } from "../domain/machines/handover";
import type { InboxItemState } from "../domain/machines/inbox-item";
import type { ConversationState } from "../domain/machines/conversation";
import type { EvalCandidateDetail, EvalCandidateState, EvalCause } from "../domain/machines/eval-candidate";
import type { KindRequestState } from "../domain/machines/kind-request";
import type { OwnerAskKind, OwnerAskState } from "../domain/machines/owner-ask";
import type { EarlierDismissal, SignalMemory, SignalStage, SignalState } from "../domain/machines/signal";
import type { SignalFacts, SignalRule, SignalSubjectType } from "../domain/signals";
import type { Answer, AskedQuestion } from "../domain/question";
import type { LeaveState } from "../domain/machines/leave";
import type { MembershipState } from "../domain/machines/membership";
import type { OverrideState } from "../domain/machines/set-status";
import type { StandupEnd, StandupQuestion, StandupState, StandupStep } from "../domain/machines/standup";
import type { BraidKind, ProjectRole } from "../domain/rights";
import type { Confidence, ExtractedItemDraft, ItemKind, RoutingState } from "../domain/shared";
import type { SettableStatus } from "../domain/status/status";
import type { UndoRefusal, UndoState } from "../domain/machines/undo";
import type { VocabularyKind, VocabularyState } from "../domain/machines/vocabulary-change";
import type { MilestoneState, WorkItemState } from "../domain/status/rules";

const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const version = () => integer("version").notNull().default(1);
const day = (name: string) => date(name, { mode: "string" }); // "YYYY-MM-DD", the domain's IsoDate
const instant = (name: string) => timestamp(name, { withTimezone: true });

// Phase 0: proves migrations run
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- Organisations, people, groups (meeting D2: Atlas owns groups; a group is tagged to an org) ----

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull(),
  createdAt: created(),
  updatedAt: updated(),
});

export const people = pgTable("people", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  initials: text("initials").notNull(),
  title: text("title"),
  /** The org-level lens (KB A7.2); project rights come from project_memberships. Null for outside contacts. */
  orgRole: text("org_role").$type<"executive" | "delivery_lead" | "employee" | "care_team">(),
  /** Phase S: "Help improve Atlas", off until they turn it on. Only then are their words kept as eval candidates (LF1). */
  helpImproveAtlas: boolean("help_improve_atlas").notNull().default(false),
  createdAt: created(),
  updatedAt: updated(),
});

export const groups = pgTable("groups", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  kind: text("kind").$type<"project" | "team" | "personal">().notNull(),
  ownerId: text("owner_id").notNull().references(() => people.id),
  /** The group owner authorized DPM to read it (M13). Nothing is read from a group without this. */
  connectedToDpm: boolean("connected_to_dpm").notNull().default(false),
  atlasGroupRef: text("atlas_group_ref"),
  createdAt: created(),
  updatedAt: updated(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: text("group_id").notNull().references(() => groups.id),
    personId: text("person_id").notNull().references(() => people.id),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.personId] })],
);

// ---- Projects ----

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().unique().references(() => groups.id),
  name: text("name").notNull(),
  /** Other names people use for it, for routing ("Forager", "Sprouts Store Insights"). */
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
  customer: text("customer"),
  ownerId: text("owner_id").notNull().references(() => people.id),
  contractType: text("contract_type").$type<"fixed_price" | "time_and_material" | "internal">(),
  startDate: day("start_date"),
  endDate: day("end_date"),
  // M9, the only stored status (A4.3)
  setOverride: text("set_override").$type<OverrideState>().notNull().default("calculated_only"),
  setStatus: text("set_status").$type<SettableStatus>(),
  reasonGivenAt: text("reason_given_at"),
  setBy: text("set_by").references(() => people.id),
  setAt: instant("set_at"),
  /** D16, S11: approvals a decision needs on this project (1 or 2), set by its PM. */
  decisionApprovers: integer("decision_approvers").notNull().default(1),
  /** Phase K, CD13: marked paused (or between phases) by its PM, so no quiet-project signal is raised. */
  paused: boolean("paused").notNull().default(false),
  version: version(),
  createdAt: created(),
  updatedAt: updated(),
});

export const projectMemberships = pgTable(
  "project_memberships",
  {
    projectId: text("project_id").notNull().references(() => projects.id),
    personId: text("person_id").notNull().references(() => people.id),
    state: text("state").$type<MembershipState>().notNull(),
    role: text("role").$type<ProjectRole>().notNull(),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.personId] })],
);

/** People tied to a project who are not members, such as a customer's contact (Kyle at Sprouts IT). Used for routing. */
export const projectContacts = pgTable(
  "project_contacts",
  {
    projectId: text("project_id").notNull().references(() => projects.id),
    personId: text("person_id").notNull().references(() => people.id),
    tie: text("tie").notNull(),
    /** KB A7.3: an outside contact reads the project's client view only when it is on for them. Off for a tie made by routing. */
    clientView: boolean("client_view").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.personId] })],
);

export const threads = pgTable("threads", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  description: text("description"),
  position: integer("position").notNull(),
});

export const milestones = pgTable("milestones", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  threadId: text("thread_id").references(() => threads.id),
  name: text("name").notNull(),
  ownerId: text("owner_id").notNull().references(() => people.id),
  state: text("state").$type<MilestoneState>().notNull(),
  targetDate: day("target_date").notNull(),
  /** Null means the forecast is the target. */
  forecastDate: day("forecast_date"),
  /** A release: shown in the client view. */
  clientVisible: boolean("client_visible").notNull().default(false),
  version: version(),
  createdAt: created(),
  updatedAt: updated(),
});

export const workItems = pgTable(
  "work_items",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    threadId: text("thread_id").references(() => threads.id),
    milestoneId: text("milestone_id").references(() => milestones.id),
    number: text("number"),
    title: text("title").notNull(),
    ownerId: text("owner_id").notNull().references(() => people.id),
    state: text("state").$type<WorkItemState>().notNull(),
    /** When the work is planned to start; with dueDate it draws the plan's bar (L14). */
    startDate: day("start_date"),
    dueDate: day("due_date"),
    /** Section 20, U6: when its owner now expects it done; Done clears it. */
    forecastDate: day("forecast_date"),
    blockedNote: text("blocked_note"),
    blockedLinks: text("blocked_links").array().notNull().default(sql`'{}'::text[]`),
    /** The PR or document that finished it (A10.1: Done with no linked change is an error). */
    linkedChange: text("linked_change"),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("work_items_project_number").on(t.projectId, t.number)],
);

/** M7. A handover's "k of m" is the count of its steps that are handed over. */
export const handovers = pgTable("handovers", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  fromPersonId: text("from_person_id").notNull().references(() => people.id),
  toPersonId: text("to_person_id").notNull().references(() => people.id),
  title: text("title").notNull(),
  state: text("state").$type<HandoverState>().notNull(),
  version: version(),
  createdAt: created(),
  updatedAt: updated(),
});

/** One step of a handover ("Runbook"). Extracted updates target a step (target type "handover"). */
export const handoverSteps = pgTable("handover_steps", {
  id: text("id").primaryKey(),
  handoverId: text("handover_id").notNull().references(() => handovers.id),
  title: text("title").notNull(),
  state: text("state").$type<"not_done" | "in_progress" | "handed_over">().notNull(),
  position: integer("position").notNull(),
  version: version(),
  updatedAt: updated(),
});

/** C9. Dates and state only: there is deliberately no reason column (A5.2, E17). */
export const leave = pgTable("leave", {
  id: text("id").primaryKey(),
  personId: text("person_id").notNull().references(() => people.id),
  startDate: day("start_date").notNull(),
  endDate: day("end_date").notNull(),
  state: text("state").$type<LeaveState>().notNull(),
  /** D6: new dates asked for on approved leave; the approved dates stand until an admin decides. */
  changeStart: day("change_start"),
  changeEnd: day("change_end"),
  decidedBy: text("decided_by").references(() => people.id),
  version: version(),
  createdAt: created(),
  updatedAt: updated(),
});

// ---- BRAID log (M15, M16) ----

export const braidEntries = pgTable(
  "braid_entries",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    kind: text("kind").$type<BraidKind>().notNull(),
    title: text("title").notNull(),
    state: text("state").$type<BraidEntryState>().notNull(),
    ownerId: text("owner_id").references(() => people.id),
    reportedBy: text("reported_by").references(() => people.id),
    round: integer("round").notNull().default(1),
    proposedOn: day("proposed_on"),
    remindersSent: integer("reminders_sent").notNull().default(0),
    lastRemindedOn: day("last_reminded_on"),
    decidedBy: text("decided_by").references(() => people.id),
    decidedOn: day("decided_on"),
    selfApproved: boolean("self_approved").notNull().default(false),
    resolvedBy: text("resolved_by").references(() => people.id),
    resolvedOn: day("resolved_on"),
    resolveProposedBy: text("resolve_proposed_by").references(() => people.id),
    newAlert: boolean("new_alert").notNull().default(false),
    mergedInto: text("merged_into"),
    stateBeforeMerge: text("state_before_merge").$type<BraidEntryState>(),
    /** D9: a PM merged an open duplicate in and chose to keep this entry resolved. */
    keptOnMerge: boolean("kept_on_merge").notNull().default(false),
    /** Section 13: who changed the kind, when and why, and the state before, for switching back. */
    switchedBy: text("switched_by").references(() => people.id),
    switchedOn: day("switched_on"),
    switchReason: text("switch_reason"),
    stateBeforeSwitch: text("state_before_switch").$type<BraidEntryState>(),
    /** Section 20, U2: the day someone promised what a dependency waits on. */
    expectedOn: day("expected_on"),
    /** Section 20, U3: who said it ended, and how, waiting for a PM or Lead. */
    outcomesProposed: jsonb("outcomes_proposed").$type<ProposedOutcome[]>().notNull().default([]),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("braid_entries_project").on(t.projectId, t.kind)],
);

/**
 * Who said it, where and when. entryId is the entry holding the source now; originEntryId is the
 * entry it was first reported on, so an unmerge gives it back (M16: sources move, never copy).
 */
export const braidSources = pgTable(
  "braid_sources",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id").notNull().references(() => braidEntries.id),
    originEntryId: text("origin_entry_id").notNull().references(() => braidEntries.id),
    personId: text("person_id").notNull().references(() => people.id),
    captureId: text("capture_id").references(() => captures.id),
    extractionId: text("extraction_id"),
    spanStart: integer("span_start"),
    spanEnd: integer("span_end"),
    at: instant("at").notNull(),
    /** D11: the person took this report back. Kept for the history, never shown on the entry. */
    withdrawnAt: instant("withdrawn_at"),
    /** Phase K, M29: a PM or Lead accepted this signal into the entry; the signal's facts are what the source says. */
    signalId: text("signal_id"),
  },
  (t) => [index("braid_sources_entry").on(t.entryId)],
);

export const braidLinks = pgTable(
  "braid_links",
  {
    entryId: text("entry_id").notNull().references(() => braidEntries.id),
    otherEntryId: text("other_entry_id").notNull().references(() => braidEntries.id),
    relation: text("relation").$type<BraidLinkRelation>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.otherEntryId, t.relation] })],
);

/** Every approve, decline, request for more and reply, kept for good (E85, E90). */
export const braidAnswers = pgTable("braid_answers", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  entryId: text("entry_id").notNull().references(() => braidEntries.id),
  by: text("by").notNull().references(() => people.id),
  act: text("act").$type<BraidAnswer["act"]>().notNull(),
  note: text("note"),
  round: integer("round").notNull(),
  on: day("on").notNull(),
});

/** M17. A member asks a PM or Lead to change an entry's kind (section 13). One waits per entry at a time. */
export const braidKindRequests = pgTable(
  "braid_kind_requests",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    entryId: text("entry_id").notNull().references(() => braidEntries.id),
    state: text("state").$type<KindRequestState>().notNull(),
    askedBy: text("asked_by").references(() => people.id),
    toKind: text("to_kind").$type<BraidKind>().notNull(),
    why: text("why").notNull(),
    askedOn: day("asked_on"),
    answeredBy: text("answered_by").references(() => people.id),
    answeredOn: day("answered_on"),
    keepReason: text("keep_reason"),
    remindersSent: integer("reminders_sent").notNull().default(0),
    lastRemindedOn: day("last_reminded_on"),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("braid_kind_requests_entry").on(t.entryId, t.state)],
);

// ---- Status reasons (M9) ----

export const statusReasons = pgTable("status_reasons", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  text: text("text").notNull(),
  draftedByAtlas: boolean("drafted_by_atlas").notNull().default(false),
  edited: boolean("edited").notNull().default(false),
  savedBy: text("saved_by").notNull().references(() => people.id),
  savedAt: instant("saved_at").notNull(),
  /** Set when the plan moved under the reason (reason_stale). */
  staleSince: instant("stale_since"),
  /**
   * Phase G: its PM marked this reason, and the status it explains, as shareable with the client, so a client
   * status may hold them (section 9). A new reason starts unshared.
   */
  clientShareable: boolean("client_shareable").notNull().default(false),
});

export const statusReasonLinks = pgTable(
  "status_reason_links",
  {
    reasonId: text("reason_id").notNull().references(() => statusReasons.id),
    braidEntryId: text("braid_entry_id").notNull().references(() => braidEntries.id),
  },
  (t) => [primaryKey({ columns: [t.reasonId, t.braidEntryId] })],
);

// ---- Captures and extracted items (M1 to M4) ----

/** M1: never edited. Its text belongs to the author; projects only see the spans routed to them. */
/** M18. A person's conversation with Atlas: it groups their captures and is private to them (section 16). */
export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => people.id),
    state: text("state").$type<ConversationState>().notNull(),
    title: text("title").notNull(),
    titleBy: text("title_by").$type<"auto" | "person">().notNull().default("auto"),
    channel: text("channel").$type<"atlas" | "app">().notNull(),
    /** The Atlas chat it mirrors ("dm" for the app's direct chat); null for one started in DPM. */
    atlasChatId: text("atlas_chat_id"),
    lastMessageAt: instant("last_message_at").notNull(),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("conversations_owner").on(t.ownerId, t.state, t.lastMessageAt)],
);

export const captures = pgTable("captures", {
  id: text("id").primaryKey(),
  authorId: text("author_id").notNull().references(() => people.id),
  /** Section 16: the conversation it was sent in. */
  conversationId: text("conversation_id").references(() => conversations.id),
  /** atlas: the Atlas messaging app, which always sends a message id. app: DPM's own chat. */
  channel: text("channel").$type<"atlas" | "app">().notNull(),
  kind: text("kind").$type<"text" | "voice">().notNull(),
  text: text("text").notNull(),
  durationSeconds: integer("duration_seconds"),
  /** When it was said: "yesterday" and "Monday" are read against this, not received_at. */
  messageAt: instant("message_at").notNull(),
  receivedAt: instant("received_at").notNull(),
  dedupKey: text("dedup_key").notNull().unique(),
  // M2
  state: text("state").$type<CaptureState>().notNull(),
  tries: integer("tries").notNull().default(0),
  proposals: integer("proposals").notNull().default(0),
  moreFound: boolean("more_found").notNull().default(false),
  reminded: boolean("reminded").notNull().default(false),
  transcriptConfidence: text("transcript_confidence").$type<Confidence>(),
  failedStep: text("failed_step").$type<"transcribe" | "read">(),
  /** Section 15: what it asked, after the checks, and DPM's answer as given then. */
  question: jsonb("question").$type<AskedQuestion>(),
  answer: jsonb("answer").$type<Answer>(),
  /** Phase B: what Atlas said when a reply decided something but made no card (AC6, AC7, AC9), as said then. */
  commandNote: text("command_note"),
  version: version(),
  createdAt: created(),
  updatedAt: updated(),
});

/** M3. The draft is what the server checks produced; the rest is the item's machine state. */
export const extractions = pgTable(
  "extractions",
  {
    id: text("id").primaryKey(),
    captureId: text("capture_id").notNull().references(() => captures.id),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").$type<ItemKind>().notNull(),
    scope: text("scope").$type<"project" | "personal">().notNull(),
    projectId: text("project_id").references(() => projects.id),
    routing: text("routing").$type<RoutingState>().notNull(),
    draft: jsonb("draft").$type<ExtractedItemDraft>().notNull(),
    state: text("state").$type<ItemState>().notNull(),
    confidence: text("confidence").$type<Confidence>().notNull(),
    value: text("value"),
    saw: text("saw"),
    conflict: jsonb("conflict").$type<{ current: string | null; reason: string | null; refused?: boolean }>(),
    withdrawn: text("withdrawn").$type<WithdrawReason>(),
    touched: boolean("touched").notNull().default(false),
    appliedAt: instant("applied_at"),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("extractions_capture_ordinal").on(t.captureId, t.ordinal), index("extractions_project").on(t.projectId)],
);

// ---- Learning from use (phase S) ----

/**
 * A thumbs up or down on an answer, with "What was wrong?" (conversational plan, section 21). One per
 * person per answer, which they can change; tied to the answer's "as of", however late it is given (LF6).
 * Only the asker sees an answer, so only they give feedback on it.
 */
export const answerFeedback = pgTable(
  "answer_feedback",
  {
    captureId: text("capture_id").notNull().references(() => captures.id),
    personId: text("person_id").notNull().references(() => people.id),
    rating: text("rating").$type<"up" | "down">().notNull(),
    /** Their words; kept with their answer, never shown to anyone else. */
    wrong: text("wrong"),
    topic: text("topic").notNull(),
    answerAsOf: instant("answer_as_of").notNull(),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [primaryKey({ columns: [t.captureId, t.personId] })],
);

/**
 * M20. A command taken from an answer line in the chat (conversational plan, phase B): a button confirmed
 * in the same tap, or a reply in words confirmed on a card. done ran the screen's own command, whose audit
 * entries carry capture_id, so the trail shows it came from the chat.
 */
export const chatCommands = pgTable(
  "chat_commands",
  {
    id: text("id").primaryKey(),
    askerId: text("asker_id").notNull().references(() => people.id),
    via: text("via").$type<"tap" | "words">().notNull(),
    captureId: text("capture_id").notNull().references(() => captures.id),
    answerCaptureId: text("answer_capture_id").notNull().references(() => captures.id),
    line: integer("line").notNull(),
    act: text("act").$type<CommandAct>().notNull(),
    subjectType: text("subject_type").$type<"braid_entry" | "work_item" | "project">().notNull(),
    subjectId: text("subject_id").notNull(),
    projectId: text("project_id").notNull().references(() => projects.id),
    proposal: text("proposal").$type<CommandProposal>(),
    outcome: text("outcome").$type<ResolveOutcome>(),
    about: jsonb("about").$type<CommandAbout>().notNull(),
    seenVersion: integer("seen_version").notNull(),
    input: jsonb("input").$type<CommandInput>(),
    state: text("state").$type<ChatCommandState>().notNull(),
    refusedWhy: text("refused_why").$type<RefusedWhy>(),
    refusal: text("refusal"),
    decidedAt: instant("decided_at"),
    /** Once only (rule 6, AC4): "tap:<answer>:<line>:<act>" or "words:<reply>:<line>:<act>". */
    dedupKey: text("dedup_key").notNull().unique(),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("chat_commands_answer").on(t.answerCaptureId), index("chat_commands_capture").on(t.captureId), index("chat_commands_open").on(t.state)],
);

/**
 * M21. A question Atlas asks in the author's own chat when it is unsure which project, record or line a
 * message means (conversational plan, phase D). At most one per capture; its options are as the author
 * could read them when it was asked, and each is checked again when chosen (CL5).
 */
export const clarifications = pgTable(
  "clarifications",
  {
    id: text("id").primaryKey(),
    /** The message it asks about; unique, so a read delivered twice asks once (rule 6). */
    captureId: text("capture_id").notNull().unique().references(() => captures.id),
    authorId: text("author_id").notNull().references(() => people.id),
    /** Where a typed answer may come from: the newest open question in this conversation (CL4). */
    conversationId: text("conversation_id").references(() => conversations.id),
    about: text("about").$type<ClarifyAbout>().notNull(),
    extractionId: text("extraction_id").references(() => extractions.id),
    answerCaptureId: text("answer_capture_id").references(() => captures.id),
    act: text("act").$type<WordAct>(),
    reason: text("reason"),
    quote: text("quote").notNull(),
    options: jsonb("options").$type<ClarifyOption[]>().notNull(),
    state: text("state").$type<ClarificationState>().notNull(),
    chosen: text("chosen"),
    /** A typed answer's message (CL2). */
    answeredBy: text("answered_by").references(() => captures.id),
    endedBy: text("ended_by").$type<EndedBy>(),
    decidedAt: instant("decided_at"),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("clarifications_open").on(t.state, t.conversationId), index("clarifications_answered_by").on(t.answeredBy)],
);

/**
 * M28. A person's standup for one day (conversational plan, phase J): the questions asked and what they said,
 * the one waiting, and the capture its answers became. One per person per day (SU10).
 */
export const standups = pgTable(
  "standups",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull().references(() => people.id),
    day: day("day").notNull(),
    /** Where it asks: a typed reply in this conversation is its answer. */
    conversationId: text("conversation_id").references(() => conversations.id),
    /** The message that started it ("Start my standup"). */
    startedBy: text("started_by").references(() => captures.id),
    state: text("state").$type<StandupState>().notNull(),
    steps: jsonb("steps").$type<StandupStep[]>().notNull(),
    current: jsonb("current").$type<StandupQuestion>(),
    /** The idle timer counts from here (SU7). */
    askedAt: instant("asked_at"),
    /** The message the chat shows it under now: the one that started it, or the latest typed reply. */
    shownIn: text("shown_in").references(() => captures.id),
    endedBy: text("ended_by").$type<StandupEnd>(),
    /** The message its answers became (composed). */
    captureId: text("capture_id").references(() => captures.id),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("standups_person_day").on(t.personId, t.day), index("standups_open").on(t.state, t.conversationId), index("standups_capture").on(t.captureId)],
);

/**
 * M25. A draft Atlas wrote for its asker from DPM's facts (conversational plan, phase G): a standup, a client
 * status or a weekly summary. Once only by draft id, one per message that asked (rule 6, DR8). The facts are
 * the ones read for the asker when the request (or Refresh) ran, never quotes (CD8).
 */
export const drafts = pgTable(
  "drafts",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => people.id),
    kind: text("kind").$type<DraftKind>().notNull(),
    projectId: text("project_id").references(() => projects.id),
    /** The message that asked for it; unique, so a read delivered twice drafts once. */
    captureId: text("capture_id").notNull().unique().references(() => captures.id),
    state: text("state").$type<DraftState>().notNull(),
    attempt: integer("attempt").notNull(),
    /** The model timer counts from here. */
    attemptAt: instant("attempt_at"),
    facts: jsonb("facts").$type<DraftFacts>().notNull(),
    text: text("text"),
    by: text("by").$type<DraftBy>(),
    edited: boolean("edited").notNull().default(false),
    /** DR5: what they had written when they refreshed. */
    aside: text("aside"),
    /** The expiry timer counts from here. */
    readyAt: instant("ready_at"),
    endedAt: instant("ended_at"),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("drafts_open").on(t.state), index("drafts_owner").on(t.ownerId, t.kind, t.state)],
);

/** M36. A candidate for the eval set; the text only while logged and while the person allows it (LF1, LF2). */
export const evalCandidates = pgTable(
  "eval_candidates",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull().references(() => people.id),
    cause: text("cause").$type<EvalCause>().notNull(),
    captureId: text("capture_id").notNull().references(() => captures.id),
    extractionId: text("extraction_id"),
    /**
     * Rule 6: one candidate per cause per answer or item ("thumbs_down:cap-1", "moved:cap-1-8"). A deleted
     * one is not counted (LF2, LF4): given again after the person turned the setting back on, or took a
     * thumbs down back and gave it again, it is logged anew. One a maintainer decided is never logged again.
     */
    dedupKey: text("dedup_key").notNull(),
    state: text("state").$type<EvalCandidateState>().notNull(),
    text: text("text"),
    detail: jsonb("detail").$type<EvalCandidateDetail>(),
    loggedAt: instant("logged_at"),
    decidedBy: text("decided_by"),
    decidedAt: instant("decided_at"),
    note: text("note"),
    caseText: text("case_text"),
    expected: text("expected"),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("eval_candidates_person").on(t.personId, t.state), uniqueIndex("eval_candidates_dedup_live").on(t.dedupKey).where(sql`${t.state} <> 'deleted'`)],
);

// ---- Asks to the owner (M37, section 20, U5 and U7) ----

export const ownerAsks = pgTable(
  "owner_asks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    captureId: text("capture_id").notNull().references(() => captures.id),
    /** The item whose words it came from: only those words are shown to the person asked (rule 9). */
    extractionId: text("extraction_id").notNull().references(() => extractions.id),
    authorId: text("author_id").notNull().references(() => people.id),
    kind: text("kind").$type<OwnerAskKind>().notNull(),
    targetType: text("target_type").$type<"work_item" | "milestone" | "handover">(),
    targetId: text("target_id"),
    targetField: text("target_field"),
    ownerId: text("owner_id").references(() => people.id),
    saw: text("saw"),
    value: text("value").notNull(),
    title: text("title"),
    state: text("state").$type<OwnerAskState>().notNull(),
    askedOn: day("asked_on").notNull(),
    decidedBy: text("decided_by").references(() => people.id),
    decidedOn: day("decided_on"),
    reason: text("reason"),
    appliedValue: text("applied_value"),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("owner_asks_project_state").on(t.projectId, t.state)],
);

// ---- Undo and corrections (phase L) ----

/**
 * M30. One undo of one save. The id is the command's (the Undo button's, or the "Undo that" message's), so a
 * repeat changes nothing; one per save, so "Undo that" twice undoes it once (UN5). What the save wrote is its
 * receipt in the audit log (action UNDO_RECEIPT), read from there as set-aside reasons are (UD6).
 */
export const undos = pgTable(
  "undos",
  {
    id: text("id").primaryKey(),
    captureId: text("capture_id").notNull().references(() => captures.id),
    ownerId: text("owner_id").notNull().references(() => people.id),
    state: text("state").$type<UndoState>().notNull(),
    refusal: jsonb("refusal").$type<UndoRefusal>(),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("undos_capture").on(t.captureId)],
);

/** M31. A proposed change to one project's vocabulary: an alias, or a contact tied to it. One per change (rule 6). */
export const vocabularyChanges = pgTable(
  "vocabulary_changes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    kind: text("kind").$type<VocabularyKind>().notNull(),
    word: text("word"),
    personId: text("person_id").references(() => people.id),
    tie: text("tie"),
    remove: boolean("remove").notNull().default(false),
    /** Null when Atlas proposed it from moves in review (CD14); forId is whose moves, or who said it. */
    proposedBy: text("proposed_by").references(() => people.id),
    forId: text("for_id").notNull().references(() => people.id),
    captureId: text("capture_id").references(() => captures.id),
    dedupKey: text("dedup_key").notNull().unique(),
    state: text("state").$type<VocabularyState>().notNull(),
    proposedOn: day("proposed_on").notNull(),
    remindersSent: integer("reminders_sent").notNull().default(0),
    lastRemindedOn: day("last_reminded_on"),
    decidedBy: text("decided_by").references(() => people.id),
    decidedOn: day("decided_on"),
    clashesWith: text("clashes_with").array().notNull().default(sql`'{}'::text[]`),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("vocabulary_changes_project").on(t.projectId, t.state)],
);

// ---- Signals (phase K, M29) ----

/**
 * M29. Trouble a rule noticed that nobody reported, raised to the people who can act. One live signal
 * (raised or dismissed) per (project, rule, subject); a later one is a new row, as a new inbox episode is.
 */
export const signals = pgTable(
  "signals",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    rule: text("rule").$type<SignalRule>().notNull(),
    subjectType: text("subject_type").$type<SignalSubjectType>().notNull(),
    subjectId: text("subject_id").notNull(),
    state: text("state").$type<SignalState>().notNull(),
    stage: text("stage").$type<SignalStage>().notNull(),
    level: integer("level").notNull(),
    episode: text("episode").notNull(),
    facts: jsonb("facts").$type<SignalFacts>().notNull(),
    raisedOn: day("raised_on").notNull(),
    stageOn: day("stage_on").notNull(),
    decidedBy: text("decided_by").references(() => people.id),
    decidedOn: day("decided_on"),
    dismissReason: text("dismiss_reason"),
    riskEntryId: text("risk_entry_id").references(() => braidEntries.id),
    earlier: jsonb("earlier").$type<EarlierDismissal>(),
    version: version(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index("signals_project").on(t.projectId, t.state),
    uniqueIndex("signals_live").on(t.projectId, t.rule, t.subjectId).where(sql`${t.state} in ('raised', 'dismissed')`),
  ],
);

/** M29, the model's fix: what the last answer (accept, dismiss or expiry) left, one per (project, rule, subject). */
export const signalMemory = pgTable(
  "signal_memory",
  {
    projectId: text("project_id").notNull().references(() => projects.id),
    rule: text("rule").$type<SignalRule>().notNull(),
    subjectId: text("subject_id").notNull(),
    episode: text("episode").notNull(),
    level: integer("level").notNull(),
    answer: text("answer").$type<SignalMemory["answer"]>().notNull(),
    by: text("by").references(() => people.id),
    on: day("on").notNull(),
    reason: text("reason"),
    seenGone: boolean("seen_gone").notNull().default(false),
    updatedAt: updated(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.rule, t.subjectId] })],
);

// ---- Notices (D15) ----

/**
 * Atlas telling someone what happened to something of theirs ("Alicia approved your risk"). Shown
 * in their chat; never an inbox item, because there is nothing to do.
 */
export const notices = pgTable(
  "notices",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull().references(() => people.id),
    at: instant("at").notNull(),
    text: text("text").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    projectId: text("project_id").references(() => projects.id),
  },
  (t) => [index("notices_person").on(t.personId, t.at)],
);

// ---- Inbox and audit ----

/** M10. One live item per (owner, cause); a returning cause is a new episode. */
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => people.id),
    causeKey: text("cause_key").notNull(),
    episode: integer("episode").notNull(),
    state: text("state").$type<InboxItemState>().notNull(),
    snoozedUntil: instant("snoozed_until"),
    createdAt: created(),
    closedAt: instant("closed_at"),
    version: version(),
  },
  (t) => [uniqueIndex("inbox_items_owner_cause_episode").on(t.ownerId, t.causeKey, t.episode)],
);

/** A11. Every transition and every Atlas action: who, what, from and to, and where it came from. */
export const auditEntries = pgTable(
  "audit_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: instant("at").notNull(),
    actorType: text("actor_type").$type<"person" | "atlas" | "rule" | "system">().notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    machine: text("machine"),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    captureId: text("capture_id"),
    extractionId: text("extraction_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [index("audit_subject").on(t.subjectType, t.subjectId)],
);
