"use client";

import { connections } from "@/lib/intro";
import type { GraphNode } from "@/lib/types";

/** How to present someone you share no co-author with.
 *
 *  This whole section used to be removed. The page then looked as if there were simply nothing
 *  to say about introductions, and **the fact that there is no shared co-author did not come
 *  across at all**. More than half of the top recommendations are these people, so they are not
 *  someone we can quietly leave blank.
 *
 *  Nor is there "no path". Measured (597 people): among candidates with no co-authorship path,
 *  0 have no evidence at all — 74% have citations in at least one direction and 79% share
 *  references. Only co-authorship is missing; the connection itself is there. So we show it.
 *
 *  We could also show whether one of your co-authors is at the same institution (true for 40% of
 *  off-network candidates), but we don't. At a large university it amounts to little more than
 *  "also at USC", which invents a tie that isn't there.
 *
 *  IntroPath draws the diagram as is. This file used to build its own SVG, but that was just a
 *  pale flat diagram next to a dark 3D one, with no consistency. One presentation is enough; the
 *  only difference is whether what sits in the middle is a person or a connection. */
export default function NoBridge({
  them,
  checked,
}: {
  them: GraphNode;
  /** Number of direct co-authors checked with no cut-off. undefined if they were not checked */
  checked?: number;
}) {
  const rows = connections(them);
  const first = them.name.split(" ").pop() ?? them.name;

  return (
    <div>
      <p className="text-[11.5px] leading-relaxed">
        <span className="font-medium">No co-author in common.</span>{" "}
        {checked !== undefined
          ? `We checked all ${checked.toLocaleString()} people you have written with, and none of them has written with ${first}`
          : `Nobody you have written with has written with ${first}`}
        , so there is no one to ask for an introduction.
      </p>

      {rows.length > 0 && (
        <>
          <p className="mt-2.5 text-[11.5px] leading-relaxed">
            You are connected another way, so a first message does not have to start
            from nothing:
          </p>
          <table className="mt-1.5 w-full text-[11.5px]">
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t align-baseline">
                  <td className="py-1 pr-2">
                    {r.label}
                    <span className="block text-[10.5px] text-muted-foreground">
                      {r.note}
                    </span>
                  </td>
                  <td className="tabular py-1 pl-2 text-right font-medium">
                    {r.count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
