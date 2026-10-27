// M29 Signal (use-cases/atlas-conversational-plan.md, section 13, phase K). Modelled before it is built.
// One subject on Forager 2.0: Kemar's #151 going stale (Rule 'stale') or one blocker reported again and
// again (Rule 'blocker'). Alicia is the PM, Jodian a Lead, Kemar a member who owns #151, and Andre an
// outsider who is only on Store Insights.
//   (none) ──DETECTED──▶ raised ──ACCEPT──▶ accepted (a risk with the signal's facts as its source)  final
//   raised ──DISMISS(reason)──▶ dismissed ──TIMER signalSnoozeDays──▶ (none); raised again only if worse
//   raised ──CONDITION_GONE──▶ cleared   final;   raised ──TIMER signalExpiryDays──▶ expired   final
// Each signal is one instance; (none) after a dismissal is the instance ending ('ended'), and a later
// DETECTED starts a new instance, as M10 starts a new item for a new episode.
//
// The condition is a level (0 gone, 1 holds, 2 worse: another report, more days) in an episode (it went
// away and came back). Timers, DETECTED (nightly and on save) and CONDITION_GONE are fair; people and
// the world are not.
//
// Memory: what DETECTED remembers of earlier answers.
//   'asDrawn'    only a dismissal is remembered, as a level, and nothing ever forgets it (the plan as written)
//   'perEpisode' accept, dismiss and expiry each remember the level and the episode; a new episode starts
//                fresh (the fix for findings 1 and 2)
// Escalate: the stale work rule says "its owner first, then PM and Leads if no answer", but M29 draws no
// arrow for it. false is the plan as written; true adds raised(owner) ──TIMER──▶ raised(PM and Leads), with
// the expiry clock starting only then (the fix for finding 3).
//
// Found by the check (27 Oct 2026), with the plan as written:
//   1. accepted and expired are final and leave nothing behind, so the next nightly DETECTED raises the
//      same signal on the same facts again (NotRaisedAgainUnchanged)
//   2. "raised again only if worse" has no end: after a dismissal, the same trouble coming back later as a
//      new episode at the same level is never raised (TroubleIsRaised)
//   3. stale work raised to its owner never reaches PM and Leads; the owner has no Accept or Dismiss, so
//      unless they answer "still going" it expires unseen by anyone who can act (StaleWorkReachesLeads)
// SG2 reads as if a worse condition is raised during the snooze; as drawn it waits for the snooze timer.
import { clone, product } from '../lib.mjs';

const LEADS = ['alicia', 'jodian'];
const OWNER = 'kemar';
const LIVE = ['raised', 'dismissed'];
const FINAL = ['accepted', 'cleared', 'expired', 'ended'];
// Only drawn arrows (section 1, rule 2); 'ended' is "dismissed ──TIMER──▶ (none)"
const ARROWS = { raised: ['accepted', 'dismissed', 'cleared', 'expired'], dismissed: ['ended'] };

