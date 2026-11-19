import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });

export function userClient(token: string) {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("apikey", key);
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

export type UserClient = ReturnType<typeof userClient>;

/** Verifies the bearer token; returns the signed-in user's client or an error response. */
export async function authenticate(
  request: Request,
): Promise<{ supabase: UserClient; userId: string } | { error: Response }> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: json(401, "Inicia sesión para continuar.") };
  const supabase = userClient(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { error: json(401, "Sesión no válida.") };
  return { supabase, userId: data.user.id };
}
