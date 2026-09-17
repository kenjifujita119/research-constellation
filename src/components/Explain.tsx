"use client";

import { useRef, useState } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** What a number or a label means, shown on hover and on tap.
 *
 *  Every figure on these pages is a choice about what to count, and a short label cannot say
 *  all of it ("Citations" — whose? counted how?). The explanation sits one hover away instead of
 *  in the layout. A hover-only tooltip would leave phones and tablets without it, so a tap pins
 *  it open, and a tap anywhere else closes it. The dotted underline is the cue that there is
 *  something to read. */
export default function Explain({
  text,
  children,
  className,
  side = "bottom",
  align = "start",
}: {
  text: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  // Opened by a click or a tap: stays open when the pointer moves away
  const [pinned, setPinned] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);

  const hover = (on: boolean) => (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || pinned) return;
    setOpen(on);
  };
  const toggle = () => {
    const next = !(open && pinned);
    setPinned(next);
    setOpen(next);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setPinned(false);
      }}
    >
      <PopoverAnchor asChild>
        <span
          ref={anchor}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onPointerEnter={hover(true)}
          onPointerLeave={hover(false)}
          // Inside a card or a link, a tap on the word opens the explanation and nothing else
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            toggle();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            e.stopPropagation();
            toggle();
          }}
          className={cn(
            "cursor-help underline decoration-current/40 decoration-dotted underline-offset-2",
            className,
          )}
        >
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        side={side}
        align={align}
        onOpenAutoFocus={(e) => e.preventDefault()}
        // A click on the word itself toggles it; it must not also count as a click outside
        onInteractOutside={(e) => {
          if (anchor.current?.contains(e.target as Node)) e.preventDefault();
        }}
        className="w-72 max-w-[calc(100vw-1.5rem)] gap-1.5 p-3 text-[11.5px] leading-relaxed"
      >
        {text}
      </PopoverContent>
    </Popover>
  );
}
