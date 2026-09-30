/**
 * Exercise the monster form of `MoveObject`.
 *
 * Four things need to hold when a group moves, and none of them are visible without
 * looking: the record leaves one cell and appears in the other; its `ITEM16` keeps
 * `uByte10`/`uByte11` and `ubPrevX`/`ubPrevY` — only `AttachItem16ToMonster` sets the
 * first pair (`CSBCode.cpp:6088-6090`), the AI caller the second; its AI timers stay behind at the
 * square it left, since `MoveObject` never re-aims them; and a move onto an occupied square parks
 * the group on an abeyance timer instead of losing it — up to 31 of them per square, past
 * which an ordinary group is deleted.
 *
 * Run: `npx tsx tools/dump-monster-move.ts [level]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, decodeObjectID, encodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { TimerFunction } from '../src/engine/TimerQueue';
import { MonsterType } from '../src/engine/monsterTypes';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

  const level = Number(process.argv[2] ?? 2);
  const game = newGame(data, graphics);
  // Stand the party somewhere on the target level so it becomes the loaded level.
  game.ctx.party.state.position = new Position(0, 0, level);
  game.systems.monsters.loadPartyLevel(level);

  const dungeon = game.ctx.dungeon;
  const pool = dungeon.getItem16Pool();
  const active = pool.map((slot, i) => ({ slot, i })).filter((e) => e.slot.word0 >= 0);
  console.log(`level ${level}: ${active.length} group(s)\n`);

  const isOpen = (x: number, y: number): boolean => {
    const map = dungeon.getMap(level);
    if (!map || x < 0 || y < 0 || x >= map.descriptor.width || y >= map.descriptor.height) return false;
    const rt = (dungeon.getCellFlag(new Position(x, y, level)) >> 5) & 7;
    return rt === RoomType.OPEN;
  };
  const monsterAt = (x: number, y: number): boolean => {
    for (let rn = dungeon.findFirstObject(new Position(x, y, level)); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      if (decodeObjectID(rn).category === DBType.CREATURE) return true;
    }
    return false;
  };

  // ---- Case 1: an ordinary one-square move -------------------------------
  const mover = active.find(({ slot }) => {
    const mx = slot.uByte10, my = slot.uByte11;
    return [[0,-1],[1,0],[0,1],[-1,0]].some(([dx, dy]) =>
      isOpen(mx + dx!, my + dy!) && !monsterAt(mx + dx!, my + dy!));
  });
  if (mover) {
    const rec = dungeon.getCreatureRecordByIndex(mover.slot.word0)!;
    const mx = mover.slot.uByte10, my = mover.slot.uByte11;
    const [dx, dy] = [[0,-1],[1,0],[0,1],[-1,0]].find(([ddx, ddy]) =>
      isOpen(mx + ddx!, my + ddy!) && !monsterAt(mx + ddx!, my + ddy!))!;
    const nx = mx + dx!, ny = my + dy!;
    const rn = game.ctx.dungeon.findFirstMonster(new Position(mx, my, level));
    const [prevX, prevY] = [mover.slot.ubPrevX, mover.slot.ubPrevY];

    const timersBefore = game.ctx.timers.getTimers()
      .filter(t => t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI
        && t.uByte6 === mx && t.uByte7 === my).length;

    console.log(`Case 1 — move a ${MonsterType[rec.creatureType]} from (${mx},${my}) to (${nx},${ny})`);
    const result = game.systems.monsters.moveMonster(rn, mx, my, nx, ny, level);
    console.log(`  code=${result.code}`);

    const timersAtOld = game.ctx.timers.getTimers()
      .filter(t => t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI
        && t.uByte6 === mx && t.uByte7 === my).length;
    const timersAtNew = game.ctx.timers.getTimers()
      .filter(t => t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI
        && t.uByte6 === nx && t.uByte7 === ny).length;
    console.log(`  AI timers: (${mx},${my})=${timersAtOld} (${nx},${ny})=${timersAtNew} (was ${timersBefore})`);
    console.log(`  ITEM16 now at (${mover.slot.uByte10},${mover.slot.uByte11}), prev (${mover.slot.ubPrevX},${mover.slot.ubPrevY})`);

    check(result.code === 0, 'the move should have succeeded');
    check(!monsterAt(mx, my), 'the old cell should no longer hold the creature');
    check(monsterAt(nx, ny), 'the new cell should hold the creature');
    // `MoveObject` does not re-aim them; the AI caller re-aims the one it is processing
    // (doc/CSBwin-src/Monster.cpp:2440), and only a DSA move re-aims the rest.
    check(timersAtOld === timersBefore && timersAtNew === 0, 'the AI timers should stay where they were');
    check(mover.slot.uByte10 === mx && mover.slot.uByte11 === my,
      "MoveObject leaves ITEM16's uByte10/11 alone (only AttachItem16ToMonster sets them)");
    check(mover.slot.ubPrevX === prevX && mover.slot.ubPrevY === prevY, "MoveObject leaves ITEM16's ubPrevX/Y alone");
    console.log('');
  }

  // ---- Case 2: moving onto another monster parks it in abeyance ----------
  const pair = active.filter(({ slot }) => slot.word0 >= 0);
  if (pair.length >= 2) {
    const a = pair[0]!, b = pair[1]!;
    const ax = a.slot.uByte10, ay = a.slot.uByte11;
    const bx = b.slot.uByte10, by = b.slot.uByte11;
    const rn = game.ctx.dungeon.findFirstMonster(new Position(ax, ay, level));
    if (rn !== OBJECT_ID_EOF && !(ax === bx && ay === by)) {
      console.log(`Case 2 — move a group from (${ax},${ay}) onto the occupied (${bx},${by})`);
      const result = game.systems.monsters.moveMonster(rn, ax, ay, bx, by, level);
      const abeyance = game.ctx.timers.getTimers()
        .filter(t => t.function === TimerFunction.TT_60 || t.function === TimerFunction.TT_61);
      console.log(`  code=${result.code}, abeyance timers: ${abeyance.length}`);
      check(result.code === 1, 'the group should have been removed to abeyance');
      check(abeyance.length === 1, 'exactly one abeyance timer should exist');
      check(abeyance[0]?.object === rn, 'the abeyance timer should carry the monster');
      check(!monsterAt(ax, ay), 'the group should have left its old cell');
      console.log('');

      // ---- Case 3: the abeyance timer retries and eventually places it ----
      // Its target is still occupied, so the first retry must reschedule, not place.
      const t = abeyance[0]!;
      game.ctx.timers.deleteTimer(t.index);
      game.systems.monsters.processAbeyanceTimer(t);
      const still = game.ctx.timers.getTimers()
        .filter(x => x.function === TimerFunction.TT_60 || x.function === TimerFunction.TT_61);
      console.log(`Case 3 — retry while still blocked: abeyance timers ${still.length}, t=${still[0]?.time}`);
      check(still.length === 1, 'the group should still be waiting');

      // Now clear the destination and retry: it should be placed.
      const bRn = game.ctx.dungeon.findFirstMonster(new Position(bx, by, level));
      dungeon.removeObjectFromCell(new Position(bx, by, level), bRn);
      const t2 = still[0]!;
      game.ctx.timers.deleteTimer(t2.index);
      game.systems.monsters.processAbeyanceTimer(t2);
      const after = game.ctx.timers.getTimers()
        .filter(x => x.function === TimerFunction.TT_60 || x.function === TimerFunction.TT_61);
      console.log(`  after clearing (${bx},${by}): abeyance timers ${after.length}, monster there = ${monsterAt(bx, by)}`);
      check(after.length === 0, 'the abeyance timer should be gone');
      check(monsterAt(bx, by), 'the group should now be placed');
      console.log('');
    }
  }

  // ---- Case 4: CreateMovementTimer's overflow guard ------------------------
  // `CreateMovementTimer` (doc/CSBwin-src/Code11f52.cpp:2446-2524) counts the
  // TT_60/TT_61 timers of its own kind already waiting on the square; from 31 up it
  // deletes the group instead of queueing a 32nd, unless the group is `Unique()` or
  // carries something (`:2473-2512`). `Unique()` is `drawAsSize4Monsters && bit 13`
  // (`CSB.h:1129`), and that design option is off in every dungeon we load, so a raw
  // bit 13 must not save a group.
  {
    const dest = new Position(1, 1, level);
    const parked = (): number => game.ctx.timers.getTimers()
      .filter(t => t.function === TimerFunction.TT_60 && t.uByte6 === dest.x && t.uByte7 === dest.y
        && t.level === dest.z).length;
    const creatures = data.databases.creatures.records;
    const pick = (i: number) => {
      const rn = encodeObjectID(0, DBType.CREATURE, i);
      const rec = dungeon.getCreatureRecord(rn)!;
      return { rn, rec };
    };
    const filler = pick(creatures.length - 1);
    const plain = pick(creatures.length - 2);
    const carrier = pick(creatures.length - 3);
    plain.rec.possession = OBJECT_ID_EOF;
    plain.rec.unique = true; // bit 13 set, option off: CSBWin's Unique() is false
    carrier.rec.possession = encodeObjectID(0, DBType.WEAPON, 0);
    carrier.rec.unique = false;

    const before = parked();
    for (let i = 0; i < 31; i++) game.systems.monsters.createMovementTimer(filler.rn, dest, false);
    const full = parked() - before;
    game.systems.monsters.createMovementTimer(plain.rn, dest, false);
    const afterPlain = parked() - before;
    const plainDeleted = plain.rec.nextObject === OBJECT_ID_NULL;
    game.systems.monsters.createMovementTimer(carrier.rn, dest, false);
    const afterCarrier = parked() - before;
    const carrierDeleted = carrier.rec.nextObject === OBJECT_ID_NULL;
    console.log(
      `Case 4 — 31 parked at (${dest.x},${dest.y}): ${full}; a 32nd plain group -> ${afterPlain}` +
        ` (deleted ${plainDeleted}); one carrying an object -> ${afterCarrier} (deleted ${carrierDeleted})`,
    );
    check(full === 31, 'the first 31 abeyance timers on a square should all be queued');
    check(afterPlain === 31, 'a 32nd group with nothing to carry should not be queued');
    check(plainDeleted, 'that group should be deleted — a raw bit 13 is not Unique() with the option off');
    check(afterCarrier === 32, 'a group carrying something should be queued even past 31');
    check(!carrierDeleted, 'the group carrying something should survive');
    console.log('');
  }

  finish();
}

main();