export default function Signal({ Rule = 'stale', Memory = 'asDrawn', Escalate = false, MaxSignals = 2, MaxEpisodes = 2, Bug = null } = {}) {
  const stale = Rule === 'stale';
  const t0 = (s, by) => Object.assign(clone(s), { by });
  const live = (s) => s.sigs.findIndex((g) => LIVE.includes(g.st));
  const leadsOf = (s) => LEADS.filter((p) => s.roles[p]);
  const canRead = (s, p, project) => s.members[project].includes(p);
  // The answer the ghost remembers: what someone answered (or let expire) in this episode
  const settled = (s) => !!s.ans && s.ans.ep === s.ep && s.lvl <= s.ans.lvl;

  // Leaving raised closes every copy in the inbox (M10: the item closes when its cause leaves). A card
  // left open on a closed signal can only be refused, so it is dropped to keep the model small; the
  // acceptTwice plant keeps it, since a second tap on it is the bug.
  const end = (t, k, st) => {
    Object.assign(t.sigs[k], { st, to: [], ver: t.sigs[k].ver + 1 });
    if (Bug !== 'acceptTwice') for (const p of LEADS) if (t.seen[p]?.k === k) delete t.seen[p];
  };
  const remember = (t, k) => {
    const lvl = t.sigs[k].lvl;
    t.ans = t.ans && t.ans.ep === t.ep ? { ep: t.ep, lvl: Math.max(t.ans.lvl, lvl) } : { ep: t.ep, lvl };
    // Planted bug forgetOnExpiry: an expired signal leaves nothing behind (the ghost above still records it)
    if (Memory === 'perEpisode' && !(Bug === 'forgetOnExpiry' && t.sigs[k].st === 'expired')) t.mem = { ep: t.ep, lvl };
  };

  return {
    name: `Signal (${Rule}, memory ${Memory}${stale ? `, escalate ${Escalate}` : ''}${Bug ? `, bug ${Bug}` : ''})`,
    init: () => [
      {
        lvl: 0,
        ep: 0,
        away: false,
        roles: { alicia: 'pm', jodian: 'lead' },
        members: { forager: ['alicia', 'jodian', 'kemar'], insights: ['andre'] },
        sigs: [],
        seen: {},
        mem: null,
        ans: null,
        work: { restarts: 0 },
        braid: [],
        by: null,
      },
    ],
    actions: [
      {
        // DETECTED: the rule runs nightly and on save. One live signal per (project, rule, subject).
        name: 'Detect',
        params: [[]],
        fair: true,
        step(s) {
          if (s.lvl === 0 || s.sigs.length >= MaxSignals) return [];
          if (live(s) >= 0 && Bug !== 'noKey') return [];
          if (stale && s.away && Bug !== 'raiseOnLeave') return []; // SG4: not raised while the owner is away
          // "Raised again only if worse": as drawn, against the level dismissed at; with the fix, against
          // the last answer in this episode
          if (Memory === 'asDrawn' && s.mem && s.lvl <= s.mem.lvl) return [];
          if (Memory === 'perEpisode' && s.mem && (Bug === 'ignoreEpisode' || s.mem.ep === s.ep) && s.lvl <= s.mem.lvl) return [];
          const t = t0(s, 'atlas');
          const stage = stale ? 'owner' : 'leads';
          const id = `s${s.sigs.length + 1}`;
          t.sigs.push({
            id,
            st: 'raised',
            lvl: s.lvl,
            ver: 1,
            stage,
            to: stage === 'owner' ? [OWNER] : leadsOf(s),
            // The text is a template over these facts; every one must be Forager's (P10)
            facts: Bug === 'leakFact' ? ['forager', 'insights'] : ['forager'],
          });
          // A signal is never a BRAID entry by itself
          if (Bug === 'atlasProposes') t.braid.push({ from: id, by: 'atlas', lvl: s.lvl });
          return [t];
        },
      },
      {
        // The rule on save sees it get worse: the live signal's text moves on, and its version
        name: 'Refresh',
        params: [[]],
        fair: true,
        step(s) {
          const k = live(s);
          if (k < 0 || s.sigs[k].st !== 'raised' || s.sigs[k].lvl >= s.lvl) return [];
          const t = t0(s, 'atlas');
          Object.assign(t.sigs[k], { lvl: s.lvl, ver: s.sigs[k].ver + 1 });
          return [t];
        },
      },
      {
        // CONDITION_GONE, checked on read and nightly (SG1)
        name: 'ConditionGone',
        params: [[]],
        fair: true,
        step(s) {
          if (s.lvl !== 0) return [];
          const t = t0(s, 'atlas');
          let moved = false;
          s.sigs.forEach((g, k) => {
            const from = Bug === 'goneClearsAny' ? ['raised', 'accepted', 'expired'] : ['raised'];
            if (from.includes(g.st)) {
              end(t, k, 'cleared');
              moved = true;
            }
          });
          return moved ? [t] : [];
        },
      },
      {
        // TIMER signalExpiryDays. With Escalate, the clock starts when PM and Leads have it.
        name: 'Expire',
        params: [[]],
        fair: true,
        step(s) {
          const k = live(s);
          if (Bug === 'noExpiry' || k < 0 || s.sigs[k].st !== 'raised') return [];
          if (Escalate && s.sigs[k].stage === 'owner' && Bug !== 'expireAtOwner') return [];
          const t = t0(s, 'atlas');
          end(t, k, 'expired');
          remember(t, k);
          return [t];
        },
      },
      {
        // Not drawn in M29: stale work goes to its owner first, then to PM and Leads if no answer
        name: 'Escalate',
        params: [[]],
        fair: true,
        step(s) {
          const k = live(s);
          if (!Escalate || k < 0 || s.sigs[k].st !== 'raised' || s.sigs[k].stage !== 'owner') return [];
          const t = t0(s, 'atlas');
          Object.assign(t.sigs[k], { stage: 'leads', to: leadsOf(s), ver: s.sigs[k].ver + 1 });
          return [t];
        },
      },
      {
        // TIMER signalSnoozeDays: dismissed ──▶ (none)
        name: 'SnoozeOver',
        params: [[]],
        fair: true,
        step(s) {
          const k = s.sigs.findIndex((g) => g.st === 'dismissed');
          if (k < 0) return [];
          const t = t0(s, 'atlas');
          t.sigs[k].st = 'ended';
          return [t];
        },
      },
      {
        // Someone opens the inbox item: the card shows this version (an answer is a snapshot)
        name: 'Open',
        // Only a holder of a copy can open it; Kemar's copy of stale work has no Accept or Dismiss
        params: LEADS.map((p) => [p]),
        step(s, p) {
          const k = s.sigs.findIndex((g) => g.st === 'raised' && g.to.includes(p));
          if (k < 0) return [];
          const card = { k, ver: s.sigs[k].ver };
          if (JSON.stringify(s.seen[p]) === JSON.stringify(card)) return [];
          const t = t0(s, p);
          t.seen[p] = card;
          return [t];
        },
      },
      {
        // ACCEPT and DISMISS(reason), from the card the person saw. Right and version are checked now (rule 4).
        name: 'Answer',
        params: product(LEADS, ['accept', 'dismiss']),
        step(s, p, choice) {
          const card = s.seen[p];
          if (!card) return [];
          // Planted bug rightWhenShown: having been shown the card counts as the right
          if (!s.roles[p] && Bug !== 'rightWhenShown') return [];
          const g = s.sigs[card.k];
          const t = t0(s, p);
          // Planted bug acceptTwice: the risk is filed before the transition checks the arrow,
          // so a second tap files a second one (two at most, so the model stays finite)
          let filed = false;
          if (Bug === 'acceptTwice' && choice === 'accept' && s.braid.filter((b) => b.from === g.id).length < 2) {
            t.braid.push({ from: g.id, by: p, lvl: g.lvl });
            filed = true;
          }
          const fresh = card.ver === g.ver || Bug === 'noVersionCheck';
          if (g.st !== 'raised' || !fresh) return filed ? [t] : []; // SG6: the second answer is told, nothing changes
          end(t, card.k, choice === 'accept' ? 'accepted' : 'dismissed');
          if (choice === 'accept' && !filed) t.braid.push({ from: g.id, by: Bug === 'fileAsOwner' && stale ? OWNER : p, lvl: g.lvl });
          if (choice === 'dismiss' && Memory === 'asDrawn') t.mem = { lvl: g.lvl };
          remember(t, card.k);
          return [t];
        },
      },
      {
        // SG8: the owner answers "still going"; the item's clock restarts, so the condition is gone.
        // Rule 10: Alicia saying "Kemar's still on it" changes nothing of his.
        name: 'StillGoing',
        params: stale ? [['kemar'], ['alicia']] : [],
        step(s, p) {
          if (s.lvl === 0) return [];
          if (p !== OWNER && Bug !== 'othersRestart') return [];
          const t = t0(s, p);
          t.lvl = 0;
          t.work.restarts++;
          return [t];
        },
      },
      // The world: the condition gets worse, goes away (a mention, a resolve), or comes back as a new episode
      { name: 'Worse', params: [[]], step: (s) => (s.lvl === 1 ? [Object.assign(t0(s, 'world'), { lvl: 2 })] : []) },
      { name: 'Gone', params: [[]], step: (s) => (s.lvl > 0 ? [Object.assign(t0(s, 'world'), { lvl: 0 })] : []) },
      {
        name: 'Returns',
        params: [[]],
        step: (s) => (s.lvl === 0 && s.ep < MaxEpisodes ? [Object.assign(t0(s, 'world'), { lvl: 1, ep: s.ep + 1 })] : []),
      },
      {
        // SG4: Kemar goes on leave and comes back
        name: 'Leave',
        params: stale ? [[true], [false]] : [],
        step: (s, away) => (s.away !== away ? [Object.assign(t0(s, OWNER), { away })] : []),
      },
      {
        // SG9: a PM or Lead leaves Forager; their copy closes, others keep theirs
        name: 'LeavesProject',
        params: LEADS.map((p) => [p]),
        step(s, p) {
          if (!s.roles[p]) return [];
          const t = t0(s, 'world');
          delete t.roles[p];
          t.members.forager = s.members.forager.filter((x) => x !== p);
          if (Bug !== 'keepCopy') for (const g of t.sigs) g.to = g.to.filter((x) => x !== p);
          return [t];
        },
      },
    ],
    invariants: {
      // One live signal per (project, rule, subject)
      OneLivePerSubject: (s) => s.sigs.filter((g) => LIVE.includes(g.st)).length <= 1,
      // Once only: a signal becomes at most one risk, however often Accept is tapped
      OneRiskPerSignal: (s) => new Set(s.braid.map((b) => b.from)).size === s.braid.length,
      // P10, rule 8: everyone holding a copy may see every fact in it
      EveryReaderMaySeeEveryFact: (s) =>
        s.sigs.every((g) => g.to.every((p) => g.facts.every((f) => canRead(s, p, f)))),
    },
    actionProperties: {
      // Rule 2: only drawn arrows; a final signal never changes; new signals start raised
      OnlyDrawnArrows: (s, t) =>
        s.sigs.every((g, k) => {
          const h = t.sigs[k];
          if (!h) return false;
          if (FINAL.includes(g.st)) return JSON.stringify(g) === JSON.stringify(h);
          return h.st === g.st || ARROWS[g.st].includes(h.st);
        }) && t.sigs.slice(s.sigs.length).every((h) => h.st === 'raised'),
      // Rule 6: running the rule again over facts someone already answered (or let expire) raises nothing
      NotRaisedAgainUnchanged: (s, t) => t.sigs.length === s.sigs.length || !settled(s),
      // Rule 4: an answer needs the right at the moment it runs...
      RightCheckedWhenItRuns: (s, t) =>
        s.sigs.every((g, k) => g.st !== 'raised' || ['raised', 'cleared', 'expired'].includes(t.sigs[k].st) || !!s.roles[t.by]),
      // ...and is refused when the signal changed after the card was shown (SG6)
      AnswerOnCurrentCard: (s, t) =>
        s.sigs.every((g, k) => g.st !== 'raised' || !['accepted', 'dismissed'].includes(t.sigs[k].st) || s.seen[t.by]?.ver === g.ver),
      // Rule 1: Atlas never changes a record; a signal is never a BRAID entry by itself
      AtlasChangesNoRecord: (s, t) =>
        t.by !== 'atlas' || (JSON.stringify(s.work) === JSON.stringify(t.work) && JSON.stringify(s.braid) === JSON.stringify(t.braid)),
      // Rule 10: only Kemar's word moves Kemar's work; a risk is filed in the name of whoever accepted it
      YourWordOnlyYours: (s, t) =>
        (JSON.stringify(s.work) === JSON.stringify(t.work) || t.by === OWNER) &&
        t.braid.slice(s.braid.length).every((b) => b.by === t.by),
      // SG4: stale work is not raised while its owner is away
      NotRaisedWhileAway: (s, t) => !stale || !s.away || t.sigs.length === s.sigs.length,
    },
    leadsTo: {
      // Rule 5: nothing gets stuck; every raised or dismissed signal ends
      NothingStuck: Array.from({ length: MaxSignals }, (_, k) => [
        { label: `s${k + 1} raised`, P: (s) => s.sigs[k]?.st === 'raised', Q: (s) => s.sigs[k]?.st !== 'raised' },
        { label: `s${k + 1} dismissed`, P: (s) => s.sigs[k]?.st === 'dismissed', Q: (s) => s.sigs[k]?.st !== 'dismissed' },
      ]).flat(),
      // Trouble nobody has answered in this episode is raised to someone (bounded by MaxSignals)
      TroubleIsRaised: [
        {
          label: 'the condition',
          P: (s) => s.lvl > 0 && !(stale && s.away) && live(s) < 0 && s.sigs.length < MaxSignals && !settled(s),
          Q: (s) => live(s) >= 0 || s.lvl === 0 || (stale && s.away),
        },
      ],
      // Section 13's table: stale work goes to its owner first, then to PM and Leads if no answer.
      // The owner's answer ("still going") ends it as cleared.
      ...(stale
        ? {
            StaleWorkReachesLeads: Array.from({ length: MaxSignals }, (_, k) => ({
              label: `s${k + 1}`,
              P: (s) => s.sigs[k]?.st === 'raised' && s.sigs[k].stage === 'owner',
              Q: (s) => s.sigs[k]?.stage === 'leads' || s.sigs[k]?.st === 'cleared',
            })),
          }
        : {}),
    },
  };
}
