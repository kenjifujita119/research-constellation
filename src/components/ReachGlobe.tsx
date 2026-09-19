"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as ThreeTypes from "three";
import { COUNTRIES, onGlobe, type Place } from "@/lib/countries";

/** Shows on a globe how far your work has reached.
 *
 *  It used to be a force layout with papers as nodes, and with 800 points scattered about there
 *  was no telling where to look. Even after the switch to a globe, at first it had only ocean and
 *  latitude/longitude lines, so it was still "just dots floating, and it is not clear what it is
 *  saying". A globe works because everyone knows the shapes of the continents; without them it is
 *  just a sphere. Only after drawing borders, showing names and giving your own country a
 *  different colour could "this is how far it reached" be read.
 *
 *  Borders are Natural Earth (public domain), loaded via world-atlas.
 *  This is going to be a paid product, so always check where data comes from and its licence. */

export type Reach = Record<string, [number, number][]>; // country code -> [[year, count], ...]

/** What the citations from a country are made of. color is the area, share its fraction
 *  (they sum to 1). */
export type Slice = { color: string; share: number };

const RADIUS = 100;
/** Number of countries whose names are shown. Too many and the globe fills up with text. */
const LABELS = 8;

type Landing = {
  code: string;
  place: Place;
  total: number;
  /** The year citations first arrived from there. The dot is drawn large in that year only */
  firstYear: number;
  byYear: Map<number, number>;
};

type Label = { code: string; name: string; x: number; y: number; shown: boolean };

