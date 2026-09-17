"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as ThreeTypes from "three";
import { buildShape, type Person, type Tie } from "@/lib/shape";
import type { MyWork } from "@/lib/types";

/** The shape of a research career. Nodes are collaborators only (rules in lib/shape.ts).
 *
 *  Colour is per group. What best explained a cluster was people, not subject (share held by
 *  the most frequent co-author: median 100%, versus 47% for subject). Lines take the mix of
 *  their two ends' colours, and the space a group occupies is wrapped in a translucent shell.
 *  That is the marbling.
 *
 *  The shape comes out the same every time. d3-force-3d's initial layout is deterministic;
 *  measured, two runs matched bit for bit. No random numbers are used. */

/** What the colour represents.
 *  "Number of papers together" is not an option: node size already shows it, so it would only
 *  say the same thing twice. */
/** Two colourings were dropped as saying nothing: the year of the first paper together, and
 *  whether there was a paper in the last 3 years — the second contradicted the year slider as
 *  soon as it was moved back before that cut-off. */
export type ShapeColor = "topic" | "cluster" | "role";

export const SHAPE_COLOR_LABELS: Record<ShapeColor, string> = {
  topic: "What you worked on together",
  cluster: "Who writes with whom",
  role: "Your role with them",
};

/** What each colouring means, in one line. Shown under the chooser and in the legend, so the
 *  choice explains itself before it is made. */
export const SHAPE_COLOR_NOTES: Record<ShapeColor, string> = {
  topic:
    "The topic of most of your papers with that person. Striped: you wrote together in several topics.",
  cluster:
    "People who, on your papers, also wrote with each other share a colour. Striped: they write with people in more than one group. The colours only tell the groups apart.",
  role: "Where you were in the author list. Striped: it varies from paper to paper.",
};

/** What the colours mean, drawn in the corner of the shape. Built with the colours themselves,
 *  so the key cannot drift from what is painted. */
type Legend = {
  items?: { label: string; color: string }[];
  note?: string;
};

type Node = Person & { x?: number; y?: number; z?: number };
// 3d-force-graph swaps source/target for the node objects at run time, so override Tie's
// string type here (an intersection type would lose the Node side).
type Link = Omit<Tie, "source" | "target"> & {
  source: string | Node;
  target: string | Node;
};
type Instance = import("3d-force-graph").ForceGraph3DInstance<Node, Link>;

/** Pull back nodes that drift too far from the origin.
 *
 *  The graph is not one connected piece. Kenji's splits into 4 components, and components not
 *  joined by any edge feel only the charge repulsion and drift apart without limit (Measured:
 *  median distance 257 against a maximum of 1,248; a 6-person component sat 1,230 from the
 *  origin). The camera then has to pull right back to fit everything in, the main body shrinks
 *  to a dot, and rotating swings only the distant components around wildly.
 *
 *  Nodes move freely up to `radius`; only the part beyond it is pulled back. Components keep
 *  their placement relative to each other, so the fact that they are apart stays visible while
 *  everything fits on screen.
 *
 *  radius is taken as a function because rebuilding the force on every slider move makes d3
 *  re-run initialize, and the layout jumps. */
function containment(radius: () => number, strength: number) {
  let nodes: Node[] = [];
  const force = (alpha: number) => {
    const r = radius();
    for (const n of nodes) {
      const d = Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0);
      if (d <= r || d === 0) continue;
      const k = ((r - d) / d) * strength * alpha;
      const s = n as Node & { vx: number; vy: number; vz: number };
      s.vx += (n.x ?? 0) * k;
      s.vy += (n.y ?? 0) * k;
      s.vz += (n.z ?? 0) * k;
    }
  };
  force.initialize = (ns: Node[]) => {
    nodes = ns;
  };
  return force;
}

/** Maximum number of paper shells, newest first. */
const MAX_SHEETS = 240;

/** Colours for role. There are only 3, so rather than spreading hues round the colour wheel,
 *  keep 3 fixed, well-separated colours. First = did it yourself (amber), middle = took part
 *  (blue), last = led it (green). */
const ROLE_HUE: Record<"first" | "middle" | "last", number> = {
  first: 38,
  middle: 212,
  last: 152,
};

type Role = keyof typeof ROLE_HUE;

/** Your most frequent position on the papers written with this person. */
function dominantRole(p: Person): Role | null {
  const order: Role[] = ["first", "middle", "last"];
  let best: Role | null = null;
  for (const r of order) {
    if (p.roles[r] > 0 && (best === null || p.roles[r] > p.roles[best])) best = r;
  }
  return best;
}

/** Breakdown of positions shown in the tooltip. The legend gives what the colours mean; this
 *  gives the exact counts behind one person's colour. */
function roleLine(p: Person): string {
  const label: Record<Role, string> = { first: "first", middle: "middle", last: "last" };
  const parts = (Object.keys(ROLE_HUE) as Role[])
    .filter((r) => p.roles[r] > 0)
    .sort((a, b) => p.roles[b] - p.roles[a])
    .map((r) => `${p.roles[r]} ${label[r]}`);
  if (!parts.length) return "";
  return `<br><span style="opacity:.5">You were ${parts.join(" · ")} author</span>`;
}

