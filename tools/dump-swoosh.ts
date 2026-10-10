/**
 * The FTL logo before the title (`SWOOSH.IMG`): what its picture decodes to and
 * what its palette script does, both read from the file.
 *
 * Nothing on screen says whether a decoder that produces *a* logo is the disk's. What
 * could be wrong while still looking plausible:
 *
 * 1. **The offsets.** The patterns, the picture and the script sit at offsets taken from
 *    the file's own `lea`s. The patterns are a canary: entry c must be plane p `$ffff`
 *    exactly where bit p of c is set.
 * 2. **The decoder.** It must stop on the last of the 64000 pixels having read exactly
 *    2306 bytes, `$0258`-`$0b59`. The codes are walked here a second time, without
 *    drawing, for what `doc/ATARI_ST_DISK_REFERENCE.md` states of them: 1089 short runs,
 *    495 long ones (53 with a two-byte count), 87 copies, the first on row 53.
 * 3. **The picture.** `tools/fixtures/swoosh-index.png` is the picture from a
 *    decoder that is not this one, in false colours: the two must agree pixel for pixel,
 *    one colour an index.
 * 4. **The script.** `showSwoosh` on a headless host that counts VBLs: each colour at the
 *    VBL the reference gives, the sound started before the first, then the hold, the fade
 *    and a black, cleared screen for the title.
 *
 * Run: `npx tsx tools/dump-swoosh.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

import { readU16BE, readU32BE } from '../src/core/bytes';
import { loadSwoosh, SWOOSH_HEIGHT, SWOOSH_WIDTH, type Swoosh } from '../src/data/SwooshLoader';
import { createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import { showSwoosh, SWOOSH_HOLD_VBLS } from '../src/renderer/intro/Swoosh';
import { check, finish } from './lib/check';

const DIR = 'static/gamefiles/swoosh';
const FIXTURES = 'tools/fixtures';
const PATTERNS_OFFSET = 0x01d8;
const PICTURE_OFFSET = 0x0258;
const PICTURE_END = 0x0b5a;

function hex(value: number, digits = 3): string {
  return value.toString(16).padStart(digits, '0');
}

/* ------------------------------------------------------------ 1. the offsets ---- */

function checkPatterns(file: Uint8Array): void {
  console.log('=== swoosh.img ===');
  console.log(`  ${file.length} bytes, first word $${hex(readU16BE(file, 0), 4)}`);
  check(file.length === 3016, 'the file is the disk\'s 3016 bytes');
  let solid = true;
  for (let c = 0; c < 16; c++) {
    for (let plane = 0; plane < 4; plane++) {
      const want = c & (1 << plane) ? 0xffff : 0;
      if (readU16BE(file, PATTERNS_OFFSET + c * 8 + plane * 2) !== want) solid = false;
    }
  }
  check(solid, 'the sixteen patterns at $01d8 are solid colours, plane p set where bit p of the colour is');
}

/* ------------------------------------------------------------ 2. the decoder ---- */

