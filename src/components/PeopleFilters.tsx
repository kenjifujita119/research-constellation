"use client";

import { ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { choices, countActive, keeps, noFilter, type PeopleFilter, type Person } from "@/lib/shape";
import { COUNTRIES } from "@/lib/countries";
import { cn } from "@/lib/utils";

/** Narrow down the shape.
 *
 *  This is the left panel of the collaborator search page, brought over here. You want to do the
 *  same when looking at your co-authors: "who did I write with in the UK?", "who am I still
 *  writing with in the last 5 years?".
 *
 *  Institution and country are the values given on the papers, not current affiliations, because
 *  looking up each person's current affiliation would take 1,197 requests for a researcher with
 *  508 papers. The page says so too; otherwise a 10-year-old affiliation would be read as current.
 *
 *  Every count is taken over "everyone who passes every condition except this axis". */
export default function PeopleFilters({
  people,
  filter,
  onChange,
}: {
  people: Person[];
  filter: PeopleFilter;
  onChange: (next: PeopleFilter) => void;
}) {
  const patch = (p: Partial<PeopleFilter>) => onChange({ ...clone(filter), ...p });
  const active = countActive(filter);
  const shown = people.filter((p) => keeps(p, filter)).length;

  // Only the years people actually last wrote with you. The slider ran from year 0 to today,
  // so dragging it landed on years like 1187, where nothing can change.
  const lastYears = people.map((p) => p.until).filter(Boolean);
  const first = lastYears.length ? Math.min(...lastYears) : 0;
  const last = lastYears.length ? Math.max(...lastYears) : 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
          <SlidersHorizontal className="size-3.5" />
          <span className="hidden sm:inline">Filters</span>
          {active > 0 && (
            <span className="tabular rounded-sm bg-primary/15 px-1 text-[10px] font-semibold text-primary">
              {active}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[75svh] w-80 overflow-y-auto p-0">
        <div className="flex items-baseline justify-between gap-2 border-b px-3 py-2">
          <span className="eyebrow">Who to show</span>
          <span className="tabular text-[10px] text-muted-foreground">
            {shown} of {people.length}
          </span>
        </div>

        <div className="space-y-3 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter.query}
              onChange={(e) => patch({ query: e.target.value.toLowerCase() })}
              placeholder="Name or institution"
              className="h-8 pl-8 text-xs"
              spellCheck={false}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="flex justify-between text-[11px] text-muted-foreground">
              How close
              <span className="tabular font-medium text-foreground">
                {filter.minPapers === 1 ? "everyone" : `${filter.minPapers}+ papers`}
              </span>
            </Label>
            <Slider
              min={0}
              max={4}
              step={1}
              value={[Math.max(0, STEPS.indexOf(filter.minPapers))]}
              onValueChange={([v]) => patch({ minPapers: STEPS[v] })}
            />
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              A big career cannot be read all at once, so it opens from the closest out.
              The shape and the list both follow this; move it to the left to bring
              everyone in.
            </p>
          </div>

          {last > first && (
            <div className="space-y-1.5">
              <Label className="flex justify-between text-[11px] text-muted-foreground">
                Latest paper together in or after
                <span className="tabular font-medium text-foreground">
                  {filter.activeSince || "any year"}
                </span>
              </Label>
              <Slider
                min={first}
                max={last}
                step={1}
                value={[filter.activeSince || first]}
                onValueChange={([v]) => patch({ activeSince: v <= first ? 0 : v })}
              />
            </div>
          )}

          {/* No "outside your country" tick: the Country list below does the same thing, and
              says which countries are actually there. */}
        </div>

        <Facet
          label="Country"
          rows={choices(people, filter, "countries")}
          chosen={filter.countries}
          name={(code) => COUNTRIES[code]?.name ?? code}
          onToggle={(v) => patch({ countries: toggle(filter.countries, v) })}
        />
        <Facet
          label="Institution"
          rows={choices(people, filter, "institutions")}
          chosen={filter.institutions}
          onToggle={(v) => patch({ institutions: toggle(filter.institutions, v) })}
          note="From the papers you wrote together, so it may not be where they are now."
        />
        <Facet
          label="What you worked on"
          rows={choices(people, filter, "topics")}
          chosen={filter.topics}
          onToggle={(v) => patch({ topics: toggle(filter.topics, v) })}
        />

        {active > 0 && (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full text-xs text-muted-foreground"
              // Keep "How close". It is a reading order, not a filter, and clearing it
              // brings up 1,197 people at once and freezes the page.
              onClick={() => onChange({ ...noFilter(), minPapers: filter.minPapers })}
            >
              <X className="size-3" />
              Clear {active} {active === 1 ? "filter" : "filters"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The values "How close" can take. A continuous scale would let you pick meaningless
 *  in-between values. */
const STEPS = [1, 2, 3, 5, 10];

const clone = (f: PeopleFilter): PeopleFilter => ({
  ...f,
  countries: new Set(f.countries),
  institutions: new Set(f.institutions),
  topics: new Set(f.topics),
});

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** A collapsible group of options. Long ones show only the top 8 at first. */
function Facet({
  label,
  rows,
  chosen,
  onToggle,
  name = (v) => v,
  note,
}: {
  label: string;
  rows: [string, number][];
  chosen: Set<string>;
  onToggle: (value: string) => void;
  name?: (value: string) => string;
  note?: string;
}) {
  const [all, setAll] = useState(false);
  if (rows.length === 0) return null;
  const visible = all ? rows : rows.slice(0, 8);

  return (
    <Collapsible defaultOpen={chosen.size > 0} className="border-t">
      <CollapsibleTrigger className="group flex w-full items-baseline gap-2 px-3 py-2 text-left hover:bg-muted/50">
        <ChevronRight className="size-3 shrink-0 self-center text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" />
        <span className="eyebrow flex-1">{label}</span>
        <span className="tabular text-[10px] text-muted-foreground">
          {chosen.size > 0 ? `${chosen.size} chosen` : rows.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-2">
        {note && (
          <p className="px-3 pb-1.5 text-[10px] leading-relaxed text-muted-foreground">{note}</p>
        )}
        <ul>
          {visible.map(([value, n]) => (
            <li key={value}>
              <Label
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-3 py-1 text-[11px] font-normal hover:bg-muted/50",
                  chosen.has(value) && "font-medium",
                )}
              >
                <Checkbox checked={chosen.has(value)} onCheckedChange={() => onToggle(value)} />
                <span className="min-w-0 flex-1 truncate">{name(value)}</span>
                <span className="tabular text-[10px] text-muted-foreground">{n}</span>
              </Label>
            </li>
          ))}
        </ul>
        {rows.length > 8 && (
          <button
            type="button"
            onClick={() => setAll((v) => !v)}
            className="px-3 py-1 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
