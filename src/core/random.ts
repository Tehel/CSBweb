/**
 * CSBWin's random number generator.
 *
 * A plain 32-bit LCG — `seed = seed * 0xbb40e62d + 11` — whose callers read bits 8
 * and up (`doc/CSBwin-src/CSBCode.cpp:1192-1227`). The seed lives in game state as
 * `d.RandomNumber`, is initialised from the host `rand()`
 * (`doc/CSBwin-src/CSBCode.cpp:361`) and is round-tripped through save games as
 * `gb2.ranseed` (`doc/CSBwin-src/SaveGame.cpp:1750`).
 *
 * This exists rather than `Math.random()` for one reason: the monster AI consumes
 * randomness pervasively and in a fixed order, so reproducing CSBWin's sequence is
 * what makes an AI trace comparable between the two codebases at all. It is also
 * what makes a seeded run repeatable.
 *
 * The three draw functions are **not** interchangeable. Each advances the seed
 * exactly once, and which bits it then takes differs, so substituting one for
 * another desynchronises the stream from CSBWin's even when the value looks right.
 *
 * CSBWin keeps a second, separate stream for the viewport: `DrawViewport` saves
 * `d.RandomNumber`, swaps in `viewportRandom`, and restores it afterwards so that
 * drawing "doesn't upset the game" (`doc/CSBwin-src/Viewport.cpp:6713-6714`). Any
 * render-time randomness therefore belongs in its own `CsbRandom` instance, never in
 * the game one.
 */

const MULTIPLIER = 0xbb40e62d;
const INCREMENT = 11;

export class CsbRandom {
  /** `d.RandomNumber`. Held as an unsigned 32-bit value, or null until first use. */
  private seed: number | null;

  /**
   * With no seed given the stream picks one on **first draw**, not here. CSBWin
   * seeds at initialisation from the host `rand()`, and nothing observable depends
   * on when the seed is chosen — but drawing it eagerly would consume a
   * `Math.random()` value at construction, which perturbs anything else sharing
   * that generator (`tools/probe-frames.mjs` overrides `Math.random` to make the
   * golden frames reproducible, and would shift by one).
   */
  constructor(seed?: number) {
    this.seed = seed === undefined ? null : seed >>> 0;
  }

  /** The current seed, choosing one first if the stream has not been used yet. */
  getSeed(): number {
    if (this.seed === null) this.seed = (Math.random() * 0x100000000) >>> 0;
    return this.seed;
  }

  setSeed(seed: number): void {
    this.seed = seed >>> 0;
  }

  /**
   * Advance the seed. `Math.imul` gives the low 32 bits of the product, which is
   * exactly the C++ `ui32` multiply; a plain `*` would lose precision past 2^53.
   */
  private advance(): number {
    this.seed = (Math.imul(this.getSeed(), MULTIPLIER) + INCREMENT) >>> 0;
    return this.seed;
  }

  /** `STRandom(void)` — 24 bits (`doc/CSBwin-src/CSBCode.cpp:1192`). */
  next(): number {
    return (this.advance() >>> 8) & 0xffffff;
  }

  /**
   * `STRandom(num)` — `(STRandom() & 0xffff) % num`, masked to 16 bits before the
   * modulo "to be exactly like Atari" (`doc/CSBwin-src/CSBCode.cpp:1204`). CSBWin
   * returns 0 for `num == 0` rather than dividing by zero.
   */
  below(num: number): number {
    if (num === 0) return 0;
    return (this.next() & 0xffff) % num;
  }

  /** `STRandomBool()` — one bit (`doc/CSBwin-src/CSBCode.cpp:1211`). */
  bool(): number {
    return (this.advance() >>> 8) & 1;
  }

  /** `STRandom0_3()` — two bits (`doc/CSBwin-src/CSBCode.cpp:1221`). */
  zeroTo3(): number {
    return (this.advance() >>> 8) & 3;
  }
}
