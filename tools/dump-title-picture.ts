/**
 * A set's thumbnail reduced to the screen's sixteen registers, as the boot shows it in the
 * title's place (`reduceTitlePicture`, `src/renderer/intro/TitlePicture.ts`).
 *
 * What the screen cannot show, and this asserts:
 *
 * 1. **The Theron cover**, `tools/fixtures/theron-cover.png` (320x200, tens of thousands of
 *    colours, the first set to ask for it): at most sixteen registers, each an Atari shade,
 *    every pixel one of them, and each pixel the register nearest its colour as the canvas
 *    shows it. The screen it gives is pinned by its MD5, and a second run gives the same:
 *    every player sees the same picture.
 * 2. **The canary**: a picture already of sixteen Atari shades comes back exactly, each
 *    pixel its own shade, which a box cut in the wrong place or a mean off by a level breaks.
 * 3. **The edges**: one colour is one register; a half-transparent pixel is taken over
 *    black; an image of another size is refused.
 *
 * `--png <file>` writes the cover's screen as a paletted PNG, to look at.
 *
 * Run: `npm test -- --only=dump-title-picture.ts`
 */
import { createHash } from 'node:crypto';

import { atariToRGB } from '../src/core/types';
import { reduceTitlePicture, TITLE_PICTURE_COLOURS } from '../src/renderer/intro/TitlePicture';
import { thumbnailPalette, type TitleFrame } from '../src/renderer/intro/TitleThumbnail';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';
import { readPng, writeIndexedPng } from './lib/png';
import { SAVE_DIR } from './lib/saves';

const COVER = `${SAVE_DIR}/theron-cover.png`;

/** The MD5 of the cover's screen, its pixels then its registers as big-endian words. */
const COVER_MD5 = 'd4577230fe21aa0feee73ebe72605d5e';

const PIXELS = SCREEN_WIDTH * SCREEN_HEIGHT;

function md5(frame: TitleFrame): string {
  const registers = Buffer.alloc(frame.registers.length * 2);
  frame.registers.forEach((register, i) => registers.writeUInt16BE(register, i * 2));
  return createHash('md5').update(frame.pixels).update(registers).digest('hex');
}

/** An image of `colour(p)`, `[r, g, b, a]` for pixel `p`. */
function image(colour: (p: number) => number[]): Uint8Array {
  const rgba = new Uint8Array(PIXELS * 4);
  for (let p = 0; p < PIXELS; p++) rgba.set(colour(p), p * 4);
  return rgba;
}

function distance(rgba: Uint8Array, p: number, register: number): number {
  const { r, g, b } = atariToRGB(register);
  const alpha = rgba[p * 4 + 3];
  const over = (c: number): number => Math.round((rgba[p * 4 + c] * alpha) / 255);
  return (over(0) - r) ** 2 + (over(1) - g) ** 2 + (over(2) - b) ** 2;
}

function checkCover(pngOut: string | null): void {
  console.log('=== The Theron cover ===');
  const png = readPng(COVER);
  const distinct = new Set<number>();
  for (let p = 0; p < png.width * png.height; p++) {
    distinct.add((png.rgba[p * 4] << 16) | (png.rgba[p * 4 + 1] << 8) | png.rgba[p * 4 + 2]);
  }
  console.log(`${png.width}x${png.height}, ${distinct.size} colours`);
  check(png.width === SCREEN_WIDTH && png.height === SCREEN_HEIGHT, 'the cover is the screen\'s size');
  check(distinct.size > 10_000, 'and far more colours than the screen has');

  const frame = reduceTitlePicture(png.rgba, png.width, png.height);
  const hex = (register: number): string => register.toString(16).padStart(3, '0');
  console.log(`registers: ${frame.registers.map(hex).join(' ')}`);
  const used = new Set(frame.pixels);
  console.log(`registers drawn: ${used.size}, md5 ${md5(frame)}`);
  check(frame.registers.length === TITLE_PICTURE_COLOURS, 'sixteen registers');
  check(frame.registers.every((register) => (register & ~0x777) === 0), 'each an Atari shade, three bits a component');
  check(new Set(frame.registers).size > 8, 'and most of them distinct: the cut found the cover\'s colours');
  check(frame.pixels.length === PIXELS && frame.pixels.every((pixel) => pixel < TITLE_PICTURE_COLOURS), 'every pixel one of them');

  let nearest = true;
  for (let p = 0; p < PIXELS && nearest; p++) {
    const own = distance(png.rgba, p, frame.registers[frame.pixels[p]]);
    nearest = frame.registers.every((register) => distance(png.rgba, p, register) >= own);
  }
  check(nearest, 'each pixel the register nearest its colour, as the canvas shows it');

  const again = reduceTitlePicture(png.rgba, png.width, png.height);
  check(md5(again) === md5(frame), 'a second run gives the same screen');
  check(md5(frame) === COVER_MD5, `the screen is the pinned one (${COVER_MD5})`);

  if (pngOut) {
    writeIndexedPng(pngOut, SCREEN_WIDTH, SCREEN_HEIGHT, frame.pixels, thumbnailPalette(frame.registers));
    console.log(`wrote ${pngOut}`);
  }
}

function checkCanary(): void {
  console.log('\n=== Sixteen Atari shades come back exactly ===');
  // Sixteen shades, each a stripe of its own width, so their pixel counts differ.
  const shades = [0x000, 0x777, 0x700, 0x070, 0x007, 0x770, 0x077, 0x707, 0x123, 0x456, 0x765, 0x321, 0x135, 0x642, 0x214, 0x553];
  const edges = shades.map((_, i) => ((i + 1) * (i + 2)) / 2);
  const shadeAt = (p: number): number => {
    const x = (p % SCREEN_WIDTH) * edges[edges.length - 1] / SCREEN_WIDTH;
    return shades[edges.findIndex((edge) => x < edge)];
  };
  const rgba = image((p) => {
    const { r, g, b } = atariToRGB(shadeAt(p));
    return [r, g, b, 255];
  });
  const frame = reduceTitlePicture(rgba, SCREEN_WIDTH, SCREEN_HEIGHT);
  let exact = true;
  for (let p = 0; p < PIXELS; p++) exact &&= frame.registers[frame.pixels[p]] === shadeAt(p);
  check(exact, 'each pixel shows its own shade');
  check([...shades].sort().join() === [...frame.registers].sort().join(), 'and the registers are the sixteen shades');
}

function checkEdges(): void {
  console.log('\n=== The edges ===');
  const one = reduceTitlePicture(image(() => [200, 100, 50, 255]), SCREEN_WIDTH, SCREEN_HEIGHT);
  check(one.pixels.every((pixel) => pixel === 0) && one.registers[0] === 0x631
    && one.registers.slice(1).every((register) => register === 0),
    'one colour is register 0, its nearest shade (200,100,50 -> 0x631), the others black');

  const half = reduceTitlePicture(image(() => [255, 255, 255, 128]), SCREEN_WIDTH, SCREEN_HEIGHT);
  check(half.registers[0] === 0x444, 'white at half alpha is taken over black: 128, level 4');

  let refused = false;
  try {
    reduceTitlePicture(new Uint8Array(160 * 100 * 4), 160, 100);
  } catch {
    refused = true;
  }
  check(refused, 'a picture of another size is refused');
}

const pngAt = process.argv.indexOf('--png');
checkCover(pngAt >= 0 ? process.argv[pngAt + 1] : null);
checkCanary();
checkEdges();
finish();
