/**
 * `GraphicRandom`'s LCG (`doc/CSBwin-src/CSBCode.cpp:574`), against an exact oracle.
 *
 * `r = r * ui32(0xbb40e62d) + 11;` is a free 32-bit-wraparound multiply in C. Plain
 * JS `*` is not: both operands run up to ~2^32, so their exact product needs up to
 * 64 bits and a float64 mantissa only holds 53 — the multiply silently rounds away
 * low bits before `>>> 0` ever sees them. The port's `GraphicRandom` used
 * to do exactly that, and the bits it lost were exactly the ones `>>> 7 % n` reads:
 * every state the LCG could reach turned out to be a multiple of 4096, so `% 32` and
 * `% 2` always came out 0. The teleporter/energy shimmer's row jitter and the
 * cloud mirror-flip (which has since moved to the viewport stream, as CSBWin has it —
 * `tools/checks/cloud-draw.ts`) were both permanently frozen at their
 * zero value — a redraw every tick, always painting the identical pixels. Nothing
 * about the tick loop or the caching was wrong; this is invisible on any single
 * frame and only shows up as a sequence, which is why it needed its own tool rather
 * than a golden frame.
 *
 * This drives the real implementation and a BigInt oracle (exact by construction,
 * no float64 involved) from several seeds and checks every step agrees, then checks
 * the specific failure mode directly: across 64 draws from the seed the module starts
 * at, `% 32` must not be the same value every time.
 *
 * Run: `npm test -- --only=graphic-random.ts`
 */
import { GraphicRandom, graphicRandomState } from '../../src/renderer/bytecode/DrawDoor';
import { check, finish } from '../lib/check';

const MULTIPLIER = 0xbb40e62dn;
const INCREMENT = 11n;
const MASK32 = 0xffffffffn;

function oracleNext(state: bigint): bigint {
  return (state * MULTIPLIER + INCREMENT) & MASK32;
}

function resetGraphicRandomState(seed: number): void {
  graphicRandomState.r = seed;
}

function main(): void {
  console.log('=== the real implementation against an exact BigInt oracle ===');
  for (const seed of [12345, 1, 0, 0xffffffff, 0x9e3779b9]) {
    resetGraphicRandomState(seed);
    let oracle = BigInt(seed);
    let allMatch = true;
    for (let i = 0; i < 200; i++) {
      oracle = oracleNext(oracle);
      const got = GraphicRandom(1_000_000_003); // a modulus far bigger than any low-bit blind spot
      const want = Number(oracle >> 7n) % 1_000_000_003;
      if (got !== want) {
        allMatch = false;
        console.log(`  seed ${seed} step ${i}: got ${got}, oracle says ${want}`);
        break;
      }
    }
    check(allMatch, `seed ${seed}: 200 draws match the BigInt oracle exactly`);
  }

  console.log('');
  console.log('=== the specific failure mode: mod-32 must not be constant ===');
  resetGraphicRandomState(12345);
  const draws: number[] = [];
  for (let i = 0; i < 64; i++) draws.push(GraphicRandom(32));
  const distinctValues = new Set(draws).size;
  console.log(`64 draws of % 32 from the state the class starts at: ${distinctValues} distinct values`);
  console.log(draws.join(' '));
  check(distinctValues > 1, 'the sequence is not stuck on a single value (the exact pre-fix symptom)');
  check(distinctValues > 16, `varies across most of the 0..31 range (got ${distinctValues} distinct values)`);

  finish();
}

main();
