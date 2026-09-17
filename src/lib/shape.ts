import type { MyWork } from "./types";

/** Rules for building the shape of a research career.
 *
 *  Nodes are **people only**. Papers are not nodes.
 *    - A paper's position would only ever be the centroid of its authors, so it adds nothing
 *    - Two kinds of ○ are hard to tell apart
 *    - Above all, papers with many authors become giant hubs and wreck the structure
 *
 *  A line means "you were on one of your papers together", but **only for papers with 20 or
 *  fewer authors**. The 57th and 83rd authors of a 99-author paper are not collaborators.
 *  Measured: for a researcher with 508 papers, 9,335 of 15,073 co-author pairs (62%) were
 *  connected only through papers with 20 or more authors, and taking those 13 papers out of the
 *  structure broke the largest cluster down from 28% to 15%. Kenji (13 authors at most) is not
 *  affected.
 *
 *  The researcher themselves is not a node. They connect to everyone, so the moment they are
 *  placed the graph turns into a hairball.
 *
 *  A cluster means only "people who, on your papers, also write with each other". It is not a
 *  lab, an affiliation or a topic. So a cluster must never be named after a person: the moment
 *  you write "So-and-so's group", you are claiming an affiliation the data does not support
 *  (Measured: someone who shared just one paper was placed in a "group" named after a person
 *  they had not necessarily ever met). If you want the theme, look at topic, which is the
 *  OpenAlex primary_topic attached to the paper, unchanged.
 */

/** Maximum number of authors on a paper used to build the structure. Papers above this are not
 *  evidence of "writing together" (they still count as publications, of course). */
export const MAX_AUTHORS_FOR_STRUCTURE = 20;

export type Person = {
  id: string;
  name: string;
  /** Number of papers written together */
  papers: number;
  /** Year of the first paper together */
  since: number;
  /** Year of the last paper together. Shows whether the relationship is still going */
  until: number;
  /** Your own position on the papers written with this person */
  roles: { first: number; middle: number; last: number };
  /** The cluster formed by papers written together. Not a lab or an affiliation */
  cluster: number;
  /** How many people other than this one they write with inside that cluster */
  alsoWith: number;
  /** Topics of the papers written together (OpenAlex primary_topic), all of them, most papers
   *  first. Not narrowed to one because some people write with you across several topics:
   *  narrowing would make them look as if they belonged to only one. The colour is made by
   *  mixing this distribution. */
  topics: TopicShare[];
  /** Affiliation printed on the last paper written together. **Not the current affiliation.**
   *  Looking up the current one costs one request per person (1,197 people for a researcher
   *  with 508 papers). This value comes from the paper itself, so it costs nothing extra, but
   *  it can only say "where they were when that work was done". */
  institution: string | null;
  /** Same as above, country code */
  country: string | null;
};

export type TopicShare = { name: string; papers: number };

/* ---------- Who to draw ---------- */

/** Filters for the shape.
 *
 *  Brought over from the FilterPanel on the collaborator search page. It was the most useful
 *  part there, and you want to do the same when looking at your co-authors: "who in the UK have
 *  I written with?", "who am I still writing with over the last 5 years?".
 *
 *  Only the layer (hop) filter was left behind. The shape holds direct co-authors only, so
 *  there is just one layer. */
export type PeopleFilter = {
  /** Partial match on name or affiliation. Stored in lower case */
  query: string;
  countries: Set<string>;
  institutions: Set<string>;
  topics: Set<string>;
  /** Minimum number of papers written together */
  minPapers: number;
  /** Only people still writing with you in or after this year. 0 means no limit */
  activeSince: number;
};

export const noFilter = (): PeopleFilter => ({
  query: "",
  countries: new Set(),
  institutions: new Set(),
  topics: new Set(),
  minPapers: 1,
  activeSince: 0,
});

/** Number of conditions moved away from the defaults (minPapers aside). Shown on the badge. */
export function countActive(f: PeopleFilter): number {
  return (
    f.countries.size +
    f.institutions.size +
    f.topics.size +
    (f.query ? 1 : 0) +
    (f.activeSince ? 1 : 0)
  );
}

