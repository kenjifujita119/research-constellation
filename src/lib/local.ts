/** Builds what the pages need **inside this browser**.
 *
 *  This used to be done by a Python server, and the pages went through "ask it to build -> poll
 *  for progress -> fetch the result when ready" with that server. The steps are kept as they were;
 *  only the other side has moved into the browser — the pages do not need to know which one they
 *  are talking to. The rules match apps/api/coauthor/server.py in the original Python server,
 *  which is not included in this repository.
 *
 *  Requests go straight from the user's browser to OpenAlex, so each user spends their own keyless
 *  free allowance ($0.10/day). Nobody shares a single server key with everyone else.
 *
 *  Jobs live in this tab. They carry on when you move between pages (within the same tab), but
 *  stop on reload or when the tab is closed. So do not reload after a rebuild — if something is
 *  still being read in the background, the free allowance spent so far is wasted. */

import { ApiError } from "./errors";
import { OpenAlexClient, normaliseOrcid } from "./openalex/client";
import type { NetGraph } from "./openalex/network";
import { NETWORK_VERSION, runPipeline } from "./openalex/pipeline";
import { CURRENT_YEAR, recommendAll } from "./openalex/recommend";
import {
  MAX_CITING,
  PAPERS_VERSION,
  REACH_VERSION,
  buildPapers,
  buildReach,
  countryReach,
  exclusionStatus,
  reachView,
  worksView,
  type Papers,
  type Reach,
} from "./openalex/works";
import * as store from "./store";
import type {
  AuthorHit,
  Bridge,
  CountryReach,
  ExclusionStatus,
  JobStatus,
  Network,
  ReachGraph,
  Recommendations,
  WorksGraph,
} from "./types";

export type StartResult = {
  orcid: string;
  status: "running" | "done";
  cached: boolean;
  job: string;
};

type Job = {
  status: JobStatus["status"];
  messages: string[];
  error: string | null;
  startedAt: number;
};

const jobs = new Map<string, Job>();

const worksKey = (orcid: string) => `${orcid}_works`;
const reachKey = (orcid: string) => `${orcid}_reach`;
/** Job name for a collaborator search. It appears as-is in the URL (/graph/?job=…), so it keeps
 *  the same form as in the server version. */
const networkKey = (orcid: string, hops: number, since: number | null) =>
  `${orcid}_h${hops}${since ? `_from${since}` : ""}`;
/** The first 19 characters of a job name are the ORCID (0000-0000-0000-0000). */
const orcidOf = (job: string) => job.slice(0, 19);

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

function valid(orcid: string): string {
  try {
    return normaliseOrcid(orcid);
  } catch (err) {
    throw new ApiError(400, describe(err));
  }
}

function begin(key: string): Job {
  const job: Job = { status: "running", messages: [], error: null, startedAt: Date.now() };
  jobs.set(key, job);
  return job;
}

const logTo = (job: Job) => (message: string) => {
  job.messages.push(message);
};

const runningNow = (key: string) => jobs.get(key)?.status === "running";

/** Starts the job if it is not running. If it is, does nothing (running the same thing twice
 *  would spend the free allowance twice). */
function start(key: string, run: (job: Job) => Promise<void>): void {
  if (runningNow(key)) return;
  const job = begin(key);
  run(job).catch((err) => {
    // Don't let the job crash; record the reason. The page picks it up through status.
    if (job.status !== "done") {
      job.status = "error";
      job.error = describe(err);
    }
  });
}

/** Discards the saved copy, and also forgets a finished job's record — if it were left behind,
 *  it would answer "done" in the middle of a rebuild, and the page would go to fetch the result
 *  and hit a 404. */
async function drop(key: string): Promise<void> {
  if (!runningNow(key)) jobs.delete(key);
  await store.drop(key);
}

const loadPapers = (orcid: string) => store.load<Papers>(worksKey(orcid), PAPERS_VERSION);
const loadReach = (orcid: string) => store.load<Reach>(reachKey(orcid), REACH_VERSION);
const loadNetwork = (job: string) => store.load<NetGraph>(job, NETWORK_VERSION);

/** Reads the publications, then the citations.
 *
 *  The key point is marking _works done as soon as the publications are saved. Not waiting here
 *  is what lets the Shape page appear within seconds. The citations carry on in the background as
 *  a separate job, _reach. */
