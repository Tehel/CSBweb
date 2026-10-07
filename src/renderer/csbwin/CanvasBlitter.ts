/**
 * CSBWin-style low-level blitting to an HTML canvas backbuffer.
 *
 * This ports the intent of CSBWin's `TAG0088b2` / `BltShapeToViewport` to a
 * browser-friendly representation: operate on a palette-index buffer (`0..15`) and
 * convert to RGBA only at the end.
 *
 * NOTE: CSBWin operates on Atari ST planar buffers with "bytes per scanline".
 * Here we operate on pixel indices (0..15) for faithful transparency (index 10).
 */

import type { IndexedBitmap } from '../../data/CSBGraphicsLoader';
import type { Rect, RectPos } from '../../data/tables/UITables';

/** The one bitmap record, declared with the loaders that make it; the blitters' readers import it from here. */
export type { IndexedBitmap };

export interface PaletteIndexViewportBuffer {
  width: number;
  height: number;
  pixels: Uint8Array; // palette indices 0..15
}

export function createPaletteIndexViewportBuffer(
  width: number,
  height: number,
  fillIndex: number = 0
): PaletteIndexViewportBuffer {
  const pixels = new Uint8Array(width * height);
  pixels.fill(fillIndex & 0xff);
  return { width, height, pixels };
}

export function clearIndex(buffer: PaletteIndexViewportBuffer, index: number = 0): void {
  buffer.pixels.fill(index & 0xff);
}

export function fillRectIndex(buffer: PaletteIndexViewportBuffer, rect: Rect, index: number): void {
  const normalized = normalizeRectInclusive(rect, buffer.width, buffer.height);
  if (!normalized) return;

  const value = index & 0xff;
  const stride = buffer.width;
  for (let y = normalized.y1; y <= normalized.y2; y++) {
    const row = y * stride;
    for (let x = normalized.x1; x <= normalized.x2; x++) {
      buffer.pixels[row + x] = value;
    }
  }
}

export function drawRectOutlineIndex(buffer: PaletteIndexViewportBuffer, rect: Rect, index: number): void {
  const normalized = normalizeRectInclusive(rect, buffer.width, buffer.height);
  if (!normalized) return;

  const value = index & 0xff;
  const stride = buffer.width;
  const { x1, x2, y1, y2 } = normalized;

  for (let x = x1; x <= x2; x++) {
    buffer.pixels[y1 * stride + x] = value;
    buffer.pixels[y2 * stride + x] = value;
  }
  for (let y = y1; y <= y2; y++) {
    buffer.pixels[y * stride + x1] = value;
    buffer.pixels[y * stride + x2] = value;
  }
}

/**
 * `vblFlashButn` (doc/CSBwin-src/VBL.cpp:60-122): invert bit plane 2 over the rectangle,
 * corners included. The routine flips the word at `+4` of each 16-pixel group, which
 * `UnpackScreen` makes bit 2 of the pixel's index (`WinScreen.cpp:314-330`).
 */
export function vblFlashButn(buffer: PaletteIndexViewportBuffer, rect: Rect): void {
  const normalized = normalizeRectInclusive(rect, buffer.width, buffer.height);
  if (!normalized) return;

  const stride = buffer.width;
  const { x1, x2, y1, y2 } = normalized;

  for (let y = y1; y <= y2; y++) {
    const row = y * stride;
    for (let x = x1; x <= x2; x++) {
      buffer.pixels[row + x] ^= 4;
    }
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value | 0;
}

/**
 * `d.IdentityColorMap`: the colour map that leaves every colour as it is. `ShrinkBLT`'s
 * colour maps hold ten times the colour, the value its `switch (D5W/10)` decodes into
 * bit planes (`doc/CSBwin-src/Graphics.cpp:457-476`).
 */
export const IDENTITY_COLOR_MAP = new Uint8Array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]);

