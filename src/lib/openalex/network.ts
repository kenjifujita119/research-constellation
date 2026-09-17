/** Builds a co-author ego network, starting from an ORCID.
 *
 *  Ported from the original Python implementation (apps/api/coauthor/network.py, not
 *  included here), with the same approach:
 *    hop1 (direct co-authors)  years and shared papers, taken from the ego's own works
 *    hop2 (second-degree)      group_by counts only; one request per direct co-author
 *  A hop2 candidate is kept according to how many hop1 people it is reached through
 *  (bridges).
 *
 *  Python dicts keep insertion order, so the same order is reproduced here with Map and
 *  plain objects (string keys keep insertion order). Ties in sorting are settled by
 *  insertion order, so disturbing the order changes the recommendation ranking. */

import type { Bridge, EgoWork, GraphMeta, Recommendations, SharedWork, Topic } from "../types.ts";
import type { OpenAlexClient, RawAuthor, RawTopic, RawWork } from "./client.ts";
import { shortId } from "./client.ts";
import { mergeMap } from "./identity.ts";
import { collapseVersions } from "./versions.ts";

export type Progress = (message: string) => void;

/** Publication years later than this are bad data (18 of Kenji's candidates showed as
 *  publishing until 10000). Next year is allowed: journals date issues ahead. */
const LATEST_YEAR = new Date().getFullYear() + 1;
export type Evidence = Record<string, number>;
export type YearCount = { year: number; works_count?: number | null; cited_by_count?: number | null };

export type NetNode = {
  id: string;
  orcid: string | null;
  name: string | null;
  /** 0 = the ego, 1 = direct co-author, 2 = second-degree, 3 = off-network candidate */
  hop: 0 | 1 | 2 | 3;
  works_count: number;
  cited_by_count: number;
  h_index: number | null;
  i10_index: number | null;
  active_from: number | null;
  active_to: number | null;
  topics: Topic[];
  topic_vector: Record<string, number>;
  counts_by_year: YearCount[];
  institution: string | null;
  institution_id: string | null;
  country: string | null;
  ror: string | null;
  topic_vector_fine?: Record<string, number>;
  collab_with_ego?: number;
  first_collab_year?: number | null;
  last_collab_year?: number | null;
  shared_works?: SharedWork[];
  shared_topics?: string[];
  coauthor_count?: number | null;
  bridges?: Bridge[];
  /** Whether introducers were recounted without the cut-off when the candidate was opened */
  bridges_checked?: boolean;
  evidence?: Evidence;
  evidence_by_topic?: Record<string, Evidence>;
  /** Works cited both by the ego and in this person's recent papers (see enrich.ts) */
  shared_refs?: number;
  group?: number | null;
  group_name?: string | null;
  confidence?: number;
  confidence_reasons?: string[];
  institution_raw?: string | null;
  country_raw?: string | null;
};

export type NetLink = { source: string; target: string; weight: number };

export type NetMeta = GraphMeta & {
  version: number;
  topic_names: Record<string, string>;
};

/** The ego's works, used by discover.ts for citations, bibliographic coupling and the
 *  per-theme breakdown. Not stored. */
export type EgoWorkRaw = { id: string; primary_topic?: RawTopic; referenced_works: string[] };

export type NetGraph = {
  ego: string;
  nodes: NetNode[];
  links: NetLink[];
  ego_works: EgoWork[];
  meta: NetMeta;
  recommendations?: Recommendations;
  /** The ego's split author records. pipeline takes them out and drops them */
  _ego_ids?: string[];
  _ego_works?: EgoWorkRaw[];
  /** Introducers for everyone seen while collecting second-degree co-authors:
   *  {candidate: {direct co-author: shared papers}}. Includes people who did not make the
   *  second-degree cut. pipeline re-attaches these to candidates, then drops them */
  _bridges?: Map<string, Map<string, number>>;
};

/* ---------- Values for one person ---------- */

/** An author's topic mix: the topics' counts normalised to sum to 1.
 *  OpenAlex's topic_share is a share of the whole world's output, so it cannot be used to
 *  compare authors. */
