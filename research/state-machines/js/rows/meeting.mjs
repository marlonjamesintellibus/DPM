// The model settings for M33 Meeting capture and M34 Attributed item (atlas-conversational-plan.md,
// section 17, phase O), in the checks.mjs format, to be added to ROWS and PLANTS there.
import Meeting from '../models/meeting.mjs';

const FIXED = { Design: 'fixed' };

// expectFail lists the properties expected to fail; everything else should pass
export const ROWS = [
  // As section 17 draws it, six rules break (the traces are the design findings; RightCheckedWhenItRuns was
  // found by the fix check of 28 Oct, once the record the thing about Alicia changes could change hands)
  {
    spec: 'Meeting',
    setting: 'as written',
    model: Meeting(),
    expectFail: ['NotToldReadAsOwnNotes', 'NoAskOnAGuess', 'DecisionsConfirmedTwice', 'OpenAsksOnlyToMembers', 'NeverExpiresWhileAway', 'RightCheckedWhenItRuns'],
  },
  { spec: 'Meeting', setting: 'with the seven fixes (proposed)', model: Meeting(FIXED), expectFail: [] },
];

// Planted bugs on the fixed design: each one must make a full check fail
export const PLANTS = [
  { spec: 'Meeting', setting: 'bug: a confirm after expiry revives the item', model: Meeting({ ...FIXED, Bug: 'lateConfirm' }), expectFail: ['OnlyDrawnArrows'] },
  { spec: 'Meeting', setting: 'bug: the attributedExpiryDays timer never fires', model: Meeting({ ...FIXED, Bug: 'noAttributedTimer' }), expectFail: ['JobEnds', 'AsksEnd'] },
  { spec: 'Meeting', setting: 'bug: a second Confirm files it again', model: Meeting({ ...FIXED, Bug: 'noDedup' }), expectFail: ['OnceOnly'] },
  { spec: 'Meeting', setting: 'bug: approval checks the role held when the decision was proposed', model: Meeting({ ...FIXED, Bug: 'rightAtAsk' }), expectFail: ['RightCheckedWhenItRuns'] },
  { spec: 'Meeting', setting: 'bug: "we agreed" in the meeting approves the decision', model: Meeting({ ...FIXED, Bug: 'approveByText' }), expectFail: ['AtlasChangesNoRecord', 'OnlyDrawnArrows', 'RightCheckedWhenItRuns', 'DecisionsConfirmedTwice'] },
  { spec: 'Meeting', setting: "bug: the recorder's Save files what was said about Alicia", model: Meeting({ ...FIXED, Bug: 'recorderConfirms' }), expectFail: ['YourWordOnlyYours', 'RightCheckedWhenItRuns'] },
  { spec: 'Meeting', setting: "bug: Kyle's promise is filed as his", model: Meeting({ ...FIXED, Bug: 'fileKyle' }), expectFail: ['NothingFiledAsKyles', 'AtlasChangesNoRecord'] },
  { spec: 'Meeting', setting: 'bug: a decline is not told to the recorder', model: Meeting({ ...FIXED, Bug: 'silentDecline' }), expectFail: ['DeclineTellsRecorder'] },
  // Each fix turned off on its own: the property it was added for fails again
  { spec: 'Meeting', setting: "bug: no way to read a note as the recorder's own (MT4)", model: Meeting({ ...FIXED, Bug: 'noOwnNotes' }), expectFail: ['NotToldReadAsOwnNotes'] },
  { spec: 'Meeting', setting: 'bug: an unsure speaker is sent anyway (MT2)', model: Meeting({ ...FIXED, Bug: 'sendOnGuess' }), expectFail: ['NoAskOnAGuess'] },
  { spec: 'Meeting', setting: 'bug: decisions go straight to the deciders', model: Meeting({ ...FIXED, Bug: 'decisionStraightToDeciders' }), expectFail: ['DecisionsConfirmedTwice'] },
  { spec: 'Meeting', setting: 'bug: Andre is asked about Forager, a project he is not in', model: Meeting({ ...FIXED, Bug: 'askOutsider' }), expectFail: ['OpenAsksOnlyToMembers'] },
  { spec: 'Meeting', setting: "bug: leaving Forager leaves Alicia's ask open (E77)", model: Meeting({ ...FIXED, Bug: 'noWithdrawOnLeave' }), expectFail: ['OpenAsksOnlyToMembers'] },
  { spec: 'Meeting', setting: 'bug: the ask runs out while Alicia is on leave (MT12)', model: Meeting({ ...FIXED, Bug: 'timerOnLeave' }), expectFail: ['NeverExpiresWhileAway'] },
  { spec: 'Meeting', setting: 'bug: Alicia confirms a change to a record that is no longer hers', model: Meeting({ ...FIXED, Bug: 'ownerAtAsk' }), expectFail: ['RightCheckedWhenItRuns'] },
];
