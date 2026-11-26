import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserClient } from "@/lib/auth-request.server";
import { MAX_IMAGE_BYTES } from "@/lib/images";

const authenticateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-request.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-request.server")>()),
  authenticate: authenticateMock,
}));

import { handleChat } from "@/lib/chat.server";

function fakeSupabase(stream: ReadableStream<Uint8Array>) {
  const writes: { table: string; operation: string; values?: unknown }[] = [];
  const threadUpdate = vi.fn((values: unknown) => {
    writes.push({ table: "threads", operation: "update", values });
  });
  const messageInsert = vi.fn((values: unknown) => {
    writes.push({ table: "messages", operation: "insert", values });
    return Promise.resolve({ error: null });
  });
  const messageUpdate = vi.fn((values: unknown) => {
    writes.push({ table: "messages", operation: "update", values });
    return Promise.resolve({ error: null });
  });
  const messageDelete = vi.fn(() => {
    writes.push({ table: "messages", operation: "delete" });
    return Promise.resolve({ error: null });
  });
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
              model: "openai/gpt-oss-120b",
              project_id: null,
            }
          : null,
      error: null,
    }));
    builder["limit"] = vi.fn(async () => ({ data: [], error: null }));
    builder["insert"] = table === "messages" ? messageInsert : vi.fn(async () => ({ error: null }));
    builder["update"] = vi.fn((values: unknown) => {
      if (table === "threads") threadUpdate(values);
      if (table === "messages") return messageUpdate(values);
      return builder;
    });
    builder["delete"] = table === "messages" ? messageDelete : vi.fn(() => builder);
    return builder;
  });
  const list = vi.fn(async (_folder: string, options?: { search?: string }) => ({
    data: [{ id: "object-id", name: options?.search ?? "oversized.txt", metadata: { size: 100 } }],
    error: null,
  }));
  const download = vi.fn(() => ({
    asStream: vi.fn(async () => ({ data: stream, error: null })),
  }));
  const supabase = {
    from,
    storage: { from: () => ({ list, download }) },
  } as unknown as UserClient;
  return { supabase, writes, threadUpdate, messageInsert, messageUpdate, messageDelete, download };
}

describe("persistencia de chat tras validar streams de adjuntos", () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    vi.stubEnv("GROQ_API_KEY", "groq-test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("no inserta el mensaje ni actualiza el título si el stream real supera 5 MiB", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let cancelled = false;
    let blocks = 0;
    const oversizedStream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array(blocks === 0 ? MAX_IMAGE_BYTES : 1));
          blocks += 1;
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const {
      supabase,
      writes,
      threadUpdate,
      messageInsert,
      messageUpdate,
      messageDelete,
      download,
    } = fakeSupabase(oversizedStream);
    authenticateMock.mockResolvedValue({ supabase, userId: "user-1" });
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        threadId: "thread-1",
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [
              { type: "text", text: "Guarda este archivo" },
              {
                type: "file",
                mediaType: "text/plain",
                filename: "oversized.txt",
                url: "capri-image://user-1/oversized.txt",
              },
            ],
          },
        ],
      }),
    });

    const response = await handleChat(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Cada archivo debe pesar 5 MB o menos." });
    expect(download).toHaveBeenCalledOnce();
    expect(cancelled).toBe(true);
    expect(messageInsert).not.toHaveBeenCalled();
    expect(messageUpdate).not.toHaveBeenCalled();
    expect(messageDelete).not.toHaveBeenCalled();
    expect(threadUpdate).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});
