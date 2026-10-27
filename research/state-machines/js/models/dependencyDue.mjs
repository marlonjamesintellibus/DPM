// Spec: DependencyDue (use case 1, machines doc section 20, U2; 27 Oct 2026)
// Someone else's promise becomes a dependency with an expected date. While it is on the log
// (open or waiting) and the date has passed, its owner has a "due" inbox item. Only a PM or Lead
// moves the date or ends it (met or late); no timer and no later report does either.
//
// One dependency, one PM whose role can lapse, a member who reports. Days are abstract: day > expected
// means "the working day after the expected date has started".
import { clone } from '../lib.mjs';

const STATES = ['none', 'proposed', 'declined', 'withdrawn', 'open', 'waiting', 'met', 'late'];
const ON_LOG = ['open', 'waiting'];
const DAYS = [0, 1, 2, 3];

export default function DependencyDue({ Bug = null } = {}) {
  const people = ['kemar', 'alicia'];
  const isLead = (s, p) => s.role[p] === 'pm';

  const dueCause = (t) => (Bug === 'dueWhileProposed' ? t.st !== 'none' : ON_LOG.includes(t.st)) && t.expected !== null && t.day > t.expected;

  // C4: inbox items always match their causes
  const sync = (t) => {
    const items = [];
    if (t.st === 'proposed') items.push(people.some((p) => isLead(t, p)) ? 'approve' : 'no_decider');
    if (dueCause(t)) items.push('due');
    t.inbox = items;
    return t;
  };

  const by = (t, who) => {
    t.by = who;
    return t;
  };

  return {
    name: `DependencyDue${Bug ? ` (bug ${Bug})` : ''}`,
    init: () => [{ role: { kemar: 'member', alicia: 'pm' }, st: 'none', expected: null, day: 0, endedBy: null, by: null, inbox: [] }],
    actions: [
      {
        // A saved capture reports it, with the date the promise named or none (DP1). E92: a lead's goes straight on.
        name: 'Report',
        params: people.flatMap((p) => [[p, null], [p, 1]]),
        step(s, p, date) {
          if (s.st !== 'none') return [];
          const t = by(clone(s), p);
          t.expected = date;
          t.st = isLead(s, p) ? 'open' : 'proposed';
          return [sync(t)];
        },
      },
      {
        // DP3: the same promise said again joins as a source. A new date in it never moves the entry's.
        name: 'ReportAgain',
        params: [[2], [3]],
        step(s, date) {
          if (!ON_LOG.includes(s.st) && s.st !== 'proposed') return [];
          const t = by(clone(s), 'kemar');
          if (Bug === 'reportMovesDate') t.expected = date;
          return [sync(t)];
        },
      },
      ...[
        ['Approve', 'proposed', 'open'],
        ['Decline', 'proposed', 'declined'],
        ['Progress', 'open', 'waiting'],
      ].map(([name, from, to]) => ({
        name,
        params: [['alicia']],
        step(s, p) {
          if (s.st !== from || !isLead(s, p)) return [];
          const t = by(clone(s), p);
          t.st = to;
          return [sync(t)];
        },
      })),
      {
        name: 'Withdraw',
        params: [['kemar']],
        step(s, p) {
          if (s.st !== 'proposed') return [];
          const t = by(clone(s), p);
          t.st = 'withdrawn';
          return [sync(t)];
        },
      },
      {
        // New date: a PM or Lead, on the log, never in the past
        name: 'SetExpected',
        params: DAYS.slice(1).map((d) => ['alicia', d]),
        step(s, p, d) {
          if (!ON_LOG.includes(s.st) || !isLead(s, p) || d < s.day || d === s.expected) return [];
          const t = by(clone(s), p);
          t.expected = d;
          // Planted bug keepDue: the due item stays after a new date
          return [Bug === 'keepDue' ? t : sync(t)];
        },
      },
      {
        // Met or late: a PM or Lead decides (D7 stands)
        name: 'Resolve',
        params: [['alicia', 'met'], ['alicia', 'late']],
        step(s, p, outcome) {
          if (!ON_LOG.includes(s.st) || !isLead(s, p)) return [];
          const t = by(clone(s), p);
          t.st = outcome;
          t.endedBy = p;
          return [sync(t)];
        },
      },
      {
        // A day passes. Planted bug autoLate: a passed date marks it late.
        name: 'Tick',
        params: [[]],
        step(s) {
          if (s.day === DAYS.at(-1)) return [];
          const t = by(clone(s), 'timer');
          t.day += 1;
          if (Bug === 'autoLate' && ON_LOG.includes(t.st) && t.expected !== null && t.day > t.expected) {
            t.st = 'late';
            t.endedBy = 'timer';
          }
          return [sync(t)];
        },
      },
      {
        // The PM loses the role, or gets it back (M13)
        name: 'RoleChange',
        params: [['alicia', 'member'], ['alicia', 'pm']],
        step(s, p, r) {
          if (s.role[p] === r) return [];
          const t = by(clone(s), 'system');
          t.role[p] = r;
          return [sync(t)];
        },
      },
    ],
    invariants: {
      TypeOK: (s) => STATES.includes(s.st) && DAYS.includes(s.day) && (s.expected === null || DAYS.includes(s.expected)),
      // The owner is told exactly while the date has passed on a live dependency (C4)
      DueMatchesCause: (s) => s.inbox.includes('due') === (ON_LOG.includes(s.st) && s.expected !== null && s.day > s.expected),
      // DP7, DP8: never for one that is proposed, declined or ended
      DueOnlyOnLog: (s) => !s.inbox.includes('due') || ON_LOG.includes(s.st),
      // A dependency ends only by a person (never the timer)
      NeverEndsByItself: (s) => s.endedBy === null || people.includes(s.endedBy),
    },
    actionProperties: {
      // Met or late only by someone who held the right at that moment
      EndedOnlyByLead: (s, t) => ['met', 'late'].includes(s.st) || !['met', 'late'].includes(t.st) || (people.includes(t.by) && isLead(s, t.by)),
      // After the report, the date moves only by a PM or Lead (DP3)
      DateMovesOnlyByLead: (s, t) => s.st === 'none' || s.expected === t.expected || (people.includes(t.by) && isLead(s, t.by)),
    },
  };
}
