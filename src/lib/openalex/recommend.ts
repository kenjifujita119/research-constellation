/** Collaborator recommendation scores. Ported from the original Python implementation
 *  (recommend.py, not included here).
 *
 *  So that the user can choose "why this person", where a candidate came from and the axis they
 *  are sorted on are kept clearly separate. Each component is normalised to 0-1 within the
 *  candidate pool, and each preset takes a weighted average (not a product — so a candidate
 *  scoring 0 on one component can still rise on other evidence).
 *
 *  confidence (how doubtful the author disambiguation is) is **not used for ranking**.
 *  Affiliations are only verified for the top 80, so multiplying by it would penalise only the
 *  people who were checked. */

import type { Recommendation, Recommendations } from "../types.ts";
import type { Evidence, NetGraph, NetNode } from "./network.ts";

/** The band of "close enough to talk to, without overlapping too much". Used by the preset
 *  that looks for complementarity. */
const SIM_CENTER = 0.55;
const SIM_WIDTH = 0.25;
/** A topic the user devotes at least this share to counts as "already covered" */
const COVERED_TAU = 0.1;
/** Above this raw cosine, the two outputs almost fully overlap = a competitor */
const COMPETITOR_SIM = 0.9;

const SAME_INSTITUTION_PENALTY = 0.35;
const SAME_COUNTRY_PENALTY = 0.85;

/** Default year for scoring. Matches the original Python server version (not included here);
 *  recency shifts when the year changes. */
export const CURRENT_YEAR = 2026;

/** Returns the same value as Python's round(x, n).
 *
 *  Sorting uses the rounded score, so a different rounding rule reorders ties. toFixed rounds
 *  using the exact value of x, so it agrees with Python except at an exact half (0.125 and so
 *  on) — Python rounds to even, toFixed rounds away from zero. Only that case is corrected. */
export function pyRound(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  const exact = Math.abs(x).toFixed(100); // 100 decimal places represent any double exactly
  const dot = exact.indexOf(".");
  const tail = exact.slice(dot + 1 + digits);
  const tie = tail[0] === "5" && /^0*$/.test(tail.slice(1));
  if (!tie) return Number(x.toFixed(digits));
  const kept = exact.slice(0, dot + 1 + digits);
  const lastDigit = Number(kept[kept.length - 1] === "." ? kept[kept.length - 2] : kept[kept.length - 1]);
  const down = Number((x < 0 ? "-" : "") + kept);
  return lastDigit % 2 === 0 ? down : Number(x.toFixed(digits));
}

/** How easy it is to be introduced through someone: the harmonic mean of the papers you have with
 *  them and the papers they have with the candidate, so the weaker of the two decides. The list and
 *  the introduction diagram (lib/intro.ts) both order introducers by this, so they agree. */
export function strength(mine: number, theirs: number): number {
  return mine > 0 && theirs > 0 ? (2 * mine * theirs) / (mine + theirs) : 0;
}

export type Preset = {
  key: string;
  label: string;
  description: string;
  /** Which of sim / sim_band / comp / bridge / cites_me / i_cite / cocite / topic / impact to use */
  weights: Record<string, number>;
  /** Drop candidates with no evidence at all from these sources */
  require: string[];
  /** Whether to apply the same-institution / same-country penalty */
  applyKnownPenalty: boolean;
  /** Evidence used as the primary sort key. The combined score only breaks ties */
  sortBy: string | null;
  /** Minimum topic similarity */
  minSim: number;
};

const preset = (p: Pick<Preset, "key" | "label" | "description" | "weights"> & Partial<Preset>): Preset => ({
  require: [],
  applyKnownPenalty: true,
  sortBy: null,
  minSim: 0,
  ...p,
});

