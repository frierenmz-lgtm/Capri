import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { UserClient } from "@/lib/auth-request.server";
import {
  downloadChatAttachmentBytes,
  validateChatMessageAttachments,
} from "@/lib/chat-attachment-limits.server";
import { MAX_IMAGE_BYTES, MAX_IMAGES } from "@/lib/images";
import { projectContextParts, resolveTrimmedAttachments } from "@/lib/chat.server";

const filePart = (filename: string) => ({
  type: "file" as const,
  mediaType: "text/plain",
  filename,
  url: `capri-image://user/${filename}`,
});

const textStream = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

function storageClient(
  size: number | undefined,
  makeStream = () => textStream("contenido de prueba"),
) {
  const list = vi.fn(async (_folder: string, options?: { search?: string }) => ({
    data:
      size === undefined
        ? [{ id: "object-id", name: options?.search ?? "file.txt", metadata: null }]
        : [{ id: "object-id", name: options?.search ?? "file.txt", metadata: { size } }],
    error: null,
  }));
  const download = vi.fn(() => ({
    asStream: vi.fn(async () => ({ data: makeStream(), error: null })),
  }));
  const supabase = {
    storage: {
      from: () => ({ list, download }),
    },
  } as unknown as UserClient;
  return { supabase, list, download };
}

const userMessage = (parts: UIMessage["parts"]): UIMessage => ({
  id: "current",
  role: "user",
  parts,
});

