"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { THEME_KEY, type Theme } from "@/components/theme-shared";

/* localStorage and the OS setting are state outside React, so we subscribe with
   useSyncExternalStore rather than useState + useEffect. Since nothing calls setState
   inside an effect, there are no cascading renders either. */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  // Picks up both changes made in another tab and the OS switching between light and dark
  window.addEventListener("storage", onChange);
  mq.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
    mq.removeEventListener("change", onChange);
  };
}

function read(): Theme {
  try {
    return (localStorage.getItem(THEME_KEY) as Theme) || "system";
  } catch {
    return "system"; // private windows, for example
  }
}

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function write(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* Even if it cannot be saved, the display on this page still switches correctly */
  }
  apply(theme);
  listeners.forEach((l) => l());
}

const OPTIONS: [Theme, string, typeof Sun][] = [
  ["light", "Light theme", Sun],
  ["system", "Match system theme", Monitor],
  ["dark", "Dark theme", Moon],
];

export default function ThemeToggleImpl() {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);

  // In "system" mode we have to follow changes on the OS side. The subscription above
  // already covers that, so here we only apply the current value to the DOM.
  if (typeof document !== "undefined") apply(theme);

  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={theme}
      onValueChange={(v) => v && write(v as Theme)}
      aria-label="Colour theme"
      className="h-7"
    >
      {OPTIONS.map(([value, label, Icon]) => (
        <ToggleGroupItem key={value} value={value} aria-label={label} className="size-7 p-0">
          <Icon className="size-3.5" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