export default function ReachGlobe({
  reach,
  mixOf,
  upTo,
  since = 0,
  spin,
  selected,
  onPick,
  onOpen,
}: {
  reach: Reach;
  /** Country -> breakdown of the citations that came from it, largest share first.
   *
   *  Not one colour per country, because measured data shows that would be false. Measured: the
   *  top area is less than half of a country's citations in 79% of countries for a researcher
   *  with 508 papers (median 38%), and in 20% for Kenji. Japan has 444 citations across 63 areas,
   *  with the top one at 33%. Squashing it into one colour would throw away two thirds and call
   *  it a single-topic country. */
  mixOf: (code: string) => Slice[];
  /** Light up only what had arrived by this year */
  upTo: number;
  /** Count only citations from this year on (0 = from the start). Passed as a value rather than
   *  filtered out of `reach`, because a new `reach` rebuilds the whole globe. */
  since?: number;
  spin: boolean;
  /** The country whose breakdown is open. Make it visible on the globe as well */
  selected: string | null;
  onPick: (c: { code: string; name: string; count: number } | null) => void;
  /** A country was clicked. Open its breakdown */
  onOpen: (code: string) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const latest = useRef({ upTo, since, spin, onPick, onOpen, selected });
  useEffect(() => {
    latest.current = { upTo, since, spin, onPick, onOpen, selected };
  });

  const landings = useMemo<Landing[]>(() => {
    const out: Landing[] = [];
    for (const [code, years] of Object.entries(reach)) {
      const place = COUNTRIES[code];
      if (!place) continue; // codes not in the table can't be placed; the page shows the count
      const byYear = new Map<number, number>();
      let total = 0;
      for (const [y, n] of years) {
        byYear.set(y, (byYear.get(y) ?? 0) + n);
        total += n;
      }
      out.push({ code, place, total, firstYear: years[0]?.[0] ?? 0, byYear });
    }
    return out.sort((a, b) => b.total - a.total);
  }, [reach]);


  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;

    Promise.all([
      import("three"),
      import("three/examples/jsm/controls/OrbitControls.js"),
      import("topojson-client"),
      import("world-atlas/countries-110m.json"),
    ])
      .then(([THREE, { OrbitControls }, topojson, atlas]) => {
        if (disposed || !holder.current) return;
        const box = holder.current;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color("#080a10");

        const camera = new THREE.PerspectiveCamera(
          40,
          box.clientWidth / Math.max(box.clientHeight, 1),
          1,
          3000,
        );
        // Start facing the direction with the most reached countries. Only half the globe is
        // visible, so if it opens on empty ocean, nothing gets across.
        const facing = new THREE.Vector3();
        for (const l of landings) {
          facing.add(
            new THREE.Vector3(...onGlobe(l.place.lat, l.place.lon, 1)).multiplyScalar(
              Math.sqrt(l.total),
            ),
          );
        }
        if (facing.lengthSq() === 0) facing.set(0, 0, 1);
        // If the globe fills the screen, there is no telling where to look.
        // Pick a distance at which the 200-unit diameter takes up about 70% of the height.
        camera.position.copy(facing.setLength(400));

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(box.clientWidth, box.clientHeight);
        box.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.enablePan = false;
        controls.minDistance = 150;
        controls.maxDistance = 700;
        // Clockwise, to match the direction on the Shape screen.
        controls.autoRotateSpeed = -0.9;

        // --- Ocean ----------------------------------------------------
        scene.add(
          new THREE.Mesh(
            new THREE.SphereGeometry(RADIUS, 64, 48),
            new THREE.MeshBasicMaterial({ color: "#0e1626" }),
          ),
        );

        // --- Borders --------------------------------------------------
        // Without these the dot positions cannot be read. It only becomes a globe once the
        // continents take shape.
        const segments: number[] = [];
        const shape = topojson.feature(
          atlas.default as unknown as Parameters<typeof topojson.feature>[0],
          (atlas.default as unknown as { objects: { countries: object } }).objects
            .countries as Parameters<typeof topojson.feature>[1],
        ) as unknown as {
          features: { geometry: { type: string; coordinates: number[][][] | number[][][][] } }[];
        };
        for (const f of shape.features) {
          const polygons =
            f.geometry.type === "Polygon"
              ? [f.geometry.coordinates as number[][][]]
              : (f.geometry.coordinates as number[][][][]);
          for (const polygon of polygons) {
            for (const ring of polygon) {
              for (let i = 0; i + 1 < ring.length; i++) {
                segments.push(
                  ...onGlobe(ring[i][1], ring[i][0], RADIUS + 0.35),
                  ...onGlobe(ring[i + 1][1], ring[i + 1][0], RADIUS + 0.35),
                );
              }
            }
          }
        }
        const borders = new THREE.BufferGeometry();
        borders.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
        scene.add(
          new THREE.LineSegments(
            borders,
            new THREE.LineBasicMaterial({ color: "#33506f", transparent: true, opacity: 0.9 }),
          ),
        );

        // --- Countries reached ----------------------------------------
        // A dot is not a sphere but a flat board that always faces the camera, so a pie chart
        // can be applied to it as is.
        const dots: { mesh: ThreeTypes.Sprite; landing: Landing; size: number }[] = [];
        const biggest = landings[0]?.total || 1;
        // Do not rebuild the texture for a breakdown that already has one.
        const skins = new Map<string, ThreeTypes.CanvasTexture>();
        const skinFor = (slices: Slice[]) => {
          const key = slices.map((v) => `${v.color}:${v.share.toFixed(3)}`).join("|");
          let texture = skins.get(key);
          if (!texture) {
            texture = pie(slices, THREE, document);
            skins.set(key, texture);
          }
          return texture;
        };
        for (const landing of landings) {
          const [x, y, z] = onGlobe(landing.place.lat, landing.place.lon, RADIUS + 1.2);
          const size = 1.7 + Math.sqrt(landing.total / biggest) * 5.2;
          const slices = mixOf(landing.code);
          // On a small dot the wedges get squashed, so paint it in the top colour alone. Reset
          // share to 1: passing the original fraction (e.g. 0.33) draws only a third of the
          // circle, and it looks bitten into, like Pac-Man.
          const shown =
            slices.length > 1 && size >= PIE_FROM
              ? slices
              : [{ color: slices[0].color, share: 1 }];
          const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: skinFor(shown), transparent: true }),
          );
          sprite.position.set(x, y, z);
          sprite.scale.setScalar(size * 2);
          scene.add(sprite);
          dots.push({ mesh: sprite, landing, size });
        }

        // --- Hit testing ----------------------------------------------
        const ray = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        const onMove = (e: PointerEvent) => {
          const r = renderer.domElement.getBoundingClientRect();
          pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
          pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
          ray.setFromCamera(pointer, camera);
          const hit = ray.intersectObjects(dots.map((d) => d.mesh))[0];
          const found = hit && dots.find((d) => d.mesh === hit.object);
          const shown = found && countIn(found.landing, latest.current.upTo, latest.current.since);
          renderer.domElement.style.cursor = found ? "pointer" : "grab";
          latest.current.onPick(
            found && shown
              ? { code: found.landing.code, name: found.landing.place.name, count: shown }
              : null,
          );
        };
        renderer.domElement.addEventListener("pointermove", onMove);

        // A click opens the breakdown. So that dragging to rotate does not open it, only count
        // it when the pointer has barely moved since it was pressed.
        let pressed: { x: number; y: number } | null = null;
        const onDown = (e: PointerEvent) => {
          pressed = { x: e.clientX, y: e.clientY };
        };
        const onUp = (e: PointerEvent) => {
          if (!pressed) return;
          const moved = Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y);
          pressed = null;
          if (moved > 4) return;
          const r = renderer.domElement.getBoundingClientRect();
          pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
          pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
          ray.setFromCamera(pointer, camera);
          const hit = ray.intersectObjects(dots.map((d) => d.mesh))[0];
          const found = hit && dots.find((d) => d.mesh === hit.object);
          if (found && countIn(found.landing, latest.current.upTo, latest.current.since)) {
            latest.current.onOpen(found.landing.code);
          }
        };
        renderer.domElement.addEventListener("pointerdown", onDown);
        renderer.domElement.addEventListener("pointerup", onUp);

        // --- Drawing --------------------------------------------------
        const colour = new THREE.Color();
        let shownYear = -1;
        let shownSince = -1;
        let shownChoice: string | null = null;
        const paint = (year: number) => {
          for (const { mesh, landing, size } of dots) {
            const n = countIn(landing, year, latest.current.since);
            const material = mesh.material as ThreeTypes.SpriteMaterial;
            if (!n) {
              mesh.visible = false;
              continue;
            }
            mesh.visible = true;
            const weight = Math.min(1, Math.sqrt(n / biggest) * 1.6);
            // The colour lives in the pie texture. material.color multiplies it, so unless it
            // stays white the breakdown colours turn muddy. Only brightness is used, for "just
            // arrived this year" and "the country that is open now".
            const arrived = !!landing.byYear.get(year);
            const chosen = landing.code === latest.current.selected;
            const lift = chosen ? 1.7 : arrived ? 1.3 : 1;
            colour.setRGB(lift, lift, lift);
            material.color.copy(colour);
            material.opacity = 0.78 + weight * 0.22;
            // Enlarge only in the year citations first arrived. If you cannot see which dot has
            // just lit up, playback does not show the work spreading.
            const arriving = landing.firstYear === year ? 2.1 : 1;
            mesh.scale.setScalar(size * 2 * arriving * (chosen ? 1.5 : 1));
          }
        };

        // --- Names -----------------------------------------------------
        // Show names for the top countries only, while they face the camera. The screen should
        // not tell you nothing until you hover.
        const project = new THREE.Vector3();
        const toCamera = new THREE.Vector3();
        let sinceLabels = 0;
        const updateLabels = () => {
          const year = latest.current.upTo;
          const out: Label[] = [];
          const named = landings.filter((l) => countIn(l, year, latest.current.since) > 0).slice(0, LABELS);
          const placed: { x: number; y: number }[] = [];
          for (const l of named) {
            const [x, y, z] = onGlobe(l.place.lat, l.place.lon, RADIUS + 3);
            project.set(x, y, z);
            // Do not show names that have gone round to the far side of the globe
            toCamera.copy(camera.position).sub(project);
            const facingUs = project.clone().normalize().dot(toCamera.normalize()) > 0.12;
            project.project(camera);
            const sx = ((project.x + 1) / 2) * box.clientWidth;
            const sy = ((1 - project.y) / 2) * box.clientHeight;
            // Skip names that sit too close together. Overlapping makes all of them unreadable.
            const clear = placed.every((p) => Math.abs(p.x - sx) > 60 || Math.abs(p.y - sy) > 13);
            if (facingUs && clear) placed.push({ x: sx, y: sy });
            out.push({
              code: l.code,
              name: l.place.name,
              x: sx,
              y: sy,
              shown: facingUs && clear,
            });
          }
          setLabels(out);
        };

        let frame = 0;
        const tick = () => {
          frame = requestAnimationFrame(tick);
          const { upTo: year, spin: spinning } = latest.current;
          controls.autoRotate = spinning;
          if (
            year !== shownYear ||
            latest.current.since !== shownSince ||
            latest.current.selected !== shownChoice
          ) {
            paint(year);
            shownYear = year;
            shownSince = latest.current.since;
            shownChoice = latest.current.selected;
          }
          controls.update();
          renderer.render(scene, camera);
          // Name positions are not needed every frame. Once every 3 frames is enough.
          if (++sinceLabels >= 3) {
            sinceLabels = 0;
            updateLabels();
          }
        };
        tick();

        const resize = () => {
          if (!box.clientWidth) return;
          camera.aspect = box.clientWidth / Math.max(box.clientHeight, 1);
          camera.updateProjectionMatrix();
          renderer.setSize(box.clientWidth, box.clientHeight);
        };
        const observer = new ResizeObserver(resize);
        observer.observe(box);

        stop = () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          for (const t of skins.values()) t.dispose();
          skins.clear();
          renderer.domElement.removeEventListener("pointermove", onMove);
          renderer.domElement.removeEventListener("pointerdown", onDown);
          renderer.domElement.removeEventListener("pointerup", onUp);
          controls.dispose();
          renderer.dispose();
          scene.traverse((o) => {
            const mesh = o as ThreeTypes.Mesh;
            mesh.geometry?.dispose?.();
            const m = mesh.material as ThreeTypes.Material | ThreeTypes.Material[] | undefined;
            if (Array.isArray(m)) m.forEach((x) => x.dispose());
            else m?.dispose?.();
          });
          box.removeChild(renderer.domElement);
        };
      })
      .catch((err) => {
        console.warn("Globe unavailable:", err);
        setFailure(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      stop?.();
    };
  }, [landings, mixOf]);

  if (failure) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-xs text-muted-foreground">
        The globe could not start on this device. {failure}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={holder} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {labels.map((l) => (
          <span
            key={l.code}
            className="absolute -translate-x-1/2 whitespace-nowrap text-[10.5px] font-medium tracking-wide text-white/85"
            style={{
              left: l.x,
              top: l.y,
              opacity: l.shown ? 1 : 0,
              textShadow: "0 1px 3px rgba(0,0,0,.9)",
            }}
          >
            {l.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Number of citations from that country from `since` (0 = the start) up to that year. */
function countIn(
  landing: { byYear: Map<number, number> },
  year: number,
  since: number,
): number {
  let n = 0;
  for (const [y, c] of landing.byYear) if (y <= year && y >= since) n += c;
  return n;
}

/** A texture that draws the breakdown as a pie chart.
 *
 *  The first attempt wrapped latitude stripes round a sphere, and it could not be read: sphere
 *  UVs bunch up towards the poles, so seen head-on only the middle stripe came out wide and the
 *  rest were squashed against the rim. A dot is only about 10px, so it looked like one colour.
 *
 *  So a dot is not a sphere but a board that always faces the camera (Sprite), with the pie chart
 *  applied to it directly. The texture maps one-to-one onto the circle you see, so the shares can
 *  be read even when the dot is small. */
function pie(slices: Slice[], THREE: typeof ThreeTypes, doc: Document): ThreeTypes.CanvasTexture {
  const S = 64;
  const canvas = doc.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const r = S / 2 - 2;
  // Always go all the way round, even if the shares do not sum to 1. A circle with a gap reads
  // not as "a small share" but as "broken", so normalise here and close it.
  const sum = slices.reduce((a, v) => a + v.share, 0) || 1;
  // Clockwise from the top, the way pie charts are read.
  let from = -Math.PI / 2;
  for (const v of slices) {
    const to = from + (v.share / sum) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(S / 2, S / 2);
    // Rounding gaps between wedges show up as black lines. Overlap them slightly.
    ctx.arc(S / 2, S / 2, r, from, to + 0.02);
    ctx.closePath();
    ctx.fillStyle = v.color;
    ctx.fill();
    from = to;
  }
  // Without an outline on the dark globe, neighbouring dots melt into each other.
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, r, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(8,10,16,.85)";
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Smallest dot size (world units) drawn as a pie. On smaller dots the wedges drop below 1px and
 *  just turn muddy, so they are painted in the top area's colour only. */
const PIE_FROM = 2.6;
