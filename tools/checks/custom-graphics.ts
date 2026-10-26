/**
 * What a skin's program draws of its own graphics:
 * `DrawCustomGraphic` through `ApplyBackground` and `ApplyBackground3`, and
 * `DrawCustomDecoration` through `ApplyDecoration` (`doc/CSBwin-src/Viewport.cpp:3070-3089`,
 * `:3109-3122`, `:6131-6548`; `src/renderer/bytecode/ApplyBackground.ts`).
 *
 * The reference here is the blit the routines mean: each pixel the mask selects, from
 * (`srcX + c`, `srcY + r`) of the bitmap to (`dstX + c`, `dstY + r`) of the viewport,
 * clipped at its right edge, after the routines' own size checks. It reads the mask and
 * the bitmap as pixels (`decodePlanar`), where the routines shift their bytes, so a
 * plane, byte or shift read wrong in the port shows as pixels that differ.
 *
 * 1. **The shifts, on graphics made here**, over a viewport of random pixels: with
 *    `srcX` on a group's start, as `BACKGROUND_MASK` requires (`CSB.h:332`), every
 *    destination bit 0 to 15, a negative `dstX` and one past the right edge draw the
 *    reference, pixel for pixel, and touch nothing else. Off that rule, CSBWin's own
 *    arithmetic: a destination shift under 8 with a source shift of 8 or more draws
 *    nothing, its case being commented out; and an aligned blit is not clipped, so a
 *    negative `dstX` starts on the line above and a blit past the right edge goes on at
 *    the next line's start.
 * 2. **Every mask a skin names**, in Conflux 3.5's and The Towers of Chaos 3.3's
 *    `CSBgraphics.dat`, with the bitmap of the same role (a wall mask with the wall
 *    graphic, …), through `GetMask` and `GetBitmap` as `DrawCustomGraphic` reads them:
 *    each draws the reference. Every `srcX` in both files is on a group's start.
 * 3. **The interpreter**: Conflux's starting view, against the same view with the
 *    graphic its one `DrawCustomGraphic` names missing. The two differ by exactly that
 *    mask's reference blit, and its `GTRACE` lines are CSBWin's.
 * 4. **`ApplyDecoration`**, on decorations made here (no data set has one): one group
 *    wide, it draws the reference at its location's x taken to a group; two groups wide,
 *    CSBWin's loop counts groups two at a time, so it draws the first group of each
 *    line, the next line's taken from where the last stopped.
 *
 * Run: `npm test -- --only=custom-graphics.ts`
 */
import { readFileSync } from 'node:fs';

import { readU16LE, readU32LE } from '../../src/core/bytes';
import { BackgroundLib, type BackgroundPointer } from '../../src/data/BackgroundLib';
import { CSBGraphicsLoader, CSBGraphicType, decodePlanar } from '../../src/data/CSBGraphicsLoader';
import { ApplyBackground, ApplyDecoration, ViewportBMP } from '../../src/renderer/bytecode/ApplyBackground';
import { BytecodeInterpreter } from '../../src/renderer/bytecode/BytecodeInterpreter';
import { Opcode } from '../../src/renderer/bytecode/Opcodes';
import { createPaletteIndexViewportBuffer, type PaletteIndexViewportBuffer } from '../../src/renderer/csbwin/CanvasBlitter';
import { check, finish } from '../lib/check';
import { viewportContextOf } from '../lib/viewportContext';

const SETS = [
  { name: 'Conflux 3.5', dir: 'conflux-3.5-b8' },
  { name: 'The Towers of Chaos 3.3', dir: 'towers-of-chaos-3.3' },
];

/** `Literal v`, the word as a `ui16` of the code. */
const L = (v: number): number[] => [Opcode.Literal, v & 0xffff];

let seed = 12345;
const random = (): number => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed >>> 16;
};

function csbGraphics(dir: string): CSBGraphicsLoader {
  const csb = new CSBGraphicsLoader();
  csb.loadFromArray(new Uint8Array(readFileSync(`tools/fixtures/gamefiles/${dir}/CSBgraphics.dat`)));
  return csb;
}

function randomViewport(): PaletteIndexViewportBuffer {
  const viewport = createPaletteIndexViewportBuffer(224, 136, 0);
  for (let i = 0; i < viewport.pixels.length; i++) viewport.pixels[i] = random() & 15;
  return viewport;
}

