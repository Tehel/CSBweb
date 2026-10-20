/**
 * `&CELL@` (`STKOP_CellFetch`, `doc/CSBwin-src/DSA.cpp:3678-3831`), run as the program of a
 * test DSA on a genuine save (`csbgame7.dat`), on squares of the party's level made a pit,
 * a false wall and a stone wall for the run.
 *
 * The array's variables are set to 0 before anything else (`Var(arrayIndex+j, 0)`,
 * `:3691-3694`), so they are well defined when the pit's and the false wall's bits go in
 * through `SetVarBit` (`:3768-3791`), which zeroes a variable that is not
 * (`DSA.cpp:144`). Their bits therefore read back as set, as a stone wall's do through
 * `Var(i, Var(i) | bit)` (`:3705-3721`), though the DSA never set the variables itself.
 *
 * Run: `npm test -- --only=dump-dsa-cell-fetch.ts`
 */
import { OBJECT_ID_EOF, Position, RoomType, locationRelToInteger } from '../src/core/types';
import { StkOp } from '../src/engine/dsa/DsaTypes';
import type { Game } from '../src/engine/Game';
import { globalStore, int, op, run, varFetch } from './lib/dsa';
import { check, finish } from './lib/check';

/** The squares made for the run, and the cell flags each gets: room type, then its bits. */
const SQUARES = [
  { name: 'pit', flags: (RoomType.PIT << 5) | 0x0d, expected: 0x0d },
  { name: 'false wall', flags: (RoomType.FALSEWALL << 5) | 0x05, expected: 0x05 },
  { name: 'stone wall', flags: (RoomType.STONE << 5) | 0x0f, expected: 0x0f },
];
/** The array `&CELL@` fills: variables 40 and 41, which nothing sets before. */
const ARRAY = 40;

/** `count` empty open squares of the party's level other than `at`. */
function emptySquares(game: Game, at: Position, count: number): Position[] {
  const dungeon = game.ctx.dungeon;
  const map = dungeon.getMap(at.z)!;
  const out: Position[] = [];
  for (let x = 0; x < map.descriptor.width && out.length < count; x++) {
    for (let y = 0; y < map.descriptor.height && out.length < count; y++) {
      const p = new Position(x, y, at.z);
      if (p.x === at.x && p.y === at.y) continue;
      if (((dungeon.getCellFlag(p) >> 5) & 7) !== RoomType.OPEN) continue;
      if (dungeon.findFirstObject(p) !== OBJECT_ID_EOF) continue;
      out.push(p);
    }
  }
  return out;
}

let squares: Position[] = [];
const { g } = run(
  (_game, at) => SQUARES.flatMap((_, i) => [
    ...int(locationRelToInteger({ l: at.z, x: squares[i]!.x, y: squares[i]!.y, p: 0 })),
    ...int(ARRAY + 2 * i), ...int(2), op(StkOp.CELL_FETCH),
    varFetch(ARRAY + 2 * i), globalStore(2 * i), varFetch(ARRAY + 2 * i + 1), globalStore(2 * i + 1),
  ]),
  (game, at) => {
    squares = emptySquares(game, at, SQUARES.length);
    const map = game.ctx.dungeon.getMap(at.z)!;
    SQUARES.forEach(({ flags }, i) => { map.cellFlags[squares[i]!.x]![squares[i]!.y] = flags; });
  },
);

console.log(['square', 'cell flags', 'room type', 'bits'].join('\t'));
SQUARES.forEach(({ name, flags, expected }, i) => {
  const roomType = g[2 * i]!;
  const bits = g[2 * i + 1]!;
  console.log([name, `0x${flags.toString(16)}`, roomType, `0x${bits.toString(16)}`].join('\t'));
  check(roomType === flags >> 5, `${name}: the room type`);
  check(bits === expected, `${name}: its bits read as set, the variable never set by the DSA`);
});

finish();
