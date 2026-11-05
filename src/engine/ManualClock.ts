/**
 * A `GameHost.clock` its owner moves itself, so that whoever runs the page's loop
 * (`Game.gameLoop`) without a page, a tool or a path played headless
 * (`src/renderer/StandInPage.ts`), reads no wall clock and waits for no timer: its time
 * is `time`, and the call the loop asked for runs when the owner moves the time on.
 */
import type { LoopClock } from './GameHost';

export class ManualClock implements LoopClock {
  time = 1_000_000;
  /** The call asked for and its delay; the loop keeps one at most. */
  pending: { call: () => void; ms: number } | null = null;

  now(): number {
    return this.time;
  }

  setTimeout(call: () => void, ms: number): unknown {
    this.pending = { call, ms };
    return this.pending;
  }

  clearTimeout(handle: unknown): void {
    if (handle === this.pending) this.pending = null;
  }

  /** `ms` on, then the call pending, if there is one: whether there was. */
  advance(ms: number): boolean {
    this.time += ms;
    const pending = this.pending;
    this.pending = null;
    pending?.call();
    return pending !== null;
  }
}
