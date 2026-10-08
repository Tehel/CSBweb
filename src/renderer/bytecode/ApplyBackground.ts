/**
 * What a skin's program draws of its own graphics: `ApplyBackground`, `ApplyBackground3`
 * and `ApplyDecoration` (`doc/CSBwin-src/Viewport.cpp:6131-6548`), which
 * `DrawCustomGraphic` and `DrawCustomDecoration` call (`:3070-3089`, `:3109-3122`).
 *
 * CSBWin draws them into `d.pViewportBMP`, the viewport in the Atari's form: 136 lines of
 * 112 bytes, each line fourteen groups of sixteen pixels, each group four big-endian
 * words, one a bitplane, the first pixel the high bit. They work on its bytes, a group's
 * against the next one's, so the port runs them on that form: `ViewportBMP` shows the
 * port's viewport, a palette index a pixel, as those bytes. A line is converted when one
 * of its bytes is first read or written, and `flush` writes the lines written back.
 *
 * A background graphic's header words are little-endian, as CSBWin's native memory is
 * (`BackgroundLib`), but its pixels and its mask are in the viewport's byte order: a mask
 * byte covers the eight pixels of the viewport byte it is ANDed with. A byte outside the
 * viewport's 15232 reads 0 and is not written, where CSBWin's would be the memory beside
 * its viewport.
 */
import { readU16LE, readU32LE } from '../../core/bytes';
import type { BackgroundPointer } from '../../data/BackgroundLib';
import type { PaletteIndexViewportBuffer } from '../csbwin/CanvasBlitter';

const LINE_BYTES = 112;
const LINES = 136;
/** `d.pViewportBMP`'s size (`doc/CSBwin-src/CSBCode.cpp:10245`). */
export const VIEWPORT_BMP_SIZE = LINE_BYTES * LINES;

/** The port's viewport as CSBWin's `d.pViewportBMP` bytes (see the module comment). */
export class ViewportBMP {
  private readonly bytes = new Uint8Array(VIEWPORT_BMP_SIZE);
  private readonly loaded = new Uint8Array(LINES);
  private readonly written = new Uint8Array(LINES);

  constructor(private readonly viewport: PaletteIndexViewportBuffer) {}

  get(i: number): number {
    if (i < 0 || i >= VIEWPORT_BMP_SIZE) return 0;
    const line = (i / LINE_BYTES) | 0;
    if (this.loaded[line] === 0) this.load(line);
    return this.bytes[i]!;
  }

  set(i: number, value: number): void {
    if (i < 0 || i >= VIEWPORT_BMP_SIZE) return;
    const line = (i / LINE_BYTES) | 0;
    if (this.loaded[line] === 0) this.load(line);
    this.bytes[i] = value;
    this.written[line] = 1;
  }

  /** The lines written, back into the viewport's palette indices. */
  flush(): void {
    const { pixels, width } = this.viewport;
    for (let line = 0; line < LINES; line++) {
      if (this.written[line] !== 0) {
        for (let group = 0; group < 14; group++) {
          const at = line * LINE_BYTES + group * 8;
          for (let bit = 0; bit < 16; bit++) {
            let colour = 0;
            for (let plane = 0; plane < 4; plane++) {
              const word = (this.bytes[at + 2 * plane]! << 8) | this.bytes[at + 2 * plane + 1]!;
              colour |= ((word >> (15 - bit)) & 1) << plane;
            }
            pixels[line * width + group * 16 + bit] = colour;
          }
        }
      }
      this.loaded[line] = 0;
      this.written[line] = 0;
    }
  }

  private load(line: number): void {
    const { pixels, width } = this.viewport;
    for (let group = 0; group < 14; group++) {
      const at = line * LINE_BYTES + group * 8;
      for (let plane = 0; plane < 4; plane++) {
        let word = 0;
        for (let bit = 0; bit < 16; bit++) {
          word |= (((pixels[line * width + group * 16 + bit] ?? 0) >> plane) & 1) << (15 - bit);
        }
        this.bytes[at + 2 * plane] = word >> 8;
        this.bytes[at + 2 * plane + 1] = word & 0xff;
      }
    }
    this.loaded[line] = 1;
  }
}

