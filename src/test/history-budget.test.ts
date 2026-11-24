import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { MAX_HISTORY_CHARS, messageCost, trimHistory } from "@/lib/history-budget";

const text = (id: string, role: UIMessage["role"], chars: number): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text: "x".repeat(chars) }],
});

describe("trimHistory", () => {
  it("conserva solo los mensajes recientes que caben en el presupuesto", () => {
    const messages = [text("a", "user", 6_000), text("b", "assistant", 6_000), text("c", "user", 6_000)];
    const out = trimHistory(messages);
    expect(out.map((m) => m.id)).toEqual(["b", "c"]);
  });

  it("siempre conserva el último mensaje aunque supere el presupuesto", () => {
    const messages = [text("a", "user", 100), text("b", "assistant", MAX_HISTORY_CHARS + 5_000)];
    const out = trimHistory(messages);
    expect(out.map((m) => m.id)).toEqual(["b"]);
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
      parts: [{ type: "file", mediaType: "image/png", url: `data:image/png;base64,${"A".repeat(100_000)}` }],
    };
    expect(messageCost(withImage)).toBe(1_000);
    const messages = [text("a", "user", MAX_HISTORY_CHARS - 1_000), withImage];
    expect(trimHistory(messages).map((m) => m.id)).toEqual(["a", "img"]);
  });

  it("no cobra las partes de herramientas ni de razonamiento", () => {
    const m: UIMessage = {
      id: "t",
      role: "assistant",
      parts: [{ type: "tool-web_search", toolCallId: "1", state: "output-available", input: { query: "x" }, output: "y" } as UIMessage["parts"][number]],
    };
    expect(messageCost(m)).toBe(0);
  });
});
