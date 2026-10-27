// The M28 Standup settings, in the checks.mjs format, to be added to ROWS and PLANTS there.
// M28 is phase J of use-cases/atlas-conversational-plan.md (section 12), checked before any code.
import Standup, { FIXES } from '../models/standup.mjs';

const without = (f) => FIXES.filter((x) => x !== f);

// expectFail lists the properties expected to fail; everything else should pass
export const ROWS = [
  // The M28 table as the plan draws it: five gaps, one per fix below
  {
    spec: 'Standup',
    setting: 'as drawn',
    model: Standup({ Fixes: [] }),
    expectFail: ['StandupEnds', 'NoStandupAfterUpdate', 'ComposedHoldsAnswers', 'YourWordChangesOnlyYours', 'AskedStandupRuns'],
  },
  { spec: 'Standup', setting: 'fixed (all five fixes)', model: Standup(), expectFail: [] },
  // Each fix is needed: leaving one out fails its property and only that one
  { spec: 'Standup', setting: 'fixed, but the timer does nothing when the M23 rules fail', model: Standup({ Fixes: without('timerSkips') }), expectFail: ['StandupEnds'] },
  { spec: 'Standup', setting: 'fixed, but the timer does not read the skip guard first', model: Standup({ Fixes: without('skipFirst') }), expectFail: ['NoStandupAfterUpdate'] },
  { spec: 'Standup', setting: 'fixed, but STOP with nothing answered composes', model: Standup({ Fixes: without('emptyAbandons') }), expectFail: ['ComposedHoldsAnswers'] },
  { spec: 'Standup', setting: "fixed, but the save checks membership, not the record's owner", model: Standup({ Fixes: without('ownerAsks') }), expectFail: ['YourWordChangesOnlyYours'] },
  { spec: 'Standup', setting: '"Start my standup" only from scheduled', model: Standup({ Fixes: without('startAfterSkip') }), expectFail: ['AskedStandupRuns'] },
];

// Planted bugs on the fixed design: each one must make a full check fail
export const PLANTS = [
  { spec: 'Standup', setting: 'bug: a tap after the idle timer abandoned the standup reopens it', model: Standup({ Bug: 'lateAnswer', Moves: 1 }), expectFail: ['OnlyDrawnArrows', 'AskedOnlyWhatTheyMaySee'] },
  { spec: 'Standup', setting: 'bug: the idle timer never fires', model: Standup({ Bug: 'noIdleTimer', Moves: 1 }), expectFail: ['StandupEnds'] },
  { spec: 'Standup', setting: 'bug: a second standup starts the same day', model: Standup({ Bug: 'twoPerDay', Moves: 0 }), expectFail: ['OnePerDay', 'OnlyDrawnArrows'] },
  { spec: 'Standup', setting: 'bug: a tap on an earlier question answers the current one', model: Standup({ Bug: 'noIdCheck', Moves: 1 }), expectFail: ['AnswerMatchesQuestion'] },
  { spec: 'Standup', setting: 'bug: Save runs again on a saved capture', model: Standup({ Bug: 'resave', Moves: 1 }), expectFail: ['AppliedAtMostOnce'] },
  { spec: 'Standup', setting: 'bug: the question list is built once, not at each step', model: Standup({ Bug: 'staleList', Moves: 1 }), expectFail: ['AskedOnlyWhatTheyMaySee'] },
  { spec: 'Standup', setting: 'bug: questions come from owned work in projects he has left', model: Standup({ Bug: 'ownerOnly', Moves: 1 }), expectFail: ['AskedOnlyWhatTheyMaySee'] },
  { spec: 'Standup', setting: 'bug: the timer ignores an update sent today', model: Standup({ Bug: 'noSkip', Moves: 1 }), expectFail: ['NoStandupAfterUpdate'] },
  { spec: 'Standup', setting: 'bug: "Start my standup" is refused with no open work', model: Standup({ Bug: 'startNeedsWork', Moves: 1 }), expectFail: ['AskedStandupRuns'] },
  { spec: 'Standup', setting: 'bug: the idle timer composes with nothing answered', model: Standup({ Bug: 'idleComposesEmpty', Moves: 1 }), expectFail: ['ComposedHoldsAnswers'] },
  { spec: 'Standup', setting: 'bug: Atlas applies tap answers without the review', model: Standup({ Bug: 'autoApply', Moves: 1 }), expectFail: ['AtlasNeverChangesRecords', 'RightCheckedWhenItRuns', 'YourWordChangesOnlyYours'] },
  { spec: 'Standup', setting: 'bug: the save trusts the rights he had when asked', model: Standup({ Bug: 'rightAtAsk', Moves: 1 }), expectFail: ['RightCheckedWhenItRuns'] },
  { spec: 'Standup', setting: 'bug: the save writes without comparing versions', model: Standup({ Bug: 'blindWrite', Moves: 1 }), expectFail: ['NeverOverwriteUnseen'] },
  { spec: 'Standup', setting: "bug: the question about #208 is the quote on an answer about #212", model: Standup({ Bug: 'questionAsQuote', Moves: 1 }), expectFail: ['QuoteFactsReadable'] },
  { spec: 'Standup', setting: 'bug: naming Alicia as the blocker gives her a to-do', model: Standup({ Bug: 'assignNamed', Moves: 1 }), expectFail: ['YourWordChangesOnlyYours'] },
];
