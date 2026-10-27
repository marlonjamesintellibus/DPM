// The UNDO arrows phase L drew on the record machines an undo touches (use-cases/atlas-conversational-plan.md,
// section 14: "Each machine an undo touches gets one drawn UNDO arrow back to the state the save moved it
// from ... model checked like any arrow"). Built in phase L on M5 work item, M6 milestone, M7 handover and its
// steps, M15 BRAID entry, M9 set status and M8 leave; the tables below are the app's (app/src/domain/machines,
// UNDO_BACK and the UNDO arrows), and the save moves are the arrows a capture save, or the rule after it, can
// take on one record in one save.
// One record per check. A save moves it (one move, or two where one save can carry two items about it); then
// someone else may move it too; then the author asks to undo. The undo job takes the record back along a
// drawn UNDO arrow while it is at the version the save left, and refuses otherwise (M30, the model's fix:
// undoing --> refused).
// What it shows: every state a save can leave a record in has an UNDO arrow drawn back to where the save
// found it (EveryMoveCanGoBack), so an undo of an untouched record never refuses for want of an arrow.
// Chosen where the plan is silent, as built: leave a save asked for is withdrawn (M8 WITHDRAW), not put back
// to none; a BRAID entry the save reported goes back to none (section 14).
import { clone } from '../lib.mjs';

const pairs = (list) => list.map((p) => p.split('>'));

