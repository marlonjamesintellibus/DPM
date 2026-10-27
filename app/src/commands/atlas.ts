// Atlas reads a capture (build plan 5.1 steps 2 to 5, phase 4): start the try, transcribe a voice
// note, ask the model with no transaction open, then store what passes the checks or record the
// failure and try again. After config.captureMaxTries the capture fails and the author is asked to
// send a new voice note (D1) or to try again or type it (E18).
import { inArray } from "drizzle-orm";
import { AtlasReadFailed, type Extraction, type Extractor, type ReadFailure } from "../atlas/extractor";
import { atlasTranscript, TranscribeFailed, type Transcriber } from "../atlas/transcriber";
import * as t from "../db/schema";
import type { CheckContext } from "../domain/atlas-checks/types";
import { config } from "../domain/config";
import type { Confidence } from "../domain/shared";
import { beginRead, failRead, failTranscribe, finishTranscribe, proposeItems, ReadSuperseded, type Proposed } from "./capture";
import type { CommandCtx } from "./core";

type Failure = { step: "transcribe" | "read"; why: string; message: string };

export type ReadResult =
  | ({ outcome: "proposed" } & Proposed & { model: string })
  | { outcome: "failed"; tries: number; failedStep: "transcribe" | "read"; failures: Failure[] }
  /** The stale timer or another worker moved the capture on; this run's answer was dropped (D19). */
  | { outcome: "superseded"; failures: Failure[] };

export type ReadOptions = {
  /** Wait before try n+1; tests pass 0. Default 2s, then 4s. */
  retryDelayMs?: (tries: number) => number;
  sleep?: (ms: number) => Promise<void>;
  /** Commands take the time as input; a read that retries asks again for each step. */
  clock?: () => Date;
  transcriber?: Transcriber;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function readCapture(ctx: CommandCtx, captureId: string, extractor: Extractor, options: ReadOptions = {}): Promise<ReadResult> {
  const { retryDelayMs = (n) => 2000 * 2 ** (n - 1), sleep = wait, clock, transcriber = atlasTranscript } = options;
  const at = (): CommandCtx => (clock ? { ...ctx, now: clock() } : ctx);
  const failures: Failure[] = [];
  // The last try needs no wait: the next beginRead fails the capture
  const pause = (tries: number) => (tries < config.captureMaxTries ? sleep(retryDelayMs(tries)) : Promise.resolve());
  try {
    for (;;) {
      const started = await beginRead(at(), captureId);
      if (started.state === "failed") return { outcome: "failed", tries: started.tries, failedStep: failures.at(-1)?.step ?? "read", failures };
      const attempt = started.tries;

      let context: CheckContext;
      if (started.voice) {
        // Only the transcriber's own failure is retried; a database refusal surfaces as it is
        let confidence: Confidence;
        try {
          ({ confidence } = await transcriber.transcribe(started.voice));
        } catch (e) {
          const why = e instanceof TranscribeFailed ? e.why : "error";
          const message = e instanceof Error ? e.message : String(e);
          failures.push({ step: "transcribe", why, message });
          await failTranscribe(at(), captureId, attempt, why, message);
          await pause(attempt);
          continue;
        }
        context = await finishTranscribe(at(), captureId, attempt, confidence);
      } else context = started.context!;

      // A voice note that was just transcribed is on its first read
      const readAttempt = started.voice ? 1 : attempt;
      let extraction: Extraction;
      try {
        extraction = await extractor.extract(context, { attempt: readAttempt });
      } catch (e) {
        const why: ReadFailure = e instanceof AtlasReadFailed ? e.why : "model_error";
        const message = e instanceof Error ? e.message : String(e);
        failures.push({ step: "read", why, message });
        await failRead(at(), captureId, why, { model: extractor.name, message, attempt: readAttempt });
        await pause(readAttempt);
        continue;
      }
      const proposed = await proposeItems(at(), captureId, extraction.proposals, {
        model: extraction.model,
        usage: extraction.usage,
        malformed: extraction.malformed,
        attempt: readAttempt,
        question: extraction.question ?? null,
      });
      return { outcome: "proposed", ...proposed, model: extraction.model };
    }
  } catch (e) {
    if (e instanceof ReadSuperseded) return { outcome: "superseded", failures };
    throw e;
  }
}

/** Captures waiting for a read: never started, or waiting to try again. A worker runs readCapture on each. */
export async function capturesToRead(db: CommandCtx["db"]): Promise<string[]> {
  const rows = await db
    .select({ id: t.captures.id })
    .from(t.captures)
    .where(inArray(t.captures.state, ["received", "transcribe_wait", "retry_wait"]))
    .orderBy(t.captures.receivedAt);
  return rows.map((r) => r.id);
}