function topicVector(author: RawAuthor): Record<string, number> {
  const topics = author.topics ?? [];
  const total = topics.reduce((acc, t) => acc + (t.count ?? 0), 0);
  if (!total) return {};
  return Object.fromEntries(topics.map((t) => [shortId(t.id), (t.count ?? 0) / total]));
}

function primaryAffiliation(author: RawAuthor) {
  let insts = author.last_known_institutions ?? [];
  if (!insts.length) {
    // Even when the latest affiliation is empty, affiliations may still hold the history
    const latest = (a: { years?: number[] | null }) => Math.max(...(a.years?.length ? a.years : [0]));
    const affs = [...(author.affiliations ?? [])].sort((a, b) => latest(b) - latest(a));
    insts = affs.length ? [affs[0].institution] : [];
  }
  if (!insts.length) return { institution: null, institution_id: null, country: null, ror: null };
  const inst = insts[0];
  return {
    institution: inst.display_name ?? null,
    institution_id: inst.id ? shortId(inst.id) : null,
    country: inst.country_code ?? null,
    ror: inst.ror ?? null,
  };
}

/** A fine-grained topic distribution, counted from the works' primary_topic.
 *  The author record's topics return only the top 5, which pins similarity at 0.9. */
export function worksTopicVector(works: { primary_topic?: RawTopic }[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const w of works) {
    const topic = w.primary_topic?.id;
    if (topic) counts.set(shortId(topic), (counts.get(shortId(topic)) ?? 0) + 1);
  }
  let total = 0;
  for (const n of counts.values()) total += n;
  if (!total) return {};
  return Object.fromEntries([...counts].map(([k, v]) => [k, v / total]));
}

/** The years someone was actually publishing. By default, the range of years that covers
 *  95% of their output. Taking the first and last years breaks with a single stray paper
 *  (one prolific researcher showed up as 1890-2025).
 *  The ego gets exact: they can remove stray papers themselves, so every paper left is
 *  theirs. */
export function activeYears(countsByYear: YearCount[], exact = false): [number | null, number | null] {
  const counts = countsByYear
    .filter((c) => c.works_count && c.year <= LATEST_YEAR)
    .map((c) => [c.year, c.works_count as number] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!counts.length) return [null, null];
  if (exact) return [counts[0][0], counts[counts.length - 1][0]];
  const total = counts.reduce((acc, [, w]) => acc + w, 0);
  let cumulative = 0;
  let start = counts[0][0];
  for (const [year, works] of counts) {
    cumulative += works;
    if (cumulative >= total * 0.05) {
      start = year;
      break;
    }
  }
  return [start, counts[counts.length - 1][0]];
}

export function nodeFromAuthor(author: RawAuthor, hop: NetNode["hop"]): NetNode {
  const stats = author.summary_stats ?? {};
  const [first, last] = activeYears(author.counts_by_year ?? [], hop === 0);
  const orcid = author.orcid ? author.orcid.slice(author.orcid.lastIndexOf("/") + 1) : "";
  return {
    id: shortId(author.id),
    orcid: orcid || null,
    name: author.display_name ?? null,
    hop,
    works_count: author.works_count ?? 0,
    cited_by_count: author.cited_by_count ?? 0,
    h_index: stats.h_index ?? null,
    i10_index: stats.i10_index ?? null,
    active_from: first,
    active_to: last,
    topics: (author.topics ?? []).slice(0, 5).map((t) => ({
      id: shortId(t.id),
      name: t.display_name,
      subfield: t.subfield?.display_name ?? null,
      field: t.field?.display_name ?? null,
      count: t.count ?? 0,
    })),
    topic_vector: topicVector(author),
    // Used to compute momentum (recent growth)
    counts_by_year: author.counts_by_year ?? [],
    ...primaryAffiliation(author),
  };
}

/** Rebuilds the ego's displayed values from only the works left after exclusions (papers
 *  marked "not mine"), folded preprints and corrections. If the removed papers still counted,
 *  "Military Technology and Strategies" would stay stuck among the themes in the header. */
