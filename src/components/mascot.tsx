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
 * Kiri, Capri's mascot. Without a state it shows the full body
 * (public/mascot.png); with a state it shows the matching UI cutout
 * (public/kiri-<state>.png), rendered as a circle.
 */
export function Mascot({ state, className }: { state?: MascotState; className?: string }) {
  if (!state) {
    return (
      <img
        src="/mascot.png"
        alt="Kiri, la mascota de Capri"
        className={cn("rounded-3xl bg-[#d6d3d6]", className)}
      />
    );
  }
  return (
    <img
      src={STATE_SRC[state]}
      alt="Kiri, la mascota de Capri"
      className={cn("rounded-full", className)}
    />
  );
}
