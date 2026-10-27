// M20 Chat command (use-cases/atlas-conversational-plan.md, phase B), in the checks.mjs format.
// To be joined to ROWS and PLANTS in checks.mjs. Alicia and Kemar are checked one at a time: they
// share no command, and together they pass a million states.
import ChatCommand from '../models/chatCommand.mjs';

// The plants run on the fixed design, so what fails is the bug, not the finding below
const FIXED = { ReferentCheck: 'lines_now' };
const ALICIA = { ...FIXED, Askers: ['alicia'] };
const KEMAR = { ...FIXED, Askers: ['kemar'] };

export const ROWS = [
  // As written, AC9 checks a reply against the open answer's lines, a snapshot. Alicia asks, the risk
  // is approved on the screen, she leaves Forager, and her "Approve the Kyle risk" makes a card that
  // names the risk as it is now, in a project she can no longer read (P10).
  { spec: 'ChatCommand', setting: "as written, Alicia asks (a reply checked against the answer's lines)", model: ChatCommand({ Askers: ['alicia'] }), expectFail: ['NothingUnseenNamed'] },
  { spec: 'ChatCommand', setting: 'as written, Kemar asks', model: ChatCommand({ Askers: ['kemar'] }), expectFail: ['NothingUnseenNamed'] },
  { spec: 'ChatCommand', setting: 'Alicia asks, a reply checked against her lines now (proposed fix)', model: ChatCommand(ALICIA), expectFail: [] },
  { spec: 'ChatCommand', setting: 'Kemar asks, a reply checked against his lines now (proposed fix)', model: ChatCommand(KEMAR), expectFail: [] },
];

export const PLANTS = [
  { spec: 'ChatCommand', setting: 'bug: Confirm on an expired card still runs', model: ChatCommand({ ...KEMAR, Bug: 'reviveExpired' }), expectFail: ['OnlyDrawnArrows'] },
  { spec: 'ChatCommand', setting: 'bug: the 30 minute timer is never set', model: ChatCommand({ ...KEMAR, Bug: 'noExpiry' }), expectFail: ['CardsEnd'] },
  // The second run also skips both guards: the version has moved, and Kemar may have left by then
  { spec: 'ChatCommand', setting: 'bug: a second tap runs the command again', model: ChatCommand({ ...KEMAR, Bug: 'rerun' }), expectFail: ['OnceOnly', 'VersionSeenAtRun', 'RightHeldAtRun'] },
  // With the right taken from the answer, the version check comes first in effect: Kemar, gone from
  // Forager, is told the blocker was resolved after he left
  { spec: 'ChatCommand', setting: 'bug: the right is the one the answer saw', model: ChatCommand({ ...KEMAR, Bug: 'rightAtCard' }), expectFail: ['RightHeldAtRun', 'NothingUnseenNamed'] },
  { spec: 'ChatCommand', setting: 'bug: the version seen is not checked', model: ChatCommand({ ...KEMAR, Bug: 'noVersionCheck' }), expectFail: ['VersionSeenAtRun'] },
  // Running at once is an arrow nobody drew, made by Atlas, who holds no right
  { spec: 'ChatCommand', setting: 'bug: Atlas runs a clear match without a card', model: ChatCommand({ ...KEMAR, Bug: 'atlasActs' }), expectFail: ['AtlasNeverChanges', 'OnlyDrawnArrows', 'RightHeldAtRun', 'YourWordOnly'] },
  { spec: 'ChatCommand', setting: 'bug: Cancel declines the risk', model: ChatCommand({ ...ALICIA, Bug: 'cancelDeclines' }), expectFail: ['RecordChangesOnlyWhenRun'] },
  { spec: 'ChatCommand', setting: 'bug: one tap confirms every card of "all of them"', model: ChatCommand({ ...ALICIA, Bug: 'oneTapForAll' }), expectFail: ['OneDecisionPerTap'] },
  // The guard then checks Alicia's right, not Kemar's, so it runs, or tells a Kemar who left what changed
  { spec: 'ChatCommand', setting: 'bug: "Alicia approved it" from Kemar makes a card in her name', model: ChatCommand({ ...KEMAR, Bug: 'claimCounts' }), expectFail: ['YourWordOnly', 'RightHeldAtRun', 'NothingUnseenNamed'] },
  // A card on Store Insights names it to Kemar, who is not in it
  { spec: 'ChatCommand', setting: 'bug: the record Atlas names is trusted', model: ChatCommand({ ...KEMAR, Bug: 'trustReferent' }), expectFail: ['CommandsOnlyOnOwnLines', 'NothingUnseenNamed'] },
  { spec: 'ChatCommand', setting: 'bug: the answer lists Store Insights', model: ChatCommand({ ...KEMAR, Bug: 'leakLines' }), expectFail: ['NothingUnseenNamed'] },
  { spec: 'ChatCommand', setting: 'bug: the version is checked before the right', model: ChatCommand({ ...KEMAR, Bug: 'versionFirst' }), expectFail: ['NothingUnseenNamed'] },
];