/** `BACKGROUND_MASK`'s header (`doc/CSBwin-src/CSB.h:330-339`). */
function maskHeader(mask: BackgroundPointer) {
  const { data, offset } = mask;
  return {
    srcX: readU16LE(data, offset),
    srcY: readU16LE(data, offset + 2),
    dstX: (readU16LE(data, offset + 4) << 16) >> 16,
    dstY: readU16LE(data, offset + 6),
    width: readU16LE(data, offset + 8),
    height: readU16LE(data, offset + 10),
  };
}

/**
 * `ApplyBackground` (`Viewport.cpp:6451-6504`): the pixels of `bitmap` the mask selects,
 * from (`srcX`, `srcY`) to (`dstX`, `dstY`), sixteen at a time; `ApplyBackground3` when
 * either x is not on a group's start. `bitmap` is the section, its width longword first,
 * and `bitmapsize` its size in `ui32`s.
 */
export function ApplyBackground(
  viewportBMP: ViewportBMP,
  mask: BackgroundPointer | null,
  bitmap: Uint8Array | null,
  bitmapsize: number
): void {
  if (mask === null) return;
  if (bitmap === null) return;
  const msk = maskHeader(mask);
  if (msk.dstX > 224) return;
  if ((msk.width & 15) !== 0) return;
  if (((msk.dstX & 15) | (msk.srcX & 15)) !== 0) {
    ApplyBackground3(viewportBMP, mask, bitmap, bitmapsize);
    return;
  }
  // In `i32` units. CSBWin's are `ui32`s, so a negative `dstX` wraps, and its 32-bit
  // pointer arithmetic takes it back: the sums below are read as `ui32`s where it compares.
  const srcX = (msk.srcX >> 4) * 2;
  const srcY = msk.srcY;
  const dstX = Math.trunc(msk.dstX / 16) * 2;
  const dstY = msk.dstY;
  const width = (msk.width >> 4) * 2;
  const height = msk.height;
  const bitmapWidth = ((readU32LE(bitmap, 0) >>> 4) * 2) & 0xffff; // Prevent overflows on really bad data.
  if (((Math.imul(28, dstY + height - 1) + dstX + width) >>> 0) > 3808) {
    return; // won't fit in viewport
  }
  if (((Math.imul(bitmapWidth, srcY + height - 1) + srcX + width) >>> 0) > bitmapsize >>> 0) {
    return; // not enough source data
  }
  // Byte offsets: `bitmap++` skips the width.
  let pDstRow = 4 * (28 * dstY + dstX);
  let pSrcRow = 4 * (1 + bitmapWidth * srcY + srcX);
  let pMask = mask.offset + 12;
  const M = mask.data;
  for (let row = 0; row < height; row++) {
    let dst = pDstRow;
    let src = pSrcRow;
    for (let col = 0; col < width; col += 2) {
      // `m = *pMask | (*pMask << 16)`: the mask word's two bytes over each plane's two.
      for (let k = 0; k < 8; k++) {
        const m = M[pMask + (k & 1)] ?? 0;
        viewportBMP.set(dst + k, (viewportBMP.get(dst + k) & ~m & 0xff) | ((bitmap[src + k] ?? 0) & m));
      }
      dst += 8;
      src += 8;
      pMask += 2;
    }
    pDstRow += 4 * 28; // destination width
    pSrcRow += 4 * bitmapWidth; // source width
  }
}

/**
 * `ApplyBackground3` (`Viewport.cpp:6131-6447`): `ApplyBackground` shifted, for a source
 * or a destination off a group's start, line by line in CSBWin's four cases of the shifts.
 * The case of a destination shift under 8 and a source shift of 8 or more draws nothing:
 * its body is commented out in CSBWin. Pointers are byte offsets: `S` into `src`, `D` into
 * the viewport, `M` into the mask's section.
 */
