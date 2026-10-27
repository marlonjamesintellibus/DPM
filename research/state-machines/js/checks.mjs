// The model settings checked in section 11 of ../tla-plus-and-tlc.md.
import TrackedStatus from './models/trackedStatus.mjs';
import Capture from './models/capture.mjs';
import AtlasAction from './models/atlasAction.mjs';
import HelpRequest from './models/helpRequest.mjs';
import Opportunity from './models/opportunity.mjs';
import BraidEntry from './models/braidEntry.mjs';
import Routing from './models/routing.mjs';
import Match from './models/match.mjs';
import CaptureSave from './models/captureSave.mjs';
import InboxItem from './models/inboxItem.mjs';
import CaptureJob from './models/captureJob.mjs';
import Leave from './models/leave.mjs';
import BraidFollowUps from './models/braidFollowUps.mjs';
import BraidKindSwitch from './models/braidKindSwitch.mjs';
// M20 to M36, the Atlas conversational plan (use-cases/atlas-conversational-plan.md), one file per machine
import { ROWS as ChatCommandRows, PLANTS as ChatCommandPlants } from './rows/chatCommand.mjs';
import { ROWS as ClarificationRows, PLANTS as ClarificationPlants } from './rows/clarification.mjs';
import { ROWS as CommitmentRows, PLANTS as CommitmentPlants } from './rows/commitment.mjs';
import { ROWS as NudgeRows, PLANTS as NudgePlants } from './rows/nudge.mjs';
import { ROWS as DraftRows, PLANTS as DraftPlants } from './rows/draft.mjs';
import { ROWS as GroupChatRows, PLANTS as GroupChatPlants } from './rows/groupChat.mjs';
import { ROWS as StandupRows, PLANTS as StandupPlants } from './rows/standup.mjs';
import { ROWS as SignalRows, PLANTS as SignalPlants } from './rows/signal.mjs';
import { ROWS as UndoAndVocabularyRows, PLANTS as UndoAndVocabularyPlants } from './rows/undoAndVocabulary.mjs';
import { ROWS as OutboundAskRows, PLANTS as OutboundAskPlants } from './rows/outboundAsk.mjs';
import { ROWS as MeetingRows, PLANTS as MeetingPlants } from './rows/meeting.mjs';
import { ROWS as CoverRequestRows, PLANTS as CoverRequestPlants } from './rows/coverRequest.mjs';
import { ROWS as EvalCandidateRows, PLANTS as EvalCandidatePlants } from './rows/evalCandidate.mjs';

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
  // CaptureSave is machines doc M2 to M4; InboxItem is M10 (phase 1a, 26 Oct)
  { spec: 'CaptureSave', setting: 'as given (all or nothing, compare and set)', model: CaptureSave(), expectFail: [] },
  { spec: 'CaptureSave', setting: 'S3 alternative: apply what can', model: CaptureSave({ ApplyMode: 'what_can' }), expectFail: ['AllOrNothing', 'NothingAfterExpiry'] },
  { spec: 'InboxItem', setting: 'as given', model: InboxItem(), expectFail: [] },
  // CaptureJob, Leave and BraidFollowUps are the decisions on D1 to D11 (machines doc, section 11)
  { spec: 'CaptureJob', setting: 'as given (retries, 5 minute timer, save retry)', model: CaptureJob(), expectFail: [] },
  { spec: 'Leave', setting: 'as given (match any live leave, impact per lead)', model: Leave(), expectFail: [] },
  { spec: 'BraidFollowUps', setting: 'as given', model: BraidFollowUps(), expectFail: [] },
  // BraidKindSwitch is the plan of 27 Oct: M15 SWITCH_KIND and M17 kind change request (machines doc, section 13)
  { spec: 'BraidKindSwitch', setting: 'as given', model: BraidKindSwitch(), expectFail: [] },
  // Phase B: M20 Chat command
  ...ChatCommandRows,
  // Phase D: M21 Clarification
  ...ClarificationRows,
  // Phase E: M22 Commitment
  ...CommitmentRows,
  // Phase F: M23 Nudge, M24 Nudge settings
  ...NudgeRows,
  // Phase G: M25 Draft
  ...DraftRows,
  // Phase I: M26 Group message, M27 Group answer
  ...GroupChatRows,
  // Phase J: M28 Standup
  ...StandupRows,
  // Phase K: M29 Signal
  ...SignalRows,
  // Phase L: M30 Undo, M31 Vocabulary change
  ...UndoAndVocabularyRows,
  // Phase M: M32 Outbound ask
  ...OutboundAskRows,
  // Phase O: M33 Meeting capture, M34 Attributed item
  ...MeetingRows,
  // Phase P: M35 Cover request
  ...CoverRequestRows,
  // Phase S: M36 Eval candidate
  ...EvalCandidateRows,
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
  { spec: 'CaptureSave', setting: 'bug: Save writes without checking what the update saw', model: CaptureSave({ Bug: 'blindWrite' }), expectFail: ['NeverOverwriteUnseen'] },
  // A second Save that runs again can arrive after another writer changed the record, and overwrite it
  { spec: 'CaptureSave', setting: 'bug: a second Save runs again (no dedup)', model: CaptureSave({ Bug: 'noDedup' }), expectFail: ['AllOrNothing', 'AppliedAtMostOnce', 'NothingAfterExpiry'] },
  { spec: 'CaptureSave', setting: 'bug: an expired capture can still be saved', model: CaptureSave({ Bug: 'applyAfterExpiry' }), expectFail: ['ExpiryIsFinal'] },
  { spec: 'CaptureSave', setting: 'bug: expires without a reminder first', model: CaptureSave({ Bug: 'expireWithoutReminder' }), expectFail: ['ReminderBeforeExpiry'] },
  { spec: 'CaptureSave', setting: 'bug: the expiry timer never fires', model: CaptureSave({ Bug: 'noExpiry' }), expectFail: ['ReviewEnds'] },
  { spec: 'InboxItem', setting: 'bug: evaluate adds an item even when one is live', model: InboxItem({ Bug: 'duplicateItems' }), expectFail: ['OneLiveItemPerCause', 'InboxMatchesCause'] },
  { spec: 'InboxItem', setting: 'bug: a closed item is reopened when the cause returns', model: InboxItem({ Bug: 'reopenClosed' }), expectFail: ['ClosedNeverReopens'] },
  { spec: 'InboxItem', setting: 'bug: items do not close when the cause goes', model: InboxItem({ Bug: 'noAutoClose' }), expectFail: ['InboxMatchesCause'] },
  { spec: 'InboxItem', setting: 'bug: the rule never runs after a change', model: InboxItem({ Bug: 'ruleNeverRuns' }), expectFail: ['InboxCatchesUp'] },
  { spec: 'CaptureJob', setting: 'bug: no timer on transcribing (found by the check)', model: CaptureJob({ Bug: 'noTranscribeTimer' }), expectFail: ['ReadEnds'] },
  { spec: 'CaptureJob', setting: 'bug: no 5 minute timer at all', model: CaptureJob({ Bug: 'noStaleTimer' }), expectFail: ['ReadEnds'] },
  { spec: 'CaptureJob', setting: 'bug: a failed voice note only says "try again"', model: CaptureJob({ Bug: 'noResendAsk' }), expectFail: ['VoiceFailureAsksForNewNote'] },
  { spec: 'CaptureJob', setting: 'bug: a late answer from an old attempt is stored', model: CaptureJob({ Bug: 'noAttemptCheck' }), expectFail: ['StoredFromCurrentAttempt'] },
  { spec: 'CaptureJob', setting: 'bug: a retry after a lost reply applies again', model: CaptureJob({ Bug: 'retryReapplies' }), expectFail: ['AppliedAtMostOnce'] },
  { spec: 'CaptureJob', setting: 'bug: Save gives up without telling the author', model: CaptureJob({ Bug: 'silentGiveUp' }), expectFail: ['GivingUpIsTold', 'SaveEnds'] },
  { spec: 'Leave', setting: 'bug: only approved leave is matched (the old default)', model: Leave({ Bug: 'approvedOnly' }), expectFail: ['NoOverlappingLeave'] },
  { spec: 'Leave', setting: 'bug: leads are not shown the impact', model: Leave({ Bug: 'noImpact' }), expectFail: ['LeadsSeeImpact'] },
  { spec: 'Leave', setting: "bug: a lead sees other projects' work", model: Leave({ Bug: 'leakImpact' }), expectFail: ['ImpactOnlyOwnProject'] },
  { spec: 'Leave', setting: 'bug: impact items stay after the decision', model: Leave({ Bug: 'impactsStay' }), expectFail: ['ImpactsCloseWhenDecided'] },
  { spec: 'Leave', setting: 'bug: a capture approves leave', model: Leave({ Bug: 'captureApproves' }), expectFail: ['NeverApprovedByCapture'] },
  { spec: 'BraidFollowUps', setting: "bug: anyone's message resolves the blocker", model: BraidFollowUps({ Bug: 'messageResolves' }), expectFail: ['BlockerResolvedByOwnerOrLead'] },
  { spec: 'BraidFollowUps', setting: 'bug: unblocking #151 resolves the blocker itself', model: BraidFollowUps({ Bug: 'autoResolve' }), expectFail: ['BlockerResolvedByOwnerOrLead'] },
  { spec: 'BraidFollowUps', setting: 'bug: a report reopens a closed risk', model: BraidFollowUps({ Bug: 'reopenClosedRisk' }), expectFail: ['ClosedRiskStaysClosed'] },
  { spec: 'BraidFollowUps', setting: 'bug: reports pile on a realised risk', model: BraidFollowUps({ Bug: 'sourceOnRealised' }), expectFail: ['ReportsGoToLiveEntry'] },
  { spec: 'BraidFollowUps', setting: 'bug: merging into a resolved blocker asks nothing', model: BraidFollowUps({ Bug: 'mergeSilently' }), expectFail: ['MergeChoiceRecorded'] },
  { spec: 'BraidFollowUps', setting: "bug: withdrawing removes others' reports", model: BraidFollowUps({ Bug: 'withdrawAll' }), expectFail: ['WithdrawKeepsOthers'] },
  { spec: 'BraidKindSwitch', setting: "bug: a switch copies the reports instead of moving them", model: BraidKindSwitch({ Bug: 'copy' }), expectFail: ['EveryReportOnce', 'SwitchedHoldsNoReports'] },
  { spec: 'BraidKindSwitch', setting: "bug: a member switches the kind themselves", model: BraidKindSwitch({ Bug: 'memberSwitches' }), expectFail: ['OnlyLeadsSwitch'] },
  { spec: 'BraidKindSwitch', setting: "bug: a later report goes to the switched entry", model: BraidKindSwitch({ Bug: 'noRedirect' }), expectFail: ['SwitchedHoldsNoReports', 'EveryReportOnce'] },
  { spec: 'BraidKindSwitch', setting: "bug: switching back leaves the original pointing at the new entry", model: BraidKindSwitch({ Bug: 'keepLink' }), expectFail: ['SwitchedHoldsNoReports', 'RedirectEnds', 'OnlyLeadsSwitch'] },
  { spec: 'BraidKindSwitch', setting: "bug: a request outlives the entry it asks about", model: BraidKindSwitch({ Bug: 'noLapse' }), expectFail: ['RequestOnlyOnSwitchable'] },
  { spec: 'BraidKindSwitch', setting: "bug: unmerge allowed after the target was switched", model: BraidKindSwitch({ Bug: 'unmergeAfterSwitch' }), expectFail: ['EveryReportOnce'] },
  { spec: 'BraidKindSwitch', setting: "bug: a blocker becomes an issue and nobody asks the work's owner", model: BraidKindSwitch({ Bug: 'dropAsk' }), expectFail: ['BlockedWorkCovered'] },
  { spec: 'BraidKindSwitch', setting: "bug: switching a blocker away unblocks its work", model: BraidKindSwitch({ Bug: 'unblock' }), expectFail: ['WorkStaysBlocked'] },
  // Phase B: M20 Chat command
  ...ChatCommandPlants,
  // Phase D: M21 Clarification
  ...ClarificationPlants,
  // Phase E: M22 Commitment
  ...CommitmentPlants,
  // Phase F: M23 Nudge, M24 Nudge settings
  ...NudgePlants,
  // Phase G: M25 Draft
  ...DraftPlants,
  // Phase I: M26 Group message, M27 Group answer
  ...GroupChatPlants,
  // Phase J: M28 Standup
  ...StandupPlants,
  // Phase K: M29 Signal
  ...SignalPlants,
  // Phase L: M30 Undo, M31 Vocabulary change
  ...UndoAndVocabularyPlants,
  // Phase M: M32 Outbound ask
  ...OutboundAskPlants,
  // Phase O: M33 Meeting capture, M34 Attributed item
  ...MeetingPlants,
  // Phase P: M35 Cover request
  ...CoverRequestPlants,
  // Phase S: M36 Eval candidate
  ...EvalCandidatePlants,
];
