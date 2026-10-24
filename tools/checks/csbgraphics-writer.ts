/**
 * `CSBgraphics.dat` written (`src/data/CSBGraphicsWriter.ts`), read back by
 * `CSBGraphicsLoader`, CSBWin's `ReadCSBgraphic` (`doc/CSBwin-src/Graphics.cpp:3228-3306`).
 *
 * 1. **`encodeOvl`**: every section of Conflux 3.5's and Towers of Chaos 3.3's files,
 *    written again in their order under their names, reads back as it was, and comes
 *    out as shipped, code word for code word: the encoder writes what the tool that made
 *    them wrote, its widenings at the same codes and a word of nothing after a last full
 *    one. All but Conflux's sound 365, where from code 14,334 that tool's codes leave the
 *    table the decoder keeps: literals for strings it holds since entry 2134, then codes
 *    past its end (15360 at entry 14587), which `OVLDECODE` reads as the code one past
 *    it. The bytes CSBWin reads from them are written back, in other codes.
 * 2. Bytes no shipped section has: none, one, a run of a million equal bytes (whose
 *    strings, which would reach 1,413 bytes, stop at 1,000, under
 *    `OVLDECODE`'s 1,024-byte stack it cannot enlarge) and
 *    300,000 random ones (codes widened to 17 bits).
 * 3. **`overlaySection`**: Conflux's overlay 1, its pixels turned top line first, comes out
 *    as shipped; an overlay of 37 colours reads through `ReadOverlay`
 *    (`Bitmaps.cpp:572-630`) bottom line first, its colours as given.
 * 4. **`overlayPaletteSection`**: Conflux's palette 1 comes out as shipped, and
 *    `SetOverlayPalette` (`Bitmaps.cpp:651-685`) reads it as it reads Conflux's.
 * 5. **`wallDecorationSection`**: each of Conflux's 36 wall decorations, from what
 *    `getWallDecoration` reads of it, comes out as shipped (five carry 16 bytes more,
 *    which nothing reads) and reads back the same.
 * 6. What CSBWin would misread is refused: two sections of one type and id, an overlay
 *    not 224x136, a bitplane width not a multiple of 16, a wall decoration under 92 bytes.
 *
 * Run: `npm test -- --only=csbgraphics-writer.ts`
 */
import { readFileSync } from 'node:fs';

import { CSBGraphicsLoader, CSBGraphicType, type DecorationDesc } from '../../src/data/CSBGraphicsLoader';
import {
  buildCSBGraphicsFile, encodeOvl, overlayPaletteSection, overlaySection, wallDecorationSection,
  type CSBGraphicSection,
} from '../../src/data/CSBGraphicsWriter';
import { readU16LE, readU32LE } from '../../src/core/bytes';
import { Overlay, OVERLAY_HEIGHT, OVERLAY_WIDTH } from '../../src/engine/Overlay';
import { identityOverlayPalette } from '../../src/engine/OverlayPalette';
import { check, finish } from '../lib/check';

interface Shipped {
  file: Uint8Array;
  loader: CSBGraphicsLoader;
  sections: CSBGraphicSection[];
}

/** A shipped file, and each of its sections as `readSection` inflates it. */
function shipped(path: string): Shipped {
  const file = new Uint8Array(readFileSync(path));
  const loader = new CSBGraphicsLoader();
  loader.loadFromArray(file);
  const sections: CSBGraphicSection[] = [];
  for (let i = 0; i < readU32LE(file, 8); i++) {
    const at = 12 + 36 * i;
    const type = readU32LE(file, at) as CSBGraphicType;
    const id = readU32LE(file, at + 4);
    const name = String.fromCharCode(...file.subarray(at + 20, at + 36));
    sections.push({ type, id, name, data: loader.readSection(type, id, 0)! });
  }
  return { file, loader, sections };
}

const equal = (a: ArrayLike<number> | null, b: ArrayLike<number> | null): boolean =>
  a !== null && b !== null && a.length === b.length && Array.prototype.every.call(a, (v: number, i: number) => v === b[i]);
