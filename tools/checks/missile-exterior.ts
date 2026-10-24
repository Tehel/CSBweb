/**
 * A missile flying off the map meets the exterior wall.
 *
 * When the cell a missile leaves its own for is off the map, `MissileTimer` makes its room
 * `roomEXTERIOR` (`doc/CSBwin-src/Timer.cpp:323-330`), which counts as stone (`:340`), so
 * the missile meets it through `ProcessMissileEncounter(roomEXTERIOR, …)` (`:351-364`).
 * That runs filter 6 (`Code11f52.cpp:1876-1878`) and goes on into the shared tail
 * (`:2079-2156`), where a spell becomes its cloud (`CreateCloud`, `:2134`) in the square it
 * was flying from.
 *
 * This finds an open square on a map's border, flies a fireball out of it over the edge,
 * and looks for the filter, the fireball's cloud in that square, and the missile gone.
 *
 * Run: `npm test -- --only=missile-exterior.ts`
 */
import { DBType, OBJECT_ID_EOF, Position, RoomType } from '../../src/core/types';
import { RN_FIREBALL } from '../../src/core/spellRn';
import type { Game } from '../../src/engine/Game';
import { newGame, stockGraphics, processTimersAt, stockDungeon } from '../lib/game';
import { wrapMember } from '../lib/standIn';
import { check, finish } from '../lib/check';

function makeGame(): Game {
  const data = stockDungeon();
  const game = newGame(data, stockGraphics());
  game.setRandomSeed(0x12345678);
  return game;
}

/** An empty open square on a map's border, and the direction that leaves the map from it. */
function findBorderSquare(game: Game): { at: Position; direction: number } {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z)!;
    const { width, height } = map.descriptor;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const direction = y === 0 ? 0 : x === width - 1 ? 1 : y === height - 1 ? 2 : x === 0 ? 3 : -1;
        if (direction < 0) continue;
        if (((map.cellFlags[x]![y]! >> 5) & 7) !== RoomType.OPEN) continue;
        const at = new Position(x, y, z);
        if (dungeon.findFirstObject(at) !== OBJECT_ID_EOF) continue;
        return { at, direction };
      }
    }
  }
  throw new Error('no empty open square on a map border');
}

function categoriesAt(game: Game, p: Position): DBType[] {
  const found: DBType[] = [];
  for (let rn = game.ctx.dungeon.findFirstObject(p); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
    found.push(game.ctx.dungeon.rnMaps.dbType(rn));
  }
  return found;
}

const game = makeGame();
const { at, direction } = findBorderSquare(game);
console.log(`an open square on the border at ${at.z}(${at.x},${at.y}), leaving the map heading ${direction}`);

const filters: number[] = [];
wrapMember(game.systems.missileEncounter, 'missileEncounterFilter', (filter) => (type, ...rest) => {
  filters.push(type);
  return filter(type, ...rest);
});

// The corner facing the edge (`leavingThisCell`, `Timer.cpp:306-308`), so the first move
// leaves the square.
const launched = game.systems.magic.launchMissile(RN_FIREBALL, at.x, at.y, at.z, direction, direction, 40, 10, 1, 1, false);
check(launched, 'the fireball launches');
// Stop at the tick the missile meets the wall: the cloud has a timer of its own, due the
// tick after.
let tick = 1;
for (; tick <= 3 && filters.length === 0; tick++) processTimersAt(game, tick);

const here = categoriesAt(game, at);
console.log(`tick ${tick - 1}: filters run: ${filters.join(', ') || 'none'}; in the square: ${here.map((c) => DBType[c]).join(', ') || 'nothing'}`);
check(filters.includes(6), 'the exterior wall runs missile filter 6 (Code11f52.cpp:1876-1878)');
check(here.includes(DBType.CLOUD), "the fireball explodes into its cloud in the square it flew from (CreateCloud, :2134)");
check(!here.includes(DBType.MISSILE), 'the missile is gone');

finish();
