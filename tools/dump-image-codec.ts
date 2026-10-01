/**
 * `ExpandGraphic`, the `graphics.dat` image codec — held up against CSBWin's own output.
 *
 * Every picture in the game goes through `decodeIMG` (`src/core/imageDecoder.ts`), so a
 * wrong opcode is the kind of bug that hides for years: it only shows on the handful of
 * images that use that opcode, and it looks like bad art rather than bad code. One did
 * hide. The decoder was written from the dmweb.free.fr format notes instead of from the
 * C++, and three of its opcodes disagreed:
 *
 * - `0xA` was "add (nib2+1) transparent pixels" and did not consume its count byte at all;
 *   CSBWin has a plain colour run with an 8-bit count (`CSBCode.cpp:10891`).
 * - `0xE` was a family of "extended transparent" sub-modes; CSBWin has the same colour run
 *   with a 16-bit count.
 * - `0xD` threw.
 *
 * Exactly one real image uses any of them — graphic 5, the credits scroll, which has four
 * `0xA` runs in CSBWin's `graphics.dat` — and the whole picture slid right from (78,55)
 * on, wrapping at the bottom. The Atari ST 1.2 disk's file, and so `dm-atari/`'s, has
 * `0xB` in those four bytes (`doc/PROVEN_FACTS.md` → "`dm-atari/graphics.dat` is
 * CSBWin's with three items from the 1.2 disk"), so the reference below is CSBWin's file. Items 558..562 use the others but they are the tables
 * `0x22e`..`0x232`, not images.
 *
 * So this tool checks three things:
 *
 * 1. **Against a real CSBWin screen.** `tools/reference/csbwin-credits.png` is graphic 5 of
 *    CSBWin's `graphics.dat` (`dm-windows/`) as CSBWin renders it. This is the only ground truth in the project that did not come out
 *    of our own code, which makes it the only check here that a symmetrical bug in both
 *    reader and writer could not satisfy.
 * 2. **Every opcode on its own**, on hand-built streams, so a regression names the opcode
 *    rather than an image.
 * 3. **Every image in each data set decodes to exactly its own size.** A stream that stops
 *    short or overruns means a count is wrong somewhere, and this catches it across 538
 *    images rather than the six the golden frames happen to show.
 *
 * Run: `npx tsx tools/dump-image-codec.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ImageFormat, decodeIMG } from '../src/core/imageDecoder';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { readPng } from './lib/png';
import { check, finish } from './lib/check';
import { graphicsTablesOf } from './lib/game';

/** CSBWin's own DM `graphics.dat` first: the reference screen is of it. */
const DATA_SETS = ['static/gamefiles/dm-windows', 'static/gamefiles/dm-atari', 'static/gamefiles/conflux-3.5-b8'];
const REFERENCE = 'tools/reference/csbwin-credits.png';
const CREDITS_GRAPHIC = 5;

/** `graphics.dat` items 0x22e..0x232 are tables; their "dimensions" are noise. */
const FIRST_TABLE_ITEM = 0x22e;
/** Items 533 and up are SND sounds, not images. */
const FIRST_SOUND_ITEM = 533;

function loadGraphics(dir: string): GraphicsLoader {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(dir, 'graphics.dat'))));
  return graphics;
}

/* ------------------------------------------- 1. against a real CSBWin screen ---- */

