"use client";

import { ChevronRight, Search, X } from "lucide-react";
import { useState } from "react";
import { emptyFilters, facet, matches, type Filters } from "@/lib/graph";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { GraphNode } from "@/lib/types";
import { cn } from "@/lib/utils";

const clone = (f: Filters): Filters => ({
  ...f,
  hops: new Set(f.hops),
  countries: new Set(f.countries),
  institutions: new Set(f.institutions),
  fields: new Set(f.fields),
});

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Which layers to show. All three are on by default: off-network means "people you have no
 *  co-authorship path to yet", which is exactly what this page is looking for. It used to be
 *  off by default for the sake of the 3D view, and that view no longer exists. */
const HOPS: { value: 1 | 2 | 3; label: string; hint: string; dot: string }[] = [
  { value: 1, label: "Direct co-authors", hint: "People you have published with", dot: "var(--hop-direct)" },
  { value: 2, label: "Second degree", hint: "Co-authors of your co-authors", dot: "var(--hop-second)" },
  { value: 3, label: "Off-network", hint: "Found by topic or citation — no co-authorship path to you", dot: "var(--hop-offnet)" },
];

export default function FilterPanel({
  nodes, filters, onChange, egoCountry,
}: {
  nodes: GraphNode[];
  /** The ego's country. Used for the label and the test of the "Outside <country>" toggle */
  egoCountry?: string | null;
  filters: Filters;
  onChange: (next: Filters) => void;
}) {
  const patch = (p: Partial<Filters>) => onChange({ ...clone(filters), ...p });

  // Counts are taken over "everyone who passes every condition except this axis".
  // If the graph is down to 108 nodes while the country list still says 228, you
  // cannot tell which one is true.
  const forHops = nodes.filter((n) => matches(n, filters, "hops", egoCountry));
  const forCountry = nodes.filter((n) => matches(n, filters, "countries", egoCountry));
  const forField = nodes.filter((n) => matches(n, filters, "fields", egoCountry));
  const forInstitution = nodes.filter((n) => matches(n, filters, "institutions", egoCountry));

  const counts = {
    1: forHops.filter((n) => n.hop === 1).length,
    2: forHops.filter((n) => n.hop === 2).length,
    3: forHops.filter((n) => n.hop === 3).length,
  };

  const active =
    filters.countries.size + filters.institutions.size + filters.fields.size +
    (filters.query ? 1 : 0) + (filters.minYear ? 1 : 0) + (filters.minCollab ? 1 : 0) +
    (filters.excludeHomeCountry ? 1 : 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="eyebrow">Filters</span>
        {active > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px]"
            onClick={() => onChange({ ...emptyFilters(), topic: filters.topic })}
          >
            <X className="size-3" />
            Clear {active}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="space-y-3 px-3 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            {/* With type="search", the browser uses Escape to clear the field,
                and the mobile sheet can no longer be closed. */}
            <Input
              type="text"
              role="searchbox"
              aria-label="Search name or institution"
              placeholder="Search name or institution"
              className="h-8 pl-7 text-xs"
              value={filters.query}
              onChange={(e) => patch({ query: e.target.value.trim().toLowerCase() })}
            />
          </div>

          <fieldset className="space-y-1">
            <legend className="sr-only">Which people to show</legend>
            {HOPS.map((h) =>
              h.value === 3 && counts[3] === 0 ? null : (
                <Label
                  key={h.value}
                  title={h.hint}
                  className="flex cursor-pointer items-center gap-2 rounded-sm py-1 text-xs font-normal hover:text-primary"
                >
                  <Checkbox
                    checked={filters.hops.has(h.value)}
                    onCheckedChange={() => patch({ hops: toggle(filters.hops, h.value) })}
                  />
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: h.dot }}
                  />
                  <span className="flex-1 truncate">{h.label}</span>
                  <span className="tabular text-muted-foreground">{counts[h.value]}</span>
                </Label>
              ),
            )}
          </fieldset>

          <div className="space-y-1.5">
            <Label className="flex justify-between text-[11px] text-muted-foreground">
              Active since
              <span className="tabular font-medium text-foreground">
                {filters.minYear || "any year"}
              </span>
            </Label>
            <Slider
              min={1990}
              max={2026}
              value={[filters.minYear || 1990]}
              onValueChange={([v]) => patch({ minYear: v === 1990 ? 0 : v })}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="flex justify-between text-[11px] text-muted-foreground">
              Papers with you
              <span className="tabular font-medium text-foreground">
                {filters.minCollab ? `${filters.minCollab}+` : "any"}
              </span>
            </Label>
            <Slider
              min={0}
              max={10}
              value={[filters.minCollab]}
              onValueChange={([v]) => patch({ minCollab: v })}
            />
          </div>
        </div>

        {/* With all three open they swallow the column, so only Country is open by default */}
        <Facet
          title="Country"
          items={facet(forCountry, (n) => n.country)}
          selected={filters.countries}
          defaultOpen
          onToggle={(v) => patch({ countries: toggle(filters.countries, v) })}
        >
          {/* There used to be an "Other countries" basis for the recommendations, but
              it was a country filter, not an ordering. Placed here, it combines with any
              basis ("They cite you" and outside the country, for example). */}
          {egoCountry && (
            <Label className="mb-1 flex cursor-pointer items-center gap-2 border-b pb-1.5 text-xs font-normal hover:text-primary">
              <Checkbox
                checked={filters.excludeHomeCountry}
                onCheckedChange={(v) => patch({ excludeHomeCountry: v === true })}
              />
              <span className="flex-1">Outside {egoCountry}</span>
              <span className="tabular text-muted-foreground">
                {forCountry.filter((n) => n.hop !== 0 && n.country && n.country !== egoCountry).length}
              </span>
            </Label>
          )}
        </Facet>
        <Facet
          title="Field"
          items={facet(forField, (n) => n.topics?.[0]?.field)}
          selected={filters.fields}
          onToggle={(v) => patch({ fields: toggle(filters.fields, v) })}
        />
        <Facet
          title="Institution"
          items={facet(forInstitution, (n) => n.institution)}
          selected={filters.institutions}
          onToggle={(v) => patch({ institutions: toggle(filters.institutions, v) })}
        />
      </div>
    </div>
  );
}

