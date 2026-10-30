/**
 * Prove the watchdog: CSBWin keeps one `TT_53` queued at all times, each queuing the next
 * 300 ticks on (`SetWatchdogTimer`, `doc/CSBwin-src/Timer.cpp:2817-2829`;
 * `CSBCode.cpp:6572`), and `MainLoop` dies with error 60 once `d.Time` passes the last
 * one's time (`CSBCode.cpp:708-712`). `TAG021028` sets `d.WatchdogTime` to 0xffffffff at
 * every start (`:10610`), so a game waits for its first `TT_53` to fire.
 *
 * 1. A new game queues what a genuine save made before time 300 holds: one `TT_53` at
 *    300, stamped 1, its bytes the constructor's 0xcd, and the next stamp 2. The stamp is
 *    1 because `InitializeTimers` runs twice (`SaveGame.cpp:2762`, `:2048`).
 * 2. As the clock runs, the queue holds exactly one `TT_53`, each at 300 past the last,
 *    and `d.WatchdogTime` follows it once the first has fired.
 * 3. A save read waits for its own `TT_53`: `d.WatchdogTime` is 0xffffffff after the
 *    read, and the save's watchdog keeps its 300-tick cadence.
 * 4. A lost `TT_53` ends the game with error 60 at the tick after its time.
 *
 * Run: `npm test -- --only=watchdog.ts`
 */
import { readFileSync } from 'node:fs';

import { Die } from '../../src/core/Die';
import { applyCsbwinSave } from '../../src/engine/CsbwinSaveGame';
import type { Game } from '../../src/engine/Game';
import { TimerFunction, type TimerEntry } from '../../src/engine/TimerQueue';
import { readSaveFile } from '../../src/data/SaveFile';
import { stockGame } from '../lib/game';
import { check, finish } from '../lib/check';
import { savePath } from '../lib/saves';

const UNSET = 0xcd;
const NONE = 0xffffffff;

function watchdogs(game: Game): TimerEntry[] {
  return game.ctx.timers.getTimers().filter((t) => t.function === TimerFunction.TT_53);
}

/** `count` ticks, each checked to leave one `TT_53` queued, due no earlier than `d.Time`. */
function runTicks(game: Game, count: number, label: string): boolean {
  for (let i = 0; i < count; i++) {
    game.gameTick();
    const queued = watchdogs(game);
    const time = game.ctx.state.tickCount;
    if (queued.length !== 1 || queued[0]!.time < time) {
      check(false, `${label}: at t=${time} the queue holds ${queued.length} TT_53 (${queued.map((t) => t.time).join(',')})`);
      return false;
    }
  }
  return true;
}

