// BRAID follow ups, with the decisions of 26 Oct on D7, D8, D9 and D11 (use-cases/01-update-to-plan-
// machines.md, section 11). Kemar owns #151, the work the blocker blocks; Alicia is the PM; Jodian
// is a member. S13: the blocked work's owner or a PM or Lead resolves a blocker.
//   D7   "Kyle sent the feed" in a message resolves the blocker when the speaker holds the right
//        and confirms it in review; from anyone else it is a proposal to those who do. When #151
//        stops being blocked, a rule asks the owner to confirm; it never resolves it (E93)
//   D8   a report on a closed risk proposes a new risk linked to it; on a realised risk it goes to
//        the issue the risk became. Finished entries never reopen from a message (S14 aside)
//   D9   merging an open duplicate into a resolved entry needs the PM to choose: reopen it, or keep
//        it resolved with the duplicate's reports kept on it
//   D11  a reporter withdraws their own report; the entry is withdrawn only when no one else reported it
import { clone, product } from '../lib.mjs';

const PEOPLE = ['kemar', 'jodian', 'alicia'];
const RESOLVERS = ['kemar', 'alicia'];
const add = (list, p) => (list.includes(p) ? list : [...list, p].sort());

export default function BraidFollowUps({ Bug = null } = {}) {
  const t0 = (s, by) => Object.assign(clone(s), { by });
  return {
    name: `BraidFollowUps${Bug ? ` (bug ${Bug})` : ''}`,
    init: () =>
      product([['kemar'], ['jodian'], ['jodian', 'kemar']], ['closed', 'realised']).map(([src, risk]) => ({
        b: { st: 'reported', src, ask: false },
        work: 'blocked',
        r: { st: risk, src: ['alicia'] },
        issue: { src: risk === 'realised' ? ['alicia'] : [] },
        r2: 'none',
        d: { st: 'reported', src: ['jodian'] },
        keptOnMerge: false,
        by: null,
      })),
    actions: [
      {
        // D7: someone says the blocker is cleared, and confirms that item in their review
        name: 'SaysCleared',
        params: PEOPLE.map((p) => [p]),
        step(s, p) {
          if (s.b.st !== 'reported') return [];
          const t = t0(s, p);
          if (RESOLVERS.includes(p) || Bug === 'messageResolves') Object.assign(t.b, { st: 'resolved', ask: false });
          else t.b.ask = true; // the "it's cleared" proposal to the owner and the PM
          return [t];
        },
      },
      {
        name: 'ResolverAnswers',
        params: product(RESOLVERS, ['confirm', 'keep_open']),
        step(s, p, answer) {
          if (s.b.st !== 'reported' || !s.b.ask) return [];
          const t = t0(s, p);
          t.b.ask = false;
          if (answer === 'confirm') t.b.st = 'resolved';
          return [t];
        },
      },
      {
        // #151 moves out of Blocked: the rule asks; it never resolves the blocker itself
        name: 'WorkUnblocks',
        params: [[]],
        step(s) {
          if (s.work !== 'blocked') return [];
          const t = t0(s, 'rule');
          t.work = 'moving';
          if (s.b.st === 'reported') {
            if (Bug === 'autoResolve') t.b.st = 'resolved';
            else t.b.ask = true;
          }
          return [t];
        },
      },
      {
        // S14: the same blocker reported again reopens it
        name: 'ReportsBlocker',
        params: PEOPLE.map((p) => [p]),
        step(s, p) {
          if (!['reported', 'resolved'].includes(s.b.st)) return [];
          const t = t0(s, p);
          t.b.src = add(s.b.src, p);
          if (s.b.st === 'resolved') Object.assign(t.b, { st: 'reported', ask: false });
          return [t];
        },
      },
      {
        // D8: the risk is reported again after it finished
        name: 'ReportsRisk',
        params: PEOPLE.map((p) => [p]),
        step(s, p) {
          const t = t0(s, p);
          if (s.r.st === 'closed') {
            if (Bug === 'reopenClosedRisk') t.r.st = 'open';
            else if (s.r2 === 'none') t.r2 = 'proposed';
            else return [];
          } else if (s.r.st === 'realised') {
            if (Bug === 'sourceOnRealised') t.r.src = add(s.r.src, p);
            else t.issue.src = add(s.issue.src, p);
          }
          return [t];
        },
      },
      { name: 'PMDecidesNewRisk', params: [['open'], ['declined']], step: (s, to) => (s.r2 === 'proposed' ? [Object.assign(t0(s, 'alicia'), { r2: to })] : []) },
      {
        // D9: the PM merges Jodian's open duplicate into the blocker
        name: 'PMMerges',
        params: [['reopen'], ['keep']],
        step(s, choice) {
          if (s.d.st !== 'reported' || !['reported', 'resolved'].includes(s.b.st)) return [];
          const t = t0(s, 'alicia');
          t.d.st = 'merged';
          t.b.src = s.d.src.reduce(add, s.b.src);
          if (s.b.st === 'resolved') {
            if (Bug === 'mergeSilently') return choice === 'keep' ? [t] : [];
            if (choice === 'reopen') Object.assign(t.b, { st: 'reported', ask: false });
            else t.keptOnMerge = true;
          } else if (choice === 'keep') return []; // nothing to choose when the target is open
          return [t];
        },
      },
      {
        // D11: a reporter takes back their own report
        name: 'Withdraws',
        params: PEOPLE.map((p) => [p]),
        step(s, p) {
          if (s.b.st !== 'reported' || !s.b.src.includes(p)) return [];
          const t = t0(s, p);
          const others = s.b.src.filter((x) => x !== p);
          if (others.length && Bug !== 'withdrawAll') t.b.src = others;
          else if (s.b.ask) return []; // someone said it is cleared: the resolver answers first
          else Object.assign(t.b, { st: 'withdrawn', src: others });
          return [t];
        },
      },
    ],
    actionProperties: {
      // S13 and D7: only the blocked work's owner or the PM resolves; never a rule, never another member's message
      BlockerResolvedByOwnerOrLead: (s, t) => !(s.b.st === 'reported' && t.b.st === 'resolved') || RESOLVERS.includes(t.by),
      // D11: withdrawing never removes someone else's report
      WithdrawKeepsOthers: (s, t) => !(s.b.st !== 'withdrawn' && t.b.st === 'withdrawn') || s.b.src.every((p) => p === t.by),
      // D8: a closed risk stays closed; the new report is a new proposal
      ClosedRiskStaysClosed: (s, t) => s.r.st !== 'closed' || t.r.st === 'closed',
      // D8: reports on a realised risk go to its issue
      ReportsGoToLiveEntry: (s, t) => s.r.st !== 'realised' || t.r.src.length === s.r.src.length,
      // D9: merging into a resolved blocker either reopens it or records that it stays resolved
      MergeChoiceRecorded: (s, t) => !(s.d.st === 'reported' && t.d.st === 'merged' && s.b.st === 'resolved') || t.b.st === 'reported' || t.keptOnMerge,
    },
  };
}
