// Switching a BRAID entry's kind, and members asking for it (use-cases/01-update-to-plan-machines.md,
// section 13: M15 SWITCH_KIND and M17 kind change request). Alicia is the PM; Kemar is a member.
//   A switch closes the old entry (realised for a risk that happened, switched otherwise) and puts a new
//   entry of the new kind on the log; the reports move across, never copy (M16). Switching back to the
//   kind it came from reopens the original. A later report follows switched_to to the live entry.
//   A blocker that stops being a blocker leaves its work Blocked and asks the owner (D32, E93).
//   A member asks; the PM switches or keeps; a request lapses when its entry can no longer be switched.
//   Merging moves reports too, and an unmerge after the target was switched is refused (BK15).
import { clone, product } from '../lib.mjs';

const KINDS = ['risk', 'issue', 'blocker'];
const LANDS = { risk: 'open', issue: 'reported', blocker: 'reported' };
const LIVE = ['open', 'reported'];
const live = (e) => !!e && LIVE.includes(e.st);
const NEW_IDS = ['n1', 'n2'];
const IDS = ['e1', 'd1', ...NEW_IDS];
const endOf = (from, to) => (from === 'risk' && to !== 'risk' ? 'realised' : 'switched');

const entry = (kind, src) => ({ kind, st: LANDS[kind], src, to: null, from: null, before: null, into: null, msrc: [] });

