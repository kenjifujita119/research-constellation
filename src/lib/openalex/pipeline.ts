/** Builds the "co-author network + recommendations" from an ORCID. Ported from the original
 *  Python implementation (pipeline.py, not included here).
 *
 *  The order matters:
 *    1. Build the co-author network (hop1/hop2)
 *    2. Gather candidates that do not depend on the network (topic match / citations /
 *       bibliographic coupling)
 *    3. Attach author metadata to the combined set of candidates
 *    4. Correct the affiliations of the top recommendations by majority vote
 *    5. Score every preset using the corrected affiliations
 *
 *  Correcting affiliations before any filtering by country is essential. Measured: OpenAlex's
 *  most recent affiliation was wrong 44% of the time, and without the correction people from
 *  the user's own country turn up under "abroad". */

import type { OpenAlexClient } from "./client.ts";
import { shortId } from "./client.ts";
import { gather, type CitingRow } from "./discover.ts";
import { enrichCandidates, type Fix } from "./enrich.ts";
import { assignGroups } from "./groups.ts";
import type { Evidence, NetGraph, NetNode, Progress } from "./network.ts";
import { buildEgoNetwork, collapseSplitRecords, nodeFromAuthor } from "./network.ts";
import { recommendAll } from "./recommend.ts";

/** Bump the number whenever this format changes; anything saved under an older number is
 *  discarded and rebuilt (same number as server.py in the original Python implementation, not
 *  included here). */
export const NETWORK_VERSION = 2;

/** Candidates' papers are read from this year on, to check affiliations and count shared
 *  references. The page says "since 2020" (lib/intro.ts SHARED_REFS_SINCE) */
const RECENT_SINCE = 2020;
/** At most this many more candidates are checked when they reach the final lists without having
 *  been checked */
const MAX_LATE_CHECKS = 60;

/** How many top candidates to take from each source. Taking them all bloats the metadata fetch. */
const SOURCE_CAPS: [string, number][] = [
  ["topic", 150],
  ["cites_me", 250],
  ["i_cite", 100],
  ["cocite", 200],
];
const MAX_DISCOVERED = 600;

/** Takes the top of each source, then merges them. Counts are on completely different scales
 *  from one source to another, so summing them and applying a single cut-off fills the list
 *  with topic-only candidates.
 *
 *  Only the cut-off above 600 people cannot be made to match Python. Python sorts a set, and
 *  the order of ties changes from run to run (string hashes differ on every run). Here the
 *  order in which candidates were found decides, so the result is the same every time. */
function selectDiscovered(evidence: Map<string, Evidence>, exclude: Set<string>): Map<string, Evidence> {
  const keep = new Set<string>();
  for (const [source, cap] of SOURCE_CAPS) {
    const ranked = [...evidence.keys()]
      .filter((aid) => source in evidence.get(aid)! && !exclude.has(aid))
      .sort((a, b) => evidence.get(b)![source] - evidence.get(a)![source]);
    for (const aid of ranked.slice(0, cap)) keep.add(aid);
  }
  let chosen = [...keep];
  if (chosen.length > MAX_DISCOVERED) {
    const breadth = (aid: string) => Object.keys(evidence.get(aid)!).length;
    chosen = chosen.sort((a, b) => breadth(b) - breadth(a)).slice(0, MAX_DISCOVERED);
  }
  const picked = new Set(chosen);
  return new Map([...evidence].filter(([aid]) => picked.has(aid)));
}

export type PipelineOptions = {
  hops?: number;
  sinceYear?: number | null;
  discoverSince?: number;
  shortlist?: number;
  useDiscovery?: boolean;
  excludeWorks?: Set<string>;
  /** The papers citing the user, from the Reach build. Gives exact "cites you" counts */
  citing?: CitingRow[] | null;
};

/** Writes the affiliation checks onto the nodes. Returns how many affiliations changed. */
function applyFixes(graph: NetGraph, fixes: Map<string, Fix>): number {
  let corrected = 0;
  for (const node of graph.nodes) {
    const fix = fixes.get(node.id);
    if (!fix) continue;
    node.confidence = fix.confidence;
    node.confidence_reasons = fix.confidence_reasons;
    if (fix.shared_refs !== undefined) node.shared_refs = fix.shared_refs;
    if (Object.keys(fix.topic_vector ?? {}).length) node.topic_vector_fine = fix.topic_vector;
    if (fix.resolved) {
      if (fix.institution !== node.institution) {
        node.institution_raw = node.institution;
        node.country_raw = node.country;
        corrected += 1;
      }
      node.institution = fix.institution ?? null;
      node.country = fix.country ?? null;
      node.institution_id = fix.institution_id ?? null;
    }
  }
  return corrected;
}

