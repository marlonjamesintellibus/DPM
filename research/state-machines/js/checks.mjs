// The model settings checked in section 11 of ../tla-plus-and-tlc.md.
import TrackedStatus from './models/trackedStatus.mjs';
import Capture from './models/capture.mjs';
import AtlasAction from './models/atlasAction.mjs';
import HelpRequest from './models/helpRequest.mjs';
import Opportunity from './models/opportunity.mjs';
import BraidEntry from './models/braidEntry.mjs';
import Routing from './models/routing.mjs';
import Match from './models/match.mjs';

// A smaller BRAID log for the Match plants that would otherwise explode
// (repeated merges reshuffle sources into many combinations): 1 report, 2 entries
const SMALL_BLOCKERS = {
  Existing: { b1: { kind: 'blocker', st: 'open', src: ['a1'], owner: 'kemar' }, b2: { kind: 'blocker', st: 'resolved', src: ['a2'], owner: 'kemar' } },
  Reports: { rep1: { by: 'kemar', creates: 'n1' } },
};
const SMALL_MIXED = {
  Existing: { b1: { kind: 'blocker', st: 'open', src: ['a1'], owner: 'kemar' }, r1: { kind: 'risk', st: 'open', src: ['a3'], owner: 'alicia' } },
  Reports: { rep1: { by: 'kemar', creates: 'n1' } },
};

// expectFail lists the properties expected to fail; everything else should pass
export const ROWS = [
  // SetStatusRespected and StaleReasonFlagged come from use case 1 (use-cases/01-update-to-plan-machines.md, M9)
  { spec: 'TrackedStatus', setting: 'ExpiryPolicy = "when_agree"', model: TrackedStatus({ ExpiryPolicy: 'when_agree' }), expectFail: ['DoneWins', 'StaleReasonFlagged'] },
  { spec: 'TrackedStatus', setting: 'ExpiryPolicy = "on_any_change"', model: TrackedStatus({ ExpiryPolicy: 'on_any_change' }), expectFail: ['SetStatusRespected'] },
  { spec: 'TrackedStatus', setting: 'ExpiryPolicy = "when_done"', model: TrackedStatus({ ExpiryPolicy: 'when_done' }), expectFail: ['StaleReasonFlagged'] },
  { spec: 'TrackedStatus', setting: 'ExpiryPolicy = "after_days"', model: TrackedStatus({ ExpiryPolicy: 'after_days' }), expectFail: ['DoneWins', 'StaleReasonFlagged'] },
  { spec: 'TrackedStatus', setting: '"when_done", ReasonStale (proposed)', model: TrackedStatus({ ExpiryPolicy: 'when_done', ReasonStale: true }), expectFail: [] },
  { spec: 'TrackedStatus', setting: '"when_agree", ReasonStale', model: TrackedStatus({ ExpiryPolicy: 'when_agree', ReasonStale: true }), expectFail: ['DoneWins'] },
  { spec: 'TrackedStatus', setting: '"on_any_change", ReasonStale', model: TrackedStatus({ ExpiryPolicy: 'on_any_change', ReasonStale: true }), expectFail: ['SetStatusRespected'] },
  { spec: 'Capture', setting: 'Dedup = FALSE', model: Capture({ Dedup: false }), expectFail: ['AppliedAtMostOnce'] },
  { spec: 'Capture', setting: 'Dedup = TRUE', model: Capture({ Dedup: true }), expectFail: [] },
  { spec: 'AtlasAction', setting: 'RecheckOnExecute = FALSE', model: AtlasAction({ RecheckOnExecute: false }), expectFail: ['ApproverHadAuthority'] },
  { spec: 'AtlasAction', setting: 'RecheckOnExecute = TRUE', model: AtlasAction({ RecheckOnExecute: true }), expectFail: [] },
  { spec: 'AtlasAction', setting: 'RecheckOnExecute = TRUE, ApprovalLapses removed', model: AtlasAction({ RecheckOnExecute: true, IncludeApprovalLapses: false }), expectFail: ['ApprovedActionsSettle'] },
  { spec: 'HelpRequest', setting: 'as given', model: HelpRequest({ Fair: true }), expectFail: [] },
  { spec: 'HelpRequest', setting: 'Fairness removed', model: HelpRequest({ Fair: false }), expectFail: ['NoSilentWait'] },
  { spec: 'Opportunity', setting: 'as given (stage kept when lost)', model: Opportunity({ KeepStageWhenLost: true }), expectFail: [] },
  { spec: 'Opportunity', setting: 'C11 as drawn (lost replaces stage)', model: Opportunity({ KeepStageWhenLost: false }), expectFail: ['Refines'] },
  // BraidEntry and Routing come from use case 1 (use-cases/01-update-to-plan-machines.md, M13 to M15)
  { spec: 'BraidEntry', setting: 'as given (right checked when approving)', model: BraidEntry(), expectFail: [] },
  // One risk is enough to show it, and keeps the run short (3 entries is 1.36M states)
  { spec: 'BraidEntry', setting: 'right checked when reported (1 risk)', model: BraidEntry({ Entries: { e1: 'risk' }, Conflicts: [], CheckRightWhen: 'on_report' }), expectFail: ['OnLogOnlyWithRight'] },
  { spec: 'Routing', setting: 'as given (membership checked at save)', model: Routing(), expectFail: [] },
  { spec: 'Routing', setting: 'RecheckAtSave = FALSE', model: Routing({ RecheckAtSave: false }), expectFail: ['OnlyMemberProjects'] },
  // Match is machines doc M16 plus the S13 blocker rule
  { spec: 'Match', setting: 'as given', model: Match(), expectFail: [] },
];

