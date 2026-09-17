/** Types for the data the app builds in the browser (lib/openalex). The shapes were first
 *  defined by the original Python implementation (not included here); keep these types and
 *  lib/openalex in step. */

export type Topic = {
  id: string;
  name: string;
  subfield: string | null;
  field: string | null;
  count: number;
};

export type SharedWork = {
  id: string;
  title: string | null;
  year: number | null;
  doi: string | null;
  cited_by_count: number;
};

export type Bridge = {
  id: string;
  name: string | null;
  /** Number of papers this person has co-authored with the candidate */
  weight: number;
  /** The last year this person and the candidate wrote together. Filled in when the
   *  candidate is opened and recounted */
  last_year?: number | null;
};

/** Where a candidate came from. Unlike bridges, which come from the network, none of
 *  these depend on the network. */
export type EvidenceCounts = {
  /** Their papers in the ego's main topics since the discovery year (2021) */
  topic?: number;
  /** Their papers that cite the ego's papers (each citing paper once) */
  cites_me?: number;
  /** Their papers among the ego's references (each paper once) */
  i_cite?: number;
  /** A ranking signal only: how much their papers cite the same work as the ego (bibliographic
   *  coupling). Counted per batch of references, so one paper can count more than once. Show
   *  shared_refs instead */
  cocite?: number;
};

export type GraphNode = {
  id: string;
  orcid: string | null;
  name: string;
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
  institution: string | null;
  institution_id: string | null;
  country: string | null;
  ror: string | null;

  /** hop1 only */
  collab_with_ego?: number;
  first_collab_year?: number | null;
  last_collab_year?: number | null;
  shared_works?: SharedWork[];
  /** Topic ids of the papers written with the ego. Used when filtering by theme */
  shared_topics?: string[];
  coauthor_count?: number | null;

  /** hop1 only. The research group, found from the links between direct co-authors.
   *  Computed without the ego: the ego is linked to everyone, so leaving them in
   *  squashes everything into one group */
  group?: number | null;
  group_name?: string | null;

  /** hop2 only */
  bridges?: Bridge[];

  /** Which lines of evidence found this candidate, as counts (hop2 / hop3) */
  evidence?: EvidenceCounts;
  /** The same counts broken down by the ego's themes. Keyed by topic id */
  evidence_by_topic?: Record<string, EvidenceCounts>;
  /** Works cited both by the ego and in this person's papers since SHARED_REFS_SINCE. Only
   *  counted for candidates whose papers were read (the verified shortlist) */
  shared_refs?: number;
  counts_by_year?: { year: number; works_count: number }[];

  /** Only present when enrich.py (Python, not included here) corrected the
   *  affiliation. Holds the original values */
  institution_raw?: string;
  country_raw?: string | null;
  confidence?: number;
  confidence_reasons?: string[];
};

export type GraphLink = {
  source: string | GraphNode;
  target: string | GraphNode;
  weight: number;
};

export type Recommendation = {
  id: string;
  orcid: string | null;
  name: string;
  institution: string | null;
  country: string | null;
  h_index: number | null;
  works_count: number;
  active_to: number | null;
  topics: string[];
  /** IDF-weighted. An internal value used for ranking, not an intuitive "closeness" */
  sim: number;
  /** Plain cosine: how much the output overlaps. This is the one displayed and used to
   *  flag competitors */
  overlap: number;
  complementarity: number;
  bridge: number;
  n_bridges: number;
  connection: "hop2" | "none";
  momentum: number;
  evidence: EvidenceCounts;
  /** See GraphNode.shared_refs. null = not counted for this person */
  shared_refs: number | null;
  missing_topics: string[];
  is_competitor: boolean;
  /** fine = a distribution over dozens of topics, built from the papers;
   *  coarse = the author record's top 5 */
  topic_precision?: "fine" | "coarse";
  confidence: number;
  confidence_reasons: string[];
  score: number;
  /** People you could ask for an introduction: up to 3, easiest route first (the same order as
   *  lib/intro.ts routes()). weight is that person's number of papers with the candidate (not
   *  with you) */
  via: { id: string; name: string | null; weight: number }[];
};

