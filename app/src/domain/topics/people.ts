// Conversational plan, phase H: ask about people (PP1 to PP8, decision CD9). "What is Kemar working on?",
// "What's on Jodian's plate?", "Is Kemar overloaded?" ask about someone else's work; "Who owns the store
// feed?" asks whose a record is. Who is meant is read from the words by the one rule for names
// (domain/names.ts), among the people the asker shares a project with; the answer
// (queries/answers/people.ts) shows only what queries/people.ts lets one person see of another.
import type { CandidateProject } from "../atlas-checks/types";
import { whereNamed } from "../names";
import type { Topic } from "./topic";

// Who a question can be about: a name of up to three words, none of them the asker ("What am I working
// on?", "What should I be working on?" are my_work), a crowd ("What's the team working on?") or a thing
// ("What is the trend model doing?")
const NOT_SOMEONE = String.raw`(?:i|am|you|u|we|me|mi|my|unu|it|this|that|the|di|a|an|team|everyone|everybody|anyone|anybody|should|could|would|will|can|do|does|did)`;
const NAME_WORD = String.raw`(?!${NOT_SOMEONE}\b)[a-z][\w'-]*`;
const SOMEONE = String.raw`${NAME_WORD}(?:\s+${NAME_WORD}){0,2}`;
// Someone's, in "Kemar's updates" or "Jodian's workload": never the asker's, nor a day's ("today's updates")
const SOMEONES = String.raw`\b(?!(?:my|mi|today|yesterday|tonight|tomorrow|week|this|that)\b)[a-z][\w-]*'s`;