/**
 * `ShrinkBLT` (`doc/CSBwin-src/Graphics.cpp:380`) for chunky pixels.
 *
 * The 68000 version walks the source with a 16.16 fixed-point accumulator and picks the
 * nearest source pixel: it is a nearest-neighbour minifier, with the colour map applied
 * per pixel. The step and the starting value are transcribed exactly, including the
 * truncation to sixteen bits before the shift, because which source column each
 * destination column lands on is visible on a 48-pixel frame:
 *
 * ```c
 *   D1L = srcWidth<<10;  D1L = (D1UL/D3UW) & 0xffff;  D1L <<= 6;  A2 = D1L;  // the step
 *   D1UL >>= 1;  D1L += 0x7fff;  LOCAL_8 = D1L;                              // the start
 * ```
 *
 * The accumulators wrap at 32 bits as `D4L` and `A4` do. The source's rows are
 * `src.width` pixels apart; a position past `srcWidth` or `srcHeight` reads the last
 * column or row, where CSBWin, which never gets there, would read on.
 */
export function shrinkBlt(
  src: IndexedBitmap,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  colorMap: Uint8Array = IDENTITY_COLOR_MAP,
): IndexedBitmap {
  const out = new Uint8Array(Math.max(0, dstWidth * dstHeight));
  if (dstWidth <= 0 || dstHeight <= 0 || srcWidth <= 0 || srcHeight <= 0) {
    return { width: dstWidth, height: dstHeight, pixels: out };
  }

  const srcPx = src.pixels;
  const stepX = ((Math.floor(((srcWidth << 10) >>> 0) / dstWidth) & 0xffff) << 6) >>> 0;
  const stepY = ((Math.floor(((srcHeight << 10) >>> 0) / dstHeight) & 0xffff) << 6) >>> 0;
  const startX = ((stepX >>> 1) + 0x7fff) >>> 0;
  let accY = ((stepY >>> 1) + 0x7fff) >>> 0;

  for (let y = 0; y < dstHeight; y++) {
    const srcY = accY >>> 16;
    const srcRow = (srcY >= srcHeight ? srcHeight - 1 : srcY) * src.width;
    const dstRow = y * dstWidth;
    let accX = startX;
    for (let x = 0; x < dstWidth; x++) {
      const srcX = accX >>> 16;
      const v = srcPx[srcRow + (srcX >= srcWidth ? srcWidth - 1 : srcX)] & 0x0f;
      out[dstRow + x] = Math.floor(colorMap[v] / 10); // `switch (D5W/10)`
      accX = (accX + stepX) >>> 0;
    }
    accY = (accY + stepY) >>> 0;
  }
  return { width: dstWidth, height: dstHeight, pixels: out };
}

/**
 * `Mirror` (`doc/CSBwin-src/CSBCode.cpp:4361`): the bitmap flipped left to right. CSBWin
 * flips the buffer in place; this returns a new one.
 */
export function mirrorBitmap(src: IndexedBitmap): IndexedBitmap {
  const { width, height, pixels } = src;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) out[row + (width - 1 - x)] = pixels[row + x];
  }
  return { width, height, pixels: out };
}

/**
 * The top-left `width` x `height` of a bitmap, as CSBWin reads a graphic through a size
 * descriptor narrower than the graphic. Past the source's edges the result holds colour 0,
 * where CSBWin would read on; no data set asks for more than the graphic holds.
 */
export function cropBitmap(src: IndexedBitmap, width: number, height: number): IndexedBitmap {
  const w = Math.max(0, width | 0);
  const h = Math.max(0, height | 0);
  const out = new Uint8Array(w * h);
  const copyW = Math.min(w, src.width);
  const copyH = Math.min(h, src.height);
  for (let y = 0; y < copyH; y++) {
    const srcRow = y * src.width;
    out.set(src.pixels.subarray(srcRow, srcRow + copyW), y * w);
  }
  return { width: w, height: h, pixels: out };
}

function normalizeRectInclusive(rect: RectPos, dstWidth: number, dstHeight: number): RectPos | null {
  const x1 = clampInt(rect.x1, 0, dstWidth - 1);
  const y1 = clampInt(rect.y1, 0, dstHeight - 1);
  const x2 = clampInt(rect.x2, 0, dstWidth - 1);
  const y2 = clampInt(rect.y2, 0, dstHeight - 1);

  if (x2 < x1 || y2 < y1) return null;

  return {
    ...rect,
    x1,
    y1,
    x2,
    y2,
  };
}

