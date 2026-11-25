import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserClient } from "@/lib/auth-request.server";

const authenticateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-request.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-request.server")>()),
  authenticate: authenticateMock,
}));

import { handleChat } from "@/lib/chat.server";

function fakeSupabase() {
  const threadUpdate = vi.fn();
  const from = vi.fn((table: string) => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder["select"] = vi.fn(() => builder);
    builder["eq"] = vi.fn(() => builder);
    builder["or"] = vi.fn(() => builder);
    builder["order"] = vi.fn(() => builder);
    builder["maybeSingle"] = vi.fn(async () => ({
      data:
        table === "threads"
          ? {
              id: "thread-1",
              title: "Nueva conversación",
              custom_instructions: null,
              model: "custom",
              project_id: null,
            }
          : null,
      error: null,
    }));
    builder["limit"] = vi.fn(async () => ({ data: [], error: null }));
    builder["update"] = vi.fn((values: unknown) => {
      if (table === "threads") threadUpdate(values);
      return builder;
    });
    builder["insert"] = vi.fn(async () => ({ error: null }));
    return builder;
  });
  return { from, supabase: { from } as unknown as UserClient, threadUpdate };
}

describe("preflight de modelo personalizado en handleChat", () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    vi.stubEnv("GROQ_API_KEY", "groq-test-key");
    vi.stubEnv("CAPRI_CUSTOM_MODEL_URL", "not a valid endpoint");
    vi.stubEnv("CAPRI_CUSTOM_MODEL_KEY", "custom-test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("no persiste el mensaje ni cambia el título si el endpoint está mal configurado", async () => {
    const { from, supabase, threadUpdate } = fakeSupabase();
    authenticateMock.mockResolvedValue({ supabase, userId: "user-1" });
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        threadId: "thread-1",
        messages: [{ id: "message-1", role: "user", parts: [{ type: "text", text: "Hola" }] }],
      }),
    });

    const response = await handleChat(request);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "El modelo de Capri no está configurado todavía.",
    });
    expect(from).not.toHaveBeenCalledWith("messages");
    expect(threadUpdate).not.toHaveBeenCalled();
  });
});
