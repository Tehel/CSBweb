/**
 * CSBgraphics.dat loader (CSBWin overlay graphics).
 *
 * Implements ReadCSBgraphic + OVLDECODE from CSBWin Graphics.cpp.
 * Used for extended wall/floor decorations (ReadWallDecoration/ReadFloorDecoration).
 */

import type { ui32 } from '../core/types';
import { readU16LE, readU32LE } from '../core/bytes';

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

export interface ExtendedWallDecoration {
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

const CSBGRAPHICS_SENTINEL = 'CSBg';
const SECTION_HEADER_SIZE = 36; // 5 * u32 + 16-byte name
const WALL_DEC_MIN_SIZE = 92;
const FLOOR_DEC_MIN_SIZE = 92;

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

function decodePacked4bpp(data: Uint8Array, widthBytes: number, height: number): Uint8Array {
  const widthPixels = widthBytes * 2;
  const out = new Uint8Array(widthPixels * height);
  let src = 0;
  let dst = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < widthBytes; x++) {
      const b = data[src++] ?? 0;
      out[dst++] = (b >> 4) & 0x0f;
      out[dst++] = b & 0x0f;
    }
  }
  return out;
}

class OvlDecode {
  private codes: Uint32Array;
  private chars: Uint8Array;
  private codeSize = 9;
  private bitsRemaining = 0;
  private codeword = 0;
  private tableLen = 255;
  private maxTableLen = 512;
  private stack: Uint8Array;
  private stackLen = 0;
  private a = 0;
  private b = 0;
  private c = 0;
  private ch = 0;

  constructor(private getCodeword: () => number) {
    this.codes = new Uint32Array(512);
    this.chars = new Uint8Array(512);
    this.stack = new Uint8Array(1024);
  }

  private enlargeTable(): void {
    this.maxTableLen *= 2;
    const nextCodes = new Uint32Array(this.maxTableLen);
    nextCodes.set(this.codes);
    this.codes = nextCodes;
    const nextChars = new Uint8Array(this.maxTableLen);
    nextChars.set(this.chars);
    this.chars = nextChars;
    this.codeSize++;
  }

  private ensureStack(extra: number): void {
    if (this.stackLen + extra < this.stack.length) return;
    const next = new Uint8Array(this.stack.length * 2);
    next.set(this.stack);
    this.stack = next;
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
        this.ensureStack(1);
        this.stack[this.stackLen++] = this.c & 0xff;
        for (this.ch = this.a; this.ch > 255; this.ch = this.codes[this.ch] ?? 0) {
          this.ensureStack(1);
          this.stack[this.stackLen++] = this.chars[this.ch] ?? 0;
        }
        this.ensureStack(1);
        this.stack[this.stackLen++] = this.ch & 0xff;
      } else {
        for (this.ch = this.b; this.ch > 255; this.ch = this.codes[this.ch] ?? 0) {
          this.ensureStack(1);
          this.stack[this.stackLen++] = this.chars[this.ch] ?? 0;
        }
        this.ensureStack(1);
        this.stack[this.stackLen++] = this.ch & 0xff;
      }

      this.c = this.ch;
      this.codes[this.tableLen] = this.a >>> 0;
      this.chars[this.tableLen] = this.c & 0xff;
      this.tableLen++;
      this.a = this.b >>> 0;
    }
  }
}

export class CSBGraphicsLoader {
  private data: Uint8Array | null = null;
  private sections: SectionHeader[] = [];
  private wallCache = new Map<number, ExtendedWallDecoration>();
  private floorCache = new Map<number, ExtendedFloorDecoration>();

  async load(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
    }
    const buf = new Uint8Array(await response.arrayBuffer());
    this.loadFromArray(buf);
  }

  async tryLoad(url: string): Promise<boolean> {
    try {
      await this.load(url);
      return true;
    } catch {
      return false;
    }
  }

  loadFromArray(data: Uint8Array): void {
    this.data = data;
    this.sections = this.parseSections(data);
  }

  isLoaded(): boolean {
    return this.data !== null && this.sections.length > 0;
  }

  getWallDecoration(id: number): ExtendedWallDecoration | null {
    if (!this.isLoaded()) return null;
    const cached = this.wallCache.get(id);
    if (cached) return cached;

    const raw = this.readSection(CSBGraphicType.WallDecoration, id, WALL_DEC_MIN_SIZE);
    if (!raw) return null;

    const descCount = 13;
    const desc: DecorationDesc[] = new Array(descCount);
    for (let i = 0; i < descCount; i++) {
      desc[i] = readDecorationDesc(raw, i * 6);
    }

    const bitmapOffset = descCount * 6 + 2; // +2 alignment padding (CSBCode.cpp:3161)
    const sideDesc = desc[11];
    const frontDesc = desc[12];
    const sideSize = sideDesc.widthBytes * sideDesc.height;
    const frontSize = frontDesc.widthBytes * frontDesc.height;
    if (bitmapOffset + sideSize + frontSize > raw.length) return null;

    const sideRaw = raw.subarray(bitmapOffset, bitmapOffset + sideSize);
    const frontRaw = raw.subarray(bitmapOffset + sideSize, bitmapOffset + sideSize + frontSize);

    const sidePixels = decodePacked4bpp(sideRaw, sideDesc.widthBytes, sideDesc.height);
    const frontPixels = decodePacked4bpp(frontRaw, frontDesc.widthBytes, frontDesc.height);

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
    if (!this.isLoaded()) return null;
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
    const pixels = decodePacked4bpp(bitmapRaw, baseDesc.widthBytes, baseDesc.height);
    const bitmap: IndexedBitmap = {
      width: baseDesc.widthBytes * 2,
      height: baseDesc.height,
      pixels,
    };

    const out: ExtendedFloorDecoration = { id, desc, mirrorFlags, bitmap };
    this.floorCache.set(id, out);
    return out;
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

  private readSection(type: number, id: number, minimumSize: number): Uint8Array | null {
    if (!this.data) return null;
    const header = this.sections.find((section) => section.type === type && section.id === id);
    if (!header) return null;
    if (header.uncompressedSize < minimumSize) return null;
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
