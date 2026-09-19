"use client";

import { useEffect, useRef, useState } from "react";
import { SAMPLE_LINKS, SAMPLE_NODES, SAMPLE_YEARS } from "@/lib/sampleShape";
import { cn } from "@/lib/utils";

/** A co-author network, playing quietly behind the start page.
 *
 *  The start page used to be a headline and a text box on an empty background, which said
 *  nothing about what waits on the other side. This draws the real thing instead — the same
 *  library, the same colours and the same layout rules as the Shape page.
 *
 *  The structure ships with the page as bare numbers (lib/sampleShape.ts). Nobody's name is in
 *  it, and OpenAlex is not called: a visitor who has not asked for anything yet should not spend
 *  a request, or wait, to see the front door.
 *
 *  Each turn tells the story the app tells. People are **added** year by year — not revealed, but
 *  handed to the force layout, which re-heats and lets everyone already there shift to make room,
 *  so the network grows the way it grew. Newcomers arrive beside whoever brought them in. Then the
 *  camera comes in close while a gathering force draws everyone together, and lets go again.
 *  Finally both of the Shape page's layout controls wind down at once — the space between people
 *  and the reach from the centre — while the camera, back at the distance it opened the turn on,
 *  holds still: what shrinks on screen is the network, not the frame. It rests there, turning,
 *  for twenty seconds before the turn starts over.
 *
 *  The simulation runs the whole time. An earlier version settled the layout once and then tried
 *  to wake it for the gathering; waking an engine that three-forcegraph had torn down mid-update
 *  threw "Cannot read properties of undefined (reading 'tick')" and left a blank stage. Nothing
 *  here stops the engine, so there is no gap to race.
 *
 *  It is decoration, so it gives way to everything else: no labels, no dragging, no controls,
 *  pointer events pass through to the form, it is hidden from screen readers, it stops when the
 *  tab is in the background, it holds still for anyone who asked for less motion, and if WebGL
 *  is unavailable it simply never appears. */

type HeroNode = {
  id: number;
  papers: number;
  group: number;
  since: number;
  country: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Whether they have been handed to the layout yet this turn, so newcomers can be dropped
   *  beside someone they wrote with rather than wherever the initial scatter left them */
  __seen?: boolean;
};
type HeroLink = { source: number; target: number; papers: number; since: number };
type Instance = import("3d-force-graph").ForceGraph3DInstance<HeroNode, HeroLink>;

/* The story, in milliseconds. */
/** People arrive this many years at a time. One year at a time was seventeen arrivals of 2 to
 *  18 people over sixteen seconds, and it dragged; two at a time is nine arrivals of 5 to 27. Not
 *  three: that lands 45 people at once, one shove far bigger than the rest. */
const YEARS_PER_ARRIVAL = 2;
/** How long the arrivals take: about a second between them, the same spacing as before. That
 *  spacing is what lets each arrival's shove settle before the next one lands — at half of it,
 *  the wobbles ran into each other and the whole network just seethed. So the growth is shorter
 *  because there are fewer arrivals, not because they come faster. */
const GROW_MS = 10_000;
/** Drawing together while the camera comes in */
const CLOSE_MS = 4_500;
/** Opening out: letting go of the gathering, winding both layout controls down, and standing the
 *  camera back to its resting frame — all on the one curve.
 *
 *  These used to be two phases, four and a half seconds of camera and then five of controls, and
 *  the seam showed. The camera lagged about two seconds behind each boundary, so it was still
 *  pulling back when the drawing-in began, paused, and then the contraction read as a second
 *  pull-back: out, hold, out again. One movement cannot have a seam in it. */
const OPEN_MS = 9_500;
/** The long look: still, turning */
const HOLD_MS = 20_000;
const LOOP_MS = GROW_MS + CLOSE_MS + OPEN_MS + HOLD_MS;
/** One full circle. The same as the long look, so it holds for exactly one revolution */
const TURN_MS = 20_000;

/* Where each phase begins, so the tick loop reads as the story rather than as arithmetic. */
const AT_CLOSE = GROW_MS;
const AT_OPEN = AT_CLOSE + CLOSE_MS;
const AT_HOLD = AT_OPEN + OPEN_MS;

