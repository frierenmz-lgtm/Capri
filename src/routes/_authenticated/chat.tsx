import { createFileRoute, Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { GraduationCap, Loader2, Folder, FolderPlus, Menu, Pin, Plus, Search, Settings, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createThread, deleteThread, saveDefaultInstructions, saveThreadPinned, settingsQuery, splitPinned, threadsQuery, type Thread } from "@/lib/threads";
import { createProject, deleteProject, projectsQuery } from "@/lib/projects";
import { MIN_SEARCH, matchesTerm, messageSearchQuery, splitHighlight, stripMarkdown } from "@/lib/search";
import { CapriMark } from "@/components/capri-mark";
import { InstructionsDialog } from "@/components/instructions-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWebMCP } from "use-webmcp-tool";
import { runWebMCPTool } from "@/lib/webmcp-telemetry";

function Highlight({ text, term }: { text: string; term: string }) {
  return (
    <>
      {splitHighlight(text, term).map((c, i) =>
        c.match ? (
          <mark key={i} className="rounded-sm bg-primary/30 px-0.5 text-foreground">
            {c.text}
          </mark>
        ) : (
          <span key={i}>{c.text}</span>
        ),
      )}
    </>
  );
}

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "Chat — Capri" },
      { name: "description", content: "Tus conversaciones con Capri." },
      { property: "og:title", content: "Chat — Capri" },
      { property: "og:description", content: "Tus conversaciones con Capri." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChatLayout,
});

