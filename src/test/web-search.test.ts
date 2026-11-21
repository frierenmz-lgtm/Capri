import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebSearchTool, searchWeb } from "@/lib/web-search";

const KEY = "tvly-test-key";

function stubFetch(response: { ok: boolean; status: number; json: unknown }) {
  return vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: response.ok,
      status: response.status,
      json: async () => response.json,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("searchWeb", () => {
  it("devuelve título, URL y fragmento recortados, como mucho cinco resultados", async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: {
        results: Array.from({ length: 7 }, (_, i) => ({
          title: `Noticia ${i}`,
          url: `https://ejemplo.com/${i}`,
          content: "x".repeat(800),
        })),
      },
    });
    const out = await searchWeb("clima hoy", KEY);
    expect("results" in out && out.results.length).toBe(5);
    if (!("results" in out)) return;
    expect(out.results[0]).toEqual({ title: "Noticia 0", url: "https://ejemplo.com/0", snippet: "x".repeat(500) });
  });

  it("descarta resultados sin URL http", async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: { results: [{ title: "Raro", url: "ftp://ejemplo.com", content: "nada" }] },
    });
    const out = await searchWeb("algo", KEY);
    expect(out).toEqual({ results: [] });
  });

  it("avisa cuando no hay clave configurada", async () => {
    const out = await searchWeb("algo", undefined);
    expect(out).toEqual({ error: "La búsqueda web no está configurada todavía." });
  });

  it("avisa cuando la consulta está vacía", async () => {
    const out = await searchWeb("   ", KEY);
    expect(out).toEqual({ error: "La búsqueda está vacía." });
  });

  it("traduce 401 y 429 a mensajes claros", async () => {
    stubFetch({ ok: false, status: 401, json: {} });
    expect(await searchWeb("algo", KEY)).toEqual({ error: "La clave de búsqueda no es válida." });
    stubFetch({ ok: false, status: 429, json: {} });
    expect(await searchWeb("algo", KEY)).toEqual({ error: "Se alcanzó el límite de búsquedas. Inténtalo más tarde." });
  });

  it("no lanza cuando la red falla", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("red caída");
    }));
    const out = await searchWeb("algo", KEY);
    expect(out).toEqual({ error: "No se pudo conectar con el buscador. Inténtalo de nuevo." });
  });
});

describe("createWebSearchTool", () => {
  it("expone una herramienta web_search que ejecuta la búsqueda", async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: { results: [{ title: "T", url: "https://ejemplo.com", content: "c" }] },
    });
    const tool = createWebSearchTool(KEY) as unknown as {
      description: string;
      execute: (input: { query: string }) => Promise<unknown>;
    };
    expect(tool.description).toContain("web");
    expect(await tool.execute({ query: "algo" })).toEqual({
      results: [{ title: "T", url: "https://ejemplo.com", snippet: "c" }],
    });
  });
});