function checkCodes(file: Uint8Array, swoosh: Swoosh): void {
  console.log('=== the picture ===');
  console.log(`  codes $${hex(PICTURE_OFFSET, 4)}-$${hex(swoosh.pictureEnd - 1, 4)}, ${swoosh.pictureEnd - PICTURE_OFFSET} bytes`);
  check(swoosh.pictureEnd === PICTURE_END, `the decoder reads exactly 2306 bytes (got ${swoosh.pictureEnd - PICTURE_OFFSET})`);
  check(swoosh.pixels.length === SWOOSH_WIDTH * SWOOSH_HEIGHT, 'and gives 320x200 pixels');

  // The same stream, without drawing: a code's length and how many pixels it stands for.
  let short = 0, long = 0, twoByte = 0, copies = 0, pixels = 0, firstCopyRow = -1, largest = 0;
  for (let at = PICTURE_OFFSET; at < swoosh.pictureEnd;) {
    const b = file[at++];
    if ((b & 0x80) === 0) {
      short++;
      pixels += (b >> 4) + 1;
      continue;
    }
    let count = file[at++];
    if (b & 0x40) {
      count = (count << 8) | file[at++];
      twoByte++;
    }
    count += 1;
    largest = Math.max(largest, count);
    if (b & 0x10) {
      if (firstCopyRow < 0) firstCopyRow = Math.floor(pixels / SWOOSH_WIDTH);
      copies++;
      pixels += count + 1;
    } else {
      long++;
      pixels += count;
    }
  }
  console.log(`  ${short} short runs, ${long} long runs, ${copies} copies, ${twoByte} two-byte counts; largest count ${largest}`);
  check(pixels === SWOOSH_WIDTH * SWOOSH_HEIGHT, `the codes stand for 64000 pixels, the last one the screen's last (got ${pixels})`);
  check(short === 1089 && long === 495 && copies === 87, '1089 short runs, 495 long runs and 87 copies');
  check(twoByte === 53, '53 codes carry a two-byte count');
  check(firstCopyRow === 53, `the first copy is on row 53, so the line above is on screen (got ${firstCopyRow})`);
  check(largest < 0x8000, 'no count is one the decoder\'s signed word compare would take as negative');

  const used = new Set(swoosh.pixels);
  check(used.size === 16, `the picture uses all sixteen colours (got ${used.size})`);
  const rows = (index: number): string => {
    let first = -1, last = -1, count = 0;
    swoosh.pixels.forEach((value, i) => {
      if (value !== index) return;
      if (first < 0) first = Math.floor(i / SWOOSH_WIDTH);
      last = Math.floor(i / SWOOSH_WIDTH);
      count++;
    });
    return `${String(count).padStart(5)} pixels, rows ${first}-${last}`;
  };
  for (let index = 0; index < 16; index++) console.log(`  colour ${String(index).padStart(2)}: ${rows(index)}`);
}

/* ------------------------------------------------------------ 3. the picture ---- */

