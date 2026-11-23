import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  AudioLines,
  Check,
  Copy,
  Download,
  FileText,
  Folder,
  Globe,
  Loader2,
  Mic,
  Paperclip,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { messagesQuery, moveThreadToProject, saveThreadInstructions, saveThreadModel, threadQuery } from "@/lib/threads";
import { projectsQuery } from "@/lib/projects";
import { CHAT_MODELS, resolveChatModel } from "@/lib/models";
import {
  ATTACH_ACCEPT,
  IMAGE_BUCKET,
  IMAGE_SCHEME,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  attachmentKind,
  imagePath,
} from "@/lib/images";
import { CapriMark } from "@/components/capri-mark";
import { Mascot } from "@/components/mascot";
import { InstructionsDialog } from "@/components/instructions-dialog";
import { ShareDialog } from "@/components/share-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { authHeaders, speak, startRecording, transcribe, type Recording } from "@/lib/voice";
import { MAX_RECORDING_SECONDS, VOICE_SILENCE_MS } from "@/lib/voice-limits";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(messagesQuery(params.threadId)),
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  const { data } = useSuspenseQuery(messagesQuery(threadId));
  return <ChatWindow key={threadId} threadId={threadId} initialMessages={data} />;
}

function ChatWindow({ threadId, initialMessages }: { threadId: string; initialMessages: UIMessage[] }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { threadId },
        headers: authHeaders,
      }),
    [threadId],
  );

  const { messages, sendMessage, regenerate, status, stop } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (err) => toast.error(readError(err)),
    onFinish: ({ messages: all }) => {
      queryClient.setQueryData(messagesQuery(threadId).queryKey, all);
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] });
      // The AI-written title lands a few seconds after the first reply.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["threads"] });
        queryClient.invalidateQueries({ queryKey: ["thread", threadId] });
      }, 5000);
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const [editingId, setEditingId] = useState<string | null>(null);
  const speaker = useSpeaker();
  const voice = useVoiceMode({ sendMessage, status, messages, stop, stopSpeaker: speaker.stop });

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const lastIsUser = messages.at(-1)?.role === "user";

  function saveEdit(m: UIMessage, text: string) {
    const files = m.parts.filter((p): p is FileUIPart => p.type === "file");
    setEditingId(null);
    speaker.stop();
    void sendMessage(text ? { text, files, messageId: m.id } : { files, messageId: m.id });
  }

  function retry(messageId?: string) {
    speaker.stop();
    void regenerate(messageId ? { messageId } : undefined);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadBar threadId={threadId} messages={messages} />
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Mascot className="w-24" />}
              title="Hola, soy Capri"
              description="Pregúntame lo que quieras. Respondo breve y en español."
            />
          ) : (
            messages.map((m) => {
              const text = textOf(m);
              const streamingThis = status === "streaming" && m.id === messages.at(-1)?.id;
              if (editingId === m.id) {
                return (
                  <EditMessage
                    key={m.id}
                    initial={text}
                    hasImages={m.parts.some((p) => p.type === "file")}
                    onCancel={() => setEditingId(null)}
                    onSave={(next) => saveEdit(m, next)}
                  />
                );
              }
              return (
                <Message key={m.id} from={m.role}>
                  <MessageContent>
                    {m.parts.some((p) => p.type === "file") && (
                      <div className="flex flex-wrap gap-2">
                        {m.parts.map((part, i) =>
                          part.type === "file" ? <SavedAttachment key={i} part={part} /> : null,
                        )}
                      </div>
                    )}
                    {streamingThis &&
                      m.parts.some((p) => p.type === "tool-web_search" && p.state !== "output-available") && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Globe className="size-4 animate-pulse" /> Buscando en la web…
                        </div>
                      )}
                    {m.parts.map((part, i) =>
                      part.type === "text" ? (
                        m.role === "user" ? (
                          <p key={i} className="whitespace-pre-wrap">
                            {part.text}
                          </p>
                        ) : (
                          <MessageResponse key={i}>{part.text}</MessageResponse>
                        )
                      ) : null,
                    )}
                    {m.role === "assistant" && <Sources parts={m.parts} />}
                  </MessageContent>
                  {!streamingThis && (
                    <MessageActions
                      className={
                        m.role === "user"
                          ? "ml-auto transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
                          : "-ml-2"
                      }
                    >
                      {m.role === "user" ? (
                        <MessageAction
                          tooltip="Editar"
                          disabled={busy}
                          onClick={() => setEditingId(m.id)}
                          className="size-8 text-muted-foreground"
                        >
                          <Pencil className="size-4" />
                        </MessageAction>
                      ) : (
                        text && (
                          <>
                            <CopyAction text={text} />
                            <MessageAction
                              tooltip={speaker.speakingId === m.id ? "Detener" : "Escuchar"}
                              onClick={() => speaker.toggle(m.id, text)}
                              className="size-8 text-muted-foreground"
                            >
                              {speaker.speakingId === m.id ? (
                                speaker.loading ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <Square className="size-3.5 fill-current" />
                                )
                              ) : (
                                <Volume2 className="size-4" />
                              )}
                            </MessageAction>
                            {m.id === lastAssistantId && (
                              <MessageAction
                                tooltip="Otra respuesta"
                                disabled={busy}
                                onClick={() => retry(m.id)}
                                className="size-8 text-muted-foreground"
                              >
                                <RefreshCw className="size-4" />
                              </MessageAction>
                            )}
                          </>
                        )
                      )}
                    </MessageActions>
                  )}
                </Message>
              );
            })
          )}
          {status === "submitted" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CapriMark className="size-5 animate-pulse" /> Capri está pensando…
            </div>
          )}
          {status === "error" && lastIsUser && (
            <Button variant="outline" size="sm" className="gap-1.5 self-start" onClick={() => retry()}>
              <RefreshCw className="size-4" /> Reintentar
            </Button>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="mx-auto w-full max-w-3xl p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {speaker.speakingId && <ReadingBar loading={speaker.loading} onStop={speaker.stop} />}
        {voice.phase !== "off" ? (
          <VoicePanel phase={voice.phase} onEnd={voice.end} />
        ) : (
        <PromptInput
          accept={ATTACH_ACCEPT}
          multiple
          globalDrop
          maxFiles={MAX_IMAGES}
          maxFileSize={MAX_IMAGE_BYTES}
          onError={(e) =>
            toast.error(
              e.code === "max_files"
                ? `Máximo ${MAX_IMAGES} archivos por mensaje.`
                : e.code === "max_file_size"
                  ? "Cada archivo debe pesar 5 MB o menos."
                  : "Puedo leer imágenes, PDF y archivos de texto (TXT, CSV, código…).",
            )
          }
          onSubmit={async ({ text, files }) => {
            const t = text.trim();
            if ((!t && files.length === 0) || busy) return;
            try {
              const uploaded = await uploadFiles(files);
              sendMessage(t ? { text: t, files: uploaded } : { files: uploaded });
            } catch (e) {
              toast.error((e as Error).message);
              throw e;
            }
          }}
        >
          <AttachmentPreviews />
          <PromptInputTextarea ref={inputRef} autoFocus placeholder="Escribe a Capri..." />
          <PromptInputFooter className="justify-between">
            <div className="flex items-center gap-1">
              <AttachButton />
              <MicButton inputRef={inputRef} disabled={busy} />
              <PromptInputButton
                onClick={() => void voice.start()}
                disabled={busy}
                aria-label="Hablar con Capri"
              >
                <AudioLines className="size-5" />
              </PromptInputButton>
            </div>
            <PromptInputSubmit status={status} onStop={stop} />
          </PromptInputFooter>
        </PromptInput>
        )}
      </div>
    </div>
  );
}

