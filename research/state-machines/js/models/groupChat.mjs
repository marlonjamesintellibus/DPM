// Atlas in the project group (use-cases/atlas-conversational-plan.md, section 11, phase I):
// M26 Group message and M27 Group answer, with the machines they hand on to: an update goes to its
// sender's own review (M2), something said about another person goes to them to confirm (M34, GR9),
// and a decision asked for in the group becomes a chat command confirmed directly (M20, GR12).
//
// One message in a connected Forager group per starting state. The people are the seeded ones:
// Kemar is a member of Forager and Store Insights, Alicia is Forager's PM (not in Store Insights),
// Kyle is an outside contact (orgRole null, reads the client view only), and Sam is in the Atlas
// group but not in DPM (GR1). People join and leave the group, and lose rights, at any time and as
// often as they like, so every guard is tried against a world that moved after the ask.
//
// Three facts an answer could hold:
//   fc  Forager's next milestone and its forecast, shown in the client view (Kemar, Alicia, Kyle)
//   fi  a live Forager blocker, members only (Kemar while he is in Forager, Alicia)
//   fs  a Store Insights blocker (Kemar only)
//
// Options for what the plan leaves open, and for the fixes to what it writes:
//   Branches  'drawn' as M26 draws it: everything that is not a question goes through M2 as the
//             sender's update; 'edge_cases' adds GR9 (about someone else: M34 to them) and GR12
//             (a decision: an M20 command to the sender directly)
//   Post      'as_written': composing -> answered when the member list is unchanged since
//             AUDIENCE, else composing again; 'filter_at_post': the post keeps only the composed
//             facts every member may read now, in the posting transaction (DPM's own words when
//             one was dropped, as section 17 FELL_BACK)
//   M34Guard  false as M34 draws it (CONFIRM -> confirmed, saved); true adds the rule 4 guard and
//             a `refused` state, as M20 has
//   History   'from_join': a member sees the group's messages from when they joined;
//             'shown': a joiner also sees what was posted before (the Atlas app is not specified)
//   Scenarios the starting states to check, all by default
// Each setting is about 20,000 states; the noDedup plant, which reads a message twice, about 540,000.
import { clone, product } from '../lib.mjs';

const PEOPLE = ['alicia', 'kemar', 'kyle', 'sam'];
const DPM = ['alicia', 'kemar', 'kyle'];
const FACTS = ['fc', 'fi', 'fs'];
const IDX = [0, 1]; // job slots: a second only when a repeat delivery is processed again (GR10)

// What each person may read now, through the per-viewer queries (P10)
function reads(s, p) {
  if (p === 'kemar') return s.rights.kemarForager ? ['fc', 'fi', 'fs'] : ['fc', 'fs'];
  if (p === 'alicia') return ['fc', 'fi'];
  if (p === 'kyle') return ['fc'];
  return [];
}
// Rule 8: a fact is kept only if every member may read it (the intersection of their reads)
const everyone = (s, members, facts = FACTS) => facts.filter((f) => members.every((p) => reads(s, p).includes(f)));

// The rights a step needs when it runs (rule 4): Kemar writes Forager items while he is in Forager,
// Alicia as its PM; only the PM decides the risk
function canWrite(s, p, item) {
  if (item === 'risk') return p === 'alicia' && s.rights.aliciaPM;
  return p === 'alicia' || (p === 'kemar' && s.rights.kemarForager);
}
// Whose record each item is (rule 10): #145 is Kemar's; a report is its reporter's
const OWNER = { k145: 'kemar' };
// The reports a step added to Andre's blocker (a sorted list, so compare as multisets)
function added(before, after) {
  const left = [...before];
  return after.filter((r) => {
    const k = left.indexOf(r);
    if (k < 0) return true;
    left.splice(k, 1);
    return false;
  });
}

