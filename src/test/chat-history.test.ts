import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { UserClient } from "@/lib/auth-request.server";
import { MAX_DOCUMENT_CHARS } from "@/lib/images";
import {
  MAX_HISTORY_CHARS,
  messageCost,
  OLDER_ATTACHMENT_HISTORY_NOTE,
} from "@/lib/history-budget";
import { resolveTrimmedAttachments } from "@/lib/chat.server";

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
          download: vi.fn(async (path: string) => {
            downloaded.push(path);
            return path === "user/retained.txt"
              ? { data: { text: async () => "contenido vigente" }, error: null }
              : { data: null, error: new Error("adjunto antiguo no disponible") };
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
          download: vi.fn(async (path: string) => {
            downloaded.push(path);
            return path === "user/retained.txt"
              ? { data: { text: async () => longAttachmentText }, error: null }
              : { data: null, error: new Error("adjunto antiguo no disponible") };
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

  it("no descarga un adjunto con codificación de contenido comprimida", async () => {
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

  it("no descarga el adjunto si list no devuelve size fiable", async () => {
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
