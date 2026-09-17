"use client";

import { useMemo } from "react";
import Explain from "@/components/Explain";
import type { Person } from "@/lib/shape";
import { cn } from "@/lib/utils";

/** The shape, read as text.
 *
 *  A 3D canvas is invisible to screen readers, and on a narrow screen you cannot rotate it to
 *  look around. With the same content as a list, it can be read in both cases. This is not a
 *  separate "alternative representation"; it is the same thing shown two ways.
 *
 *  Sorted by the number of papers written together, most first. The big spheres in the shape
 *  come to the top, so the picture and the list say the same thing. */
export default function PeopleList({
  people,
  keep,
  upTo,
  picked,
  onPick,
  className,
}: {
  people: Person[];
  /** ids of the people left after filtering; null means everyone. Pass the same set as the
   *  diagram */
  keep?: Set<string> | null;
  /** Only people who had appeared by this year */
  upTo: number;
  picked: Person | null;
  onPick: (p: Person | null) => void;
  className?: string;
}) {
  const rows = useMemo(
    () =>
      people
        .filter((p) => p.since <= upTo && (!keep || keep.has(p.id)))
        .sort((a, b) => b.papers - a.papers || (a.name < b.name ? -1 : 1)),
    [people, keep, upTo],
  );

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-baseline justify-between border-b px-3 py-2">
        <h2 className="eyebrow">Who you write with</h2>
        <Explain
          align="end"
          className="tabular text-[10px] text-muted-foreground"
          text={`Everyone whose first paper with you was out by ${upTo}. The number is how many papers you have written together in all years, and the years are your first and latest paper together.`}
        >
          by {upTo}
        </Explain>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {rows.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(picked?.id === p.id ? null : p)}
              className={cn(
                "flex w-full items-baseline gap-2 border-b px-3 py-1.5 text-left text-[11.5px] hover:bg-muted/60",
                picked?.id === p.id && "bg-muted/50",
              )}
            >
              <span className="tabular w-5 shrink-0 text-right text-[10px] text-muted-foreground">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {p.since === p.until ? p.since : `${p.since}–${p.until}`}
                  {p.institution && ` · ${p.institution}`}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground/75">
                  {p.topics[0]?.name}
                </span>
              </span>
              <span className="tabular shrink-0 font-semibold">{p.papers}</span>
            </button>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-3 py-3 text-[11px] text-muted-foreground">
            {keep ? "Nobody here matches those filters." : `You had not published with anyone by ${upTo}.`}
          </li>
        )}
      </ol>
    </div>
  );
}