/** An 8-bit RGB, non-interlaced PNG as one 24-bit colour a pixel. */
function readPng(path: string): { width: number; height: number; colours: Uint32Array } {
  const png = new Uint8Array(readFileSync(resolve(path)));
  let width = 0, height = 0;
  const data: Uint8Array[] = [];
  for (let at = 8; at < png.length;) {
    const length = readU32BE(png, at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = readU32BE(body, 0);
      height = readU32BE(body, 4);
      if (body[8] !== 8 || body[9] !== 2 || body[12] !== 0) throw new Error(`${path}: not 8-bit RGB, non-interlaced`);
    } else if (type === 'IDAT') {
      data.push(body);
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 3;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const a = x >= 3 ? out[y * stride + x - 3] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 3 && y > 0 ? out[(y - 1) * stride + x - 3] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  const colours = new Uint32Array(width * height);
  for (let i = 0; i < colours.length; i++) colours[i] = (out[i * 3] << 16) | (out[i * 3 + 1] << 8) | out[i * 3 + 2];
  return { width, height, colours };
}

function checkAgainstReference(swoosh: Swoosh): void {
  console.log('=== against swoosh-index.png ===');
  const png = readPng(`${FIXTURES}/swoosh-index.png`);
  check(png.width === SWOOSH_WIDTH && png.height === SWOOSH_HEIGHT, 'the reference picture is 320x200');
  const colourOf = new Map<number, number>();
  const indexOf = new Map<number, number>();
  let differing = 0;
  for (let i = 0; i < swoosh.pixels.length; i++) {
    const index = swoosh.pixels[i];
    const colour = png.colours[i];
    if (!colourOf.has(index) && !indexOf.has(colour)) {
      colourOf.set(index, colour);
      indexOf.set(colour, index);
    }
    if (colourOf.get(index) !== colour || indexOf.get(colour) !== index) differing++;
  }
  console.log(`  ${colourOf.size} indices over ${indexOf.size} colours, ${differing} pixels differing`);
  check(differing === 0 && colourOf.size === 16, 'the decoded picture is the reference\'s, one colour an index');
}

/* ------------------------------------------------------------- 4. the script ---- */

/** `doc/ATARI_ST_DISK_REFERENCE.md` → "The palette script": the colours set at each VBL. */
const SCRIPT_BY_VBL: readonly (readonly [number, readonly (readonly [number, number])[]])[] = [
  [0, [[1, 0x777]]],
  [2, [[2, 0x777]]],
  [4, [[3, 0x777]]],
  [7, [[4, 0x777]]],
  [10, [[5, 0x777]]],
  [14, [[6, 0x777]]],
  [18, [[7, 0x777]]],
  [22, [[8, 0x777], [9, 0x777], [10, 0x555], [15, 0x777]]],
  [26, [[8, 0x000], [11, 0x777], [12, 0x555], [13, 0x222]]],
  [30, [[15, 0x770], [14, 0x770]]],
];
const FINAL_PALETTE = [0x000, 0x777, 0x777, 0x777, 0x777, 0x777, 0x777, 0x777, 0x000, 0x777, 0x555, 0x777, 0x555, 0x222, 0x770, 0x770];
/** `_FadeToPalette`'s eight VBLs (`doc/CSBwin-src/Graphics.cpp:1625`). */
const FADE_VBLS = 8;

async function checkScript(swoosh: Swoosh): Promise<void> {
  console.log('=== the palette script ===');
  console.log(`  ${swoosh.script.map((word) => hex(word, 4)).join(' ')}`);

  const screen = createPaletteIndexViewportBuffer(SWOOSH_WIDTH, SWOOSH_HEIGHT, 5);
  const globalPalette = new Array<number>(16).fill(0x777);
  let vbl = 0;
  let soundAt = -1;
  let soundPalette: number[] = [];
  // What the display showed at each VBL: the last frame presented before it passed.
  const shown = new Map<number, { palette: number[]; picture: boolean }>();
  const host = {
    screen,
    globalPalette,
    present: (): void => {
      shown.set(vbl, { palette: [...globalPalette], picture: screen.pixels.every((v, i) => v === swoosh.pixels[i]) });
    },
    vbl: (count: number): Promise<void> => {
      vbl += count;
      return Promise.resolve();
    },
  };
  await showSwoosh(host, swoosh, () => {
    soundAt = vbl;
    soundPalette = [...globalPalette];
  });

  check(soundAt === 0 && soundPalette.every((c) => c === 0), 'the sound starts at VBL 0, on a black screen');

  const palette = new Array<number>(16).fill(0);
  for (const [at, colours] of SCRIPT_BY_VBL) {
    for (const [register, value] of colours) palette[register] = value;
    const frame = shown.get(at);
    console.log(`  VBL ${String(at).padStart(2)}: ${colours.map(([r, v]) => `${r} = ${hex(v)}`).join(', ')}`);
    check(!!frame && frame.picture && frame.palette.every((c, i) => c === palette[i]),
      `at VBL ${at} the screen is the picture through ${palette.map((c) => hex(c)).join(' ')}`);
  }
  check(palette.every((c, i) => c === FINAL_PALETTE[i]), 'which ends on the reference\'s final palette');
  const presentsInScript = [...shown.keys()].filter((at) => at <= 30);
  check(presentsInScript.length === SCRIPT_BY_VBL.length, `the script changes the screen at those ten VBLs only (got ${presentsInScript.join(', ')})`);

  const end = 30 + SWOOSH_HOLD_VBLS + FADE_VBLS;
  console.log(`  hold ${SWOOSH_HOLD_VBLS} VBLs, fade ${FADE_VBLS}: over at VBL ${vbl}`);
  const afterHold = [...shown.keys()].filter((at) => at > 30);
  check(afterHold.length > 0 && Math.min(...afterHold) === 30 + SWOOSH_HOLD_VBLS + 1,
    `the logo is held ${SWOOSH_HOLD_VBLS} VBLs, untouched, before the fade's first step`);
  check(vbl === end, `the whole of it takes ${end} VBLs (got ${vbl})`);
  check(globalPalette.every((c) => c === 0), 'it leaves the sixteen registers black');
  check(screen.pixels.every((v) => v === 0), 'and the screen cleared');
}

async function main(): Promise<void> {
  const file = new Uint8Array(readFileSync(resolve(`${DIR}/swoosh.img`)));
  checkPatterns(file);
  const swoosh = loadSwoosh(file);
  checkCodes(file, swoosh);
  checkAgainstReference(swoosh);
  await checkScript(swoosh);

  let refused = false;
  try {
    loadSwoosh(new TextEncoder().encode('<!doctype html><html></html>'.padEnd(4096, ' ')));
  } catch {
    refused = true;
  }
  check(refused, 'a file that is not SWOOSH.IMG is refused');

  finish();
}

void main();
