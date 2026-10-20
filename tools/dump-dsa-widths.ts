/**
 * The DSA's integer widths, each run through a test DSA (`tools/lib/dsa.ts`):
 *
 * 1. **`&*`** multiplies two `i32`s, which wraps (`doc/CSBwin-src/DSA.cpp:2534-2540`):
 *    0x7fffffff squared is 1.
 * 2. **`&RANDOM`** is `(ui32)STRandom() % V` with `ui32 V` (`:2721-2733`): of -1, the
 *    draw itself, which the same seed's first draw gives.
 * 3. **The state written back**: `PutState` runs whatever `Execute` returned
 *    (`:5463-5464`), and a DSA's own state is `(ui16)` (`Data.h:2483`): a program whose
 *    next state is -1 leaves the DSA in 0xffff.
 * 4. **`CASE`** binary-searches its table in unsigned order (`:1005-1031`): a value given
 *    twice jumps where the search lands, the second, not the first.
 *
 * Run: `npm test -- --only=dump-dsa-widths.ts`
 */
import { CsbRandom } from '../src/core/random';
import { StkOp } from '../src/engine/dsa/DsaTypes';
import { check, finish } from './lib/check';
import { globalStore, int, next, op, run } from './lib/dsa';

/** `DSACMD_CASE` (`doc/CSBwin-src/Data.h:1727`). */
const CASE = 16;
const SEED = 0x2468;

{
  const { g } = run([...int(0x7fffffff), ...int(0x7fffffff), op(StkOp.GEAR), globalStore(0)]);
  console.log(`1. &* of 0x7fffffff and 0x7fffffff: ${g[0]}`);
  check(g[0] === 1, 'the product wraps as an i32: 1');
}

{
  const { g } = run([...int(-1), op(StkOp.RANDOM), globalStore(0)], (game) => game.setRandomSeed(SEED));
  const draw = new CsbRandom(SEED).next() >>> 0;
  console.log(`2. &RANDOM of -1: ${g[0]}, the draw ${draw}`);
  check(g[0] === ((draw % 0xffffffff) | 0) && g[0] !== 0, 'the divisor is unsigned: the draw itself');
}

{
  const { game } = run([next(-1)]);
  const state = game.ctx.dungeon.getData().dsaIndex!.entries[0]!.state;
  console.log(`3. a next state of -1: the DSA's state ${state}`);
  check(state === 0xffff, 'is put, as a ui16: 0xffff');
}

{
  // Column 0 switches on 3, a value given twice: to column 1, then to column 2.
  const r = run([...int(0), globalStore(1)]);
  const dsa = r.game.ctx.dungeon.getData().dsaIndex!.entries[0]!;
  const target = (column: number): number[] => [column & 0xffff, 0];
  dsa.states[0]!.actions = [
    { column: 0, program: Uint16Array.from([...int(3), CASE, 2, 3, 0, ...target(1), 3, 0, ...target(2)]) },
    { column: 1, program: Uint16Array.from([...int(1), globalStore(0)]) },
    { column: 2, program: Uint16Array.from([...int(2), globalStore(0)]) },
  ];
  dsa.state = 0;
  const g = r.again();
  console.log(`4. CASE of 3 over [3 -> column 1, 3 -> column 2]: column ${g[0]}`);
  check(g[0] === 2, 'the binary search lands on the second');
}

finish();
