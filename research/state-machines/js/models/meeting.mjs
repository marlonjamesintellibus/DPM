// Meetings (use-cases/atlas-conversational-plan.md, section 17, phase O): M33 Meeting capture and
// M34 Attributed item, with the edge cases MT1 to MT12 and the rules of section 1.
//   Kemar records a Forager meeting. Alicia is the PM; Andre is in DPM but not on Forager; Kyle is
//   the client contact, not in DPM. The note holds Kemar's own items, a promise Kyle made (MT1), a
//   decision Kemar made without the right to approve it (MT6), one thing about Alicia and one about
//   Andre. Atlas may be unsure who said the thing about Alicia (MT2).
//   The recorder confirms the attendees, and that they knew it was recorded, before anything is read
//   (MT4). Kemar's items go to his review (M3), each thing about an attendee goes to them as an M34 Ask
//   (rule 10), and the decision goes to the deciders as an M15 proposal. Alicia may go on leave (MT12),
//   lose the PM role, or leave the project at any time. The thing about Alicia may be a change to a record
//   of hers (an update), and that record may be given to someone else at any time.
//
// Design 'as_written' takes the arrows exactly as section 17 draws them. Design 'fixed' adds the
// smallest change for each place the checker found the drawing breaks a rule:
//   ownNotes         MT4, CD17: received -> transcribing as the recorder's own notes when they were not told
//   holdUnsure       MT2: an unsure speaker waits in the recorder's review until they fix it
//   reviewDecisions  machines doc rule 8: a decision is confirmed accurate in the recorder's review
//                    before it reaches the deciders, as with any capture (M3, then M15 REPORT)
//   sendToMembers    rule 3 (P10): an ask goes only to a member of the item's project; anyone else's
//                    item goes to the recorder, as MT1 does for people not in DPM
//   withdrawOnLeave  rule 3, E77: leaving the project withdraws that person's open asks there
//   pauseOnLeave     MT12: the attributedExpiryDays timer does not run while the person is on leave
//   ownerAtConfirm   rules 4 and 10 (added by the fix check of 28 Oct): an update is confirmed only by the
//                    record's owner now; once the record is someone else's the ask is withdrawn, so the
//                    person it first went to never changes another person's record
// A Bug named after a fix turns that fix off, so each property is shown to catch something.
import { clone, product } from '../lib.mjs';

const RECORDER = 'kemar';
const PEOPLE = ['kemar', 'alicia', 'andre'];
// M34 items: the thing said about Alicia (a) and the thing said about Andre (n)
const ITEMS = ['a', 'n'];
const PERSON = { a: 'alicia', n: 'andre' };

const JOB_WAITING = ['received', 'transcribing', 'reading', 'split'];
const ASK_OPEN = ['held', 'waiting', 'proposed'];
const ASK_FINAL = ['confirmed', 'declined', 'expired', 'mine', 'withdrawn'];
const OWN_FINAL = ['saved', 'rejected', 'expired'];
// A decision part is settled once it is on the log as a proposal: M15 has no timer that decides it
const DEC_SETTLED = ['proposed', 'approved', 'declined', 'rejected', 'expired'];
const SENT = ['proposed', 'approved', 'declined'];

const FIXES = ['ownNotes', 'holdUnsure', 'reviewDecisions', 'sendToMembers', 'withdrawOnLeave', 'pauseOnLeave', 'ownerAtConfirm'];
const FIX_BUG = {
  ownNotes: 'noOwnNotes',
  holdUnsure: 'sendOnGuess',
  reviewDecisions: 'decisionStraightToDeciders',
  sendToMembers: 'askOutsider',
  withdrawOnLeave: 'noWithdrawOnLeave',
  pauseOnLeave: 'timerOnLeave',
  ownerAtConfirm: 'ownerAtAsk',
};

