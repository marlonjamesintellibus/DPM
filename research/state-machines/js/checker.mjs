// A small explicit-state model checker for the DPM specs.
// It does what TLC does for these models: breadth-first search of every
// reachable state, invariants, action properties, leads-to (~>) under weak
// fairness, and refinement against a simpler spec.
//
// A model is:
//   init()                     -> array of initial states
//   actions: [{ name, params: [[args]], fair, step(state, ...args) -> [next states] }]
//   invariants:        { Name: (s) => bool }
//   actionProperties:  { Name: (s, t) => bool }            like [][P]_vars
//   leadsTo:           { Name: [{ label, P, Q }] }          like P ~> Q, one entry per instance
//   refinement:        { init: (s) => bool, step: (s, t) => bool }
// Steps that do not change the state are stuttering steps and are ignored,
// as in TLA+. A fair action gets weak fairness: WF_vars(A).

import { stableKey } from './lib.mjs';

export function check(model, { maxStates = 5_000_000 } = {}) {
  const nodes = [];
  const index = new Map();
  const invNames = Object.keys(model.invariants ?? {});
  const invFail = {};

  const add = (state, parent, via) => {
    const id = nodes.length;
    const key = stableKey(state);
    nodes.push({ state, key, parent, via });
    index.set(key, id);
    for (const n of invNames) {
      if (!(n in invFail) && !model.invariants[n](state)) invFail[n] = id;
    }
    if (nodes.length > maxStates) throw new Error(`more than ${maxStates} states`);
    return id;
  };

  for (const s of model.init()) {
    if (!index.has(stableKey(s))) add(s, -1, 'Init');
  }

  const instances = [];
  for (const a of model.actions) {
    for (const args of a.params) {
      instances.push({
        step: a.step,
        args,
        label: args.length ? `${a.name}(${args.join(', ')})` : a.name,
        fair: !!a.fair,
      });
    }
  }

  const apNames = Object.keys(model.actionProperties ?? {});
  const apFail = {};
  const ref = model.refinement;
  const refFail = { init: null, step: null };
  const edges = [];
  const enabledFair = [];

  for (let i = 0; i < nodes.length; i++) {
    const s = nodes[i].state;
    if (ref && nodes[i].parent === -1 && !refFail.init && !ref.init(s)) refFail.init = i;
    const out = [];
    const enabled = new Set();
    for (let j = 0; j < instances.length; j++) {
      const inst = instances[j];
      for (const t of inst.step(s, ...inst.args)) {
        const key = stableKey(t);
        if (key === nodes[i].key) continue;
        if (inst.fair) enabled.add(j);
        let to = index.get(key);
        if (to === undefined) to = add(t, i, inst.label);
        out.push({ to, inst: j });
        for (const n of apNames) {
          if (!(n in apFail) && !model.actionProperties[n](s, t)) apFail[n] = { from: i, to, label: inst.label };
        }
        if (ref && !refFail.step && !ref.step(s, t)) refFail.step = { from: i, to, label: inst.label };
      }
    }
    edges.push(out);
    enabledFair.push(enabled);
  }

  const pathTo = (id) => {
    const steps = [];
    for (let k = id; k !== -1; k = nodes[k].parent) steps.push({ label: nodes[k].via, state: nodes[k].state });
    return steps.reverse();
  };
  const stepTrace = ({ from, to, label }) => [...pathTo(from), { label, state: nodes[to].state }];

  const result = {
    name: model.name,
    states: nodes.length,
    edges: edges.reduce((n, e) => n + e.length, 0),
    failures: {},
  };
  for (const [n, id] of Object.entries(invFail)) result.failures[n] = { kind: 'invariant', trace: pathTo(id) };
  for (const [n, f] of Object.entries(apFail)) result.failures[n] = { kind: 'action property', trace: stepTrace(f) };
  for (const [name, list] of Object.entries(model.leadsTo ?? {})) {
    for (const { label, P, Q } of list) {
      const v = checkLeadsTo({ nodes, edges, enabledFair, instances, pathTo }, P, Q);
      if (v) {
        result.failures[name] = { kind: 'liveness', instance: label, ...v };
        break;
      }
    }
  }
  if (ref) {
    if (refFail.init !== null) result.failures.Refines = { kind: 'refinement', trace: pathTo(refFail.init) };
    else if (refFail.step) result.failures.Refines = { kind: 'refinement', trace: stepTrace(refFail.step) };
  }
  result.checked = [
    ...invNames,
    ...apNames,
    ...Object.keys(model.leadsTo ?? {}),
    ...(ref ? ['Refines'] : []),
  ];
  return result;
}

