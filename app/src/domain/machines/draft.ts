// M25. Draft (Ask), the M11 shape. Conversational plan, section 9 (phase G); model checked 27 Oct
// (research/state-machines/js/models/draft.mjs) and built as its fixed variant: a timer on requested
// (config.draftModelSeconds) counts as DRAFT_FAILED, so a draft always reaches ready (ModelTimer); COPY of a
// client status, and POST, check every fact against the readers there now (ReaderCheck); and DR5's Refresh
// is a drawn arrow, with the right checked again (Refresh "drawn"). Atlas drafts text from DPM's facts; the
// person edits it, then copies it. Nothing here changes a record (rules 1 and 10): what a draft says about
// #151 is words for the person to send, never a change to #151.
//   (none) --REQUEST [the right, checked now]--> requested               DR3
//   requested --DRAFTED [this attempt; passes the facts check]--> ready
//   requested --DRAFTED [this attempt; fails] or DRAFT_FAILED--> requested (the next try), then ready (plain)
//   requested --DRAFT_FAILED [the model timer]--> as DRAFT_FAILED       the model check's fix
//   ready --EDIT [the owner]--> ready
//   ready --COPY [the owner; the right, checked now; a client status: every fact still in the client view]--> copied
//                                                                         final
//   ready --POST [the owner, confirmed; the right to post there; every reader may see every fact]--> posted
//                                                                         final; waits on B8, B9: nothing sends it yet
//   ready --DISCARD [the owner]--> discarded                              final
//   ready --EXPIRE [config.draftExpiryHours]--> expired                   final
//   ready --REFRESH [the owner; the right, checked now]--> requested      DR5: their edits kept aside
// A try's number only rises, across a Refresh too, so a reply to a try from before the Refresh can never be
// taken for the new one (rule 6).
import { config } from "../config";
import { DRAFT_LABEL, draftProblem, draftTemplate, type DraftFacts, type DraftKind, type KnownNames } from "../drafts";
import { defineMachine, transition, type Outcome } from "../machine";

export const DRAFT_STATES = ["none", "requested", "ready", "copied", "posted", "discarded", "expired"] as const;
export type DraftState = (typeof DRAFT_STATES)[number];
export const DRAFT_FINAL: readonly DraftState[] = ["copied", "posted", "discarded", "expired"];

/** The model check's TRIES: a draft that fails the facts check, or a model that fails, is tried once more, then plain. */
export const DRAFT_TRIES = 2;

/** Who wrote the text it holds: Atlas over the facts, or DPM's plain template (DR2, DR6). */
export type DraftBy = "atlas" | "plain";

export type DraftRecord = {
  id: string;
  ownerId: string;
  kind: DraftKind;
  /** The project a client status or weekly summary is about; null for a standup (all of theirs). */
  projectId: string | null;
  /** The message that asked for it; once only, by draft id (rule 6, DR8). */
  captureId: string;
  state: DraftState;
  /**
   * The try the draft is on; only a reply to this try counts (rule 6). It only rises: a request's tries are 1
   * and 2, and each Refresh starts the next DRAFT_TRIES (3 and 4, then 5 and 6), so a late reply to try 1
   * after a Refresh is still a reply to an earlier try.
   */
  attempt: number;
  /** When this try started: the model timer counts from here. */
  attemptAt: Date | null;
  facts: DraftFacts;
  text: string | null;
  by: DraftBy | null;
  edited: boolean;
  /** DR5: what they had written when they refreshed, kept aside for them. */
  aside: string | null;
  /** When it became ready: the expiry timer counts from here. */
  readyAt: Date | null;
  endedAt: Date | null;
};

export type DraftEvent =
  | { type: "REQUEST" }
  /** The model answered this try with a draft; the guard runs the facts check on it. */
  | { type: "DRAFTED"; attempt: number; text: string }
  /** A model error, no model connected (DR6), or the model timer ("timer"). */
  | { type: "DRAFT_FAILED"; attempt: number; why: string }
  | { type: "EDIT"; text: string }
  | { type: "COPY" }
  /** Waits on B8, B9 (posting to a group from the DPM bot): drawn and tested, sent by no command yet. */
  | { type: "POST" }
  | { type: "DISCARD" }
  /** Timer draft_expiry: config.draftExpiryHours after it became ready. */
  | { type: "EXPIRE" }
  /** DR5: the facts read again for the asker, now. */
  | { type: "REFRESH"; facts: DraftFacts };