describe("límites server-side de adjuntos de chat", () => {
  it("acepta hasta el máximo de archivos por mensaje y el tamaño exacto permitido en metadata", async () => {
    const { supabase, list, download } = storageClient(MAX_IMAGE_BYTES);
    const message = userMessage(
      Array.from({ length: MAX_IMAGES }, (_, i) => filePart(`f${i}.txt`)),
    );

    await expect(
      validateChatMessageAttachments(supabase, "user", message, new Map()),
    ).resolves.toBeUndefined();

    expect(list).toHaveBeenCalledTimes(MAX_IMAGES);
    expect(download).not.toHaveBeenCalled();
  });

  it("rechaza un archivo sobre el tamaño permitido antes de descargar su contenido", async () => {
    const { supabase, download } = storageClient(MAX_IMAGE_BYTES + 1);
    const message = userMessage([filePart("large.txt")]);

    await expect(resolveTrimmedAttachments(supabase, "user", [message])).rejects.toMatchObject({
      status: 413,
      message: "Cada archivo debe pesar 5 MB o menos.",
    });
    expect(download).not.toHaveBeenCalled();
  });

  it("rechaza más archivos que el máximo antes de consultar Storage", async () => {
    const { supabase, list, download } = storageClient(MAX_IMAGE_BYTES);
    const message = userMessage(
      Array.from({ length: MAX_IMAGES + 1 }, (_, i) => filePart(`f${i}.txt`)),
    );

    await expect(
      validateChatMessageAttachments(supabase, "user", message, new Map()),
    ).rejects.toMatchObject({ status: 413 });
    expect(list).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("falla cerrado y no descarga si Storage no puede confirmar el tamaño", async () => {
    const { supabase, download } = storageClient(undefined);
    const message = userMessage([filePart("unknown.txt")]);

    await expect(resolveTrimmedAttachments(supabase, "user", [message])).rejects.toThrow(
      "No se pudo verificar el tamaño de un archivo adjunto.",
    );
    expect(download).not.toHaveBeenCalled();
  });

  it("cancela una descarga cuando los bytes reales superan 5 MiB aunque la metadata sea pequeña", async () => {
    let cancelled = false;
    let producedBlocks = 0;
    const oversizedStream = () =>
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            producedBlocks += 1;
            controller.enqueue(new Uint8Array(producedBlocks === 1 ? MAX_IMAGE_BYTES : 1));
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
    const { supabase, download } = storageClient(100, oversizedStream);

    await expect(
      resolveTrimmedAttachments(supabase, "user", [userMessage([filePart("large.txt")])]),
    ).rejects.toMatchObject({
      status: 413,
      message: "Cada archivo debe pesar 5 MB o menos.",
    });

    expect(download).toHaveBeenCalledOnce();
    expect(cancelled).toBe(true);
    expect(producedBlocks).toBe(2);
  });

  it("acepta una descarga cuyo stream real pesa exactamente 5 MiB", async () => {
    const { supabase } = storageClient(
      100,
      () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES));
            controller.close();
          },
        }),
    );

    await expect(downloadChatAttachmentBytes(supabase, "user/exact.txt")).resolves.toHaveLength(
      MAX_IMAGE_BYTES,
    );
  });

  it("propaga la cancelación del cliente al stream de Storage", async () => {
    const abortController = new AbortController();
    let cancelled = false;
    let resolveFirstPull!: () => void;
    const firstPull = new Promise<void>((resolve) => {
      resolveFirstPull = resolve;
    });
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1));
        resolveFirstPull();
      },
      cancel() {
        cancelled = true;
      },
    });
    const { supabase } = storageClient(1, () => stream);
    const download = downloadChatAttachmentBytes(
      supabase,
      "user/cancel.txt",
      abortController.signal,
    );

    await firstPull;
    abortController.abort(new DOMException("Client disconnected", "AbortError"));

    await expect(download).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true);
  });

  it("cancela el fetch inicial de Storage si el request se aborta antes de recibir el stream", async () => {
    const abortController = new AbortController();
    const download = vi.fn(
      (_path: string, _options: undefined, parameters?: { signal?: AbortSignal }) => ({
        asStream: () =>
          new Promise((_, reject) => {
            const signal = parameters?.signal;
            signal?.addEventListener(
              "abort",
              () =>
                reject(signal.reason ?? new DOMException("The request was aborted", "AbortError")),
              { once: true },
            );
          }),
      }),
    );
    const supabase = {
      storage: { from: () => ({ download }) },
    } as unknown as UserClient;
    const pending = downloadChatAttachmentBytes(
      supabase,
      "user/pending.txt",
      abortController.signal,
    );

    expect(download).toHaveBeenCalledWith("user/pending.txt", undefined, {
      signal: abortController.signal,
    });
    abortController.abort(new DOMException("Client disconnected", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("recorta más de cuatro archivos de un mensaje antiguo antes de descargarlos", async () => {
    const { supabase, download } = storageClient(3_000);
    const older = {
      ...userMessage(Array.from({ length: MAX_IMAGES + 1 }, (_, i) => filePart(`old-${i}.txt`))),
      id: "old",
    };
    const current = userMessage([{ type: "text", text: "mensaje actual" }]);

    const resolved = await resolveTrimmedAttachments(supabase, "user", [older, current]);

    expect(resolved.map((message) => message.id)).toEqual(["current"]);
    expect(download).not.toHaveBeenCalled();
  });

  it.each([
    { condition: "el archivo supera el límite", size: MAX_IMAGE_BYTES + 1, status: 413 },
    { condition: "Storage no confirma el tamaño", size: undefined, status: 400 },
  ])("no descarga un archivo de proyecto si $condition", async ({ size, status }) => {
    const { supabase, list, download } = storageClient(size);

    await expect(
      projectContextParts(supabase, "user", [
        {
          name: "project.txt",
          storage_path: "user/project.txt",
          media_type: "text/plain",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ]),
    ).rejects.toMatchObject({ status });

    expect(list).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
  });

  it("valida todo el lote del proyecto antes de descargar un archivo válido cuando otro se rechaza", async () => {
    const list = vi.fn(async (_folder: string, options?: { search?: string }) => ({
      data: [
        {
          id: "object-id",
          name: options?.search ?? "file.txt",
          metadata: {
            size: options?.search === "large.txt" ? MAX_IMAGE_BYTES + 1 : 100,
          },
        },
      ],
      error: null,
    }));
    const download = vi.fn(() => ({
      asStream: vi.fn(async () => ({ data: textStream("contenido de prueba"), error: null })),
    }));
    const supabase = {
      storage: { from: () => ({ list, download }) },
    } as unknown as UserClient;

    await expect(
      projectContextParts(supabase, "user", [
        {
          name: "valid.txt",
          storage_path: "user/valid.txt",
          media_type: "text/plain",
          created_at: "2026-01-02T00:00:00.000Z",
        },
        {
          name: "large.txt",
          storage_path: "user/large.txt",
          media_type: "text/plain",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ]),
    ).rejects.toMatchObject({ status: 413 });

    expect(list).toHaveBeenCalledTimes(2);
    expect(download).not.toHaveBeenCalled();
  });
});