// Planted bugs: each one must make a full check fail (the Atlas map's "make plants")
export const PLANTS = [
  { spec: 'Capture', setting: 'bug: Medium confidence is pre-accepted', model: Capture({ Dedup: true, Bug: 'autoAcceptMedium' }), expectFail: ['NoAutoAcceptBelowHigh'] },
  { spec: 'TrackedStatus', setting: 'bug: no inbox item asks for a reason', model: TrackedStatus({ ExpiryPolicy: 'when_done', ReasonStale: true, Bug: 'noReasonItem' }), expectFail: ['ReasonRule'] },
  { spec: 'TrackedStatus', setting: 'bug: a reason goes stale and nobody is asked', model: TrackedStatus({ ExpiryPolicy: 'when_done', ReasonStale: true, Bug: 'noStaleItem' }), expectFail: ['StaleReasonAsked'] },
  // With RecheckOnExecute = TRUE this bug is harmless: the recheck refuses to run an action nobody
  // approved and sends it back for approval. So the plant turns the recheck off to test the invariant.
  { spec: 'AtlasAction', setting: 'bug: Atlas treats its request as approved (recheck off)', model: AtlasAction({ RecheckOnExecute: false, Bug: 'skipApproval' }), expectFail: ['NothingRunsWithoutApproval', 'ApproverHadAuthority'] },
  { spec: 'AtlasAction', setting: 'same bug, recheck on', model: AtlasAction({ RecheckOnExecute: true, Bug: 'skipApproval' }), expectFail: [] },
  { spec: 'HelpRequest', setting: 'bug: the 60 minute timer never fires', model: HelpRequest({ Bug: 'noTimer' }), expectFail: ['NoSilentWait'] },
  { spec: 'BraidEntry', setting: 'bug: "Andre and I agreed" counts as the approval', model: BraidEntry({ Bug: 'approveByText' }), expectFail: ['DecisionNeverApprovedByText', 'OnLogOnlyWithRight'] },
  { spec: 'BraidEntry', setting: 'bug: a proposal approves itself after the reminders', model: BraidEntry({ Bug: 'autoApprove' }), expectFail: ['NothingDecidesItself', 'OnLogOnlyWithRight'] },
  { spec: 'BraidEntry', setting: 'bug: approving a decision does not supersede the one it conflicts with', model: BraidEntry({ Bug: 'noSupersede' }), expectFail: ['ConflictsNeverSilent'] },
  { spec: 'BraidEntry', setting: 'bug: nobody is told when no one can approve', model: BraidEntry({ Bug: 'noDeciderItem' }), expectFail: ['SomeoneIsAsked'] },
  // With the save recheck on, this bug cannot file anything wrongly: the recheck withdraws the item.
  // The routing check still fails, because Kemar would be shown a project he is not in.
  { spec: 'Routing', setting: 'bug: the project Atlas names is trusted', model: Routing({ Bug: 'trustAtlas' }), expectFail: ['RoutedOnlyToCandidates'] },
  { spec: 'Routing', setting: 'same bug, save recheck off', model: Routing({ Bug: 'trustAtlas', RecheckAtSave: false }), expectFail: ['RoutedOnlyToCandidates', 'OnlyMemberProjects'] },
  { spec: 'Routing', setting: 'bug: a project member sees the whole capture', model: Routing({ Bug: 'leakCapture' }), expectFail: ['NoCrossProjectQuote'] },
  { spec: 'Routing', setting: 'bug: the org tag is ignored on dashboards', model: Routing({ Bug: 'ignoreOrgTag' }), expectFail: ['NoCrossOrg'] },
  { spec: 'Routing', setting: 'bug: Save allowed while an item needs a project', model: Routing({ Bug: 'saveWithChoose' }), expectFail: ['NothingFiledWhileChoosing'] },
  { spec: 'Match', setting: "bug: Atlas's match is saved without the speaker confirming it", model: Match({ Bug: 'silentAttach' }), expectFail: ['SourceOnlyAfterConfirm', 'ChangedMatchIsAConflict'] },
  { spec: 'Match', setting: 'bug: a match to an entry of another kind is kept', model: Match({ Bug: 'trustKind' }), expectFail: ['NeverAcrossKinds'] },
  { spec: 'Match', setting: 'bug: the PM can merge a blocker into a risk (small log)', model: Match({ ...SMALL_MIXED, Bug: 'crossKindMerge' }), expectFail: ['NeverAcrossKinds'] },
  { spec: 'Match', setting: 'bug: merge copies sources instead of moving them', model: Match({ Bug: 'mergeCopies' }), expectFail: ['EveryReportOnce'] },
  { spec: 'Match', setting: 'bug: merge loses the sources it should carry over', model: Match({ Bug: 'mergeDrops' }), expectFail: ['EveryReportOnce'] },
  { spec: 'Match', setting: 'bug: unmerge leaves the sources on the other entry (small log)', model: Match({ ...SMALL_BLOCKERS, Bug: 'unmergeKeeps' }), expectFail: ['UnmergeRestores'] },
  { spec: 'Match', setting: 'bug: an entry that changed since review is matched anyway', model: Match({ Bug: 'noConflictCheck' }), expectFail: ['ChangedMatchIsAConflict'] },
  { spec: 'Match', setting: 'bug: every report pings the PM, not only new entries', model: Match({ Bug: 'alertOnSource' }), expectFail: ['OneAlertPerNewEntry'] },
  { spec: 'Match', setting: 'bug: anyone can resolve a blocker', model: Match({ Bug: 'anyoneResolves' }), expectFail: ['BlockerResolvedByOwnerOrLead'] },
];
