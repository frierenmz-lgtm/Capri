/**
 * Reminders, shared by the chat tools (server) and the settings list (client).
 * Times are stored as timestamptz and interpreted in Freddy's timezone.
 */

export const REMINDER_TIMEZONE = "America/Mexico_City";
export const MAX_REMINDER_TEXT_CHARS = 200;
export const MAX_REMINDER_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

export type ReminderValidation =
  | { ok: true; text: string; dueAt: Date }
  | { ok: false; error: string };

/** Validate what the model (or a future form) hands over. Never trust a raw string: the date must parse, be in the future, and be at most a year away. */
export function validateReminder(input: { text: unknown; due_at: unknown }, now = new Date()): ReminderValidation {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length < 1) return { ok: false, error: "El recordatorio está vacío." };
  if (text.length > MAX_REMINDER_TEXT_CHARS) {
    return { ok: false, error: `El recordatorio es demasiado largo (máximo ${MAX_REMINDER_TEXT_CHARS} caracteres).` };
  }
  if (typeof input.due_at !== "string" || !input.due_at.trim()) {
    return { ok: false, error: "Falta la fecha y hora del recordatorio." };
  }
  const dueAt = new Date(input.due_at);
  if (Number.isNaN(dueAt.getTime())) return { ok: false, error: "La fecha y hora no se entienden." };
  if (dueAt.getTime() <= now.getTime()) return { ok: false, error: "La fecha y hora ya pasaron." };
  if (dueAt.getTime() - now.getTime() > MAX_REMINDER_AHEAD_MS) {
    return { ok: false, error: "El recordatorio no puede ser a más de un año." };
  }
  return { ok: true, text, dueAt };
}

/** "sáb 22 nov, 08:00" in Freddy's timezone, for the settings list and chat confirmations. */
export function formatReminderDue(dueAtIso: string, timezone = REMINDER_TIMEZONE): string {
  return new Date(dueAtIso).toLocaleString("es-MX", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
