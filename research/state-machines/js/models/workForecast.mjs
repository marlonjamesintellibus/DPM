// Spec: WorkForecast (use case 1, machines doc section 20, U6; 27 Oct 2026)
// A work item gets a forecast, like a milestone: its owner says when it will be done ("I'll finish
// #147 Monday"). The due date is the plan and never moves from a message (as a milestone's target).
// Status: Done; Off track if past due and not done, or forecast beyond due + tolerance; At risk if
// blocked or forecast after due; Not started if to do; else On track. Done clears the forecast.
//
// One work item due on day 2, days 0 to 4, tolerance 1. Kemar owns it; Jodian does not.
import { clone } from '../lib.mjs';

const DUE = 2;
const TOLERANCE = 1;
const LAST_DAY = 4;

export default function WorkForecast({ Bug = null } = {}) {
  // The rule, as status/rules.ts has it. Planted bug forecastHidesLate: the forecast replaces the due date
  const status = (s) => {
    if (s.state === 'done') return 'done';
    const due = Bug === 'forecastHidesLate' && s.forecast !== null ? s.forecast : s.due;
    if (s.today > due) return 'off_track';
    if (s.forecast !== null && s.forecast - s.due > TOLERANCE) return 'off_track';
    if (s.state === 'blocked' || (s.forecast !== null && s.forecast > s.due)) return 'at_risk';
    if (s.state === 'to_do') return 'not_started';
    return 'on_track';
  };

  return {
    name: `WorkForecast${Bug ? ` (bug ${Bug})` : ''}`,
    init: () => [{ state: 'to_do', due: DUE, forecast: null, today: 0, by: null, via: null }],
    actions: [
      {
        // A saved capture sets the forecast. Only the owner's; anyone else's is an Ask (M37), not modelled here
        name: 'CaptureForecast',
        params: ['kemar', 'jodian'].flatMap((p) => [1, 2, 3, 4].map((d) => [p, d])),
        step(s, p, d) {
          if (s.state === 'done' || s.forecast === d || d < s.today) return [];
          if (p !== 'kemar' && Bug !== 'anyoneForecasts') return [];
          const t = clone(s);
          t.forecast = d;
          t.by = p;
          t.via = 'capture';
          return [t];
        },
      },
      {
        // Planted bug captureMovesDue: "move #147's due date" is applied from a message
        name: 'CaptureDue',
        params: [[3], [4]],
        step(s, d) {
          if (Bug !== 'captureMovesDue' || s.due === d) return [];
          const t = clone(s);
          t.due = d;
          t.by = 'kemar';
          t.via = 'capture';
          return [t];
        },
      },
      {
        name: 'Work',
        params: [['in_progress'], ['blocked'], ['done']],
        step(s, to) {
          if (s.state === to || s.state === 'done') return [];
          const t = clone(s);
          t.state = to;
          // Planted bug keepForecastWhenDone: a finished item keeps its forecast
          if (to === 'done' && Bug !== 'keepForecastWhenDone') t.forecast = null;
          t.by = 'kemar';
          t.via = 'work';
          return [t];
        },
      },
      {
        name: 'Tick',
        params: [[]],
        step(s) {
          if (s.today === LAST_DAY) return [];
          const t = clone(s);
          t.today += 1;
          t.by = null;
          t.via = 'timer';
          return [t];
        },
      },
    ],
    views: { status },
    invariants: {
      TypeOK: (s) => ['to_do', 'in_progress', 'blocked', 'done'].includes(s.state) && (s.forecast === null || (s.forecast >= 0 && s.forecast <= LAST_DAY)),
      // A forecast never hides a missed due date: past due and not done is Off track whatever it says
      ForecastNeverHidesLate: (s) => s.state === 'done' || s.today <= s.due || status(s) === 'off_track',
      // A late forecast is never On track
      LateForecastIsSeen: (s) => s.state === 'done' || s.forecast === null || s.forecast <= s.due || ['at_risk', 'off_track'].includes(status(s)),
      // Done clears the forecast
      DoneHasNoForecast: (s) => s.state !== 'done' || s.forecast === null,
    },
    actionProperties: {
      // The due date is the plan: nothing from a message moves it (WF7)
      DueNeverFromCapture: (s, t) => t.via !== 'capture' || t.due === s.due,
      // Only the owner's words set it (S5 for milestones, U6 for work)
      ForecastOnlyByOwner: (s, t) => t.via !== 'capture' || t.forecast === s.forecast || t.by === 'kemar',
    },
  };
}