export const PRESETS: Preset[] = [
  preset({
    key: "same_topic",
    label: "Same topic",
    description:
      "Closest to the mix of topics you publish in and the work you cite, whether or not you are connected",
    // Shared references get equal weight. Topic similarity after IDF is unstable on its own.
    weights: { sim: 0.5, cocite: 0.5 },
    require: ["topic", "cocite"],
    // A candidate with zero topic overlap once came first on cocite alone.
    minSim: 0.05,
    applyKnownPenalty: false,
  }),
  preset({
    key: "complementary",
    label: "Fills your gaps",
    description:
      "Close enough to your field to talk to, with much of their work in topics you rarely publish in",
    weights: { sim_band: 0.45, comp: 0.55, bridge: 0.25 },
  }),
  preset({
    key: "cites_me",
    label: "They cite you",
    description: "Their papers cite yours, but you have never written a paper together. Most citing papers first",
    weights: { cites_me: 1.0, sim: 0.35 },
    require: ["cites_me"],
    applyKnownPenalty: false,
    sortBy: "cites_me",
  }),
  preset({
    key: "i_cite",
    label: "You cite them",
    description:
      "Authors of papers you cite, whom you have never written a paper with. Most of their papers in your references first",
    weights: { i_cite: 1.0, sim: 0.35 },
    require: ["i_cite"],
    applyKnownPenalty: false,
    sortBy: "i_cite",
  }),
  preset({
    key: "bridge",
    label: "Shared co-authors",
    description:
      "They have written papers with people you have written papers with, who could introduce you",
    weights: { bridge: 1.0, sim: 0.25 },
    require: ["bridge"],
  }),
  preset({
    key: "authority",
    // Ranked by h-index, not by citations, so it is named for what it is
    label: "Highest h-index",
    description:
      "Highest h-index among the candidates who share some of your topics. Narrow Field on the left to scope this to one discipline.",
    weights: { impact: 0.75, sim: 0.25 },
    // Without it, a big name with no topic in common with you could top the list
    minSim: 0.05,
    applyKnownPenalty: false,
  }),
];

/* ---------- Components ---------- */

type Vec = Record<string, number>;

