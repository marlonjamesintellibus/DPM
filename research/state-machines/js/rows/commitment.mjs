// The model settings for M22 Commitment (use-cases/atlas-conversational-plan.md, section 7), in the
// checks.mjs format, so they can join ROWS and PLANTS there. Each setting says only what it needs (Says)
// and the events around it (World), to stay well under a million states.
import Commitment, { ALL_FIXES } from '../models/commitment.mjs';

const FIXED = { Fixes: ALL_FIXES };

// expectFail lists the properties expected to fail; everything else should pass
export const ROWS = [
  // As the plan writes it. Each failure is in the design, with the fix below it.
  { spec: 'Commitment', setting: 'as written: the same promise while it is due (CM5)', model: Commitment({ Says: ['m1', 'm2'], World: ['leave'] }), expectFail: ['OnePerPromise'] },
  { spec: 'Commitment', setting: 'as written: "Sent Kyle the request" while it is due (CM6)', model: Commitment({ Says: ['m1', 'm3'], World: ['leave'] }), expectFail: ['NoAskAfterDone'] },
  { spec: 'Commitment', setting: 'as written: #208 Done or cancelled around the save (CM11)', model: Commitment({ Says: ['m1'], World: ['work'] }), expectFail: ['CancelledWorkAsks', 'NoAskAfterDone'] },
  // Each fix on its own leaves the other's failures
  { spec: 'Commitment', setting: 'fix anyLive only: #208 changed before the save', model: Commitment({ Says: ['m1'], World: ['work'], Fixes: ['anyLive'] }), expectFail: ['CancelledWorkAsks', 'NoAskAfterDone'] },
  { spec: 'Commitment', setting: 'fix recordAtSave only: #208 Done while it is due', model: Commitment({ Says: ['m1'], World: ['work'], Fixes: ['recordAtSave'] }), expectFail: ['NoAskAfterDone'] },
  // Both fixes
  { spec: 'Commitment', setting: 'fixed: one promise, every event around it', model: Commitment({ ...FIXED, Says: ['m1'] }), expectFail: [] },
  { spec: 'Commitment', setting: 'fixed: promise and done, every event around it', model: Commitment({ ...FIXED, Says: ['m1', 'm3'] }), expectFail: [] },
  { spec: 'Commitment', setting: 'fixed: promise, same promise, done, with leave', model: Commitment({ ...FIXED, Says: ['m1', 'm2', 'm3'], World: ['leave'] }), expectFail: [] },
  { spec: 'Commitment', setting: 'fixed: promise twice, repeats and leaving Forager', model: Commitment({ ...FIXED, Says: ['m1', 'm2'], World: ['repeat', 'project'] }), expectFail: [] },
  { spec: 'Commitment', setting: "fixed: Alicia's words about Kemar (CD5, rule 10)", model: Commitment({ ...FIXED, Says: ['m1', 'm4', 'm5'], World: ['work'] }), expectFail: [] },
  { spec: 'Commitment', setting: 'fixed: commitmentCheckIns = 1', model: Commitment({ ...FIXED, Says: ['m1', 'm3'], CheckIns: 1 }), expectFail: [] },
  // CD51 (W4-D2): a promise only about #208. As M22 drew it, #208 Done ends it, or saves it as No change
  { spec: 'Commitment', setting: 'without askWhenAbout: a promise only about #208, and #208 Done (CD51)', model: Commitment({ Fixes: ['anyLive', 'recordAtSave'], Says: ['m6'], World: ['work'] }), expectFail: ['AboutNotLost', 'WorkEndsOnlyDelivery'] },
  { spec: 'Commitment', setting: 'fixed: a promise only about #208, every event around it (CD51)', model: Commitment({ ...FIXED, Says: ['m6'] }), expectFail: [] },
  { spec: 'Commitment', setting: 'fixed: a promise about #208, then "Sent Kyle the request" (CD51)', model: Commitment({ ...FIXED, Says: ['m6', 'm3'], World: ['work'] }), expectFail: [] },
];

