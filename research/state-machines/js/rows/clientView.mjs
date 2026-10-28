// The settings and planted bugs for a contact's client view (decision CD49, W3-D11; wave 4), in the
// format of ../checks.mjs, merged into its ROWS and PLANTS.
import ClientView from '../models/clientView.mjs';

// expectFail lists the properties expected to fail; everything else should pass
export const ROWS = [
  { spec: 'ClientView', setting: 'as built, one tab each', model: ClientView(), expectFail: [] },
  // Alicia in two tabs: both read the switch as on, and both turn it off
  { spec: 'ClientView', setting: 'as built, Alicia in two tabs', model: ClientView({ Tabs: 2 }), expectFail: [] },
];

// Planted bugs: each one must make a full check fail
export const PLANTS = [
  { spec: 'ClientView', setting: 'bug: the switch on her screen is the right (she left Forager)', model: ClientView({ Bug: 'checkWhenShown' }), expectFail: ['OnlyThePmNow'] },
  { spec: 'ClientView', setting: 'bug: any member turns it on or off', model: ClientView({ Bug: 'memberMayTurn' }), expectFail: ['OnlyThePmNow', 'EveryMoveAudited'] },
  { spec: 'ClientView', setting: 'bug: Jodian, in the org, gets a client view', model: ClientView({ Bug: 'noOutsideGuard' }), expectFail: ['OnOnlyForOutsideContacts'] },
  { spec: 'ClientView', setting: 'bug: the write is not over the flag as read (two tabs)', model: ClientView({ Tabs: 2, Bug: 'noCas' }), expectFail: ['TrailTellsTheTruth'] },
  { spec: 'ClientView', setting: 'bug: a repeat is written and audited', model: ClientView({ Bug: 'repeatAudited' }), expectFail: ['EveryAuditIsAMove'] },
  { spec: 'ClientView', setting: 'bug: a tie added back keeps its old switch', model: ClientView({ Bug: 'restoreKeepsOn' }), expectFail: ['NewTieStartsOff'] },
  { spec: 'ClientView', setting: 'bug: a move is written with no audit entry', model: ClientView({ Bug: 'noAudit' }), expectFail: ['EveryMoveAudited'] },
];
