// M25 Draft (Ask), the M11 shape (use-cases/atlas-conversational-plan.md, section 9, phase G).
// Atlas drafts text from DPM's facts; the person edits it, then copies or posts it. Alicia is the PM
// on Forager; Kemar is a member there and on Store Insights, where Alicia is not. The client reads
// only the client view. One draft per run, of any kind the two of them can ask for:
//   my standup (anyone, posted to the Forager group), client status (PM or Lead, for the client),
//   weekly summary (PM or Lead, posted to the Forager group).
// The table as the plan draws it:
//   requested --DRAFTED (passes the facts check)--> ready
//   requested --DRAFTED (fails) or DRAFT_FAILED--> retry, then plain (a template from the facts, no model)
//   ready --EDIT--> ready;  --COPY--> copied;  --POST (confirm, the right to post there)--> posted;
//   ready --DISCARD--> discarded;  --TIMER draftExpiryHours--> expired
// Timers are events. The model may never answer, so its replies are not fair; the timers are.
// Options:
//   ModelTimer  a timer on requested that counts as DRAFT_FAILED (not drawn in the plan)
//   ReaderCheck POST, and COPY of a client status, recheck every fact against every reader there, now (rule 8)
//   Refresh     DR5's Refresh (ready -> requested, edits kept aside): 'undrawn' as the plan has it, 'drawn', or 'none'
// Found by the check (27 Oct 2026), all three options off as the plan has them:
//   a model that never answers leaves the draft in requested forever (rule 5); Kemar's standup, which
//   holds Store Insights work, can be posted to the Forager group, where Alicia may not see it (rule 8);
//   a client status copied after the milestone was hidden carries it to the client (rule 8, DR4);
//   and DR5's Refresh needs an arrow the table does not draw (rule 2).
import { clone, product } from '../lib.mjs';

const TRIES = 2;
const PEOPLE = ['kemar', 'alicia'];
const KINDS = ['standup', 'client', 'weekly'];
const DEST = { standup: 'group', client: 'client', weekly: 'group' };

// The arrows the plan draws (none -> requested is the request itself; requested -> requested is a retry)
const DRAWN = ['none>requested', 'requested>requested', 'requested>ready', 'ready>ready', 'ready>copied', 'ready>posted', 'ready>discarded', 'ready>expired'];

// What each fact is about. A quote from someone else's update and a fact the model made up are never
// DPM facts a draft may hold (DR2, DR7, CD8)
const ABOUT = { ms: 'forager', reason: 'forager', risk: 'forager', w151: 'forager', si: 'si', quote: 'forager' };
// Who owns each record a draft talks about (rule 10)
const OWNER = { w151: 'kemar', ms: 'alicia' };
// The facts each kind of draft is built from, before the per-viewer filter
const WANTS = { standup: { kemar: ['w151', 'si'], alicia: ['ms'] }, client: ['ms', 'reason'], weekly: ['ms', 'reason', 'risk', 'w151'] };

