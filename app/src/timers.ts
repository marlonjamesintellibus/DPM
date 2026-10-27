// The rules' timers, run by the server every minute on the app's clock: a read that stopped answering
// is marked stale after 5 minutes and read again (D1, D19), unsaved reviews are reminded and expire
// (S4, E28), milestones past their target are missed, BRAID proposals and kind change requests are
// reminded (S18), a dependency whose promised date has passed is asked about (section 20, U2), an ask to
// the owner goes moot, is withdrawn or expires (M37, U5 and U7), eval candidates nobody decided are
// deleted after config.evalCandidateDays (phase S, M36), a chat command's card nobody answered expires
// after config.commandExpiryMinutes (phase B, M20, AC10), and corrections nobody decided are reminded,
// then expire (phase L, M31). Each timer is one command and safe to run again; a reminder never decides
// anything.
// DPM_TIMERS=off turns them off.
import { atlasFromEnv } from "./atlas";
import type { Extractor } from "./atlas/extractor";
import { now as appNow } from "./app/_lib/clock";
import { capturesToRead, readCapture } from "./commands/atlas";
import { runBraidReminders, runDependencyDue, runKindRequestReminders } from "./commands/braid";
import { runCaptureTimers } from "./commands/capture";
import { runChatCommandTimers } from "./commands/chat-command";
import { runEvalCandidateTimers } from "./commands/learning";
import { runMilestoneTimers } from "./commands/milestones";
import { runOwnerAskTimers } from "./commands/owner-ask";
import { runVocabularyTimers } from "./commands/vocabulary";
import { getDb, type Db } from "./db/client";
import * as t from "./db/schema";

/** A capture nobody started reading is picked up only after this, so it never races the chat's own read. */
const UNSTARTED_AFTER_MS = 2 * 60_000;

const state = globalThis as unknown as { dpmTimers?: ReturnType<typeof setInterval>; dpmTimerRunning?: boolean };

export type TimerRun = { failed: string[]; read: string[] };

export async function runTimers(opts: { db?: Db; now?: () => Date; extractor?: Extractor } = {}): Promise<TimerRun> {
  const db = opts.db ?? (await getDb());
  const now = opts.now ?? appNow;
  const run: TimerRun = { failed: [], read: [] };
  for (const timer of [runCaptureTimers, runMilestoneTimers, runBraidReminders, runKindRequestReminders, runDependencyDue, runOwnerAskTimers, runEvalCandidateTimers, runChatCommandTimers, runVocabularyTimers]) {
    // One failing timer does not stop the others; it runs again next minute
    try {
      await timer({ db, now: now() });
    } catch (error) {
      run.failed.push(timer.name);
      console.error(`timer ${timer.name} failed`, error);
    }
  }
  // D19: a read that went stale waits for another try; so does a note the server never started on
  const due = await capturesToRead(db);
  if (!due.length) return run;
  const rows = await db.select({ id: t.captures.id, authorId: t.captures.authorId, state: t.captures.state, receivedAt: t.captures.receivedAt }).from(t.captures);
  const extractor = opts.extractor ?? atlasFromEnv().extractor;
  for (const id of due) {
    const c = rows.find((r) => r.id === id);
    if (!c || (c.state === "received" && now().getTime() - c.receivedAt.getTime() < UNSTARTED_AFTER_MS)) continue;
    try {
      await readCapture({ db, now: now(), actorId: c.authorId }, id, extractor, { clock: now, drafter: opts.extractor ? null : atlasFromEnv().drafter });
      run.read.push(id);
    } catch (error) {
      run.failed.push(`read ${id}`);
      console.error(`reading ${id} failed`, error);
    }
  }
  return run;
}

export function startTimers(everyMs = 60_000): void {
  if (state.dpmTimers) return;
  state.dpmTimers = setInterval(async () => {
    if (state.dpmTimerRunning) return;
    state.dpmTimerRunning = true;
    try {
      await runTimers();
    } finally {
      state.dpmTimerRunning = false;
    }
  }, everyMs);
  state.dpmTimers.unref?.();
}

