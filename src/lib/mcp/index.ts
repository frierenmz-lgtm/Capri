import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listConversations from "./tools/list-conversations";
import readConversation from "./tools/read-conversation";
import searchMessages from "./tools/search-messages";

// Vite inlines the stable ref; the published SUPABASE_URL may be a proxy.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "capri-ai",
  title: "Capri Ai",
  version: "0.1.0",
  instructions:
    "Read-only access to the signed-in user's conversations with Capri, their AI assistant. Use `list_conversations` to browse, `search_messages` to find a topic, and `read_conversation` to read one.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listConversations, searchMessages, readConversation],
});
