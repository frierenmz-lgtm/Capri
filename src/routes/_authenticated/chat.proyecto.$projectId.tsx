import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  FileText,
  FolderOpen,
  GraduationCap,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { ATTACH_ACCEPT, MAX_IMAGE_BYTES, MAX_IMAGES } from "@/lib/images";
import { createThread } from "@/lib/threads";
import {
  deleteProject,
  deleteProjectFile,
  projectQuery,
  projectThreadsQuery,
  renameProject,
  saveProjectInstructions,
  uploadProjectFiles,
  validateProjectFileUploads,
} from "@/lib/projects";
import { InstructionsDialog } from "@/components/instructions-dialog";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/chat/proyecto/$projectId")({
  head: () => ({
    meta: [
      { title: "Proyecto — Capri" },
      { name: "description", content: "Chats y archivos de un proyecto." },
    ],
  }),
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data } = useQuery(projectQuery(projectId));
  const { data: threads = [] } = useQuery(projectThreadsQuery(projectId));
  const project = data?.project ?? null;
  const files = data?.files ?? [];
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (project) setName(project.name);
  }, [project?.id, project?.name]);

  async function saveName() {
    if (!project || name.trim() === project.name || !name.trim()) {
      if (project) setName(project.name);
      return;
    }
    try {
      await renameProject(project.id, name);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["project", project.id] });
    } catch {
      toast.error("No se pudo renombrar el proyecto.");
      setName(project.name);
    }
  }

  async function removeProject() {
    if (!project) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deleteProject(project.id);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
      navigate({ to: "/chat", replace: true });
    } catch {
      toast.error("No se pudo borrar el proyecto.");
    }
  }

  async function newThread() {
    try {
      const id = await createThread(projectId);
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
      await queryClient.invalidateQueries({ queryKey: ["project-threads", projectId] });
      navigate({ to: "/chat/$threadId", params: { threadId: id } });
    } catch {
      toast.error("No se pudo crear la conversación.");
    }
  }

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const { accepted, issue } = validateProjectFileUploads(Array.from(list));
    if (issue) toast.error(issue.message);
    if (accepted.length === 0) {
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setUploading(true);
    try {
      const { uploaded, failed } = await uploadProjectFiles(projectId, accepted);
      if (failed.length > 0) {
        const failedNames = failed
          .map(({ file, error }) => `${file.name}: ${error.message}`)
          .join("; ");
        const keptNames =
          uploaded.length > 0
            ? `Sí quedaron subidos: ${uploaded.map((file) => file.name).join(", ")}.`
            : "No quedó ningún archivo subido.";
        toast.error(`Fallaron algunas cargas: ${failedNames}. ${keptNames}`);
      } else if (uploaded.length > 0) {
        toast.success(`Se subieron: ${uploaded.map((file) => file.name).join(", ")}.`);
      }
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  if (data && !project) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-lg font-medium">Proyecto no encontrado.</p>
        <Link to="/chat" className="mt-2 inline-block text-sm text-primary">
          Volver a las conversaciones
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-6">
      <Link to="/chat" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> Conversaciones
      </Link>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FolderOpen className="size-6 shrink-0 text-primary" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label="Nombre del proyecto"
            maxLength={80}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-2xl font-semibold outline-none focus-visible:border-input focus-visible:bg-background"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void removeProject()}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
          {confirmDelete ? "¿Borrar?" : "Borrar"}
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Las conversaciones de este proyecto usan sus instrucciones y sus archivos como contexto. Los
        archivos se leen en cada respuesta, hasta 4 archivos y 24,000 caracteres de texto por turno.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <InstructionsDialog
          title="Instrucciones del proyecto"
          description="Aplican a todas las conversaciones de este proyecto, salvo que una conversación tenga las suyas. Déjalo vacío para usar tus instrucciones generales."
          placeholder="Ej.: Este proyecto es mi tesis de ingeniería civil. Responde con referencias y pasos claros."
          examples={["Experto en el tema", "Respuestas con pasos", "Tono formal"]}
          value={project?.instructions ?? ""}
          onSave={async (next) => {
            await saveProjectInstructions(projectId, next);
            await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
            await queryClient.invalidateQueries({ queryKey: ["projects"] });
          }}
          trigger={
            <Button variant="outline" size="sm" className="gap-1.5">
              <SlidersHorizontal className="size-4" /> Instrucciones
              {project?.instructions && (
                <span className="size-1.5 rounded-full bg-primary" aria-label="Activas" />
              )}
            </Button>
          }
        />
        <Button variant="outline" size="sm" onClick={newThread} className="gap-1.5">
          <Plus className="size-4" /> Nueva conversación
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate({ to: "/estudio", search: { projectId } })}
          className="gap-1.5"
        >
          <GraduationCap className="size-4" /> Estudiar este proyecto
        </Button>
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Archivos
      </h2>
      <div className="mt-2">
        <input
          ref={fileInput}
          type="file"
          accept={ATTACH_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="gap-1.5"
        >
          <Upload className="size-4" /> {uploading ? "Subiendo…" : "Subir archivos"}
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">
          Imágenes, PDF y archivos de texto; hasta {MAX_IMAGES} por carga y{" "}
          {MAX_IMAGE_BYTES / (1024 * 1024)} MiB por archivo.
        </p>
      </div>
      <ul className="mt-3 space-y-1">
        {files.map((f) => (
          <li
            key={f.id}
            className="group flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          >
            <FileText className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <button
              type="button"
              aria-label={`Borrar ${f.name}`}
              onClick={async () => {
                try {
                  await deleteProjectFile(f);
                  await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
                } catch {
                  toast.error("No se pudo borrar el archivo.");
                }
              }}
              className="rounded p-1.5 text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {files.length === 0 && (
          <li className="flex flex-col items-center px-1 py-4 text-center">
            <Mascot state="lying" className="w-24" />
            <p className="mt-2 text-sm text-muted-foreground">Sin archivos todavía.</p>
          </li>
        )}
      </ul>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Conversaciones
      </h2>
      <ul className="mt-3 space-y-1">
        {threads.map((t) => (
          <li key={t.id}>
            <Link
              to="/chat/$threadId"
              params={{ threadId: t.id }}
              className="block truncate rounded-lg px-3 py-2 text-sm hover:bg-sidebar-accent/60"
            >
              {t.title}
            </Link>
          </li>
        ))}
        {threads.length === 0 && (
          <li className="flex flex-col items-center px-1 py-4 text-center">
            <Mascot state="standing" className="w-24" />
            <p className="mt-2 text-sm text-muted-foreground">Sin conversaciones todavía.</p>
          </li>
        )}
      </ul>
    </div>
  );
}