function ThreadBar({ threadId, messages }: { threadId: string; messages: UIMessage[] }) {
  const queryClient = useQueryClient();
  const { data: thread } = useQuery(threadQuery(threadId));
  const { data: projects = [] } = useQuery(projectsQuery);
  const [projectOpen, setProjectOpen] = useState(false);
  const value = thread?.custom_instructions ?? "";
  const project = projects.find((p) => p.id === thread?.project_id);

  async function pickProject(next: string | null) {
    try {
      await moveThreadToProject(threadId, next);
      await queryClient.invalidateQueries({ queryKey: ["thread", threadId] });
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
      await queryClient.invalidateQueries({ queryKey: ["project-threads"] });
      setProjectOpen(false);
    } catch {
      toast.error("No se pudo mover la conversación.");
    }
  }

  return (
    <div className="flex items-center gap-2 border-b px-4 py-2">
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{thread?.title ?? ""}</p>
      {project && (
        <Link
          to="/chat/proyecto/$projectId"
          params={{ projectId: project.id }}
          className="hidden items-center gap-1 truncate rounded-full bg-sidebar-accent px-2.5 py-1 text-xs text-muted-foreground sm:inline-flex"
        >
          <Folder className="size-3.5 shrink-0" />
          <span className="truncate">{project.name}</span>
        </Link>
      )}
      <Dialog open={projectOpen} onOpenChange={setProjectOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" disabled={!thread}>
            <Folder className="size-4" />
            <span className="hidden sm:inline">Proyecto</span>
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proyecto de esta conversación</DialogTitle>
            <DialogDescription>
              Las conversaciones de un proyecto usan sus instrucciones y sus archivos como contexto.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => void pickProject(null)}
              className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-sidebar-accent/60"
            >
              Sin proyecto
              {!thread?.project_id && <span className="ml-2 text-xs text-primary">Actual</span>}
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void pickProject(p.id)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-sidebar-accent/60"
              >
                <Folder className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate">{p.name}</span>
                {thread?.project_id === p.id && <span className="text-xs text-primary">Actual</span>}
              </button>
            ))}
            {projects.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                No tienes proyectos todavía. Créalo desde la barra lateral.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <select
        value={resolveChatModel(thread?.model)}
        disabled={!thread}
        onChange={async (event) => {
          const next = resolveChatModel(event.target.value);
          try {
            await saveThreadModel(threadId, next);
            await queryClient.invalidateQueries({ queryKey: ["thread", threadId] });
          } catch {
            toast.error("No se pudo cambiar el modelo.");
          }
        }}
        aria-label="Modelo de este chat"
        title={CHAT_MODELS.find((model) => model.id === resolveChatModel(thread?.model))?.hint ?? CHAT_MODELS[0]?.hint}
        className="h-9 max-w-36 truncate rounded-md border bg-background px-2 text-sm"
      >
        {CHAT_MODELS.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        disabled={messages.length === 0}
        onClick={() => exportMarkdown(thread?.title ?? "Conversación", messages)}
        aria-label="Exportar a Markdown"
      >
        <Download className="size-4" />
        <span className="hidden sm:inline">Exportar</span>
      </Button>
      <ShareDialog
        threadId={threadId}
        shareId={thread?.share_id ?? null}
        disabled={!thread}
        onChange={() => queryClient.invalidateQueries({ queryKey: ["thread", threadId] })}
      />
      <InstructionsDialog
        title="Instrucciones de esta conversación"
        description="Solo aplican aquí y reemplazan tus instrucciones generales. Déjalo vacío para usar las generales."
        placeholder="Ej.: Actúa como experto en Python y da ejemplos de código cortos."
        examples={["Experto en Python", "Traduce todo al inglés", "Explícalo como a un niño"]}
        value={value}
        onSave={async (next) => {
          await saveThreadInstructions(threadId, next);
          await queryClient.invalidateQueries({ queryKey: ["thread", threadId] });
        }}
        trigger={
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
            <SlidersHorizontal className="size-4" />
            <span className="hidden sm:inline">Instrucciones</span>
            {value && <span className="size-1.5 rounded-full bg-primary" aria-label="Activas" />}
          </Button>
        }
      />
    </div>
  );
}

