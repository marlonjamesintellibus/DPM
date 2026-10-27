// Whether some words name a person (decisions W-D1 and W-D4, 27 Oct 2026). One rule for mentions (CQ9)
// and for routing an item by a person tied to a project (check 14, tied_person). People type names in
// lower case ("waiting on kemar"), so a first name counts in any case, except a name that is also an
// everyday English word: "mark #145 done" or "mi will send it" name nobody, so those need their capital.

/** First names that are also everyday words; written in lower case they are the word, not the person. */
export const NAMES_THAT_ARE_WORDS: ReadonlySet<string> = new Set([
  "amber", "april", "art", "august", "bill", "brook", "chance", "chase", "cliff", "crystal", "dawn", "dean", "don",
  "drew", "eve", "faith", "frank", "gene", "glen", "grace", "hope", "holly", "hunter", "iris", "ivy", "jack", "jade",
  "jay", "joy", "june", "kit", "lane", "lily", "mark", "mason", "max", "may", "miles", "pat", "pearl", "penny", "ray",
  "reed", "rich", "rob", "robin", "rose", "ruby", "rusty", "sandy", "skye", "sue", "summer", "wade", "will",
]);

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A first name, as a whole word: written with its capital, or in any case when it is not also a word. */
export function namesFirstName(words: string, first: string): boolean {
  const word = NAMES_THAT_ARE_WORDS.has(first.toLowerCase());
  for (const m of words.matchAll(new RegExp(`(?<![\\w#])${escaped(first)}(?!\\w)`, "gi"))) {
    if (!word || m[0][0] !== m[0][0].toLowerCase()) return true;
  }
  return false;
}

/**
 * CQ9 (decisions CD29, W-D1): whether these words name the person. Their full name counts in any case.
 * Their first name counts as namesFirstName says, and only where no other member of that project
 * shares it. A person with one name (an outside contact such as Kyle) is named by that name alone.
 */
export function namesPerson(words: string, name: string, firstNameShared: boolean): boolean {
  const first = name.split(" ")[0];
  if (first === name) return namesFirstName(words, name);
  if (new RegExp(`(?<![\\w#])${escaped(name).replace(/\s+/g, "\\s+")}(?!\\w)`, "i").test(words)) return true;
  return !firstNameShared && namesFirstName(words, first);
}
