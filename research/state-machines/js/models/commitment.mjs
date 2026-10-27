// M22 Commitment (use-cases/atlas-conversational-plan.md, section 7, phase E), with the rules of section 1
// and the decisions CD3 to CD5 and CD24 of section 24. Kemar is a member of Forager; Alicia is its PM;
// Omar is in neither and only ever asks.
//   "I'll send Kyle the access request for #208 tomorrow" is an item in Kemar's review (M3) and opens a
//   commitment when he saves it. At the end of its due day it is due; a check-in goes out on the next
//   working day he is in (CM7, CM8); no reply after config.commitmentCheckIns check-ins lapses it.
//   A later update ("Sent Kyle the request") is proposed as done (CM6); #208 going Done does it too.
//   Private to Kemar (CD3). Alicia's words about him are not proposed (CD5) and change nothing of his
//   (rule 10). The answer to "What did I promise?" (CM12) is a view, built per viewer.
// Days are a three day week (two working days, then a weekend day), so a due day can fall on a weekend.
// A due date is the end of the day it was saved or moved on (CM1, CM2 and the date words are left out).
// The day ends (timers fire), then the morning job sends check-ins before the next day can end.
//
// Fixes are the smallest changes for what the check found in the plan as written (none by default):
//   anyLive        DONE, DROP and a new date work from open, due and checking, and CM5 matches any
//                  live commitment, not only an open one
//   recordAtSave   saving reads the linked record's state: a promise about Done work is No change, and
//                  one about cancelled work is saved with CM11's question already asked
import { clone, product } from '../lib.mjs';

const LIVE = ['open', 'due', 'checking'];
const FINAL = ['done', 'dropped', 'lapsed'];
const live = (c) => !!c && LIVE.includes(c.st);
const SLOTS = ['c1', 'c2'];
const OWNER = 'kemar';
const VIEWERS = ['kemar', 'alicia', 'omar'];
const WEEKEND = 2;
const DROP_AT = 3; // CD24: after 3 moves the check-in asks whether to drop it
const OPEN_ITEM = ['proposed', 'conflict'];

// What can be said, each once. Alicia's two are about Kemar.
const MESSAGES = {
  m1: { by: 'kemar', kind: 'promise', rec: '208' }, // "I'll send Kyle the access request for #208 tomorrow"
  m2: { by: 'kemar', kind: 'promise', rec: null }, // "I'll send Kyle the request Monday" (CM5)
  m3: { by: 'kemar', kind: 'done', rec: null }, // "Sent Kyle the request" (CM6)
  m4: { by: 'alicia', kind: 'promise', rec: '208' }, // "Kemar will send Kyle the request" (CD5)
  m5: { by: 'alicia', kind: 'done', rec: null }, // "Kemar sent Kyle the request" (rule 10)
};

// The arrows as the plan draws them; 'none>open' is SAVE
const DRAWN = ['none>open', 'open>done', 'open>dropped', 'open>due', 'due>checking', 'checking>done', 'checking>open', 'checking>dropped', 'checking>lapsed'];
const ANY_LIVE = ['due>done', 'due>dropped', 'due>open'];

export const ALL_FIXES = ['anyLive', 'recordAtSave'];

// World lists the events around the commitment that a setting includes, to keep each run small
export const WORLD = ['leave', 'project', 'work', 'repeat'];

