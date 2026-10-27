/**
 * The screen's graphics, which the viewport's interpreter and the interface share: the
 * basic graphics of `graphics.dat` (`GetBasicGraphicAddress`), and the derived graphics the
 * drawing makes from them, a shrunk object or door ornament, under CSBWin's derived numbers
 * (`AllocateDerivedGraphic` and `GetDerivedGraphicAddress`,
 * `doc/CSBwin-src/CSBCode.cpp:11446-11510`).
 */

import type { GraphicsLoader } from '../data/GraphicsLoader';
import type { IndexedBitmap } from './csbwin/CanvasBlitter';

export class GraphicsStore {
  /** The basic graphics that did not decode, traced once each. */
  private readonly failed = new Set<number>();
  private readonly derived = new Map<number, IndexedBitmap>();

  constructor(
    private readonly loader: GraphicsLoader,
    private readonly trace: (line: string) => void,
  ) {}

  /**
   * Graphic `graphicNum` as palette indices, decoded once by the loader. `null` for a
   * negative number, or a graphic that does not decode, which is traced the first time.
   */
  basicGraphic(graphicNum: number): IndexedBitmap | null {
    if (graphicNum < 0 || this.failed.has(graphicNum)) return null;
    try {
      return this.loader.getImage(graphicNum);
    } catch (error) {
      this.failed.add(graphicNum);
      this.trace(`graphics.dat item ${graphicNum} does not decode: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Derived graphic `derivedNum`: kept since `make` made it, or made now. `make`'s `null`,
   * a source that does not decode, is not kept.
   */
  derivedGraphic(derivedNum: number, make: () => IndexedBitmap): IndexedBitmap;
  derivedGraphic(derivedNum: number, make: () => IndexedBitmap | null): IndexedBitmap | null;
  derivedGraphic(derivedNum: number, make: () => IndexedBitmap | null): IndexedBitmap | null {
    const bitmap = this.derived.get(derivedNum);
    if (bitmap) return bitmap;
    const made = make();
    if (made) this.derived.set(derivedNum, made);
    return made;
  }

  /** `DeleteGraphic(derivedNum | 0x8000)` (`doc/CSBwin-src/Graphics.cpp:2047`): made again when next asked for. */
  deleteDerivedGraphic(derivedNum: number): void {
    this.derived.delete(derivedNum);
  }
}
