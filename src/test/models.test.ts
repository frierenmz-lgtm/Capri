import { describe, expect, it } from "vitest";
import {
  CHAT_MODELS,
  CUSTOM_CHAT_MODEL_ID,
  CUSTOM_CHAT_MODEL_NAME,
  DEFAULT_CHAT_MODEL,
  isChatModel,
  resolveChatModel,
} from "@/lib/models";

describe("chat models", () => {
  it("offers both Groq models and the custom Capri model", () => {
    expect(DEFAULT_CHAT_MODEL).toBe("openai/gpt-oss-120b");
    expect(CHAT_MODELS.map((model) => model.id)).toEqual([
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      CUSTOM_CHAT_MODEL_ID,
    ]);
    expect(CHAT_MODELS.find((model) => model.id === CUSTOM_CHAT_MODEL_ID)).toMatchObject({
      label: "Capri · Personalizado",
      hint: "Modelo afinado de Capri",
    });
  });

  it("accepts the offered models and custom server model", () => {
    expect(isChatModel("openai/gpt-oss-120b")).toBe(true);
    expect(isChatModel("openai/gpt-oss-20b")).toBe(true);
    expect(CUSTOM_CHAT_MODEL_NAME).toBe("default");
    expect(isChatModel(CUSTOM_CHAT_MODEL_ID)).toBe(true);
    expect(isChatModel("openai/gpt-oss-safeguard-20b")).toBe(false);
    expect(isChatModel("llama-3.3-70b-versatile")).toBe(false);
    expect(isChatModel("gpt-4o")).toBe(false);
    expect(isChatModel(null)).toBe(false);
    expect(isChatModel(undefined)).toBe(false);
  });

  it("falls back to the big model for anything unrecognized", () => {
    expect(resolveChatModel("openai/gpt-oss-20b")).toBe("openai/gpt-oss-20b");
    expect(resolveChatModel(CUSTOM_CHAT_MODEL_ID)).toBe(CUSTOM_CHAT_MODEL_ID);
    expect(resolveChatModel("llama-3.3-70b-versatile")).toBe(DEFAULT_CHAT_MODEL);
    expect(resolveChatModel(null)).toBe(DEFAULT_CHAT_MODEL);
    expect(resolveChatModel(undefined)).toBe(DEFAULT_CHAT_MODEL);
  });
});
