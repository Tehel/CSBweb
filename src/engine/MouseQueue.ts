/**
 * CSBWin's one mouse queue, `pMouseQueue` (doc/CSBwin-src/Mouse.cpp): clicks, their
 * button-ups and keys alike, as button numbers. A ring of `MOUSEQLEN` entries that keeps
 * one slot empty — `MouseQStart` is the next entry to handle, `MouseQEnd` the last one
 * queued, and `MouseQEnd + 1 == MouseQStart` means empty.
 *
 * It lives on the context (`ctx.mouseQueue`) because, as in CSBWin, more than the main
 * loop writes it: `DiscardAllInput` is called from `WakeUp`, `MoveParty`, the level load
 * (`DEBT.md` E2, "how a system reaches the loop's state"). `HandleMouseEvents`, which
 * takes the entries, stays in `Game`.
 */

/**
 * `MOUSEQLEN` — 8, because `Data.h:1513` leaves `#define NoKeyQue` commented out; the 3 on
 * `:1515` is the dead branch (doc/CSBwin-src/Data.h:1513-1518).
 */
export const MOUSEQLEN = 8;

/** The button-up `OnMouseUnClick` queues (doc/CSBwin-src/CSBCode.cpp:7594). */
export const MOUSE_UNCLICK = 0x0add;

/** One `pMouseQueue` entry: a button number and the point clicked (0,0 for a key). */
export interface MouseQueueEntry { num: number; x: number; y: number }

export class MouseQueue {
  private readonly entries: MouseQueueEntry[] =
    Array.from({ length: MOUSEQLEN }, () => ({ num: 0, x: 0, y: 0 }));
  private start = 0;
  private end = MOUSEQLEN - 1;

  /**
   * A key, `TAG0196da` (doc/CSBwin-src/CSBCode.cpp:8429): queued unless the queue is
   * full — `MouseQEnd + 2 == MouseQStart`, seven entries waiting (`:8439-8443`). Says
   * whether it was queued.
   */
  enqueueKey(num: number): boolean {
    let end = this.end + 2;
    if (end > MOUSEQLEN - 1) end -= MOUSEQLEN;
    if (end === this.start) return false;
    this.end = (this.end + 1) % MOUSEQLEN;
    this.entries[this.end] = { num, x: 0, y: 0 };
    return true;
  }

  /**
   * The queueing half of `OnMouseClick` (doc/CSBwin-src/CSBCode.cpp:7607): queued only
   * while fewer than `MOUSEQLEN-2` entries wait — there must be room left for the
   * button-up — and never for a click that hit no button (`:7626-7690`). Says whether it
   * was queued.
   */
  enqueueClick(num: number, x: number, y: number): boolean {
    if (num === 0) return false;
    if (this.count() >= MOUSEQLEN - 2) return false;
    this.end = (this.end + 1) % MOUSEQLEN;
    this.entries[this.end] = { num, x, y };
    return true;
  }

  /**
   * `OnMouseUnClick` (doc/CSBwin-src/CSBCode.cpp:7581): the button-up, `0x0add`, queued
   * while fewer than `MOUSEQLEN-1` entries wait — whether or not its click was.
   */
  enqueueUnClick(): void {
    if (this.count() >= MOUSEQLEN - 1) return;
    this.end = (this.end + 1) % MOUSEQLEN;
    this.entries[this.end] = { num: MOUSE_UNCLICK, x: 0, y: 0 };
  }

  /** `numEnt`: how many entries wait (doc/CSBwin-src/CSBCode.cpp:7589-7590). */
  count(): number {
    return (this.end - this.start + 1 + MOUSEQLEN) % MOUSEQLEN;
  }

  /** The entry `HandleMouseEvents` would take next, left in place. */
  head(): MouseQueueEntry {
    return this.entries[this.start];
  }

  /** `MouseQStart++`, wrapped: the head is taken. */
  take(): void {
    this.start = (this.start + 1) % MOUSEQLEN;
  }

  /**
   * `DiscardAllInput` (doc/CSBwin-src/CSBCode.cpp:7532-7544): the queue is reset to
   * empty, `MouseQStart = 0`, `MouseQEnd = MOUSEQLEN-1` — every key and click that was
   * waiting is lost.
   */
  discardAllInput(): void {
    this.start = 0;
    this.end = MOUSEQLEN - 1;
  }
}