function Facet({
  title, items, selected, onToggle, defaultOpen = false, children,
}: {
  title: string;
  items: { value: string; count: number }[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  defaultOpen?: boolean;
  /** Extra controls inserted above the list */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const [look, setLook] = useState("");

  // Keep a selected value even when other conditions bring it to 0. If it vanished,
  // it could not be unticked.
  const all = [...items];
  for (const v of selected) {
    if (!items.some((i) => i.value === v)) all.push({ value: v, count: 0 });
  }
  if (all.length === 0) return null;

  // An axis with many values is useless unless you can search it. Measured: 532 distinct
  // institutions (793 for a researcher with 508 papers) — too many to find by reading down.
  const needle = look.trim().toLowerCase();
  const shown = needle
    ? all.filter((i) => i.value.toLowerCase().includes(needle) || selected.has(i.value))
    : all;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-3 py-2 hover:bg-muted/60">
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-90",
          )}
        />
        <span className="eyebrow flex-1 text-left">{title}</span>
        {selected.size > 0 && (
          <span className="tabular rounded-sm bg-accent px-1.5 text-[10px] font-semibold text-accent-foreground">
            {selected.size}
          </span>
        )}
        <span className="tabular text-[10px] text-muted-foreground">{shown.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {all.length > 12 && (
          <div className="px-3 pb-1.5">
            <Input
              value={look}
              onChange={(e) => setLook(e.target.value)}
              placeholder={`Search ${all.length}…`}
              className="h-7 text-xs"
              aria-label={`Search ${title}`}
            />
          </div>
        )}
        <div className="max-h-56 overflow-y-auto overscroll-contain px-3 pb-2">
          {children}
          {shown.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground">Nothing matches “{look}”.</p>
          )}
          {shown.map(({ value, count }) => (
            <Label
              key={value}
              className={cn(
                "flex cursor-pointer items-center gap-2 py-0.5 text-xs font-normal hover:text-primary",
                count === 0 && "opacity-50",
              )}
            >
              <Checkbox
                checked={selected.has(value)}
                onCheckedChange={() => onToggle(value)}
              />
              <span className="min-w-0 flex-1 truncate" title={value}>
                {value}
              </span>
              <span className="tabular text-muted-foreground">{count}</span>
            </Label>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