function checkAgainstReference(): void {
  console.log('=== graphic 5 vs tools/reference/csbwin-credits.png ===');
  const png = readPng(resolve(REFERENCE));
  const graphics = loadGraphics(DATA_SETS[0]);
  const image = graphics.getImage(CREDITS_GRAPHIC);
  const palette = graphicsTablesOf(graphics).ui.graphic232.palette328;

  check(png.width === image.width && png.height === image.height,
    `the reference is ${image.width}x${image.height} (got ${png.width}x${png.height})`);
  check(png.palette.length > 0, 'the reference is a paletted PNG, so its indices are comparable');

  // The capture was re-quantised to 0..255, so map its palette onto `palette328` by nearest
  // colour rather than trusting the ordering.
  const ours = palette.map((c) => [((c >> 8) & 7) * 36, ((c >> 4) & 7) * 36, (c & 7) * 36]);
  const toOurs = png.palette.map(([r, g, b]) => {
    let best = 0;
    let bestDistance = Infinity;
    ours.forEach(([r2, g2, b2], index) => {
      const d = (r - (r2 * 255) / 252) ** 2 + (g - (g2 * 255) / 252) ** 2 + (b - (b2 * 255) / 252) ** 2;
      if (d < bestDistance) { bestDistance = d; best = index; }
    });
    return best;
  });
  // `palette328` entries 5 and 13 are both 0x000, so the capture cannot tell them apart.
  const normalise = (index: number): number => (index === 13 ? 5 : index);

  let differing = 0;
  let first = -1;
  for (let i = 0; i < png.width * png.height; i++) {
    if (normalise(image.pixels[i]) !== normalise(toOurs[png.indices[i]])) {
      differing++;
      if (first < 0) first = i;
    }
  }
  const at = first < 0 ? 'none' : `(${first % png.width},${Math.floor(first / png.width)})`;
  console.log(`  differing pixels: ${differing}, first at ${at}`);

  // Graphic 5's stream is four pixels short of 320x200 and CSBWin, which runs until the
  // destination is full, shows four pixels of whatever followed the source buffer in the
  // heap. One of the four came out a colour our zero-fill cannot match. Nothing else may.
  check(differing <= 1, `at most the one heap-junk pixel differs (got ${differing})`);
  if (differing === 1) {
    check(first === 199 * png.width + 316,
      `and it is the bottom-right corner at (316,199), where the stream runs out (got ${at})`);
  }
}

/* ------------------------------------------------------ 2. opcode by opcode ---- */

/** A 4-byte header plus a literal opcode stream. */
function stream(width: number, height: number, ...bytes: number[]): Uint8Array {
  return Uint8Array.from([width >> 8, width & 0xff, height >> 8, height & 0xff, ...bytes]);
}

function pixelsOf(data: Uint8Array): number[] {
  return Array.from(decodeIMG(data).pixels);
}

function checkOpcodes(): void {
  console.log('\n=== the opcodes, one at a time ===');

  // 0x00..0x7F — `(b >> 4) + 1` pixels of the low nibble. A high nibble of 0 is one pixel.
  check(pixelsOf(stream(16, 1, 0x03, 0x71, 0x62, 0x60, 0x00)).join('') === '3111111112222222',
    '0x0X places one pixel; 0x1X..0x7X place (high nibble + 1)');

  // 0x8X / 0xAX — a colour run with an 8-bit count. 0xA is 0x8 with the unconsulted 0x20
  // bit set (`doc/CSBwin-src/CSBCode.cpp:10891-10894`), and this is the opcode that was
  // wrong: it used to mean "transparent" and did not even read its count byte.
  check(pixelsOf(stream(16, 1, 0x85, 0x0f)).join('') === '5555555555555555',
    '0x8X runs (byte + 1) pixels of colour X');
  check(pixelsOf(stream(16, 1, 0xa5, 0x0f)).join('') === '5555555555555555',
    '0xAX is the same run as 0x8X, not transparency');
  check(pixelsOf(stream(16, 1, 0xa5, 0x03)).length === 16 && pixelsOf(stream(16, 1, 0xa5, 0x03))[4] === 0,
    'and 0xAX really does consume its count byte (a run of 4, then background)');

  // 0xCX / 0xEX — the same, with a 16-bit count.
  check(pixelsOf(stream(16, 2, 0xc7, 0x00, 0x1f)).join('') === '7'.repeat(32),
    '0xCX runs (word + 1) pixels of colour X');
  check(pixelsOf(stream(16, 2, 0xe7, 0x00, 0x1f)).join('') === '7'.repeat(32),
    '0xEX is the same run as 0xCX');

  // 0x9X / 0xDX — literal nibbles, high then low. An odd count opens with one pixel of the
  // opcode's own colour so the rest pairs up (`tag021558`).
  check(pixelsOf(stream(16, 1, 0x92, 0x03, 0xab, 0xcd, 0x80, 0x0b)).slice(0, 4).join('') === 'abcd'
      .split('').map((c) => parseInt(c, 16)).join(''),
    '0x9X with an even count is (byte + 1) literal nibbles');
  const odd = pixelsOf(stream(16, 1, 0x92, 0x04, 0xab, 0xcd, 0x80, 0x0a));
  check(odd[0] === 2 && odd[1] === 0xa && odd[2] === 0xb && odd[3] === 0xc && odd[4] === 0xd,
    'an odd count opens with one pixel of the opcode\'s own colour, then the nibbles');
  check(pixelsOf(stream(16, 1, 0xd2, 0x00, 0x03, 0xab, 0xcd, 0x80, 0x0b)).slice(0, 4).join('')
      === [0xa, 0xb, 0xc, 0xd].join(''),
    '0xDX is the same literal stream with a 16-bit count — and no longer throws');

  // 0xBX / 0xFX — copy from the line above, then **one** pixel of colour X. That trailing
  // pixel is a fall-through from the copy loop into `tag0214f2`, not a separate opcode.
  const copied = pixelsOf(stream(16, 2, 0x71, 0x72, 0xb3, 0x0e, 0x80, 0x00));
  check(copied.slice(0, 16).join('') === '1111111122222222', 'the source line');
  check(copied.slice(16, 31).join('') === '111111112222222',
    '0xBX copies (byte + 1) pixels from the line directly above');
  check(copied[31] === 3, 'and then places one pixel of its own colour — the fall-through');
  const copiedWide = pixelsOf(stream(16, 2, 0x71, 0x72, 0xf3, 0x00, 0x0e, 0x80, 0x00));
  check(copiedWide.slice(16, 32).join('') === copied.slice(16, 32).join(''),
    '0xFX is the same copy with a 16-bit count');

  // The first line has nothing above it; CSBWin would read before its buffer.
  check(pixelsOf(stream(16, 1, 0xb0, 0x0e))[0] === 0,
    'a copy on the first line reads background rather than off the front of the buffer');
}

