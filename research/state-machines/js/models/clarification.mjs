// M21 Clarification (use-cases/atlas-conversational-plan.md, section 6, phase D; edge cases CL1 to CL8).
// When Atlas is unsure which record or project an item of an update means, DPM asks the author in the
// chat ("#151 or #152?") with the options as buttons, instead of only leaving a card in review.
//   (none) --CHECKS_DONE [an item is choose_project, or has 2 or 3 close matches]--> asked
//   asked --ANSWERED(option)--> resolved           the item is routed or matched; review shows it as chosen
//   asked --ANSWERED(not an option)--> asked       the reply is read as a new message (CL1, CL2)
//   asked --REVIEW_OPENED--> handed_to_review      the review card holds the choice (CL3)
//   asked --TIMER clarify_expiry (2 hours)--> handed_to_review
//   asked --capture expires or is rejected--> closed (CL6)
// It lives inside the capture's review (M2 proposed). At most one question per capture, about the first
// unsure item (CD23); at most three options, each one the author can see and the checks would accept.
//
// The world is the seed (app/src/db/seed/snapshot.ts): Kemar is a member of Forager, Store Insights and
// GQ; Alicia is PM of Forager and GQ; Jodian is a member of Forager and owns #160; Andre is PM of Store
// Insights. Sante is a project Kemar is not in (Andre's, as in routing.mjs): the outsider's record.
// Atlas's candidates are untrusted: the model checks what DPM does with whatever Atlas says.
//
// Three places the plan leaves open are settings, each with the reading that fails and the fix:
//   AskIn: 'source' asks in the chat the message came from, a project group once phase I is built;
//          'own' asks in the author's own chat, where phase I sends their review.
//   Second: 'command' makes the second message a chat command (phase B, AC6 and AC7: "Mark the store
//          feed one done" over an answer with two lines). It has no review card, so handing it to review
//          leaves nobody holding the choice; CommandTimerCloses closes it instead.
//   FourProjects: Kemar is in a fourth project, so a choose_project item can have four candidates,
//          which the guard lets through; ProjectCap asks only with 2 or 3, as for matches.
import { clone, subsets } from '../lib.mjs';

// Who is in each project. Only Kemar's memberships change (he can leave Forager or Store Insights).
const MEMBERS = {
  forager: ['alicia', 'jodian', 'kemar'],
  insights: ['andre', 'kemar'],
  gq: ['alicia', 'kemar'],
  sante: ['andre'],
  retail: ['kemar'], // only with FourProjects
};
const RECORDS = {
  w151: { project: 'forager', owner: 'kemar' }, // #151 Store sales feed access
  w152: { project: 'forager', owner: 'kemar' }, // #152 Store feed connector (Alicia may cancel it, CL5)
  w160: { project: 'forager', owner: 'jodian' }, // #160 Feature store backfill, Jodian's work
  w208: { project: 'insights', owner: 'kemar' }, // #208 Weekly sales export
  s1: { project: 'sante', owner: 'andre' }, // a Sante record Kemar cannot read
};
const isRecord = (o) => o in RECORDS;
const projectOf = (o) => (isRecord(o) ? RECORDS[o].project : o);
const DONE_ABLE = ['w151', 'w152', 'w160', 'w208'];

const FINAL_Q = ['resolved', 'handed_to_review', 'closed'];
// The drawn arrows: M21 as above, and the M2 states a clarification lives in
const Q_ARROWS = ['none>asked', 'asked>resolved', 'asked>handed_to_review', 'asked>closed'];
const CAP_ARROWS = ['reading>proposed', 'reading>no_review', 'proposed>reviewing', 'proposed>rejected', 'reviewing>rejected', 'proposed>expired', 'reviewing>expired', 'reviewing>saved'];

