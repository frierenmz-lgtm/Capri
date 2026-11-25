/**
 * Chat models available in Capri: two options run on Groq, and the custom
 * Capri model runs on the configured OpenAI-compatible endpoint.
 */
export const CUSTOM_CHAT_MODEL_ID = "custom";
export const CUSTOM_CHAT_MODEL_NAME = "default";

export type ChatModelId =
  "openai/gpt-oss-120b" | "openai/gpt-oss-20b" | typeof CUSTOM_CHAT_MODEL_ID;

export const CHAT_MODELS: Array<{ id: ChatModelId; label: string; hint: string }> = [
  { id: "openai/gpt-oss-120b", label: "Grande · 120B", hint: "Mejor calidad, para lo difícil" },
  { id: "openai/gpt-oss-20b", label: "Rápido · 20B", hint: "Más rápido, para lo cotidiano" },
  { id: CUSTOM_CHAT_MODEL_ID, label: "Capri · Personalizado", hint: "Modelo afinado de Capri" },
];

export const DEFAULT_CHAT_MODEL: ChatModelId = "openai/gpt-oss-120b";

export function isChatModel(value: unknown): value is ChatModelId {
  return (
    value === CUSTOM_CHAT_MODEL_ID ||
    (typeof value === "string" && CHAT_MODELS.some((model) => model.id === value))
  );
}

/** Anything unrecognized (including a model from before the picker existed) falls back to the big model. */
export function resolveChatModel(value: unknown): ChatModelId {
  return isChatModel(value) ? value : DEFAULT_CHAT_MODEL;
}
