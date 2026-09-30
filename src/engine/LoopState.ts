/**
 * The main loop's `d.` flags that other CSBWin files write, and `WakeUp` and the freeze,
 * which write them (`DEBT.md` E2, "how a system reaches the loop's state"). They live on
 * the context (`ctx.loop`) and not in `GameState`: none is saved, in CSBWin or in the
 * port's quick-save.
 */
import type { Rect } from '../data/tables/UITables';
import type { GameContext } from './GameContext';

export interface LoopFlags {
  /**
   * `d.clockTick = 1` from `WakeUp` (doc/CSBwin-src/CSBCode.cpp:7050), a door button
   * (`Mouse.cpp:1078`), a wall switch that fired (`TouchWallF1`, `:788`), a pick-up
   * (`:840`), a drop (`:964`), `ShowHideInventory` (`CSBCode.cpp:7441`), a turn or a step
   * (`:7866-7869`, `:8084-8087`), or an attack or a cast that went through
   * (`setClockTick`): a tick is due at once, whatever the VBL count. The tick itself clears it again (`CSBCode.cpp:704`),
   * so a party woken by a blow during `ProcessTimers` gets no extra tick.
   */
  clockTickSet: boolean;
  /**
   * `d.clockTick = 0` from an inhibited move (doc/CSBwin-src/CSBCode.cpp:8313), a touch
   * of the wall that fired nothing (`TouchWallF1`, `Mouse.cpp:788`), or an attack or a
   * cast that returned 0 (`setClockTick`). The VBL sets
   * `clockTick` again on every VBL once `vblCount >= d.Speed` (`CSBCode.cpp:1066-1077`),
   * so a tick that was due waits one frame.
   */
  clockTickCleared: boolean;
  /**
   * `d.newPartyLevel`: -1, or the level the party has just reached, which the top of the
   * next tick loads (`Game.loadNewPartyLevel`). A `MoveObject` of the party that ends on
   * another level sets it (doc/CSBwin-src/Code11f52.cpp:3319-3324), and so does
   * `TraverseStairway` (`CSBCode.cpp:7775`). Until then the party's square is the new
   * level's and its level the old one (`d.partyX`, `d.partyY` and `d.partyLevel`).
   */
  newPartyLevel: number;
  /**
   * `d.ClockRunning`, 1 from the game start (doc/CSBwin-src/CSBCode.cpp:10549) and 0 while
   * the game is frozen: `if (d.ClockRunning == 0) goto tag0007b4;` (`:765`), so a tick
   * that falls due waits, still due, until the thaw.
   */
  clockRunning: boolean;
  /**
   * `gameFrozen` (a `Mouse.cpp` global): `HandleMouseEvents` throws away every entry but
   * 148, and lets 148 through whenever it comes (doc/CSBwin-src/Mouse.cpp:1433-1444,
   * `:1463-1476`).
   */
  gameFrozen: boolean;
  /**
   * `d.FlashButnActive`: `FlashButton` or `WaitForButtonFlash` has asked the next VBL to
   * invert `flashButn` (`vblFlashButton`).
   */
  flashButnActive: boolean;
  /** `d.FlashButnX1`, `…X2`, `…Y1` and `…Y2`: the screen rectangle, corners included. */
  flashButn: Rect;
  /**
   * `d.Word11776`, which each inversion toggles: whether `flashButn` stands inverted.
   * CSBWin inverts its screen memory once; the port composes its screen afresh for every
   * frame, so `GameScreen` applies the inversion (`vblFlashButn`) after composing, for as
   * long as this is set.
   */
  word11776: boolean;
  /** An inversion since the page last took it (`Game.takeFlashChanged`): a redraw is due. */
  flashChanged: boolean;
}

/**
 * A `RESTARTABLE` sequence that holds the main loop inside one of its calls, as
 * `_FusionSequence` does (doc/CSBwin-src/Attack.cpp:2220) and `MainLoop`'s wait after the
 * CSB win (`CSBCode.cpp:627-633`). It yields the length of each `VBLDelay`, in VBLs, and
 * does its work between them. `MainLoop.runScript` starts one, and `Game.runFrame` runs it in
 * place of the loop's pass. A generator rather than the intro's `async` (`IntroHost`) because
 * `runFrame` is stepped by `tools/`, one VBL at a time.
 */