/** A bitmap section: its width longword, then random planar lines. */
function makeBitmap(width: number, height: number): Uint8Array {
  const data = new Uint8Array(4 + (width / 2) * height);
  new DataView(data.buffer).setUint32(0, width, true);
  for (let i = 4; i < data.length; i++) data[i] = random() & 0xff;
  return data;
}

type Header = [srcX: number, srcY: number, dstX: number, dstY: number, width: number, height: number];

/** A mask: its header, then random mask words. */
function makeMask(header: Header): BackgroundPointer {
  const [, , , , width, height] = header;
  const data = new Uint8Array(12 + (width / 16) * height * 2);
  const view = new DataView(data.buffer);
  header.forEach((value, i) => view.setUint16(2 * i, value & 0xffff, true));
  for (let i = 12; i < data.length; i++) data[i] = random() & 0xff;
  return { data, offset: 0 };
}

function headerOf(mask: BackgroundPointer): Header {
  const word = (i: number): number => readU16LE(mask.data, mask.offset + 2 * i);
  return [word(0), word(1), (word(2) << 16) >> 16, word(3), word(4), word(5)];
}

/** The blit the routines mean (see the module comment), or `null` where a check refuses it. */
function reference(
  viewport: PaletteIndexViewportBuffer,
  mask: BackgroundPointer,
  bitmap: Uint8Array,
  linear = false
): Uint8Array | null {
  const [srcX, srcY, dstX, dstY, width, height] = headerOf(mask);
  const bitmapsize = bitmap.length >> 2;
  const srcWidth = readU32LE(bitmap, 0);
  if (dstX > 224 || (width & 15) !== 0) return null;
  if (((dstX & 15) | (srcX & 15)) === 0) {
    // `ApplyBackground`'s two checks, in `i32` units.
    if (28 * (dstY + height - 1) + Math.trunc(dstX / 16) * 2 + width / 8 > 3808) return null;
    if ((srcWidth / 8) * (srcY + height - 1) + srcX / 8 + width / 8 > bitmapsize) return null;
  } else if (srcWidth * (srcY + height - 1) + srcX + width > (bitmapsize - 1) * 8) {
    return null; // `ApplyBackground3`'s
  }
  const srcHeight = Math.floor(((bitmapsize - 1) * 8) / srcWidth);
  const src = decodePlanar(bitmap.subarray(4), srcWidth, srcHeight);
  const out = new Uint8Array(viewport.pixels);
  const groups = width >> 4;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const at = mask.offset + 12 + 2 * (r * groups + (c >> 4));
      const word = (mask.data[at]! << 8) | mask.data[at + 1]!;
      if (((word >> (15 - (c & 15))) & 1) === 0) continue;
      const x = dstX + c;
      const y = dstY + r;
      if (linear) {
        // An aligned blit's address: its lines run on into the next, either way.
        if (y * 224 + x >= 0) out[y * 224 + x] = src[(srcY + r) * srcWidth + srcX + c]!;
        continue;
      }
      if (x < 0 || x >= 224 || y >= 136) continue;
      out[y * 224 + x] = src[(srcY + r) * srcWidth + srcX + c]!;
    }
  }
  return out;
}

function apply(viewport: PaletteIndexViewportBuffer, mask: BackgroundPointer | null, bitmap: Uint8Array | null): void {
  const viewportBMP = new ViewportBMP(viewport);
  ApplyBackground(viewportBMP, mask, bitmap, bitmap === null ? 0 : bitmap.length >> 2);
  viewportBMP.flush();
}

function differing(a: Uint8Array, b: Uint8Array): number[] {
  const at: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) at.push(i);
  return at;
}

