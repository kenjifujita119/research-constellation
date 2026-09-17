"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** When the data was fetched, and a way to fetch it again.
 *
 *  The cache lasts 30 days, so unless this is on screen you cannot tell whether the data is from
 *  today or from 29 days ago. A refresh costs 11 requests = $0.0011 with the monthly check for
 *  new papers, so there is no reason to hide that it can be clicked. */
export function howOld(builtAt: number | undefined, now = Date.now()): string | null {
  if (!builtAt) return null;
  const minutes = Math.max(0, Math.round((now - builtAt * 1000) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export default function Freshness({
  builtAt,
  busy,
  onRefresh,
  className,
}: {
  builtAt: number | undefined;
  busy?: boolean;
  onRefresh: () => void;
  className?: string;
}) {
  // Recount every minute so it does not get stuck on "3 minutes ago".
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const age = howOld(builtAt, now);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={className ?? "h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"}
          onClick={onRefresh}
          disabled={busy}
          aria-label="Read this again from OpenAlex"
        >
          <RefreshCw className={busy ? "size-3 animate-spin" : "size-3"} />
          <span className="tabular hidden sm:inline">{age ?? "age unknown"}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {age ? `Read from OpenAlex ${age}.` : "We do not know when this was read."}{" "}
        Click to read it again.
      </TooltipContent>
    </Tooltip>
  );
}
