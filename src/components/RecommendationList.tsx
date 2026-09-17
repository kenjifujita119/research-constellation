"use client";

import { BadgeCheck, CircleAlert, Loader2, Unlink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Explain from "@/components/Explain";
import { fetchRecommendations } from "@/lib/api";
import { matches, type Filters } from "@/lib/graph";
import { SHARED_REFS_SINCE } from "@/lib/intro";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GraphNode, Network, Recommendation, Recommendations } from "@/lib/types";
import { cn } from "@/lib/utils";

const HOP_LABEL: Record<number, string> = {
  1: "direct co-authors",
  2: "second degree",
  3: "off-network",
};

type Chip = { key: string; label: string; explain: string };

/** The evidence under a candidate, each with what exactly was counted.
 *
 *  Every count is of papers, each counted once: "cites you 12×" used to add up topic by topic,
 *  so one paper citing you in three topics counted three times. "Shared refs" was worse — a
 *  group_by count per batch of references, 422 for someone who shares 139. The ranking still
 *  uses that signal, but the chip shows the exact number where it was counted (the checked
 *  shortlist) and no number where it was not. */
function evidenceChips(r: Recommendation, scoped: boolean): Chip[] {
  const e = r.evidence ?? {};
  const within = scoped ? " Counted within the topic you picked." : "";
  const out: Chip[] = [];
  if (e.cites_me) {
    out.push({
      key: "cites_me",
      label: `${e.cites_me} ${e.cites_me === 1 ? "paper cites" : "papers cite"} you`,
      explain: `Papers of theirs that cite at least one of yours. Each paper counts once, however many of yours it cites.${within}`,
    });
  }
  if (r.shared_refs) {
    out.push({
      key: "cocite",
      label: `${r.shared_refs} works you both cite`,
      explain: `Works in your reference lists that their papers since ${SHARED_REFS_SINCE} also cite. A sign you read the same literature.`,
    });
  } else if (e.cocite && r.shared_refs === null) {
    out.push({
      key: "cocite",
      label: "cites work you cite",
      explain:
        "Their papers cite some of the same works as yours. The exact number is only counted for the candidates checked in detail, and this one was not.",
    });
  }
  if (e.i_cite) {
    out.push({
      key: "i_cite",
      label: `you cite ${e.i_cite} of their papers`,
      explain: `Their papers that appear in your reference lists, each counted once.${within}`,
    });
  }
  if (e.topic) {
    out.push({
      key: "topic",
      label: `${e.topic} papers on your topics`,
      explain: "Their papers since 2021 whose main topic is one of your main topics.",
    });
  }
  return out;
}

/** Number of rows added per scroll */
const PAGE = 25;
/** Fetch-size tiers. Each one multiplies the last, keeping it to 3 round trips at most
 *  (the largest preset has 898 candidates) */
const TIERS = [PAGE, 100, 300, 900];

