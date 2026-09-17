/** One piece of research, counted once.
 *
 *  OpenAlex keeps a preprint and the article it became as two separate works, and it lists
 *  corrections, peer-review reports and journal front matter under the author as well. Counted
 *  as they come, the same study shows up twice and a correction counts as a paper. Real example:
 *  Kenji had two 2024 preprints whose articles came out in 2025, so everyone on them looked as if
 *  they had written one more paper with him than they had.
 *
 *  A preprint is folded into a published work only when the titles match exactly (after
 *  lower-casing and dropping punctuation). A title that changed in review stays separate: showing
 *  a duplicate is better than hiding a paper. Two published works with the same title are left
 *  alone too; they are often real updates (a Cochrane review republished years later).
 *
 *  The Shape page and the collaborator search both run the works through this, so a paper
 *  someone marks "not mine" has the same id on both. */

import type { RawWork } from "./client.ts";
import { shortId } from "./client.ts";

/** Work types that are not a piece of research in their own right. Measured on a researcher with
 *  506 works: 4 corrections, 2 "Author comment" peer-review records, "Acknowledgement to Referees
 *  2012" and one set of supplementary tables. */
export const NOT_RESEARCH = new Set([
  "erratum",
  "retraction",
  "peer-review",
  "paratext",
  "supplementary-materials",
  "grant",
  "libguides",
]);

/** Shorter titles ("Statins in older adults", "Reply") are shared by unrelated works. */
const MIN_TITLE = 25;

/** The title reduced to letters and digits, or null when it is too short to go on. */
export function titleKey(title: string | null | undefined): string | null {
  if (!title) return null;
  const key = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // accents, once split off by NFKD
    .toLowerCase()
    .replace(/<[^>]+>/g, " ") // OpenAlex titles sometimes keep <i> and <sub> tags
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return key.length >= MIN_TITLE ? key : null;
}

export type Versions = {
  /** One work per piece of research, in the order OpenAlex returned them. A work that absorbed
   *  a preprint is a copy carrying both sets of references and both citation counts */
  works: RawWork[];
  /** Folded preprint -> the work it was folded into */
  aliases: Map<string, string>;
  /** The preprints that were folded, as they came */
  folded: RawWork[];
  /** Left out as not research */
  notResearch: RawWork[];
};

const cites = (w: RawWork) => w.cited_by_count ?? 0;

/** Which work a title settles on: a published one if there is any, then the most cited. */
const outranks = (a: RawWork, b: RawWork) =>
  (a.type !== "preprint" ? 1 : 0) - (b.type !== "preprint" ? 1 : 0) || cites(a) - cites(b);

export function collapseVersions(raw: RawWork[]): Versions {
  const notResearch = raw.filter((w) => NOT_RESEARCH.has(w.type ?? ""));
  const research = raw.filter((w) => !NOT_RESEARCH.has(w.type ?? ""));

  const keeper = new Map<string, RawWork>();
  for (const w of research) {
    const key = titleKey(w.title);
    if (!key) continue;
    const at = keeper.get(key);
    if (!at || outranks(w, at) > 0) keeper.set(key, w);
  }

  const aliases = new Map<string, string>();
  const folded: RawWork[] = [];
  const absorbed = new Map<string, RawWork[]>();
  for (const w of research) {
    if (w.type !== "preprint") continue;
    const key = titleKey(w.title);
    const into = key ? keeper.get(key) : undefined;
    if (!into || into === w) continue;
    const id = shortId(into.id);
    aliases.set(shortId(w.id), id);
    folded.push(w);
    if (!absorbed.has(id)) absorbed.set(id, []);
    absorbed.get(id)!.push(w);
  }

  const works = research
    .filter((w) => !aliases.has(shortId(w.id)))
    .map((w) => {
      const extra = absorbed.get(shortId(w.id));
      if (!extra) return w;
      const merged: RawWork = {
        ...w,
        cited_by_count: extra.reduce((acc, p) => acc + cites(p), cites(w)),
      };
      if (w.referenced_works !== undefined) {
        const refs = new Set(w.referenced_works ?? []);
        for (const p of extra) for (const r of p.referenced_works ?? []) refs.add(r);
        merged.referenced_works = [...refs];
      }
      return merged;
    });

  return { works, aliases, folded, notResearch };
}
