// Atlas reads one capture and proposes items (build plan 5.1 step 3, phase 4). An extractor only
// proposes: what it returns is untrusted and goes through the 14 server checks before anyone sees it.
import type { CheckContext, RawProposal } from "../domain/atlas-checks/types";

/** Why a read failed, as the capture machine records it (M2 READ_FAILED, E18, E19). */
export type ReadFailure = "model_error" | "timeout" | "bad_output";

export class AtlasReadFailed extends Error {
  constructor(
    readonly why: ReadFailure,
    message: string,
  ) {
    super(message);
    this.name = "AtlasReadFailed";
  }
}

export type Usage = { inputTokens: number; outputTokens: number; costUsd: number | null };

/** A proposal the model sent that did not have the shape of one; logged, never shown. */
export type Malformed = { index: number; issues: string };

export type Extraction = {
  proposals: RawProposal[];
  malformed: Malformed[];
  /** The model that answered, as the provider names it ("anthropic/claude-sonnet-5.5", "fixture"). */
  model: string;
  usage: Usage | null;
};

export interface Extractor {
  readonly name: string;
  /** Throws AtlasReadFailed; anything else thrown is treated as a model error. */
  extract(context: CheckContext, options?: { signal?: AbortSignal }): Promise<Extraction>;
}

/** Text drafted by Atlas for a person to read and edit (a reason for a set status). */
export interface Drafter {
  readonly name: string;
  draft(system: string, user: string, options?: { signal?: AbortSignal }): Promise<{ text: string; model: string; usage: Usage | null }>;
}
