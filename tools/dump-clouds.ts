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
 *  - `CreateCloud`'s own sound (`doc/CSBwin-src/Code11f52.cpp:1467-1475`) is
 *    `QueueSound(size>80 ? 5 : 20, ...)` for a fireball — two *ordinals* into the sound
 *    table that both resolve to the same SND item, so a small blast is meant to be a
 *    quieter version of the same explosion, not a different sound. `playCloudSound`
 *    used to call `playSound(SoundIndex.SPELL_EXPLODE)` for the small case — a
 *    different sample entirely (ordinal 13's, not 20's).
 *
 * Run: `npx tsx tools/dump-clouds.ts`
 */
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../src/core/types';
import { Game } from '../src/engine/Game';
import { SoundQueue } from '../src/engine/SoundQueue';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { newGame, processTimersAt, stockDungeon, stockGraphics } from './lib/game';
import { standIn } from './lib/standIn';
import { check, finish } from './lib/check';
import { RN_FIREBALL, RN_POISON_CLOUD, RN_MONSTER_DEATH } from '../src/core/spellRn';
import { testChampion } from './lib/champion';


async function main(): Promise<void> {
  const graphics = stockGraphics();

  const makeGame = async (): Promise<Game> => {
    const data = stockDungeon();
    const game = newGame(data, graphics);
    // Fixed seed, so the numbers below repeat run to run. This used to sit *after* a
    // `return new Game(...)` — dead code, so every run of this tool was unseeded
    // despite the comment. `tsc` never saw it because `tools/` was outside the
    // type gate; it is inside it now.
    game.setRandomSeed(0x12345678);
    return game;
  };

  /** The first cloud sitting in a cell, or null. */
  const cloudIn = (game: Game, pos: Position): ObjectID | null => {
    const dungeon = game.ctx.dungeon;
    for (let rn = dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      if (game.ctx.dungeon.rnMaps.dbType(rn) === DBType.CLOUD) return rn;
    }
    return null;
  };

  /**
   * Create a cloud and step the clock one tick at a time, recording its `value` until
   * it leaves the cell. Returns the values it passed through and how long it lived.
   */
  const watchCloud = async (
    projectile: ObjectID,
    size: number,
    at: Position,
  ): Promise<{ values: number[]; ticks: number }> => {
    const game = await makeGame();
    const dungeon = game.ctx.dungeon;
    game.systems.missileEncounter.createDeathCloud(projectile, size, at, 255);

    const values: number[] = [];
    let ticks = 0;
    for (let t = 1; t <= 200; t++) {
      const rn = cloudIn(game, at);
      if (rn === null) break;
      values.push(dungeon.getCloudRecord(rn)?.value ?? -1);
      ticks = t;
      processTimersAt(game, t);
    }
    return { values, ticks };
  };

  /* ------------------------------------------------- 1. the monster-death cloud --- */

  const game0 = await makeGame();
  const start = game0.ctx.dungeon.getStartPosition();
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
  const cloudsBefore = gameD.ctx.dungeon.getData().databases.clouds.records.length;
  gameD.systems.missileEncounter.createDeathCloud(RN_MONSTER_DEATH, 255, at, 255);
  const born = cloudIn(gameD, at);
  check(born !== null, 'the cloud is in the cell to begin with');
  const bornIndex = born === null ? -1 : gameD.ctx.dungeon.rnMaps.idx(born);
  for (let t = 1; t <= 20; t++) processTimersAt(gameD, t);
  check(cloudIn(gameD, at) === null, 'the cloud has left the cell');
  if (born !== null) {
    // `DeleteDBEntry` marks a DB15 free by setting its link to RNnul, and frees its slot.
    const rec = gameD.ctx.dungeon.getData().databases.clouds.records[bornIndex];
    check(rec !== undefined && rec.nextObject === OBJECT_ID_NULL && gameD.ctx.dungeon.rnMaps.dbType(born) === DBType.UNKNOWN,
      `the record was released by DeleteDBEntry (link is 0x${(rec?.nextObject ?? -1).toString(16)}), its slot with it`);
  }
  console.log(`cloud records: ${cloudsBefore} before, ` +
    `${gameD.ctx.dungeon.getData().databases.clouds.records.length} after`);

  // And no timer is left behind pointing at a cloud that no longer exists.
  const leftovers = gameD.ctx.timers.getTimers().filter((t) => t.function === 25);
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
  const party = gameP.ctx.party.state;
  party.champions = [testChampion(0, {
    name: 'VICTIM',
    attributes: { mana: 0, maxMana: 0, stats: makeAddCharacterAttributes([50, 50, 50, 50, 50, 0, 0]) },
  })];
  const here = new Position(party.position.x, party.position.y, party.position.z);
  const healthBefore = party.champions[0]!.attributes.health;
  gameP.systems.missileEncounter.createDeathCloud(RN_POISON_CLOUD, 255, here, 255);
  for (let t = 1; t <= 120; t++) processTimersAt(gameP, t);
  const healthAfter = party.champions[0]!.attributes.health;
  console.log(`champion standing in a poison cloud: ${healthBefore} -> ${healthAfter} health`);
  check(healthAfter < healthBefore, 'a poison cloud hurts a champion standing in it');

  /* --------------------------------------------------- 4. a fireball on a door ---- */

  console.log('');
  const gameF = await makeGame();
  const dungeonF = gameF.ctx.dungeon;

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
        if (dungeonF.rnMaps.dbType(rn) !== DBType.DOOR) continue;
        const door = dungeonF.getDoorRecordByIndex(dungeonF.rnMaps.idx(rn));
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
    gameF.systems.missileEncounter.createDeathCloud(RN_FIREBALL, 255, doorAt, 255);
    for (let t = 1; t <= 10; t++) processTimersAt(gameF, t);
    const after = map.cellFlags[doorAt.x]![doorAt.y]! & 7;
    console.log(`=== a fireball at the door on level ${doorAt.z} (${doorAt.x},${doorAt.y}) ===`);
    console.log(`door state ${before} -> ${after} (5 is burst open)`);
    check(before === 4, 'the door started closed');
    check(after === 5, `the fireball burst it open (state ${after})`);
    check(cloudIn(gameF, doorAt) === null, 'the fireball did not linger');
  }

  /* ------------------------------------ 4b. the sound ordinal a blast plays ------ */

  console.log('');
  console.log('=== fireball impact sound: ordinal by blast size ===');
  const soundOrdinal = async (size: number): Promise<number | null> => {
    const game = await makeGame();
    let ordinal: number | null = null;
    const original = SoundQueue.prototype.queueSound;
    const restore = standIn(SoundQueue.prototype, 'queueSound', function (this: SoundQueue, o, mapX, mapY, deltaTime, level) {
      ordinal = o;
      return original.call(this, o, mapX, mapY, deltaTime, level);
    });
    game.systems.missileEncounter.createDeathCloud(RN_FIREBALL, size, at, 255);
    restore();
    return ordinal;
  };
  const bigOrdinal = await soundOrdinal(200);
  const smallOrdinal = await soundOrdinal(40);
  console.log(`size 200 (>80): ordinal ${bigOrdinal}; size 40 (<=80): ordinal ${smallOrdinal}`);
  check(bigOrdinal === 5, `a big blast plays ordinal 5 (got ${bigOrdinal})`);
  check(smallOrdinal === 20, `a small blast plays ordinal 20, not ordinal 13's sample (got ${smallOrdinal})`);

  /* ------------------------------------- 5. the real thing: kill a monster -------- */

  console.log('');
  // Level 2, not 3: level 3 currently livelocks the timer pass (see PLAN.md, "the
  // level-3 monster timer stall"), which would stop the cloud's timer from ever running
  // and make this look like a cloud bug.
  console.log('=== killing a real monster on level 2 ===');
  const gameK = await makeGame();
  const level = 2;
  gameK.ctx.party.state.position = new Position(6, 14, level);
  gameK.systems.monsters.loadPartyLevelIfChanged();
  processTimersAt(gameK, 0);

  // Find any activated group and kill it outright.
  const pool = gameK.ctx.dungeon.getItem16Pool().filter((s) => s.word0 >= 0);
  check(pool.length > 0, `level ${level} activated a monster group to kill (${pool.length})`);
  const victim = pool[0];
  if (victim) {
    const rec = gameK.ctx.dungeon.getCreatureRecordByIndex(victim.word0);
    const where = new Position(victim.uByte10, victim.uByte11, level);
    if (!rec) {
      check(false, 'the group has a DB4 record');
    } else {
      gameK.systems.monsterDamage.damageMonsterGroup(rec, level, where.x, where.y, 10000, true, false);
      const puff = cloudIn(gameK, where);
      console.log(`a dead monster at (${where.x},${where.y}) left ` +
        `${puff === null ? 'no cloud' : `a cloud of value ${gameK.ctx.dungeon.getCloudRecord(puff)?.value}`}`);
      check(puff !== null, 'killing a monster leaves a death cloud');

      let lived = 0;
      for (let t = 1; t <= 30; t++) {
        processTimersAt(gameK, t);
        if (cloudIn(gameK, where) === null) { lived = t; break; }
      }
      console.log(`it cleared after ${lived} ticks`);
      check(lived > 0 && lived <= 10, `and it cleared on its own (${lived} ticks)`);
    }
  }

  /* ------------------------------------------- 6. a Fluxcage runs out ---------- */

  // `CreateFluxcage` (`doc/CSBwin-src/Code11f52.cpp:1550-1574`) queues a `TT_24` at
  // `d.Time + 100` whose `timerObj8()` is the cage; `TT_24` (`CSBCode.cpp:6553-6569`)
  // takes that object out of its square and frees its record. The port used to read the
  // object off `timerWord8`, which a live cage's timer leaves at 0 — so the cage stayed,
  // and `DeleteDBEntry(0)` freed door record 0, cutting its cell's chain.
  console.log('');
  console.log('=== a Fluxcage runs out ===');
  const gameX = await makeGame();
  const dungeonX = gameX.ctx.dungeon;
  const door0 = dungeonX.getDoorRecordByIndex(0);
  const door0Link = door0?.nextObject;
  const cage = gameX.systems.missileEncounter.createFluxcage(at, 0);
  check(cage !== null && cloudIn(gameX, at) === cage, 'the cage stands in the cell');
  const cageIndex = cage === null ? -1 : dungeonX.rnMaps.idx(cage);
  for (let t = 1; t <= 99; t++) processTimersAt(gameX, t);
  check(cloudIn(gameX, at) === cage, 'it is still there at tick 99');
  processTimersAt(gameX, 100);
  check(cloudIn(gameX, at) === null, 'it leaves the cell at tick 100');
  const cageRec = dungeonX.getData().databases.clouds.records[cageIndex];
  check(cageRec !== undefined && cageRec.nextObject === OBJECT_ID_NULL && dungeonX.rnMaps.dbType(cage!) === DBType.UNKNOWN,
    `its record and its slot are freed (link 0x${(cageRec?.nextObject ?? -1).toString(16)})`);
  check(door0?.nextObject === door0Link,
    `door record 0 is untouched (link 0x${(door0Link ?? -1).toString(16)} -> 0x${(door0?.nextObject ?? -1).toString(16)})`);

  console.log('');
  finish();
}

main();
