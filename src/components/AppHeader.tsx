"use client";

import { ArrowLeft, Globe, Info, PanelLeft, PanelRight, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import Freshness, { howOld } from "@/components/Freshness";
import { startBuild } from "@/lib/api";
import { shareOfDay } from "@/lib/openalex/client";
import { reachHref, shapeHref } from "@/lib/routes";
import { ThemeToggle } from "@/components/ThemeProvider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GraphMeta, GraphNode } from "@/lib/types";

/** Diagnostics from the build. They are not used for exploring, so they are not always shown.
 *  API cost, request count and the size of the candidate pool are tucked away here. */
function BuildInfo({ meta }: { meta: GraphMeta }) {
  const split = (meta.n_author_records ?? 1) > 1;
  const rows: [string, string | number][] = [
    ["ORCID", meta.orcid],
    ...(split
      ? ([["OpenAlex records", `${meta.n_author_records} (split)`]] as [string, string][])
      : []),
    ...(meta.n_hop1_expanded && meta.n_hop1_expanded < meta.n_hop1
      ? ([["Expanded for 2nd degree", `${meta.n_hop1_expanded} of ${meta.n_hop1}`]] as [
          string,
          string,
        ][])
      : []),
    ["Second-degree pool", meta.n_hop2_candidates_total.toLocaleString()],
    ["Affiliations corrected", meta.corrected_affiliations ?? "—"],
    ["Read from OpenAlex", howOld(meta.built_at) ?? "—"],
    ["Requests to OpenAlex", meta.api_requests.toLocaleString()],
    // A share of the free daily limit, not dollars: nobody is charged (see FindCollaborators)
    ["Share of the day's free limit", `${shareOfDay(meta.api_cost_usd)}%`],
    ["Reach", `${meta.hops} hop${meta.hops > 1 ? "s" : ""}`],
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs">
          <Info className="size-3.5" />
          <span className="hidden sm:inline">Build info</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="eyebrow border-b px-3 py-2">How this was built</div>
        <dl className="divide-y text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 px-3 py-1.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="tabular font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {split && (
          <p className="border-t px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            OpenAlex holds {meta.n_author_records} separate author records for this
            ORCID. All of them are read as one person here, but merging them at
            OpenAlex would fix your record everywhere.
          </p>
        )}
        <p className="border-t px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          Data from OpenAlex (CC0), free to use up to a daily limit. Results are kept on
          this device for 30 days, so reopening this network uses none of it. Reading it
          again uses about the same share as last time ({shareOfDay(meta.api_cost_usd)}%).
        </p>
      </PopoverContent>
    </Popover>
  );
}

export default function AppHeader({
  ego, meta, railOpen, panelOpen,
  onToggleRail, onTogglePanel, onOpenFilters, onRebuild,
}: {
  ego?: GraphNode;
  meta: GraphMeta;
  railOpen: boolean;
  panelOpen: boolean;
  onToggleRail: () => void;
  onTogglePanel: () => void;
  onOpenFilters: () => void;
  onRebuild: () => void;
}) {
  return (
    <header
      className="flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-card px-2 sm:px-3"
      style={{ ["--header-height" as string]: "56px" }}
    >
      <Button asChild variant="ghost" size="icon" className="size-8 shrink-0">
        <Link href="/" aria-label="Start over with another ORCID iD">
          <ArrowLeft className="size-4" />
        </Link>
      </Button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold leading-tight">
          {ego?.name ?? meta.orcid}
        </h1>
        <p className="truncate text-[11px] leading-tight text-muted-foreground">
          {ego?.institution ?? "Institution unknown"}
          {ego?.country ? ` · ${ego.country}` : ""}
        </p>
      </div>

      {/* The shape of a research life: your world, coloured by who you built it with. */}
      <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
        <Link href={shapeHref(meta.orcid)}>
          <span className="hidden sm:inline">Shape</span>
          <span className="sm:hidden">◎</span>
        </Link>
      </Button>

      {/* To "who has your work been useful to". This is the side about what you contributed. */}
      <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
        <Link href={reachHref(meta.orcid)}>
          <Globe className="size-3.5" />
          <span className="hidden sm:inline">Reach</span>
        </Link>
      </Button>

      {/* On mobile, the filters move into a sheet */}
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs lg:hidden"
        onClick={onOpenFilters}
      >
        <SlidersHorizontal className="size-3.5" />
        <span className="hidden sm:inline">Filters</span>
      </Button>

      <div className="hidden items-center gap-0.5 lg:flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-pressed={railOpen}
              onClick={onToggleRail}
            >
              <PanelLeft className={railOpen ? "size-4" : "size-4 text-muted-foreground"} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{railOpen ? "Hide filters" : "Show filters"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-pressed={panelOpen}
              onClick={onTogglePanel}
            >
              <PanelRight className={panelOpen ? "size-4" : "size-4 text-muted-foreground"} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{panelOpen ? "Hide candidates" : "Show candidates"}</TooltipContent>
        </Tooltip>
      </div>

      <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />
      {/* "My papers" lives in one place only, the Shape page. This page has no
          paper-graph data, and intruders show up most clearly as colours in the shape,
          so that is where to fix them. The Shape link in the header goes there. */}
      <Freshness
        builtAt={meta.built_at}
        onRefresh={() => {
          // hops is in meta, so there is no need to recover it from the job name.
          startBuild(meta.orcid, { hops: meta.hops, refresh: true }).then(onRebuild);
        }}
      />
      {/* Not on phones. With them the header needed about 480px: the theme switch was cut off
          at the right edge and the name was squeezed down to nothing (Measured at 375px). On a
          phone the theme follows the system setting. */}
      <div className="hidden items-center gap-2 sm:flex">
        <BuildInfo meta={meta} />
        <ThemeToggle />
      </div>
    </header>
  );
}
