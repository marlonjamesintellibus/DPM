// Turning a voice note into words (M2 transcribing, D1). Atlas, the messaging app, sends its
// transcript with the voice note; DPM checks there is one. A transcriber of DPM's own can replace
// this without touching the capture job.
import type { Confidence } from "../domain/shared";

export class TranscribeFailed extends Error {
  constructor(
    readonly why: "no_transcript" | "timeout" | "error",
    message: string,
  ) {
    super(message);
    this.name = "TranscribeFailed";
  }
}

export interface Transcriber {
  readonly name: string;
  /** Throws TranscribeFailed when there is nothing usable. */
  transcribe(voice: { text: string; confidence: Confidence | null }): Promise<{ confidence: Confidence }>;
}

/** Uses the transcript Atlas sent. A voice note with no transcript cannot be read. */
export const atlasTranscript: Transcriber = {
  name: "atlas-transcript",
  async transcribe({ text, confidence }) {
    if (!text.trim()) throw new TranscribeFailed("no_transcript", "Atlas sent the voice note without a transcript");
    // A transcript with no reported confidence is treated as unsure, so it can only lower items (G13)
    return { confidence: confidence ?? "medium" };
  },
};