/** PP5: whose a record is. The words after it say what to look for ("the store feed"). */
const OWNER = /\b(?:(?:who|a who)\s+(?:owns|own|is the owner of|'s the owner of|is responsible for|'s responsible for|is working on|'s working on|is doing|'s doing|a work pon|a do|has(?=\s+#\d))|whose\s+(?:is|are)|owner of)\s+(.+?)[?.!]*$/;
/** PP8: what someone said, sent or wrote ("What did Andre say about pricing?", "Show me Kemar's updates"). */
const SAID = new RegExp(
  String.raw`\b(?:what|anything)\s+(?:did|has|have)\s+${SOMEONE}\s+(?:say|said|mention|mentioned|post|posted|send|sent|write|written|wrote|tell|told|report|reported|seh)\b|\b(?:did|has|have)\s+${SOMEONE}\s+(?:say|said|mention|mentioned|tell|told|seh)\b|${SOMEONES}\s+(?:updates|messages|captures|notes|voice notes|chats?)\b`,
);
/** PP6: how much someone has, said as a judgement; the answer gives facts only. */
const LOAD = new RegExp(String.raw`\bis\s+${SOMEONE}\s+(?:overloaded|swamped|too busy|busy|stretched|maxed out|at capacity|over capacity|snowed under)\b|\bhow busy is\b|${SOMEONES}\s+(?:workload|load)\b`);

export const people = {
  id: "people",
  // "What is Kemar working on?", "What's on Jodian's plate?", "Is Kemar overloaded?", "Who owns the store
  // feed?", "What did Andre say about pricing?" (PP8). Phase R: "Wah Kemar a work pon?", "Wah deh pon Jodian
  // plate?", "A who own di store feed?". Not "What am I working on?" or "What's on my plate?" (my_work)
  rule: new RegExp(
    [
      String.raw`\b(?:what|what's|whats|wah|wha)\s+(?:(?:is|are|am)\s+)?${SOMEONE}\s+(?:working on|doing|up to|busy with|a work pon|a do|work(?:ing)? pon)\b`,
      String.raw`\b(?:on|pon)\s+(?!my\b|mi\b|di\b|the\b)[a-z][\w-]*(?:'s)?\s+plate\b`,
      OWNER.source,
      SAID.source,
      LOAD.source,
    ].join("|"),
  ),
  prompt: "what someone else is working on or has on their plate, or who owns a record or entry",
  suggest: ["What's blocked?", "What's due this week?"],
} as const satisfies Topic;

/** The three answers: whose a record is (PP5), what someone said (PP8, never), or what they have. */
export type PeopleAsks = "owner" | "said" | "work";

const plain = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").trim();

export function peopleAsks(asked: string): PeopleAsks {
  const t = plain(asked);
  if (SAID.test(t)) return "said";
  if (OWNER.test(t)) return "owner";
  return "work";
}

/** PP5: what "Who owns ..." asks after, without its article: "store feed"; null when nothing follows. */
export function ownedPhrase(asked: string): string | null {
  const m = OWNER.exec(plain(asked));
  const phrase = m?.[1]?.replace(/^(?:the|di|a|an|our|wi|we)\s+/, "").trim();
  return phrase ? phrase : null;
}

/** Someone a question may be about: a person the asker shares a project with (CD9), or the asker. */
export type Nameable = { id: string; name: string };

/** Who the words mean: one person, several who share the name said (PP2), or nobody the asker shares a project with (PP1). */
export type Meant = { kind: "one"; id: string } | { kind: "which"; ids: string[] } | { kind: "nobody" };

/**
 * Phase H: who the words are about, by the one rule for names (W-D1). A full name wins over a first
 * name; of several people named, the first named is meant. A first name that two of these people have
 * is unsure, and both are listed (PP2). Only these people are searched, so a name the asker shares no
 * project with is read exactly as a name nobody has (PP1, P10).
 */
export function whoIsMeant(words: string, people: readonly Nameable[]): Meant {
  const unique = [...new Map(people.map((p) => [p.id, p])).values()];
  const named = unique.flatMap((p) => {
    const where = whereNamed(words, p.name, false);
    return where ? [{ p, ...where }] : [];
  });
  if (!named.length) return { kind: "nobody" };
  const full = named.filter((n) => n.full);
  const pool = full.length ? full : named;
  const at = Math.min(...pool.map((n) => n.at));
  const first = pool.find((n) => n.at === at)!.p;
  // PP2: everyone the same words could mean: the same full name, or the same first name
  const key = (name: string) => (full.length ? name : name.split(" ")[0]).toLowerCase();
  const same = unique.filter((p) => key(p.name) === key(first.name));
  return same.length > 1 ? { kind: "which", ids: same.map((p) => p.id).sort() } : { kind: "one", id: first.id };
}

/**
 * PP4: a question about the asker by their own name is my_work. Only when the words ask what someone
 * has and mean them alone, read among the people of their own projects and themselves.
 */
export function aboutAsker(asked: string, author: Nameable, projects: readonly Pick<CandidateProject, "people">[]): boolean {
  if (peopleAsks(asked) !== "work") return false;
  const nameable = [author, ...projects.flatMap((p) => p.people.map((x) => ({ id: x.personId, name: x.name })))];
  const meant = whoIsMeant(asked, nameable);
  return meant.kind === "one" && meant.id === author.id;
}

/** What "Who owns ..." can match: a record or entry title, a work item's number, an entry's kind. */
export type Ownable = { title: string; number?: string | null; kind?: string | null };

const SMALL_WORDS = new Set(["the", "di", "a", "an", "of", "for", "on", "in", "pon", "and", "to", "it", "is"]);
const wordsOf = (s: string) => plain(s).split(/[^\w#&]+/).filter((w) => w && !SMALL_WORDS.has(w));
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * PP5: the things a "Who owns ..." phrase means, best match only: a number or the whole title, then a
 * title that says the phrase, then one with every word of it, where an entry's kind is a word too ("the
 * pipeline risk"). "store feed" is #152 Store feed connector before #151 Store sales feed access. A phrase that ends with where ("the store feed on Forager") is
 * tried without it when it finds nothing.
 */
export function ownedMatches<T extends Ownable>(phrase: string, things: readonly T[]): T[] {
  const tries = [phrase, phrase.replace(/\s+(?:on|in|pon|for)\s+.+$/, "")].map(plain).filter((p, i, all) => p && all.indexOf(p) === i);
  for (const p of tries) {
    const number = /#\d+/.exec(p)?.[0];
    const tiers = [
      (x: T) => (number ? x.number === number : plain(x.title) === p),
      (x: T) => !number && new RegExp(`(?<!\\w)${escaped(p)}(?!\\w)`).test(plain(x.title)),
      (x: T) => !number && wordsOf(p).length > 0 && wordsOf(p).every((w) => wordsOf(x.title).includes(w) || (!!x.kind && w.replace(/s$/, "") === x.kind)),
    ];
    for (const tier of tiers) {
      const found = things.filter(tier);
      if (found.length) return found;
    }
  }
  return [];
}
