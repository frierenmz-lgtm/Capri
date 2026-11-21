import { tool } from "ai";
import { z } from "zod";

/**
 * Web search for Capri, backed by Tavily (free Researcher plan: 1,000 basic
 * searches a month, no card). The model calls this tool when the question
 * needs current information; the UI already shows a "Buscando en la web…"
 * indicator for the `tool-web_search` part and renders `source-url` parts
 * as Fuentes chips.
 */

export const WEB_SEARCH_TOOL_NAME = "web_search";
const TAVILY_URL = "https://api.tavily.com/search";
const MAX_RESULTS = 5;
const MAX_SNIPPET_CHARS = 500;
const SEARCH_TIMEOUT_MS = 15_000;

export type WebSearchResult = { title: string; url: string; snippet: string };
export type WebSearchOutput = { results: WebSearchResult[] } | { error: string };

type TavilyResponse = {
  results?: Array<{ title?: string; url?: string; content?: string }>;
};

/** One Tavily search. Returns an error object instead of throwing, so the model can answer gracefully. */
export async function searchWeb(query: string, apiKey: string | undefined): Promise<WebSearchOutput> {
  const q = query.trim();
  if (!q) return { error: "La búsqueda está vacía." };
  if (!apiKey) return { error: "La búsqueda web no está configurada todavía." };
  let res: Response;
  try {
    res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: q,
        search_depth: "basic",
        max_results: MAX_RESULTS,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  } catch {
    return { error: "No se pudo conectar con el buscador. Inténtalo de nuevo." };
  }
  if (!res.ok) {
    if (res.status === 401) return { error: "La clave de búsqueda no es válida." };
    if (res.status === 429) return { error: "Se alcanzó el límite de búsquedas. Inténtalo más tarde." };
    return { error: `La búsqueda falló (código ${res.status}). Inténtalo de nuevo.` };
  }
  const data = (await res.json()) as TavilyResponse;
  const results = (data.results ?? [])
    .filter((r) => typeof r.url === "string" && r.url.startsWith("http"))
    .slice(0, MAX_RESULTS)
    .map((r) => ({
      title: (r.title ?? r.url ?? "").trim().slice(0, 200),
      url: r.url as string,
      snippet: (r.content ?? "").trim().slice(0, MAX_SNIPPET_CHARS),
    }));
  return { results };
}

/** The `web_search` tool for `streamText`. The name must stay `web_search`: the chat UI keys its searching indicator on the `tool-web_search` part. */
export function createWebSearchTool(apiKey: string | undefined) {
  return tool({
    description:
      "Busca información actual en la web: noticias, precios, clima, resultados deportivos, estrenos y cualquier dato reciente o que no sepas con seguridad. Usa la pregunta del usuario tal cual; si está en español, busca en español. Cita las URLs de los resultados al responder.",
    inputSchema: z.object({
      query: z.string().min(2).max(500).describe("La pregunta o tema a buscar en la web."),
    }),
    execute: async ({ query }) => searchWeb(query, apiKey),
  });
}
