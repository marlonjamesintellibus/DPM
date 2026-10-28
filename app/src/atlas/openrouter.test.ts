// The OpenRouter client against a fake fetch: what it sends, how it reads the tool call, and how
// each failure maps to the capture machine's READ_FAILED reasons (E18, E19). No network.
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT, KEMAR_NOTE, KEMAR_PROPOSALS } from "../domain/atlas-checks/kemar-note.fixture";
import { ANSWER_SYSTEM_PROMPT } from "./answer";
import { AtlasReadFailed } from "./extractor";
import { createFixtureExtractor } from "./fixture";
import { atlasFromEnv, withFallback } from "./index";
import { createOpenRouter, DEFAULT_MODEL, OPENROUTER_URL, parseItems } from "./openrouter";
import { PROMPT_VERSION, proposalSchema, proposeItemsTool, questionSchema, SYSTEM_PROMPT, userMessage } from "./prompt";

const KEY = "sk-or-test-not-a-real-key";

type Sent = { url: string; init: RequestInit; body: Record<string, unknown> };

function fakeFetch(answer: (sent: Sent) => Response | Promise<Response>) {
  const calls: Sent[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const sent = { url, init, body: JSON.parse(String(init.body)) };
    calls.push(sent);
    return answer(sent);
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function toolAnswer(args: unknown, extra: Record<string, unknown> = {}) {
  return json(200, {
    model: "openai/gpt-6.1-sol",
    choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ function: { name: "propose_items", arguments: typeof args === "string" ? args : JSON.stringify(args) } }] } }],
    usage: { prompt_tokens: 3000, completion_tokens: 900, cost: 0.015 },
    ...extra,
  });
}

async function failure(p: Promise<unknown>): Promise<AtlasReadFailed> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AtlasReadFailed);
  return e as AtlasReadFailed;
}

