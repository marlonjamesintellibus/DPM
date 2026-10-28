// Phase S for the team building DPM (conversational plan, section 21): the weekly usage numbers and the
// eval candidates, read from the app's database. There is no maintainer role or screen yet (CD21), so
// whoever runs this is the maintainer. Stop `pnpm dev` first when the database is the local PGlite.
//
//   pnpm atlas:usage [--weeks 4]                     each org's numbers per week and topic, then the candidates
//   pnpm atlas:usage --org intellibus                one org's counts as its executives see them, never words (LF7)
//   pnpm atlas:usage --accept <id> --as <name> --case "<words with seed names and ids>" --expected "<what Atlas should do>"
//   pnpm atlas:usage --dismiss <id> --as <name> [--note "<why>"]
//
// A maintainer sees every count (W-D3). The executive view (--org) shows "-" for a number from fewer than
// 5 people, or one the numbers beside it would give by subtraction (LF8, CD28). There is no total across
// orgs, so one org's numbers cannot be taken from it (LF7).
import { acceptCandidate, dismissCandidate } from "../src/commands/learning";
import { CommandRefused } from "../src/commands/core";
import { openPglite, openPostgres, pgliteDir } from "../src/db/client";
import { config } from "../src/domain/config";
import { evalCandidateList, usageNumbers, usageOrgs, type Shown, type UsageWeek } from "../src/queries/usage";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}

const pct = (n: number | null) => (n === null ? "-" : `${Math.round(n * 100)}%`);
const cell = <T extends object>(s: Shown<T>, f: (n: T & { people: number }) => string) => (s.shown ? f(s) : "-");

function printWeek(w: UsageWeek) {
  console.log(`\nWeek of ${w.week}`);
  console.log(
    `  Questions: ${cell(w.answers, (a) => `${a.asked} from ${a.people} people; answered ${pct(a.answerRate)}, can't answer ${pct(a.cantAnswerRate)}, unclear ${pct(a.unclearRate)}, asked which with nothing chosen ${pct(a.unchosenRate)}; thumbs up ${a.thumbsUp}, down ${a.thumbsDown}`)}`,
  );
  for (const { topic, numbers } of w.topics) {
    if (numbers.shown) console.log(`    ${topic.padEnd(15)} ${numbers.asked} asked, up ${numbers.thumbsUp}, down ${numbers.thumbsDown}`);
  }
  const hidden = w.topics.filter((t) => !t.numbers.shown).length;
  if (hidden) console.log(`    ${hidden} topics not shown on their own, together: ${cell(w.rest, (r) => `${r.asked} asked, up ${r.thumbsUp}, down ${r.thumbsDown}`)}`);
  console.log(`  Updates: ${cell(w.updates, (u) => `${u.updates} from ${u.people} people, ${u.items} items; ${u.corrections} corrected, ${u.moved} moved in review`)}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  const opened = url ? openPostgres(url) : openPglite(pgliteDir());
  try {
    await opened.migrate();
    const ctx = { db: opened.db, now: new Date(), maintainer: arg("as") ?? "" };
    const accept = arg("accept");
    const dismiss = arg("dismiss");
    if (accept !== null || dismiss !== null) {
      if (!ctx.maintainer.trim()) {
        console.error("Say who you are with --as <name>.");
        process.exitCode = 1;
        return;
      }
      const done =
        accept !== null
          ? await acceptCandidate(ctx, accept, { caseText: arg("case") ?? "", expected: arg("expected") ?? "" })
          : await dismissCandidate(ctx, dismiss!, arg("note"));
      console.log(`${done.id} is now ${done.state.replace(/_/g, " ")}.`);
      return;
    }

    const orgId = arg("org");
    const weeks = Number(arg("weeks") ?? 4);
    const orgs = (await usageOrgs(opened.db)).filter((o) => orgId === null || o.id === orgId);
    if (!orgs.length) console.log(`No org ${orgId}.`);
    for (const org of orgs) {
      const view = orgId === null ? "maintainer" : "executive";
      const numbers = await usageNumbers(opened.db, { now: ctx.now, weeks: Number.isInteger(weeks) && weeks > 0 ? weeks : 4, orgId: org.id, view });
      const hiding = view === "executive" ? ` (a number from fewer than ${config.metricMinimumCount} people shows as "-")` : " (every count, for DPM maintainers)";
      console.log(`\nAtlas usage for ${org.name}, by week${hiding}`);
      numbers.forEach(printWeek);
    }
    // LF7: an org's executives see its counts, never anyone's words
    if (orgId !== null) return;

    const list = await evalCandidateList(opened.db);
    console.log("\nEval candidates by state and cause:", JSON.stringify(list.counts));
    console.log(`\nWaiting (${list.waiting.reduce((n, g) => n + g.count, 0)}), the same words grouped (LF5):`);
    for (const g of list.waiting) {
      console.log(`  ${g.count}x ${g.cause}: "${g.text}"`);
      for (const l of g.lines) console.log(`     ${l.id}  ${l.loggedAt.toISOString().slice(0, 10)}  ${JSON.stringify(l.detail ?? {})}`);
    }
    if (list.accepted.length) {
      console.log("\nIn the eval set, for src/atlas/eval/cases.ts:");
      for (const c of list.accepted) console.log(`  ${c.id} (${c.cause}): "${c.caseText}" -> ${c.expected}`);
    }
  } finally {
    await opened.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof CommandRefused ? `Refused: ${error.reason}` : error);
  process.exit(1);
});
