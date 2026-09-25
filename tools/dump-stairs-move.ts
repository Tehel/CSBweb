/**
 * `MoveObject`'s stairs arm (`doc/CSBwin-src/Code11f52.cpp:3108-3131`).
 *
 * A monster or an object — not the party, not a missile — that `MoveObject` sets down on
 * a stairs square goes one level down when bit 2 of the cell is clear (`IncrementLevel`,
 * `:3114-3118`), then one square out through `ExitStairsDirection` (`:290-325`) on the
 * level it is now on, and its corner turns to face the stairs (`:3124-3130`). The loop
 * goes on from there. `resolveCellEffects` had no stairs arm: the object stayed on the
 * stairs.
 *
 *  1. An item set down on stairs going down lands beside the stairs one level below.
 *  2. An item set down on stairs going up stays on its level, beside the stairs.
 *  3. A monster moved onto stairs going down goes the same way.
 *  4. The party is not moved by the arm (`:3111`).
 *
 * The stairs are real ones from `dungeon.dat`.
 *
 * Run: `npx tsx tools/dump-stairs-move.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, RoomType, decodeObjectID, encodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, finish } from './lib/check';
import { createMonsterAt } from './lib/createMonster';
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

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
const roomType = (game: Game, p: Position): number => (game.dungeonState.getCellFlag(p) >> 5) & 7;
const emptyOpen = (game: Game, p: Position): boolean => {
  const map = game.dungeonState.getMap(p.z);
  if (!map || p.x < 0 || p.y < 0 || p.x >= map.descriptor.width || p.y >= map.descriptor.height) return false;
  return roomType(game, p) === RoomType.OPEN && game.dungeonState.findFirstObject(p) === OBJECT_ID_EOF;
};

type Stairs = { at: Position; exitLevel: Position; dir: number; exit: Position; beside: Position | null };
/**
 * A stairs square on a level other than the party's, going down (`down`) or up, whose
 * exit square is open and empty, and an open empty square beside the stairs if there is one.
 */
function findStairs(game: Game, down: boolean, accept: (s: Stairs) => boolean = () => true): Stairs {
  const dungeon = game.dungeonState;
  for (let z = 1; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const at = new Position(x, y, z);
        const flag = dungeon.getCellFlag(at);
        if (((flag >> 5) & 7) !== RoomType.STAIRS || ((flag & 4) === 0) !== down) continue;
        const exitLevel = down ? dungeon.incrementLevel(at, 1) : at;
        if (!exitLevel || exitLevel.z === game.party.state.position.z) continue;
        const dir = dungeon.getExitStairsDirection(exitLevel, game.party.state.facing);
        const exit = new Position(exitLevel.x + DX[dir]!, exitLevel.y + DY[dir]!, exitLevel.z);
        if (!emptyOpen(game, exit)) continue;
        let beside: Position | null = null;
        for (let d = 0; d < 4 && !beside; d++) {
          const p = new Position(x + DX[d]!, y + DY[d]!, z);
          if (emptyOpen(game, p) && !same(p, exit)) beside = p;
        }
        const stairs = { at, exitLevel, dir, exit, beside };
        if (accept(stairs)) return stairs;
      }
    }
  }
  throw new Error(`no ${down ? 'down' : 'up'} stairs with an open exit`);
}

/** `:3124-3130`: the corner turned to face back towards the stairs. */
function turnedCorner(corner: number, dir: number): number {
  const back = (dir + 2) & 3;
  return ((((corner - back + 1) & 2) >> 1) + back) & 3;
}

/** The last weapon record, lifted from wherever it lies. */
function takeWeapon(game: Game, corner: number): ObjectID {
  const dungeon = game.dungeonState;
  const index = dungeon.getData().databases.weapons.records.length - 1;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const p = new Position(x, y, z);
        const found = findWeapon(game, p, index);
        if (found !== null) dungeon.removeObjectFromCell(p, found);
      }
    }
  }
  return encodeObjectID(corner, DBType.WEAPON, index);
}

