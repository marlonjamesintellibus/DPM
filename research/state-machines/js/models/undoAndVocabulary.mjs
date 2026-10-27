// Undo and corrections that teach Atlas (use-cases/atlas-conversational-plan.md, section 14, phase L:
// M30 Undo and M31 Vocabulary change). Kemar is a member of GQ and Store Insights (SI); Alicia is the
// PM of both; Jodian is a member of SI; Dwayne is the PM of HX, a project Kemar cannot open (P10).
//   M30  Kemar's save of 9:30 blocked #151 (SI), added his report to the blocker b1 that Jodian
//        reported first (SI, UN6) and proposed the risk r1 (GQ, UN3), with "New risk" to Alicia and
//        "Kemar also reported this" to Jodian. "Undo that" asks the Undo job to reverse it, within
//        undoMinutes, while every record is at the version the save wrote and he holds the right now.
//        Each record goes back through its own UNDO arrow, all or nothing (S3); the save's notices are
//        followed by "Kemar undid this."
//   M31  "GQ also means the Academy" (pG), "Dwayne is on GQ" (pT, wrong: UN8), Atlas's own proposal
//        after Kemar moved "Academy" to SI twice in review (pS, CD14). HX may already use "Academy".
//        The project's PM approves (checked now) or declines; reminders (S18), then vocabExpiryDays.
//        An alias another project already uses is refused before it is proposed (UN9).
// Recheck = false is the plan as written. Recheck = true is the plan with the fixes this check asked
// for (see rows/undoAndVocabulary.mjs):
//   M30  undoing rechecks the versions and the right when the UNDO arrows run, and gets the drawn
//        arrow undoing -> refused; a refusal names, and a notice goes to, only what the reader can open
//   M31  the clash is checked against the projects the person told can open, at the ask and again
//        at APPROVE
// An entry the save created goes back to none, as section 14 says (built in phase L: first modelled as
// withdrawn); D11 withdraws only the save's own sources from an entry others reported. Chosen where the
// plan is silent: the same correction said again changes nothing, whatever its proposal's state.
import { clone, product } from '../lib.mjs';

const AUTHOR = 'kemar';
const SAVED_V = 1;
const reads = (s, who, proj) => !!s.role[who]?.[proj];
const readable = (s, who) => Object.keys(s.role[who] ?? {});
const sortedAdd = (list, x) => (list.includes(x) ? list : [...list, x].sort());

// A message is "to|kind|projects it says something about"; every one of those projects must be
// one the reader can open when it is said (P10, rule 8)
const say = (t, to, kind, about) => {
  t.said = sortedAdd(t.said, `${to}|${kind}|${[...new Set(about)].sort().join(',')}`);
};
const newMessages = (s, t) => t.said.filter((m) => !s.said.includes(m)).map((m) => m.split('|'));
const namesOnlyReadable = (s, t) =>
  newMessages(s, t).every(([to, , about]) => !about || about.split(',').every((p) => reads(t, to, p)));

// ---------------------------------------------------------------------------------------------
// M30. Undo (Job)

// The records Kemar's save touched, and the project each is on
const RECORDS = { w151: 'SI', b1: 'SI', r1: 'GQ' };
// The save's own notices: who was told about which record
const NOTICES = [
  ['alicia', 'r1'],
  ['jodian', 'b1'],
];
const UNDO_DRAWN = ['none>requested', 'requested>undoing', 'requested>refused', 'undoing>undone'];
const RECORD_DRAWN = {
  w151: ['blocked>in_progress'], // M5, and its UNDO arrow
  b1: ['reported>resolved', 'reported>withdrawn'], // M15
  r1: ['proposed>open', 'proposed>none'], // M15 APPROVE, and the UNDO arrow back to none (UN3)
};
const JOB_FINAL = ['undone', 'refused'];