// Each machine: the states a record starts in, the moves one save can make (with how many moves one save
// can chain), the moves someone else can make after it, and the UNDO arrows drawn.
export const MACHINES = {
  // M5: compare and set allows one write per field per save; START, FINISH, BLOCK, UPDATE_BLOCKED_NOTE, UNBLOCK, REOPEN,
  // and section 20, U6's SET_FORECAST, which keeps the state (to_do>to_do, in_progress>in_progress, blocked>blocked).
  // Merged in wave 2: its UNDO keeps the state too, as a milestone's forecast does
  WorkItem: {
    init: ['to_do', 'in_progress', 'blocked', 'done'],
    save: pairs(['to_do>in_progress', 'to_do>done', 'in_progress>done', 'blocked>done', 'in_progress>blocked', 'blocked>blocked', 'blocked>in_progress', 'done>in_progress', 'to_do>to_do', 'in_progress>in_progress']),
    chain: 1,
    other: pairs(['in_progress>done', 'blocked>in_progress', 'done>in_progress', 'to_do>in_progress', 'in_progress>cancelled']),
    undo: pairs(['in_progress>to_do', 'done>to_do', 'done>in_progress', 'done>blocked', 'blocked>in_progress', 'blocked>blocked', 'in_progress>blocked', 'in_progress>done', 'to_do>to_do', 'in_progress>in_progress']),
  },
  // M6: the forecast is a field; FORECAST_CHANGED and its UNDO keep the state
  Milestone: {
    init: ['planned', 'in_progress', 'missed'],
    save: pairs(['planned>planned', 'in_progress>in_progress', 'missed>missed']),
    chain: 1,
    other: pairs(['planned>in_progress', 'in_progress>done', 'missed>done']),
    undo: pairs(['planned>planned', 'in_progress>in_progress', 'missed>missed']),
  },
  // M7: STEPS_DONE; one save can hand over several steps, so two moves chain
  Handover: {
    init: ['not_started', 'in_progress'],
    save: pairs(['not_started>in_progress', 'not_started>handed_over', 'in_progress>in_progress', 'in_progress>handed_over']),
    chain: 2,
    other: pairs(['in_progress>handed_over', 'not_started>cancelled', 'in_progress>cancelled']),
    undo: pairs(['in_progress>not_started', 'handed_over>not_started', 'in_progress>in_progress', 'handed_over>in_progress']),
  },
  // One handover step (handoverStepMachine): forward only; saying where it already is changes nothing
  HandoverStep: {
    init: ['not_done', 'in_progress'],
    save: pairs(['not_done>in_progress', 'not_done>handed_over', 'in_progress>handed_over']),
    chain: 1,
    other: pairs(['in_progress>handed_over']),
    undo: pairs(['in_progress>not_done', 'handed_over>not_done', 'handed_over>in_progress']),
  },
  // M15: REPORT, ADD_SOURCE (S14, E85, or keeps the state), RESOLVE by a save (D7), PROPOSE_OUTCOME and a
  // D10 follow up (keep the state). One save can add a source and resolve the same entry: two moves chain,
  // but never on an entry the same save reported (a resolve names an entry that already exists)
  BraidEntry: {
    init: ['none', 'reported', 'resolved', 'proposed', 'declined', 'open', 'mitigating', 'holding', 'waiting', 'closed', 'met', 'approved'],
    save: pairs([
      'none>none', 'none>reported', 'none>proposed', 'none>open', 'none>holding',
      'resolved>reported', 'declined>proposed',
      ...['reported', 'proposed', 'more_info', 'open', 'mitigating', 'closed', 'realised', 'holding', 'confirmed', 'broken', 'waiting', 'met', 'late', 'approved', 'superseded'].map((s) => `${s}>${s}`),
      'reported>resolved', 'open>closed', 'open>realised', 'mitigating>closed', 'mitigating>realised', 'holding>confirmed', 'holding>broken', 'open>met', 'open>late', 'waiting>met', 'waiting>late',
    ]),
    chain: 2,
    other: pairs(['proposed>open', 'proposed>declined', 'reported>resolved', 'resolved>reported', 'open>mitigating', 'approved>superseded']),
    undo: pairs([
      'none>none',
      'reported>none', 'reported>resolved', 'reported>reported',
      'proposed>none', 'proposed>declined', 'proposed>proposed',
      'open>none', 'open>open', 'holding>none', 'holding>holding',
      'resolved>reported', 'resolved>resolved',
      'closed>open', 'closed>mitigating', 'closed>closed', 'realised>open', 'realised>mitigating', 'realised>realised',
      'confirmed>holding', 'confirmed>confirmed', 'broken>holding', 'broken>broken',
      'met>open', 'met>waiting', 'met>met', 'late>open', 'late>waiting', 'late>late',
      ...['more_info', 'declined', 'mitigating', 'waiting', 'approved', 'superseded'].map((s) => `${s}>${s}`),
    ]),
  },
  // M9: the rule's CALCULATED_CHANGED after the save (when_done, ReasonStale)
  SetStatus: {
    init: ['calculated_only', 'reason_required', 'explained', 'reason_stale'],
    save: pairs(['reason_required>calculated_only', 'explained>calculated_only', 'reason_stale>calculated_only', 'explained>reason_stale']),
    chain: 1,
    other: pairs(['calculated_only>reason_required', 'reason_stale>explained', 'reason_required>explained']),
    undo: pairs(['calculated_only>reason_required', 'calculated_only>explained', 'calculated_only>reason_stale', 'reason_stale>explained']),
  },
  // M8 with D6: a save asks for leave, moves a request's dates, or asks a change to approved leave. Its
  // undo withdraws a request it asked for (the drawn WITHDRAW arrow), and puts dates back otherwise
  Leave: {
    init: ['none', 'requested', 'approved'],
    save: pairs(['none>requested', 'requested>requested', 'approved>approved']),
    chain: 1,
    other: pairs(['requested>approved', 'requested>declined', 'approved>approved']),
    undo: pairs(['requested>withdrawn', 'requested>requested', 'approved>approved', 'handover_in_progress>handover_in_progress', 'covered>covered', 'uncovered>uncovered']),
    back: (before) => (before === 'none' ? 'withdrawn' : before),
  },
};

const JOB_FINAL = ['undone', 'refused'];