// The drawn arrows, as from>to. Section 17 first, then what each fix adds. "transcribing ... (as M2)":
// M2 can fail while transcribing a voice note as well as while reading it.
const ARROWS = {
  job: ['received>transcribing', 'transcribing>reading', 'reading>split', 'transcribing>failed', 'reading>failed', 'split>done', 'received>expired'],
  own: ['none>review', 'review>saved', 'review>rejected', 'review>expired'],
  dec: ['none>proposed', 'proposed>approved', 'proposed>declined'],
  ask: ['none>proposed', 'none>waiting', 'waiting>proposed', 'proposed>confirmed', 'proposed>declined', 'proposed>expired'],
};
const DEC_REVIEW = ['none>review', 'review>proposed', 'review>rejected', 'review>expired'];
const ADDS = {
  ownNotes: { dec: DEC_REVIEW, ask: ['none>mine'] },
  holdUnsure: { ask: ['none>held', 'held>proposed', 'held>waiting', 'held>mine', 'held>expired', 'held>withdrawn'] },
  reviewDecisions: { dec: DEC_REVIEW },
  sendToMembers: { ask: ['none>mine'] },
  withdrawOnLeave: { ask: ['proposed>withdrawn', 'waiting>withdrawn'] },
  pauseOnLeave: {},
  ownerAtConfirm: { ask: ['proposed>withdrawn', 'waiting>withdrawn'] },
};

