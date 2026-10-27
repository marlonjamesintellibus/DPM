// Spec 1: TrackedStatus (KB A4.1, A4.2, A4.3, C3, P6, P9)
// JavaScript port of TrackedStatus.tla in ../tla-plus-and-tlc.md, section 5.
//
// ReasonStale (use case 1, machines doc M9): when the plan moves while a reason
// stands, the reason is marked stale and the owner is asked "Keep Off track?"
// instead of the old reason silently explaining a different plan.
import { clone, product } from '../lib.mjs';

const STATUSES = ['not_started', 'on_track', 'at_risk', 'off_track', 'done'];
const RANK = { done: 0, not_started: 1, on_track: 2, at_risk: 3, off_track: 4 };
const worst = (list) => list.reduce((w, s) => (RANK[s] > RANK[w] ? s : w));
const pair = (a, b, x, y) => (a === x && b === y) || (a === y && b === x);
const NO_REASON = 'status_set_with_no_reason';
const KEEP = 'keep_set_status';

export default function TrackedStatus({ Items = ['t1', 't2', 't3'], ExpiryPolicy = 'when_agree', ReasonStale = false, Bug = null } = {}) {
  // P6: calculated status is derived, never stored
  const calculated = (s) => worst(Items.map((i) => s.child[i]));
  const hasExplanation = (s) => ['explained', 'reason_stale'].includes(s.override);
  const displayed = (s) => (hasExplanation(s) ? s.setStatus : calculated(s));

  const canMove = (a, b) =>
    (a === 'not_started' && b === 'on_track') ||
    pair(a, b, 'on_track', 'at_risk') ||
    pair(a, b, 'at_risk', 'off_track') ||
    (['on_track', 'at_risk', 'off_track'].includes(a) && b === 'done');

  const clearOverride = (t) => {
    t.setStatus = 'none';
    t.hasReason = false;
    t.override = 'calculated_only';
    t.inbox = [];
    return t;
  };

  // Every policy clears when the plan agrees again (C3); when_done also clears on Done
  const expires = (s, newCalc) =>
    newCalc === s.setStatus ||
    (ExpiryPolicy === 'on_any_change' && newCalc !== calculated(s)) ||
    (ExpiryPolicy === 'when_done' && newCalc === 'done');

  return {
    name: `TrackedStatus (ExpiryPolicy = ${ExpiryPolicy}${ReasonStale ? ', ReasonStale' : ''}${Bug ? `, bug ${Bug}` : ''})`,
    init: () => [
      {
        child: Object.fromEntries(Items.map((i) => [i, 'not_started'])),
        setStatus: 'none',
        hasReason: false,
        override: 'calculated_only',
        inbox: [],
      },
    ],
    actions: [
      {
        name: 'RuleUpdatesChild',
        params: product(Items, STATUSES),
        step(s, i, st) {
          if (!canMove(s.child[i], st)) return [];
          const t = clone(s);
          t.child[i] = st;
          const newCalc = calculated(t);
          if (s.setStatus !== 'none' && expires(s, newCalc)) clearOverride(t);
          else if (ReasonStale && s.override === 'explained' && newCalc !== calculated(s)) {
            t.override = 'reason_stale';
            // Planted bug noStaleItem: the reason goes stale but nobody is asked
            if (Bug !== 'noStaleItem') t.inbox = [...s.inbox, KEEP].sort();
          }
          return [t];
        },
      },
      {
        name: 'OwnerSets',
        params: STATUSES.map((st) => [st]),
        step(s, st) {
          if (calculated(s) === 'done') return [];
          if (!['on_track', 'at_risk', 'off_track'].includes(st)) return [];
          if (st === s.setStatus) return [];
          const t = clone(s);
          if (st === calculated(s)) return [clearOverride(t)];
          t.setStatus = st;
          t.hasReason = false;
          t.override = 'reason_required';
          // Planted bug noReasonItem: the owner is never asked for a reason
          t.inbox = Bug === 'noReasonItem' ? [] : [NO_REASON];
          return [t];
        },
      },
      {
        name: 'OwnerGivesReason',
        params: [[]],
        step(s) {
          if (s.override !== 'reason_required') return [];
          const t = clone(s);
          t.hasReason = true;
          t.override = 'explained';
          t.inbox = s.inbox.filter((x) => x !== NO_REASON);
          return [t];
        },
      },
      {
        // "Keep Off track": the owner confirms the set status still holds for the new plan
        name: 'OwnerKeeps',
        params: [[]],
        step(s) {
          if (s.override !== 'reason_stale') return [];
          const t = clone(s);
          t.override = 'explained';
          t.inbox = s.inbox.filter((x) => x !== KEEP);
          return [t];
        },
      },
      {
        name: 'SetStatusExpires',
        params: [[]],
        step(s) {
          if (ExpiryPolicy !== 'after_days' || s.setStatus === 'none') return [];
          return [clearOverride(clone(s))];
        },
      },
    ],
    // Derived values shown in stories (rules, never stored: P6)
    views: { calculated, displayed },
    invariants: {
      TypeOK: (s) =>
        Items.every((i) => STATUSES.includes(s.child[i])) &&
        [...STATUSES, 'none'].includes(s.setStatus) &&
        typeof s.hasReason === 'boolean' &&
        ['calculated_only', 'reason_required', 'explained', 'reason_stale'].includes(s.override) &&
        s.inbox.every((x) => [NO_REASON, KEEP].includes(x)),
      ReasonRule: (s) =>
        !(s.setStatus !== 'none' && s.setStatus !== calculated(s)) ||
        s.hasReason ||
        s.inbox.includes(NO_REASON),
      OverrideConsistent: (s) =>
        (s.override === 'calculated_only') === (s.setStatus === 'none') &&
        hasExplanation(s) === s.hasReason,
      NoSilentDisagreement: (s) => displayed(s) === calculated(s) || s.hasReason,
      DoneMeansAllDone: (s) => (calculated(s) === 'done') === Items.every((i) => s.child[i] === 'done'),
      DoneWins: (s) => calculated(s) !== 'done' || displayed(s) === 'done',
      // A stale reason is always waiting in the owner's inbox
      StaleReasonAsked: (s) => s.override !== 'reason_stale' || s.inbox.includes(KEEP),
      // Every inbox item still has its cause (C4: it closes when the cause is gone)
      NoOrphanItems: (s) =>
        (!s.inbox.includes(NO_REASON) || s.override === 'reason_required') &&
        (!s.inbox.includes(KEEP) || s.override === 'reason_stale'),
    },
    actionProperties: {
      // A rule may clear a set status only when the plan agrees with it or the work is Done.
      // Owner moves and timers do not change the children, so they are not covered here.
      SetStatusRespected: (s, t) =>
        Items.every((i) => s.child[i] === t.child[i]) ||
        !(s.setStatus !== 'none' && t.setStatus === 'none') ||
        calculated(t) === s.setStatus ||
        calculated(t) === 'done',
      // A reason never silently explains a plan that has since moved
      StaleReasonFlagged: (s, t) =>
        !(s.override === 'explained' && t.setStatus !== 'none' && calculated(t) !== calculated(s)) ||
        t.override === 'reason_stale',
    },
  };
}
