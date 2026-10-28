// Conversational plan, phase N: how every project in the asker's view stands, worst first, with its
// displayed status and reason ("Which projects are off track?"). For executives and delivery leads, their
// org lens (KB A7.2); for anyone else, and for a lens with no tags, their own projects (LD4, LD7).
import type { Topic } from "./topic";

export const portfolio = {
  id: "portfolio",
  // "Which projects are off track?", "Any projects at risk?", "How are all the projects doing?", "How's the
  // portfolio?". Phase R: "Which project dem off track?"
  rule: /\b(?:which|what|any|how many)\s+(?:of (?:my |our |the )?)?projects?\b(?:\s+dem)?.*\b(?:off track|at risk|on track|behind|late|in trouble|slipping|pon track)\b|\bportfolio\b|\ball (?:of )?(?:my |our |the )?projects\b|\bevery project\b/,
  prompt: "which projects are off track or at risk, across all of theirs",
  suggest: ["What's at risk this week?", "What's blocked?"],
} as const satisfies Topic;
