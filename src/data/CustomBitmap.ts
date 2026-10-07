/**
 * `CUSTOMBITMAP`, `AffineTransform4` and `AffineTransform1`
 * (`doc/CSBwin-src/Viewport.cpp:108-280`): a background graphic's pixels read and written
 * one at a time, and the transform a skin's virtual graphic is made with.
 *
 * A bitmap's pixels are in the viewport's byte order (`ApplyBackground.ts`): groups of
 * sixteen pixels, a big-endian word a bitplane, the first pixel the high bit. CSBWin reads
 * them a byte at a time, so the port does: a pixel's byte is the word's first for pixels 0
 * to 7 of its group, its second for 8 to 15. A byte outside the section reads 0 and is not
 * written, where CSBWin's would be the memory beside it.
 */
import { readU16LE, readU32LE, writeU32LE } from '../core/bytes';
import type { BackgroundPointer } from './BackgroundLib';

/** `AFFINEMASK` (`doc/CSBwin-src/CSB.h:341-355`), twelve `i32`s. */
export interface AFFINEMASK {
  Cxx: number;
  Cxy: number;
  Cxc: number;
  Cyx: number;
  Cyy: number;
  Cyc: number;
  srcX: number;
  srcY: number;
  srcWidth: number;
  srcHeight: number;
  dstWidth: number;
  dstHeight: number;
}

const AFFINEMASK_FIELDS = [
  'Cxx', 'Cxy', 'Cxc', 'Cyx', 'Cyy', 'Cyc', 'srcX', 'srcY', 'srcWidth', 'srcHeight', 'dstWidth', 'dstHeight',
] as const satisfies readonly (keyof AFFINEMASK)[];

/** `sizeof (AFFINEMASK)`. */
export const AFFINEMASK_SIZE = 4 * AFFINEMASK_FIELDS.length;

/** An `AFFINEMASK` read from a mask section, in CSBWin's native (little-endian) longwords. */
export function readAffineMask(p: BackgroundPointer): AFFINEMASK {
  const m = {} as AFFINEMASK;
  AFFINEMASK_FIELDS.forEach((field, i) => { m[field] = readU32LE(p.data, p.offset + 4 * i) | 0; });
  return m;
}

/** An `AFFINEMASK` written into a mask section, as `memcpy` copies one. */
export function writeAffineMask(data: Uint8Array, offset: number, m: AFFINEMASK): void {
  AFFINEMASK_FIELDS.forEach((field, i) => writeU32LE(data, offset + 4 * i, m[field] >>> 0));
}

/** C's `i32` division, which truncates. */
const div = (a: number, b: number): number => Math.trunc(a / b) | 0;

/** `CUSTOMBITMAP` (`Viewport.cpp:108-128`). `m_pGraphic` is a byte offset into `data`. */
export class CUSTOMBITMAP {
  private data: Uint8Array = new Uint8Array(0);
  private m_pGraphic = 0;
  private m_wordsPerRow = 0;
  private m_wordsPerGroup = 0;
  private m_maxIndex = -1; // First non-accesible word

  /**
   * `CUSTOMBITMAP::Initialize` (`:142-155`): a bitmap section, its width longword first.
   * `graphicSize` is in `i32` units. CSBWin's `m_height`, which no pixel reads, is left out.
   */
  Initialize(pGraphic: Uint8Array, numberOfBitPlanes: number, graphicSize: number): void {
    this.data = pGraphic;
    this.m_pGraphic = 4;
    const width = readU32LE(pGraphic, 0) | 0;
    this.m_wordsPerGroup = numberOfBitPlanes;
    this.m_wordsPerRow = Math.imul(div(width, 16), this.m_wordsPerGroup);
    this.m_maxIndex = Math.imul(graphicSize, 2);
  }

  /** `CUSTOMBITMAP::InitializeMask` (`:270-280`): a mask, after its twelve-byte header. */
  InitializeMask(pMask: BackgroundPointer): void {
    this.data = pMask.data;
    this.m_pGraphic = pMask.offset + 12;
    const width = readU16LE(pMask.data, pMask.offset + 8);
    const height = readU16LE(pMask.data, pMask.offset + 10);
    this.m_wordsPerGroup = 1;
    this.m_wordsPerRow = (width >> 4) * this.m_wordsPerGroup;
    this.m_maxIndex = div(Math.imul(width, height), 16);
  }

  /**
   * The word index of (x, y)'s group, the byte holding its pixel in the first plane, and
   * the pixel's bit in that byte, as the four accessors compute them.
   */
  private locate(x: number, y: number): { i: number; p: number; b: number } {
    const i = (Math.imul(div(x, 16), this.m_wordsPerGroup) + Math.imul(y, this.m_wordsPerRow)) | 0;
    let b = 15 - (x & 15);
    let p = this.m_pGraphic + 2 * i;
    if (b < 8) p++;
    else b -= 8;
    return { i, p, b };
  }