function newGame(): void {
  console.log('1. A new game, against a genuine save made at t=70');
  const game = stockGame();
  const queue = game.ctx.timers.getTimers();
  const t = queue[0];
  console.log(`   queue: ${queue.map((e) => `fn=${e.function} t=${e.time} seq=${e.sequence} slot=${e.index}`).join('; ')}`);
  console.log(`   next stamp ${game.ctx.timers.getNextSequence()}, first free slot ${game.ctx.timers.getFirstAvailTimer()}`);
  check(queue.length === 1 && t?.function === TimerFunction.TT_53, 'a new game queues one timer, a TT_53');
  if (!t) return;
  check(t.time === 300 && t.level === 0, 'at time 300, level 0');
  check([t.uByte5, t.uByte6, t.uByte7, t.uByte8, t.uByte9].every((b) => b === UNSET), 'its bytes 5-9 the constructor\'s 0xcd');
  check(t.index === 0 && game.ctx.timers.getFirstAvailTimer() === 1, 'in slot 0, the next free slot 1');

  const save = readSaveFile(new Uint8Array(readFileSync(savePath('csbgame-early-1hero.dat'))));
  const saved = save.timerQueue.map((i) => save.timers[i]!);
  const s = saved.find((r) => r.function === TimerFunction.TT_53);
  console.log(`   csbgame-early-1hero.dat: ${saved.length} timer(s), TT_53 t=${s?.time} seq=${s?.sequence}, gb2.TimerSequence ${save.block2.timerSequence}`);
  check(saved.length === 1 && s !== undefined, 'the genuine save queues one timer, a TT_53');
  check(t.sequence === 1 && s?.sequence === 1, `stamped 1, as the save's (${s?.sequence}): InitializeTimers ran twice`);
  check(game.ctx.timers.getNextSequence() === save.block2.timerSequence,
    `the next stamp ${game.ctx.timers.getNextSequence()} is the save's gb2.TimerSequence ${save.block2.timerSequence}`);
  check(s?.time === t.time && s.level === t.level && s.uByte9 === t.uByte9, 'the same time, level and bytes as the save\'s');
  check(game.ctx.state.watchdogTime === NONE, 'd.WatchdogTime is 0xffffffff before the first TT_53 fires');

  console.log('2. A new game\'s clock, 1000 ticks');
  const times: number[] = [];
  for (let i = 0; i < 1000; i++) {
    if (!runTicks(game, 1, 'new game')) return;
    const due = watchdogs(game)[0]!.time;
    if (times[times.length - 1] !== due) times.push(due);
    if (game.ctx.state.tickCount <= 300 && game.ctx.state.watchdogTime !== NONE) {
      check(false, `d.WatchdogTime is ${game.ctx.state.watchdogTime} at t=${game.ctx.state.tickCount}, before the first TT_53`);
      return;
    }
    if (game.ctx.state.tickCount > 300 && game.ctx.state.watchdogTime !== due) {
      check(false, `d.WatchdogTime ${game.ctx.state.watchdogTime} is not the queued TT_53's time ${due}`);
      return;
    }
  }
  console.log(`   the TT_53 queued fell due at ${times.join(', ')}`);
  check(times.join(',') === '300,600,900,1200', 'one TT_53 at a time, each 300 ticks after the last');
  check(game.ctx.state.watchdogTime === 1200, 'd.WatchdogTime is the last one\'s time');
}

function savedGame(): void {
  console.log('3. csbgame7.dat read and run 600 ticks');
  const game = stockGame();
  game.ctx.state.watchdogTime = 5;
  applyCsbwinSave(game, new Uint8Array(readFileSync(savePath('csbgame7.dat'))));
  const read = watchdogs(game);
  console.log(`   t=${game.ctx.state.tickCount}, TT_53 at ${read.map((t) => t.time).join(',')}`);
  check(game.ctx.state.watchdogTime === NONE, 'the read makes d.WatchdogTime 0xffffffff');
  check(read.length === 1 && read[0]!.time === 127500, 'the save\'s one TT_53, at 127500, is queued');
  if (!runTicks(game, 600, 'csbgame7')) return;
  const after = watchdogs(game)[0]!;
  console.log(`   t=${game.ctx.state.tickCount}, TT_53 at ${after.time}, d.WatchdogTime ${game.ctx.state.watchdogTime}`);
  check(after.time === 128100 && game.ctx.state.watchdogTime === 128100, 'it fired at 127500 and 127800, the next at 128100');
}

function lostWatchdog(): void {
  console.log('4. The TT_53 deleted after the first has fired');
  let told: unknown = null;
  const game = stockGame({ die: (error) => { told = error; } });
  if (!runTicks(game, 301, 'lost')) return;
  const queued = watchdogs(game)[0]!;
  check(queued.time === 600 && game.ctx.state.watchdogTime === 600, 'the watchdog is at 600');
  game.ctx.timers.deleteTimer(queued.index);
  let thrown: unknown = null;
  try {
    while (game.ctx.state.tickCount < 700) game.gameTick();
  } catch (error) {
    thrown = error;
  }
  console.log(`   stopped at t=${game.ctx.state.tickCount}: ${thrown instanceof Error ? thrown.message.replace('\n', ' / ') : 'nothing thrown'}`);
  check(thrown instanceof Die && thrown.errorNum === 60, 'the game dies with error 60');
  check(told === thrown, 'and the host is told');
  check(game.ctx.state.tickCount === 601, 'at the tick d.Time passes 600');
}

function main(): void {
  newGame();
  savedGame();
  lostWatchdog();
  finish();
}

main();
