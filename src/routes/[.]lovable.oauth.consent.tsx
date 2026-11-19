import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CapriMark } from "@/components/capri-mark";
import { Button } from "@/components/ui/button";

type AuthorizationDetails = {
  client?: { name?: string; client_name?: string; uri?: string; redirect_uri?: string } | null;
  redirect_uri?: string;
  scope?: string;
  user?: { email?: string } | null;
  redirect_url?: string;
  redirect_to?: string;
};
type OAuthResult = { data: AuthorizationDetails | null; error: { message: string } | null };
// The beta auth.oauth namespace may be missing from the client's types.
const oauth = () =>
  (supabase.auth as unknown as {
    oauth: {
      getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
      approveAuthorization: (id: string) => Promise<OAuthResult>;
      denyAuthorization: (id: string) => Promise<OAuthResult>;
    };
  }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // SSR has no browser session and would redirect signed-in users.
  ssr: false,
  head: () => ({
    meta: [
      { title: "Conectar una app — Capri" },
      { name: "description", content: "Autoriza a una app externa a leer tus conversaciones con Capri." },
      { property: "og:title", content: "Conectar una app — Capri" },
      { property: "og:description", content: "Autoriza a una app externa a leer tus conversaciones con Capri." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s["authorization_id"] === "string" ? s["authorization_id"] : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Falta el identificador de la solicitud.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth", search: { next: location.pathname + location.searchStr } });
    return { email: data.session.user.email ?? "" };
  },
  loaderDeps: ({ search }) => ({ id: search.authorization_id }),
  loader: async ({ deps }) => {
    const { data, error } = await oauth().getAuthorizationDetails(deps.id);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  pendingComponent: () => (
    <Shell>
      <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
    </Shell>
  ),
  errorComponent: ({ error }) => (
    <Shell>
      <h1 className="text-2xl font-semibold">No se pudo abrir esta solicitud</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Puede que haya caducado. Vuelve a la app que te trajo aquí e inténtalo de nuevo.
      </p>
      <p className="mt-3 text-xs text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
    </Shell>
  ),
  component: Consent,
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-sea flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-md rounded-2xl border bg-card/80 p-6 text-center backdrop-blur">
        <CapriMark className="mx-auto mb-5 size-12" />
        {children}
      </div>
    </main>
  );
}

const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirmar tu identidad",
  email: "Ver tu correo",
  profile: "Ver tu perfil básico",
};

function Consent() {
  const details = Route.useLoaderData();
  const { email } = Route.useRouteContext();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = details?.client?.name ?? details?.client?.client_name ?? "Una app";
  const redirectUri = details?.redirect_uri ?? details?.client?.redirect_uri;
  const host = redirectUri ? safeHost(redirectUri) : null;
  const scopes = (details?.scope ?? "").split(/\s+/).filter(Boolean);

  async function decide(approve: boolean) {
    setBusy(approve ? "approve" : "deny");
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    const target = data?.redirect_url ?? data?.redirect_to;
    if (error || !target) {
      setBusy(null);
      setError(error?.message ?? "El servidor no devolvió a dónde continuar. Inténtalo de nuevo.");
      return;
    }
    window.location.href = target;
  }

  return (
    <Shell>
      <h1 className="text-2xl font-semibold">Conectar {client} a Capri</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {client} podrá leer y buscar tus conversaciones con Capri en tu nombre. No podrá escribir, borrar ni compartir nada.
      </p>
      <div className="mt-5 space-y-2 rounded-xl border bg-background/40 p-4 text-left text-sm">
        <p><span className="text-muted-foreground">Cuenta:</span> {email}</p>
        {host && <p><span className="text-muted-foreground">Regresa a:</span> {host}</p>}
        {scopes.length > 0 && (
          <ul className="space-y-1 pt-1">
            {scopes.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" />
                {SCOPE_LABELS[s] ?? `Permiso adicional: ${s}`}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Solo verá lo tuyo: los permisos de Capri siguen aplicando.</p>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      <div className="mt-6 flex flex-col gap-3">
        <Button className="bg-sun w-full rounded-full" disabled={busy !== null} onClick={() => decide(true)}>
          {busy === "approve" && <Loader2 className="size-4 animate-spin" />} Permitir
        </Button>
        <Button variant="outline" className="w-full rounded-full" disabled={busy !== null} onClick={() => decide(false)}>
          {busy === "deny" && <Loader2 className="size-4 animate-spin" />} Cancelar conexión
        </Button>
      </div>
    </Shell>
  );
}

function safeHost(uri: string) {
  try {
    return new URL(uri).host || uri;
  } catch {
    return uri;
  }
}
