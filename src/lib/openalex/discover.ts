/** Collaborator search that does not depend on the network. Ported from the original Python
 *  implementation (discover.py, not included here).
 *
 *  If the co-author network is the only source of candidates, "people doing the same work who
 *  are not yet connected to anyone you know" cannot, by definition, appear at all. This adds
 *  four sources:
 *
 *    topic    authors publishing in the user's main topics (worldwide)
 *    cites_me authors who cite the user's papers
 *    i_cite   authors of papers the user cites
 *    cocite   authors who cite the same body of work as the user (bibliographic coupling)
 *
 *  Splitting the user's papers by topic gives "who cites you on this topic specifically".
 *
 *  The totals are counted once over everything, not added up topic by topic: a paper that cites
 *  the user's papers in three topics is one citing paper, not three. Adding up the topics made
 *  "you cite them" 31 for someone with 26 papers in the user's references. cocite is the
 *  exception: it comes from group_by in batches of references, so it cannot be counted exactly
 *  and is used for ranking only (the page shows shared_refs from enrich.ts instead).
 *
 *  Topics are processed one at a time. The order in which candidates are found decides how ties
 *  are sorted, so running topics in parallel would change the ranking. */

import type { EgoTopic } from "../types.ts";
import type { OpenAlexClient, RawTopic } from "./client.ts";
import { OR_BATCH, shortId } from "./client.ts";
import type { EgoWorkRaw, Evidence, Progress } from "./network.ts";

/** How many of the user's references to look up authors for (i_cite), most often cited by the
 *  user first. One request per 50 */
const MAX_REFERENCES = 3000;
/** How many references per topic go into the bibliographic coupling queries (cocite) */
const MAX_TOPIC_REFERENCES = 1000;
/** Which topics get their own breakdown. Listing single-paper topics too scatters the choices */
const MIN_PAPERS_PER_TOPIC = 2;
const MAX_TOPICS = 8;

/** A paper citing the user, as read for the Reach page. */
export type CitingRow = { authors: string[]; cites: string[] };

function chunks(items: string[], size = OR_BATCH): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Authors who publish most on a topic. One request. */
function authorsByTopic(client: OpenAlexClient, topicId: string, sinceYear: number) {
  return client.groupAuthors(`primary_topic.id:${topicId},from_publication_date:${sinceYear}-01-01`);
}

/** Authors who cite the given papers, as group_by counts per batch of 50 (a paper citing papers
 *  in two batches counts twice). Batches are sent in parallel but added in batch order. */
async function authorsCiting(client: OpenAlexClient, workIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const found = await client.each(chunks(workIds), (c) => client.groupAuthors(`cites:${c.join("|")}`));
  for (const f of found) for (const [aid, n] of f) out.set(aid, (out.get(aid) ?? 0) + n);
  return out;
}

function topicOf(work: { primary_topic?: RawTopic }): [string, string] | null {
  const topic = work.primary_topic;
  if (!topic?.id) return null;
  return [shortId(topic.id), topic.display_name || topic.id];
}

