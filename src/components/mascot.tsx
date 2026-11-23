import { cn } from "@/lib/utils";

/**
 * Capri's mascot: Frieren's own drawing, cropped to the character.
 * The image background is a flat light gray (#d0cbd1); the same color is
 * used as the backdrop so the rectangle blends into the page.
 */
export function Mascot({ className }: { className?: string }) {
  return (
    <img
      src="/mascot.png"
      alt="Mascota de Capri"
      className={cn("rounded-3xl bg-[#d0cbd1]", className)}
    />
  );
}
