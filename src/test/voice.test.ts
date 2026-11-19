import { describe, expect, it } from "vitest";
import { chunkText, speakableText } from "@/lib/voice";
import { MAX_SPEECH_CHARS } from "@/lib/voice-limits";

describe("read aloud", () => {
  it("splits long replies into pieces no longer than one voice request", () => {
    const text = "Esta es una oración bastante larga para probar. ".repeat(200);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(Array.from(c).length).toBeLessThanOrEqual(MAX_SPEECH_CHARS);
  });

  it("keeps every word when splitting", () => {
    const text = Array.from({ length: 400 }, (_, i) => `Palabra${i}.`).join(" ");
    const joined = chunkText(text).join(" ");
    expect(joined).toContain("Palabra0.");
    expect(joined).toContain("Palabra399.");
  });

  it("announces code blocks instead of reading them", () => {
    const out = speakableText("Usa esto:\n```python\nprint('hola')\n```\nListo.");
    expect(out).not.toContain("print");
    expect(out).toContain("bloque de código");
  });
});
