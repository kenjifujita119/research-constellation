/** Affiliation correction and confidence. Ported from the original Python implementation
 *  (enrich.py, not included here).
 *
 *  Measured: OpenAlex's last_known_institutions is wrong quite often (e.g. one researcher's
 *  affiliation was the name of a research group rather than a university). A majority vote
 *  over authorships[].institutions on recent papers gets back to the right affiliation with
 *  high probability.
 *
 *  This step cannot be skipped. Without the fine-grained topic distribution it builds, only 7
 *  of the top 25 in "Same topic" stayed — it effectively decides the answer. */

import type { OpenAlexClient } from "./client.ts";
import { shortId } from "./client.ts";
import type { NetGraph, NetNode, Progress } from "./network.ts";
import { worksTopicVector } from "./network.ts";
import { pyRound } from "./recommend.ts";

export type Affiliation = {
  resolved: boolean;
  institution?: string;
  country?: string | null;
  institution_id?: string | null;
  vote_share?: number;
  n_recent_works: number;
  topic_vector: Record<string, number>;
  /** Works cited both by the ego and in these recent papers. Only when egoRefs was given */
  shared_refs?: number;
  alternatives?: { institution: string; country: string | null; votes: number }[];
};

export type Fix = Affiliation & { confidence: number; confidence_reasons: string[] };

/** Re-decides the affiliation by majority vote over recent papers. The same papers also give a
 *  topic distribution, and, given the ego's references, how many works both cite (no extra
 *  requests; the responses are larger). */
export async function resolveAffiliation(
  client: OpenAlexClient,
  authorId: string,
  sinceYear = 2020,
  maxWorks = 200,
  egoRefs?: Set<string>,
): Promise<Affiliation> {
  const works = await client.worksWithAuthorships([authorId], {
    sinceYear,
    maxWorks,
    withReferences: Boolean(egoRefs),
  });
  let shared: number | undefined;
  if (egoRefs) {
    const both = new Set<string>();
    for (const w of works) {
      for (const r of w.referenced_works ?? []) if (egoRefs.has(shortId(r))) both.add(shortId(r));
    }
    shared = both.size;
  }

  const votes = new Map<string, { name: string; country: string | null; id: string | null; n: number }>();
  for (const w of works) {
    for (const a of w.authorships ?? []) {
      const aid = a.author?.id;
      if (!aid || shortId(aid) !== authorId) continue;
      for (const inst of a.institutions ?? []) {
        if (!inst.display_name) continue;
        const id = inst.id ? shortId(inst.id) : null;
        const country = inst.country_code ?? null;
        const key = JSON.stringify([inst.display_name, country, id]);
        const at = votes.get(key);
        if (at) at.n += 1;
        else votes.set(key, { name: inst.display_name, country, id, n: 1 });
      }
    }
  }

  const topicVector = worksTopicVector(works);
  if (!votes.size) {
    return { resolved: false, n_recent_works: works.length, topic_vector: topicVector, shared_refs: shared };
  }

  // Most votes first. Ties go to whichever was counted first (as Counter.most_common).
  const ranked = [...votes.values()].sort((a, b) => b.n - a.n);
  const top = ranked[0];
  const total = ranked.reduce((acc, v) => acc + v.n, 0);
  return {
    resolved: true,
    institution: top.name,
    country: top.country,
    institution_id: top.id,
    vote_share: pyRound(top.n / total, 3),
    n_recent_works: works.length,
    topic_vector: topicVector,
    shared_refs: shared,
    alternatives: ranked
      .slice(1, 4)
      .map((v) => ({ institution: v.name, country: v.country, votes: v.n })),
  };
}

/** Confidence (0-1) in an author record, with the reasons.
 *  Namesakes are sometimes collapsed into one record, and showing one near the top costs trust. */
export function confidence(node: NetNode, affiliation: Affiliation): [number, string[]] {
  let score = 1.0;
  const reasons: string[] = [];

  if (!node.orcid) {
    score *= 0.55;
    reasons.push("no ORCID linked");
  }
  const share = affiliation.vote_share;
  if (share != null && share < 0.5) {
    score *= 0.6;
    // As with Python's f"{share:.0%}", an exact half (22.5%) rounds to even. toFixed rounds
    // away from zero, so a side-by-side comparison split into 23% and 22%.
    reasons.push(`affiliation inconsistent (top one only ${pyRound(share * 100, 0)}%)`);
  }
  const nRecent = affiliation.n_recent_works ?? 0;
  if (nRecent < 5) {
    score *= 0.7;
    reasons.push(`few recent papers (${nRecent})`);
  }
  // Topics too scattered for the number of papers = someone else may be mixed in
  const topics = node.topics ?? [];
  if (topics.length >= 3 && (node.works_count ?? 0) > 30) {
    const fields = new Set(topics.slice(0, 5).map((t) => t.field).filter(Boolean));
    if (fields.size >= 4) {
      score *= 0.65;
      reasons.push("topics scattered across fields (possible merged profile)");
    }
  }
  return [pyRound(score, 3), reasons];
}

/** Corrects only the recommendation shortlist (correcting everyone would be wasteful).
 *  That is 80 round trips of 2 seconds each, so they are batched and run in parallel. */
export async function enrichCandidates(
  client: OpenAlexClient,
  graph: NetGraph,
  candidateIds: string[],
  sinceYear = 2020,
  progress: Progress = () => {},
  egoRefs?: Set<string>,
): Promise<Map<string, Fix>> {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const wanted = candidateIds.filter((aid) => nodes.has(aid));
  const fixed = await client.each(
    wanted,
    async (aid): Promise<[string, Fix]> => {
      const aff = await resolveAffiliation(client, aid, sinceYear, 200, egoRefs);
      const [conf, reasons] = confidence(nodes.get(aid)!, aff);
      return [aid, { ...aff, confidence: conf, confidence_reasons: reasons }];
    },
    (done, total) => {
      if (done % 10 === 0 || done === total) progress(`  Verifying affiliations ${done}/${total}`);
    },
  );
  return new Map(fixed);
}