export function UndoArrows({ Machine, Bug = null } = {}) {
  const m = MACHINES[Machine];
  // Planted bug missingArrow: the first UNDO arrow is not drawn. noSameStateUndo: only arrows that change the
  // state are drawn (phase L before section 20, U6: a save that only set a work item's forecast could not go back)
  const drawn = Bug === 'missingArrow' ? m.undo.slice(1) : Bug === 'noSameStateUndo' ? m.undo.filter(([a, b]) => a !== b) : m.undo;
  const undo = new Set(drawn.map(([a, b]) => `${a}>${b}`));
  const back = (s) => (m.back ? m.back(s.saved.before) : s.saved.before);
  // Planted bug sameMove: a save writes a value the record already has (compare and set makes it no change)
  const save = Bug === 'sameMove' ? [...m.save, [m.init[1], m.init[1]]] : m.save;
  // Every move one save can make, chained up to m.chain moves; nothing chains after a REPORT (the entry is new)
  const paths = [];
  const grow = (path) => {
    paths.push(path);
    if (path.length >= m.chain || path[0][0] === 'none') return;
    for (const mv of save) if (mv[0] === path.at(-1)[1]) grow([...path, mv]);
  };
  for (const mv of save) grow([mv]);
  const t0 = (s, by) => Object.assign(clone(s), { by });

  return {
    name: `UndoArrows (${Machine}${Bug ? `, bug ${Bug}` : ''})`,
    init: () => m.init.map((st) => ({ st, v: 0, saved: null, others: 0, job: 'none', by: null })),
    actions: [
      {
        // The author's save: one path of moves, at once
        name: 'Saves',
        params: paths.map((p) => [p]),
        step(s, path) {
          if (s.saved || s.st !== path[0][0]) return [];
          const t = t0(s, 'save');
          t.st = path.at(-1)[1];
          t.v = s.v + 1;
          t.saved = { before: s.st, v: t.v };
          return [t];
        },
      },
      {
        // Someone else moves the record after the save (UN2): once is enough to show it
        name: 'OtherActs',
        params: m.other.map((mv) => [mv]),
        step(s, [from, to]) {
          if (!s.saved || s.others >= 1 || s.st !== from || s.job === 'undone') return [];
          return [Object.assign(t0(s, 'other'), { st: to, v: s.v + 1, others: 1 })];
        },
      },
      {
        name: 'AsksUndo',
        params: [[]],
        step: (s) => (s.saved && s.job === 'none' ? [Object.assign(t0(s, 'author'), { job: 'requested' })] : []),
      },
      {
        // The job: the version the save left, then the record's own UNDO arrow; anything else is refused
        name: 'Undo',
        params: [[]],
        fair: true,
        step(s) {
          if (s.job !== 'requested') return [];
          const t = t0(s, 'job');
          const to = back(s);
          if ((s.v !== s.saved.v && Bug !== 'noVersionCheck') || !undo.has(`${s.st}>${to}`)) return [Object.assign(t, { job: 'refused' })];
          return [Object.assign(t, { st: to, v: s.v + 1, job: 'undone' })];
        },
      },
    ],
    invariants: {
      // Every state one save leaves a record in has a drawn UNDO arrow back to where the save found it
      EveryMoveCanGoBack: (s) => !s.saved || s.job === 'undone' || s.v !== s.saved.v || undo.has(`${s.st}>${back(s)}`),
      // Undone means back where the save found it (or, for leave it asked for, withdrawn)
      UndoRestores: (s) => s.job !== 'undone' || s.st === back(s),
    },
    actionProperties: {
      // Rule 2 of section 1: an undo moves the record only along a drawn UNDO arrow
      OnlyDrawnArrows: (s, t) => !(s.job !== 'undone' && t.job === 'undone') || undo.has(`${s.st}>${t.st}`),
      // "Cannot be undone: anything someone else has acted on since"
      NeverUndoOthersWork: (s, t) => !(s.job !== 'undone' && t.job === 'undone') || s.v === s.saved.v,
    },
    leadsTo: {
      // Rule 5: "Undo that" always ends, undone or refused
      UndoSettles: [{ label: 'the job', P: (s) => s.job === 'requested', Q: (s) => JOB_FINAL.includes(s.job) }],
    },
  };
}
