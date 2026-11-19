import { describe, expect, it } from "vitest";
import { MIN_SEARCH, matchesTerm, messageSearchQuery, splitHighlight } from "@/lib/search";

describe("deep search", () => {
  it("does not search message content with fewer than 2 characters", () => {
    expect(MIN_SEARCH).toBe(2);
    expect(messageSearchQuery("a").enabled).toBe(false);
    expect(messageSearchQuery("pa").enabled).toBe(true);
  });

  it("highlights every match regardless of case", () => {
    expect(splitHighlight("Pan casero y más pan", "pan")).toEqual([
      { text: "Pan", match: true },
      { text: " casero y más ", match: false },
      { text: "pan", match: true },
    ]);
  });

  it("treats special characters in the query literally", () => {
    expect(splitHighlight("usa a.b o axb", "a.b")).toEqual([
      { text: "usa ", match: false },
      { text: "a.b", match: true },
      { text: " o axb", match: false },
    ]);
  });
});

describe("accent-insensitive search", () => {
  it("finds words written without accents", () => {
    expect(matchesTerm("Mi canción favorita", "cancion")).toBe(true);
    expect(matchesTerm("Hablemos del corazón", "CORAZON")).toBe(true);
    expect(matchesTerm("Hablemos del corazón", "cerebro")).toBe(false);
  });

  it("highlights the accented word when typed without accents", () => {
    expect(splitHighlight("Una canción y otra cancion", "cancion")).toEqual([
      { text: "Una ", match: false },
      { text: "canción", match: true },
      { text: " y otra ", match: false },
      { text: "cancion", match: true },
    ]);
  });
});

import { stripMarkdown } from "@/lib/search";
describe("snippet cleanup", () => {
  it("removes Markdown symbols from snippets", () => {
    expect(stripMarkdown("4. **Los huevos:** fríelos ### Paso `sal` [receta](http://x.y)")).toBe(
      "4. Los huevos: fríelos Paso sal receta",
    );
  });
});