export default function BraidKindSwitch({ Bug = null } = {}) {
  const t0 = (s, by) => Object.assign(clone(s), { by });
  // Where a report about e1's words lands now: along switched_to, then into a merge target
  const current = (s, id) => {
    let k = id;
    for (let i = 0; i < 6 && k; i++) {
      const e = s.e[k];
      if (e.to && Bug !== 'noRedirect') k = e.to;
      else if (e.into) k = e.into;
      else return k;
    }
    return k;
  };

  function switchKind(t, id, to) {
    const x = t.e[id];
    const back = x.from && t.e[x.from].kind === to ? x.from : null;
    let target;
    if (back) {
      // Switching back reopens the original as it was, with every report now on this entry
      const o = t.e[back];
      Object.assign(o, { st: o.before, before: null, src: [...x.src].sort(), to: Bug === 'keepLink' ? id : null });
      Object.assign(x, { before: x.st, st: 'switched', to: back, src: [] });
      target = back;
    } else {
      target = NEW_IDS.find((k) => !t.e[k]);
      if (!target) return false;
      t.e[target] = { ...entry(to, [...x.src]), from: id };
      Object.assign(x, { before: x.st, st: endOf(x.kind, to), to: target, src: Bug === 'copy' ? x.src : [] });
    }
    if (t.work.link === id) {
      if (to === 'blocker') t.work.link = target;
      else if (Bug === 'unblock') Object.assign(t.work, { st: 'moving', link: null });
      else Object.assign(t.work, { link: null, ask: Bug !== 'dropAsk' });
    }
    if (t.req.st === 'asked' && t.req.entry === id && Bug !== 'noLapse') t.req.st = t.req.to === to ? 'switched' : 'lapsed';
    return true;
  }

  return {
    name: `BraidKindSwitch${Bug ? ` (bug ${Bug})` : ''}`,
    init: () =>
      ['risk', 'blocker'].map((kind) => ({
        e: { e1: entry(kind, ['a']), d1: entry(kind, ['b']), n1: null, n2: null },
        issued: ['a', 'b'],
        req: { st: 'none', entry: null, to: null },
        work: kind === 'blocker' ? { st: 'blocked', link: 'e1', ask: false } : { st: 'none', link: null, ask: false },
        by: null,
      })),
    actions: [
      {
        // SWITCH_KIND: a PM or Lead, from a live entry, to another kind
        name: 'Switch',
        params: product(['alicia', 'kemar'], IDS, KINDS),
        step(s, by, id, to) {
          const x = s.e[id];
          if (!live(x) || x.kind === to || x.into) return [];
          if (by !== 'alicia' && Bug !== 'memberSwitches') return [];
          const t = t0(s, by);
          return switchKind(t, id, to) ? [t] : [];
        },
      },
      {
        // A new report of e1's words (one more report, c)
        name: 'Reports',
        params: [['kemar']],
        step(s, by) {
          if (s.issued.includes('c')) return [];
          const k = current(s, 'e1');
          const t = t0(s, by);
          if (!live(s.e[k]) && Bug !== 'noRedirect') return [];
          t.e[k].src = [...t.e[k].src, 'c'].sort();
          t.issued = [...s.issued, 'c'];
          return [t];
        },
      },
      {
        // M17: a member asks for the live entry behind e1 to change kind
        name: 'Asks',
        params: KINDS.map((k) => [k]),
        step(s, to) {
          const k = current(s, 'e1');
          if (s.req.st !== 'none' || !live(s.e[k]) || s.e[k].kind === to || s.e[k].into) return [];
          return [Object.assign(t0(s, 'kemar'), { req: { st: 'asked', entry: k, to } })];
        },
      },
      {
        name: 'PMAnswers',
        params: [['switch'], ['keep']],
        step(s, answer) {
          if (s.req.st !== 'asked' || !live(s.e[s.req.entry])) return [];
          const t = t0(s, 'alicia');
          if (answer === 'keep') {
            t.req.st = 'kept';
            return [t];
          }
          if (!switchKind(t, s.req.entry, s.req.to)) return [];
          t.req.st = 'switched';
          return [t];
        },
      },
      { name: 'Withdraws', params: [[]], step: (s) => (s.req.st === 'asked' ? [Object.assign(t0(s, 'kemar'), { req: { ...s.req, st: 'withdrawn' } })] : []) },
      {
        name: 'Resolves',
        params: IDS.map((id) => [id]),
        step(s, id) {
          const x = s.e[id];
          if (!live(x) || x.into) return [];
          const t = t0(s, 'alicia');
          t.e[id].st = x.kind === 'risk' ? 'closed' : 'resolved';
          if (t.work.link === id) t.work.ask = true; // the owner confirms, as E93
          if (t.req.st === 'asked' && t.req.entry === id && Bug !== 'noLapse') t.req.st = 'lapsed';
          return [t];
        },
      },
      {
        // M16: the PM merges the duplicate d1 into the live entry of the same kind behind e1
        name: 'Merges',
        params: [[]],
        step(s) {
          const k = current(s, 'e1');
          const d = s.e.d1;
          if (k === 'd1' || !live(d) || !live(s.e[k]) || s.e[k].kind !== d.kind) return [];
          const t = t0(s, 'alicia');
          t.e[k].src = [...t.e[k].src, ...d.src].sort();
          Object.assign(t.e.d1, { st: 'merged', into: k, msrc: d.src, src: [] });
          if (t.req.st === 'asked' && t.req.entry === 'd1') t.req.st = 'lapsed';
          return [t];
        },
      },
      {
        name: 'Unmerges',
        params: [[]],
        step(s) {
          const d = s.e.d1;
          if (d.st !== 'merged') return [];
          if (s.e[d.into].to && Bug !== 'unmergeAfterSwitch') return []; // BK15: refused once the target was switched
          const t = t0(s, 'alicia');
          t.e[d.into].src = t.e[d.into].src.filter((r) => !d.msrc.includes(r));
          Object.assign(t.e.d1, { st: LANDS[d.kind], into: null, src: d.msrc, msrc: [] });
          return [t];
        },
      },
    ],
    invariants: {
      // M16: every report sits on exactly one entry, through switches, merges and unmerges
      EveryReportOnce: (s) => s.issued.every((r) => IDS.filter((k) => s.e[k]?.src.includes(r)).length === 1),
      // A switched entry keeps no reports; they are on the entry it became
      SwitchedHoldsNoReports: (s) => IDS.every((k) => !s.e[k]?.to || s.e[k].src.length === 0),
      // One row on the log per thing: a chain of switches has at most one live entry
      OneLivePerChain: (s) => {
        const root = (k) => {
          for (let i = 0; i < 6 && s.e[k].from; i++) k = s.e[k].from;
          return k;
        };
        const live_ = IDS.filter((k) => live(s.e[k]) && !s.e[k].into).map(root);
        return new Set(live_).size === live_.length;
      },
      // Following switched_to always ends
      RedirectEnds: (s) =>
        IDS.every((k) => {
          let x = k;
          for (let i = 0; i < 5; i++) {
            if (!s.e[x]?.to) return true;
            x = s.e[x].to;
          }
          return false;
        }),
      // M17: a request waits only on an entry that can still be switched
      RequestOnlyOnSwitchable: (s) => s.req.st !== 'asked' || (live(s.e[s.req.entry]) && !s.e[s.req.entry].into),
      // D32: Blocked work always has a live blocker behind it, or its owner is asked
      BlockedWorkCovered: (s) => s.work.st !== 'blocked' || s.work.ask || (s.work.link && s.e[s.work.link].kind === 'blocker' && live(s.e[s.work.link])),
    },
    actionProperties: {
      // Rule 7: only the PM switches, directly or by answering a request
      OnlyLeadsSwitch: (s, t) => IDS.every((k) => !s.e[k] || !live(s.e[k]) || !t.e[k].to || t.by === 'alicia'),
      // E93, D32: no rule and no switch moves someone's work out of Blocked
      WorkStaysBlocked: (s, t) => s.work.st !== 'blocked' || t.work.st === 'blocked',
    },
  };
}
