import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { GraduationCap, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { projectsQuery } from "@/lib/projects";
import { deleteQuiz, generateQuiz, quizzesQuery, QUIZ_COUNTS } from "@/lib/study";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/estudio")({
  // projectId is optional: links to /estudio without a search stay valid.
  validateSearch: (search: Record<string, unknown>): { projectId?: string } => {
    const projectId = search["projectId"];
    return typeof projectId === "string" ? { projectId } : {};
  },
  head: () => ({
    meta: [{ title: "Modo estudio — Capri" }, { name: "description", content: "Cuestionarios generados de tus archivos y temas." }],
  }),
  component: StudyPage,
});

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function StudyPage() {
  const { projectId: initialProjectId } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useQuery(projectsQuery);
  const { data: quizzes = [] } = useQuery(quizzesQuery);
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState<5 | 10>(5);
  const [generating, setGenerating] = useState(false);
  const project = projects.find((p) => p.id === projectId);
  const title = project ? project.name : topic.trim();

  async function create() {
    if (!title) {
      toast.error("Elige un proyecto o escribe un tema.");
      return;
    }
    setGenerating(true);
    try {
      const quizId = await generateQuiz({ projectId: projectId || null, topic, count });
      await queryClient.invalidateQueries({ queryKey: ["study-quizzes"] });
      navigate({ to: "/estudio/$quizId", params: { quizId } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-6">
      <div className="flex items-center gap-2">
        <GraduationCap className="size-6 text-primary" />
        <h1 className="text-2xl font-semibold">Modo estudio</h1>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Capri genera un cuestionario de opción múltiple a partir de los archivos de texto de un proyecto o de un
        tema que escribas. Respondes una pregunta a la vez y al final ves tu puntaje con explicaciones.
      </p>

      <div className="mt-6 space-y-3 rounded-xl border p-4">
        <div>
          <label htmlFor="study-project" className="text-sm font-medium">
            Proyecto
          </label>
          <select
            id="study-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">Sin proyecto: por tema</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {project && (
            <p className="mt-1 text-xs text-muted-foreground">
              Usa los archivos de texto del proyecto (.txt, .md). Las imágenes y PDF no entran en el cuestionario.
            </p>
          )}
        </div>
        {!project && (
          <div>
            <label htmlFor="study-topic" className="text-sm font-medium">
              Tema
            </label>
            <input
              id="study-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ej.: Teorema de Pitágoras, fotosíntesis, historia de México"
              maxLength={200}
              className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}
        <div>
          <label htmlFor="study-count" className="text-sm font-medium">
            Preguntas
          </label>
          <select
            id="study-count"
            value={count}
            onChange={(e) => setCount(Number(e.target.value) as 5 | 10)}
            className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm"
          >
            {QUIZ_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n} preguntas
              </option>
            ))}
          </select>
        </div>
        <Button onClick={() => void create()} disabled={generating} className="gap-1.5">
          {generating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {generating ? "Generando…" : "Generar cuestionario"}
        </Button>
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-muted-foreground">Cuestionarios</h2>
      <ul className="mt-3 space-y-1">
        {quizzes.map((q) => (
          <li
            key={q.id}
            className="group flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-sidebar-accent/60"
          >
            <Link to="/estudio/$quizId" params={{ quizId: q.id }} className="min-w-0 flex-1">
              <span className="block truncate font-medium">{q.topic}</span>
              <span className="text-xs text-muted-foreground">
                {formatDate(q.created_at)} · {q.question_count} preguntas
                {q.score !== null ? ` · Puntaje ${q.score}/${q.question_count}` : " · Sin terminar"}
              </span>
            </Link>
            <button
              type="button"
              aria-label={`Borrar ${q.topic}`}
              onClick={async () => {
                try {
                  await deleteQuiz(q.id);
                  await queryClient.invalidateQueries({ queryKey: ["study-quizzes"] });
                } catch {
                  toast.error("No se pudo borrar el cuestionario.");
                }
              }}
              className="rounded p-1.5 text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {quizzes.length === 0 && (
          <li className="px-1 py-2 text-sm text-muted-foreground">Sin cuestionarios todavía.</li>
        )}
      </ul>
    </div>
  );
}