export default function Clarification({
  Source = 'dm',
  AskIn = 'own',
  Second = null,
  CommandTimerCloses = false,
  FourProjects = false,
  ProjectCap = false,
  Bug = null,
} = {}) {
  // c1: "Finished the feed work. Sales export is late." from Source, with every candidate Atlas might name.
  // With a Second message (c2, later, in his own chat) c1 is cut to its first item and fewer candidates,
  // so that two messages fit in the check: Second 'update' is CL4, 'command' is phase B's AC6 and AC7.
  const CAPS = Second
    ? {
        c1: { source: Source, items: { i1: { kind: 'match', pool: ['w151', 'w152', 'w208'] } } },
        c2:
          Second === 'command'
            ? { source: 'dm', command: true, items: { i1: { kind: 'match', pool: ['w151', 'w152'] } } }
            : { source: 'dm', items: { i1: { kind: 'match', pool: ['w151', 'w208'] } } },
      }
    : {
        c1: {
          source: Source,
          items: {
            i1: { kind: 'match', pool: ['w151', 'w152', 'w160', 'w208', 's1'] },
            i2: { kind: 'route', pool: ['forager', 'insights', 'gq', 'sante', ...(FourProjects ? ['retail'] : [])] },
          },
        },
      };
  const CAP_IDS = Object.keys(CAPS);
  const OPTIONS = [...Object.keys(RECORDS), ...Object.keys(MEMBERS)];

  // Rule 4: an option can be acted on only while Kemar still reads it and the checks would accept it
  const valid = (s, o) => s.member.includes(projectOf(o)) && !s.cancelled.includes(o);
  const sees = (s, who, o) => (who === 'kemar' ? s.member.includes(projectOf(o)) : MEMBERS[projectOf(o)].includes(who));
  // Who reads the question: Kemar alone in his own chat; every member now in a group (rule 8)
  const readers = (s, c) =>
    AskIn === 'source' && CAPS[c].source !== 'dm'
      ? MEMBERS[CAPS[c].source].filter((p) => p !== 'kemar' || s.member.includes(CAPS[c].source))
      : ['kemar'];

  // Section 6: the guard on CHECKS_DONE
  const needsAsking = (c, i, item) => {
    if (item.pick !== null) return false;
    const n = item.opts.length;
    if (CAPS[c].items[i].kind === 'route') return n >= 2 && (!ProjectCap || n <= 3);
    return n >= 2 && (n <= 3 || Bug === 'noCap');
  };
  // CHECKS_DONE: ask about the first unsure item (CD23); none otherwise
  const checksDone = (t, c) => {
    const cap = t.caps[c];
    const i = Object.keys(cap.items).find((k) => needsAsking(c, k, cap.items[k]));
    if (!i) return false;
    cap.q = { st: 'asked', item: i, options: [...cap.items[i].opts], chosen: null, n: cap.q.n + 1 };
    return true;
  };

  // M4, rule 10: Kemar's word changes his own records; another person's is asked of them
  const apply = (t, o) => {
    if (!isRecord(o)) return; // a routed item files the quote; no record changes
    if (RECORDS[o].owner === 'kemar' || Bug === 'applyOthers') t.recs[o] = true;
    else if (t.asks[o] === 'none') t.asks[o] = 'open';
  };

  // ANSWERED(option), by a button (it carries the capture id) or typed (CL4: the newest question)
  const answer = (s, c, o) => {
    const q = s.caps[c].q;
    const from = Bug === 'reanswer' ? ['asked', 'resolved'] : Bug === 'tapAfterReview' ? ['asked', 'handed_to_review'] : ['asked'];
    if (!from.includes(q.st) || !q.options.includes(o) || q.chosen === o) return [];
    // CL5: an option they can no longer read, or one cancelled since, is refused; the others still work
    if (Bug !== 'noRecheck' && !valid(s, o)) return [];
    const t = clone(s);
    const cap = t.caps[c];
    Object.assign(cap.q, { st: 'resolved', chosen: o });
    cap.items[q.item].pick = o;
    if (CAPS[c].command) cap.cmd = 'proposed'; // phase B: the one-tap confirm card (M20) takes it from here
    if (Bug === 'answerApplies') apply(t, o);
    return [t];
  };

  const inReview = (s, c) => ['proposed', 'reviewing'].includes(s.caps[c].st);

  return {
    name: `Clarification (${[`AskIn = ${AskIn}`, Source !== 'dm' && `from ${Source}`, Second && `second message ${Second}${CommandTimerCloses ? ', timer closes' : ''}`, FourProjects && `four projects${ProjectCap ? ', capped' : ''}`, Bug && `bug ${Bug}`].filter(Boolean).join(', ')})`,
    init: () => [
      {
        member: ['forager', 'gq', 'insights', ...(FourProjects ? ['retail'] : [])],
        cancelled: [],
        recs: Object.fromEntries(DONE_ABLE.map((r) => [r, false])),
        asks: { w160: 'none' },
        caps: Object.fromEntries(
          CAP_IDS.map((c) => [
            c,
            {
              st: 'reading',
              items: Object.fromEntries(Object.keys(CAPS[c].items).map((i) => [i, { opts: [], pick: null }])),
              q: { st: 'none', item: null, options: [], chosen: null, n: 0 },
              ...(CAPS[c].command ? { cmd: 'none' } : {}),
            },
          ]),
        ),
      },
    ],
    actions: [
      {
        // PROPOSALS_READY with whatever candidates Atlas names, then CHECKS_DONE in the same job step
        name: 'AtlasReads',
        params: CAP_IDS.map((c) => [c]),
        step(s, c) {
          if (s.caps[c].st !== 'reading') return [];
          const spec = CAPS[c].items;
          const ids = Object.keys(spec);
          let outs = [clone(s)];
          for (const i of ids) {
            const next = [];
            for (const t of outs) {
              for (const raw of subsets(spec[i].pool)) {
                const u = clone(t);
                // Check 9: only what Kemar can read and the checks accept (planted bug trustAtlas: Atlas's list as is)
                const opts = Bug === 'trustAtlas' ? raw : raw.filter((o) => valid(s, o));
                const none = spec[i].kind === 'route' ? 'not_filed' : 'new';
                u.caps[c].items[i] = { opts, pick: opts.length === 0 ? none : opts.length === 1 ? opts[0] : null };
                next.push(u);
              }
            }
            outs = next;
          }
          return outs.map((t) => {
            t.caps[c].st = CAPS[c].command ? 'no_review' : 'proposed';
            checksDone(t, c);
            return t;
          });
        },
      },
      {
        // The job retries after a crash, or CHECKS_DONE is delivered twice (rule 6)
        name: 'ChecksRedelivered',
        params: CAP_IDS.map((c) => [c]),
        step(s, c) {
          const q = s.caps[c].q;
          if (s.caps[c].st === 'reading') return [];
          // Planted bug askTwice: the question is sent again while it is still open
          const from = Bug === 'askTwice' ? ['none', 'asked'] : ['none'];
          if (!from.includes(q.st) || q.n >= 2) return [];
          const t = clone(s);
          return checksDone(t, c) ? [t] : [];
        },
      },
      {
        name: 'Taps',
        params: CAP_IDS.flatMap((c) => OPTIONS.map((o) => [c, o])),
        step: (s, c, o) => answer(s, c, o),
      },
      {
        // CL2, CL4: typed words are read against the newest open question's options only. Words that
        // match none leave the question as it is and are read as a new message (not modelled further).
        name: 'Types',
        params: OPTIONS.map((o) => [o]),
        step(s, o) {
          const c = [...CAP_IDS].reverse().find((k) => s.caps[k].q.st === 'asked');
          return c ? answer(s, c, o) : [];
        },
      },
      {
        // M2 OPEN_REVIEW, which is REVIEW_OPENED here (CL3)
        name: 'OpensReview',
        params: CAP_IDS.map((c) => [c]),
        step(s, c) {
          if (s.caps[c].st !== 'proposed') return [];
          const t = clone(s);
          t.caps[c].st = 'reviewing';
          // Planted bug noHandOver: the chat question stays open beside the review
          if (t.caps[c].q.st === 'asked' && Bug !== 'noHandOver') t.caps[c].q.st = 'handed_to_review';
          return [t];
        },
      },
      {
        // TIMER clarify_expiry, 2 hours (CD2)
        name: 'ClarifyTimer',
        params: CAP_IDS.map((c) => [c]),
        fair: true,
        step(s, c) {
          if (s.caps[c].q.st !== 'asked' || Bug === 'noTimer') return [];
          const t = clone(s);
          // A command has no review card to hand the choice to (finding); the fix closes it
          t.caps[c].q.st = CommandTimerCloses && s.caps[c].st === 'no_review' ? 'closed' : 'handed_to_review';
          return [t];
        },
      },
      {
        // M2 DISCARD by the author
        name: 'Discards',
        params: CAP_IDS.map((c) => [c]),
        step(s, c) {
          if (!inReview(s, c)) return [];
          const t = clone(s);
          t.caps[c].st = 'rejected';
          if (t.caps[c].q.st === 'asked') t.caps[c].q.st = 'closed';
          return [t];
        },
      },
      {
        // M2 TIMER review_expiry, 7 days (CL6). A question's 2 hour timer started earlier and always
        // fires first, so the capture never expires while its question is open: only DISCARD reaches closed.
        name: 'ReviewExpires',
        params: CAP_IDS.map((c) => [c]),
        fair: true,
        step(s, c) {
          if (!inReview(s, c) || s.caps[c].q.st === 'asked') return [];
          const t = clone(s);
          t.caps[c].st = 'expired';
          return [t];
        },
      },
      {
        // M14, M16 on the review page: Kemar picks a project or an entry for an item
        name: 'PicksInReview',
        params: CAP_IDS.flatMap((c) => Object.keys(CAPS[c].items).map((i) => [c, i])),
        step(s, c, i) {
          if (s.caps[c].st !== 'reviewing') return [];
          const item = s.caps[c].items[i];
          return item.opts
            .filter((o) => o !== item.pick && valid(s, o))
            .map((o) => {
              const t = clone(s);
              t.caps[c].items[i].pick = o;
              return t;
            });
        },
      },
      {
        // M2 SAVE: nothing left to choose, and every pick still allowed when it runs (rule 7)
        name: 'Saves',
        params: CAP_IDS.map((c) => [c]),
        step(s, c) {
          const cap = s.caps[c];
          if (cap.st !== 'reviewing') return [];
          const picks = Object.values(cap.items).map((i) => i.pick);
          if (picks.some((p) => p === null || (p !== 'new' && p !== 'not_filed' && !valid(s, p)))) return [];
          const t = clone(s);
          t.caps[c].st = 'saved';
          for (const p of picks) apply(t, p);
          return [t];
        },
      },
      {
        // Jodian confirms what Kemar said about #160 (rule 10, as S5 does for milestones)
        name: 'OwnerConfirms',
        params: [['w160']],
        step(s, r) {
          if (s.asks[r] !== 'open') return [];
          const t = clone(s);
          t.asks[r] = 'confirmed';
          t.recs[r] = true;
          return [t];
        },
      },
      {
        name: 'OwnerDeclines',
        params: [['w160']],
        step(s, r) {
          if (s.asks[r] !== 'open') return [];
          const t = clone(s);
          t.asks[r] = 'declined';
          return [t];
        },
      },
      {
        // M13: Kemar leaves a project after the question was asked (CL5)
        name: 'KemarLeaves',
        params: [['forager'], ['insights']],
        step(s, p) {
          if (!s.member.includes(p)) return [];
          const t = clone(s);
          t.member = s.member.filter((x) => x !== p);
          return [t];
        },
      },
      {
        // M5 any -> cancelled: Alicia cancels #152 (CL5)
        name: 'AliciaCancels',
        params: [['w152']],
        step(s, r) {
          if (s.cancelled.includes(r)) return [];
          const t = clone(s);
          t.cancelled = [...s.cancelled, r];
          return [t];
        },
      },
    ],
    invariants: {
      TypeOK: (s) =>
        CAP_IDS.every((c) => ['none', 'asked', ...FINAL_Q].includes(s.caps[c].q.st)) &&
        CAP_IDS.every((c) => s.caps[c].q.st === 'none' || s.caps[c].q.options.length >= 2),
      // Section 6: at most three options
      AtMostThreeOptions: (s) => CAP_IDS.every((c) => s.caps[c].q.options.length <= 3),
      // Section 6, rule 6: at most one clarification per capture, however often CHECKS_DONE arrives
      OneQuestionPerCapture: (s) => CAP_IDS.every((c) => s.caps[c].q.n <= 1),
      // Section 6: it lives inside the capture's review (M2 proposed), never beside an open review
      AskedOnlyWhileProposed: (s) => CAP_IDS.every((c) => s.caps[c].q.st !== 'asked' || ['proposed', 'no_review'].includes(s.caps[c].st)),
      // "The review card holds the choice": handed over only where there is a review card
      HandedOnlyToAReview: (s) => CAP_IDS.every((c) => s.caps[c].q.st !== 'handed_to_review' || s.caps[c].st !== 'no_review'),
    },
    actionProperties: {
      // Rule 2: the question and the capture move only along drawn arrows
      OnlyDrawnArrows: (s, t) =>
        CAP_IDS.every((c) => {
          const [a, b] = [s.caps[c], t.caps[c]];
          return (a.q.st === b.q.st || Q_ARROWS.includes(`${a.q.st}>${b.q.st}`)) && (a.st === b.st || CAP_ARROWS.includes(`${a.st}>${b.st}`));
        }),
      // Rule 6: once answered, handed over or closed, a repeated tap or event changes nothing in it
      AnsweredOnce: (s, t) => CAP_IDS.every((c) => !FINAL_Q.includes(s.caps[c].q.st) || JSON.stringify(s.caps[c].q) === JSON.stringify(t.caps[c].q)),
      // Rule 4, CL5: an answer is taken only if the option is still allowed when it runs
      AnswerRechecked: (s, t) => CAP_IDS.every((c) => s.caps[c].q.chosen === t.caps[c].q.chosen || valid(s, t.caps[c].q.chosen)),
      // Rules 3 and 8 (P10): every option, when asked, is something every reader of the chat may see now,
      // and the checks would accept; nothing from a project they cannot read is named
      OptionsOnlyWhatTheyMaySee: (s, t) =>
        CAP_IDS.every(
          (c) =>
            t.caps[c].q.n === s.caps[c].q.n ||
            t.caps[c].q.options.every((o) => !s.cancelled.includes(o) && readers(s, c).every((p) => sees(s, p, o))),
        ),
      // Rule 1: Atlas asks, people answer. A record changes only when the author saves the review,
      // or the record's owner confirms; never on an answer in the chat
      RecordsChangeOnlyOnSave: (s, t) =>
        DONE_ABLE.every((r) => s.recs[r] === t.recs[r]) ||
        CAP_IDS.some((c) => s.caps[c].st === 'reviewing' && t.caps[c].st === 'saved') ||
        Object.keys(s.asks).some((r) => s.asks[r] === 'open' && t.asks[r] === 'confirmed'),
      // Rule 10: what Kemar says about Jodian's #160 changes nothing of hers until she confirms
      OthersRecordsWaitForThem: (s, t) =>
        DONE_ABLE.filter((r) => RECORDS[r].owner !== 'kemar').every(
          (r) => s.recs[r] === t.recs[r] || (s.asks[r] === 'open' && t.asks[r] === 'confirmed'),
        ),
    },
    leadsTo: {
      // Rule 5: an open question always ends (answered, handed to review, or closed)
      QuestionEnds: CAP_IDS.map((c) => ({ label: c, P: (s) => s.caps[c].q.st === 'asked', Q: (s) => s.caps[c].q.st !== 'asked' })),
    },
  };
}
