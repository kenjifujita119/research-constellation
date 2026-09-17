/** Preprints folded into the papers they became, and corrections left out.
 *
 *  Getting this wrong either counts one study twice or hides a real paper, and neither shows
 *  up as an error anywhere.
 *
 *    npm test */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RawWork } from "./client.ts";
import { collapseVersions, titleKey } from "./versions.ts";

const TITLE = "Frailty in older patients with atrial fibrillation and its relationship with anticoagulant use";

const work = (id: string, fields: Partial<RawWork> = {}): RawWork => ({
  id: `https://openalex.org/${id}`,
  title: TITLE,
  type: "article",
  cited_by_count: 0,
  ...fields,
});

const ids = (works: RawWork[]) => works.map((w) => w.id.slice(w.id.lastIndexOf("/") + 1));

describe("titleKey", () => {
  test("ignores case, punctuation, accents and markup", () => {
    assert.equal(
      titleKey("Patient, carer <i>and</i> healthcare professional perspectives"),
      titleKey("patient carer and healthcare professional perspectives"),
    );
    assert.equal(titleKey("Caregivers’ experiences of médication"), "caregivers experiences of medication");
  });

  test("gives up on short titles, which unrelated works share", () => {
    assert.equal(titleKey("Statins in older adults"), null);
    assert.equal(titleKey(""), null);
    assert.equal(titleKey(null), null);
  });
});

describe("collapseVersions", () => {
  test("folds a preprint into the published paper with the same title", () => {
    const v = collapseVersions([
      work("W1", { type: "preprint", cited_by_count: 1, referenced_works: ["R1", "R2"] }),
      work("W2", { cited_by_count: 2, referenced_works: ["R2", "R3"] }),
    ]);
    assert.deepEqual(ids(v.works), ["W2"]);
    assert.deepEqual([...v.aliases], [["W1", "W2"]]);
    assert.deepEqual(ids(v.folded), ["W1"]);
    // Citations to either version count for the paper, and so do both reference lists
    assert.equal(v.works[0].cited_by_count, 3);
    assert.deepEqual([...(v.works[0].referenced_works ?? [])].sort(), ["R1", "R2", "R3"]);
  });

  test("leaves a preprint alone when the title changed in review", () => {
    const v = collapseVersions([work("W1", { type: "preprint" }), work("W2", { title: `${TITLE} in 2024` })]);
    assert.deepEqual(ids(v.works), ["W1", "W2"]);
    assert.equal(v.aliases.size, 0);
  });

  test("keeps published works with the same title apart, and folds a preprint into the most cited", () => {
    const v = collapseVersions([
      work("W1", { cited_by_count: 6 }),
      work("W2", { cited_by_count: 102 }),
      work("W3", { type: "preprint" }),
    ]);
    assert.deepEqual(ids(v.works), ["W1", "W2"]);
    assert.deepEqual([...v.aliases], [["W3", "W2"]]);
  });

  test("folds repeated preprints into one when nothing was published", () => {
    const v = collapseVersions([
      work("W1", { type: "preprint", cited_by_count: 0 }),
      work("W2", { type: "preprint", cited_by_count: 4 }),
    ]);
    assert.deepEqual(ids(v.works), ["W2"]);
    assert.equal(v.works[0].cited_by_count, 4);
  });

  test("leaves out corrections and review reports, keeping everything else in order", () => {
    const v = collapseVersions([
      work("W1", { title: "A cohort study of deprescribing in hospital wards" }),
      work("W2", { type: "erratum", title: "Correction to: A cohort study" }),
      work("W3", { type: "peer-review", title: "Author comment: Polypharmacy and precision medicine" }),
      work("W4", { type: "dataset", title: "Revised Patients' Attitudes Towards Deprescribing Questionnaire" }),
    ]);
    assert.deepEqual(ids(v.works), ["W1", "W4"]);
    assert.deepEqual(ids(v.notResearch), ["W2", "W3"]);
  });

  test("does not add a reference list to works fetched without one", () => {
    const v = collapseVersions([work("W1", { type: "preprint" }), work("W2")]);
    assert.equal("referenced_works" in v.works[0], false);
  });
});