/** How close the camera comes at the tightest: half way in.
 *
 *  It was 0.3, and that put the camera *inside* the crowd — measured at the tightest moment, a
 *  distance of 116 against a body whose 85th percentile was 119.7, so the spheres filled the
 *  frame and there was nothing to see past them. Coming in from 596 to about 190 is still a
 *  threefold approach; it just stops outside the cloud rather than in the middle of it. */
const CLOSEST = 0.5;
/** The one distance the turn is framed from: where it opens, what it returns to after the close,
 *  and where it rests for the long look. One number for all three is what lets the loop come
 *  round without a jump — and it is also what makes the drawing-in visible, because a camera
 *  that stays put while the network contracts shows the contraction instead of following it.
 *
 *  1.55 left the resting shape a little too far off; 1.42 is about 8% nearer. */
const SURVEY = 1.42;
/** How far the 85th-percentile person sits from the middle once the whole sample has settled,
 *  measured over several runs: 209.7, 214.5, 212.6, 221.4 — call it 215.
 *
 *  A seed, and nothing more. The framing is measured from the layout itself at the two
 *  boundaries where everybody is present, but on the first turn there is no settled full network
 *  to measure: the years have not played yet. Measuring whoever was on screen instead opened the
 *  turn at 380 against 573 for the long look, and measuring everybody read the untouched opening
 *  scatter and opened at 169 — the layout pass for the full set never runs, because the reset to
 *  the first year replaces it inside the same tick. The sample ships fixed with the page, so a
 *  number measured from it is the honest way to open at the distance the turn will close on. */
const SAMPLE_WIDTH = 215;
/** How hard everyone is pulled towards the centre at the tightest */
const GATHER = 0.22;

/* The Shape page's two layout controls, as the story winds them down.
 *
 * "Space between people" is the repulsion and the length of the lines. "Reach from the centre"
 * is a radius past which people are drawn back, which is what actually compacts a sprawling
 * network: the outliers come in and the core keeps its shape. */
const PUSH_WIDE = -70;
/** What the space between people winds down to.
 *
 *  A stronger push was tried here first, on the theory that it would hold the groups off one
 *  another and leave them legible: -130 against a line of 4. It did not, and the measurement
 *  says why. Everything grew by much the same factor — within a group 36.5 to 94.7, between
 *  groups 77.1 to 190.3 — so the ratio of the two barely moved, 2.11 to 2.01. A ratio does not
 *  care how big the picture is. All the strong push bought was a network two and a bit times
 *  wider (85th percentile 75.7 to 166.6), which also undid the shrinking the opening-out is
 *  there to show.
 *
 *  What the sweeps did settle is which knob does what. The link's *strength* — left at its
 *  default here — is the one that decides how tightly a group holds together: raised to 0.6 it
 *  gave the best separation ever measured, 2.434, and collapsed the whole network to an 85th
 *  percentile of 31.7 doing it. The link's *distance* is the one that decides how big the
 *  resting shape is. Since the complaint was that the shape huddled in the middle of the frame,
 *  the distance is what moved and the strength was left alone. */
const PUSH_TIGHT = -15;
const LINK_WIDE = 30;
/** Wound down, but not to nothing: at 4 the resting network huddled into the middle of an empty
 *  frame, an 85th percentile of 76.6 against a camera at 619, and read as a smudge.
 *
 *  The line is not what sets that size, though, which took three sweeps to pin down. Holding the
 *  push at -25 and shortening the line from 16 to 13 to 10 moved the width by three units —
 *  124, 125, 127. It is the **push** that sets how big the resting shape is: -8 gave 72.7, -12
 *  gave 128.7, -15 gives 104.4, -25 gives 125. An earlier sweep looked like the line was doing
 *  the work only because the push had been changed alongside it. */
const LINK_TIGHT = 16;
/** The reach at the end, as a fraction of how wide the network was before the drawing-in.
 *
 *  This one barely earns its place, and the measurement says so plainly: at 0.38 of a framing
 *  distance of about 366 the radius lands near 139, and only **five of the hundred and thirty**
 *  people sit outside it — the same five in every force setting swept, the stragglers with
 *  hardly a co-author between them. Everyone else is already well inside, so the reach never
 *  touches them.
 *
 *  It was raised from 0.26 to 0.38 on the theory that it was what left room between the groups.
 *  It is not: the network's size is set by the link distance and the push, and the reach only
 *  ever pulls a few outliers back in. Left where it is because it does that job harmlessly, but
 *  nobody should expect turning it to change the shape. */
