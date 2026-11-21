import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Download, Loader2, LogOut, Trash2, Plus, Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getVoiceMode, setVoiceMode, type VoiceMode } from "@/lib/voice";
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/push";
import { formatReminderDue } from "@/lib/reminders";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function textOf(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? (p as { text?: string }).text ?? "" : ""))
    .filter(Boolean)
    .join("\n\n");
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsDialog({ trigger, personality }: { trigger: ReactNode; personality: ReactNode }) {
  const [email, setEmail] = useState<string>("");
  const [busy, setBusy] = useState<"export" | "delete" | "memory" | null>(null);
  const [memories, setMemories] = useState<Array<{ id: string; category: string; content: string; updated_at: string; source?: string; importance?: number; expires_at?: string | null }>>([]);
  const [memoryContent, setMemoryContent] = useState("");
  const [autoMemory, setAutoMemory] = useState(true);
  const [voiceMode, setVoiceModeState] = useState<VoiceMode>(() => getVoiceMode());
  const [spanishVoice, setSpanishVoice] = useState<boolean | null>(null);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [busyPush, setBusyPush] = useState(false);
  const [reminders, setReminders] = useState<Array<{ id: string; text: string; due_at: string; timezone: string; status: string }>>([]);
  const [memoryCategory, setMemoryCategory] = useState("contexto");
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
    supabase.from("user_settings").select("memory_auto_enabled").maybeSingle().then(({ data }) => {
      if (data) setAutoMemory(data.memory_auto_enabled);
    });
    supabase
      .from("capri_memories")
      .select("id,category,content,updated_at,source,importance,expires_at")
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error("No se pudo cargar la memoria.");
        else setMemories(data ?? []);
      });
  }, []);

  useEffect(() => {
    getPushState().then(setPushState);
    void loadReminders();
  }, []);

  async function loadReminders() {
    const { data, error } = await supabase
      .from("reminders")
      .select("id,text,due_at,timezone,status")
      .order("due_at", { ascending: true })
      .limit(50);
    if (error) {
      toast.error("No se pudieron cargar los recordatorios.");
      return;
    }
    setReminders(data ?? []);
  }

  async function togglePush() {
    setBusyPush(true);
    if (pushState === "on") {
      const result = await disablePush();
      setBusyPush(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPushState("off");
      toast.success("Notificaciones desactivadas.");
      return;
    }
    const result = await enablePush();
    setBusyPush(false);
    if (!result.ok) {
      toast.error(result.error);
      setPushState(await getPushState());
      return;
    }
    setPushState("on");
    toast.success("Notificaciones activadas. Capri te avisará a la hora.");
  }

  async function cancelReminder(id: string) {
    const { error } = await supabase.from("reminders").update({ status: "cancelled" }).eq("id", id);
    if (error) {
      toast.error("No se pudo cancelar el recordatorio.");
      return;
    }
    setReminders((items) => items.filter((item) => item.id !== id));
    toast.success("Recordatorio cancelado.");
  }

  async function loadMemories() {
    const { data, error } = await supabase
      .from("capri_memories")
      .select("id,category,content,updated_at,source,importance,expires_at")
      .order("updated_at", { ascending: false });
    if (error) {
      toast.error("No se pudo cargar la memoria.");
      return;
    }
    setMemories(data ?? []);
  }


  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) {
      setSpanishVoice(false);
      return;
    }
    const check = () => setSpanishVoice(synth.getVoices().some((v) => v.lang.toLowerCase().startsWith("es")));
    check();
    synth.addEventListener("voiceschanged", check);
    return () => synth.removeEventListener("voiceschanged", check);
  }, []);

  function changeVoiceMode(mode: VoiceMode) {
    setVoiceMode(mode);
    setVoiceModeState(mode);
    toast.success(mode === "system" ? "Voz del teléfono activada." : "Voz de Capri activada.");
  }

  async function toggleAutoMemory(enabled: boolean) {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { error } = await supabase.from("user_settings").upsert(
      { user_id: auth.user.id, memory_auto_enabled: enabled, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) {
      toast.error("No se pudo actualizar la configuración de memoria.");
      return;
    }
    setAutoMemory(enabled);
    toast.success(enabled ? "Memoria automática activada." : "Memoria automática desactivada.");
  }

  async function saveMemory() {
    const content = memoryContent.trim();
    if (!content || content.length > 500) {
      toast.error("Cada recuerdo debe tener entre 1 y 500 caracteres.");
      return;
    }
    setBusy("memory");
    const result = editingMemory
      ? await supabase.from("capri_memories").update({ content, category: memoryCategory, updated_at: new Date().toISOString() }).eq("id", editingMemory)
      : await supabase.from("capri_memories").insert({ content, category: memoryCategory });
    setBusy(null);
    if (result.error) {
      toast.error("No se pudo guardar el recuerdo.");
      return;
    }
    setMemoryContent("");
    setMemoryCategory("contexto");
    setEditingMemory(null);
    await loadMemories();
    toast.success("Recuerdo guardado.");
  }

  async function removeMemory(id: string) {
    const { error } = await supabase.from("capri_memories").delete().eq("id", id);
    if (error) {
      toast.error("No se pudo eliminar el recuerdo.");
      return;
    }
    setMemories((items) => items.filter((item) => item.id !== id));
    if (editingMemory === id) {
      setEditingMemory(null);
      setMemoryContent("");
    }
    toast.success("Recuerdo eliminado.");
  }

  function startEdit(memory: (typeof memories)[number]) {
    setEditingMemory(memory.id);
    setMemoryContent(memory.content);
    setMemoryCategory(memory.category);
  }

  async function exportAll() {
    setBusy("export");
    try {
      const { data: threads, error } = await supabase
        .from("threads")
        .select("id,title,created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const { data: msgs, error: e2 } = await supabase
        .from("messages")
        .select("thread_id,role,parts,created_at")
        .order("created_at", { ascending: true });
      if (e2) throw e2;
      const parts = (threads ?? []).map((t) => {
        const body = (msgs ?? [])
          .filter((m) => m.thread_id === t.id)
          .map((m) => `**${m.role === "user" ? "Tú" : "Capri"}:**\n\n${textOf(m.parts)}`)
          .join("\n\n---\n\n");
        return `# ${t.title}\n\n${body}`;
      });
      const blob = new Blob([parts.join("\n\n\n")], { type: "text/markdown" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `capri-conversaciones-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error("No se pudo exportar.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteAll() {
    setBusy("delete");
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase.from("threads").delete().eq("user_id", user.user?.id ?? "");
    setBusy(null);
    if (error) {
      toast.error("No se pudo borrar el historial.");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["threads"] });
    toast.success("Historial borrado.");
    navigate({ to: "/chat" });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajustes</DialogTitle>
          <DialogDescription>Tu cuenta, la personalidad de Capri y tus datos.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Section title="Cuenta">
            <p className="truncate text-sm">{email || "…"}</p>
            <Button variant="outline" className="h-11 w-full justify-start gap-2" onClick={() => supabase.auth.signOut()}>
              <LogOut /> Cerrar sesión
            </Button>
          </Section>
          <Section title="Personalidad">{personality}</Section>
          <Section title="Voz">
            <div className="space-y-2">
              <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <input type="radio" name="voice-mode" checked={voiceMode === "system"} onChange={() => changeVoiceMode("system")} className="mt-1 size-4 accent-primary" />
                <span>
                  <span className="block font-medium">Voz del teléfono (español)</span>
                  <span className="text-xs text-muted-foreground">Lee en español con la voz de tu dispositivo. Gratis, sin usar la IA del servidor.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <input type="radio" name="voice-mode" checked={voiceMode === "server"} onChange={() => changeVoiceMode("server")} className="mt-1 size-4 accent-primary" />
                <span>
                  <span className="block font-medium">Voz de Capri (inglés)</span>
                  <span className="text-xs text-muted-foreground">La voz del servidor. Solo habla inglés.</span>
                </span>
              </label>
              {voiceMode === "system" && spanishVoice === false && (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  Tu dispositivo no tiene una voz en español instalada; en ese caso Capri usa la voz del servidor.
                </p>
              )}
            </div>
          </Section>
          <Section title="Recordatorios">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Pídele a Capri en el chat que te recuerde algo ("recuérdame mañana a las 8...") y te llega una notificación en tu teléfono a esa hora.
              </p>
              <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={pushState === "on"}
                  disabled={pushState === null || pushState === "unsupported" || pushState === "denied" || busyPush}
                  onChange={() => void togglePush()}
                  className="size-4 accent-primary"
                />
                <span>
                  <span className="block font-medium">Notificaciones en el teléfono</span>
                  <span className="text-xs text-muted-foreground">
                    {pushState === "denied"
                      ? "Bloqueadas en tu teléfono: actívalas en Ajustes de Chrome > Notificaciones."
                      : pushState === "unsupported"
                        ? "Este navegador no admite notificaciones push."
                        : "Capri te avisa aunque la app esté cerrada."}
                  </span>
                </span>
              </label>
              <div className="space-y-2">
                <p className="text-sm font-medium">Tus recordatorios</p>
                {reminders.length === 0 ? (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Todavía no tienes recordatorios.</p>
                ) : (
                  reminders.map((reminder) => (
                    <div key={reminder.id} className="flex items-start gap-2 rounded-md border p-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {reminder.status === "sent" ? "Enviado" : "Pendiente"} · {formatReminderDue(reminder.due_at, reminder.timezone)}
                        </p>
                        <p className="break-words text-sm">{reminder.text}</p>
                      </div>
                      {reminder.status === "pending" && (
                        <Button variant="ghost" size="icon" aria-label="Cancelar recordatorio" onClick={() => void cancelReminder(reminder.id)}>
                          <X className="size-4" />
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </Section>
          <Section title="Memoria de Capri">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Capri puede guardar automáticamente preferencias, proyectos y objetivos estables que expreses. No debe guardar datos sensibles ni suposiciones. También puedes añadir recuerdos manualmente; puedes editar o eliminar cualquier recuerdo.
              </p>
              <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <input type="checkbox" checked={autoMemory} onChange={(event) => void toggleAutoMemory(event.target.checked)} className="size-4 accent-primary" />
                <span><span className="block font-medium">Guardar recuerdos automáticamente</span><span className="text-xs text-muted-foreground">Puedes desactivarlo cuando quieras.</span></span>
              </label>
              <div className="space-y-2 rounded-lg border p-3">
                <label className="text-xs font-medium" htmlFor="memory-category">Categoría</label>
                <select
                  id="memory-category"
                  value={memoryCategory}
                  onChange={(event) => setMemoryCategory(event.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="contexto">Contexto</option>
                  <option value="preferencia">Preferencia</option>
                  <option value="proyecto">Proyecto</option>
                  <option value="objetivo">Objetivo</option>
                  <option value="otro">Otro</option>
                </select>
                <label className="text-xs font-medium" htmlFor="memory-content">Recuerdo ({memoryContent.length}/500)</label>
                <textarea
                  id="memory-content"
                  value={memoryContent}
                  onChange={(event) => setMemoryContent(event.target.value.slice(0, 500))}
                  placeholder="Ej. Estoy desarrollando Capri como asistente web conectado a IA en la nube."
                  rows={3}
                  maxLength={500}
                  className="w-full resize-y rounded-md border bg-background p-3 text-sm"
                />
                <div className="flex gap-2">
                  <Button className="h-10 flex-1" onClick={saveMemory} disabled={!!busy || !memoryContent.trim()}>
                    {busy === "memory" ? <Loader2 className="animate-spin" /> : editingMemory ? <Check /> : <Plus />}
                    {editingMemory ? "Guardar cambios" : "Añadir recuerdo"}
                  </Button>
                  {editingMemory && <Button variant="outline" className="h-10" onClick={() => { setEditingMemory(null); setMemoryContent(""); setMemoryCategory("contexto"); }}><X /></Button>}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Recuerdos guardados</p>
                  <span className="text-xs text-muted-foreground">{memories.length}</span>
                </div>
                {memories.length === 0 ? (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Todavía no has guardado recuerdos.</p>
                ) : memories.map((memory) => (
                  <div key={memory.id} className="flex items-start gap-2 rounded-md border p-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{memory.category} · {memory.source === "automatic" ? "automático" : "manual"}</p>
                      <p className="whitespace-pre-wrap break-words text-sm">{memory.content}</p>
                    </div>
                    <Button variant="ghost" size="icon" aria-label="Editar recuerdo" onClick={() => startEdit(memory)}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label="Eliminar recuerdo" onClick={() => removeMemory(memory.id)}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
              </div>
            </div>
          </Section>
          <Section title="Tus datos">
            <Button variant="outline" className="h-11 w-full justify-start gap-2" onClick={exportAll} disabled={!!busy}>
              {busy === "export" ? <Loader2 className="animate-spin" /> : <Download />} Exportar todas las conversaciones
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="h-11 w-full justify-start gap-2 text-destructive" disabled={!!busy}>
                  {busy === "delete" ? <Loader2 className="animate-spin" /> : <Trash2 />} Borrar todo el historial
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Borrar todas tus conversaciones?</AlertDialogTitle>
                  <AlertDialogDescription>Esto no se puede deshacer.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={deleteAll}>Borrar todo</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
