/**
 * The hidden alcove of level 5 (map 5): a gem, a bow, a coin and a mirror put in the
 * room's four alcoves open a fifth one, which holds an Iron Key.
 *
 * Map 5, the room (8..12, 18..22). The four alcoves are the south faces of (9,17) and
 * (12,17) and the north faces of (9,23) and (12,23), each a type 2 "hold, normally
 * closed" that wants its object and aims at the counters on (13,23). The fifth is the
 * west face of (13,19), seen from (12,19) facing east. Its actuators, first to last:
 * #550 (type 0, the alcove ornament) and #549 (type 5, no ornament, local action 1).
 *
 *  1. A stone face shows its *last* actuator's `wallGraphicOrdinal()`, whatever it is,
 *     0 included (`doc/CSBwin-src/Codea59a.cpp:134-153`). #549 comes last and has
 *     none, so the face is bare stone and the key in it is not an alcove's to show.
 *     The port wrote only an ordinal in `1..NumWallDecoration`, so #550's alcove showed
 *     through from the start.
 *  2. With the four objects in, counter #616 reaches zero and clears (13,19) corner 3.
 *     #549 (value 0: every input bit clear matches) fires its local action 1 with its
 *     own square as the switch's (`doc/CSBwin-src/Timer.cpp:2331-2346`), and the
 *     `RotateActuatorList` that ends `ProcessTT_STONEROOM` (`:2382`,
 *     `doc/CSBwin-src/Code11f52.cpp:3465-3525`) moves #550 behind it. The face then shows
 *     #550's ornament, an alcove. The port handed the local action the bits of #549's
 *     `localActionType` read as a target square, and never rotated after a stone timer.
 *
 * Run: `npx tsx tools/dump-hidden-alcove.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, Direction, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, decodeObjectID, encodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { getActuatorValue } from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { Game } from '../src/engine/Game';
import { GetBasicObjectType } from '../src/engine/objectIndex';
import type { SummarizeRoomData } from '../src/renderer/bytecode/Types';
import { summarizeRoomInfoCsbwin } from '../src/renderer/csbwin/SummarizeRoomInfo';
import { check, finish } from './lib/check';
import { graphicsTablesOf, newGame, stockGraphics } from './lib/game';

const MAP = 5;
const HIDDEN = new Position(13, 19, MAP);
const WEST_FACE = 3;
/** The four alcoves: the wall, the party square before it, and the party's facing. */
const ALCOVES: Array<{ wall: Position; party: Position; facing: Direction; actuator: number }> = [
  { wall: new Position(9, 17, MAP), party: new Position(9, 18, MAP), facing: Direction.NORTH, actuator: 138 },
  { wall: new Position(12, 17, MAP), party: new Position(12, 18, MAP), facing: Direction.NORTH, actuator: 139 },
  { wall: new Position(9, 23, MAP), party: new Position(9, 22, MAP), facing: Direction.SOUTH, actuator: 136 },
  { wall: new Position(12, 23, MAP), party: new Position(12, 22, MAP), facing: Direction.SOUTH, actuator: 137 },
];

const objectTables = graphicsTablesOf(stockGraphics()).objects;

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const game = newGame(data, stockGraphics());
  game.ctx.party.state.position = new Position(12, 19, MAP);
  game.ctx.party.state.facing = Direction.EAST;
  game.ctx.party.state.cursorOwner = 0;
  game.ctx.party.state.objectInHand = OBJECT_ID_NULL;
  return game;
}

const basicType = (game: Game, rn: ObjectID): number =>
  GetBasicObjectType(game.ctx.dungeon, game.ctx.tables.objDescObjectType, rn);

/** Everything on a square, first to last. */
function square(game: Game, at: Position): ObjectID[] {
  const out: ObjectID[] = [];
  for (let rn = game.ctx.dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) out.push(rn);
  return out;
}

const actuatorIndices = (game: Game): number[] =>
  square(game, HIDDEN).filter((rn) => decodeObjectID(rn).category === DBType.ACTUATOR).map((rn) => decodeObjectID(rn).index);

