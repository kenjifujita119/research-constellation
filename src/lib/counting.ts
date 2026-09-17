import type { WorksMeta } from "./types";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What was done to OpenAlex's list before counting, one sentence each. */
export function countingNotes(m: WorksMeta, withExcluded = true): string[] {
  const parts: string[] = [];
  const folded = m.n_preprints_folded ?? 0;
  if (folded) {
    parts.push(
      `${folded} ${plural(folded, "preprint is", "preprints are")} counted as the published ` +
        `${plural(folded, "paper it", "papers they")} became, so no study is counted twice.`,
    );
  }
  const notResearch = m.n_not_research ?? 0;
  if (notResearch) {
    parts.push(
      `${notResearch} ${plural(notResearch, "correction, review report or notice is", "corrections, review reports and notices are")} left out.`,
    );
  }
  const excluded = m.n_excluded_works ?? 0;
  if (withExcluded && excluded) {
    parts.push(`${excluded} you marked as not yours ${plural(excluded, "is", "are")} left out.`);
  }
  const records = m.n_author_records ?? 1;
  if (records > 1) {
    parts.push(`OpenAlex splits you across ${records} profiles; they are read together.`);
  }
  return parts;
}

/** What "N publications" counts, in words. The same sentence wherever the count appears, so
 *  the Shape page, the Reach page and My papers cannot describe it differently. */
export function publicationsNote(m: WorksMeta): string {
  return ["The research OpenAlex lists under your ORCID iD.", ...countingNotes(m)].join(" ");
}
