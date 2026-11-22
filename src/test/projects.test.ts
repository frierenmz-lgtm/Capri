import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/instructions";
import {
  budgetProjectTexts,
  pickFallbackInstructions,
  projectFileText,
  selectProjectFiles,
} from "@/lib/project-context";

const file = (name: string, created_at: string) => ({ name, created_at });

describe("project files in context", () => {
  it("keeps the most recent files, at most 4", () => {
    const files = [
      file("a.txt", "2026-01-01T00:00:00Z"),
      file("b.txt", "2026-01-02T00:00:00Z"),
      file("c.txt", "2026-01-03T00:00:00Z"),
      file("d.txt", "2026-01-04T00:00:00Z"),
      file("e.txt", "2026-01-05T00:00:00Z"),
    ];
    expect(selectProjectFiles(files).map((f) => f.name)).toEqual(["e.txt", "d.txt", "c.txt", "b.txt"]);
  });

  it("shares the text budget across files and cuts the rest", () => {
    const out = budgetProjectTexts(
      [
        { name: "a.txt", text: "x".repeat(100) },
        { name: "b.txt", text: "y".repeat(100) },
      ],
      150,
    );
    expect(out[0]).toEqual({ name: "a.txt", text: "x".repeat(100), cut: false });
    expect(out[1]).toEqual({ name: "b.txt", text: "y".repeat(50), cut: true });
  });

  it("drops files once the budget is spent", () => {
    const out = budgetProjectTexts(
      [
        { name: "a.txt", text: "x".repeat(10) },
        { name: "b.txt", text: "y".repeat(10) },
      ],
      10,
    );
    expect(out[1]).toEqual({ name: "b.txt", text: "", cut: true });
  });

  it("formats a project file as an attached document", () => {
    expect(projectFileText("apuntes.txt", "hola")).toContain("Archivo adjunto: apuntes.txt");
  });
});

describe("project instructions precedence", () => {
  it("uses the project instructions instead of the account default", () => {
    expect(pickFallbackInstructions("Instrucciones del proyecto", "Generales")).toBe("Instrucciones del proyecto");
  });

  it("falls back to the account default when the project has none", () => {
    expect(pickFallbackInstructions("   ", "Generales")).toBe("Generales");
  });

  it("lets the thread instructions win over the project ones", () => {
    const fallback = pickFallbackInstructions("Del proyecto", "Generales");
    const prompt = buildSystemPrompt("De la conversación", fallback);
    expect(prompt).toContain("De la conversación");
    expect(prompt).not.toContain("Del proyecto");
  });
});
