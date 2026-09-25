/**
 * The two drops go through `MoveObject` (`doc/CSBwin-src/Code11f52.cpp:2796`).
 *
 * `DropObject` puts the cursor's object down with `MoveObject(objD4, -1, 0, x, y)`
 * (`doc/CSBwin-src/Mouse.cpp:882`), and a thrown object whose flight ends is put down with
 * `MoveObject(obj, -2, 0, x, y)` (`ProcessObjectFromMissile`, `Timer.cpp:151-159`).
 * `Game.dropObjectFromCursor` and `TimerSystem.dropMissileObject` hand-rolled it, and
 * differed from it in two ways:
 *
 *  1. They placed the object with `unchangedRoom` false. `MoveObject` places an object
 *     with `unchangedRoom` = "the party stands on this square" (`:3433-3448`), so an item
 *     dropped where the party stands does not press a type-1 pad the party is already on.
 *  2. The cursor drop turned the object's corner on a relative teleporter. `MoveObject`
 *     turns it only when `oldX != -1` (`:3000-3006`): a thrown object (`oldX` -2) turns,
 *     a dropped one keeps the corner it was dropped at.
 *
 * The teleporter is a real record from `dungeon.dat`, rigged by `tools/lib/teleporter.ts`.
 *
 * Run: `npx tsx tools/dump-drop-move-object.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, RoomType, decodeObjectID, encodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { ActuatorSystem } from '../src/engine/ActuatorSystem';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, finish } from './lib/check';
import { rigTeleporter } from './lib/teleporter';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';

const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
const viewportTables = extractViewportTables(graphics);
const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
const uiTables = extractUITables(graphics);

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const game = new Game(
    data,
    {
      roomTimerFunctions: uiTables.graphic232.byte1596,
      monsterDesc: objectTables.monsterDesc,
      objDescObjectType: objectTables.objDescObjectType,
      weaponDesc: objectTables.weaponDesc,
      weaponWeights: objectTables.weaponWeights,
      clothingWeights: objectTables.clothingWeights,
      miscWeights: objectTables.miscWeights,
    },
    {
      monsterDesc: objectTables.monsterDesc,
      word1074: uiTables.graphic232.word1074,
      soundTable: uiTables.graphic232.soundTable,
      doorCharacteristics: objectTables.doorCharacteristics,
      monsterDroppings: objectTables.monsterDroppings,
      facingReplication: objectTables.facingReplication,
    },
  );
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < 4; i++) game.addChampion(champion(i));
  return game;
}

const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
const isOpen = (game: Game, p: Position): boolean => {
  const map = game.dungeonState.getMap(p.z);
  if (!map || p.x < 0 || p.y < 0 || p.x >= map.descriptor.width || p.y >= map.descriptor.height) return false;
  return ((game.dungeonState.getCellFlag(p) >> 5) & 7) === RoomType.OPEN;
};

/**
 * Three open squares on level 0: the party's, the one north of it, and a far one. The
 * north one becomes a teleporter to the far one, turning objects by `rotation`.
 */
function stage(game: Game, rotation: number): { party: Position; front: Position; dest: Position } {
  const dungeon = game.dungeonState;
  const map = dungeon.getMap(0)!;
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 1; y < map.descriptor.height; y++) {
      const party = new Position(x, y, 0);
      const front = party.north;
      if (!isOpen(game, party) || !isOpen(game, front)) continue;
      for (let dx = 0; dx < map.descriptor.width; dx++) {
        for (let dy = 0; dy < map.descriptor.height; dy++) {
          const dest = new Position(dx, dy, 0);
          if (Math.abs(dx - x) + Math.abs(dy - y) < 3 || !isOpen(game, dest)) continue;
          rigTeleporter(game, front, dest);
          const records = dungeon.getData().databases.teleporters.records;
          for (let rn = dungeon.findFirstObject(front); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
            if (decodeObjectID(rn).category === DBType.TELEPORTER) records[decodeObjectID(rn).index]!.rotation = rotation;
          }
          game.party.state.position = party;
          game.party.state.facing = 0;
          return { party, front, dest };
        }
      }
    }
  }
  throw new Error('no staging squares on level 0');
}

/** The last weapon record, lifted from wherever it lies, at corner 0. */
function takeWeapon(game: Game): ObjectID {
  const dungeon = game.dungeonState;
  const index = dungeon.getData().databases.weapons.records.length - 1;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const found = find(game, new Position(x, y, z), index);
        if (found !== null) dungeon.removeObjectFromCell(new Position(x, y, z), found);
      }
    }
  }
  return encodeObjectID(0, DBType.WEAPON, index) as ObjectID;
}

function find(game: Game, at: Position, index: number): ObjectID | null {
  const dungeon = game.dungeonState;
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const decoded = decodeObjectID(rn);
    if (decoded.category === DBType.WEAPON && decoded.index === index) return rn;
  }
  return null;
}