const loaderOf = (file: Uint8Array): CSBGraphicsLoader => {
  const loader = new CSBGraphicsLoader();
  loader.loadFromArray(file);
  return loader;
};
const throws = (f: () => unknown): boolean => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};
/**
 * The most bytes `OVLDECODE::GetBytes` (`doc/CSBwin-src/Graphics.cpp:3157-3221`) stacks at
 * once reading `size` bytes from `words`: a code's string, one byte more for a code past
 * the table. Its reading of the codes, with the strings' lengths for their bytes.
 */
function longestString(words: Uint8Array, size: number): number {
  const length: number[] = [];
  const lengthOf = (code: number): number => (code > 255 ? length[code]! : 1);
  let word = 0, at = 0, bitsRemaining = 0, codeSize = 9, tableLen = 255, maxTableLen = 512;
  let a = 0, out = 0, longest = 0;
  while (out < size) {
    let numbits = Math.min(codeSize, bitsRemaining);
    let b = word & ((1 << numbits) - 1);
    bitsRemaining -= numbits;
    word >>>= numbits;
    numbits = codeSize - numbits;
    if (numbits > 0) {
      word = readU32LE(words, 4 * at++);
      bitsRemaining = 32 - numbits;
      b = (b << numbits) | (word & ((1 << numbits) - 1));
      word >>>= numbits;
    }
    let bytes: number;
    if (b >= tableLen && b > 0xff) {
      if (b === maxTableLen - 1) {
        maxTableLen *= 2;
        codeSize++;
        continue;
      }
      bytes = lengthOf(a) + 1;
    } else {
      bytes = lengthOf(b);
    }
    length[tableLen++] = lengthOf(a) + 1;
    longest = Math.max(longest, bytes);
    out += bytes;
    a = b;
  }
  return longest;
}

/** One section of `data`, written and read back. */
const roundTrip = (data: Uint8Array): Uint8Array | null =>
  loaderOf(buildCSBGraphicsFile([{ type: CSBGraphicType.Sound, id: 1, name: 'test', data }]))
    .readSection(CSBGraphicType.Sound, 1, 0);

const conflux = shipped('tools/fixtures/gamefiles/conflux-3.5-b8/CSBgraphics.dat');
const towers = shipped('tools/fixtures/gamefiles/towers-of-chaos-3.3/CSBgraphics.dat');

console.log('1. encodeOvl, on the shipped files');
/** Section `i`'s code words in `file`. */
const codeWords = (file: Uint8Array, i: number): Uint8Array => {
  const at = 12 + 36 * i;
  return file.subarray(readU32LE(file, at + 16), readU32LE(file, at + 16) + readU32LE(file, at + 8));
};
for (const [name, set, unlike] of [['Conflux 3.5', conflux, ['2/365']], ['Towers of Chaos 3.3', towers, []]] as const) {
  const written = buildCSBGraphicsFile(set.sections);
  const back = loaderOf(written);
  const misread = set.sections.filter((s) => !equal(back.readSection(s.type, s.id, 0), s.data));
  const different = set.sections.flatMap((s, i) => equal(codeWords(written, i), codeWords(set.file, i)) ? [] : [`${s.type}/${s.id}`]);
  console.log(`  ${name}: ${set.sections.length} sections, ${written.length} bytes written, ${set.file.length} shipped; in other code words: ${different.join(', ') || 'none'}`);
  check(misread.length === 0, `${name}: every section reads back as it was (${misread.length} do not)`);
  check(JSON.stringify(different) === JSON.stringify(unlike), `${name}: every section but ${unlike.join(', ') || 'none'} is written in the code words shipped`);
  check(equal(written.subarray(0, 12), set.file.subarray(0, 12))
    && set.sections.every((_, i) => equal(written.subarray(12 + 36 * i, 12 + 36 * i + 8), set.file.subarray(12 + 36 * i, 12 + 36 * i + 8))
      && equal(written.subarray(12 + 36 * i + 12, 12 + 36 * i + 16), set.file.subarray(12 + 36 * i + 12, 12 + 36 * i + 16))
      && equal(written.subarray(12 + 36 * i + 20, 12 + 36 * i + 36), set.file.subarray(12 + 36 * i + 20, 12 + 36 * i + 36))),
    `${name}: the header and every section's type, id, size and name are written as shipped`);
  if (unlike.length === 0) check(equal(written, set.file), `${name}: the file is written byte for byte as shipped`);
}

