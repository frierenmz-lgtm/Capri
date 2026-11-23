import { cn } from "@/lib/utils";

export type MascotState = "idle" | "success" | "confused" | "alert" | "sleep";

const STATE_SRC: Record<MascotState, string> = {
  idle: "/kiri-idle.png",
  success: "/kiri-success.png",
  confused: "/kiri-confused.png",
  alert: "/kiri-alert.png",
  sleep: "/kiri-sleep.png",
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