async function readWorks(orcid: string, job: Job): Promise<void> {
  const client = new OpenAlexClient();
  const papers = await buildPapers(client, orcid, store.loadExcluded(orcid), logTo(job));
  await store.save(worksKey(orcid), PAPERS_VERSION, papers);

  // If a usable reach already exists, don't read it again. When only the format of the
  // publication data has changed, dragging the citation fetch along wastes the user's free
  // allowance.
  // Decide this **before** marking the publications done. If there is a gap between done and the
  // start of reach, reach looks "missing" (404) for that moment and the page shows a failure.
  const reachNeeded = !runningNow(reachKey(orcid)) && !(await loadReach(orcid));
  job.status = "done";
  job.messages.push("Done");
  if (!reachNeeded) return;
  const next = begin(reachKey(orcid));
  try {
    const reach = await buildReach(client, papers, MAX_CITING, logTo(next));
    await store.save(reachKey(orcid), REACH_VERSION, reach);
    next.status = "done";
    next.messages.push("Done");
  } catch (err) {
    next.status = "error";
    next.error = describe(err);
  }
}

/** Reads only the citations, assuming the publications are already built. */
async function readReach(orcid: string, job: Job): Promise<void> {
  const papers = await loadPapers(orcid);
  if (!papers) throw new Error("Read the publications first");
  const reach = await buildReach(new OpenAlexClient(), papers.value, MAX_CITING, logTo(job));
  await store.save(reachKey(orcid), REACH_VERSION, reach);
  job.status = "done";
  job.messages.push("Done");
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The papers citing the user, which the collaborator search counts "cites you" from. They are
 *  normally there already (the Shape page reads them in the background). If they are still being
 *  read, wait; if they are missing, read them here, and save them for the Reach page too. */
async function citingFor(orcid: string, job: Job): Promise<Reach["citing"]> {
  const log = logTo(job);
  if (runningNow(worksKey(orcid)) || runningNow(reachKey(orcid))) {
    log("Waiting for the papers that cite you to finish reading");
    while (runningNow(worksKey(orcid)) || runningNow(reachKey(orcid))) await sleep(1000);
  }
  const saved = await loadReach(orcid);
  if (saved) return saved.value.citing;
  const client = new OpenAlexClient();
  let papers = (await loadPapers(orcid))?.value;
  if (!papers) {
    papers = await buildPapers(client, orcid, store.loadExcluded(orcid), log);
    await store.save(worksKey(orcid), PAPERS_VERSION, papers);
  }
  const reach = await buildReach(client, papers, MAX_CITING, log);
  await store.save(reachKey(orcid), REACH_VERSION, reach);
  return reach.citing;
}

/** Builds the co-author network and the recommendations. The most expensive operation
 *  (Measured: $0.027–0.066). */
async function readNetwork(
  orcid: string,
  hops: number,
  since: number | null,
  key: string,
  job: Job,
): Promise<void> {
  const citing = await citingFor(orcid, job);
  const graph = await runPipeline(
    new OpenAlexClient(),
    orcid,
    { hops, sinceYear: since, excludeWorks: store.loadExcluded(orcid), citing },
    logTo(job),
  );
  await store.save(key, NETWORK_VERSION, graph);
  job.status = "done";
  job.messages.push("Done");
}

const statusOf = (job: Job): JobStatus => ({
  status: job.status,
  messages: job.messages.slice(-12),
  error: job.error,
  elapsed: Math.round((Date.now() - job.startedAt) / 100) / 10,
});

/* ---------- Called from the pages (lib/api.ts exports them under the same names) ---------- */

/** Asks for the publications to be read. The citation fetch follows in the background. */
export async function startWorksBuild(orcid: string, refresh = false): Promise<StartResult> {
  const id = valid(orcid);
  const job = worksKey(id);
  if (!refresh && (await loadPapers(id))) {
    // The publications can be there without the reach (the last attempt failed / it expired).
    if (!(await loadReach(id))) start(reachKey(id), (j) => readReach(id, j));
    return { orcid: id, status: "done", cached: true, job };
  }
  // A refresh redoes both. If only one were new, each page would show numbers from a different
  // point in time.
  if (refresh) await drop(reachKey(id));
  start(job, (j) => readWorks(id, j));
  return { orcid: id, status: "running", cached: false, job };
}

/** Asks for the citations to be read. Normally they follow the publications automatically, so
 *  there is no need to call this. */
export async function startReachBuild(orcid: string, refresh = false): Promise<StartResult> {
  const id = valid(orcid);
  const job = reachKey(id);
  const papers = await loadPapers(id);
  if (!refresh && papers && (await loadReach(id))) {
    return { orcid: id, status: "done", cached: true, job };
  }
  if (papers) start(job, (j) => readReach(id, j));
  else start(worksKey(id), (j) => readWorks(id, j)); // publications first; citations follow
  return { orcid: id, status: "running", cached: false, job };
}

/** Starts a collaborator search. If a saved copy exists, it is done straight away. */
export async function startBuild(
  orcid: string,
  opts: { hops?: number; sinceYear?: number | null; refresh?: boolean } = {},
): Promise<StartResult> {
  const id = valid(orcid);
  const hops = opts.hops ?? 2;
  const since = opts.sinceYear ?? null;
  const job = networkKey(id, hops, since);
  if (!opts.refresh && (await loadNetwork(job))) {
    return { orcid: id, status: "done", cached: true, job };
  }
  start(job, (j) => readNetwork(id, hops, since, job, j));
  return { orcid: id, status: "running", cached: false, job };
}

export async function fetchStatus(job: string): Promise<JobStatus> {
  const found = jobs.get(job);
  if (found) return statusOf(found);
  // Reach is queued behind the publications. While they are being read, the answer is "not yet".
  if (job.endsWith("_reach")) {
    const ahead = jobs.get(worksKey(orcidOf(job)));
    if (ahead?.status === "running") return statusOf(ahead);
  }
  const cached = job.endsWith("_works")
    ? await loadPapers(orcidOf(job))
    : job.endsWith("_reach")
      ? await loadReach(orcidOf(job))
      : await loadNetwork(job);
  if (cached) return { status: "done", messages: [], elapsed: 0 };
  throw new ApiError(404, "No such job");
}

/** The author's own publications. This is all the Shape page needs; citations are not included. */
export async function fetchWorks(orcid: string): Promise<WorksGraph> {
  const papers = await loadPapers(orcid);
  if (!papers) throw new ApiError(404, "This works graph has not been built yet");
  return worksView(papers.value, papers.savedAt);
}

/** How far the work has reached. Aggregates only. It takes both parts to make an answer. */
export async function fetchReach(orcid: string): Promise<ReachGraph> {
  const [papers, reach] = await Promise.all([loadPapers(orcid), loadReach(orcid)]);
  if (!papers || !reach) throw new ApiError(404, "This reach has not been built yet");
  return reachView(papers.value, reach.value, reach.savedAt);
}

/** Breakdown of the citations that came from one country. */
export async function fetchCountryReach(
  orcid: string,
  code: string,
  until?: number,
  since?: number,
): Promise<CountryReach> {
  const [papers, reach] = await Promise.all([loadPapers(orcid), loadReach(orcid)]);
  if (!papers || !reach) throw new ApiError(404, "This reach has not been built yet");
  return countryReach(papers.value, reach.value, code, until, undefined, since);
}

/** The co-author network, with when it was built attached (the page's "3 days ago"). */
export async function fetchNetwork(job: string): Promise<Network> {
  const graph = await loadNetwork(job);
  if (!graph) throw new ApiError(404, "This network has not been built yet");
  return {
    ...graph.value,
    meta: { ...graph.value.meta, built_at: graph.savedAt },
  } as unknown as Network;
}

/** Recommendations for a different topic or count. This is scoring only, so OpenAlex is not called.
 *  Given a preset, returns just that one (the page only shows one at a time). */
export async function fetchRecommendations(
  job: string,
  topic: string | null,
  limit = 25,
  preset?: string,
): Promise<Recommendations> {
  const graph = await loadNetwork(job);
  if (!graph) throw new ApiError(404, "This network has not been built yet");
  if (topic && !(graph.value.meta.ego_topics ?? []).some((t) => t.id === topic)) {
    throw new ApiError(404, `No breakdown for topic ${topic}`);
  }
  const out = recommendAll(graph.value, limit, CURRENT_YEAR, topic);
  if (preset !== undefined) {
    if (!(preset in out.results)) throw new ApiError(404, `No such basis: ${preset}`);
    out.results = { [preset]: out.results[preset] };
  }
  return out;
}

/** When a candidate is opened, recounts the people who could introduce you, with no cut-off.
 *
 *  At build time, introducers are taken from "the top 200 co-authors of each direct co-author",
 *  so the weak co-authorships of people with many co-authors are invisible. Real examples (Kenji):
 *  one candidate had 1 introducer at build time and 3 after the recount; another went from 1 to 2.
 *  If we are going to say "there is nobody in between", we check everyone first.
 *
 *  One request per 50 direct co-authors (2 for Kenji, 23 for a researcher with 508 papers;
 *  $0.0002–0.0023). The result is saved once counted, so reopening is free. The recommendations
 *  are recomputed and saved too — so that the "no route" mark in the list is corrected as well. */
export async function fetchIntroducers(job: string, candidateId: string): Promise<Bridge[]> {
  const saved = await loadNetwork(job);
  if (!saved) throw new ApiError(404, "This network has not been built yet");
  const graph = saved.value;
  const node = graph.nodes.find((n) => n.id === candidateId);
  if (!node) throw new ApiError(404, "No such candidate");
  // Recount only once. But recount entries without the last year written together (ones checked
  // before we started counting years) — the diagram needs it to show whether the relationship is
  // still active.
  if (node.bridges_checked && (node.bridges ?? []).every((b) => b.last_year !== undefined)) {
    return node.bridges ?? [];
  }

  const hop1 = graph.nodes.filter((n) => n.hop === 1);
  const ties = await new OpenAlexClient().coauthoredWith(
    candidateId,
    hop1.map((n) => n.id),
  );
  // Keep what was visible at build time. Split co-author records have been merged into one
  // representative, so recounting with the representative's id alone can drop co-authorships
  // that belong to the merged records. For those the year is unknown (null).
  for (const b of node.bridges ?? []) {
    const at = ties.get(b.id);
    if (!at) ties.set(b.id, { papers: b.weight, last: null });
    else at.papers = Math.max(at.papers, b.weight);
  }
  const names = new Map(hop1.map((n) => [n.id, n.name]));
  node.bridges = [...ties]
    .sort((a, b) => b[1].papers - a[1].papers)
    .map(([id, t]) => ({ id, name: names.get(id) ?? null, weight: t.papers, last_year: t.last }));
  node.bridges_checked = true;
  // If there is an introducer, the candidate is second-degree by definition
  if (node.bridges.length && node.hop === 3) node.hop = 2;
  graph.recommendations = recommendAll(graph);
  await store.update(job, graph);
  return node.bridges;
}

/** What is left of today's OpenAlex free allowance for this connection (USD), or null if unknown.
 *  Read from the response headers of a free single-record fetch, so it costs no allowance. */
export async function remainingAllowance(): Promise<number | null> {
  try {
    return await new OpenAlexClient().remaining();
  } catch {
    return null;
  }
}

/** Checks whether the exclusions (papers marked 'not mine') have been detached on OpenAlex's side.
 *  Makes one call, and only if there are any exclusions. */
export async function fetchExclusionStatus(orcid: string): Promise<ExclusionStatus> {
  const id = valid(orcid);
  const papers = await loadPapers(id);
  if (!papers) throw new ApiError(404, "This works graph has not been built yet");
  return exclusionStatus(new OpenAlexClient(), papers.value, store.loadExcluded(id));
}

/** Clears out exclusions already fixed upstream. The graph is unchanged, so nothing is rebuilt. */
export async function pruneExclusions(orcid: string): Promise<ExclusionStatus> {
  const status = await fetchExclusionStatus(orcid);
  const keep = status.works.filter((w) => w.attached);
  const pruned = status.works.filter((w) => !w.attached).map((w) => w.id);
  if (pruned.length) store.saveExcluded(status.orcid, keep.map((w) => w.id));
  // The state after clearing can be worked out locally. Don't ask OpenAlex again.
  return { ...status, works: keep, n_attached: keep.length, n_fixed: 0, pruned };
}

/** From the Shape page, removes papers that are not the author's. Rereads the publications, then
 *  the citations. */
export async function saveWorksExclusions(
  orcid: string,
  excluded: string[],
): Promise<StartResult> {
  const id = valid(orcid);
  const papers = await loadPapers(id);
  if (!papers) throw new ApiError(404, "This works graph has not been built yet");
  // Reject ids that are neither among the current publications nor already excluded.
  const known = new Set([
    ...papers.value.works.map((w) => w.id),
    ...(papers.value.meta.excluded_works ?? []).map((w) => w.id),
  ]);
  const unknown = excluded.filter((w) => !known.has(w));
  if (unknown.length) {
    throw new ApiError(400, `Not among this author's publications: ${unknown.slice(0, 5).join(", ")}`);
  }
  store.saveExcluded(id, excluded);
  // Reach and the co-author network are both derived from the publications, so they cannot be
  // left stale. The network is rebuilt the next time it is opened (it is expensive, so it is not
  // built for people who never look at it).
  await drop(reachKey(id));
  for (const hops of [1, 2]) await drop(networkKey(id, hops, null));
  start(worksKey(id), (j) => readWorks(id, j));
  return { orcid: id, status: "running", cached: false, job: worksKey(id) };
}

/** Entry by name. $0.001 per call. The entry page calls it only once, after typing stops. */
export async function searchAuthors(
  q: string,
  signal?: AbortSignal,
): Promise<{ results: AuthorHit[]; more: boolean }> {
  const { authors: rows, more } = await new OpenAlexClient().searchAuthors(q, signal);
  return {
    more,
    results: rows.map((a) => {
      const years = (a.counts_by_year ?? []).map((c) => c.year);
      const inst = a.last_known_institutions?.[0];
      return {
        orcid: normaliseOrcid(a.orcid ?? ""),
        name: a.display_name ?? null,
        institution: inst?.display_name ?? null,
        country: inst?.country_code ?? null,
        works_count: a.works_count || 0,
        cited_by_count: a.cited_by_count || 0,
        // What the person works on. The strongest clue for telling namesakes apart.
        topics: (a.topics ?? []).slice(0, 2).map((t) => t.display_name ?? null),
        years: [
          years.length ? Math.min(...years) : null,
          years.length ? Math.max(...years) : null,
        ],
      };
    }),
  };
}
