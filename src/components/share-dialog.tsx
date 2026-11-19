import { useState } from "react";
import { Check, Copy, Link2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { setThreadShare } from "@/lib/threads";

type Props = { threadId: string; shareId: string | null; disabled?: boolean; onChange: () => Promise<void> };

export function ShareDialog({ threadId, shareId, disabled, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = shareId && typeof window !== "undefined" ? `${window.location.origin}/s/${shareId}` : "";

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      await setThreadShare(threadId, on);
      await onChange();
      toast.success(on ? "Enlace creado." : "Dejaste de compartir esta conversación.");
    } catch {
      toast.error("No se pudo cambiar el enlace.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("No se pudo copiar. Mantén presionado el enlace para copiarlo.");
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" disabled={disabled} aria-label="Compartir">
          <Share2 className="size-4" />
          <span className="hidden sm:inline">Compartir</span>
          {shareId && <span className="size-1.5 rounded-full bg-primary" aria-label="Compartida" />}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Compartir conversación</DialogTitle>
          <DialogDescription>
            Quien tenga el enlace podrá leer esta conversación, incluidos los mensajes que agregues después. No podrá
            escribir ni ver tus instrucciones.
          </DialogDescription>
        </DialogHeader>
        {shareId ? (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace para compartir" />
              <Button onClick={copy} className="shrink-0 gap-1.5">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <Button variant="ghost" className="self-start text-destructive" disabled={busy} onClick={() => toggle(false)}>
              Dejar de compartir
            </Button>
          </div>
        ) : (
          <Button className="bg-sun gap-2 self-start rounded-full" disabled={busy} onClick={() => toggle(true)}>
            <Link2 className="size-4" /> Crear enlace
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