function shifts(): void {
  console.log('1. The shifts, on graphics made here');
  const bitmap = makeBitmap(256, 80);
  const onRule: Array<[string, Header]> = [];
  for (let dBit = 0; dBit < 16; dBit++) onRule.push([`dstX ${32 + dBit}`, [16, 3, 32 + dBit, 10, 48, 20]]);
  onRule.push(['dstX -20, bit 12', [0, 3, -20, 10, 48, 20]], ['dstX -28, bit 4', [16, 3, -28, 10, 48, 20]]);
  onRule.push(['dstX 196, past the right edge', [0, 3, 196, 10, 64, 20]], ['dstX 207', [32, 7, 207, 100, 32, 36]]);
  const wrong: string[] = [];
  let drawn = 0;
  for (const [name, header] of onRule) {
    const viewport = randomViewport();
    const mask = makeMask(header);
    const expected = reference(viewport, mask, bitmap)!;
    const before = new Uint8Array(viewport.pixels);
    apply(viewport, mask, bitmap);
    drawn += differing(before, viewport.pixels).length;
    const off = differing(expected, viewport.pixels).length;
    if (off !== 0) wrong.push(`${name}: ${off} pixels`);
  }
  check(wrong.length === 0 && drawn > 0,
    `srcX on a group's start: ${onRule.length} blits draw the reference and nothing else, ${drawn} pixels changed (${wrong.join('; ')})`);

  const nothing = randomViewport();
  const untouched = new Uint8Array(nothing.pixels);
  apply(nothing, makeMask([8, 3, 35, 10, 48, 20]), bitmap);
  check(differing(untouched, nothing.pixels).length === 0,
    'destination shift 3, source shift 11: CSBWin\'s commented-out case draws nothing');

  // Aligned and not clipped: `pDstRow = d.pViewportBMP + 28*dstY + dstX`, its lines 28 longwords apart.
  const wrapped = (header: Header): boolean => {
    const viewport = randomViewport();
    const mask = makeMask(header);
    const expected = reference(viewport, mask, bitmap, true)!;
    apply(viewport, mask, bitmap);
    return differing(expected, viewport.pixels).length === 0;
  };
  check(wrapped([0, 3, -16, 10, 48, 20]) && wrapped([0, 3, 192, 10, 64, 20]),
    'aligned, dstX -16: each line\'s first group ends the line above; dstX 192, 64 wide: the last two start the next line');
}

function everyMask(): void {
  console.log('2. Every mask a skin names');
  for (const set of SETS) {
    const csb = csbGraphics(set.dir);
    const lib = new BackgroundLib(csb);
    const pairs = new Set<string>();
    for (let skin = 1; skin < 64; skin++) {
      for (let role = 0; role < 4; role++) {
        const graphicID = lib.GetSkinID(skin, role);
        const maskID = lib.GetSkinID(skin, role + 4);
        if (graphicID !== 0 && maskID !== 0) pairs.add(`${graphicID},${maskID}`);
      }
    }
    let blits = 0;
    let refused = 0;
    let pixels = 0;
    let offRule = 0;
    const wrong: string[] = [];
    for (const pair of pairs) {
      const [graphicID, maskID] = pair.split(',').map(Number) as [number, number];
      const count = readU32LE(csb.readSection(CSBGraphicType.Backgrounds, maskID, 0)!, 0);
      for (let maskNumber = 0; maskNumber < count; maskNumber++) {
        const mask = lib.GetMask(maskID, maskNumber, 12);
        const bitmap = lib.GetBitmap(graphicID, 2);
        if (mask === null || bitmap === null) continue;
        if ((headerOf(mask)[0] & 15) !== 0) offRule++;
        const viewport = randomViewport();
        const expected = reference(viewport, mask, bitmap.data);
        const before = new Uint8Array(viewport.pixels);
        apply(viewport, mask, bitmap.data);
        if (expected === null) {
          refused++;
          if (differing(before, viewport.pixels).length !== 0) wrong.push(`${graphicID}/${maskID}.${maskNumber} refused but drew`);
          continue;
        }
        blits++;
        pixels += differing(before, viewport.pixels).length;
        const off = differing(expected, viewport.pixels).length;
        if (off !== 0) wrong.push(`${graphicID}/${maskID}.${maskNumber}: ${off} pixels`);
      }
    }
    console.log(`  ${set.name}: ${pairs.size} graphic and mask pairs, ${blits} blits drawing ${pixels} pixels, ${refused} refused by the size checks`);
    check(offRule === 0, `${set.name}: every mask's srcX is on a group's start`);
    check(wrong.length === 0 && blits > 0, `${set.name}: every blit draws the reference (${wrong.slice(0, 4).join('; ')})`);
  }
}

