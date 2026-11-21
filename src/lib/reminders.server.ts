/**
 * Reminders, server side: the chat tools the model calls, and the per-minute
 * job that sends due reminders as web push notifications.
 */
import { tool } from "ai";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { json, type UserClient } from "./auth-request.server";
import { REMINDER_TIMEZONE, formatReminderDue, validateReminder } from "./reminders";
import { sendPushNotification } from "./push-send.server";

export const REMINDER_TOOLS = ["create_reminder", "list_reminders", "cancel_reminder"] as const;

/** Tools for `streamText`. The model creates, lists and cancels reminders in plain language; the server validates everything. */
export function createReminderTools(supabase: UserClient, userId: string, threadId: string) {
  return {
    create_reminder: tool({
      description:
        "Crea un recordatorio para el usuario: Capri le avisa con una notificación en su teléfono a la hora indicada. Úsala solo cuando el usuario pida explícitamente que le recuerdes algo. due_at es la fecha y hora en ISO 8601 con la zona horaria de Ciudad de México (UTC-06:00), por ejemplo 2026-11-22T08:00:00-06:00 para mañana a las 8. Calcula la fecha a partir de la fecha y hora actuales del sistema.",
      inputSchema: z.object({
        text: z.string().min(1).max(200).describe("Qué hay que recordar, en pocas palabras."),
        due_at: z.string().describe("Fecha y hora del recordatorio en ISO 8601 con zona horaria -06:00."),
      }),
      execute: async ({ text, due_at }) => {
        const validation = validateReminder({ text, due_at });
        if (!validation.ok) return { error: validation.error };
        const { data, error } = await supabase
          .from("reminders")
          .insert({
            user_id: userId,
            thread_id: threadId,
            text: validation.text,
            due_at: validation.dueAt.toISOString(),
            timezone: REMINDER_TIMEZONE,
          })
          .select("id,due_at")
          .single();
        if (error || !data) {
          console.error("create reminder", error);
          return { error: "No se pudo guardar el recordatorio." };
        }
        return { ok: true, id: data.id, text: validation.text, due_at: data.due_at, due_text: formatReminderDue(data.due_at) };
      },
    }),
    list_reminders: tool({
      description:
        "Lista los recordatorios pendientes del usuario, con su id, texto y fecha. Úsala para responder qué recordatorios tiene o para identificar cuál cancelar.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("reminders")
          .select("id,text,due_at")
          .eq("user_id", userId)
          .eq("status", "pending")
          .order("due_at", { ascending: true })
          .limit(20);
        if (error) {
          console.error("list reminders", error);
          return { error: "No se pudieron listar los recordatorios." };
        }
        return {
          reminders: (data ?? []).map((row) => ({
            id: row.id,
            text: row.text,
            due_at: row.due_at,
            due_text: formatReminderDue(row.due_at),
          })),
        };
      },
    }),
    cancel_reminder: tool({
      description: "Cancela un recordatorio pendiente por su id (usa list_reminders para encontrarlo).",
      inputSchema: z.object({
        id: z.string().describe("El id del recordatorio a cancelar."),
      }),
      execute: async ({ id }) => {
        const { data, error } = await supabase
          .from("reminders")
          .update({ status: "cancelled" })
          .eq("id", id)
          .eq("user_id", userId)
          .eq("status", "pending")
          .select("id,text")
          .maybeSingle();
        if (error) {
          console.error("cancel reminder", error);
          return { error: "No se pudo cancelar el recordatorio." };
        }
        if (!data) return { error: "No hay un recordatorio pendiente con ese id." };
        return { ok: true, text: data.text };
      },
    }),
  };
}

/**
 * The per-minute job: send every due reminder as a push to all of the owner's
 * devices. A reminder with no subscribed device stays pending and is retried
 * next minute, so it is never lost silently. The status update is conditional
 * on still being pending, so two overlapping runs cannot send it twice.
 */
export async function processDueReminders(): Promise<{ checked: number; sent: number; waiting: number }> {
  const now = new Date().toISOString();
  const { data: due, error } = await supabaseAdmin
    .from("reminders")
    .select("id,user_id,text,thread_id")
    .eq("status", "pending")
    .lte("due_at", now)
    .order("due_at", { ascending: true })
    .limit(100);
  if (error) {
    console.error("due reminders query", error);
    throw error;
  }
  let sent = 0;
  let waiting = 0;
  for (const reminder of due ?? []) {
    const { data: subs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth")
      .eq("user_id", reminder.user_id);
    if (!subs?.length) {
      waiting++;
      continue;
    }
    const url = reminder.thread_id ? `/chat/${reminder.thread_id}` : "/chat";
    for (const sub of subs) {
      const result = await sendPushNotification(sub, {
        title: "Capri: recordatorio",
        body: reminder.text,
        url,
      });
      if (result === "gone") {
        await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
    const { data: claimed } = await supabaseAdmin
      .from("reminders")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", reminder.id)
      .eq("status", "pending")
      .select("id");
    if (claimed?.length) sent++;
  }
  return { checked: due?.length ?? 0, sent, waiting };
}

/** POST /api/reminders-due, called once a minute by the scheduler with a bearer secret. */
export async function handleDueReminders(request: Request) {
  const secret = process.env["REMINDERS_CRON_SECRET"];
  if (!secret) return json(500, "Server configuration error");
  const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]) return json(401, "Unauthorized");
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  if (!timingSafeEqual(digest(match[1]), digest(secret))) return json(401, "Unauthorized");
  try {
    const result = await processDueReminders();
    return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  } catch {
    return json(500, "No se pudieron procesar los recordatorios.");
  }
}
