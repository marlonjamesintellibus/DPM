// M35 Cover request, phase P of the Atlas conversational plan (use-cases/atlas-conversational-plan.md,
// section 18, edge cases LV1 to LV10, decision CD19). Kemar is going on leave; Atlas offers a cover for
// the work due while he is away, and he picks a teammate to ask:
//   suggested --PICK (Kemar)--> asked
//   asked --ACCEPT (the teammate)--> accepted: a handover (M7) proposed; the PM gets a notice (CD19)   final
//   asked --DECLINE--> declined; Kemar is told and may pick someone else                               final
//   asked --TIMER coverAskHours--> unanswered; Kemar is told                                            final
//   asked --the leave is cancelled--> withdrawn                                                         final
// The seeded world: Forager (Alicia PM; Kemar and Jodian members) and Store Insights (Andre PM; Kemar).
// #151 and #208 are Forager work; the Trend model is Store Insights. Andre is the outsider for Forager,
// Jodian for Store Insights. One request lists items of one project (LV8), so only a teammate who reads
// every one of them may be asked.
//   LV2  a teammate on leave then is refused before asking, when the project shows Kemar that leave (a PM or Lead
//        sees it, CD43); a member is not shown it, so P10 wins and the ask goes (phase P as built)
//   LV3  the dates change: items no longer due while away leave open requests; an empty one is withdrawn
//   LV4  the leave is cancelled after a cover was accepted: the handover is cancelled through M7
//   LV8  one request, several items: accepted together, or each declined
//   LV9  leave not yet approved: the handover waits on the approval
// The admin's decision on the leave is M8's own Ask; it is taken as fair here (M8 settles), so a
// handover that waits on it is stuck only if this machine gives it no way on.
//
// Fixes are the smallest changes to the plan as written that the check showed were needed (none by
// default, which is the plan as written):
//   suggestedWayOut       suggested --TIMER (the leave starts), the leave is cancelled, or DISMISS (Kemar)--> withdrawn
//   declineCancels        the admin declining the leave acts as the leave cancelled
//   leaveProjectWithdraws Kemar or the teammate leaving the project withdraws an open request (as CH10, E77), and
//                         cancels an accepted cover's live handover, waiting or proposed (phase P's check: a
//                         handover that waited must not start for someone off the project, LV9); whichever of
//                         the two still reads every item is told the cover ended
// Rule 4 as built: Accept, Decline and DeclineItem each recheck that both still read every item, and approving
// the leave starts a waiting handover only for two people still on the project.
//   oneCoverPerItem       PICK is refused for an item already in an open or accepted request
import { clone, product, subsets } from '../lib.mjs';

export const FIXES = ['suggestedWayOut', 'declineCancels', 'leaveProjectWithdraws', 'oneCoverPerItem'];

const PROJECT = { i151: 'forager', i208: 'forager', trend: 'insights' };
const ITEMS = Object.keys(PROJECT);
const PM = { forager: 'alicia', insights: 'andre' };
const TEAMMATES = ['jodian', 'alicia', 'andre'];
const REQS = ['r1', 'r2'];
const LIVE_LEAVE = ['requested', 'approved'];
const OPEN = ['suggested', 'asked'];
const FINAL = ['accepted', 'declined', 'unanswered', 'withdrawn'];
const HANDOVER = ['none', 'waiting', 'proposed', 'cancelled'];
const LIVE_HANDOVER = ['waiting', 'proposed'];

// Arrows as the plan draws them; the creation arrow is Atlas offering the cover (section 18)
const ARROWS = ['none>suggested', 'suggested>asked', 'asked>accepted', 'asked>declined', 'asked>unanswered', 'asked>withdrawn'];
// M7, as far as this machine moves it: proposed (waiting on the approval, LV9), cancelled (LV4)
const HANDOVER_ARROWS = ['none>waiting', 'none>proposed', 'waiting>proposed', 'waiting>cancelled', 'proposed>cancelled'];

const request = () => ({ st: 'none', to: null, items: [], sent: 0, handovers: 0, ho: 'none', told: false, notified: false });

