// Atlas reads a capture (build plan 5.1 steps 2 to 5, phase 4): start the read, ask the model with
// no transaction open, then store what passes the checks or record the failure and try again.
// After config.captureMaxTries the capture fails and the author is told to try again or type it (E18).
import { AtlasReadFailed, type Extraction, type Extractor, type ReadFailure } from "../atlas/extractor";
import { config } from "../domain/config";
import { beginRead, failRead, proposeItems, type Proposed } from "./capture";
import type { CommandCtx } from "./core";

export type ReadResult =
  | ({ outcome: "proposed" } & Proposed & { model: string })
  | { outcome: "failed"; tries: number; failures: { why: ReadFailure; message: string }[] };

export type ReadOptions = {
  /** Wait before try n+1; tests pass 0. Default 2s, then 4s. */
  retryDelayMs?: (tries: number) => number;
  sleep?: (ms: number) => Promise<void>;
  /** Commands take the time as input; a read that retries asks again for each step. */
  clock?: () => Date;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function readCapture(ctx: CommandCtx, captureId: string, extractor: Extractor, options: ReadOptions = {}): Promise<ReadResult> {
  const { retryDelayMs = (n) => 2000 * 2 ** (n - 1), sleep = wait, clock } = options;
  const at = (): CommandCtx => (clock ? { ...ctx, now: clock() } : ctx);
  const failures: { why: ReadFailure; message: string }[] = [];
  for (;;) {
    const started = await beginRead(at(), captureId);
    if (!started.context) return { outcome: "failed", tries: started.tries, failures };
    // Only the model call can fail into a retry; a database refusal or a bug surfaces as it is
    let extraction: Extraction;
    try {
      extraction = await extractor.extract(started.context);
    } catch (e) {
      const why: ReadFailure = e instanceof AtlasReadFailed ? e.why : "model_error";
      const message = e instanceof Error ? e.message : String(e);
      failures.push({ why, message });
      await failRead(at(), captureId, why, { model: extractor.name, message });
      // The last try needs no wait: the next beginRead fails the capture
      if (started.tries < config.captureMaxTries) await sleep(retryDelayMs(started.tries));
      continue;
    }
    const proposed = await proposeItems(at(), captureId, extraction.proposals, {
      model: extraction.model,
      usage: extraction.usage,
      malformed: extraction.malformed,
    });
    return { outcome: "proposed", ...proposed, model: extraction.model };
  }
}
