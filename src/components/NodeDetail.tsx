"use client";

import { BadgeCheck, ExternalLink, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import Explain from "@/components/Explain";
import IntroPath from "@/components/IntroPath";
import NoBridge from "@/components/NoBridge";
import { fetchIntroducers } from "@/lib/api";
import { routes } from "@/lib/intro";
import type { Bridge, GraphNode } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Whether a recount changed who could introduce you (and so the list's "Shared" and "Intro via"). */
const sameBridges = (a: Bridge[] | undefined, b: Bridge[]) =>
  JSON.stringify((a ?? []).map((x) => [x.id, x.weight])) ===
  JSON.stringify(b.map((x) => [x.id, x.weight]));

export default function NodeDetail({
  node, byId, egoName, covering, onClose, job, onRecounted,
}: {
  node: GraphNode;
  /** Used by the path diagram to look up how many papers each person on the path has
   *  written with you */
  byId: Map<string, GraphNode>;
  egoName: string;
  /** Whether this panel covers the list. If it does, the button says "Back"; if it only sits
   *  alongside, "Close" — "Back to the list" while the list is still visible leaves people
   *  unsure where it will take them. */
  covering?: boolean;
  onClose: () => void;
  /** Co-author network used to recount the introducers. Without it, no recount is done */
  job?: string;
  /** Called when the recount changed the introducers, so the page can read the saved network
   *  again and the list stops showing the old count */
  onRecounted?: () => void;
}) {
  const back = covering ? "Back to the list" : "Close";

  // The introducers stored at build time come from a truncated count (the top 200 people per
  // co-author). Saying "nobody in between" on that basis claims more than the facts support
  // — a real case: one candidate had 3 papers with one of the user's co-authors but showed
  // "no path". When the panel opens, recount co-authorship against every direct co-author.
  const candidate = node.hop === 2 || node.hop === 3;
  const [checked, setChecked] = useState<{ id: string; bridges: Bridge[] | null } | null>(null);
  useEffect(() => {
    if (!job || !candidate) return;
    let cancelled = false;
    const before = node.bridges;
    fetchIntroducers(job, node.id)
      .then((bridges) => {
        if (cancelled) return;
        setChecked({ id: node.id, bridges });
        if (!sameBridges(before, bridges)) onRecounted?.();
      })
      // Even if the recount fails (free allowance used up, connection lost), the build-time
      // introducers can still be shown
      .catch(() => {
        if (!cancelled) setChecked({ id: node.id, bridges: null });
      });
    return () => {
      cancelled = true;
    };
    // node.bridges is read once, as the "before" to compare with. Re-running when it changes
    // (it does, right after onRecounted reloads the network) would recount again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, candidate, node.id, onRecounted]);
  const result = checked && checked.id === node.id ? checked : null;
  const verifying = !!job && candidate && !result;
  const them: GraphNode = result?.bridges ? { ...node, bridges: result.bridges } : node;
  const coauthors = [...byId.values()].filter((n) => n.hop === 1).length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold">{node.name}</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {node.institution ?? "Institution unknown"}
            {node.country ? ` · ${node.country}` : ""}
          </p>
        </div>
        {/* On narrow screens this panel covers the list, so an x alone does not tell people
            how to get back. Spell it out. */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-[11px] text-muted-foreground"
          onClick={onClose}
          aria-label={back}
        >
          <X className="size-3.5" />
          <span className="hidden sm:inline">{back}</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        {node.institution_raw && (
          <p className="mb-2 flex items-start gap-1 text-[10.5px] leading-snug text-muted-foreground">
            <BadgeCheck className="mt-px size-3 shrink-0 text-chart-3" />
            Affiliation corrected — OpenAlex said {node.institution_raw}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-y py-2">
          <Stat
            k="Publications"
            v={node.works_count.toLocaleString()}
            hint="Everything OpenAlex lists for them, preprints and conference abstracts included."
          />
          <Stat
            k="Citations"
            v={node.cited_by_count.toLocaleString()}
            hint="Citations to everything they have published, as OpenAlex counts them (their own citations of themselves included)."
          />
          <Stat
            k="h-index"
            v={node.h_index ?? "—"}
            hint="They have h papers that are each cited at least h times (from OpenAlex). It grows with career length, so it favours senior researchers."
          />
          <Stat
            k="Publishing"
            v={`${node.active_from ?? "?"}–${node.active_to ?? "?"}`}
            hint="From the year their output reaches 5% of the total, to their latest publication. Stray early records — often another researcher of the same name — are skipped, and so are dates in the future, which are errors in OpenAlex."
          />
          {node.collab_with_ego ? (
            <Stat
              k="Papers together"
              v={node.collab_with_ego}
              hint="Papers you have both written. A preprint and the paper it became count once."
            />
          ) : null}
        </dl>

        {node.orcid && (
          <a
            href={`https://orcid.org/${node.orcid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-primary underline underline-offset-2"
          >
            {node.orcid}
            <ExternalLink className="size-3" />
          </a>
        )}

        <Section title="Main topics">
          <ul className="space-y-0.5 text-[11.5px]">
            {(node.topics ?? []).map((t) => (
              <li key={t.id} className="leading-snug">
                {t.name}
                <span className="text-muted-foreground"> · {t.field}</span>
              </li>
            ))}
            {(node.topics ?? []).length === 0 && <li className="text-muted-foreground">—</li>}
          </ul>
        </Section>

        {node.shared_works?.length ? (
          <Section title={`Papers together (${node.shared_works.length} shown)`}>
            <ul className="space-y-1 text-[11.5px]">
              {node.shared_works.map((w) => (
                <li key={w.id} className="leading-snug">
                  {w.doi ? (
                    <a
                      href={w.doi}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      {w.title}
                    </a>
                  ) : (
                    w.title
                  )}{" "}
                  <span className="tabular text-muted-foreground">({w.year})</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {verifying ? (
          /* Draw the diagram only once the recount is done. Drawing the build-time introducers
             first means more appear a few seconds later and the diagram rearranges itself,
             leaving people unsure which version is right. */
          <Section title="Who could introduce you">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Checking all {coauthors.toLocaleString()} people you have written with…
            </p>
          </Section>
        ) : them.bridges?.length ? (
          <Section title={`Who could introduce you (${them.bridges.length})`}>
            {/* The only 3D left on this page. The path is the only thing it makes readable,
                so draw just the path. */}
            <IntroPath them={them} byId={byId} egoName={egoName} />
            <Introducers them={them} byId={byId} />
          </Section>
        ) : candidate ? (
          /* Someone with no co-authors in common. Removing the whole section would also
             remove the fact that nobody can introduce you. */
          <Section title="How to reach them">
            <IntroPath them={them} byId={byId} egoName={egoName} />
            <NoBridge them={them} checked={result?.bridges ? coauthors : undefined} />
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ k, v, hint }: { k: string; v: string | number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] text-muted-foreground">
        {hint ? <Explain text={hint}>{k}</Explain> : k}
      </dt>
      <dd className="tabular text-[12px] font-semibold">{v}</dd>
    </div>
  );
}

/** Year of the most recent paper written together. Whether you can ask for an introduction
 *  depends as much on recency as on the count — someone you wrote with last year is easier
 *  to ask than someone you wrote with once ten years ago. */
function LastYear({ year }: { year: number | null }) {
  if (!year) return null;
  return (
    <span className="block text-[9.5px] font-normal text-muted-foreground">latest {year}</span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-3">
      <h3 className="eyebrow mb-1">{title}</h3>
      {children}
    </section>
  );
}

/** Introducers, shown with both co-authorship counts, in order of how likely the
 *  introduction is to get through.
 *
 *  This used to be one line of names and numbers ("Introducer A 71 · Introducer B 13 · …")
 *  that never said what the 71 counted (papers with the candidate). The order was also "most
 *  papers with the candidate first", which reads as if the first person is the easiest to ask
 *  — but someone with 71 papers with the candidate and only 3 with you is not necessarily
 *  easy to ask.
 *
 *  Showing both numbers, ordered by how likely the path is to get through, avoids that mix-up. */
function Introducers({
  them,
  byId,
}: {
  them: GraphNode;
  byId: Map<string, GraphNode>;
}) {
  const [all, setAll] = useState(false);
  const rows = routes(them, byId);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, 5);
  const surname = (name: string) => name.split(" ").pop() ?? name;

  return (
    <div className="mt-2.5">
      <table className="w-full text-[11.5px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="pb-1 text-left font-medium">Could introduce you</th>
            <th className="pb-1 pl-2 text-right font-medium">with you</th>
            <th className="pb-1 pl-2 text-right font-medium">
              with {surname(them.name)}
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={r.id} className="border-t">
              <td className={cn("truncate py-1 pr-2", i === 0 && "font-semibold")}>
                {r.name}
              </td>
              <td className="tabular py-1 pl-2 text-right">
                {r.mine}
                <LastYear year={r.lastWithYou} />
              </td>
              <td className="tabular py-1 pl-2 text-right">
                {r.theirs}
                <LastYear year={r.lastWithThem} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 5 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-1 text-[10.5px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {all ? "Show the top 5 only" : `Show all ${rows.length}`}
        </button>
      )}
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
        Ordered by how well the whole path holds, not by either number on its own —
        someone who has written a lot with {surname(them.name)} but little with you
        cannot pass a message along.
      </p>
    </div>
  );
}
