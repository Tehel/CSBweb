/**
 * A `RESTARTABLE` sequence holding the main loop (`Game.runScript`, `LoopScript`), and the
 * tick such a sequence runs, `_ProcessTimersViewportAndSound`.
 *
 * 1. **The waits.** A script runs at once up to its first `VBLDelay`, and `runFrame` runs
 *    the rest: each `VBLDelay(n)` is `n` VBLs, each with its `vblInterrupt` and the frame
 *    callbacks, and a `VBLDelay(0)` waits for none (doc/CSBwin-src/CSBCode.cpp:1137-1147).
 *    Meanwhile the loop makes no pass: no mouse entry is taken, no tick runs however late
 *    it is, and no print-queue entry is taken (`CSBCode.cpp:714-765`). Once the script
 *    ends, the next frame is a pass again.
 * 2. **A script started by a mouse handler**, as `atk_FUSE` starts `_FusionSequence`
 *    (`Attack.cpp:1971`, `:259`): the pass that took the click is held inside it, so the
 *    entries behind it stay queued and that pass runs no tick. They are taken once the
 *    script is over and `d.Time` has moved on.
 * 3. **`_ProcessTimersViewportAndSound`** (`Attack.cpp:2192-2213`): one `ProcessTimers`,
 *    then one `d.Time++` and one `scrollingText.ClockTick()`, and no VBL goes by.
 * 4. **A win inside it** (`:2199-2204`): `VBLDelay(300)`, then `ShowCredits(1)`, which
 *    never returns, so the script is never resumed; `d.CanRestartFromSavegame` is cleared
 *    by the stone-room timer that won (`Timer.cpp:2370-2371`), which `tools/dump-show-credits.ts`
 *    covers with a real type-18 actuator. Here `ProcessTimers` is made to report a win.
 *
 * Run: `npx tsx tools/dump-loop-script.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { MessageSink } from '../src/engine/ActuatorSystem';
import { WON_GAME_VBLS, type Game } from '../src/engine/Game';
import type { LoopScript } from '../src/engine/LoopState';
import { check, finish } from './lib/check';
import { newGame, stockGraphics } from './lib/game';

interface Watched {
  game: Game;
  log: string[];
  vbls: number;
  frameCallbacks: number;
  clockTicks: number;
  printed: number;
  credits: boolean[];
  handled: number[];
  timerPasses: number[];
  frames: number;
  /** What `ProcessTimers` returns: whether the game has been won. */
  win: boolean;
}

function watchedGame(): Watched {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const w = {
    log: [], vbls: 0, frameCallbacks: 0, clockTicks: 0, printed: 0, credits: [], handled: [],
    timerPasses: [], frames: 0, win: false,
  } as unknown as Watched;
  const messages: MessageSink = {
    printLinefeed: () => {},
    quePrintLines: () => {},
    printLines: () => {},
    setNewSpeed: () => {},
    resetTime: () => {},
    clockTick: () => { w.clockTicks++; },
    printNextQueued: () => { w.printed++; },
    vblInterrupt: () => { w.vbls++; },
  };
  w.game = newGame(data, stockGraphics(), { messages, showCredits: (word11694) => w.credits.push(word11694) });
  w.game.setRandomSeed(0x12345678);
  w.game.party.state.position = new Position(6, 14, 2);
  w.game.onFrame(() => { w.frameCallbacks++; });
  const timers = w.game.timerSystem;
  const processTimers = timers.processTimers.bind(timers);
  timers.processTimers = (time: number): boolean => {
    w.timerPasses.push(time);
    return processTimers(time) || w.win;
  };
  return w;
}

/** The next `runFrame`, 250 ms after the last: a tick is due in every one. */
function frame(w: Watched): void {
  w.frames++;
  w.game.runFrame(1_000_000 + w.frames * 250);
}

/* ------------------------------------------------------------ 1. the waits ---- */

function checkWaits(): void {
  console.log('=== the waits: VBLDelay(31), VBLDelay(0), VBLDelay(2) (CSBCode.cpp:1137-1147) ===');
  const w = watchedGame();
  const game = w.game;
  for (let n = 0; n < 3; n++) frame(w);
  const tick = game.state.tickCount;
  const printed = w.printed;
  check(tick > 0 && printed > 0, 'before the script, every frame is a pass with a tick and a print-queue entry');

  function* script(): LoopScript {
    w.log.push(`a@${w.frames}`);
    yield 31;
    w.log.push(`b@${w.frames}`);
    yield 0;
    w.log.push(`c@${w.frames}`);
    yield 2;
    w.log.push(`d@${w.frames}`);
  }
  const start = w.frames;
  const vbls = w.vbls;
  const callbacks = w.frameCallbacks;
  game.runScript(script());
  check(w.log.join(' ') === `a@${start}` && game.isRunningScript(), 'runScript runs it at once, up to its first VBLDelay');
  game.onMouseClick(20, 100, 100);
  const handled: number[] = [];
  game.setMouseEventHandlers({ button: (num) => handled.push(num), unclick: () => {} });
  for (let n = 0; n < 33; n++) frame(w);
  console.log(`  log ${w.log.join(' ')}; vblInterrupts ${w.vbls - vbls}; frame callbacks ${w.frameCallbacks - callbacks}`);
  console.log(`  tick ${tick} -> ${game.state.tickCount}; print-queue entries ${w.printed - printed}; queued ${game.queuedInputCount()}`);
  check(w.log.join(' ') === `a@${start} b@${start + 31} c@${start + 31} d@${start + 33}`,
    'it resumes on the 31st VBL, goes through VBLDelay(0) without one, and ends on the 2nd after');
  check(!game.isRunningScript(), 'and holds the loop no longer');
  check(w.vbls - vbls === 33 && w.frameCallbacks - callbacks === 33, 'each of its 33 VBLs runs vblInterrupt and the frame callbacks');
  check(game.state.tickCount === tick && w.printed === printed, 'no tick runs meanwhile, late as it is, and no print-queue entry is taken');
  check(handled.length === 0 && game.queuedInputCount() === 1, 'nor is the click queued meanwhile taken');
  frame(w);
  console.log(`  the frame after: tick ${game.state.tickCount}; handled ${JSON.stringify(handled)}`);
  check(game.state.tickCount === tick + 1 && w.printed === printed + 1 && handled.join() === '20',
    'the frame after is a pass: the click is taken, a tick runs and a print-queue entry is taken');
}