export function Undo({ Recheck = false, Bug = null } = {}) {
  const t0 = (s, by) => Object.assign(clone(s), { by });
  const drawn = Recheck ? [...UNDO_DRAWN, 'undoing>refused'] : UNDO_DRAWN;
  const moved = (s) => Object.keys(RECORDS).filter((x) => s.rec[x].v !== SAVED_V);
  const rightHeld = (s, who) => Object.values(RECORDS).every((p) => reads(s, who, p));
  // As written a refusal names what it is about; with the fix, only what the asker can open now
  const shown = (t, who, projects) => (Recheck ? projects.filter((p) => reads(t, who, p)) : projects);

  // Each record back through its own UNDO arrow, then "Kemar undid this." to those the save told
  function undo(t, xs) {
    for (const x of xs) {
      const r = t.rec[x];
      if (x === 'w151') r.st = 'in_progress';
      if (x === 'r1') r.st = 'none';
      if (x === 'b1') {
        // D11, UN6: only Kemar's report is withdrawn; the entry stays for Jodian's
        if (Bug === 'withdrawAll') Object.assign(r, { st: 'withdrawn', src: [] });
        else r.src = r.src.filter((p) => p !== AUTHOR);
      }
      Object.assign(r, { v: r.v + 1, undone: true });
    }
    // UN3: the deciders' inbox items close as cause gone
    if (t.rec.r1.st !== 'proposed' && Bug !== 'inboxStays') t.inbox = 'closed';
    for (const [to, x] of NOTICES) {
      if (xs.includes(x) && (!Recheck || reads(t, to, RECORDS[x]))) say(t, to, 'undid', [RECORDS[x]]);
    }
  }

  function refuse(t, i, owner, kind, projects) {
    t.jobs[i].st = 'refused';
    say(t, owner, kind, shown(t, owner, projects));
    return [t];
  }

  return {
    name: `Undo (${Recheck ? 'with the fixes' : 'as written'}${Bug ? `, bug ${Bug}` : ''})`,
    init: () => [
      {
        role: { kemar: { GQ: 'member', SI: 'member' }, alicia: { GQ: 'pm', SI: 'pm' }, jodian: { SI: 'member' } },
        win: true,
        rec: {
          w151: { st: 'blocked', v: SAVED_V, undone: false },
          b1: { st: 'reported', src: ['jodian', 'kemar'], v: SAVED_V, undone: false },
          r1: { st: 'proposed', v: SAVED_V, undone: false },
        },
        inbox: 'open',
        jobs: [],
        said: [],
        by: null,
      },
    ],
    actions: [
      {
        // "Undo that" or the Undo button, command u1. Alicia has no save of her own (UN4)
        name: 'AsksUndo',
        params: [['kemar'], ['alicia']],
        step(s, by) {
          const t = t0(s, by);
          if (by === AUTHOR || Bug === 'anyoneUndoes') {
            // UN5: the same command again changes nothing
            const mine = s.jobs.filter((j) => j.owner === by).length;
            if (mine && !(Bug === 'noDedup' && mine < 2)) return [];
            t.jobs.push({ st: 'requested', owner: by });
            return [t];
          }
          say(t, by, 'nothing_to_undo', []);
          return [t];
        },
      },
      {
        // "Why did you file that?": a read. The routing reason is Kemar's own words; the match is
        // b1 on SI's log, shown through the per-viewer query
        name: 'AsksWhy',
        params: [['kemar'], ['alicia']],
        step(s, by) {
          const t = t0(s, by);
          if (by === AUTHOR) say(t, by, 'why', reads(s, by, 'SI') || Bug === 'whyLeaks' ? ['SI'] : []);
          else if (Bug === 'whyOthers') say(t, by, 'why', ['SI']);
          else say(t, by, 'not_yours', []); // UN7
          return [t];
        },
      },
      {
        // The job checks the guard: own save, within undoMinutes, every record at the version the
        // save wrote, the right held now
        name: 'Check',
        params: [[0], [1]],
        fair: true,
        step(s, i) {
          const j = s.jobs[i];
          if (j?.st !== 'requested') return [];
          const t = t0(s, 'job');
          if (!s.win) return refuse(t, i, j.owner, 'too_late', Object.values(RECORDS)); // UN1, with links
          if (moved(s).length && Bug !== 'noVersionCheck') {
            return refuse(t, i, j.owner, 'moved', moved(s).map((x) => RECORDS[x])); // UN2
          }
          if (!rightHeld(s, j.owner)) return refuse(t, i, j.owner, 'no_right', []);
          if (Bug === 'skipCheck') {
            undo(t, Object.keys(RECORDS));
            t.jobs[i].st = 'undone';
            return [t];
          }
          t.jobs[i].st = 'undoing';
          return [t];
        },
      },
      {
        // The UNDO arrows run, all or nothing (S3). As drawn, a record's own arrow refuses a stale
        // version and undoing has no other way out
        name: 'Run',
        params: [[0], [1]],
        fair: true,
        step(s, i) {
          const j = s.jobs[i];
          if (j?.st !== 'undoing' || Bug === 'jobNeverRuns') return [];
          const t = t0(s, 'job');
          const stale = moved(s).length && Bug !== 'noVersionCheck' && Bug !== 'partial';
          if (Recheck && Bug !== 'rightAtAsk' && !rightHeld(s, j.owner)) return refuse(t, i, j.owner, 'no_right', []);
          if (Recheck && stale) return refuse(t, i, j.owner, 'moved', moved(s).map((x) => RECORDS[x]));
          if (stale) return [];
          const xs = Object.keys(RECORDS).filter((x) => Bug !== 'partial' || s.rec[x].v === SAVED_V);
          undo(t, xs);
          t.jobs[i].st = 'undone';
          return [t];
        },
      },
      { name: 'WindowCloses', params: [[]], step: (s) => (s.win ? [Object.assign(t0(s, 'timer'), { win: false })] : []) },
      {
        // Someone else acts on a record the save wrote (UN2): Alicia approves r1, resolves b1, unblocks #151
        name: 'AliciaActs',
        params: [['r1'], ['b1'], ['w151']],
        step(s, x) {
          const r = s.rec[x];
          const from = { r1: 'proposed', b1: 'reported', w151: 'blocked' }[x];
          if (r.st !== from || s.role.alicia[RECORDS[x]] !== 'pm') return [];
          const t = t0(s, 'alicia');
          t.rec[x].st = { r1: 'open', b1: 'resolved', w151: 'in_progress' }[x];
          t.rec[x].v++;
          if (x === 'r1') t.inbox = 'closed';
          return [t];
        },
      },
      {
        // M13: leaving SI. Saved reports stay as sources
        name: 'LeavesSI',
        params: [['kemar'], ['jodian']],
        step(s, who) {
          if (!s.role[who].SI) return [];
          const t = t0(s, 'org');
          delete t.role[who].SI;
          return [t];
        },
      },
    ],
    invariants: {
      // S3: every record the save wrote is undone, or none is
      AllOrNothing: (s) => new Set(Object.values(s.rec).map((r) => r.undone)).size === 1,
      // UN6: Jodian's report stays on b1
      OthersReportsKept: (s) => s.rec.b1.src.includes('jodian'),
      // UN3: Alicia's "approve r1" is open exactly while r1 waits
      InboxFollowsCause: (s) => (s.inbox === 'open') === (s.rec.r1.st === 'proposed'),
      // UN5, rule 6: one job per command, however often it arrives
      OneJobPerCommand: (s) => s.jobs.filter((j) => j.owner === AUTHOR).length <= 1,
      // UN7: why a thing was filed is told only to the person who said it
      WhyOnlyToAuthor: (s) => s.said.every((m) => !m.includes('|why|') || m.startsWith(`${AUTHOR}|`)),
    },
    actionProperties: {
      // Rule 2 of section 1: the job and each record move only along drawn arrows
      OnlyDrawnArrows: (s, t) =>
        t.jobs.every((j, i) => (s.jobs[i]?.st ?? 'none') === j.st || drawn.includes(`${s.jobs[i]?.st ?? 'none'}>${j.st}`)) &&
        Object.keys(RECORDS).every((x) => s.rec[x].st === t.rec[x].st || RECORD_DRAWN[x].includes(`${s.rec[x].st}>${t.rec[x].st}`)),
      // "Cannot be undone: anything someone else has acted on since"
      NeverUndoOthersWork: (s, t) => Object.keys(RECORDS).every((x) => s.rec[x].undone || !t.rec[x].undone || s.rec[x].v === SAVED_V),
      // Rule 4: the right is held when the UNDO arrows run, not only when "Undo that" was checked
      RightHeldWhenUndone: (s, t) =>
        t.jobs.every(
          (j, i) =>
            s.jobs[i]?.st === 'undone' ||
            j.st !== 'undone' ||
            Object.keys(RECORDS).every((x) => s.rec[x].undone || !t.rec[x].undone || reads(s, j.owner, RECORDS[x])),
        ),
      // "Their own save": only Kemar undoes Kemar's save
      OnlyAuthorUndoes: (s, t) => t.jobs.every((j, i) => s.jobs[i]?.st === 'undone' || j.st !== 'undone' || j.owner === AUTHOR),
      // P10, rule 8: a refusal, a notice or an answer says nothing about a project its reader cannot open
      NamesOnlyReadable: namesOnlyReadable,
    },
    leadsTo: {
      // Rule 5: "Undo that" always ends, undone or refused with a reason
      UndoSettles: [0, 1].map((i) => ({
        label: `job ${i + 1}`,
        P: (s) => !!s.jobs[i] && !JOB_FINAL.includes(s.jobs[i].st),
        Q: (s) => JOB_FINAL.includes(s.jobs[i]?.st),
      })),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// M31. Vocabulary change (Ask)

const CHANGES = {
  pG: { proj: 'GQ', alias: true, asker: 'kemar' }, // "GQ also means the Academy"
  pS: { proj: 'SI', alias: true, asker: 'atlas', for: 'kemar' }, // CD14: two moves of "Academy" to SI
  pT: { proj: 'GQ', tie: 'dwayne', asker: 'kemar' }, // UN8: "Dwayne is on GQ"
};
const IDS = Object.keys(CHANGES);
const VOCAB_DRAWN = ['none>proposed', 'none>refused', 'proposed>applied', 'proposed>declined', 'proposed>expired'];
const VOCAB_FINAL = ['applied', 'declined', 'expired', 'refused'];
const REMINDERS = 2; // S18: 2 working days, then weekly, inside vocabExpiryDays (14)
const INIT_ROLE = { kemar: { GQ: 'member', SI: 'member' }, alicia: { GQ: 'pm', SI: 'pm' }, dwayne: { HX: 'pm' } };

export function VocabularyChange({ Recheck = false, Bug = null } = {}) {
  const t0 = (s, by) => Object.assign(clone(s), { by });
  // UN9: the other projects already using "Academy". As written, any in the org; with the fix, only
  // those the person who will be told can open
  const clashes = (s, who, proj, scope) =>
    Object.keys(s.alias).filter((p) => p !== proj && s.alias[p] && (scope === 'org' || reads(s, who, p)));
  const askScope = Recheck && Bug !== 'orgWideClash' ? 'readable' : 'org';
  const isPM = (s, who, proj) => s.role[who]?.[proj] === 'pm';

  function open(t, p) {
    t.p[p] = { st: 'proposed', rem: 0, asks: 1 };
    // Planted bug roleAtAsk: who may approve is fixed when the proposal is made
    if (Bug === 'roleAtAsk') t.p[p].ok = Object.keys(t.role).filter((w) => isPM(t, w, CHANGES[p].proj));
    return [t];
  }

  return {
    name: `VocabularyChange (${Recheck ? 'with the fixes' : 'as written'}${Bug ? `, bug ${Bug}` : ''})`,
    init: () =>
      [false, true].map((hx) => ({
        role: clone(INIT_ROLE),
        alias: { GQ: false, SI: false, HX: hx },
        tied: { GQ: [] },
        p: Object.fromEntries(IDS.map((p) => [p, { st: 'none', rem: 0, asks: 0 }])),
        moves: 0,
        said: [],
        by: null,
      })),
    actions: [
      {
        // A person says the correction
        name: 'Corrects',
        params: ['pG', 'pT'].map((p) => [p]),
        step(s, p) {
          const c = CHANGES[p];
          const x = s.p[p];
          const t = t0(s, c.asker);
          if (x.st !== 'none') {
            if (Bug === 'reviveDeclined' && x.st === 'declined') return open(t, p);
            if (Bug === 'dupProposal' && x.st === 'proposed' && x.asks < 2) {
              t.p[p].asks++;
              return [t];
            }
            return []; // rule 6: said again, it changes nothing
          }
          const clash = c.alias ? clashes(s, c.asker, c.proj, askScope) : [];
          if (clash.length) {
            t.p[p].st = 'refused'; // UN9: refused before it is proposed
            say(t, c.asker, 'alias_taken', clash);
            return [t];
          }
          return open(t, p);
        },
      },
      {
        // UN10: Kemar moves an item about "Academy" from GQ to SI in review
        name: 'MovesInReview',
        params: [[]],
        step: (s) => (s.moves < 3 ? [Object.assign(t0(s, 'kemar'), { moves: s.moves + 1 })] : []),
      },
      {
        // CD14: after two moves of the same word, Atlas proposes it as a correction; never twice
        name: 'AtlasProposes',
        params: [[]],
        step(s) {
          if (s.p.pS.st !== 'none' || s.moves < 2) return [];
          const t = t0(s, 'atlas');
          if (Bug === 'atlasApplies') {
            t.p.pS.st = 'applied';
            t.alias.SI = true;
            return [t];
          }
          // A clash means Atlas does not propose it, and says nothing
          if (clashes(s, CHANGES.pS.for, 'SI', askScope).length) {
            t.p.pS.st = 'refused';
            return [t];
          }
          return open(t, 'pS');
        },
      },
      {
        // APPROVE: a PM or Lead of the project, checked now (rule 4)
        name: 'Approves',
        params: product(['alicia', 'dwayne'], IDS),
        step(s, by, p) {
          const c = CHANGES[p];
          const x = s.p[p];
          if (x.st !== 'proposed') return [];
          if (Bug === 'roleAtAsk' ? !x.ok.includes(by) : !isPM(s, by, c.proj)) return [];
          const t = t0(s, by);
          if (Recheck && c.alias && Bug !== 'noClashRecheck') {
            const clash = clashes(s, by, c.proj, 'readable');
            if (clash.length) {
              say(t, by, 'alias_taken', clash); // it stays proposed, to decline or let expire
              return [t];
            }
          }
          t.p[p].st = 'applied';
          if (c.alias) t.alias[c.proj] = true;
          if (c.tie) {
            // Rule 10: tying Dwayne to GQ's vocabulary changes nothing of Dwayne's
            t.tied[c.proj] = sortedAdd(t.tied[c.proj], c.tie);
            if (Bug === 'tieMakesMember') t.role[c.tie][c.proj] = 'member';
          }
          return [t];
        },
      },
      {
        name: 'Declines',
        params: product(['alicia', 'dwayne'], IDS),
        step(s, by, p) {
          if (s.p[p].st !== 'proposed' || !isPM(s, by, CHANGES[p].proj)) return [];
          const t = t0(s, by);
          t.p[p].st = 'declined';
          return [t];
        },
      },
      {
        name: 'Reminds',
        params: IDS.map((p) => [p]),
        fair: true,
        step(s, p) {
          if (s.p[p].st !== 'proposed' || s.p[p].rem >= REMINDERS) return [];
          const t = t0(s, 'timer');
          t.p[p].rem++;
          return [t];
        },
      },
      {
        // vocabExpiryDays pass after the reminders
        name: 'Expires',
        params: IDS.map((p) => [p]),
        fair: true,
        step(s, p) {
          const x = s.p[p];
          if (x.st !== 'proposed' || Bug === 'noExpiry') return [];
          if (x.rem < REMINDERS && Bug !== 'expireEarly') return [];
          const t = t0(s, 'timer');
          t.p[p].st = 'expired';
          return [t];
        },
      },
      {
        // M13: Alicia stops being PM of GQ; Kemar leaves SI
        name: 'RoleChanges',
        params: [['alicia', 'GQ'], ['kemar', 'SI']],
        step(s, who, proj) {
          if (!s.role[who][proj]) return [];
          const t = t0(s, 'org');
          if (who === 'alicia') {
            if (t.role.alicia.GQ !== 'pm') return [];
            t.role.alicia.GQ = 'member';
          } else delete t.role[who][proj];
          return [t];
        },
      },
    ],
    invariants: {
      // Why UN9 refuses a clash: no one's routing finds "Academy" on two of their projects
      AliasClearForEveryReader: (s) => Object.keys(s.role).every((w) => readable(s, w).filter((p) => s.alias[p]).length <= 1),
      // Rule 6: the same correction makes one proposal
      OneProposalPerChange: (s) => IDS.every((p) => s.p[p].asks <= 1),
      // Rule 10: words about Dwayne put him on no project
      WordsChangeNoOnesMembership: (s) => Object.keys(s.role).every((w) => readable(s, w).every((p) => INIT_ROLE[w][p])),
    },
    actionProperties: {
      OnlyDrawnArrows: (s, t) => IDS.every((p) => s.p[p].st === t.p[p].st || VOCAB_DRAWN.includes(`${s.p[p].st}>${t.p[p].st}`)),
      // Rule 4: the approver is the project's PM or Lead when APPROVE runs
      ApproverHeldRightThen: (s, t) =>
        IDS.every((p) => !(s.p[p].st === 'proposed' && t.p[p].st === 'applied') || isPM(s, t.by, CHANGES[p].proj)),
      // Rule 1: Atlas asks; nothing Atlas does changes the vocabulary or anyone's role
      AtlasNeverChangesARecord: (s, t) =>
        t.by !== 'atlas' || JSON.stringify([s.alias, s.tied, s.role]) === JSON.stringify([t.alias, t.tied, t.role]),
      // S18: never expires without the reminders first
      ReminderBeforeExpiry: (s, t) => IDS.every((p) => !(s.p[p].st === 'proposed' && t.p[p].st === 'expired') || s.p[p].rem === REMINDERS),
      // P10: a refusal never names, counts or hints at a project its reader cannot open
      NamesOnlyReadable: namesOnlyReadable,
    },
    leadsTo: {
      // Rule 5: a proposal always ends, approved, declined or expired
      ProposalSettles: IDS.map((p) => ({ label: p, P: (s) => s.p[p].st === 'proposed', Q: (s) => VOCAB_FINAL.includes(s.p[p].st) })),
    },
  };
}
