/**
 * `ViewportDraw` — what the viewport's drawing functions share with the bytecode machine
 * that calls them: the `InterpreterContext`, the mirrored and flipped copies of the
 * bitmaps they draw, and the blits into the viewport buffer. CSBWin's drawing functions
 * (`Viewport.cpp`, `CSBCode.cpp`, `Code51a4.cpp`) reach the same things as globals.
 *
 * `BytecodeInterpreter` builds one per redraw. A tool builds its own over a stub context
 * and calls a drawing function with it, and can replace a blit helper on that instance.
 */

import type { RectPos } from '../../data/tables/UITables';
import {
  bltShapeToViewportIndex,
  mirrorBitmap,
  shrinkBlt,
  tag0088b2Index,
  type IndexedBitmap,
} from '../csbwin/CanvasBlitter';
import type { InterpreterContext } from './BytecodeInterpreter';

export class ViewportDraw {
  private mirrorCache = new WeakMap<IndexedBitmap, IndexedBitmap>();
  private flipCache = new WeakMap<IndexedBitmap, IndexedBitmap>();

  constructor(readonly context: InterpreterContext) {}

  getMirroredBitmap(src: IndexedBitmap): IndexedBitmap {
    const cached = this.mirrorCache.get(src);
    if (cached) return cached;

    const mirrored = mirrorBitmap(src);
    this.mirrorCache.set(src, mirrored);
    return mirrored;
  }

  getFlippedBitmapVertical(src: IndexedBitmap): IndexedBitmap {
    const cached = this.flipCache.get(src);
    if (cached) return cached;

    const { width, height, pixels } = src;
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const srcRow = y * width;
      const dstRow = (height - 1 - y) * width;
      out.set(pixels.subarray(srcRow, srcRow + width), dstRow);
    }
    const flipped = { width, height, pixels: out };
    this.flipCache.set(src, flipped);
    return flipped;
  }

  scaleIndexedBitmap(
    src: IndexedBitmap,
    dstWidth: number,
    dstHeight: number,
    colorMap?: Uint8Array,
    mirror?: boolean
  ): IndexedBitmap {
    const scaled = shrinkBlt(src, src.width, src.height, dstWidth, dstHeight, colorMap);
    return mirror ? this.getMirroredBitmap(scaled) : scaled;
  }

  blitShapeToViewportIndexWithTransparent(
    bitmap: IndexedBitmap,
    rect: RectPos,
    transparentColor: number,
    mirror: boolean = false
  ): void {
    const src = mirror ? this.getMirroredBitmap(bitmap) : bitmap;
    tag0088b2Index(src, this.context.viewportIndexBuffer, rect, transparentColor);
  }

  blitShapeBitmapToViewport(bitmap: IndexedBitmap, rect: RectPos, mirror: boolean): void {
    // -> Blitting ${mirror ? 'mirrored ' : ''}bitmap ${bitmap.width}x${bitmap.height} to rect (${rect.x1}, ${rect.y1}, ${rect.x2}, ${rect.y2}

    const src = mirror ? this.getMirroredBitmap(bitmap) : bitmap;
    bltShapeToViewportIndex(src, this.context.viewportIndexBuffer, rect);
  }
}