// The drawn arrows, per machine
const ARROWS = {
  msg: ['sent>received', 'received>captured', 'received>ignored'],
  cap: ['proposed>saved', 'proposed>withdrawn', 'proposed>expired'],
  none: [],
  q: ['asked>sent_directly', 'asked>composing', 'composing>composing', 'composing>answered'],
  att: ['proposed>confirmed', 'proposed>declined', 'proposed>expired'],
  cmd: ['proposed>done', 'proposed>refused', 'proposed>cancelled', 'proposed>expired'],
};

// The scenarios: who sends what, in which group (GR numbers from the plan's edge-case table)
const SCENARIOS = {
  update: { from: 'kemar', says: 'update', item: 'k145' }, //            "Finished #145"
  plusOne: { from: 'kemar', says: 'update', item: 'rep' }, //            GR7: "+1, same for me" on Andre's blocker
  banter: { from: 'alicia', says: 'banter' }, //                         GR8: "Lunch at 1?"
  askGroup: { from: 'kemar', says: 'ask_group' }, //                     GR4, GR5: "@Atlas what's blocked?"
  askPersonal: { from: 'kemar', says: 'ask_personal' }, //               GR6: "@Atlas what needs me?"
  aboutOther: { from: 'alicia', says: 'about_other', item: 'k145' }, //  GR9: "Kemar says #145 is done"
  approveAlicia: { from: 'alicia', says: 'decide' }, //                  GR12: "@Atlas approve the Kyle risk"
  approveKemar: { from: 'kemar', says: 'decide' }, //                    GR12, asked by someone without the right
  stranger: { from: 'sam', says: 'update', item: 'k145' }, //            GR1
  unconnected: { from: 'kemar', says: 'update', item: 'k145', connected: false }, // GR2: UWI Mona study group
};

