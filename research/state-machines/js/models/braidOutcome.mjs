// Spec: BraidOutcome (use case 1, machines doc section 20, U3; 27 Oct 2026)
// A message can say a risk is gone or happened, an assumption held or broke, a dependency was met
// or is late. D7 stands: only a PM or Lead ends these kinds. A member's words only propose the
// outcome; the PM and Leads are asked while any proposal waits, and decide it, or keep it open.
//
// One risk, two members who may propose, a PM whose role can lapse and come back. Saying it in a
// message and pressing a button are the same event to the entry: a person, checked when it runs.
import { clone } from '../lib.mjs';

const LIVE = ['open', 'mitigating'];
const ENDS = ['closed', 'realised'];

export default function BraidOutcome({ Bug = null } = {}) {
  const people = ['kemar', 'jodian', 'alicia'];
  const isLead = (s, p) => s.role[p] === 'pm';

  // C4: the leads' item matches its cause
  const sync = (t) => {
    t.inbox = LIVE.includes(t.st) && t.proposed.length && Bug !== 'noConfirmItem' ? ['confirm_outcome'] : [];
    return t;
  };

  const end = (t, p, outcome) => {
    t.st = outcome;
    t.by = p;
    t.endedBy = p;
    if (Bug !== 'keepProposals') t.proposed = [];
    return sync(t);
  };

  return {
    name: `BraidOutcome${Bug ? ` (bug ${Bug})` : ''}`,
    init: () => [{ role: { kemar: 'member', jodian: 'member', alicia: 'pm' }, st: 'open', proposed: [], endedBy: null, by: null, told: [], inbox: [] }],
    actions: [
      {
        // A saved capture says it ended. With the right it ends it (OC1); without, it proposes (OC2).
        name: 'Say',
        params: people.flatMap((p) => ENDS.map((o) => [p, o])),
        step(s, p, outcome) {
          if (!LIVE.includes(s.st)) return [];
          const t = clone(s);
          if (isLead(s, p)) return [end(t, p, outcome)];
          // Planted bug proposalEnds: a member's words end the risk
          if (Bug === 'proposalEnds') return [end(t, p, outcome)];
          // OC3: one proposal per person; a later one replaces their earlier one
          t.proposed = [...t.proposed.filter((x) => x.by !== p), { by: p, outcome }].sort((a, b) => a.by.localeCompare(b.by));
          t.by = p;
          return [sync(t)];
        },
      },
      {
        // The PM or a Lead decides from the item: one of the outcomes, or keep it open
        name: 'Decide',
        params: ENDS.map((o) => ['alicia', o]),
        step(s, p, outcome) {
          if (!LIVE.includes(s.st) || !isLead(s, p)) return [];
          return [end(clone(s), p, outcome)];
        },
      },
      {
        name: 'KeepOpen',
        params: [['alicia']],
        step(s, p) {
          if (!LIVE.includes(s.st) || !isLead(s, p) || !s.proposed.length) return [];
          const t = clone(s);
          t.told = [...new Set([...t.told, ...t.proposed.map((x) => x.by)])].sort();
          t.proposed = [];
          t.by = p;
          return [sync(t)];
        },
      },
      {
        name: 'Progress',
        params: [['alicia']],
        step(s, p) {
          if (s.st !== 'open' || !isLead(s, p)) return [];
          const t = clone(s);
          t.st = 'mitigating';
          t.by = p;
          return [sync(t)];
        },
      },
      {
        name: 'RoleChange',
        params: [['alicia', 'member'], ['alicia', 'pm']],
        step(s, p, r) {
          if (s.role[p] === r) return [];
          const t = clone(s);
          t.role[p] = r;
          t.by = 'system';
          return [sync(t)];
        },
      },
    ],
    invariants: {
      TypeOK: (s) => [...LIVE, ...ENDS].includes(s.st) && s.proposed.every((x) => people.includes(x.by) && ENDS.includes(x.outcome)),
      // The leads are asked exactly while a proposal waits on a live entry (C4)
      ConfirmMatchesCause: (s) => s.inbox.includes('confirm_outcome') === (LIVE.includes(s.st) && s.proposed.length > 0),
      // An ended entry carries no proposals that could be acted on later
      NoStaleProposals: (s) => LIVE.includes(s.st) || s.proposed.length === 0,
    },
    actionProperties: {
      // D7: it ends only by someone who held the right at that moment, by message or by button
      OutcomeOnlyByLead: (s, t) => !LIVE.includes(s.st) || LIVE.includes(t.st) || (people.includes(t.endedBy) && isLead(s, t.endedBy)),
      // A proposal never changes the entry's state
      ProposalKeepsState: (s, t) => t.proposed.length <= s.proposed.length || t.st === s.st,
    },
  };
}
