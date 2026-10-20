/**
 * CSBgraphics.dat loader (CSBWin overlay graphics).
 *
 * Implements ReadCSBgraphic + OVLDECODE from CSBWin Graphics.cpp.
 * Used for extended wall/floor decorations (ReadWallDecoration/ReadFloorDecoration), the
 * portraits past graphic 26's, the sounds a DSA's `&SOUND` plays (`SoundQueue`), and the
 * alternate monster graphics (`AltMonGraphics`).
 */

import type { ui32 } from '../core/types';
import { readU16LE, readU32LE } from '../core/bytes';
import { MAX_EXPANDED_SIZE } from '../core/compression';
import { Die } from '../engine/Die';
import { Signature, type FileSignature } from './FileSignature';

export enum CSBGraphicType {
  ViewportOverlay = 0,
  Portrait = 1,
  Sound = 2,
  Backgrounds = 3,
  OverlayPalette = 4,
  AlternateMonsterGraphic = 5,
  WallDecoration = 6,
  FloorDecoration = 7,
}

export interface DecorationDesc {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  widthBytes: number;
  height: number;
}

interface ExtendedWallDecoration {
  id: number;
  desc: DecorationDesc[]; // 13 entries (relative positions 0..12)
  sideBitmap: IndexedBitmap;
  frontBitmap: IndexedBitmap;
}

export interface ExtendedFloorDecoration {
  id: number;
  desc: DecorationDesc[]; // 9 entries (relative cells 0..8)
  mirrorFlags: number;
  bitmap: IndexedBitmap;
}

export interface IndexedBitmap {
  width: number;
  height: number;
  pixels: Uint8Array;
}

interface SectionHeader {
  type: ui32;
  id: ui32;
  compressedSize: ui32;
  uncompressedSize: ui32;
  fileOffset: ui32;
  name: string;
}

export const CSBGRAPHICS_SENTINEL = 'CSBg';
const SECTION_HEADER_SIZE = 36; // 5 * u32 + 16-byte name
const WALL_DEC_MIN_SIZE = 92;
const FLOOR_DEC_MIN_SIZE = 92;
/** `sizeof(CSB_BITMAPFILEHEADER)`, packed (`doc/CSBwin-src/CSB.h:18`, `:314-320`). */
const BITMAP_FILE_HEADER_SIZE = 14;
/** `sizeof(CSB_BITMAPINFOHEADER)` (`doc/CSBwin-src/CSB.h:299-311`). */
const BITMAP_INFO_HEADER_SIZE = 40;
/** `ImportBitmap`'s `minSize`: the two headers and one colour (`Bitmaps.cpp:284-286`). */
const PORTRAIT_MIN_SIZE = BITMAP_FILE_HEADER_SIZE + BITMAP_INFO_HEADER_SIZE + 4;
const EXTERNAL_PORTRAIT_WIDTH = 32;
const EXTERNAL_PORTRAIT_HEIGHT = 29;

/**
 * `errorPortraitBitmap` (`doc/CSBwin-src/Bitmaps.cpp:464-524`): the 32x29 picture
 * `GetErrorPortrait` gives in place of a portrait it cannot read. Atari bitplanes, as
 * every bitmap in CSBWin's memory: per line, two groups of 16 pixels, each four
 * big-endian plane words, plane 0 carrying bit 0 of the colour and the leftmost pixel
 * in bit 15.
 */
const ERROR_PORTRAIT_BITMAP = new Uint8Array([
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0x83,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xBF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xBF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0x86,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xBE,0x8F,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xBE,0x7F,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xBE,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xBE,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0x82,0xEF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFE,0xE8,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFE,0xE7,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFE,0xEF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFE,0xEF,0x00,0x00,0x00,0x00,
  0x00,0x00,0x0F,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xEE,0x00,0x00,0x00,0x00,
  0x00,0x00,0xF7,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xEE,0x00,0x00,0x00,0x00,
  0x00,0x00,0xF7,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xEE,0x00,0x00,0x00,0x00,
  0x00,0x00,0xF7,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xEE,0x00,0x00,0x00,0x00,
  0x00,0x00,0xF6,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFE,0x00,0x00,0x00,0x00,
  0x00,0x00,0xF6,0x8F,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFE,0x00,0x00,0x00,0x00,
  0x00,0x00,0xF6,0x7F,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFE,0x00,0x00,0x00,0x00,
  0x00,0x00,0xF6,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0x0E,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFE,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFE,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFE,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFE,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
  0x00,0x00,0xFF,0xFF,0x00,0x00,0x00,0x00,
]);

