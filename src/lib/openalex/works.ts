/** Builds your own papers (the shape) and the papers that cite them (the globe).
 *
 *  Ported from the original Python implementation (not included here): works.py and the read
 *  side of server.py (get_works / get_reach / works_from_country / _exclusion_status). That
 *  version documented the measurements behind these choices and what the numbers mean. This
 *  file only notes what needed care in the port:
 *
 *  - Ties are ordered by "whichever was counted first" (Python's Counter.most_common).
 *    Tally.mostCommon preserves that.
 *  - Missing values are null, not undefined. If a key disappears when serialised to JSON,
 *    it no longer matches the types the UI expects.
 *
 *  The two stages are kept as they were: papers alone take 3-8 s / under $0.0004; reading the
 *  citations too takes up to 142 s / $0.019 (measured). The shape can be drawn from the papers
 *  alone, so the user is not kept waiting. */

import type {
  CitingWork,
  CountryReach,
  ExclusionStatus,
  MyWork,
  ReachGraph,
  ReachMeta,
  WorksGraph,
  WorksMeta,
} from "../types.ts";
import type { OpenAlexClient, RawWork } from "./client.ts";
import { shortId } from "./client.ts";
import { mergeMap } from "./identity.ts";
import { collapseVersions } from "./versions.ts";

export type Progress = (message: string) => void;

/** Bump the number whenever this format changes; anything saved under an older number is
 *  discarded and rebuilt. */
export const PAPERS_VERSION = 10;
export const REACH_VERSION = 3;

/** Upper limit on citing papers fetched. The UI does not hard-code this number; it reads
 *  meta.max_citing. */
export const MAX_CITING = 40000;

/** Publication years later than this are bad data (OpenAlex has papers dated 10000). Next year is
 *  allowed: journals date issues ahead. */
const LATEST_YEAR = new Date().getFullYear() + 1;
const saneYear = (year: number | null | undefined) =>
  year != null && year <= LATEST_YEAR ? year : null;

export type PaperRow = MyWork & {
  subfield: string | null;
  /** External prior work. Used for bibliographic coupling. Not sent to the UI */
  refs: string[];
};

export type Papers = {
  ego: string;
  ego_name: string | null;
  /** Every OpenAlex author record with this ORCID (OpenAlex sometimes splits one person) */
  ego_ids: string[];
  works: PaperRow[];
  /** Folded preprint -> the published paper it is counted as. A citation to either counts for
   *  the paper */
  aliases: Record<string, string>;
  /** The user's works that are not research (corrections and the like). Only used to tell
   *  self-citations apart */
  not_research: string[];
  meta: WorksMeta & { version: number };
};

export type ReachRow = CitingWork & {
  subfield: string | null;
  /** Author ids. The collaborator search counts who cites you from these */
  authors: string[];
};

type ReachOnly = Omit<ReachMeta, keyof WorksMeta>;

export type Reach = {
  ego: string;
  citing: ReachRow[];
  meta: ReachOnly &
    Pick<WorksMeta, "orcid" | "api_requests" | "api_cost_usd"> & { version: number };
};

/* ---------- Counting ---------- */

class Tally<K> {
  private counts = new Map<K, number>();

