import { strength } from "./openalex/recommend";
import type { GraphNode } from "./types";

export { strength };

/** Year the shared-reference count starts from (see enrich.ts). */
export const SHARED_REFS_SINCE = 2020;

/** How to order "who you could ask to reach this person".
 *
 *  Both the diagram (IntroPath) and the table (NodeDetail) use this. With the ordering rule in two
 *  places they will always disagree — and they did: the diagram showed "3 people, most papers with
 *  you first" and the names below showed "everyone, most papers with the candidate first", so not
 *  even the top 3 matched. */
export type Route = {
  id: string;
  name: string;
  /** Number of papers you have co-authored with that person */
  mine: number;
  /** Number of papers that person has co-authored with the candidate */
  theirs: number;
  /** Strength of the route */
  strength: number;
  /** Last year you and that person wrote together */
  lastWithYou: number | null;
  /** Last year that person and the candidate wrote together. Unknown until the candidate is
   *  opened and recounted */
  lastWithThem: number | null;
};

/** How many years still count as "an ongoing relationship". The same cut-off as recency in the
 *  recommendations (no penalty for the last 3 years) — if "recent" meant something different on
 *  each page, nobody could read them. */
export const RECENT_YEARS = 3;

export function isRecent(year: number | null | undefined, now = new Date().getFullYear()): boolean {
  return year != null && now - year <= RECENT_YEARS;
}

/** People who could introduce you, easiest route first.
 *
 *  Route strength (strength(), in recommend.ts so the list can use it too) is the harmonic mean,
 *  which gets pulled down by the weaker of the two counts. A chain breaks at its weakest link.
 *  Even if someone has written 71 papers with you, you cannot ask them for an introduction if they
 *  have written only 1 with the candidate — a simple mean makes that look like 36, while the
 *  harmonic mean gives 2.
 *
 *  Real example (a researcher with 508 papers -> one candidate): introducer A has written 71
 *  papers with the candidate but only 3 with the researcher, giving a strength of 5.8. Introducer
 *  B has 5 and 13, giving 7.2. Routes are ranked by whether they will get you through, not by how
 *  many papers are involved. */
export function routes(them: GraphNode, byId: Map<string, GraphNode>): Route[] {
  return (them.bridges ?? [])
    .map((b) => {
      const mine = byId.get(b.id)?.collab_with_ego ?? 1;
      const theirs = b.weight || 1;
      return {
        id: b.id,
        name: b.name ?? b.id,
        mine,
        theirs,
        strength: strength(mine, theirs),
        lastWithYou: byId.get(b.id)?.last_collab_year ?? null,
        lastWithThem: b.last_year ?? null,
      };
    })
    .sort((a, b) => b.strength - a.strength || b.mine - a.mine || (a.name < b.name ? -1 : 1));
}

/** Connections that don't go through a co-author. Having no co-author in common does not mean
 *  there is no route. Measured: of 597 candidates with no co-authorship path, none had zero
 *  evidence (citations in at least one direction 74%, shared references 79%).
 *
 *  Ordered by how much each one helps when writing the first email. The candidate citing you is
 *  the strongest — there is already evidence they have read your work. */
export type Connection = { key: string; label: string; count: number; note: string };

export function connections(them: GraphNode): Connection[] {
  const e = them.evidence ?? {};
  const rows: Connection[] = [
    {
      key: "cites_me",
      label: "Their papers that cite yours",
      count: e.cites_me ?? 0,
      note: "They have read your work already — the strongest way to open.",
    },
    {
      key: "i_cite",
      label: "Their papers in your references",
      count: e.i_cite ?? 0,
      note: "You already build on their work.",
    },
    {
      key: "cocite",
      label: `Works you both cite (their papers since ${SHARED_REFS_SINCE})`,
      count: them.shared_refs ?? 0,
      note: "You read the same literature.",
    },
    {
      key: "topic",
      label: "Their papers on your topics since 2021",
      count: e.topic ?? 0,
      note: "You work on the same questions.",
    },
  ];
  return rows.filter((r) => r.count > 0);
}