export function ApplyBackground3(
  viewportBMP: ViewportBMP,
  mask: BackgroundPointer,
  src: Uint8Array,
  bitmapsize: number
): void {
  const msk = maskHeader(mask);
  const MD = mask.data;
  const s = (i: number): number => src[i] ?? 0;
  const m = (i: number): number => MD[i] ?? 0;
  const get = (i: number): number => viewportBMP.get(i);
  const put = (i: number, v: number): void => viewportBMP.set(i, v & 0xff);
  // CSBWin's `numFullGroups` wraps to some 2^28 groups for a mask of width 0; past the
  // viewport's end nothing more is written, so a group loop stops there.
  const pastEnd = (D: number): boolean => D >= VIEWPORT_BMP_SIZE;

  const sBit = msk.srcX & 15;
  const negativeWords = msk.dstX < 0 ? ((-msk.dstX + 15) / 16) | 0 : 0; // # words negative
  const dBit = (msk.dstX + negativeWords * 16) & 15;
  const numPixelsInSrc = Math.imul(bitmapsize - 1, 8) >>> 0;
  let SMR = dBit;
  let SML = 16 - SMR;
  let SSR = dBit - sBit;
  if (sBit > dBit) SSR += 16;
  let SSL = 16 - SSR;
  let prePixelCount = dBit;
  let pMskLine = mask.offset + 12;
  let pSrcLine = 4;
  let pDstLine = 0;
  const srcWidth = readU32LE(src, 0);
  const srcLineIncr = ((srcWidth >>> 4) * 2) & 0xffff; // Prevent overflows on really bad data.
  const srcPixelsNeeded = (Math.imul(srcWidth, msk.srcY + msk.height - 1) + msk.srcX + msk.width) >>> 0;
  if (srcPixelsNeeded > numPixelsInSrc) return;
  pSrcLine += 4 * srcLineIncr * msk.srcY;
  pSrcLine += 4 * 2 * (msk.srcX >> 4);
  const dstWidth = 224;
  const dstLineIncr = dstWidth >> 3;
  pDstLine += 4 * dstLineIncr * msk.dstY;
  if (negativeWords !== 0) {
    pDstLine -= 4 * 2 * negativeWords;
  } else {
    pDstLine += 4 * 2 * (msk.dstX >> 4);
  }
  const mskLineIncr = msk.width >> 4;
  let pixelsPerLine = msk.width;
  if (((msk.dstX + pixelsPerLine) >>> 0) > dstWidth) {
    pixelsPerLine = (dstWidth - msk.dstX) >>> 0;
  }
  const postPixelCount = (pixelsPerLine - SML) & 15;
  let numFullGroups = ((pixelsPerLine - SML) >>> 0) >>> 4;
  // One line: the first group has zero bits on the front of the mask.
  if (negativeWords !== 0) {
    numFullGroups -= negativeWords - (prePixelCount !== 0 ? 1 : 0);
    prePixelCount = 0;
    pMskLine += 2 * negativeWords;
    pDstLine += 4 * 2 * negativeWords;
    pSrcLine += 4 * 2 * negativeWords;
  }
  const nextLine = (): void => {
    pSrcLine += 4 * srcLineIncr;
    pDstLine += 4 * dstLineIncr;
    pMskLine += 2 * mskLineIncr;
  };
  let M0: number, N0: number, M1: number, N1: number;

  if (SMR === 0) {
    SSL -= 8;
    for (let i = 0; i < msk.height; i++) {
      let S = pSrcLine;
      let D = pDstLine;
      let M = pMskLine;
      for (let j = 0; j <= numFullGroups && !pastEnd(D); j++, M += 2) {
        M0 = m(M);
        M1 = m(M + 1);
        N0 = ~M0 & 0xff;
        N1 = ~M1 & 0xff;
        for (let jj = 0; jj < 4; jj++, D += 2, S += 2) {
          put(D, ((((s(S + 1) << 8) | s(S + 8)) >> SSR) & M0) | (get(D) & N0));
          put(D + 1, ((((s(S + 8) << 8) | s(S + 9)) >> SSR) & M1) | (get(D + 1) & N1));
        }
      }
      if (postPixelCount > 0) {
        M0 = m(M + 1);
        N0 = ~M0 & 0xff;
        for (let jj = 0; jj < 4; jj++, D += 2, S += 2) {
          put(D, ((s(S + 1) << SSL) & M0) | (get(D) & N0));
        }
      }
      nextLine();
    }
  } else if (SMR < 8) {
    SML -= 8;
    if (SSR < 8) {
      // SMR<8  SSR<8
      SSL -= 8;
      for (let i = 0; i < msk.height; i++) {
        let S = pSrcLine;
        let D = pDstLine;
        let M = pMskLine;
        if (prePixelCount !== 0) {
          M0 = (m(M) >> SMR) & 0xff;
          M1 = (((m(M) << 8) | m(M + 1)) >> SMR) & 0xff;
          N0 = ~M0 & 0xff;
          N1 = ~M1 & 0xff;
          M += 2;
          for (let jj = 0; jj < 4; jj++, D += 2, S += 2) {
            put(D, ((s(S) >> SSR) & M0) | (get(D) & N0));
            put(D + 1, ((((s(S) << 8) | s(S + 1)) >> SSR) & M1) | (get(D + 1) & N1));
          }
        }
        S -= 8;
        D -= 8;
        M -= 2;
        for (let j = 0; j < numFullGroups && !pastEnd(D); j++, M += 2) {
          M0 = (((m(M + 1) << 8) | m(M + 2)) >> SMR) & 0xff;
          M1 = (((m(M + 2) << 8) | m(M + 3)) >> SMR) & 0xff;
          N0 = ~M0 & 0xff;
          N1 = ~M1 & 0xff;
          for (let jj = 0; jj < 4; jj++, D += 2, S += 2) {
            put(D + 8, ((((s(S + 1) << 8) | s(S + 8)) >> SSR) & M0) | (get(D + 8) & N0));
            put(D + 9, ((((s(S + 8) << 8) | s(S + 9)) >> SSR) & M1) | (get(D + 9) & N1));
          }
        }
        if (postPixelCount > 0) {
          M0 = (m(M + 1) << SML) & 0xff;
          N0 = ~M0 & 0xff;
          for (let jj = 0; jj < 4; jj++, D += 2, S += 2) {
            put(D + 8, ((s(S + 1) << SSL) & M0) | (get(D + 8) & N0));
          }
        }
        nextLine();
      }
    } else {
      // SMR<8  SSR>=8: commented out in CSBWin, with its `NotImplemented(0xcc12)`.
    }
  } else {
    // SMR>=8
    SMR -= 8;
    if (SSR < 8) {
      // SMR>=8  SSR<8
      for (let i = 0; i < msk.height; i++) {
        let S = pSrcLine;
        let D = pDstLine;
        let M = pMskLine;
        M1 = (m(M) >> SMR) & 0xff;
        N1 = ~M1 & 0xff;
        for (let jj = 0; jj < 4; jj++, D += 2, S += 2) {
          put(D + 1, ((s(S) >> SSR) & M1) | (get(D + 1) & N1));
        }
        S -= 8;
        D -= 8;
        for (let j = 0; j < numFullGroups && !pastEnd(D); j++, M += 2) {
          M0 = (((m(M) << 8) | m(M + 1)) >> SMR) & 0xff;
          M1 = (((m(M + 1) << 8) | m(M + 2)) >> SMR) & 0xff;
          N0 = ~M0 & 0xff;
          N1 = ~M1 & 0xff;
          for (let jj = 0; jj < 4; jj++, D += 2, S += 2) {
            put(D + 8, ((((s(S) << 8) | s(S + 1)) >> SSR) & M0) | (get(D + 8) & N0));
            put(D + 9, ((((s(S + 1) << 8) | s(S + 8)) >> SSR) & M1) | (get(D + 9) & N1));
          }
        }
        if (postPixelCount !== 0) {
          M0 = (((m(M) << 8) | m(M + 1)) >> SMR) & 0xff;
          M1 = (m(M + 1) << SML) & 0xff;
          N0 = ~M0 & 0xff;
          N1 = ~M1 & 0xff;
          for (let jj = 0; jj < 4; jj++, D += 2, S += 2) {
            put(D + 8, ((((s(S) << 8) | s(S + 1)) >> SSR) & M0) | (get(D + 8) & N0));
            put(D + 9, ((((s(S + 1) << 8) | s(S + 8)) >> SSR) & M1) | (get(D + 9) & N1));
          }
        }
        nextLine();
      }
    } else {
      // SMR>=8   SSR>=8
      SSR -= 8;
      for (let i = 0; i < msk.height; i++) {
        let S = pSrcLine;
        let D = pDstLine;
        let M = pMskLine;
        if (prePixelCount !== 0) {
          M1 = (m(M) >> SMR) & 0xff;
          N1 = ~M1 & 0xff;
          M += 2;
          for (let jj = 0; jj < 4; jj++, D += 2, S += 2) {
            put(D + 1, ((s(S) >> SSR) & M1) | (get(D + 1) & N1));
          }
        }
        S -= 8;
        D -= 8;
        M -= 2;
        for (let j = 0; j < numFullGroups && !pastEnd(D); j++, M += 2) {
          M0 = (((m(M) << 8) | m(M + 1)) >> SMR) & 0xff;
          M1 = (((m(M + 1) << 8) | m(M + 2)) >> SMR) & 0xff;
          N0 = ~M0 & 0xff;
          N1 = ~M1 & 0xff;
          for (let jj = 0; jj < 4; jj++, D += 2, S += 2) {
            put(D + 8, ((((s(S) << 8) | s(S + 1)) >> SSR) & M0) | (get(D + 8) & N0));
            put(D + 9, ((((s(S + 1) << 8) | s(S + 8)) >> SSR) & M1) | (get(D + 9) & N1));
          }
        }
        if (postPixelCount !== 0) {
          M0 = (((m(M) << 8) | m(M + 1)) >> SMR) & 0xff;
          M1 = (m(M + 1) << SML) & 0xff;
          N0 = ~M0 & 0xff;
          N1 = ~M1 & 0xff;
          for (let jj = 0; jj < 4; jj++, D += 2, S += 2) {
            put(D + 8, ((((s(S) << 8) | s(S + 1)) >> SSR) & M0) | (get(D + 8) & N0));
            put(D + 9, ((((s(S + 1) << 8) | s(S + 8)) >> SSR) & M1) | (get(D + 9) & N1));
          }
        }
        nextLine();
      }
    }
  }
}