/** One of the ego's own papers, shown so they can decide "this one is not mine".
 *  OpenAlex's author disambiguation sometimes merges namesakes into a single record. */
export type EgoWork = {
  id: string;
  title: string | null;
  year: number | null;
  doi: string | null;
  topic: string | null;
  field: string | null;
  coauthors: string[];
  n_authors: number;
  excluded: boolean;
};

/** What OpenAlex currently says about an excluded paper (one marked "not mine").
 *  attached=true means it is still linked to the person upstream. */
export type ExclusionWork = {
  id: string;
  title: string | null;
  year: number | null;
  url: string;
  attached: boolean;
};

export type ExclusionStatus = {
  orcid: string;
  author_id: string;
  profile_url: string;
  works: ExclusionWork[];
  n_attached: number;
  n_fixed: number;
  /** Only for prune: the ids of the papers that were cleared away */
  pruned?: string[];
};

export type GraphMeta = {
  /** When it was built (Unix seconds): the cache file's modification time */
  built_at?: number;
  orcid: string;
  hops: number;
  /** Number of papers the ego removed as "not mine" */
  n_excluded_works?: number;
  since_year: number | null;
  hop2_min_bridges: number;
  n_nodes: number;
  n_links: number;
  n_hop1: number;
  n_hop2: number;
  n_hop2_candidates_total: number;
  /** Number of research groups found among the direct co-authors */
  n_groups?: number;
  /** Number of direct co-authors expanded to find hop2. Can be smaller than n_hop1 */
  n_hop1_expanded?: number;
  /** Number of OpenAlex author records with this ORCID. More than 1 means the person has
   *  split author records */
  n_author_records?: number;
  n_discovered?: number;
  /** The ego's own research themes. Recommendations can be filtered by these */
  ego_topics?: EgoTopic[];
  api_requests: number;
  api_cost_usd: number;
  corrected_affiliations?: number;
};

export type Network = {
  ego: string;
  nodes: GraphNode[];
  links: GraphLink[];
  ego_works?: EgoWork[];
  meta: GraphMeta;
  recommendations?: Recommendations;
};

export type Recommendations = {
  /** null means all themes combined */
  topic?: string | null;
  presets: PresetInfo[];
  results: Record<string, Recommendation[]>;
};

export type EgoTopic = { id: string; name: string; papers: number };

export type JobStatus = {
  status: "running" | "done" | "error";
  messages: string[];
  error?: string | null;
  elapsed: number;
};

export type PresetInfo = { key: string; label: string; description: string };

/* ---------- Works graph (works.py in the Python original, not included here) ---------- */

/** One of your papers. Nothing is filtered out, so every one comes back. */
export type MyWork = {
  id: string;
  title: string | null;
  year: number | null;
  doi: string | null;
  topic: string | null;
  field: string | null;
  cited_by_count: number;
  /** Citation impact normalised by field and year. 1.0 is the field average */
  fwci: number | null;
  /** Position within the field. 0.9 means the top 10% */
  percentile: number | null;
  retracted: boolean;
  /** The ego's position on the paper. first = did the work / last = led it */
  my_position: "first" | "middle" | "last" | null;
  corresponding: boolean;
  /** Co-authors. inst / cc are the affiliation and country printed on that paper, not
   *  the current ones (the trade-off for getting them at no extra API cost) */
  coauthors: { id: string; name: string | null; inst?: string; cc?: string }[];
  /** References to your own earlier papers. An internal signal for lineage; not drawn */
  builds_on: string[];
};

/** A paper that cited you: who your work was useful to. */
export type CitingWork = {
  id: string;
  title: string | null;
  year: number | null;
  doi: string | null;
  topic: string | null;
  field: string | null;
  countries: string[];
  cited_by_count: number;
  /** Which of your papers it cited */
  cites: string[];
};

