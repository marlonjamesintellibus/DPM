// Spec 5: Opportunity refines StagedPipeline (KB C11, C14.10)
// JavaScript port of StagedPipeline.tla and Opportunity.tla in ../tla-plus-and-tlc.md, section 9.
//
// KeepStageWhenLost = true  is the spec as proposed (stage and result kept apart).
// KeepStageWhenLost = false is C11 as drawn today: "lost" replaces the stage,
// so the mapping has to guess a stage for lost opportunities.
import { clone } from '../lib.mjs';

const STAGES = ['pitch', 'proposal', 'pricing', 'with_legal'];
const N_STAGES = 4;
const RESULT_TO_OUTCOME = { open: 'open', signed: 'won', lost: 'lost' };

// The generic machine's Next, as a relation between abstract states
function pipelineStep(a, b) {
  const same = a.stage === b.stage && a.outcome === b.outcome;
  const advance = a.outcome === 'open' && a.stage < N_STAGES && b.stage === a.stage + 1 && b.outcome === a.outcome;
  const win = a.outcome === 'open' && a.stage === N_STAGES && b.outcome === 'won' && b.stage === a.stage;
  const lose = a.outcome === 'open' && b.outcome === 'lost' && b.stage === a.stage;
  return same || advance || win || lose;
}
const pipelineInit = (a) => a.stage === 1 && a.outcome === 'open';

export default function Opportunity({ KeepStageWhenLost = true } = {}) {
  // Concrete state: { oppStage, result, stalled }.
  // As drawn in C11, a lost opportunity has no stage, so oppStage becomes 'lost'.
  const toAbstract = (s) => ({
    stage: s.oppStage === 'lost' ? 1 : STAGES.indexOf(s.oppStage) + 1,
    outcome: RESULT_TO_OUTCOME[s.result],
  });

  return {
    name: `Opportunity refines StagedPipeline (${KeepStageWhenLost ? 'stage kept when lost' : 'C11 as drawn'})`,
    init: () => [{ oppStage: 'pitch', result: 'open', stalled: false }],
    actions: [
      {
        name: 'Move',
        params: [[]],
        step(s) {
          const i = STAGES.indexOf(s.oppStage);
          if (s.result !== 'open' || s.stalled || i < 0 || i >= 3) return [];
          const t = clone(s);
          t.oppStage = STAGES[i + 1];
          return [t];
        },
      },
      {
        name: 'Sign',
        params: [[]],
        step(s) {
          if (s.result !== 'open' || s.stalled || s.oppStage !== 'with_legal') return [];
          return [{ ...s, result: 'signed' }];
        },
      },
      {
        name: 'Lose',
        params: [[]],
        step(s) {
          if (s.result !== 'open') return [];
          return [{ ...s, result: 'lost', stalled: false, oppStage: KeepStageWhenLost ? s.oppStage : 'lost' }];
        },
      },
      {
        name: 'Stall',
        params: [[]],
        step: (s) => (s.result === 'open' && !s.stalled ? [{ ...s, stalled: true }] : []),
      },
      {
        name: 'Resume',
        params: [[]],
        step: (s) => (s.stalled ? [{ ...s, stalled: false }] : []),
      },
    ],
    refinement: {
      init: (s) => pipelineInit(toAbstract(s)),
      step: (s, t) => pipelineStep(toAbstract(s), toAbstract(t)),
    },
  };
}