export default function RecommendationList({
  net, job, filters, byId, selectedId, onSelect, onRevealHops,
}: {
  net: Network;
  job: string;
  /** The page-wide filters. Reads the same state as the graph side */
  filters: Filters;
  byId: Map<string, GraphNode>;
  selectedId: string | null;
  onSelect: (n: GraphNode) => void;
  /** Brings back candidates hidden by the layer checkboxes */
  onRevealHops: (hops: number[]) => void;
}) {
  // Scoring results are kept here. A combination fetched once is not fetched again — until the
  // network itself is read again (after introducers are recounted, the ranking changes), so the
  // cache belongs to one network.
  const [store, setStore] = useState<{ net: Network; rows: Record<string, Recommendations> }>(
    () => ({ net, rows: {} }),
  );
  const cache = useMemo(() => (store.net === net ? store.rows : {}), [store, net]);
  const listRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState(net.recommendations?.presets[0]?.key ?? "");

  const { topic } = filters;
  const egoCountry = byId.get(net.ego)?.country ?? null;

  // Every condition in the left panel applies to this list too. If the layer checkboxes alone
  // were ignored, it would cause the same confusion as "I filtered to JP and the list didn't
  // change". But whatever the layers hide can be brought back in one click from the band below
  // (17 of the top 25 for Same topic are off-network candidates, so hiding them silently
  //  would remove the main point of this app).
  const narrowing =
    filters.countries.size > 0 || filters.institutions.size > 0 ||
    filters.fields.size > 0 || filters.query !== "" ||
    filters.minYear > 0 || filters.minCollab > 0 || filters.excludeHomeCountry;

  // Load more on scroll. Some presets have close to 900 candidates (Measured: complementary
  // 898, same_topic 496), so stopping at 25 would leave most of them out of reach. Fetch in
  // bulk, show a little at a time.
  //
  // A change of basis, topic or attribute filter changes the order, so the loaded-up-to
  // position is dropped. Calling setState in an effect causes a cascading render, so this is
  // "derived" instead: when the reset key changes, paging falls back to its defaults.
  // Layers (hops) are left out of the key. "Show them" only adds candidates, and being sent
  // back to the top at that point would make the list harder to use.
  const resetKey = [
    tab, topic ?? "",
    [...filters.countries].sort().join(","),
    [...filters.institutions].sort().join(","),
    [...filters.fields].sort().join(","),
    filters.query, filters.minYear, filters.minCollab, filters.excludeHomeCountry,
  ].join("|");

  const [paging, setPaging] = useState({ key: resetKey, shown: PAGE, floor: 0 });
  const page = paging.key === resetKey ? paging : { key: resetKey, shown: PAGE, floor: 0 };
  const { shown, floor } = page;

  useEffect(() => {
    // Only touches the DOM. No state changes.
    listRef.current?.scrollTo({ top: 0 });
  }, [resetKey]);

  // Fetch size grows in tiers, moving up one just before the display catches up. Filtering
  // leaves fewer of the fetched rows, so if there are not enough, go up another tier.
  const tier = TIERS.find((t) => t >= shown + PAGE) ?? TIERS[TIERS.length - 1];
  const want = Math.max(tier, floor);
  const key = `${topic ?? ""}|${tab}|${want}`;
  // The first 25 are already in the graph payload, so don't fetch them.
  const embedded = topic === null && want <= PAGE;
  const data = embedded ? net.recommendations : cache[key];
  const loading = !embedded && !cache[key];

  useEffect(() => {
    if (embedded || cache[key] || !tab) return;
    let cancelled = false;
    fetchRecommendations(job, topic, want, tab).then((r) => {
      if (!cancelled) {
        setStore((s) => ({ net, rows: { ...(s.net === net ? s.rows : {}), [key]: r } }));
      }
    });
    return () => { cancelled = true; };
  }, [embedded, key, cache, job, topic, want, tab, net]);

  const presets = data?.presets ?? net.recommendations?.presets ?? [];
  const current = presets.find((p) => p.key === tab);

  const scored = data?.results?.[tab] ?? [];
  const allowed = scored.filter((r) => {
    const n = byId.get(r.id);
    return n ? matches(n, filters, undefined, egoCountry) : false;
  });
  const rows = allowed.slice(0, shown);
  // If filtering uses up everything fetched, fetch one tier deeper from the server.
  const exhausted = scored.length < want;

  // Candidates hidden only by the layer checkboxes. Handled separately from those hidden by
  // attributes.
  const byHop = scored.filter((r) => {
    const n = byId.get(r.id);
    return n && !filters.hops.has(n.hop) && matches(n, filters, "hops", egoCountry);
  });
  const hiddenHops = [...new Set(byHop.map((r) => byId.get(r.id)!.hop))].sort();
  // Number hidden by attribute filters. Excludes those hidden by layer (byHop) and rows not
  // yet paged in.
  const suppressed = scored.length - allowed.length - byHop.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The basis fits on one line. It used to be 8 buttons that permanently took up a third
          of the panel, but they do not all need to be visible all the time, and that height
          does more good given to the candidate cards. */}
      <div className="shrink-0 space-y-1.5 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="eyebrow flex-1">Recommend based on</span>
          {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        </div>

        <Select value={tab} onValueChange={setTab}>
          <SelectTrigger size="sm" className="w-full text-xs font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p.key} value={p.key} className="text-xs">
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {current && (
          <p className="text-[11px] leading-snug text-muted-foreground">{current.description}</p>
        )}
      </div>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          // Add more before the bottom is reached, so nobody waits after reading to the end.
          if (el.scrollHeight - el.scrollTop - el.clientHeight > 240) return;
          if (rows.length < allowed.length) {
            setPaging({ ...page, shown: shown + PAGE });
          } else if (!exhausted && !loading) {
            // Everything held locally is shown. Fetch one tier deeper from the server.
            const next = TIERS.find((t) => t > want);
            setPaging({ ...page, shown: shown + PAGE, floor: next ?? floor });
          }
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {rows.length === 0 && !loading && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {narrowing
              ? "No candidates match this basis and your filters."
              : topic
                ? "Nobody matches this basis within this topic."
                : "No candidates for this basis."}
          </p>
        )}
        {byHop.length > 0 && (
          <div className="flex items-center gap-2 border-b bg-accent/60 px-3 py-1.5 text-[11px]">
            <span className="flex-1 text-accent-foreground">
              {byHop.length} more {byHop.length === 1 ? "candidate is" : "candidates are"} in
              layers you have hidden ({hiddenHops.map((h) => HOP_LABEL[h]).join(", ")}).
            </span>
            <button
              type="button"
              onClick={() => onRevealHops(hiddenHops)}
              className="shrink-0 font-semibold text-primary underline underline-offset-2"
            >
              Show them
            </button>
          </div>
        )}
        {suppressed > 0 && rows.length > 0 && (
          <p className="border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            Filtered to your selection · {suppressed} other candidates hidden
          </p>
        )}
        <ol className="divide-y">
          {rows.map((r, i) => (
            <Card
              key={r.id}
              r={r}
              rank={i + 1}
              scoped={topic !== null}
              node={byId.get(r.id)}
              on={r.id === selectedId}
              onClick={() => { const n = byId.get(r.id); if (n) onSelect(n); }}
            />
          ))}
        </ol>

        {/* Load-more status. Always say how far the list has got. */}
        {rows.length > 0 && (
          <p className="px-3 py-3 text-center text-[11px] text-muted-foreground">
            {rows.length < allowed.length || !exhausted ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" />
                Loading more…
              </span>
            ) : (
              `${allowed.length} candidates on this basis`
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <Explain text={hint} className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Explain>
      <span className="tabular text-[11px] font-semibold">{value}</span>
    </span>
  );
}

function Card({
  r, rank, scoped, node, on, onClick,
}: {
  r: Recommendation;
  rank: number;
  /** A topic is picked, so the evidence counts are within it */
  scoped: boolean;
  node?: GraphNode;
  on: boolean;
  onClick: () => void;
}) {
  const via = r.via.filter((v) => v.name).map((v) => v.name!.split(" ").pop()).join(", ");
  const chips = evidenceChips(r, scoped);

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={on ? "true" : undefined}
        className={cn(
          "w-full px-3 py-2.5 text-left transition-colors duration-200",
          "focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2",
          on ? "bg-accent/10 border-l-2 border-l-accent" : "border-l-2 border-l-transparent hover:bg-muted/60",
        )}
      >
        <div className="flex items-baseline gap-2">
          <span className="tabular w-5 shrink-0 text-[11px] font-semibold text-muted-foreground">
            {rank}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{r.name}</span>
          {r.connection === "none" && (
            <Explain
              align="end"
              className="shrink-0 text-accent no-underline"
              text="None of the people you have written with has written with them, so nobody can introduce you. Opening them checks this again against all your co-authors."
            >
              <Unlink className="size-3.5" />
              <span className="sr-only">No co-author in common</span>
            </Explain>
          )}
        </div>

        <p className="ml-7 truncate text-[11px] text-muted-foreground">
          {r.institution ?? "Institution unknown"}
          {r.country ? ` · ${r.country}` : ""}
          {r.h_index != null ? ` · h-index ${r.h_index}` : ""}
        </p>

        <div className="ml-7 mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* The ranking uses the IDF-weighted sim. This used to show the raw cosine
              (overlap), so "high Topic score but ranked low" happened all the time. */}
          <Metric
            label="Topic"
            value={`${r.sim.toFixed(2)}${r.topic_precision === "coarse" ? "*" : ""}`}
            hint={
              r.topic_precision === "coarse"
                ? "How alike your mixes of topics are, from 0 (nothing in common) to 1 (the same), discounting topics that almost everyone here publishes on. * = measured from their top 5 topics only, so it is rougher than the others."
                : "How alike your mixes of topics are, from 0 (nothing in common) to 1 (the same), discounting topics that almost everyone here publishes on. Measured from their papers since 2020."
            }
          />
          <Metric
            label="Compl."
            value={r.complementarity.toFixed(2)}
            hint="Complementarity: the share of their work (0 to 1) in topics you rarely or never publish in — what they could add to a collaboration."
          />
          {r.n_bridges > 0 && (
            <Metric
              label="Shared"
              value={`${r.n_bridges}`}
              hint="People you have written with who have also written with them. Any of them could introduce you."
            />
          )}
          {r.momentum >= 1.3 && (
            <Metric
              label="Momentum"
              value={`${r.momentum.toFixed(1)}×`}
              hint="Papers in the last 3 years versus the 3 years before."
            />
          )}
        </div>

        {chips.length > 0 && (
          <div className="ml-7 mt-1.5 flex flex-wrap gap-1">
            {chips.map((c) => (
              <Explain
                key={c.key}
                text={c.explain}
                className="tabular rounded-sm bg-primary/10 px-1.5 py-px text-[10px] text-primary no-underline dark:bg-primary/15"
              >
                {c.label}
              </Explain>
            ))}
          </div>
        )}

        {via && (
          <p className="ml-7 mt-1.5 truncate text-[11px] text-primary">
            <Explain text="People you have written with who have also written with them, easiest route first: the one who has written most with both of you, taken together. Open the candidate to see every route.">
              Intro via
            </Explain>{" "}
            {via}
          </p>
        )}

        {r.missing_topics.length > 0 && (
          <p className="ml-7 mt-1 text-[11px] leading-snug text-muted-foreground">
            <Explain
              text="Among their main topics, ones you have published little or nothing in."
              className="font-medium text-foreground"
            >
              Also works on:
            </Explain>{" "}
            {r.missing_topics.slice(0, 2).join(" · ")}
          </p>
        )}

        {/* No "large overlap = competitor" warning. Telling someone who works deeply on the
            same topic that they are "more a competitor than a collaborator" is rude, and it
            is not ours to decide anyway. */}
        {(node?.institution_raw || r.confidence < 0.99) && (
          <div className="ml-7 mt-1.5 space-y-1">
            {node?.institution_raw && (
              <p className="flex items-start gap-1 text-[10.5px] leading-snug text-muted-foreground">
                <BadgeCheck className="mt-px size-3 shrink-0 text-chart-3" />
                Affiliation corrected — OpenAlex said {node.institution_raw}
              </p>
            )}
            {r.confidence < 0.99 && (
              <p className="flex items-start gap-1 text-[10.5px] leading-snug text-muted-foreground">
                <CircleAlert className="mt-px size-3 shrink-0" />
                <span>
                  <Explain text="OpenAlex sometimes merges two researchers with the same name into one profile, or gets an affiliation wrong. These are the warning signs found for this profile; it may still be right. Check it on OpenAlex or ORCID before you write.">
                    Check this profile
                  </Explain>
                  : {r.confidence_reasons.join("; ")}
                </span>
              </p>
            )}
          </div>
        )}
      </button>
    </li>
  );
}
