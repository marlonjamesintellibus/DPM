// M29 Signal (use-cases/atlas-conversational-plan.md, section 13, phase K), in the checks.mjs format.
// Run with check() from ../checker.mjs; run-all.mjs does not import this file yet.
import Signal from '../models/signal.mjs';

// The fixes for the findings: remember every answer per episode, and draw the stale work escalation
const FIXED = { Memory: 'perEpisode', Escalate: true };

// expectFail lists the properties expected to fail; everything else should pass
export const ROWS = [
  // As written, accept and expiry leave nothing behind, so the next nightly run raises the same signal
  // again; and a dismissal is remembered forever, so the same trouble coming back is never raised
  { spec: 'Signal', setting: 'repeated blocker, as written', model: Signal({ Rule: 'blocker' }), expectFail: ['NotRaisedAgainUnchanged', 'TroubleIsRaised'] },
  // As written, stale work raised to its owner has no arrow to PM and Leads; it expires unseen by them,
  // and the next night it is raised to the owner again. Nobody can dismiss it, so TroubleIsRaised holds.
  { spec: 'Signal', setting: 'stale work, as written', model: Signal({ Rule: 'stale' }), expectFail: ['NotRaisedAgainUnchanged', 'StaleWorkReachesLeads'] },
  { spec: 'Signal', setting: 'stale work, memory per episode, no escalation', model: Signal({ Rule: 'stale', Memory: 'perEpisode' }), expectFail: ['StaleWorkReachesLeads'] },
  { spec: 'Signal', setting: 'repeated blocker, memory per episode (fixed)', model: Signal({ Rule: 'blocker', Memory: 'perEpisode' }), expectFail: [] },
  { spec: 'Signal', setting: 'stale work, memory per episode, escalation drawn (fixed)', model: Signal({ Rule: 'stale', ...FIXED }), expectFail: [] },
];

// Planted bugs on the fixed design: each one must make a full check fail
export const PLANTS = [
  { spec: 'Signal', setting: 'bug: CONDITION_GONE also clears accepted and expired signals', model: Signal({ ...FIXED, Bug: 'goneClearsAny' }), expectFail: ['OnlyDrawnArrows'] },
  { spec: 'Signal', setting: 'bug: the expiry timer never fires', model: Signal({ ...FIXED, Bug: 'noExpiry' }), expectFail: ['NothingStuck'] },
  { spec: 'Signal', setting: 'bug: DETECTED raises a second live signal', model: Signal({ ...FIXED, Bug: 'noKey' }), expectFail: ['OneLivePerSubject'] },
  { spec: 'Signal', setting: 'bug: the risk is filed before the arrow is checked (repeated blocker)', model: Signal({ Rule: 'blocker', Memory: 'perEpisode', MaxEpisodes: 1, Bug: 'acceptTwice' }), expectFail: ['OneRiskPerSignal'] },
  { spec: 'Signal', setting: 'bug: an expired signal is forgotten', model: Signal({ ...FIXED, Bug: 'forgetOnExpiry' }), expectFail: ['NotRaisedAgainUnchanged'] },
  { spec: 'Signal', setting: 'bug: "only if worse" ignores the episode', model: Signal({ ...FIXED, Bug: 'ignoreEpisode' }), expectFail: ['TroubleIsRaised'] },
  { spec: 'Signal', setting: 'bug: the right is the one the card was shown with', model: Signal({ ...FIXED, Bug: 'rightWhenShown' }), expectFail: ['RightCheckedWhenItRuns'] },
  { spec: 'Signal', setting: 'bug: an answer on an old card is applied', model: Signal({ ...FIXED, Bug: 'noVersionCheck' }), expectFail: ['AnswerOnCurrentCard'] },
  { spec: 'Signal', setting: 'bug: a PM who left Forager keeps the copy', model: Signal({ ...FIXED, Bug: 'keepCopy' }), expectFail: ['EveryReaderMaySeeEveryFact'] },
  { spec: 'Signal', setting: 'bug: the text cites a Store Insights fact', model: Signal({ ...FIXED, Bug: 'leakFact' }), expectFail: ['EveryReaderMaySeeEveryFact'] },
  { spec: 'Signal', setting: 'bug: Atlas files the risk itself', model: Signal({ ...FIXED, Bug: 'atlasProposes' }), expectFail: ['AtlasChangesNoRecord', 'OneRiskPerSignal'] },
  { spec: 'Signal', setting: 'bug: "Kemar\'s still on it" from Alicia restarts his clock', model: Signal({ ...FIXED, Bug: 'othersRestart' }), expectFail: ['YourWordOnlyYours'] },
  { spec: 'Signal', setting: 'bug: the risk is filed as reported by Kemar', model: Signal({ ...FIXED, Bug: 'fileAsOwner' }), expectFail: ['YourWordOnlyYours'] },
  { spec: 'Signal', setting: 'bug: stale work raised while its owner is on leave', model: Signal({ ...FIXED, Bug: 'raiseOnLeave' }), expectFail: ['NotRaisedWhileAway'] },
  { spec: 'Signal', setting: 'bug: the expiry clock runs while only the owner has it', model: Signal({ ...FIXED, Bug: 'expireAtOwner' }), expectFail: ['StaleWorkReachesLeads'] },
];
