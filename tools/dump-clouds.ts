/**
 * The life of a cloud (`CreateCloud` + `ProcessTT_25`).
 *
 * Until this was ported, `createCloud` built the DB15 record, dropped it in the cell,
 * and stopped: no timer, so every cloud rendered at full size for the rest of the game
 * and none of them ever dealt damage. A single monster kill left a permanent puff on
 * the floor. What the timer adds is the whole of a cloud's behaviour — each type
 * shrinks or hurts on its own schedule, and dies by *not* rescheduling itself.
 *
 * What to look for in the output:
 *
 *  - A monster-death cloud steps 255 → 215 → 175 → 135 → 95 → 55 and is then gone from
 *    the cell. That is five visible ticks of shrinking, because the renderer scales the
 *    puff by `value` — which is what makes it read as a puff of smoke dispersing rather
 *    than a static sprite.
 *  - A poison cloud steps down by 3 instead, so it lingers far longer, and hurts
 *    whatever is standing in it on every one of those ticks.
 *  - A fireball bursts a door open (cell flag bottom bits 4 → 5) and does not linger at
 *    all — one tick and gone.
 *
 * Run: `npx tsx tools/dump-clouds.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, decodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { check, finish } from './lib/check';

const RN_FIREBALL = 0xff80;
const RN_POISON_CLOUD = 0xff87;
const RN_MONSTER_DEATH = 0xffa8;

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

  /** The first cloud sitting in a cell, or null. */
  const cloudIn = (game: Game, pos: Position): ObjectID | null => {
    const dungeon = game.dungeonState;
    for (let rn = dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      if (decodeObjectID(rn).category === DBType.CLOUD) return rn;
    }
    return null;
  };

  /**
   * Create a cloud and step the clock one tick at a time, recording its `value` until
   * it leaves the cell. Returns the values it passed through and how long it lived.
   */
  const watchCloud = async (
    projectile: number,
    size: number,
    at: Position,
  ): Promise<{ values: number[]; ticks: number }> => {
    const game = await makeGame();
    const dungeon = game.dungeonState;
    game.timerSystem.createDeathCloud(projectile, size, at, 255);

    const values: number[] = [];
    let ticks = 0;
    for (let t = 1; t <= 200; t++) {
      const rn = cloudIn(game, at);
      if (rn === null) break;
      values.push(dungeon.getCloudRecord(rn)?.value ?? -1);
      ticks = t;
      game.timerSystem.processTimers(t);
    }
    return { values, ticks };
  };

  /* ------------------------------------------------- 1. the monster-death cloud --- */

  const game0 = await makeGame();
  const start = game0.dungeonState.getStartPosition();
  const at = new Position(start.x, start.y, start.z);

  console.log('=== a monster-death cloud, tick by tick ===');
  const death = await watchCloud(RN_MONSTER_DEATH, 255, at);
  console.log(`value: ${death.values.join(' -> ')} -> gone after ${death.ticks} ticks`);

  check(death.values.length > 1, 'the death cloud actually shrinks rather than sitting still');
  check(death.values[0] === 255, `it starts at the size it was made with (got ${death.values[0]})`);
  check(death.values.join(',') === '255,215,175,135,95,55',
    `it steps down by 40 while over 55 (got ${death.values.join(',')})`);
  check(death.ticks <= 8, `and it is gone quickly (${death.ticks} ticks)`);

  // The record must leave the cell *and* be freed, or the DB fills up with dead clouds.
  const gameD = await makeGame();
  const cloudsBefore = gameD.dungeonState.getData().databases.clouds.records.length;
  gameD.timerSystem.createDeathCloud(RN_MONSTER_DEATH, 255, at, 255);
  const born = cloudIn(gameD, at);
  check(born !== null, 'the cloud is in the cell to begin with');
  for (let t = 1; t <= 20; t++) gameD.timerSystem.processTimers(t);
  check(cloudIn(gameD, at) === null, 'the cloud has left the cell');
  if (born !== null) {
    // `DeleteDBEntry` marks a DB15 free by setting its link to RNnul.
    const rec = gameD.dungeonState.getCloudRecord(born);
    check(rec !== null && rec.nextObject === OBJECT_ID_NULL,
      `the record was released by DeleteDBEntry (link is 0x${(rec?.nextObject ?? -1).toString(16)})`);
  }
  console.log(`cloud records: ${cloudsBefore} before, ` +
    `${gameD.dungeonState.getData().databases.clouds.records.length} after`);

  // And no timer is left behind pointing at a cloud that no longer exists.
  const leftovers = gameD.timerQueue.getTimers().filter((t) => t.function === 25);
  check(leftovers.length === 0, `no TT_25 timer outlives its cloud (${leftovers.length} left)`);

  /* -------------------------------------------------------- 2. a poison cloud ----- */

  console.log('');
  console.log('=== a poison cloud, tick by tick ===');
  const poison = await watchCloud(RN_POISON_CLOUD, 255, at);
  console.log(`value: ${poison.values.slice(0, 12).join(' -> ')}… -> gone after ${poison.ticks} ticks`);

  check(poison.values.length > death.values.length,
    `poison lingers far longer than a death puff (${poison.ticks} ticks against ${death.ticks})`);
  const step = (poison.values[0] ?? 0) - (poison.values[1] ?? 0);
  check(step === 3, `poison steps down by 3 a tick (got ${step})`);
  // The cut-off is tested *before* the subtraction (`doc/CSBwin-src/Timer.cpp:597`), so
  // the last tick a poison cloud lives through is the one where it is already under 6 —
  // 255 less a multiple of 3 lands on 3, not on 6.
  const lastPoison = poison.values[poison.values.length - 1]!;
  check(lastPoison === 3, `the last value before it goes is 3 (got ${lastPoison})`);
  check(poison.values.every((v) => v >= 0), 'it never goes negative');
  check(poison.ticks < 200, `and it does finish (${poison.ticks} ticks)`);

  /* ------------------------------------------- 3. a poison cloud hurts the party -- */

  console.log('');
  const gameP = await makeGame();
  const party = gameP.party.state;
  party.champions = [{
    name: 'VICTIM',
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([50, 50, 50, 50, 50, 0, 0]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [], weaponHand: null, shieldHand: null, quiver: null,
    possessions: new Array(30).fill(null),
    partyPosition: 0,
  }];
  const here = new Position(party.position.x, party.position.y, party.position.z);
  const healthBefore = party.champions[0]!.attributes.health;
  gameP.timerSystem.createDeathCloud(RN_POISON_CLOUD, 255, here, 255);
  for (let t = 1; t <= 120; t++) gameP.timerSystem.processTimers(t);
  const healthAfter = party.champions[0]!.attributes.health;
  console.log(`champion standing in a poison cloud: ${healthBefore} -> ${healthAfter} health`);
  check(healthAfter < healthBefore, 'a poison cloud hurts a champion standing in it');

  /* --------------------------------------------------- 4. a fireball on a door ---- */

  console.log('');
  const gameF = await makeGame();
  const dungeonF = gameF.dungeonState;

  // Find a door that a fireball is allowed to blow open.
  let doorAt: Position | null = null;
  outer:
  for (let level = 0; level < 14 && doorAt === null; level++) {
    const map = dungeonF.getMap(level);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const flag = map.cellFlags[x]?.[y] ?? 0;
        if (((flag >> 5) & 7) !== RoomType.DOOR) continue;
        if ((flag & 7) !== 4) continue; // must start closed
        const pos = new Position(x, y, level);
        const rn = dungeonF.findFirstObject(pos);
        if (rn === OBJECT_ID_EOF) continue;
        if (decodeObjectID(rn).category !== DBType.DOOR) continue;
        const door = dungeonF.getDoorRecordByIndex(decodeObjectID(rn).index);
        if (!door?.destructibleByFireball) continue;
        doorAt = pos;
        break outer;
      }
    }
  }

  if (doorAt === null) {
    check(false, 'the dungeon has a closed, fireball-destructible door to test');
  } else {
    const map = dungeonF.getMap(doorAt.z)!;
    const before = map.cellFlags[doorAt.x]![doorAt.y]! & 7;
    // A big fireball, so the force clears the door type's DoorTOC threshold.
    gameF.timerSystem.createDeathCloud(RN_FIREBALL, 255, doorAt, 255);
    for (let t = 1; t <= 10; t++) gameF.timerSystem.processTimers(t);
    const after = map.cellFlags[doorAt.x]![doorAt.y]! & 7;
    console.log(`=== a fireball at the door on level ${doorAt.z} (${doorAt.x},${doorAt.y}) ===`);
    console.log(`door state ${before} -> ${after} (5 is burst open)`);
    check(before === 4, 'the door started closed');
    check(after === 5, `the fireball burst it open (state ${after})`);
    check(cloudIn(gameF, doorAt) === null, 'the fireball did not linger');
  }

  /* ------------------------------------- 5. the real thing: kill a monster -------- */

  console.log('');
  // Level 2, not 3: level 3 currently livelocks the timer pass (see PLAN.md, "the
  // level-3 monster timer stall"), which would stop the cloud's timer from ever running
  // and make this look like a cloud bug.
  console.log('=== killing a real monster on level 2 ===');
  const gameK = await makeGame();
  const level = 2;
  gameK.party.state.position = new Position(6, 14, level);
  gameK.monsterSystem.loadPartyLevelIfChanged();
  gameK.timerSystem.processTimers(0);

  // Find any activated group and kill it outright.
  const pool = gameK.dungeonState.getItem16Pool().filter((s) => s.word0 >= 0);
  check(pool.length > 0, `level ${level} activated a monster group to kill (${pool.length})`);
  const victim = pool[0];
  if (victim) {
    const rec = gameK.dungeonState.getCreatureRecordByIndex(victim.word0);
    const where = new Position(victim.uByte10, victim.uByte11, level);
    if (!rec) {
      check(false, 'the group has a DB4 record');
    } else {
      gameK.monsterDamage.damageMonsterGroup(rec, level, where.x, where.y, 10000, true, false);
      const puff = cloudIn(gameK, where);
      console.log(`a dead monster at (${where.x},${where.y}) left ` +
        `${puff === null ? 'no cloud' : `a cloud of value ${gameK.dungeonState.getCloudRecord(puff)?.value}`}`);
      check(puff !== null, 'killing a monster leaves a death cloud');

      let lived = 0;
      for (let t = 1; t <= 30; t++) {
        gameK.timerSystem.processTimers(t);
        if (cloudIn(gameK, where) === null) { lived = t; break; }
      }
      console.log(`it cleared after ${lived} ticks`);
      check(lived > 0 && lived <= 10, `and it cleared on its own (${lived} ticks)`);
    }
  }

  console.log('');
  finish();
}

main();
