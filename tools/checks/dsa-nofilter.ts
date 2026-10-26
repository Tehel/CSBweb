/**
 * `NOFILTER` (`doc/CSBwin-src/DSA.cpp:463`): an operation that changes the dungeon, run by
 * a filter's DSA, says "Filter Modifying Dungeon" (`NoFilter`, `:458-461`), and does what
 * it does all the same. Each operation below runs as the one DSA of the cursor filter
 * (`CursorFilter`, `MoveObject.cpp:797-858`), whose runs are a filter's, and as an
 * ordinary DSA's program, against a genuine save (`csbgame7.dat`). Its operands make it
 * do nothing once past the check: an empty hand to `&DEL`, a full one to `&ADD`, a
 * location off the dungeon, a source type of 0, an object copied onto itself.
 *
 * 1. **As a filter's DSA**, it says it once.
 * 2. **As any other DSA**, it says nothing.
 *
 * Run: `npm test -- --only=dsa-nofilter.ts`
 */
import { DBType, OBJECT_ID_NULL } from '../../src/core/types';
import { CursorFilterType, StkOp } from '../../src/engine/dsa/DsaTypes';
import type { Game } from '../../src/engine/Game';
import { freshGame, int, op, run, withFilterDsas } from '../lib/dsa';
import { check, finish } from '../lib/check';

/** `ESL_CURSORFILTER` (`doc/CSBwin-src/CSB.h:1547`). */
const ESL_CURSORFILTER = 9;
const SAID = 'Filter Modifying Dungeon';

/** The save's first misc object, the same RN in every game on it. */
const MISC = freshGame().ctx.dungeon.rnMaps.rn(DBType.MISC, 0);

/** The operation, its operands pushed in order, and whether the hand holds `MISC`. */
const OPERATIONS: Array<{ name: string; cite: string; words: number[]; handFull?: boolean }> = [
  { name: '&DEL', cite: ':1655', words: [...int(0), ...int(-1), op(StkOp.DEL)] },
  { name: '&ADD', cite: ':1979', words: [...int(0), ...int(-1), ...int(0), op(StkOp.ADD)], handFull: true },
  { name: '&CELL!', cite: ':3849', words: [...int(-1), ...int(0), ...int(1), op(StkOp.CELL_STORE)] },
  { name: '&TELEPORT', cite: ':4594', words: [...int(-1), op(StkOp.TELEPORT_PARTY)] },
  { name: '&MOVE', cite: ':4685', words: [...Array.from({ length: 10 }, () => int(0)).flat(), op(StkOp.MOVE)] },
  { name: '&COPY', cite: ':4708', words: [...int(MISC), ...int(MISC), op(StkOp.COPY)] },
];

const count = (lines: string[]): number => lines.filter((line) => line === SAID).length;

for (const { name, cite, words, handFull } of OPERATIONS) {
  const hand = (game: Game): void => { game.ctx.party.state.objectInHand = handFull ? MISC : OBJECT_ID_NULL; };

  const filterSaid: string[] = [];
  const game = withFilterDsas(ESL_CURSORFILTER, [words], { trace: (line) => { filterSaid.push(line); } });
  hand(game);
  game.systems.dsa.filters.cursorFilter({ object: OBJECT_ID_NULL, type: CursorFilterType.Unknown, p1: 0, p2: 0, p3: 0, p4: 0 });

  const plainSaid: string[] = [];
  run(words, (g) => {
    g.ctx.host.trace = (line) => { plainSaid.push(line); };
    hand(g);
  });

  console.log(`${name} (DSA.cpp${cite}): as the filter's, ${count(filterSaid)}; as a DSA's, ${count(plainSaid)}`);
  check(count(filterSaid) === 1, `1. ${name}, a filter's, says "${SAID}" once`);
  check(count(plainSaid) === 0, `2. ${name}, any other DSA's, says nothing`);
}

finish();