/**
 * Semantic port of CSBWin `TAG0088b2` for palette-index buffers.
 *
 * CSBWin signature (Graphics.cpp:559):
 *   TAG0088b2(src, dst, dstRect, srcOffsetX, srcOffsetY, srcByteWidth, dstByteWidth, transparentColor)
 *
 * Here we treat all coordinates as pixels:
 * - `dstRect` uses inclusive coordinates, same as CSBWin (`x2-x1+1` width).
 * - `srcX/srcY` (carried via `RectPos`) select the top-left within `src`.
 * - `srcWidth/srcHeight` (carried via `RectPos`) are treated as optional copy limits.
 * - `transparentColor` matches CSBWin behavior (`10` for shapes, `-1` for no transparency).
 *
 * This does not attempt to emulate the Atari ST planar bit shifting; it operates on already-decoded pixels.
 */
export function tag0088b2Index(
  src: IndexedBitmap,
  dst: PaletteIndexViewportBuffer,
  dstRect: RectPos,
  transparentColor: number
): void {
  const rect = normalizeRectInclusive(dstRect, dst.width, dst.height);
  if (!rect) return;

  let dstX1 = rect.x1;
  let dstY1 = rect.y1;
  let dstX2 = rect.x2;
  let dstY2 = rect.y2;

  let srcX0 = rect.srcX ?? 0;
  let srcY0 = rect.srcY ?? 0;

  // Clamp source offsets.
  if (srcX0 < 0) {
    dstX1 += -srcX0;
    srcX0 = 0;
  }
  if (srcY0 < 0) {
    dstY1 += -srcY0;
    srcY0 = 0;
  }

  if (dstX2 < dstX1 || dstY2 < dstY1) return;

  let copyWidth = dstX2 - dstX1 + 1;
  let copyHeight = dstY2 - dstY1 + 1;

  // CSBWin uses srcByteWidth as the source stride; align to that if provided.
  let srcStride = rect.srcStride ?? src.width;
  let srcHeight = rect.srcHeight ?? src.height;
  if (srcStride <= 0) srcStride = src.width;
  if (srcHeight <= 0) srcHeight = src.height;

  let safeHeight = Math.floor(src.pixels.length / srcStride);
  if (safeHeight <= 0) {
    srcStride = src.width;
    srcHeight = src.height;
    safeHeight = Math.floor(src.pixels.length / srcStride);
  }
  if (safeHeight < srcHeight) srcHeight = safeHeight;

  copyWidth = Math.min(copyWidth, srcStride - srcX0);
  copyHeight = Math.min(copyHeight, srcHeight - srcY0);

  if (copyWidth <= 0 || copyHeight <= 0) return;

  const srcPixels = src.pixels;
  const dstPixels = dst.pixels;
  const dstStride = dst.width;

  const useTransparency = transparentColor >= 0;
  const tc = transparentColor & 0xff;

  for (let y = 0; y < copyHeight; y++) {
    const sy = srcY0 + y;
    const dy = dstY1 + y;
    const srcRow = sy * srcStride;
    const dstRow = dy * dstStride;

    for (let x = 0; x < copyWidth; x++) {
      const v = srcPixels[srcRow + (srcX0 + x)];
      if (useTransparency && v === tc) continue;
      dstPixels[dstRow + (dstX1 + x)] = v;
    }
  }
}

/**
 * CSBWin `TAG0088b2` with its own argument list (`doc/CSBwin-src/Graphics.cpp:559`), for the
 * callers that pass explicit offsets and line widths instead of a `RectPos`'s source bytes.
 * Widths are CSBWin's bytes per line (two pixels a byte). The source is addressed as CSBWin
 * addresses it, `src + srcY*srcByteWidth + srcX/2`, so an `srcX` past a line's end reads on
 * into the lines below. A read past the end of `src` writes nothing.
 */
export function tag0088b2Explicit(
  src: Uint8Array,
  dst: Uint8Array,
  dstRect: Rect,
  srcOffsetX: number,
  srcOffsetY: number,
  srcByteWidth: number,
  destByteWidth: number,
  transparentColor: number
): void {
  const srcStride = srcByteWidth * 2;
  const dstStride = destByteWidth * 2;
  const width = dstRect.x2 - dstRect.x1 + 1;
  const height = dstRect.y2 - dstRect.y1 + 1;
  const useTransparency = transparentColor >= 0;
  const tc = transparentColor & 0xff;
  for (let y = 0; y < height; y++) {
    const srcRow = (srcOffsetY + y) * srcStride + srcOffsetX;
    const dstRow = (dstRect.y1 + y) * dstStride + dstRect.x1;
    for (let x = 0; x < width; x++) {
      const si = srcRow + x;
      const di = dstRow + x;
      if (si >= src.length || di >= dst.length) continue;
      const v = src[si];
      if (useTransparency && v === tc) continue;
      dst[di] = v;
    }
  }
}

