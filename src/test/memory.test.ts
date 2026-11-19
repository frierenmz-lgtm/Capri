import { describe, expect, it } from "vitest";
import { selectRelevantMemories } from "@/lib/memory";

describe("Capri user memory", () => {
  const rows = [
    { category: "proyecto", content: "Capri es un asistente web conectado a IA en la nube.", updated_at: "2026-11-08" },
    { category: "preferencia", content: "Prefiero respuestas breves y directas.", updated_at: "2026-11-07" },
    { category: "objetivo", content: "Estoy aprendiendo inglés desde cero.", updated_at: "2026-11-06" },
  ];

  it("ranks memories that match the latest message first", () => {
    const result = selectRelevantMemories(rows, "Quiero seguir trabajando en Capri web");
    expect(result.split("\n")[0]).toContain("Capri es un asistente web");
  });

  it("falls back to recent memories when no terms match", () => {
    const result = selectRelevantMemories(rows, "xyzqv");
    expect(result).toContain("Capri es un asistente web");
    expect(result.split("\n")).toHaveLength(3);
  });

  it("returns no memory context when the user has not saved any", () => {
    expect(selectRelevantMemories([], "Capri")).toBe("");
  });
});
