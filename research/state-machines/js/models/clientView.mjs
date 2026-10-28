// A contact's client view (Switch), decision CD49 (W3-D11; use-cases/atlas-conversational-plan.md,
// section 24; app/src/domain/machines/client-view.ts and app/src/commands/client-view.ts).
// Whether an outside contact tied to a project reads its client view (KB A7.3; phase Q, EX4). One switch
// per contact per project, stored on the tie (project_contacts.client_view):
//   off --TURN_ON [the actor is the project's PM now; the contact has no org role]--> on
//   on --TURN_OFF [the actor is the project's PM now]--> off
// A tie is added or taken off by a vocabulary change (M31); a tie added starts off, also one added back.
//
// The world is the seed (app/src/db/seed/snapshot.ts): Alicia is PM of Forager and GQ and can leave
// Forager; Andre is PM of Store Insights; Kemar is a member of all three and PM of none. Kyle (Sprouts IT,
// no org role) is Forager's contact with the client view on; Store Insights can tie him too. Jodian is in
// the org and is tied to GQ as a contact. Each tab is a session: Alicia may have two (Tabs = 2).
//
// The command runs in two steps, as one transaction does under read committed: Request reads the right
// and the flag and decides the move (or refuses it, changing nothing); Write writes it over the flag as
// read, or finds it stale. Another tab, or a tie taken off, can come between them. Anyone may send any
// request (a server action is an endpoint), so the button on a screen is never the right (rule 7).
import { clone, product } from '../lib.mjs';

const PM = { forager: 'alicia', gq: 'alicia', insights: 'andre' };
const MEMBERS = { forager: ['alicia', 'kemar'], gq: ['alicia', 'kemar'], insights: ['andre', 'kemar'] };
// Each contact on a project, as `${project}@${person}`, the switch's subject on the trail
const CONTACTS = {
  'forager@kyle': { project: 'forager', outside: true, init: true },
  'insights@kyle': { project: 'insights', outside: true, init: null }, // no tie yet
  'gq@jodian': { project: 'gq', outside: false, init: false },
};
const KEYS = Object.keys(CONTACTS);

// The drawn arrows: [from, event, to]
const ARROWS = [
  ['off', 'TURN_ON', 'on'],
  ['on', 'TURN_OFF', 'off'],
];

