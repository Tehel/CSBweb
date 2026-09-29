/**
 * CSBWin-style low-level blitting to an HTML canvas backbuffer.
 *
 * This ports the intent of CSBWin's `TAG0088b2` / `BltShapeToViewport` /
 * `BLT2Screen` to a browser-friendly representation:
 * - Primary path: operate on a palette-index viewport buffer (`0..15`) and present to RGBA only at the end.
 * - Legacy path: operate on RGBA `ImageData` sources and an RGBA viewport buffer.
 *
 * NOTE: CSBWin operates on Atari ST planar buffers with "bytes per scanline".
 * Here we operate on pixel indices (0..15) for faithful transparency (index 10).
 */

import { Rect } from "./UITables";

export interface RectPos extends Rect {
  srcX?: number;
  srcY?: number;
  srcStride?: number;
  srcWidth?: number;
  srcHeight?: number;
}

export interface RGBAViewportBuffer {
  width: number;
  height: number;
  imageData: ImageData;
  pixels: Uint8ClampedArray;
}

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

export function createRGBAViewportBuffer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): RGBAViewportBuffer {
  const imageData = ctx.createImageData(width, height);
  return { width, height, imageData, pixels: imageData.data };
}

export function clearRGBA(
  buffer: RGBAViewportBuffer,
  r: number = 0,
  g: number = 0,
  b: number = 0,
  a: number = 255
): void {
  const { pixels } = buffer;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i + 0] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
  }
}

export function flushRGBA(ctx: CanvasRenderingContext2D, buffer: RGBAViewportBuffer): void {
  ctx.putImageData(buffer.imageData, 0, 0);
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value | 0;
}

export interface IndexedBitmap {
  width: number;
  height: number;
  pixels: Uint8Array;
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

export function bltRectangleToViewportIndex(
  src: IndexedBitmap,
  dst: PaletteIndexViewportBuffer,
  rect: RectPos
): void {
  // CSBWin `BltRectangleToViewport()` (CSBCode.cpp:2951) uses transparentColor=-1 (no transparency).
  tag0088b2Index(src, dst, rect, -1);
}

function modPositive(value: number, modulo: number): number {
  const v = value % modulo;
  return v < 0 ? v + modulo : v;
}

/**
 * Approximate CSBWin `TAG008c98` for chunky 4bpp sources.
 *
 * This fills `rect` from `src` using jitter offsets and an optional mask.
 * Pixels outside the mask are set to `transparentColor` (then skipped on write).
 *
 * TODO: this is a behavioural approximation, not a transcription — the jitter and mask
 * handling were reconstructed from observed output rather than read off `TAG008c98`.
 * Verify it line-by-line against the C++ before relying on it for new callers.
 */
export function tag008c98Index(
  src: IndexedBitmap,
  dst: PaletteIndexViewportBuffer,
  mask: IndexedBitmap | null,
  rect: RectPos,
  jitterX: number,
  jitterY: number,
  transparentColor: number,
  srcOffsetX: number,
  srcOffsetY: number
): void {
  const normalized = normalizeRectInclusive(rect, dst.width, dst.height);
  if (!normalized) return;

  const tcRaw = transparentColor & 0xff;
  const tc = tcRaw & 0x7f;
  const useMask = mask !== null && (tcRaw & 0x80) === 0;

  const srcW = src.width;
  const srcH = src.height;
  const maskW = mask?.width ?? 0;
  const maskH = mask?.height ?? 0;

  for (let y = normalized.y1; y <= normalized.y2; y++) {
    const sy = modPositive(srcOffsetY + jitterY + (y - normalized.y1), srcH);
    const dstRow = y * dst.width;
    const srcRow = sy * srcW;
    for (let x = normalized.x1; x <= normalized.x2; x++) {
      const sx = modPositive(srcOffsetX + jitterX + (x - normalized.x1), srcW);
      let v = src.pixels[srcRow + sx];
      if (useMask) {
        const mx = modPositive(x - normalized.x1, maskW);
        const my = modPositive(y - normalized.y1, maskH);
        const mv = mask!.pixels[my * maskW + mx];
        if (mv === 0) v = tc;
      }
      if (v === tc) continue;
      dst.pixels[dstRow + x] = v;
    }
  }
}

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

    // Keep color conversion consistent with existing `createImageData()` helper.
    const r = ((color >> 8) & 0x7) * 36;
    const g = ((color >> 4) & 0x7) * 36;
    const b = (color & 0x7) * 36;

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

      const r = ((color >> 8) & 0x7) * 36;
      const g = ((color >> 4) & 0x7) * 36;
      const b = (color & 0x7) * 36;

      const o = idx * 4;
      out[o + 0] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
}

/**
 * `TAG0088b2` port for RGBA `ImageData` sources.
 *
 * In CSBWin:
 *   TAG0088b2(src, dst, dstRect, srcX, srcY, srcBytesPerLine, dstBytesPerLine, transparentColor)
 *
 * Here:
 * - `srcX/srcY` select the top-left within `src`.
 * - Width/height are derived from `dstRect` unless overridden by `srcWidth/srcHeight`.
 * - If `transparent=true`, pixels with alpha==0 are skipped (CSBWin uses transparentColor=10).
 */
export function tag0088b2ImageData(
  src: ImageData,
  dst: RGBAViewportBuffer,
  dstRect: RectPos,
  transparent: boolean = true
): void {
  const rect = normalizeRectInclusive(dstRect, dst.width, dst.height);
  if (!rect) return;

  const srcData = src.data;
  const dstData = dst.pixels;
  const srcWidth = src.width;
  const srcHeight = src.height;

  const copyWidth = Math.min(
    rect.x2 - rect.x1 + 1,
    rect.srcWidth ?? Number.POSITIVE_INFINITY,
    srcWidth - (rect.srcX ?? 0)
  );
  const copyHeight = Math.min(
    rect.y2 - rect.y1 + 1,
    rect.srcHeight ?? Number.POSITIVE_INFINITY,
    srcHeight - (rect.srcY ?? 0)
  );

  const srcX0 = rect.srcX ?? 0;
  const srcY0 = rect.srcY ?? 0;

  for (let y = 0; y < copyHeight; y++) {
    const sy = srcY0 + y;
    const dy = rect.y1 + y;
    if (sy < 0 || sy >= srcHeight) continue;
    if (dy < 0 || dy >= dst.height) continue;

    const srcRow = sy * srcWidth;
    const dstRow = dy * dst.width;

    for (let x = 0; x < copyWidth; x++) {
      const sx = srcX0 + x;
      const dx = rect.x1 + x;
      if (sx < 0 || sx >= srcWidth) continue;
      if (dx < 0 || dx >= dst.width) continue;

      const srcIndex = (srcRow + sx) * 4;
      const a = srcData[srcIndex + 3];
      if (transparent && a === 0) continue;

      const dstIndex = (dstRow + dx) * 4;
      dstData[dstIndex + 0] = srcData[srcIndex + 0];
      dstData[dstIndex + 1] = srcData[srcIndex + 1];
      dstData[dstIndex + 2] = srcData[srcIndex + 2];
      dstData[dstIndex + 3] = a;
    }
  }
}

/**
 * `BLT2Screen` port: copy a viewport backbuffer to a screen canvas at an offset.
 *
 * In CSBWin this goes to `d.LogicalScreenBase`. Here we use `putImageData()`.
 */
export function blt2Screen(
  screenCtx: CanvasRenderingContext2D,
  viewport: RGBAViewportBuffer,
  dstX: number,
  dstY: number
): void {
  screenCtx.putImageData(viewport.imageData, dstX, dstY);
}