  private byte(p: number): number {
    return this.data[p] ?? 0;
  }

  private put(p: number, value: number): void {
    if (p >= 0 && p < this.data.length) this.data[p] = value & 0xff;
  }

  /** `CUSTOMBITMAP::GetPixel4` (`:157-172`): -1 past `m_maxIndex`, which it may equal. */
  GetPixel4(x: number, y: number): number {
    const { i, p, b } = this.locate(x, y);
    const mask = 1 << b;
    if (i > this.m_maxIndex) return -1;
    return (((((((this.byte(p + 6) & mask) << 1)
      | (this.byte(p + 4) & mask)) << 1)
      | (this.byte(p + 2) & mask)) << 1)
      | (this.byte(p) & mask)) >> b;
  }

  /** `CUSTOMBITMAP::PutPixel4` (`:174-193`). A pixel of -1 sets all four planes. */
  PutPixel4(x: number, y: number, pixel: number): void {
    const { i, p, b } = this.locate(x, y);
    const mask = 1 << b;
    const nmask = ~mask;
    if (i > this.m_maxIndex) return;
    pixel <<= b; // Position bottom bit
    this.put(p, (this.byte(p) & nmask) | (pixel & mask));
    pixel >>= 1;
    this.put(p + 2, (this.byte(p + 2) & nmask) | (pixel & mask));
    pixel >>= 1;
    this.put(p + 4, (this.byte(p + 4) & nmask) | (pixel & mask));
    pixel >>= 1;
    this.put(p + 6, (this.byte(p + 6) & nmask) | (pixel & mask));
  }

  /** `CUSTOMBITMAP::GetPixel1` (`:218-230`). */
  GetPixel1(x: number, y: number): number {
    const { i, p, b } = this.locate(x, y);
    const mask = 1 << b;
    if (i > this.m_maxIndex) return -1;
    return (this.byte(p) & mask) >> b;
  }

  /** `CUSTOMBITMAP::PutPixel1` (`:232-245`). */
  PutPixel1(x: number, y: number, pixel: number): void {
    const { i, p, b } = this.locate(x, y);
    const mask = 1 << b;
    const nmask = ~mask;
    if (i > this.m_maxIndex) return;
    pixel <<= b; // Position bottom bit
    this.put(p, (this.byte(p) & nmask) | (pixel & mask));
  }
}

/**
 * Where destination pixel (`col`, `row`) reads its source, as both transforms compute it:
 * the coefficients in 32nds of a pixel, the position wrapped into the source's width and
 * height. A source of width or height 0 divides by zero in CSBWin; the port's callers
 * make nothing then.
 */
function sourceOf(pAM: AFFINEMASK, col: number, row: number, xModulus: number, yModulus: number): [number, number] {
  let srcX = (Math.imul(pAM.Cxx, col) + Math.imul(pAM.Cxy, row) + pAM.Cxc + 16) | 0;
  let srcY = (Math.imul(pAM.Cyx, col) + Math.imul(pAM.Cyy, row) + pAM.Cyc + 16) | 0;
  srcX = div((((srcX % xModulus) + xModulus) | 0) % xModulus, 32);
  srcY = div((((srcY % yModulus) + yModulus) | 0) % yModulus, 32);
  return [(pAM.srcX + srcX) | 0, (pAM.srcY + srcY) | 0];
}

/** `AffineTransform4` (`Viewport.cpp:196-216`): four bitplanes. */
export function AffineTransform4(pSrc: CUSTOMBITMAP, pDst: CUSTOMBITMAP, pAM: AFFINEMASK): void {
  const xModulus = Math.imul(32, pAM.srcWidth);
  const yModulus = Math.imul(32, pAM.srcHeight);
  if (xModulus === 0 || yModulus === 0) return;
  for (let row = 0; row < pAM.dstHeight; row++) {
    for (let col = 0; col < pAM.dstWidth; col++) {
      const [x, y] = sourceOf(pAM, col, row, xModulus, yModulus);
      pDst.PutPixel4(col, row, pSrc.GetPixel4(x, y));
    }
  }
}

/** `AffineTransform1` (`Viewport.cpp:248-268`): one bitplane, a mask. */
export function AffineTransform1(pSrc: CUSTOMBITMAP, pDst: CUSTOMBITMAP, pAM: AFFINEMASK): void {
  const xModulus = Math.imul(32, pAM.srcWidth);
  const yModulus = Math.imul(32, pAM.srcHeight);
  if (xModulus === 0 || yModulus === 0) return;
  for (let row = 0; row < pAM.dstHeight; row++) {
    for (let col = 0; col < pAM.dstWidth; col++) {
      const [x, y] = sourceOf(pAM, col, row, xModulus, yModulus);
      pDst.PutPixel1(col, row, pSrc.GetPixel1(x, y));
    }
  }
}
