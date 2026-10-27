// Helpers shared by the models and the checker.
// Sets are sorted arrays, functions are plain objects, so a state is plain JSON.

export const clone = (v) => structuredClone(v);

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}

// Canonical text for a state, used to tell states apart
export const stableKey = (v) => JSON.stringify(sortKeys(v));

// All subsets of arr, each kept in arr's order (SUBSET S)
export function subsets(arr) {
  const out = [[]];
  for (const x of arr) {
    const n = out.length;
    for (let i = 0; i < n; i++) out.push([...out[i], x]);
  }
  return out;
}

// All functions from domain to range ([D -> R])
export function allFunctions(domain, range) {
  let out = [{}];
  for (const d of domain) {
    const next = [];
    for (const f of out) for (const r of range) next.push({ ...f, [d]: clone(r) });
    out = next;
  }
  return out;
}

// Cartesian product, used to list action parameters
export const product = (...lists) =>
  lists.reduce((acc, l) => acc.flatMap((a) => l.map((x) => [...a, x])), [[]]);
