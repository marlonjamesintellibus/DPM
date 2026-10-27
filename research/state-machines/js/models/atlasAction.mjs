// Spec 3: AtlasAction (KB A9.3, C5, P5)
// JavaScript port of AtlasAction.tla in ../tla-plus-and-tlc.md, section 7.
import { clone, allFunctions, subsets, product } from '../lib.mjs';

const NO_ONE = 'no_one';
const DONE_ISH = ['executing', 'succeeded', 'failed', 'undone'];

export default function AtlasAction({
  People = ['alicia', 'kemar'],
  Actions = ['a1', 'a2'],
  Undoable = ['a1'],
  RecheckOnExecute = false,
  IncludeApprovalLapses = true,
  Bug = null,
} = {}) {
  const perAction = Actions.map((a) => [a]);
  const move = (s, a, from, to) => {
    if (s.act[a] !== from) return [];
    const t = clone(s);
    t.act[a] = to;
    return [t];
  };

  const actions = [
    {
      name: 'AskForApproval',
      params: perAction,
      // Planted bug skipApproval: the action counts as approved without anyone approving it
      step: (s, a) => move(s, a, 'requested', Bug === 'skipApproval' ? 'approved' : 'awaiting_approval'),
    },
    {
      name: 'Approve',
      params: product(People, Actions),
      step(s, p, a) {
        if (s.act[a] !== 'awaiting_approval' || !s.scope[a].includes(p)) return [];
        const t = clone(s);
        t.act[a] = 'approved';
        t.approver[a] = p;
        return [t];
      },
    },
    {
      name: 'RoleRemoved',
      params: product(People, Actions),
      step(s, p, a) {
        if (!s.scope[a].includes(p)) return [];
        const t = clone(s);
        t.scope[a] = s.scope[a].filter((x) => x !== p);
        return [t];
      },
    },
    {
      name: 'Execute',
      params: perAction,
      fair: true,
      step(s, a) {
        if (RecheckOnExecute && !s.scope[a].includes(s.approver[a])) return [];
        return move(s, a, 'approved', 'executing');
      },
    },
    {
      name: 'Finish',
      params: perAction,
      fair: true,
      step: (s, a) => [...move(s, a, 'executing', 'succeeded'), ...move(s, a, 'executing', 'failed')],
    },
    {
      name: 'Undo',
      params: perAction,
      step: (s, a) => (Undoable.includes(a) ? move(s, a, 'succeeded', 'undone') : []),
    },
  ];

  if (IncludeApprovalLapses) {
    actions.push({
      name: 'ApprovalLapses',
      params: perAction,
      fair: true,
      step(s, a) {
        if (s.act[a] !== 'approved' || s.scope[a].includes(s.approver[a])) return [];
        const t = clone(s);
        t.act[a] = 'awaiting_approval';
        t.approver[a] = NO_ONE;
        return [t];
      },
    });
  }

  return {
    name: `AtlasAction (RecheckOnExecute = ${RecheckOnExecute}${IncludeApprovalLapses ? '' : ', no ApprovalLapses'}${Bug ? `, bug ${Bug}` : ''})`,
    init: () =>
      allFunctions(Actions, subsets(People)).map((scope) => ({
        act: Object.fromEntries(Actions.map((a) => [a, 'requested'])),
        approver: Object.fromEntries(Actions.map((a) => [a, NO_ONE])),
        scope,
      })),
    actions,
    invariants: {
      TypeOK: (s) => Actions.every((a) => [...People, NO_ONE].includes(s.approver[a])),
      NothingRunsWithoutApproval: (s) =>
        Actions.every((a) => !DONE_ISH.includes(s.act[a]) || People.includes(s.approver[a])),
    },
    actionProperties: {
      ApproverHadAuthority: (s, t) =>
        Actions.every(
          (a) => !(s.act[a] === 'approved' && t.act[a] === 'executing') || s.scope[a].includes(s.approver[a]),
        ),
    },
    leadsTo: {
      ApprovedActionsSettle: Actions.map((a) => ({
        label: a,
        P: (s) => s.act[a] === 'approved',
        Q: (s) => ['succeeded', 'failed', 'undone', 'awaiting_approval'].includes(s.act[a]),
      })),
    },
  };
}