function cosine(a: Vec, b: Vec): number {
  const ak = Object.keys(a);
  if (!ak.length || !Object.keys(b).length) return 0;
  let num = 0;
  for (const [t, w] of Object.entries(a)) if (t in b) num += w * b[t];
  if (!num) return 0;
  let na = 0;
  for (const w of Object.values(a)) na += w * w;
  let nb = 0;
  for (const w of Object.values(b)) nb += w * w;
  return num / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Inverse document frequency of topics within the candidate pool. A topic everyone has tells
 *  no one apart. */
function buildIdf(vectors: Vec[]): Vec {
  const n = vectors.length;
  if (!n) return {};
  const df: Record<string, number> = {};
  for (const v of vectors) for (const topic of Object.keys(v)) df[topic] = (df[topic] ?? 0) + 1;
  return Object.fromEntries(Object.entries(df).map(([t, c]) => [t, Math.log((n + 1) / (c + 1))]));
}

/** The vector reweighted by IDF. Topics with weight 0 are dropped. */
function weighted(vec: Vec, idf: Vec): Vec {
  if (!Object.keys(idf).length) return vec;
  const out: Vec = {};
  for (const [t, w] of Object.entries(vec)) {
    const v = w * (idf[t] ?? 0);
    if (v > 0) out[t] = v;
  }
  return out;
}

/** Share of the candidate's topic mass that falls in areas the user covers thinly (0-1). */
function complementarity(egoVec: Vec, candVec: Vec): number {
  let total = 0;
  for (const [topic, w] of Object.entries(candVec)) {
    total += w * Math.max(0, 1 - (egoVec[topic] ?? 0) / COVERED_TAU);
  }
  return total;
}

/** Topic names shown as "areas you do not cover". */
function missingTopics(egoVec: Vec, node: NetNode, limit = 3): string[] {
  const out: string[] = [];
  for (const t of node.topics ?? []) {
    if ((egoVec[t.id] ?? 0) < COVERED_TAU / 2) out.push(t.name);
    if (out.length >= limit) break;
  }
  return out;
}

/** Gaussian window peaking at 1.0 around 0.55; down-weights candidates too close (competitors)
 *  and too far away. */
const similarityBand = (sim: number) => Math.exp(-(((sim - SIM_CENTER) / SIM_WIDTH) ** 2));

/** Triadic closure with Adamic-Adar weighting. Links through hubs with hundreds of co-authors
 *  count for less. */
function bridgeScore(
  cand: NetNode["bridges"],
  egoWeights: Map<string, number>,
  hop1Degree: Map<string, number | null>,
): number {
  let total = 0;
  for (const b of cand ?? []) {
    const egoMid = egoWeights.get(b.id) ?? 0;
    const midCand = b.weight ?? 0;
    if (!egoMid || !midCand) continue;
    const deg = Math.max(hop1Degree.get(b.id) || 10, 3);
    total += Math.min(egoMid, midCand) / Math.log(deg);
  }
  return total;
}

/** Ratio of output in the last 3 years to the 3 years before. Not used for ranking; only shown
 *  as a badge. */
function momentum(node: NetNode, year: number): number {
  const counts = new Map<number, number>();
  for (const c of node.counts_by_year ?? []) counts.set(c.year, c.works_count ?? 0);
  let recent = 0;
  for (let y = year - 2; y <= year; y++) recent += counts.get(y) ?? 0;
  let prior = 0;
  for (let y = year - 5; y < year - 2; y++) prior += counts.get(y) ?? 0;
  if (recent + prior === 0) return 0;
  return recent / (prior + 1);
}

/** Whether broken author disambiguation has collapsed several people into one record.
 *  For a real researcher, h is roughly of the order of sqrt(number of papers). */
function looksMerged(node: NetNode): boolean {
  const works = node.works_count || 0;
  if (works < 300) return false;
  return (node.h_index || 0) < Math.sqrt(works) / 4;
}

/** OpenAlex keeps some organisations as authors. "South Carolina Department of Health and Human
 *  Services" came sixth in Kenji's "Same topic" list; it is not someone you can write to. */
const ORGANISATION =
  /\b(department|ministry|university|institute|hospital|council|committee|consortium|collaboration|collaborative|investigators|association|society|agency|organi[sz]ation|foundation|services|group|network|centre|center)\b/i;

function looksLikeOrganisation(node: NetNode): boolean {
  return ORGANISATION.test(node.name ?? "");
}

/** 1.0 if they have published in the last 3 years, decaying gently after that. */
function recency(node: NetNode, year: number): number {
  const last = node.active_to;
  if (!last) return 0.3;
  const gap = year - last;
  if (gap <= 3) return 1;
  return Math.max(0.15, Math.exp(-(gap - 3) / 4));
}

function normalise(values: Map<string, number>): Map<string, number> {
  if (!values.size) return new Map();
  const top = Math.max(...values.values());
  if (top <= 0) return new Map([...values.keys()].map((k) => [k, 0]));
  return new Map([...values].map(([k, v]) => [k, v / top]));
}

/* ---------- Scoring ---------- */

type Scored = {
  node: NetNode;
  components: Record<string, number>;
  evidence: Evidence;
  /** IDF-weighted (for ranking) */
  sim: number;
  /** Raw cosine (for spotting competitors) */
  overlap: number;
  comp: number;
  bridgeRaw: number;
  recency: number;
  confidence: number;
  precision: "fine" | "coarse";
  via: Recommendation["via"];
};

const RAW_KEYS = ["bridge", "cites_me", "i_cite", "cocite", "topic", "impact", "momentum"] as const;

/** Computes the components for each candidate. Everything that does not depend on the preset is
 *  done once, here. Passing topic restricts the evidence to that topic. */
function prepare(graph: NetGraph, year = CURRENT_YEAR, topic: string | null = null): Scored[] {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const ego = nodes.get(graph.ego)!;
  const egoVec = ego.topic_vector ?? {};
  const egoFine = ego.topic_vector_fine ?? {};

  const egoWeights = new Map<string, number>();
  const hop1Degree = new Map<string, number | null>();
  for (const n of graph.nodes) {
    if (n.hop !== 1) continue;
    egoWeights.set(n.id, n.collab_with_ego ?? 0);
    hop1Degree.set(n.id, n.coauthor_count ?? null);
  }

  const has = (v: Vec | undefined): v is Vec => !!v && Object.keys(v).length > 0;
  const idfFine = buildIdf(graph.nodes.map((n) => n.topic_vector_fine).filter(has));
  const idfCoarse = buildIdf(graph.nodes.map((n) => n.topic_vector).filter(has));
  const egoFineW = weighted(egoFine, idfFine);
  const egoCoarseW = weighted(egoVec, idfCoarse);

  const scored: Scored[] = [];
  const raw = Object.fromEntries(RAW_KEYS.map((k) => [k, new Map<string, number>()])) as Record<
    (typeof RAW_KEYS)[number],
    Map<string, number>
  >;

  for (const node of graph.nodes) {
    // Never recommend the user, or people they have already co-authored with
    if (node.hop === 0 || node.hop === 1) continue;
    // A record with broken disambiguation, or an organisation, is not a person, so it is not
    // shown on any axis
    if (looksMerged(node) || looksLikeOrganisation(node)) continue;

    let ev: Evidence;
    if (topic === null) ev = node.evidence ?? {};
    else {
      ev = node.evidence_by_topic?.[topic] ?? {};
      if (!Object.keys(ev).length) continue; // never appears under that topic
    }
    const s: Scored = {
      node,
      components: {},
      evidence: ev,
      sim: 0,
      overlap: 0,
      comp: 0,
      bridgeRaw: 0,
      recency: 1,
      confidence: 1,
      precision: "coarse",
      via: [],
    };

    const candFine = node.topic_vector_fine ?? {};
    if (has(egoFine) && has(candFine)) {
      s.sim = cosine(egoFineW, weighted(candFine, idfFine));
      s.overlap = cosine(egoFine, candFine);
      s.comp = complementarity(egoFine, candFine);
      s.precision = "fine";
    } else {
      const candVec = node.topic_vector ?? {};
      s.sim = cosine(egoCoarseW, weighted(candVec, idfCoarse));
      s.overlap = cosine(egoVec, candVec);
      s.comp = complementarity(egoVec, candVec);
      s.precision = "coarse";
    }
    s.bridgeRaw = bridgeScore(node.bridges, egoWeights, hop1Degree);
    s.recency = recency(node, year);
    s.confidence = node.confidence ?? 1;
    // The UI needs the introducers' ids to draw "you -> this person -> candidate". Easiest route
    // first, in the same order as lib/intro.ts routes(), so the list and the diagram agree.
    s.via = [...(node.bridges ?? [])]
      .map((b) => {
        const mine = egoWeights.get(b.id) || 1;
        return { b, mine, s: strength(mine, b.weight || 1) };
      })
      .sort(
        (x, y) =>
          y.s - x.s || y.mine - x.mine || ((x.b.name ?? x.b.id) < (y.b.name ?? y.b.id) ? -1 : 1),
      )
      .slice(0, 3)
      .map(({ b }) => ({ id: b.id, name: b.name, weight: b.weight }));

    const cid = node.id;
    // Counts have very long tails, so compress them with sqrt before normalising
    raw.bridge.set(cid, Math.sqrt(s.bridgeRaw));
    raw.cites_me.set(cid, Math.sqrt(ev.cites_me ?? 0));
    raw.i_cite.set(cid, Math.sqrt(ev.i_cite ?? 0));
    raw.cocite.set(cid, Math.sqrt(ev.cocite ?? 0));
    raw.topic.set(cid, Math.sqrt(ev.topic ?? 0));
    raw.impact.set(cid, Math.log1p(node.h_index || 0));
    raw.momentum.set(cid, Math.min(momentum(node, year), 3));
    scored.push(s);
  }

  const normalised = RAW_KEYS.map((k) => [k, normalise(raw[k])] as const);
  for (const s of scored) {
    for (const [k, values] of normalised) s.components[k] = values.get(s.node.id) ?? 0;
    s.components.sim = s.sim;
    s.components.sim_band = similarityBand(s.sim);
    s.components.comp = s.comp;
  }
  return scored;
}

function rank(
  graph: NetGraph,
  scored: Scored[],
  p: Preset,
  limit = 25,
  year = CURRENT_YEAR,
): Recommendation[] {
  const ego = graph.nodes.find((n) => n.id === graph.ego)!;
  const egoVec = ego.topic_vector ?? {};
  const totalWeight = Object.values(p.weights).reduce((a, b) => a + b, 0) || 1;

  const out: Recommendation[] = [];
  for (const s of scored) {
    const node = s.node;
    if (
      p.require.length &&
      !p.require.some((r) => s.evidence[r] || (r === "bridge" && s.bridgeRaw > 0))
    ) {
      continue;
    }
    if (s.sim < p.minSim) continue;

    let base = 0;
    for (const [name, w] of Object.entries(p.weights)) base += w * (s.components[name] ?? 0);
    base /= totalWeight;

    let known = 1;
    if (p.applyKnownPenalty) {
      if (node.institution_id && node.institution_id === ego.institution_id) {
        known = SAME_INSTITUTION_PENALTY;
      } else if (node.country && node.country === ego.country) {
        known = SAME_COUNTRY_PENALTY;
      }
    }
    // confidence is not multiplied into the score (see the top of the file). Doubts are shown
    // in the UI instead.
    const score = base * s.recency * known;

    out.push({
      id: node.id,
      orcid: node.orcid,
      name: node.name as string,
      institution: node.institution,
      country: node.country,
      h_index: node.h_index,
      works_count: node.works_count,
      active_to: node.active_to,
      topics: (node.topics ?? []).slice(0, 3).map((t) => t.name),
      connection: node.hop === 2 ? "hop2" : "none",
      sim: pyRound(s.sim, 3),
      complementarity: pyRound(s.comp, 3),
      bridge: pyRound(s.bridgeRaw, 3),
      n_bridges: (node.bridges ?? []).length,
      momentum: pyRound(momentum(node, year), 2),
      evidence: s.evidence,
      shared_refs: node.shared_refs ?? null,
      missing_topics: missingTopics(egoVec, node),
      overlap: pyRound(s.overlap, 3),
      is_competitor: s.precision === "fine" && s.overlap >= COMPETITOR_SIM,
      topic_precision: s.precision,
      confidence: s.confidence,
      confidence_reasons: node.confidence_reasons ?? [],
      score: pyRound(score, 4),
      via: s.via,
    });
  }

  // The chosen axis is the primary key. The combined score only breaks ties.
  const by = p.sortBy;
  if (by) {
    out.sort(
      (a, b) =>
        ((b.evidence as Evidence)[by] || 0) - ((a.evidence as Evidence)[by] || 0) ||
        b.score - a.score,
    );
  } else {
    out.sort((a, b) => b.score - a.score);
  }
  return out.slice(0, limit);
}

/** Returns every preset at once. Needs only the cached graph (no API calls). */
export function recommendAll(
  graph: NetGraph,
  limit = 25,
  year = CURRENT_YEAR,
  topic: string | null = null,
): Recommendations {
  const scored = prepare(graph, year, topic);
  return {
    topic,
    presets: PRESETS.map((p) => ({ key: p.key, label: p.label, description: p.description })),
    results: Object.fromEntries(PRESETS.map((p) => [p.key, rank(graph, scored, p, limit, year)])),
  };
}
