"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppHeader from "@/components/AppHeader";
import Explain from "@/components/Explain";
import FilterPanel from "@/components/FilterPanel";
import NodeDetail from "@/components/NodeDetail";
import ParamGate from "@/components/ParamGate";
import RecommendationList from "@/components/RecommendationList";
import TopicScope from "@/components/TopicScope";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ApiError, fetchNetwork, fetchStatus, startBuild } from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";
import { applyFilters, emptyFilters, type Filters } from "@/lib/graph";
import { useIsWide } from "@/lib/useIsWide";
import type { GraphNode, Network as Net } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function GraphPage() {
  return <ParamGate name="job">{(job) => <GraphView job={job} />}</ParamGate>;
}

function GraphView({ job }: { job: string }) {

  const [net, setNet] = useState<Net | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const [railOpen, setRailOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [filterSheet, setFilterSheet] = useState(false);
  const wide = useIsWide();
  // Rebuild after "not my paper" is saved. Co-authors are derived from the ego's papers, so
  // re-scoring is not enough: the network has to be built again from the start.
  const [rebuilding, setRebuilding] = useState(false);
  // Progress shown while rebuilding. null means no rebuild is in progress.
  const [rebuildLog, setRebuildLog] = useState<string[] | null>(null);

  useEffect(() => {
    if (!rebuilding) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const s = await fetchStatus(job);
        if (cancelled || s.status === "running") return;
        clearInterval(timer);
        if (s.status === "error") {
          setError(s.error ?? "Rebuild failed");
        } else {
          const fresh = await fetchNetwork(job);
          if (cancelled) return;
          setNet(fresh);
          // Co-authors of the removed papers are gone, so don't carry over the selection or filters
          setSelected(null);
          setFilters(emptyFilters);
        }
        setRebuilding(false);
      } catch {
        // The server can briefly stop responding during a build. Try again on the next tick.
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rebuilding, job]);

  // If the network is missing, rebuild it. The cache expires after 30 days and is also
  // discarded when the rules change, so someone opening a link directly could hit a dead end.
  // The ORCID can be recovered from the job name.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const load = async () => {
      try {
        const fresh = await fetchNetwork(job);
        if (!cancelled) setNet(fresh);
        return;
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
          return;
        }
      }
      if (cancelled) return;
      const orcid = job.replace(/_h\d+$/, "");
      const hops = /_h1$/.test(job) ? 1 : 2;
      setRebuildLog(["Finding people you could write with…"]);
      try {
        const started = await startBuild(orcid, { hops });
        if (started.status === "done") {
          const fresh = await fetchNetwork(job);
          if (!cancelled) {
            setNet(fresh);
            setRebuildLog(null);
          }
          return;
        }
        timer = setInterval(async () => {
          try {
            const st = await fetchStatus(started.job);
            if (cancelled) return;
            setRebuildLog(st.messages.length ? st.messages : ["Finding people you could write with…"]);
            if (st.status === "running") return;
            stop();
            if (st.status === "error") {
              setRebuildLog(null);
              setError(st.error ?? "Rebuilding this network failed");
              return;
            }
            const fresh = await fetchNetwork(started.job);
            if (cancelled) return;
            setNet(fresh);
            setRebuildLog(null);
          } catch {
            // The server may not respond during a build. Try again on the next tick.
          }
        }, 1500);
      } catch (err) {
        if (!cancelled) {
          setRebuildLog(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    load();
    return () => {
      cancelled = true;
      stop();
    };
  }, [job]);

  const byId = useMemo(
    () => new Map((net?.nodes ?? []).map((n) => [n.id, n])),
    [net],
  );

  // Opening a candidate recounts who could introduce you, and saves the result with a new
  // ranking. Read the saved network again, or the list keeps the old "Shared", "Intro via"
  // and "no co-author in common" mark next to a detail panel that says otherwise.
  const reread = useCallback(() => {
    fetchNetwork(job)
      .then((fresh) => {
        setNet(fresh);
        setSelected((s) => (s ? (fresh.nodes.find((n) => n.id === s.id) ?? s) : s));
      })
      .catch(() => {
        // The panel already shows the recount; the list catches up on the next visit.
      });
  }, [job]);

  const view = useMemo(
    () => (net ? applyFilters(net, filters) : { nodes: [], links: [] }),
    [net, filters],
  );

  /** Select a candidate.
   *
   *  Most of the top recommendations are off-network candidates (Measured: 52–59% of the top
   *  150 places), so filtering by layer would defeat the recommendations themselves. Lean
   *  towards showing rather than hiding: if you select someone the filters have hidden,
   *  switch their layer back on first. */
  function select(n: GraphNode) {
    if (n.hop !== 0 && !filters.hops.has(n.hop)) {
      setFilters((f) => ({ ...f, hops: new Set(f.hops).add(n.hop) }));
    }
    setSelected(n);
  }

  if (error) {
    return (
      <main className="grid h-svh place-items-center p-10 text-center">
        <div>
          <h1 className="text-sm font-semibold">Could not load this network</h1>
          <p className="mt-1.5 text-xs text-muted-foreground">{error}</p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href="/">Start over</Link>
          </Button>
        </div>
      </main>
    );
  }

  if (!net) {
    return (
      <main className="grid h-svh place-items-center p-10">
        <div className="w-full max-w-sm text-center">
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {rebuildLog ? "Finding people you could write with…" : "Loading network…"}
          </p>
          {rebuildLog && (
            <>
              <p className="mt-2 text-[11px] text-muted-foreground">
                The first time on this device this reads a lot from OpenAlex, so it
                takes a few minutes. It is then kept here for 30 days.
              </p>
              <p className="tabular mt-3 truncate text-[11px] text-muted-foreground">
                {rebuildLog[rebuildLog.length - 1]}
              </p>
            </>
          )}
        </div>
      </main>
    );
  }

  const ego = byId.get(net.ego);
  const m = net.meta;
  const hop1 = view.nodes.filter((n) => n.hop === 1);
  // Candidates are the people you have not written with. The count used to be every node,
  // which added you and your co-authors to it.
  const allCandidates = net.nodes.filter((n) => n.hop >= 2);
  const candidates = view.nodes.filter((n) => n.hop >= 2);
  const throughCoauthors = allCandidates.filter((n) => n.hop === 2).length;
  // Only people with a known country go in the denominator. Counting unknown countries as
  // "home" makes the overseas share look lower than it is (Measured: 3% of direct co-authors
  // have no country).
  const known = hop1.filter((n) => n.country);
  const intl = known.filter((n) => n.country !== ego?.country).length;
  const countries = new Set(view.nodes.map((n) => n.country).filter(Boolean)).size;
  const home = ego?.country ? (COUNTRIES[ego.country]?.name ?? ego.country) : "your country";

  // Build the detail only once. On wide screens it goes in the right column; on narrow
  // screens, in the bottom Sheet.
  const detail = selected && (
    <NodeDetail
      node={selected}
      byId={byId}
      egoName={ego?.name ?? "You"}
      covering={!wide}
      onClose={() => setSelected(null)}
      job={job}
      onRecounted={reread}
    />
  );

  const filterPanel = (
    // FilterPanel does the count filtering itself with matches(). Pass it every node.
    <FilterPanel
      nodes={net.nodes}
      egoCountry={ego?.country}
      filters={filters}
      onChange={setFilters}
    />
  );

  // overflow-clip, not hidden. hidden only removes the scrollbar and still creates a scroll
  // container, so every time focus moves to an element inside, the browser scrolls this box
  // and pushes the header off the top of the screen — and with no scrollbar and no wheel
  // scrolling, there is no way to bring it back (Measured: at scrollTop 41.6 the header sat
  // at top -42). clip creates no scroll container, so nothing can shift.
  return (
    <div className="relative flex h-svh flex-col overflow-clip">
      <AppHeader
        ego={ego}
        meta={m}
        onRebuild={() => setRebuilding(true)}
        railOpen={railOpen}
        panelOpen={panelOpen}
        onToggleRail={() => setRailOpen((v) => !v)}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        onOpenFilters={() => setFilterSheet(true)}
      />

      <TopicScope
        topics={m.ego_topics ?? []}
        nodes={net.nodes}
        egoId={net.ego}
        topic={filters.topic}
        onChange={(topic) => setFilters((f) => ({ ...f, topic }))}
      />

      <div className="flex min-h-0 flex-1">
        {/* --- Left rail: filters (desktop only, collapsible) --- */}
        {/* The width is set inline. When two Tailwind utilities compete, the winner depends on
            the order they are generated in, and collapsing can stop working. */}
        <aside
          className="hidden shrink-0 overflow-hidden border-r bg-sidebar transition-[width] duration-200 lg:block"
          // With width alone, the flex item's min-content width (the 260px of its contents)
          // wins and it will not shrink. Set min/max as well to close that loophole.
          style={{
            width: railOpen ? "var(--rail-width)" : 0,
            minWidth: railOpen ? "var(--rail-width)" : 0,
            maxWidth: railOpen ? "var(--rail-width)" : 0,
            borderRightWidth: railOpen ? 1 : 0,
          }}
          aria-hidden={!railOpen}
        >
          <div className="h-full w-(--rail-width)">{filterPanel}</div>
        </aside>

        {/* --- Right panel: candidate list + detail --- */}
        {/* --- Candidate list: the main body of this page --- */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
          <dl className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-b px-3 py-1.5">
            <Stat
              k="Candidates"
              v={
                candidates.length === allCandidates.length
                  ? allCandidates.length
                  : `${candidates.length} / ${allCandidates.length}`
              }
              explain={`People you have not written a paper with who came up in the search: ${throughCoauthors} who write with your co-authors, and ${allCandidates.length - throughCoauthors} found through topics and citations. With filters on, the first number is how many pass them.`}
            />
            <Stat
              k="Co-authors"
              v={hop1.length}
              explain="People you have written at least one paper with. They are not recommended here; they are the people who could introduce you."
            />
            <Stat
              k="Co-authors abroad"
              v={known.length ? `${Math.round((intl / known.length) * 100)}%` : "—"}
              explain={`The share of your co-authors whose latest known affiliation is outside ${home}. ${hop1.length - known.length} with no known country are left out of the share.`}
            />
            <Stat
              k="Countries"
              v={countries}
              explain="Countries of everyone counted here, co-authors and candidates, by their latest known affiliation."
            />
          </dl>
          <RecommendationList
            net={net}
            job={job}
            filters={filters}
            byId={byId}
            selectedId={selected?.id ?? null}
            onSelect={select}
            onRevealHops={(hops) =>
              setFilters((f) => {
                const next = new Set(f.hops);
                for (const h of hops) next.add(h);
                return { ...f, hops: next };
              })
            }
          />
        </main>

        {/* --- Right panel: detail for the one selected person (wide screens only) ---
             Narrow screens use a Sheet that slides up from the bottom. Only one of the two is
             built, rather than switching with CSS, because there is a canvas inside — the
             hidden one grabs a WebGL context too (Measured: two introduction-path diagrams
             were created, one of them 0x0 and never drawn). */}
        {selected && wide && (
          <aside
            className={cn(
              "min-h-0 shrink-0 overflow-hidden border-l bg-card",
              panelOpen ? "w-(--panel-width)" : "w-0 border-l-0",
            )}
          >
            <div className="h-full w-(--panel-width)">{detail}</div>
          </aside>
        )}
      </div>

      {rebuilding && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Rebuilding your network without the papers you removed…
          </p>
        </div>
      )}

      {/* Narrow screens have no right panel, so the detail slides up from the bottom. */}
      <Sheet
        open={!!selected && !wide}
        onOpenChange={(v) => { if (!v) setSelected(null); }}
      >
        {/* Write the height with data-[side=bottom]. A plain h-[75svh] loses to the sheet's
            own data-[side=bottom]:h-auto, so it grows to the height of its contents and runs
            off the top of the screen — Measured: an 841px panel on a 706px screen, with the
            close mark hidden off-screen. */}
        <SheetContent
          side="bottom"
          className="flex h-[75svh] flex-col overflow-hidden p-0 data-[side=bottom]:h-[75svh]"
          // The heading inside already has "Back to the list", so the sheet's own x is not
          // shown. With both, they overlap in the top-right corner.
          showCloseButton={false}
          // On opening, focus jumped to the first link inside and scrolled to it, taking the
          // heading out of view with it. Don't move focus.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SheetTitle className="sr-only">{selected?.name ?? "Candidate"}</SheetTitle>
          {!wide && detail}
        </SheetContent>
      </Sheet>

      <Sheet open={filterSheet} onOpenChange={setFilterSheet}>
        <SheetContent side="left" className="w-[86vw] max-w-sm p-0">
          <SheetTitle className="sr-only">Filters</SheetTitle>
          {filterPanel}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Small figures shown above the list. They used to be overlaid in white on the 3D canvas;
 *  the canvas has since been removed, so they now sit on the plain background. */
function Stat({ k, v, explain }: { k: string; v: string | number; explain: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        <Explain text={explain}>{k}</Explain>
      </dt>
      <dd className="tabular text-[11px] font-semibold">{v}</dd>
    </div>
  );
}
