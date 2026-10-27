/**
 * A minimal PNG reader, and `src/core/png.ts`'s paletted writer to a file, for tools that
 * hold a rendering up against a captured reference or dump one to look at, and for the
 * golden frames (`lib/frames.ts`), which a PNG's `tEXt` chunk describes.
 *
 * Enough of the format to read what a screenshot tool writes: any bit depth for a paletted
 * image, 8 bits per channel otherwise, and all five row filters. No interlace, no 16-bit
 * samples, no colour management — a file it cannot read throws rather than guesses.
 *
 * Its imports name their `.ts`: Node runs the frame probe that imports it, with no bundler.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

import { indexedPng, indexedPngRows } from '../../src/core/png.ts';

export interface PngImage {
  width: number;
  height: number;
  depth: number;
  /** PNG colour type: 0 grey, 2 RGB, 3 paletted, 4 grey+alpha, 6 RGBA. */
  ctype: number;
  /** For a paletted image these are palette indices; otherwise the first channel. */
  indices: Uint8Array;
  /** The PLTE entries as `[r, g, b]`, empty when the image is not paletted. */
  palette: number[][];
  /** Every pixel as four bytes, red, green, blue and alpha; a paletted pixel opaque. Not for grey under 8 bits. */
  rgba: Uint8Array;
  /** The `tEXt` chunks, each value by its keyword. */
  text: Record<string, string>;
}

/** Read a PNG. Paletted images come back as indices into `palette`. */
export function readPng(path: string): PngImage {
  return decodePng(readFileSync(path));
}

/** `readPng` of a file's bytes. */
export function decodePng(bytes: Uint8Array): PngImage {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8, width = 0, height = 0, depth = 0, ctype = 0;
  const idat: Buffer[] = [];
  const text: Record<string, string> = {};
  let plte: Buffer | null = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; }
    else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'tEXt') { const nul = data.indexOf(0); text[data.toString('latin1', 0, nul)] = data.toString('latin1', nul + 1); }
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = ctype === 2 ? 3 : ctype === 6 ? 4 : ctype === 4 ? 2 : 1;
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
                  v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error(`filter ${filter}`);
      }
      row[i] = v & 0xff;
    }
  }
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v: number;
      if (depth === 8) v = out[y * stride + x * channels];
      else { const per = 8 / depth, byte = out[y * stride + ((x / per) | 0)];
             const shift = 8 - depth * ((x % per) + 1); v = (byte >> shift) & ((1 << depth) - 1); }
      indices[y * width + x] = v;
    }
  }
  const palette: number[][] = [];
  if (plte) for (let i = 0; i < plte.length; i += 3) palette.push([plte[i], plte[i + 1], plte[i + 2]]);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x, at = y * stride + x * channels;
      const [r, g, b, a] = ctype === 3 ? [...(palette[indices[p]] ?? [0, 0, 0]), 255]
        : ctype === 2 ? [out[at], out[at + 1], out[at + 2], 255]
        : ctype === 6 ? [out[at], out[at + 1], out[at + 2], out[at + 3]]
        : ctype === 4 ? [out[at], out[at], out[at], out[at + 1]]
        : [indices[p], indices[p], indices[p], 255];
      rgba.set([r, g, b, a], p * 4);
    }
  }
  return { width, height, depth, ctype, indices, palette, rgba, text };
}

/**
 * `indices` (one byte a pixel) as an 8-bit paletted PNG over `palette`'s `[r, g, b]`, each
 * of `text`'s entries a `tEXt` chunk (`src/core/png.ts`), deflated at zlib's `level`.
 */
export function encodeIndexedPng(width: number, height: number, indices: Uint8Array, palette: number[][],
  text: Record<string, string> = {}, level = zlib.constants.Z_DEFAULT_COMPRESSION): Uint8Array {
  return indexedPng(width, height, palette, zlib.deflateSync(indexedPngRows(width, height, indices), { level }), text);
}

/** `encodeIndexedPng`, without text, written to `path`. */
export function writeIndexedPng(path: string, width: number, height: number, indices: Uint8Array, palette: number[][]): void {
  writeFileSync(path, encodeIndexedPng(width, height, indices, palette));
}
