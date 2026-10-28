// Runs the Atlas evaluation set against one or more models through OpenRouter (phase 4 step 7).
// Usage: pnpm atlas:eval [--only id,id] [model ...]. Defaults to the app's default model. Needs OPENROUTER_API_KEY
// in .env.local; the key is never printed. Results go to .data/atlas-eval/ (ignored by git). Phase G: the
// drafting cases (eval/drafts.ts) run on the app's draft model, each scored by the facts check (M25, DR2).
import { mkdirSync, writeFileSync } from "node:fs";
import { EVAL_CASES } from "../src/atlas/eval/cases";
import { scoreCase, type CaseScore } from "../src/atlas/eval/score";
import { AtlasReadFailed } from "../src/atlas/extractor";
import { createOpenRouter, DEFAULT_MODEL } from "../src/atlas/openrouter";
import { DEFAULT_DRAFT_MODEL } from "../src/atlas";
import { draftSystemPrompt, draftUserMessage } from "../src/atlas/draft";
import { DRAFT_EVAL_CASES, draftCaseFacts, scoreDraft, type DraftScore } from "../src/atlas/eval/drafts";
import type { Db } from "../src/db/client";
import { PROMPT_VERSION } from "../src/atlas/prompt";
import { caseContext, evalContexts } from "../src/atlas/eval/contexts";
import type { CheckContext, RawProposal } from "../src/domain/atlas-checks/types";
import { seededDb } from "../src/test/seeded-db";

type Run = { id: string; seconds: number; costUsd: number; failed?: string; score?: CaseScore; malformed: number; proposals?: RawProposal[] };

async function pool<T, R>(items: readonly T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

type Contexts = Awaited<ReturnType<typeof evalContexts>>;

async function evalModel(model: string, apiKey: string, cases: typeof EVAL_CASES, contexts: Contexts): Promise<Run[]> {
  const atlas = createOpenRouter({ apiKey, model, timeoutMs: 120_000 });
  return pool(cases, 4, async (c): Promise<Run> => {
    const started = Date.now();
    const ctx: CheckContext = caseContext(c, contexts);
    try {
      const out = await atlas.extract(ctx);
      return { id: c.id, seconds: (Date.now() - started) / 1000, costUsd: out.usage?.costUsd ?? 0, score: scoreCase(c, out.proposals, ctx, out.question ?? null, out.commands ?? []), malformed: out.malformed.length, proposals: out.proposals };
    } catch (e) {
      const why = e instanceof AtlasReadFailed ? `${e.why}: ${e.message}` : (e as Error).message;
      return { id: c.id, seconds: (Date.now() - started) / 1000, costUsd: 0, failed: why, malformed: 0 };
    }
  });
}

function summary(model: string, runs: Run[]) {
  const scored = runs.filter((r) => r.score).map((r) => r.score!);
  const sum = (f: (s: CaseScore) => number) => scored.reduce((a, s) => a + f(s), 0);
  const secs = runs.map((r) => r.seconds).sort((a, b) => a - b);
  return {
    model,
    cases: runs.length,
    passed: scored.filter((s) => s.pass).length,
    readFailed: runs.filter((r) => r.failed).length,
    expectedHit: `${sum((s) => s.hit)}/${sum((s) => s.expected)}`,
    extra: sum((s) => s.extra.length),
    forbidden: sum((s) => s.forbidden.length),
    chooseProject: sum((s) => s.chooseProject),
    malformed: runs.reduce((a, r) => a + r.malformed, 0),
    medianSeconds: secs[Math.floor(secs.length / 2)],
    costUsd: Number(runs.reduce((a, r) => a + r.costUsd, 0).toFixed(4)),
  };
}

type DraftRun = { id: string; seconds: number; costUsd: number; failed?: string; score?: DraftScore; text?: string };

/** Phase G: each drafting case written by the draft model, as the app asks it, and scored by the facts check. */
async function evalDrafts(model: string, apiKey: string, cases: typeof DRAFT_EVAL_CASES, db: Db): Promise<DraftRun[]> {
  const drafter = createOpenRouter({ apiKey, model, timeoutMs: 120_000 });
  return pool(cases, 4, async (c): Promise<DraftRun> => {
    const started = Date.now();
    const { facts, known } = await draftCaseFacts(db, c);
    try {
      const out = await drafter.draft(draftSystemPrompt(c.kind), draftUserMessage(facts));
      return { id: c.id, seconds: (Date.now() - started) / 1000, costUsd: out.usage?.costUsd ?? 0, score: scoreDraft(c, facts, known, out.text), text: out.text };
    } catch (e) {
      return { id: c.id, seconds: (Date.now() - started) / 1000, costUsd: 0, failed: (e as Error).message };
    }
  });
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set in .env.local");
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args.splice(args.indexOf("--only"), 2)[1].split(",") : null;
  const cases = only ? EVAL_CASES.filter((c) => only.includes(c.id)) : EVAL_CASES;
  const draftCases = only ? DRAFT_EVAL_CASES.filter((c) => only.includes(c.id)) : DRAFT_EVAL_CASES;
  const models = args.length ? args : [DEFAULT_MODEL];
  // Each author's data as the app loads it from the seed (D22)
  const db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  const contexts = await evalContexts(db);
  const results = cases.length ? await Promise.all(models.map(async (m) => ({ model: m, runs: await evalModel(m, apiKey, cases, contexts) }))) : [];
  const drafts = draftCases.length ? await evalDrafts(DEFAULT_DRAFT_MODEL, apiKey, draftCases, db) : [];
  const at = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(".data/atlas-eval", { recursive: true });
  const file = `.data/atlas-eval/${at}.json`;
  writeFileSync(file, JSON.stringify({ at, prompt: PROMPT_VERSION, results, drafts: { model: DEFAULT_DRAFT_MODEL, runs: drafts } }, null, 1));

  console.log(`prompt ${PROMPT_VERSION}, ${cases.length} cases, ${draftCases.length} drafting cases\n`);
  console.table(results.map((r) => summary(r.model, r.runs)));
  for (const r of results) {
    console.log(`\n## ${r.model}: cases that did not pass, or passed with extras`);
    for (const run of r.runs) {
      if (run.failed) console.log(`  ${run.id}: READ FAILED ${run.failed}`);
      else if (!run.score!.pass || run.score!.extra.length) {
        const s = run.score!;
        console.log(`  ${run.id}${s.pass ? " (pass)" : ""}: missing [${s.missing.join(", ")}] extra [${s.extra.join(", ")}] forbidden [${s.forbidden.join(", ")}]`);
      }
    }
  }
  if (drafts.length) {
    console.log(`\n## drafting on ${DEFAULT_DRAFT_MODEL}: ${drafts.filter((d) => d.score?.pass).length} of ${drafts.length} pass the facts check`);
    for (const d of drafts) {
      if (d.failed) console.log(`  ${d.id}: FAILED ${d.failed}`);
      else if (!d.score!.pass) console.log(`  ${d.id}: ${d.score!.problem ?? ""} forbidden [${d.score!.forbidden.join(", ")}]`);
    }
  }
  console.log(`\nfull results: ${file}`);
}

// The seeded PGlite keeps Node alive; leave once the report is written
main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
