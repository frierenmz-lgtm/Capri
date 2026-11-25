export type CustomChatModelConfig = { baseURL: string; apiKey: string };

/** Returns a usable OpenAI-compatible endpoint configuration, or null when incomplete/invalid. */
export function parseCustomChatModelConfig(
  baseURLValue: unknown,
  apiKeyValue: unknown,
): CustomChatModelConfig | null {
  if (typeof baseURLValue !== "string" || typeof apiKeyValue !== "string") return null;

  const baseURL = baseURLValue.trim();
  const apiKey = apiKeyValue.trim();
  if (!baseURL || !apiKey) return null;

  try {
    const parsed = new URL(baseURL);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return { baseURL, apiKey };
}
