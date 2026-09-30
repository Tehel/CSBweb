/**
 * The Power Gem's wall: a Zokathra spell takes the force field away, then the empty
 * Firestaff takes the gem.
 *
 * Level 13, the south face of (24,3), seen from (24,4) facing north. Three actuators,
 * first to last: #147 (type 0), #146 (type 16, the Firestaff swap) and #535 (type 17,
 * wants a Zokathra spell), then the complete Firestaff lying in the wall. A wall shows
 * its *last* actuator's ornament (`doc/CSBwin-src/Codea59a.cpp:136-139`), so #535's is
 * the force field.
 *
 *  1. A type 17 that matches unlinks itself from the square and `DeleteDBEntry`s itself
 *     (`doc/CSBwin-src/Mouse.cpp:389-398`), and takes the spell from the hand like a
 *     type 4 (`:549-568`). The wall then shows #146's ornament.
 *  2. A type 16 does nothing while an actuator follows it on that face
 *     (`remainingActuators[actuatorPos] != 0`, `Mouse.cpp:473-474`). With #535 gone, the
 *     empty Firestaff in hand is swapped for the first drawable object on the square,
 *     the complete one (`:475-506`).
 *  3. Before the spell, the Firestaff does nothing: #535 still follows #146.
 *  4. A type 17 first on its square has no `previousListObject` to unlink from, and
 *     `break`s out of the switch with its type unchanged (`Mouse.cpp:391`): it fires,
 *     takes the key, and stays to fire again.
 *
 * Run: `npx tsx tools/dump-zokathra-wall.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, decodeObjectID, encodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { OBJNI_THE_FIRESTAFF_A, OBJNI_THE_FIRESTAFF_B } from '../src/core/objectNameIndex';
import { getActuatorType } from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { Game } from '../src/engine/Game';
import { GetBasicObjectType } from '../src/engine/objectIndex';
import type { SummarizeRoomData } from '../src/renderer/bytecode/Types';
import { extractObjectTables } from '../src/data/tables/ObjectTables';
import { summarizeRoomInfoCsbwin } from '../src/renderer/csbwin/SummarizeRoomInfo';
import { extractViewportTables } from '../src/data/tables/ViewportTables';
import { check, finish } from './lib/check';
import { newGame, stockGraphics } from './lib/game';

const PARTY = new Position(24, 4, 13);
const FACING_NORTH = 0;
const WALL = new Position(24, 3, 13);
const SOUTH_FACE = 2;
const OBJNI_ZOKATHRA_SPELL = 197;
/** `MagicSystem`'s ZO KATH RA makes a misc of type 51. */
const MISC_ZOKATHRA = 51;

const objectTables = extractObjectTables(stockGraphics(), extractViewportTables(stockGraphics()).wallRectanglesOffset);

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const game = newGame(data, stockGraphics());
  game.ctx.party.state.position = PARTY;
  game.ctx.party.state.facing = FACING_NORTH;
  game.ctx.party.state.cursorOwner = 0;
  game.ctx.party.state.objectInHand = OBJECT_ID_NULL;
  return game;
}

const basicType = (game: Game, rn: ObjectID): number =>
  GetBasicObjectType(game.ctx.dungeon, game.ctx.tables.objDescObjectType, rn);

/** Everything on the square, first to last. */
function square(game: Game): ObjectID[] {
  const out: ObjectID[] = [];
  for (let rn = game.ctx.dungeon.findFirstObject(WALL); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) out.push(rn);
  return out;
}

const actuatorIndices = (game: Game): number[] =>
  square(game).filter((rn) => decodeObjectID(rn).category === DBType.ACTUATOR).map((rn) => decodeObjectID(rn).index);

/** The wall ornament ordinal (`wallGraphicOrdinal`) the party sees ahead, through `SummarizeRoomInfo`. */
function ordinalAhead(game: Game): number {
  const rslt: SummarizeRoomData = {
    x: WALL.x, y: WALL.y, relativeCellNumber: 17, skinNumber: 0, roomType: 0, championPortraitOrdinal: 0,
    graphicRoomType: 0, rn2: 0xfffe, decorations: [0, 0, 0], text: [0xfffe, 0xfffe, 0xfffe],
  };
  summarizeRoomInfoCsbwin(rslt, game.ctx.dungeon, game.ctx.party.state.position, FACING_NORTH, objectTables);
  return rslt.decorations[1] | 0;
}

const ordinalOf = (game: Game, index: number): number =>
  (game.ctx.dungeon.getActuatorRecord(encodeObjectID(SOUTH_FACE, DBType.ACTUATOR, index))!.word4 >> 12) & 0xf;

function zokathra(game: Game): ObjectID {
  const index = game.ctx.dungeon.findEmptyDBEntry('misc', { nextObject: OBJECT_ID_EOF, specialState: 0, important: false, miscType: MISC_ZOKATHRA });
  if (index === null) throw new Error('no room for a Zokathra spell');
  return encodeObjectID(0, DBType.MISC, index);
}