/** Whether a person passes the filter.
 *
 *  Passing `except` ignores that one axis. Used for the counts: if the graph is down to 12
 *  people but the country list still says 68, you cannot tell which one is true. */
export function keeps(p: Person, f: PeopleFilter, except?: keyof PeopleFilter): boolean {
  if (except !== "minPapers" && p.papers < f.minPapers) return false;
  if (except !== "activeSince" && f.activeSince && p.until < f.activeSince) return false;
  if (except !== "countries" && f.countries.size && !f.countries.has(p.country ?? "")) return false;
  if (except !== "institutions" && f.institutions.size && !f.institutions.has(p.institution ?? ""))
    return false;
  if (except !== "topics" && f.topics.size && !p.topics.some((t) => f.topics.has(t.name)))
    return false;
  if (except !== "query" && f.query) {
    const hay = `${p.name} ${p.institution ?? ""}`.toLowerCase();
    if (!hay.includes(f.query)) return false;
  }
  return true;
}

/** The options on one axis and their counts, counted with every other axis applied. */
export function choices(
  people: Person[],
  f: PeopleFilter,
  axis: "countries" | "institutions" | "topics",
): [string, number][] {
  const pool = people.filter((p) => keeps(p, f, axis));
  const n = new Map<string, number>();
  for (const p of pool) {
    if (axis === "topics") for (const t of p.topics) n.set(t.name, (n.get(t.name) ?? 0) + 1);
    else {
      const v = axis === "countries" ? p.country : p.institution;
      if (v) n.set(v, (n.get(v) ?? 0) + 1);
    }
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

export type Tie = { source: string; target: string; papers: number; since: number };

/** The space one paper occupies. Wrapping its authors' positions gives the paper's "field".
 *  Only papers with at least 4 authors (the minimum for a convex hull) and at most 20 (the limit
 *  for use in the structure). */
export type Paper = { id: string; year: number; topic: string | null; people: string[] };

/** Duplicate people are not merged here. IDs are used exactly as the API grouped them.
 *
 *  This file used to merge people by matching names, but ORCID never reaches the browser, so
 *  the only rule available was "same name and never on the same paper". Measured: for a
 *  researcher with 508 papers, 15 of 66 merged pairs were different people (two people with the
 *  same name, two differing only by a middle name, and so on, all with different ORCIDs). The
 *  decision now happens where ORCID is visible, when the data is built (lib/openalex/identity.ts).
 */

/** Label propagation. The seed is fixed, so the same input always gives the same result. */
function detectGroups(people: string[], adj: Map<string, Set<string>>): Map<string, number> {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const order = [...people];
  const label = new Map<string, number>();
  order.forEach((p, i) => label.set(p, i));

  for (let pass = 0; pass < 40; pass++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let changed = 0;
    for (const p of order) {
      const counts = new Map<number, number>();
      for (const q of adj.get(p) ?? []) {
        const l = label.get(q);
        if (l === undefined) continue;
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      if (!counts.size) continue;
      const top = Math.max(...counts.values());
      // Break ties at random. Leaning towards the lower label snowballs labels into merges;
      // measured, 8 groups collapsed into 4.
      const tied = [...counts.entries()].filter(([, v]) => v === top).map(([k]) => k).sort();
      const pick = tied[Math.floor(rnd() * tied.length)];
      if (label.get(p) !== pick) {
        label.set(p, pick);
        changed++;
      }
    }
    if (!changed) break;
  }
  return label;
}

export function buildShape(works: MyWork[]): {
  people: Person[];
  ties: Tie[];
  papers: Paper[];
} {

  const name = new Map<string, string>();
  const papers = new Map<string, number>();
  const since = new Map<string, number>();
  const until = new Map<string, number>();
  const roles = new Map<string, { first: number; middle: number; last: number }>();
  // Take the affiliation from the last paper written together. There is no better reason than
  // "a newer affiliation is closer to the present", but it beats picking an arbitrary paper.
  const affil = new Map<string, { year: number; inst: string | null; cc: string | null }>();
  const tie = new Map<string, Tie>();
  const adj = new Map<string, Set<string>>();
  const sheets: Paper[] = [];

  for (const w of works) {
    if (!w.year) continue;
    const ids = [...new Set(w.coauthors.map((c) => c.id))];
    for (const c of w.coauthors) {
      const key = c.id;
      if (!name.has(key)) name.set(key, c.name ?? key);
      papers.set(key, (papers.get(key) ?? 0) + 1);
      since.set(key, Math.min(since.get(key) ?? w.year, w.year));
      until.set(key, Math.max(until.get(key) ?? w.year, w.year));
      const r = roles.get(key) ?? { first: 0, middle: 0, last: 0 };
      if (w.my_position) r[w.my_position]++;
      roles.set(key, r);
      const had = affil.get(key);
      if (!had || w.year >= had.year) {
        affil.set(key, {
          year: w.year,
          // If this paper lists no affiliation, keep the value already known.
          inst: c.inst ?? had?.inst ?? null,
          cc: c.cc ?? had?.cc ?? null,
        });
      }
    }
    // Papers with many authors are no evidence of writing together, so draw no lines for them
    if (ids.length < 2 || ids.length > MAX_AUTHORS_FOR_STRUCTURE) continue;
    // A convex hull needs at least 4 points
    if (ids.length >= 4) sheets.push({ id: w.id, year: w.year, topic: w.topic, people: ids });
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const k = a + "|" + b;
        const t = tie.get(k);
        if (t) {
          t.papers++;
          t.since = Math.min(t.since, w.year);
        } else {
          tie.set(k, { source: a, target: b, papers: 1, since: w.year });
        }
        if (!adj.has(a)) adj.set(a, new Set());
        if (!adj.has(b)) adj.set(b, new Set());
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
      }
    }
  }

  const ids = [...papers.keys()].sort();
  const label = detectGroups(ids, adj);

  // Topics of the papers written together, most papers first; ties go to the more recent one.
  const tally = new Map<string, Map<string, { n: number; year: number }>>();
  for (const w of works) {
    if (!w.year || !w.topic) continue;
    for (const c of new Set(w.coauthors.map((x) => x.id))) {
      const seen = tally.get(c) ?? new Map<string, { n: number; year: number }>();
      const at = seen.get(w.topic) ?? { n: 0, year: 0 };
      seen.set(w.topic, { n: at.n + 1, year: Math.max(at.year, w.year) });
      tally.set(c, seen);
    }
  }
  const topics = new Map<string, TopicShare[]>();
  for (const [p, seen] of tally) {
    topics.set(
      p,
      [...seen.entries()]
        .sort((a, b) => b[1].n - a[1].n || b[1].year - a[1].year || (a[0] < b[0] ? -1 : 1))
        .map(([name, v]) => ({ name, papers: v.n })),
    );
  }

  // Renumber clusters largest first, so that colour assignment stays stable.
  const members = new Map<number, string[]>();
  for (const p of ids) {
    const l = label.get(p) ?? -1;
    members.set(l, [...(members.get(l) ?? []), p]);
  }
  const ranked = [...members.values()].sort(
    (a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1),
  );
  const group = new Map<string, number>();
  ranked.forEach((g, i) => {
    for (const p of g) group.set(p, i);
  });

  const people: Person[] = ids.map((p) => ({
    id: p,
    name: name.get(p) ?? p,
    papers: papers.get(p) ?? 0,
    since: since.get(p) ?? 0,
    until: until.get(p) ?? 0,
    roles: roles.get(p) ?? { first: 0, middle: 0, last: 0 },
    cluster: group.get(p) ?? 0,
    alsoWith: adj.get(p)?.size ?? 0,
    topics: topics.get(p) ?? [],
    institution: affil.get(p)?.inst ?? null,
    country: affil.get(p)?.cc ?? null,
  }));

  return { people, ties: [...tie.values()], papers: sheets };
}
