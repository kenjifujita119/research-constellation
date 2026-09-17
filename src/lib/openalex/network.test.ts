/** How split author records are folded. Ported from the original Python tests
 *  (apps/api/tests/test_collapse.py, not included here).
 *
 *  Mixing up what can be summed and what cannot breaks the numbers silently. The bug we
 *  actually hit was "when the canonical record comes later, its own values are added
 *  twice", which doubled the paper counts of Kenji's co-authors.
 *
 *    npm test */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { absorb, collapse, collapseSplitRecords, type NetGraph, type NetNode } from "./network.ts";

/** Write only the fields a test needs; the rest are filled with empty values. */
function node(fields: Partial<NetNode> & { id: string }): NetNode {
  return {
    orcid: null,
    name: null,
    hop: 1,
    works_count: 0,
    cited_by_count: 0,
    h_index: null,
    i10_index: null,
    active_from: null,
    active_to: null,
    topics: [],
    topic_vector: {},
    counts_by_year: [],
    institution: null,
    institution_id: null,
    country: null,
    ror: null,
    ...fields,
  };
}

const person = (id: string, name: string, rest: Partial<NetNode> = {}) =>
  node({ id, name, hop: 1, ...rest });

describe("collapse", () => {
  test("adds what can be added", () => {
    const out = collapse(
      [
        person("A1", "Maria K. Lindqvist", { works_count: 400, cited_by_count: 9000, collab_with_ego: 15 }),
        person("A2", "Maria K Lindqvist", { works_count: 3, cited_by_count: 10, collab_with_ego: 1 }),
      ],
      new Map([["A1", "A1"], ["A2", "A1"]]),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].works_count, 403);
    assert.equal(out[0].cited_by_count, 9010);
    assert.equal(out[0].collab_with_ego, 16);
  });

  test("h index is the maximum, not the sum", () => {
    const out = collapse(
      [
        person("A1", "Maria K. Lindqvist", { h_index: 73, i10_index: 300 }),
        person("A2", "Maria K Lindqvist", { h_index: 1, i10_index: 0 }),
      ],
      new Map([["A1", "A1"], ["A2", "A1"]]),
    );
    assert.equal(out[0].h_index, 73);
    assert.equal(out[0].i10_index, 300);
  });

  test("the canonical record is not counted twice", () => {
    // No double counting even when the canonical record comes later. This used to double.
    const out = collapse(
      [person("B", "Maria K Lindqvist", { works_count: 3 }), person("A", "Maria K. Lindqvist", { works_count: 400 })],
      new Map([["A", "A"], ["B", "A"]]),
    );
    assert.equal(out[0].works_count, 403);
  });

  test("keeps the canonical name and affiliation", () => {
    const out = collapse(
      [
        person("B", "Ana Silva", { institution: "Elsewhere", works_count: 2 }),
        person("A", "Ana M. Silva", { institution: "The University of Sydney", works_count: 40 }),
      ],
      new Map([["A", "A"], ["B", "A"]]),
    );
    assert.equal(out[0].name, "Ana M. Silva");
    assert.equal(out[0].institution, "The University of Sydney");
  });

  test("takes the nearer hop", () => {
    const out = collapse(
      [node({ id: "A", name: "X Y", hop: 2 }), node({ id: "B", name: "X Y", hop: 1 })],
      new Map([["A", "A"], ["B", "A"]]),
    );
    assert.equal(out[0].hop, 1);
  });

  test("widens the active span", () => {
    const out = collapse(
      [
        person("A", "X Y", { active_from: 2010, active_to: 2020 }),
        person("B", "X Y", { active_from: 2005, active_to: 2026 }),
      ],
      new Map([["A", "A"], ["B", "A"]]),
    );
    assert.equal(out[0].active_from, 2005);
    assert.equal(out[0].active_to, 2026);
  });

  test("keeps order and leaves others alone", () => {
    const out = collapse(
      [person("A", "X Y"), person("C", "Someone Else"), person("B", "X Y")],
      new Map([["A", "A"], ["B", "A"]]),
    );
    assert.deepEqual(out.map((n) => n.id), ["A", "C"]);
  });
});

