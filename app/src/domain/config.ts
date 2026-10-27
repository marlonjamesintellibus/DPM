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

  // S7, S8
  captureMaxTries: 3,
  maxProposalsPerCapture: 20,

  // S11, S12: one approver for a decision; a proposer who holds the right may approve their own
  decisionApprovers: 1,
  selfApproval: true,

  // S18: remind deciders about an unanswered proposal; never decide it
  braidReminderWorkingDays: 2,
} as const;

export type Config = typeof config;
