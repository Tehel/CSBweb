/**
 * A DSA moving a cloud or a missile across the dungeon (`MoveObject`,
 * `doc/CSBwin-src/MoveObject.cpp:721-790`, with `FindCellSource` / `FindCellDestination`).
 *
 *  1. A cell source hands a cloud over. The check pass finds its `TT_25` (or a
 *     Fluxcage's `TT_24`) — `SER_BadCloudTimer` (16) when there is none (`:227-245`) —
 *     and `FindCellDestination` points that timer at the new square and level
 *     (`:522-529`). The port refused every cloud with `SER_NoCloudsPlease` (15).
 *  2. So the cloud lives out its life where the DSA put it, and `ProcessTT_25`
 *     removes it from *that* cell when it is spent.
 *  3. A missile's timer gets the new square in `timerWord8`'s low ten bits, keeping
 *     its direction and energy, and the new level (`:574-596`). The port left the
 *     timer at the old square, so the missile flew on from where it no longer was.
 *
 * Run: `npx tsx tools/dump-dsa-move.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DBType, decodeObjectID, locationRelToInteger, OBJECT_ID_EOF, Position, RoomType, type ObjectID,
} from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { TimerFunction } from '../src/engine/TimerQueue';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { check, finish } from './lib/check';

const RN_POISON_CLOUD = 0xff87;
const RN_POISON_BOLT = 0xff86;
const SER_BadCloudTimer = 16;
const CELL = 1;

async function main(): Promise<void> {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

  const makeGame = async (): Promise<Game> => {
    const loader = new DungeonLoader();
    await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
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
        monsterAttackSounds: objectTables.monsterAttackSounds,
        uByte590: uiTables.graphic232.uByte590,
        byte586: uiTables.graphic232.byte586,
        clothingArmour: objectTables.clothingArmour,
        clothingFlags: objectTables.clothingFlags,
        byte1412: uiTables.graphic232.byte1412,
      experienceForAttacking: uiTables.graphic230.experienceForAttacking,
      skillNumber: uiTables.graphic230.skillNumber,
      byte20046: uiTables.graphic230.byte20046,
      byte20002: uiTables.graphic230.byte20002,
      byte19958: uiTables.graphic230.byte19958,
      byte19914: uiTables.graphic230.byte19914,
      byte20090: uiTables.graphic230.byte20090,
      attackNames: uiTables.graphic230.attackNames,
      },
    );
    // Fixed seed, so the numbers below repeat run to run. This used to sit *after* a
    // `return new Game(...)` — dead code, so every run of this tool was unseeded
    // despite the comment. `tsc` never saw it because `tools/` was outside the
    // type gate; it is inside it now.
    game.setRandomSeed(0x12345678);
    return game;
  };

  /** Every object of `category` in a cell. */
  const inCell = (game: Game, pos: Position, category: DBType): ObjectID[] => {
    const out: ObjectID[] = [];
    const dungeon = game.dungeonState;
    for (let rn = dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      if (decodeObjectID(rn).category === category) out.push(rn);
    }
    return out;
  };

  /** An empty open square on the start level that is not the start square. */
  const emptySquare = (game: Game, start: Position): Position => {
    const dungeon = game.dungeonState;
    const map = dungeon.getMap(start.z);
    if (!map) throw new Error('no start level');
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const p = new Position(x, y, start.z);
        if (x === start.x && y === start.y) continue;
        if (((dungeon.getCellFlag(p) >> 5) & 7) !== RoomType.OPEN) continue;
        if (dungeon.findFirstObject(p) !== OBJECT_ID_EOF) continue;
        return p;
      }
    }
    throw new Error('no empty open square');
  };

  const move = (game: Game, category: DBType, from: Position, to: Position, corner: number): number =>
    (game as any).dsaSystem.moveObjectDsa(
      CELL, 1 << category, 0xf, locationRelToInteger({ l: from.z, x: from.x, y: from.y, p: 0 }), 0,
      CELL, 0, 1 << corner, locationRelToInteger({ l: to.z, x: to.x, y: to.y, p: 0 }), 0,
    );

  /* ---------------------------------------------- 1-2. a poison cloud moved ------ */
  {
    const game = await makeGame();
    const start = game.dungeonState.getStartPosition();
    const from = new Position(start.x, start.y, start.z);
    const to = emptySquare(game, from);
    game.timerSystem.createDeathCloud(RN_POISON_CLOUD, 60, from, 255);
    const result = move(game, DBType.CLOUD, from, to, 2);
    const moved = inCell(game, to, DBType.CLOUD);
    const timer = game.timerQueue.getTimers().find((t) => t.function === TimerFunction.TT_25);
    console.log(`1. poison cloud (${from.x},${from.y}) -> (${to.x},${to.y}): result ${result}, `
      + `now ${moved.map((r) => r.toString(16)).join(',') || 'nowhere'}, timer at (${timer?.uByte6},${timer?.uByte7}) L${timer?.level} obj ${timer?.object?.toString(16)}`);
    check(result === 0, 'a cell source hands a cloud over (result 0, not SER_NoCloudsPlease)');
    check(inCell(game, from, DBType.CLOUD).length === 0 && moved.length === 1, 'the cloud leaves its square for the destination');
    check(moved.length === 1 && decodeObjectID(moved[0]).position === 2, 'it lands in the corner the position mask names');
    check(!!timer && timer.uByte6 === to.x && timer.uByte7 === to.y && timer.level === to.z,
      'FindCellDestination points the TT_25 at the new square and level');
    check(!!timer && moved.length === 1 && timer.object === moved[0], 'the timer names the cloud as it now lies');

    let ticks = 0;
    for (let t = 1; t <= 400 && inCell(game, to, DBType.CLOUD).length > 0; t++) {
      game.timerSystem.processTimers(t);
      ticks = t;
    }
    console.log(`2. it lived ${ticks} more ticks at the destination`);
    check(inCell(game, to, DBType.CLOUD).length === 0, 'ProcessTT_25 removes the spent cloud from where the DSA put it');
    check(inCell(game, from, DBType.CLOUD).length === 0, 'and nothing reappears at the old square');
  }

  /* -------------------------------------------- a cloud with no timer ----------- */
  {
    const game = await makeGame();
    const start = game.dungeonState.getStartPosition();
    const from = new Position(start.x, start.y, start.z);
    const to = emptySquare(game, from);
    game.timerSystem.createDeathCloud(RN_POISON_CLOUD, 60, from, 255);
    const tt25 = game.timerQueue.getTimers().find((t) => t.function === TimerFunction.TT_25);
    if (tt25) game.timerQueue.deleteTimer(tt25.index);
    const result = move(game, DBType.CLOUD, from, to, 2);
    console.log(`1b. a cloud without its timer: result ${result}`);
    check(result === SER_BadCloudTimer, 'a cloud with no TT_24/TT_25 is SER_BadCloudTimer (16)');
    check(inCell(game, from, DBType.CLOUD).length === 1, 'and stays where it was');
  }

  /* ---------------------------------------------- 3. a missile moved ------------ */
  {
    const game = await makeGame();
    const start = game.dungeonState.getStartPosition();
    const from = new Position(start.x, start.y, start.z);
    const to = emptySquare(game, from);
    // A poison bolt in flight, heading west with decay 1, not due for a while.
    game.timerSystem.launchThrownMissile(RN_POISON_BOLT, from, 1, 3, 100, 100, 1, 1000);
    const missile = inCell(game, from, DBType.MISSILE)[0];
    const record = missile !== undefined ? game.dungeonState.getMissileRecord(missile) : null;
    const timer = record ? game.timerQueue.getTimer(record.timerIndex) : null;
    const before = timer?.timerWord8 ?? 0;
    const result = move(game, DBType.MISSILE, from, to, 1);
    const after = timer?.timerWord8 ?? 0;
    console.log(`3. missile (${from.x},${from.y}) -> (${to.x},${to.y}): result ${result}, `
      + `word8 ${before.toString(16)} -> ${after.toString(16)}, level ${timer?.level}`);
    check(result === 0 && inCell(game, to, DBType.MISSILE).length === 1, 'the missile moves');
    check((after & 0x1f) === to.x && ((after >> 5) & 0x1f) === to.y, 'timerWord8 carries the new square');
    check((after & 0xfc00) === (before & 0xfc00), 'direction and energy bits are kept');
    check(timer?.level === to.z, 'the timer carries the new level');
  }

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