/** An empty Firestaff lying anywhere in the dungeon, taken off its square. */
function emptyFirestaff(game: Game): ObjectID {
  const data = game.ctx.dungeon.getData();
  for (let z = 0; z < data.maps.length; z++) {
    const { width, height } = data.maps[z]!.descriptor;
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
      const at = new Position(x, y, z);
      for (let rn = game.ctx.dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
        if (basicType(game, rn) !== OBJNI_THE_FIRESTAFF_A) continue;
        game.ctx.dungeon.removeObjectFromCell(at, rn);
        return rn;
      }
    }
  }
  throw new Error('no empty Firestaff in the dungeon');
}

function main(): void {
  // --- 1 and 2: the spell, then the staff -------------------------------------------
  {
    const game = makeGame();
    const before = actuatorIndices(game);
    const gem = square(game).find((rn) => decodeObjectID(rn).category === DBType.WEAPON)!;
    console.log(`square: actuators ${before.join(',')}, ornament ordinal ${ordinalAhead(game)}; in the wall ${basicType(game, gem)}`);
    check(before.join(',') === '147,146,535', 'the south face holds #147, #146, #535 in that order');
    check(basicType(game, gem) === OBJNI_THE_FIRESTAFF_B, 'the wall holds the complete Firestaff');
    check(ordinalAhead(game) === ordinalOf(game, 535), 'the wall shows #535\'s ornament, the force field');

    const spell = zokathra(game);
    check(basicType(game, spell) === OBJNI_ZOKATHRA_SPELL, 'canary: misc type 51 is the Zokathra spell');
    game.ctx.party.state.objectInHand = spell;
    const fired = game.handleWallClick();
    const after = actuatorIndices(game);
    const deleted = encodeObjectID(SOUTH_FACE, DBType.ACTUATOR, 535);
    console.log(`Zokathra: fired ${fired}, actuators ${after.join(',')}, ornament ordinal ${ordinalAhead(game)}, hand ${game.ctx.party.state.objectInHand}`);
    check(fired, 'the spell fires #535');
    check(after.join(',') === '147,146', '#535 is unlinked from the square');
    check(game.ctx.dungeon.getDBRecordLink(deleted) === OBJECT_ID_NULL, '#535 is DeleteDBEntry\'d: its link is RNnul');
    check(game.ctx.dungeon.getDBRecordLink(encodeObjectID(SOUTH_FACE, DBType.ACTUATOR, 146)) === gem, '#146 now links to the Firestaff in the wall');
    check(game.ctx.party.state.objectInHand === OBJECT_ID_NULL, 'the spell is taken from the hand');
    check(ordinalAhead(game) === ordinalOf(game, 146), 'the wall now shows #146\'s ornament');

    const staff = emptyFirestaff(game);
    game.ctx.party.state.objectInHand = staff;
    const swapped = game.handleWallClick();
    const hand = game.ctx.party.state.objectInHand;
    console.log(`Firestaff: fired ${swapped}, hand ${basicType(game, hand)}, square ${square(game).map((rn) => `${DBType[decodeObjectID(rn).category]}#${decodeObjectID(rn).index}`).join(',')}`);
    check(swapped, 'the empty Firestaff fires #146');
    check(hand === gem && basicType(game, hand) === OBJNI_THE_FIRESTAFF_B, 'the hand now holds the complete Firestaff');
    check(square(game).some((rn) => (rn & 0x3fff) === (staff & 0x3fff)), 'the empty Firestaff is left in the wall');
  }

  // --- 3: the staff before the spell --------------------------------------------------
  {
    const game = makeGame();
    const staff = emptyFirestaff(game);
    game.ctx.party.state.objectInHand = staff;
    const fired = game.handleWallClick();
    check(!fired && game.ctx.party.state.objectInHand === staff, 'before the spell the Firestaff does nothing: #535 still follows #146');
  }

  // --- 4: a type 17 first on its square stays ---------------------------------------
  {
    const game = makeGame();
    // Unlink #147 and #146 so that #535 is first on the square.
    const d = game.ctx.dungeon;
    const first = encodeObjectID(SOUTH_FACE, DBType.ACTUATOR, 535);
    d.removeObjectFromCell(WALL, encodeObjectID(SOUTH_FACE, DBType.ACTUATOR, 147));
    d.removeObjectFromCell(WALL, encodeObjectID(SOUTH_FACE, DBType.ACTUATOR, 146));
    check(square(game)[0] === first, 'set-up: #535 is first on the square');
    game.ctx.party.state.objectInHand = zokathra(game);
    const fired = game.handleWallClick();
    const rec = d.getActuatorRecord(first)!;
    console.log(`first on the square: fired ${fired}, actuators ${actuatorIndices(game).join(',')}, type ${getActuatorType(rec)}`);
    check(fired && game.ctx.party.state.objectInHand === OBJECT_ID_NULL, 'it fires and takes the spell');
    check(square(game)[0] === first && getActuatorType(rec) === 17, 'and stays on the square, still type 17');
  }

  finish();
}

main();