// P ~> Q fails when some reachable state has P and not Q, and from there a
// fair behaviour can stay out of Q forever. That means one of:
//   a state outside Q where every fair action is disabled (stutter forever), or
//   a cycle outside Q in which every fair action is either taken or disabled somewhere.
function checkLeadsTo({ nodes, edges, enabledFair, instances, pathTo }, P, Q) {
  const N = nodes.length;
  const outsideQ = new Uint8Array(N);
  for (let i = 0; i < N; i++) outsideQ[i] = Q(nodes[i].state) ? 0 : 1;

  // States reachable from a P-and-not-Q state without passing through Q
  const parent = new Int32Array(N).fill(-2);
  const queue = [];
  for (let i = 0; i < N; i++) {
    if (outsideQ[i] && P(nodes[i].state)) {
      parent[i] = -1;
      queue.push(i);
    }
  }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h];
    for (const e of edges[i]) {
      if (outsideQ[e.to] && parent[e.to] === -2) {
        parent[e.to] = i;
        queue.push(e.to);
      }
    }
  }
  const inRegion = (i) => parent[i] !== -2;

  const labelOf = (from, to) => instances[edges[from].find((e) => e.to === to).inst].label;
  const stemTo = (x) => {
    const seg = [];
    let k = x;
    while (parent[k] !== -1) {
      seg.push(k);
      k = parent[k];
    }
    seg.reverse();
    const steps = pathTo(k);
    let prev = k;
    for (const id of seg) {
      steps.push({ label: labelOf(prev, id), state: nodes[id].state });
      prev = id;
    }
    return steps;
  };

  for (const i of queue) {
    if (enabledFair[i].size === 0) {
      return { trace: stemTo(i), loop: 'stutters here forever (no fair action is enabled)' };
    }
  }

  const fairIds = instances.map((x, j) => (x.fair ? j : -1)).filter((j) => j >= 0);
  const succ = (i) => edges[i].filter((e) => inRegion(e.to)).map((e) => e.to);
  for (const comp of tarjan(queue, succ)) {
    if (comp.length < 2) continue;
    const inComp = new Set(comp);
    const fair = fairIds.every(
      (j) =>
        comp.some((i) => !enabledFair[i].has(j)) ||
        comp.some((i) => edges[i].some((e) => e.inst === j && inComp.has(e.to))),
    );
    if (!fair) continue;
    const x = comp[0];
    const cyc = cycleThrough(x, (i) => succ(i).filter((w) => inComp.has(w)));
    const loop = [];
    let prev = x;
    for (const id of cyc) {
      loop.push({ label: labelOf(prev, id), state: nodes[id].state });
      prev = id;
    }
    return { trace: stemTo(x), loop, loopStates: comp.length };
  }
  return null;
}

// Iterative Tarjan strongly connected components
function tarjan(vertices, succ) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const out = [];
  const visit = (v) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
  };
  for (const v0 of vertices) {
    if (index.has(v0)) continue;
    visit(v0);
    const work = [[v0, succ(v0), 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, ss] = frame;
      if (frame[2] < ss.length) {
        const w = ss[frame[2]++];
        if (!index.has(w)) {
          visit(w);
          work.push([w, succ(w), 0]);
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v), index.get(w)));
        }
      } else {
        work.pop();
        if (work.length) {
          const u = work[work.length - 1][0];
          low.set(u, Math.min(low.get(u), low.get(v)));
        }
        if (low.get(v) === index.get(v)) {
          const comp = [];
          let w;
          do {
            w = stack.pop();
            onStack.delete(w);
            comp.push(w);
          } while (w !== v);
          out.push(comp);
        }
      }
    }
  }
  return out;
}

