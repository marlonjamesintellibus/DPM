// M32 Outbound ask (use-cases/atlas-conversational-plan.md, section 15, phase M; CH1 to CH10).
// "Ask Kyle if the feed access is sorted." Kemar (a member) or Alicia (the PM) asks Atlas to chase
// someone about the Forager blocker "#151 blocked on Kyle". Kyle is a Forager contact (project_contacts);
// Dana is on Store Insights only, which neither asker can read; "nobody" is a name DPM does not know.
//   Atlas drafts from the asker's words and the record's title (CH7, CD15) and sends only after the
//   asker confirms (rule 9). The send job retries up to nudgeMaxTries with one message id (rule 6).
//   One reminder after chaseReminderWorkingDays, then the asker is told. Kyle's reply is a proposal in
//   the asker's review and changes nothing until the asker saves it (rule 1); nothing is saved as his (CH9).
//   Rights are rechecked when each step runs (rule 4): Kyle can stop being a contact, the asker can
//   leave Forager (CH10), and someone else can resolve the blocker (CH4).
// Timers and the send job are fair actions; people, Kyle and the world are not.
//
// With no Fixes the model takes the arrows of the section 15 table and nothing else; a transition not
// in the table is refused and changes nothing (machines doc, section 1, rule 2). Fixes adds what the
// check found missing, each on its own so a row can leave one out:
//   F1  reminded ──REPLY──▶ replied (CH3 expects it), and a reply to a chase that already ended is shown
//       to the asker as is, nothing proposed (it reached Kyle after a lost acknowledgement, or came late)
//   F2  sending, reminded ──CANCEL, the subject resolved elsewhere, the asker left──▶ closed (CH4, CH10),
//       and the send and the second timer recheck the subject and the asker when they run
//   F3  sending, waiting, reminded ──the asker can no longer reach them──▶ closed; the asker is told
import { clone, product } from '../lib.mjs';

const ASKERS = ['kemar', 'alicia'];
const OPEN = ['drafted', 'sending', 'waiting', 'reminded'];
// What Kyle may read: the asker's own words and the record's title (CH7, CD15). "forecast" stands for
// any other fact on #151 (its forecast, its owner's leave) that only Forager members may see.
const FOR_KYLE = ['title', 'words'];

const DRAWN = [
  'none>drafted',
  'drafted>sending',
  'drafted>cancelled',
  'sending>waiting',
  'sending>failed',
  'waiting>replied',
  'waiting>reminded',
  'waiting>closed',
  'reminded>unanswered',
];
const ADDED = { F1: ['reminded>replied'], F2: ['sending>closed', 'reminded>closed'], F3: ['sending>closed', 'reminded>closed'] };
export const ALL_FIXES = ['F1', 'F2', 'F3'];