console.log('2. encodeOvl, on bytes no shipped section has');
{
  check(encodeOvl(new Uint8Array(0)).length === 0, 'no bytes are no code words');
  check(equal(roundTrip(new Uint8Array([0xa5])), [0xa5]), 'one byte reads back');
  const run = new Uint8Array(1_000_000).fill(7);
  check(equal(roundTrip(run), run), 'a million equal bytes read back');
  const longest = longestString(encodeOvl(run), run.length);
  console.log(`  the run's longest string is ${longest} bytes`);
  check(longest === 1000, "the run's strings stop at 1,000 bytes, under OVLDECODE's 1,024-byte stack");
  let seed = 12345;
  const random = Uint8Array.from({ length: 300_000 }, () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24);
  check(equal(roundTrip(random), random), '300,000 random bytes read back, through codes of 17 bits');
}

console.log('3. overlaySection');
{
  const PIXELS = 14 + 40 + 4 * 256;
  const shippedOverlay = conflux.sections.find((s) => s.type === CSBGraphicType.ViewportOverlay && s.id === 1)!.data;
  const topFirst = new Uint8Array(OVERLAY_WIDTH * OVERLAY_HEIGHT);
  for (let line = 0; line < OVERLAY_HEIGHT; line++) {
    const from = PIXELS + (OVERLAY_HEIGHT - 1 - line) * OVERLAY_WIDTH;
    topFirst.set(shippedOverlay.subarray(from, from + OVERLAY_WIDTH), line * OVERLAY_WIDTH);
  }
  const colours = Array.from({ length: 256 }, (_, i) => readU32LE(shippedOverlay, 54 + 4 * i));
  check(equal(overlaySection(topFirst, colours), shippedOverlay), "Conflux's overlay 1 is written as shipped");

  const pixels = Uint8Array.from({ length: OVERLAY_WIDTH * OVERLAY_HEIGHT }, (_, i) => (i % OVERLAY_WIDTH + 3 * Math.floor(i / OVERLAY_WIDTH)) % 37);
  const ours = Array.from({ length: 37 }, (_, i) => (i * 0x070503) & 0xffffff);
  const overlay = new Overlay(identityOverlayPalette(), () => {});
  overlay.csbGraphics = loaderOf(buildCSBGraphicsFile([
    { type: CSBGraphicType.ViewportOverlay, id: 4, name: 'test', data: overlaySection(pixels, ours) },
  ]));
  const read = overlay.ReadOverlay(4);
  const bottomFirst = new Uint8Array(pixels.length);
  for (let line = 0; line < OVERLAY_HEIGHT; line++) {
    bottomFirst.set(pixels.subarray((OVERLAY_HEIGHT - 1 - line) * OVERLAY_WIDTH, (OVERLAY_HEIGHT - line) * OVERLAY_WIDTH), line * OVERLAY_WIDTH);
  }
  check(read && equal(overlay.current.overlay, bottomFirst), 'an overlay reads through ReadOverlay bottom line first');
  check(equal(overlay.current.overlayPalette!.subarray(0, 37), ours), 'its 37 colours read as given');
}

