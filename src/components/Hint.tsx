"use client";

import { X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/** A how-to note laid over a diagram. **It can always be closed.**
 *
 *  If a note you have already read cannot be dismissed, from the second visit on it is just
 *  something covering part of the picture. We remember that it was closed and do not show it
 *  the next time either.
 *
 *  Where localStorage is unavailable (private windows, site data blocked), it simply cannot be
 *  remembered; closing it still works. */
const KEY = (id: string) => `hint:${id}`;

function read(id: string): boolean {
  try {
    return window.localStorage.getItem(KEY(id)) === "1";
  } catch {
    return false;
  }
}

/** Write the "closed" mark and notify subscribers. */
const watchers = new Set<() => void>();

export function dismissHint(id: string): void {
  try {
    window.localStorage.setItem(KEY(id), "1");
  } catch {
    // It just cannot be remembered. For this session the re-render below still hides it.
  }
  for (const w of watchers) w();
}

function subscribe(onChange: () => void): () => void {
  watchers.add(onChange);
  return () => {
    watchers.delete(onChange);
  };
}

export default function Hint({
  id,
  title,
  children,
  className,
}: {
  /** Name to remember it by. Use a different one for each page */
  id: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  // The server has no localStorage. The first render treats it as "not closed yet",
  // and the real answer takes over after hydration.
  const gone = useSyncExternalStore(
    subscribe,
    () => read(id),
    () => false,
  );
  if (gone) return null;

  return (
    <aside
      className={cn(
        "max-w-xs rounded-sm bg-black/55 px-3 py-2 text-[11px] leading-relaxed text-white/80 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 font-semibold text-white">{title}</p>
        <button
          type="button"
          onClick={() => dismissHint(id)}
          aria-label={`Hide "${title}"`}
          className="-mr-1 -mt-0.5 shrink-0 rounded-sm p-0.5 text-white/50 hover:bg-white/15 hover:text-white"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className="mt-1 text-white/60">{children}</div>
    </aside>
  );
}
