/**
 * A minimal PNG reader and paletted writer, for tools that hold a rendering up against a
 * captured reference or dump one to look at.
 *
 * Enough of the format to read what a screenshot tool writes: any bit depth for a paletted
 * image, 8 bits per channel otherwise, and all five row filters. No interlace, no 16-bit
 * samples, no colour management — a file it cannot read throws rather than guesses.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

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
}

/** Read a PNG. Paletted images come back as indices into `palette`. */
export function readPng(path: string): PngImage {
  const buf = readFileSync(path);
  let off = 8, width = 0, height = 0, depth = 0, ctype = 0;
  const idat: Buffer[] = [];
  let plte: Buffer | null = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; }
    else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
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
  return { width, height, depth, ctype, indices, palette };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([head.subarray(4), data])) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}

/** Write `indices` (one byte a pixel) as an 8-bit paletted PNG over `palette`'s `[r, g, b]`. */
export function writeIndexedPng(path: string, width: number, height: number, indices: Uint8Array, palette: number[][]): void {
  if (indices.length !== width * height) throw new Error(`${indices.length} indices for ${width}x${height}`);
  if (palette.length === 0 || palette.length > 256) throw new Error(`a palette of ${palette.length} colours`);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(palette.flat())),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}
