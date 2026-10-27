// Which Atlas the app uses. Server code only: the key comes from app/.env.local and never reaches
// the browser (it has no NEXT_PUBLIC_ prefix, so Next.js never bundles it).
import type { Drafter, Extractor } from "./extractor";
import { createFixtureExtractor } from "./fixture";
import { createOpenRouter } from "./openrouter";

export type Atlas = { extractor: Extractor; drafter: Drafter | null; connected: boolean };

export function atlasFromEnv(env: NodeJS.ProcessEnv = process.env): Atlas {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return { extractor: createFixtureExtractor(), drafter: null, connected: false };
  const client = createOpenRouter({ apiKey, model: env.OPENROUTER_MODEL?.trim() || undefined });
  return { extractor: client, drafter: client, connected: true };
}
