"use client";

import { ArrowRight, Boxes, Coffee, Globe, Loader2, Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import HeroGraph from "@/components/HeroGraph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchAuthors } from "@/lib/api";
import { shapeHref } from "@/lib/routes";
import type { AuthorHit } from "@/lib/types";

const SAMPLE = "0000-0001-7876-6004";

/** The entry page.
 *
 *  It does only two things — decides whose work to look at, and hands over to the Shape page.
 *  It used to start building the co-author network here (Measured: 7 minutes / $0.03–0.07),
 *  but that is the most expensive operation, and not one to impose on someone who has not
 *  seen anything yet. The shape can be drawn from papers alone in 3–8 seconds, so the entry
 *  page goes to the shape.
 *
 *  Names are accepted too because hardly any researcher knows their ORCID by heart (16 digits).
 *  Ask for 16 digits at the door and anyone who cannot remember them simply leaves.
 *
 *  The shape itself turns behind all of this (HeroGraph). A page that only says "see the shape
 *  of your research" asks people to imagine what that means; showing it does not. The stage is
 *  dark in both themes, like the canvas on every other screen, so the front door looks like the
 *  rooms behind it. */

/** Treat the input as an ORCID once all 16 digits are there. Hyphens and URLs are ignored. */
function asOrcid(value: string): string | null {
  const digits = value.trim().replace(/^.*orcid\.org\//i, "").replace(/[\s-]/g, "");
  if (!/^\d{15}[\dX]$/i.test(digits)) return null;
  return digits.toUpperCase().replace(/(.{4})(?=.)/g, "$1-");
}

const WHAT: { icon: typeof Boxes; title: string; line: string }[] = [
  { icon: Boxes, title: "Shape", line: "Everyone you have written with, placed by who wrote with whom, played back year by year." },
  { icon: Globe, title: "Reach", line: "A globe of the countries whose researchers have cited you, self-citations left out." },
  { icon: Users, title: "Collaborators", line: "People you have not written with yet, and the co-authors who could introduce you." },
];

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // Also keep which query the results answer. Without it, candidates for the previous name
  // linger while typing, and people end up choosing from someone else's list.
  const [hits, setHits] = useState<{ q: string; results: AuthorHit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const orcid = asOrcid(query);
  const term = query.trim();
  // Whether we are searching by name. Don't search while someone is typing an ORCID — every
  // partial 16-digit entry would come back as a name with no matches.
  const looking = !orcid && term.length >= 3;
  // Show only the results for the name being typed now. Leftovers from the previous name are
  // treated as absent.
  const shown = looking && hits?.q === term ? hits.results : null;

  useEffect(() => {
    if (!looking) return;
    const wait = setTimeout(() => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setSearching(true);
      setError(null);
      searchAuthors(term, ctrl.signal)
        .then((res) => {
          setHits({ q: term, results: res.results });
          setSearching(false);
        })
        .catch((err) => {
          if (ctrl.signal.aborted) return;
          setSearching(false);
          setError(err instanceof Error ? err.message : String(err));
        });
    }, 350);
    return () => clearTimeout(wait);
  }, [term, looking]);

  const open = (id: string) => router.push(shapeHref(id));

  return (
    // `dark` so every control on the stage takes its dark colours, whichever theme the visitor
    // is in. The canvas is dark on every screen of this app; the front door matches it.
    <main className="dark relative min-h-svh overflow-hidden bg-canvas text-foreground">
      {/* Wide screens: the shape keeps to the right of the words. Narrow ones have no room
          beside them, so it takes the lower half instead of hiding behind the text. */}
      <HeroGraph className="absolute inset-x-0 bottom-[26%] top-[34%] opacity-95 md:inset-y-0 md:bottom-0 md:left-[26%] md:top-0" />
      {/* The veil comes from wherever the words are: down the page on a phone, across from the
          left on a wide screen. */}
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(8,10,16,0.98)_0%,rgba(8,10,16,0.95)_34%,rgba(8,10,16,0.62)_54%,rgba(8,10,16,0.12)_78%,rgba(8,10,16,0)_100%)] md:bg-[linear-gradient(to_right,rgba(8,10,16,0.98)_0%,rgba(8,10,16,0.96)_32%,rgba(8,10,16,0.72)_48%,rgba(8,10,16,0.3)_66%,rgba(8,10,16,0.05)_88%,rgba(8,10,16,0)_100%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(to_top,rgba(8,10,16,0.96)_0%,rgba(8,10,16,0.7)_45%,rgba(8,10,16,0)_100%)] md:h-56"
        aria-hidden
      />

      <div className="relative flex min-h-svh flex-col">
        {/* No theme switch here: this page is always dark (`dark` above), so it changed nothing.
            The height is the one the switch used to give the header, so nothing below moves. */}
        <header className="flex h-13 items-center px-4 sm:px-6">
          <span className="text-xs font-semibold tracking-tight">Research Constellation</span>
        </header>

        <div className="flex flex-1 items-center px-4 py-8 sm:px-6">
          <div className="w-full max-w-lg">
            {/* Balanced, not pretty: this headline runs to three or four lines, and text-pretty
                only protects the last one. Without balancing, the em dash was left stranded at
                the end of a line. */}
            <h1 className="text-balance text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl">
              Explore your research network — how it connects, evolves, and expands.
            </h1>
            <p className="mt-3 max-w-md text-[13px] leading-relaxed text-muted-foreground">
              Watch your research constellation take shape year by year — each co-author coloured
              by what you worked on. Then see where your work travelled, and who you could connect
              with next. From an ORCID iD, in seconds.
            </p>

            {/* Everything you type or press is kept to a narrower column than the words above it.
                At the full width of the headline the field ran under the network behind the page,
                and a text box sitting on top of moving spheres reads as a mistake.

                The bottom margin replaces a paragraph that used to sit here. This column is
                centred vertically, so losing the paragraph made the block shorter and re-centred
                it lower — far enough that the sample button landed on the spheres. Restoring the
                height puts everything back where it was. Only on narrow screens: on wide ones the
                network is off to the right and never met this column. */}
            <div className="mb-16 max-w-sm md:mb-0">
              <form
                className="mt-6 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (orcid) open(orcid);
                  else if (shown?.length === 1) open(shown[0].orcid);
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="who" className="eyebrow">
                    Your name, or your ORCID iD
                  </Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="who"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                      className="h-11 bg-card/80 pl-8 text-sm backdrop-blur-sm"
                    />
                    {searching && (
                      <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </div>

                {orcid && (
                  <Button type="submit" className="h-11 w-full">
                    Open {orcid}
                    <ArrowRight className="size-4" />
                  </Button>
                )}
              </form>

              {/* Candidates. A name alone is not enough to choose by, so add institution, years
                  and topics — people with the same name are common in OpenAlex. */}
              {looking && (shown !== null || searching) && (
                <div className="mt-4">
                  {(shown ?? []).length === 0 ? (
                    <p className="rounded-md border border-dashed bg-card/70 px-3 py-4 text-center text-[11.5px] leading-relaxed text-muted-foreground backdrop-blur-sm">
                      {searching
                        ? "Looking…"
                        : "Nobody with an ORCID iD came back for that. Try the name as it appears on your papers, or paste your ORCID iD."}
                    </p>
                  ) : (
                    <ul className="divide-y overflow-hidden rounded-md border bg-card/80 backdrop-blur-sm">
                      {(shown ?? []).map((a) => (
                        <li key={a.orcid}>
                          <button
                            type="button"
                            onClick={() => open(a.orcid)}
                            className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/60"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium">
                                {a.name}
                              </span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {a.institution ?? "No institution on record"}
                              </span>
                              {a.topics.filter(Boolean).length > 0 && (
                                <span className="block truncate text-[11px] text-muted-foreground/80">
                                  {a.topics.filter(Boolean).join(" · ")}
                                </span>
                              )}
                            </span>
                            <span
                              className="tabular shrink-0 text-right text-[11px] text-muted-foreground"
                              title="Works OpenAlex lists for this ORCID iD, preprints and corrections included, and the years they span"
                            >
                              <span className="block font-medium text-foreground">
                                {a.works_count.toLocaleString()}{" "}
                                {a.works_count === 1 ? "work" : "works"}
                              </span>
                              {a.years[0] && a.years[1] && (
                                <span className="block">{`${a.years[0]}–${a.years[1]}`}</span>
                              )}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {error}
                </p>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-3 w-full font-normal text-muted-foreground hover:text-foreground"
                onClick={() => open(SAMPLE)}
              >
                Or look at the sample first
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* On a phone the shape runs the width of the page, so the footer gets its own frosted
            ground to sit on and the spheres pass behind it. A wide screen keeps the shape to the
            right of the text and needs none of that. */}
        <footer className="bg-canvas/85 px-4 pb-8 pt-4 backdrop-blur-sm sm:px-6 md:bg-transparent md:pt-0 md:backdrop-blur-none">
          <dl className="grid max-w-3xl gap-x-6 gap-y-3 border-t border-border/60 pt-4 sm:grid-cols-3">
            {WHAT.map(({ icon: Icon, title, line }) => (
              <div key={title}>
                <dt className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <Icon className="size-3.5 text-muted-foreground" />
                  {title}
                </dt>
                <dd className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {line}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 max-w-3xl text-[11px] leading-relaxed text-muted-foreground/80">
            Free, no account, nothing to install. Everything is read from{" "}
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href="https://openalex.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenAlex
            </a>{" "}
            (CC0) by your own browser, and drawn with{" "}
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href="https://github.com/vasturiano/3d-force-graph"
              target="_blank"
              rel="noopener noreferrer"
            >
              3d-force-graph
            </a>{" "}
            and{" "}
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href="https://threejs.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              three.js
            </a>{" "}
            (MIT). Country borders from{" "}
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href="https://www.naturalearthdata.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Natural Earth
            </a>{" "}
            (public domain).
          </p>
          {/* A plain link, not Ko-fi's button or widget: those load from Ko-fi's servers, and the
              line above says the page talks to nobody but OpenAlex. */}
          <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-muted-foreground/80">
            <a
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
              href="https://ko-fi.com/kenjifujita"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Coffee className="size-3" aria-hidden />
              Tip on Ko-fi
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
