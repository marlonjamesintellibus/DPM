// The recorded Atlas, for tests and for running without an OpenRouter key: it answers the messages
// it has a recording for and refuses the rest, so nothing pretends a real read happened. A one-sentence
// question is the exception (section 15, QA8): the rule in domain/question.ts spots it, and DPM answers
// it from data, so no read is pretended. So is small talk, a whole message of "Hi" or "Thanks!" (CQ12),
// and a one-sentence reply that decides lines of the open answer (phase B: "Approve the refresh decision"),
// and "Start my standup" (phase J): a standup of taps never reaches a model, and typed answers need one.
// Phase D adds one recording: a vague update whose words fit two of Kemar's records, so the browser story
// can answer Atlas's question (M21). Phase K adds one: the store feed blocker said again (S14). Phase E adds one:
// Kemar's own promise, a commitment (M22). Phase P adds one: Kemar's leave next week, so the story can ask cover (M35).
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

/**
 * Phase K's story steps: Kemar says the store feed is still blocked, a report on the blocker already on the
 * log (M16 same as). Said after Alicia resolved it, it reopens it (S14): a repeated blocker Atlas notices on save.
 */
export const FEED_STILL_BLOCKED = "The Sprouts store feed is still blocked for me too.";
const FEED_STILL_BLOCKED_PROPOSALS: readonly RawProposal[] = [
  {
    kind: "braid_same",
    projectId: "forager",
    routingReason: { basis: "target", evidence: "Store sales feed access", label: "Same subject as #151" },
    braidKind: "blocker",
    matchEntryId: "br-feed-blocker",
    quote: "The Sprouts store feed is still blocked for me too",
    confidence: "high",
    rationale: "The same store feed blocker: add them as a source",
  },
];

/**
 * Phase E's story step: Kemar's own promise about #151, a commitment for his review (M22). "Tomorrow" is read by
 * the server against when he says it, and the card shows the day to correct (CM2).
 */
export const KEMAR_PROMISE = "I'll send Kyle the access request for #151 tomorrow.";
const KEMAR_PROMISE_PROPOSALS: readonly RawProposal[] = [
  {
    kind: "commitment",
    projectId: null,
    routingReason: { basis: "personal", evidence: "I'll", label: "Your promise" },
    targetId: "wi-151",
    newValue: "promised",
    promise: "Send Kyle the access request",
    commitmentId: null,
    quote: "I'll send Kyle the access request for #151 tomorrow",
    confidence: "high",
    rationale: "You promised to send it, so DPM checks on it when it is due.",
  },
];

/**
 * Phase P's story step: "next week" is read by the server as Mon 26 to Fri 30 Oct, the leave already approved, so it
 * matches and changes nothing (D6); saving it offers cover for what is due then.
 */
export const KEMAR_OFF = "I'm off next week.";
const KEMAR_OFF_PROPOSALS: readonly RawProposal[] = [
  {
    kind: "update",
    projectId: null,
    routingReason: { basis: "personal", evidence: "I'm off", label: "Personal" },
    targetId: "leave-kemar",
    field: "dates",
    newValue: "2026-10-26/2026-10-30",
    quote: "I'm off next week",
    confidence: "high",
    rationale: "Your leave next week.",
  },
];

const RECORDINGS = new Map<string, readonly RawProposal[]>([
  [KEMAR_NOTE, KEMAR_PROPOSALS],
  [VAGUE_FEED, VAGUE_FEED_PROPOSALS],
  [FEED_STILL_BLOCKED, FEED_STILL_BLOCKED_PROPOSALS],
  [KEMAR_PROMISE, KEMAR_PROMISE_PROPOSALS],
  [KEMAR_OFF, KEMAR_OFF_PROPOSALS],
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
