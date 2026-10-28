// The recorded Atlas, for tests and for running without an OpenRouter key: it answers the messages
// it has a recording for and refuses the rest, so nothing pretends a real read happened. A one-sentence
// question is the exception (section 15, QA8): the rule in domain/question.ts spots it, and DPM answers
// it from data, so no read is pretended. So is small talk, a whole message of "Hi" or "Thanks!" (CQ12),
// and a one-sentence reply that decides lines of the open answer (phase B: "Approve the refresh decision"),
// and "Start my standup" (phase J): a standup of taps never reaches a model, and typed answers need one.
// Phase D adds one recording: a vague update whose words fit two of Kemar's records, so the browser story
// can answer Atlas's question (M21).
import type { RawProposal } from "../domain/atlas-checks/types";
import { KEMAR_NOTE, KEMAR_PROPOSALS } from "../domain/atlas-checks/kemar-note.fixture";
import { ruleCommands } from "../domain/acting";
import { ruleQuestion } from "../domain/question";
import { AtlasReadFailed, type Extractor } from "./extractor";

/** Phase D: "the store feed" is #151 Store sales feed access or #152 Store feed connector. */
export const VAGUE_FEED = "Worked on the store feed today.";
const VAGUE_FEED_PROPOSALS: readonly RawProposal[] = [
  {
    kind: "update",
    projectId: "forager",
    routingReason: { basis: "target", evidence: "store feed", label: "#151" },
    targetId: "wi-151",
    targetOptions: ["wi-151", "wi-152"],
    field: "state",
    newValue: "in_progress",
    quote: "Worked on the store feed today",
    confidence: "medium",
    rationale: "You worked on the store feed, and two of your records are about it.",
  },
];

const RECORDINGS = new Map<string, readonly RawProposal[]>([
  [KEMAR_NOTE, KEMAR_PROPOSALS],
  [VAGUE_FEED, VAGUE_FEED_PROPOSALS],
]);

export function createFixtureExtractor(recordings: ReadonlyMap<string, readonly RawProposal[]> = RECORDINGS): Extractor {
  return {
    name: "fixture",
    async extract(ctx) {
      const proposals = recordings.get(ctx.text);
      const asked = proposals ? null : ruleQuestion(ctx);
      // Phase C: the rule's subject goes to the checks as Atlas would say it, by its id
      if (asked) return { proposals: [], question: asked.subject ? { ...asked, subjectId: asked.subject.id } : asked, malformed: [], model: "fixture", usage: null };
      const commands = proposals ? [] : ruleCommands(ctx);
      if (commands.length) return { proposals: [], question: null, commands, malformed: [], model: "fixture", usage: null };
      if (!proposals) throw new AtlasReadFailed("model_error", "Atlas is not connected (no OPENROUTER_API_KEY) and has no recording of this message");
      return { proposals: [...proposals], malformed: [], model: "fixture", usage: null };
    },
  };
}
