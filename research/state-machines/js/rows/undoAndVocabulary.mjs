// Phase L of the Atlas conversational plan (use-cases/atlas-conversational-plan.md, section 14):
// M30 Undo and M31 Vocabulary change, in the ROWS and PLANTS format of ../checks.mjs.
// Model checked 27 Oct 2026, before any code. The plan as written breaks three properties:
//   M30  undoing has one way out, so a record someone changes after the guard passed leaves the job
//        stuck (UndoSettles), and a right lost after the guard is never rechecked (RightHeldWhenUndone).
//        "Kemar undid this." goes to everyone the save told, and a refusal names every record, even
//        on a project the reader has since left (NamesOnlyReadable)
//   M31  the alias clash is checked only before the proposal, so two proposals for "Academy" can both
//        be approved (AliasClearForEveryReader); and refusing a clash with a project Kemar cannot open
//        tells him it exists (NamesOnlyReadable, P10)
// The "with the fixes" rows add what the findings suggest; every plant runs against them.
// UndoArrows (added after phase L was built): the UNDO arrows drawn on each record machine an undo touches,
// as the app draws them, checked against every move one save can make on that record.
import { Undo, VocabularyChange } from '../models/undoAndVocabulary.mjs';
import { MACHINES, UndoArrows } from '../models/undoArrows.mjs';

// expectFail lists the properties expected to fail; everything else should pass
export const ROWS = [
  { spec: 'Undo', setting: 'as written', model: Undo(), expectFail: ['RightHeldWhenUndone', 'NamesOnlyReadable', 'UndoSettles'] },
  { spec: 'Undo', setting: 'with the fixes (recheck when the UNDO arrows run, undoing -> refused, name only what the reader can open)', model: Undo({ Recheck: true }), expectFail: [] },
  { spec: 'VocabularyChange', setting: 'as written', model: VocabularyChange(), expectFail: ['AliasClearForEveryReader', 'NamesOnlyReadable'] },
  { spec: 'VocabularyChange', setting: 'with the fixes (clash checked against what the person told can open, again at APPROVE)', model: VocabularyChange({ Recheck: true }), expectFail: [] },
  ...Object.keys(MACHINES).map((Machine) => ({ spec: 'UndoArrows', setting: `${Machine}, as built in phase L`, model: UndoArrows({ Machine }), expectFail: [] })),
];

