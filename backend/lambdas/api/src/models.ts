/** Retired Claude IDs that the Anthropic API now returns as 404 not_found_error. */
export const RETIRED_MODEL_ALIASES: Record<string, string> = {
  "claude-sonnet-4-20250514": "claude-sonnet-5",
  "claude-opus-4-20250514": "claude-opus-5",
  "claude-opus-4-1-20250805": "claude-opus-5",
  "claude-3-5-sonnet-latest": "claude-sonnet-5",
  "claude-3-5-sonnet-20241022": "claude-sonnet-5",
  "claude-3-7-sonnet-20250219": "claude-sonnet-5",
  "claude-3-5-haiku-latest": "claude-haiku-4-5",
  "claude-3-5-haiku-20241022": "claude-haiku-4-5",
  "claude-3-haiku-20240307": "claude-haiku-4-5",
  "claude-sonnet-4": "claude-sonnet-5",
  "claude-opus-4": "claude-opus-5",
  "anthropic/claude-3.5-sonnet": "anthropic/claude-sonnet-5",
  "anthropic/claude-sonnet-4": "anthropic/claude-sonnet-5",
  "anthropic/claude-3-haiku": "anthropic/claude-haiku-4.5",
};

export function resolveModelId(model: string): string {
  return RETIRED_MODEL_ALIASES[model] ?? model;
}

export function apiKeyForProvider(provider: string, requestKey?: string): string | undefined {
  const trimmed = requestKey?.trim();
  if (trimmed) {
    return trimmed;
  }
  switch (provider) {
    case "anthropic":
      return firstEnv("ANTHROPIC_API_KEY", "ANTHROPIC", "OPENROUTER_API_KEY");
    case "openai":
      return firstEnv("OPENAI_API_KEY", "OPENAI", "OPENROUTER_API_KEY");
    case "gemini":
      return firstEnv("GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY");
    case "grok":
      return firstEnv("XAI_API_KEY", "GROK_API_KEY", "OPENROUTER_API_KEY");
    default:
      return firstEnv("OPENROUTER_API_KEY", "OPENROUTER");
  }
}

function firstEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}
