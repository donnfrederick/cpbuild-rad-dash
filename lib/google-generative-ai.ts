import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Gemini API key for `@ai-sdk/google`.
 * - `GOOGLE_GENERATIVE_AI_API_KEY` is what Vercel AI SDK expects by default.
 * - `GEMINI_API_KEY` is the name Google often shows in AI Studio / docs; we accept it as an alias.
 */
export function getGoogleGenerativeAiApiKey(): string | undefined {
  const primary = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (primary) return primary;
  const alternate = process.env.GEMINI_API_KEY?.trim();
  if (alternate) return alternate;
  return undefined;
}

/** Provider wired to whichever env key is set (or falls through to SDK env lookup if neither). */
export function getGoogleGenerativeAI() {
  const apiKey = getGoogleGenerativeAiApiKey();
  return createGoogleGenerativeAI(apiKey ? { apiKey } : {});
}