// Planted bugs: each one must make a full check fail
export const PLANTS = [
  { spec: 'Undo', setting: 'bug: the job goes from requested straight to undone', model: Undo({ Recheck: true, Bug: 'skipCheck' }), expectFail: ['OnlyDrawnArrows'] },
  // Undoing an approved risk takes it from open to none, an arrow nobody drew
  { spec: 'Undo', setting: 'bug: versions are not compared (UN2)', model: Undo({ Recheck: true, Bug: 'noVersionCheck' }), expectFail: ['OnlyDrawnArrows', 'NeverUndoOthersWork'] },
  { spec: 'Undo', setting: 'bug: the records that still match are undone, the rest skipped', model: Undo({ Recheck: true, Bug: 'partial' }), expectFail: ['AllOrNothing'] },
  { spec: 'Undo', setting: 'bug: "Undo that" twice makes two jobs (UN5)', model: Undo({ Recheck: true, Bug: 'noDedup' }), expectFail: ['OneJobPerCommand'] },
  { spec: 'Undo', setting: "bug: Alicia's \"Undo that\" undoes Kemar's save (UN4)", model: Undo({ Recheck: true, Bug: 'anyoneUndoes' }), expectFail: ['OnlyAuthorUndoes'] },
  { spec: 'Undo', setting: "bug: undo withdraws the whole shared blocker (UN6)", model: Undo({ Recheck: true, Bug: 'withdrawAll' }), expectFail: ['OthersReportsKept'] },
  { spec: 'Undo', setting: "bug: Alicia's inbox item stays after the risk is withdrawn (UN3)", model: Undo({ Recheck: true, Bug: 'inboxStays' }), expectFail: ['InboxFollowsCause'] },
  { spec: 'Undo', setting: "bug: \"Why did you file that?\" answers about another person's item (UN7)", model: Undo({ Recheck: true, Bug: 'whyOthers' }), expectFail: ['WhyOnlyToAuthor'] },
  { spec: 'Undo', setting: 'bug: "Why did you file that?" shows the SI match after Kemar left SI', model: Undo({ Recheck: true, Bug: 'whyLeaks' }), expectFail: ['NamesOnlyReadable'] },
  { spec: 'Undo', setting: 'bug: the job never runs the UNDO arrows', model: Undo({ Recheck: true, Bug: 'jobNeverRuns' }), expectFail: ['UndoSettles'] },
  { spec: 'Undo', setting: 'bug: the right is checked only when "Undo that" is checked', model: Undo({ Recheck: true, Bug: 'rightAtAsk' }), expectFail: ['RightHeldWhenUndone'] },
  { spec: 'VocabularyChange', setting: 'bug: saying a declined correction again reopens it', model: VocabularyChange({ Recheck: true, Bug: 'reviveDeclined' }), expectFail: ['OnlyDrawnArrows'] },
  { spec: 'VocabularyChange', setting: 'bug: who may approve is fixed when the proposal is made', model: VocabularyChange({ Recheck: true, Bug: 'roleAtAsk' }), expectFail: ['ApproverHeldRightThen'] },
  // Applied without a proposal, "Academy" can also reach SI while GQ has it
  { spec: 'VocabularyChange', setting: "bug: Atlas applies its own correction (CD14)", model: VocabularyChange({ Recheck: true, Bug: 'atlasApplies' }), expectFail: ['AliasClearForEveryReader', 'OnlyDrawnArrows', 'AtlasNeverChangesARecord'] },
  { spec: 'VocabularyChange', setting: 'bug: the same correction said twice makes two proposals', model: VocabularyChange({ Recheck: true, Bug: 'dupProposal' }), expectFail: ['OneProposalPerChange'] },
  // Once Dwayne is in GQ he reads GQ and HX, which may both use "Academy": the fixed clash check
  // is per reader, so a new member of both is the case M14's choose_project has to catch
  { spec: 'VocabularyChange', setting: 'bug: "Dwayne is on GQ" makes Dwayne a member (UN8, rule 10)', model: VocabularyChange({ Recheck: true, Bug: 'tieMakesMember' }), expectFail: ['WordsChangeNoOnesMembership', 'AliasClearForEveryReader'] },
  { spec: 'VocabularyChange', setting: 'bug: the vocabExpiryDays timer never fires', model: VocabularyChange({ Recheck: true, Bug: 'noExpiry' }), expectFail: ['ProposalSettles'] },
  { spec: 'VocabularyChange', setting: 'bug: expires without the reminders first', model: VocabularyChange({ Recheck: true, Bug: 'expireEarly' }), expectFail: ['ReminderBeforeExpiry'] },
  { spec: 'VocabularyChange', setting: 'bug: no clash recheck at APPROVE', model: VocabularyChange({ Recheck: true, Bug: 'noClashRecheck' }), expectFail: ['AliasClearForEveryReader'] },
  { spec: 'VocabularyChange', setting: 'bug: the clash is checked against the whole org (UN9 as written)', model: VocabularyChange({ Recheck: true, Bug: 'orgWideClash' }), expectFail: ['NamesOnlyReadable'] },
  // Each machine's first UNDO arrow left undrawn: a save that took that move could never be undone
  ...Object.keys(MACHINES).map((Machine) => ({ spec: 'UndoArrows', setting: `bug: ${Machine} misses an UNDO arrow`, model: UndoArrows({ Machine, Bug: 'missingArrow' }), expectFail: ['EveryMoveCanGoBack'] })),
  { spec: 'UndoArrows', setting: 'bug: the undo skips the version check (work item)', model: UndoArrows({ Machine: 'WorkItem', Bug: 'noVersionCheck' }), expectFail: ['NeverUndoOthersWork'] },
  { spec: 'UndoArrows', setting: 'bug: the undo skips the version check (BRAID entry)', model: UndoArrows({ Machine: 'BraidEntry', Bug: 'noVersionCheck' }), expectFail: ['NeverUndoOthersWork'] },
  // Why a step's MOVE is strictly forward: a save that "moved" it to where it was has no UNDO arrow back
  { spec: 'UndoArrows', setting: 'bug: a save moves a handover step to the state it is in', model: UndoArrows({ Machine: 'HandoverStep', Bug: 'sameMove' }), expectFail: ['EveryMoveCanGoBack'] },
];