export default function CoverRequest({ Fixes = [], Bug = null } = {}) {
  const fix = (f) => Fixes.includes(f);
  const arrows = fix('suggestedWayOut') ? [...ARROWS, 'suggested>withdrawn'] : ARROWS;
  // P10: a person reads an item only on a project they are a member of now
  const reads = (s, p, i) => s.members[PROJECT[i]].includes(p);
  // Rule 4: Kemar and the request's teammate both still read every item it names
  const bothRead = (s, x) => x.items.every((i) => reads(s, x.to, i) && reads(s, 'kemar', i));
  const t0 = (s, by) => Object.assign(clone(s), { by, said: [] });
  const say = (t, to, items, kind) => t.said.push({ to, items: [...items], kind });
  // Items already in an open ask or a live cover (oneCoverPerItem)
  const taken = (s, r) =>
    REQS.filter((q) => q !== r && (s.req[q].st === 'asked' || (s.req[q].st === 'accepted' && LIVE_HANDOVER.includes(s.req[q].ho)))).flatMap((q) => s.req[q].items);

  const pick = (s, r, who, items, by) => {
    const x = s.req[r];
    if (x.st !== 'suggested' || !LIVE_LEAVE.includes(s.leave)) return [];
    if (!items.every((i) => s.due[i] && reads(s, 'kemar', i))) return [];
    // P10, LV8: the teammate reads every item the request names; anyone else is refused in the same
    // words as a name nobody has
    if (Bug !== 'askAnyone' && !items.every((i) => reads(s, who, i))) return [];
    // LV2: refused before asking when the project shows Kemar the teammate's leave
    if (Bug !== 'askAway' && s.away.includes(who) && s.awayShown) return [];
    if (fix('oneCoverPerItem') && items.some((i) => taken(s, r).includes(i))) return [];
    const t = t0(s, by);
    Object.assign(t.req[r], { st: 'asked', to: who, items, sent: 1 });
    say(t, who, items, 'ask');
    return [t];
  };

  // ACCEPT, by the teammate (or, under the planted bug, by the timer)
  const accept = (s, r, by) => {
    const x = s.req[r];
    if (x.st !== 'asked' && !(Bug === 'lateAccept' && x.st === 'unanswered')) return [];
    // Rule 4: checked when it runs. Both still read every item, or the tap is refused
    if (Bug !== 'noRecheck' && !bothRead(s, x)) return [];
    const t = t0(s, by);
    const y = t.req[r];
    Object.assign(y, { st: 'accepted', handovers: 1, ho: s.leave === 'approved' ? 'proposed' : 'waiting' });
    for (const i of y.items) t.cover[i] = y.to;
    // CD19: no OK needed, but the PM is told; only the PM of the request's project
    if (Bug !== 'noNotice') {
      y.notified = true;
      const leads = Bug === 'noticeAllLeads' ? Object.values(PM) : [PM[PROJECT[y.items[0]]]];
      for (const pm of leads) say(t, pm, y.items, 'notice');
    }
    return [t];
  };

  // The handover is cancelled through M7 (LV4), and with it the cover
  const cancelHandover = (t, r) => {
    const y = t.req[r];
    if (!LIVE_HANDOVER.includes(y.ho)) return false;
    y.ho = 'cancelled';
    for (const i of y.items) if (t.cover[i] === y.to) t.cover[i] = null;
    return true;
  };
  // The leave is off: open asks are withdrawn, live handovers cancelled and the teammate told
  const leaveOff = (t) => {
    for (const r of REQS) {
      const y = t.req[r];
      if (y.st === 'asked' || (y.st === 'suggested' && fix('suggestedWayOut'))) y.st = 'withdrawn';
      if (cancelHandover(t, r)) say(t, y.to, y.items, 'cancelled');
    }
  };

  return {
    name: `CoverRequest (${Fixes.length ? `fixes ${Fixes.join(', ')}` : 'as written'}${Bug ? `, bug ${Bug}` : ''})`,
    init: () =>
      // Jodian's leave then: none, shown to Kemar, or not shown to him (he is a member, CD43)
      product(['requested', 'approved'], [[[], false], [['jodian'], true], [['jodian'], false]]).map(([leave, [away, awayShown]]) => ({
        leave,
        away,
        awayShown,
        members: { forager: ['alicia', 'jodian', 'kemar'], insights: ['andre', 'kemar'] },
        due: Object.fromEntries(ITEMS.map((i) => [i, true])),
        cover: Object.fromEntries(ITEMS.map((i) => [i, null])),
        req: Object.fromEntries(REQS.map((r) => [r, request()])),
        by: null,
        said: [],
      })),
    actions: [
      {
        // "I'm off next week": Atlas offers a cover while some item of Kemar's due then has none (LV1:
        // nothing due, nothing offered). After a decline it offers again; requests are taken in order.
        name: 'AtlasOffers',
        params: REQS.map((r) => [r]),
        step(s, r) {
          if (s.req[r].st !== 'none' || (r === 'r2' && s.req.r1.st === 'none') || !LIVE_LEAVE.includes(s.leave)) return [];
          if (REQS.some((q) => s.req[q].st === 'suggested')) return [];
          const free = ITEMS.filter((i) => s.due[i] && reads(s, 'kemar', i) && !taken(s, null).includes(i));
          if (!free.length) return [];
          const t = t0(s, 'atlas');
          t.req[r].st = 'suggested';
          return [t];
        },
      },
      {
        // PICK: Kemar names who to ask and for which items (suggestions wait on phase H).
        // Rule 9: the ask goes out only on his tap; under the planted bug Atlas sends it itself.
        name: 'Pick',
        params: product(REQS, TEAMMATES, subsets(ITEMS).filter((x) => x.length)),
        step: (s, r, who, items) => pick(s, r, who, items, Bug === 'atlasPicks' ? 'atlas' : 'kemar'),
      },
      {
        name: 'Accept',
        params: REQS.map((r) => [r]),
        step: (s, r) => (s.req[r].to ? accept(s, r, s.req[r].to) : []),
      },
      {
        name: 'Decline',
        params: REQS.map((r) => [r]),
        step(s, r) {
          const x = s.req[r];
          if (x.st !== 'asked') return [];
          // Rule 4, P10: the decline names the items to Kemar, so both must still read them
          if (Bug !== 'noRecheck' && !bothRead(s, x)) return [];
          const t = t0(s, x.to);
          Object.assign(t.req[r], { st: 'declined', told: true });
          say(t, 'kemar', x.items, 'declined');
          return [t];
        },
      },
      {
        // LV8: one item of several declined; the rest wait on ACCEPT. The last one declines the request.
        name: 'DeclineItem',
        params: product(REQS, ITEMS),
        step(s, r, i) {
          const x = s.req[r];
          if (x.st !== 'asked' || x.items.length < 2 || !x.items.includes(i)) return [];
          if (Bug !== 'noRecheck' && !bothRead(s, x)) return [];
          const t = t0(s, x.to);
          t.req[r].items = x.items.filter((k) => k !== i);
          say(t, 'kemar', [i], 'declined');
          return [t];
        },
      },
      {
        // TIMER coverAskHours (24)
        name: 'AskTimer',
        params: REQS.map((r) => [r]),
        fair: true,
        step(s, r) {
          const x = s.req[r];
          if (Bug === 'noTimer' || x.st !== 'asked') return [];
          // Planted bug silenceAccepts: no answer is taken as yes
          if (Bug === 'silenceAccepts') return accept(s, r, 'timer');
          const t = t0(s, 'timer');
          t.req[r].st = 'unanswered';
          if (Bug !== 'silentTimeout') {
            t.req[r].told = true;
            say(t, 'kemar', x.items, 'unanswered');
          }
          return [t];
        },
      },
      {
        // suggestedWayOut: the offer lapses when the leave starts
        name: 'OfferLapses',
        params: REQS.map((r) => [r]),
        fair: true,
        step(s, r) {
          if (!fix('suggestedWayOut') || Bug === 'noOfferLapse' || s.req[r].st !== 'suggested') return [];
          const t = t0(s, 'timer');
          t.req[r].st = 'withdrawn';
          return [t];
        },
      },
      {
        // suggestedWayOut, as built (phase P): Kemar says no cover is needed, and the offer ends with nothing asked.
        // Atlas offers again only once something is free again (a decline, no answer, new dates).
        name: 'Dismiss',
        params: REQS.map((r) => [r]),
        step(s, r) {
          if (!fix('suggestedWayOut') || s.req[r].st !== 'suggested') return [];
          const t = t0(s, 'kemar');
          t.req[r].st = 'withdrawn';
          return [t];
        },
      },
      {
        // A repeated tap or delivery of a command already run (rule 6): the same id changes nothing.
        // Under the planted bug it runs again while the request still shows what the first one did.
        name: 'Repeat',
        params: product(REQS, ['pick', 'accept']),
        step(s, r, cmd) {
          const x = s.req[r];
          if (Bug !== 'noDedup') return [];
          if (cmd === 'pick' && x.st === 'asked' && x.sent === 1) {
            const t = t0(s, 'kemar');
            t.req[r].sent = 2;
            say(t, x.to, x.items, 'ask');
            return [t];
          }
          if (cmd === 'accept' && x.st === 'accepted' && x.handovers === 1) {
            const t = t0(s, x.to);
            t.req[r].handovers = 2;
            say(t, PM[PROJECT[x.items[0]]], x.items, 'notice');
            return [t];
          }
          return [];
        },
      },
      {
        // Kemar cancels the leave, requested or approved
        name: 'LeaveCancelled',
        params: [[]],
        step(s) {
          if (!LIVE_LEAVE.includes(s.leave)) return [];
          const t = t0(s, 'kemar');
          t.leave = 'cancelled';
          leaveOff(t);
          return [t];
        },
      },
      {
        // M8: the admin approves or declines a requested leave (taken as fair: M8 settles)
        name: 'AdminDecides',
        params: [['approved'], ['declined']],
        fair: true,
        step(s, to) {
          if (s.leave !== 'requested') return [];
          const t = t0(s, 'admin');
          t.leave = to;
          if (to === 'approved' && Bug !== 'noApprovalHook') {
            // LV9: the handover waited on the approval; it starts, and the teammate is told, only while both
            // still read every item (rule 4)
            for (const r of REQS) {
              const y = t.req[r];
              if (y.ho !== 'waiting' || (Bug !== 'noRecheck' && !bothRead(t, y))) continue;
              y.ho = 'proposed';
              say(t, y.to, y.items, 'handover');
            }
          }
          if (to === 'declined' && fix('declineCancels')) leaveOff(t);
          return [t];
        },
      },
      {
        // LV3: the dates change so an item is no longer due while away
        name: 'DatesChange',
        params: [['i208'], ['trend']],
        step(s, i) {
          if (!s.due[i] || !LIVE_LEAVE.includes(s.leave)) return [];
          const t = t0(s, 'kemar');
          t.due[i] = false;
          if (Bug !== 'keepUndue') {
            for (const r of REQS) {
              const y = t.req[r];
              if (y.st !== 'asked' || !y.items.includes(i)) continue;
              y.items = y.items.filter((k) => k !== i);
              if (!y.items.length) y.st = 'withdrawn';
            }
          }
          return [t];
        },
      },
      {
        // M13: someone leaves a project. The rights are gone from then on.
        name: 'LeavesProject',
        params: [['jodian', 'forager'], ['kemar', 'insights']],
        step(s, who, project) {
          if (!s.members[project].includes(who)) return [];
          const t = t0(s, who);
          t.members[project] = s.members[project].filter((p) => p !== who);
          if (fix('leaveProjectWithdraws')) {
            for (const r of REQS) {
              const y = t.req[r];
              if (!((y.to === who || who === 'kemar') && y.items.some((i) => PROJECT[i] === project))) continue;
              if (y.st === 'asked') y.st = 'withdrawn';
              // Planted bug keepCover: only the ask is withdrawn, as phase P was first built
              else if (y.st === 'accepted' && Bug !== 'keepCover' && cancelHandover(t, r)) {
                for (const p of ['kemar', y.to]) if (y.items.every((i) => reads(t, p, i))) say(t, p, y.items, 'cover_ended');
              }
            }
          }
          return [t];
        },
      },
    ],
    invariants: {
      TypeOK: (s) =>
        REQS.every((r) => {
          const x = s.req[r];
          return ['none', ...OPEN, ...FINAL].includes(x.st) && HANDOVER.includes(x.ho) && (x.st === 'accepted') === (x.handovers > 0);
        }),
      // Once only (rule 6): one ask sent and one handover proposed per request, however often a tap repeats
      EachCommandOnce: (s) => REQS.every((r) => s.req[r].sent <= 1 && s.req[r].handovers <= 1),
      // One item, one cover: no two live covers, and no item asked of two people at once
      OneCoverPerItem: (s) =>
        ITEMS.every(
          (i) => REQS.filter((r) => s.req[r].items.includes(i) && (s.req[r].st === 'asked' || (s.req[r].st === 'accepted' && LIVE_HANDOVER.includes(s.req[r].ho)))).length <= 1,
        ),
      // An offer, an ask or a live handover exists only while the leave is on (LV4, LV9)
      AsksOnlyForLiveLeave: (s) =>
        LIVE_LEAVE.includes(s.leave) || REQS.every((r) => !OPEN.includes(s.req[r].st) && !LIVE_HANDOVER.includes(s.req[r].ho)),
      // LV3: an open ask names only items still due while away
      OpenAsksOnlyForDueItems: (s) => REQS.every((r) => s.req[r].st !== 'asked' || s.req[r].items.every((i) => s.due[i])),
      // LV9, rule 4: a live cover (its handover waiting or proposed) holds only between two people who both
      // still read every item it names
      LiveCoverOnlyForReaders: (s) => REQS.every((r) => s.req[r].st !== 'accepted' || !LIVE_HANDOVER.includes(s.req[r].ho) || bothRead(s, s.req[r])),
      // "Declined; the asker picks someone else", "unanswered; the asker is told"
      AskerToldOfEveryEnd: (s) => REQS.every((r) => !['declined', 'unanswered'].includes(s.req[r].st) || s.req[r].told),
      // CD19: a change of owner never surprises the PM
      PMToldOfEveryCover: (s) => REQS.every((r) => s.req[r].st !== 'accepted' || s.req[r].notified),
    },
    actionProperties: {
      // Machines doc section 1, rule 2: no state change outside the table
      OnlyDrawnArrows: (s, t) =>
        REQS.every((r) => {
          const [a, b] = [s.req[r], t.req[r]];
          return (a.st === b.st || arrows.includes(`${a.st}>${b.st}`)) && (a.ho === b.ho || HANDOVER_ARROWS.includes(`${a.ho}>${b.ho}`));
        }),
      // Rule 1: nothing Atlas or a timer does changes a record (covers, handovers, leave, memberships)
      AtlasChangesNoRecord: (s, t) =>
        !['atlas', 'timer'].includes(t.by) ||
        (JSON.stringify([s.cover, s.leave, s.members]) === JSON.stringify([t.cover, t.leave, t.members]) && REQS.every((r) => s.req[r].ho === t.req[r].ho)),
      // Rule 9: a request to cover goes out only on the tap of the person it comes from
      OutwardConfirmed: (s, t) => t.said.every((m) => m.kind !== 'ask' || t.by === 'kemar'),
      // Rule 10: Kemar's word makes nobody cover; a cover is set only by the one who covers
      CoverOnlyByConsent: (s, t) => ITEMS.every((i) => t.cover[i] === s.cover[i] || t.cover[i] === null || t.by === t.cover[i]),
      // Rule 4: a right lost after the ask is refused when ACCEPT runs
      RightCheckedWhenItRuns: (s, t) =>
        REQS.every((r) => {
          const x = s.req[r];
          return t.req[r].st !== 'accepted' || x.st === 'accepted' || x.items.every((i) => reads(s, x.to, i) && reads(s, 'kemar', i));
        }),
      // P10 and rule 8: every message (the ask, the PM's notice, what Kemar is told) names only items its
      // reader may open when it is sent
      EveryReaderMaySeeIt: (s, t) => t.said.every((m) => m.items.every((i) => reads(t, m.to, i))),
      // LV2: nobody is asked to cover while the project shows Kemar their leave (P10: a leave he is not shown
      // cannot refuse anything)
      NeverAskSomeoneAway: (s, t) => t.said.every((m) => m.kind !== 'ask' || !(t.away.includes(m.to) && t.awayShown)),
    },
    leadsTo: {
      // Rule 5, nothing gets stuck: each waiting state ends, by a timer or a named way out
      AskEnds: REQS.map((r) => ({ label: r, P: (s) => s.req[r].st === 'asked', Q: (s) => s.req[r].st !== 'asked' })),
      OfferEnds: REQS.map((r) => ({ label: r, P: (s) => s.req[r].st === 'suggested', Q: (s) => s.req[r].st !== 'suggested' })),
      HandoverSettles: REQS.map((r) => ({ label: r, P: (s) => s.req[r].ho === 'waiting', Q: (s) => s.req[r].ho !== 'waiting' })),
    },
  };
}