export function bltShapeToViewportIndex(
  src: IndexedBitmap,
  dst: PaletteIndexViewportBuffer,
  rect: RectPos
): void {
  // CSBWin `BltShapeToViewport()` (CSBCode.cpp:2930) uses transparentColor=10.
  tag0088b2Index(src, dst, rect, 10);
}

/**
 * CSBWin `TAG008c98` (`doc/CSBwin-src/Graphics.cpp:1169-1316`). It fills a temporary bitmap
 * as wide as `rect` in whole 16-pixel groups, `w_2 = (x2 - x1) / 16 + 1`, and as tall, then
 * blits it into `rect` through `TAG0088b2` with `P10`/`P11` as the source offsets and `P9` as
 * the transparent colour. `P8` is the destination's bytes per line.
 *
 * - **The source is one stream of groups.** The fill starts at group `P7` of `src` and goes
 *   back to group 0 when the count reaches `P6` (`tag008dd6`), whatever `src`'s width.
 * - **The mask** is read when `P9`'s low byte has bit 7 clear: one group of `mask` per group
 *   written, as a stream of its own that never wraps. CSBWin's bitmaps are interleaved
 *   bitplanes, and it reads the group's first word, plane 0, so a source pixel is kept where
 *   the mask pixel's bit 0 is set. Every other pixel becomes colour `P9`: CSBWin implements
 *   0 (`tag008dc8`, the planes cleared) and 10 (`tag008da4`, planes 1 and 3 set), and stops in
 *   `NotImplemented` on any other value, where this draws nothing. So does a missing mask,
 *   CSBWin's `ASSERT`.
 * - **With bit 7 set** no mask is read, and `P9 &= 0x7f` unless the byte is -1.
 *
 * A group is 16 pixels of a row, rows padded to whole groups as CSBWin's bitmaps are; the
 * padding reads as colour 0. No caller's graphic has any: the teleporter's are 32 wide and
 * its masks multiples of 16 (`tools/dump-teleporter-shimmer.ts`).
 */
export function tag008c98(
  src: IndexedBitmap,
  dst: PaletteIndexViewportBuffer,
  mask: IndexedBitmap | null,
  rect: Rect,
  P6: number,
  P7: number,
  P8: number,
  P9: number,
  P10: number,
  P11: number
): void {
  let useMask = true;
  if ((P9 & 0xff) === 0xff) useMask = false;
  else if ((P9 & 0x80) !== 0) {
    P9 &= 0x7f;
    useMask = false;
  }
  if (useMask && (mask === null || (P9 !== 0 && P9 !== 10))) return;

  const w2 = Math.trunc((rect.x2 - rect.x1) / 16) + 1;
  const groups = (rect.y2 - rect.y1 + 1) * w2;
  const temp = new Uint8Array(groups * 16);
  let group = P7;
  for (let k = 0; k < groups; k++) {
    const out = k * 16;
    for (let i = 0; i < 16; i++) {
      temp[out + i] = useMask && (groupPixel(mask!, k, i) & 1) === 0 ? P9 : groupPixel(src, group, i);
    }
    if (++group === P6) group = 0;
  }
  tag0088b2Explicit(temp, dst.pixels, rect, P10, P11, 8 * w2, P8, P9);
}

/** Pixel `i` of 16-pixel group `group` of `bitmap`, its rows padded to whole groups. */
function groupPixel(bitmap: IndexedBitmap, group: number, i: number): number {
  const groupsPerRow = (bitmap.width + 15) >> 4;
  const y = Math.floor(group / groupsPerRow);
  const x = (group % groupsPerRow) * 16 + i;
  return x < bitmap.width && y < bitmap.height ? bitmap.pixels[y * bitmap.width + x] : 0;
}

