// Spec 4: HelpRequest (KB A7.3, A10.2, C10)
// JavaScript port of HelpRequest.tla in ../tla-plus-and-tlc.md, section 8.
import { clone } from '../lib.mjs';

// level: 0 with the care team, 1 HR, 2 security, 3 executive
export default function HelpRequest({ Requests = ['r1', 'r2'], Fair = true, Bug = null } = {}) {
  const perRequest = Requests.map((r) => [r]);
  const move = (s, r, from, to) => {
    if (!from.includes(s.req[r])) return [];
    const t = clone(s);
    t.req[r] = to;
    return [t];
  };
  const count = (s, st) => Requests.filter((r) => s.req[r] === st).length;
  const leaderView = (s) => ({ escalated: count(s, 'escalated'), waiting: count(s, 'new') });
  const careStatus = (s) => (Requests.some((r) => s.req[r] === 'new' && s.breached[r]) ? 'at_risk' : 'on_track');

  return {
    name: `HelpRequest (${Fair ? 'fair clock' : 'no fairness'}${Bug ? `, bug ${Bug}` : ''})`,
    init: () => [
      {
        req: Object.fromEntries(Requests.map((r) => [r, 'none'])),
        level: Object.fromEntries(Requests.map((r) => [r, 0])),
        breached: Object.fromEntries(Requests.map((r) => [r, false])),
      },
    ],
    actions: [
      { name: 'Open', params: perRequest, step: (s, r) => move(s, r, ['none'], 'new') },
      { name: 'FirstReply', params: perRequest, step: (s, r) => move(s, r, ['new'], 'acknowledged') },
      {
        name: 'SlaTimerFires',
        params: perRequest,
        fair: Fair,
        step(s, r) {
          // Planted bug noTimer: the 60 minute timer never fires
          if (Bug === 'noTimer' || s.req[r] !== 'new' || s.breached[r]) return [];
          const t = clone(s);
          t.breached[r] = true;
          return [t];
        },
      },
      { name: 'Start', params: perRequest, step: (s, r) => move(s, r, ['acknowledged'], 'in_progress') },
      {
        name: 'Escalate',
        params: perRequest,
        step(s, r) {
          if (s.level[r] >= 3) return [];
          return move(s, r, ['in_progress', 'escalated'], 'escalated').map((t) => ((t.level[r] += 1), t));
        },
      },
      { name: 'Resolve', params: perRequest, step: (s, r) => move(s, r, ['in_progress', 'escalated'], 'resolved') },
    ],
    // Derived values shown in stories (rules, never stored: P6)
    views: {
      careArea: careStatus,
      leadersWaiting: (s) => leaderView(s).waiting,
      leadersEscalated: (s) => leaderView(s).escalated,
    },
    invariants: {
      TypeOK: (s) => Requests.every((r) => s.level[r] >= 0 && s.level[r] <= 3),
      LeaderViewIsCountsOnly: (s) => Object.values(leaderView(s)).every((v) => Number.isInteger(v)),
      BreachNeedsARequest: (s) => Requests.every((r) => !s.breached[r] || s.req[r] !== 'none'),
    },
    actionProperties: {
      EscalationOnlyRises: (s, t) => Requests.every((r) => t.level[r] >= s.level[r]),
    },
    leadsTo: {
      NoSilentWait: Requests.map((r) => ({
        label: r,
        P: (s) => s.req[r] === 'new',
        Q: (s) => s.req[r] !== 'new' || s.breached[r],
      })),
    },
  };
}
