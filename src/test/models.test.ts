import { describe, expect, it } from "vitest";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, isChatModel, resolveChatModel } from "@/lib/models";

describe("chat models", () => {
  it("offers the big model by default and the fast one as the alternative", () => {
    expect(DEFAULT_CHAT_MODEL).toBe("openai/gpt-oss-120b");
    expect(CHAT_MODELS.map((model) => model.id)).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  });

  it("accepts only the offered models", () => {
    expect(isChatModel("openai/gpt-oss-120b")).toBe(true);
    expect(isChatModel("openai/gpt-oss-20b")).toBe(true);
    expect(isChatModel("openai/gpt-oss-safeguard-20b")).toBe(false);
    expect(isChatModel("llama-3.3-70b-versatile")).toBe(false);
    expect(isChatModel("gpt-4o")).toBe(false);
    expect(isChatModel(null)).toBe(false);
    expect(isChatModel(undefined)).toBe(false);
  });

  it("falls back to the big model for anything unrecognized", () => {
    expect(resolveChatModel("openai/gpt-oss-20b")).toBe("openai/gpt-oss-20b");
    expect(resolveChatModel("llama-3.3-70b-versatile")).toBe(DEFAULT_CHAT_MODEL);
    expect(resolveChatModel(null)).toBe(DEFAULT_CHAT_MODEL);
    expect(resolveChatModel(undefined)).toBe(DEFAULT_CHAT_MODEL);
  });
});