/** What can be worked out from your own papers alone. Measured: 3–8 s and under $0.0004. */
export type WorksMeta = {
  /** When it was built (Unix seconds): the cache file's modification time */
  built_at?: number;
  orcid: string;
  n_works: number;
  cited_by_total: number;
  /** The ego's country. Used on the Reach page */
  ego_country?: string | null;
  /** Papers removed as not yours. Their titles are kept so they can be restored */
  excluded_works?: { id: string; title: string | null; year: number | null; topic: string | null }[];
  /** Median FWCI over the papers that have one */
  fwci_median: number | null;
  /** Papers with an FWCI (OpenAlex gives none to very recent papers and to preprints) */
  n_fwci?: number;
  /** Of those, how many are above their field's average (FWCI over 1) */
  n_fwci_above?: number;
  /** Preprints counted as the published papers they became (same title) */
  n_preprints_folded?: number;
  /** Corrections, peer-review reports and notices left out */
  n_not_research?: number;
  years: [number | null, number | null];
  n_author_records?: number;
  n_excluded_works?: number;
  api_requests: number;
  api_cost_usd: number;
};

/** What can only be worked out by reading the citations. Measured: 11 s to 6 min 22 s,
 *  up to $0.019. That is why it has its own cache and its own job, separate from the papers. */
export type ReachMeta = WorksMeta & {
  n_citing: number;
  /** Citations actually read: each (citing paper, your paper) pair once, self-citations left
   *  out. Differs from OpenAlex's cited_by_count totals, which cannot be split this way */
  citation_links?: number;
  /** Citations from your own papers, left out of citation_links */
  self_citations: number;
  n_countries: number;
  n_fields: number;
  top_countries: [string, number][];
  top_fields: [string, number][];
  /** Country code -> [[year, count], ...]. Built from every citing paper that was fetched */
  reach_by_country?: Record<string, [number, number][]>;
  /** [year, citing papers that year]. Not the same as summing the countries (this does not
   *  count a paper from several countries more than once) */
  citing_by_year?: [number, number][];
  /** Country code -> [[area, count], ...], up to 6, largest first.
   *  Kept generous because one colour per country does not work (Measured: the top area
   *  has under half of the citations in 79% of countries for a researcher with 508 papers,
   *  and in 20% for Kenji) */
  fields_by_country?: Record<string, [string, number][]>;
  /** Country code -> total citations that have an area. Needed to size the part outside
   *  the top 6 ("other") */
  area_total_by_country?: Record<string, number>;
  /** Whether fetching citing papers hit the cap. If it did, the numbers are cut short */
  citing_capped?: boolean;
  /** The cap itself, so the page does not have to hard-code the number */
  max_citing?: number;
};

/** What the Shape page reads. No citations (4.9MB → 1.3MB for a researcher with 508 papers). */
export type WorksGraph = {
  ego: string;
  ego_name: string | null;
  works: MyWork[];
  meta: WorksMeta;
};

/** What the Reach page (the globe) reads. Only totals, not the citing papers themselves.
 *  Individual papers are fetched one country at a time, when a country is opened. */
export type ReachGraph = {
  ego: string;
  ego_name: string | null;
  /** Total number of citing papers */
  citing_total: number;
  meta: ReachMeta;
};

/** A match when someone starts by searching for a name. Includes what is needed to tell
 *  namesakes apart. */
export type AuthorHit = {
  orcid: string;
  name: string | null;
  institution: string | null;
  country: string | null;
  works_count: number;
  cited_by_count: number;
  topics: (string | null)[];
  years: [number | null, number | null];
};

/** Breakdown of the citations from one country. Returned by
 *  /api/works/{orcid}/countries/{code}. */
export type CountryReach = {
  code: string;
  n_citing: number;
  /** How many areas the citing papers come from. by_area lists only the largest */
  n_areas: number;
  /** [area, citing papers], largest first, up to 8 */
  by_area: [string, number][];
  by_year: [number, number][];
  /** How many of your papers were cited from there. your_papers lists only the most cited */
  n_your_papers: number;
  /** Your papers most cited from that country, up to 6. n = citing papers from there */
  your_papers: { id: string; title: string | null; year: number | null; doi: string | null; n: number }[];
  citing: CitingWork[];
};