function rebuildEgoFromWorks(node: NetNode, works: RawWork[], dropped: RawWork[]): void {
  if (!dropped.length) return;

  const counts = new Map<string, number>();
  const meta = new Map<string, NonNullable<RawTopic>>();
  for (const w of works) {
    const topic = w.primary_topic;
    if (!topic?.id) continue;
    const key = shortId(topic.id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!meta.has(key)) meta.set(key, topic);
  }
  let total = 0;
  for (const n of counts.values()) total += n;
  if (total) {
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5);
    node.topics = top.map(([key, n]) => ({
      id: key,
      name: meta.get(key)!.display_name as string,
      subfield: meta.get(key)!.subfield?.display_name ?? null,
      field: meta.get(key)!.field?.display_name ?? null,
      count: n,
    }));
    node.topic_vector = Object.fromEntries(top.map(([key, n]) => [key, n / total]));
  }

  node.works_count = Math.max(0, (node.works_count || 0) - dropped.length);

  // Subtract the removed papers from their publication years, then recompute the active span.
  const byYear = new Map<number, number>();
  for (const c of node.counts_by_year) byYear.set(c.year, c.works_count || 0);
  for (const w of dropped) {
    const year = w.publication_year;
    if (year != null && byYear.has(year)) byYear.set(year, byYear.get(year)! - 1);
  }
  node.counts_by_year = [...byYear]
    .sort((a, b) => a[0] - b[0])
    .filter(([, n]) => n > 0)
    .map(([year, n]) => ({ year, works_count: n }));
  [node.active_from, node.active_to] = activeYears(node.counts_by_year, true);
}

/* ---------- Folding split author records ---------- */

/** Merges `other` into `into`. What can be summed is summed; what cannot takes the larger.
 *  h_index depends on the set of papers, so it takes the maximum (correct as a lower bound). */
export function absorb(into: NetNode, other: NetNode): void {
  for (const f of ["works_count", "cited_by_count", "collab_with_ego"] as const) {
    if (other[f]) into[f] = (into[f] || 0) + (other[f] as number);
  }
  for (const f of ["h_index", "i10_index", "coauthor_count"] as const) {
    const v = other[f];
    if (v != null) into[f] = Math.max(into[f] || 0, v);
  }
  for (const f of ["active_from", "first_collab_year"] as const) {
    const v = other[f];
    if (v != null) into[f] = Math.min(into[f] || v, v);
  }
  for (const f of ["active_to", "last_collab_year"] as const) {
    const v = other[f];
    if (v != null) into[f] = Math.max(into[f] || v, v);
  }
  // Take the nearer hop. A direct co-author stays direct even if the other record is
  // second-degree.
  into.hop = Math.min(into.hop ?? other.hop, other.hop) as NetNode["hop"];
  if (other.shared_topics?.length) {
    into.shared_topics = [...new Set([...(into.shared_topics ?? []), ...other.shared_topics])].sort();
  }
  if (other.shared_works?.length) {
    const seen = new Set((into.shared_works ?? []).map((w) => w.id));
    into.shared_works = [
      ...(into.shared_works ?? []),
      ...other.shared_works.filter((w) => !seen.has(w.id)),
    ];
  }
  if (other.counts_by_year?.length) {
    const per = new Map<number, number>();
    for (const row of [...(into.counts_by_year ?? []), ...other.counts_by_year]) {
      per.set(row.year, (per.get(row.year) ?? 0) + (row.works_count || 0));
    }
    into.counts_by_year = [...per]
      .sort((a, b) => b[0] - a[0])
      .map(([year, works_count]) => ({ year, works_count }));
  }
  if (other.bridges?.length) {
    const weight = new Map((into.bridges ?? []).map((b) => [b.id, { ...b }]));
    for (const b of other.bridges) {
      const at = weight.get(b.id);
      if (at) at.weight = (at.weight || 0) + (b.weight || 0);
      else weight.set(b.id, { ...b });
    }
    into.bridges = [...weight.values()].sort((a, b) => (b.weight || 0) - (a.weight || 0));
  }
  // Recommendation evidence. Unless the split record's share is added too, merging would
  // lower the ranking.
  if (other.evidence && Object.keys(other.evidence).length) {
    const base: Evidence = { ...(into.evidence ?? {}) };
    for (const [k, v] of Object.entries(other.evidence)) base[k] = (base[k] ?? 0) + v;
    into.evidence = base;
  }
  if (other.evidence_by_topic && Object.keys(other.evidence_by_topic).length) {
    const byTopic: Record<string, Evidence> = {};
    for (const [t, e] of Object.entries(into.evidence_by_topic ?? {})) byTopic[t] = { ...e };
    for (const [topic, ev] of Object.entries(other.evidence_by_topic)) {
      const at = (byTopic[topic] ??= {});
      for (const [k, v] of Object.entries(ev)) at[k] = (at[k] ?? 0) + v;
    }
    into.evidence_by_topic = byTopic;
  }
  // Sometimes only one record has the ORCID. Keep whichever has it.
  if (!into.orcid && other.orcid) into.orcid = other.orcid;
}

