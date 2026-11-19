import { queryOptions } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";

export type Thread = { id: string; title: string; updated_at: string };

export const threadsQuery = queryOptions({
  queryKey: ["threads"],
  queryFn: async (): Promise<Thread[]> => {
    const { data, error } = await supabase
      .from("threads")
      .select("id,title,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data;
  },
});

export const messagesQuery = (threadId: string) =>
  queryOptions({
    queryKey: ["messages", threadId],
    queryFn: async (): Promise<UIMessage[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("message_id,role,parts")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data.map((m) => ({
        id: m.message_id,
        role: m.role as UIMessage["role"],
        parts: m.parts as UIMessage["parts"],
      }));
    },
    staleTime: Infinity,
  });

export async function createThread(): Promise<string> {
  const { data, error } = await supabase.from("threads").insert({}).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function deleteThread(id: string) {
  const { error } = await supabase.from("threads").delete().eq("id", id);
  if (error) throw error;
}

export const threadQuery = (threadId: string) =>
  queryOptions({
    queryKey: ["thread", threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("threads")
        .select("id,title,custom_instructions,share_id")
        .eq("id", threadId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export async function saveThreadInstructions(threadId: string, value: string) {
  const { error } = await supabase.from("threads").update({ custom_instructions: value }).eq("id", threadId);
  if (error) throw error;
}

export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: async () => {
    const { data, error } = await supabase.from("user_settings").select("default_instructions").maybeSingle();
    if (error) throw error;
    return { default_instructions: data?.default_instructions ?? "" };
  },
});

export async function saveDefaultInstructions(value: string) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("No session");
  const { error } = await supabase
    .from("user_settings")
    .upsert(
      { user_id: auth.user.id, default_instructions: value, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

/** Turns the public read-only link on (new random id) or off (null). */
export async function setThreadShare(threadId: string, on: boolean): Promise<string | null> {
  const share_id = on ? crypto.randomUUID() : null;
  const { error } = await supabase.from("threads").update({ share_id }).eq("id", threadId);
  if (error) throw error;
  return share_id;
}