async function uploadFiles(files: FileUIPart[]): Promise<FileUIPart[]> {
  if (files.length === 0) return [];
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Inicia sesión para enviar archivos.");
  return Promise.all(
    files.map(async (f) => {
      const name = f.filename ?? "archivo";
      const kind = attachmentKind(f.mediaType, f.filename);
      if (!kind) throw new Error(`No puedo leer «${name}». Usa imágenes, PDF o archivos de texto.`);
      const blob = await (await fetch(f.url)).blob();
      if (kind === "text") {
        const head = new Uint8Array(await blob.slice(0, 8192).arrayBuffer());
        if (head.includes(0)) throw new Error(`«${name}» no parece un archivo de texto.`);
      }
      const mediaType = kind === "pdf" ? "application/pdf" : kind === "text" ? "text/plain" : f.mediaType;
      const ext =
        kind === "image"
          ? (f.mediaType.split("/")[1] ?? "png").replace("jpeg", "jpg")
          : kind === "pdf"
            ? "pdf"
            : "txt";
      const path = `${uid}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, blob, { contentType: kind === "text" ? "text/plain;charset=utf-8" : mediaType });
      if (error) throw new Error(`No se pudo subir «${name}».`);
      return { type: "file" as const, mediaType, ...(f.filename ? { filename: f.filename } : {}), url: IMAGE_SCHEME + path };
    }),
  );
}

function useSignedUrl(url: string) {
  const path = imagePath(url);
  return useQuery({
    queryKey: ["image", path ?? url],
    queryFn: async () => {
      if (!path) return url;
      const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrl(path, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
    staleTime: 50 * 60 * 1000,
  }).data;
}

function SavedAttachment({ part }: { part: FileUIPart }) {
  const kind = attachmentKind(part.mediaType, part.filename);
  const href = useSignedUrl(part.url);
  if (kind !== "image") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="flex min-h-11 max-w-64 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-card-foreground"
      >
        <FileText className="size-5 shrink-0 text-primary" />
        <span className="min-w-0 truncate">{part.filename ?? (kind === "pdf" ? "Documento PDF" : "Archivo")}</span>
      </a>
    );
  }
  if (!href) return <div className="size-40 animate-pulse rounded-lg bg-muted" />;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      <img src={href} alt="Imagen adjunta" className="max-h-60 max-w-60 rounded-lg object-cover" />
    </a>
  );
}

type SourcePart = { type: "source-url"; sourceId: string; url: string; title?: string };

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** One chip per website the reply relied on. */
function Sources({ parts }: { parts: UIMessage["parts"] }) {
  const seen = new Set<string>();
  const sources = parts.filter((p): p is SourcePart => {
    if (p.type !== "source-url" || !/^https?:\/\//.test(p.url)) return false;
    const host = hostOf(p.url);
    if (seen.has(host)) return false;
    seen.add(host);
    return true;
  });
  if (sources.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t pt-2">
      <p className="text-xs font-medium text-muted-foreground">Fuentes</p>
      <div className="flex flex-wrap gap-1.5">
        {sources.slice(0, 6).map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            title={s.title ?? s.url}
            className="flex min-h-8 max-w-56 items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Globe className="size-3 shrink-0" />
            <span className="truncate">{hostOf(s.url)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function AttachButton() {
  const att = usePromptInputAttachments();
  return (
    <PromptInputButton onClick={() => att.openFileDialog()} aria-label="Adjuntar imagen o documento">
      <Paperclip className="size-4" />
    </PromptInputButton>
  );
}

function AttachmentPreviews() {
  const att = usePromptInputAttachments();
  if (att.files.length === 0) return null;
  return (
    <div className="flex w-full flex-wrap gap-2 p-2">
      {att.files.map((f) => (
        <div key={f.id} className="relative">
          {attachmentKind(f.mediaType, f.filename) === "image" ? (
            <img src={f.url} alt={f.filename ?? "Imagen"} className="size-16 rounded-md object-cover" />
          ) : (
            <div className="flex h-16 w-36 items-center gap-2 rounded-md border bg-card px-2 text-xs">
              <FileText className="size-5 shrink-0 text-primary" />
              <span className="line-clamp-2 break-all">{f.filename ?? "Archivo"}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => att.remove(f.id)}
            aria-label={`Quitar ${f.filename ?? "archivo"}`}
            className="absolute -right-1.5 -top-1.5 rounded-full bg-background p-0.5 shadow ring-1 ring-border"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function readError(err: Error) {
  try {
    const parsed = JSON.parse(err.message);
    if (parsed?.error) return parsed.error as string;
  } catch {
    /* not json */
  }
  return err.message || "Algo salió mal. Inténtalo de nuevo.";
}

function exportMarkdown(title: string, messages: UIMessage[]) {
  const date = new Date().toLocaleString("es-MX");
  const body = messages
    .map((m) => {
      const text = m.parts
        .map((p) =>
          p.type === "text"
            ? p.text
            : p.type === "file"
              ? attachmentKind(p.mediaType, p.filename) === "image"
                ? "[imagen adjunta]"
                : `[archivo adjunto: ${p.filename ?? "archivo"}]`
              : p.type === "source-url"
                ? `Fuente: ${p.url}`
                : "",
        )
        .filter(Boolean)
        .join("\n")
        .trim();
      return `### ${m.role === "user" ? "Tú" : "Capri"}\n\n${text}`;
    })
    .join("\n\n---\n\n");
  const md = `# ${title}\n\n_Exportado el ${date}_\n\n${body}\n`;
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const name = (title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 50) || "conversacion") + ".md";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const textOf = (m: UIMessage) =>
  m.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n")
    .trim();

function EditMessage({
  initial,
  hasImages,
  onCancel,
  onSave,
}: {
  initial: string;
  hasImages: boolean;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const canSave = (text.trim().length > 0 || hasImages) && text.trim() !== initial;
  return (
    <div className="ml-auto flex w-full max-w-[95%] flex-col gap-2 rounded-lg border bg-card p-3">
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey && canSave) {
            e.preventDefault();
            onSave(text.trim());
          }
        }}
        className="min-h-20 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
        aria-label="Editar mensaje"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto text-xs text-muted-foreground">Las respuestas que siguen se reemplazarán.</p>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button size="sm" disabled={!canSave} onClick={() => onSave(text.trim())}>
          Enviar
        </Button>
      </div>
    </div>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <MessageAction
      tooltip={copied ? "Copiado" : "Copiar"}
      className="size-8 text-muted-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("No se pudo copiar.");
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </MessageAction>
  );
}

