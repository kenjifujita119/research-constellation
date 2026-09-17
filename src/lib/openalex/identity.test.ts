/** Rules for merging records of the same person. Ported from the original Python tests
 *  (test_identity.py, not included here).
 *
 *  If this goes wrong, the app **shows people under the wrong name**. Two problems were hit on
 *  real data: merging by name alone, 15 of the 66 pairs for a researcher with 508 papers were
 *  actually different people; and the canonical-record picker was handed an id string instead
 *  of the record, which made the network build fail.
 *
 *    npm test */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mergeMap, normaliseName as tokens, sameName } from "./identity.ts";

describe("normaliseName", () => {
  test("strips punctuation and case", () => {
    assert.deepEqual(tokens("Maria K. Lindqvist"), ["maria", "k", "lindqvist"]);
    assert.deepEqual(tokens("MARIA K LINDQVIST"), tokens("Maria K. Lindqvist"));
  });

  test("folds apostrophes and dashes", () => {
    assert.deepEqual(tokens("Nora O’Brien"), tokens("Nora O'Brien"));
    assert.deepEqual(tokens("Jean‐Pierre Dupont"), tokens("Jean-Pierre Dupont"));
  });

  test("folds full width", () => {
    assert.deepEqual(tokens("Ｋｅｎｊｉ Ｆｕｊｉｔａ"), ["kenji", "fujita"]);
  });

  test("empty", () => {
    assert.deepEqual(tokens(null), []);
    assert.deepEqual(tokens("   "), []);
  });
});

describe("sameName", () => {
  test("identical", () => {
    assert.ok(sameName(tokens("Kenji Fujita"), tokens("Kenji Fujita")));
  });

  test("missing middle name is allowed", () => {
    // Real case: these two were the same person
    assert.ok(sameName(tokens("Ana Silva"), tokens("Ana M. Silva")));
  });

  test("initial matches full middle name", () => {
    assert.ok(sameName(tokens("Maria K Lindqvist"), tokens("Maria Katarina Lindqvist")));
  });

  test("run-together initials", () => {
    assert.ok(sameName(tokens("Tomas A.G. Novak"), tokens("Tomas AG Novak")));
  });

  test("conflicting middle names are different people", () => {
    assert.ok(!sameName(tokens("John A Smith"), tokens("John B Smith")));
    // Real case: these two are different people (their ORCIDs differed too)
    assert.ok(!sameName(tokens("Daniel Bo Yuan Park"), tokens("Daniel F. Park")));
  });

  test("different surname or given name", () => {
    assert.ok(!sameName(tokens("Kenji Fujita"), tokens("Kenji Tanaka")));
    assert.ok(!sameName(tokens("Kenji Fujita"), tokens("Akira Fujita")));
  });

  test("empty never matches", () => {
    assert.ok(!sameName([], tokens("Kenji Fujita")));
  });
});

describe("mergeMap", () => {
  test("merges a split profile", () => {
    const got = mergeMap([
      { id: "A2", name: "Maria K. Lindqvist", orcid: null },
      { id: "A1", name: "Maria K Lindqvist", orcid: null },
    ]);
    assert.deepEqual(new Set(got.keys()), new Set(["A1", "A2"]));
    assert.equal(new Set(got.values()).size, 1);
  });

  test("conflicting ORCIDs are never merged", () => {
    // Same name but different ORCIDs = different people (a case hit on real data, with the
    // names changed)
    const got = mergeMap([
      { id: "A1", name: "Paul Meyer", orcid: "https://orcid.org/0000-0001-0000-0001" },
      { id: "A2", name: "Paul Meyer", orcid: "https://orcid.org/0000-0001-0000-0002" },
    ]);
    assert.equal(got.size, 0);
  });

  test("the same ORCID merges", () => {
    const got = mergeMap([
      { id: "A1", name: "Maria K Lindqvist", orcid: "https://orcid.org/0000-0002-1825-0097" },
      { id: "A2", name: "Maria K. Lindqvist", orcid: "0000-0002-1825-0097" },
    ]);
    assert.equal(new Set(got.values()).size, 1);
  });

  test("appearing on the same paper means different people", () => {
    const together = new Set(["A1|A2", "A2|A1"]);
    const got = mergeMap(
      [
        { id: "A1", name: "Jordan Lee", orcid: null },
        { id: "A2", name: "Jordan Lee", orcid: null },
      ],
      (a, b) => together.has(`${a}|${b}`),
    );
    assert.equal(got.size, 0);
  });

  test("an ORCID conflict is checked across the whole group", () => {
    // A (no ORCID) could pair with either B or C, but B and C have different ORCIDs.
    const got = mergeMap([
      { id: "A", name: "Alex Kim", orcid: null },
      { id: "B", name: "Alex Kim", orcid: "https://orcid.org/0000-0001-0000-0003" },
      { id: "C", name: "Alex Kim", orcid: "https://orcid.org/0000-0001-0000-0004" },
    ]);
    assert.ok(got.size <= 2, "must not merge all three into one person");
    assert.ok(new Set(got.values()).size <= 1);
  });

  test("rank receives the record, not the id", () => {
    const seen: unknown[] = [];
    const got = mergeMap(
      [
        { id: "A1", name: "Ana Silva", orcid: null, works: 3 },
        { id: "A2", name: "Ana M. Silva", orcid: null, works: 40 },
      ],
      undefined,
      (person) => {
        seen.push(person);
        return [person.works, person.id];
      },
    );
    assert.ok(seen.every((p) => typeof p === "object" && p !== null));
    // The record with more papers becomes canonical
    assert.deepEqual(new Set(got.values()), new Set(["A2"]));
  });

  test("the result is stable", () => {
    const people = [
      { id: "A2", name: "Maria K. Lindqvist", orcid: null },
      { id: "A1", name: "Maria K Lindqvist", orcid: null },
      { id: "A3", name: "Maria K Lindqvist", orcid: null },
    ];
    assert.deepEqual(mergeMap(people), mergeMap([...people].reverse()));
  });

  test("unrelated people are left alone", () => {
    const got = mergeMap([
      { id: "A1", name: "Kenji Fujita", orcid: null },
      { id: "A2", name: "Maria Lindqvist", orcid: null },
    ]);
    assert.equal(got.size, 0);
  });
});
