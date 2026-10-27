// M20 Chat command (use-cases/atlas-conversational-plan.md, phase B, section 4; rules in section 1).
// Acting from an answer in the DPM chat. Alicia is the PM on Forager; Kemar is a member and owns
// the work that blocker b1 holds up. r1 is a proposed risk on Forager. r2 is a proposed risk on
// Store Insights, which neither of them is in (the outsider project, AC9).
//   An answer is a snapshot ("as of 9:41am"): each record the asker can read, the version they saw,
//   and whether its line carries a button (they hold the right then and the record is still open).
//   A button is a command confirmed in the same tap: done or refused at once, never a card.
//   A reply in words ("Approve the Kyle risk") is read by Atlas, who may name anything. DPM keeps it
//   only when it names a line of the open answer (AC6, AC9) and the asker speaks for themselves
//   (rule 10); then it is a card: proposed -> done | refused | cancelled | expired (30 minutes, CD2).
//   Confirming checks the right held now, then the version seen (rule 4, AC1 to AC3).
//   Meanwhile someone else on the screen decides the record or edits it (the version moves), and
//   the asker can lose the right: Alicia stops being PM or leaves Forager, Kemar leaves it.
// Not modelled: record changes said in words ("Mark the second one done" is a normal proposal, M3
// and M4, checked in CaptureSave); clarifications (AC7, M21 in phase D); Decline, which runs as Approve.
import { clone, product } from '../lib.mjs';

const PEOPLE = ['alicia', 'kemar'];
const OTHER = { alicia: 'kemar', kemar: 'alicia' };
const RECS = ['r1', 'b1'];
// The one decision each line offers, as the record's own machine (M15) draws it
const FROM = { r1: 'proposed', b1: 'reported', r2: 'proposed' };
const TO = { r1: 'open', b1: 'resolved', r2: 'open' };
const R2 = { st: 'proposed', v: 0 }; // never changes here; only who may hear of it matters
// Rights are only lost here (M13); getting one back changes no guard
const LOSSES = [['alicia', 'pm', 'member'], ['alicia', 'pm', 'none'], ['alicia', 'member', 'none'], ['kemar', 'member', 'none']];
const FINAL = ['done', 'refused', 'cancelled', 'expired'];
// Section 4, M20 as drawn. A button (b.) goes from nothing straight to its end in the same tap.
const ARROWS = {
  b: ['none>done', 'none>refused'],
  c: ['none>proposed', 'proposed>done', 'proposed>refused', 'proposed>cancelled', 'proposed>expired'],
};