/* -------------------------------------------- 2. started by a mouse handler ---- */

function checkFromHandler(): void {
  console.log('');
  console.log('=== a script started by a mouse handler (Attack.cpp:1971, :259) ===');
  const w = watchedGame();
  const game = w.game;
  frame(w);
  const handled: number[] = [];
  function* script(): LoopScript {
    yield 5;
    w.log.push(`resumed@${w.frames}`);
  }
  game.setMouseEventHandlers({
    button: (num) => {
      handled.push(num);
      if (num === 20) game.runScript(script());
    },
    unclick: () => { handled.push(0x0add); },
  });
  game.onMouseClick(20, 100, 100);
  game.onMouseUnClick();
  game.onMouseClick(21, 100, 100);
  const tick = game.state.tickCount;
  const printed = w.printed;
  frame(w);
  const held = w.frames;
  console.log(`  handled ${JSON.stringify(handled)}; queued ${game.queuedInputCount()}; tick ${tick} -> ${game.state.tickCount}`);
  check(handled.join() === '20' && game.isRunningScript(), 'the click starts the script');
  check(game.queuedInputCount() === 2, 'and the button-up and the click behind it stay queued');
  check(game.state.tickCount === tick && w.printed === printed, 'that pass runs no tick and takes no print-queue entry');
  for (let n = 0; n < 6; n++) frame(w);
  console.log(`  log ${w.log.join(' ')}; handled ${JSON.stringify(handled)}; tick ${game.state.tickCount}`);
  check(w.log.join(' ') === `resumed@${held + 5}`, 'it resumes 5 VBLs later');
  check(game.state.tickCount === tick + 1 && handled.join() === '20',
    'the pass after it runs a tick, and the entries behind the click wait for d.Time to move (Mouse.cpp:1468-1476)');
  frame(w);
  console.log(`  the frame after: handled ${JSON.stringify(handled)}`);
  check(handled.join() === `20,${0x0add},21`, 'which the next pass takes: the button-up, and the click it lets follow');
}

/* -------------------------------------- 3-4. _ProcessTimersViewportAndSound ---- */

function checkProcessTimersViewportAndSound(): void {
  console.log('');
  console.log('=== _ProcessTimersViewportAndSound (Attack.cpp:2192-2213) ===');
  const w = watchedGame();
  const game = w.game;
  frame(w);
  game.savedGameRead();
  function* script(): LoopScript {
    for (let n = 0; n < 3; n++) {
      yield* game.processTimersViewportAndSound();
      w.log.push(`t${game.state.tickCount}@${w.frames}`);
    }
    yield 31;
    w.win = true;
    yield* game.processTimersViewportAndSound();
    w.log.push('after the win');
  }
  const tick = game.state.tickCount;
  const passes = w.timerPasses.length;
  const clockTicks = w.clockTicks;
  const vbls = w.vbls;
  game.runScript(script());
  console.log(`  log ${w.log.join(' ')}; timer passes ${JSON.stringify(w.timerPasses.slice(passes))}; clockTicks ${w.clockTicks - clockTicks}`);
  check(w.log.join(' ') === `t${tick + 1}@${w.frames} t${tick + 2}@${w.frames} t${tick + 3}@${w.frames}`,
    'three in a row turn the clock three times, and no VBL goes by');
  check(w.timerPasses.slice(passes).join() === [tick, tick + 1, tick + 2].join(),
    'each runs ProcessTimers once, on the clock before it turns');
  check(w.clockTicks - clockTicks === 3 && w.vbls === vbls, 'and scrollingText.ClockTick() once');

  const start = w.frames;
  let creditsAt = 0;
  for (let n = 1; n <= 31 + WON_GAME_VBLS + 20; n++) {
    frame(w);
    if (w.credits.length > 0 && creditsAt === 0) creditsAt = n;
  }
  console.log(`  credits ${creditsAt - 31} VBLs after the winning pass; asked ${JSON.stringify(w.credits)}; log ${w.log.join(' ')}`);
  check(creditsAt === 31 + WON_GAME_VBLS, 'a win inside it asks for ShowCredits(1) 300 VBLs later');
  check(w.credits.length === 1, 'once');
  check(!game.canRestartFromSavegame(), 'd.CanRestartFromSavegame is cleared');
  check(!w.log.includes('after the win'), 'ShowCredits never returns: the script is never resumed');
  check(game.mainLoopHasReturned() && w.frames - start === 31 + WON_GAME_VBLS + 20, 'MainLoop is over');
  check(w.vbls - vbls === 31 + WON_GAME_VBLS, 'and no VBL runs after it');
}

function main(): void {
  checkWaits();
  checkFromHandler();
  checkProcessTimersViewportAndSound();
  finish();
}

main();