/** Folds split author records into their canonical record, keeping each person where they
 *  first appeared in the list. Name, affiliation and topics come from the canonical record
 *  (the one with the most works). */
export function collapse(nodes: NetNode[], canonical: Map<string, string>): NetNode[] {
  const members = new Map<string, NetNode[]>();
  for (const n of nodes) {
    const cid = canonical.get(n.id) ?? n.id;
    const group = members.get(cid);
    if (group) group.push(n);
    else members.set(cid, [n]);
  }
  const out: NetNode[] = [];
  for (const [cid, group] of members) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    // Start from the canonical record and add the rest into it. The canonical record is
    // left out of the rest so that it is not counted twice.
    const at = group.find((n) => n.id === cid);
    const base: NetNode = { ...(at ?? group[0]) };
    const rest = at ? group.filter((n) => n.id !== cid) : group.slice(1);
    base.id = cid;
    for (const other of rest) absorb(base, other);
    out.push(base);
  }
  return out;
}

/** Merges split author records in the graph so each person appears once. Returns how many
 *  records were folded. The rule "if they wrote together, they are different people" uses
 *  the edges already in the graph. Candidates (hop3) are added later, so this is called
 *  twice: right after building, and again after they are added. */
export function collapseSplitRecords(graph: NetGraph, progress: Progress = () => {}): number {
  const nodes = graph.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const linked = new Set<string>();
  for (const l of graph.links) {
    linked.add(`${l.source}|${l.target}`);
    linked.add(`${l.target}|${l.source}`);
  }

  const canonical = mergeMap(
    nodes.filter((n) => n.hop !== 0).map((n) => ({ id: n.id, name: n.name, orcid: n.orcid })),
    (a, b) => linked.has(`${a}|${b}`),
    // The canonical record is the one with the most works. Name and affiliation come from it.
    (p) => [byId.get(p.id)!.works_count || 0, p.id],
  );
  if (!canonical.size) return 0;

  graph.nodes = collapse(nodes, canonical);

  // Point introducer ids at the canonical record too. Otherwise they keep pointing at the
  // folded-away id, and the page cannot look the person up and drops them from the
  // introduction path. When two ids land on the same person, add their paper counts.
  const regroup = (via: Map<string, number>) => {
    const out = new Map<string, number>();
    for (const [id, n] of via) {
      const to = canonical.get(id) ?? id;
      out.set(to, (out.get(to) ?? 0) + n);
    }
    return out;
  };
  for (const n of graph.nodes) {
    if (!n.bridges?.some((b) => canonical.has(b.id))) continue;
    const weights = regroup(new Map(n.bridges.map((b) => [b.id, b.weight])));
    n.bridges = [...weights]
      .sort((a, b) => b[1] - a[1])
      .map(([id, weight]) => ({ id, name: byId.get(id)?.name ?? null, weight }));
  }
  if (graph._bridges) {
    for (const [cand, via] of graph._bridges) graph._bridges.set(cand, regroup(via));
  }

  const present = new Set(graph.nodes.map((n) => n.id));
  const weights = new Map<string, NetLink>();
  for (const l of graph.links) {
    const ca = canonical.get(l.source) ?? l.source;
    const cb = canonical.get(l.target) ?? l.target;
    if (ca === cb || !present.has(ca) || !present.has(cb)) continue; // drop self-loops
    const [s, t] = ca < cb ? [ca, cb] : [cb, ca];
    const at = weights.get(`${s}|${t}`);
    if (at) at.weight = (at.weight || 0) + (l.weight || 0);
    else weights.set(`${s}|${t}`, { source: s, target: t, weight: l.weight || 0 });
  }
  graph.links = [...weights.values()];

  const folded = canonical.size - new Set(canonical.values()).size;
  progress(`Merged ${folded} split author records`);
  return folded;
}

