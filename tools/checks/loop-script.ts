/**
 * A `RESTARTABLE` sequence holding the main loop (`Game.runScript`, `LoopScript`), and the
 * tick such a sequence runs, `_ProcessTimersViewportAndSound`.
 *
 * 1. **The waits.** A script runs at once up to its first `VBLDelay`, and `runFrame` runs
 *    the rest: each `VBLDelay(n)` is `n` VBLs, each with its `vblInterrupt` and the frame
 *    callbacks, and a `VBLDelay(0)` waits for none (doc/CSBwin-src/CSBCode.cpp:1147-1157).
 *    Meanwhile the loop makes no pass: no mouse entry is taken, no tick runs however late
 *    it is, and no print-queue entry is taken (`CSBCode.cpp:724-775`). In the VBL the
 *    script ends, the pass it held goes on where it stopped: no further mouse entry, then
 *    the tick if one is due and a print-queue entry (`:757-775`, `:724-731`).
 * 2. **A script started by a mouse handler**, as `atk_FUSE` starts `_FusionSequence`
 *    (`Attack.cpp:1973`, `:259`) and a click on the spell panel `_MagicSelection`
 *    (`Magic.cpp:548-584`): the pass that took the click is held inside it, so the entries
 *    behind it stay queued and no tick runs until the script's last VBL, where the pass
 *    goes on. They are taken in the VBL after, once `d.Time` has moved on.
 * 3. **`_ProcessTimersViewportAndSound`** (`Attack.cpp:2194-2215`): one `ProcessTimers`,
 *    then one `d.Time++` and one `scrollingText.ClockTick()`, and no VBL goes by.
 * 4. **A win inside it** (`:2201-2206`): `VBLDelay(300)`, then `ShowCredits(1)`, which
 *    never returns, so the script is never resumed; `d.CanRestartFromSavegame` is cleared
 *    by the stone-room timer that won (`Timer.cpp:2370-2371`), which `tools/checks/show-credits.ts`
 *    covers with a real type-18 actuator. Here `ProcessTimers` is made to report a win.
 *
 * Run: `npm test -- --only=loop-script.ts`
 */
import { Position } from '../../src/core/types';
import type { MessageSink } from '../../src/engine/GameHost';
import { WON_GAME_VBLS, type Game } from '../../src/engine/Game';
import type { LoopScript } from '../../src/engine/LoopState';
import { check, finish } from '../lib/check';
import { newGame, stockGraphics, runVbl, TICK_DUE, stockDungeon } from '../lib/game';
import { ButtonsAt } from '../lib/clicks';
import { wrapMember, standInOf } from '../lib/standIn';

/** The button each queued click is taken as (`ButtonsAt`). */
const clicks = new ButtonsAt();

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
  const data = stockDungeon();
  const w = standInOf<Watched>({
    log: [], vbls: 0, frameCallbacks: 0, clockTicks: 0, printed: 0, credits: [], handled: [],
    timerPasses: [], frames: 0, win: false,
  });
  const messages: MessageSink = {
    printLinefeed: () => {},
    quePrintLines: () => {},
    printLines: () => {},
    setNewSpeed: () => {},
    resetTime: () => {},
    clockTick: () => { w.clockTicks++; },
    printNextQueued: () => { w.printed++; },
    vblInterrupt: () => { w.vbls++; },
    discardText: () => {},
  };
  w.game = newGame(data, stockGraphics(), { messages, showCredits: (word11694) => w.credits.push(word11694) });
  w.game.setRandomSeed(0x12345678);
  w.game.ctx.party.state.position = new Position(6, 14, 2);
  w.game.onFrame(() => { w.frameCallbacks++; });
  wrapMember(w.game.systems.timer, 'processTimers', (processTimers) => (): boolean => {
    w.timerPasses.push(w.game.ctx.state.tickCount);
    return processTimers() || w.win;
  });
  return w;
}

/** The next VBL, with a tick due in every one. */
function frame(w: Watched): void {
  w.frames++;
  runVbl(w.game, TICK_DUE);
}

/* ------------------------------------------------------------ 1. the waits ---- */

