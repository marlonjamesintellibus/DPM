// Atlas through OpenRouter (decision B4): one chat completion per read, answered through a tool
// call (forced where the model allows it) so the answer has a shape the server can check. The key is read by the caller and only ever
// goes in the Authorization header; no message, log or error here contains it.
import type { CheckContext, RawProposal } from "../domain/atlas-checks/types";
import { AtlasReadFailed, type Drafter, type Extraction, type Extractor, type Malformed, type Usage } from "./extractor";
import { proposalSchema, proposeItemsTool, SYSTEM_PROMPT, TOOL_NAME, userMessage } from "./prompt";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "openai/gpt-6.1-sol";
const DEFAULT_TIMEOUT_MS = 60_000;

export type OpenRouterOptions = {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  /** Tests pass a fake; the default is the global fetch. */
  fetch?: typeof fetch;
  /** Reasoning effort; null sends none. The default depends on the model (see quirksOf). */
  reasoning?: "low" | "medium" | "high" | null;
};

/**
 * What each model family accepts. OpenAI's reasoning models (the default) think before they answer,
 * and low effort is enough to fill the tool. Anthropic models are served with a forced tool call
 * refused ("tool_choice type tool is not supported", Bedrock, 26 Oct 2026), so they get "auto":
 * the prompt asks for the tool, and an answer without it is a bad_output that is retried.
 */
export function quirksOf(model: string): { reasoning: "low" | null; forceTool: boolean } {
  if (model.startsWith("anthropic/")) return { reasoning: null, forceTool: false };
  return { reasoning: model.startsWith("openai/") ? "low" : null, forceTool: true };
}

type Message = { role: "system" | "user"; content: string };

type Completion = {
  model?: string;
  choices?: { finish_reason?: string | null; message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string; code?: number | string; metadata?: { raw?: unknown; provider_name?: string } };
};

/** The provider's own words behind "Provider returned error", shortened for the audit. */
function upstream(meta: { raw?: unknown; provider_name?: string } | undefined): string {
  if (!meta?.raw) return "";
  const raw = typeof meta.raw === "string" ? meta.raw : JSON.stringify(meta.raw);
  return ` (${meta.provider_name ?? "provider"}: ${raw.slice(0, 300)})`;
}

export function createOpenRouter(options: OpenRouterOptions): Extractor & Drafter {
  const model = options.model || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetch ?? fetch;
  const quirks = quirksOf(model);
  const effort = options.reasoning === undefined ? quirks.reasoning : options.reasoning;
  const reasoning = effort ? { reasoning: { effort } } : {};

  async function complete(body: Record<string, unknown>, signal?: AbortSignal): Promise<Completion> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await doFetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Intellibus DPM",
        },
        // Placeholder data only until the privacy sign-off (B7); even so, ask providers not to keep it
        body: JSON.stringify({ model, ...body, usage: { include: true }, provider: { data_collection: "deny" } }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (e) {
      if (timeout.aborted) throw new AtlasReadFailed("timeout", `no answer from ${model} in ${timeoutMs / 1000}s`);
      throw new AtlasReadFailed("model_error", `could not reach OpenRouter: ${(e as Error).message}`);
    }
    let json: Completion;
    try {
      json = (await res.json()) as Completion;
    } catch {
      throw new AtlasReadFailed(res.ok ? "bad_output" : "model_error", `OpenRouter answered ${res.status} with no JSON`);
    }
    // OpenRouter can report an upstream failure inside a 200
    if (!res.ok || json.error) throw new AtlasReadFailed("model_error", `OpenRouter ${res.status}: ${json.error?.message ?? res.statusText}${upstream(json.error?.metadata)}`);
    return json;
  }

  const usageOf = (c: Completion): Usage | null =>
    c.usage ? { inputTokens: c.usage.prompt_tokens ?? 0, outputTokens: c.usage.completion_tokens ?? 0, costUsd: c.usage.cost ?? null } : null;

  const messages = (system: string, user: string): Message[] => [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  return {
    name: `openrouter:${model}`,

    async extract(ctx: CheckContext, opts = {}): Promise<Extraction> {
      const completion = await complete(
        {
          messages: messages(SYSTEM_PROMPT, userMessage(ctx)),
          tools: [proposeItemsTool],
          tool_choice: quirks.forceTool ? { type: "function", function: { name: TOOL_NAME } } : "auto",
          // Reasoning tokens count against max_tokens
          ...reasoning,
          max_tokens: 16_000,
        },
        opts.signal,
      );
      const choice = completion.choices?.[0];
      if (choice?.finish_reason === "length") throw new AtlasReadFailed("bad_output", "the answer was cut off");
      const call = choice?.message?.tool_calls?.find((c) => c.function?.name === TOOL_NAME);
      if (!call?.function?.arguments) throw new AtlasReadFailed("bad_output", "the model did not call propose_items");
      const { proposals, malformed } = parseItems(call.function.arguments);
      return { proposals, malformed, model: completion.model ?? model, usage: usageOf(completion) };
    },

    async draft(system: string, user: string, opts = {}) {
      const completion = await complete({ messages: messages(system, user), ...reasoning, max_tokens: 4000 }, opts.signal);
      const text = completion.choices?.[0]?.message?.content?.trim();
      if (!text) throw new AtlasReadFailed("bad_output", "the model returned no text");
      return { text, model: completion.model ?? model, usage: usageOf(completion) };
    },
  };
}

/**
 * Reads the tool arguments. A broken envelope fails the read (it is retried); a single item with
 * the wrong shape is set aside and logged, so one bad item does not lose the rest.
 */
export function parseItems(args: string): { proposals: RawProposal[]; malformed: Malformed[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    throw new AtlasReadFailed("bad_output", "the tool arguments are not JSON");
  }
  const items = (parsed as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) throw new AtlasReadFailed("bad_output", "the tool arguments have no items list");
  const proposals: RawProposal[] = [];
  const malformed: Malformed[] = [];
  items.forEach((item, index) => {
    const r = proposalSchema.safeParse(item);
    if (r.success) proposals.push(r.data);
    else malformed.push({ index, issues: r.error.issues.map((i) => `${i.path.join(".") || "item"}: ${i.message}`).join("; ") });
  });
  return { proposals, malformed };
}
