import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserClient } from "@/lib/auth-request.server";
import { MAX_IMAGE_BYTES } from "@/lib/images";

const authenticateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-request.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-request.server")>()),
  authenticate: authenticateMock,
}));

import { handleStudyGenerate } from "@/lib/study.server";

const projectFiles = [
  {
    name: "valid.txt",
    storage_path: "user-1/valid.txt",
    media_type: "text/plain",
    created_at: "2026-01-02T00:00:00.000Z",
  },
  {
    name: "oversized.txt",
    storage_path: "user-1/oversized.txt",
    media_type: "text/plain",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

function textStream(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function fakeSupabase(
  options: {
    files?: typeof projectFiles;
    makeStream?: () => ReadableStream<Uint8Array>;
  } = {},
) {
  const files = options.files ?? projectFiles;
  const from = vi.fn((table: string) => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder["select"] = vi.fn(() => builder);
    builder["eq"] = vi.fn(() => builder);
    builder["maybeSingle"] = vi.fn(async () => ({
      data: table === "projects" ? { id: "project-1", name: "Proyecto" } : null,
      error: null,
    }));
    builder["order"] = vi.fn(async () => ({
      data: table === "project_files" ? files : [],
      error: null,
    }));
    return builder;
  });
  const list = vi.fn(async (_folder: string, listOptions?: { search?: string }) => ({
    data: [
      {
        id: "object-id",
        name: listOptions?.search ?? "file.txt",
        metadata: {
          size: listOptions?.search === "oversized.txt" ? MAX_IMAGE_BYTES + 1 : 100,
        },
      },
    ],
    error: null,
  }));
  const download = vi.fn(() => ({
    asStream: vi.fn(async () => ({
      data: (options.makeStream ?? (() => textStream("contenido de prueba")))(),
      error: null,
    })),
  }));
  const supabase = {
    from,
    storage: { from: () => ({ list, download }) },
  } as unknown as UserClient;
  return { supabase, list, download };
}

describe("límites de adjuntos en /api/study", () => {
  beforeEach(() => authenticateMock.mockReset());

  it("rechaza el lote por metadata antes de descargar cualquier texto del proyecto", async () => {
    const { supabase, list, download } = fakeSupabase();
    authenticateMock.mockResolvedValue({ supabase, userId: "user-1" });
    const request = new Request("http://localhost/api/study", {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project-1" }),
    });

    const response = await handleStudyGenerate(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Cada archivo debe pesar 5 MB o menos." });
    expect(list).toHaveBeenCalledTimes(2);
    expect(download).not.toHaveBeenCalled();
  });

  it("rechaza y cancela un stream que supera 5 MiB aunque la metadata sea pequeña", async () => {
    let cancelled = false;
    const oversizedStream = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES));
          controller.enqueue(new Uint8Array(1));
        },
        cancel() {
          cancelled = true;
        },
      });
    const { supabase, download } = fakeSupabase({
      files: [projectFiles[0]!],
      makeStream: oversizedStream,
    });
    authenticateMock.mockResolvedValue({ supabase, userId: "user-1" });
    const request = new Request("http://localhost/api/study", {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project-1" }),
    });

    const response = await handleStudyGenerate(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Cada archivo debe pesar 5 MB o menos." });
    expect(download).toHaveBeenCalledOnce();
    expect(cancelled).toBe(true);
  });
});