function ChatLayout() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams({ strict: false }) as { threadId?: string; projectId?: string };
  const { data: threads = [] } = useQuery(threadsQuery);
  const { data: projects = [] } = useQuery(projectsQuery);
  const [newProject, setNewProject] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<string | null>(null);
  const { data: settings } = useQuery(settingsQuery);
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const visible = q ? threads.filter((t) => matchesTerm(t.title, q)) : threads;
  const { pinned, rest } = splitPinned(visible);
  const [deepTerm, setDeepTerm] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDeepTerm(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const deepActive = q.length >= MIN_SEARCH && deepTerm.length >= MIN_SEARCH;
  const deep = useQuery({ ...messageSearchQuery(deepTerm), placeholderData: keepPreviousData });
  const titleIds = new Set(visible.map((t) => t.id));
  const messageHits = deepActive ? (deep.data ?? []).filter((h) => !titleIds.has(h.thread_id)) : [];

  function openThread(id: string) {
    const thread = visible.find((t) => t.id === id) ?? messageHits.find((h) => h.thread_id === id);
    if (!thread) throw new Error("That conversation is not in the list shown.");
    setOpen(false);
    navigate({ to: "/chat/$threadId", params: { threadId: id } });
    return `Opened "${thread.title}".`;
  }

  useWebMCP({
    name: "list_conversations",
    description: "List the conversations shown in the sidebar (respecting the current search), with their ids.",
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: () =>
      runWebMCPTool("list_conversations", () => {
        const lines = [
          ...visible.map((t) => `${t.id}: ${t.title}`),
          ...messageHits.map((h) => `${h.thread_id}: ${h.title} (match in messages)`),
        ];
        return lines.length ? lines.join("\n") : "No conversations shown.";
      }),
  });

  useWebMCP({
    name: "search_conversations",
    description: "Type a search into the sidebar to filter conversations by title and message content. Use an empty string to clear it.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Text to search for; empty clears the search." } },
      required: ["query"],
    },
    execute: ({ query }: { query: string }) =>
      runWebMCPTool("search_conversations", () => {
        if (typeof query !== "string") throw new Error("query must be a string.");
        setSearch(query);
        return query ? `Searching for "${query}".` : "Search cleared.";
      }),
  });

  useWebMCP({
    name: "open_conversation",
    description: "Open one of the conversations listed in the sidebar by its id.",
    annotations: { untrustedContentHint: true },
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Conversation id from list_conversations." } },
      required: ["id"],
    },
    execute: ({ id }: { id: string }) => runWebMCPTool("open_conversation", () => openThread(id)),
  });

  async function createNewProject() {
    const name = newProject.trim();
    if (!name) return;
    try {
      const id = await createProject(name);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setNewProject("");
      setCreatingProject(false);
      setOpen(false);
      navigate({ to: "/chat/proyecto/$projectId", params: { projectId: id } });
    } catch {
      toast.error("No se pudo crear el proyecto.");
    }
  }

  async function removeProject(id: string) {
    if (confirmDeleteProject !== id) {
      setConfirmDeleteProject(id);
      return;
    }
    try {
      await deleteProject(id);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
      setConfirmDeleteProject(null);
      if (params.projectId === id) navigate({ to: "/chat", replace: true });
    } catch {
      toast.error("No se pudo borrar el proyecto.");
    }
  }

  async function newThread() {
    try {
      const id = await createThread();
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
      setOpen(false);
      navigate({ to: "/chat/$threadId", params: { threadId: id } });
    } catch {
      toast.error("No se pudo crear la conversación.");
    }
  }

  async function remove(id: string) {
    try {
      await deleteThread(id);
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.removeQueries({ queryKey: ["search"] });
      if (params.threadId === id) navigate({ to: "/chat", replace: true });
    } catch {
      toast.error("No se pudo borrar.");
    }
  }

  async function togglePin(thread: Thread) {
    try {
      await saveThreadPinned(thread.id, !thread.pinned);
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
    } catch {
      toast.error("No se pudo fijar la conversación.");
    }
  }

  function threadRow(t: Thread) {
    return (
      <div
        key={t.id}
        className={cn(
          "group flex items-center rounded-lg text-sm",
          params.threadId === t.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
        )}
      >
        <Link
          to="/chat/$threadId"
          params={{ threadId: t.id }}
          onClick={() => setOpen(false)}
          className="flex-1 truncate px-3 py-2"
        >
          {q ? <Highlight text={t.title} term={q} /> : t.title}
        </Link>
        <button
          type="button"
          onClick={() => togglePin(t)}
          aria-label={t.pinned ? "Desfijar conversación" : "Fijar conversación"}
          title={t.pinned ? "Desfijar conversación" : "Fijar conversación"}
          className={cn(
            "rounded p-1.5 group-hover:opacity-100",
            t.pinned ? "text-primary opacity-100" : "text-muted-foreground opacity-60",
          )}
        >
          <Pin className="size-4" fill={t.pinned ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          onClick={() => remove(t.id)}
          aria-label="Borrar conversación"
          className="mr-1 rounded p-1.5 text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    );
  }

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex h-dvh bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r bg-sidebar transition-transform md:static md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between p-4">
          <Link to="/" className="flex items-center gap-2">
            <CapriMark className="size-7" />
            <span className="font-display text-xl font-semibold">Capri</span>
          </Link>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(false)} aria-label="Cerrar">
            <X />
          </Button>
        </div>
        <div className="px-3">
          <Button onClick={newThread} className="bg-sun w-full justify-start gap-2 rounded-full">
            <Plus /> Nueva conversación
          </Button>
        </div>
        <div className="relative mx-3 mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar conversaciones"
            aria-label="Buscar conversaciones"
            className="w-full rounded-full border bg-background py-2 pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="px-3 pt-3">
          <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Proyectos</p>
          {projects.map((p) => (
            <div
              key={p.id}
              className={cn(
                "group flex items-center rounded-lg text-sm",
                params.projectId === p.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
              )}
            >
              <Link
                to="/chat/proyecto/$projectId"
                params={{ projectId: p.id }}
                onClick={() => setOpen(false)}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2"
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{p.name}</span>
              </Link>
              <button
                type="button"
                onClick={() => void removeProject(p.id)}
                aria-label="Borrar proyecto"
                className="mr-1 rounded p-1.5 text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
              >
                {confirmDeleteProject === p.id ? <span className="text-xs">¿Borrar?</span> : <Trash2 className="size-4" />}
              </button>
            </div>
          ))}
          {creatingProject ? (
            <form
              className="mt-1 flex items-center gap-1 px-3"
              onSubmit={(e) => {
                e.preventDefault();
                void createNewProject();
              }}
            >
              <input
                autoFocus
                value={newProject}
                onChange={(e) => setNewProject(e.target.value)}
                placeholder="Nombre del proyecto"
                aria-label="Nombre del proyecto"
                maxLength={80}
                className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="sm" disabled={!newProject.trim()}>
                Crear
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreatingProject(false)}>
                <X className="size-4" />
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreatingProject(true)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent/60"
            >
              <FolderPlus className="size-4" /> Nuevo proyecto
            </button>
          )}
        </div>
        <nav className="mt-3 flex-1 space-y-1 overflow-y-auto px-3">
          {q && visible.length > 0 && (
            <p className="px-3 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Títulos</p>
          )}
          {!q && pinned.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Fijados
              </p>
              {pinned.map((t) => threadRow(t))}
              {rest.length > 0 && (
                <p className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Conversaciones
                </p>
              )}
            </>
          )}
          {q ? visible.map((t) => threadRow(t)) : rest.map((t) => threadRow(t))}
          {deepActive && (
            <>
              <p className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                En mensajes
              </p>
              {deep.isFetching && messageHits.length === 0 && (
                <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Buscando…
                </p>
              )}
              {!deep.isFetching && messageHits.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  {visible.length === 0 ? "Sin resultados." : "Ningún mensaje más contiene esa palabra."}
                </p>
              )}
              {messageHits.map((h) => (
                <Link
                  key={h.thread_id}
                  to="/chat/$threadId"
                  params={{ threadId: h.thread_id }}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "block rounded-lg px-3 py-2 text-sm",
                    params.threadId === h.thread_id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
                  )}
                >
                  <span className="block truncate font-medium">{h.title}</span>
                  <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    <Highlight text={stripMarkdown(h.snippet)} term={deepTerm} />
                  </span>
                </Link>
              ))}
            </>
          )}
          {q && !deepActive && visible.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">Sin resultados.</p>
          )}
        </nav>
        <div className="space-y-1 border-t p-3">
          <Link
            to="/estudio"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent/60"
          >
            <GraduationCap className="size-4" /> Modo estudio
          </Link>
          <SettingsDialog
            trigger={
              <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground">
                <Settings /> Ajustes
              </Button>
            }
            personality={
              <InstructionsDialog
                title="Personalidad de Capri"
                description="Instrucciones generales para todas tus conversaciones. Cada conversación puede tener las suyas."
                placeholder="Ej.: Soy estudiante de medicina. Responde con un tono directo y usa listas."
                examples={["Tono formal", "Respuestas muy cortas", "Usa emojis"]}
                value={settings?.default_instructions ?? ""}
                onSave={async (next) => {
                  await saveDefaultInstructions(next);
                  await queryClient.invalidateQueries({ queryKey: ["settings"] });
                }}
                trigger={
                  <Button variant="outline" className="h-11 w-full justify-start gap-2">
                    <Sparkles /> Personalidad de Capri
                    {settings?.default_instructions && (
                      <span className="ml-auto text-xs text-primary">Activa</span>
                    )}
                  </Button>
                }
              />
            }
          />
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-background/70 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Conversaciones">
            <Menu />
          </Button>
          <CapriMark className="size-6" />
          <span className="font-display text-lg font-semibold">Capri</span>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
