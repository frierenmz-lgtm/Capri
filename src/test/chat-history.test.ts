import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { UserClient } from "@/lib/auth-request.server";
import { MAX_DOCUMENT_CHARS, MAX_IMAGE_BYTES } from "@/lib/images";
import {
  MAX_HISTORY_CHARS,
  messageCost,
  OLDER_ATTACHMENT_HISTORY_NOTE,
} from "@/lib/history-budget";
import { resolveTrimmedAttachments } from "@/lib/chat.server";

const textStream = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

describe("resolveTrimmedAttachments", () => {
  it("no descarga adjuntos de mensajes recortados y conserva los de los mensajes retenidos", async () => {
    const downloaded: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async (_folder: string, options?: { search?: string }) => ({
            data: [
              {
                id: "object-id",
                name: options?.search ?? "retained.txt",
                metadata: { size: 20 },
              },
            ],
            error: null,
          })),
          download: vi.fn((path: string) => {
            downloaded.push(path);
            return {
              asStream: async () =>
                path === "user/retained.txt"
                  ? { data: textStream("contenido vigente"), error: null }
                  : { data: null, error: new Error("adjunto antiguo no disponible") },
            };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      {
        id: "old",
        role: "user",
        parts: [
          { type: "text", text: "x".repeat(12_000) },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "antiguo.txt",
            url: "capri-image://user/old.txt",
          },
        ],
      },
      {
        id: "current",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "text/plain",
            filename: "retained.txt",
            url: "capri-image://user/retained.txt",
          },
        ],
      },
    ];

    const resolved = await resolveTrimmedAttachments(supabase, "user", messages);

    expect(downloaded).toEqual(["user/retained.txt"]);
    expect(resolved.map((message) => message.id)).toEqual(["current"]);
    expect(resolved[0]?.parts[0]).toEqual({
      type: "text",
      text: "Archivo adjunto: retained.txt\n<<<\ncontenido vigente\n>>>",
    });
    const currentText = resolved[0]?.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    expect(currentText).toContain("adjuntos de mensajes anteriores");
    expect(messageCost(resolved[0]!)).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
  });

  it("prevalida todos los adjuntos del mensaje retenido y no descarga ninguno si uno es inválido", async () => {
    const downloaded: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async (_folder: string, options?: { search?: string }) => ({
            data: [
              {
                id: "object-id",
                name: options?.search ?? "current.txt",
                metadata: options?.search === "invalid.txt" ? null : { size: 20 },
              },
            ],
            error: null,
          })),
          download: vi.fn((path: string) => {
            downloaded.push(path);
            return {
              asStream: async () => ({ data: textStream("contenido"), error: null }),
            };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      {
        id: "current",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "text/plain",
            filename: "current.txt",
            url: "capri-image://user/current.txt",
          },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "invalid.txt",
            url: "capri-image://user/invalid.txt",
          },
        ],
      },
    ];

    await expect(resolveTrimmedAttachments(supabase, "user", messages)).rejects.toThrow(
      "No se pudo verificar el tamaño de un archivo adjunto.",
    );

    expect(downloaded).toEqual([]);
  });

  it("cuenta el adjunto de texto grande, respeta el límite estricto y omite adjuntos antiguos", async () => {
    const downloaded: string[] = [];
    const longAttachmentText = "y".repeat(MAX_DOCUMENT_CHARS + 100);
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async (_folder: string, options?: { search?: string }) => ({
            data: [
              {
                id: "object-id",
                name: options?.search ?? "retained.txt",
                metadata: { size: longAttachmentText.length },
              },
            ],
            error: null,
          })),
          download: vi.fn((path: string) => {
            downloaded.push(path);
            return {
              asStream: async () =>
                path === "user/retained.txt"
                  ? { data: textStream(longAttachmentText), error: null }
                  : { data: null, error: new Error("adjunto antiguo no disponible") },
            };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      {
        id: "previous",
        role: "assistant",
        parts: [
          { type: "text", text: "x".repeat(8_000) },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "antiguo.txt",
            url: "capri-image://user/old.txt",
          },
        ],
      },
      {
        id: "current",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "text/plain",
            filename: "retained.txt",
            url: "capri-image://user/retained.txt",
          },
        ],
      },
    ];

    const resolved = await resolveTrimmedAttachments(supabase, "user", messages);

    expect(downloaded).toEqual(["user/retained.txt"]);
    expect(resolved.map((message) => message.id)).toEqual(["current"]);
    expect(messageCost(resolved[0]!)).toBe(MAX_HISTORY_CHARS);
    const retainedContent = resolved[0]?.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    expect(retainedContent).toContain("Archivo adjunto: retained.txt");
    expect(retainedContent).toContain("solo se incluyen los primeros");
    expect(retainedContent).toContain("límite del historial");
    expect(retainedContent).toContain("Uno o más adjuntos se recortaron u omitieron");
    expect(retainedContent).toContain("adjuntos de mensajes anteriores");
  });

  it("descarta un adjunto de texto antiguo usando size en bytes sin descargar su cuerpo", async () => {
    const listCalls: string[] = [];
    const downloadPaths: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async (folder: string, options?: { search?: string; limit?: number }) => {
            listCalls.push(`${folder}/${options?.search}/${options?.limit}`);
            return {
              data: [{ id: "object-id", name: "old.txt", metadata: { size: 80_000 } }],
              error: null,
            };
          }),
          download: vi.fn(async (path: string) => {
            downloadPaths.push(path);
            return { data: { text: async () => "z".repeat(80_000) }, error: null };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      {
        id: "old",
        role: "assistant",
        parts: [
          {
            type: "file",
            mediaType: "text/plain",
            filename: "antiguo.txt",
            url: "capri-image://user/old.txt",
          },
        ],
      },
      { id: "current", role: "user", parts: [{ type: "text", text: "x".repeat(5_000) }] },
    ];

    const resolved = await resolveTrimmedAttachments(supabase, "user", messages);

    expect(listCalls).toEqual(["user/old.txt/100"]);
    expect(downloadPaths).toEqual([]);
    expect(resolved.map((message) => message.id)).toEqual(["current"]);
  });

  it("poda un adjunto histórico mayor a 5 MiB con encoding admitida sin validarlo ni descargarlo", async () => {
    const listCalls: string[] = [];
    const downloadPaths: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async (folder: string, options?: { search?: string; limit?: number }) => {
            listCalls.push(`${folder}/${options?.search}/${options?.limit}`);
            return {
              data: [
                {
                  id: "object-id",
                  name: "old-large.txt",
                  metadata: { size: 5 * 1024 * 1024 + 1, contentEncoding: "identity" },
                },
              ],
              error: null,
            };
          }),
          download: vi.fn(async (path: string) => {
            downloadPaths.push(path);
            return { data: null, error: new Error("no debe descargarse") };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      {
        id: "old-large",
        role: "assistant",
        parts: [
          {
            type: "file",
            mediaType: "text/plain",
            filename: "old-large.txt",
            url: "capri-image://user/old-large.txt",
          },
        ],
      },
      { id: "current", role: "user", parts: [{ type: "text", text: "mensaje actual" }] },
    ];

    const resolved = await resolveTrimmedAttachments(supabase, "user", messages);

    expect(listCalls).toEqual(["user/old-large.txt/100"]);
    expect(downloadPaths).toEqual([]);
    expect(resolved.map((message) => message.id)).toEqual(["current"]);
  });

  it("poda un adjunto ASCII antiguo de 13 KB cuando su cota mínima ya no cabe", async () => {
    const asciiBytes = new TextEncoder().encode("a".repeat(13_000));
    const downloadPaths: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async (_folder: string, options?: { search?: string }) => ({
            data: [
              {
                id: "object-id",
                name: options?.search ?? "old.txt",
                metadata: { size: asciiBytes.byteLength },
              },
            ],
            error: null,
          })),
          download: vi.fn((path: string) => {
            downloadPaths.push(path);
            return {
              asStream: async () => ({
                data: new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(asciiBytes);
                    controller.close();
                  },
                }),
                error: null,
              }),
            };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      {
        id: "old",
        role: "assistant",
        parts: [
          {
            type: "file",
            mediaType: "text/plain",
            filename: "antiguo.txt",
            url: "capri-image://user/old.txt",
          },
        ],
      },
      { id: "current", role: "user", parts: [{ type: "text", text: "x".repeat(9_000) }] },
    ];

    const resolved = await resolveTrimmedAttachments(supabase, "user", messages);

    expect(downloadPaths).toEqual([]);
    expect(resolved.map((message) => message.id)).toEqual(["current"]);
    const currentText = resolved[0]?.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    expect(currentText).toContain("x".repeat(20));
    expect(currentText).toContain(OLDER_ATTACHMENT_HISTORY_NOTE.trim());
  });

  it("conserva CJK y poda ASCII de 13 KB del mismo tamaño en bytes cuando el antiguo ya no cabe", async () => {
    const asciiText = "a".repeat(13_002);
    const cjkText = "界".repeat(4_334);
    const asciiBytes = new TextEncoder().encode(asciiText);
    const cjkBytes = new TextEncoder().encode(cjkText);
    expect(cjkBytes.byteLength).toBe(asciiBytes.byteLength);

    const downloadPaths: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async (_folder: string, options?: { search?: string }) => ({
            data: [
              {
                id: "object-id",
                name: options?.search ?? "file.txt",
                metadata: { size: asciiBytes.byteLength },
              },
            ],
            error: null,
          })),
          download: vi.fn((path: string) => {
            downloadPaths.push(path);
            return {
              asStream: async () => ({
                data: textStream(path === "user/cjk.txt" ? cjkText : asciiText),
                error: null,
              }),
            };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      {
        id: "ascii-old",
        role: "assistant",
        parts: [
          {
            type: "file",
            mediaType: "text/plain",
            filename: "ascii.txt",
            url: "capri-image://user/ascii.txt",
          },
        ],
      },
      {
        id: "cjk",
        role: "assistant",
        parts: [
          {
            type: "file",
            mediaType: "text/plain",
            filename: "cjk.txt",
            url: "capri-image://user/cjk.txt",
          },
        ],
      },
      { id: "current", role: "user", parts: [{ type: "text", text: "x".repeat(5_000) }] },
    ];

    const resolved = await resolveTrimmedAttachments(supabase, "user", messages);

    expect(downloadPaths).toEqual(["user/cjk.txt"]);
    expect(resolved.map((message) => message.id)).toEqual(["cjk", "current"]);
    const cjkAttachment = resolved[0]?.parts.find((part) => part.type === "text");
    expect(cjkAttachment?.type === "text" ? cjkAttachment.text : "").toContain(cjkText);
    expect(messageCost(resolved[0]!) + messageCost(resolved[1]!)).toBeLessThanOrEqual(
      MAX_HISTORY_CHARS,
    );
  });

  it("poda el segundo adjunto de un mismo mensaje antes de descargarlo cuando el CJK consume el presupuesto", async () => {
    const cjkText = "界".repeat(4_334);
    const asciiText = "a".repeat(13_002);
    const sharedByteSize = new TextEncoder().encode(asciiText).byteLength;
    expect(new TextEncoder().encode(cjkText).byteLength).toBe(sharedByteSize);

    const downloadPaths: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async (_folder: string, options?: { search?: string }) => {
            const filename = options?.search ?? "";
            return {
              data: [
                {
                  id: "object-id",
                  name: filename,
                  metadata: { size: sharedByteSize, contentEncoding: "identity" },
                },
              ],
              error: null,
            };
          }),
          download: vi.fn((path: string) => {
            downloadPaths.push(path);
            return {
              asStream: async () => ({
                data: textStream(path === "user/cjk.txt" ? cjkText : asciiText),
                error: null,
              }),
            };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      {
        id: "paired",
        role: "assistant",
        parts: [
          {
            type: "file",
            mediaType: "text/plain",
            filename: "cjk.txt",
            url: "capri-image://user/cjk.txt",
          },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "ascii.txt",
            url: "capri-image://user/ascii.txt",
          },
        ],
      },
      { id: "current", role: "user", parts: [{ type: "text", text: "x".repeat(5_000) }] },
    ];

    const resolved = await resolveTrimmedAttachments(supabase, "user", messages);

    expect(downloadPaths).toEqual(["user/cjk.txt"]);
    expect(resolved.map((message) => message.id)).toEqual(["paired", "current"]);
    const olderText = resolved[0]?.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    expect(olderText).toContain(cjkText);
    expect(olderText).not.toContain("Archivo adjunto: ascii.txt");
  });

  it("poda PDF histórico mayor a 5 MiB si el texto CJK más reciente ocupa el presupuesto", async () => {
    const cjkText = "界".repeat(13_000);
    const cjkBytes = new TextEncoder().encode(cjkText);
    const listCalls: string[] = [];
    const downloadPaths: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async (_folder: string, options?: { search?: string }) => {
            const filename = options?.search ?? "";
            listCalls.push(filename);
            return {
              data: [
                {
                  id: "object-id",
                  name: filename,
                  metadata: {
                    size: filename === "recent.txt" ? cjkBytes.byteLength : MAX_IMAGE_BYTES + 1,
                    contentEncoding: "identity",
                  },
                },
              ],
              error: null,
            };
          }),
          download: vi.fn((path: string) => {
            downloadPaths.push(path);
            return {
              asStream: async () => ({
                data:
                  path === "user/recent.txt"
                    ? textStream(cjkText)
                    : new ReadableStream<Uint8Array>({
                        start(controller) {
                          controller.error(new Error("el PDF histórico no debe descargarse"));
                        },
                      }),
                error: null,
              }),
            };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      {
        id: "old-pdf",
        role: "assistant",
        parts: [
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "old.pdf",
            url: "capri-image://user/old.pdf",
          },
          {
            type: "file",
            mediaType: "image/png",
            filename: "old.png",
            url: "capri-image://user/old.png",
          },
        ],
      },
      {
        id: "current",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "text/plain",
            filename: "recent.txt",
            url: "capri-image://user/recent.txt",
          },
        ],
      },
    ];

    const resolved = await resolveTrimmedAttachments(supabase, "user", messages);

    expect(listCalls).toEqual(["recent.txt", "old.pdf", "old.png"]);
    expect(downloadPaths).toEqual(["user/recent.txt"]);
    expect(resolved.map((message) => message.id)).toEqual(["current"]);
    expect(messageCost(resolved[0]!)).toBe(MAX_HISTORY_CHARS);
  });

  it("conserva el aviso de adjuntos omitidos al recortar también mensajes históricos sin adjuntos", async () => {
    const listCalls: string[] = [];
    const downloadPaths: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async (_folder: string, options?: { search?: string }) => {
            listCalls.push(options?.search ?? "");
            return {
              data: [
                {
                  id: "object-id",
                  name: "old.pdf",
                  metadata: { size: MAX_IMAGE_BYTES + 1, contentEncoding: "identity" },
                },
              ],
              error: null,
            };
          }),
          download: vi.fn(async (path: string) => {
            downloadPaths.push(path);
            return { data: null, error: new Error("el PDF antiguo no debe descargarse") };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      { id: "older-text", role: "assistant", parts: [{ type: "text", text: "x".repeat(6_000) }] },
      {
        id: "oversized-pdf",
        role: "assistant",
        parts: [
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "old.pdf",
            url: "capri-image://user/old.pdf",
          },
        ],
      },
      { id: "current", role: "user", parts: [{ type: "text", text: "c".repeat(7_000) }] },
    ];

    const resolved = await resolveTrimmedAttachments(supabase, "user", messages);
    const currentText = resolved[0]?.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");

    expect(listCalls).toEqual(["old.pdf"]);
    expect(downloadPaths).toEqual([]);
    expect(resolved.map((message) => message.id)).toEqual(["current"]);
    expect(currentText).toContain(OLDER_ATTACHMENT_HISTORY_NOTE.trim());
  });

  it("conserva el texto de un mensaje mixto y recorta el adjunto con aviso dentro del presupuesto", async () => {
    const asciiText = "a".repeat(13_002);
    const ordinaryText = "historial que sí cabe".repeat(35);
    const currentText = "c".repeat(5_000);
    const downloadPaths: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async (_folder: string, options?: { search?: string }) => ({
            data: [
              {
                id: "object-id",
                name: options?.search ?? "large.txt",
                metadata: {
                  size: new TextEncoder().encode(asciiText).byteLength,
                  contentEncoding: "identity",
                },
              },
            ],
            error: null,
          })),
          download: vi.fn((path: string) => {
            downloadPaths.push(path);
            return {
              asStream: async () => ({ data: textStream(asciiText), error: null }),
            };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      {
        id: "mixed",
        role: "assistant",
        parts: [
          { type: "text", text: ordinaryText },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "large.txt",
            url: "capri-image://user/large.txt",
          },
        ],
      },
      { id: "current", role: "user", parts: [{ type: "text", text: currentText }] },
    ];

    const resolved = await resolveTrimmedAttachments(supabase, "user", messages);
    const mixedParts = resolved[0]?.parts.filter((part) => part.type === "text") ?? [];
    const attachmentText = mixedParts.find(
      (part) => part.type === "text" && part.text.startsWith("Archivo adjunto: large.txt"),
    );
    const finalCurrentText = resolved[1]?.parts.find((part) => part.type === "text");

    expect(downloadPaths).toEqual(["user/large.txt"]);
    expect(resolved.map((message) => message.id)).toEqual(["mixed", "current"]);
    expect(mixedParts[0]).toEqual({ type: "text", text: ordinaryText });
    expect(finalCurrentText).toEqual({ type: "text", text: currentText });
    expect(attachmentText?.type === "text" ? attachmentText.text : "").toContain(
      asciiText.slice(0, 100),
    );
    expect(attachmentText?.type === "text" ? attachmentText.text : "").not.toContain(asciiText);
    expect(
      mixedParts.some(
        (part) =>
          part.type === "text" &&
          part.text.includes(
            "Uno o más adjuntos se recortaron u omitieron por el límite del historial.",
          ),
      ),
    ).toBe(true);
    expect(messageCost(resolved[0]!) + messageCost(resolved[1]!)).toBeLessThanOrEqual(
      MAX_HISTORY_CHARS,
    );
  });

  it("reserva el aviso completo antes de conservar historial casi lleno y no descarga el adjunto omitido", async () => {
    const listCalls: string[] = [];
    const downloadPaths: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async (folder: string, options?: { search?: string; limit?: number }) => {
            listCalls.push(`${folder}/${options?.search}/${options?.limit}`);
            return {
              data: [{ id: "object-id", name: "old.txt", metadata: { size: 80_000 } }],
              error: null,
            };
          }),
          download: vi.fn(async (path: string) => {
            downloadPaths.push(path);
            return { data: { text: async () => "contenido que no debe descargarse" }, error: null };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      {
        id: "old",
        role: "assistant",
        parts: [
          {
            type: "file",
            mediaType: "text/plain",
            filename: "old.txt",
            url: "capri-image://user/old.txt",
          },
        ],
      },
      {
        id: "previous",
        role: "assistant",
        parts: [{ type: "text", text: "p".repeat(MAX_HISTORY_CHARS - 10) }],
      },
      { id: "current", role: "user", parts: [{ type: "text", text: "c".repeat(5) }] },
    ];

    const resolved = await resolveTrimmedAttachments(supabase, "user", messages);
    const textContent = resolved[0]?.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");

    expect(listCalls).toEqual(["user/old.txt/100"]);
    expect(downloadPaths).toEqual([]);
    expect(resolved.map((message) => message.id)).toEqual(["current"]);
    expect(textContent).toContain(OLDER_ATTACHMENT_HISTORY_NOTE.trim());
    expect(messageCost(resolved[0]!)).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
  });

  it("falla cerrado si un adjunto candidato tiene codificación de contenido no admitida", async () => {
    const downloadPaths: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async () => ({
            data: [
              {
                id: "object-id",
                name: "old.txt",
                metadata: { size: 80_000, contentEncoding: "gzip" },
              },
            ],
            error: null,
          })),
          download: vi.fn(async (path: string) => {
            downloadPaths.push(path);
            return { data: { text: async () => "contenido breve" }, error: null };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      {
        id: "old",
        role: "assistant",
        parts: [
          {
            type: "file",
            mediaType: "text/plain",
            filename: "antiguo.txt",
            url: "capri-image://user/old.txt",
          },
        ],
      },
      { id: "current", role: "user", parts: [{ type: "text", text: "x".repeat(5_000) }] },
    ];

    await expect(resolveTrimmedAttachments(supabase, "user", messages)).rejects.toThrow(
      "No se admiten archivos adjuntos con compresión.",
    );

    expect(downloadPaths).toEqual([]);
  });

  it("falla cerrado si list no devuelve size fiable para un adjunto candidato", async () => {
    const downloadPaths: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          list: vi.fn(async () => ({
            data: [{ id: "object-id", name: "old.txt", metadata: null }],
            error: null,
          })),
          download: vi.fn(async (path: string) => {
            downloadPaths.push(path);
            return { data: { text: async () => "contenido breve" }, error: null };
          }),
        }),
      },
    } as unknown as UserClient;
    const messages: UIMessage[] = [
      {
        id: "old",
        role: "assistant",
        parts: [
          {
            type: "file",
            mediaType: "text/plain",
            filename: "antiguo.txt",
            url: "capri-image://user/old.txt",
          },
        ],
      },
      { id: "current", role: "user", parts: [{ type: "text", text: "x".repeat(5_000) }] },
    ];

    await expect(resolveTrimmedAttachments(supabase, "user", messages)).rejects.toThrow(
      "No se pudo verificar el tamaño de un archivo adjunto.",
    );

    expect(downloadPaths).toEqual([]);
  });
});
