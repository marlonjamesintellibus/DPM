// Builds ../dpm-machine-map.html: runs every check and replays every story,
// then writes the page from the results. Nothing on the page about a check or
// a story is typed by hand; rerun this after any change to a model or story.
//
//   node build-map.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check, replay } from './checker.mjs';
import { ROWS, PLANTS } from './checks.mjs';
import { STORIES } from './stories.mjs';
import { SHAPES, RULES, AREAS, MACHINES, RULE_STATUSES, OWNERS, DECISIONS, PROMISES } from './map-data.mjs';

const esc = (v) =>
  String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const STATUS_KEYS = ['not_started', 'on_track', 'at_risk', 'off_track', 'done'];
const TONE = { on_track: 'ok', at_risk: 'warn', off_track: 'bad', not_started: 'neutral', done: 'neutral' };
const shapeById = Object.fromEntries(SHAPES.map((s) => [s.id, s]));
const today = new Date().toISOString().slice(0, 10);

// ---------- run everything ----------
const results = [...ROWS, ...PLANTS].map((row) => {
  const r = check(row.model);
  const failed = Object.keys(r.failures);
  const match = failed.length === row.expectFail.length && row.expectFail.every((n) => failed.includes(n));
  return { ...row, states: r.states, failed, checked: r.checked, match, plant: PLANTS.includes(row) };
});
const replays = STORIES.map((st) => ({ st, run: replay(st.model, st), bug: replay(st.bug.model, st) }));

const allMatch = results.every((r) => r.match);
const storiesOk = replays.every((x) => x.run.ok && !x.bug.ok);
const properties = new Set(results.filter((r) => !r.plant).flatMap((r) => r.checked.map((c) => `${r.spec}.${c}`))).size;
const statesTotal = results.reduce((n, r) => n + r.states, 0);

// ---------- small renderers ----------
const chip = (shapeId, label) =>
  `<span class="chip sh-${shapeId}"><span class="glyph" aria-hidden="true"></span>${esc(label ?? shapeById[shapeId].name)}</span>`;