export type LoopScript = Generator<number, void, void>;

/**
 * What a system asks of the main loop itself, which `Game` is (`ctx.systems.mainLoop`):
 * to be held in a `LoopScript`, and the calls such a script makes.
 */
export interface MainLoop {
  /** Hold the loop in `script`: run it now, up to its first `VBLDelay`. */
  runScript(script: LoopScript): void;
  /** Whether a script holds the loop. */
  isRunningScript(): boolean;
  /** `_ProcessTimersViewportAndSound` (doc/CSBwin-src/Attack.cpp:2192). */
  processTimersViewportAndSound(): LoopScript;
  /** `ShowCredits(n, 1)` from inside the loop, which never returns. */
  showCreditsAndEnd(): LoopScript;
  /** `d.CanRestartFromSavegame = 0`. */
  clearCanRestartFromSavegame(): void;
}

export function createLoopFlags(): LoopFlags {
  // `d.FlashButnActive = 0; d.Word11776 = 0;` at the game start
  // (doc/CSBwin-src/CSBCode.cpp:10477-10478).
  return {
    clockTickSet: false, clockTickCleared: false, newPartyLevel: -1, clockRunning: true, gameFrozen: false,
    flashButnActive: false, flashButn: { x1: 0, x2: 0, y1: 0, y2: 0 }, word11776: false, flashChanged: false,
  };
}

/**
 * The vertical blank's share of the button flash (doc/CSBwin-src/CSBCode.cpp:1028-1038):
 * `d.FlashButnActive = 0`, `d.Word11776 ^= 0xffff`, and `vblFlashButn` inverts the
 * rectangle.
 */
export function vblFlashButton(loop: LoopFlags): void {
  if (!loop.flashButnActive) return;
  loop.flashButnActive = false;
  loop.word11776 = !loop.word11776;
  loop.flashChanged = true;
}

/**
 * `_FlashButton(x1, x2, y1, y2)` (doc/CSBwin-src/CSBCode.cpp:7713-7730): wait out a pending
 * flash, store the rectangle, set `d.FlashButnActive` and wait a VBL, whose handler inverts
 * it. The main loop's pass does not stop for VBLs, so each wait runs its VBL's share at
 * once: the rectangle is inverted where CSBWin's is, before the rest of the pass. A
 * `RESTARTABLE` caller that the port runs as a `LoopScript` waits instead
 * (`flashButtonScript`).
 */
export function flashButton(ctx: GameContext, x1: number, x2: number, y1: number, y2: number): void {
  const loop = ctx.loop;
  // `while (d.FlashButnActive != 0) {};`
  vblFlashButton(loop);
  loop.flashButn = { x1, x2, y1, y2 };
  loop.flashButnActive = true;
  // `wvbl(_1_);`
  vblFlashButton(loop);
}

/**
 * The rectangle `vblFlashButn` has inverted while `d.Word11776` says it stands inverted, or
 * `null`: the screen inverts it after composing a frame.
 */
export function flashedButton(ctx: GameContext): Rect | null {
  return ctx.loop.word11776 ? ctx.loop.flashButn : null;
}

/**
 * `_FlashButton` inside a `LoopScript`, which can wait: each wait is a VBL of the held
 * loop (`Game.runFrame`), whose `vblFlashButton` inverts the rectangle.
 */
export function* flashButtonScript(ctx: GameContext, x1: number, x2: number, y1: number, y2: number): LoopScript {
  const loop = ctx.loop;
  // `while (d.FlashButnActive != 0) {};`
  while (loop.flashButnActive) yield 1;
  loop.flashButn = { x1, x2, y1, y2 };
  loop.flashButnActive = true;
  // `wvbl(_1_);`
  yield 1;
}

