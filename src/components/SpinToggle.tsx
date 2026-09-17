"use client";

import { Pause, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

/** Stop or start the diagram's automatic rotation.
 *
 *  Always shown, with the same look, on every page that has a 3D view. Previously only the Shape
 *  page had a speed slider, tucked away in a settings popover, and the globe and the
 *  introduction path had no way to stop it. Something you are trying to read that keeps moving
 *  on its own is unreadable for that reason alone.
 *
 *  It sits on top of the canvas, so its background is fixed dark to stay readable whatever is
 *  behind it. */
export default function SpinToggle({
  spinning,
  onChange,
  className,
}: {
  spinning: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!spinning)}
      aria-pressed={spinning}
      title={spinning ? "Stop rotating" : "Rotate"}
      className={cn(
        "flex min-h-8 items-center gap-1.5 rounded-sm bg-black/55 px-2 py-1.5 text-[11px] text-white/75 backdrop-blur-sm transition-colors duration-200 hover:bg-black/70 hover:text-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        className,
      )}
    >
      {spinning ? <Pause className="size-3.5" /> : <RotateCw className="size-3.5" />}
      <span>{spinning ? "Stop" : "Rotate"}</span>
    </button>
  );
}