function fmtValue(row, v) {
  if (v === undefined) return 'none';
  const key = typeof v === 'object' ? JSON.stringify(v) : String(v);
  const text = row.values?.[key] ?? (typeof v === 'number' ? String(v) : key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
  if (typeof v === 'string' && STATUS_KEYS.includes(v)) return `<span class="st st-${TONE[v]}">${esc(text)}</span>`;
  return esc(text);
}

function storyPanel({ st, run, bug }, index) {
  const n = st.steps.length;
  const rowsChecked = run.rowsChecked ?? 0;
  const badge = run.ok
    ? `<p class="replayed ok"><span aria-hidden="true">✓</span> Replayed by the checker: all ${n} steps happen, and all ${rowsChecked} machine rows match.</p>`
    : `<p class="replayed bad">Replay failed at step ${run.failedAt}: ${esc(JSON.stringify(run.reason))}</p>`;

  const stepCards = st.steps
    .map((step, k) => {
      const done = run.steps?.[k];
      const changes = (done?.changes ?? [])
        .map((c) => {
          const row = st.rows[c.path];
          return `<tr><td class="what">${esc(row.label)}</td><td class="state">${fmtValue(row, c.from)} <span class="arrow">→</span> <b>${fmtValue(row, c.to)}</b></td><td>${chip(row.shape, row.machine)}</td></tr>`;
        })
        .join('');
      const sees = st.people
        .map((who, i) => `<div class="sees"><div class="who">${esc(who)}</div><div class="screen">${esc(step.sees[i])}</div></div>`)
        .join('');
      return `<div class="step" data-step="${k}"${k ? ' hidden' : ''}>
        <div class="eyebrow">Step ${k + 1} of ${n}</div>
        <h4>${esc(step.title)}</h4>
        <div class="sees-grid">${sees}</div>
        <div class="scroll"><table class="rows"><thead><tr><th>What changed</th><th>State</th><th>Machine</th></tr></thead><tbody>${changes}</tbody></table></div>
      </div>`;
    })
    .join('');

  const watched = Object.keys(st.rows);
  const allAtOnce = `<div class="scroll"><table class="grid-table"><thead><tr><th>Row</th><th>Before</th>${st.steps
    .map((s, k) => `<th>Step ${k + 1}</th>`)
    .join('')}</tr></thead><tbody>${watched
    .map((p) => {
      const row = st.rows[p];
      const cells = (run.steps ?? []).map((s, k) => {
        const changed = s.changes.some((c) => c.path === p);
        return `<td class="${changed ? 'changed' : ''}">${fmtValue(row, s.state[p])}</td>`;
      });
      return `<tr><th scope="row">${esc(row.label)}<div class="sub">${chip(row.shape, row.machine)}</div></th><td>${fmtValue(row, run.before?.[p])}</td>${cells.join('')}</tr>`;
    })
    .join('')}</tbody></table></div>`;

  const bugLine = bug.ok
    ? `<p class="replayed bad">The planted bug was not caught: ${esc(st.bug.text)}.</p>`
    : `<p>We broke DPM on purpose, and the replay had to fail: <b>${esc(st.bug.text)}</b>. Caught at step ${bug.failedAt} (${esc(
        st.steps[bug.failedAt - 1]?.title ?? 'before the story',
      )}): ${esc(
        typeof bug.reason === 'string'
          ? bug.reason
          : `${st.rows[bug.reason.path].label} is ${stripTags(fmtValue(st.rows[bug.reason.path], bug.reason.actual))}; the story says ${stripTags(
              fmtValue(st.rows[bug.reason.path], bug.reason.expected),
            )}`,
      )}.</p>`;

  return `<div class="story" id="st-${st.id}" role="tabpanel" aria-labelledby="tab-${st.id}"${index ? ' hidden' : ''}>
    <p class="summary">${esc(st.summary)}</p>
    <div class="badge-row">${badge}<span class="refs">${st.refs.map((r) => `<span class="ref">${esc(r)}</span>`).join('')}</span></div>
    ${st.before ? `<p class="before"><span class="eyebrow">Before the story</span> ${esc(st.before)}</p>` : ''}
    <div class="stepper">
      <div class="step-buttons" role="group" aria-label="Steps">${st.steps
        .map((s, k) => `<button type="button" class="num${k ? '' : ' on'}" data-go="${k}" aria-label="Step ${k + 1}">${k + 1}</button>`)
        .join('')}</div>
      <div class="nav-buttons"><button type="button" data-move="-1">Back</button><button type="button" data-move="1" class="primary">Next</button></div>
    </div>
    <div class="step-card">${stepCards}</div>
    <p class="note">${esc(st.note)}</p>
    <details><summary>All steps at once</summary>${allAtOnce}</details>
    <details><summary>How we know the replay works</summary>${bugLine}</details>
  </div>`;
}
const stripTags = (h) => h.replace(/<[^>]+>/g, '');

// ---------- sections ----------
const shapeCounts = Object.fromEntries(SHAPES.map((s) => [s.id, MACHINES.filter((m) => m.shape === s.id).length]));
shapeCounts.rule = RULE_STATUSES.length;

const heroChips = SHAPES.map(
  (s) => `<span class="chip sh-${s.id}"><span class="glyph" aria-hidden="true"></span>${shapeCounts[s.id]} ${esc(shapeCounts[s.id] === 1 ? s.name : s.name.endsWith('ch') ? `${s.name}es` : `${s.name}s`)}</span>`,
).join('');

const storiesSection = `
<section id="stories" aria-labelledby="stories-h">
  <h2 id="stories-h">Start here: how DPM behaves</h2>
  <p class="lede">${replays.length} short stories from the Intellibus snapshot (Tuesday 20 Oct 2026). Each step shows what people see and, under it, the machines that changed. The checker replays every story move by move and checks every machine row. The lines under each person are yours to judge: is that what DPM should show?</p>
  <div class="tabs" role="tablist">${replays
    .map(
      ({ st }, i) =>
        `<button type="button" role="tab" id="tab-${st.id}" aria-controls="st-${st.id}" aria-selected="${i === 0}" class="tab${i ? '' : ' on'}">${esc(st.tab)}</button>`,
    )
    .join('')}</div>
  ${replays.map(storyPanel).join('')}
  <div class="always">
    <h3>Always true, in every run the checker tries</h3>
    <p>A story is one way things can go. These are checked in every order things can happen, in every reachable state of the models.</p>
    <ul class="checks">${PROMISES.map(([spec, text]) => {
      const fails = text.includes('fails under');
      return `<li class="${fails ? 'fails' : ''}"><span class="mark" aria-hidden="true">${fails ? '!' : '✓'}</span><span>${esc(text)} <span class="ref">${esc(spec)}</span></span></li>`;
    }).join('')}</ul>
  </div>
</section>`;

const shapesSection = `
<section id="shapes" aria-labelledby="shapes-h">
  <h2 id="shapes-h">8 shapes, and statuses as rules</h2>
  <p class="lede">Every DPM machine is one of the 7 shapes the Atlas map already uses, or 1 new one, Stage. A shape that is checked once holds for every machine built from it. Statuses are not machines at all; they are rules over machines.</p>
  <div class="shape-grid">${SHAPES.map((s) => {
    const examples = MACHINES.filter((m) => m.shape === s.id).map((m) => m.name);
    const exampleText =
      s.id === 'rule'
        ? `${RULE_STATUSES.length} rules, such as ${RULE_STATUSES.slice(0, 4).map((r) => r[0]).join(', ')}`
        : `${examples.length} machines, such as ${examples.slice(0, 5).join(', ')}${examples.length > 5 ? ` and ${examples.length - 5} more` : ''}`;
    return `<article class="shape-card" id="shape-${s.id}">
      <header>${chip(s.id)}${s.fromAtlas ? '<span class="from">from Atlas</span>' : `<span class="from new">${s.id === 'rule' ? 'not a machine' : 'new for DPM'}</span>`}</header>
      <p>${esc(s.line)}</p>
      <div class="states">${s.states.map((x) => `<span class="state-pill">${esc(x)}</span>`).join('')}</div>
      <ul class="arrows">${s.arrows.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
      <ul class="notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      <p class="examples">${esc(exampleText)}</p>
    </article>`;
  }).join('')}</div>
</section>`;

const rulesSection = `
<section id="rules" aria-labelledby="rules-h">
  <h2 id="rules-h">8 rules every machine follows</h2>
  <p class="lede">These replace special cases. Rules 1 to 3, 6 and 7 come from the Atlas map; 4 and 5 are DPM principles; 8 came out of the checker. Stories and decisions refer to them by number.</p>
  <ol class="rules">${RULES.map(([h, b]) => `<li><b>${esc(h)}</b> ${esc(b)}</li>`).join('')}</ol>
</section>`;

const mapSection = `
<section id="map" aria-labelledby="map-h">
  <h2 id="map-h">How the pieces fit</h2>
  <p class="lede">Machines belong to owners. When an owner ends, everything under it ends too: close a project and its inbox items close; delete a capture and its pending updates go.</p>
  <div class="owners">${OWNERS.map(
    (o) => `<div class="owner"><div class="owner-h">${chip(o.shape, o.name)}</div><ul>${o.owns.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`,
  ).join('')}</div>
</section>`;

const areasSection = `
<section id="areas" aria-labelledby="areas-h">
  <h2 id="areas-h">Every area</h2>
  <p class="lede">${MACHINES.length} machines from Part C and Part A of the knowledge base, area by area. A tick means a model covers it today; the rest are mapped to a shape but not modelled yet.</p>
  ${AREAS.map((a) => {
    const ms = MACHINES.filter((m) => m.area === a.id);
    const checked = ms.filter((m) => m.checked).length;
    return `<div class="area" id="area-${a.id}">
      <div class="area-h"><h3>${esc(a.name)}</h3><span class="meta">${ms.length} machines · ${checked} checked · ${esc(a.refs)}</span></div>
      <div class="scroll"><table class="machines"><thead><tr><th>Machine</th><th>Shape</th><th>States</th><th>KB</th><th>Checked</th></tr></thead><tbody>${ms
        .map(
          (m) =>
            `<tr><td class="what">${esc(m.name)}</td><td>${chip(m.shape)}</td><td class="states-cell">${esc(m.states)}</td><td class="kb">${esc(m.refs)}</td><td>${
              m.checked ? `<span class="tick" title="Covered by the ${esc(m.checked)} model">✓ ${esc(m.checked)}</span>` : '<span class="muted">Not yet</span>'
            }</td></tr>`,
        )
        .join('')}</tbody></table></div>
    </div>`;
  }).join('')}
  <div class="area" id="area-rules">
    <div class="area-h"><h3>Statuses: rules, not machines</h3><span class="meta">${RULE_STATUSES.length} rules · A10.2</span></div>
    <div class="scroll"><table class="machines"><thead><tr><th>Rule</th><th>Calculated from</th><th>KB</th></tr></thead><tbody>${RULE_STATUSES.map(
      ([n, d, r]) => `<tr><td class="what">${esc(n)}</td><td>${esc(d)}</td><td class="kb">${esc(r)}</td></tr>`,
    ).join('')}</tbody></table></div>
  </div>
</section>`;

const decisionsSection = `
<section id="decisions" aria-labelledby="decisions-h">
  <h2 id="decisions-h">Decisions for you</h2>
  <p class="lede">First what this design changes from the knowledge base, then what the checker raised, then the open questions already in Part F.</p>
  <div class="dec-cols">
    <div><h3>Changes this design makes</h3><ul class="dec">${DECISIONS.changes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div><h3>Raised by the checker and the mapping</h3><ul class="dec raised">${DECISIONS.raised.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
  </div>
  <h3>Open in Part F</h3>
  <dl class="open-f">${DECISIONS.open.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
</section>`;

const tlaSection = `
<section id="tla" aria-labelledby="tla-h">
  <h2 id="tla-h">How it is checked</h2>
  <p class="lede">The specs are written in TLA+ (<code>tla-plus-and-tlc.md</code>), except BraidEntry, Routing and Match, which are JavaScript only so far. Until Java is installed, a JavaScript checker does what TLC would: it visits every reachable state of each model, checks every rule, checks that nothing waits forever, and replays every story. Each check must also catch a bug planted for it.</p>
  <div class="stat-row small">
    <div><span class="n">${results.filter((r) => !r.plant).length}</span><span class="l">settings</span></div>
    <div><span class="n">${properties}</span><span class="l">properties</span></div>
    <div><span class="n">${statesTotal.toLocaleString('en-US')}</span><span class="l">states visited</span></div>
    <div><span class="n">${PLANTS.length + STORIES.length}</span><span class="l">planted bugs</span></div>
  </div>
  <p class="result-line ${allMatch && storiesOk ? 'ok' : 'bad'}">${
    allMatch && storiesOk
      ? `✓ Every setting behaved as expected, every story replayed, and every planted bug was caught. Run on ${today}.`
      : 'Something did not match. See the rows marked No.'
  }</p>
  <div class="scroll"><table class="results"><thead><tr><th>Spec</th><th>Setting</th><th class="num-col">States</th><th>Expected</th><th>Result</th><th>Match</th></tr></thead><tbody>${results
    .map(
      (r) =>
        `<tr class="${r.plant ? 'plant' : ''}"><td>${esc(r.spec)}</td><td>${esc(r.setting)}</td><td class="num-col">${r.states.toLocaleString('en-US')}</td><td>${esc(
          r.expectFail.length ? `${r.expectFail.join(', ')} fails` : 'All pass',
        )}</td><td>${esc(r.failed.length ? `${r.failed.join(', ')} fails` : `All ${r.checked.length} pass`)}</td><td>${r.match ? '<span class="tick">Yes</span>' : '<b class="no">No</b>'}</td></tr>`,
    )
    .join('')}</tbody></table></div>
  <h3>How every model is checked</h3>
  <ul class="dec">
    <li><b>Each shape on its own first.</b> The Atlas map checks each of its 7 shapes once in TLA+. DPM can reuse those checks and add one for Stage.</li>
    <li><b>Then together.</b> Each DPM model joins a few machines and checks the rules between them, such as a set status and its reason, or an approval and the action it unlocks.</li>
    <li><b>Small enough to finish.</b> 2 or 3 of everything. Every model above finishes in under a second.</li>
    <li><b>Planted bugs.</b> Every check must fail on a bug planted for it, so a passing check is not a check that tests nothing.</li>
    <li><b>Stories.</b> The checker may take only a story's moves, in order, and every row must match as written.</li>
    <li><b>TLC next.</b> Once Java is installed, run the same specs in TLC and compare; any difference means the JavaScript port and the TLA+ have drifted.</li>
  </ul>
  <pre class="cmd"><code>cd research/state-machines/js
node run-all.mjs      # checks only
node build-map.mjs    # checks, stories, and this page</code></pre>
</section>`;

// ---------- page ----------
const html = `<title>DPM Machine Map</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">
<style>
/* Layout: one reading column, sticky section bar, cards only for shapes, steps and owners.
   Tokens follow the DPM / Precision design system (KB D4): Geist only, status tones, accent. */
:root {
  --bg: #fbfbfc; --surface: #ffffff; --sunk: #f3f4f7; --line: #e3e5ea; --line-strong: #d4d4d8;
  --fg: #17181c; --fg-2: #4b4f5a; --fg-3: #6f7380;
  --accent: #3e63dd; --ai: #6e56cf;
  --ok: #18794e; --warn: #ad5700; --bad: #ce2c31; --neutral: #8b8d98;
  --sh-switch: #0b6bcb; --sh-thing: #5b6474; --sh-membership: #4f46e5; --sh-ask: #6e56cf;
  --sh-job: #0e7490; --sh-presence: #b4236d; --sh-allowance: #8a5a2b; --sh-stage: #3e63dd; --sh-rule: #71717a;
  --font: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --r: 10px;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0e0f12; --surface: #16171b; --sunk: #1c1d22; --line: #2a2c33; --line-strong: #34343a;
  --fg: #ececf0; --fg-2: #b4b7c2; --fg-3: #8b8f9c;
  --accent: #7b96f0; --ai: #a593f0;
  --ok: #4cc38a; --warn: #f1a10d; --bad: #ff6369; --neutral: #9a9ca8;
  --sh-switch: #5aa7f0; --sh-thing: #a4adbb; --sh-membership: #8f88f7; --sh-ask: #a593f0;
  --sh-job: #3fb6cf; --sh-presence: #ec6fae; --sh-allowance: #d29a62; --sh-stage: #7b96f0; --sh-rule: #a1a1aa;
  color-scheme: dark;
} }
:root[data-theme="dark"] {
  --bg: #0e0f12; --surface: #16171b; --sunk: #1c1d22; --line: #2a2c33; --line-strong: #34343a;
  --fg: #ececf0; --fg-2: #b4b7c2; --fg-3: #8b8f9c;
  --accent: #7b96f0; --ai: #a593f0;
  --ok: #4cc38a; --warn: #f1a10d; --bad: #ff6369; --neutral: #9a9ca8;
  --sh-switch: #5aa7f0; --sh-thing: #a4adbb; --sh-membership: #8f88f7; --sh-ask: #a593f0;
  --sh-job: #3fb6cf; --sh-presence: #ec6fae; --sh-allowance: #d29a62; --sh-stage: #7b96f0; --sh-rule: #a1a1aa;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font-family: var(--font); font-size: 15px; line-height: 1.55; }
.wrap { max-width: 1040px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
h1, h2, h3, h4 { text-wrap: balance; margin: 0; line-height: 1.15; letter-spacing: -0.01em; }
h1 { font-size: clamp(2rem, 5vw, 3rem); font-weight: 700; letter-spacing: -0.025em; }
h2 { font-size: 1.75rem; font-weight: 650; }
h3 { font-size: 1.1rem; font-weight: 600; }
h4 { font-size: 1.15rem; font-weight: 600; }
p { margin: 0; }
code, .ref, .eyebrow, .meta, .kb, .num-col { font-family: var(--mono); }
code { font-size: 0.88em; background: var(--sunk); border: 1px solid var(--line); padding: 0.05em 0.35em; border-radius: 5px; }
.eyebrow { font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-3); }
.lede { color: var(--fg-2); max-width: 68ch; }
a { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

/* hero */
.hero { padding-block: 40px 28px; display: grid; gap: 18px; }
.hero .lede { font-size: 1.05rem; }
.stat-row { display: flex; flex-wrap: wrap; gap: 14px 36px; }
.stat-row > div { display: grid; }
.stat-row .n { font-size: 1.9rem; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.stat-row .l { font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-3); order: -1; }
.stat-row.small .n { font-size: 1.4rem; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }

/* shape chips (categories: never status colours, A4.1) */
.chip { --c: var(--sh-rule); display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px 2px 7px; border-radius: 999px; font-size: 12.5px; font-weight: 500; white-space: nowrap;
  color: var(--c); background: color-mix(in oklab, var(--c) 11%, transparent); border: 1px solid color-mix(in oklab, var(--c) 30%, transparent); }
.chip .glyph { width: 8px; height: 8px; border: 1.5px solid currentColor; border-radius: 2px; }
.sh-switch { --c: var(--sh-switch); } .sh-switch .glyph { border-radius: 999px; width: 12px; }
.sh-thing { --c: var(--sh-thing); }
.sh-membership { --c: var(--sh-membership); } .sh-membership .glyph { border-radius: 999px; }
.sh-ask { --c: var(--sh-ask); } .sh-ask .glyph { transform: rotate(45deg); width: 7px; height: 7px; }
.sh-job { --c: var(--sh-job); } .sh-job .glyph { border-style: dotted; border-radius: 999px; }
.sh-presence { --c: var(--sh-presence); } .sh-presence .glyph { background: currentColor; border-radius: 999px; width: 6px; height: 6px; }
.sh-allowance { --c: var(--sh-allowance); } .sh-allowance .glyph { border-top: 0; border-radius: 0 0 3px 3px; }
.sh-stage { --c: var(--sh-stage); } .sh-stage .glyph { border-left: 0; border-radius: 0; width: 10px; }
.sh-rule { --c: var(--sh-rule); } .sh-rule .glyph { border-style: dashed; }

/* status (only for things with a target) */
.st { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; }
.st::before { content: ""; width: 8px; height: 8px; border-radius: 999px; background: var(--tone); }
.st-ok { --tone: var(--ok); } .st-warn { --tone: var(--warn); } .st-bad { --tone: var(--bad); } .st-neutral { --tone: var(--neutral); }

/* section bar */
.bar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: color-mix(in oklab, var(--bg) 88%, transparent); backdrop-filter: blur(8px); border-block: 1px solid var(--line); }
.bar nav { display: flex; gap: 4px; overflow-x: auto; padding-block: 6px; scrollbar-width: none; }
.bar a { color: var(--fg-2); text-decoration: none; font-size: 13.5px; font-weight: 500; padding: 6px 10px; border-radius: 7px; white-space: nowrap; }
.bar a:hover { background: var(--sunk); color: var(--fg); }

section { padding-block: 44px 8px; display: grid; gap: 16px; scroll-margin-top: 56px; }
section > h2 + .lede { margin-top: -6px; }

/* stories */
.tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.tab, .num, .nav-buttons button { font: inherit; font-size: 13.5px; cursor: pointer; color: var(--fg-2); background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 6px 13px; }
.tab:hover, .num:hover, .nav-buttons button:hover { border-color: var(--line-strong); color: var(--fg); }
.tab.on { background: var(--fg); color: var(--bg); border-color: var(--fg); font-weight: 600; }
.story { display: grid; gap: 14px; }
.summary { font-size: 1.02rem; max-width: 68ch; }
.badge-row { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
.replayed { font-size: 13px; padding: 4px 10px; border-radius: 7px; }
.replayed.ok { color: var(--ok); background: color-mix(in oklab, var(--ok) 10%, transparent); border: 1px solid color-mix(in oklab, var(--ok) 28%, transparent); }
.replayed.bad, .result-line.bad { color: var(--bad); }
.refs { display: flex; gap: 6px; flex-wrap: wrap; }
.ref { font-size: 11.5px; color: var(--fg-3); border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; }
.before { color: var(--fg-2); font-size: 14px; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.stepper { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.step-buttons, .nav-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
.num { width: 34px; height: 34px; padding: 0; border-radius: 8px; font-family: var(--mono); }
.num.on { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.nav-buttons button { border-radius: 8px; }
.nav-buttons .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.nav-buttons button:disabled { opacity: 0.45; cursor: default; }
.step-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 18px; }
.step { display: grid; gap: 12px; }
.sees-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.sees { background: var(--sunk); border-radius: 8px; padding: 10px 12px; min-width: 0; }
.who { font-size: 12.5px; color: var(--fg-3); }
.screen { font-weight: 500; }
.scroll { overflow-x: auto; min-width: 0; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th { text-align: left; font-family: var(--mono); font-size: 11px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--fg-3); font-weight: 500; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
tbody tr:last-child td, tbody tr:last-child th { border-bottom: 0; }
td.what { font-weight: 600; }
td.state { white-space: nowrap; color: var(--fg-2); }
td.state b { color: var(--fg); font-weight: 600; }
.arrow { color: var(--fg-3); }
.note { color: var(--fg-2); font-size: 14px; max-width: 75ch; }
details { border-top: 1px solid var(--line); padding-top: 10px; }
summary { cursor: pointer; color: var(--accent); font-weight: 500; font-size: 14px; }
details[open] > summary { margin-bottom: 10px; }
details p { color: var(--fg-2); max-width: 75ch; }
.grid-table th[scope="row"] { text-transform: none; letter-spacing: 0; font-family: var(--font); font-size: 13.5px; color: var(--fg); font-weight: 600; white-space: normal; min-width: 180px; }
.grid-table .sub { margin-top: 4px; }
.grid-table td { white-space: nowrap; font-size: 13.5px; color: var(--fg-2); }
.grid-table td.changed { color: var(--fg); font-weight: 600; background: color-mix(in oklab, var(--accent) 8%, transparent); }
.always { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 18px; display: grid; gap: 10px; margin-top: 8px; }
.always > p { color: var(--fg-2); font-size: 14px; }
.checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
.checks li { display: flex; gap: 10px; align-items: baseline; }
.checks .mark { color: var(--ok); font-weight: 700; width: 1em; flex: none; }
.checks li.fails .mark { color: var(--warn); }
.checks .ref { margin-left: 4px; }

/* shapes */
.shape-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 12px; }
.shape-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 16px; display: grid; gap: 10px; align-content: start; min-width: 0; }
.shape-card header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.shape-card .chip { font-size: 14px; font-weight: 600; }
.from { font-family: var(--mono); font-size: 11px; color: var(--fg-3); text-transform: uppercase; letter-spacing: 0.07em; }
.from.new { color: var(--accent); }
.states { display: flex; flex-wrap: wrap; gap: 6px; }
.state-pill { font-size: 12.5px; padding: 3px 10px; border: 1.5px solid var(--line-strong); border-radius: 999px; background: var(--sunk); font-weight: 500; }
.arrows, .notes { margin: 0; padding-left: 18px; font-size: 13.5px; color: var(--fg-2); display: grid; gap: 3px; }
.arrows { font-family: var(--mono); font-size: 12.5px; list-style: none; padding-left: 0; }
.examples { font-size: 13px; color: var(--fg-3); border-top: 1px dashed var(--line); padding-top: 8px; }

/* rules */
.rules { margin: 0; padding-left: 1.6em; display: grid; gap: 10px; max-width: 80ch; }
.rules li::marker { font-family: var(--mono); color: var(--fg-3); }
.rules b { font-weight: 650; }

/* map */
.owners { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.owner { border: 1px solid var(--line); border-radius: var(--r); padding: 14px; background: var(--surface); }
.owner ul { margin: 10px 0 0; padding-left: 18px; color: var(--fg-2); font-size: 14px; display: grid; gap: 4px; }

/* areas */
.area { display: grid; gap: 8px; padding-top: 10px; }
.area-h { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 16px; border-bottom: 1.5px solid var(--line-strong); padding-bottom: 6px; }
.meta { font-size: 12px; color: var(--fg-3); }
.machines td { font-size: 13.5px; }
.machines td.what { min-width: 150px; }
.states-cell { color: var(--fg-2); min-width: 260px; }
.kb { font-size: 12px; color: var(--fg-3); white-space: nowrap; }
.tick { color: var(--ok); font-weight: 600; font-size: 13px; white-space: nowrap; }
.muted { color: var(--fg-3); font-size: 13px; white-space: nowrap; }

/* decisions */
.dec-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
.dec-cols > div { display: grid; gap: 10px; align-content: start; min-width: 0; }
.dec { margin: 0; padding-left: 18px; display: grid; gap: 8px; color: var(--fg-2); max-width: 75ch; }
.dec b { color: var(--fg); }
.dec.raised li::marker { color: var(--warn); }
.open-f { margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px 20px; }
.open-f div { display: flex; gap: 10px; align-items: baseline; border-bottom: 1px solid var(--line); padding-block: 6px; }
.open-f dt { font-family: var(--mono); font-size: 12px; color: var(--fg-3); width: 2.6em; flex: none; }
.open-f dd { margin: 0; font-size: 14px; }

/* checks */
.result-line { font-weight: 500; }
.result-line.ok { color: var(--ok); }
.results td { font-size: 13.5px; }
.results .num-col { text-align: right; font-variant-numeric: tabular-nums; font-size: 12.5px; }
.results tr.plant td:first-child::before { content: "Planted bug · "; color: var(--fg-3); font-size: 12px; }
.no { color: var(--bad); }
.cmd { background: var(--sunk); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin: 0; }
.cmd code { background: none; border: 0; padding: 0; font-size: 13px; }
footer { padding-block: 40px; color: var(--fg-3); font-size: 13px; }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
</style>

<div class="wrap">
  <header class="hero">
    <div class="eyebrow">DPM · a design for review · checked before build</div>
    <h1>DPM, built from<br>8 small shapes</h1>
    <p class="lede">The same idea as the Atlas machine map, applied to the Digital Project Manager. Start with the stories: what happens when people use DPM, step by step, each one replayed by the checker. Under the stories, every part of DPM from Part C of the knowledge base is a small state machine, and every machine is one of 8 shapes. Statuses are rules over those machines, never stored.</p>
    <div class="stat-row">
      <div><span class="n">${MACHINES.length}</span><span class="l">Machines</span></div>
      <div><span class="n">8</span><span class="l">Shapes</span></div>
      <div><span class="n">${AREAS.length}</span><span class="l">Areas</span></div>
      <div><span class="n">${STORIES.length}</span><span class="l">Stories</span></div>
      <div><span class="n">${MACHINES.filter((m) => m.checked).length}</span><span class="l">Machines checked</span></div>
    </div>
    <div class="chips">${heroChips}</div>
  </header>
</div>
<div class="bar"><div class="wrap"><nav aria-label="Sections">
  <a href="#stories">Stories</a><a href="#shapes">Shapes</a><a href="#rules">Rules</a><a href="#map">Map</a><a href="#areas">Areas</a><a href="#decisions">Decisions</a><a href="#tla">Checks</a>
</nav></div></div>
<main class="wrap">
${storiesSection}
${shapesSection}
${rulesSection}
${mapSection}
${areasSection}
${decisionsSection}
${tlaSection}
</main>
<div class="wrap"><footer>Built from DPM-knowledge-base.md (24 Oct 2026) and the Atlas machine map. Every name and number in the stories is a placeholder from Part B. Generated by <code>node build-map.mjs</code> on ${today}.</footer></div>

<script>
(() => {
  const tabs = [...document.querySelectorAll('.tab')];
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => { const on = t === tab; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); document.getElementById(t.getAttribute('aria-controls')).hidden = !on; });
  }));
  document.querySelectorAll('.story').forEach((story) => {
    const steps = [...story.querySelectorAll('.step')];
    const nums = [...story.querySelectorAll('.num')];
    const back = story.querySelector('[data-move="-1"]');
    const next = story.querySelector('[data-move="1"]');
    let at = 0;
    const show = (k) => {
      at = Math.max(0, Math.min(steps.length - 1, k));
      steps.forEach((s, i) => { s.hidden = i !== at; });
      nums.forEach((b, i) => { b.classList.toggle('on', i === at); b.setAttribute('aria-current', i === at ? 'step' : 'false'); });
      back.disabled = at === 0; next.disabled = at === steps.length - 1;
    };
    nums.forEach((b) => b.addEventListener('click', () => show(+b.dataset.go)));
    back.addEventListener('click', () => show(at - 1));
    next.addEventListener('click', () => show(at + 1));
    show(0);
  });
})();
</script>
`;

const out = fileURLToPath(new URL('../dpm-machine-map.html', import.meta.url));
writeFileSync(out, html);
console.log(`Wrote ${out}`);
console.log(`${results.length} check rows, ${allMatch ? 'all match' : 'MISMATCH'}; ${replays.length} stories, ${storiesOk ? 'all replay and all bugs caught' : 'PROBLEM'}`);
process.exit(allMatch && storiesOk ? 0 : 1);
