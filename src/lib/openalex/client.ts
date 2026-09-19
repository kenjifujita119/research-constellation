/** Queries to OpenAlex, sent **directly from the user's browser**.
 *
 *  Previously a Python server queried on everyone's behalf with a single API key, so users
 *  all over the world shared one OpenAlex free allowance ($1/day). Querying from the
 *  browser means each user gets the keyless free allowance OpenAlex gives every caller
 *  ($0.10/day; see the X-RateLimit-Limit-USD response header).
 *  Users do not have to enter anything. CORS is open with `*` (checked).
 *
 *  Ported from the original Python implementation (not included here). The port was checked
 *  by building the same researchers with both and comparing the outputs.
 *
 *  This folder (lib/openalex) puts file extensions on relative imports and does not use
 *  the `@/` alias, so it also runs as-is under Node.
 *
 *  OpenAlex metadata is CC0. The ORCID iD is only passed along as an identifier; the
 *  ORCID API is never called. */

export const BASE = "https://api.openalex.org";

/** Maximum number of IDs that can be OR-ed together in one request (an OpenAlex limit) */
export const OR_BATCH = 50;
/** Maximum number of groups group_by returns (an OpenAlex limit). For very prolific
 *  authors, co-authors are cut off at the top 200 by number of shared papers. */
export const GROUP_LIMIT = 200;

export const AUTHOR_SELECT = [
  "id",
  "orcid",
  "display_name",
  "works_count",
  "cited_by_count",
  "summary_stats",
  "last_known_institutions",
  "affiliations",
  "topics",
  "topic_share",
  "counts_by_year",
].join(",");

/* ---------- Shapes OpenAlex returns (only the parts we use) ---------- */

export type RawInstitution = {
  id?: string | null;
  display_name?: string | null;
  country_code?: string | null;
  ror?: string | null;
};

export type RawAuthorship = {
  author?: { id?: string | null; display_name?: string | null; orcid?: string | null } | null;
  author_position?: string | null;
  is_corresponding?: boolean | null;
  countries?: string[] | null;
  institutions?: RawInstitution[] | null;
};

export type RawTopic = {
  id?: string | null;
  display_name?: string | null;
  field?: { display_name?: string | null } | null;
  subfield?: { display_name?: string | null } | null;
} | null;

export type RawWork = {
  id: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  cited_by_count?: number | null;
  authorships?: RawAuthorship[] | null;
  primary_topic?: RawTopic;
  type?: string | null;
  fwci?: number | null;
  citation_normalized_percentile?: { value?: number | null } | null;
  is_retracted?: boolean | null;
  referenced_works?: string[] | null;
};

export type RawAuthorTopic = {
  id: string;
  display_name: string;
  count?: number | null;
  field?: { display_name?: string | null } | null;
  subfield?: { display_name?: string | null } | null;
};

export type RawAuthor = {
  id: string;
  orcid?: string | null;
  display_name?: string | null;
  works_count?: number | null;
  cited_by_count?: number | null;
  summary_stats?: { h_index?: number | null; i10_index?: number | null } | null;
  last_known_institutions?: RawInstitution[] | null;
  affiliations?: { institution: RawInstitution; years?: number[] | null }[] | null;
  topics?: RawAuthorTopic[] | null;
  counts_by_year?: { year: number; works_count?: number | null; cited_by_count?: number | null }[] | null;
};

type Page<T> = {
  results?: T[] | null;
  meta?: { next_cursor?: string | null; cost_usd?: number | null; count?: number | null } | null;
};

/* ---------- Kinds of failure ---------- */

/** Today's free allowance is used up. It comes back at midnight UTC.
 *
 *  Unless this is told apart from rate limits that clear if you wait, the client retries
 *  endlessly and ends in a failure that makes no sense. The message is shown to users,
 *  so it says what happened and when the allowance comes back. */
export class BudgetExhausted extends Error {
  constructor() {
    super(
      "OpenAlex, where these numbers come from, gives every connection a small free " +
        `allowance each day, and today's has run out. It comes back at ${resetsAt()} your ` +
        "time (midnight UTC); try again then. Nothing is charged.",
    );
    this.name = "BudgetExhausted";
  }
}

/** A response that retrying will not fix (404 and the like). */
export class OpenAlexError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenAlexError";
    this.status = status;
  }
}