describe("the request", () => {
  it("defaults to GPT-6.1 Sol, forces the propose_items tool and asks providers not to keep the data", async () => {
    const { fetch, calls } = fakeFetch(() => toolAnswer({ items: [] }));
    await createOpenRouter({ apiKey: KEY, fetch }).extract(KEMAR_CONTEXT);
    const [sent] = calls;
    expect(DEFAULT_MODEL).toBe("openai/gpt-6.1-sol");
    expect(sent.url).toBe(OPENROUTER_URL);
    expect(sent.body).toMatchObject({
      model: "openai/gpt-6.1-sol",
      tool_choice: { type: "function", function: { name: "propose_items" } },
      provider: { data_collection: "deny" },
    });
    expect((sent.body.tools as unknown[]).length).toBe(1);
  });

  it("the default reasons at low effort; Anthropic models get no reasoning and an unforced tool call", async () => {
    const sol = fakeFetch(() => toolAnswer({ items: [] }));
    await createOpenRouter({ apiKey: KEY, fetch: sol.fetch }).extract(KEMAR_CONTEXT);
    expect(sol.calls[0].body).toMatchObject({ reasoning: { effort: "low" } });

    const sonnet = fakeFetch(() => toolAnswer({ items: [] }));
    await createOpenRouter({ apiKey: KEY, model: "anthropic/claude-sonnet-5.5", fetch: sonnet.fetch }).extract(KEMAR_CONTEXT);
    expect(sonnet.calls[0].body.tool_choice).toBe("auto");
    expect(sonnet.calls[0].body).not.toHaveProperty("reasoning");
  });

  it("the topics come from domain/topics in read-wave4-e's words and order (phase C added why; phase L why_filed, correction and undo; phase H people; phase N who_free, not_updated, my_decisions, at_risk_week and portfolio; phase J standup; phase Q explain_project; phase E commitments; phase P catch_up); a change to them is a new prompt version", () => {
    expect(PROMPT_VERSION).toBe("read-wave4-p2");
    expect(SYSTEM_PROMPT).toContain(
      'topic: needs_me (what they need to do, review or approve), my_work (what they are working on: their own open work), due (what is due, or when the next milestone is), commitments (what they promised to do: their own open and due commitments), blocked (what is blocked or stuck), project_status (how a project stands), explain_project (what a project is, who it is for and where to start on it), updates (what is new or changed since they last asked), catch_up (catching up after time away: what changed since their leave began, and what was handed over), mentions (who mentioned them), people (what someone else is working on or has on their plate, or who owns a record or entry), who_free (who on the team could pick up a piece of work, with how much each has), not_updated (who on their projects has not sent an update today (for a PM or Lead)), my_decisions (what waits for their decision: proposals, kind changes, statuses they set and asks to them), at_risk_week (what is at risk this week across their projects: late milestones and live blockers), portfolio (which projects are off track or at risk, across all of theirs), why (why something is as it is: a status, what holds it up, when something was decided, or why a field changed), why_filed (why Atlas filed their update or an item of it where it did ("Why did you file that?")), correction (a correction to how you read names ("GQ also means the Guild", "Kyle is Store Insights, not Forager"), with correction filled), undo (only "Undo that" or "Take that back": undo their last saved update, with nothing else said), standup (only "Start my standup" or "Let\'s do my standup": start their standup in this chat, with nothing else said), small_talk (only a greeting, thanks or ok, with nothing else said or asked), or other.\n',
    );
    expect(questionSchema.shape.topic.options).toEqual([
      "needs_me",
      "my_work",
      "due",
      "commitments",
      "blocked",
      "project_status",
      "explain_project",
      "updates",
      "catch_up",
      "mentions",
      "people",
      "who_free",
      "not_updated",
      "my_decisions",
      "at_risk_week",
      "portfolio",
      "why",
      "why_filed",
      "correction",
      "undo",
      "standup",
      "small_talk",
      "other",
      "unclear",
    ]);
  });

  it("phase N: who could pick up work, who hasn't updated (today only), decisions, risks this week and the portfolio", () => {
    expect(SYSTEM_PROMPT).toContain('"Who can pick up #151?" or "Who\'s free to take the store feed?" is topic who_free');
    expect(SYSTEM_PROMPT).toContain("DPM answers for today only, and only to a PM or Lead.");
    expect(SYSTEM_PROMPT).toContain('"What needs a decision from me?" is topic my_decisions.');
    expect(SYSTEM_PROMPT).toContain('"Which projects are off track?" is topic portfolio.');
    expect(questionSchema.safeParse({ asked: "Who hasn\'t updated today?", topic: "not_updated", projectId: null }).success).toBe(true);
  });

  it("phase C: a why question names its subject by a listed id, null for a person (WY1, WY8)", () => {
    expect(SYSTEM_PROMPT).toContain("subjectId, for topic why only: the id of the listed project, record or BRAID entry the question is about");
    expect(SYSTEM_PROMPT).toContain('A why about a person ("Why is Kemar late?") is topic why with subjectId null');
  });

  it("phase H: another person's work or who owns something is people; the author by name is my_work; messages are never shared (PP4, PP5, PP8)", () => {
    expect(SYSTEM_PROMPT).toContain("DPM answers with what they have on record, never a reason about them.");
    expect(SYSTEM_PROMPT).toContain('or about who owns something ("Who owns the store feed?") is topic people');
    expect(SYSTEM_PROMPT).toContain('About the author by their own name ("What is Kemar working on?" from Kemar) it is my_work.');
    expect(SYSTEM_PROMPT).toContain("DPM never shares anyone's messages.");
    expect(questionSchema.safeParse({ asked: "What is Kemar working on?", topic: "people", projectId: null }).success).toBe(true);
    expect(questionSchema.safeParse({ asked: "Why?", topic: "why", projectId: null, subjectId: "wi-151" }).success).toBe(true);
    // QA7 still holds for a question that leaves it out
    expect(questionSchema.safeParse({ asked: "Why?", topic: "why", projectId: null }).success).toBe(true);
  });

  it("phase L: undo is the whole message, and a correction is only a proposal with listed ids (UN8, M31)", () => {
    const section = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf("Undo and corrections\n"), SYSTEM_PROMPT.indexOf("\nEarlier messages"));
    expect(section).toContain("with nothing else in the message, is topic undo with items empty");
    expect(section).toContain("It is only a proposal: a PM or Lead of the project decides.");
    expect(section).toContain('kind "alias", word the new name exactly as written');
    expect(section).toContain('kind "contact", personId from the people listed');
    expect(section).toContain("Use only listed project ids and people.");
    const correction = { kind: "contact", projectId: "insights", personId: "kyle", notProjectId: "forager" };
    expect(questionSchema.safeParse({ asked: "Kyle is Store Insights, not Forager", topic: "correction", projectId: "insights", correction }).success).toBe(true);
    expect(questionSchema.safeParse({ asked: "hi", topic: "small_talk", projectId: null }).success).toBe(true);
  });

  it("phase E: the author's own promise is a commitment, matched or said done by a listed id; CM3 and CD5 are not (M22)", () => {
    expect(SYSTEM_PROMPT).toContain('- "commitment": something the author promises to do themselves');
    expect(SYSTEM_PROMPT).toContain("put that commitment's id in commitmentId");
    expect(SYSTEM_PROMPT).toContain('propose kind "commitment" with newValue "done"');
    expect(SYSTEM_PROMPT).toContain("is that record's forecast; propose the update");
    expect(SYSTEM_PROMPT).toContain("Someone else's promise (\"Kyle will send it\", \"Jodian said she'd do it\") is never the author's");
    expect(SYSTEM_PROMPT).not.toContain('("I\'ll send Kyle the request"), propose nothing for it');
    const promise = { kind: "commitment", projectId: null, routingReason: { basis: "personal", evidence: "I'll", label: "You" }, promise: "Send Kyle the access request", newValue: "promised", targetId: "wi-151", commitmentId: null, quote: "I'll send Kyle the access request tomorrow", confidence: "medium", rationale: "Your promise" };
    expect(proposalSchema.safeParse(promise).success).toBe(true);
    // The author's live commitments go to Atlas with the projects, their own only
    const message = userMessage({ ...KEMAR_CONTEXT, commitments: [{ id: "cm-1", what: "Send Andre the export columns", dueOn: "2026-10-19", state: "due", linkId: "wi-208" }] });
    expect(message).toContain('"promise": "Send Andre the export columns"');
    expect(userMessage(KEMAR_CONTEXT)).toContain('"commitments": []');
  });

  it("phase J: a standup's answers are read each with its question, quoting only the author's words (M28, SU4)", () => {
    const section = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf("Standups\n"), SYSTEM_PROMPT.indexOf("\nEarlier messages"));
    expect(section).toContain('"Start my standup" or "Let\'s do my standup", with nothing else said, is topic standup with items empty');
    expect(section).toContain("Read each answer with its question as context");
    expect(section).toContain('("Not that, but #212 is done" is about #212)'); // SU4
    expect(section).toContain('quote only the author\'s answer words, never an "Atlas:" line'); // the model check's questionAsQuote
    expect(section).toContain("Propose only a blocker report for what it waits on when it names something");
    // S3: DPM's Blocked from the tap is the only one; DPM drops a second from Atlas as well (atlasProposals)
    expect(section).toContain("never propose that work's state or blocked_note");
    const answers = { ...KEMAR_CONTEXT, text: "Atlas: Anything new blocking you?\nKemar: The GPU quota", standup: { quoteIn: [] } };
    expect(userMessage(answers)).toContain("This update is the author's answers to their standup questions.");
    expect(userMessage(KEMAR_CONTEXT)).not.toContain("standup questions");
  });

  it("phase R: how the team writes is read as written, and what Atlas writes is standard English (JA1 to JA4, JA7, CD20)", () => {
    const section = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf("How the team writes\n"), SYSTEM_PROMPT.indexOf("\nQuestions\n"));
    expect(section).toContain("Jamaican English and Patois");
    expect(section).toContain('"mi tink", "mi feel seh", "mebbe" and "mussi" are "I think" and "maybe", so the confidence is medium'); // E12
    expect(section).toContain('"Di access nuh come yet" means the blocker is still open: never a resolve'); // JA1
    expect(section).toContain('"Soon done" and "almost done" mean still in progress, not done'); // JA2
    expect(section).toContain('"A go", "ago" and "gwine" before a verb are the future'); // JA3
    expect(section).toContain("quote and evidence are copied exactly as written, spelling and all"); // JA4
    expect(section).toContain("Write braidTitle, note, label and rationale in standard English"); // CD20
    expect(section).toContain("only when written as a name (capitalised) or next to one of their records"); // JA7
    expect(SYSTEM_PROMPT).toContain('"Weh mi fi do today?" is needs_me'); // JA6
    expect(ANSWER_SYSTEM_PROMPT).toContain("- Reply in standard English, even when they asked in Jamaican English or Patois. Never correct, translate or remark on how they wrote.\n");
  });

  it("puts the key only in the Authorization header", async () => {
    const { fetch, calls } = fakeFetch(() => toolAnswer({ items: [] }));
    await createOpenRouter({ apiKey: KEY, fetch }).extract(KEMAR_CONTEXT);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(String(calls[0].init.body)).not.toContain(KEY);
  });

  it("uses the model the settings name", async () => {
    const { fetch, calls } = fakeFetch(() => toolAnswer({ items: [] }));
    await createOpenRouter({ apiKey: KEY, model: "anthropic/claude-haiku-5.5", fetch }).extract(KEMAR_CONTEXT);
    expect(calls[0].body.model).toBe("anthropic/claude-haiku-5.5");
  });

  it("sends the update as data inside <update>, and only the author's candidate projects (check 9)", () => {
    const msg = userMessage({ ...KEMAR_CONTEXT, notConnected: [{ id: "uwi", name: "UWI study group" }] });
    expect(msg).toContain(`<update>\n${KEMAR_NOTE}\n</update>`);
    expect(msg).toContain("Tuesday 2026-10-20, 8:58 AM");
    expect(msg).toContain('"id": "forager"');
    expect(msg).not.toContain("UWI");
  });

  it("phase B: the open answer's lines go between <answer> tags, numbered, with what the author may do on each", () => {
    const msg = userMessage({
      ...KEMAR_CONTEXT,
      openAnswer: {
        captureId: "cap-q",
        asked: "What needs me?",
        asOf: "2026-10-20T14:10:00.000Z",
        lines: [{ line: 1, title: "Kemar raised a risk: Trend model may slip to 24 Oct", detail: "Why: risks go on the log only when a PM or Lead approves", subject: { type: "braid_entry", id: "br-1", projectId: "forager" }, acts: ["approve", "decline"] }],
      },
    });
    const answer = msg.slice(msg.indexOf("<answer>\n") + 9, msg.indexOf("\n</answer>\n\n<update>"));
    expect(JSON.parse(answer)).toEqual({
      asked: "What needs me?",
      lines: [{ line: 1, title: "Kemar raised a risk: Trend model may slip to 24 Oct", detail: "Why: risks go on the log only when a PM or Lead approves", record: { type: "braid_entry", id: "br-1" }, actions: ["approve", "decline"] }],
    });
    // No answer open: no tags at all
    expect(userMessage(KEMAR_CONTEXT)).not.toContain("<answer>");
    const section = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf("Acting on the last answer\n"), SYSTEM_PROMPT.indexOf("\nWhich project\n"));
    expect(section).toContain("act is approve, decline, resolve, give_reason, and only one the line lists in actions");
    expect(section).toContain("never pick one"); // AC7
    expect(section).toContain('"Approve all of them": one command for each line'); // AC8
    expect(section).toContain('"Mark the second one done"'); // a record change stays a proposal
    expect(section).toContain('Words that only report another person\'s decision ("Alicia approved the Kyle risk") are "other"'); // rule 10
  });

  it("phase D: a vague update names every record it could mean in targetOptions, and DPM asks which (M21)", () => {
    expect(SYSTEM_PROMPT).toContain("targetOptions every record the words could mean, targetId among them. DPM asks the author which.");
    expect(SYSTEM_PROMPT).toContain("never when the words name the record or only one fits");
    const r = proposalSchema.safeParse({ ...KEMAR_PROPOSALS[2], targetOptions: ["wi-151", "wi-152"] });
    expect(r.success && r.data.targetOptions).toEqual(["wi-151", "wi-152"]);
    // Older answers without it keep their shape
    expect(proposalSchema.safeParse(KEMAR_PROPOSALS[2]).success).toBe(true);
  });

  it("describes every proposal field the checks read", () => {
    const schema = proposeItemsTool.function.parameters as unknown as { properties: { items: { items: { required: string[] } } } };
    expect(schema.properties.items.items.required).toEqual(expect.arrayContaining(["kind", "projectId", "routingReason", "quote", "confidence", "rationale"]));
  });
});