export default function OutboundAsk({ Fixes = [], NudgeMaxTries = 3, Bug = null } = {}) {
  const has = (f) => Fixes.includes(f);
  const arrows = [...DRAWN, ...Fixes.flatMap((f) => ADDED[f])];
  // Who can be asked: people on a project the asker shares with them, and its contacts
  const reachable = (s) => s.to === 'kyle' && s.contact && s.member;
  const t0 = (s, by) => Object.assign(clone(s), { by });
  const tell = (t, what) => {
    if (!t.said.includes(what)) t.said = [...t.said, what].sort();
  };
  const deliver = (t, which) => {
    t.got[which] += 1;
    if (which === 'ask') t.sent = [...t.draft];
  };
  const close = (t) => {
    t.st = 'closed';
    tell(t, 'closed');
    return [t];
  };

  return {
    name: `OutboundAsk (${Fixes.length ? Fixes.join(', ') : 'as written'}${Bug ? `, bug ${Bug}` : ''})`,
    init: () =>
      product(ASKERS, ['kyle', 'dana', 'nobody'], [null, 'b151', 'ins']).map(([asker, to, other]) => ({
        st: 'none',
        asker,
        to,
        // An earlier chase to Kyle by Andre: about #151, or about Store Insights (CH5)
        other,
        member: true,
        contact: true,
        subject: 'open',
        // What Atlas said to the asker, and the draft the asker sees
        said: [],
        draft: [],
        confirmedBy: null,
        tries: 0,
        // What reached Kyle: how many of each message, and the text of the ask
        got: { ask: 0, reminder: 0 },
        sent: [],
        reply: 'none',
        kind: null,
        // The asker's review, what was saved from it, and how many proposals replies made
        review: [],
        applied: [],
        proposed: 0,
        by: null,
      })),
    actions: [
      {
        // "Ask Kyle if the feed access is sorted" (CH1: anyone unreachable gets the words for an unknown name)
        name: 'Ask',
        params: [[]],
        step(s) {
          if (s.st !== 'none' || s.said.length) return [];
          const t = t0(s, s.asker);
          if (!reachable(s)) {
            tell(t, Bug === 'revealOutsider' && s.to === 'dana' ? 'notOnYourProjects' : 'cantReach');
            return [t];
          }
          t.st = 'drafted';
          t.draft = Bug === 'draftLeaks' ? [...FOR_KYLE, 'forecast'] : [...FOR_KYLE];
          tell(t, 'draft');
          // CH5: an earlier chase is mentioned only when it is about this record
          if (s.other === 'b151' || (Bug === 'matchByWords' && s.other)) tell(t, 'otherAsked');
          return [t];
        },
      },
      {
        // CONFIRM: the asker, and only the asker (rule 9), with the right rechecked (rule 4)
        name: 'Confirm',
        params: ASKERS.map((p) => [p]),
        step(s, by) {
          if (s.st !== 'drafted' || !reachable(s)) return [];
          if (by !== s.asker && !(Bug === 'pmConfirms' && by === 'alicia')) return [];
          return [Object.assign(t0(s, by), { st: 'sending', confirmedBy: by })];
        },
      },
      {
        name: 'Cancel',
        params: [[]],
        step(s) {
          const t = t0(s, s.asker);
          if (s.st === 'drafted') return [Object.assign(t, { st: 'cancelled' })];
          if (s.st === 'waiting' || (has('F2') && s.st === 'reminded')) return close(t);
          if (s.st === 'sending' && Bug === 'cancelWhileSending') return [Object.assign(t, { st: 'cancelled' })];
          return [];
        },
      },
      {
        // TIMER commandExpiryMinutes (CD2: 30 minutes)
        name: 'ExpiryTimer',
        params: [[]],
        fair: true,
        step: (s) => (s.st === 'drafted' ? [Object.assign(t0(s, 'atlas'), { st: 'cancelled' })] : []),
      },
      {
        // The send job: SENT, SEND_FAILED, or delivered with the acknowledgement lost. A retry carries
        // the same message id, so the Atlas app answers "already delivered" (rule 6)
        name: 'Send',
        params: [['ok'], ['fails'], ['ackLost']],
        fair: true,
        step(s, outcome) {
          if (s.st !== 'sending') return [];
          if (!reachable(s) && Bug !== 'noRecheckAtSend') return []; // rule 4; as written nothing leads out (F3)
          if (has('F2') && s.subject !== 'open') return []; // F2: closes instead
          const t = t0(s, 'atlas');
          if (outcome !== 'fails' && (s.got.ask === 0 || Bug === 'noMessageId')) deliver(t, 'ask');
          if (outcome === 'ok') return [Object.assign(t, { st: 'waiting' })];
          t.tries += 1;
          if (t.tries >= NudgeMaxTries) {
            t.st = 'failed';
            if (Bug !== 'silentFail') tell(t, 'failed');
          }
          return [t];
        },
      },
      {
        // TIMER chaseReminderWorkingDays: one reminder, never about a resolved subject (CH4)
        name: 'ReminderTimer',
        params: [[]],
        fair: true,
        step(s) {
          if (Bug === 'noReminderTimer' || s.st !== 'waiting' || !reachable(s)) return [];
          if (s.subject !== 'open' && Bug !== 'remindAfterResolved') return [];
          const t = t0(s, 'atlas');
          deliver(t, 'reminder');
          return [Object.assign(t, { st: 'reminded' })];
        },
      },
      {
        // The second TIMER: unanswered, and the dependency shows "Asked Kyle on Mon, no reply"
        name: 'UnansweredTimer',
        params: [[]],
        fair: true,
        step(s) {
          if (s.st !== 'reminded') return [];
          if (has('F2') && (s.subject !== 'open' || !s.member)) return []; // F2: closes instead
          const t = t0(s, 'atlas');
          t.st = 'unanswered';
          tell(t, 'noReply');
          return [t];
        },
      },
      {
        // Closed when the subject was resolved elsewhere (CH4) or the asker left (CH10). As written only
        // waiting has this arrow; F2 gives it to sending and reminded, and F3 adds losing reach
        name: 'Closes',
        params: [[]],
        fair: true,
        step(s) {
          const moot = s.subject !== 'open' || !s.member;
          const ends =
            (s.st === 'waiting' && moot) ||
            (has('F2') && ['sending', 'reminded'].includes(s.st) && moot) ||
            (has('F3') && ['sending', 'waiting', 'reminded'].includes(s.st) && !reachable(s));
          return ends ? close(t0(s, 'atlas')) : [];
        },
      },
      {
        // Kyle answers, says "Who is this?" (CH2), or writes about something else (CH9)
        name: 'KyleReplies',
        params: [['answer'], ['noAnswer'], ['other']],
        step(s, kind) {
          if (s.got.ask === 0 || s.reply !== 'none') return [];
          return [Object.assign(t0(s, 'kyle'), { reply: 'pending', kind })];
        },
      },
      {
        // REPLY: a proposal in the asker's review, as the asker's, with Kyle's words as context (rule 1, CH9)
        name: 'FileReply',
        params: [[]],
        fair: true,
        step(s) {
          if (s.reply !== 'pending') return [];
          const t = t0(s, 'atlas');
          if (s.st === 'waiting' || (has('F1') && s.st === 'reminded')) {
            Object.assign(t, { st: 'replied', reply: 'filed' });
            tell(t, 'reply');
            if (s.kind === 'answer') {
              if (Bug === 'autoApply') t.subject = 'resolved';
              else t.review = [...t.review, { kind: 'update', as: s.asker }];
            }
            if (s.kind === 'other') {
              if (Bug === 'saveAsReplier') t.applied = [...t.applied, { kind: 'capture', as: 'kyle' }];
              else t.review = [...t.review, { kind: 'capture', as: s.asker }];
            }
            if (s.kind !== 'noAnswer') t.proposed += 1;
            return [t];
          }
          // F1: a reply to an ended chase is shown as is; nothing is proposed and the state stays
          if (has('F1') && !OPEN.includes(s.st) && Bug !== 'dropLateReply') {
            t.reply = 'shown';
            tell(t, 'reply');
            return [t];
          }
          return [];
        },
      },
      {
        // The Atlas app delivers the same reply again; its id was seen, so nothing changes (rule 6)
        name: 'ReplyAgain',
        params: [[]],
        step(s) {
          // Planted bug noReplyDedup: proposes again (once more is enough, and keeps the model finite)
          if (s.reply !== 'filed' || s.kind === 'noAnswer' || Bug !== 'noReplyDedup' || s.proposed > 1) return [];
          const t = t0(s, 'atlas');
          t.review = [...t.review, { kind: s.kind === 'answer' ? 'update' : 'capture', as: s.asker }];
          t.proposed += 1;
          return [t];
        },
      },
      {
        // The asker saves the first proposal: the blocker resolves, or the capture is saved as theirs.
        // Rechecked at save (rule 4, E77): an asker who left Forager is refused
        name: 'Save',
        params: ASKERS.map((p) => [p]),
        step(s, by) {
          if (!s.review.length || by !== s.asker) return [];
          if (!s.member && Bug !== 'noRecheckAtSave') return [];
          const t = t0(s, by);
          const [item, ...rest] = s.review;
          if (item.kind === 'update') t.subject = 'resolved';
          t.review = rest;
          t.applied = [...t.applied, item];
          return [t];
        },
      },
      {
        name: 'Reject',
        params: [[]],
        step: (s) => (s.review.length ? [Object.assign(t0(s, s.asker), { review: s.review.slice(1) })] : []),
      },
      // The world: Jodian resolves the blocker, Alicia takes Kyle off the contacts, the asker leaves Forager
      { name: 'ResolvedElsewhere', params: [[]], step: (s) => (s.subject === 'open' ? [Object.assign(t0(s, 'jodian'), { subject: 'resolved' })] : []) },
      { name: 'ContactRemoved', params: [[]], step: (s) => (s.contact ? [Object.assign(t0(s, 'alicia'), { contact: false })] : []) },
      { name: 'AskerLeaves', params: [[]], step: (s) => (s.member ? [Object.assign(t0(s, s.asker), { member: false })] : []) },
    ],
    invariants: {
      TypeOK: (s) => [...OPEN, 'none', 'cancelled', 'failed', 'replied', 'unanswered', 'closed'].includes(s.st) && s.tries <= NudgeMaxTries,
      // Rule 6: one ask and one reminder reach Kyle, and one reply makes at most one proposal
      OnceOnly: (s) => s.got.ask <= 1 && s.got.reminder <= 1 && s.proposed <= 1,
      // Rule 9: nothing reaches Kyle that the asker did not confirm
      OutwardIsConfirmed: (s) => s.got.ask === 0 || s.confirmedBy === s.asker,
      // Rule 8, CH7: the draft and the message hold only the asker's words and the record's title
      EveryReaderMaySee: (s) => [...s.draft, ...s.sent].every((f) => FOR_KYLE.includes(f)),
      // P10, CH1, CH5: an outsider gets the words for an unknown name, and a chase on a project the
      // asker cannot read is never mentioned
      NothingHintedAboutHidden: (s) =>
        (s.to === 'kyle' || s.said.every((w) => w === 'cantReach')) && (!s.said.includes('otherAsked') || s.other === 'b151'),
      // Rule 10, CH9: what Kyle said is the asker's to save; nothing is saved as Kyle's
      YourWordChangesOnlyYours: (s) => [...s.review, ...s.applied].every((i) => i.as === s.asker),
      // The asker is told when a chase fails, goes unanswered or closes
      AskerIsTold: (s) =>
        (s.st !== 'failed' || s.said.includes('failed')) &&
        (s.st !== 'unanswered' || s.said.includes('noReply')) &&
        (s.st !== 'closed' || s.said.includes('closed')),
    },
    actionProperties: {
      // Rule 2: only the arrows of the table
      OnlyDrawnArrows: (s, t) => s.st === t.st || arrows.includes(`${s.st}>${t.st}`),
      // Rule 4: a message goes out, a confirm starts a send, and a save applies only with the right as it is then
      RightCheckedWhenItRuns: (s, t) =>
        (!(t.got.ask > s.got.ask || t.got.reminder > s.got.reminder || (s.st === 'drafted' && t.st === 'sending')) || reachable(s)) &&
        (!(t.applied.length > s.applied.length && t.by === s.asker) || s.member),
      // Rule 1: the blocker changes only by a person: the asker saving, or someone resolving it elsewhere
      AtlasNeverChangesRecord: (s, t) => s.subject === t.subject || !['atlas', 'kyle'].includes(t.by),
      // CH4, CH10: nothing reaches Kyle about a resolved subject, and nobody is told "no reply" about a
      // resolved subject or after leaving the project
      MootChaseCloses: (s, t) =>
        (!(t.got.ask > s.got.ask || t.got.reminder > s.got.reminder) || s.subject === 'open') &&
        (t.st !== 'unanswered' || s.st === 'unanswered' || (s.subject === 'open' && s.member)),
    },
    leadsTo: {
      // Rule 5: every waiting state has a timer or a named way out
      NothingGetsStuck: OPEN.map((x) => ({ label: x, P: (s) => s.st === x, Q: (s) => s.st !== x })),
      // A reply that reached DPM is filed, or at least shown to the asker (CH3)
      ReplyNotLost: [{ label: 'reply', P: (s) => s.reply === 'pending', Q: (s) => s.reply !== 'pending' }],
    },
  };
}
