// M23 Nudge and M24 Nudge settings: Atlas speaks first (use-cases/atlas-conversational-plan.md, section 8,
// phase F, edge cases PN1 to PN12). Kemar is a member of Forager; Alicia is its PM and is also on Store
// Insights; Dwayne is an outsider, on neither.
//   A nudge is scheduled once per (person, kind, subject, day). At send_at it is composed: the facts and
//   the guards are read again (still true, the right to see it, not on leave, working hours, the daily
//   cap, the kind turned on). Then it is sent, retried while the Atlas app fails (then failed), and
//   replied to or left unanswered. A reply is a capture read with the nudge as context: it proposes, and
//   only the owner of a record confirms a change to it (rules 1 and 10).
//   M24: on or off per person per kind, read at composing (PN8); only the person changes their own.
// Scaled down: the daily cap is 1 or 2 (config 4) and nudgeMaxTries is 2 (config 3).
//
// The default is the plan as written. FIXED holds the four changes the check found were needed:
//   SendTimer          a send that never answers goes to retry_wait on a timer (rule 5)
//   RetryRecomposes    the retry timer goes back to composing, so facts and guards are read again (rule 4, PN3, PN9)
//   CapReserves        the cap counts every nudge handed to the app today, not only sent ones (PN4)
//   ReplyWhileSending  a reply that quotes a nudge it already reached answers it, sent or not yet (PN6)
import { clone, product } from '../lib.mjs';

export const FIXED = { SendTimer: true, RetryRecomposes: true, CapReserves: true, ReplyWhileSending: true };

const MEMBERS = { kemar: ['forager'], alicia: ['forager', 'store'], dwayne: [] };
// CD6: brief, mentions, due-date checks and check-ins on; missing-update reminders off
const DEFAULTS = { brief: true, mention: true, due: true, missing: false, checkin: true };
const MAX_TRIES = 2;
const FINAL = ['skipped', 'failed', 'replied', 'unanswered'];

// What each nudge is about. Facts carry the project they come from; a brief picks its own at composing
const NUDGES = {
  // "Is #151 still on for today?" #151 is Kemar's, on Forager, and past due
  due: { to: 'kemar', kind: 'due', facts: ['forager'] },
  // Alicia's report on Forager names Kemar
  mention: { to: 'kemar', kind: 'mention', facts: ['forager'] },
  // Words that name Kemar but were routed to Store Insights, which he is not in (PN7, CQ8)
  hidden: { to: 'kemar', kind: 'mention', facts: ['store'] },
  // The same Forager report also names Dwayne, who is not on Forager
  outsider: { to: 'dwayne', kind: 'mention', facts: ['forager'] },
  // Kemar's morning brief: #151 due this week on Forager, and a Store Insights risk that names him
  brief: { to: 'kemar', kind: 'brief', facts: null, candidates: ['forager', 'store'] },
};
// Replies in the Atlas app. c1 quotes the due-date check: "Yes, still on. Alicia's #160 slipped to
// Monday" (PN12: it is also about someone else's record). c2 quotes nothing: "Moved #151 to Friday"
const CAPTURES = { c1: { quote: 'due', about: ['w151', 'w160'] }, c2: { quote: null, about: ['w151'] } };
const OWNER = { w151: 'kemar', w160: 'alicia' };

// Each setting checks one small world, so it stays well under a million states
const WORLDS = {
  due: { nudges: ['due'], captures: ['c1'], changes: ['removed', 'leave', 'late', 'setting', 'edited'] },
  two: { nudges: ['due', 'mention'], captures: ['c1', 'c2'], changes: [] },
  mentions: { nudges: ['mention', 'hidden', 'outsider'], captures: [], changes: ['removed'] },
  brief: { nudges: ['brief'], captures: [], changes: ['removed'] },
};

// M23 as drawn, as "from>to"
const DRAWN = [
  'scheduled>composing',
  'composing>sending',
  'composing>skipped',
  'sending>sent',
  'sending>retry_wait',
  'retry_wait>sending',
  'retry_wait>failed',
  'sent>replied',
  'sent>unanswered',
];

