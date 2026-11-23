import { cn } from "@/lib/utils";

export type MascotState =
  | "idle"
  | "success"
  | "confused"
  | "alert"
  | "sleep"
  | "happy"
  | "excited"
  | "peeking"
  | "grumpy"
  | "dizzy"
  | "surprised"
  | "lying"
  | "standing"
  | "box";

const STATE_SRC: Record<MascotState, string> = {
  idle: "/kiri-idle.png",
  success: "/kiri-success.png",
  confused: "/kiri-confused.png",
  alert: "/kiri-alert.png",
  sleep: "/kiri-sleep.png",
  happy: "/kiri-happy.png",
  excited: "/kiri-excited.png",
  peeking: "/kiri-peeking.png",
  grumpy: "/kiri-grumpy.png",
  dizzy: "/kiri-dizzy.png",
  surprised: "/kiri-surprised.png",
  lying: "/kiri-lying.png",
  standing: "/kiri-standing.png",
  box: "/kiri-box.png",
};

/**
 * Kiri, Capri's mascot. Shows the UI cutout for the given state
 * (public/kiri-<state>.png), rendered as a circle on a lavender disc.
 * Defaults to idle. The PNGs are transparent (cut from the reference
 * sheet); the disc color comes from the palette's highlight lilac.
 */
export function Mascot({ state = "idle", className }: { state?: MascotState; className?: string }) {
  return (
    <img
      src={STATE_SRC[state]}
      alt="Kiri, la mascota de Capri"
      className={cn("rounded-full bg-[#d8c9ec]", className)}
    />
  );
}

/** Kiri's circular avatar (purple ring), used as the brand mark in the app chrome. */
export function KiriAvatar({ className }: { className?: string }) {
  return <img src="/kiri-avatar.png" alt="Kiri" className={cn("rounded-full", className)} />;
}