console.log('4. overlayPaletteSection');
{
  const shippedPalette = conflux.sections.find((s) => s.type === CSBGraphicType.OverlayPalette && s.id === 1)!.data;
  const words = Array.from({ length: 512 }, (_, i) => readU16LE(shippedPalette, 2 * i));
  const written = overlayPaletteSection(words);
  check(equal(written, shippedPalette), "Conflux's overlay palette 1 is written as shipped");
  const blended = (csbGraphics: CSBGraphicsLoader): Uint8Array => {
    const palette = identityOverlayPalette();
    const overlay = new Overlay(palette, () => {});
    overlay.csbGraphics = csbGraphics;
    overlay.SetOverlayPalette(3, 100);
    return palette;
  };
  const ours = blended(loaderOf(buildCSBGraphicsFile([{ type: CSBGraphicType.OverlayPalette, id: 3, name: 'test', data: written }])));
  const theirs = identityOverlayPalette();
  const overlay = new Overlay(theirs, () => {});
  overlay.csbGraphics = conflux.loader;
  overlay.SetOverlayPalette(1, 100);
  check(!equal(ours, identityOverlayPalette()) && equal(ours, theirs), 'SetOverlayPalette reads it as it reads Conflux\'s');
}

console.log('5. wallDecorationSection');
{
  const walls = conflux.sections.filter((s) => s.type === CSBGraphicType.WallDecoration);
  const rebuilt: CSBGraphicSection[] = [];
  let asShipped = 0;
  let longer = 0;
  for (const section of walls) {
    const wall = conflux.loader.getWallDecoration(section.id)!;
    const data = wallDecorationSection(wall.desc, wall.sideBitmap, wall.frontBitmap);
    if (equal(data, section.data)) asShipped++;
    else if (section.data.length === data.length + 16 && equal(section.data.subarray(0, data.length), data)) longer++;
    rebuilt.push({ ...section, data });
  }
  console.log(`  ${walls.length} wall decorations: ${asShipped} as shipped, ${longer} shipped with 16 bytes more`);
  check(walls.length === 36 && asShipped === 31 && longer === 5, "each of Conflux's wall decorations is written as shipped, but the 16 bytes nothing reads");
  const back = loaderOf(buildCSBGraphicsFile(rebuilt));
  const same = walls.every((s) => {
    const a = conflux.loader.getWallDecoration(s.id)!;
    const b = back.getWallDecoration(s.id);
    return b !== null && JSON.stringify(a.desc) === JSON.stringify(b.desc)
      && equal(a.sideBitmap.pixels, b.sideBitmap.pixels) && equal(a.frontBitmap.pixels, b.frontBitmap.pixels);
  });
  check(same, 'every one reads back through getWallDecoration as Conflux\'s does');
}

console.log('6. Refusals');
{
  const data = new Uint8Array(4);
  check(throws(() => buildCSBGraphicsFile([
    { type: CSBGraphicType.Sound, id: 1, name: 'a', data },
    { type: CSBGraphicType.Sound, id: 1, name: 'b', data },
  ])), 'two sections of one type and id');
  check(throws(() => buildCSBGraphicsFile([{ type: CSBGraphicType.Sound, id: 1, name: 'seventeen chars!!', data }])), 'a name of 17 characters');
  check(throws(() => overlaySection(new Uint8Array(224 * 135), [0])), 'an overlay of 224x135');
  check(throws(() => overlaySection(new Uint8Array(224 * 136).fill(2), [0, 1])), 'an overlay pixel past its colours');
  const desc = (widthBytes: number, height: number): DecorationDesc[] =>
    Array.from({ length: 13 }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0, widthBytes, height }));
  const bitmap = (width: number, height: number) => ({ width, height, pixels: new Uint8Array(width * height) });
  check(throws(() => wallDecorationSection(desc(12, 4), bitmap(24, 4), bitmap(24, 4))), 'a wall decoration 24 wide');
  check(throws(() => wallDecorationSection(desc(8, 4), bitmap(16, 4), bitmap(32, 4))), 'a bitmap of another size than its placement');
  check(throws(() => wallDecorationSection(desc(8, 0), bitmap(16, 0), bitmap(16, 0))), 'a wall decoration of 80 bytes');
  check(!throws(() => wallDecorationSection(desc(8, 1), bitmap(16, 1), bitmap(16, 1))), 'one of 96 bytes is written');
}

finish();
