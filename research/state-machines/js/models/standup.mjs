// M28 Standup (use-cases/atlas-conversational-plan.md, section 12, phase J; rules in section 1).
// Kemar is a member of Forager 2.0 (Alicia is the PM) and, in one start, of Store Insights (Andre is
// the PM and is the outsider: he reads nothing of Forager). Kemar owns #208 on Forager and #212 on
// Store Insights, both In progress.
//   Atlas asks short questions built from his open work, the list rebuilt at each step (SU8): blocked
//   items, items In progress, then "Anything new blocking you?". "Stuck" asks one more question,
//   "What's it waiting on?". The answers become one capture (M1, M2) that Kemar reviews and saves as
//   usual: the save rechecks his rights and compares versions (M4, SU3).
//   Timers are events: the standup time and the idle timer (standupIdleMinutes).
//   The world moves underneath: a PM takes an item back, cancels it, or removes Kemar from the project;
//   Kemar goes on leave or turns the standup off (the M23 rules); he sends an update of his own.
//
// Fixes lists what the check found missing from the M28 table as drawn (Fixes = [] is the plan as
// written; the default is every fix):
//   timerSkips      TIMER standup time with the M23 rules failing goes to skipped, as M23 composing does
//   skipFirst       the timer reads the skip guard first: an update today or no open work is skipped (SU1, SU2)
//   emptyAbandons   STOP, or the last SKIP, with nothing answered is abandoned, not an empty capture
//   ownerAsks       at save, an answer about a record Kemar no longer owns is an Ask to its owner (rule 10)
//   startAfterSkip  "Start my standup" is an arrow, from scheduled and from skipped (SU1)
import { clone, product } from '../lib.mjs';

const ITEMS = ['w208', 'w212'];
const PROJECT = { w208: 'forager', w212: 'insights' };
const PM = { forager: 'alicia', insights: 'andre' };
const OPEN = ['in_progress', 'blocked'];
// M5 arrows a save may fire; the work item's own table decides (M4)
const WORK = { in_progress: ['done', 'blocked'], blocked: ['in_progress', 'done'] };
const ANSWERS = { item: ['done', 'going', 'stuck', 'other'], new: ['nothing', 'names'], wait: ['names', 'plain'] };
const kindOf = (subject) => (ITEMS.includes(subject) ? 'item' : subject);
const WAITING = ['scheduled', 'asking'];
const FINAL = ['skipped', 'composed', 'abandoned'];
const DRAWN = ['scheduled>asking', 'scheduled>skipped', 'asking>composed', 'asking>abandoned'];
export const WORLD = ['Reassign', 'Cancel', 'Remove', 'GoesOff', 'SendsUpdate'];
export const FIXES = ['timerSkips', 'skipFirst', 'emptyAbandons', 'ownerAsks', 'startAfterSkip'];

