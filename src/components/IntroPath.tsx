"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SpinToggle from "@/components/SpinToggle";
import { RECENT_YEARS, connections, isRecent, routes } from "@/lib/intro";
import type { GraphNode } from "@/lib/types";

/** Draws one thing only: who you could ask to get to this person.
 *
 *  This is the only chart left on the candidate page. It used to render the whole 984-person
 *  co-author network in 3D, but Measured: 597 of them (61%) had not a single line, because
 *  off-network candidates were being placed inside the co-author graph. Distance could also
 *  only be 0, 1 or 2 (by definition, since it is an ego network), so the topology had nothing
 *  to read. Off-network candidates were hidden by default, but that also meant hiding 52-59%
 *  of the top recommendations simply because no line could be drawn to them.
 *
 *  A chart beats text at one thing only: **showing the path**.
 *  You -> a shared co-author -> them. Five points at most. That can be read.
 *
 *  Line width is the number of papers written together. The two sides mean different things
 *  (left = you and that person, right = that person and them), so they are coloured apart. */

type Dot = {
  id: string;
  name: string;
  role: "you" | "via" | "them";
  val: number;
  color: string;
  /** Takes the dot out of the force simulation and pins it (fx/fy/fz, as d3-force does) */
  fx?: number;
  fy?: number;
  fz?: number;
};

type Line = {
  source: string;
  target: string;
  papers: number;
  color: string;
  /** Text shown when the pointer is over the line */
  label: string;
  /** Whether the two have also written together in recent years. Dots flow only on these lines */
  recent: boolean;
};

/** Hover text for a line. For the year, state only the fact (the publication year of their latest
 *  paper together); do not blur it into something like "most recently". */
const together = (papers: number, last: number | null) => {
  if (papers === 1) return `1 paper together${last ? `, published in ${last}` : ""}`;
  return `${papers} papers together${last ? `, the latest published in ${last}` : ""}`;
};

type Instance = import("3d-force-graph").ForceGraph3DInstance<Dot, Line>;

const COLOR = {
  you: "#e8eaf0",
  via: "#6fa8ff",
  them: "#ffcf5c",
  // What goes in the middle when there is no shared co-author. It is not a person, so it gets
  // its own colour: in the same blue, "shared references" would be read as a person.
  route: "#4fd1c5",
  toYou: "rgba(232,234,240,0.55)",
  toThem: "rgba(255,207,92,0.55)",
  toRoute: "rgba(79,209,197,0.5)",
};

/** How far from the centre you and they are placed (each side). The axis is horizontal: you on
 *  the left, them on the right, and a ring of introducers in between. */
const END = 150;
/** Minimum and maximum distance from the axis. The stronger the person, the closer to the axis. */
const NEAR = 20;
const FAR = 120;

