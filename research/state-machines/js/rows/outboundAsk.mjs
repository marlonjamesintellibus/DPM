// M32 Outbound ask (atlas-conversational-plan.md, section 15), in the checks.mjs format so run-all.mjs
// can take these rows in with the rest.
import OutboundAsk, { ALL_FIXES } from '../models/outboundAsk.mjs';

const FIXED = { Fixes: ALL_FIXES };
const without = (f) => ({ Fixes: ALL_FIXES.filter((x) => x !== f) });

// expectFail lists the properties expected to fail; everything else should pass
export const ROWS = [
  // The table as section 15 draws it breaks three properties; each fix is needed, and together they pass.
  // Without F3 a reply that reached Kyle during a send that then sticks is never filed either
  { spec: 'OutboundAsk', setting: 'as written (section 15 table)', model: OutboundAsk(), expectFail: ['NothingGetsStuck', 'ReplyNotLost', 'MootChaseCloses'] },
  { spec: 'OutboundAsk', setting: 'F1 to F3 added (proposed)', model: OutboundAsk(FIXED), expectFail: [] },
  { spec: 'OutboundAsk', setting: 'without F1: no REPLY from reminded, a late reply has nowhere to go', model: OutboundAsk(without('F1')), expectFail: ['ReplyNotLost'] },
  { spec: 'OutboundAsk', setting: 'without F2: reminded and sending do not close on CH4, CH10', model: OutboundAsk(without('F2')), expectFail: ['MootChaseCloses'] },
  { spec: 'OutboundAsk', setting: 'without F3: losing reach while sending or waiting', model: OutboundAsk(without('F3')), expectFail: ['NothingGetsStuck', 'ReplyNotLost'] },
];

// Planted bugs, each on the fixed design: each one must make a full check fail
export const PLANTS = [
  { spec: 'OutboundAsk', setting: 'bug: the asker cancels while the message is being sent', model: OutboundAsk({ ...FIXED, Bug: 'cancelWhileSending' }), expectFail: ['OnlyDrawnArrows'] },
  { spec: 'OutboundAsk', setting: 'bug: the reminder timer never fires', model: OutboundAsk({ ...FIXED, Bug: 'noReminderTimer' }), expectFail: ['NothingGetsStuck'] },
  { spec: 'OutboundAsk', setting: 'bug: a reply to an ended chase is dropped', model: OutboundAsk({ ...FIXED, Bug: 'dropLateReply' }), expectFail: ['ReplyNotLost'] },
  { spec: 'OutboundAsk', setting: 'bug: a retry after a lost acknowledgement sends again', model: OutboundAsk({ ...FIXED, Bug: 'noMessageId' }), expectFail: ['OnceOnly'] },
  { spec: 'OutboundAsk', setting: 'bug: the same reply delivered twice proposes twice', model: OutboundAsk({ ...FIXED, Bug: 'noReplyDedup' }), expectFail: ['OnceOnly'] },
  { spec: 'OutboundAsk', setting: 'bug: the send job does not recheck who the asker can reach', model: OutboundAsk({ ...FIXED, Bug: 'noRecheckAtSend' }), expectFail: ['RightCheckedWhenItRuns'] },
  { spec: 'OutboundAsk', setting: 'bug: an asker who left the project can still save the reply', model: OutboundAsk({ ...FIXED, Bug: 'noRecheckAtSave' }), expectFail: ['RightCheckedWhenItRuns'] },
  { spec: 'OutboundAsk', setting: "bug: Kyle's answer resolves the blocker", model: OutboundAsk({ ...FIXED, Bug: 'autoApply' }), expectFail: ['AtlasNeverChangesRecord'] },
  { spec: 'OutboundAsk', setting: "bug: the draft carries #151's forecast", model: OutboundAsk({ ...FIXED, Bug: 'draftLeaks' }), expectFail: ['EveryReaderMaySee'] },
  { spec: 'OutboundAsk', setting: "bug: the PM confirms Kemar's chase", model: OutboundAsk({ ...FIXED, Bug: 'pmConfirms' }), expectFail: ['OutwardIsConfirmed'] },
  { spec: 'OutboundAsk', setting: 'bug: an outsider gets "not on your projects"', model: OutboundAsk({ ...FIXED, Bug: 'revealOutsider' }), expectFail: ['NothingHintedAboutHidden'] },
  { spec: 'OutboundAsk', setting: 'bug: CH5 matches any chase to Kyle, Store Insights too', model: OutboundAsk({ ...FIXED, Bug: 'matchByWords' }), expectFail: ['NothingHintedAboutHidden'] },
  { spec: 'OutboundAsk', setting: "bug: an update in Kyle's reply is saved as his", model: OutboundAsk({ ...FIXED, Bug: 'saveAsReplier' }), expectFail: ['YourWordChangesOnlyYours'] },
  { spec: 'OutboundAsk', setting: 'bug: a failed send is not told to the asker', model: OutboundAsk({ ...FIXED, Bug: 'silentFail' }), expectFail: ['AskerIsTold'] },
  { spec: 'OutboundAsk', setting: 'bug: the reminder goes out after the blocker was resolved', model: OutboundAsk({ ...FIXED, Bug: 'remindAfterResolved' }), expectFail: ['MootChaseCloses'] },
];
