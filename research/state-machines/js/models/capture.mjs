// Spec 2: Capture (KB A3, A9.2, C1, C14.5)
// JavaScript port of Capture.tla in ../tla-plus-and-tlc.md, section 6.
import { clone, allFunctions, product } from '../lib.mjs';

const UPD_STATES = ['proposed', 'accepted', 'edited', 'rejected'];
const CONFIDENCE = ['high', 'medium', 'low'];

export default function Capture({ Channels = ['whatsapp', 'app'], Updates = ['u1', 'u2'], Dedup = false, Bug = null } = {}) {
  const reviewing = (s, c) => ['proposed', 'partially_confirmed'].includes(s.cap[c]);
  const move = (s, c, from, to) => {
    if (s.cap[c] !== from) return [];
    const t = clone(s);
    t.cap[c] = to;
    return [t];
  };
  const perChannel = Channels.map((c) => [c]);

  return {
    name: `Capture (Dedup = ${Dedup}${Bug ? `, bug ${Bug}` : ''})`,
    init: () =>
      allFunctions(Updates, CONFIDENCE).map((conf) => ({
        cap: Object.fromEntries(Channels.map((c) => [c, 'waiting'])),
        upd: Object.fromEntries(Channels.map((c) => [c, Object.fromEntries(Updates.map((u) => [u, 'proposed']))])),
        conf,
        touched: Object.fromEntries(Channels.map((c) => [c, []])),
        asked: Object.fromEntries(Channels.map((c) => [c, false])),
        applied: Object.fromEntries(Updates.map((u) => [u, 0])),
      })),
    actions: [
      { name: 'Arrive', params: perChannel, step: (s, c) => move(s, c, 'waiting', 'received') },
      { name: 'Parse', params: perChannel, fair: true, step: (s, c) => move(s, c, 'received', 'parsing') },
      {
        name: 'FieldUnclear',
        params: perChannel,
        step(s, c) {
          if (s.asked[c]) return [];
          return move(s, c, 'parsing', 'needs_clarification').map((t) => ((t.asked[c] = true), t));
        },
      },
      { name: 'Answered', params: perChannel, step: (s, c) => move(s, c, 'needs_clarification', 'parsing') },
      {
        name: 'Propose',
        params: perChannel,
        fair: true,
        step(s, c) {
          return move(s, c, 'parsing', 'proposed').map((t) => {
            // Planted bug autoAcceptMedium: everything is pre-accepted, whatever the confidence
            for (const u of Updates) t.upd[c][u] = s.conf[u] === 'high' || Bug === 'autoAcceptMedium' ? 'accepted' : 'proposed';
            return t;
          });
        },
      },
      {
        name: 'PersonMarks',
        params: product(Channels, Updates, UPD_STATES),
        step(s, c, u, st) {
          if (!reviewing(s, c)) return [];
          if (!['accepted', 'edited', 'rejected'].includes(st) || s.upd[c][u] === st) return [];
          const t = clone(s);
          t.upd[c][u] = st;
          if (!t.touched[c].includes(u)) t.touched[c] = [...t.touched[c], u].sort();
          t.cap[c] = 'partially_confirmed';
          return [t];
        },
      },
      {
        name: 'Save',
        params: perChannel,
        step(s, c) {
          if (!reviewing(s, c)) return [];
          if (Updates.some((u) => s.upd[c][u] === 'proposed')) return [];
          const t = clone(s);
          t.cap[c] = 'applied';
          for (const u of Updates) {
            if (['accepted', 'edited'].includes(s.upd[c][u]) && !(Dedup && s.applied[u] > 0)) t.applied[u] += 1;
          }
          return [t];
        },
      },
      { name: 'RejectAll', params: perChannel, step: (s, c) => move(s, c, 'proposed', 'rejected') },
    ],
    invariants: {
      TypeOK: (s) => Updates.every((u) => s.applied[u] >= 0 && s.applied[u] <= Channels.length),
      NothingAppliedWithoutConfirm: (s) =>
        Updates.every(
          (u) =>
            s.applied[u] === 0 ||
            Channels.some((c) => s.cap[c] === 'applied' && ['accepted', 'edited'].includes(s.upd[c][u])),
        ),
      NoAutoAcceptBelowHigh: (s) =>
        Channels.every((c) =>
          Updates.every(
            (u) =>
              !(['accepted', 'edited'].includes(s.upd[c][u]) && s.conf[u] !== 'high') || s.touched[c].includes(u),
          ),
        ),
      AppliedAtMostOnce: (s) => Updates.every((u) => s.applied[u] <= 1),
    },
    leadsTo: {
      AtlasReachesPerson: Channels.map((c) => ({
        label: c,
        P: (s) => s.cap[c] === 'received',
        Q: (s) => ['needs_clarification', 'proposed'].includes(s.cap[c]),
      })),
    },
  };
}
