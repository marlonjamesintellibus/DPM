// The settings and planted bugs for M36 Eval candidate (use-cases/atlas-conversational-plan.md,
// section 21, phase S), in the format of ../checks.mjs, to be merged into its ROWS and PLANTS.
import EvalCandidate, { FIXED } from '../models/evalCandidate.mjs';

// expectFail lists the properties expected to fail; everything else should pass
export const ROWS = [
  // The table as drawn: LOGGED guarded by the giver only, no arrow for LF2, final states keep the text.
  // Alicia's thumbs down on a group answer stores Kemar's words without his OK, and a maintainer accepts them.
  { spec: 'EvalCandidate', setting: 'as drawn', model: EvalCandidate(), expectFail: ['TextOnlyWithConsent', 'AcceptOnlyWithConsent', 'TextNotKeptForever'] },
  // With every owner's OK: Kemar turns "Help improve Atlas" off and his logged text stays, and can be accepted (LF2)
  { spec: 'EvalCandidate', setting: 'fix everyOwner only', model: EvalCandidate({ Fixes: ['everyOwner'] }), expectFail: ['TextOnlyWithConsent', 'AcceptOnlyWithConsent', 'TextNotKeptForever'] },
  // With OPTED_OUT too: a dismissed or accepted candidate keeps his text after he opts out, and forever
  { spec: 'EvalCandidate', setting: 'fixes everyOwner, optOut', model: EvalCandidate({ Fixes: ['everyOwner', 'optOut'] }), expectFail: ['TextOnlyWithConsent', 'TextNotKeptForever'] },
  // Every owner's OK, OPTED_OUT with the setting, the OK rechecked on ACCEPT and DISMISS, final states drop the text
  { spec: 'EvalCandidate', setting: 'all three fixes (proposed)', model: EvalCandidate({ Fixes: FIXED }), expectFail: [] },
];

// Planted bugs: each one must make a full check fail
export const PLANTS = [
  { spec: 'EvalCandidate', setting: 'bug: the 30 day cleanup deletes accepted candidates too', model: EvalCandidate({ Fixes: FIXED, Bug: 'timerOnFinal' }), expectFail: ['OnlyDrawnArrows'] },
  { spec: 'EvalCandidate', setting: 'bug: no evalCandidateDays timer', model: EvalCandidate({ Fixes: FIXED, Bug: 'noTimer' }), expectFail: ['NothingStuck', 'TextNotKeptForever'] },
  { spec: 'EvalCandidate', setting: 'bug: a repeated thumbs down logs again', model: EvalCandidate({ Fixes: FIXED, Bug: 'noDedup' }), expectFail: ['CountedOnce', 'OnlyDrawnArrows', 'EvalCaseOnce'] },
  { spec: 'EvalCandidate', setting: 'bug: a second Accept adds the case again', model: EvalCandidate({ Fixes: FIXED, Bug: 'acceptTwice' }), expectFail: ['EvalCaseOnce'] },
  { spec: 'EvalCandidate', setting: 'bug: Accept trusts what the maintainer was shown', model: EvalCandidate({ Fixes: FIXED, Bug: 'checkWhenShown' }), expectFail: ['DecidedByMaintainerNow', 'OnlyDrawnArrows'] },
  { spec: 'EvalCandidate', setting: "bug: only the giver's OK is asked (Alicia logs Kemar's words)", model: EvalCandidate({ Fixes: FIXED, Bug: 'giverConsentOnly' }), expectFail: ['TextOnlyWithConsent'] },
  { spec: 'EvalCandidate', setting: 'bug: opting out deletes later, Accept rechecks', model: EvalCandidate({ Fixes: FIXED, Bug: 'deleteLater' }), expectFail: ['TextOnlyWithConsent'] },
  { spec: 'EvalCandidate', setting: 'bug: opting out deletes later, no recheck', model: EvalCandidate({ Fixes: FIXED, Bug: 'deleteLaterNoRecheck' }), expectFail: ['TextOnlyWithConsent', 'AcceptOnlyWithConsent'] },
  { spec: 'EvalCandidate', setting: 'bug: opting out deletes accepted cases', model: EvalCandidate({ Fixes: FIXED, Bug: 'optOutDeletesCases' }), expectFail: ['AcceptedCasesStay', 'OnlyDrawnArrows'] },
  { spec: 'EvalCandidate', setting: 'bug: dismissed and accepted keep the original text', model: EvalCandidate({ Fixes: FIXED, Bug: 'keepTextOnFinal' }), expectFail: ['TextNotKeptForever', 'TextOnlyWithConsent'] },
  { spec: 'EvalCandidate', setting: "bug: a PM reads her team's candidates", model: EvalCandidate({ Fixes: FIXED, Bug: 'leadSeesText' }), expectFail: ['TextOnlyToMaintainers'] },
  { spec: 'EvalCandidate', setting: 'bug: a case enters the eval set with real names', model: EvalCandidate({ Fixes: FIXED, Bug: 'acceptRaw' }), expectFail: ['EvalSetAnonymised'] },
  { spec: 'EvalCandidate', setting: 'bug: numbers shown for one person', model: EvalCandidate({ Fixes: FIXED, Bug: 'smallCounts' }), expectFail: ['CountsNeverSingleOutAPerson'] },
  { spec: 'EvalCandidate', setting: "bug: Kyle sees Intellibus's numbers", model: EvalCandidate({ Fixes: FIXED, Bug: 'countsAcrossOrgs' }), expectFail: ['CountsOnlyOwnOrg'] },
  { spec: 'EvalCandidate', setting: '"What was wrong? #151 is done" closes #151', model: EvalCandidate({ Fixes: FIXED, Bug: 'feedbackApplies' }), expectFail: ['NoRecordChanges'] },
];
