import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { partsText, supabaseForUser } from "../supabase";

export default defineTool({
  name: "read_conversation",
  title: "Read conversation",
  description: "Read the messages of one of the user's Capri conversations by its id.",
  inputSchema: {
    conversation_id: z.string().uuid().describe("Conversation id from list_conversations or search_messages."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ conversation_id }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated.");
    const supabase = supabaseForUser(ctx);
    const { data: thread, error: threadError } = await supabase
      .from("threads")
      .select("id,title,updated_at")
      .eq("id", conversation_id)
      .maybeSingle();
    if (threadError) throw new ToolError("Could not load the conversation.");
    if (!thread) throw new ToolError("Conversation not found.");
    const { data, error } = await supabase
      .from("messages")
      .select("role,parts,created_at")
      .eq("thread_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new ToolError("Could not load the messages.");
    const messages = (data ?? []).map((m) => ({ role: m.role, text: partsText(m.parts), created_at: m.created_at }));
    const text =
      `# ${thread.title}\n\n` +
      (messages.length
        ? messages.map((m) => `${m.role === "user" ? "User" : "Capri"}: ${m.text}`).join("\n\n")
        : "No messages yet.");
    return {
      content: [{ type: "text", text }],
      structuredContent: { conversation: { id: thread.id, title: thread.title, updated_at: thread.updated_at, messages } },
    };
  },
});
