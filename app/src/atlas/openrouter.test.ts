// The OpenRouter client against a fake fetch: what it sends, how it reads the tool call, and how
// each failure maps to the capture machine's READ_FAILED reasons (E18, E19). No network.
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT, KEMAR_NOTE, KEMAR_PROPOSALS } from "../domain/atlas-checks/kemar-note.fixture";
import { ANSWER_SYSTEM_PROMPT } from "./answer";
import { AtlasReadFailed } from "./extractor";
import { createFixtureExtractor } from "./fixture";
import { atlasFromEnv, withFallback } from "./index";
import { createOpenRouter, DEFAULT_MODEL, OPENROUTER_URL, parseItems } from "./openrouter";
import { PROMPT_VERSION, proposeItemsTool, questionSchema, SYSTEM_PROMPT, userMessage } from "./prompt";

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

  it("the topics come from domain/topics in read-wave2-l's words and order; a change to them is a new prompt version", () => {
    expect(PROMPT_VERSION).toBe("read-wave2-l");
    expect(SYSTEM_PROMPT).toContain(
      'topic: needs_me (what they need to do, review or approve), my_work (what they are working on: their own open work), due (what is due, or when the next milestone is), blocked (what is blocked or stuck), project_status (how a project stands), updates (what is new or changed since they last asked), mentions (who mentioned them), why_filed (why Atlas filed their update or an item of it where it did ("Why did you file that?")), correction (a correction to how you read names ("GQ also means the Guild", "Kyle is Store Insights, not Forager"), with correction filled), undo (only "Undo that" or "Take that back": undo their last saved update, with nothing else said), small_talk (only a greeting, thanks or ok, with nothing else said or asked), or other.\n',
    );
    expect(questionSchema.shape.topic.options).toEqual([
      "needs_me",
      "my_work",
      "due",
      "blocked",
      "project_status",
      "updates",
      "mentions",
      "why_filed",
      "correction",
      "undo",
      "small_talk",
      "other",
      "unclear",
    ]);
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
    expect(parseItems('{"items":[]}')).toEqual({ proposals: [], malformed: [], question: null });
  });

  it("section 15: reads what the message asks; a question without the right shape is set aside (QA7)", () => {
    const asked = { asked: "What needs me today?", topic: "needs_me", projectId: null };
    expect(parseItems(JSON.stringify({ items: [], question: asked }))).toEqual({ proposals: [], malformed: [], question: asked });
    const bad = parseItems(JSON.stringify({ items: [], question: { asked: 3, topic: "gossip" } }));
    expect(bad.question).toBeNull();
    expect(bad.malformed).toHaveLength(1);
    expect(bad.malformed[0].issues).toMatch(/^question:/);
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