  add(key: K, n = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + n);
  }

  get size(): number {
    return this.counts.size;
  }

  keys(): IterableIterator<K> {
    return this.counts.keys();
  }

  total(): number {
    let t = 0;
    for (const n of this.counts.values()) t += n;
    return t;
  }

  /** Most frequent first. Ties go to whichever was counted first (as Counter.most_common). */
  mostCommon(n?: number): [K, number][] {
    const rows = [...this.counts.entries()].sort((a, b) => b[1] - a[1]);
    return n === undefined ? rows : rows.slice(0, n);
  }

  /** Ascending by key (Python's sorted(counter.items())). */
  sorted(): [K, number][] {
    return [...this.counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
}

/** Gets a Tally from a Map<K, Tally>, creating it if missing
 *  (stands in for defaultdict(Counter)). */
function tallyOf<K, V>(table: Map<K, Tally<V>>, key: K): Tally<V> {
  let t = table.get(key);
  if (!t) {
    t = new Tally<V>();
    table.set(key, t);
  }
  return t;
}

const byKey = <K, V>(entries: Iterable<[K, V]>): [K, V][] =>
  [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

/** The middle value of an ascending list; the mean of the two middle values when the count is
 *  even. */
export function median(sorted: number[]): number | null {
  const n = sorted.length;
  if (!n) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* ---------- What to read from a single paper ---------- */

/** Topic, field, and the level in between (subfield). Only subfield is usable for colouring —
 *  field has just 26 values, and almost all medical work lands in "Medicine". */
function topicOf(work: RawWork): [string | null, string | null, string | null] {
  const t = work.primary_topic ?? {};
  return [t.display_name ?? null, t.field?.display_name ?? null, t.subfield?.display_name ?? null];
}

/** Countries of the paper's authors. The unit used to measure how wide the reach is. */
function countriesOf(work: RawWork): string[] {
  const out: string[] = [];
  for (const a of work.authorships ?? []) {
    for (const c of a.countries ?? []) if (!out.includes(c)) out.push(c);
    for (const inst of a.institutions ?? []) {
      const c = inst.country_code;
      if (c && !out.includes(c)) out.push(c);
    }
  }
  return out;
}

/** The user's position on the paper. First = did the work, last = led it. */
function myRole(work: RawWork, egoIds: Set<string>): [string | null, boolean] {
  for (const a of work.authorships ?? []) {
    const aid = a.author?.id;
    if (aid && egoIds.has(shortId(aid))) {
      return [a.author_position ?? null, Boolean(a.is_corresponding)];
    }
  }
  return [null, false];
}

type Seen = { id: string; name: string | null; orcid: string | null };

/** Co-authors on the paper. Split records are folded into the canonical id and duplicates
 *  collapsed. Affiliation and country are as printed on the paper (where they were when they
 *  did that work), so they cost nothing extra. */
function coauthorsOf(
  work: RawWork,
  egoIds: Set<string>,
  who: (id: string) => string,
  seen: Map<string, Seen>,
): MyWork["coauthors"] {
  const out: MyWork["coauthors"] = [];
  const added = new Set<string>();
  for (const a of work.authorships ?? []) {
    const raw = a.author?.id;
    if (!raw) continue;
    const aid = shortId(raw);
    if (egoIds.has(aid)) continue;
    const keep = who(aid);
    if (added.has(keep)) continue;
    added.add(keep);
    const inst = (a.institutions?.length ? a.institutions : [{}])[0];
    const row: MyWork["coauthors"][number] = { id: keep, name: seen.get(keep)?.name ?? null };
    // Leave out empty keys. Across 508 papers x 30 co-authors, it adds up.
    if (inst.display_name) row.inst = inst.display_name;
    const cc = inst.country_code || (a.countries ?? [])[0];
    if (cc) row.cc = cc;
    out.push(row);
  }
  return out;
}

/* ---------- Shape ---------- */

/** Returns {ego, ego_name, works, meta}. Does not read citations. */
export async function buildPapers(
  client: OpenAlexClient,
  orcid: string,
  excludeWorks: Set<string> = new Set(),
  progress: Progress = () => {},
): Promise<Papers> {
  const records = await client.authorsByOrcid(orcid);
  if (!records.length) throw new Error(`ORCID ${orcid} was not found in OpenAlex.`);
  const ego = records[0];
  const egoId = shortId(ego.id);
  // OpenAlex sometimes splits one person into several records. Read all of them as the user.
  const egoIds = new Set([egoId, ...records.slice(1).map((r) => shortId(r.id))]);
  progress(`Found ${ego.display_name} (${egoId}), ${ego.works_count} works`);

  const fetched = await client.worksWithAuthorships([...egoIds].sort(), { withReferences: true });
  // A preprint and the paper it became are one piece of research; a correction is not one.
  const { works: raw, aliases, notResearch } = collapseVersions(fetched);
  if (aliases.size) {
    progress(`Counting ${aliases.size} preprints as the published papers they became`);
  }
  if (notResearch.length) {
    progress(`Leaving out ${notResearch.length} corrections, review reports and notices`);
  }
  const mine = raw.filter((w) => !excludeWorks.has(shortId(w.id)));
  // Keep the titles of papers set aside, too. Otherwise the user cannot put them back.
  const putAside = raw
    .filter((w) => excludeWorks.has(shortId(w.id)))
    .map((w) => ({
      id: shortId(w.id),
      title: w.title ?? null,
      year: saneYear(w.publication_year),
      topic: w.primary_topic?.display_name ?? null,
    }));
  if (mine.length < raw.length) {
    progress(`Ignoring ${raw.length - mine.length} publications you marked as not yours`);
  }
  progress(`Read ${mine.length} of their publications`);

  const myIds = new Set(mine.map((w) => shortId(w.id)));

  // Re-merge split author records. ORCIDs only exist at this layer, so this is the only
  // place the check can be made.
  const seen = new Map<string, Seen>();
  const onPaper = new Map<string, Set<string>>();
  // The canonical record is the one that appeared most often for that person
  const appearances = new Map<string, number>();
  for (const w of mine) {
    const here = new Set<string>();
    for (const a of w.authorships ?? []) {
      const author = a.author;
      if (!author?.id) continue;
      const aid = shortId(author.id);
      appearances.set(aid, (appearances.get(aid) ?? 0) + 1);
      if (egoIds.has(aid)) continue;
      here.add(aid);
      if (!seen.has(aid)) {
        seen.set(aid, { id: aid, name: author.display_name ?? null, orcid: author.orcid ?? null });
      }
    }
    for (const aid of here) {
      let others = onPaper.get(aid);
      if (!others) onPaper.set(aid, (others = new Set()));
      for (const other of here) if (other !== aid) others.add(other);
    }
  }

  const canonical = mergeMap(
    seen.values(),
    (a, b) => onPaper.get(a)?.has(b) ?? false,
    (p) => [appearances.get(p.id) ?? 0, p.id],
  );
  if (canonical.size) {
    progress(
      `Merged ${canonical.size - new Set(canonical.values()).size} split author records ` +
        "among your co-authors",
    );
  }
  const who = (aid: string) => canonical.get(aid) ?? aid;

  const works: PaperRow[] = mine.map((w) => {
    const id = shortId(w.id);
    const [topic, field, subfield] = topicOf(w);
    const [position, corresponding] = myRole(w, egoIds);
    const refs = new Set(
      (w.referenced_works ?? []).map((r) => aliases.get(shortId(r)) ?? shortId(r)),
    );
    refs.delete(id);
    return {
      id,
      title: w.title ?? null,
      year: saneYear(w.publication_year),
      doi: w.doi ?? null,
      topic,
      field,
      subfield,
      cited_by_count: w.cited_by_count ?? 0,
      // Normalised by field and year. 1.0 is the field average.
      fwci: w.fwci ?? null,
      percentile: w.citation_normalized_percentile?.value ?? null,
      retracted: Boolean(w.is_retracted),
      my_position: position as MyWork["my_position"],
      corresponding,
      coauthors: coauthorsOf(w, egoIds, who, seen),
      // References to the user's own earlier papers. An internal signal of how the work
      // builds on itself; excluded from citation counts.
      builds_on: [...refs].filter((r) => myIds.has(r)).sort(),
      refs: [...refs].filter((r) => !myIds.has(r)).sort(),
    };
  });

  // The user's country, where the arcs start. The most common country on their own authorships.
  const mineCountries = new Tally<string>();
  for (const w of mine) {
    for (const a of w.authorships ?? []) {
      const aid = a.author?.id;
      if (aid && egoIds.has(shortId(aid))) {
        for (const code of a.countries ?? []) mineCountries.add(code);
      }
    }
  }
  const egoCountry = mineCountries.mostCommon(1)[0]?.[0] ?? null;

  const fwci = works
    .map((w) => w.fwci)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const years = works.map((w) => w.year).filter((y): y is number => Boolean(y));

  return {
    ego: egoId,
    ego_name: ego.display_name ?? null,
    ego_ids: [...egoIds].sort(),
    works,
    aliases: Object.fromEntries(aliases),
    not_research: notResearch.map((w) => shortId(w.id)),
    meta: {
      version: PAPERS_VERSION,
      orcid,
      n_author_records: records.length,
      n_works: works.length,
      n_excluded_works: raw.length - mine.length,
      n_preprints_folded: [...aliases.values()].filter((id) => myIds.has(id)).length,
      n_not_research: notResearch.length,
      excluded_works: putAside.sort((a, b) => (b.year || 0) - (a.year || 0)),
      cited_by_total: works.reduce((acc, w) => acc + w.cited_by_count, 0),
      ego_country: egoCountry,
      fwci_median: median(fwci),
      n_fwci: fwci.length,
      n_fwci_above: fwci.filter((v) => v > 1).length,
      years: [years.length ? Math.min(...years) : null, years.length ? Math.max(...years) : null],
      api_requests: client.nRequests,
      api_cost_usd: round5(client.costUsd),
    },
  };
}

/* ---------- Globe ---------- */

/** Returns {ego, citing, meta}, built from the output of buildPapers. The expensive stage. */
export async function buildReach(
  client: OpenAlexClient,
  papers: Papers,
  maxCiting = MAX_CITING,
  progress: Progress = () => {},
): Promise<Reach> {
  const myIds = new Set(papers.works.map((w) => w.id));
  // A citation to a folded preprint counts for the published paper.
  const toMine = new Map<string, string>();
  for (const id of myIds) toMine.set(id, id);
  for (const [alias, kept] of Object.entries(papers.aliases ?? {})) {
    if (myIds.has(kept)) toMine.set(alias, kept);
  }
  // Any work of the user's, research or not. A citation from one of them is a self-citation.
  const own = new Set([...toMine.keys(), ...(papers.not_research ?? [])]);
  progress("Finding who has cited your work");

  /** Trims one page down to the fields we need. The raw page is dropped here. */
  const keep = (page: RawWork[]): ReachRow[] => {
    const out: ReachRow[] = [];
    for (const w of page) {
      const cites = [
        ...new Set(
          (w.referenced_works ?? [])
            .map((r) => toMine.get(shortId(r)))
            .filter((r): r is string => r !== undefined),
        ),
      ].sort();
      if (!cites.length) continue;
      const [topic, field, subfield] = topicOf(w);
      const authors = new Set<string>();
      for (const a of w.authorships ?? []) if (a.author?.id) authors.add(shortId(a.author.id));
      out.push({
        id: shortId(w.id),
        title: w.title ?? null,
        year: saneYear(w.publication_year),
        doi: w.doi ?? null,
        topic,
        field,
        subfield,
        countries: countriesOf(w),
        cited_by_count: w.cited_by_count ?? 0,
        // Which of the user's papers it cites
        cites,
        authors: [...authors],
      });
    }
    return out;
  };

  const [kept, nRaw] = await client.worksCiting([...toMine.keys()].sort(), keep, maxCiting, progress);

  // Duplicates and self-citations span batches, so they are dealt with after fetching.
  const citing: ReachRow[] = [];
  let selfCites = 0;
  const seen = new Set<string>();
  for (const w of kept) {
    if (seen.has(w.id)) continue; // can be duplicated across batches
    seen.add(w.id);
    if (own.has(w.id)) {
      selfCites += w.cites.length; // self-citation; counted only so it can be left out of citations
      continue;
    }
    citing.push(w);
  }

  // If the cap was hit, the country and area counts come out too low. Say so rather than
  // quietly hiding it.
  const capped = nRaw >= maxCiting;

  const countries = new Tally<string>();
  for (const w of citing) for (const c of w.countries) countries.add(c);
  const reach = new Map<string, Tally<number>>();
  const fieldsByCountry = new Map<string, Tally<string>>();
  for (const w of citing) {
    if (!w.year) continue;
    for (const code of w.countries) {
      tallyOf(reach, code).add(w.year);
      const area = w.subfield || w.field;
      if (area) tallyOf(fieldsByCountry, code).add(area);
    }
  }
  const fields = new Tally<string>();
  for (const w of citing) if (w.field) fields.add(w.field);
  const byYear = new Tally<number>();
  for (const w of citing) if (w.year) byYear.add(w.year);
  const links = citing.reduce((acc, w) => acc + w.cites.length, 0);

  progress(
    `Cited by ${citing.length} publications from ${countries.size} countries ` +
      `and ${fields.size} fields`,
  );

  return {
    ego: papers.ego,
    citing,
    meta: {
      version: REACH_VERSION,
      orcid: papers.meta.orcid,
      n_citing: citing.length,
      citation_links: links,
      self_citations: selfCites,
      n_countries: countries.size,
      n_fields: fields.size,
      citing_capped: capped,
      max_citing: maxCiting,
      top_countries: countries.mostCommon(20),
      // Not the same as summing per country (a multi-country paper is not counted once per country)
      citing_by_year: byYear.sorted(),
      // A country cannot be given a single colour, so keep the top 6 areas in detail
      fields_by_country: Object.fromEntries(
        byKey(fieldsByCountry.entries()).map(([code, t]) => [code, t.mostCommon(6)]),
      ),
      // Needed to show the size of everything outside the top 6 ("Other")
      area_total_by_country: Object.fromEntries(
        byKey(fieldsByCountry.entries()).map(([code, t]) => [code, t.total()]),
      ),
      reach_by_country: Object.fromEntries(
        byKey(reach.entries()).map(([code, t]) => [code, t.sorted()]),
      ),
      top_fields: fields.mostCommon(20),
      api_requests: client.nRequests,
      api_cost_usd: round5(client.costUsd),
    },
  };
}

/* ---------- What the UI receives ---------- */

/** What the shape view reads. refs are for bibliographic coupling and unused by the UI
 *  (387KB for a researcher with 508 papers). */
export function worksView(papers: Papers, builtAt: number): WorksGraph {
  return {
    ego: papers.ego,
    ego_name: papers.ego_name,
    works: papers.works.map((w) => {
      const { refs, ...row } = w;
      void refs;
      return row;
    }),
    meta: { ...papers.meta, built_at: builtAt },
  };
}

/** What the globe view reads. Aggregates only; the citing papers themselves are left out. */
export function reachView(papers: Papers, reach: Reach, builtAt: number): ReachGraph {
  return {
    ego: reach.ego,
    ego_name: papers.ego_name,
    citing_total: reach.citing.length,
    meta: { ...papers.meta, ...reach.meta, built_at: builtAt },
  };
}

/** Strongest engagement first: how many of the user's papers they cite, then their own impact. */
function byEngagement(citing: ReachRow[]): ReachRow[] {
  return [...citing].sort(
    (a, b) => b.cites.length - a.cites.length || b.cited_by_count - a.cited_by_count,
  );
}

/** Breakdown of the citations from one country, built when a country is opened.
 *  Passing until limits it to that year and earlier (the globe and the list follow the year). */
export function countryReach(
  papers: Papers,
  reach: Reach,
  code: string,
  until?: number,
  limit = 60,
): CountryReach {
  const here = reach.citing.filter(
    (w) => w.countries.includes(code) && (until === undefined || (w.year || 0) <= until),
  );
  const mine = new Map(papers.works.map((w) => [w.id, w]));

  const areas = new Tally<string>();
  const cited = new Tally<string>();
  const years = new Tally<number>();
  for (const w of here) {
    const area = w.subfield || w.field;
    if (area) areas.add(area);
    if (w.year) years.add(w.year);
    for (const wid of w.cites) cited.add(wid);
  }

  return {
    code,
    n_citing: here.length,
    n_areas: areas.size,
    by_area: areas.mostCommon(8),
    by_year: years.sorted(),
    n_your_papers: cited.size,
    your_papers: cited.mostCommon(6).map(([id, n]) => ({
      id,
      title: mine.get(id)?.title ?? null,
      year: mine.get(id)?.year ?? null,
      doi: mine.get(id)?.doi ?? null,
      n,
    })),
    // Author ids stay behind: the page does not show them, and they are most of the weight.
    citing: byEngagement(here)
      .slice(0, limit)
      .map((w) => {
        const { authors, ...row } = w;
        void authors;
        return row;
      }),
  };
}

/* ---------- Exclusions (papers marked 'not mine') ---------- */

const SITE = "https://openalex.org";

/** Checks whether the papers set aside are still attached to the user in OpenAlex.
 *
 *  Exclusions in the app have to fight author disambiguation forever, but removing a paper in
 *  OpenAlex fixes it once and for all. The job here is to show the user how much has already
 *  been fixed upstream. Every author record with the ORCID is checked: a paper can sit on a
 *  split record rather than the main one. If nothing has been set aside, OpenAlex is not
 *  called. */
export async function exclusionStatus(
  client: OpenAlexClient,
  papers: Papers,
  excluded: Set<string>,
): Promise<ExclusionStatus> {
  const known = new Map<string, { title: string | null; year: number | null }>();
  for (const w of papers.works) known.set(w.id, w);
  for (const w of papers.meta.excluded_works ?? []) if (!known.has(w.id)) known.set(w.id, w);

  const records = papers.ego_ids?.length ? papers.ego_ids : [papers.ego];
  const attached = excluded.size ? await client.workIds(records) : new Set<string>();

  const works = [...excluded]
    .sort()
    .map((id) => ({
      id,
      title: known.get(id)?.title ?? null,
      year: known.get(id)?.year ?? null,
      url: `${SITE}/${id}`,
      // still attached to the user = not yet fixed upstream
      attached: attached.has(id),
    }))
    .sort((a, b) => Number(b.attached) - Number(a.attached) || (b.year || 0) - (a.year || 0));

  return {
    orcid: papers.meta.orcid,
    author_id: papers.ego,
    profile_url: `${SITE}/${papers.ego}`,
    works,
    n_attached: works.filter((w) => w.attached).length,
    n_fixed: works.filter((w) => !w.attached).length,
  };
}
