/**
 * CSBWin's one mouse queue, `pMouseQueue` (doc/CSBwin-src/Mouse.cpp): clicks, their
 * button-ups and keys alike. A key and a button-up are queued as their button numbers; a
 * click is queued untranslated, with its point and mouse buttons, and matched to its
 * button only when `HandleMouseEvents` comes to it (`POST_TRANSLATE_CLICK`,
 * doc/CSBwin-src/CSB.h:1716-1779). A ring of `MOUSEQLEN` entries that keeps
 * one slot empty — `MouseQStart` is the next entry to handle, `MouseQEnd` the last one
 * queued, and `MouseQEnd + 1 == MouseQStart` means empty.
 *
 * It lives on the context (`ctx.mouseQueue`) because, as in CSBWin, more than the main
 * loop writes it: `DiscardAllInput` is called from `WakeUp`, `MoveParty`, the level load.
 * `HandleMouseEvents`, which takes the entries, stays in `Game`.
 */

/**
 * `MOUSEQLEN` — 8, because `Data.h:1528` leaves `#define NoKeyQue` commented out; the 3 on
 * `:1530` is the dead branch (doc/CSBwin-src/Data.h:1528-1533).
 */
export const MOUSEQLEN = 8;

/** The button-up `OnMouseUnClick` queues (doc/CSBwin-src/CSBCode.cpp:7653). */
export const MOUSE_UNCLICK = 0x0add;

/**
 * `UNTRANSLATED_CLICK`: the `translatedButtonNum` of a click not yet matched to its button
 * (doc/CSBwin-src/CSB.h:1735).
 */
export const UNTRANSLATED_CLICK = 0xfffe;

/**
 * One `pMouseQueue` entry, `MouseQueueEnt` (doc/CSBwin-src/CSB.h:1726-1781): a
 * button number, `UNTRANSLATED_CLICK` until a click is translated, the point clicked (0,0
 * for a key), and a click's mouse buttons, `SearchButtonList`'s mask.
 */
export interface MouseQueueEntry { num: number; x: number; y: number; buttons: number }

export class MouseQueue {
  private readonly entries: MouseQueueEntry[] =
    Array.from({ length: MOUSEQLEN }, () => ({ num: 0, x: 0, y: 0, buttons: 0 }));
  private start = 0;
  private end = MOUSEQLEN - 1;

  /**
   * A key, `TAG0196da` (doc/CSBwin-src/CSBCode.cpp:8516): queued unless the queue is
   * full — `MouseQEnd + 2 == MouseQStart`, seven entries waiting (`:8526-8530`). Says
   * whether it was queued.
   */
  enqueueKey(num: number): boolean {
    let end = this.end + 2;
    if (end > MOUSEQLEN - 1) end -= MOUSEQLEN;
    if (end === this.start) return false;
    this.end = (this.end + 1) % MOUSEQLEN;
    this.entries[this.end] = { num, x: 0, y: 0, buttons: 0 };
    return true;
  }

  /**
   * `OnMouseClick` (doc/CSBwin-src/CSBCode.cpp:7670): the click queued as
   * `UNTRANSLATED_CLICK` with its point and mouse buttons, only while fewer than
   * `MOUSEQLEN-2` entries wait — there must be room left for the button-up
   * (`:7694-7711`). A click that hits no button is queued too, and dropped when it is
   * translated (`Game.handleMouseEvents`). Says whether it was queued.
   */
  enqueueClick(x: number, y: number, buttons: number): boolean {
    if (this.count() >= MOUSEQLEN - 2) return false;
    this.end = (this.end + 1) % MOUSEQLEN;
    this.entries[this.end] = { num: UNTRANSLATED_CLICK, x, y, buttons };
    return true;
  }

  /**
   * `OnMouseUnClick` (doc/CSBwin-src/CSBCode.cpp:7640): the button-up, `0x0add`, queued
   * while fewer than `MOUSEQLEN-1` entries wait — whether or not its click was.
   */
  enqueueUnClick(): void {
    if (this.count() >= MOUSEQLEN - 1) return;
    this.end = (this.end + 1) % MOUSEQLEN;
    this.entries[this.end] = { num: MOUSE_UNCLICK, x: 0, y: 0, buttons: 0 };
  }

  /** `numEnt`: how many entries wait (doc/CSBwin-src/CSBCode.cpp:7648-7649). */
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
   * `DiscardAllInput` (doc/CSBwin-src/CSBCode.cpp:7591-7603): the queue is reset to
   * empty, `MouseQStart = 0`, `MouseQEnd = MOUSEQLEN-1` — every key and click that was
   * waiting is lost.
   */
  discardAllInput(): void {
    this.start = 0;
    this.end = MOUSEQLEN - 1;
  }
}
