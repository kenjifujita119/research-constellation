"use client";

import {
  ArrowLeft,
  Boxes,
  ChevronRight,
  Globe,
  ListOrdered,
  Loader2,
  Pause,
  Play,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Explain from "@/components/Explain";
import FindCollaborators from "@/components/FindCollaborators";
import Freshness from "@/components/Freshness";
import Hint from "@/components/Hint";
import ParamGate from "@/components/ParamGate";
import ReachGlobe, { type Reach, type Slice } from "@/components/ReachGlobe";
import SpinToggle from "@/components/SpinToggle";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Slider } from "@/components/ui/slider";
import { COUNTRIES } from "@/lib/countries";
import { publicationsNote } from "@/lib/counting";
import { fetchCountryReach, fetchStatus, startWorksBuild } from "@/lib/api";
import type { CountryReach } from "@/lib/types";
import { useReachGraph } from "@/lib/useWorks";
import { shapeHref } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** The screen for seeing who your work has been useful to.
 *
 *  Based on the measurement that a sense of contribution comes from outside: from who your
 *  work turned out to be useful to. Citation counts exclude self-citations by default. This
 *  is a design promise: the moment it is dropped, this feature turns into one where people who
 *  pad their numbers with self-citation look the most impressive.
 *
 *  It used to be 3D with papers as nodes, but with 800 dots scattered about there was no telling
 *  where to look, and it was judged to "get nothing across". Countries are a coordinate system
 *  everyone knows, so watching them fill in reads directly as the work spreading. */
/** Colour for whatever falls outside the top 6 areas. Grey stands for "read widely but thinly".
 *
 *  It sits on a dark globe, so a dark grey would only look like a hole. Japan (for a researcher
 *  with 508 papers) has 37% in this "other"; making it an invisible colour would be the same as
 *  pretending that 37% did not exist. */
const OTHER = "#7e8798";

export default function ReachPage() {
  // When a refresh finishes, rebuild just the view. No page reload (same reason as on the
  // Shape screen).
  const [round, setRound] = useState(0);
  return (
    <ParamGate name="orcid">
      {(orcid) => (
        <ReachView key={round} orcid={orcid} onReload={() => setRound((r) => r + 1)} />
      )}
    </ParamGate>
  );
}