function interpreter(): void {
  console.log('3. The interpreter');
  const csb = csbGraphics('conflux-3.5-b8');
  const lib = new BackgroundLib(csb);
  const viewport = randomViewport();
  const expected = reference(viewport, lib.GetMask(9, 3, 12)!, lib.GetBitmap(143, 2)!.data)!;
  const trace: string[] = [];
  const ctx = viewportContextOf({
    backgroundLib: lib, viewportIndexBuffer: viewport,
    graphicTrace: (line) => trace.push(line),
  });
  new BytecodeInterpreter(ctx).interpret([...L(143), ...L(9), ...L(3), Opcode.DrawCustomGraphic, Opcode.Return], 0, 0);
  for (const line of trace) console.log(`  ${line}`);
  check(differing(expected, viewport.pixels).length === 0,
    'graphic 143, mask section 9, mask 3, as Conflux\'s starting view asks: popped in that order and drawn');
  check(trace.map((line) => line.trim()).join('|') === 'DrawCustomGraphic(143, 9, 3)|dstX=208, dstY=25, width=16, height=49',
    'its GTRACE line, and the mask\'s line CSBWin\'s _DEBUG build adds');

  // A decoration section: a count, an offset each, a count of locations and the locations.
  const decoration = new Uint8Array(2 + 2 + 2 + 2 + 2 + 10 * 12);
  const view = new DataView(decoration.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 10, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 0x2510, true); // x 16, y 37
  decoration[10] = 16;
  decoration[11] = 12;
  for (let i = 12; i < decoration.length; i++) decoration[i] = random() & 0xff;
  const decorated = new BackgroundLib({ readSection: (_type, id) => (id === 70 ? decoration : null) });
  const own = randomViewport();
  const direct = { ...own, pixels: new Uint8Array(own.pixels) };
  const viewportBMP = new ViewportBMP(direct);
  ApplyDecoration(viewportBMP, { data: decoration, offset: 10 }, { data: decoration, offset: 6 }, decoration.length - 10);
  viewportBMP.flush();
  const before = new Uint8Array(own.pixels);
  new BytecodeInterpreter({ ...ctx, backgroundLib: decorated, viewportIndexBuffer: own })
    .interpret([...L(70), ...L(0), ...L(0), Opcode.DrawCustomDecoration, Opcode.Return], 0, 0);
  check(differing(before, own.pixels).length > 0 && differing(direct.pixels, own.pixels).length === 0,
    'DrawCustomDecoration 70, decoration 0, location 0: GetDecorationBitmap\'s pointers, through ApplyDecoration');
}

function decorations(): void {
  console.log('4. ApplyDecoration, on decorations made here');
  // A decoration of `groups` groups: width, height, then per group a mask word and four planes.
  const make = (groups: number, height: number): BackgroundPointer => {
    const data = new Uint8Array(2 + 10 * groups * height);
    data[0] = 16 * groups;
    data[1] = height;
    for (let i = 2; i < data.length; i++) data[i] = random() & 0xff;
    return { data, offset: 0 };
  };
  const location: BackgroundPointer = { data: Uint8Array.of(0, 0, 37, 50), offset: 2 }; // x 37 → 32
  // What a decoration means: group `g` of line `r` taken from `wordsAt(r, g)`.
  const expected = (viewport: PaletteIndexViewportBuffer, decoration: BackgroundPointer, drawnGroups: number, at: (r: number, g: number) => number): Uint8Array => {
    const out = new Uint8Array(viewport.pixels);
    const { data } = decoration;
    for (let r = 0; r < data[1]!; r++) {
      for (let g = 0; g < drawnGroups; g++) {
        const p = at(r, g);
        const word = (i: number): number => (data[p + 2 * i]! << 8) | data[p + 2 * i + 1]!;
        for (let bit = 0; bit < 16; bit++) {
          if (((word(0) >> (15 - bit)) & 1) === 0) continue;
          let colour = 0;
          for (let plane = 0; plane < 4; plane++) colour |= ((word(1 + plane) >> (15 - bit)) & 1) << plane;
          out[(50 + r) * 224 + 32 + 16 * g + bit] = colour;
        }
      }
    }
    return out;
  };
  const draw = (decoration: BackgroundPointer): PaletteIndexViewportBuffer => {
    const viewport = randomViewport();
    const before = { ...viewport, pixels: new Uint8Array(viewport.pixels) };
    const viewportBMP = new ViewportBMP(viewport);
    ApplyDecoration(viewportBMP, decoration, location, decoration.data.length);
    viewportBMP.flush();
    return Object.assign(before, { after: viewport.pixels });
  };
  const one = make(1, 12);
  const oneDrawn = draw(one) as PaletteIndexViewportBuffer & { after: Uint8Array };
  check(differing(expected(oneDrawn, one, 1, (r) => 2 + 10 * r), oneDrawn.after).length === 0,
    'one group wide: the decoration at its location, x 37 taken to the group at 32');
  const two = make(2, 12);
  const twoDrawn = draw(two) as PaletteIndexViewportBuffer & { after: Uint8Array };
  check(differing(expected(twoDrawn, two, 1, (r) => 2 + 10 * r), twoDrawn.after).length === 0,
    'two groups wide: the first group of each line, each line\'s taken from where the last stopped');
}

shifts();
everyMask();
interpreter();
decorations();
finish();
