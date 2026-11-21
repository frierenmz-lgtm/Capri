/**
 * Web push subscription, client side. The public VAPID key ships in the
 * browser bundle (it is public by design); the private key never leaves the
 * server. Subscriptions are stored in `push_subscriptions` via RLS, so no
 * API route is needed to save or delete them.
 */
import { supabase } from "@/integrations/supabase/client";

const VAPID_PUBLIC_KEY = import.meta.env["VITE_VAPID_PUBLIC_KEY"] as string | undefined;

export type PushState = "unsupported" | "denied" | "off" | "on";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Decodes a base64url string (no padding) to bytes; used for the VAPID public key. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** True when the browser already has a live push subscription for this device. */
export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription ? "on" : "off";
  } catch {
    return "off";
  }
}

/** Ask for permission, subscribe this device, and save the subscription. Returns an error message in Spanish on failure. */
export async function enablePush(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pushSupported()) return { ok: false, error: "Este navegador no admite notificaciones push." };
  if (!VAPID_PUBLIC_KEY) return { ok: false, error: "Las notificaciones no están configuradas todavía." };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, error: "Sin permiso, Capri no puede avisarte." };
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const json = subscription.toJSON();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return { ok: false, error: "Inicia sesión para activar las notificaciones." };
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: auth.user.id,
        endpoint: json.endpoint ?? "",
        p256dh: json.keys?.["p256dh"] ?? "",
        auth: json.keys?.["auth"] ?? "",
      },
      { onConflict: "endpoint" },
    );
    if (error) {
      await subscription.unsubscribe().catch(() => undefined);
      return { ok: false, error: "No se pudo guardar la suscripción." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo activar las notificaciones." };
  }
}

/** Remove this device's subscription, in the browser and in the database. */
export async function disablePush(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe().catch(() => undefined);
      const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
      if (error) return { ok: false, error: "No se pudo desactivar las notificaciones." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo desactivar las notificaciones." };
  }
}