function readAsciiZ(data: Uint8Array, off: number, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    const v = data[off + i] ?? 0;
    if (v === 0) break;
    out += String.fromCharCode(v);
  }
  return out;
}

function readDecorationDesc(data: Uint8Array, off: number): DecorationDesc {
  return {
    x1: data[off + 0] ?? 0,
    x2: data[off + 1] ?? 0,
    y1: data[off + 2] ?? 0,
    y2: data[off + 3] ?? 0,
    widthBytes: data[off + 4] ?? 0,
    height: data[off + 5] ?? 0,
  };
}

/** `m_maxstack`: the stack `OVLDECODE` allocates, and never enlarges. */
const OVL_STACK_SIZE = 1024;

/**
 * `OVLDECODE` (`doc/CSBwin-src/Graphics.cpp:3119-3211`). The table is `m_maxTableLen` wide,
 * but only stored as far as `m_tableLen` has filled it, its unwritten entries 0: an escape
 * doubles it for a few bits, and a damaged section can ask for more than memory holds. A
 * write past `m_maxTableLen` is dropped, where CSBWin's runs past its allocation.
 */
class OvlDecode {
  private codes = new Uint32Array(512);
  private chars = new Uint8Array(512);
  private codeSize = 9;
  private bitsRemaining = 0;
  private codeword = 0;
  private tableLen = 255;
  private maxTableLen = 512;
  private readonly stack = new Uint8Array(OVL_STACK_SIZE);
  private stackLen = 0;
  private a = 0;
  private b = 0;
  private c = 0;
  private ch = 0;

  constructor(private getCodeword: () => number) {}

  private enlargeTable(): void {
    this.maxTableLen *= 2;
    this.codeSize++;
  }

  /**
   * `m_stack[m_stklen++] = byte`, then `if (m_stklen >= m_maxstack) EnlargeStack()`, which
   * is `NotImplemented(0xf864)` (`doc/CSBwin-src/Graphics.cpp:3143-3146`): a chain longer
   * than the stack, as a damaged section's cyclic one is, ends the program.
   */
  private push(byte: number): void {
    this.stack[this.stackLen++] = byte;
    if (this.stackLen >= OVL_STACK_SIZE) {
      throw new Die(0xf864, 'You have encountered code at relative address 0x00f864 that I thought was unused.');
    }
  }

  /** `m_codes[m_tableLen] = a; m_chars[m_tableLen] = c`, the storage grown to hold it. */
  private addEntry(a: number, c: number): void {
    if (this.tableLen >= this.maxTableLen) return;
    if (this.tableLen >= this.codes.length) {
      const length = Math.min(this.codes.length * 2, this.maxTableLen);
      const nextCodes = new Uint32Array(length);
      nextCodes.set(this.codes);
      this.codes = nextCodes;
      const nextChars = new Uint8Array(length);
      nextChars.set(this.chars);
      this.chars = nextChars;
    }
    this.codes[this.tableLen] = a;
    this.chars[this.tableLen] = c;
  }