describe("reading the answer", () => {
  it("returns the proposals, the model that answered and what it cost", async () => {
    const { fetch } = fakeFetch(() => toolAnswer({ items: KEMAR_PROPOSALS }));
    const out = await createOpenRouter({ apiKey: KEY, fetch }).extract(KEMAR_CONTEXT);
    expect(out.proposals).toHaveLength(11);
    expect(out.proposals[2]).toMatchObject({ targetId: "wi-151", newValue: "blocked", note: "waiting on Kyle (Sprouts IT)" });
    expect(out).toMatchObject({ model: "openai/gpt-6.1-sol", malformed: [], usage: { inputTokens: 3000, outputTokens: 900, costUsd: 0.015 } });
  });

  it("sets aside one item with the wrong shape and keeps the rest", () => {
    const { proposals, malformed } = parseItems(JSON.stringify({ items: [KEMAR_PROPOSALS[0], { kind: "update", quote: 42 }, KEMAR_PROPOSALS[1]] }));
    expect(proposals).toHaveLength(2);
    expect(malformed).toEqual([{ index: 1, issues: expect.stringContaining("quote") }]);
  });

  it("an empty list is a real answer: nothing to update (E4)", () => {
    expect(parseItems('{"items":[]}')).toEqual({ proposals: [], malformed: [], question: null, commands: [] });
  });

  it("section 15: reads what the message asks; a question without the right shape is set aside (QA7)", () => {
    const asked = { asked: "What needs me today?", topic: "needs_me", projectId: null };
    expect(parseItems(JSON.stringify({ items: [], question: asked }))).toEqual({ proposals: [], malformed: [], question: asked, commands: [] });
    const bad = parseItems(JSON.stringify({ items: [], question: { asked: 3, topic: "gossip" } }));
    expect(bad.question).toBeNull();
    expect(bad.malformed).toHaveLength(1);
    expect(bad.malformed[0].issues).toMatch(/^question:/);
  });

  it("phase B: reads what a reply decides on the open answer; a command without the right shape is set aside", () => {
    const said = { act: "approve", lines: [2], reason: null, by: "author" };
    const out = parseItems(JSON.stringify({ items: [], question: null, commands: [said, { act: "delete", lines: ["x"] }] }));
    expect(out.commands).toEqual([said]);
    expect(out.malformed).toEqual([{ index: -3, issues: expect.stringMatching(/^command:/) }]);
    // Rule 10: who decides it is read too, so DPM can drop a report of someone else's decision
    const other = { ...said, by: "other" };
    expect(parseItems(JSON.stringify({ items: [], commands: [other] })).commands).toEqual([other]);
    const schema = proposeItemsTool.function.parameters as unknown as { properties: { commands: { items: { required: string[] } } } };
    expect(schema.properties.commands.items.required).toEqual(expect.arrayContaining(["act", "lines", "reason", "by"]));
    // A model that leaves the list out decides nothing
    expect(parseItems('{"items":[]}').commands).toEqual([]);
  });

  it.each([
    ["the tool arguments are not JSON", "{items: ["],
    ["there is no items list", '{"proposals": []}'],
  ])("bad_output when %s", async (_, args) => {
    const { fetch } = fakeFetch(() => toolAnswer(args));
    expect((await failure(createOpenRouter({ apiKey: KEY, fetch }).extract(KEMAR_CONTEXT))).why).toBe("bad_output");
  });

  it("bad_output when the model answers in text instead of calling the tool", async () => {
    const { fetch } = fakeFetch(() => json(200, { choices: [{ finish_reason: "stop", message: { content: "Here are the items..." } }] }));
    expect((await failure(createOpenRouter({ apiKey: KEY, fetch }).extract(KEMAR_CONTEXT))).why).toBe("bad_output");
  });

  it("bad_output when the answer was cut off", async () => {
    const { fetch } = fakeFetch(() => json(200, { choices: [{ finish_reason: "length", message: { tool_calls: [{ function: { name: "propose_items", arguments: '{"items":[' } }] } }] }));
    expect((await failure(createOpenRouter({ apiKey: KEY, fetch }).extract(KEMAR_CONTEXT))).why).toBe("bad_output");
  });
});