/* --------------------------------------------- 3. every image, every data set ---- */

function checkEveryImage(): void {
  console.log('\n=== every image in both data sets ===');
  for (const dir of DATA_SETS) {
    const graphics = loadGraphics(dir);
    const count = graphics.getItemCount();
    let images = 0;
    let short = 0;
    const shortfalls: string[] = [];

    for (let i = 0; i < Math.min(count, FIRST_SOUND_ITEM); i++) {
      const raw = graphics.getRawGraphic(i);
      if (raw.length < 6) continue;
      images++;
      const decoded = decodeIMG(raw, ImageFormat.IMG1);
      check(decoded.pixels.length === decoded.width * decoded.height,
        `item ${i} decodes to exactly ${decoded.width}x${decoded.height}`);

      // How far the stream itself reached, independently of the decoder's clamping.
      const produced = streamLength(raw);
      const wanted = paddedStride(decoded.width) * decoded.height;
      if (produced < wanted) { short++; shortfalls.push(`${i} (${wanted - produced} px)`); }
    }

    console.log(`  ${dir}: ${images} images, ${short} with a stream that stops short — ${shortfalls.join(', ') || 'none'}`);
    // Graphic 5 is the only one, and it is four pixels in a corner. Anything else means a
    // count is being mis-read.
    check(short <= 1 && (short === 0 || shortfalls[0].startsWith(`${CREDITS_GRAPHIC} `)),
      `only graphic ${CREDITS_GRAPHIC} stops short, and only just (got ${shortfalls.join(', ') || 'none'})`);

    // Items 0x22e..0x232 are tables. Decoding one as an image should not be attempted, but
    // it must not crash either — `extractUITables` and `getImage` share `getRawGraphic`.
    for (let i = FIRST_TABLE_ITEM; i < count; i++) {
      const raw = graphics.getRawGraphic(i);
      check(raw.length > 0, `table item 0x${i.toString(16)} still decompresses`);
    }
  }
}

/** The 16-pixel-group line pitch: `D7W = ((width+15)>>1) & 0x7ff8` bytes, two pixels each. */
function paddedStride(width: number): number {
  return (((width + 15) >> 1) & 0x7ff8) * 2;
}

/** Walk the opcode stream and report how many pixels it asks for. */
function streamLength(raw: Uint8Array): number {
  const width = (raw[0] << 8) | raw[1];
  const height = (raw[2] << 8) | raw[3];
  const total = paddedStride(width) * height;
  let off = 4;
  let produced = 0;
  while (off < raw.length && produced < total) {
    const op = raw[off++];
    if (op < 0x80) { produced += (op >> 4) + 1; continue; }
    let count = raw[off++];
    if (op & 0x40) count = ((count << 8) | raw[off++]) & 0xffff;
    count += 1;
    switch (op & 0x30) {
      case 0x10: off += count >> 1; produced += count; break;
      case 0x30: produced += count + 1; break;
      default: produced += count;
    }
  }
  return produced;
}

function main(): void {
  checkAgainstReference();
  checkOpcodes();
  checkEveryImage();
  finish();
}

main();
