/**
 * The main loop's `d.` flags that other CSBWin files write, and the freeze, which writes
 * them. They live on the context (`ctx.loop`), where every system reaches them, and not
 * in `GameState`: none is saved, in CSBWin or here.
 */
import type { Rect } from '../data/tables/UITables';
import type { GameContext } from './GameContext';

export interface LoopFlags {
  /**
   * `d.clockTick`: a tick is due, and the main loop's pass that finds it set runs one
   * (doc/CSBwin-src/CSBCode.cpp:773-775). The VBL sets it on every VBL once
   * `vblCount >= d.Speed` (`vblInterrupt`, `:1076-1087`). Handlers set it too: to 1 in
   * `WakeUp` (`:7109`), a door button (`Mouse.cpp:1079`), a wall switch that fired
   * (`TouchWallF1`, `:789`), a pick-up (`:841`), a drop (`:965`), `ShowHideInventory`
   * (`CSBCode.cpp:7500`), a turn or a step (`:7953-7956`, `:8171-8174`), or an attack or
   * a cast that went through (`setClockTick`), so a tick is due at once, whatever the VBL
   * count; to 0 on an inhibited move (`:8400`), a touch of the wall that fired nothing
   * (`Mouse.cpp:789`), or an attack or a cast that returned 0, which puts off a tick that
   * was due until the next VBL sets it again. The tick itself clears it at its end
   * (`CSBCode.cpp:714`), so a party woken by a blow during `ProcessTimers` gets no extra
   * tick.
   */
  clockTick: boolean;
  /**
   * `d.vblCount`, the VBLs since the top of the last tick: each VBL adds one
   * (`vblInterrupt`, doc/CSBwin-src/CSBCode.cpp:1075), and the top of every tick zeroes it
   * (`:627`).
   */
  vblCount: number;
  /**
   * `d.newPartyLevel`: -1, or the level the party has just reached, which the top of the
   * next tick loads (`Game.loadNewPartyLevel`). A `MoveObject` of the party that ends on
   * another level sets it (doc/CSBwin-src/Code11f52.cpp:3354-3359), and so does
   * `TraverseStairway` (`CSBCode.cpp:7862`). Until then the party's square is the new
   * level's and its level the old one (`d.partyX`, `d.partyY` and `d.partyLevel`).
   */
  newPartyLevel: number;
  /**
   * `d.ClockRunning`, 1 from the game start (doc/CSBwin-src/CSBCode.cpp:10673) and 0 while
   * the game is frozen: `if (d.ClockRunning == 0) goto tag0007b4;` (`:775`), so a tick
   * that falls due waits, still due, until the thaw.
   */
  clockRunning: boolean;
  /**
   * `gameFrozen` (a `Mouse.cpp` global): `HandleMouseEvents` throws away every entry but
   * 148, and lets 148 through whenever it comes (doc/CSBwin-src/Mouse.cpp:1548-1565,
   * `:1591-1604`).
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
  /**
   * `videoMode` (a global of `data.cpp`), which the viewport is drawn through the overlay
   * in only when it is `VM_ADVENTURE` (`GameScreen.isAdventureVideoMode`). It is set where
   * CSBWin sets it: an inventory shown or hidden (`ShowHideInventory`,
   * doc/CSBwin-src/CSBCode.cpp:7512, `:7546`), `TAG0207cc` (`:10081`), `WakeUp` (`:7121`),
   * the freeze and the thaw (`Mouse.cpp:1874`, `:1903`), sleep (`:1842`) and a menu
   * (`Menu.cpp:465-472`). The top of every tick puts any other mode back to
   * `VM_ADVENTURE`, awake and with no inventory open (`CSBCode.cpp:613-621`): a menu
   * closed shows the straight viewport until then.
   */
  videoMode: VideoMode;
  /**
   * `gravityMove` (a global of `data.cpp`, doc/CSBwin-src/data.cpp:247): the party is
   * sliding. Every `MoveParty` of a dungeon that sets `bGravityGame` sets it
   * (`CSBCode.cpp:8166-8170`), and `GravityMove` clears it when it finds no axis to fall
   * along (`Mouse.cpp:1368`). While it is set, `HandleMouseEvents` throws the queue away
   * on every call and takes `GravityMove`'s step instead (`:1482-1491`).
   */
  gravityMove: boolean;
  /** `nextGravityMoveTime` (`data.cpp:245`, a global, so 0 at first): the `d.Time` before which no gravity step is taken. */
  nextGravityMoveTime: number;
  /**
   * `moveHistory` (`data.cpp:246`), `{0,1,2,0}` at first: the three axes, 0 east-west, 1
   * north-south and 2 vertical, from the one moved along last, then in bit `axis` of
   * `[3]` whether the last move along it went the positive way, east, south or down
   * (`MoveParty`, `CSBCode.cpp:8128-8164`). `GravityMove` tries the axes from the
   * least recent (`Mouse.cpp:1269-1301`).
   *
   * The three are globals CSBWin never saves and never resets: a load keeps the last
   * game's, a restart of the program starts from these. The port gives every game read
   * the program's start (`Game.installReadState`, `DEBT.md` H, "A game read starts
   * the gravity afresh").
   */
  moveHistory: number[];
}

/**
 * CSBWin's `VIDEOMODE` (doc/CSBwin-src/Data.h:63-77), the values the game sets. The
 * screens before it (`VM_PRESENTS`, `VM_PRISONDOOR`, `VM_CREDITS`) and after it
 * (`VM_THEEND`, `VM_CAST`) are the intro's host, which has no overlay.
 */