export default function GroupChat({
  Scenarios = Object.keys(SCENARIOS),
  Branches = 'edge_cases',
  Post = 'filter_at_post',
  M34Guard = true,
  History = 'from_join',
  Bug = null,
} = {}) {
  // by: the person or 'atlas' whose step it was; null for the app, timers and the world, which change no record
  const t0 = (s, by) => Object.assign(clone(s), { by });
  const arrows = { ...ARROWS, att: M34Guard ? [...ARROWS.att, 'proposed>refused'] : ARROWS.att };

  // A record changes only through a person's confirmed step (rule 1)
  function apply(t, item, by) {
    if (item === 'risk') t.rec.risk = 'approved';
    else if (item === 'k145') t.rec.k145 = 'done';
    else t.rec.rep = [...t.rec.rep, Bug === 'creditOriginal' ? 'andre' : by].sort();
  }

  function post(t, i, kind, facts) {
    // Bug hint: the answer says some facts were left out ("there is more I can't share here")
    const more = Bug === 'hint' && everyone(t, [t.jobs[i]?.asker ?? t.from]).length > facts.length;
    t.posts.push({ q: i, kind, facts, more, readers: [...t.members] });
  }

  // What the message becomes once M26's guard holds
  function job(s) {
    const { from, says, item } = SCENARIOS[s.sc];
    const cap = (author, it) => ({ m: 'cap', author, item: it, st: 'proposed', reads: 0 });
    if (says === 'update') return cap(from, item);
    if (says === 'banter') return { m: 'none', st: 'nothing_to_update' };
    if (says === 'ask_group' || says === 'ask_personal') return { m: 'q', asker: from, personal: says === 'ask_personal', st: 'asked', aud: [], facts: [] };
    if (says === 'about_other') return Branches === 'drawn' ? cap(from, item) : { m: 'att', for: OWNER[item], item, st: 'proposed' };
    // right: what the asker held when they asked, read only by the rightAtAsk plant
    return { m: 'cmd', asker: from, st: 'proposed', right: canWrite(s, from, 'risk') };
  }

  // Whose reads a group answer is kept to. Bug askerReads: the asker's, not every member's
  const audience = (s, j) => (Bug === 'askerReads' ? [j.asker] : s.members);
  const at = (s, i, m, st) => s.jobs[i]?.m === m && (!st || [].concat(st).includes(s.jobs[i].st));

  return {
    name: `GroupChat (${Branches}, ${Post}, M34Guard = ${M34Guard}, History = ${History}${Bug ? `, bug ${Bug}` : ''})`,
    init: () =>
      Object.entries(SCENARIOS).filter(([sc]) => Scenarios.includes(sc)).map(([sc, { from, connected = true }]) => ({
        sc,
        from,
        connected,
        members: from === 'sam' ? ['alicia', 'kemar', 'sam'] : ['alicia', 'kemar'],
        rights: { kemarForager: true, aliciaPM: true },
        msg: { st: 'sent', n: 0, ed: 0, del: false },
        jobs: [],
        rec: { k145: 'in_progress', rep: ['andre'], risk: 'proposed' },
        posts: [],
        direct: [],
        by: null,
      })),
    actions: [
      {
        // The Atlas app delivers the message, with its Atlas message id. It may deliver it twice (GR10).
        name: 'Deliver',
        params: [[]],
        step(s) {
          if (s.msg.n >= 2 || s.msg.del) return [];
          const t = t0(s, null);
          t.msg.n++;
          if (s.msg.st === 'sent') t.msg.st = 'received';
          // Bug noDedup: the repeat is read again as a new message
          else if (Bug === 'noDedup') t.msg.st = 'received';
          return [t];
        },
      },
      {
        // M26 received -> captured | ignored. The guard is read when it runs: the group is connected,
        // and the sender is a DPM person in it now. A message deleted before Atlas reads it is not read
        // (GR11's withdrawal, before there is a capture to withdraw).
        name: 'Process',
        params: [[]],
        fair: true,
        step(s) {
          if (s.msg.st !== 'received') return [];
          const t = t0(s, 'atlas');
          const ok = s.connected && DPM.includes(s.from) && s.members.includes(s.from) && !s.msg.del;
          if (!ok) {
            t.msg.st = 'ignored';
            // Bug storeStrangers: a capture is kept for a message that was ignored (GR1, GR2)
            if (Bug === 'storeStrangers') t.jobs.push({ m: 'none', st: 'nothing_to_update' });
            return [t];
          }
          t.msg.st = 'captured';
          const j = job(s);
          t.jobs.push(j);
          const i = t.jobs.length - 1;
          // Bug autoSave: Atlas saves the update itself, with no review (the right is still checked)
          if (Bug === 'autoSave' && j.m === 'cap' && canWrite(s, j.author, j.item)) {
            j.st = 'saved';
            apply(t, j.item, j.author);
          }
          // Bug gotItInGroup: nothing_to_update is said in the group (GR8)
          if (Bug === 'gotItInGroup' && j.m === 'none') post(t, i, 'got_it', []);
          // Bug cardInGroup: the confirm card is put in the group, where anyone can tap it (GR12)
          if (Bug === 'cardInGroup' && j.m === 'cmd') post(t, i, 'card', []);
          return [t];
        },
      },
      // M2, for the sender's own update: their review comes to them directly, never in the group
      {
        name: 'Save',
        params: IDX.map((i) => [i]),
        step(s, i) {
          if (!at(s, i, 'cap', 'proposed')) return [];
          const { author, item } = s.jobs[i];
          if (!canWrite(s, author, item)) return [];
          const t = t0(s, author);
          t.jobs[i].st = 'saved';
          apply(t, item, author);
          return [t];
        },
      },
      {
        name: 'ReviewExpires',
        params: IDX.map((i) => [i]),
        fair: true,
        step(s, i) {
          if (!at(s, i, 'cap', 'proposed')) return [];
          const t = t0(s, null);
          t.jobs[i].st = 'expired';
          return [t];
        },
      },
      {
        // GR11, CD11: an edit before review is a new read; after save, nothing changes
        name: 'Edit',
        params: [[]],
        step(s) {
          if (s.msg.ed >= 1 || s.msg.del || !SCENARIOS[s.sc].item) return [];
          const t = t0(s, null);
          t.msg.ed = 1;
          for (const j of t.jobs) {
            if (j.m !== 'cap') continue;
            if (j.st === 'proposed') j.reads++;
            // Bug editAfterSave: the edit reopens a saved update for review
            else if (j.st === 'saved' && Bug === 'editAfterSave') Object.assign(j, { st: 'proposed', reads: j.reads + 1 });
          }
          return [t];
        },
      },
      {
        // GR11: a deleted message withdraws its unsaved capture
        name: 'Delete',
        params: [[]],
        step(s) {
          if (s.msg.del || !SCENARIOS[s.sc].item) return [];
          const t = t0(s, null);
          t.msg.del = true;
          for (const j of t.jobs) if (j.m === 'cap' && j.st === 'proposed' && Bug !== 'deleteKeeps') j.st = 'withdrawn';
          return [t];
        },
      },
      // M27 Group answer
      {
        // asked -> sent_directly for a personal topic (GR6): the same reply in the group whatever the
        // answer; the answer in the asker's own chat, from their reads now. Otherwise AUDIENCE.
        name: 'Audience',
        params: IDX.map((i) => [i]),
        fair: true,
        step(s, i) {
          if (!at(s, i, 'q', 'asked')) return [];
          const j = s.jobs[i];
          const t = t0(s, 'atlas');
          if (j.personal) {
            t.jobs[i].st = 'sent_directly';
            // Bug personalInGroup: the asker's own answer is given in the group
            if (Bug === 'personalInGroup') post(t, i, 'answer', reads(s, j.asker));
            else {
              post(t, i, 'directly', []);
              t.direct.push({ to: j.asker, facts: reads(s, j.asker), readers: [j.asker] });
            }
            return [t];
          }
          // Bug noAudience: Atlas never takes the member list, so the question waits for good
          if (Bug === 'noAudience') return [];
          // AUDIENCE(the members now)
          const facts = everyone(s, audience(s, j));
          Object.assign(t.jobs[i], { st: 'composing', aud: [...s.members], facts });
          return [t];
        },
      },
      {
        // composing -> answered, or composing again with the new list
        name: 'Post',
        params: IDX.map((i) => [i]),
        fair: true,
        step(s, i) {
          if (!at(s, i, 'q', 'composing')) return [];
          const j = s.jobs[i];
          const t = t0(s, 'atlas');
          if (Post === 'as_written' && JSON.stringify(j.aud) !== JSON.stringify(s.members)) {
            Object.assign(t.jobs[i], { aud: [...s.members], facts: everyone(s, s.members) });
            return [t];
          }
          // As written the facts are the ones composed for the list; the fix filters them again now
          const facts = Post === 'filter_at_post' ? everyone(s, audience(s, j), j.facts) : j.facts;
          t.jobs[i].st = 'answered';
          // "Nothing I can share with everyone here." when facts is empty, and no hint of more (P10)
          post(t, i, 'answer', facts);
          return [t];
        },
      },
      // M34 Attributed item, to the person it is about (GR9, rule 10)
      {
        name: 'Confirm',
        params: IDX.map((i) => [i]),
        step(s, i) {
          // Bug confirmAfterExpiry: an expired item can still be confirmed
          if (!at(s, i, 'att', Bug === 'confirmAfterExpiry' ? ['proposed', 'expired'] : 'proposed')) return [];
          const { for: p, item } = s.jobs[i];
          const t = t0(s, p);
          if (M34Guard && !canWrite(s, p, item)) {
            t.jobs[i].st = 'refused';
            return [t];
          }
          t.jobs[i].st = 'confirmed';
          apply(t, item, p);
          return [t];
        },
      },
      {
        name: 'Decline',
        params: IDX.map((i) => [i]),
        step(s, i) {
          if (!at(s, i, 'att', 'proposed')) return [];
          const t = t0(s, s.jobs[i].for);
          t.jobs[i].st = 'declined';
          return [t];
        },
      },
      {
        name: 'AttributedExpires',
        params: IDX.map((i) => [i]),
        fair: true,
        step(s, i) {
          // Bug noAttTimer: attributedExpiryDays never fires
          if (!at(s, i, 'att', 'proposed') || Bug === 'noAttTimer') return [];
          const t = t0(s, null);
          t.jobs[i].st = 'expired';
          return [t];
        },
      },
      // M20 Chat command, confirmed by the asker in their own chat, never in the group (GR12)
      {
        name: 'Approve',
        params: product(DPM, IDX),
        step(s, by, i) {
          if (!at(s, i, 'cmd', 'proposed')) return [];
          const j = s.jobs[i];
          if (by !== j.asker && !(Bug === 'cardInGroup' && s.members.includes(by))) return [];
          const t = t0(s, by);
          // Bug rightAtAsk: the right is read from when the command was made, not now
          const right = Bug === 'rightAtAsk' ? j.right : canWrite(s, by, 'risk');
          t.jobs[i].st = right ? 'done' : 'refused';
          if (right) apply(t, 'risk', by);
          return [t];
        },
      },
      {
        name: 'Cancel',
        params: IDX.map((i) => [i]),
        step(s, i) {
          if (!at(s, i, 'cmd', 'proposed')) return [];
          const t = t0(s, s.jobs[i].asker);
          t.jobs[i].st = 'cancelled';
          return [t];
        },
      },
      {
        name: 'CommandExpires',
        params: IDX.map((i) => [i]),
        fair: true,
        step(s, i) {
          if (!at(s, i, 'cmd', 'proposed')) return [];
          const t = t0(s, null);
          t.jobs[i].st = 'expired';
          return [t];
        },
      },
      // The world moves: people join and leave the group, and lose rights in DPM
      {
        name: 'Join',
        params: DPM.map((p) => [p]),
        step(s, p) {
          if (s.members.includes(p)) return [];
          const t = t0(s, null);
          t.members = [...s.members, p].sort();
          if (History === 'shown') for (const x of t.posts) if (!x.readers.includes(p)) x.readers = [...x.readers, p].sort();
          return [t];
        },
      },
      {
        name: 'Leave',
        params: PEOPLE.map((p) => [p]),
        step(s, p) {
          if (!s.members.includes(p)) return [];
          const t = t0(s, null);
          t.members = s.members.filter((x) => x !== p);
          return [t];
        },
      },
      {
        // Kemar leaves Forager (still in the group); Alicia stops being its PM
        name: 'LosesRight',
        params: [['kemarForager'], ['aliciaPM']],
        step(s, r) {
          if (!s.rights[r]) return [];
          const t = t0(s, null);
          t.rights[r] = false;
          return [t];
        },
      },
    ],
    invariants: {
      // GR10, rule 6: one Atlas message id, one capture, one answer
      OnceOnly: (s) => s.jobs.length <= 1 && s.posts.length <= 1 && s.direct.length <= 1,
      // GR1, GR2: nothing is stored about a message that is not read
      IgnoredStoresNothing: (s) => (s.connected && DPM.includes(s.from)) || s.jobs.length === 0,
      // Atlas says nothing in the group about an update, a review or a command: it only answers a
      // question asked there, and a personal one only with "Sent you that directly" (GR6, GR8, GR12)
      GroupHearsOnlyAnswers: (s) =>
        s.posts.every((p) => {
          const j = s.jobs[p.q];
          if (j?.m !== 'q') return false;
          return j.personal ? p.kind === 'directly' && p.facts.length === 0 : p.kind === 'answer';
        }),
      // P10: an answer never says facts were left out
      NoHintOfMore: (s) => s.posts.every((p) => !p.more),
      // GR11: a deleted message leaves no update waiting for review
      DeletedWithdrawn: (s) => !s.msg.del || !s.jobs.some((j) => j.m === 'cap' && j.st === 'proposed'),
    },
    actionProperties: {
      // Rule 2: a state changes only along a drawn arrow
      OnlyDrawnArrows: (s, t) =>
        (s.msg.st === t.msg.st || arrows.msg.includes(`${s.msg.st}>${t.msg.st}`)) &&
        s.jobs.every((j, i) => j.st === t.jobs[i].st || arrows[j.m].includes(`${j.st}>${t.jobs[i].st}`)),
      // Rule 8, P10: whoever can read an answer, in the group or their own chat, may read every fact
      // in it at the moment they can first read it (when it is posted, or when they join if earlier
      // messages are shown)
      EveryReaderMaySee: (s, t) =>
        ['posts', 'direct'].every((list) =>
          t[list].every((x, k) => x.readers.every((r) => s[list][k]?.readers.includes(r) || x.facts.every((f) => reads(t, r).includes(f))))),
      // Rule 1: Atlas never changes a record; only a person's own step does
      AtlasNeverChangesARecord: (s, t) => JSON.stringify(s.rec) === JSON.stringify(t.rec) || DPM.includes(t.by),
      // Rule 10: a person's step changes only their own records; what is said about Kemar changes
      // nothing of his until he confirms (GR7, GR9)
      YourWordYourRecords: (s, t) =>
        !DPM.includes(t.by) || ((s.rec.k145 === t.rec.k145 || t.by === OWNER.k145) && added(s.rec.rep, t.rec.rep).every((r) => r === t.by)),
      // Rule 4: a person changes a record only with the right they hold when it runs (AC1)
      RightHeldWhenItRuns: (s, t) =>
        !DPM.includes(t.by) ||
        (['k145', 'risk'].every((k) => s.rec[k] === t.rec[k] || canWrite(s, t.by, k)) &&
          (added(s.rec.rep, t.rec.rep).length === 0 || canWrite(s, t.by, 'rep'))),
      // M20, M34: only the person a confirm is for answers it, in their own chat
      OnlyTheirOwnConfirm: (s, t) =>
        s.jobs.every((j, i) => {
          if (j.st === t.jobs[i].st) return true;
          if (j.m === 'cmd' && ['done', 'refused', 'cancelled'].includes(t.jobs[i].st)) return t.by === j.asker;
          if (j.m === 'att' && ['confirmed', 'declined', 'refused'].includes(t.jobs[i].st)) return t.by === j.for;
          return true;
        }),
      // CD11: once saved, an edit or a delete changes nothing
      SavedStaysSaved: (s, t) => s.jobs.every((j, i) => j.m !== 'cap' || j.st !== 'saved' || JSON.stringify(j) === JSON.stringify(t.jobs[i])),
    },
    leadsTo: {
      // Rule 5: nothing gets stuck. Every message is read; every wait has a timer or a way out.
      WaitsEnd: [
        { label: 'message', P: (s) => s.msg.st === 'received', Q: (s) => s.msg.st !== 'received' },
        { label: 'review', P: (s) => at(s, 0, 'cap', 'proposed'), Q: (s) => !at(s, 0, 'cap', 'proposed') },
        { label: 'attributed', P: (s) => at(s, 0, 'att', 'proposed'), Q: (s) => !at(s, 0, 'att', 'proposed') },
        { label: 'command', P: (s) => at(s, 0, 'cmd', 'proposed'), Q: (s) => !at(s, 0, 'cmd', 'proposed') },
      ],
      // A question in the group is answered, however the member list moves
      QuestionAnswered: [{ label: 'question', P: (s) => at(s, 0, 'q', ['asked', 'composing']), Q: (s) => !at(s, 0, 'q', ['asked', 'composing']) }],
    },
  };
}
