// The recorded Atlas, for tests and for running without an OpenRouter key: it answers the messages
// it has a recording for and refuses the rest, so nothing pretends a real read happened. A one-sentence
// question is the exception (section 15, QA8): the rule in domain/question.ts spots it, and DPM answers
// it from data, so no read is pretended.
import type { RawProposal } from "../domain/atlas-checks/types";
import { KEMAR_NOTE, KEMAR_PROPOSALS } from "../domain/atlas-checks/kemar-note.fixture";
import { ruleQuestion } from "../domain/question";
import { AtlasReadFailed, type Extractor } from "./extractor";

const RECORDINGS = new Map<string, readonly RawProposal[]>([[KEMAR_NOTE, KEMAR_PROPOSALS]]);

export function createFixtureExtractor(recordings: ReadonlyMap<string, readonly RawProposal[]> = RECORDINGS): Extractor {
  return {
    name: "fixture",
    async extract(ctx) {
      const proposals = recordings.get(ctx.text);
      const asked = proposals ? null : ruleQuestion(ctx);
      if (asked) return { proposals: [], question: asked, malformed: [], model: "fixture", usage: null };
      if (!proposals) throw new AtlasReadFailed("model_error", "Atlas is not connected (no OPENROUTER_API_KEY) and has no recording of this message");
      return { proposals: [...proposals], malformed: [], model: "fixture", usage: null };
    },
  };
}
