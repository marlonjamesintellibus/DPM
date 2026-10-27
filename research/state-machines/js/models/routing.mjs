// Spec 7: Routing (use case 1, machines doc M13, M14; briefing 26 Oct 2026)
// One daily update from Kemar, with a few items. Atlas guesses a project for
// each item; the guess is untrusted. Kemar can move, pick or keep items
// private, and can leave a project or have one disconnected before he saves.
// After saving, readers on each org's dashboard see only what they may see.
//
// Atlas's guess is any project, "ambiguous" or "none": the model checks what
// DPM does with whatever Atlas says, not whether Atlas guessed well.
import { clone, product } from '../lib.mjs';

// Kemar's groups: the use case story, plus one project he is not in and one in another org
const PROJECTS = {
  forager: { org: 'A' },
  insights: { org: 'A' },
  sante: { org: 'A' }, // Kemar is not a member
  study: { org: 'A' }, // personal group, owner has not connected it to DPM
  partner: { org: 'B' }, // Kemar is a member; tagged to another company
};
const NAMES = Object.keys(PROJECTS);

// Readers: a person looking at one org's dashboard, and the projects they are members of
const READERS = [
  { id: 'alicia@A', org: 'A', member: ['forager', 'partner'] },
  { id: 'andre@A', org: 'A', member: ['insights'] },
  { id: 'bob@B', org: 'B', member: ['partner'] },
];

export default function Routing({ Items = ['i1', 'i2'], RecheckAtSave = true, Bug = null } = {}) {
  const candidate = (s, p) => s.member.includes(p) && s.connected.includes(p);
  const isProject = (r) => NAMES.includes(r);

  // What a reader sees of a saved capture: the quotes of items filed into their projects, in their org
  const sees = (s, r, i) => {
    const p = s.filed[i];
    if (!p) return false;
    const orgOk = Bug === 'ignoreOrgTag' || PROJECTS[p].org === r.org;
    // Planted bug leakCapture: a member of any project the capture touched sees the whole capture
    const memberOk =
      Bug === 'leakCapture'
        ? Items.some((j) => s.filed[j] && r.member.includes(s.filed[j]))
        : r.member.includes(p);
    return orgOk && memberOk;
  };
  const visible = (s) => Object.fromEntries(READERS.map((r) => [r.id, Items.filter((i) => sees(s, r, i))]));
  // One view per reader for stories: aliciaSees, andreSees, bobSees
  const perReader = Object.fromEntries(
    READERS.map((r) => [`${r.id.split('@')[0]}Sees`, (s) => Items.filter((i) => sees(s, r, i))]),
  );

  const reviewing = (s) => s.cap === 'reviewing';
  const routeTo = (s, i, r) => {
    const t = clone(s);
    t.route[i] = r;
    return [t];
  };

  return {
    name: `Routing (RecheckAtSave = ${RecheckAtSave}${Bug ? `, bug ${Bug}` : ''})`,
    init: () => [
      {
        member: ['forager', 'insights', 'partner', 'study'],
        connected: ['forager', 'insights', 'partner', 'sante'],
        cap: 'reviewing',
        route: Object.fromEntries(Items.map((i) => [i, 'pending'])),
        filed: Object.fromEntries(Items.map((i) => [i, null])),
      },
    ],
    actions: [
      {
        // Atlas proposes a project for an item; the server checks it (check 9)
        name: 'AtlasRoutes',
        params: product(Items, [...NAMES, 'ambiguous', 'none']),
        step(s, i, guess) {
          if (!reviewing(s) || s.route[i] !== 'pending') return [];
          // Planted bug trustAtlas: whatever project Atlas names is used
          if (Bug === 'trustAtlas' && isProject(guess)) return routeTo(s, i, guess);
          if (isProject(guess) && candidate(s, guess)) return routeTo(s, i, guess);
          return routeTo(s, i, guess === 'ambiguous' ? 'choose' : 'not_filed');
        },
      },
      {
        // Kemar moves a routed item, picks a project for an ambiguous one, or files a private one
        name: 'AuthorRoutes',
        params: product(Items, NAMES),
        step(s, i, p) {
          if (!reviewing(s) || s.route[i] === 'pending' || s.route[i] === p) return [];
          return candidate(s, p) ? routeTo(s, i, p) : [];
        },
      },
      {
        name: 'KeepPrivate',
        params: Items.map((i) => [i]),
        step(s, i) {
          if (!reviewing(s) || ['pending', 'not_filed'].includes(s.route[i])) return [];
          return routeTo(s, i, 'not_filed');
        },
      },
      {
        // M13: Kemar leaves a project before saving
        name: 'Leave',
        params: [['forager'], ['insights']],
        step(s, p) {
          if (!s.member.includes(p)) return [];
          const t = clone(s);
          t.member = s.member.filter((x) => x !== p);
          return [t];
        },
      },
      {
        // The group owner disconnects the group from DPM
        name: 'Disconnect',
        params: [['forager'], ['insights']],
        step(s, p) {
          if (!s.connected.includes(p)) return [];
          const t = clone(s);
          t.connected = s.connected.filter((x) => x !== p);
          return [t];
        },
      },
      {
        name: 'Save',
        params: [[]],
        step(s) {
          if (!reviewing(s) || Items.some((i) => s.route[i] === 'pending')) return [];
          // Planted bug saveWithChoose: Save is allowed while an item still needs a project
          if (Bug !== 'saveWithChoose' && Items.some((i) => s.route[i] === 'choose')) return [];
          const t = clone(s);
          t.cap = 'saved';
          for (const i of Items) {
            const r = s.route[i];
            if (!isProject(r)) continue;
            // Rule 7: membership is checked when Save runs, not when the item was routed
            if (RecheckAtSave && !candidate(s, r)) t.route[i] = 'withdrawn';
            else t.filed[i] = r;
          }
          return [t];
        },
      },
    ],
    views: { visible, ...perReader },
    invariants: {
      TypeOK: (s) =>
        ['reviewing', 'saved'].includes(s.cap) &&
        Items.every((i) => ['pending', 'choose', 'not_filed', 'withdrawn', ...NAMES].includes(s.route[i])),
      // Nothing is saved while an item still needs a project
      NothingFiledWhileChoosing: (s) => s.cap !== 'saved' || Items.every((i) => s.route[i] !== 'choose'),
      // A reader sees an item's quote only if it was filed into a project they are a member of
      NoCrossProjectQuote: (s) => READERS.every((r) => Items.every((i) => !sees(s, r, i) || r.member.includes(s.filed[i]))),
      // An org's dashboard never shows an item filed into another org's project
      NoCrossOrg: (s) => READERS.every((r) => Items.every((i) => !sees(s, r, i) || PROJECTS[s.filed[i]].org === r.org)),
    },
    actionProperties: {
      // Check 9: an item is only ever routed (by Atlas or by Kemar) to a project he can file into right now
      RoutedOnlyToCandidates: (s, t) =>
        Items.every((i) => t.route[i] === s.route[i] || !isProject(t.route[i]) || candidate(s, t.route[i])),
      // At the moment of saving, every filed item goes to a project Kemar is a member of and that is connected to DPM
      OnlyMemberProjects: (s, t) =>
        s.cap === 'saved' || t.cap !== 'saved' || Items.every((i) => t.filed[i] === null || candidate(s, t.filed[i])),
    },
  };
}
