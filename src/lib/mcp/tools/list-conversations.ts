import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_conversations",
  title: "List conversations",
  description: "List the signed-in user's Capri conversations, most recently active first.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().describe("How many conversations to return (default 30)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated.");
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("threads")
      .select("id,title,updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit ?? 30);
    if (error) throw new ToolError("Could not load conversations.");
    const conversations = (data ?? []).map((t) => ({ id: t.id, title: t.title, updated_at: t.updated_at }));
    const text = conversations.length
      ? conversations.map((c) => `${c.id}: ${c.title} (${c.updated_at})`).join("\n")
      : "No conversations yet.";
    return { content: [{ type: "text", text }], structuredContent: { conversations } };
  },
});