function checkWaits(): void {
  console.log('=== the waits: VBLDelay(31), VBLDelay(0), VBLDelay(2) (CSBCode.cpp:1147-1157) ===');
  const w = watchedGame();
  const game = w.game;
  for (let n = 0; n < 3; n++) frame(w);
  const tick = game.ctx.state.tickCount;
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
  clicks.click(game, 20, 100, 100);
  const handled: number[] = [];
  game.setMouseEventHandlers({ translate: clicks.translate, button: (num) => handled.push(num), unclick: () => {} });
  for (let n = 0; n < 32; n++) frame(w);
  console.log(`  32 VBLs: tick ${tick} -> ${game.ctx.state.tickCount}; print-queue entries ${w.printed - printed}; queued ${game.ctx.mouseQueue.count()}`);
  check(game.isRunningScript() && game.ctx.state.tickCount === tick && w.printed === printed,
    'no tick runs while it waits, late as it is, and no print-queue entry is taken');
  frame(w);
  console.log(`  log ${w.log.join(' ')}; vblInterrupts ${w.vbls - vbls}; frame callbacks ${w.frameCallbacks - callbacks}`);
  console.log(`  the 33rd: tick ${game.ctx.state.tickCount}; print-queue entries ${w.printed - printed}; queued ${game.ctx.mouseQueue.count()}`);
  check(w.log.join(' ') === `a@${start} b@${start + 31} c@${start + 31} d@${start + 33}`,
    'it resumes on the 31st VBL, goes through VBLDelay(0) without one, and ends on the 2nd after');
  check(!game.isRunningScript(), 'and holds the loop no longer');
  check(w.vbls - vbls === 33 && w.frameCallbacks - callbacks === 33, 'each of its 33 VBLs runs vblInterrupt and the frame callbacks, once');
  check(game.ctx.state.tickCount === tick + 1 && w.printed === printed + 1,
    'the pass it held goes on in the VBL it ends: the due tick runs and a print-queue entry is taken (CSBCode.cpp:757-775)');
  check(handled.length === 0 && game.ctx.mouseQueue.count() === 1, 'with no further mouse entry: the click queued meanwhile waits');
  frame(w);
  console.log(`  the frame after: tick ${game.ctx.state.tickCount}; handled ${JSON.stringify(handled)}`);
  check(game.ctx.state.tickCount === tick + 2 && w.printed === printed + 2 && handled.join() === '20',
    'the frame after is a whole pass: the click is taken, a tick runs and a print-queue entry is taken');
}

/* -------------------------------------------- 2. started by a mouse handler ---- */

function checkFromHandler(): void {
  console.log('');
  console.log('=== a script started by a mouse handler (Attack.cpp:1973, :259) ===');
  const w = watchedGame();
  const game = w.game;
  frame(w);
  const handled: number[] = [];
  function* script(): LoopScript {
    yield 5;
    w.log.push(`resumed@${w.frames}`);
  }
  game.setMouseEventHandlers({
    translate: clicks.translate,
    button: (num) => {
      handled.push(num);
      if (num === 20) game.runScript(script());
    },
    unclick: () => { handled.push(0x0add); },
  });
  clicks.click(game, 20, 100, 100);
  game.onMouseUnClick();
  clicks.click(game, 21, 101, 100);
  const tick = game.ctx.state.tickCount;
  const printed = w.printed;
  frame(w);
  const held = w.frames;
  console.log(`  handled ${JSON.stringify(handled)}; queued ${game.ctx.mouseQueue.count()}; tick ${tick} -> ${game.ctx.state.tickCount}`);
  check(handled.join() === '20' && game.isRunningScript(), 'the click starts the script');
  check(game.ctx.mouseQueue.count() === 2, 'and the button-up and the click behind it stay queued');
  check(game.ctx.state.tickCount === tick && w.printed === printed, 'that pass runs no tick and takes no print-queue entry');
  for (let n = 0; n < 4; n++) frame(w);
  check(game.isRunningScript() && game.ctx.state.tickCount === tick, 'nor do the next four VBLs');
  frame(w);
  console.log(`  log ${w.log.join(' ')}; handled ${JSON.stringify(handled)}; tick ${game.ctx.state.tickCount}`);
  check(w.log.join(' ') === `resumed@${held + 5}` && !game.isRunningScript(), 'it resumes 5 VBLs later, and ends');
  check(game.ctx.state.tickCount === tick + 1 && handled.join() === '20',
    'the held pass goes on in that VBL: the tick runs, and the entries behind the click stay, its result being 0 (CSBCode.cpp:771)');
  frame(w);
  console.log(`  the frame after: handled ${JSON.stringify(handled)}`);
  check(handled.join() === `20,${0x0add},21`, 'the next pass takes them, d.Time having moved: the button-up, and the click it lets follow');
}

/* -------------------------------------- 3-4. _ProcessTimersViewportAndSound ---- */

function checkProcessTimersViewportAndSound(): void {
  console.log('');
  console.log('=== _ProcessTimersViewportAndSound (Attack.cpp:2194-2215) ===');
  const w = watchedGame();
  const game = w.game;
  frame(w);
  game.savedGameRead(false);
  function* script(): LoopScript {
    for (let n = 0; n < 3; n++) {
      yield* game.processTimersViewportAndSound();
      w.log.push(`t${game.ctx.state.tickCount}@${w.frames}`);
    }
    yield 31;
    w.win = true;
    yield* game.processTimersViewportAndSound();
    w.log.push('after the win');
  }
  const tick = game.ctx.state.tickCount;
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
