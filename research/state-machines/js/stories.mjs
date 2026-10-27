// DPM stories, replayed by the checker (replay() in checker.mjs).
// Each story is one way things can go, told with the Intellibus snapshot (KB Part B).
// Each one has a planted bug that must make its replay fail.
//
// rows: what the story watches. "shape" is the machine's shape on the map.
// values: how a raw model value reads on the page.
import Capture from './models/capture.mjs';
import TrackedStatus from './models/trackedStatus.mjs';
import AtlasAction from './models/atlasAction.mjs';
import HelpRequest from './models/helpRequest.mjs';
import BraidEntry from './models/braidEntry.mjs';
import Routing from './models/routing.mjs';
import CaptureSave from './models/captureSave.mjs';
import InboxItem from './models/inboxItem.mjs';
import Match from './models/match.mjs';

const CAP = {
  waiting: 'Not sent',
  received: 'Received',
  parsing: 'Being read',
  needs_clarification: 'Asking 1 question',
  proposed: 'Proposed',
  partially_confirmed: 'Being reviewed',
  applied: 'Saved',
  rejected: 'Rejected',
};
const UPD = { proposed: 'Needs your OK', accepted: 'Accepted', edited: 'Edited', rejected: 'Rejected' };
const APPLIED = { 0: 'Not on the plan', 1: 'On the plan once', 2: 'On the plan twice' };
const STATUS = {
  not_started: 'Not started',
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  done: 'Done',
  none: 'None',
};
const ACT = {
  requested: 'Requested',
  awaiting_approval: 'Waiting for approval',
  approved: 'Approved',
  executing: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  undone: 'Undone',
};

// Kemar's message from KB A9.1, cut to 2 of its updates
const KEMAR_START = (s) => s.conf.u1 === 'high' && s.conf.u2 === 'medium';
const KEMAR_ROWS = (c, label) => ({
  [`cap.${c}`]: { label, machine: 'Capture processing', shape: 'job', values: CAP },
  [`upd.${c}.u1`]: { label: 'Update: Google Trends source is done (High)', machine: 'Extracted update', shape: 'ask', values: UPD },
  [`upd.${c}.u2`]: { label: 'Update: trend model slips a day (Medium)', machine: 'Extracted update', shape: 'ask', values: UPD },
  'applied.u1': { label: 'Google Trends source on the plan', machine: 'Apply update', shape: 'job', values: APPLIED },
  'applied.u2': { label: 'Trend model forecast on the plan', machine: 'Apply update', shape: 'job', values: APPLIED },
});