type VideoMode =
  | 'VM_DEFAULT' | 'VM_CENTERMENU' | 'VM_LEFTMENU' | 'VM_ADVENTURE' | 'VM_INVENTORY' | 'VM_FROZEN' | 'VM_SLEEPING';

/**
 * A `RESTARTABLE` sequence that holds the main loop inside one of its calls, as
 * `_FusionSequence` does (doc/CSBwin-src/Attack.cpp:2222) and `MainLoop`'s wait after the
 * CSB win (`CSBCode.cpp:637-643`). It yields the length of each `VBLDelay`, in VBLs, and
 * does its work between them. `MainLoop.runScript` starts one, and `Game.runFrame` runs it in
 * place of the loop's pass, and in the VBL it returns goes on with the pass it held, as
 * CSBWin's does after `_MagicSelection`. A generator rather than the intro's `async` (`IntroHost`) because
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
  /** `_ProcessTimersViewportAndSound` (doc/CSBwin-src/Attack.cpp:2194). */
  processTimersViewportAndSound(): LoopScript;
  /** `ShowCredits(n, 1)` from inside the loop, which never returns. */
  showCreditsAndEnd(): LoopScript;
  /** `d.CanRestartFromSavegame = 0`. */
  clearCanRestartFromSavegame(): void;
}

export function createLoopFlags(): LoopFlags {
  // `d.FlashButnActive = 0; d.Word11776 = 0;` at the game start
  // (doc/CSBwin-src/CSBCode.cpp:10601-10602). A game starts from the prison door
  // (`VM_PRISONDOOR`, `:9701`), a menu or "THE END", never in `VM_ADVENTURE`: its first
  // tick sets that (`:613-621`). `VM_DEFAULT` stands for all of them.
  return {
    clockTick: false, vblCount: 0, newPartyLevel: -1, clockRunning: true, gameFrozen: false,
    flashButnActive: false, flashButn: { x1: 0, x2: 0, y1: 0, y2: 0 }, word11776: false, flashChanged: false,
    videoMode: 'VM_DEFAULT',
    ...createGravityState(),
  };
}

/** `gravityMove`, `nextGravityMoveTime` and `moveHistory` as the program starts (doc/CSBwin-src/data.cpp:245-247). */
export function createGravityState(): Pick<LoopFlags, 'gravityMove' | 'nextGravityMoveTime' | 'moveHistory'> {
  return { gravityMove: false, nextGravityMoveTime: 0, moveHistory: [0, 1, 2, 0] };
}

/**
 * The vertical blank's share of the button flash (doc/CSBwin-src/CSBCode.cpp:1038-1048):
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
 * `_FlashButton(x1, x2, y1, y2)` (doc/CSBwin-src/CSBCode.cpp:7800-7817): wait out a pending
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
 * `WaitForButtonFlash` (doc/CSBwin-src/CSBCode.cpp:8666-8706): an inverted rectangle is
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
 * `d.clockTick = value` from a handler: non-zero makes a tick due at once, and 0 puts off
 * a tick that was due until the next VBL.
 */
export function setClockTick(ctx: GameContext, value: number): void {
  ctx.loop.clockTick = value !== 0;
}

/**
 * `speedTable[gameSpeed].vblPerTick` at CSBWin's default `SPEED_NORMAL`
 * (doc/CSBwin-src/data.cpp:276, `CSBwin.cpp:181`), the port's only game speed.
 */
export const VBL_PER_TICK = 15;

/**
 * `d.Speed`, the VBLs per tick: 0 while the party sleeps (doc/CSBwin-src/Mouse.cpp:1836),
 * `VBL_PER_TICK` awake (`CSBCode.cpp:7113`). The top of every tick sets it again while
 * awake, with a `SetNewSpeed` (`:622-626`) that the port's one speed makes a no-op.
 */
export function speed(ctx: GameContext): number {
  return ctx.party.state.sleeping ? 0 : VBL_PER_TICK;
}

/**
 * The tick's share of the VBL handler (doc/CSBwin-src/CSBCode.cpp:1075-1087), after the
 * message strip's scroll and the button flash: `d.vblCount += 1`, and once it has reached
 * `d.Speed`, `d.clockTick = 1`. It runs on every VBL, while a script holds the loop and
 * while the game is frozen. `NoSpeedLimit` and the "Player Clock" arm (`:1077-1097`) are
 * the speed menu's, which is not ported.
 */
export function vblInterrupt(ctx: GameContext): void {
  const loop = ctx.loop;
  loop.vblCount += 1;
  if (loop.vblCount >= speed(ctx)) loop.clockTick = true;
}

/**
 * The engine's half of button 147, the freeze (doc/CSBwin-src/Mouse.cpp:1870-1898):
 * `d.ClockRunning = 0`, `gameFrozen = true`, `videoMode = VM_FROZEN`,
 * `DiscardAllInput()`. The screen's half is `handleMouseButton`'s.
 */
export function freeze(ctx: GameContext): void {
  ctx.loop.clockRunning = false;
  ctx.loop.gameFrozen = true;
  ctx.loop.videoMode = 'VM_FROZEN';
  ctx.mouseQueue.discardAllInput();
}

/**
 * The engine's half of button 148, the thaw (doc/CSBwin-src/Mouse.cpp:1899-1912):
 * `videoMode = VM_ADVENTURE` before `TAG0207cc`, which shows an open inventory again.
 */
export function thaw(ctx: GameContext): void {
  ctx.loop.clockRunning = true;
  ctx.loop.gameFrozen = false;
  ctx.loop.videoMode = 'VM_ADVENTURE';
  ctx.mouseQueue.discardAllInput();
}