/** The ornament ordinal of the wall ahead of (12,19) facing east, through `SummarizeRoomInfo`. */
function ordinalAhead(game: Game): number {
  const rslt: SummarizeRoomData = {
    x: HIDDEN.x, y: HIDDEN.y, relativeCellNumber: 17, skinNumber: 0, roomType: 0, championPortraitOrdinal: 0,
    graphicRoomType: 0, rn2: 0xfffe, decorations: [0, 0, 0], text: [0xfffe, 0xfffe, 0xfffe],
  };
  summarizeRoomInfoCsbwin(rslt, game.ctx.dungeon, new Position(12, 19, MAP), Direction.EAST, objectTables);
  return rslt.decorations[1] | 0;
}

const ordinalOf = (game: Game, at: number, index: number): number =>
  (game.ctx.dungeon.getActuatorRecord(encodeObjectID(at, DBType.ACTUATOR, index))!.word4 >> 12) & 0xf;

/** The first object lying anywhere in the dungeon whose basic type is `wanted`, taken off its square. */
function takeObject(game: Game, wanted: number): ObjectID {
  const data = game.ctx.dungeon.getData();
  for (let z = 0; z < data.maps.length; z++) {
    const { width, height } = data.maps[z]!.descriptor;
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
      const at = new Position(x, y, z);
      for (let rn = game.ctx.dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
        if (decodeObjectID(rn).category <= DBType.ACTUATOR) continue;
        if (basicType(game, rn) !== wanted) continue;
        game.ctx.dungeon.removeObjectFromCell(at, rn);
        return rn;
      }
    }
  }
  throw new Error(`no object of basic type ${wanted} lying in the dungeon`);
}

/** The two counters on (13,23): #616 opens the alcove at zero, #135 aims at the door on (13,20). */
const counters = (game: Game): string =>
  [616, 135].map((i) => getActuatorValue(game.ctx.dungeon.getActuatorRecord(encodeObjectID(WEST_FACE, DBType.ACTUATOR, i))!)).join(',');

function runTicks(game: Game, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    game.systems.timer.processTimers();
    game.ctx.state.tickCount++;
  }
}

function main(): void {
  const game = makeGame();
  const alcove = ordinalOf(game, WEST_FACE, 550);
  const key = square(game, HIDDEN).find((rn) => decodeObjectID(rn).category === DBType.MISC)!;

  // --- 1: hidden on arrival -----------------------------------------------------------
  console.log(`(13,19) west face: actuators ${actuatorIndices(game).join(',')}; #550 ornament ${alcove}, #549 ornament ${ordinalOf(game, WEST_FACE, 549)}`);
  console.log(`on arrival the party sees ornament ${ordinalAhead(game)}`);
  check(actuatorIndices(game).join(',') === '550,549', 'the face holds #550 then #549');
  check(alcove !== 0 && ordinalOf(game, WEST_FACE, 549) === 0, '#550 carries an ornament and #549 none');
  check(ALCOVES.every((a) => ordinalOf(game, (a.facing + 2) & 3, a.actuator) === alcove), 'canary: the four alcoves carry #550\'s ornament');
  check(key !== undefined && game.ctx.dungeon.getDBRecordLink(encodeObjectID(WEST_FACE, DBType.ACTUATOR, 549)) === key, 'the key lies in the wall after #549');
  check(ordinalAhead(game) === 0, 'on arrival the face is bare stone: the last actuator, #549, has no ornament');

  // --- 2: the four objects open it ----------------------------------------------------
  console.log('');
  console.log(['alcove', 'wants', 'counters #616,#135', 'actuators on (13,19)', 'ornament ahead of (12,19)'].join('\t'));
  for (const a of ALCOVES) {
    const wanted = getActuatorValue(game.ctx.dungeon.getActuatorRecord(encodeObjectID((a.facing + 2) & 3, DBType.ACTUATOR, a.actuator))!);
    game.ctx.party.state.position = a.party;
    game.ctx.party.state.facing = a.facing;
    game.ctx.party.state.objectInHand = takeObject(game, wanted);
    check(game.dropObjectFromCursor(4), `the object goes into the alcove at (${a.wall.x},${a.wall.y})`);
    runTicks(game, 4);
    console.log([`(${a.wall.x},${a.wall.y})`, wanted, counters(game), actuatorIndices(game).join(','), ordinalAhead(game)].join('\t'));
    if (a !== ALCOVES[ALCOVES.length - 1]) check(ordinalAhead(game) === 0, `after (${a.wall.x},${a.wall.y}) alone the face is still bare`);
  }
  check(actuatorIndices(game).join(',') === '549,550', 'the fourth object rotates #550 behind #549');
  check(ordinalAhead(game) === alcove, 'and the face now shows the alcove');

  finish();
}

main();
