import type { UIMessage } from "ai";

export const MAX_CHAT_REQUEST_BYTES = 1024 * 1024;
export const MAX_CHAT_MESSAGES = 100;

export type ChatRequestBody = { messages: UIMessage[]; threadId: string };

/** Validate the untrusted browser payload before it reaches the model provider. */
export function parseChatRequest(raw: string): ChatRequestBody | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_CHAT_REQUEST_BYTES) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body["threadId"] !== "string" ||
    body["threadId"].length === 0 ||
    body["threadId"].length > 128 ||
    !Array.isArray(body["messages"]) ||
    body["messages"].length === 0 ||
    body["messages"].length > MAX_CHAT_MESSAGES
  ) {
    return null;
  }

  const validMessages = body["messages"].every((message: unknown) => {
    if (!message || typeof message !== "object") return false;
    const item = message as Record<string, unknown>;
    return (
      typeof item["id"] === "string" &&
      item["id"].length > 0 &&
      item["id"].length <= 128 &&
      (item["role"] === "user" || item["role"] === "assistant") &&
      Array.isArray(item["parts"])
    );
  });

  if (!validMessages) return null;
  return { messages: body["messages"] as UIMessage[], threadId: body["threadId"] };
}
