import { describe, expect, it } from "vitest";
import { MAX_CHAT_MESSAGES, MAX_CHAT_REQUEST_BYTES, parseChatRequest } from "@/lib/chat-request";

const validMessage = { id: "m1", role: "user", parts: [{ type: "text", text: "Hola" }] };
const payload = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ threadId: "thread-1", messages: [validMessage], ...overrides });

describe("chat request validation", () => {
  it("accepts a valid user message", () => {
    expect(parseChatRequest(payload())).toMatchObject({ threadId: "thread-1", messages: [validMessage] });
  });

  it("rejects malformed JSON and missing fields", () => {
    expect(parseChatRequest("{" )).toBeNull();
    expect(parseChatRequest(JSON.stringify({ messages: [validMessage] }))).toBeNull();
  });

  it("rejects system and developer roles supplied by the browser", () => {
    expect(parseChatRequest(payload({ messages: [{ ...validMessage, role: "system" }] }))).toBeNull();
    expect(parseChatRequest(payload({ messages: [{ ...validMessage, role: "developer" }] }))).toBeNull();
  });

  it("rejects empty or oversized message histories", () => {
    expect(parseChatRequest(payload({ messages: [] }))).toBeNull();
    expect(parseChatRequest(payload({ messages: Array.from({ length: MAX_CHAT_MESSAGES + 1 }, (_, i) => ({ ...validMessage, id: `m${i}` })) }))).toBeNull();
  });

  it("rejects oversized request bodies", () => {
    expect(parseChatRequest("x".repeat(MAX_CHAT_REQUEST_BYTES + 1))).toBeNull();
  });
});