// Planted bugs, on the fixed design: each one must make a full check fail
const plant = (setting, opts, expectFail) => ({ spec: 'Commitment', setting: `bug: ${setting}`, model: Commitment({ ...FIXED, ...opts }), expectFail });

export const PLANTS = [
  plant('a late reply to a lapsed commitment reopens it', { Says: ['m1'], World: [], Bug: 'reviveLapsed' }, ['OnlyDrawnArrows']),
  plant('Atlas marks it done itself from "Sent Kyle the request"', { Says: ['m1', 'm3'], World: [], Bug: 'atlasMarksDone' }, ['AtlasOnlyProposes', 'YourWordOnlyYours']),
  plant('"Kemar sent Kyle the request" from Alicia marks his done', { Says: ['m1', 'm5'], World: [], Bug: 'othersDone' }, ['YourWordOnlyYours']),
  plant('"Kemar will send Kyle the request" from Alicia makes him a commitment', { Says: ['m4'], World: [], Bug: 'proposeForOthers' }, ['YourWordOnlyYours']),
  plant('the link Atlas proposed is kept at save after Kemar left Forager', { Says: ['m1'], World: ['project'], Bug: 'noRecheckAtSave' }, ['LinkOnlyWhileMember']),
  plant('leaving Forager keeps the link to #208', { Says: ['m1'], World: ['project'], Bug: 'keepLinkOnLeave' }, ['LinkOnlyWhileMember']),
  plant('the link is kept and check-ins and answers trust it', { Says: ['m1'], World: ['project'], Bug: ['keepLinkOnLeave', 'readsTrustLink'] }, ['LinkOnlyWhileMember', 'CheckInHoldsOnlyWhatOwnerMaySee', 'AnswerHoldsOnlyWhatViewerMaySee']),
  plant("Alicia's answer shows Kemar's commitment on #208 (the CD3 alternative)", { Says: ['m1'], World: [], Bug: 'showOnProject' }, ['AnswerHoldsOnlyWhatViewerMaySee']),
  plant('Omar is told there is one he cannot see', { Says: ['m1'], World: [], Bug: 'hintHidden' }, ['AnswerHoldsOnlyWhatViewerMaySee']),
  plant('a check-in goes out on a weekend or during leave', { Says: ['m1'], World: ['leave'], Bug: 'checkInWhileAway' }, ['NoCheckInWhileAway']),
  plant('a repeated Save or reply runs again', { Says: ['m1', 'm2'], World: ['repeat'], Bug: 'noDedup' }, ['AppliedAtMostOnce']),
  plant('the due timer never fires', { Says: ['m1'], World: [], Bug: 'noDueTimer' }, ['NothingStuck']),
  plant('no reply never lapses it', { Says: ['m1'], World: [], Bug: 'noLapseTimer' }, ['NothingStuck']),
  plant('after 3 moves the check-in does not offer to drop it', { Says: ['m1'], World: [], Bug: 'noDropAsk' }, ['DropAskedAfterMoves']),
  plant('#208 Done leaves the commitment waiting', { Says: ['m1'], World: ['work'], Bug: 'workDoneIgnored' }, ['NoAskAfterDone']),
  plant('#208 cancelled asks nothing', { Says: ['m1'], World: ['work'], Bug: 'noCancelAsk' }, ['CancelledWorkAsks']),
  plant('"still stands?" is asked again every day', { Says: ['m1'], World: ['work'], Bug: 'askEachTime' }, ['StandsAskedOnce']),
  plant('"still stands?" stays open after the commitment ends', { Says: ['m1'], World: ['work'], Bug: 'standsStays' }, ['StandsQuestionEnds']),
  plant('#208 Done still ends a promise only about it', { Says: ['m6'], World: ['work'], Bug: 'endAboutOnDone' }, ['AboutNotLost', 'WorkEndsOnlyDelivery']),
  plant('#208 Done asks nothing about a promise only about it', { Says: ['m6'], World: ['work'], Bug: 'noAboutAsk' }, ['DoneWorkAsksAbout']),
  plant('the same promise again opens a second one', { Says: ['m1', 'm2'], World: [], Bug: 'noMatch' }, ['OnePerPromise']),
];
