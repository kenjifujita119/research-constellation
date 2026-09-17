/** How identifiers are handled, and what running work in batches guarantees. Does not
 *  call OpenAlex.
 *
 *    npm test */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { OpenAlexClient, normaliseOrcid, shortId } from "./client.ts";

describe("normaliseOrcid", () => {
  test("accepts the forms people paste", () => {
    const want = "0000-0001-7876-6004";
    assert.equal(normaliseOrcid("0000-0001-7876-6004"), want);
    assert.equal(normaliseOrcid("https://orcid.org/0000-0001-7876-6004"), want);
    assert.equal(normaliseOrcid(" 0000000178766004 "), want);
    assert.equal(normaliseOrcid("0000-0002-1825-009x"), "0000-0002-1825-009X");
  });

  test("rejects the wrong length", () => {
    assert.throws(() => normaliseOrcid("0000-0001-7876"));
  });
});

test("shortId keeps the last path segment", () => {
  assert.equal(shortId("https://openalex.org/A5050356914"), "A5050356914");
  assert.equal(shortId("W123"), "W123");
});

describe("each", () => {
  test("returns results in input order, whatever finishes first", async () => {
    const client = new OpenAlexClient({ workers: 3 });
    const got = await client.each([30, 5, 20, 1], async (ms) => {
      await new Promise((done) => setTimeout(done, ms));
      return ms;
    });
    assert.deepEqual(got, [30, 5, 20, 1]);
  });

  test("stops handing out work after a failure", async () => {
    // If other batches kept querying after the free allowance ran out, they would
    // spend the user's allowance on failures.
    const client = new OpenAlexClient({ workers: 1 });
    const started: number[] = [];
    await assert.rejects(
      client.each([1, 2, 3, 4], async (n) => {
        started.push(n);
        if (n === 2) throw new Error("budget");
        return n;
      }),
      /budget/,
    );
    assert.deepEqual(started, [1, 2]);
  });
});
