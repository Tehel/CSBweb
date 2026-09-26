/**
 * The main loop's `d.` flags that other CSBWin files write, and `WakeUp`, which writes
 * them (`DEBT.md` E2, "how a system reaches the loop's state"). They live on the context
 * (`ctx.loop`) and not in `GameState`: none is saved, in CSBWin or in the port's
 * quick-save, and the next tick settles each of them.
 */
import type { GameContext } from './GameContext';

export interface LoopFlags {
  /**
   * `d.clockTick = 1` from `WakeUp` (doc/CSBwin-src/CSBCode.cpp:7050), a door button
   * (`Mouse.cpp:1078`) or a wall switch that fired (`TouchWallF1`, `:788`): a tick is due
   * at once, whatever the VBL count. The tick itself clears it again (`CSBCode.cpp:704`),
   * so a party woken by a blow during `ProcessTimers` gets no extra tick.
   */
  clockTickSet: boolean;
  /**
   * `d.clockTick = 0` from an inhibited move (doc/CSBwin-src/CSBCode.cpp:8313) or a touch
   * of the wall that fired nothing (`TouchWallF1`, `Mouse.cpp:788`). The VBL sets
   * `clockTick` again on every VBL once `vblCount >= d.Speed` (`CSBCode.cpp:1066-1077`),
   * so a tick that was due waits one frame.
   */
  clockTickCleared: boolean;
  /** `d.newPartyLevel != -1`: a level change whose `DiscardAllInput` is still owed. */
  newPartyLevel: boolean;
}

export function createLoopFlags(): LoopFlags {
  return { clockTickSet: false, clockTickCleared: false, newPartyLevel: false };
}

/**
 * `WakeUp` (doc/CSBwin-src/CSBCode.cpp:7047) — button 146, or any blow that lands on a
 * sleeping party (`Monster.cpp:4531`, `Character.cpp:2809-2812`). `d.clockTick = 1`,
 * `d.PartySleeping = 0`, the game speed back, the adventure button lists back (the
 * host's listeners), `DiscardAllInput()`.
 *
 * Not ported: `scrollingText.SetNewSpeed`, which paces the scroll animation the port
 * does not have (DEBT G5).
 */
export function wakeUp(ctx: GameContext): void {
  ctx.loop.clockTickSet = true;
  ctx.loop.clockTickCleared = false;
  ctx.party.state.sleeping = false;
  ctx.host.sleepChanged(false);
  ctx.mouseQueue.discardAllInput();
}