const REACH_TIGHT = 0.38;
/** How firmly the reach is held — the same strength as the control on the Shape page */
const REACH_K = 0.55;
/* How fast the heat goes out of the simulation.
 *
 * d3 scales every force by alpha, so the story only gets what it asks the forces for in
 * proportion to the heat left — and the heat is spent. Measured: alpha falls to about 1e-9
 * within seconds of the last arrival, and across the whole of the gathering the network's width
 * did not move at all, 209.7 before and 209.7 after. The camera was closing in on a layout that
 * never budged.
 *
 * So the turn runs at two speeds. While people are arriving the heat has to go quickly, or one
 * arrival's shove runs into the next and the whole thing seethes. Once the arrivals stop and the
 * story starts asking — the gathering, then the drawing-in — the simulation is re-heated once
 * and cooled slowly enough to still mean something fourteen seconds later: at this rate alpha
 * runs from 1 down to about 0.08 over that stretch.
 *
 * (d3's own alpha target would be the natural way to hold a simulation warm. 3d-force-graph
 * does not expose it — its type definitions name it in ExcludedInnerProps — and reaching for it
 * without checking threw on every frame, which stopped the tick loop before it reached the
 * camera and froze the whole page for a turn. What the instance does have was then read off it
 * rather than assumed: the alpha decay and minimum, the velocity decay, and the re-heat.) */
const QUICK_DECAY = 0.06;
const SLOW_DECAY = 0.0055;
/** How much of its speed each person loses per tick while the network is drawn in and let go
 *  (d3's velocity decay; its own default of 0.4 is kept while people arrive).
 *
 *  The re-heat that the drawing-in needs puts the simulation back to full heat in a crowd, and
 *  everyone overshot and swung back on every frame: measured in screen pixels, the frame-to-frame
 *  roughness of each person's path jumped from 0.07 to 0.41 the moment the drawing-in began and
 *  stayed near 0.3 while the camera came in, which is what read as the whole network shivering.
 *  More friction takes the swing out without taking the gathering away. */
const CALM_DECAY = 0.7;

/** Groups get hues by the golden angle, in the order they were numbered (largest first) — the
 *  same rule as the Shape page, so the front door and the thing itself look like one product. */
const groupColour = (group: number) => `hsl(${((group * 137.508) % 360).toFixed(1)}, 62%, 60%)`;
/** Fixed starting positions, so the shape is the same on every visit. */
function hash(n: number): number {
  let h = 2166136261 ^ n;
  h = Math.imul(h ^ (h >>> 13), 16777619);
  return (h ^ (h >>> 15)) >>> 0;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** Eased 0 → 1, gentle at both ends. */
const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
const mix = (from: number, to: number, t: number) => from + (to - from) * t;

/** The year by which a tenth of the people have joined: where the playback starts. */
export function startYear(years: number[]): number {
  const sorted = [...years].filter(Boolean).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.1)] ?? sorted[0] ?? 0;
}