export default function Meeting({ Design = 'as_written', Bug = null } = {}) {
  const fix = Object.fromEntries(FIXES.map((f) => [f, Design === 'fixed' && Bug !== FIX_BUG[f]]));
  const drawn = {};
  for (const m of Object.keys(ARROWS)) {
    drawn[m] = new Set([...ARROWS[m], ...FIXES.filter((f) => fix[f]).flatMap((f) => ADDS[f][m] ?? [])]);
  }
  // With every decision reviewed, none -> proposed is no longer drawn
  if (fix.reviewDecisions) drawn.dec.delete('none>proposed');

  const t0 = (s, by) => Object.assign(clone(s), { by });
  // M13: Kemar stays a member; Alicia until she leaves; Andre is not on Forager
  const member = (s, p) => p === RECORDER || (p === 'alicia' && s.alicia.role !== 'gone');
  const away = (s, p) => p === 'alicia' && s.alicia.leave === 'away';
  const isPm = (s, p) => p === 'alicia' && s.alicia.role === 'pm';

  // Where an item about someone goes once its speaker is settled (split, or the recorder fixing it)
  const deliver = (t, x) => {
    const p = PERSON[x];
    if (fix.sendToMembers && !member(t, p)) t[x].st = 'mine'; // as MT1: a dependency proposed to the recorder
    else if (away(t, p)) t[x].st = 'waiting'; // MT12: waits until they are back
    else t[x].st = 'proposed';
  };
  const decisionProposed = (t) => Object.assign(t.dec, { st: 'proposed', pmAtAsk: t.alicia.role === 'pm' });

  // MT4, CD17: the recorder says the attendees were not told; the note is read as their own notes only
  const ownNotesOnly = (s) => {
    if (!fix.ownNotes || s.job !== 'received') return [];
    return [Object.assign(t0(s, RECORDER), { job: 'transcribing', mode: 'own' })];
  };

  return {
    name: `Meeting (${Design}${Bug ? `, bug ${Bug}` : ''})`,
    init: () =>
      [true, false].map((told) => ({
        job: 'received',
        mode: null, // 'meeting' or 'own'
        told, // the attendees knew it was recorded
        sure: null, // Atlas is sure who said the thing about Alicia (set when it reads)
        own: 'none', // the recorder's review (M3), with Kyle's promise as a dependency (MT1)
        dec: { st: 'none', pmAtAsk: false },
        a: { st: 'none', worded: false, fixed: false, recorderTold: false },
        n: { st: 'none', worded: false, fixed: false, recorderTold: false },
        alicia: { role: 'pm', leave: 'in', owns: true }, // owns: the record the thing about her changes
        filed: { own: 0, a: 0, n: 0, kyle: 0, dec: 0 },
        by: null,
      })),
    actions: [
      {
        // ATTENDEES_CONFIRMED: the recorder confirms who was there, and that they knew it was recorded
        name: 'ConfirmAttendees',
        params: [[]],
        step(s) {
          if (s.job !== 'received' || !s.told) return [];
          return [Object.assign(t0(s, RECORDER), { job: 'transcribing', mode: 'meeting' })];
        },
      },
      { name: 'OwnNotesOnly', params: [[]], step: ownNotesOnly },
      {
        // TIMER reviewExpiryDays: the attendees were never confirmed
        name: 'ReceivedExpires',
        params: [[]],
        fair: true,
        step: (s) => (s.job === 'received' ? [Object.assign(t0(s, 'timer'), { job: 'expired' })] : []),
      },
      {
        name: 'Transcribed',
        params: [[]],
        fair: true,
        step: (s) => (s.job === 'transcribing' ? [Object.assign(t0(s, 'atlas'), { job: 'reading' })] : []),
      },
      {
        // As M2: transcribing or reading fails after its retries
        name: 'ReadFails',
        params: [[]],
        step: (s) => (['transcribing', 'reading'].includes(s.job) ? [Object.assign(t0(s, 'atlas'), { job: 'failed' })] : []),
      },
      {
        // PROPOSALS_READY, then the split. Atlas may or may not be sure who said the thing about Alicia.
        name: 'ProposalsReady',
        params: [[true], [false]],
        fair: true,
        step(s, sure) {
          if (s.job !== 'reading') return [];
          const t = Object.assign(t0(s, 'atlas'), { job: 'split', sure, own: 'review' });
          // MT1: Kyle is not in DPM; his promise is a dependency in the recorder's review, never his
          if (Bug === 'fileKyle') t.filed.kyle += 1;
          if (s.mode === 'own') {
            // CD17: nothing goes to anyone else; the decision is reviewed as in any capture
            t.dec.st = 'review';
            for (const x of ITEMS) t[x].st = 'mine';
            return [t];
          }
          if (Bug === 'approveByText') {
            // "We agreed" in the meeting is taken as the approval
            t.dec.st = 'approved';
            t.filed.dec += 1;
          } else if (fix.reviewDecisions) t.dec.st = 'review';
          else decisionProposed(t); // as drawn: decisions go straight to the deciders
          for (const x of ITEMS) {
            if (x === 'a' && !sure && fix.holdUnsure) t[x].st = 'held';
            else deliver(t, x);
          }
          return [t];
        },
      },
      {
        // MT2: the recorder fixes who said it, in review, before it goes to anyone
        name: 'FixSpeaker',
        params: [[]],
        step(s) {
          if (s.a.st !== 'held' || s.own !== 'review') return [];
          const t = t0(s, RECORDER);
          t.a.fixed = true;
          deliver(t, 'a');
          return [t];
        },
      },
      {
        // M2 SAVE by the recorder: their items, Kyle's dependency, and the decision if they keep it
        name: 'RecorderSaves',
        params: [['keep'], ['drop']],
        step(s, decision) {
          if (s.own !== 'review' || s.a.st === 'held') return [];
          if (s.dec.st !== 'review' && decision === 'drop') return [];
          const t = t0(s, RECORDER);
          t.own = 'saved';
          t.filed.own += 1;
          if (s.dec.st === 'review') {
            if (decision === 'keep') decisionProposed(t); // M15 REPORT, for the speaker
            else t.dec.st = 'rejected';
          }
          // Planted bug recorderConfirms: the recorder's Save files what was said about Alicia too
          if (Bug === 'recorderConfirms' && s.a.st === 'proposed') {
            t.a.st = 'confirmed';
            t.filed.a += 1;
          }
          return [t];
        },
      },
      {
        name: 'RecorderDiscards',
        params: [[]],
        step(s) {
          if (s.own !== 'review') return [];
          const t = t0(s, RECORDER);
          t.own = 'rejected';
          if (s.dec.st === 'review') t.dec.st = 'rejected';
          if (s.a.st === 'held') t.a.st = 'withdrawn';
          return [t];
        },
      },
      {
        // M2 TIMER review_expiry: nothing in the recorder's review is filed
        name: 'ReviewExpires',
        params: [[]],
        fair: true,
        step(s) {
          if (s.own !== 'review') return [];
          const t = t0(s, 'timer');
          t.own = 'expired';
          if (s.dec.st === 'review') t.dec.st = 'expired';
          if (s.a.st === 'held') t.a.st = 'expired';
          return [t];
        },
      },
      {
        // M34 CONFIRM: saved as theirs; their right is checked now (rule 4)
        name: 'Confirm',
        params: product(ITEMS, PEOPLE),
        step(s, x, by) {
          if (by !== PERSON[x]) return [];
          // Planted bug noDedup: a second tap, or a retry after a lost reply, files it again (twice is enough)
          const again = s[x].st === 'confirmed' && Bug === 'noDedup' && s.filed[x] < 2;
          const late = s[x].st === 'expired' && Bug === 'lateConfirm';
          if (s[x].st !== 'proposed' && !again && !late) return [];
          if (!member(s, by)) return [];
          // ownerAtConfirm: the record is checked as it is now, not as it was when the note was read
          if (fix.ownerAtConfirm && x === 'a' && !s.alicia.owns) return [];
          const t = t0(s, by);
          t[x].st = 'confirmed';
          t.filed[x] += 1;
          return [t];
        },
      },
      {
        // EDIT, then CONFIRM: confirmed with their wording
        name: 'Edit',
        params: ITEMS.map((x) => [x]),
        step(s, x) {
          if (s[x].st !== 'proposed' || s[x].worded) return [];
          const t = t0(s, PERSON[x]);
          t[x].worded = true;
          return [t];
        },
      },
      {
        // MT5: not filed; the recorder is told "Alicia says that's not right"
        name: 'Decline',
        params: ITEMS.map((x) => [x]),
        step(s, x) {
          if (s[x].st !== 'proposed') return [];
          const t = t0(s, PERSON[x]);
          Object.assign(t[x], { st: 'declined', recorderTold: Bug !== 'silentDecline' });
          return [t];
        },
      },
      {
        // TIMER attributedExpiryDays: expired, not filed
        name: 'AskExpires',
        params: ITEMS.map((x) => [x]),
        fair: true,
        step(s, x) {
          if (Bug === 'noAttributedTimer' || s[x].st !== 'proposed') return [];
          if (fix.pauseOnLeave && away(s, PERSON[x])) return [];
          const t = t0(s, 'timer');
          t[x].st = 'expired';
          return [t];
        },
      },
      {
        // MT12: they are back; the ask arrives and its timer starts
        name: 'AskArrives',
        params: ITEMS.map((x) => [x]),
        fair: true,
        step(s, x) {
          if (s[x].st !== 'waiting' || away(s, PERSON[x])) return [];
          const t = t0(s, 'atlas');
          t[x].st = 'proposed';
          return [t];
        },
      },
      {
        // ownerAtConfirm: an ask about a record that is someone else's now is withdrawn (by her tap, or the timer)
        name: 'OwnerMoved',
        params: [[]],
        fair: true,
        step(s) {
          if (!fix.ownerAtConfirm || s.alicia.owns || !['proposed', 'waiting'].includes(s.a.st)) return [];
          const t = t0(s, 'timer');
          t.a.st = 'withdrawn';
          return [t];
        },
      },
      {
        // Every part saved, confirmed, declined or expired
        name: 'Done',
        params: [[]],
        fair: true,
        step(s) {
          if (s.job !== 'split' || !OWN_FINAL.includes(s.own) || !DEC_SETTLED.includes(s.dec.st)) return [];
          if (!ITEMS.every((x) => ASK_FINAL.includes(s[x].st))) return [];
          return [Object.assign(t0(s, 'atlas'), { job: 'done' })];
        },
      },
      {
        // M15 APPROVE or DECLINE by a decider, who holds the right when it runs (rule 4). MT6: Kemar
        // made the decision; he cannot approve it.
        name: 'Decides',
        params: product(['alicia', 'kemar'], ['approve', 'decline']),
        step(s, by, answer) {
          if (s.dec.st !== 'proposed') return [];
          if (!(Bug === 'rightAtAsk' ? by === 'alicia' && s.dec.pmAtAsk : isPm(s, by))) return [];
          const t = t0(s, by);
          t.dec.st = answer === 'approve' ? 'approved' : 'declined';
          if (answer === 'approve') t.filed.dec += 1;
          return [t];
        },
      },
      // The world: Alicia goes on leave and comes back, loses the PM role, or leaves Forager. Once each.
      { name: 'LeaveStarts', params: [[]], step: (s) => (s.alicia.leave === 'in' ? [Object.assign(t0(s, 'alicia'), { alicia: { ...s.alicia, leave: 'away' } })] : []) },
      { name: 'LeaveEnds', params: [[]], fair: true, step: (s) => (s.alicia.leave === 'away' ? [Object.assign(t0(s, 'timer'), { alicia: { ...s.alicia, leave: 'back' } })] : []) },
      { name: 'Reassigned', params: [[]], step: (s) => (s.alicia.owns ? [Object.assign(t0(s, 'group'), { alicia: { ...s.alicia, owns: false } })] : []) },
      { name: 'Demoted', params: [[]], step: (s) => (s.alicia.role === 'pm' ? [Object.assign(t0(s, 'group'), { alicia: { ...s.alicia, role: 'member' } })] : []) },
      {
        name: 'LeavesProject',
        params: [[]],
        step(s) {
          if (s.alicia.role === 'gone') return [];
          const t = Object.assign(t0(s, 'group'), { alicia: { ...s.alicia, role: 'gone' } });
          // E77: her open asks on Forager are withdrawn in the same transaction
          if (fix.withdrawOnLeave && ['proposed', 'waiting'].includes(s.a.st)) t.a.st = 'withdrawn';
          return [t];
        },
      },
    ],
    invariants: {
      // Once only: whatever is tapped twice or retried, each part is filed at most once
      OnceOnly: (s) => Object.values(s.filed).every((n) => n <= 1),
      // MT1: nothing is ever filed as Kyle's; he is not in DPM
      NothingFiledAsKyles: (s) => s.filed.kyle === 0,
      // MT5: a decline always reaches the recorder
      DeclineTellsRecorder: (s) => ITEMS.every((x) => s[x].st !== 'declined' || s[x].recorderTold),
      // Rule 3 (P10): an open ask names Forager's records, so it is open only to a member of Forager
      OpenAsksOnlyToMembers: (s) => ITEMS.every((x) => s[x].st !== 'proposed' || member(s, PERSON[x])),
      // MT4, CD17: a note whose attendees were not told has a drawn way to be read as the recorder's own
      NotToldReadAsOwnNotes: (s) => s.job !== 'received' || s.told || ownNotesOnly(s).length > 0,
    },
    actionProperties: {
      // Machines doc rule 2: every change of state is an arrow the design draws
      OnlyDrawnArrows: (s, t) =>
        [
          ['job', s.job, t.job],
          ['own', s.own, t.own],
          ['dec', s.dec.st, t.dec.st],
          ...ITEMS.map((x) => ['ask', s[x].st, t[x].st]),
        ].every(([m, from, to]) => from === to || drawn[m].has(`${from}>${to}`)),
      // Rule 1: Atlas never files anything; every filing is a step a person took
      AtlasChangesNoRecord: (s, t) => Object.keys(s.filed).every((k) => s.filed[k] === t.filed[k]) || PEOPLE.includes(t.by),
      // Rule 10: what is said about Alicia or Andre is filed as theirs only when they confirm it
      YourWordOnlyYours: (s, t) =>
        ITEMS.every((x) => t.filed[x] === s.filed[x] || t.by === PERSON[x]) && (t.filed.own === s.filed.own || t.by === RECORDER),
      // Rule 4: a confirm or an approval is refused once the right is gone, whatever the ask showed. Rule 10:
      // the right to confirm a change to a record is its owner's, so it goes when the record changes hands
      RightCheckedWhenItRuns: (s, t) =>
        ITEMS.every((x) => t.filed[x] === s.filed[x] || (member(s, PERSON[x]) && (x !== 'a' || s.alicia.owns))) && (t.filed.dec === s.filed.dec || isPm(s, t.by)),
      // MT2: nothing goes to another person while Atlas is unsure who said it
      NoAskOnAGuess: (s, t) =>
        !(['none', 'held'].includes(s.a.st) && ['proposed', 'waiting'].includes(t.a.st)) || t.sure || t.a.fixed,
      // Machines doc rule 8: the decision reaches the deciders only after the recorder confirmed it is
      // accurate; the deciders' answer is the second confirmation, never the only one
      DecisionsConfirmedTwice: (s, t) => SENT.includes(s.dec.st) || !SENT.includes(t.dec.st) || t.by === RECORDER,
      // MT12: an ask never runs out while its person is on leave
      NeverExpiresWhileAway: (s, t) => ITEMS.every((x) => !(s[x].st === 'proposed' && t[x].st === 'expired') || !away(s, PERSON[x])),
    },
    leadsTo: {
      // Rule 5: the job never waits forever
      JobEnds: [{ label: 'job', P: (s) => JOB_WAITING.includes(s.job), Q: (s) => !JOB_WAITING.includes(s.job) }],
      // Rule 5: an ask held, waiting or proposed always ends
      AsksEnd: ITEMS.map((x) => ({ label: x, P: (s) => ASK_OPEN.includes(s[x].st), Q: (s) => !ASK_OPEN.includes(s[x].st) })),
    },
  };
}
