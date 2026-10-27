// Spec 10: InboxItem (use case 1, machines doc M10; KB A8.2, C4)
// One cause, for example "Forager 2.0 is set with no reason". A rule notices the
// cause appear and disappear; evaluate() keeps the owner's inbox in step with it.
// The owner can act (which removes the cause), snooze, or wait. When the cause
// comes back after an item closed, that is a new episode with a new item.
//
// Episodes are bounded (MaxEpisodes) so the model stays finite.
import { clone } from '../lib.mjs';

const LIVE = ['open', 'snoozed'];

export default function InboxItem({ MaxEpisodes = 3, Bug = null } = {}) {
  const live = (s) => s.items.filter((i) => LIVE.includes(i.st));

  // evaluate(): one live item while the cause holds, none once it is gone
  const evaluate = (t) => {
    if (t.cause) {
      if (Bug === 'duplicateItems' || !live(t).length) {
        const lastClosed = [...t.items].reverse().find((i) => !LIVE.includes(i.st));
        // Planted bug reopenClosed: the old item is reopened instead of a new episode starting
        if (Bug === 'reopenClosed' && lastClosed) lastClosed.st = 'open';
        else if (t.items.length < MaxEpisodes) t.items.push({ ep: t.items.length + 1, st: 'open' });
      }
    } else if (Bug !== 'noAutoClose') {
      for (const i of t.items) if (LIVE.includes(i.st)) i.st = 'auto_closed';
    }
    t.dirty = false;
    return t;
  };

  return {
    name: `InboxItem (MaxEpisodes = ${MaxEpisodes}${Bug ? `, bug ${Bug}` : ''})`,
    init: () => [{ cause: false, dirty: false, items: [] }],
    actions: [
      {
        // The world changes: a status is set with no reason, a blocker is reported...
        name: 'CauseAppears',
        params: [[]],
        step(s) {
          if (s.cause || s.items.length >= MaxEpisodes) return [];
          const t = clone(s);
          t.cause = true;
          t.dirty = true;
          return [t];
        },
      },
      {
        // ...or the cause goes away on its own (the plan agrees again)
        name: 'CauseClears',
        params: [[]],
        step(s) {
          if (!s.cause) return [];
          const t = clone(s);
          t.cause = false;
          t.dirty = true;
          return [t];
        },
      },
      {
        // The rule runs after every change (and on a timer)
        name: 'Evaluate',
        params: [[]],
        fair: true,
        step(s) {
          // Planted bug ruleNeverRuns: nothing re-evaluates after a change
          if (!s.dirty || Bug === 'ruleNeverRuns') return [];
          return [evaluate(clone(s))];
        },
      },
      {
        // The owner does the primary action ("Save reason"). It removes the cause;
        // the item closes as acted only because the cause is gone.
        name: 'OwnerActs',
        params: [[]],
        step(s) {
          const item = s.items.find((i) => i.st === 'open');
          if (!item || !s.cause) return [];
          const t = clone(s);
          t.cause = false;
          t.items.find((i) => i.ep === item.ep).st = 'acted';
          return [evaluate(t)];
        },
      },
      {
        name: 'Snooze',
        params: [[]],
        step(s) {
          const item = s.items.find((i) => i.st === 'open');
          if (!item) return [];
          const t = clone(s);
          t.items.find((i) => i.ep === item.ep).st = 'snoozed';
          return [t];
        },
      },
      {
        // The snooze time passes
        name: 'Wake',
        params: [[]],
        step(s) {
          const item = s.items.find((i) => i.st === 'snoozed');
          if (!item) return [];
          const t = clone(s);
          t.items.find((i) => i.ep === item.ep).st = 'open';
          return [t];
        },
      },
    ],
    invariants: {
      TypeOK: (s) => s.items.every((i, k) => i.ep === k + 1 && ['open', 'snoozed', 'acted', 'auto_closed'].includes(i.st)),
      // At most one open or snoozed item per cause
      OneLiveItemPerCause: (s) => live(s).length <= 1,
      // Once the rule has run, there is a live item exactly when the cause holds
      // (a snoozed item whose cause is gone closes; it never wakes up)
      InboxMatchesCause: (s) => s.dirty || live(s).length === (s.cause ? 1 : 0),
    },
    actionProperties: {
      // Closed means closed: an acted or auto closed item never changes again
      ClosedNeverReopens: (s, t) =>
        s.items.every((i) => LIVE.includes(i.st) || t.items.find((j) => j.ep === i.ep)?.st === i.st),
    },
    leadsTo: {
      // Every change is evaluated: the inbox catches up
      InboxCatchesUp: [{ label: 'rule', P: (s) => s.dirty, Q: (s) => !s.dirty }],
    },
  };
}
