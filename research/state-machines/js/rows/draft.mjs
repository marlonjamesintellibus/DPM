// M25 Draft (phase G of use-cases/atlas-conversational-plan.md), in the format of ../checks.mjs.
// Kept apart from checks.mjs so it can be added there with one import.
import Draft from '../models/draft.mjs';

// The three fixes the check asks for: a timer on requested, the reader check on POST and on COPY of a
// client status, and DR5's Refresh drawn as an arrow
const FIXED = { ModelTimer: true, ReaderCheck: true, Refresh: 'drawn' };

// expectFail lists the properties expected to fail; everything else should pass
export const ROWS = [
  { spec: 'Draft', setting: 'as the plan draws it (DR5 Refresh not drawn)', model: Draft(), expectFail: ['DraftEnds', 'EveryReaderMaySeeEveryFact', 'OnlyDrawnArrows'] },
  { spec: 'Draft', setting: 'fixed: timer on requested, reader check now, Refresh drawn', model: Draft(FIXED), expectFail: [] },
  { spec: 'Draft', setting: 'fixed, but no timer on requested', model: Draft({ ...FIXED, ModelTimer: false }), expectFail: ['DraftEnds'] },
  { spec: 'Draft', setting: 'fixed, but POST and COPY check only the right', model: Draft({ ...FIXED, ReaderCheck: false }), expectFail: ['EveryReaderMaySeeEveryFact'] },
  { spec: 'Draft', setting: 'fixed, but Refresh used and not drawn', model: Draft({ ...FIXED, Refresh: 'undrawn' }), expectFail: ['OnlyDrawnArrows'] },
  { spec: 'Draft', setting: 'fixed, without Refresh (discard and ask again)', model: Draft({ ...FIXED, Refresh: 'none' }), expectFail: [] },
];

// Planted bugs, each on the fixed design: each one must make a full check fail
export const PLANTS = [
  { spec: 'Draft', setting: 'bug: an expired draft can still be copied', model: Draft({ ...FIXED, Bug: 'copyAfterExpiry' }), expectFail: ['OnlyDrawnArrows'] },
  { spec: 'Draft', setting: 'bug: the expiry timer never fires', model: Draft({ ...FIXED, Bug: 'noExpiry' }), expectFail: ['DraftEnds'] },
  // Posting again can also move a copied draft to posted, an arrow the table does not draw
  { spec: 'Draft', setting: 'bug: a confirm sent twice posts twice', model: Draft({ ...FIXED, Bug: 'noOnceOnly' }), expectFail: ['OncePosted', 'RepeatChangesNothing', 'OnlyDrawnArrows'] },
  { spec: 'Draft', setting: 'bug: a late reply from an old attempt is used', model: Draft({ ...FIXED, Bug: 'noAttemptCheck' }), expectFail: ['RepeatChangesNothing'] },
  { spec: 'Draft', setting: 'bug: a member can ask for a client status', model: Draft({ ...FIXED, Bug: 'noRoleCheck' }), expectFail: ['RequestOnlyWithRight'] },
  { spec: 'Draft', setting: 'bug: the right to post is checked at the tap', model: Draft({ ...FIXED, Bug: 'rightAtAsk' }), expectFail: ['PostedOnlyWithRight'] },
  // The reader check still stops a made-up fact going out, since no reader may see it
  { spec: 'Draft', setting: 'bug: the facts check is skipped', model: Draft({ ...FIXED, Bug: 'noFactsCheck' }), expectFail: ['FactsFromDPM'] },
  { spec: 'Draft', setting: 'bug: facts are read for the project, not the asker', model: Draft({ ...FIXED, Bug: 'notPerViewer' }), expectFail: ['OwnerMaySeeEveryFact'] },
  { spec: 'Draft', setting: "bug: quotes from others' updates are given to Atlas", model: Draft({ ...FIXED, Bug: 'quotesGiven' }), expectFail: ['NoQuotes', 'ClientDraftOnlyClientFacts'] },
  { spec: 'Draft', setting: 'bug: a client status is built from the weekly facts', model: Draft({ ...FIXED, Bug: 'clientGetsInternals' }), expectFail: ['ClientDraftOnlyClientFacts'] },
  { spec: 'Draft', setting: 'bug: the reader check uses the view when drafted', model: Draft({ ...FIXED, Bug: 'readerCheckAtDraft' }), expectFail: ['EveryReaderMaySeeEveryFact'] },
  // Atlas posting by itself also skips the reader check
  { spec: 'Draft', setting: 'bug: Atlas posts a ready standup by itself', model: Draft({ ...FIXED, Bug: 'autoPost' }), expectFail: ['OutwardIsConfirmed', 'EveryReaderMaySeeEveryFact'] },
  { spec: 'Draft', setting: 'bug: "#151 is done" in a standup marks it done', model: Draft({ ...FIXED, Bug: 'draftApplies' }), expectFail: ['AtlasNeverChangesARecord', 'OthersRecordsUntouched'] },
  { spec: 'Draft', setting: "bug: Alicia's weekly summary marks Kemar's #151 done", model: Draft({ ...FIXED, Bug: 'postApplies' }), expectFail: ['OthersRecordsUntouched'] },
];
