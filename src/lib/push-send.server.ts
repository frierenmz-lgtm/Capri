/**
 * Sends a web push notification. Server-only: the VAPID private key lives in
 * Vercel env vars and never reaches the browser.
 */
import { sendNotification, setVapidDetails } from "web-push";

export type PushSubscription = { endpoint: string; p256dh: string; auth: string };

export type PushSendResult = "sent" | "gone" | "failed";

let configured = false;

function configure(): boolean {
  if (configured) return true;
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  if (!publicKey || !privateKey) return false;
  setVapidDetails("https://capri-black.vercel.app/", publicKey, privateKey);
  configured = true;
  return true;
}

/**
 * One push. "gone" means the subscription expired (410/404): the caller
 * should delete it so it is not retried forever.
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: { title: string; body: string; url: string },
): Promise<PushSendResult> {
  if (!configure()) return "failed";
  try {
    await sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
    );
    return "sent";
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) return "gone";
    console.error("push send failed", error);
    return "failed";
  }
}
