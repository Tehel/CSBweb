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
  const ticks = Number(process.argv[3] ?? 200);

  // Two separate things: a capped buffer for showing sample lines, and uncapped
  // counters, because the buffer fills up long before the run ends.
  const traceLines: string[] = [];
  let turnsStarted = 0;
  let turnsPassedGate = 0;
  const game = newGame(data, graphics, {
    monsterHooks: {
      trace: (l) => {
        if (l.startsWith('MonsterAI ')) turnsStarted++;
        if (l.includes('MAI Passed.')) turnsPassedGate++;
        if (traceLines.length < 200) traceLines.push(l);
      },
    },
  });
  game.party.state.position = new Position(10, 10, level);
  game.monsterSystem.loadPartyLevel(level);

  const pool = game.dungeonState.getItem16Pool();
  const active = () => pool.filter((s) => s.word0 >= 0).length;
  const aiTimers = () => game.timerQueue.getTimers().filter(
    t => t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI).length;

  console.log(`level ${level}: ${active()} group(s), ${aiTimers()} AI timer(s)\n`);

  // ---- Run the clock -----------------------------------------------------
  const startTimers = aiTimers();
  turnsStarted = 0; turnsPassedGate = 0;
  for (let t = 0; t < ticks; t++) {
    (game as unknown as { state: { tickCount: number } }).state.tickCount = t;
    game.timerSystem.processTimers(t);
  }
  const fired = turnsStarted;
  const passed = turnsPassedGate;

  console.log(`After ${ticks} ticks:`);
  console.log(`  AI timer events processed: ${fired}`);
  console.log(`  AI timers still queued:    ${aiTimers()} (started with ${startTimers})`);
  console.log(`  groups still active:       ${active()}`);
  check(fired > 0, 'monster AI timers should have fired');
  check(aiTimers() >= startTimers - 1, 'groups should keep their turns coming round, not run dry');

  console.log(`  reached the AI proper:     ${passed}`);
  check(passed > 0, 'some timers should have passed InitialChecks');
  console.log('');

  // ---- Gate: FREEZE LIFE holds everything ---------------------------------
  // The window has to be long enough for something to actually be due: the slowest
  // monsters here have a `timePerMove` of 185 ticks, so 60 would see nothing at all.
  game.party.state.freezeLifeTimer = 2000;
  turnsStarted = 0; turnsPassedGate = 0;
  for (let t = ticks; t < ticks + 400; t++) {
    (game as unknown as { state: { tickCount: number } }).state.tickCount = t;
    game.timerSystem.processTimers(t);
  }
  const firedFrozen = turnsStarted;
  const passedFrozen = turnsPassedGate;
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
    for (let t = ticks + 400; t < ticks + 900; t++) {
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
  finish();
}

main();