function findWeapon(game: Game, at: Position, index: number): ObjectID | null {
  const dungeon = game.dungeonState;
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const decoded = decodeObjectID(rn);
    if (decoded.category === DBType.WEAPON && decoded.index === index) return rn;
  }
  return null;
}

function main(): void {
  /* ----------------------------------------------- 1-2. an item set down on stairs ---- */
  for (const down of [true, false]) {
    const game = makeGame();
    const stairs = findStairs(game, down);
    const rn = takeWeapon(game, 1);
    const moved = game.timerSystem.moveObject(rn, -1, 0, stairs.at.x, stairs.at.y, stairs.at.z);
    const landed = findWeapon(game, stairs.exit, decodeObjectID(rn).index);
    const want = turnedCorner(1, stairs.dir);
    const n = down ? 1 : 2;
    console.log(`${n}. item set down on ${down ? 'down' : 'up'} stairs (${stairs.at.x},${stairs.at.y}) L${stairs.at.z}: `
      + `exit ${stairs.dir} to (${stairs.exit.x},${stairs.exit.y}) L${stairs.exit.z}; on the stairs `
      + `${findWeapon(game, stairs.at, decodeObjectID(rn).index) !== null}, at the exit ${landed !== null}, `
      + `corner ${landed !== null ? decodeObjectID(landed).position : '-'} (want ${want})`);
    check(landed !== null && moved.position !== null && same(moved.position, stairs.exit),
      down ? 'it goes down a level and out through ExitStairsDirection' : 'it stays on its level and goes out');
    check(landed !== null && decodeObjectID(landed).position === want, 'its corner turns to face the stairs');
  }

  /* ---------------------------------------------- 3. a monster moved onto stairs ---- */
  {
    const game = makeGame();
    const dungeon = game.dungeonState;
    let type = -1;
    const stairs = findStairs(game, true, (s) => {
      if (!s.beside) return false;
      for (let t = 0; t < 27; t++) {
        if (dungeon.monsterAllowedOnLevel(t, s.at.z) && dungeon.monsterAllowedOnLevel(t, s.exit.z)) { type = t; return true; }
      }
      return false;
    });
    const beside = stairs.beside!;
    const rn = createMonsterAt(game, {
      value: type, hitPointMultiplier: 1, numMonM1: 0, facing: 0,
      mapX: beside.x, mapY: beside.y, level: beside.z, invisible: false, drawAsSize4: false,
    });
    if (rn === null) throw new Error('createMonster failed');
    const result = game.monsterSystem.moveMonster(rn, beside.x, beside.y, stairs.at.x, stairs.at.y, stairs.at.z);
    const there = dungeon.findFirstMonster(stairs.exit);
    console.log(`3. type ${type} group (${beside.x},${beside.y}) -> stairs (${stairs.at.x},${stairs.at.y}) `
      + `L${stairs.at.z}: code ${result.code}, ended (${result.position.x},${result.position.y}) L${result.position.z}, `
      + `on the stairs ${dungeon.findFirstMonster(stairs.at) !== OBJECT_ID_EOF}, at the exit ${there !== OBJECT_ID_EOF}`);
    check(same(result.position, stairs.exit) && there !== OBJECT_ID_EOF
      && dungeon.findFirstMonster(stairs.at) === OBJECT_ID_EOF, 'the group goes down the stairs and out');
  }

  /* ------------------------------------------------------ 4. the party is not moved ---- */
  {
    const game = makeGame();
    const stairs = findStairs(game, true);
    const result = game.timerSystem.resolvePartyMove(stairs.at, 0);
    console.log(`4. the party resolved on the stairs: moved ${result.moved}`);
    check(!result.moved && same(result.position, stairs.at), 'the stairs arm breaks for the party');
  }

  finish();
}

main();