export default function Nudge({
  World = 'due',
  Cap = 1,
  SendTimer = false,
  RetryRecomposes = false,
  CapReserves = false,
  ReplyWhileSending = false,
  Bug = null,
} = {}) {
  const world = WORLDS[World];
  const arrows = new Set(DRAWN);
  if (RetryRecomposes) {
    arrows.delete('retry_wait>sending');
    arrows.add('retry_wait>composing');
  }
  if (ReplyWhileSending) for (const st of ['composing', 'sending', 'retry_wait']) arrows.add(`${st}>replied`);
  // The cap counts sent nudges as written ("under the daily cap"). The fix counts every other nudge
  // handed to the app today, whatever its state now: one being retried may already have been shown
  const counted = (x) => (CapReserves ? x.tries > 0 : ['sent', 'replied', 'unanswered'].includes(x.st));
  // A reply can answer a nudge in these states (it was shown, so it reached the person)
  const ANSWERABLE = ReplyWhileSending ? ['composing', 'sending', 'retry_wait', 'sent'] : ['sent'];
  const SLOTS = world.nudges.flatMap((id) => [0, 1].map((k) => [id, k]));

  const t0 = (s, by) => Object.assign(clone(s), { by });
  const member = (s, p, project) => (p === 'kemar' ? project === 'forager' && s.kemarIn : MEMBERS[p].includes(project));
  const sees = (s, p, facts) => facts.every((f) => member(s, p, f));
  const kindOn = (s, p, kind) => (s.on[p] ?? DEFAULTS)[kind];
  const all = (s) => SLOTS.filter(([id, k]) => s.n[id][k]).map(([id, k]) => ({ id, k, x: s.n[id][k] }));

  // What the nudge says, read from DPM's per-viewer facts at this moment (P10)
  function message(s, id) {
    const nd = NUDGES[id];
    if (nd.facts) return { facts: nd.facts, count: nd.facts.length };
    const facts = nd.candidates.filter((f) => member(s, nd.to, f));
    // Planted bug countHidden: "2 things need you" when only one is listed
    return { facts, count: Bug === 'countHidden' ? nd.candidates.length : facts.length };
  }

  // The guard at composing; a reason means skipped, final, reason logged
  function skipReason(s, id, k) {
    const nd = NUDGES[id];
    const x = s.n[id][k];
    if (id === 'due' && s.rec.w151) return 'already_updated'; // PN3
    if (nd.kind === 'brief' && !message(s, id).facts.length && Bug !== 'sendEmpty') return 'empty'; // PN11
    // PN7, PN9. Planted bug rightAtSchedule: the check made when it was scheduled is trusted
    const checkRight = Bug !== 'rightAtSchedule' && !(Bug === 'leakMention' && nd.kind === 'mention');
    if (nd.facts && checkRight && !sees(s, nd.to, nd.facts)) return 'no_right';
    if (nd.to === 'kemar' && s.leave) return 'on_leave'; // PN1
    if (s.late) return 'after_hours';
    // PN8. Planted bug settingAtSchedule: the setting as it was when the nudge was scheduled
    if (!(Bug === 'settingAtSchedule' ? x.wasOn : kindOn(s, nd.to, nd.kind))) return 'turned_off';
    const used = all(s).filter((o) => NUDGES[o.id].to === nd.to && !(o.id === id && o.k === k) && counted(o.x)).length;
    if (Bug !== 'noCap' && used >= Cap) return 'over_cap'; // PN4
    return null;
  }

  // The message goes to the Atlas app carrying the nudge's id. The app either takes it or is down
  // (PN5). An app that already has this id shows nothing new (rule 6). The hand-off is the same step
  // as the guard that allowed it, so "checked when it runs" is about the moment it is handed over
  // (a right lost while the app is answering is not a send after the check)
  function handOff(t, id, k) {
    Object.assign(t.n[id][k], { st: 'sending', tries: t.n[id][k].tries + 1 });
    const got = clone(t);
    const g = got.n[id][k];
    // Planted bug noSendId: a resend after a lost reply is shown again
    if (!g.shown || Bug === 'noSendId') g.shown += 1;
    g.fly = 'got';
    t.n[id][k].fly = 'down';
    return [got, t];
  }

  function compose(t, id, k) {
    const why = skipReason(t, id, k);
    if (why) {
      Object.assign(t.n[id][k], { st: 'skipped', why });
      return [t];
    }
    t.n[id][k].msg = message(t, id);
    return handOff(t, id, k);
  }

  // Where a reply lands (PN6): the nudge it quotes, otherwise the newest unanswered one
  function target(s, c) {
    const q = CAPTURES[c].quote;
    if (q && Bug !== 'newestAlways') {
      const k = (s.n[q] ?? []).findIndex((x) => x.shown > 0);
      return k >= 0 && ANSWERABLE.includes(s.n[q][k].st) ? { id: q, k } : null;
    }
    const sent = all(s).filter((o) => NUDGES[o.id].to === 'kemar' && o.x.st === 'sent');
    sent.sort((a, b) => b.x.seq - a.x.seq);
    return sent[0] ?? null;
  }

  // One action per nudge slot (id, k); k is 1 only when the planted bug noKey schedules a repeat
  const slotAction = (name, fair, step) => ({ name, params: SLOTS, fair, step: (s, id, k) => (s.n[id][k] ? step(s, id, k, s.n[id][k]) : []) });
  const moveTo = (s, id, k, patch) => {
    const t = t0(s, 'atlas');
    Object.assign(t.n[id][k], patch);
    return [t];
  };
  const changes = (name) => world.changes.includes(name);

  return {
    name: `Nudge (${World}, cap ${Cap}${SendTimer && RetryRecomposes && CapReserves && ReplyWhileSending ? ', fixed' : ''}${Bug ? `, bug ${Bug}` : ''})`,
    init: () => [
      {
        n: Object.fromEntries(world.nudges.map((id) => [id, []])),
        kemarIn: true,
        leave: false,
        late: false,
        on: { kemar: Object.fromEntries([...new Set(world.nudges.map((id) => NUDGES[id].kind))].map((kind) => [kind, DEFAULTS[kind]])) },
        rec: { w151: false, w160: false },
        prop: { w151: false, w160: false },
        reads: Object.fromEntries(world.captures.map((c) => [c, 0])),
        clock: 0,
        by: null,
      },
    ],
    actions: [
      {
        // The event that makes a nudge due: #151 passes its date, a report naming them is saved, the day starts
        name: 'Schedule',
        params: world.nudges.map((id) => [id]),
        step(s, id) {
          const nd = NUDGES[id];
          const list = s.n[id];
          // One nudge per (person, kind, subject, day): a repeat event changes nothing. Planted bug noKey
          if (list.length >= (Bug === 'noKey' ? 2 : 1)) return [];
          if (id === 'due' && (s.rec.w151 || !member(s, 'kemar', 'forager'))) return [];
          // A mention alert only when its quote is visible to them (PN7). Planted bug leakMention
          if (nd.kind === 'mention' && Bug !== 'leakMention' && !sees(s, nd.to, nd.facts)) return [];
          const t = t0(s, 'atlas');
          const x = { st: 'scheduled', tries: 0, fly: null, shown: 0, msg: null, why: null, seq: 0, ctx: null };
          if (Bug === 'settingAtSchedule') x.wasOn = kindOn(s, nd.to, nd.kind);
          t.n[id] = [...list, x];
          return [t];
        },
      },
      slotAction('SendAt', true, (s, id, k, x) => (x.st === 'scheduled' ? moveTo(s, id, k, { st: 'composing' }) : [])),
      slotAction('Compose', true, (s, id, k, x) => (x.st === 'composing' ? compose(t0(s, 'atlas'), id, k) : [])),
      slotAction('Sent', true, (s, id, k, x) => {
        if (x.st !== 'sending' || x.fly !== 'got') return [];
        const t = t0(s, 'atlas');
        Object.assign(t.n[id][k], { st: 'sent', fly: null, seq: s.clock + 1 });
        t.clock = s.clock + 1;
        return [t];
      }),
      slotAction('SendFailed', true, (s, id, k, x) => (x.st === 'sending' && x.fly === 'down' ? moveTo(s, id, k, { st: 'retry_wait', fly: null }) : [])),
      // The app took the message but its answer was lost: it looks like a failure
      slotAction('AnswerLost', false, (s, id, k, x) => (x.st === 'sending' && x.fly === 'got' ? moveTo(s, id, k, { st: 'retry_wait', fly: null }) : [])),
      // The call to the app never answers (the process stopped mid send)
      slotAction('Hangs', false, (s, id, k, x) => (x.st === 'sending' && x.fly ? moveTo(s, id, k, { fly: null }) : [])),
      // Fix SendTimer: a send with no answer goes back to retry (rule 5)
      slotAction('SendTimer', true, (s, id, k, x) => (SendTimer && x.st === 'sending' ? moveTo(s, id, k, { st: 'retry_wait', fly: null }) : [])),
      slotAction('RetryTimer', true, (s, id, k, x) => {
        if (x.st !== 'retry_wait') return [];
        if (x.tries >= MAX_TRIES) return moveTo(s, id, k, { st: 'failed' });
        // As drawn, retry_wait goes straight to sending with what was composed before
        return RetryRecomposes ? moveTo(s, id, k, { st: 'composing' }) : handOff(t0(s, 'atlas'), id, k);
      }),
      // TIMER nudgeReplyHours. Planted bug noReplyTimer
      slotAction('ReplyTimer', true, (s, id, k, x) => (x.st === 'sent' && Bug !== 'noReplyTimer' ? moveTo(s, id, k, { st: 'unanswered' }) : [])),
      // Planted bug reviveSkipped: a nudge skipped because the kind was off is sent once it is on again
      slotAction('Revive', false, (s, id, k, x) =>
        Bug === 'reviveSkipped' && x.st === 'skipped' && x.why === 'turned_off' && kindOn(s, NUDGES[id].to, NUDGES[id].kind) ? moveTo(s, id, k, { st: 'composing', why: null }) : [],
      ),
      {
        // Kemar replies in the Atlas app. Atlas reads the capture with the nudge as context: it
        // proposes changes to the records the reply is about, and changes none itself (rule 1)
        name: 'Reply',
        params: world.captures.map((c) => [c]),
        step(s, c) {
          if (s.reads[c] >= (Bug === 'replyTwice' ? 2 : 1)) return [];
          if (!all(s).some((o) => NUDGES[o.id].to === 'kemar' && o.x.shown > 0)) return [];
          const q = CAPTURES[c].quote;
          if (q && !s.n[q].some((x) => x.shown > 0)) return [];
          const t = t0(s, 'atlas');
          t.reads[c] = s.reads[c] + 1;
          for (const r of CAPTURES[c].about) t.prop[r] = true;
          // Planted bug replyApplies: "yes, still on" moves #151 without Kemar confirming
          if (Bug === 'replyApplies') t.rec.w151 = true;
          const to = target(s, c);
          if (to) Object.assign(t.n[to.id][to.k], { st: 'replied', ctx: c, fly: null });
          return [t];
        },
      },
      {
        // The owner confirms the proposed change to their record; the right is checked now (rule 4)
        name: 'Confirm',
        params: product(['kemar', 'alicia'], ['w151', 'w160']),
        step(s, by, r) {
          if (!s.prop[r] || by !== OWNER[r] || !member(s, by, 'forager')) return [];
          const t = t0(s, by);
          t.rec[r] = true;
          t.prop[r] = false;
          // Planted bug othersApplied: Kemar's confirm also applies what he said about Alicia's #160
          if (Bug === 'othersApplied' && t.prop.w160) Object.assign(t, { rec: { ...t.rec, w160: true }, prop: { ...t.prop, w160: false } });
          return [t];
        },
      },
      // The world changes under a waiting nudge
      { name: 'RemovedFromForager', params: changes('removed') ? [[]] : [], step: (s) => (s.kemarIn ? [Object.assign(t0(s, 'alicia'), { kemarIn: false })] : []) },
      { name: 'GoesOnLeave', params: changes('leave') ? [[]] : [], step: (s) => (!s.leave ? [Object.assign(t0(s, 'kemar'), { leave: true })] : []) },
      { name: 'WorkingDayEnds', params: changes('late') ? [[]] : [], step: (s) => (!s.late ? [Object.assign(t0(s, 'atlas'), { late: true })] : []) },
      {
        // Kemar updates #151 himself in DPM (PN3)
        name: 'UpdatesItem',
        params: changes('edited') ? [[]] : [],
        step: (s) => (!s.rec.w151 && s.kemarIn ? [Object.assign(t0(s, 'kemar'), { rec: { ...s.rec, w151: true } })] : []),
      },
      {
        // M24: someone switches a kind on or off for Kemar. Leads cannot change other people's settings
        name: 'Switch',
        params: changes('setting') ? product(['kemar', 'alicia', 'dwayne'], ['due']) : [],
        step(s, by, kind) {
          // Planted bug leadChanges: Alicia, as Forager's PM, may switch Kemar's; Dwayne never may
          if (by !== 'kemar' && (Bug !== 'leadChanges' || by === 'dwayne')) return [];
          const t = t0(s, by);
          t.on.kemar[kind] = !s.on.kemar[kind];
          return [t];
        },
      },
    ],
    invariants: {
      // Rule 6: one nudge per (person, kind, subject, day)
      OneNudgePerKey: (s) => world.nudges.every((id) => s.n[id].length <= 1),
      // Rule 6: a retry after a lost answer never shows the nudge twice
      DeliveredOnce: (s) => all(s).every((o) => o.x.shown <= 1),
      // Rule 6: a reply is read once, however often it arrives
      ReadOnce: (s) => world.captures.every((c) => s.reads[c] <= 1),
      // PN4: no more than the daily cap reach a person
      CapHolds: (s) => ['kemar', 'dwayne'].every((p) => all(s).filter((o) => NUDGES[o.id].to === p && o.x.shown > 0).length <= Cap),
    },
    actionProperties: {
      // Section 1, rule 2 of the machines doc: no state change outside the table
      OnlyDrawnArrows: (s, t) =>
        world.nudges.every((id) =>
          t.n[id].every((y, k) => {
            const x = s.n[id][k];
            if (!x) return y.st === 'scheduled';
            return x.st === y.st || arrows.has(`${x.st}>${y.st}`);
          }),
        ),
      // Rule 4: a nudge reaches a person only if they may read every fact in it at that moment,
      // and a record changes only if the person confirming still holds the right
      RightCheckedWhenItRuns: (s, t) =>
        all(t).every((o) => o.x.shown === (s.n[o.id][o.k]?.shown ?? 0) || sees(t, NUDGES[o.id].to, o.x.msg.facts)) &&
        Object.keys(OWNER).every((r) => s.rec[r] === t.rec[r] || t.by === 'atlas' || member(t, t.by, 'forager')),
      // PN1, PN3, PN8, working hours: every send decision holds the guards as they are now
      GuardsHoldWhenSent: (s, t) =>
        all(t).every((o) => {
          if (o.x.tries === (s.n[o.id][o.k]?.tries ?? 0)) return true;
          const nd = NUDGES[o.id];
          return !(o.id === 'due' && t.rec.w151) && !(nd.to === 'kemar' && t.leave) && !t.late && kindOn(t, nd.to, nd.kind);
        }),
      // P10: something they cannot open is never named, counted or hinted at
      NothingHiddenIsHinted: (s, t) => all(t).every((o) => o.x.shown === (s.n[o.id][o.k]?.shown ?? 0) || o.x.msg.count === o.x.msg.facts.length),
      // PN11: an empty brief is not sent
      EmptyNotSent: (s, t) => all(t).every((o) => o.x.shown === (s.n[o.id][o.k]?.shown ?? 0) || o.x.msg.facts.length > 0),
      // Rule 1: nothing Atlas does changes a record
      AtlasNeverChangesARecord: (s, t) => Object.keys(OWNER).every((r) => s.rec[r] === t.rec[r] || t.by !== 'atlas'),
      // Rule 10: what Kemar said about Alicia's #160 changes nothing of hers until she confirms
      YourWordChangesOnlyYours: (s, t) => s.rec.w160 === t.rec.w160 || t.by === 'alicia',
      // PN6: a reply that quotes a nudge it reached answers that nudge
      QuotedReplyGoesToItsNudge: (s, t) =>
        world.captures.every((c) => {
          const q = CAPTURES[c].quote;
          if (!q || s.reads[c] || !t.reads[c]) return true;
          const k = s.n[q].findIndex((x) => x.shown > 0);
          if (FINAL.includes(s.n[q][k].st)) return true;
          return t.n[q][k].st === 'replied' && t.n[q][k].ctx === c;
        }),
      // M24: only Kemar changes Kemar's settings
      OnlyTheyChangeTheirSettings: (s, t) => JSON.stringify(s.on.kemar) === JSON.stringify(t.on.kemar) || t.by === 'kemar',
    },
    leadsTo: {
      // Rule 5: every nudge ends: replied, unanswered, skipped or failed
      NudgeEnds: SLOTS.map(([id, k]) => ({ label: `${id} ${k + 1}`, P: (s) => s.n[id][k]?.st === 'scheduled', Q: (s) => FINAL.includes(s.n[id][k]?.st) })),
    },
  };
}