export default function ClientView({ Tabs = 1, Bug = null } = {}) {
  const SESSIONS = { a1: 'alicia', ...(Tabs > 1 ? { a2: 'alicia' } : {}), kemar: 'kemar', andre: 'andre' };
  const IDS = Object.keys(SESSIONS);

  const member = (s, p, project) => MEMBERS[project].includes(p) && !(p === 'alicia' && project === 'forager' && s.aliciaLeft);
  const isPm = (s, p, project) => PM[project] === p && member(s, p, project);
  const state = (on) => (on ? 'on' : 'off');
  const t0 = (s, ev) => Object.assign(clone(s), { ev, audit: null });

  return {
    name: `ClientView (${Tabs} tab${Tabs > 1 ? 's' : ''} for Alicia${Bug ? `, bug ${Bug}` : ''})`,
    init: () => [
      {
        c: Object.fromEntries(KEYS.map((k) => [k, CONTACTS[k].init === null ? null : { on: CONTACTS[k].init }])),
        // Planted bug restoreKeepsOn: what a tie's flag was when it was taken off
        kept: Object.fromEntries(KEYS.map((k) => [k, false])),
        aliciaLeft: false,
        // Whether each of Alicia's tabs shows Forager's switch (it did when she opened it as its PM)
        shown: Object.fromEntries(IDS.filter((id) => SESSIONS[id] === 'alicia').map((id) => [id, false])),
        pending: Object.fromEntries(IDS.map((id) => [id, null])),
        ev: null,
        audit: null,
      },
    ],
    actions: [
      {
        // Alicia opens Forager in a tab: the contacts card shows the switch to its PM
        name: 'Opens',
        params: IDS.filter((id) => SESSIONS[id] === 'alicia').map((id) => [id]),
        step(s, id) {
          const shows = isPm(s, 'alicia', 'forager');
          if (s.shown[id] === shows) return [];
          const t = t0(s, 'OPEN');
          t.shown[id] = shows;
          return [t];
        },
      },
      {
        // The command's read: the right and the flag now, then the move or a refusal that changes nothing
        name: 'Request',
        params: product(IDS, KEYS, [true, false]),
        step(s, id, key, to) {
          const p = SESSIONS[id];
          const { project, outside } = CONTACTS[key];
          const x = s.c[key];
          if (s.pending[id]) return [];
          // Planted bug checkWhenShown: the switch on her screen is taken as the right
          const right =
            Bug === 'checkWhenShown' && project === 'forager' && p === 'alicia'
              ? s.shown[id]
              : Bug === 'memberMayTurn'
                ? member(s, p, project)
                : isPm(s, p, project);
          // P10: no project they cannot open, no tie, no right: refused, nothing changes
          if (!right || !x) return [];
          // Rule 6: a repeat changes nothing (planted bug repeatAudited writes it anyway)
          if (x.on === to && Bug !== 'repeatAudited') return [];
          // On only for a contact with no org role (planted bug noOutsideGuard skips it)
          if (to && !x.on && !outside && Bug !== 'noOutsideGuard') return [];
          const t = t0(s, 'REQUEST');
          t.pending[id] = { key, read: x.on, to, by: p };
          return [t];
        },
      },
      {
        // The command's write, over the flag as read; stale when it moved since, and nothing is written
        name: 'Write',
        params: IDS.map((id) => [id]),
        fair: true,
        step(s, id) {
          const r = s.pending[id];
          if (!r) return [];
          const t = t0(s, 'WRITE');
          t.pending[id] = null;
          const x = s.c[r.key];
          // A tie taken off since: no row to write (expectOne)
          if (!x) return [t];
          // Planted bug noCas: the write is not over the flag as read
          if (x.on !== r.read && Bug !== 'noCas') return [t];
          t.c[r.key] = { on: r.to };
          // Planted bug noAudit: the move is written with no audit entry
          if (Bug !== 'noAudit') t.audit = { key: r.key, from: state(r.read), to: state(r.to), by: r.by };
          return [t];
        },
      },
      {
        // A vocabulary change (M31) takes the tie off or adds it; one added starts off
        name: 'Tie',
        params: product(KEYS, [true, false]),
        step(s, key, add) {
          if (!!s.c[key] === add) return [];
          const t = t0(s, add ? 'TIE_ADDED' : 'TIE_REMOVED');
          if (add) t.c[key] = { on: Bug === 'restoreKeepsOn' ? s.kept[key] : false };
          else {
            if (Bug === 'restoreKeepsOn') t.kept[key] = s.c[key].on;
            t.c[key] = null;
          }
          return [t];
        },
      },
      {
        name: 'AliciaLeavesForager',
        params: [[]],
        step(s) {
          if (s.aliciaLeft) return [];
          return [Object.assign(t0(s, 'LEFT'), { aliciaLeft: true })];
        },
      },
    ],
    views: {
      // What Kyle reads as a client: the projects whose client view is on for him (queries/client-view.ts)
      kyleReads: (s) => KEYS.filter((k) => k.endsWith('@kyle') && s.c[k]?.on).map((k) => CONTACTS[k].project),
    },
    invariants: {
      // A7.3, CD49: only a contact with no org role has a client view; someone in the org reads as a member
      OnOnlyForOutsideContacts: (s) => KEYS.every((k) => !s.c[k]?.on || CONTACTS[k].outside),
    },
    actionProperties: {
      // Rule 2 of the machines doc: the switch moves only along a drawn arrow, and only by its own command
      OnlyDrawnArrows: (s, t) =>
        KEYS.every((k) => {
          if (!s.c[k] || !t.c[k] || s.c[k].on === t.c[k].on) return true;
          return t.ev === 'WRITE' && ARROWS.some(([f, e, x]) => f === state(s.c[k].on) && x === state(t.c[k].on) && e === (t.c[k].on ? 'TURN_ON' : 'TURN_OFF'));
        }),
      // Rules 4 and 7: a move is decided only for the project's PM as she is when the command reads it
      OnlyThePmNow: (s, t) => IDS.every((id) => s.pending[id] || !t.pending[id] || isPm(s, SESSIONS[id], CONTACTS[t.pending[id].key].project)),
      // A11: every move of the flag is on the trail, with who made it
      EveryMoveAudited: (s, t) => KEYS.every((k) => !s.c[k] || !t.c[k] || s.c[k].on === t.c[k].on || (t.audit?.key === k && PM[CONTACTS[k].project] === t.audit.by)),
      // Rule 5: the trail says what the flag was, so a move over one that changed since is stale, never written
      TrailTellsTheTruth: (s, t) => !t.audit || (state(s.c[t.audit.key]?.on) === t.audit.from && state(t.c[t.audit.key]?.on) === t.audit.to),
      // Rule 6: a repeat changes nothing, the trail included
      EveryAuditIsAMove: (s, t) => !t.audit || t.audit.from !== t.audit.to,
      // CD49: a tie added, also one added back, starts off; the PM turns it on again if she wants
      NewTieStartsOff: (s, t) => KEYS.every((k) => s.c[k] || !t.c[k] || !t.c[k].on),
    },
    leadsTo: {
      // A command that read the flag writes it or finds it stale; it never hangs
      CommandsFinish: IDS.map((id) => ({ label: id, P: (s) => !!s.pending[id], Q: (s) => !s.pending[id] })),
    },
  };
}
