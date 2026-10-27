// Every DECIDE default from the build plan and the use case 1 machines doc, in one place.
// Each line names the decision it comes from; change a value here, not in the rules.

export const config = {
  timeZone: "America/Jamaica",

  // B3, S9: a milestone is Off track when its forecast is more than this many calendar days late
  milestoneToleranceDays: 3,

  // S1: a set status clears when the plan agrees or the work is Done (model checked as "when_done"),
  // and a reason is marked stale when the plan moves under it
  setStatusExpiry: "when_done" as "when_agree" | "when_done" | "on_any_change",
  reasonStale: true,

  // S3: a capture saves all or nothing
  applyMode: "all_or_nothing" as "all_or_nothing" | "what_can",

  // S4: remind about an unfinished review, then expire it
  reviewReminderWorkingHours: 4,
  reviewExpiryDays: 7,
  // Section 20, UD1: an Ask to the owner (M37) expires after this, like a review
  ownerAskExpiryDays: 7,

  // S7, S8
  captureMaxTries: 3,
  // D19: a transcription or read with no answer for this long goes back to retry
  staleReadMinutes: 5,
  // D3: a save that fails on a database error is tried this many times, waiting 1s, then 2s
  saveMaxTries: 3,
  maxProposalsPerCapture: 20,

  // S11, S12: one approver for a decision; a proposer who holds the right may approve their own
  decisionApprovers: 1,
  selfApproval: true,

  // S18: remind deciders about an unanswered proposal; never decide it
  braidReminderWorkingDays: 2,

  // Section 18, CQ4 and CQ5 (conversational plan, section 23): "Any updates?" covers what happened since
  // the asker last asked, and never more than this many days back
  updatesMaxDays: 7,
  // Section 18, CQ8 to CQ11 (conversational plan, section 23): "Who has mentioned me?" looks this far back
  mentionsDays: 14,

  // Phase S, M36 (conversational plan, section 23): a candidate for the eval set nobody accepts or
  // dismisses is deleted after this many days, with the person's words in it
  evalCandidateDays: 30,
  // Phase S, LF8 and CD28: a usage number is shown only for a group of at least this many people
  metricMinimumCount: 5,
} as const;

export type Config = typeof config;