export default function HeroGraph({ className }: { className?: string }) {
  const holder = useRef<HTMLDivElement>(null);
  // Only shown once it has drawn something: fading in from nothing beats a flash of black
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let instance: Instance | null = null;
    let observer: ResizeObserver | null = null;
    let onVisibility: (() => void) | null = null;
    let frameId = 0;

    const [, lastYear] = SAMPLE_YEARS;
    // Start the years where there is something to see. The earliest year holds two people, and a
    // second of two spheres on an empty stage is not a beginning, it is a gap.
    const firstYear = startYear(SAMPLE_NODES.map(([, , since]) => since));

    const everyone: HeroNode[] = SAMPLE_NODES.map(([group, papers, since, country], id) => {
      const h = hash(id);
      const r = 30 + (h & 31);
      const a = (((h >> 6) & 1023) / 1023) * Math.PI * 2;
      const b = (((h >> 16) & 1023) / 1023) * Math.PI;
      return {
        id,
        group,
        papers,
        since,
        country,
        x: r * Math.sin(b) * Math.cos(a),
        y: r * Math.sin(b) * Math.sin(a),
        z: r * Math.cos(b),
      };
    });
    const allLinks: HeroLink[] = SAMPLE_LINKS.map(([source, target, papers, since]) => ({
      source,
      target,
      papers,
      since,
    }));

    import("3d-force-graph")
      .then(({ default: ForceGraph3D }) => {
        if (disposed || !holder.current) return;
        const Ctor = ForceGraph3D as unknown as new (el: HTMLElement, cfg?: object) => Instance;
        instance = new Ctor(holder.current, {
          // Plain spheres, no antialiasing: a background running a live simulation has to leave
          // the machine alone (measured at 42 frames a second before this)
          rendererConfig: { antialias: false, powerPreference: "low-power" },
          controlType: "orbit",
        });

        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        /** How hard the gathering force pulls, 0 to GATHER. Read by the force on every tick */
        let pull = 0;
        /** "Reach from the centre": how far anyone may sit from the middle before being drawn
         *  back. No limit while the network grows — the story only winds it in at the end. */
        let reach = Infinity;
        /** Where the camera is, eased towards what the story asks for */
        let at = 0;
        let shownYear = still ? lastYear : firstYear;

        /** Everyone who had arrived by that year, and the lines between them.
         *
         *  Newcomers start beside someone they wrote with, so they arrive from their own corner
         *  of the network rather than flying in from wherever the initial scatter put them. */
        function upTo(year: number) {
          const nodes = everyone.filter((n) => n.since <= year);
          const there = new Set(nodes.map((n) => n.id));
          const links = allLinks
            .filter((l) => there.has(l.source) && there.has(l.target) && l.since <= year)
            .map((l) => ({ ...l }));
          const placed = new Map(nodes.filter((n) => n.__seen).map((n) => [n.id, n]));
          for (const n of nodes) {
            if (n.__seen) continue;
            n.__seen = true;
            const host = links.find((l) => l.source === n.id || l.target === n.id);
            const beside = host && placed.get(host.source === n.id ? host.target : host.source);
            if (beside) {
              const h = hash(n.id * 31);
              n.x = (beside.x ?? 0) + ((h & 31) - 16);
              n.y = (beside.y ?? 0) + (((h >> 5) & 31) - 16);
              n.z = (beside.z ?? 0) + (((h >> 10) & 31) - 16);
            }
          }
          return { nodes, links };
        }

        /** Draws people towards the middle, two ways, both of which the story can turn while the
         *  engine keeps running.
         *
         *  `pull` takes hold of everyone at once, for the moment the camera comes in close.
         *  `reach` is the Shape page's "Reach from the centre": nobody past it is left there, so
         *  winding it down gathers a sprawl into something that can be taken in at once, without
         *  crushing the middle the way a pull on everybody does. Both are read fresh on every
         *  tick, so moving them costs the simulation nothing. */
        let pulled: HeroNode[] = [];
        const gather = (alpha: number) => {
          for (const n of pulled) {
            const x = n.x ?? 0;
            const y = n.y ?? 0;
            const z = n.z ?? 0;
            if (pull) {
              n.vx = (n.vx ?? 0) - x * pull * alpha;
              n.vy = (n.vy ?? 0) - y * pull * alpha;
              n.vz = (n.vz ?? 0) - z * pull * alpha;
            }
            if (reach < Infinity) {
              const r = Math.hypot(x, y, z);
              if (r > reach) {
                const k = ((r - reach) / r) * REACH_K * alpha;
                n.vx = (n.vx ?? 0) - x * k;
                n.vy = (n.vy ?? 0) - y * k;
                n.vz = (n.vz ?? 0) - z * k;
              }
            }
          }
        };
        gather.initialize = (ns: HeroNode[]) => {
          pulled = ns;
        };

        /** How far anyone may move in a single frame. */
        const SPEED = 12;
        /** A speed limit, applied after every other force.
         *
         *  Taking the warm-up away made the arrivals animate, but two of the four measured still
         *  opened with one frame of 427 and 474 units before decaying over the next twenty. A
         *  newcomer dropped within about half a unit of somebody meets the charge force at close
         *  range, where its strength over distance squared is enough to fling them across the
         *  network in a single tick: the same teleport, now at the head of the wobble rather than
         *  instead of it. d3 runs the forces in the order they were added and moves everyone
         *  afterwards, so clamping here bounds what one frame can do without changing where the
         *  layout comes to rest. */
        let limited: HeroNode[] = [];
        const limit = () => {
          for (const n of limited) {
            const v = Math.hypot(n.vx ?? 0, n.vy ?? 0, n.vz ?? 0);
            if (v > SPEED) {
              const k = SPEED / v;
              n.vx = (n.vx ?? 0) * k;
              n.vy = (n.vy ?? 0) * k;
              n.vz = (n.vz ?? 0) * k;
            }
          }
        };
        limit.initialize = (ns: HeroNode[]) => {
          limited = ns;
        };

        instance
          .backgroundColor("rgba(0,0,0,0)") // the page paints the ground; this only adds the shape
          .showNavInfo(false)
          .nodeRelSize(2.6)
          .nodeVal((n) => 0.5 + n.papers * 0.5)
          .nodeColor((n) => groupColour(n.group))
          .nodeOpacity(0.95)
          .nodeResolution(6)
          .nodeLabel(() => "")
          .enableNodeDrag(false)
          .enablePointerInteraction(false)
          .linkColor((l) => {
            const from = typeof l.source === "object" ? (l.source as HeroNode) : everyone[l.source];
            return groupColour(from.group);
          })
          .linkOpacity(0.18)
          .linkWidth((l) => Math.min(0.8, 0.15 + l.papers * 0.08))
          // The engine never stops. Everything the story does — people arriving, the gathering —
          // is something a running simulation absorbs; an engine that has to be woken races the
          // library's own updates, which is what blanked the stage before.
          //
          // The warm-up is only for the opening layout, and is taken away again below: it is not
          // the one-off it looks like.
          .warmupTicks(90)
          // Every arrival re-heats the layout to full, and arrivals are nine tenths of a second
          // apart. At d3's own decay of 0.0228 the heat takes some three hundred ticks to fade, so
          // it never fades between them: measured, the fastest person sat at the speed limit on
          // more than half of all frames, which reads as a network that simply never stops moving.
          // At 0.06 each shove is spent before the next one lands, so an arrival is an event.
          .d3AlphaDecay(QUICK_DECAY)
          .cooldownTicks(Infinity)
          // Everyone at once first, only to find out how wide the finished network is
          .graphData({ nodes: everyone, links: allLinks.map((l) => ({ ...l })) });

        /** "Space between people", the Shape page's other control: the repulsion, and the length
         *  of the lines. They move together there and they move together here — 0 is the room the
         *  network grows in, 1 is drawn in. d3 re-reads both the moment they are set, so this can
         *  run on any frame. */
        const setSpace = (k: number) => {
          instance?.d3Force("charge")?.strength(mix(PUSH_WIDE, PUSH_TIGHT, k));
          (instance?.d3Force("link") as unknown as { distance?: (d: number) => void })?.distance?.(
            mix(LINK_WIDE, LINK_TIGHT, k),
          );
        };
        setSpace(0);
        instance.d3Force("gather", gather as unknown as Parameters<Instance["d3Force"]>[1]);
        // Last, so it sees what every other force asked for on this tick
        instance.d3Force("limit", limit as unknown as Parameters<Instance["d3Force"]>[1]);

        for (const n of everyone) n.__seen = false;
        instance.graphData(upTo(shownYear));
        // Warm-up ticks are not the one-off the name suggests: three-forcegraph runs the whole
        // loop again on every graphData call (dist/three-forcegraph.mjs:1476). Ninety of them
        // meant each year's arrivals landed with the re-settling already finished, inside a single
        // frame. Measured over ten seconds of the growth: an ordinary frame moved the people
        // already there by 0.28 units, the frame after an arrival by 194, and one by 963 — seven
        // hundred times a normal frame, then straight back to normal. That is a jump, not a shove,
        // and it read as the network teleporting. From here on the layout gets no head start, so
        // the arrival plays out over frames you can actually watch.
        instance.warmupTicks(0);
        // d3's own friction, read off the instance rather than assumed, to go back to each turn
        const ARRIVING_DECAY = instance.d3VelocityDecay();
        const controls = instance.controls() as { autoRotate: boolean; enabled: boolean };
        controls.enabled = false; // it is a background, not something to fly around in
        controls.autoRotate = false; // the loop below moves the camera itself
        // Open on the distance the turn will close on, not on whatever the first year measures
        at = frame(SAMPLE_WIDTH) * SURVEY;
        place(0, at, 0);
        setReady(true);
        // Development only (Next.js strips this from the built files): framing a background you
        // cannot query is guesswork, so let the console read the camera and the layout back.
        if (process.env.NODE_ENV !== "production") {
          (window as unknown as { __heroGraph?: Instance }).__heroGraph = instance;
        }

        if (!still) {
          const started = performance.now();
          let phaseWas = -1;
          // The one reference for the whole turn (see `full` above): never measured from the
          // half-grown network, only re-measured at the two boundaries where everybody is there.
          //
          // `full` is only a seed, and a poor one: three-forcegraph runs its warm-up ticks in its
          // own update cycle, so measuring straight after handing it the data reads the initial
          // scatter, not the settled network (measured: 100 against a real 180-250, which put the
          // camera inside the cloud at a ratio of 0.62). A moment later it is worth having.
          // Seeded rather than measured (see SAMPLE_WIDTH): on the first turn there is no settled
          // full network to read. From the first gathering onwards this holds the real thing,
          // re-measured at the two boundaries where everybody is present.
          let span = frame(SAMPLE_WIDTH);
          const tick = () => {
            if (!instance) return;
            frameId = requestAnimationFrame(tick);
            const elapsed = performance.now() - started;
            const t = elapsed % LOOP_MS;
            const angle = (elapsed / TURN_MS) * Math.PI * 2;
            const lift = Math.sin((elapsed / 23_000) * Math.PI * 2) * 0.16;
            const phase = t < AT_CLOSE ? 0 : t < AT_OPEN ? 1 : t < AT_HOLD ? 2 : 3;

            if (phase !== phaseWas) {
              phaseWas = phase;
              if (phase === 0) {
                // Back to the beginning: everyone forgets where they were, so the growth is the
                // same every turn. Handing the layout new data is also what wakes the engine
                // again after the rest at the end of the last turn — the library re-heats and
                // restarts its own countdown, so nothing here has to poke at the simulation.
                for (const n of everyone) n.__seen = false;
                shownYear = firstYear;
                // Both controls wound back out, or the next turn would grow inside the ball this
                // one ended in
                pull = 0;
                reach = Infinity;
                setSpace(0);
                // Back to the quick cooling and d3's own friction that the arrivals need
                instance.d3AlphaDecay(QUICK_DECAY).d3VelocityDecay(ARRIVING_DECAY);
                // The turn starting over is a hard cut whatever happens — a hundred and thirty
                // people drop back to a dozen — so this one is allowed to land settled. Only the
                // arrivals within the year are meant to be felt, so the head start is handed back
                // immediately.
                instance.warmupTicks(60).cooldownTicks(Infinity).graphData(upTo(shownYear));
                instance.warmupTicks(0);
              }
              // The one honest moment to ask how wide the network is: everybody has arrived and
              // nothing has been wound in yet. Measuring anywhere later reads a half-gathered or
              // drawn-in network, and the framing would then shrink with the shape — which is
              // exactly what the resting distance must not do.
              if (phase === 1) span = distance();
              // Everything from here to the long look asks the forces for something, and they
              // answer only in proportion to the heat left. One re-heat, then a cooling slow
              // enough to last the rest of the turn (see SLOW_DECAY above).
              if (phase === 1) {
                instance
                  .d3AlphaDecay(SLOW_DECAY)
                  .d3VelocityDecay(CALM_DECAY)
                  .d3ReheatSimulation();
              }
              if (phase === 3) {
                // Let the heat go quickly again and let the engine rest. Nothing moves but the
                // camera from here, and a live simulation is what the frame rate actually goes on
                // (measured at 35 frames a second with it running, against 55 once it could rest).
                instance.d3AlphaDecay(QUICK_DECAY).cooldownTicks(0);
              }
            }

            let wanted = at;
            if (phase === 0) {
              // People arrive. Handing them to the layout re-heats it, so those already there
              // shift to make room — the network grows rather than filling in.
              // The growth is cut into one slot per arrival plus the opening one, so the last
              // arrival still gets its second to settle before the drawing-in starts.
              const arrivals = Math.ceil((lastYear - firstYear) / YEARS_PER_ARRIVAL);
              const slot = Math.min(arrivals, Math.floor((t / GROW_MS) * (arrivals + 1)));
              const year = Math.min(lastYear, firstYear + slot * YEARS_PER_ARRIVAL);
              if (year !== shownYear) {
                shownYear = year;
                instance.graphData(upTo(shownYear));
              }
              pull = 0;
              reach = Infinity;
              wanted = span * SURVEY;
            } else if (phase === 1) {
              const k = ease((t - AT_CLOSE) / CLOSE_MS);
              pull = GATHER * k;
              wanted = span * mix(SURVEY, CLOSEST, k);
            } else if (phase === 2) {
              // One movement, on one curve: the gathering lets go, both of the Shape page's
              // controls wind down, and the camera stands back to its resting frame. Splitting
              // these was what made the pull-back stop half way and start again.
              const k = ease((t - AT_OPEN) / OPEN_MS);
              pull = GATHER * (1 - k);
              // `span` is a framing distance, not a radius — it carries the 1.7 and the window
              // shape with it. REACH_TIGHT is tuned against that, which is why 0.26 of it lands
              // near a hundred units of actual reach. Worth knowing before either is retuned.
              reach = mix(span * 1.3, span * REACH_TIGHT, k);
              setSpace(k);
              wanted = span * mix(CLOSEST, SURVEY, k);
            } else {
              // The same distance the turn opened on, and the one the opening-out arrived at:
              // the loop comes round to where it began.
              wanted = span * SURVEY;
            }

            // Ease towards what the story asks for, so nothing ever jumps. At 0.04 this trailed
            // the story by about two seconds — the camera was still closing in when the letting-go
            // began, and still pulling back when the drawing-in did, which is half of why the
            // movement looked like it stopped and restarted. Tight enough to keep up, loose
            // enough that nothing snaps.
            at += (wanted - at) * 0.12;
            place(angle, at, lift);
          };
          frameId = requestAnimationFrame(tick);
        }

        /** Put the camera on a circle at that angle, distance and height. */
        function place(angle: number, from: number, lift: number) {
          instance?.cameraPosition(
            { x: Math.sin(angle) * from, y: from * lift, z: Math.cos(angle) * from },
            { x: 0, y: 0, z: 0 },
            0,
          );
        }

        /** How far back the body of whoever is on screen needs the camera to be.
         *
         *  The 85th percentile of how far people sit from the centre, not the furthest: a few
         *  stragglers sit far out, and framing those leaves everyone else a pixel wide (measured:
         *  a body of 248 against a furthest person at 455 put the camera at 682). Recomputed every
         *  frame, because the layout is alive: it spreads as people arrive and draws in when the
         *  gathering force pulls. */
        function distance() {
          if (!instance) return 320;
          const here = instance.graphData().nodes;
          if (!here.length) return 320;
          const radii = here
            .map((n) => Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0))
            .sort((a, b) => a - b);
          return frame(Math.max(60, radii[Math.floor(radii.length * 0.85)] ?? 1));
        }

        /** How far back a body of that half-width has to be seen from, in this window. Narrow
         *  frames need up to a third again. Kept apart from the measuring above so the seed can
         *  be framed the same way a measurement is. */
        function frame(spread: number) {
          if (!holder.current) return 320;
          const w = holder.current.clientWidth;
          const h = holder.current.clientHeight;
          return spread * 1.7 * Math.min(1.3, Math.max(1, h / w));
        }

        const size = () => {
          if (!holder.current || !instance) return;
          instance.width(holder.current.clientWidth).height(holder.current.clientHeight);
        };
        size();
        observer = new ResizeObserver(size);
        observer.observe(holder.current);

        // A background tab should cost nothing
        onVisibility = () => {
          if (!instance) return;
          if (document.hidden) instance.pauseAnimation();
          else instance.resumeAnimation();
        };
        document.addEventListener("visibilitychange", onVisibility);
      })
      .catch((err) => {
        // No WebGL, or the library could not load. The page reads perfectly well without it —
        // but say why in the console rather than leaving a silent blank stage.
        console.error("The shape behind the start page could not be drawn", err);
      });

    return () => {
      disposed = true;
      if (frameId) cancelAnimationFrame(frameId);
      observer?.disconnect();
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      instance?._destructor?.();
      instance = null;
    };
  }, []);

  return (
    <div
      ref={holder}
      aria-hidden
      className={cn(
        "pointer-events-none transition-opacity duration-1000",
        ready ? "opacity-100" : "opacity-0",
        className,
      )}
    />
  );
}