export default function ChatCommand({
  Askers = PEOPLE, // who asks and acts in the chat; one at a time keeps a run under a million states
  ReferentCheck = 'answer_lines', // as written (AC9); 'lines_now' also runs the per-viewer query again
  Bug = null,
} = {}) {
  const CARD_IDS = product(['c'], Askers, [...RECS, 'r2']).map((p) => p.join('.'));
  const rec = (s, x) => (x === 'r2' ? R2 : s.rec[x]);
  // P10: Forager is readable while a member; Store Insights never, for either of them
  const reads = (s, p, x) => x !== 'r2' && s.role[p] !== 'none';
  // Approving a risk: the PM. Resolving a blocker: the PM, or the owner of the blocked work (S13)
  const right = (s, p, x) =>
    x === 'r1' ? s.role[p] === 'pm' : x === 'b1' ? s.role[p] === 'pm' || (p === 'kemar' && s.role.kemar === 'member') : false;
  const lineOf = (s, a, x) => s.ans[a]?.find((l) => l.x === x);
  const t0 = (s, by) => Object.assign(clone(s), { by });

  // CONFIRM: the guard runs now, in the order the plan writes it: right held, then version unchanged.
  // A refusal for a change says what changed, or who decided it first, as the record is now (AC2, AC3).
  function run(s, t, id) {
    const c = t.cmd[id];
    const now = rec(t, c.x);
    // Planted bug rightAtCard: the right is the one the answer saw, not the one held now
    const holds = Bug === 'rightAtCard' ? !!lineOf(s, c.asker, c.x)?.act : right(s, c.on, c.x);
    // Planted bug noVersionCheck: only the record's own machine guards it (still open, any version)
    const same = (Bug === 'noVersionCheck' || now.v === c.v) && now.st === FROM[c.x];
    // Planted bug versionFirst: the version is checked before the right
    if (Bug === 'versionFirst' && !same) Object.assign(c, { st: 'refused', why: 'changed' });
    else if (!holds) Object.assign(c, { st: 'refused', why: 'right_lost' });
    else if (!same) Object.assign(c, { st: 'refused', why: 'changed' });
    else {
      t.rec[c.x] = { st: TO[c.x], v: now.v + 1 };
      Object.assign(c, { st: 'done', runs: c.runs + 1 });
    }
    return t;
  }

  // Planted bug rerun: a repeat of a command that already ran runs the screen's command again
  // (once more at most, to keep the model finite)
  const rerun = (t, id) => {
    const c = t.cmd[id];
    if (c.runs > 1) return [];
    t.rec[c.x] = { ...t.rec[c.x], v: t.rec[c.x].v + 1 };
    c.runs += 1;
    return [t];
  };

  // The command stores the subject, the version seen (the answer's) and whose decision it is
  const command = (s, a, x, on, all) => ({ asker: a, x, on, v: lineOf(s, a, x)?.v ?? rec(s, x).v, st: 'proposed', runs: 0, all, why: null });
  // AC6, AC9: a reply is a command only about a line of the open answer; as written that is the snapshot
  const keeps = (s, a, x) =>
    Bug === 'trustReferent' || (!!lineOf(s, a, x) && (ReferentCheck === 'answer_lines' || reads(s, a, x)));

  return {
    name: `ChatCommand (${Askers.join(', ')} ask; ReferentCheck = ${ReferentCheck}${Bug ? `, bug ${Bug}` : ''})`,
    init: () => [
      {
        role: { alicia: 'pm', kemar: 'member' },
        rec: { r1: { st: 'proposed', v: 0 }, b1: { st: 'reported', v: 0 } },
        ans: { alicia: null, kemar: null },
        cmd: {},
        by: null,
      },
    ],
    actions: [
      {
        // A question answered through the per-viewer queries: the asker's lines as of now
        name: 'Asks',
        params: Askers.map((a) => [a]),
        step(s, a) {
          if (s.ans[a]) return [];
          const t = t0(s, a);
          // Planted bug leakLines: the query is not per viewer and lists Store Insights too
          const xs = [...RECS, 'r2'].filter((x) => reads(s, a, x) || (Bug === 'leakLines' && x === 'r2'));
          t.ans[a] = xs.map((x) => ({ x, v: rec(s, x).v, act: right(s, a, x) && rec(s, x).st === FROM[x] }));
          return [t];
        },
      },
      {
        // A button on an answer line, confirmed in the same tap. A double tap carries the same id (AC4).
        name: 'Taps',
        params: product(Askers, RECS),
        step(s, a, x) {
          if (!lineOf(s, a, x)?.act) return [];
          const id = `b.${a}.${x}`;
          if (s.cmd[id]) return Bug === 'rerun' && s.cmd[id].st === 'done' ? rerun(t0(s, a), id) : [];
          const t = t0(s, a);
          t.cmd[id] = { ...command(s, a, x, a, false), st: 'none' };
          return [run(s, t, id)];
        },
      },
      {
        // Atlas reads a reply. It may name any record, and may read it as said by the asker ("Approve
        // the Kyle risk") or about the other person ("Alicia approved the Kyle risk"). DPM decides.
        name: 'Replies',
        params: product(Askers, [...RECS, 'r2'], ['self', 'other']),
        step(s, a, x, claim) {
          if (!keeps(s, a, x)) return []; // not a command: "Which one do you mean?", naming nothing
          // Rule 10, E96: words about someone else's decision are an update, never their decision
          if (claim === 'other' && Bug !== 'claimCounts') return [];
          const id = `c.${a}.${x}`;
          // The same reply again changes nothing (once only). One reply per line is enough here: a
          // second message would be a new card with its own id, guarded the same way.
          if (s.cmd[id]) return [];
          const t = t0(s, 'atlas');
          t.cmd[id] = command(s, a, x, claim === 'other' ? OTHER[a] : a, false);
          // Planted bug atlasActs: a clear, single match is run at once instead of asking
          if (Bug === 'atlasActs') {
            t.cmd[id].st = 'none';
            run(s, t, id);
          }
          return [t];
        },
      },
      {
        // AC8: "Approve all of them" is one card per line, never one tap for many
        name: 'RepliesAll',
        params: Askers.map((a) => [a]),
        step(s, a) {
          const xs = RECS.filter((x) => keeps(s, a, x) && !s.cmd[`c.${a}.${x}`]);
          if (xs.length < 2) return [];
          const t = t0(s, 'atlas');
          for (const x of xs) t.cmd[`c.${a}.${x}`] = command(s, a, x, a, true);
          return [t];
        },
      },
      {
        // CONFIRM on the card; a second tap finds it final and changes nothing (AC4)
        name: 'Confirms',
        params: CARD_IDS.map((id) => [id]),
        step(s, id) {
          const c = s.cmd[id];
          if (!c) return [];
          const t = t0(s, c.asker);
          if (c.st === 'done' && Bug === 'rerun') return rerun(t, id);
          // Planted bug reviveExpired: an expired card still runs when tapped
          if (c.st !== 'proposed' && !(c.st === 'expired' && Bug === 'reviveExpired')) return [];
          run(s, t, id);
          // Planted bug oneTapForAll: one tap confirms every card the same reply made
          if (Bug === 'oneTapForAll' && c.all) {
            for (const k of CARD_IDS) if (k !== id && t.cmd[k]?.all && t.cmd[k].st === 'proposed') run(s, t, k);
          }
          return [t];
        },
      },
      {
        name: 'Cancels',
        params: CARD_IDS.map((id) => [id]),
        step(s, id) {
          const c = s.cmd[id];
          if (c?.st !== 'proposed') return [];
          const t = t0(s, c.asker);
          t.cmd[id].st = 'cancelled';
          // Planted bug cancelDeclines: Cancel on an approval card declines the risk
          if (Bug === 'cancelDeclines' && c.x === 'r1' && s.rec.r1.st === 'proposed') t.rec.r1 = { st: 'declined', v: s.rec.r1.v + 1 };
          return [t];
        },
      },
      {
        // TIMER command_expiry, 30 minutes (CD2, AC10)
        name: 'Expires',
        params: CARD_IDS.map((id) => [id]),
        fair: true,
        step(s, id) {
          // Planted bug noExpiry: the timer is never set
          if (s.cmd[id]?.st !== 'proposed' || Bug === 'noExpiry') return [];
          const t = t0(s, null);
          t.cmd[id].st = 'expired';
          return [t];
        },
      },
      {
        // Someone else on the screen decides the record first (AC2)...
        name: 'ScreenDecides',
        params: RECS.map((x) => [x]),
        step(s, x) {
          const r = s.rec[x];
          if (r.st !== FROM[x]) return [];
          const t = t0(s, 'screen');
          t.rec[x] = { st: TO[x], v: r.v + 1 };
          return [t];
        },
      },
      {
        // ...or edits it, and the version moves (AC3). Once per record keeps the model finite.
        name: 'ScreenEdits',
        params: RECS.map((x) => [x]),
        step(s, x) {
          const r = s.rec[x];
          if (r.st !== FROM[x] || r.v > 0) return [];
          const t = t0(s, 'screen');
          t.rec[x] = { ...r, v: r.v + 1 };
          return [t];
        },
      },
      {
        // A role is lost or a person leaves the project (AC1); only an asker's role matters
        name: 'LosesRole',
        params: LOSSES.filter(([p]) => Askers.includes(p)),
        step(s, p, from, to) {
          if (s.role[p] !== from) return [];
          const t = t0(s, null);
          t.role[p] = to;
          return [t];
        },
      },
    ],
    invariants: {
      TypeOK: (s) =>
        Object.entries(s.cmd).every(([id, c]) => id === `${id[0]}.${c.asker}.${c.x}` && [...FINAL, 'proposed'].includes(c.st)),
      // Once only (rule 6, AC4): every command runs at most once
      OnceOnly: (s) => Object.values(s.cmd).every((c) => c.runs <= 1),
      // AC9: a command is only ever about a line of the asker's own answer
      CommandsOnlyOnOwnLines: (s) => Object.values(s.cmd).every((c) => !!lineOf(s, c.asker, c.x)),
    },
    actionProperties: {
      // Only drawn arrows (machines doc section 1, rule 2); a final state never changes
      OnlyDrawnArrows: (s, t) =>
        Object.keys(t.cmd).every((id) => {
          const from = s.cmd[id]?.st ?? 'none';
          const to = t.cmd[id].st;
          return from === to || ARROWS[id[0]].includes(`${from}>${to}`);
        }),
      // Rule 4, AC1: the person who confirms holds the right when it runs
      RightHeldAtRun: (s, t) => ran(s, t).every((id) => right(s, t.by, t.cmd[id].x)),
      // AC3, AC5: it runs only on the picture the asker saw
      VersionSeenAtRun: (s, t) => ran(s, t).every((id) => rec(s, t.cmd[id].x).v === t.cmd[id].v),
      // Rule 1: Atlas's reading of a reply never changes a record
      AtlasNeverChanges: (s, t) => t.by !== 'atlas' || RECS.every((x) => same(s.rec[x], t.rec[x])),
      // Rule 1, AC10: away from the screen, a record changes only when a command on it runs
      RecordChangesOnlyWhenRun: (s, t) =>
        t.by === 'screen' || RECS.every((x) => same(s.rec[x], t.rec[x]) || ran(s, t).some((id) => t.cmd[id].x === x)),
      // AC8: one tap, one decision
      OneDecisionPerTap: (s, t) => ran(s, t).length <= 1,
      // Rule 10: a decision is made only by the person who confirmed it, in their own name
      YourWordOnly: (s, t) => ran(s, t).every((id) => t.cmd[id].asker === t.by && t.cmd[id].on === t.by),
      // P10, rule 3: nothing about a record the asker cannot read now is said to them, beyond what
      // their answer showed or what they did themselves. A card names the record as it is; so does a
      // refusal for a change.
      NothingUnseenNamed: (s, t) =>
        Askers.every((a) => {
          const v = (x) => rec(s, x).v;
          const known = (x) =>
            reads(s, a, x) ||
            s.ans[a]?.some((l) => l.x === x && l.v === v(x)) ||
            Object.values(s.cmd).some((c) => c.asker === a && c.x === x && c.st === 'done' && c.v + 1 === v(x));
          if (!s.ans[a] && t.ans[a] && !t.ans[a].every((l) => reads(s, a, l.x))) return false;
          return Object.entries(t.cmd).every(([id, c]) => {
            const was = s.cmd[id];
            if (c.asker !== a || (was && was.st === c.st)) return true;
            if (!was && id[0] === 'c' && !known(c.x)) return false; // the card's words
            return c.why !== 'changed' || known(c.x); // the refusal's
          });
        }),
    },
    leadsTo: {
      // Nothing gets stuck (rule 5): every card ends
      CardsEnd: CARD_IDS.map((id) => ({
        label: id,
        P: (s) => s.cmd[id]?.st === 'proposed',
        Q: (s) => s.cmd[id]?.st !== 'proposed',
      })),
    },
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// The commands that ran in this step (their run count went up)
const ran = (s, t) => Object.keys(t.cmd).filter((id) => t.cmd[id].runs > (s.cmd[id]?.runs ?? 0));
