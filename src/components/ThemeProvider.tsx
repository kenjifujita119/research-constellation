"use client";

import dynamic from "next/dynamic";

/** The server has no way of knowing the user's setting, and rendering it there would cause
 *  a hydration mismatch. So it is loaded on the client only. */
export const ThemeToggle = dynamic(() => import("@/components/ThemeToggleImpl"), {
  ssr: false,
  loading: () => <div className="h-7 w-[84px]" aria-hidden />,
});