  getBytes(out: Uint8Array): void {
    let outPos = 0;
    const outLen = out.length;
    while (outPos < outLen) {
      if (this.stackLen > 0) {
        out[outPos++] = this.stack[--this.stackLen] ?? 0;
        continue;
      }

      let numbits = this.codeSize;
      if (numbits > this.bitsRemaining) numbits = this.bitsRemaining;
      this.b = this.codeword & ((1 << numbits) - 1);
      this.bitsRemaining -= numbits;
      this.codeword >>>= numbits;
      numbits = this.codeSize - numbits;
      if (numbits > 0) {
        this.codeword = this.getCodeword() >>> 0;
        this.bitsRemaining = 32;
        this.b = (this.b << numbits) | (this.codeword & ((1 << numbits) - 1));
        this.bitsRemaining -= numbits;
        this.codeword >>>= numbits;
      }

      if (this.b >= this.tableLen && this.b > 0xff) {
        if (this.b === this.maxTableLen - 1) {
          this.enlargeTable();
          continue;
        }
        this.push(this.c & 0xff);
        for (this.ch = this.a; this.ch > 255; this.ch = this.codes[this.ch] ?? 0) {
          this.push(this.chars[this.ch] ?? 0);
        }
        this.push(this.ch & 0xff);
      } else {
        for (this.ch = this.b; this.ch > 255; this.ch = this.codes[this.ch] ?? 0) {
          this.push(this.chars[this.ch] ?? 0);
        }
        this.push(this.ch & 0xff);
      }

      this.c = this.ch;
      this.addEntry(this.a >>> 0, this.c & 0xff);
      this.tableLen++;
      this.a = this.b >>> 0;
    }
  }
}

/**
 * A graphic as CSBWin keeps one in memory, the Atari's: each line in groups of 16 pixels,
 * each group four big-endian words, one per bitplane, the first pixel the high bit.
 */
export function decodePlanar(data: Uint8Array, width: number, height: number): Uint8Array {
  const groups = (width + 15) >> 4;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let group = 0; group < groups; group++) {
      const at = (y * groups + group) * 8;
      for (let bit = 0; bit < 16 && group * 16 + bit < width; bit++) {
        let colour = 0;
        for (let plane = 0; plane < 4; plane++) {
          const word = ((data[at + plane * 2] ?? 0) << 8) | (data[at + plane * 2 + 1] ?? 0);
          colour |= ((word >> (15 - bit)) & 1) << plane;
        }
        out[y * width + group * 16 + bit] = colour;
      }
    }
  }
  return out;
}

/** `GetErrorPortrait` (`doc/CSBwin-src/Bitmaps.cpp:526-536`). */
export const ERROR_PORTRAIT: IndexedBitmap = {
  width: EXTERNAL_PORTRAIT_WIDTH,
  height: EXTERNAL_PORTRAIT_HEIGHT,
  pixels: decodePlanar(ERROR_PORTRAIT_BITMAP, EXTERNAL_PORTRAIT_WIDTH, EXTERNAL_PORTRAIT_HEIGHT),
};

/**
 * `GetExternalPortraitAddress` (`doc/CSBwin-src/Bitmaps.cpp:540-571`): portrait `index`
 * of `CSBgraphics.dat`, for a `charID` past graphic 26's 24 cells. A portrait that cannot
 * be read, the file missing or the section absent or malformed, or that is not 32 by 29,
 * is the error portrait. CSBWin caches the answer by index, error portrait included,
 * as `csbGraphics` does.
 *
 * CSBWin also puts up a message box for each failure (`bmpError`, and `ReadCSBgraphic`'s
 * "Missing section" once): the executable's, not the game's, and as for every section
 * this loader reads, the port shows none.
 */
export function getExternalPortraitAddress(csbGraphics: CSBGraphicsLoader | null | undefined, index: number): IndexedBitmap {
  return csbGraphics?.getExternalPortrait(index) ?? ERROR_PORTRAIT;
}

/**
 * A data set's `CSBgraphics.dat`, or the file's absence: a loader that loads nothing is a
 * data set without one, which reads no section and still opens as CSBWin's does
 * (`opener`).
 */
