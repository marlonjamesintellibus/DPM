// Conversational plan, phase N: what is at risk this week on the asker's projects: milestones forecast
// past their target, milestones due this week with blocked work, live blockers, and open signals once
// phase K lands. Anyone asks; the scope is their own projects, or the one they name.
import type { Topic } from "./topic";

export const atRiskWeek = {
  id: "at_risk_week",
  // "What's at risk this week?", "Anything at risk?", "What's slipping?". Not "Is Forager at risk?" or
  // "Anything at risk on Forager?" (how one project stands), "Why is Forager at risk?" (why), "Which
  // projects are at risk?" (portfolio, which the rule tries first) or "What is a risk?". Phase R: "Wah a
  // risk dis week?", where "a risk" is "at risk"
  rule: /^(?:what's|whats|what is|what are|what|anything|any)\b(?!.*\bprojects?\b)(?!.*\bat risk\s+(?:on|in|for|pon)\s+(?!(?:this|dis|my|our|your|all|any|the)\b)).*\b(?:at risk|slipping|in danger)\b|^(?:wah|wha)\b(?!.*\bprojects?\b).*\b(?:at risk|a risk|slipping)\b|\brisks? (?:this|dis) week\b|\bat risk (?:this|dis) week\b/,
  prompt: "what is at risk this week across their projects: late milestones and live blockers",
  suggest: ["What's blocked?", "What needs a decision from me?"],
} as const satisfies Topic;