export async function runPipeline(
  client: OpenAlexClient,
  orcid: string,
  opts: PipelineOptions = {},
  progress: Progress = () => {},
): Promise<NetGraph> {
  const shortlist = opts.shortlist ?? 80;
  const graph = await buildEgoNetwork(
    client,
    orcid,
    { hops: opts.hops ?? 2, sinceYear: opts.sinceYear ?? null, excludeWorks: opts.excludeWorks },
    progress,
  );
  // The user's other ids when OpenAlex has split them. Used to keep them out of the candidates.
  const egoIds = new Set(graph._ego_ids?.length ? graph._ego_ids : [graph.ego]);
  delete graph._ego_ids;
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  // Every work the user cites, to count the references a candidate shares with them
  const egoRefs = new Set(
    (graph._ego_works ?? []).flatMap((w) => w.referenced_works.map(shortId)),
  );

  // --- Candidates that do not depend on the network ----------------
  if (opts.useDiscovery ?? true) {
    progress("Looking for researchers beyond your co-author network");
    const { totals, byTopic, topics } = await gather(
      client,
      graph.ego,
      graph._ego_works ?? [],
      egoIds,
      opts.discoverSince ?? 2021,
      progress,
      opts.citing ?? null,
    );
    delete graph._ego_works;
    graph.meta.ego_topics = topics;

    // People already in the graph only get the evidence added (this lifts hop2 candidates)
    for (const [aid, ev] of totals) {
      const node = nodesById.get(aid);
      if (node) {
        node.evidence = ev;
        node.evidence_by_topic = byTopic.get(aid) ?? {};
      }
    }

    const fresh = selectDiscovered(totals, new Set([...nodesById.keys(), ...egoIds]));
    progress(`${fresh.size} new candidates with no co-authorship path to you`);

    if (fresh.size) {
      for (const author of await client.authorsByIds([...fresh.keys()])) {
        const aid = shortId(author.id);
        const node: NetNode = nodeFromAuthor(author, 3);
        node.evidence = fresh.get(aid) ?? {};
        node.evidence_by_topic = byTopic.get(aid) ?? {};
        node.collab_with_ego = 0;
        graph.nodes.push(node);
        nodesById.set(aid, node);
      }
    }
  } else {
    delete graph._ego_works;
    graph.meta.ego_topics = [];
  }

  // Even for people linked through only one direct co-author, the introducer is known — they
  // were visible when the second-degree contacts were collected. Only the top 300 linked
  // through two or more are kept as second-degree, so the other introducers used to be thrown
  // away, and people who came in through topics or citations were shown with "nobody in
  // between". Example: one candidate had 3 papers with one of the user's co-authors, yet showed
  // "no path". Among Kenji's top recommendations, 1 in 3 of the "no path" people were like this.
  // Anyone with an introducer is by definition second-degree, so treat them as second-degree.
  const seen = graph._bridges;
  delete graph._bridges;
  let reconnected = 0;
  for (const node of graph.nodes) {
    const via = node.hop === 3 ? seen?.get(node.id) : undefined;
    if (!via?.size) continue;
    node.hop = 2;
    node.bridges = [...via]
      .sort((a, b) => b[1] - a[1])
      .map(([id, weight]) => ({ id, name: nodesById.get(id)?.name ?? null, weight }));
    for (const [id, weight] of via) {
      const [source, target] = id < node.id ? [id, node.id] : [node.id, id];
      graph.links.push({ source, target, weight });
    }
    reconnected += 1;
  }
  if (reconnected) {
    progress(`${reconnected} of them write with one of your co-authors, who could introduce you`);
  }

  // Off-network candidates include split records too. Merge again once they have all been added.
  collapseSplitRecords(graph, progress);

  // --- Correct affiliations for the top recommendations -------------
  // Each preset has a different top, so collect from all of them.
  const rough = recommendAll(graph, Math.floor(shortlist / 4));
  const ids: string[] = [];
  for (const rows of Object.values(rough.results)) {
    for (const r of rows) if (!ids.includes(r.id)) ids.push(r.id);
  }
  const shortlistIds = ids.slice(0, shortlist);
  progress(`Verifying affiliations for the top ${shortlistIds.length} candidates`);

  const fixes = await enrichCandidates(client, graph, shortlistIds, RECENT_SINCE, progress, egoRefs);
  let corrected = applyFixes(graph, fixes);
  progress(`Corrected ${corrected} of ${fixes.size} affiliations`);

  // --- Group the direct co-authors (no API calls) -------------------
  const nGroups = assignGroups(graph);
  progress(`Found ${nGroups} research groups among your direct co-authors`);

  // --- Final scoring with the corrected affiliations ----------------
  graph.recommendations = recommendAll(graph);

  // The corrections move people, and some reach the lists without having been checked. Check
  // them too, so everyone shown has a verified affiliation and a shared-reference count. Each
  // round of scoring lets a few more in (Kenji: 53 after the first round, 32 after the second),
  // so go round twice and stop; anyone left is shown without the exact count.
  for (let round = 0; round < 2; round++) {
    const late: string[] = [];
    for (const rows of Object.values(graph.recommendations.results)) {
      for (const r of rows) if (!fixes.has(r.id) && !late.includes(r.id)) late.push(r.id);
    }
    if (!late.length) break;
    const more = await enrichCandidates(
      client,
      graph,
      late.slice(0, MAX_LATE_CHECKS),
      RECENT_SINCE,
      progress,
      egoRefs,
    );
    for (const [id, fix] of more) fixes.set(id, fix);
    corrected += applyFixes(graph, more);
    progress(`Checked ${more.size} more candidates who moved into the lists`);
    graph.recommendations = recommendAll(graph);
  }

  const m = graph.meta;
  m.corrected_affiliations = corrected;
  m.n_discovered = graph.nodes.filter((n) => n.hop === 3).length;
  m.n_hop2 = graph.nodes.filter((n) => n.hop === 2).length;
  m.n_nodes = graph.nodes.length;
  m.n_links = graph.links.length;
  m.api_cost_usd = Math.round(client.costUsd * 1e5) / 1e5;
  m.api_requests = client.nRequests;
  return graph;
}
