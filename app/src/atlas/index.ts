// Which Atlas the app uses. Server code only: the key comes from app/.env.local and never reaches
// the browser (it has no NEXT_PUBLIC_ prefix, so Next.js never bundles it).
// D21: GPT-6.1 Sol reads captures; if it fails twice, the last try uses Claude Haiku, so a provider
// outage does not fail the read. Haiku also words reasons: short, cheap, and checked (G21).
import { config } from "../domain/config";
import type { Drafter, Extractor } from "./extractor";
import { createFixtureExtractor } from "./fixture";
import { createOpenRouter } from "./openrouter";

export const DEFAULT_FALLBACK_MODEL = "anthropic/claude-haiku-5.5";
export const DEFAULT_DRAFT_MODEL = "anthropic/claude-haiku-5.5";

export type Atlas = { extractor: Extractor; drafter: Drafter | null; connected: boolean };

/** The primary model for every try but the last, which goes to the fallback (D21). */
export function withFallback(primary: Extractor, fallback: Extractor, lastTry: number = config.captureMaxTries): Extractor {
  return {
    name: `${primary.name}, then ${fallback.name}`,
    extract: (context, options = {}) => ((options.attempt ?? 1) >= lastTry ? fallback : primary).extract(context, options),
  };
}

export function atlasFromEnv(env: NodeJS.ProcessEnv = process.env): Atlas {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return { extractor: createFixtureExtractor(), drafter: null, connected: false };
  const model = (name: string | undefined) => name?.trim() || undefined;
  const primary = createOpenRouter({ apiKey, model: model(env.OPENROUTER_MODEL) });
  const fallback = createOpenRouter({ apiKey, model: model(env.OPENROUTER_FALLBACK_MODEL) ?? DEFAULT_FALLBACK_MODEL });
  const drafter = createOpenRouter({ apiKey, model: model(env.OPENROUTER_DRAFT_MODEL) ?? DEFAULT_DRAFT_MODEL });
  return { extractor: withFallback(primary, fallback), drafter, connected: true };
}
