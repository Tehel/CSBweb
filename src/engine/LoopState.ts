/**
 * The main loop's `d.` flags that other CSBWin files write, and `WakeUp` and the freeze,
 * which write them (`DEBT.md` E2, "how a system reaches the loop's state"). They live on
 * the context (`ctx.loop`) and not in `GameState`: none is saved, in CSBWin or in the
 * port's quick-save.
 */
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
}

export function createLoopFlags(): LoopFlags {
  return { clockTickSet: false, clockTickCleared: false, newPartyLevel: -1, clockRunning: true, gameFrozen: false };
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