/** The references of these works, each once, in the order first met. */
function references(works: EgoWorkRaw[], limit: number, skip: Set<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of works) {
    for (const ref of w.referenced_works) {
      const rid = shortId(ref);
      if (seen.has(rid) || skip.has(rid)) continue;
      seen.add(rid);
      out.push(rid);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** The user's references, the ones they cite in the most papers first. */
function rankedReferences(works: EgoWorkRaw[], limit: number, skip: Set<string>): string[] {
  const uses = new Map<string, number>();
  for (const w of works) {
    for (const rid of new Set(w.referenced_works.map(shortId))) {
      if (!skip.has(rid)) uses.set(rid, (uses.get(rid) ?? 0) + 1);
    }
  }
  return [...uses]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([rid]) => rid);
}

/** Counts, for each author, how many of the given items they appear on. */
function countAuthors(items: Iterable<string[]>): Map<string, number> {
  const out = new Map<string, number>();
  for (const authors of items) for (const aid of authors) out.set(aid, (out.get(aid) ?? 0) + 1);
  return out;
}

export type Discovery = {
  /** candidate -> {source: count} (over all the user's papers) */
  totals: Map<string, Evidence>;
  /** candidate -> {topic: {source: count}} (breakdown by topic) */
  byTopic: Map<string, Record<string, Evidence>>;
  /** Topic choices offered in the UI */
  topics: EgoTopic[];
};

export async function gather(
  client: OpenAlexClient,
  egoId: string,
  egoWorks: EgoWorkRaw[],
  egoIds: Set<string>,
  sinceYear = 2021,
  progress: Progress = () => {},
  /** The papers citing the user, from the Reach build. Without them, cites_me falls back to
   *  group_by counts, which add up topic by topic */
  citing: CitingRow[] | null = null,
): Promise<Discovery> {
  const worksByTopic = new Map<string, EgoWorkRaw[]>();
  const topicNames = new Map<string, string>();
  const topicOfWork = new Map<string, string | null>();
  for (const w of egoWorks) {
    const found = topicOf(w);
    topicOfWork.set(shortId(w.id), found?.[0] ?? null);
    if (!found) continue;
    const [tid, name] = found;
    if (!worksByTopic.has(tid)) worksByTopic.set(tid, []);
    worksByTopic.get(tid)!.push(w);
    topicNames.set(tid, name);
  }

  const rankedTopics = [...worksByTopic].sort((a, b) => b[1].length - a[1].length);
  const breakdown = rankedTopics
    .filter(([, ws]) => ws.length >= MIN_PAPERS_PER_TOPIC)
    .map(([tid]) => tid)
    .slice(0, MAX_TOPICS);
  const inBreakdown = new Set(breakdown);
  const rest = rankedTopics.filter(([tid]) => !inBreakdown.has(tid)).flatMap(([, ws]) => ws);
  const ownWorks = new Set(egoWorks.map((w) => shortId(w.id)));

  const totals = new Map<string, Evidence>();
  const byTopic = new Map<string, Record<string, Evidence>>();

  // Split author records are the user too. Listing them would recommend the user to themselves.
  const notMe = (found: Map<string, number>) => {
    found.delete(egoId);
    for (const e of egoIds) found.delete(e);
    return found;
  };
  const addTopic = (source: string, found: Map<string, number>, topic: string) => {
    for (const [aid, n] of notMe(found)) {
      if (!byTopic.has(aid)) byTopic.set(aid, {});
      (byTopic.get(aid)![topic] ??= {})[source] = n;
    }
  };
  const addTotal = (source: string, found: Map<string, number>) => {
    for (const [aid, n] of notMe(found)) {
      if (!totals.has(aid)) totals.set(aid, {});
      const t = totals.get(aid)!;
      t[source] = (t[source] ?? 0) + n;
    }
  };

  // --- Who cites you: counted exactly from the papers already read for the Reach page ------
  if (citing) {
    const all: string[][] = [];
    const perTopic = new Map<string, string[][]>();
    for (const row of citing) {
      let any = false;
      const topics = new Set<string>();
      for (const id of row.cites) {
        if (!topicOfWork.has(id)) continue; // outside the years searched, or set aside
        any = true;
        const t = topicOfWork.get(id);
        if (t && inBreakdown.has(t)) topics.add(t);
      }
      if (!any) continue;
      all.push(row.authors);
      for (const t of topics) {
        if (!perTopic.has(t)) perTopic.set(t, []);
        perTopic.get(t)!.push(row.authors);
      }
    }
    for (const tid of breakdown) addTopic("cites_me", countAuthors(perTopic.get(tid) ?? []), tid);
    addTotal("cites_me", countAuthors(all));
    progress(`  ${all.length} papers cite your work`);
  }

  // --- Who you cite: the authors of your references, looked up once -----------------------
  const refs = rankedReferences(egoWorks, MAX_REFERENCES, ownWorks);
  const refAuthors = new Map<string, string[]>();
  if (refs.length) {
    progress(`  Looking up the authors of ${refs.length} works you cite`);
    for (const w of await client.worksByIds(refs, "id,authorships")) {
      const authors = new Set<string>();
      for (const a of w.authorships ?? []) if (a.author?.id) authors.add(shortId(a.author.id));
      refAuthors.set(shortId(w.id), [...authors]);
    }
  }
  const authorsOfRefs = (works: EgoWorkRaw[]) => {
    const here = new Set<string>();
    for (const w of works) for (const r of w.referenced_works) here.add(shortId(r));
    return countAuthors([...here].filter((r) => refAuthors.has(r)).map((r) => refAuthors.get(r)!));
  };

  // --- The per-topic sources ---------------------------------------------------------------
  for (const [i, tid] of breakdown.entries()) {
    const works = worksByTopic.get(tid)!;
    progress(`  [${i + 1}/${breakdown.length}] ${topicNames.get(tid)} (${works.length} papers)`);
    // Each paper has one primary topic, so adding up the topics counts each paper once
    const onTopic = await authorsByTopic(client, tid, sinceYear);
    addTopic("topic", new Map(onTopic), tid);
    addTotal("topic", onTopic);
    if (!citing) {
      const found = await authorsCiting(client, works.map((w) => shortId(w.id)));
      addTopic("cites_me", new Map(found), tid);
      addTotal("cites_me", found);
    }
    addTopic("i_cite", authorsOfRefs(works), tid);
    const topicRefs = references(works, MAX_TOPIC_REFERENCES, ownWorks);
    if (topicRefs.length) {
      const found = await authorsCiting(client, topicRefs);
      addTopic("cocite", new Map(found), tid);
      addTotal("cocite", found);
    }
  }

  // --- Papers in topics left out of the breakdown, in a single pass ---
  if (rest.length) {
    progress(`  Other topics (${rest.length} papers)`);
    if (!citing) addTotal("cites_me", await authorsCiting(client, rest.map((w) => shortId(w.id))));
    const restRefs = references(rest, MAX_TOPIC_REFERENCES / 2, ownWorks);
    if (restRefs.length) addTotal("cocite", await authorsCiting(client, restRefs));
  }

  addTotal("i_cite", authorsOfRefs(egoWorks));

  progress(`  Found ${totals.size} candidates across ${breakdown.length} topics`);

  return {
    totals,
    byTopic,
    topics: breakdown.map((tid) => ({
      id: tid,
      name: topicNames.get(tid)!,
      papers: worksByTopic.get(tid)!.length,
    })),
  };
}
