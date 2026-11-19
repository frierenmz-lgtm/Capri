import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MAX_INSTRUCTIONS } from "@/lib/instructions";

type Props = {
  trigger: ReactNode;
  title: string;
  description: string;
  placeholder: string;
  value: string;
  examples?: string[];
  onSave: (value: string) => Promise<void>;
};

export function InstructionsDialog({ trigger, title, description, placeholder, value, examples, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setText(value);
  }, [open, value]);

  async function save(next: string) {
    setSaving(true);
    try {
      await onSave(next.trim());
      toast.success(next.trim() ? "Instrucciones guardadas." : "Instrucciones borradas.");
      setOpen(false);
    } catch {
      toast.error("No se pudieron guardar las instrucciones.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_INSTRUCTIONS))}
          placeholder={placeholder}
          className="min-h-40"
        />
        <div className="flex flex-wrap items-center gap-2">
          {examples?.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {ex}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            {text.length}/{MAX_INSTRUCTIONS}
          </span>
        </div>
        <DialogFooter className="gap-2">
          {value && (
            <Button variant="ghost" disabled={saving} onClick={() => save("")}>
              Borrar
            </Button>
          )}
          <Button className="bg-sun" disabled={saving} onClick={() => save(text)}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
