// M36 Eval candidate (use-cases/atlas-conversational-plan.md, section 21, phase S; LF1 to LF8).
// A thumbs down, an `other` answer, an undo or a correction is logged as a candidate for the eval set.
// A DPM maintainer accepts it (anonymised to seed names and ids, with the expected result) or dismisses
// it; otherwise it is deleted after evalCandidateDays. Counts are kept for everyone; the text only with
// the person's OK, because their words are theirs (M1, LF1).
//
// The world: Kemar (a member) and Alicia (his PM) give feedback. f1 is Kemar's thumbs down on an answer
// in his own chat; f2 is Alicia's thumbs down on a group answer to Kemar's question (phase I), with
// "What was wrong? #151 is done", so it holds Kemar's words as well as hers. Dev is a DPM maintainer
// (none is seeded) who can lose the role. Exec is an Intellibus executive (none is seeded) and Kyle, at
// Sprouts, is the outsider: neither may read the text, and Kyle sees no Intellibus numbers (LF7, CD21).
// The smallest group a number is shown for (CD28: 5) is scaled to 2 so the model can reach it (LF8).
//
// Fixes = [] is the plan's table as drawn: LOGGED is guarded by the person giving the feedback, opting out
// has no arrow (LF2), ACCEPT has no consent guard, and dismissed and in_eval_set keep the person's text.
// The fixes (FIXED is all of them): 'everyOwner', every person whose words it holds must allow it;
// 'optOut', OPTED_OUT deletes their logged candidates in the same transaction as the setting, and ACCEPT
// and DISMISS recheck the OK; 'dropText', both final states drop the original text (the eval case is
// the anonymised copy; a dismissal keeps its note).
import { clone, product } from '../lib.mjs';

const SOURCES = {
  f1: { giver: 'kemar', owners: ['kemar'] },
  f2: { giver: 'alicia', owners: ['alicia', 'kemar'] },
};
const IDS = Object.keys(SOURCES);
const GIVERS = ['kemar', 'alicia'];
const VIEWERS = ['kemar', 'alicia', 'exec', 'kyle', 'dev'];
const MIN_PEOPLE = 2;
const MAX_COUNT = 3; // bounds the noDedup plant

// The drawn arrows: [from, event, to]; null is "(none)"
const ARROWS_AS_DRAWN = [
  [null, 'LOGGED', 'logged'],
  ['logged', 'ACCEPT', 'in_eval_set'],
  ['logged', 'DISMISS', 'dismissed'],
  ['logged', 'TIMER', 'deleted'],
];
const ARROWS_FIXED = [...ARROWS_AS_DRAWN, ['logged', 'OPTED_OUT', 'deleted']];

export const FIXED = ['everyOwner', 'optOut', 'dropText'];

