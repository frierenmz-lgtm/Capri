import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { MIN_SEARCH } from "../../search";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_messages",
  title: "Search messages",
  description: "Find the user's Capri conversations whose messages contain a word or phrase (ignores case and accents).",
  inputSchema: {
    query: z.string().trim().min(MIN_SEARCH).max(200).describe("Word or phrase to look for."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated.");
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.rpc("search_messages", { q: query });
    if (error) throw new ToolError("Search failed.");
    const hits = (data ?? []).map((h) => ({
      conversation_id: h.thread_id,
      title: h.title,
      snippet: h.snippet,
      updated_at: h.updated_at,
    }));
    const text = hits.length
      ? hits.map((h) => `${h.conversation_id}: ${h.title}\n  …${h.snippet}…`).join("\n")
      : "No matches.";
    return { content: [{ type: "text", text }], structuredContent: { hits } };
  },
});