/** One topic's portion of the sphere's surface. The shares add up to 1. */
type Slice = { color: string; share: number };

/** Colour for anything missing from the colour table. */
const UNKNOWN = "rgb(140,140,140)";

/** Number of topics that get a colour; the rest are grey. Same idea as the co-author view's
 *  palette: handing out more colours than can be told apart makes the distinction a lie. */
const MAIN_TOPICS = 14;

/** Maximum number of people whose spheres are painted in sections. With more, the stripes
 *  blur, and if everyone is striped the stripes distinguish nothing. */
const MAX_STRIPED = 40;

/** Repulsion and link length per slider step. The coefficients are chosen so that the
 *  default, 4, matches the values that used to be hard-coded (-38 / 26). */
const charge = (spacing: number) => -9.5 * spacing;
const rest = (spacing: number) => 6.5 * spacing;

/** A horizontal strip that turns the topic mix directly into a gradient running once round
 *  the sphere.
 *
 *  On a sphere's UV map u is longitude, so a strip one pixel tall carries its colours once
 *  round the sphere. Each topic takes a width proportional to its paper count and blends
 *  smoothly into its neighbours. A person spanning 3 topics really does show 3 colours.
 *
 *  Averaging down to one colour makes "why this colour?" impossible to answer: the result is
 *  no topic's colour, and it may happen to coincide with another topic's colour. */
function ribbon(slices: Slice[], doc: Document): HTMLCanvasElement {
  const w = 256;
  const canvas = doc.createElement("canvas");
  canvas.width = w;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Put each topic's colour in the middle of its own band.
  const centre: number[] = [];
  let at = 0;
  for (const s of slices) {
    centre.push(at + s.share / 2);
    at += s.share;
  }
  // The seam (u=0 and u=1) gets the colour between the last topic and the first. Putting the
  // "last colour" and the "first colour" straight at the ends makes the colour jump there.
  const first = centre[0];
  const last = centre[centre.length - 1] - 1; // the same position, one lap back round the ring
  const t = first === last ? 0 : (0 - last) / (first - last);
  const seam = blend(slices[slices.length - 1].color, slices[0].color, t);

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, seam);
  slices.forEach((s, i) => grad.addColorStop(Math.min(1, Math.max(0, centre[i])), s.color));
  grad.addColorStop(1, seam);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, 1);
  return canvas;
}