export default function EvalCandidate({ Fixes = [], Bug = null } = {}) {
  // Each fix, and the plants that take one back out of the fixed design
  const deleteLater = ['deleteLater', 'deleteLaterNoRecheck'].includes(Bug);
  const optOutDeletes = Fixes.includes('optOut') && !deleteLater;
  const everyOwner = Fixes.includes('everyOwner') && Bug !== 'giverConsentOnly';
  const recheckConsent = Fixes.includes('optOut') && Bug !== 'deleteLaterNoRecheck';
  const finalDropsText = Fixes.includes('dropText') && Bug !== 'keepTextOnFinal';
  const ARROWS = Fixes.includes('optOut') ? ARROWS_FIXED : ARROWS_AS_DRAWN;

  const t0 = (s, by, ev) => Object.assign(clone(s), { by, ev });
  const allows = (s, id) => (everyOwner ? SOURCES[id].owners : [SOURCES[id].giver]).every((p) => s.allow[p]);
  const everyOwnerAllows = (s, id) => SOURCES[id].owners.every((p) => s.allow[p]);
  const withText = (s) => IDS.filter((id) => s.c[id]?.text);

  // What each viewer can read: the candidates' text, and the Intellibus numbers
  const texts = (s, v) => {
    if (v === 'dev') return s.maint ? withText(s) : [];
    // Planted bug leadSeesText: a PM reads her team's feedback
    if (v === 'alicia' && Bug === 'leadSeesText') return withText(s).filter((id) => SOURCES[id].owners.includes('kemar'));
    return [];
  };
  const counts = (s, v) => {
    const bigEnough = s.who.length >= MIN_PEOPLE || Bug === 'smallCounts';
    if (v === 'dev') return s.n;
    if (v === 'exec') return bigEnough ? s.n : null;
    if (v === 'kyle' && Bug === 'countsAcrossOrgs') return bigEnough ? s.n : null;
    return null;
  };

  const drop = (x) => (finalDropsText ? null : x.text);

  // OPTED_OUT: every logged candidate holding p's words is deleted
  const forget = (t, p) => {
    for (const id of IDS) {
      const x = t.c[id];
      if (x?.st === 'logged' && SOURCES[id].owners.includes(p)) Object.assign(x, { st: 'deleted', text: null });
      // Planted bug optOutDeletesCases: accepted cases go too, though they were anonymised (LF2)
      if (Bug === 'optOutDeletesCases' && x?.st === 'in_eval_set' && SOURCES[id].owners.includes(p)) {
        x.st = 'deleted';
        t.evalSet = t.evalSet.filter((e) => e.id !== id);
      }
    }
  };

  return {
    name: `EvalCandidate (${Fixes.length ? `fixes ${Fixes.join(', ')}` : 'as drawn'}${Bug ? `, bug ${Bug}` : ''})`,
    init: () =>
      product([true, false], [true, false]).map(([k, a]) => ({
        allow: { kemar: k, alicia: a },
        maint: true,
        c: { f1: null, f2: null },
        seen: [],
        n: 0,
        who: [],
        evalSet: [],
        shown: { f1: false, f2: false },
        work: 'in_progress',
        by: null,
        ev: null,
      })),
    actions: [
      {
        // LOGGED: thumbs down (or other, undo, correction). Counts always; the text only with the OK (LF1)
        name: 'Feedback',
        params: IDS.map((id) => [id]),
        step(s, id) {
          const { giver } = SOURCES[id];
          if (s.seen.includes(id) && Bug !== 'noDedup') return []; // rule 6: a repeat changes nothing
          if (s.n >= MAX_COUNT) return [];
          const t = t0(s, giver, 'LOGGED');
          t.n = s.n + 1;
          t.who = [...new Set([...s.who, giver])].sort();
          t.seen = [...new Set([...s.seen, id])].sort();
          if (allows(s, id)) t.c[id] = { st: 'logged', text: 'real' };
          // Planted bug feedbackApplies: "What was wrong? #151 is done" closes Kemar's #151
          if (Bug === 'feedbackApplies' && id === 'f2') t.work = 'done';
          return [t];
        },
      },
      {
        // The maintainer opens a candidate and reads it (what Accept was shown)
        name: 'Opens',
        params: IDS.map((id) => [id]),
        step(s, id) {
          if (!s.maint || s.c[id]?.st !== 'logged' || s.shown[id]) return [];
          const t = t0(s, 'dev', 'OPEN');
          t.shown[id] = true;
          return [t];
        },
      },
      {
        // ACCEPT: a maintainer, with the expected result; the text is anonymised to seed names (LF3)
        name: 'Accept',
        params: IDS.map((id) => [id]),
        step(s, id) {
          const x = s.c[id];
          // Rule 4: the right and the state are checked when it runs, not when the candidate was shown
          if (Bug === 'checkWhenShown') {
            if (!s.shown[id]) return [];
          } else {
            const from = Bug === 'acceptTwice' ? ['logged', 'in_eval_set'] : ['logged'];
            if (!s.maint || !from.includes(x?.st)) return [];
          }
          if (recheckConsent && !everyOwnerAllows(s, id)) return [];
          if (Bug === 'acceptTwice' && s.evalSet.length >= 2) return [];
          const t = t0(s, 'dev', 'ACCEPT');
          t.c[id] = { st: 'in_eval_set', text: x ? drop(x) : null };
          t.evalSet = [...s.evalSet, { id, words: Bug === 'acceptRaw' ? 'real' : 'seed' }].sort((a, b) => a.id.localeCompare(b.id));
          t.shown[id] = false;
          return [t];
        },
      },
      {
        // DISMISS: a maintainer, with a note (LF4); a client's data can be dismissed outright (LF3)
        name: 'Dismiss',
        params: IDS.map((id) => [id]),
        step(s, id) {
          const x = s.c[id];
          if (!s.maint || x?.st !== 'logged') return [];
          if (recheckConsent && !everyOwnerAllows(s, id)) return [];
          const t = t0(s, 'dev', 'DISMISS');
          t.c[id] = { st: 'dismissed', text: drop(x) };
          t.shown[id] = false;
          return [t];
        },
      },
      {
        // TIMER evalCandidateDays (30)
        name: 'Timer',
        params: IDS.map((id) => [id]),
        fair: true,
        step(s, id) {
          const x = s.c[id];
          // Planted bug noTimer: nothing ever deletes a candidate nobody looks at
          if (Bug === 'noTimer') return [];
          // Planted bug timerOnFinal: the cleanup deletes every candidate older than 30 days, accepted ones too
          const from = Bug === 'timerOnFinal' ? ['logged', 'dismissed', 'in_eval_set'] : ['logged'];
          if (!from.includes(x?.st)) return [];
          const t = t0(s, null, 'TIMER');
          t.c[id] = { st: 'deleted', text: null };
          return [t];
        },
      },
      {
        // "Help improve Atlas" turned on or off (LF2)
        name: 'SetsHelp',
        params: product(GIVERS, [true, false]),
        step(s, p, on) {
          if (s.allow[p] === on) return [];
          const t = t0(s, p, on ? 'SETTING' : 'OPTED_OUT');
          t.allow[p] = on;
          if (!on && optOutDeletes) forget(t, p);
          return [t];
        },
      },
      {
        // Planted bugs deleteLater*: the opt-out deletion runs later as a job, not with the setting
        name: 'ForgetJob',
        params: GIVERS.map((p) => [p]),
        fair: true,
        step(s, p) {
          if (!deleteLater || s.allow[p]) return [];
          if (!IDS.some((id) => s.c[id]?.st === 'logged' && SOURCES[id].owners.includes(p))) return [];
          const t = t0(s, null, 'OPTED_OUT');
          forget(t, p);
          return [t];
        },
      },
      {
        name: 'LosesMaintainer',
        params: [[]],
        step(s) {
          if (!s.maint) return [];
          return [Object.assign(t0(s, null, 'ROLE'), { maint: false })];
        },
      },
    ],
    invariants: {
      // M1, LF1: a candidate holds text only while everyone whose words it holds allows it
      TextOnlyWithConsent: (s) => withText(s).every((id) => everyOwnerAllows(s, id)),
      // Rule 3, LF7: only a maintainer, now, reads a candidate's text; never a PM, an executive or Kyle
      TextOnlyToMaintainers: (s) => VIEWERS.every((v) => !texts(s, v).length || (v === 'dev' && s.maint)),
      // Rule 8: the eval set is read by every maintainer and lives in the repo, so it holds seed names only
      EvalSetAnonymised: (s) => s.evalSet.every((e) => e.words === 'seed'),
      // Rule 6: a candidate enters the eval set once
      EvalCaseOnce: (s) => new Set(s.evalSet.map((e) => e.id)).size === s.evalSet.length,
      // Rule 6: a repeated thumbs down counts once
      CountedOnce: (s) => s.n === s.seen.length,
      // LF8: a number is shown outside the maintainers only for a big enough group
      CountsNeverSingleOutAPerson: (s) => VIEWERS.every((v) => v === 'dev' || counts(s, v) === null || s.who.length >= MIN_PEOPLE),
      // LF7: an executive sees their own org's numbers only; Kyle is at Sprouts
      CountsOnlyOwnOrg: (s) => counts(s, 'kyle') === null,
    },
    actionProperties: {
      // Rule 2 of the machines doc: no state change outside the table
      OnlyDrawnArrows: (s, t) =>
        IDS.every((id) => {
          const from = s.c[id]?.st ?? null;
          const to = t.c[id]?.st ?? null;
          return from === to || ARROWS.some(([f, e, x]) => f === from && e === t.ev && x === to);
        }),
      // Rule 4: an accept or dismiss runs only for someone who is a maintainer when it runs
      DecidedByMaintainerNow: (s, t) => !['ACCEPT', 'DISMISS'].includes(t.ev) || s.maint,
      // Rule 4, LF2: a case enters the eval set only while everyone whose words it holds allows it
      AcceptOnlyWithConsent: (s, t) =>
        t.evalSet.every((e) => s.evalSet.some((x) => x.id === e.id) || everyOwnerAllows(s, e.id)),
      // LF2: accepted cases were anonymised and stay
      AcceptedCasesStay: (s, t) => s.evalSet.every((e) => t.evalSet.some((x) => x.id === e.id)),
      // Rules 1 and 10: feedback changes no record, least of all another person's
      NoRecordChanges: (s, t) => s.work === t.work,
    },
    leadsTo: {
      // Rule 5: a logged candidate is accepted, dismissed or deleted
      NothingStuck: IDS.map((id) => ({ label: id, P: (s) => s.c[id]?.st === 'logged', Q: (s) => s.c[id]?.st !== 'logged' })),
      // M1: the person's text is not kept forever (the 30 day timer, or a final state that drops it)
      TextNotKeptForever: IDS.map((id) => ({ label: id, P: (s) => !!s.c[id]?.text, Q: (s) => !s.c[id]?.text })),
    },
  };
}
