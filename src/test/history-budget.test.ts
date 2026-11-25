import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { documentText, MAX_DOCUMENT_CHARS } from "@/lib/images";
import { MAX_HISTORY_CHARS, messageCost, trimHistory } from "@/lib/history-budget";

const text = (id: string, role: UIMessage["role"], chars: number): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text: "x".repeat(chars) }],
});

describe("trimHistory", () => {
  it("conserva solo los mensajes recientes que caben en el presupuesto", () => {
    const messages = [
      text("a", "user", 6_000),
      text("b", "assistant", 6_000),
      text("c", "user", 6_000),
    ];
    const out = trimHistory(messages);
    expect(out.map((m) => m.id)).toEqual(["b", "c"]);
  });

  it("conserva el último mensaje pero lo recorta para no superar el presupuesto", () => {
    const messages = [text("a", "user", 100), text("b", "assistant", MAX_HISTORY_CHARS + 5_000)];
    const out = trimHistory(messages);
    expect(out.map((m) => m.id)).toEqual(["b"]);
    expect(messageCost(out[0]!)).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    const content = out[0]?.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    expect(content).toContain("contenido se recortó");
  });

  it("devuelve todo cuando cabe y nada cuando no hay mensajes", () => {
    const messages = [text("a", "user", 100), text("b", "assistant", 100)];
    expect(trimHistory(messages)).toEqual(messages);
    expect(trimHistory([])).toEqual([]);
  });

  it("cuenta un archivo adjunto con un costo fijo, no con la longitud del base64", () => {
    const withImage: UIMessage = {
      id: "img",
      role: "user",
      parts: [
        {
          type: "file",
          mediaType: "image/png",
          url: `data:image/png;base64,${"A".repeat(100_000)}`,
        },
      ],
    };
    expect(messageCost(withImage)).toBe(1_000);
    const messages = [text("a", "user", MAX_HISTORY_CHARS - 1_000), withImage];
    expect(trimHistory(messages).map((m) => m.id)).toEqual(["a", "img"]);
  });

  it("avisa si recorta un adjunto de texto que comparte presupuesto con otras partes", () => {
    const message: UIMessage = {
      id: "mixed-text",
      role: "user",
      parts: [
        { type: "text", text: "instrucción previa ".repeat(500) },
        {
          type: "text",
          text: documentText("informe.txt", "y".repeat(MAX_DOCUMENT_CHARS + 10)),
        },
      ],
    };

    const [trimmed] = trimHistory([message]);
    const textContent = trimmed?.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");

    expect(messageCost(trimmed!)).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    expect(textContent).toContain("Archivo adjunto: informe.txt");
    expect(textContent).toContain("Uno o más adjuntos se recortaron u omitieron");
  });

  it("avisa si una imagen y un PDF se omiten por compartir presupuesto con texto", () => {
    const message: UIMessage = {
      id: "mixed-media",
      role: "user",
      parts: [
        { type: "text", text: "x".repeat(MAX_HISTORY_CHARS - 500) },
        { type: "file", mediaType: "image/png", url: "data:image/png;base64,abc" },
        { type: "file", mediaType: "application/pdf", url: "data:application/pdf;base64,def" },
      ],
    };

    const [trimmed] = trimHistory([message]);
    const textContent = trimmed?.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");

    expect(messageCost(trimmed!)).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    expect(trimmed?.parts.some((part) => part.type === "file")).toBe(false);
    expect(textContent).toContain("Uno o más adjuntos se recortaron u omitieron");
  });

  it("avisa cuando omite adjuntos de mensajes anteriores para conservar el actual", () => {
    const old: UIMessage = {
      id: "old-attachment",
      role: "user",
      parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,old" }],
    };

    const out = trimHistory([old, text("current", "user", MAX_HISTORY_CHARS)]);
    const current = out[0]!;
    const textContent = current.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");

    expect(out.map((message) => message.id)).toEqual(["current"]);
    expect(messageCost(current)).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    expect(textContent).toContain("adjuntos de mensajes anteriores");
  });

  it("no muestra un aviso de adjuntos parcial cuando solo quedan cinco caracteres", () => {
    const old: UIMessage = {
      id: "old-attachment",
      role: "user",
      parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,old" }],
    };

    const [current] = trimHistory([old, text("current", "user", 10)], 5);
    const textContent = current?.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");

    expect(messageCost(current!)).toBeLessThanOrEqual(5);
    expect(textContent).toBe("xxxxx");
    expect(textContent).not.toContain("\n[Se ");
    expect(textContent).not.toContain("\n[El ");
  });

  it("no cobra las partes de herramientas ni de razonamiento", () => {
    const m: UIMessage = {
      id: "t",
      role: "assistant",
      parts: [
        {
          type: "tool-web_search",
          toolCallId: "1",
          state: "output-available",
          input: { query: "x" },
          output: "y",
        } as UIMessage["parts"][number],
      ],
    };
    expect(messageCost(m)).toBe(0);
  });
});