/**
 * `ApplyDecoration` (`Viewport.cpp:6507-6548`): a decoration, a byte of width and one of
 * height, then per group of sixteen pixels a mask word and the four plane words, at the
 * location's byte of x, taken to a group, and its byte of y. CSBWin's group loop counts
 * groups two at a time (`col += 2` over `width / 16`), so it draws the first half of each
 * line, rounded up, and takes the next line's from where it stopped. No data set here has
 * a decoration.
 */
export function ApplyDecoration(
  viewportBMP: ViewportBMP,
  pDecoration: BackgroundPointer | null,
  location: BackgroundPointer,
  bitmapsize: number
): void {
  if (pDecoration === null) return;
  const { data, offset } = pDecoration;
  let width = data[offset] ?? 0;
  const height = data[offset + 1] ?? 0;
  if ((width & 15) !== 0) return;
  const dstX = ((location.data[location.offset] ?? 0) >> 4) * 4; // in i16 units
  const dstY = location.data[location.offset + 1] ?? 0;
  if (((28 * (dstY + height - 1) + dstX + width) >>> 0) > 3808) {
    return; // won't fit in viewport
  }
  if (((width >> 1) + (width >> 3)) * height > bitmapsize >>> 0) {
    return; // not enough source data
  }
  // Byte offsets.
  let pDstRow = 2 * (56 * dstY + dstX);
  let pSrcRow = offset + 2;
  width = width >> 4; // 16-pixel units
  for (let row = 0; row < height; row++) {
    let dst = pDstRow;
    for (let col = 0; col < width; col += 2) {
      // `m = pSrcRow[0]`: the mask word's two bytes over each plane's two.
      for (let k = 0; k < 8; k++) {
        const mk = data[pSrcRow + (k & 1)] ?? 0;
        viewportBMP.set(dst + k, (viewportBMP.get(dst + k) & ~mk & 0xff) | ((data[pSrcRow + 2 + k] ?? 0) & mk));
      }
      dst += 8;
      pSrcRow += 10;
    }
    pDstRow += 2 * 56; // destination width
  }
}
