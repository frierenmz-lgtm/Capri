import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { FileText, Globe } from "lucide-react";
import { KiriAvatar, Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { getSharedThread, type SharedPart } from "@/lib/share.functions";

export const Route = createFileRoute("/s/$shareId")({
  ssr: "data-only",
  loader: async ({ params }) => {
    const thread = await getSharedThread({ data: { shareId: params.shareId } }).catch(() => null);
    if (!thread) throw notFound();
    return thread;
  },
  head: ({ loaderData }) => {
    const title = loaderData ? `${loaderData.title} — Conversación con Capri` : "Conversación compartida — Capri";
    const description = "Una conversación con Capri, tu asistente de IA en español, compartida en modo solo lectura.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary" },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  notFoundComponent: SharedNotFound,
  component: SharedPage,
});

function SharedPage() {
  const thread = Route.useLoaderData();
  const date = new Date(thread.updated_at).toLocaleDateString("es-MX", { dateStyle: "long" });
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <KiriAvatar className="size-7 shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg font-semibold">{thread.title}</h1>
            <p className="text-xs text-muted-foreground">Conversación compartida · {date}</p>
          </div>
          <Button asChild size="sm" className="bg-sun shrink-0 rounded-full">
            <Link to="/chat">Probar Capri</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
        {thread.messages.map((m) => (
          <Message key={m.id} from={m.role}>
            <MessageContent>
              {m.parts.some((p) => p.type === "image" || p.type === "document") && (
                <div className="flex flex-wrap gap-2">
                  {m.parts.map((p, i) =>
                    p.type === "image" ? (
                      p.url ? (
                        <img key={i} src={p.url} alt="Imagen adjunta" className="max-h-60 max-w-60 rounded-lg object-cover" />
                      ) : (
                        <div key={i} className="flex size-28 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                          Imagen
                        </div>
                      )
                    ) : p.type === "document" ? (
                      <a
                        key={i}
                        href={p.url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-11 max-w-64 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-card-foreground"
                      >
                        <FileText className="size-5 shrink-0 text-primary" />
                        <span className="min-w-0 truncate">{p.name}</span>
                      </a>
                    ) : null,
                  )}
                </div>
              )}
              {m.parts.map((p, i) =>
                p.type === "text" ? (
                  m.role === "user" ? (
                    <p key={i} className="whitespace-pre-wrap">
                      {p.text}
                    </p>
                  ) : (
                    <MessageResponse key={i}>{p.text}</MessageResponse>
                  )
                ) : null,
              )}
              {m.parts.some((p) => p.type === "source") && (
                <div className="mt-1 flex flex-wrap gap-1.5 border-t pt-2">
                  {uniqueSources(m.parts).map((p, i) =>
                    p.type === "source" ? (
                      <a
                        key={i}
                        href={p.url}
                        target="_blank"
                        rel="noreferrer nofollow"
                        title={p.title ?? p.url}
                        className="flex max-w-56 items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Globe className="size-3 shrink-0" />
                        <span className="truncate">{hostOf(p.url)}</span>
                      </a>
                    ) : null,
                  )}
                </div>
              )}
            </MessageContent>
          </Message>
        ))}
        {thread.messages.length === 0 && (
          <p className="py-20 text-center text-muted-foreground">Esta conversación todavía no tiene mensajes.</p>
        )}
      </main>
      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        Solo lectura · Creado con Capri
      </footer>
    </div>
  );
}

function SharedNotFound() {
  return (
    <main className="bg-sea flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Mascot state="confused" className="w-14" />
      <h1 className="mt-6 font-display text-3xl font-semibold">Enlace no disponible</h1>
      <p className="mt-3 max-w-sm text-muted-foreground">
        Esta conversación ya no se comparte o el enlace es incorrecto.
      </p>
      <Button asChild className="bg-sun mt-8 rounded-full px-8">
        <Link to="/">Ir a Capri</Link>
      </Button>
    </main>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function uniqueSources(parts: SharedPart[]) {
  const seen = new Set<string>();
  return parts
    .filter((p) => {
      if (p.type !== "source") return false;
      const host = hostOf(p.url);
      if (seen.has(host)) return false;
      seen.add(host);
      return true;
    })
    .slice(0, 6);
}
