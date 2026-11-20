import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { oauthReturnPath } from "@/lib/oauth-return-path";
import { CapriMark } from "@/components/capri-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Capri" },
      { name: "description", content: "Inicia sesión o crea tu cuenta para chatear con Capri." },
      { property: "og:title", content: "Entrar — Capri" },
      { property: "og:description", content: "Inicia sesión o crea tu cuenta para chatear con Capri." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s["next"] === "string" ? { next: s["next"] } : {},
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  // Where to land after signing in: a validated return path (e.g. an app connection request) or the chat.
  const target = next ? oauthReturnPath(next) : "/chat";
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ href: target, replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) navigate({ href: target, replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate, target]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error("Correo o contraseña incorrectos.");
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: new URL(target, window.location.origin).href },
      });
      if (error) toast.error(error.message);
      else if (!data.session) toast.success("Revisa tu correo para confirmar tu cuenta.");
    }
    setBusy(false);
  }

  // Google login uses Supabase Auth directly. The previous Lovable OAuth
  // broker (/~oauth/initiate) only exists on Lovable's hosting, so it 404s
  // on Vercel. Requires the Google provider enabled in Supabase Auth.
  async function oauthGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: next
          ? new URL("/auth?next=" + encodeURIComponent(target), window.location.origin).href
          : window.location.origin + "/auth",
      },
    });
    if (error) toast.error("No se pudo iniciar sesión con Google.");
  }

  return (
    <main className="bg-sea flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <CapriMark className="size-14" />
          <h1 className="mt-4 text-3xl font-semibold">{mode === "in" ? "Bienvenido de vuelta" : "Crea tu cuenta"}</h1>
        </div>
        <div className="rounded-2xl border bg-card/80 p-6 backdrop-blur">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Correo</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy} className="bg-sun w-full rounded-full">
              {mode === "in" ? "Entrar" : "Registrarme"}
            </Button>
          </form>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> o <div className="h-px flex-1 bg-border" />
          </div>
          <div className="space-y-3">
            <Button variant="outline" className="w-full rounded-full" onClick={oauthGoogle}>
              Continuar con Google
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="mt-6 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === "in" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Entra"}
        </button>
      </div>
    </main>
  );
}