// Shortest path from x back to x, as the list of states after x
function cycleThrough(x, succ) {
  const parent = new Map();
  const queue = [x];
  for (let h = 0; h < queue.length; h++) {
    const v = queue[h];
    for (const w of succ(v)) {
      if (w === x) {
        const path = [x];
        for (let k = v; k !== x; k = parent.get(k)) path.push(k);
        return path.reverse();
      }
      if (!parent.has(w)) {
        parent.set(w, v);
        queue.push(w);
      }
    }
  }
  return [];
}

// Trace printing: the first state in full, then only what changed
function flatten(v, prefix = '', out = {}) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of Object.keys(v)) flatten(v[k], prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = JSON.stringify(v);
  }
  return out;
}

export function formatTrace(steps, indent = '    ') {
  const lines = [];
  let prev = null;
  steps.forEach((step, n) => {
    const flat = flatten(step.state);
    const changed = Object.entries(flat).filter(([k, v]) => !prev || prev[k] !== v);
    const body = changed.map(([k, v]) => `${k} = ${v}`).join(', ');
    lines.push(`${indent}${n + 1}. ${step.label}${body ? `: ${body}` : ''}`);
    prev = flat;
  });
  return lines.join('\n');
}

// Replays a story the way the Atlas map replays its stories with TLC: the
// checker may take only the story's moves, in order. Every move must be
// possible, every state must keep the model's invariants, and each step must
// change exactly the rows the story says, to the values it says.
//
// story = {
//   start(state) -> bool        picks the initial state
//   setup: [[action, ...args]]  moves made before the story begins
//   rows: { path: {...} }       the rows to watch; "view.x" reads model.views.x
//   steps: [{ moves: [[action, ...args]], expect: { path: value } }]
// }
export function replay(model, story) {
  const byName = Object.fromEntries(model.actions.map((a) => [a.name, a]));
  const views = model.views ?? {};
  const read = (s, path) =>
    path.startsWith('view.') ? views[path.slice(5)](s) : path.split('.').reduce((o, k) => o?.[k], s);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const watched = Object.keys(story.rows);
  const snapshot = (s) => Object.fromEntries(watched.map((p) => [p, read(s, p)]));

  const move = (s, [name, ...args], wanted) => {
    const action = byName[name];
    const label = `${name}(${args.join(', ')})`;
    if (!action) return { error: `${label} is not a move this design has` };
    const next = action.step(s, ...args);
    if (!next.length) return { error: `${label} is not possible here` };
    return { state: (wanted && next.find(wanted)) || next[0] };
  };
  const brokenInvariant = (s) =>
    Object.entries(model.invariants ?? {}).find(([, inv]) => !inv(s))?.[0];

  const start = model.init().find(story.start);
  if (!start) return { ok: false, failedAt: 0, reason: 'no starting state matches the story' };
  let s = start;
  for (const mv of story.setup ?? []) {
    const r = move(s, mv);
    if (r.error) return { ok: false, failedAt: 0, reason: `before the story: ${r.error}` };
    s = r.state;
  }

  const before = snapshot(s);
  const steps = [];
  let rowsChecked = 0;
  for (const [n, step] of story.steps.entries()) {
    const fail = (reason) => ({ ok: false, failedAt: n + 1, reason, before, steps });
    const prev = snapshot(s);
    const matches = (t) => Object.entries(step.expect).every(([p, v]) => eq(read(t, p), v));
    for (const [k, mv] of step.moves.entries()) {
      const r = move(s, mv, k === step.moves.length - 1 ? matches : null);
      if (r.error) return fail(r.error);
      s = r.state;
      const broken = brokenInvariant(s);
      if (broken) return fail(`invariant ${broken} is broken`);
    }
    const now = snapshot(s);
    const wrong = Object.keys(step.expect).find((p) => !eq(now[p], step.expect[p]));
    if (wrong) return fail({ path: wrong, actual: now[wrong], expected: step.expect[wrong] });
    const changed = watched.filter((p) => !eq(now[p], prev[p]));
    const extra = changed.find((p) => !(p in step.expect));
    if (extra) return fail({ path: extra, actual: now[extra], expected: prev[extra] });
    rowsChecked += Object.keys(step.expect).length;
    steps.push({ changes: changed.map((p) => ({ path: p, from: prev[p], to: now[p] })), state: now });
  }
  return { ok: true, before, steps, rowsChecked };
}
