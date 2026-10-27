// Spec 8: Match (use case 1, machines doc M16 and S13; briefing 26 Oct 2026)
// Duplicate matching on one project's BRAID log. Reports arrive from different
// captures; Atlas suggests which existing entry each one is "the same as", and
// the suggestion is untrusted. The speaker confirms the match, picks another
// entry, or says "this is different". Between review and save someone else may
// resolve or merge the matched entry. After save a PM can merge and unmerge.
// Blockers are resolved only by the owner of the blocked work or a PM or Lead;
// anyone else's "it's cleared" is a proposal to them (S13).
//
// Not modelled: how good Atlas is at spotting duplicates. The model checks what
// DPM does with whatever Atlas suggests.
import { clone, product } from '../lib.mjs';

export default function Match({
  // Existing entries: kind, state, sources, owner of the blocked work
  Existing = {
    b1: { kind: 'blocker', st: 'open', src: ['a1'], owner: 'kemar' }, // Store sales feed access (Alicia, 6 days ago)
    b2: { kind: 'blocker', st: 'resolved', src: ['a2'], owner: 'kemar' }, // Store API outage, resolved last week
    r1: { kind: 'risk', st: 'open', src: ['a3'], owner: 'alicia' }, // Only Kemar can run the pipeline
  },
  // Reports in this run; a report saved as "new" creates the entry named here
  Reports = { rep1: { by: 'kemar', creates: 'n1' }, rep2: { by: 'jodian', creates: 'n2' } },
  Roles = { alicia: 'pm', kemar: 'member', jodian: 'member' },
  Bug = null,
} = {}) {
  const reps = Object.keys(Reports);
  const slots = reps.map((r) => Reports[r].creates);
  const entries = [...Object.keys(Existing), ...slots];
  const kind = Object.fromEntries([
    ...Object.entries(Existing).map(([e, x]) => [e, x.kind]),
    ...slots.map((n) => [n, 'blocker']), // reports in this run are all blockers
  ]);
  const owner = Object.fromEntries([
    ...Object.entries(Existing).map(([e, x]) => [e, x.owner]),
    ...reps.map((r) => [Reports[r].creates, Reports[r].by]),
  ]);
  const srcKind = Object.fromEntries([
    ...Object.entries(Existing).flatMap(([, x]) => x.src.map((id) => [id, x.kind])),
    ...reps.map((r) => [r, 'blocker']),
  ]);
  const allSources = Object.keys(srcKind);
  const people = Object.keys(Roles);
  const isLead = (p) => ['pm', 'lead'].includes(Roles[p]);

  // An entry a report may be matched to: exists, not merged away, same kind (blocker)
  const matchable = (s, e) => s.exists[e] && s.mergedInto[e] === null && kind[e] === 'blocker';
  // What the speaker sees of an entry; a change of this since review is a conflict
  const look = (s, e) => (s.mergedInto[e] !== null ? 'merged' : s.st[e]);
  const reviewing = (s, r) => ['reviewing', 'conflict'].includes(s.rep[r]);
  const add = (list, x) => [...list, x].sort();
  const syncItems = (t) => {
    t.inbox = t.inbox.filter((x) => {
      const [k, e] = x.split(':');
      if (k === 'new_blocker') return t.st[e] === 'open' && t.mergedInto[e] === null;
      return t.clearProposed[e];
    });
    for (const e of entries) if (t.clearProposed[e] && !t.inbox.includes(`clear:${e}`)) t.inbox.push(`clear:${e}`);
    t.inbox.sort();
    return t;
  };
  const alert = (t, e) => {
    t.alerted[e] += 1;
    if (!t.inbox.includes(`new_blocker:${e}`)) t.inbox = add(t.inbox, `new_blocker:${e}`);
  };

  return {
    name: `Match${Bug ? ` (bug ${Bug})` : ''}`,
    init: () => [
      {
        exists: Object.fromEntries(entries.map((e) => [e, e in Existing])),
        st: Object.fromEntries(entries.map((e) => [e, Existing[e]?.st ?? 'none'])),
        src: Object.fromEntries(entries.map((e) => [e, Existing[e]?.src ?? []])),
        mergedInto: Object.fromEntries(entries.map((e) => [e, null])),
        mergedSrc: Object.fromEntries(entries.map((e) => [e, []])),
        resolvedBy: Object.fromEntries(entries.map((e) => [e, null])),
        clearProposed: Object.fromEntries(entries.map((e) => [e, false])),
        alerted: Object.fromEntries(entries.map((e) => [e, 0])),
        rep: Object.fromEntries(reps.map((r) => [r, 'pending'])),
        match: Object.fromEntries(reps.map((r) => [r, null])),
        confirmed: Object.fromEntries(reps.map((r) => [r, false])),
        seen: Object.fromEntries(reps.map((r) => [r, null])),
        inbox: [],
      },
    ],
    actions: [
      {
        // Atlas suggests a match: any entry, or "new". The server keeps only matchable ones.
        name: 'AtlasSuggests',
        params: product(reps, [...entries, 'new']),
        step(s, r, guess) {
          if (s.rep[r] !== 'pending') return [];
          const t = clone(s);
          t.rep[r] = 'reviewing';
          // Planted bug trustKind: a suggestion of another kind (the risk) is kept
          const ok = guess !== 'new' && (matchable(s, guess) || (Bug === 'trustKind' && s.exists[guess] && s.mergedInto[guess] === null));
          t.match[r] = ok ? guess : 'new';
          return [t];
        },
      },
      {
        // The speaker confirms what is shown: "yes, same as this one" (or "yes, new")
        name: 'Confirm',
        params: reps.map((r) => [r]),
        step(s, r) {
          if (!reviewing(s, r) || s.confirmed[r]) return [];
          const m = s.match[r];
          if (m !== 'new' && !matchable(s, m) && Bug !== 'trustKind') return [];
          const t = clone(s);
          t.rep[r] = 'reviewing';
          t.confirmed[r] = true;
          t.seen[r] = m === 'new' ? null : look(s, m);
          return [t];
        },
      },
      {
        // The speaker picks another entry ("no, it's this one")
        name: 'Pick',
        params: product(reps, entries),
        step(s, r, e) {
          if (!reviewing(s, r) || !matchable(s, e) || (s.match[r] === e && s.confirmed[r])) return [];
          const t = clone(s);
          t.rep[r] = 'reviewing';
          t.match[r] = e;
          t.confirmed[r] = true;
          t.seen[r] = look(s, e);
          return [t];
        },
      },
      {
        // "This is different": a new entry
        name: 'Different',
        params: reps.map((r) => [r]),
        step(s, r) {
          if (!reviewing(s, r) || (s.match[r] === 'new' && s.confirmed[r])) return [];
          const t = clone(s);
          t.rep[r] = 'reviewing';
          t.match[r] = 'new';
          t.confirmed[r] = true;
          t.seen[r] = null;
          return [t];
        },
      },
      {
        name: 'Save',
        params: reps.map((r) => [r]),
        step(s, r) {
          if (s.rep[r] !== 'reviewing') return [];
          // Planted bug silentAttach: Atlas's suggestion is saved without the speaker confirming it
          if (!s.confirmed[r] && Bug !== 'silentAttach') return [];
          const t = clone(s);
          const m = s.match[r];
          if (m === 'new') {
            const n = Reports[r].creates;
            t.exists[n] = true;
            t.st[n] = 'open';
            t.src[n] = [r];
            alert(t, n);
          } else {
            // The matched entry changed since the speaker confirmed: ask again, attach nothing
            if (s.confirmed[r] && look(s, m) !== s.seen[r] && Bug !== 'noConflictCheck') {
              t.rep[r] = 'conflict';
              t.confirmed[r] = false;
              return [t];
            }
            if (s.mergedInto[m] !== null) return []; // with noConflictCheck, a merged entry still cannot take sources
            t.src[m] = add(s.src[m], r);
            if (s.st[m] === 'resolved') {
              t.st[m] = 'open'; // reported again: the same entry reopens, history kept (S14)
              t.resolvedBy[m] = null;
            }
            // Planted bug alertOnSource: every report pings the PM, not only new entries
            if (Bug === 'alertOnSource') alert(t, m);
          }
          t.rep[r] = 'saved';
          return [syncItems(t)];
        },
      },
      {
        // S13: the owner of the blocked work or a PM or Lead resolves; anyone else proposes
        name: 'Resolve',
        params: product(people, entries),
        step(s, p, e) {
          if (kind[e] !== 'blocker' || !s.exists[e] || s.st[e] !== 'open' || s.mergedInto[e] !== null) return [];
          const t = clone(s);
          if (p === owner[e] || isLead(p) || Bug === 'anyoneResolves') {
            t.st[e] = 'resolved';
            t.resolvedBy[e] = p;
            t.clearProposed[e] = false;
          } else {
            if (s.clearProposed[e]) return [];
            t.clearProposed[e] = true;
          }
          return [syncItems(t)];
        },
      },
      {
        name: 'Merge',
        params: product(entries, entries).filter(([x, y]) => x !== y),
        step(s, x, y) {
          if (!s.exists[x] || !s.exists[y] || s.mergedInto[x] !== null || s.mergedInto[y] !== null) return [];
          // Planted bug crossKindMerge: the PM can merge a blocker into a risk
          if (kind[x] !== kind[y] && Bug !== 'crossKindMerge') return [];
          const t = clone(s);
          t.mergedInto[x] = y;
          t.mergedSrc[x] = s.src[x];
          // Planted bug mergeDrops: x's sources are not carried over to y (reports lost)
          t.src[y] = Bug === 'mergeDrops' ? s.src[y] : [...new Set([...s.src[y], ...s.src[x]])].sort();
          // Planted bug mergeCopies: sources are copied into y but also left on x
          if (Bug !== 'mergeCopies') t.src[x] = [];
          t.clearProposed[x] = false;
          return [syncItems(t)];
        },
      },
      {
        // Undo the latest merge first: x's target must not itself be merged away
        name: 'Unmerge',
        params: entries.map((x) => [x]),
        step(s, x) {
          const y = s.mergedInto[x];
          if (y === null || s.mergedInto[y] !== null) return [];
          const t = clone(s);
          t.mergedInto[x] = null;
          // Planted bug unmergeKeeps: the entry comes back but its sources stay on the other one
          if (Bug !== 'unmergeKeeps') {
            t.src[x] = s.mergedSrc[x];
            t.src[y] = s.src[y].filter((id) => !s.mergedSrc[x].includes(id));
          }
          t.mergedSrc[x] = [];
          return [syncItems(t)];
        },
      },
      {
        // The PM has seen the "new blocker" item
        name: 'Ack',
        params: entries.map((e) => [e]),
        step(s, e) {
          if (!s.inbox.includes(`new_blocker:${e}`)) return [];
          const t = clone(s);
          t.inbox = s.inbox.filter((x) => x !== `new_blocker:${e}`);
          return [t];
        },
      },
    ],
    views: {
      reports: (s) => Object.fromEntries(entries.map((e) => [e, s.src[e].length])),
    },
    invariants: {
      TypeOK: (s) =>
        reps.every((r) => ['pending', 'reviewing', 'conflict', 'saved'].includes(s.rep[r])) &&
        entries.every((e) => ['none', 'open', 'resolved'].includes(s.st[e])),
      // Kinds never mix: a source sits only on an entry of its own kind, and merges stay within a kind
      NeverAcrossKinds: (s) =>
        entries.every(
          (e) =>
            s.src[e].every((id) => srcKind[id] === kind[e]) &&
            (s.mergedInto[e] === null || kind[s.mergedInto[e]] === kind[e]),
        ),
      // Every saved report, and every earlier source, is held exactly once; unsaved reports nowhere
      EveryReportOnce: (s) =>
        allSources.every((id) => {
          const n = entries.filter((e) => s.src[e].includes(id)).length;
          const saved = !(id in Reports) || s.rep[id] === 'saved';
          return n === (saved ? 1 : 0);
        }),
      // The PM is told once per new entry, and never for a source added to an existing one
      OneAlertPerNewEntry: (s) =>
        entries.every((e) => s.alerted[e] === (e in Existing || !s.exists[e] ? 0 : 1)),
      NoOrphanItems: (s) =>
        s.inbox.every((x) => {
          const [k, e] = x.split(':');
          return k === 'clear' ? s.clearProposed[e] : s.st[e] === 'open' && s.mergedInto[e] === null;
        }),
    },
    actionProperties: {
      // A report joins an existing entry only after the speaker confirmed that match (never silently)
      SourceOnlyAfterConfirm: (s, t) =>
        reps.every((r) => !(s.rep[r] !== 'saved' && t.rep[r] === 'saved' && s.match[r] !== 'new') || s.confirmed[r]),
      // A match to an entry that changed since review becomes a conflict, never an attach.
      // A resolved blocker reopens only when the speaker saw it resolved and confirmed.
      ChangedMatchIsAConflict: (s, t) =>
        reps.every(
          (r) =>
            !(s.rep[r] !== 'saved' && t.rep[r] === 'saved' && s.match[r] !== 'new') ||
            look(s, s.match[r]) === s.seen[r],
        ),
      // Unmerge gives the entry back exactly the sources it had, and takes them off the other entry
      UnmergeRestores: (s, t) =>
        entries.every((x) => {
          const y = s.mergedInto[x];
          if (y === null || t.mergedInto[x] !== null) return true;
          return (
            JSON.stringify(t.src[x]) === JSON.stringify(s.mergedSrc[x]) &&
            s.mergedSrc[x].every((id) => !t.src[y].includes(id))
          );
        }),
      // S13: a blocker is resolved only by the owner of the blocked work or a PM or Lead
      BlockerResolvedByOwnerOrLead: (s, t) =>
        entries.every(
          (e) =>
            !(s.st[e] === 'open' && t.st[e] === 'resolved') ||
            t.resolvedBy[e] === owner[e] ||
            isLead(t.resolvedBy[e]),
        ),
    },
  };
}
