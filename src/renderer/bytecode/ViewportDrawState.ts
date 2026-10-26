/**
 * `ViewportDrawState` — what the viewport's drawing keeps from one frame to the next, which
 * CSBWin holds in statics: the bytecode machine's two stacks, the viewport's random stream
 * and `GraphicRandom`'s state. The `ViewportRenderer` that owns the context holds one
 * (`InterpreterContext.drawState`), and a game has one renderer for its page; a tool's
 * context has its own, from `viewportContextOf`, and a copy of a context shares it.
 */

import { CsbRandom } from '../../core/random';
import type { ObjectID } from '../../core/types';

export class ViewportDrawState {
  /**
   * CSBWin's `stack` and `rstack` (`doc/CSBwin-src/Viewport.cpp:2215-2247`): static rings of
   * 256 words, each indexed by a byte that `push` decrements first. They are kept from one
   * `Interpret` to the next, and a program that pops more than it pushed reads what an
   * earlier one left. `pop` and `rpop` return an `i16`; `popRN` reads the word unsigned.
   */
  readonly stack = new Uint16Array(256);
  readonly rstack = new Uint16Array(256);
  sp = 0;
  rsp = 0;

  /**
   * `viewportRandom` (`doc/CSBwin-src/Viewport.cpp:6713-6714`): CSBWin saves
   * `d.RandomNumber`, swaps this stream in for the duration of `DrawViewport`, and
   * restores the game's own value afterward, so every `STRandomBool()` a drawing
   * function calls — the lightning door's mirror/flip, for one — reads this and
   * never the sequence monster AI and combat depend on. It survives past the one
   * `BytecodeInterpreter` each redraw builds, or every frame would reroll from the same
   * point and the effect would never move.
   */
  readonly viewportRandom = new CsbRandom(0x34175432); // `Viewport.cpp:6704`

  /**
   * `GraphicRandom`'s `r` (`doc/CSBwin-src/CSBCode.cpp:576`): a C function-static, which
   * lives for the whole process rather than one call. The teleporter's shimmer is this
   * counter advancing frame over frame, not the caller re-seeding it, or every frame would
   * replay the same jitter and the effect would render frozen. A tool seeds it here.
   */
  graphicRandom = 12345;

  pop(): number {
    const v = this.stack[this.sp]!;
    this.sp = (this.sp + 1) & 0xff;
    return (v << 16) >> 16;
  }

  /** `push(i32 v)`: `stack[--sp] = (i16)v`, the low sixteen bits. */
  push(v: number): void {
    this.sp = (this.sp - 1) & 0xff;
    this.stack[this.sp] = v;
  }

  /**
   * `popRN` (`Viewport.cpp:2249-2258`): the word, unsigned. CSBWin checks it with
   * `checkIndirectIndex`; the port passes it on unchecked.
   */
  popRN(): ObjectID {
    const n = this.stack[this.sp]!;
    this.sp = (this.sp + 1) & 0xff;
    return n as ObjectID;
  }

  rpop(): number {
    const v = this.rstack[this.rsp]!;
    this.rsp = (this.rsp + 1) & 0xff;
    return (v << 16) >> 16;
  }

  rpush(v: number): void {
    this.rsp = (this.rsp - 1) & 0xff;
    this.rstack[this.rsp] = v;
  }

  /** The data stack's top `n` words as `pop` reads them, the top first, for the tools. */
  stackTop(n: number): number[] {
    return Array.from({ length: n }, (_, i) => (this.stack[(this.sp + i) & 0xff]! << 16) >> 16);
  }
}