type Ctx = {
  record: DraftRecord;
  actorId: string;
  now: Date;
  /** REQUEST, REFRESH, COPY and POST: the right held now (rule 4): anyone for a standup, a PM or Lead of the project otherwise (DR3). */
  right?: boolean;
  /** COPY of a client status, and POST: every fact in it is one every reader there may see now (rule 8). */
  readersOk?: boolean;
  /** POST: the person confirmed it (rule 9: outward is confirmed, never automatic). */
  confirmed?: boolean;
  /** DRAFTED: the names DPM knows for the asker, so one the draft was not given is refused (DR2, DR4). */
  known?: KnownNames;
};

/** Rule 5: a try the model has not answered counts as failed after config.draftModelSeconds. */
export function modelTimedOut(r: Pick<DraftRecord, "state" | "attemptAt">, now: Date): boolean {
  return r.state === "requested" && !!r.attemptAt && now.getTime() - r.attemptAt.getTime() >= config.draftModelSeconds * 1000;
}

/** Rule 5: a ready draft nobody copies or discards expires after config.draftExpiryHours. */
export function draftExpired(r: Pick<DraftRecord, "state" | "readyAt">, now: Date): boolean {
  return r.state === "ready" && !!r.readyAt && now.getTime() - r.readyAt.getTime() >= config.draftExpiryHours * 3_600_000;
}

/** Rule 10: a draft is its asker's own; only they act on it. */
const ownerGuard = (c: Ctx) => (c.actorId === c.record.ownerId ? null : "only the person who asked for it can use this draft");

/** DR3, rule 4: the right is the caller's to read now; a standup needs none beyond being the owner. */
const rightGuard = (c: Ctx) => ownerGuard(c) ?? (c.right === true ? null : `only a PM or Lead of the project can draft a ${DRAFT_LABEL[c.record.kind]}`);

// Rule 6: only the try the draft is on counts; a late reply to an earlier one changes nothing
const thisTry = (c: Ctx, e: { attempt: number }) => (e.attempt === c.record.attempt ? null : "a reply to an earlier try");
const passes = (c: Ctx, e: Extract<DraftEvent, { type: "DRAFTED" }>) => thisTry(c, e) ?? draftProblem(c.record.facts, e.text, c.known);
const fails = (c: Ctx, e: Extract<DraftEvent, { type: "DRAFTED" }>) => thisTry(c, e) ?? (draftProblem(c.record.facts, e.text, c.known) ? null : "it passes the facts check");
/** Which try of its round a draft is on (1 or 2): a Refresh starts a round of DRAFT_TRIES at the next number. */
export const tryOfRound = (attempt: number) => ((attempt - 1) % DRAFT_TRIES) + 1;
const triesLeft = (c: Ctx) => (tryOfRound(c.record.attempt) < DRAFT_TRIES ? null : "that was the last try");
const lastTry = (c: Ctx) => (tryOfRound(c.record.attempt) >= DRAFT_TRIES ? null : "there is another try");
// The model check's fix: the timer is a DRAFT_FAILED, sent only once this try has had its time
const failure = (c: Ctx, e: Extract<DraftEvent, { type: "DRAFT_FAILED" }>) =>
  thisTry(c, e) ?? (e.why === "timer" && !modelTimedOut(c.record, c.now) ? `a try has ${config.draftModelSeconds} seconds` : null);

// Rule 4: the right is checked again when Copy runs, as for Refresh: a PM made a member since cannot copy a
// client status. Rule 8, ReaderCheck: a client status goes to the client, so the client view is checked now;
// the others are copied by their owner for themselves
const copyGuard = (c: Ctx) => rightGuard(c) ?? (c.record.kind !== "client" || c.readersOk === true ? null : "it says something the client view does not show now");
const postGuard = (c: Ctx) =>
  rightGuard(c) ?? (c.confirmed === true ? null : "a post is sent only once you confirm it") ?? (c.readersOk === true ? null : "someone there may not see everything in it");