/**
 * The canvas's 8-bit channel for each Atari intensity, 0 to 7: the intensity times 36.
 * CSBWin's straight palette is RGB555, each intensity five bits `(i << 2) | (i >> 1)`
 * (`CreateOverlayTable`, `doc/CSBwin-src/Graphics.cpp:3069-3090`), which Windows widens to
 * eight; only the viewport through the overlay is shown so (`OverlayScreen.ts`). A
 * deliberate divergence (`DEBT.md` H).
 */
const atariIntensity = Uint8Array.from({ length: 8 }, (_, i) => i * 36);

export function updateImageDataFromIndex(
  imageData: ImageData,
  src: PaletteIndexViewportBuffer,
  palette: number[]
): void {
  const out = imageData.data;
  const inPx = src.pixels;
  const pixelCount = src.width * src.height;
  if (inPx.length !== pixelCount) {
    throw new Error(`Index buffer size mismatch: expected ${pixelCount}, got ${inPx.length}`);
  }
  if (imageData.width !== src.width || imageData.height !== src.height) {
    throw new Error('ImageData dimensions do not match index buffer');
  }

  for (let i = 0; i < pixelCount; i++) {
    const colorIndex = inPx[i] & 0x0f;
    const color = palette[colorIndex] ?? 0;

    const r = atariIntensity[(color >> 8) & 0x7]!;
    const g = atariIntensity[(color >> 4) & 0x7]!;
    const b = atariIntensity[color & 0x7]!;

    const o = i * 4;
    out[o + 0] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
}

export function updateImageDataFromIndexWithViewportPalette(
  imageData: ImageData,
  src: PaletteIndexViewportBuffer,
  viewportRect: Rect,
  viewportPalette: number[],
  uiPalette: number[]
): void {
  const out = imageData.data;
  const inPx = src.pixels;
  const pixelCount = src.width * src.height;
  if (inPx.length !== pixelCount) {
    throw new Error(`Index buffer size mismatch: expected ${pixelCount}, got ${inPx.length}`);
  }
  if (imageData.width !== src.width || imageData.height !== src.height) {
    throw new Error('ImageData dimensions do not match index buffer');
  }

  const x1 = clampInt(viewportRect.x1, 0, src.width - 1);
  const y1 = clampInt(viewportRect.y1, 0, src.height - 1);
  const x2 = clampInt(viewportRect.x2, 0, src.width - 1);
  const y2 = clampInt(viewportRect.y2, 0, src.height - 1);

  for (let y = 0; y < src.height; y++) {
    const row = y * src.width;
    const inViewportY = y >= y1 && y <= y2;
    for (let x = 0; x < src.width; x++) {
      const idx = row + x;
      const colorIndex = inPx[idx] & 0x0f;
      const useViewportPalette = inViewportY && x >= x1 && x <= x2;
      const palette = useViewportPalette ? viewportPalette : uiPalette;
      const color = palette[colorIndex] ?? 0;

      const r = atariIntensity[(color >> 8) & 0x7]!;
      const g = atariIntensity[(color >> 4) & 0x7]!;
      const b = atariIntensity[color & 0x7]!;

      const o = idx * 4;
      out[o + 0] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
}

/**
 * Converts again, through `palette`, the pixels of `src` that `bitmap` covers at (`x`, `y`)
 * where it is not colour `transparentColor`: a cursor drawn over the viewport, shown in
 * the palette it was drawn for rather than the viewport's.
 */
export function reconvertThroughPalette(
  imageData: ImageData,
  src: PaletteIndexViewportBuffer,
  footprint: { x: number; y: number; bitmap: IndexedBitmap },
  transparentColor: number,
  palette: number[]
): void {
  const out = imageData.data;
  const { x, y, bitmap } = footprint;
  for (let row = 0; row < bitmap.height; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= src.height) continue;
    for (let col = 0; col < bitmap.width; col++) {
      const sx = x + col;
      if (sx < 0 || sx >= src.width) continue;
      if ((bitmap.pixels[row * bitmap.width + col] & 0x0f) === transparentColor) continue;
      const idx = sy * src.width + sx;
      const color = palette[src.pixels[idx] & 0x0f] ?? 0;
      const o = idx * 4;
      out[o + 0] = atariIntensity[(color >> 8) & 0x7]!;
      out[o + 1] = atariIntensity[(color >> 4) & 0x7]!;
      out[o + 2] = atariIntensity[color & 0x7]!;
      out[o + 3] = 255;
    }
  }
}