export default function IntroPath({
  them,
  byId,
  egoName,
  /** Safety valve. Measured: the maximum is 21 people (a researcher with 508 papers), so it
   *  normally never kicks in. When it does, the caption says "top N"; thinning silently would
   *  stop it matching the number of names listed just below. */
  limit = 30,
}: {
  them: GraphNode;
  byId: Map<string, GraphNode>;
  egoName: string;
  limit?: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const graph = useRef<Instance | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  // It is hard to read while it spins on its own, so it can be stopped.
  const [spin, setSpin] = useState(true);
  // Copied into a ref because it is read inside rAF. Reading the state directly would freeze it
  // at its value when the loop was created. The copy happens inside an effect: writing a ref
  // during render can make React miss an update.
  const spinning = useRef(spin);
  useEffect(() => {
    spinning.current = spin;
  }, [spin]);
  const spinStop = useRef<(() => void) | null>(null);

  const data = useMemo(() => {
    // **The position is the answer.** When the force layout decided it, you and them were both
    // connected to everyone, so they overlapped and it only ever came out as a fan. Putting
    // people evenly on a ring instead would mean position means nothing, and then there is no
    // point in it being a chart.
    //
    // So the coordinates come from the two co-authorship counts:
    //
    //   Distance from the axis = strength of the path (weaker is further out)
    //     Strength is the harmonic mean. If one side is 1 paper, it is weak even if the other
    //     side is 71. As a result, the more someone writes with both of you, the closer they sit
    //     to the straight line joining "you -> them": the most direct introduction path looks
    //     the most direct.
    //
    //   Position along the axis = whose side they are on
    //     Written a lot with you and not much with them: left (your side).
    //     The reverse: right. The middle is about the same with both.
    //
    //   Angle around the axis: no meaning. Spread by the golden angle only to avoid overlaps.
    // The order follows the same rule as the table (lib/intro.ts), so the chart and the table
    // tell the same story.
    const all = routes(them, byId);
    const pairs = all.slice(0, limit);
    // No shared co-author. What goes in the middle is then a "route" rather than a person, but
    // the presentation stays the same: a separate chart would just put a pale flat diagram next
    // to the dark 3D one, and the page would stop looking like one piece.
    const vias = pairs.length
      ? null
      : connections(them).map((c, i) => ({ ...c, rank: i }));
    const best = Math.max(1, ...pairs.map((p) => p.strength));

    const nodes: Dot[] = [
      { id: "__you", name: egoName, role: "you", val: 6, color: COLOR.you, fx: -END, fy: 0, fz: 0 },
    ];
    const links: Line[] = [];

    pairs.forEach(({ id, name, mine, theirs, strength: s, lastWithYou, lastWithThem }, i) => {
      // Scale strength to 0..1. The sqrt stops the top person alone from sitting on the axis
      // while everyone else is stuck to the outer edge.
      const t = Math.sqrt(s / best);
      const r = NEAR + (FAR - NEAR) * (1 - t);
      // Golden angle. With even spacing, people at similar radii overlap in a regular pattern.
      const angle = i * 2.39996;
      nodes.push({
        id,
        name,
        role: "via",
        // Size is how much you have written with that person.
        // That is what decides whether you can ask them.
        val: 1.5 + Math.min(mine, 30) * 0.25,
        color: COLOR.via,
        // Left/right is whose side they are on. The more they write with you, the further left
        // (your side). About the same with both: the middle.
        fx: (END * 0.72 * (theirs - mine)) / (theirs + mine),
        fy: Math.cos(angle) * r,
        fz: Math.sin(angle) * r,
      });
      links.push({
        source: "__you",
        target: id,
        papers: mine,
        color: COLOR.toYou,
        label: together(mine, lastWithYou),
        recent: isRecent(lastWithYou),
      });
      links.push({
        source: id,
        target: them.id,
        papers: theirs,
        color: COLOR.toThem,
        label: together(theirs, lastWithThem),
        recent: isRecent(lastWithThem),
      });
    });

    // Route mode. Everything goes in the middle (x=0): a route belongs to neither side, so there
    // is no reason to push it left or right. Distance from the axis follows how much it helps a
    // first message, with the route where they have cited you nearest.
    for (const c of vias ?? []) {
      const r = NEAR + ((FAR - NEAR) * c.rank) / Math.max(1, (vias?.length ?? 1) - 1);
      const angle = c.rank * 2.39996;
      nodes.push({
        id: `route:${c.key}`,
        name: `${c.label}: ${c.count.toLocaleString()}`,
        role: "via",
        // All the same size. The line width already carries the count; giving it to the circle
        // too would read as "bigger = more important" and contradict the position (= the order
        // of usefulness). 5,482 shared references is a big number, but it helps a first message
        // the least.
        val: 4,
        color: COLOR.route,
        fx: 0,
        fy: Math.cos(angle) * r,
        fz: Math.sin(angle) * r,
      });
      // Not co-authorship, so do not say "papers together" (it used to show 5,482 shared
      // references as "5482 papers together"). No dots flow on it either.
      const label = `${c.label}: ${c.count.toLocaleString()}`;
      links.push({
        source: "__you",
        target: `route:${c.key}`,
        papers: c.count,
        color: COLOR.toRoute,
        label,
        recent: false,
      });
      links.push({
        source: `route:${c.key}`,
        target: them.id,
        papers: c.count,
        color: COLOR.toRoute,
        label,
        recent: false,
      });
    }

    nodes.push({
      id: them.id,
      name: them.name,
      role: "them",
      val: 6,
      color: COLOR.them,
      fx: END,
      fy: 0,
      fz: 0,
    });
    // The strongest path is also given in text, so you can tell who to ask without spinning the
    // 3D chart to work it out. The chart's job is to show why that is the answer.
    return {
      nodes,
      links,
      radius: FAR,
      viaRoutes: !!vias,
      hidden: Math.max(0, all.length - pairs.length),
    };
  }, [them, byId, egoName, limit]);

  // Build the chart once and only swap its contents. Recreating the WebGL context every time a
  // different candidate is picked makes the browser report "context lost".
  useEffect(() => {
    let disposed = false;
    let instance: Instance | null = null;
    let observer: ResizeObserver | null = null;

    import("3d-force-graph").then(({ default: ForceGraph3D }) => {
      if (disposed || !holder.current) return;
      try {
        const Ctor = ForceGraph3D as unknown as new (el: HTMLElement, cfg?: object) => Instance;
        instance = new Ctor(holder.current, {
          rendererConfig: { antialias: false, powerPreference: "low-power" },
          controlType: "orbit",
        });
        instance
          .backgroundColor("#080a10")
          .showNavInfo(false)
          .nodeRelSize(4)
          .nodeResolution(14)
          .nodeVal((n) => n.val)
          .nodeColor((n) => n.color)
          .nodeLabel((n) => n.name)
          .linkLabel((l) => l.label)
          .linkColor((l) => l.color)
          // Grows with sqrt. It used to top out at 12 papers, so 13 papers and 71 papers got the
          // same width.
          .linkWidth((l) => 0.5 + Math.sqrt(Math.min(l.papers, 100)) * 0.75)
          .linkOpacity(0.8)
          // Dots flow only on lines for relationships that are still going: a line moves if the
          // two have also written together in recent years, and a still line is older
          // co-authorship. Paper count is carried by width and path strength by position, so the
          // dots add only recency. They used to flow on every line at the same count and speed,
          // and meant nothing. Count and speed are uniform, so the only thing to read is whether
          // a line is moving.
          .linkDirectionalParticles((l) => (l.recent ? 2 : 0))
          .linkDirectionalParticleWidth(1.4)
          .linkDirectionalParticleSpeed(0.012)
          .enableNodeDrag(false)
          // Every position is pinned, so the force simulation is not needed. Running it would
          // only waste computation on fixed points.
          .cooldownTicks(0);
        // Rotation is done here by hand. OrbitControls' autoRotate only turns around the
        // vertical axis, and with the path axis horizontal, at some point you look straight down
        // that axis and the whole thing collapses. Here **the path axis (X) itself** is the
        // rotation axis, so you and them stay put on the left and right and only the ring in
        // between turns.
        const world = instance.scene();
        let frame = 0;
        let last = performance.now();
        const turn = (now: number) => {
          frame = requestAnimationFrame(turn);
          const dt = Math.min(now - last, 100);
          last = now;
          if (spinning.current) world.rotation.x += dt * 0.00035;
        };
        frame = requestAnimationFrame(turn);
        spinStop.current = () => cancelAnimationFrame(frame);

        graph.current = instance;
        // Announce through state that the chart exists. 3d-force-graph is a dynamic import, so
        // the effect that feeds in the data runs first. If it only checks the ref, it finds
        // nothing there and never feeds the data again unless data changes
        // (Measured: it stayed pitch black with 0 nodes).
        setReady(true);

        // Measure the holder itself. The parent <figure> also includes the figcaption's height,
        // so the canvas would end up taller than the holder and overflow it.
        const box = holder.current;
        const resize = () => {
          if (!instance) return;
          instance.width(box.clientWidth).height(box.clientHeight);
        };
        resize();
        observer = new ResizeObserver(resize);
        observer.observe(box);
      } catch (err) {
        console.warn("Intro path unavailable:", err);
        instance = null;
        setFailed(true);
      }
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      spinStop.current?.();
      spinStop.current = null;
      instance?._destructor?.();
      graph.current = null;
    };
  }, []);

  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    g.graphData({ nodes: data.nodes, links: data.links });
    // The camera distance is computed too. zoomToFit left far too much room (Measured: a chart of
    // about 200px in an 800px frame). The layout is decided here, so the distance can be as well:
    // the width is the 2 * END between the two ends, and the height and depth are the ring's
    // diameter.
    graph.current?.cameraPosition({ x: 0, y: 0, z: 175 + data.radius * 1.1 });
  }, [data, ready]);

  if (failed || data.links.length === 0) return null;

  return (
    <figure className="overflow-hidden rounded-md border">
      <div className="relative">
        <div ref={holder} className="h-64 w-full bg-canvas" />
        <SpinToggle spinning={spin} onChange={setSpin} className="absolute bottom-2 left-2" />
      </div>
      <figcaption className="border-t px-2.5 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1">
            <Dotted color={COLOR.you} /> you
          </span>
          <span className="flex items-center gap-1">
            <Dotted color={data.viaRoutes ? COLOR.route : COLOR.via} />{" "}
            {data.viaRoutes ? "how you already overlap" : "could introduce you"}
          </span>
          <span className="flex items-center gap-1">
            <Dotted color={COLOR.them} /> {them.name}
          </span>
          {data.hidden > 0 && (
            <span className="ml-auto">
              Showing {data.nodes.length - 2} of {data.nodes.length - 2 + data.hidden}
            </span>
          )}
        </span>
        {/* Position carries meaning in this chart, so it cannot be read unless that meaning
            is written out. */}
        <span className="mt-1 block">
          {data.viaRoutes
            ? "No one sits between you — nothing in the middle is a person. These are the ways your work already overlaps, nearest the line first."
            : `The nearer the straight line between you two, the stronger the whole path — those are the people to ask. Out at the edges are the thin connections. Left or right says whose co-author they mostly are: nearer you, or nearer them. Dots flow along a line when those two published a paper together in ${new Date().getFullYear() - RECENT_YEARS} or later; on a still line, their latest paper together is older.`}
        </span>
      </figcaption>
    </figure>
  );
}

function Dotted({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 rounded-full"
      style={{ background: color }}
    />
  );
}