const role = (s, p, person) => s.roles[p][person] ?? null;
const lead = (s, person) => ['pm', 'lead'].includes(role(s, 'forager', person));
const reads = (s, person, f) => f in ABOUT && !!role(s, ABOUT[f], person);
// The client view: client-visible milestones, and the reason only when the PM marks it shareable (DR4)
const clientView = (s) => [...(s.world.msVisible ? ['ms'] : []), ...(s.world.reasonShared ? ['reason'] : [])];
const readers = (s, dest) => (dest === 'client' ? ['client'] : Object.keys(s.roles.forager));
const readerSees = (s, reader, f) => (reader === 'client' ? clientView(s).includes(f) : reads(s, reader, f));
const allSee = (s, dest, facts) => facts.every((f) => readers(s, dest).every((r) => readerSees(s, r, f)));
const subset = (a, b) => a.every((x) => b.includes(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// DR3: a client status or weekly summary is for the PM or a Lead only
const mayAsk = (s, person, kind) => kind === 'standup' || lead(s, person);
// The right to post there: a member of the group for a standup, the PM or a Lead otherwise
const mayPost = (s, person, kind) => (kind === 'standup' ? !!role(s, 'forager', person) : lead(s, person));

export default function Draft({ ModelTimer = false, ReaderCheck = false, Refresh = 'undrawn', Bug = null } = {}) {
  // by is set only on a step that changes a record or posts, so the properties can ask who did it
  const t0 = (s) => Object.assign(clone(s), { by: null, ev: null });
  const set = (s, patch) => [Object.assign(t0(s), { d: { ...s.d, ...patch } })];

  // The facts given to Atlas, read through the per-viewer queries when the job runs
  const given = (s, owner, kind) => {
    let fs = kind === 'standup' ? WANTS.standup[owner] : WANTS[kind];
    if (kind === 'client') fs = Bug === 'clientGetsInternals' ? WANTS.weekly : fs.filter((f) => clientView(s).includes(f));
    if (Bug !== 'notPerViewer') fs = fs.filter((f) => reads(s, owner, f));
    if (Bug === 'quotesGiven') fs = [...fs, 'quote'];
    return [...new Set(fs)].sort();
  };
  const start = (t) => {
    Object.assign(t.d, { st: 'requested', attempt: 1, given: given(t, t.d.owner, t.d.kind), facts: [], plain: false, confirm: 'none' });
    // Kept only for the planted bug readerCheckAtDraft: the client view as it was when drafted
    if (Bug === 'readerCheckAtDraft') t.d.view = clientView(t);
    return t;
  };
  // A reply that fails the facts check, or DRAFT_FAILED: try again, then the plain template
  const failed = (t) => {
    if (t.d.attempt < TRIES) t.d.attempt += 1;
    else Object.assign(t.d, { st: 'ready', facts: [...t.d.given], plain: true });
    return t;
  };
  const readersOk = (s) => {
    if (!ReaderCheck) return true;
    const w = Bug === 'readerCheckAtDraft' ? { msVisible: s.d.view.includes('ms'), reasonShared: s.d.view.includes('reason') } : s.world;
    return allSee({ ...s, world: w }, DEST[s.d.kind], s.d.facts);
  };
  const post = (t, by) => {
    Object.assign(t.d, { st: 'posted', posts: t.d.posts + 1 });
    t.by = by;
    // Planted bug postApplies: Alicia's weekly summary says #151 is done, and that marks it done
    if (Bug === 'postApplies' && t.d.kind === 'weekly') t.rec.w151 = 'done';
    return t;
  };
  // POST runs: the right to post there is checked now (rule 4), and with ReaderCheck every reader there (rule 8)
  const runPost = (s, t) => {
    const right = Bug === 'rightAtAsk' ? s.d.askRight : mayPost(s, s.d.owner, s.d.kind);
    // Refused otherwise ("You can no longer post this"); the draft is unchanged
    return right && readersOk(s) ? post(t, s.d.owner) : t;
  };

  const actions = [
    {
      // DR3: the right is checked when the request runs; a member asking for a client status gets no draft
      name: 'Request',
      params: product(PEOPLE, KINDS),
      step(s, owner, kind) {
        if (s.d.st !== 'none') return [];
        if (!mayAsk(s, owner, kind) && Bug !== 'noRoleCheck') return [];
        const t = t0(s);
        Object.assign(t.d, { owner, kind });
        return [start(t)];
      },
    },
    {
      // DRAFTED: the model answers for one attempt, with the facts it was given or with one it made up (DR2).
      // Only the attempt the draft is on counts; a late reply changes nothing (rule 6)
      name: 'Drafted',
      params: product([1, 2], ['good', 'adds']),
      step(s, attempt, outcome) {
        const current = s.d.st === 'requested' && attempt === s.d.attempt;
        const late = ['requested', 'ready'].includes(s.d.st) && attempt <= s.d.attempt;
        if (!current && !(Bug === 'noAttemptCheck' && late)) return [];
        const t = t0(s);
        if (!current) t.ev = 'stale';
        const facts = outcome === 'good' ? [...s.d.given] : [...s.d.given, 'invented'].sort();
        if (!subset(facts, s.d.given) && Bug !== 'noFactsCheck') return [failed(t)];
        Object.assign(t.d, { st: 'ready', facts, plain: false, edited: false });
        // Planted bug draftApplies: "#151 is done" in Kemar's standup marks #151 done
        if (Bug === 'draftApplies' && s.d.kind === 'standup' && facts.includes('w151')) Object.assign(t, { by: 'atlas', rec: { ...t.rec, w151: 'done' } });
        return [t];
      },
    },
    {
      // DRAFT_FAILED: a model error, or no model connected (DR6)
      name: 'DraftFailed',
      params: [[1], [2]],
      step: (s, attempt) => (s.d.st === 'requested' && attempt === s.d.attempt ? [failed(t0(s))] : []),
    },
    {
      // Not drawn in the plan: the model may never answer, so a timer counts as DRAFT_FAILED
      name: 'ModelTimer',
      params: ModelTimer ? [[]] : [],
      fair: true,
      step: (s) => (s.d.st === 'requested' ? [failed(t0(s))] : []),
    },
    {
      // EDIT: the person rewrites their own words, or takes a fact out; Atlas adds nothing
      name: 'Edit',
      params: [['words'], ['ms'], ['w151'], ['si'], ['invented']],
      step: (s, cut) =>
        s.d.st !== 'ready' || (cut !== 'words' && !s.d.facts.includes(cut)) ? [] : set(s, { edited: true, facts: s.d.facts.filter((f) => f !== cut) }),
    },
    {
      // COPY: a client status goes to the client this way (copying does not wait on B8, B9)
      name: 'Copy',
      params: [[]],
      step(s) {
        if (s.d.st !== 'ready' && !(Bug === 'copyAfterExpiry' && s.d.st === 'expired')) return [];
        if (s.d.kind === 'client' && !readersOk(s)) return [];
        return set(s, { st: 'copied' });
      },
    },
    {
      // POST, first half: the person taps Post and a confirm shows
      name: 'AskPost',
      params: [[]],
      step(s) {
        if (s.d.st !== 'ready' || s.d.confirm !== 'none') return [];
        // Kept only for the planted bug rightAtAsk: the right as it was at the tap
        return set(s, { confirm: 'shown', ...(Bug === 'rightAtAsk' ? { askRight: mayPost(s, s.d.owner, s.d.kind) } : {}) });
      },
    },
    {
      // POST, second half: the person confirms; posted once only, by draft id (DR8)
      name: 'Confirm',
      params: [[]],
      step(s) {
        if (s.d.confirm !== 'shown') return [];
        const t = t0(s);
        t.d.confirm = 'done';
        return [s.d.st === 'ready' ? runPost(s, t) : t];
      },
    },
    {
      // The same confirm arrives again (a double tap, or a retried request after a lost reply)
      name: 'ConfirmAgain',
      params: [[]],
      step(s) {
        // Two posts are enough to show the bug, and keep the model finite
        if (s.d.confirm !== 'done' || Bug !== 'noOnceOnly' || s.d.posts >= 2) return [];
        const t = t0(s);
        t.ev = 'stale';
        return [runPost(s, t)];
      },
    },
    { name: 'Discard', params: [[]], step: (s) => (s.d.st === 'ready' ? set(s, { st: 'discarded' }) : []) },
    {
      // TIMER config.draftExpiryHours
      name: 'ExpiryTimer',
      params: Bug === 'noExpiry' ? [] : [[]],
      fair: true,
      step: (s) => (s.d.st === 'ready' ? set(s, { st: 'expired' }) : []),
    },
    {
      // DR5: the facts changed; Refresh redrafts from the facts now, the person's edits kept aside.
      // It runs like a request, so the right is checked again
      name: 'Refresh',
      params: Refresh === 'none' ? [] : [[]],
      step(s) {
        if (s.d.st !== 'ready') return [];
        if (!mayAsk(s, s.d.owner, s.d.kind) && Bug !== 'noRoleCheck') return [];
        const t = t0(s);
        Object.assign(t.d, { aside: s.d.edited, edited: false });
        return [start(t)];
      },
    },
    // The world moves while the draft waits: roles (set by the project owner), the client view, and Kemar's own work
    { name: 'AliciaDemoted', params: [[]], step: (s) => (lead(s, 'alicia') ? [Object.assign(t0(s), { roles: { ...s.roles, forager: { ...s.roles.forager, alicia: 'member' } } })] : []) },
    { name: 'KemarLeavesSI', params: [[]], step: (s) => (role(s, 'si', 'kemar') ? [Object.assign(t0(s), { roles: { ...s.roles, si: {} } })] : []) },
    { name: 'HideMilestone', params: [[]], step: (s) => (s.world.msVisible ? [Object.assign(t0(s), { world: { ...s.world, msVisible: false } })] : []) },
    { name: 'UnshareReason', params: [[]], step: (s) => (s.world.reasonShared ? [Object.assign(t0(s), { world: { ...s.world, reasonShared: false } })] : []) },
    { name: 'KemarFinishes', params: [[]], step: (s) => (s.rec.w151 === 'doing' ? [Object.assign(t0(s), { by: 'kemar', rec: { ...s.rec, w151: 'done' } })] : []) },
  ];
  if (Bug === 'autoPost') {
    // Planted bug autoPost: Atlas posts a ready standup to the group by itself
    actions.push({ name: 'AtlasPosts', params: [[]], step: (s) => (s.d.st === 'ready' && s.d.kind === 'standup' ? [post(t0(s), 'atlas')] : []) });
  }

  return {
    name: `Draft (ModelTimer = ${ModelTimer}, ReaderCheck = ${ReaderCheck}, Refresh = ${Refresh}${Bug ? `, bug ${Bug}` : ''})`,
    init: () => [
      {
        roles: { forager: { alicia: 'pm', kemar: 'member' }, si: { kemar: 'member' } },
        world: { msVisible: true, reasonShared: true },
        rec: { w151: 'doing', ms: 'on_track' },
        d: { owner: null, kind: null, st: 'none', attempt: 0, given: [], facts: [], plain: false, edited: false, aside: false, confirm: 'none', posts: 0 },
        by: null,
        ev: null,
      },
    ],
    actions,
    invariants: {
      // Rule 2, DR2: every fact in a draft is one of the facts it was given
      FactsFromDPM: (s) => subset(s.d.facts, s.d.given),
      // DR7, CD8: never a quote from someone's update, even one the asker may see
      NoQuotes: (s) => !s.d.facts.includes('quote') && !s.d.given.includes('quote'),
      // DR8: posted once only, by draft id
      OncePosted: (s) => s.d.posts <= 1,
    },
    actionProperties: {
      // Section 1, rule 2: no state changes outside the table
      OnlyDrawnArrows: (s, t) => s.d.st === t.d.st || DRAWN.includes(`${s.d.st}>${t.d.st}`) || (Refresh === 'drawn' && s.d.st === 'ready' && t.d.st === 'requested'),
      // Rule 6: a repeated event or command (a late reply, a confirm sent twice) changes nothing
      RepeatChangesNothing: (s, t) => t.ev !== 'stale' || same({ ...s, ev: null, by: null }, { ...t, ev: null, by: null }),
      // Rule 4, DR3: a draft for the PM or a Lead runs only for someone who holds that role then
      RequestOnlyWithRight: (s, t) => t.d.st !== 'requested' || s.d.st === 'requested' || mayAsk(t, t.d.owner, t.d.kind),
      // Rule 4: a right lost after the Post tap is refused
      PostedOnlyWithRight: (s, t) => t.d.posts === s.d.posts || mayPost(t, t.d.owner, t.d.kind),
      // P10: every fact given to Atlas is one the asker may read when the job runs
      OwnerMaySeeEveryFact: (s, t) => same(t.d.given, s.d.given) || t.d.given.every((f) => reads(t, t.d.owner, f)),
      // DR4: a client status is built from the client view only, never BRAID internals
      ClientDraftOnlyClientFacts: (s, t) => t.d.kind !== 'client' || same(t.d.given, s.d.given) || subset(t.d.given, clientView(t)),
      // Rule 8: what goes out (a post, a client status copied for the client) holds only facts every reader there may see now
      EveryReaderMaySeeEveryFact: (s, t) =>
        (t.d.posts === s.d.posts || allSee(t, DEST[t.d.kind], t.d.facts)) &&
        (t.d.st !== 'copied' || s.d.st === 'copied' || t.d.kind !== 'client' || allSee(t, 'client', t.d.facts)),
      // Rule 9: a post goes out only when the person it comes from confirms it
      OutwardIsConfirmed: (s, t) => t.d.posts === s.d.posts || t.by === t.d.owner,
      // Rule 1: nothing Atlas does changes a record; a record changes only on a person's own step
      AtlasNeverChangesARecord: (s, t) => same(s.rec, t.rec) || PEOPLE.includes(t.by),
      // Rule 10: a record changes only by its owner; a draft saying something about Kemar changes nothing of his
      OthersRecordsUntouched: (s, t) => Object.keys(OWNER).every((r) => s.rec[r] === t.rec[r] || t.by === OWNER[r]),
    },
    leadsTo: {
      // Rule 5: every waiting state has a timer or a named way out
      DraftEnds: [
        { label: 'requested', P: (s) => s.d.st === 'requested', Q: (s) => s.d.st !== 'requested' },
        { label: 'ready', P: (s) => s.d.st === 'ready', Q: (s) => s.d.st !== 'ready' },
      ],
    },
  };
}