export const STORIES = [
  {
    id: 'kemar-update',
    tab: "Kemar's update",
    area: 'atlas',
    summary:
      'Kemar sends a message in Atlas about Forager 2.0. Atlas finds 2 updates: one it is sure of, one it is not. Nothing reaches the plan until Kemar confirms.',
    refs: ['A3', 'A9.2', 'C1'],
    people: ['Kemar sees', 'Alicia sees'],
    model: Capture({ Dedup: true }),
    start: KEMAR_START,
    rows: KEMAR_ROWS('atlas', "Kemar's Atlas message"),
    steps: [
      {
        title: 'Kemar sends an Atlas message',
        sees: ['Sent to Atlas', 'Nothing yet'],
        moves: [['Arrive', 'atlas']],
        expect: { 'cap.atlas': 'received' },
      },
      {
        title: 'Atlas reads it',
        sees: ['Atlas is reading your update', 'Nothing yet'],
        moves: [['Parse', 'atlas']],
        expect: { 'cap.atlas': 'parsing' },
      },
      {
        title: 'Atlas proposes 2 updates',
        sees: ['Review my update: 1 needs your OK', 'Nothing yet'],
        moves: [['Propose', 'atlas']],
        expect: { 'cap.atlas': 'proposed', 'upd.atlas.u1': 'accepted', 'upd.atlas.u2': 'proposed' },
      },
      {
        title: 'Kemar confirms the slip',
        sees: ['2 of 2 ready to save', 'Nothing yet'],
        moves: [['PersonMarks', 'atlas', 'u2', 'accepted']],
        expect: { 'cap.atlas': 'partially_confirmed', 'upd.atlas.u2': 'accepted' },
      },
      {
        title: 'Kemar taps Save',
        sees: ['Saved', 'Forager 2.0: 2 updates from Kemar, via Atlas'],
        moves: [['Save', 'atlas']],
        expect: { 'cap.atlas': 'applied', 'applied.u1': 1, 'applied.u2': 1 },
      },
    ],
    note: 'The High confidence update is accepted as soon as Atlas proposes it, but it still waits for Save like everything else. The Medium one waits for Kemar.',
    bug: {
      text: 'Atlas pre-accepts every update, whatever its confidence',
      model: Capture({ Dedup: true, Bug: 'autoAcceptMedium' }),
    },
  },
  {
    id: 'sent-twice',
    tab: 'The same message twice',
    area: 'atlas',
    summary:
      'Kemar was offline, so he sent the same update again from the app. Both copies reach Atlas. The plan must still change once.',
    refs: ['C1', 'C14.5'],
    people: ['Kemar sees', 'Alicia sees'],
    model: Capture({ Dedup: true }),
    start: KEMAR_START,
    setup: [
      ['Arrive', 'atlas'],
      ['Parse', 'atlas'],
      ['Propose', 'atlas'],
      ['PersonMarks', 'atlas', 'u2', 'accepted'],
      ['Save', 'atlas'],
    ],
    before: 'The Atlas copy is already saved: both updates are on the plan once.',
    rows: KEMAR_ROWS('app', 'The same message, from the app'),
    steps: [
      {
        title: 'The app copy arrives',
        sees: ['Sent to Atlas', 'Forager 2.0: 2 updates from Kemar'],
        moves: [['Arrive', 'app']],
        expect: { 'cap.app': 'received' },
      },
      {
        title: 'Atlas proposes the same 2 updates',
        sees: ['Review my update: 1 needs your OK', 'Forager 2.0: 2 updates from Kemar'],
        moves: [
          ['Parse', 'app'],
          ['Propose', 'app'],
        ],
        expect: { 'cap.app': 'proposed', 'upd.app.u1': 'accepted' },
      },
      {
        title: 'Kemar confirms and saves again',
        sees: ['Saved', 'Still 2 updates from Kemar, not 4'],
        moves: [
          ['PersonMarks', 'app', 'u2', 'accepted'],
          ['Save', 'app'],
        ],
        expect: { 'cap.app': 'applied', 'upd.app.u2': 'accepted', 'applied.u1': 1, 'applied.u2': 1 },
      },
    ],
    note: 'Saving twice changes the plan once, because applying an update carries its own ID (rule 6). Better still, Atlas could spot the copy before asking Kemar twice; that is open (F, new).',
    bug: {
      text: 'Applying an update does not check whether it was already applied',
      model: Capture({ Dedup: false }),
    },
  },
  {
    id: 'forager-off-track',
    tab: 'Alicia sets Off track',
    area: 'delivery',
    summary:
      'After standup, Alicia marks Forager 2.0 Off track while the plan says At risk. DPM asks her why, then shows her status with the reason.',
    refs: ['A4.2', 'A4.3', 'C3', 'B5'],
    people: ['Alicia sees', 'The executive sees'],
    model: TrackedStatus({ ExpiryPolicy: 'when_agree' }),
    start: () => true,
    setup: [
      ['RuleUpdatesChild', 't1', 'on_track'],
      ['RuleUpdatesChild', 't2', 'on_track'],
      ['RuleUpdatesChild', 't3', 'on_track'],
      ['RuleUpdatesChild', 't1', 'at_risk'],
      ['RuleUpdatesChild', 't2', 'at_risk'],
    ],
    before: '2 threads are At risk and 1 is On track, so the plan says At risk.',
    rows: {
      'child.t1': { label: 'Thread: Trend to buyer email', machine: 'Thread status', shape: 'rule', values: STATUS },
      'child.t2': { label: 'Thread: Store sales signal', machine: 'Thread status', shape: 'rule', values: STATUS },
      'child.t3': { label: 'Thread: Production ready', machine: 'Thread status', shape: 'rule', values: STATUS },
      'view.calculated': { label: 'Forager 2.0, from the plan', machine: 'Project status', shape: 'rule', values: STATUS },
      setStatus: { label: 'Forager 2.0, set by Alicia', machine: 'Set status', shape: 'switch', values: STATUS },
      override: {
        label: 'Reason for the set status',
        machine: 'Reason',
        shape: 'ask',
        values: { calculated_only: 'Not needed', reason_required: 'Asking', explained: 'Given' },
      },
      inbox: {
        label: "Alicia's inbox",
        machine: 'Inbox item',
        shape: 'ask',
        values: { '[]': 'Nothing', '["status_set_with_no_reason"]': 'Status set with no reason' },
      },
      'view.displayed': { label: 'Forager 2.0, on screen', machine: 'Project status', shape: 'rule', values: STATUS },
    },
    steps: [
      {
        title: 'Alicia sets Off track after standup',
        sees: ['Inbox: Forager 2.0 is set Off track, but the plan says At risk', 'Forager 2.0 At risk. Set Off track by Alicia, no reason yet'],
        moves: [['OwnerSets', 'off_track']],
        expect: { setStatus: 'off_track', override: 'reason_required', inbox: ['status_set_with_no_reason'] },
      },
      {
        title: 'Alicia adds a reason',
        sees: ['Inbox item closed', 'Forager 2.0 Off track because store sales feed access from Sprouts IT is late (#151)'],
        moves: [['OwnerGivesReason']],
        expect: { override: 'explained', inbox: [], 'view.displayed': 'off_track' },
      },
      {
        title: 'Sprouts IT opens the store sales feed',
        sees: ['Store sales signal On track', 'Forager 2.0 Off track, with the same reason'],
        moves: [['RuleUpdatesChild', 't2', 'on_track']],
        expect: { 'child.t2': 'on_track' },
      },
      {
        title: 'The trend model is back on plan',
        sees: ['The plan now says On track; your set status is still Off track', 'Forager 2.0 Off track (set). The plan says On track'],
        moves: [['RuleUpdatesChild', 't1', 'on_track']],
        expect: { 'child.t1': 'on_track', 'view.calculated': 'on_track' },
      },
      {
        title: 'Alicia sets it back to On track',
        sees: ['Forager 2.0 On track', 'Forager 2.0 On track'],
        moves: [['OwnerSets', 'on_track']],
        expect: { setStatus: 'none', override: 'calculated_only', 'view.displayed': 'on_track' },
      },
    ],
    note: 'Step 4 is decision F3. Under the rule in C3 today, a set status lasts until it agrees with the plan again, so Off track stays on screen until Alicia clears it. The checker also found that a set status can outlive finished work (TLA+ section).',
    bug: {
      text: 'Setting a status that disagrees with the plan does not ask for a reason',
      model: TrackedStatus({ ExpiryPolicy: 'when_agree', Bug: 'noReasonItem' }),
    },
  },
  {
    id: 'kemar-update-keeps-off-track',
    tab: "Off track survives Kemar's save",
    area: 'delivery',
    summary:
      'Use case 1. Alicia sets Forager 2.0 Off track at 9:02 while the plan says On track. Kemar then saves his update and the plan moves to At risk. Her Off track must survive that, and a reason she gives later must not silently outlive the plan it explained.',
    refs: ['A4.3', 'C3', 'F3', 'use case 1, M9'],
    people: ['Alicia sees', 'The executive sees'],
    model: TrackedStatus({ ExpiryPolicy: 'when_done', ReasonStale: true }),
    start: () => true,
    setup: [
      ['RuleUpdatesChild', 't1', 'on_track'],
      ['RuleUpdatesChild', 't2', 'on_track'],
      ['RuleUpdatesChild', 't3', 'on_track'],
    ],
    before: 'All 3 threads are On track, so the plan says On track. Kemar has sent his voice note but not saved it.',
    rows: {
      'child.t1': { label: 'Thread: Trend to buyer email', machine: 'Thread status', shape: 'rule', values: STATUS },
      'child.t2': { label: 'Thread: Store sales signal', machine: 'Thread status', shape: 'rule', values: STATUS },
      'child.t3': { label: 'Thread: Production ready', machine: 'Thread status', shape: 'rule', values: STATUS },
      'view.calculated': { label: 'Forager 2.0, from the plan', machine: 'Project status', shape: 'rule', values: STATUS },
      setStatus: { label: 'Forager 2.0, set by Alicia', machine: 'Set status', shape: 'switch', values: STATUS },
      override: {
        label: 'Reason for the set status',
        machine: 'Reason',
        shape: 'ask',
        values: { calculated_only: 'Not needed', reason_required: 'Asking', explained: 'Given', reason_stale: 'Given, but the plan moved' },
      },
      inbox: {
        label: "Alicia's inbox",
        machine: 'Inbox item',
        shape: 'ask',
        values: { '[]': 'Nothing', '["status_set_with_no_reason"]': 'Status set with no reason', '["keep_set_status"]': 'Keep Off track?' },
      },
      'view.displayed': { label: 'Forager 2.0, on screen', machine: 'Project status', shape: 'rule', values: STATUS },
    },
    steps: [
      {
        title: '9:02am. Alicia sets Off track after standup',
        sees: ['Inbox: Forager 2.0 is set Off track, but the plan says On track', 'Forager 2.0 On track. Set Off track by Alicia, no reason yet'],
        moves: [['OwnerSets', 'off_track']],
        expect: { setStatus: 'off_track', override: 'reason_required', inbox: ['status_set_with_no_reason'] },
      },
      {
        title: 'Kemar saves his update: trend model forecast 24 Oct, store feed blocked',
        sees: ['The same inbox item now reads: but the plan says At risk', 'Forager 2.0 At risk. Set Off track by Alicia, no reason yet'],
        moves: [
          ['RuleUpdatesChild', 't1', 'at_risk'],
          ['RuleUpdatesChild', 't2', 'at_risk'],
        ],
        expect: { 'child.t1': 'at_risk', 'child.t2': 'at_risk', 'view.calculated': 'at_risk', 'view.displayed': 'at_risk' },
      },
      {
        title: 'Alicia saves the reason Atlas drafted from the risk log',
        sees: ['Inbox item closed', 'Forager 2.0 Off track because the store feed has been blocked for 6 days (#151) and there is no data engineer on days 15 to 19'],
        moves: [['OwnerGivesReason']],
        expect: { override: 'explained', inbox: [], 'view.displayed': 'off_track' },
      },
      {
        title: 'Sprouts IT opens the store sales feed',
        sees: ['Store sales signal On track. The plan still says At risk, so the reason still stands', 'Forager 2.0 Off track, with the same reason'],
        moves: [['RuleUpdatesChild', 't2', 'on_track']],
        expect: { 'child.t2': 'on_track' },
      },
      {
        title: 'The trend model is back on plan',
        sees: ['Inbox: Forager 2.0 plan now says On track. Keep Off track?', 'Forager 2.0 Off track (reason given when the plan said At risk)'],
        moves: [['RuleUpdatesChild', 't1', 'on_track']],
        expect: { 'child.t1': 'on_track', 'view.calculated': 'on_track', override: 'reason_stale', inbox: ['keep_set_status'] },
      },
      {
        title: 'Alicia uses On track',
        sees: ['Inbox item closed', 'Forager 2.0 On track'],
        moves: [['OwnerSets', 'on_track']],
        expect: { setStatus: 'none', override: 'calculated_only', inbox: [], 'view.displayed': 'on_track' },
      },
    ],
    note: 'Step 2 is why the expiry policy matters. Under "on_any_change" (the first default in build-plan.md) Kemar\'s save would clear Alicia\'s Off track and her inbox item, and L6 would never appear. Step 5 is the new reason_stale state: the old reason is kept but no longer trusted until Alicia keeps it or changes the status.',
    bug: {
      text: 'The set status expires whenever the plan moves ("on_any_change")',
      model: TrackedStatus({ ExpiryPolicy: 'on_any_change', ReasonStale: true }),
    },
  },
  {
    id: 'braid-approvals',
    tab: 'Who decides on the BRAID log',
    area: 'delivery',
    summary:
      'Use case 1, after Kemar saves. His update raised a risk on Forager 2.0 and a decision on Store Insights ("Andre and I agreed to move the refresh to 6am"). Anyone can raise them; only a PM or Lead can put them on the log, and words in a message never approve anything.',
    refs: ['use case 1, M15', 'briefing 26 Oct', 'P5'],
    people: ['Kemar sees', 'Alicia and Andre see'],
    model: BraidEntry(),
    start: () => true,
    before: 'Alicia is PM and Andre is Lead. Nothing is on the log yet.',
    rows: {
      'st.e1': { label: 'Risk: trend model may slip to 24 Oct', machine: 'BRAID entry', shape: 'ask', values: { none: 'Not raised', proposed: 'Waiting for PM or Lead', open: 'On the risk log' } },
      'decidedBy.e1': { label: 'Risk approved by', machine: 'BRAID entry', shape: 'ask', values: { null: 'No one yet', alicia: 'Alicia', andre: 'Andre' } },
      'st.e2': { label: 'Decision: refresh at 6am', machine: 'BRAID entry', shape: 'ask', values: { none: 'Not raised', proposed: 'Pending', approved: 'Approved', superseded: 'Superseded' } },
      'decidedBy.e2': { label: '6am approved by', machine: 'BRAID entry', shape: 'ask', values: { null: 'No one yet', alicia: 'Alicia', andre: 'Andre' } },
      'st.e3': { label: 'Decision: keep the refresh at 5am', machine: 'BRAID entry', shape: 'ask', values: { none: 'Not raised', proposed: 'Pending', approved: 'Approved' } },
      'decidedBy.e3': { label: '5am approved by', machine: 'BRAID entry', shape: 'ask', values: { null: 'No one yet', alicia: 'Alicia', andre: 'Andre' } },
      inbox: {
        label: 'Waiting for a PM or Lead',
        machine: 'Inbox item',
        shape: 'ask',
        values: {
          '[]': 'Nothing',
          '["approve:e1","approve:e2"]': 'Approve the risk; approve the 6am decision',
          '["approve:e2"]': 'Approve the 6am decision',
          '["approve:e3"]': 'Approve the 5am decision (may conflict with 6am)',
        },
      },
    },
    steps: [
      {
        title: '9:10am. Kemar saves his update',
        sees: ['Saved. 1 risk sent to Alicia, 1 decision sent to Andre', 'Kemar raised a risk. Add to the risk log? · Kemar proposed a decision: move the refresh to 6am'],
        moves: [
          ['Report', 'kemar', 'e1', false],
          ['Report', 'kemar', 'e2', true],
        ],
        expect: { 'st.e1': 'proposed', 'st.e2': 'proposed', inbox: ['approve:e1', 'approve:e2'] },
      },
      {
        title: 'Alicia approves the risk',
        sees: ['Your risk is on the Forager 2.0 log (approved by Alicia)', 'Risk on the log; she can now link it in her Off track reason'],
        moves: [['Approve', 'alicia', 'e1']],
        expect: { 'st.e1': 'open', 'decidedBy.e1': 'alicia', inbox: ['approve:e2'] },
      },
      {
        title: 'Andre approves the 6am refresh',
        sees: ['Your decision was approved by Andre', 'Store Insights decision log: refresh at 6am, approved by Andre, source: Kemar 8:58am'],
        moves: [['Approve', 'andre', 'e2']],
        expect: { 'st.e2': 'approved', 'decidedBy.e2': 'andre', inbox: [] },
      },
      {
        title: 'Thursday. Sprouts asks to keep 5am; Kemar passes it on',
        sees: ['Proposed. Atlas notes it may conflict with the 6am decision', 'Kemar proposed a decision: keep the refresh at 5am (may conflict with 6am, approved Tuesday)'],
        moves: [['Report', 'kemar', 'e3', false]],
        expect: { 'st.e3': 'proposed', inbox: ['approve:e3'] },
      },
      {
        title: 'Andre approves keeping 5am',
        sees: ['Your decision was approved by Andre', 'Refresh at 5am approved; the 6am decision is superseded, not deleted'],
        moves: [['Approve', 'andre', 'e3']],
        expect: { 'st.e3': 'approved', 'decidedBy.e3': 'andre', 'st.e2': 'superseded', inbox: [] },
      },
    ],
    note: 'Step 1: "Andre and I agreed" makes a proposal, not a decision; Andre still has to approve it. Step 5: two conflicting decisions never both stand. The checker also covers what this story does not show: an approver who lost the role, a project with no one who can approve, and reminders that never decide anything.',
    bug: {
      text: '"Andre and I agreed" counts as the approval',
      model: BraidEntry({ Bug: 'approveByText' }),
    },
  },
  {
    id: 'update-splits',
    tab: "Kemar's update splits across projects",
    area: 'atlas',
    summary:
      'Use case 1. Kemar is in 5 groups. One voice note has lines for Forager 2.0 and a sentence for Store Insights. Atlas files each part in its own project, and each person sees only the part that belongs to a project they are in.',
    refs: ['use case 1, M13, M14', 'briefing 26 Oct', 'P10'],
    people: ['Kemar sees', 'Alicia sees (Forager PM)', 'Andre sees (Store Insights PM)'],
    model: Routing(),
    start: () => true,
    before:
      'Kemar can file into Forager 2.0 and Store Insights. He is not in Sante Group, his study group is not connected to DPM, and one of his projects belongs to another company. Alicia is in Forager; Andre is in Store Insights; Bob reads the other company\'s dashboard.',
    rows: {
      'route.i1': { label: 'Forager lines ("waiting on Kyle…", "the model slips a day")', machine: 'Routing an item', shape: 'switch', values: { pending: 'Not read yet', forager: 'Forager 2.0', insights: 'Store Insights', choose: 'Choose a project', not_filed: 'Not filed' } },
      'route.i2': { label: 'Store Insights sentence ("move the refresh to 6am")', machine: 'Routing an item', shape: 'switch', values: { pending: 'Not read yet', forager: 'Forager 2.0', insights: 'Store Insights', choose: 'Choose a project', not_filed: 'Not filed' } },
      'filed.i1': { label: 'Forager lines, saved into', machine: 'Apply update', shape: 'job', values: { null: 'Not saved', forager: 'Forager 2.0', insights: 'Store Insights' } },
      'filed.i2': { label: 'Store Insights sentence, saved into', machine: 'Apply update', shape: 'job', values: { null: 'Not saved', forager: 'Forager 2.0', insights: 'Store Insights' } },
      'view.aliciaSees': { label: 'Alicia can read', machine: 'Role on a project', shape: 'membership', values: { '[]': 'Nothing', '["i1"]': 'The Forager lines', '["i2"]': 'The Store Insights sentence', '["i1","i2"]': 'The whole update' } },
      'view.andreSees': { label: 'Andre can read', machine: 'Role on a project', shape: 'membership', values: { '[]': 'Nothing', '["i1"]': 'The Forager lines', '["i2"]': 'The Store Insights sentence', '["i1","i2"]': 'The whole update' } },
      'view.bobSees': { label: 'Bob (other company) can read', machine: 'Role on a project', shape: 'membership', values: { '[]': 'Nothing', '["i1"]': 'The Forager lines', '["i2"]': 'The Store Insights sentence', '["i1","i2"]': 'The whole update' } },
    },
    steps: [
      {
        title: 'Atlas reads the Forager lines',
        sees: ['Forager 2.0 · because Kyle is the contact on #151', 'Nothing yet: Kemar has not saved', 'Nothing yet'],
        moves: [['AtlasRoutes', 'i1', 'forager']],
        expect: { 'route.i1': 'forager' },
      },
      {
        title: 'Atlas reads "On Store Insights…"',
        sees: ['Store Insights · because you said "On Store Insights". 9 updates for 2 projects; 4 need your OK', 'Nothing yet', 'Nothing yet'],
        moves: [['AtlasRoutes', 'i2', 'insights']],
        expect: { 'route.i2': 'insights' },
      },
      {
        title: '9:10am. Kemar checks both projects and saves',
        sees: [
          'Saved to Forager 2.0 and Store Insights. Only you can see the whole note',
          'Forager updates and a new risk, with Kemar\'s Forager words as the source. Not the Store Insights sentence',
          'The proposed 6am decision, with Kemar\'s Store Insights sentence as the source. Not the Forager lines',
        ],
        moves: [['Save']],
        expect: { 'filed.i1': 'forager', 'filed.i2': 'insights', 'view.aliciaSees': ['i1'], 'view.andreSees': ['i2'] },
      },
    ],
    note: 'Bob reads the other company\'s dashboard and sees nothing at every step. The checker also covers what this story does not show: Atlas naming a project Kemar is not in, Kemar leaving a project before he saves, a line that fits two projects, and a project tagged to another company.',
    bug: {
      text: 'A project member sees the whole capture',
      model: Routing({ Bug: 'leakCapture' }),
    },
  },
  {
    id: 'one-blocker',
    tab: 'Three reports, one blocker',
    area: 'delivery',
    summary:
      'Use case 1 and M16. Alicia logged "Store sales feed access" on Forager 2.0 six days ago. Kemar and Jodian each report it again in their own updates. Atlas suggests matches; the speaker confirms; the log keeps one blocker with every report as a source, and only the person blocked (or a PM or Lead) can say it is gone.',
    refs: ['use case 1, M16', 'S13', 'briefing 26 Oct'],
    people: ['Kemar and Jodian see', 'Alicia (PM) sees'],
    model: Match(),
    start: () => true,
    before: 'Forager 2.0 has an open blocker "Store sales feed access" (1 report, Alicia), an older blocker "Store API outage" (resolved last week), and a risk.',
    rows: {
      'match.rep1': { label: "Kemar's report: same as", machine: 'Same as an existing entry', shape: 'ask', values: { null: 'Not read yet', b1: 'Store sales feed access', b2: 'Store API outage (resolved)', new: 'A new blocker' } },
      'match.rep2': { label: "Jodian's report: same as", machine: 'Same as an existing entry', shape: 'ask', values: { null: 'Not read yet', b1: 'Store sales feed access', b2: 'Store API outage (resolved)', new: 'A new blocker' } },
      'src.b1': { label: 'Store sales feed access: reports', machine: 'Blocker', shape: 'switch', values: { '["a1"]': '1 (Alicia, 6 days ago)', '["a1","rep1"]': '2 (Alicia, Kemar)', '["a1","rep1","rep2"]': '3 (Alicia, Kemar, Jodian)' } },
      'st.b1': { label: 'Store sales feed access', machine: 'Blocker', shape: 'switch', values: { open: 'Open', resolved: 'Resolved' } },
      'resolvedBy.b1': { label: 'Resolved by', machine: 'Blocker', shape: 'switch', values: { null: 'No one yet', kemar: 'Kemar', alicia: 'Alicia', jodian: 'Jodian' } },
      inbox: {
        label: 'Waiting on Kemar or Alicia',
        machine: 'Inbox item',
        shape: 'ask',
        values: { '[]': 'Nothing', '["clear:b1"]': "Jodian says the feed is cleared. Confirm?", '["new_blocker:b1"]': 'New blocker on Forager 2.0' },
      },
    },
    steps: [
      {
        title: "Atlas reads Kemar's \"still waiting on Kyle for the store feed\"",
        sees: ['Same as: Store API outage (resolved last week)?', 'Nothing yet'],
        moves: [['AtlasSuggests', 'rep1', 'b2']],
        expect: { 'match.rep1': 'b2' },
      },
      {
        title: 'Kemar rejects that match and picks the right one',
        sees: ['Same as: Store sales feed access (open, 1 report)', 'Nothing yet'],
        moves: [['Pick', 'rep1', 'b1']],
        expect: { 'match.rep1': 'b1' },
      },
      {
        title: '9:10am. Kemar saves',
        sees: ['Added to the existing blocker. 2 reports', 'Store sales feed access: 2 reports. No new alert: it is not a new blocker'],
        moves: [['Save', 'rep1']],
        expect: { 'src.b1': ['a1', 'rep1'] },
      },
      {
        title: 'Jodian mentions the same feed in her update; she confirms the match',
        sees: ['Same as: Store sales feed access (open, 2 reports)', 'Nothing yet'],
        moves: [
          ['AtlasSuggests', 'rep2', 'b1'],
          ['Confirm', 'rep2'],
        ],
        expect: { 'match.rep2': 'b1' },
      },
      {
        title: 'Jodian saves',
        sees: ['Added to the existing blocker. 3 reports', 'One blocker, 3 reports, each with its quote and time'],
        moves: [['Save', 'rep2']],
        expect: { 'src.b1': ['a1', 'rep1', 'rep2'] },
      },
      {
        title: 'Thursday. Jodian hears Kyle sent the feed',
        sees: ["Jodian: your 'it's cleared' went to Kemar and Alicia", 'Jodian says the feed is cleared. Confirm?'],
        moves: [['Resolve', 'jodian', 'b1']],
        expect: { inbox: ['clear:b1'] },
      },
      {
        title: 'Kemar, whose work it blocked, confirms',
        sees: ['Resolved. #151 can move out of Blocked', 'Store sales feed access resolved by Kemar'],
        moves: [['Resolve', 'kemar', 'b1']],
        expect: { 'st.b1': 'resolved', 'resolvedBy.b1': 'kemar', inbox: [] },
      },
    ],
    note: "Seven reports would still be one blocker with seven sources, and Alicia would be alerted once, for the first. The checker also covers what this story does not show: Atlas suggesting the risk (another kind), the blocker being resolved or merged while Kemar is still reviewing (a conflict he decides again), and a PM merging and unmerging entries without losing or doubling a report.",
    bug: {
      text: 'Every report pings the PM, not only new entries',
      model: Match({ Bug: 'alertOnSource' }),
    },
  },
  {
    id: 'changed-before-save',
    tab: 'Someone changed it first',
    area: 'atlas',
    summary:
      'Use case 1, E24 and E25. Between Atlas reading Kemar\'s note and Kemar pressing Save, GitHub closes #145 and Alicia moves the trend model forecast. Save writes only over what Kemar saw, and saves all or nothing.',
    refs: ['use case 1, M2 to M4', 'E24', 'E25', 'S3'],
    people: ['Kemar sees', 'Alicia sees'],
    model: CaptureSave({ Updates: { u1: 't1', u2: 't2' } }),
    start: () => true,
    before: 'Atlas read #145 as In progress and the trend model forecast as 23 Oct. Kemar is reviewing.',
    rows: {
      'upd.u1': { label: 'Update: #145 to Done', machine: 'Extracted update', shape: 'ask', values: { proposed: 'Needs your OK', accepted: 'Accepted', conflict: 'Changed since you looked', applied: 'Saved', no_change: 'Already true, nothing to write' } },
      'upd.u2': { label: 'Update: forecast to 24 Oct', machine: 'Extracted update', shape: 'ask', values: { proposed: 'Needs your OK', accepted: 'Accepted', conflict: 'Changed since you looked', applied: 'Saved', no_change: 'Already true, nothing to write' } },
      'record.t1': { label: 'Issue #145 in the plan', machine: 'Work item', shape: 'stage', values: { a: 'In progress', b: 'Done', c: 'Cancelled' } },
      'record.t2': { label: 'Trend model forecast in the plan', machine: 'Milestone', shape: 'stage', values: { a: '23 Oct', b: '24 Oct', c: '25 Oct' } },
      cap: { label: "Kemar's review", machine: 'Capture processing', shape: 'job', values: { reviewing: 'In review', saved: 'Saved', expired: 'Expired' } },
    },
    steps: [
      {
        title: 'Kemar accepts both updates',
        sees: ['2 ready', 'Nothing yet'],
        moves: [['Accept', 'u1'], ['Accept', 'u2']],
        expect: { 'upd.u1': 'accepted', 'upd.u2': 'accepted' },
      },
      {
        title: '9:05am. GitHub closes #145',
        sees: ['Nothing yet', 'Nothing'],
        moves: [['OtherWriter', 't1', 'b']],
        expect: { 'record.t1': 'b' },
      },
      {
        title: '9:06am. Alicia moves the forecast to 25 Oct',
        sees: ['Nothing yet', 'Forecast 25 Oct'],
        moves: [['OtherWriter', 't2', 'c']],
        expect: { 'record.t2': 'c' },
      },
      {
        title: 'Kemar presses Save',
        sees: ['Not saved. The forecast changed since you looked: Alicia set 25 Oct at 9:06. Keep 24 Oct, or drop yours?', 'Nothing changes'],
        moves: [['Save']],
        expect: { 'upd.u2': 'conflict' },
      },
      {
        title: 'Kemar keeps 24 Oct (he owns the milestone)',
        sees: ['Ready to save again', 'Nothing yet'],
        moves: [['Accept', 'u2']],
        expect: { 'upd.u2': 'accepted' },
      },
      {
        title: 'Kemar saves',
        sees: ['Saved. #145 was already Done (GitHub, 9:05), so nothing was written for it', 'Forecast 24 Oct, by Kemar, after your 25 Oct'],
        moves: [['Save']],
        expect: { cap: 'saved', 'upd.u1': 'no_change', 'upd.u2': 'applied', 'record.t2': 'b' },
      },
    ],
    note: 'Step 4 is all or nothing (S3): #145 is not saved alone while the forecast is in conflict. The checker also covers what this story does not show: Save pressed twice, a review nobody finishes (reminder, then expiry), and saving after expiry.',
    bug: {
      text: 'Save writes without checking what the update saw',
      model: CaptureSave({ Bug: 'blindWrite' }),
    },
  },
  {
    id: 'reason-item',
    tab: "Alicia's reason item",
    area: 'inbox',
    summary:
      'The inbox item "Forager 2.0 is set Off track, but the plan says At risk". One live item per cause; it closes when the cause goes, even while snoozed; when the cause comes back, it is a new item with a new age.',
    refs: ['use case 1, M10', 'A8.2', 'C4', 'E60 to E62'],
    people: ['Alicia sees'],
    model: InboxItem(),
    start: () => true,
    before: 'Forager 2.0 has no set status. Alicia\'s inbox has nothing about it.',
    rows: {
      cause: { label: 'Cause: status set with no reason', machine: 'Set status', shape: 'switch', values: { true: 'Yes', false: 'No' } },
      items: {
        label: "Alicia's inbox items for this cause",
        machine: 'Inbox item',
        shape: 'ask',
        values: {
          '[]': 'None',
          '[{"ep":1,"st":"open"}]': 'Item 1 open',
          '[{"ep":1,"st":"snoozed"}]': 'Item 1 snoozed',
          '[{"ep":1,"st":"auto_closed"}]': 'Item 1 closed (cause gone)',
          '[{"ep":1,"st":"auto_closed"},{"ep":2,"st":"open"}]': 'Item 1 closed; item 2 open, new age',
          '[{"ep":1,"st":"auto_closed"},{"ep":2,"st":"acted"}]': 'Item 1 closed; item 2 done',
        },
      },
    },
    steps: [
      {
        title: '9:02am. Alicia sets Off track with no reason',
        sees: ['Forager 2.0 is set Off track, but the plan says At risk · 0m'],
        moves: [['CauseAppears'], ['Evaluate']],
        expect: { cause: true, items: [{ ep: 1, st: 'open' }] },
      },
      {
        title: 'She snoozes it until after lunch',
        sees: ['Snoozed until 1pm'],
        moves: [['Snooze']],
        expect: { items: [{ ep: 1, st: 'snoozed' }] },
      },
      {
        title: '11am. The plan catches up and agrees: Off track',
        sees: ['Nothing. The item closed while snoozed, and will not wake at 1pm'],
        moves: [['CauseClears'], ['Evaluate']],
        expect: { cause: false, items: [{ ep: 1, st: 'auto_closed' }] },
      },
      {
        title: '3pm. She sets On track; the plan says At risk',
        sees: ['Forager 2.0 is set On track, but the plan says At risk · 0m (a new item, not the old one reopened)'],
        moves: [['CauseAppears'], ['Evaluate']],
        expect: { cause: true, items: [{ ep: 1, st: 'auto_closed' }, { ep: 2, st: 'open' }] },
      },
      {
        title: 'She saves a reason',
        sees: ['Item done'],
        moves: [['OwnerActs']],
        expect: { cause: false, items: [{ ep: 1, st: 'auto_closed' }, { ep: 2, st: 'acted' }] },
      },
    ],
    note: 'If the cause clears and comes back before the rule has run in between, the original item simply stays open: the rule never saw it clear. The checker covers that, a rule that never runs, and items that never close.',
    bug: {
      text: 'A closed item is reopened when the cause returns',
      model: InboxItem({ Bug: 'reopenClosed' }),
    },
  },
  {
    id: 'staff-nepa',
    tab: 'Staffing NEPA',
    area: 'operations',
    summary:
      'NEPA support is 2 people short. Atlas proposes Ricardo and Omari. Nothing happens until the executive approves.',
    refs: ['P5', 'C5', 'B6'],
    people: ['The executive sees', 'Alicia sees'],
    model: AtlasAction({ People: ['alicia', 'executive'], Actions: ['staff_nepa'], Undoable: [], RecheckOnExecute: true }),
    start: (s) => JSON.stringify(s.scope.staff_nepa) === '["executive"]',
    rows: {
      'act.staff_nepa': { label: 'Staff NEPA with Ricardo and Omari', machine: 'Atlas action', shape: 'job', values: ACT },
      'approver.staff_nepa': {
        label: 'Approved by',
        machine: 'Approval',
        shape: 'ask',
        values: { no_one: 'Nobody yet', executive: 'The executive', alicia: 'Alicia' },
      },
    },
    steps: [
      {
        title: 'Atlas asks the executive',
        sees: ['Decide now: approve Ricardo and Omari for NEPA support ($9k a week until staffed)', 'Waiting for the executive'],
        moves: [['AskForApproval', 'staff_nepa']],
        expect: { 'act.staff_nepa': 'awaiting_approval' },
      },
      {
        title: 'The executive approves',
        sees: ['Approved', 'Approved by the executive'],
        moves: [['Approve', 'executive', 'staff_nepa']],
        expect: { 'act.staff_nepa': 'approved', 'approver.staff_nepa': 'executive' },
      },
      {
        title: 'Atlas assigns them',
        sees: ['Assigning', 'Assigning Ricardo and Omari'],
        moves: [['Execute', 'staff_nepa']],
        expect: { 'act.staff_nepa': 'executing' },
      },
      {
        title: 'The assignment is saved',
        sees: ['Operations no longer Off track for staffing', 'NEPA support: Ricardo and Omari start Monday'],
        moves: [['Finish', 'staff_nepa']],
        expect: { 'act.staff_nepa': 'succeeded' },
      },
    ],
    note: 'Atlas runs with the approver’s permissions and only after a person says yes (P5). Every step is audited (C5).',
    bug: {
      text: 'Atlas treats its own request as approved',
      model: AtlasAction({ People: ['alicia', 'executive'], Actions: ['staff_nepa'], Undoable: [], RecheckOnExecute: true, Bug: 'skipApproval' }),
    },
  },
  {
    id: 'approver-moves',
    tab: 'The approver moves on',
    area: 'operations',
    summary:
      'Alicia approves the NEPA staffing, then is moved off the NEPA account before Atlas runs it. The approval no longer counts.',
    refs: ['C5', 'A7.1'],
    people: ['Alicia sees', 'The new owner sees'],
    model: AtlasAction({ People: ['alicia', 'executive'], Actions: ['staff_nepa'], Undoable: [], RecheckOnExecute: true }),
    start: (s) => JSON.stringify(s.scope.staff_nepa) === '["alicia"]',
    setup: [
      ['AskForApproval', 'staff_nepa'],
      ['Approve', 'alicia', 'staff_nepa'],
    ],
    before: 'Alicia has approved; Atlas has not run it yet.',
    rows: {
      'scope.staff_nepa': {
        label: 'Who may approve for NEPA',
        machine: 'Role assignment',
        shape: 'membership',
        values: { '[]': 'Nobody yet', '["alicia"]': 'Alicia' },
      },
      'act.staff_nepa': { label: 'Staff NEPA with Ricardo and Omari', machine: 'Atlas action', shape: 'job', values: ACT },
      'approver.staff_nepa': {
        label: 'Approved by',
        machine: 'Approval',
        shape: 'ask',
        values: { no_one: 'Nobody yet', executive: 'The executive', alicia: 'Alicia' },
      },
    },
    steps: [
      {
        title: 'Alicia moves off the NEPA account',
        sees: ['NEPA is no longer yours', 'NEPA support handed over'],
        moves: [['RoleRemoved', 'alicia', 'staff_nepa']],
        expect: { 'scope.staff_nepa': [] },
      },
      {
        title: 'Atlas checks before it runs',
        sees: ['Nothing', 'Decide now: approve Ricardo and Omari for NEPA support'],
        moves: [['ApprovalLapses', 'staff_nepa']],
        expect: { 'act.staff_nepa': 'awaiting_approval', 'approver.staff_nepa': 'no_one' },
      },
    ],
    note: 'This step is not in C5 yet. Without it the checker found 2 failures: either Atlas runs on an approval that no longer counts, or the action waits forever (TLA+ section).',
    bug: {
      text: 'Atlas checks permission only when someone approves, never when it runs',
      model: AtlasAction({
        People: ['alicia', 'executive'],
        Actions: ['staff_nepa'],
        Undoable: [],
        RecheckOnExecute: false,
        IncludeApprovalLapses: false,
      }),
    },
  },
  {
    id: 'care-request',
    tab: 'A care request waits',
    area: 'people',
    summary:
      'Someone asks the care team for a ride. Nobody replies within 60 minutes, so the care area goes At risk. Leaders only ever see counts.',
    refs: ['C10', 'A7.3', 'A10.2', 'B6'],
    people: ['The care team sees', 'The executive sees'],
    model: HelpRequest(),
    start: () => true,
    rows: {
      'req.r1': {
        label: 'The ride request',
        machine: 'Care request',
        shape: 'stage',
        values: { none: 'Not asked', new: 'New', acknowledged: 'Replied', in_progress: 'In progress', escalated: 'Escalated', resolved: 'Resolved' },
      },
      'breached.r1': {
        label: 'First reply within 60 minutes',
        machine: 'Reply target',
        shape: 'switch',
        values: { false: 'Not missed', true: 'Missed' },
      },
      'level.r1': {
        label: 'Who holds it',
        machine: 'Escalation level',
        shape: 'switch',
        values: { 0: 'Care team', 1: 'HR', 2: 'Security', 3: 'Executive' },
      },
      'view.careArea': { label: 'Care replies', machine: 'People area status', shape: 'rule', values: STATUS },
      'view.leadersWaiting': { label: 'Leaders see: requests waiting', machine: 'Count only', shape: 'rule' },
      'view.leadersEscalated': { label: 'Leaders see: requests escalated', machine: 'Count only', shape: 'rule' },
    },
    steps: [
      {
        title: 'Someone asks for a ride',
        sees: ['New: I need a ride (with the name)', '1 care request waiting (no names)'],
        moves: [['Open', 'r1']],
        expect: { 'req.r1': 'new', 'view.leadersWaiting': 1 },
      },
      {
        title: '60 minutes pass with no reply',
        sees: ['Waiting longest: 1 hour', 'Care replies At risk'],
        moves: [['SlaTimerFires', 'r1']],
        expect: { 'breached.r1': true, 'view.careArea': 'at_risk' },
      },
      {
        title: 'Shanelle replies',
        sees: ['Replied', 'Care replies On track'],
        moves: [['FirstReply', 'r1']],
        expect: { 'req.r1': 'acknowledged', 'view.careArea': 'on_track', 'view.leadersWaiting': 0 },
      },
      {
        title: 'Shanelle takes it on',
        sees: ['In progress', 'Nothing new'],
        moves: [['Start', 'r1']],
        expect: { 'req.r1': 'in_progress' },
      },
      {
        title: 'Shanelle escalates it to HR',
        sees: ['Escalated to HR', '1 care request escalated to HR (details stay with the care team)'],
        moves: [['Escalate', 'r1']],
        expect: { 'req.r1': 'escalated', 'level.r1': 1, 'view.leadersEscalated': 1 },
      },
      {
        title: 'HR resolves it',
        sees: ['Resolved', 'No care requests escalated'],
        moves: [['Resolve', 'r1']],
        expect: { 'req.r1': 'resolved', 'view.leadersEscalated': 0 },
      },
    ],
    note: 'Once Shanelle replies, care replies go back On track. Whether a missed target should keep counting against the area after the reply is open.',
    bug: {
      text: 'The 60 minute timer never fires',
      model: HelpRequest({ Bug: 'noTimer' }),
    },
  },
];
