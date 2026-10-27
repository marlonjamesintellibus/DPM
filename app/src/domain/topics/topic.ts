// What a question topic is (machines doc, sections 15, 17 and 18). Each topic has its own file here,
// with the words the rule knows it by, how the prompt describes it and what to suggest after its
// answer; its answer is built from the asker's data in queries/answers. A new topic is a new file in
// each folder and its line in each index (in BY_RULE too when the rule knows its words). The two halves
// stay apart because domain code never reads the database.

export type Topic = {
  id: string;
  /** QA8: words that make a one-sentence question this topic without a model; null when only Atlas or a follow-up gives it. */
  rule: RegExp | null;
  /** Its place in the prompt's topic list; null when the prompt speaks of it on its own line. */
  prompt: string | null;
  /** Section 17: one or two follow-ups suggested under its answer. */
  suggest: readonly string[];
};
