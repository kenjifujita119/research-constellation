"use client";

import {
  ArrowLeft,
  Boxes,
  Globe,
  ListOrdered,
  Loader2,
  Maximize2,
  Move3d,
  Pause,
  Play,
  RotateCw,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Explain from "@/components/Explain";
import FindCollaborators from "@/components/FindCollaborators";
import Freshness from "@/components/Freshness";
import MyPapers from "@/components/MyPapers";
import ParamGate from "@/components/ParamGate";
import PeopleFilters from "@/components/PeopleFilters";
import PeopleList from "@/components/PeopleList";
import ShapeGraph, {
  SHAPE_COLOR_LABELS,
  SHAPE_COLOR_NOTES,
  type ShapeColor,
} from "@/components/ShapeGraph";
import SpinToggle from "@/components/SpinToggle";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { buildShape, keeps, noFilter, type PeopleFilter, type Person } from "@/lib/shape";
import { fetchStatus, startWorksBuild } from "@/lib/api";
import { publicationsNote } from "@/lib/counting";
import { useReachReady, useWorksGraph } from "@/lib/useWorks";
import { reachHref } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** The shape of a research career.
 *
 *  The shape is unique to each person — the force layout gives the same result for the same
 *  input (Measured: two runs matched bit for bit). The outline (elongated or round) means
 *  nothing, though: as the numbers grow, every researcher converges on 1 : 0.85 : 0.79.
 *  What carries meaning is the internal structure, and showing that is the job of the colours. */
export default function ShapePage() {
  // When a rebuild finishes, re-create only the view. Don't reload the page — citations are
  // still being fetched in the background in this tab, so a reload would stop that and waste
  // the OpenAlex free allowance spent so far.
  const [round, setRound] = useState(0);
  return (
    <ParamGate name="orcid">
      {(orcid) => (
        <ShapeView key={round} orcid={orcid} onReload={() => setRound((r) => r + 1)} />
      )}
    </ParamGate>
  );
}

function ShapeView({ orcid, onReload }: { orcid: string; onReload: () => void }) {

  // Papers are read when this page asks for them, not on the entry page.
  // Citations carry on being fetched behind it on their own — only the globe lights up later.
  const { data, building, messages, elapsed, error } = useWorksGraph(orcid);
  // The globe is built in the background. Letting people click before it is ready drops them
  // on an empty page.
  const reachReady = useReachReady(orcid);
  const [picked, setPicked] = useState<Person | null>(null);
  // Rebuild after "not my paper" is saved. The shape is built from this list, so the view
  // stays out of date until the list is fetched again.
  const [rebuilding, setRebuilding] = useState(false);
  const [stats, setStats] = useState({ people: 0, clusters: 0 });
  // On a narrow screen the 3D view cannot be rotated, and a canvas is invisible to screen
  // readers. Show the same content as a list too; the list is the default.
  const [narrowView, setNarrowView] = useState<"list" | "shape">("list");
  const [year, setYear] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [colorBy, setColorBy] = useState<ShapeColor>("topic");
  // Playback settings. range is [start, end]; seconds is how long the whole playback takes.
  const [range, setRange] = useState<[number, number] | null>(null);
  const [seconds, setSeconds] = useState(20);
  // In three, autoRotateSpeed 2.0 is one turn every 30 seconds. Default to a speed that feels
  // right.
  const [rotation, setRotation] = useState(4);
  // Always keep a way to stop it on screen. If the only control is the speed setting tucked
  // away in the settings, people cannot find it when they want it to stop.
  const [spin, setSpin] = useState(true);
  // How it spreads out. spread = how far from the centre; spacing = how far apart people sit.
  const [spread, setSpread] = useState(230);
  const [spacing, setSpacing] = useState(4);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const span = useMemo(() => {
    const ys = (data?.works ?? []).map((w) => w.year).filter((y): y is number => !!y);
    return ys.length ? ([Math.min(...ys), Math.max(...ys)] as const) : ([2000, 2026] as const);
  }, [data]);

  const from = range?.[0] ?? span[0];
  const to = range?.[1] ?? span[1];
  const upTo = year ?? to;

  // "Your career in N seconds": play back the shape as it grows.
  // The interval per year is the chosen number of seconds divided by the number of years.
  useEffect(() => {
    if (!playing) return;
    const steps = Math.max(to - from, 1);
    const every = Math.max(120, (seconds * 1000) / steps);
    timer.current = setInterval(() => {
      setYear((y) => {
        const next = (y ?? from) + 1;
        if (next > to) {
          setPlaying(false);
          return to;
        }
        return next;
      });
    }, every);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, from, to, seconds]);

  // People for the list. Built from the same rules as the shape (lib/shape.ts is the single
  // source).
  const people = useMemo(() => (data ? buildShape(data.works).people : []), [data]);

  /** The minimum number of shared papers for someone to be drawn. It sets an order, not a cap
   *  — a big career drawn all at once is unreadable, so start from the closest relationships
   *  and open out from there.
   *
   *  The default is the smallest threshold that keeps it to 250 people or fewer. Kenji
   *  (87 people) gets everyone from 1 paper; a researcher with 508 papers (1,197 people)
   *  starts with the 240 who share 3 or more (Measured: 56% share only 1 paper, 44% share 2
   *  or more, 20% share 3 or more). */
  const readable = useMemo(() => {
    for (const cut of [1, 2, 3, 5, 10]) {
      if (people.filter((p) => p.papers >= cut).length <= 250) return cut;
    }
    return 10;
  }, [people]);

  // Filters. Left at the default until touched — the default minPapers depends on the number
  // of people, so it cannot be fixed before the data arrives.
  const [filter, setFilter] = useState<PeopleFilter | null>(null);
  const active = useMemo(
    () => filter ?? { ...noFilter(), minPapers: readable },
    [filter, readable],
  );
  const closeness = active.minPapers;

  /** People to draw. The list is built from the same set — with the rule in two places,
   *  someone could be in the list but missing from the picture. */
  const keep = useMemo(() => {
    const set = new Set(people.filter((p) => keeps(p, active)).map((p) => p.id));
    return set.size === people.length ? null : set;
  }, [people, active]);
  const drawn = useMemo(
    () => people.filter((p) => (!keep || keep.has(p.id)) && p.since <= upTo).length,
    [people, keep, upTo],
  );

  const shown = useMemo(
    () => (data?.works ?? []).filter((w) => w.year && w.year <= upTo),
    [data, upTo],
  );
  const roles = useMemo(() => {
    const c = { first: 0, middle: 0, last: 0 } as Record<string, number>;
    for (const w of shown) if (w.my_position) c[w.my_position] = (c[w.my_position] ?? 0) + 1;
    return c;
  }, [shown]);

  // Reload once the rebuild has finished. Until then, showing that we are waiting is better
  // than keeping the old shape on screen.
  useEffect(() => {
    if (!rebuilding) return;
    const timer = setInterval(async () => {
      try {
        const st = await fetchStatus(`${orcid}_works`);
        if (st.status === "running") return;
        clearInterval(timer);
        onReload();
      } catch {
        // The status may not be available yet. Try again on the next tick.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [rebuilding, orcid, onReload]);

  if (rebuilding) {
    return (
      <main className="grid h-svh place-items-center p-10">
        <div className="w-full max-w-sm text-center">
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Reading your publications from OpenAlex…
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Your shape, your collaborators and your reach are all built from that
            list, so they are all being read again. About a minute.
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="grid h-svh place-items-center p-10 text-center">
        <div>
          <h1 className="text-sm font-semibold">Could not load this shape</h1>
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
            {building ? "Reading your publications…" : "Building your shape…"}
          </p>
          {building && (
            <>
              <p className="mt-2 text-[11px] text-muted-foreground">
                The first time you open an ORCID it is read from OpenAlex. It is then
                kept on this device for 30 days.
              </p>
              {messages.length > 0 && (
                <p className="tabular mt-3 truncate text-[11px] text-muted-foreground">
                  {messages[messages.length - 1]}
                  {elapsed > 0 && ` · ${Math.round(elapsed)}s`}
                </p>
              )}
            </>
          )}
        </div>
      </main>
    );
  }

  const total = roles.first + roles.middle + roles.last || 1;

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
            Collaborators only · {SHAPE_COLOR_LABELS[colorBy].toLowerCase()}
          </p>
        </div>
        <PeopleFilters people={people} filter={active} onChange={setFilter} />
        <Freshness
          builtAt={data.meta.built_at}
          onRefresh={() => {
            startWorksBuild(orcid, true).then(() => setRebuilding(true));
          }}
        />
        <MyPapers
          orcid={orcid}
          works={data.works}
          meta={data.meta}
          onSaved={() => setRebuilding(true)}
        />
        {/* On narrow screens drop the text and keep only the icon. If it does not fit, it runs
            off the screen and leaves a destination nobody can tap. */}
        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          title={
            reachReady === "ready"
              ? "See which countries have cited you"
              : "Still finding everyone who has cited you"
          }
        >
          <Link href={reachHref(orcid)} aria-label="Reach">
            {reachReady === "building" ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            ) : (
              <Globe className="size-3.5" />
            )}
            <span className="hidden sm:inline">Reach</span>
          </Link>
        </Button>
        <FindCollaborators orcid={orcid} works={data.works.length} />
      </header>

      <div className="flex min-h-0 flex-1">
      <div
        className={cn(
          "relative min-h-0 flex-1 bg-canvas",
          narrowView === "shape" ? "block" : "hidden md:block",
        )}
      >
        <ShapeGraph
          works={data.works}
          upTo={upTo}
          playing={playing}
          colorBy={colorBy}
          rotationSpeed={spin ? rotation : 0}
          spread={spread}
          spacing={spacing}
          keep={keep}
          onPick={setPicked}
          onStats={setStats}
          sizeSignal={`${upTo}`}
        />

        <div className="pointer-events-none absolute left-3 top-3 rounded-sm bg-black/55 px-3 py-2 text-[11px] leading-relaxed text-white/80 backdrop-blur-sm">
          <p className="tabular text-2xl font-semibold leading-none text-white">{upTo}</p>
          {/* The box lets clicks through to the shape; only the explained words take them. */}
          <p className="mt-1.5">
            <Explain
              className="pointer-events-auto"
              text={`${publicationsNote(data.meta)} This counts those out by ${upTo}.`}
            >
              {shown.length} publications
            </Explain>{" "}
            · {stats.people} collaborators
            {stats.clusters > 0 && (
              <>
                {" "}
                ·{" "}
                <Explain
                  className="pointer-events-auto"
                  text="Groups of people who, on your papers, also wrote with each other. Someone who has only ever written with you is not counted as a group. A cluster is not a lab or an institution."
                >
                  {stats.clusters} clusters
                </Explain>
              </>
            )}
          </p>
          {closeness > 1 && (
            <p className="mt-1 text-white/55">
              Showing the {drawn} you wrote {closeness}+ papers with
            </p>
          )}
          <p className="mt-1 text-white/55">
            <Explain
              className="pointer-events-auto"
              text={`Your place in the author list of your papers out by ${upTo}. In many fields the first author did most of the work and the last author led it; conventions differ between fields.`}
            >
              {Math.round((roles.first / total) * 100)}% first ·{" "}
              {Math.round((roles.middle / total) * 100)}% middle ·{" "}
              {Math.round((roles.last / total) * 100)}% last author
            </Explain>
          </p>
        </div>

        <SpinToggle spinning={spin} onChange={setSpin} className="absolute bottom-3 left-3" />

        {picked && (
          <div className="pointer-events-none absolute right-3 top-3 max-w-xs rounded-sm bg-black/55 px-3 py-2 text-[11px] leading-relaxed text-white/80 backdrop-blur-sm">
            <p className="font-semibold text-white">{picked.name}</p>
            <p className="mt-1 text-white/60">
              {picked.papers} {picked.papers === 1 ? "paper" : "papers"} with you ·{" "}
              {picked.since === picked.until
                ? `in ${picked.since}`
                : `first ${picked.since}, latest ${picked.until}`}
            </p>
            {picked.topics.map((t) => (
              <p key={t.name} className="mt-1 text-white/60">
                {t.name}
                {picked.papers > 1 && <span className="text-white/40"> · {t.papers}</span>}
              </p>
            ))}
            {picked.alsoWith > 0 && (
              <p className="mt-1 text-white/45">
                On your papers, has also written with {picked.alsoWith} of your other
                co-authors
              </p>
            )}
          </div>
        )}
      </div>

      <aside
        className={cn(
          "min-h-0 shrink-0 flex-col overflow-hidden border-l bg-card md:hidden",
          narrowView === "list" ? "flex w-full" : "hidden",
        )}
      >
        <PeopleList
          people={people}
          keep={keep}
          upTo={upTo}
          picked={picked}
          onPick={setPicked}
        />
      </aside>
      </div>

      {/* View switch for narrow screens. */}
      <nav className="flex shrink-0 border-t bg-card md:hidden">
        {(
          [
            ["list", "People", ListOrdered],
            ["shape", "Shape", Boxes],
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

      {/* Timeline slider and playback settings. */}
      <div className="flex shrink-0 items-center gap-3 border-t bg-card px-4 py-3">
        <Button
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          onClick={() => {
            if (!playing && upTo >= to) setYear(from);
            setPlaying((p) => !p);
          }}
          aria-label={playing ? "Pause" : "Play your career"}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>

        <span className="tabular w-10 shrink-0 text-xs text-muted-foreground">{from}</span>
        <Slider
          min={from}
          max={to}
          step={1}
          value={[upTo]}
          onValueChange={([v]) => {
            setPlaying(false);
            setYear(v);
          }}
          className="flex-1"
        />
        <span className="tabular w-10 shrink-0 text-right text-xs text-muted-foreground">
          {to}
        </span>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" className="size-8 shrink-0" aria-label="Playback settings">
              <Settings2 className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="max-h-[70svh] w-72 space-y-4 overflow-y-auto"
          >
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Colour by</Label>
              <Select value={colorBy} onValueChange={(v) => setColorBy(v as ShapeColor)}>
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SHAPE_COLOR_LABELS) as ShapeColor[]).map((k) => (
                    <SelectItem key={k} value={k} className="text-xs">
                      {SHAPE_COLOR_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* What the choice means, in the open, rather than hidden behind a hover */}
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {SHAPE_COLOR_NOTES[colorBy]}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="flex justify-between text-[11px] text-muted-foreground">
                Years to play
                <span className="tabular font-medium text-foreground">
                  {from}–{to}
                </span>
              </Label>
              <Slider
                min={span[0]}
                max={span[1]}
                step={1}
                value={[from, to]}
                onValueChange={([a, b]) => {
                  setRange([a, b]);
                  setPlaying(false);
                  setYear(Math.min(Math.max(upTo, a), b));
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="flex justify-between text-[11px] text-muted-foreground">
                Time to play it
                <span className="tabular font-medium text-foreground">{seconds}s</span>
              </Label>
              <Slider
                min={5}
                max={90}
                step={5}
                value={[seconds]}
                onValueChange={([v]) => setSeconds(v)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="flex justify-between text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Maximize2 className="size-3" />
                  Reach from the centre
                </span>
                <span className="tabular font-medium text-foreground">{spread}</span>
              </Label>
              <Slider
                min={80}
                max={600}
                step={10}
                value={[spread]}
                onValueChange={([v]) => setSpread(v)}
              />
              <p className="text-[10px] text-muted-foreground">
                How far the shape may extend before it is pulled back in. Small keeps
                everything on screen; large lets separate groups drift apart.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="flex justify-between text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Move3d className="size-3" />
                  Space between people
                </span>
                <span className="tabular font-medium text-foreground">{spacing.toFixed(1)}</span>
              </Label>
              <Slider
                min={1}
                max={10}
                step={0.5}
                value={[spacing]}
                onValueChange={([v]) => setSpacing(v)}
              />
              <p className="text-[10px] text-muted-foreground">
                How hard people push each other apart. Low packs the groups tight;
                high opens them up so you can see inside.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="flex justify-between text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <RotateCw className="size-3" />
                  Rotation
                </span>
                <span className="tabular font-medium text-foreground">
                  {rotation === 0 ? "off" : `${rotation.toFixed(1)}`}
                </span>
              </Label>
              <Slider
                min={0}
                max={20}
                step={0.5}
                value={[rotation]}
                onValueChange={([v]) => setRotation(v)}
              />
              <p className="text-[10px] text-muted-foreground">
                Clockwise, around the centre of what is on screen.
                {rotation > 0 && ` About ${Math.round(60 / rotation)}s per turn.`}
                {!spin && " Rotation is off — the button on the canvas turns it back on."}
              </p>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
