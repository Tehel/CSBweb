/**
 * Where the DSA stops, each run through a test DSA (`tools/lib/dsa.ts`):
 *
 * 1. **An unknown command** says "Unknown DSA command code" and returns the state the run
 *    is in (`doc/CSBwin-src/DSA.cpp:5263-5265`): nothing after it runs, its operands not
 *    read as commands, and the DSA stays in that state.
 * 2. **The stack** holds 100 values and `die`s on an overflow (`0xdcd6`), an underflow
 *    (`0xdcd7`), a pick or a poke past the bottom (`0xdcdb`) and a roll past it (`0xdcda`)
 *    (`:370-424`), an underflow saying where (`constructDebugMessage`, `:278-289`).
 *
 * Run: `npm test -- --only=dsa-limits.ts`
 */
import { Die } from '../../src/core/Die';
import { StkOp } from '../../src/engine/dsa/DsaTypes';
import { check, finish } from '../lib/check';
import { globalStore, int, op, run, UNSET } from '../lib/dsa';

/** A command code no `DSACMD` names (`doc/CSBwin-src/Data.h:1715-1738`). */
const UNKNOWN = 10;

{
  const { g, game } = run([UNKNOWN, ...int(5), globalStore(0)]);
  const state = game.ctx.dungeon.getData().dsaIndex!.entries[0]!.state;
  console.log(`1. an unknown command, then LOAD 5, GV0!: GV0 ${g[0] === UNSET ? 'unset' : g[0]}, the state ${state}`);
  check(g[0] === UNSET, 'nothing after an unknown command runs');
  check(state === 0, 'and the DSA stays in the state it was in');
}

/** The `die` a program ends the game with, or null. */
function dies(words: number[]): Die | null {
  try {
    run(words);
  } catch (error) {
    if (error instanceof Die) return error;
    throw error;
  }
  return null;
}

console.log('2. the stack');
for (const [what, words, code] of [
  ['101 pushes', Array.from({ length: 101 }, () => int(1)).flat(), 0xdcd6],
  ['a pop of nothing', [globalStore(0)], 0xdcd7],
  ['a pick past the bottom', [...int(1), ...int(5), op(StkOp.PICK)], 0xdcdb],
  ['a poke past the bottom', [...int(9), ...int(5), op(StkOp.POKE)], 0xdcdb],
  ['a roll past the bottom', [...int(1), ...int(3), op(StkOp.ROLL)], 0xdcda],
] as const) {
  const died = dies([...words]);
  console.log(`  ${what}: ${died ? JSON.stringify(died.message) : 'runs on'}`);
  check(died?.errorNum === code, `${what} dies with 0x${code.toString(16)}`);
}
check(dies([...int(7), ...int(0), op(StkOp.PICK), globalStore(0), globalStore(1)]) === null, 'a pick within the stack runs on');
const underflow = dies([globalStore(0)]);
check(underflow !== null && /DSA stack underflow\nDSA at \d+\(\d+,\d+\)\nRow=0;Col=0/.test(underflow.message),
  'an underflow says where the DSA is');

finish();
