import type { GraphNode, Network } from "./types";

// The 3D view's colour scheme (PALETTE / HOP_COLOR / assignColors) used to live here, but it was
// removed along with the co-author network diagram on the candidate page. The layer colours now
// survive only as the CSS variables (--hop-direct and others) used for the dots in FilterPanel.

export type Filters = {
  hops: Set<number>;
  countries: Set<string>;
  institutions: Set<string>;
  fields: Set<string>;
  query: string;
  minYear: number;
  minCollab: number;
  /** Narrow to one of the ego's topics. null means all topics */
  topic: string | null;
  /** Leave out the ego's own country. Used when checking a grant's international-partner rule */
  excludeHomeCountry: boolean;
};

// All 3 layers are shown by default. hop3 (off-network candidates) used to be hidden — with
// hundreds of people floating unconnected in the co-author graph, the diagram was unreadable.
// That diagram is gone, and the reason to hide them went with it. Hiding them is now the harmful
// choice. Measured: 52–59% of the top 150 recommendation slots were hop3. The unconnected people
// are exactly the "people you don't know yet" that this page is looking for.
export const emptyFilters = (): Filters => ({
  hops: new Set([1, 2, 3]),
  countries: new Set(),
  institutions: new Set(),
  fields: new Set(),
  query: "",
  minYear: 0,
  minCollab: 0,
  topic: null,
  excludeHomeCountry: false,
});

/** Whether the node is involved in the given topic.
 *
 * Direct co-authors are judged by "did you write together on this topic", other candidates by
 * "is there evidence for them on this topic". The kinds of evidence differ, so one test cannot
 * measure both. */
export function inTopic(n: GraphNode, topic: string): boolean {
  if (n.hop === 0) return true;
  if (n.hop === 1) return (n.shared_topics ?? []).includes(topic);
  return Boolean(n.evidence_by_topic?.[topic]);
}

/** Which filter to leave out when evaluating. Used to work out facet counts. */
export type FilterKey = "hops" | "countries" | "institutions" | "fields" | "activity";

/** Whether the node meets the conditions. Only the condition passed as `except` is ignored.
 *
 * The standard way to count a facet is "under every condition except its own". Otherwise, the
 * moment you pick AU under countries, the country list shrinks to AU alone and you can't add US.
 * The institution list, on the other hand, should be narrowed by AU, so a facet leaves out only
 * its own axis. */
export function matches(
  n: GraphNode,
  f: Filters,
  except?: FilterKey,
  egoCountry?: string | null,
): boolean {
  if (except !== "countries" && f.excludeHomeCountry && egoCountry
      && n.country === egoCountry) return false;
  if (except !== "hops" && !f.hops.has(n.hop)) return false;
  if (f.topic && !inTopic(n, f.topic)) return false;
  if (except !== "countries" && f.countries.size
      && !(n.country && f.countries.has(n.country))) return false;
  if (except !== "institutions" && f.institutions.size
      && !(n.institution && f.institutions.has(n.institution))) return false;
  if (except !== "fields" && f.fields.size) {
    const field = n.topics?.[0]?.field;
    if (!field || !f.fields.has(field)) return false;
  }
  if (except !== "activity") {
    if (f.minYear && (n.active_to ?? 0) < f.minYear) return false;
    if (f.minCollab && (n.collab_with_ego ?? 0) < f.minCollab) return false;
  }
  if (f.query) {
    const hay = `${n.name} ${n.institution ?? ""} ${n.country ?? ""}`.toLowerCase();
    if (!hay.includes(f.query)) return false;
  }
  return true;
}

/** The ego is always kept (without it, there is no telling whose graph this is). */
export function isVisible(
  n: GraphNode, f: Filters, egoCountry?: string | null,
): boolean {
  return n.hop === 0 || matches(n, f, undefined, egoCountry);
}

export function applyFilters(net: Network, f: Filters) {
  const egoCountry = net.nodes.find((n) => n.id === net.ego)?.country ?? null;
  const kept = new Set(
    net.nodes.filter((n) => isVisible(n, f, egoCountry)).map((n) => n.id),
  );
  kept.add(net.ego);
  const nodes = net.nodes.filter((n) => kept.has(n.id));
  const links = net.links.filter((l) => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    return kept.has(s) && kept.has(t);
  });
  return { nodes, links };
}

export type Facet = { value: string; count: number };

export function facet(nodes: GraphNode[], pick: (n: GraphNode) => string | null | undefined): Facet[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const v = pick(n);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}
