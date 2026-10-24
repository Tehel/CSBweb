/**
 * PNG read and write, for the golden frames.
 *
 * The golden frames used to be whatever PNG `Page.captureScreenshot` handed back, compared
 * with `cmp`. That made the check a test of the *browser*: a full-page shot carries the DOM
 * debug chrome, so it depends on the machine's fonts, its widget theme and the window
 * metrics, and a byte compare depends on the Chrome build's PNG encoder — identical pixels
 * from a different Chrome still differ from byte 25 on, because the encoder picks different
 * row filters and IDAT chunking. Frames captured on one machine could not be checked on
 * another.
 *
 * So the project owns both ends: `probe-frames.mjs` encodes the frames here and
 * `compare-frames.mjs` decodes them and compares what they hold, never their bytes. A frame
 * is a paletted PNG whose pixels are the screen's palette slots and whose `tEXt` chunk
 * says what the slots stood for (`probe-frames.mjs`); its `PLTE` is only there to view it.
 *
 * This is deliberately separate from `lib/png.ts`, which reads *paletted* PNGs for
 * `checks/image-codec.ts`. This one is plain ESM because the CDP drivers are plain node
 * scripts.
 *
 * Deliberately minimal: 8-bit RGB, RGBA and paletted, no interlace. Anything else throws
 * rather than guessing.
 */
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encode `indices` (width*height bytes) as an 8-bit paletted PNG, `plte` its colours as
 * `[r, g, b]`, and each of `text`'s entries a `tEXt` chunk.
 */
export function encodeIndexedPng(width, height, indices, plte, text = {}) {
  if (indices.length !== width * height)
    throw new Error(`expected ${width * height} indices, got ${indices.length}`);
  if (plte.length === 0 || plte.length > 256) throw new Error(`a palette of ${plte.length} colours`);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 3;   // colour type: paletted
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;   // filter 0
    for (let x = 0; x < width; x++) {
      const v = indices[y * width + x];
      if (v >= plte.length) throw new Error(`index ${v} past a palette of ${plte.length}`);
      raw[y * (width + 1) + 1 + x] = v;
    }
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(plte.flat())),
    ...Object.entries(text).map(([k, v]) => chunk('tEXt', Buffer.from(`${k}\0${v}`, 'latin1'))),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Read an 8-bit RGB, RGBA or paletted PNG, returning `{ width, height, rgba, indices,
 * text }`: `indices` the paletted one's pixels (`null` for the others), and `text` its
 * `tEXt` chunks by keyword.
 */
export function decodePng(path) {
  const buf = readFileSync(path);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${path}: not a PNG`);
  let off = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  const text = {};
  let plte = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tEXt') {
      const nul = data.indexOf(0);
      text[data.toString('latin1', 0, nul)] = data.toString('latin1', nul + 1);
    }
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8) throw new Error(`${path}: bit depth ${depth}, only 8 is supported`);
  if (ctype !== 2 && ctype !== 3 && ctype !== 6)
    throw new Error(`${path}: colour type ${ctype}, only 2 (RGB), 3 (paletted) and 6 (RGBA) are supported`);
  if (ctype === 3 && !plte) throw new Error(`${path}: paletted, with no PLTE`);
  if (interlace !== 0) throw new Error(`${path}: interlaced`);

  const channels = ctype === 6 ? 4 : ctype === 3 ? 1 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const flat = new Uint8Array(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = flat.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? flat.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`${path}: row filter ${filter}`);
      }
      row[i] = v & 0xff;
    }
  }
  // Normalise to RGBA so callers never have to branch on the colour type.
  const rgba = new Uint8Array(width * height * 4);
  for (let n = 0; n < width * height; n++) {
    if (ctype === 3) {
      const v = flat[n];
      if (v * 3 >= plte.length) throw new Error(`${path}: index ${v} past its PLTE`);
      rgba.set(plte.subarray(v * 3, v * 3 + 3), n * 4);
      rgba[n * 4 + 3] = 0xff;
      continue;
    }
    rgba[n * 4] = flat[n * channels];
    rgba[n * 4 + 1] = flat[n * channels + 1];
    rgba[n * 4 + 2] = flat[n * channels + 2];
    rgba[n * 4 + 3] = channels === 4 ? flat[n * channels + 3] : 0xff;
  }
  return { width, height, rgba, indices: ctype === 3 ? flat : null, text };
}