export default function Commitment({ Says = ['m1', 'm2', 'm3'], CheckIns = 2, Fixes = [], World = WORLD, Bug = null } = {}) {
  const bug = (b) => [Bug].flat().includes(b);
  const fixed = (f) => Fixes.includes(f);
  // Where the owner's DONE and DROP, and CM5's match, apply
  const liveFrom = fixed('anyLive') ? LIVE : ['open'];
  const arrows = fixed('anyLive') ? [...DRAWN, ...ANY_LIVE] : DRAWN;
  // Who moved is kept only when it is someone other than Kemar or a timer, to keep the state space small
  const t0 = (s, by) => Object.assign(clone(s), { by: [OWNER, 'timer', 'dpm'].includes(by) ? null : by, last: null });
  // Per-viewer reads (P10): Alicia is Forager's PM, Kemar is in it until he leaves, Omar never
  const reads = (s, viewer) => viewer === 'alicia' || (viewer === OWNER && s.member);
  const firstLive = (s) => SLOTS.find((k) => live(s.c[k]));
  const working = (s) => s.day !== WEEKEND;
  const isIn = (s) => s.leave !== 'away';

  const end = (c, st) => {
    Object.assign(c, { st, out: false, ci: null });
    if (c.stands === 'asked' && !bug('standsStays')) c.stands = null;
  };
  // A new date: back to open, the move counted (CM10), check-ins start again
  const redate = (c) => {
    Object.assign(c, { st: 'open', moves: Math.min(c.moves + 1, DROP_AT), checkIns: 0, out: false, ci: null });
    if (c.stands === 'asked') c.stands = 'kept'; // a new date says it still stands (CM11)
  };
  const fire = (c, ev) => {
    if (!liveFrom.includes(c.st)) return false; // not a drawn arrow: refused, changes nothing
    end(c, ev === 'done' ? 'done' : 'dropped');
    return true;
  };

  // Saving an item from the speaker's review (M3, M4). Returns false when it is refused outright.
  function save(t, m) {
    const said = MESSAGES[m];
    const it = t.msg[m];
    if (said.kind === 'promise') {
      // CM5: the same promise again moves the date of the one already there. As written it matches
      // only an open one, so a due or checking one gets a twin.
      const k = SLOTS.find((x) => t.c[x] && liveFrom.includes(t.c[x].st));
      if (k && !bug('noMatch')) {
        redate(t.c[k]);
        it.st = 'saved';
        return true;
      }
      // Permission is checked when it runs: the link holds only if Kemar can still read #208 (CM9)
      const link = bug('noRecheckAtSave') ? it.link : it.link && t.member ? it.link : null;
      if (link && fixed('recordAtSave') && t.work === 'done') {
        it.st = 'no_change';
        return true;
      }
      const free = SLOTS.find((x) => !t.c[x]);
      if (!free) return false;
      const ask = link && fixed('recordAtSave') && t.work === 'cancelled' ? 'asked' : null;
      t.c[free] = { st: 'open', link, moves: 0, checkIns: 0, out: false, stands: ask, ci: null };
      it.st = 'saved';
      return true;
    }
    // A done item (CM6) fires DONE on the live commitment, if the table has that arrow
    const k = firstLive(t);
    if (!k) {
      it.st = SLOTS.some((x) => t.c[x]?.st === 'done') ? 'no_change' : 'conflict';
      return true;
    }
    if (fire(t.c[k], 'done')) it.st = 'saved';
    else {
      // M4: an illegal arrow on the target is a conflict. Kemar has still said it is done.
      it.st = 'conflict';
      if (said.by === OWNER) t.c[k].told = true;
    }
    return true;
  }

  function reply(t, k, ans) {
    const c = t.c[k];
    if (ans === 'date') redate(c);
    else end(c, ans === 'done' ? 'done' : 'dropped');
  }

  return {
    name: `Commitment (${Fixes.length ? `fixes ${Fixes.join(', ')}` : 'as written'}, ${CheckIns} check-ins, says ${Says.join(' ')}${Bug ? `, bug ${[Bug].flat().join(' + ')}` : ''})`,
    init: () => [
      {
        msg: Object.fromEntries(Says.map((m) => [m, { st: 'said', link: null }])),
        c: Object.fromEntries(SLOTS.map((k) => [k, null])),
        work: 'open', // #208 on Forager
        member: true, // Kemar on Forager
        leave: 'before',
        day: 0,
        morning: false,
        last: null,
        by: null,
      },
    ],
    actions: [
      {
        // Atlas reads the message and proposes; it never changes a record (rule 1)
        name: 'Reads',
        params: Says.map((m) => [m]),
        step(s, m) {
          if (s.msg[m].st !== 'said') return [];
          const said = MESSAGES[m];
          const t = t0(s, 'atlas');
          const it = t.msg[m];
          const k = firstLive(s);
          if (said.by === OWNER && said.kind === 'promise') Object.assign(it, { st: 'proposed', link: said.rec && s.member ? said.rec : null });
          else if (said.by === OWNER) {
            it.st = k ? 'proposed' : 'none';
            // Planted bug atlasMarksDone: Atlas marks the commitment done itself, skipping the review
            if (k && bug('atlasMarksDone')) {
              end(t.c[k], 'done');
              it.st = 'saved';
            }
          } else if (said.kind === 'promise') Object.assign(it, { st: bug('proposeForOthers') ? 'proposed' : 'none', link: said.rec }); // CD5
          else it.st = k && bug('othersDone') ? 'proposed' : 'none'; // rule 10
          return [t];
        },
      },
      {
        name: 'Save',
        params: Says.map((m) => [m]),
        step(s, m) {
          if (!OPEN_ITEM.includes(s.msg[m].st)) return [];
          const t = t0(s, MESSAGES[m].by);
          if (!save(t, m)) return [];
          if (World.includes('repeat')) t.last = { cmd: 'save', m, n: 1 };
          return [t];
        },
      },
      {
        name: 'Rejects',
        params: Says.map((m) => [m]),
        step(s, m) {
          if (!OPEN_ITEM.includes(s.msg[m].st)) return [];
          const t = t0(s, MESSAGES[m].by);
          t.msg[m].st = 'rejected';
          return [t];
        },
      },
      {
        // The capture's review expires (M2 to M4), so a proposal never waits forever
        name: 'ReviewExpires',
        params: Says.map((m) => [m]),
        fair: true,
        step(s, m) {
          if (!OPEN_ITEM.includes(s.msg[m].st)) return [];
          const t = t0(s, 'timer');
          t.msg[m].st = 'withdrawn';
          return [t];
        },
      },
      {
        // Kemar answers a check-in: done, a new date, or drop
        name: 'Replies',
        params: product(SLOTS, ['done', 'date', 'drop']),
        step(s, k, ans) {
          const c = s.c[k];
          // Planted bug reviveLapsed: a late reply to a lapsed commitment still counts
          if (!c || !(c.st === 'checking' || (bug('reviveLapsed') && c.st === 'lapsed'))) return [];
          const t = t0(s, OWNER);
          reply(t, k, ans);
          if (World.includes('repeat')) t.last = { cmd: 'reply', k, ans, n: 1 };
          return [t];
        },
      },
      {
        // DONE and DROP by the owner, from the commitments list (CM12)
        name: 'OwnerSays',
        params: product(SLOTS, ['done', 'drop']),
        step(s, k, ev) {
          if (!live(s.c[k])) return [];
          const t = t0(s, OWNER);
          if (!fire(t.c[k], ev)) return [];
          return [t];
        },
      },
      {
        // CM11: Kemar answers whether it still stands
        name: 'Stands',
        params: product(SLOTS, ['keep', 'drop']),
        step(s, k, ans) {
          if (!live(s.c[k]) || s.c[k].stands !== 'asked') return [];
          const t = t0(s, OWNER);
          if (ans === 'keep') t.c[k].stands = 'kept';
          else if (!fire(t.c[k], 'drop')) return [];
          return [t];
        },
      },
      {
        // The network or a second tap sends the last command again, with the same id
        name: 'Repeats',
        world: 'repeat',
        params: [[]],
        step(s) {
          if (!s.last || s.last.n > 1) return [];
          if (!bug('noDedup')) return []; // the id was seen: changes nothing
          const t = Object.assign(t0(s, s.last.cmd === 'save' ? MESSAGES[s.last.m].by : OWNER), { last: s.last });
          if (s.last.cmd === 'save') save(t, s.last.m);
          else reply(t, s.last.k, s.last.ans);
          t.last = { ...s.last, n: s.last.n + 1 };
          return [t];
        },
      },
      {
        // The day ends: TIMER due at the end of the due day, TIMER no reply on a check-in
        name: 'DayEnds',
        params: [[]],
        fair: true,
        step(s) {
          if (s.morning) return [];
          const t = t0(s, 'timer');
          for (const k of SLOTS) {
            const c = t.c[k];
            if (!live(c)) continue;
            if (c.st === 'open' && !bug('noDueTimer')) c.st = 'due';
            else if (c.st === 'checking' && c.out && c.checkIns >= CheckIns && !bug('noLapseTimer')) end(c, 'lapsed');
            else if (c.st === 'checking' && c.out && c.checkIns < CheckIns) Object.assign(c, { out: false, ci: null });
            // Planted bug askEachTime: the question about cancelled work comes back every day
            if (bug('askEachTime') && live(c) && c.link && t.work === 'cancelled' && c.stands === 'kept') c.stands = 'asked';
          }
          t.day = (s.day + 1) % 3;
          t.morning = true;
          return [t];
        },
      },
      {
        // The morning job: CHECK_IN_SENT on a working day the owner is in (CM7, CM8)
        name: 'Morning',
        params: [[]],
        fair: true,
        step(s) {
          if (!s.morning) return [];
          const t = t0(s, 'timer');
          t.morning = false;
          if (!((working(s) && isIn(s)) || bug('checkInWhileAway'))) return [t];
          for (const k of SLOTS) {
            const c = t.c[k];
            if (!live(c)) continue;
            const send = c.st === 'due' || (c.st === 'checking' && !c.out && c.checkIns < CheckIns);
            if (!send) continue;
            // The check-in is built through Kemar's reads now; #208 is named only if he can still open it
            const rec = c.link && (reads(t, OWNER) || bug('readsTrustLink')) ? c.link : null;
            Object.assign(c, { st: 'checking', checkIns: c.checkIns + 1, out: true, ci: { rec, drop: c.moves >= DROP_AT && !bug('noDropAsk') } });
          }
          return [t];
        },
      },
      { name: 'LeaveStarts', world: 'leave', params: [[]], step: (s) => (s.leave === 'before' ? [Object.assign(t0(s, OWNER), { leave: 'away' })] : []) },
      { name: 'LeaveEnds', world: 'leave', params: [[]], fair: true, step: (s) => (s.leave === 'away' ? [Object.assign(t0(s, 'dpm'), { leave: 'after' })] : []) },
      {
        // CM9: Kemar leaves Forager. His commitments stay his; the link to #208 is dropped
        name: 'LeavesProject',
        world: 'project',
        params: [[]],
        step(s) {
          if (!s.member) return [];
          const t = t0(s, OWNER);
          t.member = false;
          if (!bug('keepLinkOnLeave')) for (const k of SLOTS) if (t.c[k]?.link) t.c[k].link = null;
          return [t];
        },
      },
      {
        // Alicia marks #208 Done: DONE on a linked commitment, if the table has that arrow
        name: 'WorkDone',
        world: 'work',
        params: [[]],
        step(s) {
          if (s.work !== 'open') return [];
          const t = t0(s, 'alicia');
          t.work = 'done';
          if (!bug('workDoneIgnored')) for (const k of SLOTS) if (live(t.c[k]) && t.c[k].link) fire(t.c[k], 'done');
          return [t];
        },
      },
      {
        // CM11: Alicia cancels #208; a linked commitment asks once whether it still stands
        name: 'WorkCancelled',
        world: 'work',
        params: [[]],
        step(s) {
          if (s.work !== 'open') return [];
          const t = t0(s, 'alicia');
          t.work = 'cancelled';
          if (!bug('noCancelAsk')) for (const k of SLOTS) if (live(t.c[k]) && t.c[k].link && !t.c[k].stands) t.c[k].stands = 'asked';
          return [t];
        },
      },
    ].filter((a) => !a.world || World.includes(a.world)),
    // CM12, "What did I promise?": the viewer's own open and due commitments, through their reads
    views: {
      answer: (s) => Object.fromEntries(VIEWERS.map((v) => [v, answer(s, v)])),
    },
    invariants: {
      TypeOK: (s) =>
        SLOTS.every((k) => !s.c[k] || ([...LIVE, ...FINAL].includes(s.c[k].st) && s.c[k].checkIns <= CheckIns && s.c[k].moves <= DROP_AT)) &&
        Says.every((m) => ['said', 'none', ...OPEN_ITEM, 'saved', 'no_change', 'rejected', 'withdrawn'].includes(s.msg[m].st)),
      // CM5: one promise, one live commitment; the same words again move its date
      OnePerPromise: (s) => SLOTS.filter((k) => live(s.c[k])).length <= 1,
      // CM9 and rule 4: a commitment links only to a record its owner can open
      LinkOnlyWhileMember: (s) => SLOTS.every((k) => !s.c[k]?.link || s.member),
      // CM11: a live commitment on cancelled work has asked whether it still stands
      CancelledWorkAsks: (s) => SLOTS.every((k) => !live(s.c[k]) || !s.c[k].link || s.work !== 'cancelled' || s.c[k].stands),
      // Rule 6: a command with an id has its effect once
      AppliedAtMostOnce: (s) => !s.last || s.last.n === 1,
      // P10, CD3, rule 8: an answer holds only the viewer's own commitments, only records they can open, and
      // nothing about anyone else's, not even a count
      AnswerHoldsOnlyWhatViewerMaySee: (s) =>
        VIEWERS.every((v) => answer(s, v).every((a) => a.owner === v && a.hidden === undefined && (!a.rec || reads(s, v)))),
    },
    actionProperties: {
      // Section 1, rule 2 of the machines doc: a state changes only along a drawn arrow
      OnlyDrawnArrows: (s, t) =>
        SLOTS.every((k) => {
          const from = s.c[k]?.st ?? 'none';
          const to = t.c[k]?.st ?? 'none';
          return from === to || arrows.includes(`${from}>${to}`);
        }),
      // Rule 1: Atlas proposes; nothing it does changes a commitment or a record
      AtlasOnlyProposes: (s, t) => t.by !== 'atlas' || (JSON.stringify(s.c) === JSON.stringify(t.c) && s.work === t.work),
      // Rule 10, CD5: someone else's word changes nothing of Kemar's. Only his own steps, timers, and the
      // drawn rule on his linked record (#208 Done or cancelled) touch his commitments
      YourWordOnlyYours: (s, t) =>
        t.by === null ||
        SLOTS.every((k) => JSON.stringify(s.c[k]) === JSON.stringify(t.c[k]) || (s.c[k]?.link && s.work !== t.work)),
      // CM7, CM8: a check-in goes out only on a working day the owner is in
      NoCheckInWhileAway: (s, t) => SLOTS.every((k) => !sent(s, t, k) || (working(t) && isIn(t))),
      // Nothing asks "Did you send it?" once Kemar said it is done, or once its linked work is Done
      NoAskAfterDone: (s, t) => SLOTS.every((k) => !sent(s, t, k) || (!s.c[k].told && !(s.work === 'done' && s.c[k].link))),
      // P10 and rule 4: a check-in names a record only if its reader can open it when it is sent
      CheckInHoldsOnlyWhatOwnerMaySee: (s, t) => SLOTS.every((k) => !sent(s, t, k) || !t.c[k].ci.rec || reads(t, OWNER)),
      // CM10, CD24: after 3 moves the check-in asks whether to drop it
      DropAskedAfterMoves: (s, t) => SLOTS.every((k) => !sent(s, t, k) || t.c[k].moves < DROP_AT || t.c[k].ci.drop),
      // CM11: asked once; an answer of "it still stands" is never asked again
      StandsAskedOnce: (s, t) => SLOTS.every((k) => s.c[k]?.stands !== 'kept' || t.c[k].stands !== 'asked'),
    },
    leadsTo: {
      // Rule 5: every waiting state has a timer or a named way out
      NothingStuck: [
        ...Says.map((m) => ({ label: `${m} in review`, P: (s) => OPEN_ITEM.includes(s.msg[m].st), Q: (s) => !OPEN_ITEM.includes(s.msg[m].st) })),
        ...product(SLOTS, LIVE).map(([k, st]) => ({ label: `${k} ${st}`, P: (s) => s.c[k]?.st === st, Q: (s) => s.c[k]?.st !== st })),
      ],
      // CM11: the question is answered, or closes with the commitment
      StandsQuestionEnds: SLOTS.map((k) => ({ label: k, P: (s) => s.c[k]?.stands === 'asked', Q: (s) => s.c[k]?.stands !== 'asked' })),
    },
  };

  function answer(s, viewer) {
    const own = SLOTS.filter((k) => live(s.c[k]) && (viewer === OWNER || (bug('showOnProject') && s.c[k].link && reads(s, viewer))));
    // Built through the viewer's reads: #208 is named only if they can open it now
    const out = own.map((k) => ({ id: k, owner: OWNER, rec: s.c[k].link && (reads(s, viewer) || bug('readsTrustLink')) ? s.c[k].link : null }));
    // Planted bug hintHidden: "you have none, but there is 1 you can't see"
    if (bug('hintHidden') && !own.length && SLOTS.some((k) => live(s.c[k]))) out.push({ owner: viewer, hidden: 1 });
    return out;
  }
}

// A check-in went out on this step
const sent = (s, t, k) => !!t.c[k]?.out && (!s.c[k]?.out || t.c[k].checkIns > s.c[k].checkIns);
