// Spec 6: BraidEntry (use case 1, machines doc M15; briefing 26 Oct 2026)
// Who can report and who decides on a project's BRAID log. One project, a few
// entries, people whose project roles can change. Risks and Decisions need a
// PM or Lead to approve them; nothing else may put them on the log.
//
// Not modelled here: Blockers and Issues (they go on the log as reported, no
// approval), matching and merging (M16), and whether Atlas spots a conflict.
// Conflicts are given as a constant: the model checks what DPM does once a
// conflict link exists, not how good Atlas is at finding one.
import { clone, product } from '../lib.mjs';

// Rights table defaults (use case 1, S10, S11)
const DECIDE = { risk: ['pm', 'lead'], decision: ['pm', 'lead'] };
const ON_LOG = { risk: 'open', decision: 'approved' };
const STATES = ['none', 'proposed', 'more_info', 'open', 'approved', 'declined', 'withdrawn', 'superseded'];

export default function BraidEntry({
  Entries = { e1: 'risk', e2: 'decision', e3: 'decision' },
  Conflicts = [['e2', 'e3']],
  Reporters = ['kemar', 'alicia'],
  Deciders = { alicia: 'pm', andre: 'lead' }, // starting roles; each can lose it and get it back
  CheckRightWhen = 'on_approve', // or 'on_report': the right is checked when the item was created
  Bug = null,
} = {}) {
  const ids = Object.keys(Entries);
  const people = [...new Set([...Reporters, ...Object.keys(Deciders)])];
  const canDecide = (role, e) => DECIDE[Entries[e]].includes(role);
  const holders = (s, e) => people.filter((p) => canDecide(s.role[p], e)).sort();
  const partners = (e) => Conflicts.flatMap(([a, b]) => (a === e ? [b] : b === e ? [a] : []));

  // C4: an entry's inbox items always match its state (one per cause key)
  const syncItems = (t, e) => {
    t.inbox = t.inbox.filter((x) => x.split(':')[1] !== e);
    if (t.st[e] === 'proposed') {
      if (holders(t, e).length) t.inbox.push(`approve:${e}`);
      // Planted bug noDeciderItem: nobody holds the right and nobody is told
      else if (Bug !== 'noDeciderItem') t.inbox.push(`no_decider:${e}`);
    }
    if (t.st[e] === 'more_info') t.inbox.push(`more_info:${e}`);
    t.inbox.sort();
    return t;
  };

  const decide = (t, e, who, via) => {
    t.st[e] = ON_LOG[Entries[e]];
    t.decidedBy[e] = who;
    t.via[e] = via;
    if (Entries[e] === 'decision' && Bug !== 'noSupersede') {
      // Approving a decision supersedes an approved one it conflicts with
      for (const q of partners(e)) if (t.st[q] === 'approved') t.st[q] = 'superseded';
    }
    return syncItems(t, e);
  };

  // The guard every decision passes through (rule 7: permission is checked when it runs)
  const mayDecide = (s, p, e) =>
    s.st[e] === 'proposed' && (CheckRightWhen === 'on_report' ? s.asked[e].includes(p) : canDecide(s.role[p], e));

  const perEntry = ids.map((e) => [e]);
  const deciderMoves = product(Object.keys(Deciders), ids);

  return {
    name: `BraidEntry (CheckRightWhen = ${CheckRightWhen}${Bug ? `, bug ${Bug}` : ''})`,
    init: () => [
      {
        role: Object.fromEntries(people.map((p) => [p, Deciders[p] ?? 'member'])),
        st: Object.fromEntries(ids.map((e) => [e, 'none'])),
        reporter: Object.fromEntries(ids.map((e) => [e, null])),
        says: Object.fromEntries(ids.map((e) => [e, false])),
        asked: Object.fromEntries(ids.map((e) => [e, []])),
        decidedBy: Object.fromEntries(ids.map((e) => [e, null])),
        via: Object.fromEntries(ids.map((e) => [e, 'none'])),
        reminded: Object.fromEntries(ids.map((e) => [e, false])),
        inbox: [],
      },
    ],
    actions: [
      {
        // A saved capture reports the entry. "says" = the words claim it was agreed or approved.
        // Who reports a decision changes no rule, so only the first reporter does (keeps the model small).
        name: 'Report',
        params: ids.flatMap((e) =>
          Entries[e] === 'decision' ? [[Reporters[0], e, false], [Reporters[0], e, true]] : Reporters.map((p) => [p, e, false]),
        ),
        step(s, p, e, says) {
          if (s.st[e] !== 'none') return [];
          const t = clone(s);
          t.reporter[e] = p;
          t.says[e] = says;
          if (CheckRightWhen === 'on_report') t.asked[e] = holders(s, e);
          // E92: a PM or Lead reporting a risk on their own project puts it straight on the log
          if (Entries[e] === 'risk' && canDecide(s.role[p], e)) return [decide(t, e, p, 'button')];
          // Planted bug approveByText: "Andre and I agreed" is taken as the approval
          if (says && Bug === 'approveByText') return [decide(t, e, 'atlas', 'text')];
          // Planted bug supersedeOnReport (section 20, U4): "we're going back to 5am" replaces the approved decision before anyone approves the new one
          if (Bug === 'supersedeOnReport' && Entries[e] === 'decision') for (const q of partners(e)) if (t.st[q] === 'approved') t.st[q] = 'superseded';
          t.st[e] = 'proposed';
          return [syncItems(t, e)];
        },
      },
      {
        name: 'Approve',
        params: deciderMoves,
        step: (s, p, e) => (mayDecide(s, p, e) ? [decide(clone(s), e, p, 'button')] : []),
      },
      {
        name: 'Decline',
        params: deciderMoves,
        step(s, p, e) {
          if (!mayDecide(s, p, e)) return [];
          const t = clone(s);
          t.st[e] = 'declined';
          t.decidedBy[e] = p;
          t.via[e] = 'button';
          return [syncItems(t, e)];
        },
      },
      {
        name: 'RequestInfo',
        params: deciderMoves,
        step(s, p, e) {
          if (!mayDecide(s, p, e)) return [];
          const t = clone(s);
          t.st[e] = 'more_info';
          return [syncItems(t, e)];
        },
      },
      {
        name: 'Reply',
        params: perEntry,
        step(s, e) {
          if (s.st[e] !== 'more_info') return [];
          const t = clone(s);
          t.st[e] = 'proposed';
          return [syncItems(t, e)];
        },
      },
      {
        name: 'Withdraw',
        params: perEntry,
        step(s, e) {
          if (!['proposed', 'more_info'].includes(s.st[e])) return [];
          const t = clone(s);
          t.st[e] = 'withdrawn';
          return [syncItems(t, e)];
        },
      },
      {
        // S18: reminders to the deciders; a reminder never decides
        name: 'Remind',
        params: perEntry,
        step(s, e) {
          if (s.st[e] !== 'proposed') return [];
          const t = clone(s);
          if (!s.reminded[e]) {
            t.reminded[e] = true;
            return [t];
          }
          // Planted bug autoApprove: after the reminders run out, the proposal approves itself
          return Bug === 'autoApprove' ? [decide(t, e, 'timer', 'timer')] : [];
        },
      },
      {
        // A PM or Lead loses the role, or gets it back (M13)
        name: 'RoleChange',
        params: Object.keys(Deciders).flatMap((p) => [[p, Deciders[p]], [p, 'member']]),
        step(s, p, r) {
          if (s.role[p] === r) return [];
          const t = clone(s);
          t.role[p] = r;
          for (const e of ids) syncItems(t, e);
          return [t];
        },
      },
    ],
    views: { holders },
    invariants: {
      TypeOK: (s) =>
        ids.every((e) => STATES.includes(s.st[e])) &&
        ids.every((e) => ['none', 'button', 'text', 'timer'].includes(s.via[e])) &&
        people.every((p) => ['pm', 'lead', 'member'].includes(s.role[p])),
      // "We agreed" in a message is never an approval
      DecisionNeverApprovedByText: (s) => ids.every((e) => s.via[e] !== 'text'),
      // No timer approves or declines anything
      NothingDecidesItself: (s) => ids.every((e) => s.via[e] !== 'timer'),
      // Two conflicting decisions never both stand: approving one supersedes the other
      ConflictsNeverSilent: (s) => Conflicts.every(([a, b]) => !(s.st[a] === 'approved' && s.st[b] === 'approved')),
      // Section 20, U4: a decision is replaced only by one that was approved (SD1, SD3: a pending or declined reversal replaces nothing)
      SupersededHasApprovedSuccessor: (s) => ids.every((e) => s.st[e] !== 'superseded' || partners(e).some((q) => s.st[q] === 'approved')),
      // A proposal is always in front of someone who can decide it, or the owner is told nobody can (E91)
      SomeoneIsAsked: (s) =>
        ids.every(
          (e) =>
            s.st[e] !== 'proposed' ||
            (holders(s, e).length ? s.inbox.includes(`approve:${e}`) : s.inbox.includes(`no_decider:${e}`)),
        ),
      // Every inbox item still has its cause
      NoOrphanItems: (s) =>
        s.inbox.every((x) => {
          const [kind, e] = x.split(':');
          return kind === 'more_info' ? s.st[e] === 'more_info' : s.st[e] === 'proposed';
        }),
    },
    actionProperties: {
      // A Risk or Decision goes on the log only by a person who holds the right at that moment
      OnLogOnlyWithRight: (s, t) =>
        ids.every((e) => {
          const onLog = ON_LOG[Entries[e]];
          if (s.st[e] === onLog || t.st[e] !== onLog) return true;
          const who = t.decidedBy[e];
          return people.includes(who) && canDecide(s.role[who], e);
        }),
    },
  };
}
