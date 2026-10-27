// Check rows for M26 Group message and M27 Group answer (atlas-conversational-plan.md, section 11),
// in the checks.mjs format, to be added to its ROWS and PLANTS.
import GroupChat from '../models/groupChat.mjs';

// The fixes to what the plan writes (see the model's header); the plants run on top of them
const FIXED = { Branches: 'edge_cases', Post: 'filter_at_post', M34Guard: true, History: 'from_join' };

// expectFail lists the properties expected to fail; everything else should pass
export const ROWS = [
  // As the plan writes it: M26 draws no GR9 branch (so M34 is never reached here), M27 rechecks only the member list
  { spec: 'GroupChat', setting: 'as written', model: GroupChat({ Branches: 'drawn', Post: 'as_written', M34Guard: false }), expectFail: ['YourWordYourRecords', 'EveryReaderMaySee', 'QuestionAnswered'] },
  // GR9 as the edge-case table writes it, with M34 as drawn: CONFIRM has no guard
  { spec: 'GroupChat', setting: 'as written, with the GR9 branch to M34', model: GroupChat({ Post: 'as_written', M34Guard: false }), expectFail: ['EveryReaderMaySee', 'QuestionAnswered', 'RightHeldWhenItRuns'] },
  { spec: 'GroupChat', setting: 'fixed but M26 as drawn ("Kemar says #145 is done" is the sender\'s update)', model: GroupChat({ ...FIXED, Branches: 'drawn' }), expectFail: ['YourWordYourRecords'] },
  { spec: 'GroupChat', setting: 'fixed but M27 as written (member list rechecked, reads not; recompose without end)', model: GroupChat({ ...FIXED, Post: 'as_written' }), expectFail: ['EveryReaderMaySee', 'QuestionAnswered'] },
  { spec: 'GroupChat', setting: 'fixed but M34 CONFIRM unguarded', model: GroupChat({ ...FIXED, M34Guard: false }), expectFail: ['RightHeldWhenItRuns'] },
  { spec: 'GroupChat', setting: 'fixed, joiners see earlier messages', model: GroupChat({ ...FIXED, History: 'shown' }), expectFail: ['EveryReaderMaySee'] },
  { spec: 'GroupChat', setting: 'fixed (GR9 and GR12 branches, filter at post, M34 guard, history from join)', model: GroupChat(FIXED), expectFail: [] },
];

// Planted bugs: each one must make a full check fail
export const PLANTS = [
  { spec: 'GroupChat', setting: 'bug: a repeat delivery is read again', model: GroupChat({ ...FIXED, Bug: 'noDedup' }), expectFail: ['OnceOnly', 'OnlyDrawnArrows'] },
  { spec: 'GroupChat', setting: 'bug: an expired attributed item can still be confirmed', model: GroupChat({ ...FIXED, Bug: 'confirmAfterExpiry' }), expectFail: ['OnlyDrawnArrows'] },
  { spec: 'GroupChat', setting: 'bug: the attributed item never expires', model: GroupChat({ ...FIXED, Bug: 'noAttTimer' }), expectFail: ['WaitsEnd'] },
  { spec: 'GroupChat', setting: 'bug: Atlas never takes the member list', model: GroupChat({ ...FIXED, Bug: 'noAudience' }), expectFail: ['QuestionAnswered'] },
  { spec: 'GroupChat', setting: 'bug: a command runs on the right held when it was asked', model: GroupChat({ ...FIXED, Bug: 'rightAtAsk' }), expectFail: ['RightHeldWhenItRuns'] },
  { spec: 'GroupChat', setting: 'bug: Atlas saves a group update without review', model: GroupChat({ ...FIXED, Bug: 'autoSave' }), expectFail: ['AtlasNeverChangesARecord'] },
  { spec: 'GroupChat', setting: "bug: the group answer uses the asker's reads", model: GroupChat({ ...FIXED, Bug: 'askerReads' }), expectFail: ['EveryReaderMaySee'] },
  { spec: 'GroupChat', setting: 'bug: "+1" is credited to the person replied to', model: GroupChat({ ...FIXED, Bug: 'creditOriginal' }), expectFail: ['YourWordYourRecords'] },
  { spec: 'GroupChat', setting: 'bug: the confirm card is put in the group', model: GroupChat({ ...FIXED, Bug: 'cardInGroup' }), expectFail: ['GroupHearsOnlyAnswers', 'OnlyTheirOwnConfirm'] },
  { spec: 'GroupChat', setting: 'bug: "what needs me?" is answered in the group', model: GroupChat({ ...FIXED, Bug: 'personalInGroup' }), expectFail: ['GroupHearsOnlyAnswers', 'EveryReaderMaySee'] },
  { spec: 'GroupChat', setting: 'bug: "Got it" is said in the group', model: GroupChat({ ...FIXED, Bug: 'gotItInGroup' }), expectFail: ['GroupHearsOnlyAnswers'] },
  { spec: 'GroupChat', setting: 'bug: the answer says some facts were left out', model: GroupChat({ ...FIXED, Bug: 'hint' }), expectFail: ['NoHintOfMore'] },
  { spec: 'GroupChat', setting: 'bug: a capture is kept for an ignored message', model: GroupChat({ ...FIXED, Bug: 'storeStrangers' }), expectFail: ['IgnoredStoresNothing'] },
  { spec: 'GroupChat', setting: 'bug: an edit after save reopens the update', model: GroupChat({ ...FIXED, Bug: 'editAfterSave' }), expectFail: ['SavedStaysSaved', 'OnlyDrawnArrows'] },
  { spec: 'GroupChat', setting: 'bug: a deleted message keeps its update waiting', model: GroupChat({ ...FIXED, Bug: 'deleteKeeps' }), expectFail: ['DeletedWithdrawn'] },
];
