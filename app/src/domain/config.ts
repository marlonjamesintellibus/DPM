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

  // Phase B, M20 and CD2 (conversational plan, section 23): a confirm card for a command said in words
  // ("Approve the Kyle risk") expires unanswered after this many minutes, and nothing changes (AC10)
  commandExpiryMinutes: 30,
  // Phase D, M21 and CD2 (conversational plan, section 23): a question Atlas asks in the chat ("#151 or #152?")
  // nobody answers goes to the review after this many hours, or closes when it is about a command
  clarifyExpiryHours: 2,

  // Phase J, M28 (conversational plan, section 23): a standup asks at most this many questions about the
  // person's work and "Anything new blocking you?" together; a question left this many minutes ends it,
  // composing what was answered (SU7). standupTime (CD27, in the org time zone) is when Atlas would start one
  // itself, which waits on phase F; phase N reads it too: "Who hasn't updated today?" asked before it says
  // "It's early" (LD3)
  standupMaxQuestions: 4,
  standupIdleMinutes: 60,
  standupTime: "09:00",

  // Phase S, M36 (conversational plan, section 23): a candidate for the eval set nobody accepts or
  // dismisses is deleted after this many days, with the person's words in it
  evalCandidateDays: 30,
  // Phase S, LF8 and CD28: a usage number is shown only for a group of at least this many people
  metricMinimumCount: 5,

  // Phase L, M30 (conversational plan, section 23): "Undo that" reverses the author's last save for this long
  undoMinutes: 15,
  // Phase L, M31: a vocabulary change nobody approves or declines is reminded (S18), then expires after this many days
  vocabExpiryDays: 14,

  // Phase K, M29 (conversational plan, section 23): when a rule sees trouble nobody reported. Work In progress
  // with no change and no mention for this many working days is stale; a milestone whose forecast moved later
  // this many times is slipping; a proposal waiting this many working days (after the S18 reminders) needs its
  // deciders; a project with no update from any member for this many working days is quiet
  staleWorkDays: 5,
  slipCount: 3,
  decisionWaitDays: 5,
  quietProjectDays: 3,
  // A dismissed signal is not raised again for this many days, and then only if worse or a new episode
  signalSnoozeDays: 7,
  // A signal nobody answers expires after this many days with PM and Leads (from when it reached them)
  signalExpiryDays: 14,
  // The model check's fix: stale work goes to its owner first, and to PM and Leads after this many working days
  ownerAnswerDays: 2,

  // Phase G, M25 (conversational plan, section 23): a draft nobody copies, discards or refreshes expires after
  // this many hours; and the model check's timer on requested: a model that has not answered after this many
  // seconds counts as DRAFT_FAILED, so a draft always reaches ready (the plain template at worst)
  draftExpiryHours: 24,
  draftModelSeconds: 30,
} as const;

export type Config = typeof config;
