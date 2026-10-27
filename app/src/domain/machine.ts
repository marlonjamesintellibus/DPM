// The transition engine (machines doc, section 1).
// A machine is a table of drawn arrows. transition() moves only along a drawn
// arrow whose guard passes; anything else is refused and changes nothing.
// Data changes that go with a move (who decided, which value was seen) are
// applied by each machine's own functions; the engine only decides legality.

export type MachineEvent = { type: string };

// One arrow per event type; its guard receives that event, already narrowed.
export type Arrow<S extends string, E extends MachineEvent, C> = {
  [K in E["type"]]: {
    from: readonly S[];
    on: K;
    to: S;
    /** Why this arrow cannot be taken right now, or null when it can. */
    guard?: (ctx: C, event: Extract<E, { type: K }>) => string | null;
  };
}[E["type"]];

export type Machine<S extends string, E extends MachineEvent, C> = {
  name: string;
  states: readonly S[];
  arrows: readonly Arrow<S, E, C>[];
};

export type Moved<S extends string> = { ok: true; machine: string; event: string; from: S; to: S };
export type Refused = { ok: false; machine: string; event: string; from: string; reason: string };
export type Outcome<S extends string> = Moved<S> | Refused;

export function defineMachine<S extends string, E extends MachineEvent, C>(
  machine: Machine<S, E, C>,
): Machine<S, E, C> {
  const known = new Set<string>(machine.states);
  for (const arrow of machine.arrows) {
    for (const s of [...arrow.from, arrow.to]) {
      if (!known.has(s)) throw new Error(`${machine.name}: arrow ${arrow.on} uses unknown state "${s}"`);
    }
  }
  return machine;
}

// Arrows are tried in table order; the first whose guard passes is taken.
export function transition<S extends string, E extends MachineEvent, C>(
  machine: Machine<S, E, C>,
  state: NoInfer<S>,
  event: NoInfer<E>,
  ctx: NoInfer<C>,
): Outcome<S> {
  const base = { machine: machine.name, event: event.type, from: state };
  const candidates = machine.arrows.filter((a) => a.on === event.type && a.from.includes(state));
  if (!candidates.length) return { ...base, ok: false, reason: `no arrow from ${state} on ${event.type}` };
  let reason = "";
  for (const arrow of candidates) {
    // Safe: candidates only holds arrows whose `on` equals event.type
    const guard = arrow.guard as ((ctx: C, event: E) => string | null) | undefined;
    const refused = guard?.(ctx, event) ?? null;
    if (refused === null) return { ...base, ok: true, to: arrow.to };
    reason ||= refused;
  }
  return { ...base, ok: false, reason };
}

/** Event types that have at least one drawn arrow out of this state. */
export function eventsFrom<S extends string, E extends MachineEvent, C>(machine: Machine<S, E, C>, state: S): string[] {
  return [...new Set(machine.arrows.filter((a) => a.from.includes(state)).map((a) => a.on))];
}
