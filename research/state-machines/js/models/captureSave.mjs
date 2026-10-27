// Spec 9: CaptureSave (use case 1, machines doc M2 to M4)
// What happens between Atlas proposing updates and Kemar saving them. Each
// update saw a value when Atlas read the record ("a") and wants to write a new
// one ("b"). Meanwhile another writer (GitHub, a lead) may change the record:
// to the same new value ("b", someone got there first) or to something else
// ("c"). Save compares and sets: it writes only over the value the update saw.
// Nobody may ever review, so timers remind and then expire the capture.
//
// The existing Capture model (spec 2) covers confidence, channels and dedup;
// this one covers the save itself.
import { clone, product } from '../lib.mjs';

export default function CaptureSave({
  Updates = { u1: 't1', u2: 't2' }, // update -> the record it changes
  ApplyMode = 'all_or_nothing', // S3; 'what_can' applies the updates that still fit
  Bug = null,
} = {}) {
  const ids = Object.keys(Updates);
  const targets = [...new Set(Object.values(Updates))];
  const SAW = 'a';
  const NEW = 'b';
  const reviewing = (s) => s.cap === 'reviewing';
  const open = (s, u) => ['proposed', 'conflict'].includes(s.upd[u]);

  return {
    name: `CaptureSave (ApplyMode = ${ApplyMode}${Bug ? `, bug ${Bug}` : ''})`,
    init: () => [
      {
        cap: 'reviewing',
        upd: Object.fromEntries(ids.map((u) => [u, 'proposed'])),
        record: Object.fromEntries(targets.map((t) => [t, SAW])),
        externalDone: Object.fromEntries(targets.map((t) => [t, false])),
        writes: Object.fromEntries(ids.map((u) => [u, 0])),
        saw: Object.fromEntries(ids.map((u) => [u, SAW])), // the value Kemar last saw for each update
        reminded: false,
      },
    ],
    actions: [
      {
        name: 'Accept',
        params: ids.map((u) => [u]),
        step(s, u) {
          if (!reviewing(s) || !open(s, u)) return [];
          const t = clone(s);
          // Accepting a conflict means "I have seen the new value and still want mine"
          if (s.upd[u] === 'conflict') t.saw[u] = s.record[Updates[u]];
          t.upd[u] = 'accepted';
          return [t];
        },
      },
      {
        name: 'Reject',
        params: ids.map((u) => [u]),
        step(s, u) {
          if (!reviewing(s) || !['proposed', 'accepted', 'conflict'].includes(s.upd[u])) return [];
          const t = clone(s);
          t.upd[u] = 'rejected';
          return [t];
        },
      },
      {
        // Another writer changes the record while Kemar reviews (E24, E25). Once per record.
        name: 'OtherWriter',
        params: product(targets, [NEW, 'c']),
        step(s, r, v) {
          if (s.externalDone[r] || s.record[r] === v) return [];
          const t = clone(s);
          t.record[r] = v;
          t.externalDone[r] = true;
          return [t];
        },
      },
      {
        name: 'Save',
        params: [[]],
        step(s) {
          // Planted bug applyAfterExpiry: an expired capture can still be saved
          // Planted bug noDedup: a second Save (another tab, a retry) runs again
          const allowed = reviewing(s) || (Bug === 'applyAfterExpiry' && s.cap === 'expired') || (Bug === 'noDedup' && s.cap === 'saved');
          if (!allowed) return [];
          if (ids.some((u) => s.upd[u] === 'proposed' || s.upd[u] === 'conflict')) return [];
          const t = clone(s);
          // Once per update ID: an update that was applied is never applied again.
          // The planted bugs widen this: noDedup re-runs applied updates, applyAfterExpiry revives withdrawn ones.
          const toApply = ids.filter(
            (u) =>
              s.upd[u] === 'accepted' ||
              (Bug === 'noDedup' && s.upd[u] === 'applied') ||
              (Bug === 'applyAfterExpiry' && s.upd[u] === 'withdrawn'),
          );
          // Compare and set: a record that moved to something else is a conflict
          const conflicts = Bug === 'blindWrite' ? [] : toApply.filter((u) => ![s.saw[u], NEW].includes(s.record[Updates[u]]));
          if (conflicts.length && ApplyMode === 'all_or_nothing') {
            for (const u of conflicts) t.upd[u] = 'conflict';
            t.cap = 'reviewing';
            return [t];
          }
          for (const u of toApply) {
            if (conflicts.includes(u)) {
              t.upd[u] = 'conflict';
              continue;
            }
            const r = Updates[u];
            if (Bug !== 'blindWrite' && s.record[r] === NEW) {
              t.upd[u] = s.upd[u] === 'applied' ? 'applied' : 'no_change'; // someone got there first
              continue;
            }
            t.record[r] = NEW;
            t.writes[u] += 1;
            t.upd[u] = 'applied';
          }
          t.cap = conflicts.length ? 'reviewing' : 'saved';
          return [t];
        },
      },
      {
        // S4: a reminder after 4 working hours
        name: 'Remind',
        params: [[]],
        fair: true,
        step(s) {
          if (!reviewing(s) || s.reminded) return [];
          const t = clone(s);
          t.reminded = true;
          return [t];
        },
      },
      {
        // S4: expiry after 7 days; nothing is applied
        name: 'Expire',
        params: [[]],
        fair: true,
        step(s) {
          // Planted bug noExpiry: the expiry timer never fires
          if (Bug === 'noExpiry' || !reviewing(s)) return [];
          // Planted bug expireWithoutReminder: expires without the reminder first
          if (!s.reminded && Bug !== 'expireWithoutReminder') return [];
          const t = clone(s);
          t.cap = 'expired';
          for (const u of ids) if (s.upd[u] !== 'applied') t.upd[u] = 'withdrawn';
          return [t];
        },
      },
    ],
    invariants: {
      TypeOK: (s) => ['reviewing', 'saved', 'expired'].includes(s.cap),
      // A save that cannot apply everything applies nothing: no update is applied while the capture is still in review
      AllOrNothing: (s) => !reviewing(s) || ids.every((u) => s.upd[u] !== 'applied'),
      // Each update writes its record at most once, whatever is pressed twice
      AppliedAtMostOnce: (s) => ids.every((u) => s.writes[u] <= 1),
      // An expired capture changed nothing
      NothingAfterExpiry: (s) => s.cap !== 'expired' || ids.every((u) => s.writes[u] === 0),
      // Kemar is reminded before his review expires
      ReminderBeforeExpiry: (s) => s.cap !== 'expired' || s.reminded,
    },
    actionProperties: {
      // Expiry is final: nothing about an expired capture changes again
      ExpiryIsFinal: (s, t) => s.cap !== 'expired' || (t.cap === 'expired' && ids.every((u) => t.writes[u] === s.writes[u])),
      // Save writes a record only over the value the update saw when Atlas read it
      // (the other writer's own change is the step that sets its externalDone flag)
      NeverOverwriteUnseen: (s, t) =>
        targets.every(
          (r) =>
            t.record[r] === s.record[r] ||
            t.externalDone[r] !== s.externalDone[r] ||
            ids.some((u) => Updates[u] === r && s.saw[u] === s.record[r]),
        ),
    },
    leadsTo: {
      // A review never waits forever: it is saved or it expires
      ReviewEnds: [{ label: 'capture', P: (s) => reviewing(s), Q: (s) => !reviewing(s) }],
    },
  };
}
