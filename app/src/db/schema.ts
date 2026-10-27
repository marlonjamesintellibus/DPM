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
import type { BraidAnswer, BraidEntryState, BraidLinkRelation } from "../domain/machines/braid-entry";
import type { CaptureState } from "../domain/machines/capture";
import type { ItemState, WithdrawReason } from "../domain/machines/extracted-item";
import type { HandoverState } from "../domain/machines/handover";
import type { InboxItemState } from "../domain/machines/inbox-item";
import type { ConversationState } from "../domain/machines/conversation";
import type { KindRequestState } from "../domain/machines/kind-request";
import type { Answer, AskedQuestion } from "../domain/question";
import type { LeaveState } from "../domain/machines/leave";
import type { MembershipState } from "../domain/machines/membership";
import type { OverrideState } from "../domain/machines/set-status";
import type { BraidKind, ProjectRole } from "../domain/rights";
import type { Confidence, ExtractedItemDraft, ItemKind, RoutingState } from "../domain/shared";
import type { SettableStatus } from "../domain/status/status";
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
