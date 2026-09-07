/**
 * Exercise the monster form of `MoveObject`.
 *
 * Four things need to hold when a group moves, and none of them are visible without
 * looking: the record leaves one cell and appears in the other; its `ITEM16` learns
 * the new square (and remembers the previous one); its AI timers follow it, rather
 * than staying behind at the square it left; and a move onto an occupied square parks
 * the group on an abeyance timer instead of losing it.
 *
 * Run: `npx tsx tools/dump-monster-move.ts [level]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CsbRandom } from '../src/core/random';
import { DBType, decodeObjectID, OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { TimerFunction } from '../src/engine/TimerQueue';
import { MonsterType } from '../src/engine/monsterTypes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';

let problems = 0;
function check(ok: boolean, what: string): void {
  if (!ok) { console.log(`  !! ${what}`); problems++; }
}

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

  const level = Number(process.argv[2] ?? 2);
  const game = new Game(
    data,
    { roomTimerFunctions: uiTables.graphic232.byte1596, monsterDesc: objectTables.monsterDesc },
    {
      monsterDesc: objectTables.monsterDesc,
      word1074: uiTables.graphic232.word1074,
      soundTable: uiTables.graphic232.soundTable,
      doorCharacteristics: objectTables.doorCharacteristics,
      monsterDroppings: objectTables.monsterDroppings,
      facingReplication: objectTables.facingReplication,
    },
  );
  // Stand the party somewhere on the target level so it becomes the loaded level.
  game.party.state.position = new Position(0, 0, level);
  game.monsterSystem.loadPartyLevel(level);

  const dungeon = game.dungeonState;
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
    const rn = game.monsterSystem.findFirstMonsterAt(new Position(mx, my, level));

    const timersBefore = game.timerQueue.getTimers()
      .filter(t => t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI
        && t.uByte6 === mx && t.uByte7 === my).length;

    console.log(`Case 1 — move a ${MonsterType[rec.creatureType]} from (${mx},${my}) to (${nx},${ny})`);
    const result = game.monsterSystem.moveMonster(rn, mx, my, nx, ny, level);
    console.log(`  removed=${result.removed} code=${result.code}`);

    const timersAtOld = game.timerQueue.getTimers()
      .filter(t => t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI
        && t.uByte6 === mx && t.uByte7 === my).length;
    const timersAtNew = game.timerQueue.getTimers()
      .filter(t => t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI
        && t.uByte6 === nx && t.uByte7 === ny).length;
    console.log(`  AI timers: (${mx},${my})=${timersAtOld} (${nx},${ny})=${timersAtNew} (was ${timersBefore})`);
    console.log(`  ITEM16 now at (${mover.slot.uByte10},${mover.slot.uByte11}), prev (${mover.slot.ubPrevX},${mover.slot.ubPrevY})`);

    check(!result.removed, 'the move should have succeeded');
    check(!monsterAt(mx, my), 'the old cell should no longer hold the creature');
    check(monsterAt(nx, ny), 'the new cell should hold the creature');
    check(timersAtOld === 0 && timersAtNew === timersBefore, 'the AI timers should have followed the group');
    check(mover.slot.uByte10 === nx && mover.slot.uByte11 === ny, 'ITEM16 should record the new square');
    check(mover.slot.ubPrevX === mx && mover.slot.ubPrevY === my, 'ITEM16 should remember the old square');
    console.log('');
  }

  // ---- Case 2: moving onto another monster parks it in abeyance ----------
  const pair = active.filter(({ slot }) => slot.word0 >= 0);
  if (pair.length >= 2) {
    const a = pair[0]!, b = pair[1]!;
    const ax = a.slot.uByte10, ay = a.slot.uByte11;
    const bx = b.slot.uByte10, by = b.slot.uByte11;
    const rn = game.monsterSystem.findFirstMonsterAt(new Position(ax, ay, level));
    if (rn !== OBJECT_ID_EOF && !(ax === bx && ay === by)) {
      console.log(`Case 2 — move a group from (${ax},${ay}) onto the occupied (${bx},${by})`);
      const result = game.monsterSystem.moveMonster(rn, ax, ay, bx, by, level);
      const abeyance = game.timerQueue.getTimers()
        .filter(t => t.function === TimerFunction.TT_60 || t.function === TimerFunction.TT_61);
      console.log(`  removed=${result.removed}, abeyance timers: ${abeyance.length}`);
      check(result.removed, 'the group should have been removed to abeyance');
      check(abeyance.length === 1, 'exactly one abeyance timer should exist');
      check(abeyance[0]?.object === rn, 'the abeyance timer should carry the monster');
      check(!monsterAt(ax, ay), 'the group should have left its old cell');
      console.log('');

      // ---- Case 3: the abeyance timer retries and eventually places it ----
      // Its target is still occupied, so the first retry must reschedule, not place.
      const t = abeyance[0]!;
      game.timerQueue.deleteTimer(t.index);
      game.monsterSystem.processAbeyanceTimer(t);
      const still = game.timerQueue.getTimers()
        .filter(x => x.function === TimerFunction.TT_60 || x.function === TimerFunction.TT_61);
      console.log(`Case 3 — retry while still blocked: abeyance timers ${still.length}, t=${still[0]?.time}`);
      check(still.length === 1, 'the group should still be waiting');

      // Now clear the destination and retry: it should be placed.
      const bRn = game.monsterSystem.findFirstMonsterAt(new Position(bx, by, level));
      dungeon.removeObjectFromCell(new Position(bx, by, level), bRn);
      const t2 = still[0]!;
      game.timerQueue.deleteTimer(t2.index);
      game.monsterSystem.processAbeyanceTimer(t2);
      const after = game.timerQueue.getTimers()
        .filter(x => x.function === TimerFunction.TT_60 || x.function === TimerFunction.TT_61);
      console.log(`  after clearing (${bx},${by}): abeyance timers ${after.length}, monster there = ${monsterAt(bx, by)}`);
      check(after.length === 0, 'the abeyance timer should be gone');
      check(monsterAt(bx, by), 'the group should now be placed');
      console.log('');
    }
  }

  console.log(problems === 0 ? 'ALL CHECKS PASSED' : `${problems} CHECK(S) FAILED`);
  process.exitCode = problems === 0 ? 0 : 1;
}

main();