/* ---------- Building ---------- */

export type NetworkOptions = {
  hops?: number;
  sinceYear?: number | null;
  hop2MinBridges?: number;
  maxHop2?: number;
  maxHop1Expand?: number;
  excludeWorks?: Set<string>;
};

/** Builds and returns {nodes, links, ego, meta} from an ORCID. */
export async function buildEgoNetwork(
  client: OpenAlexClient,
  orcid: string,
  opts: NetworkOptions = {},
  progress: Progress = () => {},
): Promise<NetGraph> {
  const hops = opts.hops ?? 2;
  const sinceYear = opts.sinceYear ?? null;
  const hop2MinBridges = opts.hop2MinBridges ?? 2;
  const maxHop2 = opts.maxHop2 ?? 300;
  const maxHop1Expand = opts.maxHop1Expand ?? 300;

  // --- 1. The ego. Every split author record is read as the ego too -------
  const records = await client.authorsByOrcid(orcid);
  if (!records.length) {
    throw new Error(
      `ORCID ${orcid} was not found in OpenAlex. It may have no publications linked to it yet.`,
    );
  }
  const egoAuthor = records[0];
  const egoId = shortId(egoAuthor.id);
  const egoIds = new Set([egoId, ...records.slice(1).map((r) => shortId(r.id))]);
  progress(`Found ${egoAuthor.display_name} (${egoId}), ${egoAuthor.works_count} works`);
  if (records.length > 1) {
    const extra = records.slice(1).reduce((acc, r) => acc + (r.works_count || 0), 0);
    progress(
      `Their OpenAlex profile is split across ${records.length} records; ` +
        `reading ${extra} more publications from the other ${records.length - 1}`,
    );
  }

  // --- 2. Co-authorship years and shared papers, from the ego's works -----
  const fetched = await client.worksWithAuthorships([...egoIds].sort(), {
    sinceYear,
    withReferences: true,
  });
  // The same rule as the Shape page: a preprint and the paper it became are one paper, and a
  // correction is not one. Otherwise "papers together" counts a study twice.
  const { works: allWorks, folded, notResearch } = collapseVersions(fetched);
  progress(`Read ${allWorks.length} of their publications`);

  // Drop the papers the ego removed. Measured: every automatic rule tried to spot someone
  // else's paper has failed, so this is left to the ego.
  const dropped = opts.excludeWorks ?? new Set<string>();
  const works = allWorks.filter((w) => !dropped.has(shortId(w.id)));
  const droppedWorks = allWorks.filter((w) => dropped.has(shortId(w.id)));
  if (droppedWorks.length) {
    progress(`Ignoring ${droppedWorks.length} publications you marked as not yours`);
  }

  const hop1Counts = new Map<string, number>();
  const egoYears = new Map<string, number[]>();
  const sharedWorks = new Map<string, SharedWork[]>();
  // Which themes they wrote together in, so co-authors follow along when filtering by theme.
  const sharedTopics = new Map<string, Set<string>>();
  // Theme id -> display name. Used to name clusters (people's names are not used).
  const topicNames: Record<string, string> = {};
  for (const w of works) {
    const year = w.publication_year ?? null;
    const primary = w.primary_topic;
    const topic = primary?.id ?? null;
    if (topic && primary?.display_name) topicNames[shortId(topic)] = primary.display_name;
    const brief: SharedWork = {
      id: shortId(w.id),
      title: w.title ?? null,
      year,
      doi: w.doi ?? null,
      cited_by_count: w.cited_by_count ?? 0,
    };
    for (const a of w.authorships ?? []) {
      // Authorships whose author could not be identified come with a null id
      const raw = a.author?.id;
      if (!raw) continue;
      const aid = shortId(raw);
      if (egoIds.has(aid)) continue;
      hop1Counts.set(aid, (hop1Counts.get(aid) ?? 0) + 1);
      if (year) {
        if (!egoYears.has(aid)) egoYears.set(aid, []);
        egoYears.get(aid)!.push(year);
      }
      if (topic) {
        if (!sharedTopics.has(aid)) sharedTopics.set(aid, new Set());
        sharedTopics.get(aid)!.add(shortId(topic));
      }
      if (!sharedWorks.has(aid)) sharedWorks.set(aid, []);
      if (sharedWorks.get(aid)!.length < 25) sharedWorks.get(aid)!.push(brief);
    }
  }

  // --- 3. hop1 (already counted from the works in the loop above) --------
  const hop1 = new Set(hop1Counts.keys());
  progress(`Direct co-authors: ${hop1.size}`);

  const edges = new Map<string, NetLink>();
  const addEdge = (a: string, b: string, weight: number) => {
    if (a === b) return;
    const [s, t] = a < b ? [a, b] : [b, a];
    const at = edges.get(`${s}|${t}`);
    if (at) at.weight = Math.max(at.weight, weight);
    else edges.set(`${s}|${t}`, { source: s, target: t, weight });
  };
  for (const [aid, n] of hop1Counts) addEdge(egoId, aid, n);

  // --- 4. hop2 -------------------------------------------------------
  let hop2 = new Set<string>();
  // candidate -> {direct co-author it is reached through: shared papers}
  const bridges = new Map<string, Map<string, number>>();
  const outer = new Map<string, Map<string, number>>();
  const hop1Degree = new Map<string, number>();

  if (hops >= 2) {
    // One request per direct co-author. Only the top ones, by papers shared, are expanded
    // (a researcher with 508 papers has 1,193 of them, and 56% share just one paper).
    const expand = [...hop1]
      .sort((a, b) => hop1Counts.get(b)! - hop1Counts.get(a)! || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, maxHop1Expand);
    if (expand.length < hop1.size) {
      progress(
        `Expanding the ${expand.length} closest of ${hop1.size} direct co-authors ` +
          `(those you wrote ${hop1Counts.get(expand[expand.length - 1])}+ papers with)`,
      );
    }
    const fetched = await client.each(
      expand,
      (aid) => client.coauthors(aid, sinceYear),
      (done, total) => {
        if (done % 25 === 0 || done === total) progress(`  Expanding co-authors ${done}/${total}`);
      },
    );
    expand.forEach((aid, i) => {
      const co = fetched[i];
      co.delete(aid);
      for (const e of egoIds) co.delete(e);
      outer.set(aid, co);
      // The Adamic-Adar denominator. Used to discount ties that run through hubs with many
      // co-authors.
      hop1Degree.set(aid, co.size);
      for (const [bid, n] of co) {
        if (hop1.has(bid)) addEdge(aid, bid, n); // a tie between two direct co-authors
        else if (!egoIds.has(bid)) {
          if (!bridges.has(bid)) bridges.set(bid, new Map());
          bridges.get(bid)!.set(aid, n);
        }
      }
    });

    const total = (m: Map<string, number>) => {
      let t = 0;
      for (const n of m.values()) t += n;
      return t;
    };
    // Rank by how many people they are reached through, then by total shared papers
    const ranked = [...bridges].sort(
      (a, b) => b[1].size - a[1].size || total(b[1]) - total(a[1]),
    );
    const selected = ranked.filter(([, br]) => br.size >= hop2MinBridges).map(([bid]) => bid);
    hop2 = new Set(selected.slice(0, maxHop2));
    progress(
      `Second-degree: kept ${hop2.size} of ${bridges.size} candidates ` +
        `(reachable via at least ${hop2MinBridges} shared co-authors)`,
    );

    for (const [aid, co] of outer) {
      for (const [bid, n] of co) if (hop2.has(bid)) addEdge(aid, bid, n);
    }
  }

  // --- 5. Resolve node metadata in bulk -----------------------------------
  const nodeIds = [egoId, ...[...hop1].sort(), ...[...hop2].sort()];
  progress(`Fetching profiles for ${nodeIds.length} researchers`);
  const authors = new Map((await client.authorsByIds(nodeIds)).map((a) => [shortId(a.id), a]));

  const hopOf = new Map<string, NetNode["hop"]>([[egoId, 0]]);
  for (const a of hop1) hopOf.set(a, 1);
  for (const a of hop2) hopOf.set(a, 2);

  const nodes: NetNode[] = [];
  for (const aid of nodeIds) {
    const author = authors.get(aid);
    if (!author) continue; // author record merged away or deleted
    const node = nodeFromAuthor(author, hopOf.get(aid)!);
    if (node.hop === 0) {
      // The author record's counts include folded preprints and corrections, so take them off too
      rebuildEgoFromWorks(node, works, [...droppedWorks, ...folded, ...notResearch]);
      node.topic_vector_fine = worksTopicVector(works);
    }
    if (node.hop === 1) {
      const years = [...(egoYears.get(aid) ?? [])].sort((a, b) => a - b);
      node.collab_with_ego = hop1Counts.get(aid) ?? 0;
      node.first_collab_year = years.length ? years[0] : null;
      node.last_collab_year = years.length ? years[years.length - 1] : null;
      node.shared_works = sharedWorks.get(aid) ?? [];
      node.shared_topics = [...(sharedTopics.get(aid) ?? [])].sort();
      node.coauthor_count = hop1Degree.get(aid) ?? null;
    } else if (node.hop === 2) {
      node.collab_with_ego = 0;
      node.bridges = [...bridges.get(aid)!]
        .sort((a, b) => b[1] - a[1])
        .map(([b, w]) => ({ id: b, name: authors.get(b)?.display_name ?? null, weight: w }));
    }
    nodes.push(node);
  }

  const present = new Set(nodes.map((n) => n.id));
  const links = [...edges.values()].filter((l) => present.has(l.source) && present.has(l.target));

  const graph: NetGraph = {
    ego: egoId,
    nodes,
    links,
    _ego_ids: [...egoIds].sort(),
    _bridges: bridges,
    _ego_works: works.map((w) => ({
      id: w.id,
      primary_topic: w.primary_topic,
      referenced_works: w.referenced_works ?? [],
    })),
    // The list the ego uses to judge "is this my paper?". Excluded papers stay in it.
    ego_works: [...allWorks]
      .sort((a, b) => (b.publication_year || 0) - (a.publication_year || 0))
      .map((w) => ({
        id: shortId(w.id),
        title: w.title ?? null,
        year: w.publication_year ?? null,
        doi: w.doi ?? null,
        topic: w.primary_topic?.display_name ?? null,
        field: w.primary_topic?.field?.display_name ?? null,
        coauthors: (w.authorships ?? [])
          .filter((a) => {
            const id = a.author?.id ?? "";
            return id.slice(id.lastIndexOf("/") + 1) !== egoId;
          })
          .map((a) => a.author?.display_name ?? null)
          .slice(0, 6) as string[],
        n_authors: (w.authorships ?? []).length,
        excluded: dropped.has(shortId(w.id)),
      })),
    meta: {
      version: 2,
      orcid,
      hops,
      n_excluded_works: droppedWorks.length,
      topic_names: topicNames,
      since_year: sinceYear,
      hop2_min_bridges: hop2MinBridges,
      n_nodes: nodes.length,
      n_links: links.length,
      n_hop1: nodes.filter((n) => n.hop === 1).length,
      n_hop2: nodes.filter((n) => n.hop === 2).length,
      n_hop2_candidates_total: bridges.size,
      n_hop1_expanded: outer.size,
      n_author_records: records.length,
      api_requests: client.nRequests,
      api_cost_usd: Math.round(client.costUsd * 1e5) / 1e5,
    },
  };

  // Merge split author records here, so each person appears once.
  collapseSplitRecords(graph, progress);
  graph.meta.n_nodes = graph.nodes.length;
  graph.meta.n_links = graph.links.length;
  graph.meta.n_hop1 = graph.nodes.filter((n) => n.hop === 1).length;
  graph.meta.n_hop2 = graph.nodes.filter((n) => n.hop === 2).length;
  return graph;
}