describe("failures", () => {
  it("model_error on an HTTP error, with OpenRouter's message and never the key", async () => {
    const { fetch } = fakeFetch(() => json(429, { error: { message: "Rate limit exceeded", code: 429 } }));
    const e = await failure(createOpenRouter({ apiKey: KEY, fetch }).extract(KEMAR_CONTEXT));
    expect(e.why).toBe("model_error");
    expect(e.message).toContain("Rate limit exceeded");
    expect(e.message).not.toContain(KEY);
  });

  it("model_error carries the provider's own words when OpenRouter has them", async () => {
    const raw = { message: 'tool_choice: type "tool" and "any" are not supported for this model.' };
    const { fetch } = fakeFetch(() => json(400, { error: { message: "Provider returned error", code: 400, metadata: { raw: JSON.stringify(raw), provider_name: "Amazon Bedrock" } } }));
    const e = await failure(createOpenRouter({ apiKey: KEY, fetch }).extract(KEMAR_CONTEXT));
    expect(e.message).toContain("(Amazon Bedrock: {");
    expect(e.message).toContain("are not supported for this model");
  });

  it("model_error when OpenRouter reports an upstream failure inside a 200", async () => {
    const { fetch } = fakeFetch(() => json(200, { error: { message: "Provider returned error", code: 502 } }));
    expect((await failure(createOpenRouter({ apiKey: KEY, fetch }).extract(KEMAR_CONTEXT))).why).toBe("model_error");
  });

  it("model_error when the network fails", async () => {
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect((await failure(createOpenRouter({ apiKey: KEY, fetch }).extract(KEMAR_CONTEXT))).why).toBe("model_error");
  });

  it("timeout when no answer comes in time", async () => {
    const { fetch } = fakeFetch(
      ({ init }) =>
        new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")))),
    );
    const e = await failure(createOpenRouter({ apiKey: KEY, fetch, timeoutMs: 20 }).extract(KEMAR_CONTEXT));
    expect(e.why).toBe("timeout");
  });
});

