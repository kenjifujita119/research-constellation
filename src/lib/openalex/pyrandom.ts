/** A copy of Python's random.Random that gives the same sequence from the same seed.
 *
 *  Research groups (groups.ts) come from label propagation, which breaks ties with a
 *  fixed-seed random number. With Math.random or any other generator the groups would
 *  differ from the server version's, and a person's "own group" would depend on where
 *  it was built.
 *
 *  Ported directly from Python 3.12's implementation (the Mersenne Twister in
 *  Modules/_randommodule.c, and _randbelow, shuffle and choice in Lib/random.py).
 *  pyrandom.test.ts checks that the sequences match Python's output. */

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER = 0x80000000;
const LOWER = 0x7fffffff;

export class PyRandom {
  private mt = new Uint32Array(N);
  private mti = N + 1;

  /** Same as random.Random(seed). seed is a non-negative integer. */
  constructor(seed: number) {
    // An integer seed reaches init_by_array as an array of 32-bit chunks, lowest first.
    // 0 becomes [0].
    const key: number[] = [];
    let n = Math.abs(Math.trunc(seed));
    while (n > 0) {
      key.push(n % 0x100000000);
      n = Math.floor(n / 0x100000000);
    }
    this.initByArray(key.length ? key : [0]);
  }

  private initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.mti = N;
  }

  private initByArray(key: number[]): void {
    this.initGenrand(19650218);
    const mt = this.mt;
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
    }
    mt[0] = UPPER; // so the initial state is never all zeros
  }

  /** genrand_uint32. */
  private next(): number {
    const mt = this.mt;
    if (this.mti >= N) {
      let kk = 0;
      let y: number;
      for (; kk < N - M; kk++) {
        y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER);
        mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      for (; kk < N - 1; kk++) {
        y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER);
        mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      y = (mt[N - 1] & UPPER) | (mt[0] & LOWER);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      this.mti = 0;
    }
    let y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** getrandbits(k). Only up to 32 bits is needed here. */
  getrandbits(k: number): number {
    if (k <= 0) return 0;
    if (k > 32) throw new Error("PyRandom.getrandbits handles at most 32 bits");
    return this.next() >>> (32 - k);
  }

  /** _randbelow_with_getrandbits. 0 <= r < n. n must be at least 1. */
  randbelow(n: number): number {
    const k = 32 - Math.clz32(n); // n.bit_length()
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** random.shuffle. Shuffles in place. */
  shuffle<T>(x: T[]): void {
    for (let i = x.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      [x[i], x[j]] = [x[j], x[i]];
    }
  }

  /** random.choice. */
  choice<T>(seq: T[]): T {
    if (!seq.length) throw new Error("Cannot choose from an empty sequence");
    return seq[this.randbelow(seq.length)];
  }
}
