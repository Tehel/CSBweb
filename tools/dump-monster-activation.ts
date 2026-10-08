/**
 * Prove that the monster group lifecycle actually runs.
 *
 * Loads the real dungeon, stands a `MonsterSystem` up on a level that has creatures
 * and runs `ProcessMonstersOnLevel`, then reports which groups got an `ITEM16` slot
 * and what AI timer each was given. Without this there is nothing to look at: a
 * monster with a slot renders exactly like one without.
 *
 * Run: `npx tsx tools/dump-monster-activation.ts [level]`  (default: level 3)
 */
import { DungeonState } from '../src/engine/DungeonState';
import { MonsterSystem } from '../src/engine/MonsterSystem';
import { TimerQueue, TimerFunction } from '../src/engine/TimerQueue';
import { CsbRandom } from '../src/core/random';
import { MonsterType } from '../src/engine/monsterTypes';
import type { PartyState } from '../src/engine/gameTypes';
import { graphicsTablesOf, newContext, stockDungeon, stockGraphics } from './lib/game';
import { check, fail, finish } from './lib/check';

async function main(): Promise<void> {
  const data = stockDungeon();
  const graphics = stockGraphics();
  const objectTables = graphicsTablesOf(graphics).objects;

  const dungeon = new DungeonState(data);
  const start = dungeon.getStartPosition();
  // Default to level 3, not the party's starting level: level 0 has no creatures at all,
  // so the no-argument run used to activate nothing and check nothing.
  const level = process.argv[2] !== undefined ? Number(process.argv[2]) : 3;

  const party = { position: { x: start.x, y: start.y, z: level }, champions: [], brightness: 0 } as unknown as PartyState;
  const timers = new TimerQueue();
  // A fixed seed: the point is a repeatable listing, not a realistic game.
  const ctx = newContext(data, graphics, { dungeon, timers, random: new CsbRandom(0x12345678) });
  ctx.party.state = party;
  const monsters = new MonsterSystem(ctx);

  monsters.loadPartyLevel(level);

  const pool = dungeon.getItem16Pool();
  const active = pool.filter((s) => s.word0 >= 0);
  console.log(`level ${level}: ${active.length} monster group(s) activated, pool size ${pool.length}`);
  console.log('');
  console.log(['slot', 'db4', 'type', 'name', 'n', 'at', 'facings', 'positions', 'sms'].join('\t'));
  pool.forEach((slot, index) => {
    if (slot.word0 < 0) return;
    const rec = dungeon.getCreatureRecordByIndex(slot.word0);
    if (!rec) return;
    console.log([
      index,
      slot.word0,
      rec.creatureType,
      MonsterType[rec.creatureType] ?? '?',
      (rec.numMonM1 & 3) + 1,
      `(${slot.uByte10},${slot.uByte11})`,
      '0x' + slot.facings.toString(16).padStart(2, '0'),
      '0x' + slot.positions.toString(16).padStart(2, '0'),
      slot.singleMonsterStatus.map((v) => v.toString(16).padStart(2, '0')).join(' '),
    ].join('\t'));
  });

  const aiTimers = timers.getTimers().filter(
    (t) => t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI,
  );
  console.log('');
  console.log(`${aiTimers.length} monster AI timer(s) queued:`);
  for (const t of aiTimers) {
    console.log(
      `  t=${t.time} L${t.level} (${t.uByte6},${t.uByte7}) fn=${TimerFunction[t.function] ?? t.function} uByte5=${t.uByte5}`,
    );
  }

  // Every group must have exactly one timer, no monster may keep a stale slot, and each
  // timer's countdown must be the one its own type asks for.
  console.log('');
  check(active.length > 0, `the level activated at least one group (got ${active.length})`);
  check(aiTimers.length === active.length,
    `one AI timer per active group (${aiTimers.length} timers, ${active.length} groups)`);

  for (const slot of active) {
    const rec = dungeon.getCreatureRecordByIndex(slot.word0);
    if (!rec) { fail(`slot for db4 ${slot.word0} has no record`); continue; }
    check(dungeon.getAttachedItem16(rec) === slot,
      `db4 ${slot.word0} groupIndex ${rec.groupIndex} points back at its own slot`);

    // `StartMonsterMovementTimers` stores `255 - movementTicks06` in the timer, so a
    // slow monster's timer carries a small number. This is the canary that the timer
    // belongs to *this* group rather than being a generic one.
    const timer = aiTimers.find((t) => t.uByte6 === slot.uByte10 && t.uByte7 === slot.uByte11);
    const want = 255 - (objectTables.monsterDesc[rec.creatureType]?.movementTicks06 ?? 0);
    if (!timer) {
      fail(`db4 ${slot.word0} at (${slot.uByte10},${slot.uByte11}) has no AI timer at its square`);
    } else {
      check(timer.uByte5 === want,
        `${MonsterType[rec.creatureType] ?? rec.creatureType} at (${slot.uByte10},${slot.uByte11}) ` +
        `has uByte5 ${timer.uByte5}, expected 255 - movementTicks06 = ${want}`);
    }
  }
  finish();
}

main();
