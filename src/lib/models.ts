/**
 * Chat models available in Capri, all on Groq's free plan (30 RPM / 1K RPD /
 * 8K TPM / 200K TPD each). Only these two are offered: the big one for hard
 * questions and the small one for everyday chats. Groq's free tier has no
 * other general chat model (Qwen 3.8 27B is preview-only, Safeguard is a
 * moderation model, and the Llama models left the free tier).
 */
export type ChatModelId = "openai/gpt-oss-120b" | "openai/gpt-oss-20b";

export const CHAT_MODELS: Array<{ id: ChatModelId; label: string; hint: string }> = [
  { id: "openai/gpt-oss-120b", label: "Grande · 120B", hint: "Mejor calidad, para lo difícil" },
  { id: "openai/gpt-oss-20b", label: "Rápido · 20B", hint: "Más rápido, para lo cotidiano" },
];

export const DEFAULT_CHAT_MODEL: ChatModelId = "openai/gpt-oss-120b";

export function isChatModel(value: unknown): value is ChatModelId {
  return typeof value === "string" && CHAT_MODELS.some((model) => model.id === value);
}

/** Anything unrecognized (including a model from before the picker existed) falls back to the big model. */
export function resolveChatModel(value: unknown): ChatModelId {
  return isChatModel(value) ? value : DEFAULT_CHAT_MODEL;
}