/** Mix two rgb() strings in the ratio t : (1 - t). */
function blend(a: string, b: string, t: number): string {
  const parse = (c: string) => {
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(c);
    return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const at = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${at(r1, r2)},${at(g1, g2)},${at(b1, b2)})`;
}

/** The most common colour in the group. Ties go by colour name, so it is always the same. */
function commonest(members: Node[], palette: Map<string, string>): string {
  const tally = new Map<string, number>();
  for (const m of members) {
    const c = palette.get(m.id) ?? UNKNOWN;
    tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  return (
    [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ??
    UNKNOWN
  );
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
  };
  return [f(0), f(8), f(4)];
}
const css = ([r, g, b]: [number, number, number]) =>
  `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;

/** Fit to the visible nodes only. We follow the shape as it grows, so fitting the whole period
 *  would shrink the early years to a dot in the corner. */
function fit(instance: Instance, upTo: number) {
  const ns = instance.graphData().nodes.filter((n) => n.x != null && n.since <= upTo);
  if (!ns.length) return;
  const c = { x: 0, y: 0, z: 0 };
  for (const n of ns) {
    c.x += (n.x ?? 0) / ns.length;
    c.y += (n.y ?? 0) / ns.length;
    c.z += (n.z ?? 0) / ns.length;
  }
  const radius =
    Math.max(
      ...ns.map((n) => Math.hypot((n.x ?? 0) - c.x, (n.y ?? 0) - c.y, (n.z ?? 0) - c.z)),
    ) || 1;
  const fov = ((instance.camera() as { fov?: number }).fov ?? 50) * (Math.PI / 180);
  // Keep the current viewing direction. Resetting only the position mid-rotation makes it jump.
  const cam = instance.cameraPosition();
  let dx = cam.x - c.x;
  let dy = cam.y - c.y;
  let dz = cam.z - c.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  const d = ((radius + 12) / Math.tan(fov / 2)) * 1.15;
  // No tween.
  //
  // OrbitControls reads controls.target every frame to decide the direction. Passing a
  // duration to cameraPosition starts a tween that rewrites target bit by bit as it runs, so
  // any target we set is undone. On top of that, the next fit works out the direction from "the
  // current camera position", so it never catches up and keeps drifting. Measured: the look-at
  // point stayed stuck at y=-141, and a node that belonged at y=-223 was projected to y=1609 on
  // a canvas 601 tall, off screen. Fixing the position and the look-at point at the same moment
  // leaves no room to drift.
  instance.cameraPosition({ x: c.x + dx * d, y: c.y + dy * d, z: c.z + dz * d }, c, 0);
  const controls = instance.controls() as {
    target?: { set: (x: number, y: number, z: number) => void };
    update?: () => void;
  };
  controls?.target?.set(c.x, c.y, c.z);
  controls?.update?.();
}

export default function ShapeGraph({
  works,
  upTo,
  playing,
  colorBy,
  rotationSpeed,
  spread,
  spacing,
  keep,
  onPick,
  onStats,
  sizeSignal,
}: {
  works: MyWork[];
  upTo: number;
  playing: boolean;
  colorBy: ShapeColor;
  /** Degrees per second. Positive is clockwise */
  rotationSpeed: number;
  /** How far from the centre nodes may spread. Only the part beyond this is pulled back */
  spread: number;
  /** How far apart nodes sit. Moves repulsion and link length together */
  spacing: number;
  /** ids of the people to draw. null means everyone. Filtering is the caller's job; this
   *  component sticks to drawing only the people it is given. If the rule for who to show lived
   *  in two places, the graph and the list, they would inevitably disagree. */
  keep: Set<string> | null;
  onPick: (p: Person | null) => void;
  onStats: (s: { people: number; clusters: number }) => void;
  sizeSignal?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const graph = useRef<Instance | null>(null);
  const [ready, setReady] = useState(false);
  // How many times the simulation has come to rest. Used as the signal to rebuild the shells.
  const [settled, setSettled] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const refit = useRef<(() => void) | null>(null);
  const hulls = useRef<(() => void) | null>(null);
  const loaded = useRef(false);

  const all = useMemo(() => buildShape(works), [works]);

  /** When people are filtered out, their lines and shells go with them. Leaving people who are
   *  not drawn inside lines or shells makes it unclear what you are looking at. */
  const shape = useMemo(() => {
    if (!keep) return all;
    return {
      people: all.people.filter((p) => keep.has(p.id)),
      ties: all.ties.filter((t) => keep.has(t.source) && keep.has(t.target)),
      papers: all.papers
        .map((w) => ({ ...w, people: w.people.filter((id) => keep.has(id)) }))
        .filter((w) => w.people.length >= 4),
    };
  }, [all, keep]);

  // Nodes are built from shape alone. Mixing colour in means every colour change rebuilds the
  // objects, replaces graphData and restarts the force layout from scratch (Measured: changing
  // "Colour by" broke the shape).
  const data = useMemo(() => {
    const nodes: Node[] = shape.people.map((p) => {
      // Initial position comes from the id. Random numbers would give a new shape on every open.
      const h = hash(p.id);
      const r = 30 + (h & 63);
      const a = (((h >> 6) & 1023) / 1023) * Math.PI * 2;
      const b = (((h >> 16) & 1023) / 1023) * Math.PI;
      return {
        ...p,
        x: r * Math.sin(b) * Math.cos(a),
        y: r * Math.sin(b) * Math.sin(a),
        z: r * Math.cos(b),
      };
    });
    const byId = new Set(nodes.map((n) => n.id));
    const links: Link[] = shape.ties
      .filter((t) => byId.has(t.source) && byId.has(t.target))
      .map((t) => ({ ...t }));
    return { nodes, links };
  }, [shape]);

  /** id -> colour. Switching the colour scheme only swaps this table. */
  const palette = useMemo(() => {
    const clusterHue = new Map<number, number>();
    const clusters = [...new Set(shape.people.map((p) => p.cluster))].sort((a, b) => a - b);
    // Hand out hues by the golden angle, so neighbouring clusters do not get similar colours.
    clusters.forEach((g, i) => clusterHue.set(g, (i * 137.508) % 360));
    // Topics get hues largest first. The topics you write in most keep the most stable colours,
    // and they line up in the same order when you compare with other researchers.
    const size = new Map<string, number>();
    for (const p of shape.people) {
      for (const t of p.topics) size.set(t.name, (size.get(t.name) ?? 0) + t.papers);
    }
    // Only the main topics get a colour. Past a certain number, colour can no longer carry a
    // distinction; we hit the same thing with the co-author view's palette. Measured: a
    // researcher with 508 papers had 109 topics across 246 people, and painting them all gave
    // an unreadable rainbow (the top 14 cover 75% of the total). The rest are grey.
    const topicHue = new Map<string, number>();
    [...size.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, MAIN_TOPICS)
      .forEach(([t], i) => topicHue.set(t, (i * 137.508) % 360));

    const paint = (p: Person): [number, number, number] => {
      switch (colorBy) {
        case "topic": {
          // The representative colour is exactly the colour of "the topic you mainly worked on
          // together". Averaging hues produces a colour that belongs to no topic, and it can
          // coincide with another topic's colour. Spanning several topics is shown by actually
          // painting the sphere's surface in sections (mix).
          if (!p.topics.length) return hsl(0, 0, 0.42); // papers with no topic
          // Grey if it is not one of the main topics. "You have not worked with them in your
          // main areas" is a readable fact in itself.
          const hue = topicHue.get(p.topics[0].name);
          return hue === undefined ? hsl(0, 0, 0.42) : hsl(hue, 0.6, 0.6);
        }
        case "role": {
          // First = did it yourself / last = led it / middle = took part.
          // The hue used to come from last/(first+last), so people you were a middle author
          // with had first and last both at 0 and dropped to grey. Measured: that was 51 of 87
          // people (59%), so the colour was throwing away what the heading on the same screen
          // showed as "59% middle".
          const top = dominantRole(p);
          if (!top) return hsl(0, 0, 0.42); // position unknown
          return hsl(ROLE_HUE[top], 0.6, 0.6);
        }
        default: {
          const hue = clusterHue.get(p.cluster) ?? 0;
          // Vary slightly within a cluster so the colours do not turn muddy when mixed
          const jitter = ((hash(p.id) & 255) / 255 - 0.5) * 14;
          return hsl(hue + jitter, 0.6, 0.6);
        }
      }
    };

    const color = new Map(shape.people.map((p) => [p.id, css(paint(p))]));

    // Breakdown for painting the sphere's surface in sections. Built only when colouring by
    // topic, and only for people spanning 2 or more topics.
    const mix = new Map<string, Slice[]>();
    if (colorBy === "topic") {
      for (const p of shape.people) {
        if (p.topics.length < 2) continue;
        const total = p.topics.reduce((n, t) => n + t.papers, 0) || 1;
        const slices = p.topics.map((t) => {
          const hue = topicHue.get(t.name);
          return {
            color: hue === undefined ? css(hsl(0, 0, 0.42)) : css(hsl(hue, 0.6, 0.6)),
            share: t.papers / total,
          };
        });
        // If every topic is outside the main ones, there is nothing to split (a single grey).
        if (slices.every((x) => x.color === slices[0].color)) continue;
        mix.set(p.id, slices);
      }
    }
    if (colorBy === "cluster") {
      // Who they write with, group by group. Label propagation gives each person exactly one
      // group, so someone sitting between two of them used to be painted as if they belonged to
      // one. Measured: 23 of Kenji's 85 co-authors (27%) write with people in more than one
      // group, and 570 of 1,133 (50%) for a researcher with 506 papers — common enough that a
      // single colour was hiding it. The bands are the papers they wrote with each group.
      const groupOf = new Map(shape.people.map((p) => [p.id, p.cluster]));
      const papersWith = new Map<string, Map<number, number>>();
      const add = (id: string, group: number | undefined, papers: number) => {
        if (group === undefined) return;
        const at = papersWith.get(id) ?? new Map<number, number>();
        at.set(group, (at.get(group) ?? 0) + papers);
        papersWith.set(id, at);
      };
      for (const t of shape.ties) {
        add(t.source, groupOf.get(t.target), t.papers);
        add(t.target, groupOf.get(t.source), t.papers);
      }
      for (const p of shape.people) {
        const theirs = papersWith.get(p.id);
        if (!theirs || theirs.size < 2) continue; // only ever writes within one group
        let total = 0;
        for (const n of theirs.values()) total += n;
        mix.set(
          p.id,
          [...theirs]
            .sort((a, b) => b[1] - a[1] || a[0] - b[0])
            .map(([group, n]) => ({
              color: css(hsl(clusterHue.get(group) ?? 0, 0.6, 0.6)),
              share: n / (total || 1),
            })),
        );
      }
    }
    if (colorBy === "role") {
      // Position is not always a single one either. Being first author on 1 paper and middle
      // on 2 with the same person is common. Paint in sections the same way as topics.
      for (const p of shape.people) {
        const parts = (Object.keys(ROLE_HUE) as Role[])
          .filter((r) => p.roles[r] > 0)
          .sort((a, b) => p.roles[b] - p.roles[a]);
        if (parts.length < 2) continue;
        const total = parts.reduce((n, r) => n + p.roles[r], 0) || 1;
        mix.set(
          p.id,
          parts.map((r) => ({
            color: css(hsl(ROLE_HUE[r], 0.6, 0.6)),
            share: p.roles[r] / total,
          })),
        );
      }
    }
    // Only large spheres get painted in sections, whichever colouring built them. Stripes on
    // small spheres blur into static, and if everyone is striped the stripes distinguish nothing
    // (Measured: for a researcher with 508 papers, 223 of 246 people qualified on topics and the
    // screen turned into a rainbow). Take the people you wrote with most, only as many as can
    // still be read. Everyone's breakdown stays readable in the tooltip.
    if (mix.size > MAX_STRIPED) {
      const rank = new Map(shape.people.map((p) => [p.id, p.papers]));
      const keep = new Set(
        [...mix.keys()]
          .sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0) || (a < b ? -1 : 1))
          .slice(0, MAX_STRIPED),
      );
      for (const id of [...mix.keys()]) if (!keep.has(id)) mix.delete(id);
    }
    // The colours of the topics themselves. Used to paint the paper shells.
    const topicColor = new Map(
      [...topicHue.entries()].map(([t, h]) => [t, css(hsl(h, 0.6, 0.6))] as const),
    );

    const grey = css(hsl(0, 0, 0.42));
    let legend: Legend;
    switch (colorBy) {
      case "topic": {
        const items = [...topicColor.entries()].map(([label, color]) => ({ label, color }));
        if (size.size > topicHue.size || shape.people.some((p) => !p.topics.length)) {
          items.push({ label: "Other topics", color: grey });
        }
        legend = { items, note: SHAPE_COLOR_NOTES.topic };
        break;
      }
      case "role":
        legend = {
          // No "mostly": someone who was first author on some papers and last on others is
          // painted in bands, and the bands say that better than the word did.
          items: [
            { label: "First author", color: css(hsl(ROLE_HUE.first, 0.6, 0.6)) },
            { label: "Middle author", color: css(hsl(ROLE_HUE.middle, 0.6, 0.6)) },
            { label: "Last author", color: css(hsl(ROLE_HUE.last, 0.6, 0.6)) },
          ],
          note: SHAPE_COLOR_NOTES.role,
        };
        break;
      default:
        legend = { note: SHAPE_COLOR_NOTES.cluster };
    }
    return { color, mix, topicColor: colorBy === "topic" ? topicColor : new Map(), legend };
  }, [shape, colorBy]);

  const latest = useRef({ onPick, upTo, spread, spacing, palette });
  useEffect(() => {
    latest.current = { onPick, upTo, spread, spacing, palette };
  });

  // People who have appeared by that year, and the number of groups they belong to.
  // The header's numbers come from here: counting raw ids before merging gives "90 people",
  // which disagrees with the 88 actually drawn.
  const stats = useMemo(() => {
    const visible = shape.people.filter((p) => p.since <= upTo);
    // A "cluster" of one is someone who has only written with you. That is not a group, and
    // counting them made a big career look like hundreds of clusters.
    const size = new Map<number, number>();
    for (const p of visible) size.set(p.cluster, (size.get(p.cluster) ?? 0) + 1);
    return { people: visible.length, clusters: [...size.values()].filter((n) => n >= 2).length };
  }, [shape, upTo]);
  useEffect(() => {
    onStats(stats);
  }, [stats, onStats]);

  useEffect(() => {
    let disposed = false;
    let instance: Instance | null = null;
    let observer: ResizeObserver | null = null;
    let detach: (() => void) | null = null;
    // Make one sectioned texture per mix and reuse it. Likewise one sphere geometry per radius
    // (Measured: for a researcher with 508 papers, 444 sectioned nodes shared only a handful of
    // radii).
    const skins = new Map<string, ThreeTypes.CanvasTexture>();
    const balls = new Map<number, ThreeTypes.SphereGeometry>();

    Promise.all([import("3d-force-graph"), import("three")]).then(
      ([{ default: ForceGraph3D }, THREE]) => {
        if (disposed || !holder.current) return;
        try {
          const Ctor = ForceGraph3D as unknown as new (el: HTMLElement, cfg?: object) => Instance;
          instance = new Ctor(holder.current, {
            rendererConfig: { antialias: false, powerPreference: "low-power" },
            // The default TrackballControls has no autoRotate (the property does not exist, and
            // assigning it does nothing). Use orbit so the graph can rotate during playback.
            controlType: "orbit",
          });

          instance
            .backgroundColor("#080a10")
            .showNavInfo(false)
            .nodeRelSize(3)
            .nodeResolution(8)
            .nodeVal((n) => 0.7 + n.papers * 0.9)
            .nodeColor((n) => latest.current.palette.color.get(n.id) ?? UNKNOWN)
            // Only people spanning 2 or more topics are swapped for our own mesh with a
            // sectioned sphere. Everyone else keeps the default sphere.
            // Returning null uses the default sphere (three-forcegraph's onCreateObj falls
            // back to the default on a falsy value). The types do not describe that branch,
            // so it is cast through here only.
            .nodeThreeObject(((n: Node) => {
              const slices = latest.current.palette.mix.get(n.id);
              if (!slices || slices.length < 2) return null;
              const key = slices.map((s) => `${s.color}:${s.share.toFixed(3)}`).join("|");
              let texture = skins.get(key);
              if (!texture) {
                texture = new THREE.CanvasTexture(ribbon(slices, document));
                texture.wrapS = THREE.RepeatWrapping;
                texture.colorSpace = THREE.SRGBColorSpace;
                skins.set(key, texture);
              }
              // Same size as the default sphere (three-forcegraph's formula).
              const radius = Math.cbrt(0.7 + n.papers * 0.9) * 3;
              // How many times the strip wraps round. Large spheres get 3: with 1, only half
              // is visible, and from some angles only a single-colour face shows, so the
              // mixing does not come across. On small spheres 3 wraps just blur into static,
              // so use 1 (Measured: for a researcher with 508 papers, 225 of 246 people were
              // painted in sections, most with a radius of around 5).
              const wraps = radius >= 7 ? 3 : 1;
              let ball = balls.get(radius);
              if (!ball) {
                ball = new THREE.SphereGeometry(radius, 20, 16);
                balls.set(radius, ball);
              }
              // A different wrap count needs a separate texture. Changing the shared one would
              // rewrap the other spheres too.
              const skin = wraps === 1 ? texture : texture.clone();
              skin.repeat.x = wraps;
              skin.needsUpdate = true;
              return new THREE.Mesh(
                ball,
                new THREE.MeshLambertMaterial({ map: skin, transparent: true, opacity: 0.95 }),
              );
            }) as unknown as (n: Node) => ThreeTypes.Object3D)
            .nodeOpacity(0.95)
            .nodeVisibility((n) => n.since <= latest.current.upTo)
            .linkVisibility((l) => l.since <= latest.current.upTo)
            // No hover label where there is no hover. A phone has no cursor, but the library keeps
            // the last touch as the pointer and tests it against the spheres every frame, so while
            // the shape turned, each sphere passing under that spot flashed its label. A tap still
            // opens the same details in the panel (onNodeClick).
            .nodeLabel((n) =>
              window.matchMedia("(hover: none)").matches
                ? ""
                : `<div style="font:12px system-ui;padding:6px 8px;background:rgba(0,0,0,.85);border-radius:4px;color:#fff;max-width:240px"><b>${n.name}</b><br><span style="opacity:.7">${n.papers} ${n.papers === 1 ? "paper" : "papers"} with you · ${n.since === n.until ? n.since : `${n.since}–${n.until}`}</span>${
                  n.topics.length
                    ? `<br><span style="opacity:.7">${n.topics
                        .slice(0, 3)
                        .map((t) => `${t.name}${n.papers > 1 ? ` (${t.papers})` : ""}`)
                        .join("<br>")}</span>${
                        n.topics.length > 3
                          ? `<br><span style="opacity:.5">+${n.topics.length - 3} more</span>`
                          : ""
                      }`
                    : ""
                }${roleLine(n)}${
                  n.alsoWith
                    ? `<br><span style="opacity:.5">On your papers, also writes with ${n.alsoWith} of your other co-authors</span>`
                    : ""
                }</div>`,
            )
            // Lines take the mix of their two ends' colours; this is what marbles the space.
            .linkThreeObject((l) => {
              const parse = (c?: string): number[] => {
                const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(c ?? "");
                return m ? [+m[1] / 255, +m[2] / 255, +m[3] / 255] : [0.5, 0.5, 0.5];
              };
              const hue = (e: string | Node) =>
                latest.current.palette.color.get(typeof e === "object" ? e.id : e);
              const s = hue(l.source);
              const t = hue(l.target);
              const geometry = new THREE.BufferGeometry();
              geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
              geometry.setAttribute(
                "color",
                new THREE.BufferAttribute(new Float32Array([...parse(s), ...parse(t)]), 3),
              );
              return new THREE.Line(
                geometry,
                new THREE.LineBasicMaterial({
                  vertexColors: true,
                  transparent: true,
                  opacity: Math.min(0.5, 0.12 + l.papers * 0.1),
                }),
              );
            })
            .linkPositionUpdate((line, { start, end }) => {
              const pos = (
                line as unknown as { geometry: ThreeTypes.BufferGeometry }
              ).geometry.getAttribute("position") as ThreeTypes.BufferAttribute;
              pos.set([start.x, start.y, start.z, end.x, end.y, end.z]);
              pos.needsUpdate = true;
              return true;
            })
            .onNodeClick((n) => latest.current.onPick(n))
            .onBackgroundClick(() => latest.current.onPick(null))
            .cooldownTime(2500)
            // The layout moves because the simulation is reheated whenever the year changes.
            // Measuring mid-motion is always off, so fit once it has come to rest.
            .onEngineStop(() => {
              if (graph.current) fit(graph.current, latest.current.upTo);
              // Build the shells once it has come to rest. Waiting on a timer would leave old
              // shells in place after a slider move had shifted the nodes.
              setSettled((n) => n + 1);
            });

          const s0 = latest.current.spacing;
          instance.d3Force("charge")?.strength(charge(s0)).distanceMax(240);
          instance.d3Force("link")?.distance(rest(s0));
          // Keep disconnected components inside a sphere so they do not fly away.
          instance.d3Force("containment", containment(() => latest.current.spread, 0.55));
          instance.graphData({ nodes: [], links: [] });

          // Grabbing a node and letting go always crashed (Runtime TypeError:
          // Cannot read properties of undefined (reading 'x')). The cause lies at the seam
          // between the libraries:
          //   - three's OrbitControls records finger positions in _pointerPositions, but only
          //     the touch path fills it in. With a mouse it stays empty.
          //   - Every time a node drag ends, 3d-force-graph dispatches a synthetic pointerup
          //     with pointerType:'touch' so that the gesture is not handed on to the camera.
          //   - OrbitControls takes that into its "one finger is still down" branch, reads a
          //     position it never recorded, and crashes.
          // Recording the press position lets the library's recovery path run through as is.
          // What is recorded must be a Vector2. The library calls .set() on the entries in
          // this table, so a plain {x, y} crashes with position.set is not a function
          // (Measured).
          const controls = instance.controls() as unknown as {
            _pointerPositions?: Record<number, ThreeTypes.Vector2>;
          };
          const remember = (e: PointerEvent) => {
            const seen = controls?._pointerPositions;
            if (!seen) return;
            (seen[e.pointerId] ??= new THREE.Vector2()).set(e.pageX, e.pageY);
          };
          const surface = holder.current;
          surface.addEventListener("pointerdown", remember, true);
          detach = () => surface.removeEventListener("pointerdown", remember, true);

          graph.current = instance;
          if (process.env.NODE_ENV !== "production") {
            (window as unknown as { __shape?: Instance }).__shape = instance;
          }
          setReady(true);

          const box = holder.current.parentElement;
          const resize = () => {
            if (!box || !instance) return;
            instance.width(box.clientWidth).height(box.clientHeight);
          };
          refit.current = resize;
          resize();
          if (box) {
            observer = new ResizeObserver(resize);
            observer.observe(box);
          }
        } catch (err) {
          console.warn("3D graph unavailable:", err);
          instance = null;
          setFailure(err instanceof Error ? err.message : String(err));
        }
      },
    );

    return () => {
      disposed = true;
      for (const t of skins.values()) t.dispose();
      skins.clear();
      for (const b of balls.values()) b.dispose();
      balls.clear();
      detach?.();
      observer?.disconnect();
      hulls.current?.();
      instance?._destructor?.();
      graph.current = null;
    };
  }, []);

  // Load data for the whole period, once. Rebuilding it per year restarts the layout every
  // time, so you get flicker instead of growth.
  useEffect(() => {
    const g = graph.current;
    if (!ready || !g) return;
    g.graphData(data);
    loaded.current = true;
  }, [ready, data]);

  // When the year moves, update what is visible and reheat a little. The shape drifts gently as
  // new people appear, so it does not become a series of still images.
  useEffect(() => {
    const g = graph.current;
    if (!ready || !g || !loaded.current) return;
    g.nodeVisibility(g.nodeVisibility()).linkVisibility(g.linkVisibility());
    hulls.current?.();
    // Reheating lets the newly appeared people pull the shape around. Once it settles,
    // onEngineStop re-fits the camera.
    g.d3ReheatSimulation();
  }, [ready, upTo]);

  // Repaint when the colour scheme changes. Lines bake in their end colours when created, so
  // they have to be rebuilt. Node positions are not touched, so the shape does not move.
  useEffect(() => {
    const g = graph.current;
    if (!ready || !g || !loaded.current) return;
    g.nodeColor(g.nodeColor());
    g.nodeThreeObject(g.nodeThreeObject());
    g.linkThreeObject(g.linkThreeObject());
  }, [ready, palette]);

  // The spread sliders. Swapping the forces and reheating moves the current layout into a new
  // equilibrium. Nothing is rebuilt, so the shape stays continuous.
  useEffect(() => {
    const g = graph.current;
    if (!ready || !g || !loaded.current) return;
    g.d3Force("charge")?.strength(charge(spacing)).distanceMax(Math.max(240, spread));
    g.d3Force("link")?.distance(rest(spacing));
    // Remove the shells before anything starts moving. Shells stay put while their contents
    // move, so leaving them on lets the nodes slip out of them.
    hulls.current?.();
    g.d3ReheatSimulation();
  }, [ready, spread, spacing]);

  // Always rotate. Rotating only during playback would snap back to a still image the moment
  // it stops. The centre of rotation is controls.target: the centroid of the nodes visible in
  // that year, which fit() keeps moving.
  useEffect(() => {
    const g = graph.current;
    if (!ready || !g) return;
    const c = g.controls() as { autoRotate?: boolean; autoRotateSpeed?: number } | null;
    if (!c || !("autoRotate" in c)) return;
    c.autoRotate = rotationSpeed !== 0;
    // three's autoRotateSpeed turns anticlockwise when positive. We want clockwise: flip the sign.
    c.autoRotateSpeed = -rotationSpeed;
    return () => {
      c.autoRotate = false;
    };
  }, [ready, rotationSpeed]);

  // What wraps the space is **each individual paper**, not the cluster.
  //
  // Wrapping by cluster gives only one shell per person. In reality, the people you write with
  // most sit inside many papers, so their space should be covered by many overlapping shells
  // and look denser. Clusters cannot show that, because label propagation can put each person
  // in only one. With papers, a person can sit under any number of shells.
  //
  // Every shell is equally faint, and overlap is left to build up density. Where papers on
  // different topics overlap, the colours mix too, so the space of a person spanning several
  // topics takes a different colour from its surroundings.
  //
  // No shells during playback. Rebuilding convex hulls every year is heavy, and when the
  // rebuild falls behind, the previous year's shells linger (Measured: the 2000 view still
  // showed the 2026 shells). While things are moving, only points and lines are shown.
  useEffect(() => {
    const g = graph.current;
    if (!ready || !g) return;
    let cancelled = false;
    if (playing) {
      hulls.current?.();
      return;
    }

    const build = async () => {
      const [THREE, { ConvexGeometry }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/geometries/ConvexGeometry.js"),
      ]);
      if (cancelled || !graph.current) return;
      hulls.current?.();
      const scene = graph.current.scene();
      const added: ThreeTypes.Object3D[] = [];

      const here = new Map(
        graph.current
          .graphData()
          .nodes.filter((n) => n.since <= latest.current.upTo && n.x != null)
          .map((n) => [n.id, n] as const),
      );

      // Newest first, up to the limit, so that a big career does not produce too many shells.
      const sheets = shape.papers
        .filter((w) => w.year <= latest.current.upTo)
        .sort((a, b) => b.year - a.year)
        .slice(0, MAX_SHEETS);

      for (const sheet of sheets) {
        const authors = sheet.people.map((id) => here.get(id)).filter((n) => !!n);
        if (authors.length < 4) continue;
        let geom;
        try {
          geom = new ConvexGeometry(
            authors.map((n) => new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0)),
          );
        } catch {
          continue; // can fail, e.g. when the points are coplanar
        }
        // When colouring by topic, use the paper's own topic colour. With any other scheme,
        // use the most common colour among its authors.
        const tint =
          (sheet.topic ? latest.current.palette.topicColor.get(sheet.topic) : null) ??
          commonest(authors, latest.current.palette.color);
        const mesh = new THREE.Mesh(
          geom,
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(tint),
            transparent: true,
            // Each shell is faint; density comes from overlap. But as the count grows,
            // everything saturates to white, so keep the total amount of ink constant
            // (Measured: laying 240 shells at 0.05 for a researcher with 508 papers turned the
            // shape into a milky lump you could not see into).
            opacity: Math.min(0.05, 1.2 / sheets.length),
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        mesh.renderOrder = -1;
        scene.add(mesh);
        added.push(mesh);
      }
      hulls.current = () => {
        for (const m of added) {
          scene.remove(m);
          const mesh = m as ThreeTypes.Mesh;
          mesh.geometry?.dispose?.();
          (mesh.material as ThreeTypes.Material)?.dispose?.();
        }
        hulls.current = null;
      };
    };

    // Build once it has come to rest (settled goes up). If it has never come to rest yet, wait:
    // shells built from coordinates taken mid-motion are wrong almost at once.
    if (settled > 0) build();
    return () => {
      cancelled = true;
      // Forget to clean up and the previous year's shells linger.
      hulls.current?.();
    };
  }, [ready, data, upTo, playing, palette, settled, shape.papers]);

  useEffect(() => {
    if (!ready) return;
    refit.current?.();
    const t = setTimeout(() => refit.current?.(), 260);
    return () => clearTimeout(t);
  }, [ready, sizeSignal]);

  if (failure) {
    return (
      <div className="grid h-full place-items-center bg-canvas p-8 text-center">
        <p className="max-w-md text-xs leading-relaxed text-white/60">
          Your browser could not start WebGL, so the shape cannot be drawn.
          <br />
          <span className="mt-2 block font-mono text-[10.5px] text-white/40">{failure}</span>
        </p>
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={holder} style={{ position: "absolute", inset: 0 }} />
      <ShapeLegend legend={palette.legend} title={SHAPE_COLOR_LABELS[colorBy]} />
    </div>
  );
}

/** The key to the colours. It can be folded away: once read, it only covers the picture. */
function ShapeLegend({ legend, title }: { legend: Legend; title: string }) {
  if (!legend.items?.length && !legend.note) return null;
  return (
    <details
      open
      className="absolute bottom-3 right-3 max-w-60 rounded-sm bg-black/55 px-3 py-2 text-[11px] leading-relaxed text-white/80 backdrop-blur-sm"
    >
      <summary className="cursor-pointer font-semibold text-white">Colour: {title}</summary>
      {legend.items && (
        <ul className="mt-1.5 max-h-44 space-y-0.5 overflow-y-auto overscroll-contain pr-1">
          {legend.items.map((it) => (
            <li key={it.label} className="flex items-center gap-1.5">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: it.color }}
                aria-hidden
              />
              <span className="min-w-0 truncate">{it.label}</span>
            </li>
          ))}
        </ul>
      )}
      {legend.note && <p className="mt-1.5 text-white/55">{legend.note}</p>}
    </details>
  );
}
