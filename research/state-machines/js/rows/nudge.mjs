// The model settings for M23 Nudge and M24 Nudge settings (use-cases/atlas-conversational-plan.md,
// section 8, phase F), in the format of ../checks.mjs, kept apart so they can be added to ROWS and PLANTS there.
import Nudge, { FIXED } from '../models/nudge.mjs';

const without = (fix) => ({ ...FIXED, [fix]: false });

// expectFail lists the properties expected to fail; everything else should pass
export const ROWS = [
  // The plan as written. Each failure is one of the four design findings; the rows after take them one at a time
  { spec: 'Nudge', setting: 'as written: a due-date check', model: Nudge({ World: 'due' }), expectFail: ['NudgeEnds', 'RightCheckedWhenItRuns', 'GuardsHoldWhenSent', 'QuotedReplyGoesToItsNudge'] },
  { spec: 'Nudge', setting: 'as written: two nudges, cap of 1', model: Nudge({ World: 'two', Cap: 1 }), expectFail: ['NudgeEnds', 'CapHolds', 'GuardsHoldWhenSent', 'QuotedReplyGoesToItsNudge'] },
  { spec: 'Nudge', setting: 'as written: mention alerts', model: Nudge({ World: 'mentions' }), expectFail: ['NudgeEnds', 'RightCheckedWhenItRuns'] },
  { spec: 'Nudge', setting: 'as written: morning brief', model: Nudge({ World: 'brief' }), expectFail: ['NudgeEnds', 'RightCheckedWhenItRuns'] },
  { spec: 'Nudge', setting: 'fixed, but no timer on sending', model: Nudge({ World: 'due', ...without('SendTimer') }), expectFail: ['NudgeEnds'] },
  { spec: 'Nudge', setting: 'fixed, but the retry goes straight to sending', model: Nudge({ World: 'due', ...without('RetryRecomposes') }), expectFail: ['RightCheckedWhenItRuns', 'GuardsHoldWhenSent'] },
  { spec: 'Nudge', setting: 'fixed, but the cap counts only sent nudges', model: Nudge({ World: 'two', Cap: 1, ...without('CapReserves') }), expectFail: ['CapHolds'] },
  { spec: 'Nudge', setting: 'fixed, but a reply answers only a sent nudge', model: Nudge({ World: 'due', ...without('ReplyWhileSending') }), expectFail: ['QuotedReplyGoesToItsNudge'] },
  // The plan with the four fixes
  { spec: 'Nudge', setting: 'fixed: a due-date check', model: Nudge({ World: 'due', ...FIXED }), expectFail: [] },
  { spec: 'Nudge', setting: 'fixed: two nudges, cap of 1', model: Nudge({ World: 'two', Cap: 1, ...FIXED }), expectFail: [] },
  { spec: 'Nudge', setting: 'fixed: two nudges, cap of 2 (replies)', model: Nudge({ World: 'two', Cap: 2, ...FIXED }), expectFail: [] },
  { spec: 'Nudge', setting: 'fixed: mention alerts', model: Nudge({ World: 'mentions', ...FIXED }), expectFail: [] },
  { spec: 'Nudge', setting: 'fixed: morning brief', model: Nudge({ World: 'brief', ...FIXED }), expectFail: [] },
];

// Planted bugs, each on the fixed plan: each one must make a full check fail
export const PLANTS = [
  { spec: 'Nudge', setting: 'bug: a skipped nudge is sent once its kind is on again', model: Nudge({ World: 'due', ...FIXED, Bug: 'reviveSkipped' }), expectFail: ['OnlyDrawnArrows'] },
  { spec: 'Nudge', setting: 'bug: no nudgeReplyHours timer', model: Nudge({ World: 'due', ...FIXED, Bug: 'noReplyTimer' }), expectFail: ['NudgeEnds'] },
  { spec: 'Nudge', setting: 'bug: a repeat event schedules a second nudge', model: Nudge({ World: 'due', ...FIXED, Bug: 'noKey' }), expectFail: ['OneNudgePerKey'] },
  { spec: 'Nudge', setting: 'bug: a resend carries no nudge id', model: Nudge({ World: 'due', ...FIXED, Bug: 'noSendId' }), expectFail: ['DeliveredOnce'] },
  { spec: 'Nudge', setting: 'bug: a repeated reply is read again', model: Nudge({ World: 'due', ...FIXED, Bug: 'replyTwice' }), expectFail: ['ReadOnce'] },
  { spec: 'Nudge', setting: 'bug: the right is checked only when scheduled', model: Nudge({ World: 'mentions', ...FIXED, Bug: 'rightAtSchedule' }), expectFail: ['RightCheckedWhenItRuns'] },
  { spec: 'Nudge', setting: 'bug: a mention alert ignores who can see the quote', model: Nudge({ World: 'mentions', ...FIXED, Bug: 'leakMention' }), expectFail: ['RightCheckedWhenItRuns'] },
  { spec: 'Nudge', setting: 'bug: the setting is read when scheduled', model: Nudge({ World: 'due', ...FIXED, Bug: 'settingAtSchedule' }), expectFail: ['GuardsHoldWhenSent'] },
  { spec: 'Nudge', setting: 'bug: the brief counts what Kemar cannot open', model: Nudge({ World: 'brief', ...FIXED, Bug: 'countHidden' }), expectFail: ['NothingHiddenIsHinted'] },
  { spec: 'Nudge', setting: 'bug: an empty brief is sent', model: Nudge({ World: 'brief', ...FIXED, Bug: 'sendEmpty' }), expectFail: ['EmptyNotSent'] },
  { spec: 'Nudge', setting: 'bug: no daily cap', model: Nudge({ World: 'two', Cap: 1, ...FIXED, Bug: 'noCap' }), expectFail: ['CapHolds'] },
  { spec: 'Nudge', setting: 'bug: "yes, still on" moves #151 itself', model: Nudge({ World: 'due', ...FIXED, Bug: 'replyApplies' }), expectFail: ['AtlasNeverChangesARecord'] },
  { spec: 'Nudge', setting: "bug: Kemar's confirm applies Alicia's #160", model: Nudge({ World: 'due', ...FIXED, Bug: 'othersApplied' }), expectFail: ['YourWordChangesOnlyYours'] },
  { spec: 'Nudge', setting: 'bug: a reply goes to the newest nudge, not the one it quotes', model: Nudge({ World: 'two', Cap: 2, ...FIXED, Bug: 'newestAlways' }), expectFail: ['QuotedReplyGoesToItsNudge'] },
  { spec: 'Nudge', setting: "bug: a lead switches off someone else's nudges", model: Nudge({ World: 'due', ...FIXED, Bug: 'leadChanges' }), expectFail: ['OnlyTheyChangeTheirSettings'] },
];