export const draftMachine = defineMachine<DraftState, DraftEvent, Ctx>({
  name: "draft",
  states: DRAFT_STATES,
  arrows: [
    { from: ["none"], on: "REQUEST", to: "requested", guard: rightGuard },
    { from: ["requested"], on: "DRAFTED", to: "ready", guard: passes },
    { from: ["requested"], on: "DRAFTED", to: "requested", guard: (c, e) => fails(c, e) ?? triesLeft(c) },
    { from: ["requested"], on: "DRAFTED", to: "ready", guard: (c, e) => fails(c, e) ?? lastTry(c) },
    { from: ["requested"], on: "DRAFT_FAILED", to: "requested", guard: (c, e) => failure(c, e) ?? triesLeft(c) },
    { from: ["requested"], on: "DRAFT_FAILED", to: "ready", guard: (c, e) => failure(c, e) ?? lastTry(c) },
    { from: ["ready"], on: "EDIT", to: "ready", guard: (c, e) => ownerGuard(c) ?? (e.text.trim() ? null : "a draft can't be empty") },
    { from: ["ready"], on: "COPY", to: "copied", guard: copyGuard },
    { from: ["ready"], on: "POST", to: "posted", guard: postGuard },
    { from: ["ready"], on: "DISCARD", to: "discarded", guard: ownerGuard },
    { from: ["ready"], on: "EXPIRE", to: "expired", guard: (c) => (draftExpired(c.record, c.now) ? null : `a draft stays ${config.draftExpiryHours} hours`) },
    { from: ["ready"], on: "REFRESH", to: "requested", guard: rightGuard },
  ],
});

export type DraftResult = { outcome: Outcome<DraftState>; record: DraftRecord };

/** The first try of a round, from the facts read now: try 1 for a request, the next round's first after a Refresh (rule 6). */
const fresh = (r: DraftRecord, facts: DraftFacts, now: Date): DraftRecord => ({
  ...r,
  facts,
  attempt: r.attempt < 1 ? 1 : Math.ceil(r.attempt / DRAFT_TRIES) * DRAFT_TRIES + 1,
  attemptAt: now,
  text: null,
  by: null,
  edited: false,
  readyAt: null,
});

/** Applies one event. A refused event returns the record unchanged. */
export function applyDraftEvent(record: DraftRecord, event: DraftEvent, ctx: Omit<Ctx, "record">): DraftResult {
  const outcome = transition(draftMachine, record.state, event, { ...ctx, record });
  if (!outcome.ok) return { outcome, record };
  const next: DraftRecord = { ...record, state: outcome.to };
  switch (event.type) {
    case "REQUEST":
      return { outcome, record: fresh(next, record.facts, ctx.now) };
    case "DRAFTED":
    case "DRAFT_FAILED": {
      if (outcome.to === "requested") return { outcome, record: { ...next, attempt: record.attempt + 1, attemptAt: ctx.now } };
      // DR2, DR6: after the tries, DPM's own words from the facts
      const atlas = event.type === "DRAFTED" && !draftProblem(record.facts, event.text, ctx.known);
      return { outcome, record: { ...next, text: atlas ? event.text : draftTemplate(record.facts), by: atlas ? "atlas" : "plain", readyAt: ctx.now } };
    }
    case "EDIT":
      return { outcome, record: { ...next, text: event.text.trim(), edited: next.edited || event.text.trim() !== record.text } };
    case "REFRESH":
      // DR5: what they wrote is kept aside; a refresh of an unedited draft keeps what was aside before
      return { outcome, record: { ...fresh(next, event.facts, ctx.now), aside: record.edited ? record.text : record.aside } };
    default:
      return { outcome, record: { ...next, endedAt: ctx.now } };
  }
}

/** A draft about to be asked for; nothing is stored unless REQUEST moves it. */
export function newDraft(fields: Pick<DraftRecord, "id" | "ownerId" | "kind" | "projectId" | "captureId" | "facts">): DraftRecord {
  return { ...fields, state: "none", attempt: 0, attemptAt: null, text: null, by: null, edited: false, aside: null, readyAt: null, endedAt: null };
}

// ---- What the chat says ----

/** How a draft that is no longer ready ended, in plain words. */
export function draftEndText(r: Pick<DraftRecord, "state" | "kind">): string | null {
  switch (r.state) {
    case "copied":
      return "Copied. Paste it where you need it.";
    case "posted":
      return "Posted.";
    case "discarded":
      return "Discarded. Nothing was sent.";
    case "expired":
      return `This draft expired. Ask me again for a fresh ${DRAFT_LABEL[r.kind]}.`;
    default:
      return null;
  }
}