describe("which Atlas runs", () => {
  it("the recorded Atlas without a key: it answers Kemar's note and refuses anything else", async () => {
    const atlas = atlasFromEnv({ OPENROUTER_API_KEY: "  " } as unknown as NodeJS.ProcessEnv);
    expect(atlas).toMatchObject({ connected: false, drafter: null, extractor: { name: "fixture" } });
    expect((await atlas.extractor.extract(KEMAR_CONTEXT)).proposals).toEqual(KEMAR_PROPOSALS);
    expect((await failure(createFixtureExtractor().extract({ ...KEMAR_CONTEXT, text: "Finished #145 and the export is fixed." }))).why).toBe("model_error");
    // CQ12: small talk is answered by the rule, so it needs no recording
    expect((await createFixtureExtractor().extract({ ...KEMAR_CONTEXT, text: "hello" })).question).toEqual({ asked: "hello", topic: "small_talk", projectId: null });
  });

  it("D21 OpenRouter with a key: Sol reads, Haiku takes the last try and words reasons; each can be named", () => {
    const atlas = atlasFromEnv({ OPENROUTER_API_KEY: KEY } as unknown as NodeJS.ProcessEnv);
    expect(atlas.extractor.name).toBe("openrouter:openai/gpt-6.1-sol, then openrouter:anthropic/claude-haiku-5.5");
    expect(atlas.drafter?.name).toBe("openrouter:anthropic/claude-haiku-5.5");
    const named = atlasFromEnv({ OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: "anthropic/claude-sonnet-5.5", OPENROUTER_FALLBACK_MODEL: "openai/gpt-6-sol", OPENROUTER_DRAFT_MODEL: "openai/gpt-6.1-sol" } as unknown as NodeJS.ProcessEnv);
    expect(named.extractor.name).toBe("openrouter:anthropic/claude-sonnet-5.5, then openrouter:openai/gpt-6-sol");
    expect(named.drafter?.name).toBe("openrouter:openai/gpt-6.1-sol");
  });

  it("D21 the last try goes to the fallback, every earlier one to the primary", async () => {
    const asked: string[] = [];
    const fake = (name: string) => ({ name, extract: async () => (asked.push(name), { proposals: [], malformed: [], model: name, usage: null }) });
    const atlas = withFallback(fake("sol"), fake("haiku"), 3);
    for (const attempt of [1, 2, 3]) await atlas.extract(KEMAR_CONTEXT, { attempt });
    await atlas.extract(KEMAR_CONTEXT);
    expect(asked).toEqual(["sol", "sol", "haiku", "sol"]);
  });
});
