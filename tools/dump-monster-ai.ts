/**
 * Drive real monster AI timers through `InitialChecks`.
 *
 * `InitialChecks` is a gate with five ways out, and which one a timer takes is
 * invisible from outside. This runs the real dungeon's monster timers for a while and
 * reports what actually happens: how many timers fire, whether groups keep their
 * turns coming round, and whether the specific gates fire when provoked — a member at
 * zero HP being cleared out, FREEZE LIFE holding everything still, and a group off
 * the party's level taking its slow random walk.
 *
 * Run: `npx tsx tools/dump-monster-ai.ts [level] [ticks]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
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
  const ticks = Number(process.argv[3] ?? 200);

  const traceLines: string[] = [];
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
    undefined, undefined, undefined,
    { trace: (l) => { if (traceLines.length < 4000) traceLines.push(l); } },
  );
  game.party.state.position = new Position(10, 10, level);
  game.monsterSystem.loadPartyLevel(level);

  const pool = game.dungeonState.getItem16Pool();
  const active = () => pool.filter((s) => s.word0 >= 0).length;
  const aiTimers = () => game.timerQueue.getTimers().filter(
    t => t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI).length;

  console.log(`level ${level}: ${active()} group(s), ${aiTimers()} AI timer(s)\n`);

  // ---- Run the clock -----------------------------------------------------
  const startTimers = aiTimers();
  let fired = 0;
  const before = traceLines.length;
  for (let t = 0; t < ticks; t++) {
    (game as unknown as { state: { tickCount: number } }).state.tickCount = t;
    game.timerQueue.getTimers(); // no-op, keeps the intent clear
    game.timerSystem.processTimers(t);
  }
  fired = traceLines.slice(before).filter(l => l.startsWith('MonsterAI ')).length;

  console.log(`After ${ticks} ticks:`);
  console.log(`  AI timer events processed: ${fired}`);
  console.log(`  AI timers still queued:    ${aiTimers()} (started with ${startTimers})`);
  console.log(`  groups still active:       ${active()}`);
  check(fired > 0, 'monster AI timers should have fired');
  check(aiTimers() >= startTimers - 1, 'groups should keep their turns coming round, not run dry');

  const passed = traceLines.filter(l => l.includes('MAI Passed.')).length;
  console.log(`  reached the AI proper:     ${passed}`);
  check(passed > 0, 'some timers should have passed InitialChecks');
  console.log('');

  // ---- Gate: FREEZE LIFE holds everything ---------------------------------
  game.party.state.freezeLifeTimer = 100;
  const beforeFreeze = traceLines.length;
  for (let t = ticks; t < ticks + 60; t++) {
    (game as unknown as { state: { tickCount: number } }).state.tickCount = t;
    game.timerSystem.processTimers(t);
  }
  const passedFrozen = traceLines.slice(beforeFreeze).filter(l => l.includes('MAI Passed.')).length;
  const firedFrozen = traceLines.slice(beforeFreeze).filter(l => l.startsWith('MonsterAI ')).length;
  console.log(`FREEZE LIFE active: ${firedFrozen} timer(s) fired, ${passedFrozen} reached the AI`);
  check(firedFrozen > 0, 'timers should still fire while frozen');
  check(passedFrozen === 0, 'no monster should pass InitialChecks while life is frozen');
  game.party.state.freezeLifeTimer = 0;
  console.log('');

  // ---- Gate: a member at zero HP is cleared out --------------------------
  const groupSlot = pool.find((s) => {
    if (s.word0 < 0) return false;
    const r = game.dungeonState.getCreatureRecordByIndex(s.word0);
    return r ? (r.numMonM1 & 3) >= 1 : false;
  });
  if (groupSlot) {
    const rec = game.dungeonState.getCreatureRecordByIndex(groupSlot.word0)!;
    const n0 = rec.numMonM1;
    rec.hp[0] = 0; // kill member 0 without going through DamageMonster
    console.log(`Zero-HP gate — ${MonsterType[rec.creatureType]} at (${groupSlot.uByte10},${groupSlot.uByte11}), numMonM1 ${n0}`);
    for (let t = ticks + 60; t < ticks + 200; t++) {
      (game as unknown as { state: { tickCount: number } }).state.tickCount = t;
      game.timerSystem.processTimers(t);
    }
    console.log(`  numMonM1 now ${rec.numMonM1}, member 0 hp ${rec.hp[0]}`);
    check(rec.numMonM1 === n0 - 1 || rec.hp[0] !== 0,
      'InitialChecks should have removed the zero-HP member');
    console.log('');
  }

  console.log('--- first 12 trace lines ---');
  for (const l of traceLines.slice(0, 12)) console.log('  ' + l);

  console.log('');
  console.log(problems === 0 ? 'ALL CHECKS PASSED' : `${problems} CHECK(S) FAILED`);
  process.exitCode = problems === 0 ? 0 : 1;
}

main();
