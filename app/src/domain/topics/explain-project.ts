// Conversational plan, phase Q: "What is Forager?" for new joiners (EX1 to EX6). What a project is, who
// it is for and where to start on it, all from the project view the asker reads (queries/answers). Section
// 18's "Tell me about Forager" stays how it stands (project_status). The name may be part of a project's
// name or alias ("Explain Insights"); projectFits finds which of the asker's own projects it can mean (EX5).
import { namesProject } from "../atlas-checks/checks";
import type { Topic } from "./topic";

export const explainProject = {
  id: "explain_project",
  // "Explain Store Insights", "I'm new on GQ, where do I start?", "What is Forager for?", "What is GQ?". The
  // last asks only as the whole message, of a few words, and never about something another topic answers
  // (what is new, next, left or on today; a #number is a why or a record). Phase R: "Weh mi fi start?"
  rule: /\b(explain|splain|what (?:is|does) (?:\S+ ){1,4}(?:for|about|do)|who is (?:\S+ ){1,4}for|(?:i'm|i am|im) new|new (?:on|to|here|pon)|where (?:do|should|can|would) i (?:start|begin)|where to (?:start|begin)|(?:weh|wey|where) mi fi (?:start|begin)|get(?:ting)? started)\b|^(?:so,? )?what(?:'s| is)\s+(?![^?]*#)(?!(?:new|up|next|left|due|happening|going on|on|my|mi|the status)\b)(?:[^\s?]+\s+){0,3}[^\s?]+\s*\?*$/,
  prompt: "what a project is, who it is for and where to start on it",
  suggest: ["What am I working on?", "What's due this week?"],
} as const satisfies Topic;

/** A word of a name too common to say which project it is, said alone. */
const COMMON = new Set(["and", "the", "for", "with", "project"]);

/**
 * EX5: the projects the words can mean, by their name or an alias said in full, else by one word of
 * either ("Insights" is Store Insights). Only the projects given are searched, which are the asker's own,
 * so nothing else is ever matched. A word counts in the words' own case, as namedProject reads a name: a
 * message with capitals needs the capital ("the store feed" is no project), one without any is read in any
 * case. Two fits are for the asker to choose between.
 */
export function projectFits<P extends { id: string; name: string; aliases: readonly string[] }>(text: string, projects: readonly P[]): P[] {
  const shaped = text !== text.toLowerCase();
  const names = (p: P) => [p.name, ...p.aliases];
  const full = projects.filter((p) => names(p).some((n) => namesProject(text, shaped ? n : n.toLowerCase())));
  if (full.length) return full;
  return projects.filter((p) =>
    names(p)
      .flatMap((n) => n.split(/[\s&·,]+/))
      .filter((w) => w.length >= 4 && /[a-z]/i.test(w) && !COMMON.has(w.toLowerCase()))
      .some((w) => namesProject(text, shaped ? w : w.toLowerCase())),
  );
}

/**
 * EX1: whether the words name something, a capitalised word after the first that is not "I" or Atlas.
 * "What is Atlas Bank?" names something the asker is not in, so it is answered as not found; "Where do I
 * start?" names nothing, so it asks which of their projects. Either way nothing about other projects is said.
 */
export function namesSomething(text: string): boolean {
  return text
    .trim()
    .split(/\s+/)
    .slice(1)
    .some((w) => /^[A-Z]/.test(w) && !/^(?:I|I'm|I’m|I've|I’ve|I'll|I’ll|Atlas|DPM)\W*$/.test(w));
}