/**
 * `WaitForButtonFlash` inside a `LoopScript`, which waits as CSBWin's does: out a pending
 * flash, then, while `d.Word11776` is set, for the VBL that puts the rectangle back.
 */
export function* waitForButtonFlashScript(ctx: GameContext): LoopScript {
  const loop = ctx.loop;
  while (loop.flashButnActive) yield 1;
  if (loop.word11776) {
    loop.flashButnActive = true;
    yield 1;
  }
}

/**
 * `WaitForButtonFlash` (doc/CSBwin-src/CSBCode.cpp:8561-8601): an inverted rectangle is
 * handed to the next VBL to put back (`d.FlashButnActive = 1`), and CSBWin waits for that
 * VBL. The main loop's pass does not wait: the next VBL puts it back, and the frame this
 * pass draws still shows it, which is the one frame a flash is seen (`DEBT.md` H). A
 * put-back already asked for is the flash CSBWin's first loop waits out, after which
 * `d.Word11776` is clear. A `LoopScript` waits instead (`waitForButtonFlashScript`).
 */
export function waitForButtonFlash(ctx: GameContext): void {
  if (ctx.loop.word11776) ctx.loop.flashButnActive = true;
}

/**
 * `d.clockTick = value` from a handler the mouse queue runs: non-zero makes a tick due at
 * once, and 0 puts off a tick that was due by a VBL.
 */
export function setClockTick(ctx: GameContext, value: number): void {
  ctx.loop.clockTickSet = value !== 0;
  ctx.loop.clockTickCleared = value === 0;
}

/**
 * `speedTable[gameSpeed].vblPerTick` at CSBWin's default `SPEED_NORMAL`
 * (doc/CSBwin-src/data.cpp:275, `CSBwin.cpp:180`), the port's only game speed.
 */
export const VBL_PER_TICK = 15;

/**
 * `d.Speed`, the VBLs per tick: 0 while the party sleeps (doc/CSBwin-src/Mouse.cpp:1697),
 * `VBL_PER_TICK` awake (`CSBCode.cpp:7054`). The top of every tick sets it again while
 * awake, with a `SetNewSpeed` (`:612-616`) that the port's one speed makes a no-op.
 */
export function speed(ctx: GameContext): number {
  return ctx.party.state.sleeping ? 0 : VBL_PER_TICK;
}

/**
 * `WakeUp` (doc/CSBwin-src/CSBCode.cpp:7047) — button 146, or any blow that lands on a
 * sleeping party (`Monster.cpp:4531`, `Character.cpp:2809-2812`). `d.clockTick = 1`,
 * `d.PartySleeping = 0`, the message timeouts rescaled to the game speed
 * (`scrollingText.SetNewSpeed(d.Speed, …)`, `:7053`), the adventure button lists back (the
 * host's listeners), `DiscardAllInput()`, and `TAG0207cc` last (`:7061`).
 */
export function wakeUp(ctx: GameContext): void {
  const oldSpeed = speed(ctx);
  ctx.loop.clockTickSet = true;
  ctx.loop.clockTickCleared = false;
  ctx.party.state.sleeping = false;
  ctx.host.messages.setNewSpeed(oldSpeed, VBL_PER_TICK, ctx.state.tickCount);
  ctx.host.sleepChanged(false);
  ctx.mouseQueue.discardAllInput();
  ctx.host.tag0207cc();
}

/**
 * The engine's half of button 147, the freeze (doc/CSBwin-src/Mouse.cpp:1731-1759):
 * `d.ClockRunning = 0`, `gameFrozen = true`, `DiscardAllInput()`. The screen's half is
 * `handleMouseButton`'s.
 */
export function freeze(ctx: GameContext): void {
  ctx.loop.clockRunning = false;
  ctx.loop.gameFrozen = true;
  ctx.mouseQueue.discardAllInput();
}

/** The engine's half of button 148, the thaw (doc/CSBwin-src/Mouse.cpp:1760-1773). */
export function thaw(ctx: GameContext): void {
  ctx.loop.clockRunning = true;
  ctx.loop.gameFrozen = false;
  ctx.mouseQueue.discardAllInput();
}