type VoicePhase = "off" | "listening" | "transcribing" | "thinking" | "speaking";

/**
 * Hands-free conversation: listen until the user goes quiet, transcribe, send,
 * read the reply aloud, and listen again. Everything runs through refs, so the
 * async callbacks stay valid across renders; `alive` is the single kill switch.
 */
function useVoiceMode({
  sendMessage,
  status,
  messages,
  stop,
  stopSpeaker,
}: {
  sendMessage: (message: { text: string }) => void;
  status: string;
  messages: UIMessage[];
  stop: () => void;
  stopSpeaker: () => void;
}) {
  const [phase, setPhase] = useState<VoicePhase>("off");
  const alive = useRef(false);
  const rec = useRef<Recording | null>(null);
  const tts = useRef<AbortController | null>(null);
  const spokenId = useRef<string | null>(null);
  const latest = useRef({ sendMessage, status, messages, stop });
  latest.current = { sendMessage, status, messages, stop };

  const end = useCallback(() => {
    alive.current = false;
    rec.current?.cancel();
    rec.current = null;
    tts.current?.abort();
    tts.current = null;
    spokenId.current = null;
    if (latest.current.status === "submitted" || latest.current.status === "streaming") latest.current.stop();
    setPhase("off");
  }, []);

  useEffect(() => end, [end]);

  async function listen() {
    if (!alive.current) return;
    setPhase("listening");
    try {
      const r = await startRecording(() => void finish(), {
        silenceMs: VOICE_SILENCE_MS,
        onSilence: () => void finish(),
      });
      if (!alive.current) {
        r.cancel();
        return;
      }
      rec.current = r;
    } catch (e) {
      if (!alive.current) return;
      toast.error((e as Error).message || "No se pudo usar el micrófono.");
      end();
    }
  }

  async function finish() {
    const r = rec.current;
    rec.current = null;
    if (!r || !alive.current) return;
    setPhase("transcribing");
    try {
      const file = await r.stop();
      const text = await transcribe(file, () => {});
      if (!alive.current) return;
      if (!text.trim()) {
        await listen();
        return;
      }
      setPhase("thinking");
      latest.current.sendMessage({ text });
    } catch (e) {
      if (!alive.current) return;
      toast.error((e as Error).message || "No se pudo transcribir el audio.");
      await listen();
    }
  }

  async function speakReply(text: string) {
    if (!alive.current) return;
    setPhase("speaking");
    const c = new AbortController();
    tts.current = c;
    try {
      await speak(text, c.signal);
    } catch {
      /* a failed read-aloud just ends the turn */
    } finally {
      if (tts.current === c) tts.current = null;
    }
    if (!alive.current) return;
    // Small pause so the speaker tail isn't picked up by the microphone.
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (!alive.current) return;
    await listen();
  }

  async function start() {
    if (alive.current) return;
    stopSpeaker();
    alive.current = true;
    spokenId.current = null;
    await listen();
  }

  // The reply finished streaming: read it aloud, then listen again.
  useEffect(() => {
    if (!alive.current || phase !== "thinking") return;
    if (status === "error") {
      toast.error("Capri no pudo responder. Escuchando de nuevo…");
      void listen();
      return;
    }
    if (status !== "ready") return;
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last || spokenId.current === last.id) return;
    spokenId.current = last.id;
    const text = textOf(last);
    if (!text) {
      void listen();
      return;
    }
    void speakReply(text);
  }, [status, messages, phase]);

  return { phase, start, end };
}