type PadCall = { at: Position; place: boolean; unchangedRoom: boolean };
function spy(game: Game): PadCall[] {
  const calls: PadCall[] = [];
  const actuators = (game as unknown as { actuators: ActuatorSystem }).actuators;
  const real = actuators.triggerObjectMove.bind(actuators);
  actuators.triggerObjectMove = (position, object, place, unchangedRoom, facing) => {
    if (decodeObjectID(object).category === DBType.WEAPON) calls.push({ at: position, place, unchangedRoom });
    return real(position, object, place, unchangedRoom, facing);
  };
  return calls;
}

type Dropper = { dropMissileObject(projectile: number, position: Position, posInCell: number): void };
const throwLands = (game: Game, rn: ObjectID, at: Position, corner: number): void =>
  (game.timerSystem as unknown as Dropper).dropMissileObject(rn, at, corner);

function main(): void {
  /* ------------------------------------- 1. a drop onto the party's own square ---- */
  {
    const game = makeGame();
    const { party } = stage(game, 0);
    const rn = takeWeapon(game);
    const calls = spy(game);
    game.party.state.cursorOwner = 0;
    game.party.state.objectInHand = rn;
    const dropped = game.dropObjectFromCursor(1);
    const landed = find(game, party, decodeObjectID(rn).index);
    console.log(`1. cursor drop at (${party.x},${party.y}) where the party stands: accepted ${dropped}, `
      + `there ${landed !== null}, pad calls ${JSON.stringify(calls.map((c) => [c.at.x, c.at.y, c.place, c.unchangedRoom]))}`);
    check(dropped && landed !== null && decodeObjectID(landed).position === 1, 'the item lies on the party square, corner 1');
    check(calls.length === 1 && calls[0]!.place && same(calls[0]!.at, party) && calls[0]!.unchangedRoom,
      'it is placed with unchangedRoom = the party stands there (Code11f52.cpp:3433-3448)');
  }

  /* ---------------------------- 2. a drop onto a relative teleporter in front ---- */
  {
    const game = makeGame();
    const { front, dest } = stage(game, 1);
    const rn = takeWeapon(game);
    const calls = spy(game);
    game.party.state.cursorOwner = 0;
    game.party.state.objectInHand = rn;
    game.dropObjectFromCursor(2);
    const landed = find(game, dest, decodeObjectID(rn).index);
    console.log(`2. cursor drop onto the teleporter at (${front.x},${front.y}), rotation 1: at (${dest.x},${dest.y}) `
      + `${landed !== null}, corner ${landed !== null ? decodeObjectID(landed).position : '-'}, `
      + `pad calls ${JSON.stringify(calls.map((c) => [c.at.x, c.at.y, c.place, c.unchangedRoom]))}`);
    check(landed !== null, 'the item is carried to the destination');
    check(landed !== null && decodeObjectID(landed).position === 2,
      'it keeps the corner it was dropped at: oldX is -1 (Code11f52.cpp:3000-3006)');
    check(calls.length === 1 && same(calls[0]!.at, dest) && !calls[0]!.unchangedRoom,
      'it is placed once, at the destination, with unchangedRoom false');
  }

  /* ------------------------------- 3. a thrown item landing where the party stands ---- */
  {
    const game = makeGame();
    const { party } = stage(game, 0);
    const rn = takeWeapon(game);
    const calls = spy(game);
    throwLands(game, rn, party, 3);
    const landed = find(game, party, decodeObjectID(rn).index);
    console.log(`3. thrown item lands at (${party.x},${party.y}) where the party stands: there ${landed !== null}, `
      + `pad calls ${JSON.stringify(calls.map((c) => [c.at.x, c.at.y, c.place, c.unchangedRoom]))}`);
    check(landed !== null && decodeObjectID(landed).position === 3, 'the item lies on the party square, corner 3');
    check(calls.length === 1 && calls[0]!.place && calls[0]!.unchangedRoom,
      'it is placed with unchangedRoom = the party stands there (Code11f52.cpp:3433-3448)');
  }

  /* ----------------------------- 4. a thrown item landing on a relative teleporter ---- */
  {
    const game = makeGame();
    const { front, dest } = stage(game, 1);
    const rn = takeWeapon(game);
    throwLands(game, rn, front, 2);
    const landed = find(game, dest, decodeObjectID(rn).index);
    console.log(`4. thrown item lands on the teleporter at (${front.x},${front.y}), rotation 1: at (${dest.x},${dest.y}) `
      + `${landed !== null}, corner ${landed !== null ? decodeObjectID(landed).position : '-'}`);
    check(landed !== null && decodeObjectID(landed).position === 3,
      'it is carried to the destination and turned: oldX is -2, not -1 (Code11f52.cpp:3000-3006)');
  }

  finish();
}

main();
