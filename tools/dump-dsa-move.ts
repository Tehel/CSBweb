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
 * The move itself is the low-level `MoveObject` (`Code11f52.cpp:2796`): lift with
 * `MoveObject(obj, x, y, -1, 0)`, set down with `MoveObject(obj, -1, 0, x, y)`
 * (`MoveObject.cpp:203-220`, `:531-538`). The port spliced the chains directly, so:
 *  4. an item set down on an active teleporter stayed on it instead of being carried on;
 *  5. an item set down on an open pit stayed on it instead of falling — and so did a
 *     cloud, which is not `Levitating` (`Code11f52.cpp:2417-2437`);
 *  6. a monster moved within the party's level keeps its `ITEM16`, and its AI timers
 *     follow it to the new square (`MoveObject.cpp:539-571`); the port left them behind;
 *  7. a monster moved off the party's level has `groupIndex` 0xd8 / 0xff (`:504-521`);
 *  8. a monster moved onto the party's level gets an `ITEM16` and its first AI timers
 *     (`Code11f52.cpp:3363-3405`); the port gave it neither.
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
import { createMonsterAt } from './lib/createMonster';

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

  /** The first square on any level that `pred` accepts. */
  const findSquare = (game: Game, pred: (p: Position) => boolean): Position | null => {
    const dungeon = game.dungeonState;
    for (let z = 0; z < dungeon.getMapCount(); z++) {
      const map = dungeon.getMap(z);
      if (!map) continue;
      for (let x = 0; x < map.descriptor.width; x++) {
        for (let y = 0; y < map.descriptor.height; y++) {
          const p = new Position(x, y, z);
          if (pred(p)) return p;
        }
      }
    }
    return null;
  };
  const roomType = (game: Game, p: Position): number => (game.dungeonState.getCellFlag(p) >> 5) & 7;
  const emptyOpen = (game: Game, p: Position): boolean =>
    roomType(game, p) === RoomType.OPEN && game.dungeonState.findFirstObject(p) === OBJECT_ID_EOF;
  const holding = (game: Game, p: Position, rn: ObjectID): boolean =>
    inCell(game, p, decodeObjectID(rn).category).some((r) => (r & 0x3fff) === (rn & 0x3fff));
  /** An item lying on a floor somewhere: the thing the DSA moves. */
  const anItem = (game: Game): { at: Position; rn: ObjectID } => {
    let found: { at: Position; rn: ObjectID } | null = null;
    findSquare(game, (p) => {
      if (roomType(game, p) !== RoomType.OPEN) return false;
      const rn = inCell(game, p, DBType.WEAPON)[0];
      if (rn === undefined) return false;
      found = { at: p, rn };
      return true;
    });
    if (!found) throw new Error('no weapon on any floor');
    return found;
  };

  /* ------------------------------------- 4. an item onto an active teleporter ---- */
  {
    const game = await makeGame();
    const dungeon = game.dungeonState;
    const { at, rn } = anItem(game);
    let dest: Position | null = null;
    const tele = findSquare(game, (p) => {
      if (roomType(game, p) !== RoomType.TELEPORTER || (dungeon.getCellFlag(p) & 0x08) === 0) return false;
      const t = inCell(game, p, DBType.TELEPORTER)[0];
      const rec = t !== undefined ? dungeon.getTeleporterRecord(t) : null;
      if (!rec || (rec.scope & 3) === 1) return false;
      const level = findSquare(game, (q) => q.x === 0 && q.y === 0 && dungeon.getMap(q.z)?.descriptor.level === (rec.destMap & 0xff));
      if (!level) return false;
      dest = new Position(rec.destX & 0x1f, rec.destY & 0x1f, level.z);
      return roomType(game, dest) !== RoomType.TELEPORTER && !(dest.x === p.x && dest.y === p.y && dest.z === p.z);
    });
    if (!tele || !dest) throw new Error('no active item teleporter');
    const to: Position = dest;
    const result = move(game, DBType.WEAPON, at, tele, 0);
    console.log(`4. item ${rn.toString(16)} (${at.x},${at.y}) L${at.z} -> teleporter (${tele.x},${tele.y}) L${tele.z}, `
      + `which sends to (${to.x},${to.y}) L${to.z}: result ${result}, on the teleporter ${holding(game, tele, rn)}, at its destination ${holding(game, to, rn)}`);
    check(result === 0 && !holding(game, at, rn), 'the item leaves its square');
    check(!holding(game, tele, rn), 'it does not stay on the active teleporter');
    check(holding(game, to, rn), "it is carried on to the teleporter's destination");
  }

  /* ------------------------------------------- 5. an item and a cloud down a pit ---- */
  {
    const game = await makeGame();
    const dungeon = game.dungeonState;
    const { at, rn } = anItem(game);
    const pit = findSquare(game, (p) => {
      const flag = dungeon.getCellFlag(p);
      return roomType(game, p) === RoomType.PIT && (flag & 0x08) !== 0 && (flag & 0x01) === 0
        && dungeon.incrementLevel(p, 1) !== null;
    });
    if (!pit) throw new Error('no open pit');
    const below = dungeon.incrementLevel(pit, 1)!;
    const result = move(game, DBType.WEAPON, at, pit, 0);
    console.log(`5. item -> pit (${pit.x},${pit.y}) L${pit.z}: result ${result}, on the pit ${holding(game, pit, rn)}, `
      + `below (${below.x},${below.y}) L${below.z} ${holding(game, below, rn)}`);
    check(!holding(game, pit, rn) && holding(game, below, rn), 'an item set down on an open pit falls to the level below');

    const start = dungeon.getStartPosition();
    const from = new Position(start.x, start.y, start.z);
    game.timerSystem.createDeathCloud(RN_POISON_CLOUD, 60, from, 255);
    const cloud = inCell(game, from, DBType.CLOUD)[0]!;
    const cloudResult = move(game, DBType.CLOUD, from, pit, 0);
    console.log(`5b. cloud -> the same pit: result ${cloudResult}, on the pit ${holding(game, pit, cloud)}, below ${holding(game, below, cloud)}`);
    check(!holding(game, pit, cloud) && holding(game, below, cloud), 'so does a cloud: only a missile or a flying monster is Levitating');
  }

  /* --------------------------------------------------------- 6-8. monsters ---- */
  {
    /**
     * A game with the party on level `a` and a group made on `level` at `at`. Its type
     * is allowed on both `a` and `b`: `MoveObject` deletes a group that ends on a level
     * its type may not live on (`doc/CSBwin-src/Code11f52.cpp:3147-3176`).
     */
    const withMonster = async (level: number, at: (g: Game, z: number) => Position): Promise<{
      game: Game; party: number; other: number; rn: ObjectID; where: Position;
    }> => {
      const game = await makeGame();
      const dungeon = game.dungeonState;
      let pick: [number, number, number] | null = null;
      for (let a = 0; a < dungeon.getMapCount() && !pick; a++) {
        for (let b = a + 1; b < dungeon.getMapCount() && !pick; b++) {
          for (let t = 0; t < 27 && !pick; t++) {
            if (dungeon.monsterAllowedOnLevel(t, a) && dungeon.monsterAllowedOnLevel(t, b)) pick = [a, b, t];
          }
        }
      }
      if (!pick) throw new Error('no monster type is allowed on two levels');
      const [a, b, type] = pick;
      const partySquare = findSquare(game, (p) => p.z === a && emptyOpen(game, p))!;
      game.party.state.position = partySquare;
      game.monsterSystem.loadPartyLevel(a);
      const z = level === 0 ? a : b;
      const where = at(game, z);
      const rn = createMonsterAt(game, {
        value: type, hitPointMultiplier: 1, numMonM1: 0, facing: 0,
        mapX: where.x, mapY: where.y, level: z, invisible: false, drawAsSize4: false,
      });
      if (rn === null) throw new Error('createMonster failed');
      return { game, party: a, other: b, rn, where };
    };
    const aiTimersAt = (game: Game, p: Position): number => game.timerQueue.getTimers().filter((t) =>
      t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI
      && t.uByte6 === p.x && t.uByte7 === p.y && t.level === p.z).length;
    const openOn = (game: Game, z: number, not: Position[]): Position => findSquare(game, (p) =>
      p.z === z && emptyOpen(game, p) && !not.some((q) => q.x === p.x && q.y === p.y && q.z === p.z)
      && !(game.party.state.position.x === p.x && game.party.state.position.y === p.y && game.party.state.position.z === p.z))!;

    {
      const { game, rn, where, party } = await withMonster(0, (g, z) => openOn(g, z, []));
      const group = game.dungeonState.getCreatureRecord(rn)!;
      const before = group.groupIndex;
      const timersBefore = aiTimersAt(game, where);
      const to = openOn(game, party, [where]);
      const result = move(game, DBType.CREATURE, where, to, 0);
      console.log(`6. monster on the party's level (${where.x},${where.y}) -> (${to.x},${to.y}) L${party}: result ${result}, `
        + `groupIndex ${before} -> ${group.groupIndex}, AI timers ${timersBefore} at the old square -> ${aiTimersAt(game, where)}, ${aiTimersAt(game, to)} at the new`);
      check(result === 0 && holding(game, to, rn) && !holding(game, where, rn), 'the group moves');
      check(before < 60 && group.groupIndex === before, 'it keeps its ITEM16');
      check(timersBefore > 0 && aiTimersAt(game, where) === 0 && aiTimersAt(game, to) === timersBefore,
        'its AI timers follow it to the new square');
    }
    {
      const { game, rn, where, other } = await withMonster(0, (g, z) => openOn(g, z, []));
      const group = game.dungeonState.getCreatureRecord(rn)!;
      const before = group.groupIndex;
      const to = openOn(game, other, []);
      const result = move(game, DBType.CREATURE, where, to, 0);
      console.log(`7. monster off the party's level -> (${to.x},${to.y}) L${other}: result ${result}, groupIndex ${before} -> ${group.groupIndex}`);
      check(result === 0 && holding(game, to, rn), 'the group moves to the other level');
      check(group.groupIndex === 0xd8 || group.groupIndex === 0xff, 'groupIndex becomes 0xd8 / 0xff: it has no ITEM16 there');
    }
    {
      const { game, rn, where, party } = await withMonster(1, (g, z) => openOn(g, z, []));
      const group = game.dungeonState.getCreatureRecord(rn)!;
      const before = group.groupIndex;
      const to = openOn(game, party, []);
      const result = move(game, DBType.CREATURE, where, to, 0);
      console.log(`8. monster from L${where.z} onto the party's level (${to.x},${to.y}) L${party}: result ${result}, `
        + `groupIndex ${before} -> ${group.groupIndex}, AI timers at the new square ${aiTimersAt(game, to)}`);
      check(result === 0 && holding(game, to, rn), "the group moves onto the party's level");
      check(before >= 60 && group.groupIndex < 60, 'it gets an ITEM16');
      check(aiTimersAt(game, to) > 0, 'and its first AI timers');
    }
  }

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
