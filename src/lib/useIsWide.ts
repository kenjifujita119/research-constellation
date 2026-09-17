"use client";

import { useSyncExternalStore } from "react";

/** Whether the screen is wide (Tailwind's lg and up).
 *
 *  Switching with CSS hidden / lg:block leaves the "hidden" one in the DOM even on narrow screens.
 *  When the content is a canvas, the invisible one grabs a WebGL context too. Measured: two
 *  introduction-path diagrams were being created (one of them 0x0 and never drawn). This is needed
 *  so that only one of the two is built. */
const QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches),
    // On the server there is no screen. Starting as narrow means a wide screen is treated as
    // narrow for the one hydration frame, but that does less harm than the reverse
    // (the narrow layout's Sheet builds nothing until it is opened).
    () => false,
  );
}