describe("absorb", () => {
  test("sums counts by year", () => {
    const into = node({ id: "A", counts_by_year: [{ year: 2024, works_count: 5 }] });
    absorb(into, node({ id: "B", counts_by_year: [{ year: 2024, works_count: 2 }, { year: 2023, works_count: 1 }] }));
    assert.deepEqual(into.counts_by_year, [
      { year: 2024, works_count: 7 },
      { year: 2023, works_count: 1 },
    ]);
  });

  test("unions shared topics and dedupes shared works", () => {
    const w = (id: string) => ({ id, title: null, year: null, doi: null, cited_by_count: 0 });
    const into = node({ id: "A", shared_topics: ["T1"], shared_works: [w("W1")] });
    absorb(into, node({ id: "B", shared_topics: ["T2", "T1"], shared_works: [w("W1"), w("W2")] }));
    assert.deepEqual(into.shared_topics, ["T1", "T2"]);
    assert.deepEqual(into.shared_works!.map((x) => x.id), ["W1", "W2"]);
  });

  test("sums recommendation evidence", () => {
    // If merging lost evidence, the recommendation ranking would drop for no reason.
    const into = node({ id: "A", evidence: { cocite: 10 }, evidence_by_topic: { T1: { cocite: 5 } } });
    absorb(into, node({ id: "B", evidence: { cocite: 3, cites_me: 1 }, evidence_by_topic: { T1: { cocite: 2 } } }));
    assert.deepEqual(into.evidence, { cocite: 13, cites_me: 1 });
    assert.deepEqual(into.evidence_by_topic, { T1: { cocite: 7 } });
  });

  test("keeps an ORCID from either record", () => {
    const into = node({ id: "A", orcid: null });
    absorb(into, node({ id: "B", orcid: "https://orcid.org/0000-0002-1825-0097" }));
    assert.equal(into.orcid, "https://orcid.org/0000-0002-1825-0097");
  });
});

describe("collapseSplitRecords", () => {
  const graph = (): NetGraph => ({
    ego: "E",
    nodes: [
      node({ id: "E", name: "Kenji Fujita", hop: 0 }),
      node({ id: "A", name: "Maria K. Lindqvist", hop: 1, works_count: 400 }),
      node({ id: "B", name: "Maria K Lindqvist", hop: 1, works_count: 3 }),
      node({ id: "C", name: "Someone Else", hop: 1, works_count: 10 }),
    ],
    links: [
      { source: "E", target: "A", weight: 15 },
      { source: "E", target: "B", weight: 1 },
      { source: "A", target: "C", weight: 2 },
      { source: "B", target: "C", weight: 3 },
    ],
    ego_works: [],
    meta: {} as NetGraph["meta"],
  });

  test("folds nodes and merges links", () => {
    const g = graph();
    assert.equal(collapseSplitRecords(g), 1);
    assert.deepEqual(g.nodes.map((n) => n.id), ["E", "A", "C"]);
    const weights = new Map(g.links.map((l) => [[l.source, l.target].sort().join("-"), l.weight]));
    assert.equal(weights.get("A-E"), 16); // E-A and E-B become one edge, and the weights are added
    assert.equal(weights.get("A-C"), 5);
  });

  test("drops self loops", () => {
    const g = graph();
    g.links.push({ source: "A", target: "B", weight: 9 });
    collapseSplitRecords(g);
    assert.ok(g.links.every((l) => l.source !== l.target));
  });

  test("a shared paper keeps them apart", () => {
    // An edge means they wrote together = different people
    const g = graph();
    g.links.push({ source: "A", target: "B", weight: 1 });
    assert.equal(collapseSplitRecords(g), 0);
    assert.equal(g.nodes.length, 4);
  });

  test("introducers follow the record they were folded into", () => {
    // If an introducer keeps pointing at the folded-away id, the page cannot look them up
    // and drops them from the introduction path. Point it at the canonical record, and
    // add the paper counts when two ids turn out to be the same person.
    const g = graph();
    g.nodes.push(
      node({
        id: "X",
        name: "Chris O'Neill",
        hop: 2,
        bridges: [
          { id: "B", name: "Maria K Lindqvist", weight: 2 },
          { id: "A", name: "Maria K. Lindqvist", weight: 1 },
          { id: "C", name: "Someone Else", weight: 4 },
        ],
      }),
    );
    collapseSplitRecords(g);
    const x = g.nodes.find((n) => n.id === "X")!;
    assert.deepEqual(x.bridges, [
      { id: "C", name: "Someone Else", weight: 4 },
      { id: "A", name: "Maria K. Lindqvist", weight: 3 },
    ]);
  });

  test("the ego is never folded away", () => {
    const g = graph();
    g.nodes.push(node({ id: "E2", name: "Kenji Fujita", hop: 1, works_count: 1 }));
    collapseSplitRecords(g);
    assert.ok(g.nodes.some((n) => n.id === "E" && n.hop === 0));
  });
});