/** One reply read aloud at a time; tapping again (or another reply) stops it. */
function useSpeaker() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    setSpeakingId(null);
    setLoading(false);
  }, []);

  useEffect(() => stop, [stop]);

  const toggle = useCallback(
    (id: string, text: string) => {
      const wasThis = speakingId === id;
      stop();
      if (wasThis) return;
      const c = new AbortController();
      ctrl.current = c;
      setSpeakingId(id);
      setLoading(true);
      speak(text, c.signal, () => {
        if (ctrl.current === c) setLoading(false);
      })
        .catch((e: Error) => {
          if (!c.signal.aborted) toast.error(e.message || "No se pudo leer la respuesta.");
        })
        .finally(() => {
          if (ctrl.current === c) {
            ctrl.current = null;
            setSpeakingId(null);
            setLoading(false);
          }
        });
    },
    [speakingId, stop],
  );

  return { speakingId, loading, toggle, stop };
}

function MicButton({ inputRef, disabled }: { inputRef: RefObject<HTMLTextAreaElement | null>; disabled: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const rec = useRef<Recording | null>(null);

  useEffect(() => () => rec.current?.cancel(), []);

  const finish = useCallback(async () => {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    setState("transcribing");
    const el = inputRef.current;
    const base = el?.value.trim() ?? "";
    try {
      const file = await r.stop();
      await transcribe(file, (t) => {
        if (el) el.value = base ? `${base} ${t}` : t;
      });
      el?.focus();
    } catch (e) {
      if (el) el.value = base;
      toast.error((e as Error).message || "No se pudo transcribir el audio.");
    } finally {
      setState("idle");
    }
  }, [inputRef]);

  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (state !== "recording") return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  function cancel() {
    rec.current?.cancel();
    rec.current = null;
    setState("idle");
  }

  async function onClick() {
    if (state === "recording") return finish();
    if (state !== "idle") return;
    try {
      rec.current = await startRecording(() => {
        toast.info("Llegaste al límite de 2 minutos.");
        void finish();
      });
      navigator.vibrate?.(30);
      setState("recording");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (state === "recording") {
    return (
      <div className="flex items-center gap-1 rounded-full bg-destructive/10 py-1 pl-3 pr-1">
        <span className="size-2.5 animate-pulse rounded-full bg-destructive" />
        <span className="min-w-[4.5rem] text-sm tabular-nums text-destructive" aria-live="polite">
          {fmt(seconds)} / {fmt(MAX_RECORDING_SECONDS)}
        </span>
        <Button type="button" variant="ghost" size="icon" className="size-10 rounded-full" onClick={cancel} aria-label="Descartar dictado">
          <X className="size-5" />
        </Button>
        <Button type="button" size="icon" className="size-10 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void finish()} aria-label="Terminar y transcribir">
          <Square className="size-4 fill-current" />
        </Button>
      </div>
    );
  }

  if (state === "transcribing") {
    return (
      <span className="flex h-10 items-center gap-2 px-2 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="size-4 animate-spin" /> Transcribiendo…
      </span>
    );
  }

  return (
    <PromptInputButton
      onClick={onClick}
      disabled={disabled}
      aria-label="Dictar mensaje"
      className="size-10"
    >
      <Mic className="size-5" />
    </PromptInputButton>
  );
}

function VoicePanel({ phase, onEnd }: { phase: Exclude<VoicePhase, "off">; onEnd: () => void }) {
  const label =
    phase === "listening"
      ? "Escuchando… habla cuando quieras"
      : phase === "transcribing"
        ? "Transcribiendo…"
        : phase === "thinking"
          ? "Capri está pensando…"
          : "Capri está hablando…";
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-4" role="status">
      <span className="relative flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
        {phase === "listening" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
        )}
        <AudioLines className="relative size-6" />
      </span>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {label}
      </p>
      <Button type="button" size="lg" className="h-11 gap-2 rounded-full px-6" onClick={onEnd}>
        <Square className="size-4 fill-current" /> Terminar
      </Button>
    </div>
  );
}

function ReadingBar({ loading, onStop }: { loading: boolean; onStop: () => void }) {
  return (
    <div className="mb-2 flex items-center gap-3 rounded-full border bg-card py-1.5 pl-4 pr-1.5 shadow-lg" role="status">
      {loading ? (
        <Loader2 className="size-4 animate-spin text-primary" />
      ) : (
        <Volume2 className="size-4 animate-pulse text-primary" />
      )}
      <span className="flex-1 text-sm">{loading ? "Preparando audio…" : "Capri está leyendo…"}</span>
      <Button type="button" size="sm" className="h-10 gap-1.5 rounded-full px-4" onClick={onStop}>
        <Square className="size-3.5 fill-current" /> Detener
      </Button>
    </div>
  );
}
