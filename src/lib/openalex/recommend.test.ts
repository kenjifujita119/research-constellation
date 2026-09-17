/** Does the rounding match Python's round()?
 *
 *  Recommendations are sorted by the rounded score, so a different rounding rule reorders
 *  ties. The expected values were produced with Python 3.12.10.
 *
 *    npm test */

import assert from "node:assert/strict";
import { test } from "node:test";
import { pyRound } from "./recommend.ts";

// [x, digits, Python's round(x, digits)]
const CASES: [number, number, number][] = [
  [0.125, 2, 0.12], // an exact half goes to even
  [0.375, 2, 0.38],
  [0.0005, 3, 0.001], // as a double, slightly above half
  [2.675, 2, 2.67], // as a double, slightly below half
  [1.0005, 3, 1.0],
  [0.5, 0, 0],
  [1.5, 0, 2],
  [2.5, 0, 2],
  [0.45, 1, 0.5],
  [-0.125, 2, -0.12],
  [0.28445, 4, 0.2844],
  [0.123456789, 4, 0.1235],
  [1 / 3, 3, 0.333],
  [2 / 3, 3, 0.667],
  [0.8125, 3, 0.812],
  [0.0625, 3, 0.062],
  [12.34565, 4, 12.3456],
  [0.999999, 3, 1.0],
];

test("pyRound matches Python's round()", () => {
  for (const [x, digits, want] of CASES) {
    assert.equal(pyRound(x, digits), want, `round(${x}, ${digits})`);
  }
});