export class CSBGraphicsLoader {
  private data: Uint8Array | null = null;
  private sections: SectionHeader[] = [];
  private wallCache = new Map<number, ExtendedWallDecoration>();
  private floorCache = new Map<number, ExtendedFloorDecoration>();
  private portraitCache = new Map<number, IndexedBitmap>();
  /** `CSBgraphicSignature1/2`: the file's `Signature`, taken as it loads. */
  private fileSignature: FileSignature | null = null;
  /**
   * `CSBgraphicsFile.f >= 0`: the file has opened, and is not checked again. Public so
   * that `tools/` can close it again, as only CSBWin's shutdown does
   * (`CSBgraphicsFile.Cleanup()`, `doc/CSBwin-src/Graphics.cpp:2236`).
   */
  opened = false;
  /**
   * `OpenCSBgraphicsFile`, which `ReadCSBgraphic` calls first
   * (`doc/CSBwin-src/Graphics.cpp:3246`): the game's checks (`csbGraphicsOpener`,
   * `src/engine/FileSignatures.ts`), given the signature, or `null` for a file that is not
   * there, and true when the file opens. One that dies refuses the file: nothing more is
   * read from it. Left `null`, as a tool leaves it, the file opens unchecked.
   */
  opener: ((signature: FileSignature | null) => boolean) | null = null;
  /**
   * What `ReadCSBgraphic` does besides its message box when the file will not open, the
   * first time it fails at all (`doc/CSBwin-src/Graphics.cpp:3247-3255`): `overlayActive =
   * false` (`Overlay.active`). Its `firstTime` is one for every failure, so a missing
   * section said first means this never happens.
   */
  cannotOpen: (() => void) | null = null;
  /** `ReadCSBgraphic`'s `firstTime`, cleared by its first failure. */
  private firstTime = true;

