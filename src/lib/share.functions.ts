import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { IMAGE_BUCKET, attachmentKind, imagePath } from "./images";

export type SharedPart =
  | { type: "text"; text: string }
  | { type: "image"; url: string | null }
  | { type: "document"; name: string; url: string | null }
  | { type: "source"; url: string; title: string | null };
export type SharedMessage = { id: string; role: "user" | "assistant"; parts: SharedPart[] };
export type SharedThread = { title: string; updated_at: string; messages: SharedMessage[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Public, read-only view of a conversation its owner chose to share. */
export const getSharedThread = createServerFn({ method: "GET" })
  .inputValidator((d: { shareId: string }) => {
    if (typeof d?.shareId !== "string" || !UUID.test(d.shareId)) throw new Error("Enlace no válido.");
    return { shareId: d.shareId.toLowerCase() };
  })
  .handler(async ({ data }): Promise<SharedThread | null> => {
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const sb = createClient<Database>(process.env["SUPABASE_URL"]!, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          headers.delete("Authorization");
          headers.set("apikey", key);
          return fetch(input, { ...init, headers });
        },
      },
    });
    const { data: row, error } = await sb.rpc("get_shared_thread", { p_share_id: data.shareId });
    if (error) {
      console.error("shared thread", error);
      throw new Error("No se pudo cargar la conversación.");
    }
    if (!row) return null;
    const raw = row as {
      title: string;
      updated_at: string;
      messages: {
        id: string;
        role: string;
        parts: { type: string; text?: string; url?: string; mediaType?: string; filename?: string; title?: string }[];
      }[];
    };

    // Only attachments inside this shared conversation get a short-lived link.
    const paths = new Set<string>();
    for (const m of raw.messages)
      for (const p of m.parts) {
        const path = p.type === "file" && p.url ? imagePath(p.url) : null;
        if (path) paths.add(path);
      }
    const signed = new Map<string, string>();
    if (paths.size) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: urls } = await supabaseAdmin.storage.from(IMAGE_BUCKET).createSignedUrls([...paths], 3600);
      for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }

    return {
      title: raw.title,
      updated_at: raw.updated_at,
      messages: raw.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          parts: m.parts.flatMap((p): SharedPart[] => {
            if (p.type === "text" && p.text) return [{ type: "text", text: p.text }];
            if (p.type === "file" && p.url) {
              const path = imagePath(p.url);
              const url = path ? (signed.get(path) ?? null) : null;
              const kind = attachmentKind(p.mediaType ?? "", p.filename);
              if (kind === "image") return [{ type: "image", url }];
              return [{ type: "document", name: p.filename ?? "Archivo", url }];
            }
            if (p.type === "source-url" && p.url && /^https?:\/\//.test(p.url)) {
              return [{ type: "source", url: p.url, title: p.title ?? null }];
            }
            return [];
          }),
        }))
        .filter((m) => m.parts.length > 0),
    };
  });
