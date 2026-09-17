/** Does it produce the same sequences as Python's random? The expected values were
 *  generated with Python 3.12.10.
 *
 *  If they drift, research groups come out differently from the server version (groups.ts).
 *
 *    npm test */

import assert from "node:assert/strict";
import { test } from "node:test";
import { labelPropagation } from "./groups.ts";
import { PyRandom } from "./pyrandom.ts";

test("the same 32-bit numbers as random.Random(0)", () => {
  const r = new PyRandom(0);
  assert.deepEqual(
    Array.from({ length: 6 }, () => r.getrandbits(32)),
    [3626764237, 1654615998, 3255389356, 3823568514, 1806341205, 173879092],
  );
  const s = new PyRandom(12345);
  assert.deepEqual(
    Array.from({ length: 3 }, () => s.getrandbits(32)),
    [1789368711, 3146859322, 43676229],
  );
});

test("shuffle, choice and randbelow match", () => {
  const x = Array.from({ length: 12 }, (_, i) => i);
  new PyRandom(0).shuffle(x);
  assert.deepEqual(x, [1, 9, 8, 5, 10, 2, 3, 7, 4, 0, 11, 6]);

  const c = new PyRandom(0);
  assert.deepEqual(
    Array.from({ length: 12 }, () => c.choice([3, 1, 4, 1, 5, 9, 2, 6])),
    [2, 2, 3, 5, 6, 2, 5, 6, 9, 1, 4, 5],
  );

  const b = new PyRandom(0);
  assert.deepEqual(
    [1, 2, 3, 7, 100, 1000, 65536, 5, 5, 5].map((n) => b.randbelow(n)),
    [0, 1, 0, 2, 65, 497, 53075, 2, 3, 2],
  );
});

test("label propagation gives the same groups as groups.py", () => {
  const edges = [
    ["a", "b"], ["b", "c"], ["c", "a"], ["c", "d"], ["d", "e"], ["e", "f"], ["f", "d"],
    ["h", "a"], ["h", "e"], ["i", "j"], ["j", "k"], ["k", "i"], ["k", "l"], ["l", "m"],
    ["m", "k"], ["b", "e"],
  ];
  const adj = new Map<string, Set<string>>([..."abcdefghijklm"].map((n) => [n, new Set()]));
  for (const [s, t] of edges) {
    adj.get(s)!.add(t);
    adj.get(t)!.add(s);
  }
  assert.deepEqual(Object.fromEntries(labelPropagation(adj)), {
    a: 4, b: 4, c: 4, d: 4, e: 4, f: 4, g: 6, h: 4, i: 9, j: 9, k: 9, l: 9, m: 9,
  });
});
