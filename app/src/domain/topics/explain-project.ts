// Conversational plan, phase Q: "What is Forager?" for new joiners (EX1 to EX6). What a project is, who
// it is for and where to start on it, all from the project view the asker reads (queries/answers). Section
// 18's "Tell me about Forager" stays how it stands (project_status). The name may be part of a project's
// name or alias ("Explain Insights"); projectFits finds which of the asker's own projects it can mean (EX5).
import { namesProject } from "../atlas-checks/checks";
import type { Topic } from "./topic";

// What may stand for a project's name in "What is X?" (the rule reads lowercased words, so it cannot see a
// name). Not a determiner or a question word ("What's the forecast?", "What is the plan?") unless the words go
// on to say project ("What's this project about?"); not a word that says how things stand ("What's wrong?",
// "What is overdue?", "What's next?"). These were other before phase Q, and stay so.
const NOT_A_NAME = String.raw`(?!(?:the|this|that|these|those|it|its|my|mi|your|our|his|her|their|a|an|all|any|some|why|how|what|who|when|where|which)\b(?![^?]*\bproject\b))(?!(?:new|up|next|left|due|overdue|late|wrong|right|good|bad|on|open|urgent|important|outstanding|ahead|today|tomorrow|tonight|here|there|news|status|update|updates|plan|risk|risks|issue|issues|problem|problems|deal|matter|point|story|gwaan|gwan|going on)\b)`;
// Nor one that ends on a word in -ing or -ed, a preposition or a time: that asks what someone is doing
// ("What's Kemar doing?", "What is Kemar waiting for?", "What is Kemar up to?") or what has happened
// ("What is finished?"). Phase H asks about people.
const LAST = String.raw`(?![^\s?]*(?:ing|[a-z]{4}ed)(?![^\s?]))(?!(?:to|up|on|at|in|of|for|about|with|from|by|like|now|today|tomorrow)(?![^\s?]))[^\s?]+`;
const OBJECT = String.raw`${NOT_A_NAME}(?:[^\s?]+\s+){0,3}${LAST}`;

export const explainProject = {
  id: "explain_project",
  // "Explain Store Insights", "I'm new on GQ, where do I start?", "What is Forager for?", "What is GQ?". The
  // last asks only as the whole message, of a few words that can be a name (above). Never a message with a
  // #number, which is a why or a record ("Explain #151"). Being new asks nothing by itself: "I'm new here,
  // what needs me today?" is needs me, and "I'm new to Patois, what does 'weh' mean?" is other. Phase R:
  // "Weh mi fi start?"
  rule: new RegExp(
    String.raw`^(?![\s\S]*#\d)(?:[\s\S]*\b(?:(?:explain|splain)\s+${NOT_A_NAME}|what(?:'s| is| does) ${OBJECT} (?:for|about|do)\b|who is ${OBJECT} for\b|where (?:do|should|can|would) i (?:start|begin)\b|where to (?:start|begin)\b|(?:weh|wey|where) mi fi (?:start|begin)\b|get(?:ting)? started\b)|(?:so,? )?what(?:'s| is)\s+${OBJECT}\s*\?*$)`,
  ),
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
  const t = text.trim().toLowerCase().replace(/[‘’]/g, "'");
  // Phase Q fix, EX1: read where the question puts a project, in any case ("what is gq", "explain forager"),
  // not by capitals, so a person named elsewhere ("I'm new, Alicia said to ask you where to start") is no
  // project. A follow-up puts it straight after its "and" ("and Store Insights?"), unless it asks again
  // ("and where do I start?").
  const said = [...t.matchAll(ABOUT)].map((m) => m[1]);
  const followed = FOLLOWING.exec(t)?.[1];
  if (followed && !ASKS.test(followed)) said.push(followed);
  return said.some((words) =>
    words
      .split(/\s+/)
      .slice(0, 4)
      .some((w) => /[a-z0-9]/.test(w) && !NOTHING.has(w.replace(/^\W+|\W+$/g, ""))),
  );
}

/** Where a question says the project it is about: "What is X", "Explain X", "new on X", "start on X". */
const ABOUT = /\b(?:what(?:'s| is| does)|whats|who is|explain|splain|new (?:on|to|pon|wid|with)|(?:start|begin|started|starting) (?:on|with|pon|wid|in))\s+([^?.!,;]+)/g;
const FOLLOWING = /^(?:and|what about|how about|wah bout|wha bout|wat bout|what bout|how bout)\s+([^?.!,;]+)/;
const ASKS = /^(?:what|what's|whats|which|who|when|where|why|how|is|are|do|does|can|could|should|explain|tell|weh|wey|wah|wha)\b/;
/** Words that stand for no project ("What's this project about?", "Can you explain it to me?"). */
const NOTHING = new Set(
  "a an the this that these those it its project projects here there me us you to for about do does again please atlas dpm all everything one mi dis dat now so i my our your on pon with wid in of like really bout fi".split(" "),
);
