import { createFileRoute, Link } from "@tanstack/react-router";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Capri — asistente de IA en español" },
      { name: "description", content: "Conversa con Capri: respuestas breves y útiles, guardadas en tu cuenta." },
      { property: "og:title", content: "Capri — asistente de IA en español" },
      { property: "og:description", content: "Conversa con Capri: respuestas breves y útiles, guardadas en tu cuenta." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="bg-sea flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Mascot className="w-40" />
      <h1 className="mt-6 text-5xl font-semibold tracking-tight sm:text-6xl">Capri</h1>
      <p className="mt-4 max-w-sm text-lg text-muted-foreground">
        Tu asistente breve y útil. Pregunta lo que quieras, en español.
      </p>
      <Button asChild size="lg" className="bg-sun shadow-glow mt-10 rounded-full px-10 text-base">
        <Link to="/chat">Empezar a chatear</Link>
      </Button>
      <p className="mt-6 text-sm text-muted-foreground">Tus conversaciones se guardan en tu cuenta.</p>
    </main>
  );
}
