// The model settings for M21 Clarification (use-cases/atlas-conversational-plan.md, section 6, phase D),
// in the ROWS and PLANTS format of ../checks.mjs, ready to be added there.
import Clarification from '../models/clarification.mjs';

// expectFail lists the properties expected to fail; everything else should pass
export const ROWS = [
  { spec: 'Clarification', setting: 'as given (one message, asked in his own chat)', model: Clarification(), expectFail: [] },
  { spec: 'Clarification', setting: 'two messages, each with a question open (CL4)', model: Clarification({ Second: 'update' }), expectFail: [] },
  // Found by the check: phase B sends AC6 and AC7 here, but a chat command has no review card to hand the choice to
  { spec: 'Clarification', setting: 'a chat command asks which (AC7), handed to review as drawn', model: Clarification({ Second: 'command' }), expectFail: ['HandedOnlyToAReview'] },
  { spec: 'Clarification', setting: "same, the timer closes a command's question (proposed)", model: Clarification({ Second: 'command', CommandTimerCloses: true }), expectFail: [] },
  // Found by the check: the plan does not say which chat; asked where a group message came from, rule 8 breaks
  { spec: 'Clarification', setting: 'a Forager group message (phase I), asked in the group', model: Clarification({ Source: 'forager', AskIn: 'source' }), expectFail: ['OptionsOnlyWhatTheyMaySee'] },
  { spec: 'Clarification', setting: "same, asked in Kemar's own chat (proposed)", model: Clarification({ Source: 'forager', AskIn: 'own' }), expectFail: [] },
  // Found by the check: the guard lets a choose_project item with four candidates through
  { spec: 'Clarification', setting: 'Kemar in four projects, guard as drawn', model: Clarification({ FourProjects: true }), expectFail: ['AtMostThreeOptions'] },
  { spec: 'Clarification', setting: 'same, choose_project asked only with 2 or 3 (proposed)', model: Clarification({ FourProjects: true, ProjectCap: true }), expectFail: [] },
];

// Planted bugs: each one must make a full check fail
export const PLANTS = [
  { spec: 'Clarification', setting: "bug: Atlas's candidates are used as options unchecked", model: Clarification({ Bug: 'trustAtlas' }), expectFail: ['OptionsOnlyWhatTheyMaySee', 'AtMostThreeOptions'] },
  { spec: 'Clarification', setting: 'bug: four close matches are all offered', model: Clarification({ Bug: 'noCap' }), expectFail: ['AtMostThreeOptions'] },
  // The second question also names options he may have lost since, so the check on options fails too
  { spec: 'Clarification', setting: 'bug: CHECKS_DONE delivered twice asks twice', model: Clarification({ Bug: 'askTwice' }), expectFail: ['OneQuestionPerCapture', 'OptionsOnlyWhatTheyMaySee'] },
  { spec: 'Clarification', setting: 'bug: a second tap changes the answer', model: Clarification({ Bug: 'reanswer' }), expectFail: ['AnsweredOnce'] },
  { spec: 'Clarification', setting: 'bug: a tap after the review was opened still answers (CL3)', model: Clarification({ Bug: 'tapAfterReview' }), expectFail: ['OnlyDrawnArrows', 'AnsweredOnce'] },
  { spec: 'Clarification', setting: 'bug: an answer is taken without checking the option again (CL5)', model: Clarification({ Bug: 'noRecheck' }), expectFail: ['AnswerRechecked'] },
  { spec: 'Clarification', setting: 'bug: the answer applies the change at once', model: Clarification({ Bug: 'answerApplies' }), expectFail: ['RecordsChangeOnlyOnSave'] },
  { spec: 'Clarification', setting: "bug: saving marks Jodian's #160 done on Kemar's word", model: Clarification({ Bug: 'applyOthers' }), expectFail: ['OthersRecordsWaitForThem'] },
  { spec: 'Clarification', setting: 'bug: the 2 hour timer never fires', model: Clarification({ Bug: 'noTimer' }), expectFail: ['QuestionEnds'] },
  { spec: 'Clarification', setting: 'bug: opening the review leaves the chat question open', model: Clarification({ Bug: 'noHandOver' }), expectFail: ['AskedOnlyWhileProposed'] },
];
