// M35 Cover request (use-cases/atlas-conversational-plan.md, section 18), in the checks.mjs format.
// The plan as written fails six properties, through four gaps; each fix in FIXES is the smallest change
// that closes one, and the rows without one fix show that each is needed. Phase P's check widened
// leaveProjectWithdraws to an accepted cover's live handover (LiveCoverOnlyForReaders): without it a handover
// that waited would start for someone off the project, and since approving now rechecks, it waits forever.
import CoverRequest, { FIXES } from '../models/coverRequest.mjs';

const without = (f) => FIXES.filter((x) => x !== f);

export const ROWS = [
  {
    spec: 'CoverRequest',
    setting: 'as written',
    model: CoverRequest(),
    expectFail: ['OneCoverPerItem', 'AsksOnlyForLiveLeave', 'LiveCoverOnlyForReaders', 'EveryReaderMaySeeIt', 'OfferEnds', 'HandoverSettles'],
  },
  { spec: 'CoverRequest', setting: 'with the four fixes', model: CoverRequest({ Fixes: FIXES }), expectFail: [] },
  { spec: 'CoverRequest', setting: 'fixes, but an offer has no way out', model: CoverRequest({ Fixes: without('suggestedWayOut') }), expectFail: ['AsksOnlyForLiveLeave', 'OfferEnds'] },
  { spec: 'CoverRequest', setting: 'fixes, but a declined leave is not a cancelled one', model: CoverRequest({ Fixes: without('declineCancels') }), expectFail: ['AsksOnlyForLiveLeave', 'HandoverSettles'] },
  {
    spec: 'CoverRequest',
    setting: 'fixes, but leaving the project keeps the ask open',
    model: CoverRequest({ Fixes: without('leaveProjectWithdraws') }),
    expectFail: ['LiveCoverOnlyForReaders', 'EveryReaderMaySeeIt', 'HandoverSettles'],
  },
  { spec: 'CoverRequest', setting: 'fixes, but one item can be asked of two people', model: CoverRequest({ Fixes: without('oneCoverPerItem') }), expectFail: ['OneCoverPerItem'] },
];

// Planted bugs, each on the fixed design: every one must make a full check fail
export const PLANTS = [
  // A late Accept skips every guard the ask had: the leave may be off and the item asked of someone else
  {
    spec: 'CoverRequest',
    setting: 'bug: Accept still works after the 24 hour timer',
    model: CoverRequest({ Fixes: FIXES, Bug: 'lateAccept' }),
    expectFail: ['OnlyDrawnArrows', 'AsksOnlyForLiveLeave', 'OneCoverPerItem', 'HandoverSettles'],
  },
  { spec: 'CoverRequest', setting: 'bug: no answer counts as yes', model: CoverRequest({ Fixes: FIXES, Bug: 'silenceAccepts' }), expectFail: ['AtlasChangesNoRecord', 'CoverOnlyByConsent'] },
  { spec: 'CoverRequest', setting: "bug: Atlas asks the teammate without Kemar's tap", model: CoverRequest({ Fixes: FIXES, Bug: 'atlasPicks' }), expectFail: ['OutwardConfirmed'] },
  { spec: 'CoverRequest', setting: 'bug: a repeated tap runs again', model: CoverRequest({ Fixes: FIXES, Bug: 'noDedup' }), expectFail: ['EachCommandOnce'] },
  // With leaveProjectWithdraws the ask is gone before a lost right can matter, so the plant turns it off
  {
    spec: 'CoverRequest',
    setting: 'bug: Accept trusts the rights seen at the ask (withdraw on leaving off)',
    model: CoverRequest({ Fixes: without('leaveProjectWithdraws'), Bug: 'noRecheck' }),
    expectFail: ['LiveCoverOnlyForReaders', 'RightCheckedWhenItRuns', 'EveryReaderMaySeeIt'],
  },
  // Phase P as first built: leaving the project withdrew only an ask, so a cover's handover still started or was
  // cancelled with a notice to someone off the project
  { spec: 'CoverRequest', setting: 'bug: leaving the project keeps an accepted cover', model: CoverRequest({ Fixes: FIXES, Bug: 'keepCover' }), expectFail: ['LiveCoverOnlyForReaders', 'EveryReaderMaySeeIt', 'HandoverSettles'] },
  { spec: 'CoverRequest', setting: 'bug: anyone can be asked to cover', model: CoverRequest({ Fixes: FIXES, Bug: 'askAnyone' }), expectFail: ['EveryReaderMaySeeIt'] },
  { spec: 'CoverRequest', setting: 'bug: every lead gets the notice', model: CoverRequest({ Fixes: FIXES, Bug: 'noticeAllLeads' }), expectFail: ['EveryReaderMaySeeIt'] },
  { spec: 'CoverRequest', setting: 'bug: a teammate on leave is asked', model: CoverRequest({ Fixes: FIXES, Bug: 'askAway' }), expectFail: ['NeverAskSomeoneAway'] },
  { spec: 'CoverRequest', setting: 'bug: the PM is not told of a cover', model: CoverRequest({ Fixes: FIXES, Bug: 'noNotice' }), expectFail: ['PMToldOfEveryCover'] },
  { spec: 'CoverRequest', setting: 'bug: the timer ends the ask without telling Kemar', model: CoverRequest({ Fixes: FIXES, Bug: 'silentTimeout' }), expectFail: ['AskerToldOfEveryEnd'] },
  { spec: 'CoverRequest', setting: 'bug: new dates leave items in the ask', model: CoverRequest({ Fixes: FIXES, Bug: 'keepUndue' }), expectFail: ['OpenAsksOnlyForDueItems'] },
  { spec: 'CoverRequest', setting: 'bug: the 24 hour timer never fires', model: CoverRequest({ Fixes: FIXES, Bug: 'noTimer' }), expectFail: ['AskEnds'] },
  { spec: 'CoverRequest', setting: 'bug: the offer never lapses', model: CoverRequest({ Fixes: FIXES, Bug: 'noOfferLapse' }), expectFail: ['OfferEnds'] },
  { spec: 'CoverRequest', setting: 'bug: approving the leave does not start the handover', model: CoverRequest({ Fixes: FIXES, Bug: 'noApprovalHook' }), expectFail: ['HandoverSettles'] },
];