  /** The file at `url`. One that will not load or parse throws: the page refuses it. */
  async load(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
    }
    const buf = new Uint8Array(await response.arrayBuffer());
    this.loadFromArray(buf);
  }

  loadFromArray(data: Uint8Array): void {
    this.sections = this.parseSections(data);
    this.data = data;
    this.fileSignature = Signature(data);
  }

  /** The file's signature, or `null` for a loader that loaded none. */
  getSignature(): FileSignature | null {
    return this.fileSignature;
  }

  getWallDecoration(id: number): ExtendedWallDecoration | null {
    const cached = this.wallCache.get(id);
    if (cached) return cached;

    const raw = this.readSection(CSBGraphicType.WallDecoration, id, WALL_DEC_MIN_SIZE);
    if (!raw) return null;

    const descCount = 13;
    const desc: DecorationDesc[] = new Array(descCount);
    for (let i = 0; i < descCount; i++) {
      desc[i] = readDecorationDesc(raw, i * 6);
    }

    const bitmapOffset = descCount * 6 + 2; // +2 alignment padding (CSBCode.cpp:3217)
    const sideDesc = desc[11];
    const frontDesc = desc[12];
    const sideSize = sideDesc.widthBytes * sideDesc.height;
    const frontSize = frontDesc.widthBytes * frontDesc.height;
    if (bitmapOffset + sideSize + frontSize > raw.length) return null;

    const sideRaw = raw.subarray(bitmapOffset, bitmapOffset + sideSize);
    const frontRaw = raw.subarray(bitmapOffset + sideSize, bitmapOffset + sideSize + frontSize);

    // Bitplanes, as `DrawWallDecoration` hands them to `ShrinkBLT` and `TAG0088b2`
    // (`doc/CSBwin-src/CSBCode.cpp:3263-3267`, `:3383-3392`).
    const sidePixels = decodePlanar(sideRaw, sideDesc.widthBytes * 2, sideDesc.height);
    const frontPixels = decodePlanar(frontRaw, frontDesc.widthBytes * 2, frontDesc.height);

    const sideBitmap: IndexedBitmap = {
      width: sideDesc.widthBytes * 2,
      height: sideDesc.height,
      pixels: sidePixels,
    };
    const frontBitmap: IndexedBitmap = {
      width: frontDesc.widthBytes * 2,
      height: frontDesc.height,
      pixels: frontPixels,
    };

    const out: ExtendedWallDecoration = { id, desc, sideBitmap, frontBitmap };
    this.wallCache.set(id, out);
    return out;
  }

  getFloorDecoration(id: number): ExtendedFloorDecoration | null {
    const cached = this.floorCache.get(id);
    if (cached) return cached;

    const raw = this.readSection(CSBGraphicType.FloorDecoration, id, FLOOR_DEC_MIN_SIZE);
    if (!raw) return null;

    const descCount = 9;
    const desc: DecorationDesc[] = new Array(descCount);
    for (let i = 0; i < descCount; i++) {
      desc[i] = readDecorationDesc(raw, i * 6);
    }

    const mirrorFlags = readU16LE(raw, descCount * 6);
    const bitmapOffset = descCount * 6 + 2;
    const baseDesc = desc[7];
    const bitmapSize = baseDesc.widthBytes * baseDesc.height;
    if (bitmapOffset + bitmapSize > raw.length) return null;

    const bitmapRaw = raw.subarray(bitmapOffset, bitmapOffset + bitmapSize);
    // Bitplanes, as `DrawFloorDecorations` hands them to `ShrinkBLT` and `TAG0088b2`
    // (`doc/CSBwin-src/CSBCode.cpp:3898`).
    const pixels = decodePlanar(bitmapRaw, baseDesc.widthBytes * 2, baseDesc.height);
    const bitmap: IndexedBitmap = {
      width: baseDesc.widthBytes * 2,
      height: baseDesc.height,
      pixels,
    };

    const out: ExtendedFloorDecoration = { id, desc, mirrorFlags, bitmap };
    this.floorCache.set(id, out);
    return out;
  }

  /** `getExternalPortraitAddress`'s cache, filled through `importBitmap`. */
  getExternalPortrait(index: number): IndexedBitmap {
    const cached = this.portraitCache.get(index);
    if (cached) return cached;
    let bitmap = this.importBitmap(index) ?? ERROR_PORTRAIT;
    if (bitmap.width !== EXTERNAL_PORTRAIT_WIDTH || bitmap.height !== EXTERNAL_PORTRAIT_HEIGHT) {
      bitmap = ERROR_PORTRAIT;
    }
    this.portraitCache.set(index, bitmap);
    return bitmap;
  }

  /**
   * `ImportBitmap(ui32 index, …)` (`doc/CSBwin-src/Bitmaps.cpp:246-435`): a `CGT_Portrait`
   * section, a 16-colour Windows bitmap. Its pixels are palette indices as they stand: the
   * colour table is stepped over (`biClrUsed` entries, or 16), never read, and the pixels
   * start right after it, whatever `bfOffBits` says. Rows are bottom-up, `(width+1)/2`
   * bytes each with no padding to four, the high nibble the left pixel. CSBWin writes them
   * into bitplanes rounded up to 16 pixels, the extra ones 0; here the bitmap is
   * `width` wide, the only width `GetExternalPortraitAddress` takes being 32. `null` where
   * `ImportBitmap` returns false. Its size test is made without CSBWin's 32-bit wrap
   * (`size = (width+1)/2 * height`, a `ui32`, `doc/CSBwin-src/Bitmaps.cpp:356-372`), past
   * which it would read beyond the section (DEBT.md H).
   */
  importBitmap(index: number): IndexedBitmap | null {
    const raw = this.readSection(CSBGraphicType.Portrait, index, PORTRAIT_MIN_SIZE);
    if (!raw) return null;
    const fileSize = raw.length;
    const infoHeader = BITMAP_FILE_HEADER_SIZE;
    const colours = infoHeader + BITMAP_INFO_HEADER_SIZE;
    let numColor = 16;
    const biClrUsed = readU32LE(raw, infoHeader + 32) | 0;
    if (biClrUsed !== 0) numColor = biClrUsed;
    const pixels = colours + 4 * numColor;
    if (readU16LE(raw, 0) !== (('M'.charCodeAt(0) << 8) | 'B'.charCodeAt(0))) return null;
    if (readU16LE(raw, infoHeader + 14) !== 4) return null;
    const width = readU32LE(raw, infoHeader + 4);
    const height = readU32LE(raw, infoHeader + 8);
    const srcByteWidth = ((width + 1) >>> 0) >>> 1;
    const size = srcByteWidth * height;
    if (fileSize < PORTRAIT_MIN_SIZE + size) return null;
    const out = new Uint8Array(width * height);
    for (let i = 0; i < height && width > 0; i++) {
      const srcLine = pixels + srcByteWidth * (height - 1 - i);
      for (let srcX = 0; srcX < width; srcX++) {
        const byte = raw[srcLine + (srcX >> 1)] ?? 0;
        out[i * width + srcX] = (srcX & 1) === 0 ? (byte >> 4) & 15 : byte & 15;
      }
    }
    return { width, height, pixels: out };
  }

  /** `OpenCSBgraphicsFile`, through `opener`: whether the file is open. */
  private open(): boolean {
    if (this.opened) return true;
    if (!this.opener) return (this.opened = this.data !== null);
    try {
      this.opened = this.opener(this.data ? this.fileSignature : null);
    } catch (error) {
      this.data = null;
      this.sections = [];
      throw error;
    }
    return this.opened;
  }

  private parseSections(data: Uint8Array): SectionHeader[] {
    if (data.length < 12) throw new Error('CSBgraphics.dat too small');
    const s0 = String.fromCharCode(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0);
    if (s0 !== CSBGRAPHICS_SENTINEL) throw new Error('CSBgraphics.dat sentinel mismatch');
    const numSections = readU32LE(data, 8);
    const headerOffset = 12;
    const needed = headerOffset + numSections * SECTION_HEADER_SIZE;
    if (needed > data.length) throw new Error('CSBgraphics.dat truncated in section header');

    const sections: SectionHeader[] = [];
    for (let i = 0; i < numSections; i++) {
      const off = headerOffset + i * SECTION_HEADER_SIZE;
      sections.push({
        type: readU32LE(data, off + 0),
        id: readU32LE(data, off + 4),
        compressedSize: readU32LE(data, off + 8),
        uncompressedSize: readU32LE(data, off + 12),
        fileOffset: readU32LE(data, off + 16),
        name: readAsciiZ(data, off + 20, 16),
      });
    }
    return sections;
  }

  /**
   * `ReadCSBgraphic` (`doc/CSBwin-src/Graphics.cpp:3228`): section `type`/`id`, inflated,
   * or `null`. It opens the file first (`open`). The bytes are the caller's own, as
   * CSBWin's are a fresh allocation, to change as it reads them. A section missing that
   * `mustExist` asked for ends `firstTime`, CSBWin's "Missing section" message; one that
   * did not ask, as `BACKGROUND_LIB` sometimes does not (`src/data/BackgroundLib.ts`),
   * leaves it (`:3280-3289`). An `uncompressedSize` past `MAX_EXPANDED_SIZE` throws, where
   * CSBWin's allocation would fail.
   */
  readSection(type: number, id: number, minimumSize: number, mustExist = true): Uint8Array | null {
    if (!this.open() || !this.data) {
      if (this.firstTime) {
        this.cannotOpen?.();
        this.firstTime = false;
      }
      return null;
    }
    const header = this.sections.find((section) => section.type === type && section.id === id);
    if (!header) {
      if (!mustExist) return null;
      this.firstTime = false;
      return null;
    }
    if (header.uncompressedSize < minimumSize) return null;
    if (header.uncompressedSize > MAX_EXPANDED_SIZE) {
      throw new Error(`CSBgraphics.dat section ${type}/${id} expands to ${header.uncompressedSize} bytes, past ${MAX_EXPANDED_SIZE}`);
    }
    const start = header.fileOffset;
    const end = start + header.compressedSize;
    if (end > this.data.length) return null;

    const compressed = this.data.subarray(start, end);
    const view = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    let wordOffset = 0;
    const getCodeword = () => {
      const off = wordOffset * 4;
      wordOffset++;
      if (off + 4 > view.byteLength) return 0;
      return view.getUint32(off, true) >>> 0;
    };

    const decoder = new OvlDecode(getCodeword);
    const out = new Uint8Array(header.uncompressedSize);
    decoder.getBytes(out);
    return out;
  }
}