/** The free daily limit OpenAlex gives a connection without a key, in the dollars it meters it
 *  in (X-RateLimit-Limit-USD). Nobody is charged: pages show a share of this, never dollars,
 *  because "$0.03" reads as a price. */
export const KEYLESS_DAILY_USD = 0.1;

/** How much of the day's free limit an amount is, as a whole percentage (0–100). */
export function shareOfDay(usd: number): number {
  return Math.min(100, Math.max(0, Math.round((usd / KEYLESS_DAILY_USD) * 100)));
}

/** When the free limit comes back (midnight UTC), in the viewer's own time. */
export function resetsAt(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return next.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const RETRY = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const backoff = (attempt: number) => Math.min(2 ** attempt, 20) * 1000;

/* ---------- Identifiers ---------- */

/** 'https://openalex.org/A5050356914' -> 'A5050356914' */
export function shortId(openalexId: string): string {
  return openalexId.slice(openalexId.lastIndexOf("/") + 1);
}

/** Normalises the forms people type (with a URL / without hyphens) to 0000-0000-0000-0000. */
export function normaliseOrcid(value: string): string {
  const trimmed = value.trim();
  const raw = trimmed.slice(trimmed.lastIndexOf("/") + 1).toUpperCase().replaceAll(" ", "");
  const digits = raw.replaceAll("-", "");
  if (digits.length !== 16) throw new Error(`That does not look like an ORCID iD: ${value}`);
  return digits.match(/.{4}/g)!.join("-");
}

/* ---------- Client ---------- */

export type ClientOptions = {
  /** Optional. Without it, queries use the keyless free allowance (the default in the
   *  browser). Only passed when running the port comparison under Node. */
  apiKey?: string | null;
  /** Minimum gap between requests. About 8 requests/second in total */
  minIntervalMs?: number;
  timeoutMs?: number;
  /** Requests in flight at once. The slow part is round-trip latency, so overlapping
   *  requests shortens the wait */
  workers?: number;
};

export class OpenAlexClient {
  readonly apiKey: string | null;
  readonly minIntervalMs: number;
  readonly timeoutMs: number;
  readonly workers: number;

  costUsd = 0;
  nRequests = 0;
  /** Today's remaining allowance (USD), read from the response headers. null until the
   *  first request has been sent */
  remainingUsd: number | null = null;

  private nextCall = 0;

  constructor(opts: ClientOptions = {}) {
    this.apiKey = opts.apiKey ?? null;
    this.minIntervalMs = opts.minIntervalMs ?? 120;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.workers = opts.workers ?? 6;
  }

  /** Runs a one-request-per-item job over many items. Results come back in input order.
   *
   *  If one item fails, the whole call fails and **the rest are not sent**. If other
   *  batches kept querying after the free allowance ran out, they would spend the user's
   *  allowance on failures (the server version did not stop here). */
  async each<T, R>(
    items: T[],
    call: (item: T) => Promise<R>,
    progress?: (done: number, total: number) => void,
  ): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    let done = 0;
    let failure: { error: unknown } | null = null;

    const worker = async () => {
      while (!failure && next < items.length) {
        const i = next++;
        try {
          out[i] = await call(items[i]);
        } catch (error) {
          failure ??= { error };
          return;
        }
        done += 1;
        progress?.(done, items.length);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(Math.max(1, this.workers), items.length) }, worker),
    );
    if (failure) throw (failure as { error: unknown }).error;
    return out;
  }

  /** Waits until the next request may go out. Reserves a time slot before sleeping, so
   *  that even with parallel callers the total stays at one request per minIntervalMs. */
  private async pace(): Promise<void> {
    const now = performance.now();
    const at = Math.max(now, this.nextCall);
    this.nextCall = at + this.minIntervalMs;
    if (at > now) await sleep(at - now);
  }

  private noteBudget(headers: Headers): void {
    const left = headers.get("X-RateLimit-Remaining-USD");
    if (left === null || left === "") return;
    const n = Number(left);
    if (Number.isFinite(n)) this.remainingUsd = n;
  }

  async get<T>(
    path: string,
    params: Record<string, string | number>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    // Send the key in a header. URLs end up in logs and history.
    const headers: Record<string, string> = {};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    await this.pace();

    let last: unknown = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      let resp: Response;
      try {
        resp = await fetch(url, {
          headers,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        last = err; // network drop or timeout
        await sleep(backoff(attempt));
        continue;
      }
      this.noteBudget(resp.headers);
      if (resp.status === 429) {
        const body = (await resp.json().catch(() => ({}))) as {
          dailyRemainingUsd?: number;
          message?: string;
        };
        if (
          body.dailyRemainingUsd === 0 ||
          /budget/i.test(String(body.message ?? "")) ||
          this.remainingUsd === 0
        ) {
          throw new BudgetExhausted();
        }
      }
      if (RETRY.has(resp.status)) {
        last = new OpenAlexError(resp.status, `OpenAlex answered ${resp.status}`);
        await sleep(backoff(attempt));
        continue;
      }
      // Retrying will not fix a 404 and the like, so raise it as is
      if (!resp.ok) throw new OpenAlexError(resp.status, `OpenAlex answered ${resp.status} for ${path}`);
      const data = (await resp.json()) as T & Page<unknown>;
      this.nRequests += 1;
      this.costUsd += Number(data?.meta?.cost_usd ?? 0) || 0;
      return data;
    }
    throw new Error(`Could not reach OpenAlex (${path}). Check the connection and try again.`, {
      cause: last,
    });
  }

  /* ---------------------------------------------------------- authors */

  /** Searches for authors by name. Returns only records that have an ORCID, one per person,
   *  and whether OpenAlex had more records than one page could bring back.
   *
   *  $0.001 per call (the search price), whatever the page size, so a page of 50 costs no more
   *  than a page of 16. The keyless free allowance is $0.10/day, so do not call this on every
   *  keystroke; the start page calls it once, after typing stops.
   *
   *  Everyone found is returned. This used to keep the 8 with the most works, and a researcher
   *  with 23 works was the 9th of 10 people named Noriko Sato — found by OpenAlex, then dropped
   *  before the page could show her. */
  async searchAuthors(
    query: string,
    signal?: AbortSignal,
  ): Promise<{ authors: RawAuthor[]; more: boolean }> {
    const q = query.trim();
    if (q.length < 2) return { authors: [], more: false };
    const perPage = 50;
    const data = await this.get<Page<RawAuthor>>(
      "/authors",
      {
        search: q,
        filter: "has_orcid:true",
        per_page: perPage,
        select: AUTHOR_SELECT,
      },
      signal,
    );
    // For split author records under one ORCID, show the largest, carrying the counts of all of
    // them (only the ones this search returned, so a lower bound).
    const best = new Map<string, RawAuthor>();
    const works = new Map<string, number>();
    const cited = new Map<string, number>();
    for (const a of data.results ?? []) {
      if (!a.orcid) continue;
      const key = normaliseOrcid(a.orcid);
      works.set(key, (works.get(key) ?? 0) + (a.works_count || 0));
      cited.set(key, (cited.get(key) ?? 0) + (a.cited_by_count || 0));
      if ((a.works_count || 0) > (best.get(key)?.works_count || -1)) best.set(key, a);
    }
    const authors = [...best]
      .map(([key, a]) => ({ ...a, works_count: works.get(key), cited_by_count: cited.get(key) }))
      .sort((a, b) => (b.works_count || 0) - (a.works_count || 0));
    return { authors, more: (data.meta?.count ?? 0) > perPage };
  }

  /** Returns every author record with this ORCID, most works first.
   *
   *  OpenAlex sometimes splits one person across several records. The single-entity
   *  /authors/orcid:... returns only one of them, and you cannot choose which (a real
   *  case: a researcher with 508 papers was split into a 507-paper main record and a
   *  1-paper record). */
  async authorsByOrcid(orcid: string): Promise<RawAuthor[]> {
    const data = await this.get<Page<RawAuthor>>("/authors", {
      filter: `orcid:${normaliseOrcid(orcid)}`,
      per_page: 50,
      select: AUTHOR_SELECT,
    });
    return [...(data.results ?? [])].sort((a, b) => (b.works_count || 0) - (a.works_count || 0));
  }

  /** Resolves OpenAlex author IDs in bulk (OR-ed 50 at a time; batches run in parallel). */
  async authorsByIds(authorIds: string[]): Promise<RawAuthor[]> {
    const chunks: string[][] = [];
    for (let i = 0; i < authorIds.length; i += OR_BATCH) {
      chunks.push(authorIds.slice(i, i + OR_BATCH).map(shortId));
    }
    const pages = await this.each(chunks, (chunk) =>
      this.get<Page<RawAuthor>>("/authors", {
        filter: `openalex_id:${chunk.join("|")}`,
        per_page: OR_BATCH,
        select: AUTHOR_SELECT,
      }),
    );
    return pages.flatMap((p) => p.results ?? []);
  }

  /** Fetches works by id in bulk (OR-ed 50 at a time; batches run in parallel). Results
   *  come back in batch order. */
  async worksByIds(workIds: string[], select: string): Promise<RawWork[]> {
    const chunks: string[][] = [];
    for (let i = 0; i < workIds.length; i += OR_BATCH) {
      chunks.push(workIds.slice(i, i + OR_BATCH).map(shortId));
    }
    const pages = await this.each(chunks, (chunk) =>
      this.get<Page<RawWork>>("/works", {
        filter: `openalex_id:${chunk.join("|")}`,
        per_page: OR_BATCH,
        select,
      }),
    );
    return pages.flatMap((p) => p.results ?? []);
  }

  /** Counts works per author (group_by): {author id: count} in one request.
   *  The order is as OpenAlex returned it (highest count first). */
  async groupAuthors(filter: string): Promise<Map<string, number>> {
    const data = await this.get<{ group_by?: { key?: string | null; count?: number }[] }>(
      "/works",
      { filter, group_by: "authorships.author.id", per_page: GROUP_LIMIT },
    );
    const out = new Map<string, number>();
    for (const g of data.group_by ?? []) {
      if (g.key?.startsWith("https://openalex.org/A")) out.set(shortId(g.key), Math.trunc(Number(g.count)));
    }
    return out;
  }

  /** Returns an author's co-authors as {author id: shared papers}. The author themself is
   *  included. */
  coauthors(authorId: string, sinceYear?: number | null): Promise<Map<string, number>> {
    const filters = [`authorships.author.id:${shortId(authorId)}`];
    if (sinceYear) filters.push(`from_publication_date:${sinceYear}-01-01`);
    return this.groupAuthors(filters.join(","));
  }

  /** Counts the papers this person shares with each of the given people:
   *  {other: {papers, last year written together}}.
   *
   *  Not subject to group_by's top-200 cut-off, so it is used to check who could make an
   *  introduction. For people with many co-authors (over 1,000 for a researcher with 508
   *  papers), weak ties never show up in the capped counts. One request per 50 people.
   *
   *  The last year written together comes from the same response (no extra cost). The
   *  introduction-path diagram uses it to show whether a tie is still active. */
  async coauthoredWith(
    authorId: string,
    others: string[],
  ): Promise<Map<string, { papers: number; last: number | null }>> {
    type Tie = { papers: number; last: number | null };
    const me = shortId(authorId);
    const chunks: string[][] = [];
    for (let i = 0; i < others.length; i += OR_BATCH) {
      chunks.push(others.slice(i, i + OR_BATCH).map(shortId));
    }
    const add = (into: Map<string, Tie>, id: string, papers: number, year: number | null) => {
      const at = into.get(id) ?? { papers: 0, last: null };
      at.papers += papers;
      if (year != null && (at.last == null || year > at.last)) at.last = year;
      into.set(id, at);
    };
    const found = await this.each(chunks, async (chunk) => {
      const want = new Set(chunk);
      const ties = new Map<string, Tie>();
      let cursor: string | null | undefined = "*";
      while (cursor) {
        // Giving the same field twice makes an AND: works whose authors include both
        // this person and someone in this batch
        const data: Page<RawWork> = await this.get("/works", {
          filter: `authorships.author.id:${me},authorships.author.id:${chunk.join("|")}`,
          per_page: 200,
          cursor,
          select: "id,publication_year,authorships",
        });
        for (const w of data.results ?? []) {
          const here = new Set<string>();
          for (const a of w.authorships ?? []) {
            const id = a.author?.id;
            if (id && want.has(shortId(id))) here.add(shortId(id));
          }
          for (const id of here) add(ties, id, 1, w.publication_year ?? null);
        }
        cursor = data.meta?.next_cursor;
      }
      return ties;
    });
    const out = new Map<string, Tie>();
    for (const ties of found) for (const [id, t] of ties) add(out, id, t.papers, t.last);
    return out;
  }

  /** Checks today's remaining allowance (USD). Fetching a single entity is free ($0), so
   *  this reads it without using up any of the allowance. Collaborator search uses 30–70%
   *  of the free allowance, so the figure is needed to show before it starts. */
  async remaining(): Promise<number | null> {
    await this.get("/works/W2741809807", { select: "id" });
    return this.remainingUsd;
  }

  /* ------------------------------------------------------------ works */

  /** Fetches only the ids of the works currently linked to these author records (one person's
   *  split records together). Used solely to check whether the person has removed a paper on
   *  the OpenAlex side. 200 per request. */
  async workIds(authorIds: string[], maxWorks = 2000): Promise<Set<string>> {
    const ids = new Set<string>();
    let cursor: string | null | undefined = "*";
    while (cursor && ids.size < maxWorks) {
      const data: Page<{ id: string }> = await this.get("/works", {
        filter: `authorships.author.id:${authorIds.map(shortId).join("|")}`,
        per_page: 200,
        cursor,
        select: "id",
      });
      for (const w of data.results ?? []) ids.add(shortId(w.id));
      cursor = data.meta?.next_cursor;
    }
    return ids;
  }

  /** Fetches the works citing these works and returns only what `keep` lets through.
   *
   *  **Raw pages are dropped here.** Collecting every page and filtering afterwards means
   *  holding 216 MB of raw data for a researcher with 508 papers (17,637 citations) only
   *  to throw 98% of it away. A browser tab cannot cope with that.
   *
   *  Within a batch, pages follow a cursor, so they run one after another; batches run in
   *  parallel. The cap applies to the total across all batches: a cap per batch would let
   *  the total overshoot once for every batch.
   *
   *  Returns (rows kept, raw works seen). The second tells whether the cap was hit. */
  async worksCiting<R>(
    workIds: string[],
    keep: (page: RawWork[]) => R[],
    maxWorks = 40000,
    progress: (message: string) => void = () => {},
  ): Promise<[R[], number]> {
    const select =
      "id,doi,title,publication_year,primary_topic,cited_by_count,referenced_works,authorships";
    const chunks: string[][] = [];
    for (let i = 0; i < workIds.length; i += OR_BATCH) {
      chunks.push(workIds.slice(i, i + OR_BATCH).map(shortId));
    }
    let taken = 0;
    let seenWorks = 0;

    const batch = async (chunk: string[]): Promise<R[]> => {
      const rows: R[] = [];
      let cursor: string | null | undefined = "*";
      while (cursor) {
        if (taken >= maxWorks) break;
        const data: Page<RawWork> = await this.get("/works", {
          filter: "cites:" + chunk.join("|"),
          per_page: 100,
          cursor,
          select,
        });
        const page = data.results ?? [];
        for (const row of keep(page)) rows.push(row);
        taken += page.length;
        cursor = data.meta?.next_cursor;
      }
      return rows;
    };

    const tick = () => {
      seenWorks = Math.min(seenWorks + OR_BATCH, workIds.length);
      progress(
        `Reading citations ${seenWorks}/${workIds.length} of your publications (${taken} so far)`,
      );
    };

    const results: R[] = [];
    for (const rows of await this.each(chunks, batch, tick)) {
      for (const row of rows) results.push(row);
    }
    return [results, taken];
  }

  /** Fetches an author's works with their authorships. Split author records are read
   *  together as one person (OR is "|"). */
  async worksWithAuthorships(
    authorIds: string[],
    opts: { sinceYear?: number | null; maxWorks?: number; withReferences?: boolean } = {},
  ): Promise<RawWork[]> {
    const maxWorks = opts.maxWorks ?? 1000;
    const filters = ["authorships.author.id:" + authorIds.map(shortId).join("|")];
    if (opts.sinceYear) filters.push(`from_publication_date:${opts.sinceYear}-01-01`);

    const results: RawWork[] = [];
    let cursor: string | null | undefined = "*";
    while (cursor && results.length < maxWorks) {
      const data: Page<RawWork> = await this.get("/works", {
        filter: filters.join(","),
        per_page: 200,
        cursor,
        // fwci = citation impact normalised by field and year (1.0 is the field average)
        select:
          "id,doi,title,publication_year,cited_by_count,authorships,primary_topic,type,fwci," +
          "citation_normalized_percentile,is_retracted" +
          (opts.withReferences ? ",referenced_works" : ""),
      });
      for (const w of data.results ?? []) results.push(w);
      cursor = data.meta?.next_cursor;
    }
    return results.slice(0, maxWorks);
  }
}