function ReachView({ orcid, onReload }: { orcid: string; onReload: () => void }) {

  // The globe does not need the citing papers themselves; the totals are in meta.
  // It is a separate job from the papers, so it is often ready in the background while you are
  // looking at the Shape page.
  const { data, messages, elapsed, error } = useReachGraph(orcid);
  const [picked, setPicked] = useState<{ code: string; name: string; count: number } | null>(null);
  // The country whose breakdown is open. Set from both a globe click and a list click.
  const [opened, setOpened] = useState<string | null>(null);
  const [detail, setDetail] = useState<CountryReach | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  // A refresh is running. Reload when it finishes.
  const [refreshing, setRefreshing] = useState(false);
  // On narrow screens the globe and the list do not fit side by side. The list is the default:
  // screen readers cannot read the globe, so the one you can read as text comes first.
  const [narrowView, setNarrowView] = useState<"list" | "globe">("list");
  const [year, setYear] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // The user decides whether it spins. What you are trying to read cannot be read if it keeps
  // moving on its own.
  const [spin, setSpin] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reach = useMemo(() => (data?.meta.reach_by_country ?? {}) as Reach, [data]);

  const span = useMemo(() => {
    const years = Object.values(reach).flatMap((rows) => rows.map(([y]) => y));
    if (!years.length) return [2000, 2026] as const;
    // Nobody can cite you before your first paper came out. Earlier years are bad dates in
    // OpenAlex (one showed as 1943, stretching the slider over decades of nothing), so start at
    // the first paper. Those citations still count from that year on.
    const first = data?.meta.years[0];
    const start = first ? Math.max(Math.min(...years), first) : Math.min(...years);
    return [start, Math.max(start, ...years)] as const;
  }, [reach, data]);
  const upTo = year ?? span[1];

  // The whole span plays in 20 seconds, the same length as playback on the Shape screen.
  useEffect(() => {
    if (!playing) return;
    const steps = Math.max(span[1] - span[0], 1);
    timer.current = setInterval(
      () =>
        setYear((y) => {
          const next = (y ?? span[0]) + 1;
          if (next >= span[1]) {
            setPlaying(false);
            return span[1];
          }
          return next;
        }),
      Math.max(120, 20000 / steps),
    );
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, span]);

  /** A colour per field. Handing them out by golden angle is the same rule as on the Shape screen.
   *  Bigger fields get lower numbers, so their colours stay stable. */
  const fieldColour = useMemo(() => {
    const size = new Map<string, number>();
    for (const rows of Object.values(data?.meta.fields_by_country ?? {})) {
      for (const [field, n] of rows) size.set(field, (size.get(field) ?? 0) + n);
    }
    const order = [...size.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    return new Map(
      // three's Color cannot parse space-separated hsl() and draws it plain white instead.
      // Write it comma-separated.
      order.map(
        ([field], i) => [field, `hsl(${((i * 137.508) % 360).toFixed(1)}, 62%, 58%)`] as const,
      ),
    );
  }, [data]);

  /** Country -> the field citing you most from that country. Used for the colour and the list. */
  const topField = useMemo(() => {
    const out = new Map<string, string>();
    for (const [code, rows] of Object.entries(data?.meta.fields_by_country ?? {})) {
      if (rows[0]) out.set(code, rows[0][0]);
    }
    return out;
  }, [data]);

  /** Country -> breakdown of its citations. Not one colour per country.
   *
   *  Measured: the top area is less than half of a country's citations in 79% of countries for a
   *  researcher with 508 papers (median 38%), and in 20% for Kenji. Japan has 444 citations across
   *  63 areas with the top one at only 33%; painting it a single green would throw away the other
   *  two thirds.
   *
   *  The top 6 areas are shown at their real size, and whatever falls outside them is grouped into
   *  a grey "other". A country with a large "other" reads as "read widely but thinly". */
  const mixOf = useMemo(() => {
    const rows = data?.meta.fields_by_country ?? {};
    const totals = data?.meta.area_total_by_country ?? {};
    const only: Slice[] = [{ color: OTHER, share: 1 }];
    const table = new Map<string, Slice[]>(
      Object.entries(rows).map(([code, top]) => {
        const total = totals[code] ?? top.reduce((a, [, n]) => a + n, 0);
        if (!total) return [code, only] as const;
        const out: Slice[] = top.map(([field, n]) => ({
          color: fieldColour.get(field) ?? OTHER,
          share: n / total,
        }));
        const rest = 1 - out.reduce((a, v) => a + v.share, 0);
        // A remainder under 2% would not show up as a band, so it is not added.
        if (rest > 0.02) out.push({ color: OTHER, share: rest });
        return [code, out.length ? out : only] as const;
      }),
    );
    return (code: string): Slice[] => table.get(code) ?? only;
  }, [data, fieldColour]);

  /** The small marker in the list shows the same breakdown. If the globe is mixed but the list is
   *  one colour, you cannot tell which one is true. A vertical CSS gradient makes the same
   *  bands. */
  const barOf = useMemo(
    () => (code: string) => {
      const slices = mixOf(code);
      if (slices.length === 1) return slices[0].color;
      let at = 0;
      const stops: string[] = [];
      for (const s of slices) {
        const to = at + s.share * 100;
        stops.push(`${s.color} ${at.toFixed(1)}% ${to.toFixed(1)}%`);
        at = to;
      }
      return `linear-gradient(to bottom, ${stops.join(", ")})`;
    },
    [mixOf],
  );

  /** What share of a country's citations its top area accounts for. Shown in the list: with
   *  "33%" written next to it, nobody reads that country as a single-topic country. */
  const topShare = useMemo(() => {
    const rows = data?.meta.fields_by_country ?? {};
    const totals = data?.meta.area_total_by_country ?? {};
    return (code: string): number | null => {
      const top = rows[code]?.[0];
      const total = totals[code] ?? 0;
      return top && total ? top[1] / total : null;
    };
  }, [data]);

  /** Countries reached by that year, most first. The order changes as the years play. */
  const ranked = useMemo(() => {
    const rows: { code: string; name: string; n: number; field: string | null; rank: number }[] =
      [];
    for (const [code, years] of Object.entries(reach)) {
      const n = years.reduce((acc, [y, c]) => (y <= upTo ? acc + c : acc), 0);
      if (!n) continue;
      rows.push({
        code,
        name: COUNTRIES[code]?.name ?? code,
        n,
        field: topField.get(code) ?? null,
        rank: 0,
      });
    }
    rows.sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1));
    // Countries with the same count share a place. Numbering them 4, 5, 6 would rank what is a
    // tie, decided by nothing but the alphabet.
    rows.forEach((r, i) => {
      r.rank = i > 0 && rows[i - 1].n === r.n ? rows[i - 1].rank : i + 1;
    });
    return rows;
  }, [reach, upTo, topField]);

  /** Countries reached by that year, and the number of papers citing you. Keeps the figures in
   *  the top left in step with the year.
   *
   *  The paper count is tallied separately, not summed over countries. A paper whose authors span
   *  several countries is counted once per country, so calling the sum "papers" would inflate it
   *  (Measured: for Kenji the country total is 507, against 299 actual citing papers). */
  const sofar = useMemo(() => {
    let countries = 0;
    let offMap = 0;
    for (const [code, rows] of Object.entries(reach)) {
      const n = rows.reduce((acc, [y, c]) => (y <= upTo ? acc + c : acc), 0);
      if (!n) continue;
      countries += 1;
      if (!COUNTRIES[code]) offMap += 1;
    }
    const papers = (data?.meta.citing_by_year ?? []).reduce(
      (acc, [y, c]) => (y <= upTo ? acc + c : acc),
      0,
    );
    return { countries, papers, offMap };
  }, [reach, upTo, data]);

  /** Open or close a country. Clear the previous country's breakdown before fetching. */
  const openCountry = (code: string | null) => {
    setOpened(code);
    setDetail(null);
    setDetailFailed(false);
  };

  // Once a country and year are set, fetch the breakdown. Moving the year updates the numbers.
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    fetchCountryReach(orcid, opened, upTo)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetailFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [orcid, opened, upTo]);

  // Whether it is loading is derived rather than kept as another piece of state. Calling
  // setState inside an effect sets off a chain of renders.
  const loadingDetail = opened !== null && detail === null && !detailFailed;

  useEffect(() => {
    if (!refreshing) return;
    const timer = setInterval(async () => {
      try {
        const st = await fetchStatus(`${orcid}_reach`);
        if (st.status === "running") return;
        clearInterval(timer);
        onReload();
      } catch {
        // The status may not exist yet. Try again on the next tick.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [refreshing, orcid, onReload]);

  if (error) {
    return (
      <main className="grid h-svh place-items-center p-10 text-center">
        <div>
          <h1 className="text-sm font-semibold">Could not load this reach map</h1>
          <p className="mt-1.5 text-xs text-muted-foreground">{error}</p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href="/">Start over</Link>
          </Button>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="grid h-svh place-items-center p-10">
        <div className="w-full max-w-sm text-center">
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Finding everyone who has cited you
          </p>
          {/* Do not hide this wait. Citations are fetched by asking OpenAlex about one paper
              at a time, so the more someone has published, the longer it takes. Measured:
              8 seconds for someone with 37 papers, 2 min 8 s for someone with 505. With the
              reason written down, people can wait. */}
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Every one of your publications has to be looked up separately, so this
            takes from a few seconds to about two minutes depending on how much you
            have written. It is then kept on this device for 30 days.
          </p>
          {messages.length > 0 && (
            <p className="tabular mt-3 truncate text-[11px] text-muted-foreground">
              {messages[messages.length - 1]}
              {elapsed > 0 && ` · ${Math.round(elapsed)}s`}
            </p>
          )}
          <Button asChild variant="outline" size="sm" className="mt-5">
            <Link href={shapeHref(orcid)}>
              <Boxes className="size-3.5" />
              Look at your shape while you wait
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  const m = data.meta;
  // The promise: the default figure excludes self-citations. It is counted from the citing
  // papers that were read, not taken from OpenAlex's headline totals minus the self-citations
  // found — those two come from different counts and did not add up (395 − 42 = 353, against
  // 338 citations actually read for Kenji).
  const links = m.citation_links ?? 0;
  // If the fetch cap was hit, every count here is only "at least".
  const atLeast = m.citing_capped ? "≥" : "";
  const unscored = m.n_works - (m.n_fwci ?? 0);

  return (
    <div className="flex h-svh flex-col overflow-clip">
      <header className="flex shrink-0 items-center gap-3 border-b bg-card px-3 py-2">
        <Button asChild variant="ghost" size="icon" className="size-8 shrink-0">
          <Link href="/" aria-label="Start over">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold leading-tight">
            {data.ego_name ?? orcid}
          </h1>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            <Explain text={publicationsNote(m)}>{m.n_works} publications</Explain> ·{" "}
            {m.years[0]}–{m.years[1]}
          </p>
        </div>
        <Freshness
          builtAt={m.built_at}
          busy={refreshing}
          onRefresh={() => {
            startWorksBuild(orcid, true).then(() => setRefreshing(true));
          }}
        />
        <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
          <Link href={shapeHref(orcid)} aria-label="Shape">
            <Boxes className="size-3.5" />
            <span className="hidden sm:inline">Shape</span>
          </Link>
        </Button>
        <FindCollaborators orcid={orcid} works={m.n_works} />
      </header>

      {/* Reach summary. The figures are computed from everything that was fetched, so the
          headings are accurate even when only part of it is lit on the globe. */}
      {/* "Areas reached" and "top 10%" are gone: a count of areas says nothing about whether
          reaching more of them is good, and both were hard to read. What is left can each be
          explained in a sentence, and the sentence is one hover or tap away. */}
      <dl className="grid shrink-0 grid-cols-3 gap-px border-b bg-border">
        <Stat
          k="Countries reached"
          v={`${atLeast}${m.n_countries}`}
          icon
          explain="Countries with at least one author on a paper that cites yours. A paper written from three countries counts for all three."
        />
        <Stat
          k="Citations"
          v={`${atLeast}${links.toLocaleString()}`}
          note={`from ${atLeast}${m.n_citing.toLocaleString()} papers · not your own`}
          explain={
            <>
              <p>
                {m.n_citing.toLocaleString()} papers cite your work, {links.toLocaleString()}{" "}
                times in all: a paper that cites three of yours counts three times.
              </p>
              <p>
                {m.self_citations.toLocaleString()} citations from your own papers are left
                out. Your co-authors citing you in their own papers still count.
              </p>
              <p className="text-muted-foreground">
                OpenAlex&apos;s headline total for your papers is{" "}
                {m.cited_by_total.toLocaleString()}. It includes self-citations and is counted
                separately, so the two do not match exactly.
              </p>
              {m.citing_capped && (
                <p>
                  Only the first {(m.max_citing ?? 40000).toLocaleString()} citing papers could
                  be read, so the real figures are higher.
                </p>
              )}
            </>
          }
        />
        <Stat
          k="Above field average"
          v={m.n_fwci ? `${m.n_fwci_above ?? 0} of ${m.n_fwci}` : "—"}
          note="papers with a field score"
          explain={
            <>
              <p>
                Field-weighted citation impact (FWCI, from OpenAlex) compares a paper&apos;s
                citations in the year it came out and the three years after with the average
                for papers of the same year, type and field. Above 1 means cited more than
                that average.
              </p>
              {unscored > 0 && (
                <p>
                  {unscored} of your {m.n_works} papers have no score yet, mostly the most
                  recent ones.
                </p>
              )}
              {m.fwci_median != null && (
                <p className="text-muted-foreground">
                  The middle of your scores (median) is {m.fwci_median.toFixed(2)}.
                </p>
              )}
            </>
          }
        />
      </dl>

      <div className="flex min-h-0 flex-1">
      <div
        className={cn(
          "relative min-h-0 flex-1 bg-canvas",
          narrowView === "globe" ? "block" : "hidden md:block",
        )}
      >
        <ReachGlobe
          reach={reach}
          mixOf={mixOf}
          upTo={upTo}
          spin={spin && !picked && !opened}
          selected={opened}
          onPick={setPicked}
          onOpen={openCountry}
        />

        <div className="pointer-events-none absolute left-3 top-3 rounded-sm bg-black/55 px-3 py-2 text-[11px] leading-relaxed text-white/80 backdrop-blur-sm">
          <p className="tabular text-2xl font-semibold leading-none text-white">{upTo}</p>
          <p className="mt-1.5">
            {sofar.countries} {sofar.countries === 1 ? "country" : "countries"} ·{" "}
            {sofar.papers.toLocaleString()} citing publications
          </p>
          {sofar.offMap > 0 && (
            <p className="mt-1 text-white/45">{sofar.offMap} not on the map</p>
          )}
        </div>

        {picked ? (
          <div className="pointer-events-none absolute right-3 top-3 max-w-xs rounded-sm bg-black/55 px-3 py-2 text-[11px] leading-relaxed text-white/80 backdrop-blur-sm">
            <p className="font-semibold text-white">{picked.name}</p>
            <p className="mt-1 text-white/65">
              {picked.count.toLocaleString()} citing{" "}
              {picked.count === 1 ? "publication" : "publications"} by {upTo}
            </p>
          </div>
        ) : (
          <Hint id="reach-globe" title="Where your work landed" className="absolute right-3 top-3">
            Each light is a country whose researchers cited you, sized by how many of
            their papers did, and coloured by the research areas those papers are in.
            Most countries cite you from several areas, so most lights are more than one
            colour. The list on the right re-sorts as the years play. Your own citations
            of yourself are not counted.
          </Hint>
        )}

        <SpinToggle spinning={spin} onChange={setSpin} className="absolute bottom-3 left-3" />
      </div>

      {/* Size on the globe alone does not tell you who reads you most, in order. A list that
          re-sorts with the year sits alongside. */}
      <aside
        className={cn(
          "min-h-0 shrink-0 flex-col overflow-hidden border-l bg-card md:flex md:w-60",
          narrowView === "list" ? "flex w-full" : "hidden",
        )}
      >
        {opened ? (
          <CountryDetail
            code={opened}
            name={COUNTRIES[opened]?.name ?? opened}
            colour={barOf(opened)}
            upTo={upTo}
            detail={detail}
            loading={loadingDetail}
            onClose={() => openCountry(null)}
          />
        ) : (
          <>
        <div className="flex items-baseline justify-between border-b px-3 py-2">
          <h2 className="eyebrow">Who cites you</h2>
          <Explain
            align="end"
            className="tabular text-[10px] text-muted-foreground"
            text={
              <>
                <p>
                  The number is how many papers from that country cited you by {upTo}. It
                  follows the year slider.
                </p>
                <p>
                  The colour band and the line under the name describe all years: the
                  largest research area among that country&apos;s citing papers, and its
                  share of them.
                </p>
              </>
            }
          >
            papers, by {upTo}
          </Explain>
        </div>
        <ol className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {ranked.map((row) => (
            <li key={row.code}>
              <button
                type="button"
                onClick={() => openCountry(row.code)}
                className={cn(
                  "flex w-full items-baseline gap-2 border-b px-3 py-1.5 text-left text-[11.5px] hover:bg-muted/60",
                  picked?.code === row.code && "bg-muted/40",
                )}
              >
                <span className="tabular w-4 shrink-0 text-right text-[10px] text-muted-foreground">
                  {row.rank}
                </span>
                <span
                  className="mt-0.5 h-4 w-1.5 shrink-0 rounded-sm"
                  style={{ background: barOf(row.code) }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{row.name}</span>
                  {row.field && (
                    <span className="flex gap-1 text-[10px] text-muted-foreground">
                      {/* The percentage goes first. After the name, a long area name
                          pushes it out and it gets cut off, and the moment it is cut off
                          the country reads as "that country = that topic". */}
                      {topShare(row.code) !== null && (
                        <span className="tabular shrink-0 font-medium">
                          {Math.round(topShare(row.code)! * 100)}%
                        </span>
                      )}
                      <span className="min-w-0 truncate">{row.field}</span>
                    </span>
                  )}
                </span>
                <span className="tabular shrink-0 font-semibold">{row.n}</span>
              </button>
            </li>
          ))}
          {ranked.length === 0 && (
            <li className="px-3 py-3 text-[11px] text-muted-foreground">
              Nobody had cited you yet by {upTo}.
            </li>
          )}
        </ol>
          </>
        )}
      </aside>
      </div>

      {/* The switch for narrow screens. Same layout as the co-author view. */}
      <nav className="flex shrink-0 border-t bg-card md:hidden">
        {(
          [
            ["list", "Countries", ListOrdered],
            ["globe", "Globe", Globe],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setNarrowView(key)}
            aria-pressed={narrowView === key}
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center gap-1.5 text-xs transition-colors duration-200",
              narrowView === key
                ? "border-t-2 border-primary font-semibold text-primary"
                : "border-t-2 border-transparent text-muted-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-3 border-t bg-card px-4 py-3">
        <Button
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          onClick={() => {
            if (!playing && upTo >= span[1]) setYear(span[0]);
            setPlaying((p) => !p);
          }}
          aria-label={playing ? "Pause" : "Play the years"}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <span className="tabular w-10 shrink-0 text-xs text-muted-foreground">{span[0]}</span>
        <Slider
          min={span[0]}
          max={span[1]}
          step={1}
          value={[upTo]}
          onValueChange={([v]) => {
            setPlaying(false);
            setYear(v);
          }}
          className="flex-1"
        />
        <span className="tabular w-10 shrink-0 text-right text-xs text-muted-foreground">
          {span[1]}
        </span>
      </div>
    </div>
  );
}

/** A country's breakdown: which areas read you there, and which of your papers they read.
 *
 *  It follows the year. The globe and the list move with the year, so a breakdown covering the
 *  whole period would make the numbers look inconsistent. */
function CountryDetail({
  name,
  colour,
  upTo,
  detail,
  loading,
  onClose,
}: {
  code: string;
  name: string;
  colour: string;
  upTo: number;
  detail: CountryReach | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 border-b px-3 py-2">
        {/* The same band as in the list. As a circle, the gradient gets squeezed into 10px
            and becomes just a smudge. */}
        <span
          className="mt-1 h-5 w-1.5 shrink-0 rounded-sm"
          style={{ background: colour }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold leading-tight">{name}</h2>
          <p className="tabular text-[10px] text-muted-foreground">
            {detail ? `${detail.n_citing} citing publications by ${upTo}` : `by ${upTo}`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          onClick={onClose}
          aria-label="Back to the list"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        {loading && !detail && (
          <p className="flex items-center gap-2 py-2 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Reading the citations…
          </p>
        )}

        {detail && detail.n_citing === 0 && (
          <p className="py-2 text-[11px] text-muted-foreground">
            Nobody from here had cited you by {upTo}.
          </p>
        )}

        {detail && detail.n_citing > 0 && (
          <div className="-mx-3">
            {/* The areas of the citing papers, not of the papers they cite: "what they cited
                you for" claimed more than the data knows. Both counts are totals, with a note
                when only the largest are listed — "8" used to stand for 8 of 19. */}
            <Fold
              title="Areas of the citing papers"
              count={detail.n_areas}
              note={detail.by_area.length < detail.n_areas ? `largest ${detail.by_area.length}` : undefined}
              defaultOpen
            >
              <ul className="space-y-0.5 px-3 pb-2">
                {detail.by_area.map(([area, n]) => (
                  <li key={area} className="flex items-baseline gap-2 text-[11.5px] leading-snug">
                    <span className="min-w-0 flex-1 truncate">{area}</span>
                    <span className="tabular shrink-0 text-muted-foreground">{n}</span>
                  </li>
                ))}
              </ul>
            </Fold>

            <Fold
              title="Your papers they cited"
              count={detail.n_your_papers}
              note={
                detail.your_papers.length < detail.n_your_papers
                  ? `most cited ${detail.your_papers.length}`
                  : undefined
              }
            >
              <ul className="space-y-1.5 px-3 pb-2">
                {detail.your_papers.map((p) => (
                  <li key={p.id} className="text-[11.5px] leading-snug">
                    {p.doi ? (
                      <a
                        href={p.doi}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-2"
                      >
                        {p.title ?? "Untitled"}
                      </a>
                    ) : (
                      (p.title ?? "Untitled")
                    )}{" "}
                    <span className="tabular text-muted-foreground">
                      ({p.year}) · by {p.n} {p.n === 1 ? "paper" : "papers"}
                    </span>
                  </li>
                ))}
              </ul>
            </Fold>

            <Fold
              title="Publications from here"
              count={detail.n_citing}
              note={
                detail.citing.length < detail.n_citing
                  ? `showing ${detail.citing.length}`
                  : undefined
              }
            >
              <ul className="space-y-1.5 px-3 pb-2">
                {detail.citing.map((w) => (
                  <li key={w.id} className="text-[11.5px] leading-snug">
                    {w.doi ? (
                      <a
                        href={w.doi}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-2"
                      >
                        {w.title ?? "Untitled"}
                      </a>
                    ) : (
                      (w.title ?? "Untitled")
                    )}{" "}
                    <span className="tabular text-muted-foreground">({w.year})</span>
                  </li>
                ))}
              </ul>
            </Fold>
          </div>
        )}
      </div>
    </div>
  );
}

/** A collapsible section. With all three open, you have to scroll to reach the bottom one
 *  ("Publications from here"). Only the headings and counts are always visible, and you open
 *  the one you want to read. */
function Fold({
  title,
  count,
  note,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  note?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-3 py-2 text-left hover:bg-muted/60">
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-90",
          )}
        />
        <span className="eyebrow flex-1">{title}</span>
        {note && <span className="text-[10px] text-muted-foreground">{note}</span>}
        <span className="tabular text-[10px] font-semibold text-muted-foreground">{count}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Stat({
  k,
  v,
  note,
  icon,
  explain,
}: {
  k: string;
  v: string | number;
  note?: string;
  icon?: boolean;
  /** What the figure counts. Opens on hover or tap of the label */
  explain?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-card px-3 py-2">
      <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon && <Globe className="size-3 shrink-0" />}
        {explain ? <Explain text={explain}>{k}</Explain> : k}
      </dt>
      <dd className="tabular text-lg font-semibold leading-none">{v}</dd>
      {note && <dd className="text-[10px] text-muted-foreground">{note}</dd>}
    </div>
  );
}
