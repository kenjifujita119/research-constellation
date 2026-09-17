"use client";

import { ArrowRight, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { remainingAllowance } from "@/lib/api";
import { resetsAt } from "@/lib/openalex/client";
import { collaboratorsHref } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** The most expensive action, which is why it is a deliberate step.
 *
 *  Measured (2026-09-15, with the current rules): 37 papers → 1.8 minutes, 293 requests,
 *  $0.029; 506 papers → 3.9 minutes, 687 requests, $0.069. If the papers citing you have not
 *  been read yet, that comes first (up to 2 more minutes and $0.02 for 506 papers). The requests
 *  go out from the user's browser, so they use the free daily limit attached to the user's own
 *  connection ($0.10/day without a key), taking 30–70% of it.
 *
 *  **Nobody pays**, so the pop-up says only that it is free up to a daily limit, and what to do if
 *  the limit runs out. It used to show "$0.03" and "Left today: $0.01", which read as a price, and
 *  then percentages of the limit, which were accurate but more than anyone needs. What is left
 *  today is still checked (a free request reports it; checked 2026-09-16 against the response
 *  headers: Remaining-USD 0.012 of Limit-USD 0.1, reset in 3709 s at 22:58 UTC = midnight UTC),
 *  but it is only mentioned when it is too little for this search. */
export default function FindCollaborators({
  orcid,
  /** Number of publications. This roughly determines the wait and the share of the limit */
  works,
}: {
  orcid: string;
  works: number;
}) {
  // Estimate from the two measured points above, in between for the middle. A range, because a
  // single number for something that actually varies will be wrong.
  const minutes = works > 300 ? "4–6" : works > 100 ? "3–4" : "2–3";
  // What this search uses of the free limit, in the dollars OpenAlex meters it in
  const need = works > 300 ? 0.08 : works > 100 ? 0.05 : 0.03;
  // What is left today. Checked once, when opened (a free single-item fetch reports it).
  const [left, setLeft] = useState<"unasked" | "asking" | number | null>("unasked");
  const short = typeof left === "number" && left < need;

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open || left !== "unasked") return;
        setLeft("asking");
        remainingAllowance().then(setLeft);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
          <Users className="size-3.5" />
          <span className="hidden sm:inline">Collaborators</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <h3 className="text-[12.5px] font-semibold">Find new collaborators!</h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Researchers close to your work whom you have not written a paper with yet — and
          the people you have written with who could introduce you.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          The first time takes about{" "}
          <span className="tabular font-medium text-foreground">{minutes} minutes</span>. The
          result is then kept on this device for 30 days.
        </p>
        {short && (
          <p className="mt-2 text-[11px] leading-relaxed text-destructive">
            Most of today&apos;s free limit on this connection has already been used, so the
            search may stop partway.
          </p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Free.</span> OpenAlex, where the data
          comes from, can be used free up to a daily limit. If today&apos;s runs out, the search
          stops partway; try again after{" "}
          <span className="tabular font-medium text-foreground">{resetsAt()}</span> your time
          (midnight UTC), when the limit resets.
        </p>
        <Button asChild size="sm" className="mt-3 h-8 w-full text-xs">
          <Link href={collaboratorsHref(orcid)}>
            Start looking
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
