// M8 Leave with the decision of 26 Oct on D6 (use-cases/01-update-to-plan-machines.md, section 11).
// What the author says about leave is matched against every live leave of theirs, requested or
// approved. Covered: no change. Overlapping: a change to that leave; approved dates stay approved
// until the admin approves the change.
// Otherwise a new request. Each new or changed request shows each project lead what the absence
// touches in their project only, and the admin decides. A capture never approves leave.
import { clone } from '../lib.mjs';

// Day ranges, abstracted: A = 11 to 13 Nov, IN = 12 Nov (inside A), PLUS = 11 to 14 Nov, B = 2 Dec
const RANGES = ['A', 'IN', 'PLUS', 'B'];
const COVERS = { A: ['A', 'IN'], IN: ['IN'], PLUS: ['A', 'IN', 'PLUS'], B: ['B'] };
const overlaps = (x, y) => x === y || COVERS[x].includes(y) || COVERS[y].includes(x) || (COVERS[x].some((d) => COVERS[y].includes(d)));
const LIVE = ['requested', 'approved'];
// Kemar is in two projects; each lead sees only their own project's part
const LEADS = { alicia: 'forager', andre: 'insights' };

export default function Leave({ Bug = null, Says = 2 } = {}) {
  const live = (s) => Object.entries(s.leaves).filter(([, l]) => LIVE.includes(l.st) && (Bug !== 'approvedOnly' || l.st === 'approved'));
  const impactsFor = (id) => Object.entries(LEADS).map(([lead, project]) => ({ leave: id, lead, project: Bug === 'leakImpact' ? 'all' : project }));
  const setImpacts = (t, id, open) => {
    t.impacts = t.impacts.filter((i) => i.leave !== id);
    if (open && Bug !== 'noImpact') t.impacts = [...t.impacts, ...impactsFor(id)];
    if (!open && Bug === 'impactsStay') t.impacts = [...t.impacts, ...impactsFor(id)];
    t.impacts.sort((a, b) => (a.leave + a.lead).localeCompare(b.leave + b.lead));
  };
  // Waiting on the admin: a new request, or approved leave with a change asked for
  const waiting = (l) => l.st === 'requested' || (l.st === 'approved' && l.change);
  const decide = (to) => (s, id) => {
    const l = s.leaves[id];
    if (!l || !waiting(l)) return [];
    const t = clone(s);
    const m = t.leaves[id];
    if (m.st === 'approved') {
      // A change to approved leave: approving moves the dates, declining or withdrawing keeps the old ones
      if (to === 'approved') m.range = m.change;
      m.change = null;
    } else m.st = to;
    t.by = to === 'withdrawn' ? 'author' : 'admin';
    setImpacts(t, id, false);
    return [t];
  };
  const ids = ['l1', 'l2', 'l3'];

  return {
    name: `Leave${Bug ? ` (bug ${Bug})` : ''}`,
    init: () =>
      [{}, { l1: { range: 'A', st: 'requested', change: null } }, { l1: { range: 'A', st: 'approved', change: null } }].map((leaves) => {
        const s = { leaves, item: null, says: 0, impacts: [], by: null };
        for (const [id, l] of Object.entries(leaves)) if (l.st === 'requested') setImpacts(s, id, true);
        return s;
      }),
    actions: [
      {
        // Atlas reads "I'm out ..." and the server marks it (check 8)
        name: 'Say',
        params: RANGES.map((r) => [r]),
        step(s, said) {
          if (s.item || s.says >= Says) return [];
          const covering = live(s).find(([, l]) => COVERS[l.range].includes(said));
          const touching = live(s).find(([, l]) => overlaps(l.range, said));
          const item = covering ? { said, mark: 'matches', leave: covering[0] } : touching ? { said, mark: 'change', leave: touching[0] } : { said, mark: 'new', leave: null };
          return [Object.assign(clone(s), { item, says: s.says + 1, by: 'atlas' })];
        },
      },
      {
        name: 'AuthorSaves',
        params: [[]],
        step(s) {
          if (!s.item) return [];
          const t = clone(s);
          t.item = null;
          t.by = 'author';
          const { said, mark, leave } = s.item;
          if (mark === 'change') {
            // The leave changed under the item since Atlas read it: the save conflicts and nothing moves
            const l = t.leaves[leave];
            if (!LIVE.includes(l.st)) return [t];
            if (l.st === 'requested' || Bug === 'captureApproves') l.range = said;
            else l.change = said;
            setImpacts(t, leave, l.st === 'requested' || !!l.change);
          } else if (mark === 'new') {
            const id = ids.find((x) => !t.leaves[x]);
            if (!id) return [];
            t.leaves[id] = { range: said, st: Bug === 'captureApproves' ? 'approved' : 'requested', change: null };
            setImpacts(t, id, t.leaves[id].st === 'requested');
          }
          return [t];
        },
      },
      { name: 'AuthorRejects', params: [[]], step: (s) => (s.item ? [Object.assign(clone(s), { item: null, by: 'author' })] : []) },
      { name: 'AdminApproves', params: ids.map((i) => [i]), step: decide('approved') },
      { name: 'AdminDeclines', params: ids.map((i) => [i]), step: decide('declined') },
      { name: 'AuthorWithdraws', params: ids.map((i) => [i]), step: decide('withdrawn') },
    ],
    invariants: {
      // D6: saying the same leave twice never makes a second request
      NoOverlappingLeave: (s) => {
        const l = Object.values(s.leaves).filter((x) => LIVE.includes(x.st));
        return l.every((a, i) => l.every((b, j) => i >= j || !overlaps(a.range, b.range)));
      },
      // An approved leave keeps its approved dates while a change waits
      ApprovedDatesKept: (s) => Object.values(s.leaves).every((l) => !l.change || l.st === 'approved'),
      LeadsSeeImpact: (s) =>
        Object.entries(s.leaves).every(([id, l]) => !waiting(l) || Object.keys(LEADS).every((lead) => s.impacts.some((i) => i.leave === id && i.lead === lead))),
      ImpactOnlyOwnProject: (s) => s.impacts.every((i) => LEADS[i.lead] === i.project),
      ImpactsCloseWhenDecided: (s) => s.impacts.every((i) => s.leaves[i.leave] && waiting(s.leaves[i.leave])),
    },
    actionProperties: {
      // Only the admin approves leave; a capture creates or changes requests
      NeverApprovedByCapture: (s, t) =>
        Object.entries(t.leaves).every(
          ([id, l]) => l.st !== 'approved' || (s.leaves[id]?.st === 'approved' && s.leaves[id].range === l.range) || t.by === 'admin',
        ),
    },
  };
}