export default function Standup({ Fixes = FIXES, World = WORLD, Moves = 2, Max = 4, Bug = null } = {}) {
  const fix = Object.fromEntries(FIXES.map((f) => [f, Fixes.includes(f)]));
  const arrows = [...DRAWN, ...(fix.startAfterSkip ? ['skipped>asking'] : [])];
  const t0 = (s, by) => Object.assign(clone(s), { by });
  const inFlight = (s) => WAITING.includes(s.su.st) || s.cap?.st === 'reviewing' || !!s.cap?.items.some((i) => i.st === 'owner_ask');
  const moves = (s, name) => World.includes(name) && s.moves < Moves && inFlight(s);
  const moved = (s, by) => Object.assign(t0(s, by), { moves: s.moves + 1 });
  const members = (s, p) => [PM[p], ...(s.member[p] ? ['kemar'] : [])];
  // Rule 3, P10: Kemar is asked only about open work of his in a project he can open
  const mayAsk = (s, x) =>
    s.work[x].owner === 'kemar' && (Bug === 'ownerOnly' || s.member[PROJECT[x]]) && OPEN.includes(s.work[x].st);
  const hasOpenWork = (s) =>
    ITEMS.some((x) => s.work[x].owner === 'kemar' && s.member[PROJECT[x]] && OPEN.includes(s.work[x].st));
  const blockedFirst = (s) => (a, b) => (s.work[a].st === 'blocked' ? 0 : 1) - (s.work[b].st === 'blocked' ? 0 : 1);
  // A question remembers what it showed (saw) and whether he could open it then (m, read only by bug rightAtAsk)
  const question = (t, subject, x = subject) => ({ s: subject, x, saw: x ? t.work[x].st : null, m: x ? t.member[PROJECT[x]] : null });

  // Section 12, SU8: the question list is rebuilt at each step, the follow-up included
  const nextQuestion = (t) => {
    const su = t.su;
    const x = su.follow;
    su.follow = null;
    if (x && (Bug === 'staleList' || mayAsk(t, x))) return question(t, 'wait', x);
    if (su.asked.length >= Max) return null;
    const pool = Bug === 'staleList' ? su.plan : ITEMS.filter((k) => mayAsk(t, k)).sort(blockedFirst(t));
    const next = pool.find((k) => !su.asked.includes(k));
    if (next) return question(t, next);
    return su.asked.includes('new') ? null : question(t, 'new', null);
  };

  const compose = (t) => {
    // composed ──▶ one capture (M1, M2) from the answers, each read with its question as context
    const items = t.su.items;
    Object.assign(t.su, { st: 'composed', q: null, items: [] });
    t.cap = { id: t.su.runs, st: items.length ? 'reviewing' : 'nothing', items };
    if (Bug === 'autoApply') {
      // Planted bug autoApply: a tap answer is high confidence, so Atlas applies it without the review
      for (const it of items) if (it.rec !== 'blocker' && apply(t, it)) it.st = 'applied';
    }
    return t;
  };
  const abandon = (t) => Object.assign(t, { su: { ...t.su, st: 'abandoned', q: null, items: [], follow: null } });
  // k = n, or STOP: as drawn both compose; with emptyAbandons nothing answered is abandoned
  const finish = (t) => (t.su.answers.length || !fix.emptyAbandons ? compose(t) : abandon(t));
  const advance = (t) => {
    const next = nextQuestion(t);
    if (!next) return finish(t);
    t.su.q = next;
    if (next.s !== 'wait') t.su.asked = [...t.su.asked, next.s];
    return t;
  };
  const begin = (t) => {
    t.su = { st: 'asking', q: null, asked: [], answers: [], items: [], follow: null, runs: t.su.runs + 1 };
    if (Bug === 'staleList') t.su.plan = ITEMS.filter((k) => mayAsk(t, k)).sort(blockedFirst(t));
    return advance(t);
  };

  // What an answer proposes. A tap answer is the item with the question as its quote (facts: that item)
  const record = (t, q, a) => {
    const n = t.su.answers.length;
    const add = (it, k = 0) => t.su.items.push({ id: n * 2 + k, st: 'ok', n: 0, ...it });
    const x = q.x;
    if (q.s === 'new') {
      // M14: routed to a project he is in, or not filed
      if (a === 'names' && t.member.forager) add({ rec: 'blocker', p: 'forager', names: 'alicia', facts: [], m: true });
    } else if (q.s === 'wait') {
      // The answer is the blocked note; naming something makes a blocker report (Section 12)
      if (a === 'names') add({ rec: 'blocker', p: PROJECT[x], names: 'alicia', facts: [x], m: q.m });
    } else if (a === 'done' || a === 'stuck') {
      add({ rec: x, p: PROJECT[x], to: a === 'done' ? 'done' : 'blocked', saw: q.saw, m: q.m, facts: [x] });
      if (a === 'stuck') t.su.follow = x;
    } else if (a === 'other') {
      // SU4: "Not that, but #212 is done" is read as a free-form update with the question as context
      const y = ITEMS.find((k) => k !== x);
      if (!t.su.asked.includes(y)) t.su.asked = [...t.su.asked, y];
      const facts = Bug === 'questionAsQuote' ? [x, y] : [y];
      if (t.member[PROJECT[y]]) add({ rec: y, p: PROJECT[y], to: 'done', saw: t.work[y].st, m: true, facts }, 1);
    }
  };

  // Fires the work item's event (M4): compare and set, then the M5 arrow
  const apply = (t, it) => {
    if (it.rec === 'blocker') {
      t.braid = [...t.braid, { p: it.p, item: `${t.cap.id}.${it.id}`, names: it.names }];
      if (Bug === 'assignNamed') t.tasks += 1; // Planted bug: Alicia, named as what it waits on, gets a to-do
      return true;
    }
    const w = t.work[it.rec];
    if (w.st === it.to) return true; // no_change: someone got there first
    if (Bug !== 'blindWrite' && w.st !== it.saw) return false;
    if (!(WORK[w.st] ?? []).includes(it.to) && Bug !== 'blindWrite') return false;
    w.st = it.to;
    return true;
  };

  return {
    name: `Standup (${Fixes.length === FIXES.length ? 'fixed' : Fixes.length ? Fixes.join(', ') : 'as drawn'}${Bug ? `, bug ${Bug}` : ''})`,
    init: () =>
      [true, false].map((insights) => ({
        work: { w208: { owner: 'kemar', st: 'in_progress' }, w212: { owner: 'kemar', st: 'in_progress' } },
        member: { forager: true, insights },
        on: true,
        updated: false,
        moves: 0,
        su: { st: 'scheduled', q: null, asked: [], answers: [], items: [], follow: null, runs: 0 },
        cap: null,
        braid: [],
        tasks: 0,
        said: null,
        by: null,
      })),
    actions: [
      {
        // TIMER standup time (M23 rules: working day, not on leave, turned on, under the cap)
        name: 'Timer',
        params: [[]],
        fair: true,
        step(s) {
          if (s.su.st !== 'scheduled') return [];
          const t = t0(s, 'atlas');
          if (!s.on) {
            // As drawn there is no arrow for this: the standup waits in scheduled forever
            if (!fix.timerSkips) return [];
            t.su.st = 'skipped';
            return [t];
          }
          if (fix.skipFirst && Bug !== 'noSkip' && (s.updated || !hasOpenWork(s))) {
            t.su.st = 'skipped';
            return [t];
          }
          return [begin(t)];
        },
      },
      {
        // scheduled ──(guard: they already sent an update today, or have no open work)──▶ skipped
        name: 'SkipGuard',
        params: [[]],
        fair: true,
        step(s) {
          if (s.su.st !== 'scheduled' || Bug === 'noSkip' || !(s.updated || !hasOpenWork(s))) return [];
          const t = t0(s, 'atlas');
          t.su.st = 'skipped';
          return [t];
        },
      },
      {
        // "Start my standup" in the DPM chat (Section 12). SU10: one per person per day
        name: 'Start',
        params: [[]],
        step(s) {
          const t = t0(s, 'kemar');
          const from = s.su.st;
          let ok = from === 'scheduled' || (fix.startAfterSkip && from === 'skipped');
          // Planted bug twoPerDay: a second standup starts after the first ended (one more is enough to show it)
          if (Bug === 'twoPerDay' && FINAL.includes(from) && s.su.runs < 2) ok = true;
          // Planted bug startNeedsWork: refused with no open work, where SU1 asks "Anything blocking you?"
          if (Bug === 'startNeedsWork' && !hasOpenWork(s)) ok = false;
          if (!ok) {
            t.said = 'refused';
            return [t];
          }
          t.said = 'started';
          return [begin(t)];
        },
      },
      {
        // ANSWER: a tap or a typed reply to the question on screen. Each button carries its question's id
        name: 'Answer',
        params: [...ITEMS, 'new', 'wait'].flatMap((subject) => ANSWERS[kindOf(subject)].map((a) => [subject, a])),
        step(s, subject, a) {
          const su = s.su;
          if (Bug === 'lateAnswer' && su.st === 'abandoned' && su.asked.includes(subject)) {
            // Planted bug lateAnswer: a tap after the idle timer abandoned it reopens the standup at that question
            const t = t0(s, 'kemar');
            Object.assign(t.su, { st: 'asking', q: question(t, subject, kindOf(subject) === 'item' ? subject : null) });
            return [t];
          }
          if (su.st !== 'asking') return [];
          const q = su.q;
          if (q.s !== subject) {
            // Rule 6: a tap on an earlier question, or one delivered twice, changes nothing
            const taken = Bug === 'noIdCheck' && su.asked.includes(subject) && kindOf(subject) === 'item' && kindOf(q.s) === 'item';
            if (!taken) return [];
          }
          const t = t0(s, 'kemar');
          t.su.answers = [...su.answers, { q: q.s, on: subject }];
          record(t, q, a);
          return [advance(t)];
        },
      },
      {
        name: 'Skip',
        params: [[]],
        step(s) {
          if (s.su.st !== 'asking') return [];
          return [advance(t0(s, 'kemar'))];
        },
      },
      {
        // STOP ("that's all"). SU6: what was answered is composed; the rest is not asked again today
        name: 'Stop',
        params: [[]],
        step(s) {
          if (s.su.st !== 'asking') return [];
          return [finish(t0(s, 'kemar'))];
        },
      },
      {
        // TIMER standupIdleMinutes: composed if anything was answered, else abandoned (SU7)
        name: 'Idle',
        params: [[]],
        fair: true,
        step(s) {
          if (s.su.st !== 'asking' || Bug === 'noIdleTimer') return [];
          const t = t0(s, 'atlas');
          return [t.su.answers.length || Bug === 'idleComposesEmpty' ? compose(t) : abandon(t)];
        },
      },
      {
        // M2 SAVE by the author: all or nothing (M4), rights checked now (rule 4), versions compared (SU3)
        name: 'Save',
        params: [[]],
        step(s) {
          const c = s.cap;
          // Planted bug resave: a second Save on a saved capture runs again (once is enough to show it)
          if (!c || !(c.st === 'reviewing' || (Bug === 'resave' && c.st === 'saved' && !c.again))) return [];
          const t = t0(s, 'kemar');
          if (c.st === 'saved') t.cap.again = true;
          const due = t.cap.items.filter((it) => it.st === 'ok' || (Bug === 'resave' && it.st === 'applied'));
          const theirs = (it) => it.rec !== 'blocker' && fix.ownerAsks && t.work[it.rec].owner !== 'kemar';
          let failed = false;
          for (const it of due) {
            const right = Bug === 'rightAtAsk' ? it.m : t.member[it.p];
            if (!right) Object.assign(it, { st: 'conflict', why: 'right' });
            else if (!theirs(it) && !apply(clone(t), it)) Object.assign(it, { st: 'conflict', why: 'version' });
            else continue;
            failed = true;
          }
          // Nothing applied; back to review with each conflict shown (M4)
          if (failed) return [t];
          for (const it of due) {
            if (theirs(it)) {
              // Rule 10: his word about Alicia's #208 changes nothing of hers until she confirms
              it.st = 'owner_ask';
              continue;
            }
            apply(t, it);
            Object.assign(it, { st: 'applied', n: it.n + 1 });
          }
          t.cap.st = 'saved';
          return [t];
        },
      },
      {
        // The author decides again on a conflict: drop it, or take it again over what is there now (M3)
        name: 'Review',
        params: product([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], ['drop', 'again']),
        step(s, id, how) {
          const it = s.cap?.st === 'reviewing' && s.cap.items.find((i) => i.id === id && i.st === 'conflict');
          if (!it) return [];
          if (how === 'again' && (it.why !== 'version' || !(WORK[s.work[it.rec].st] ?? []).includes(it.to))) return [];
          const t = t0(s, 'kemar');
          const u = t.cap.items.find((i) => i.id === id);
          if (how === 'drop') u.st = 'dropped';
          else Object.assign(u, { st: 'ok', why: null, saw: s.work[it.rec].st });
          return [t];
        },
      },
      {
        name: 'Discard',
        params: [[]],
        step: (s) => (s.cap?.st === 'reviewing' ? [Object.assign(t0(s, 'kemar'), { cap: { ...s.cap, st: 'rejected' } })] : []),
      },
      {
        // TIMER review_expiry (M2): 7 days, nothing applied
        name: 'Expires',
        params: [[]],
        fair: true,
        step: (s) => (s.cap?.st === 'reviewing' ? [Object.assign(t0(s, 'atlas'), { cap: { ...s.cap, st: 'expired' } })] : []),
      },
      {
        // ownerAsks: the record's owner confirms or declines what Kemar said about it
        name: 'OwnerAnswers',
        params: product([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], ['confirm', 'decline']),
        step(s, id, how) {
          const it = s.cap?.items.find((i) => i.id === id && i.st === 'owner_ask');
          if (!it) return [];
          const t = t0(s, s.work[it.rec].owner);
          const u = t.cap.items.find((i) => i.id === id);
          u.st = how === 'confirm' && apply(t, u) ? 'applied' : 'declined';
          if (u.st === 'applied') u.n += 1;
          return [t];
        },
      },
      // The world moves underneath the standup, at most Moves times and only while something is in flight
      {
        // SU8: a PM takes the item back
        name: 'Reassign',
        params: ITEMS.map((x) => [x]),
        step(s, x) {
          if (!moves(s, 'Reassign') || s.work[x].owner !== 'kemar') return [];
          const t = moved(s, PM[PROJECT[x]]);
          t.work[x].owner = PM[PROJECT[x]];
          return [t];
        },
      },
      {
        // SU3: someone else changes the item while he answers
        name: 'Cancel',
        params: ITEMS.map((x) => [x]),
        step(s, x) {
          if (!moves(s, 'Cancel') || !OPEN.includes(s.work[x].st)) return [];
          const t = moved(s, PM[PROJECT[x]]);
          t.work[x].st = 'cancelled';
          return [t];
        },
      },
      {
        name: 'Remove',
        params: ['forager', 'insights'].map((p) => [p]),
        step(s, p) {
          if (!moves(s, 'Remove') || !s.member[p]) return [];
          const t = moved(s, PM[p]);
          t.member[p] = false;
          return [t];
        },
      },
      {
        // Leave starts, the standup is turned off, or the nudge cap is reached (M23 rules)
        name: 'GoesOff',
        params: [[]],
        step: (s) => (moves(s, 'GoesOff') && s.on ? [Object.assign(moved(s, 'kemar'), { on: false })] : []),
      },
      {
        // SU2: a free-form update of his own today
        name: 'SendsUpdate',
        params: [[]],
        step: (s) => (moves(s, 'SendsUpdate') && !s.updated ? [Object.assign(moved(s, 'kemar'), { updated: true })] : []),
      },
    ],
    invariants: {
      // SU10, SU6: one standup per person per day
      OnePerDay: (s) => s.su.runs <= 1,
      // Rule 6: an answer is taken only for the question it was given to
      AnswerMatchesQuestion: (s) => s.su.answers.every((a) => a.q === a.on),
      // Rule 6: a save that runs again applies nothing again
      AppliedAtMostOnce: (s) =>
        (s.cap?.items ?? []).every((i) => i.n <= 1) && new Set(s.braid.map((b) => b.item)).size === s.braid.length,
      // A composed standup has something in it; nothing answered is abandoned
      ComposedHoldsAnswers: (s) => s.su.st !== 'composed' || s.su.answers.length > 0,
      // Rule 8: a quote routed to a project holds only facts every member of that project may see
      QuoteFactsReadable: (s) =>
        [...s.su.items, ...(s.cap?.items ?? [])].every((it) =>
          it.facts.every((f) => members(s, it.p).every((m) => members(s, PROJECT[f]).includes(m))),
        ),
    },
    actionProperties: {
      // Rule 2: only drawn arrows
      OnlyDrawnArrows: (s, t) => s.su.st === t.su.st || arrows.includes(`${s.su.st}>${t.su.st}`),
      // Rule 3, P10, SU8: a question names only open work of his he can open, when it is asked
      AskedOnlyWhatTheyMaySee: (s, t) => {
        const q = t.su.q;
        if (!q?.x || JSON.stringify(q) === JSON.stringify(s.su.q)) return true;
        return t.work[q.x].owner === 'kemar' && t.member[PROJECT[q.x]];
      },
      // SU1, SU2, CD12: Atlas starts a standup only with open work and no update today
      NoStandupAfterUpdate: (s, t) =>
        !(s.su.st === 'scheduled' && t.su.st === 'asking' && t.by === 'atlas') || (!s.updated && hasOpenWork(s)),
      // SU1: a person who asks for a standup gets one, unless one already ran today
      AskedStandupRuns: (s, t) => !(t.said === 'refused' && s.said !== 'refused') || s.su.runs >= 1,
      // Rule 1: nothing Atlas says changes a record; only a person's save, confirm or own act does
      AtlasNeverChangesRecords: (s, t) => {
        const rec = (x) => JSON.stringify([x.work, x.braid, x.tasks]);
        return rec(s) === rec(t) || (t.by !== 'atlas' && (t.by !== 'kemar' || s.cap !== null));
      },
      // Rule 4: Kemar's save changes a record only in a project he is a member of when it runs
      RightCheckedWhenItRuns: (s, t) =>
        t.by !== 'kemar' ||
        (ITEMS.every((x) => s.work[x].st === t.work[x].st || s.member[PROJECT[x]]) &&
          t.braid.slice(s.braid.length).every((b) => s.member[b.p])),
      // SU3, M4: a save writes only over the value the answer saw
      NeverOverwriteUnseen: (s, t) =>
        (t.cap?.items ?? []).every((it) => {
          const before = s.cap?.id === t.cap.id && s.cap.items.find((i) => i.id === it.id);
          if (it.rec === 'blocker' || !before || it.n === before.n) return true;
          return [it.saw, it.to].includes(s.work[it.rec].st);
        }),
      // Rule 10: his word changes only his records; someone else's changes only when they act
      YourWordChangesOnlyYours: (s, t) =>
        ITEMS.every((x) => s.work[x].owner === 'kemar' || s.work[x].st === t.work[x].st || !['kemar', 'atlas'].includes(t.by)) &&
        (s.tasks === t.tasks || t.by === 'alicia'),
    },
    leadsTo: {
      // Rule 5: every waiting state has a timer or a named way out
      StandupEnds: [{ label: 'standup', P: (s) => WAITING.includes(s.su.st), Q: (s) => FINAL.includes(s.su.st) }],
    },
  };
}
