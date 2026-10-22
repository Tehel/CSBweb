/**
 * A skin's virtual graphics: `CreateVirtualBitmap`,
 * `CreateVirtualMask` and `CreateVirtualAffineMask` make a bitmap, a mask or a transform
 * in the background library, which a skin's program then draws with
 * (`doc/CSBwin-src/Viewport.cpp:3090-3108`, `:3212-3284`, `:5452-5631`, `:108-280`).
 *
 * 1. **The transforms**, on a hand-made bitmap of 32 by 4 pixels, read back by a decoder of
 *    its own (sixteen pixels a group, four big-endian plane words, the first pixel the
 *    high bit): the identity copies it, `Cxx` of -32 mirrors it, a `Cxc` past the width
 *    wraps it, half a pixel's step rounds to the nearest (the `+ 16`), and a pixel whose group's first word is past `m_maxIndex` reads -1, so
 *    colour 15 is written, while one whose word equals it is still read. A mask's
 *    transform, one bit a pixel, the same way.
 * 2. **The mask sections' index**, by hand: `CreateNewMask` on a section of two masks
 *    grows its index to the new number, zeros the entries between, moves the two offsets
 *    up by four bytes an entry added, and puts the new mask, its header copied, at the
 *    section's old end; a second time refuses, and shows the "Design Error" once.
 *    `CreateNewAffineMask` moves the offsets up by 4 whatever it adds, as CSBWin does
 *    (`:5584`), and a new id starts a section of its own.
 * 3. **Views**, in Conflux 3.5 and The Towers of Chaos 3.3: from every square of the
 *    party's starting level, in each facing, twice over. Every virtual bitmap and mask the
 *    programs make is the transform of its source as the decoder above reads it, with no
 *    pixel read past the source; each is made once, and the second pass makes none; no
 *    "Design Error", and no transform grows its section's index by more than one entry
 *    past offsets it holds, so `CreateNewAffineMask`'s short move never shows. The programs draw with them: `DrawCustomGraphic` is asked for a
 *    virtual bitmap through a virtual mask, and finds both.
 *
 * Run: `npm test -- --only=dump-virtual-graphics.ts`.
 */
import { readFileSync } from 'node:fs';

import { readU16LE, readU32LE, writeU16LE, writeU32LE } from '../src/core/bytes';
import { Position } from '../src/core/types';
import { BackgroundLib, type BackgroundPointer } from '../src/data/BackgroundLib';
import { CSBGraphicsLoader } from '../src/data/CSBGraphicsLoader';
import {
  AffineTransform1, AffineTransform4, CUSTOMBITMAP, readAffineMask, type AFFINEMASK,
} from '../src/data/CustomBitmap';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { ViewportRenderer } from '../src/renderer/ViewportRenderer';
import { check, finish } from './lib/check';
import { graphicsTablesOf, newGame } from './lib/game';

const SETS = [
  { name: 'Conflux 3.5', dir: 'conflux-3.5-b8' },
  { name: 'The Towers of Chaos 3.3', dir: 'towers-of-chaos-3.3' },
];

/** Pixel (x, y) of a four-plane bitmap section, its width longword first. */
function pixel4(bitmap: Uint8Array, x: number, y: number): number {
  const groups = readU32LE(bitmap, 0) >>> 4;
  let colour = 0;
  for (let plane = 0; plane < 4; plane++) {
    const at = 4 + 2 * ((y * groups + (x >> 4)) * 4 + plane);
    const word = ((bitmap[at] ?? 0) << 8) | (bitmap[at + 1] ?? 0);
    colour |= ((word >> (15 - (x & 15))) & 1) << plane;
  }
  return colour;
}

/** The word of a four-plane bitmap's first plane that holds pixel (x, y)'s group. */
function word4(bitmap: Uint8Array, x: number, y: number): number {
  return (y * (readU32LE(bitmap, 0) >>> 4) + Math.trunc(x / 16)) * 4;
}

/** Pixel (x, y) of a mask, one bit a pixel after its twelve-byte header. */
function pixel1(mask: BackgroundPointer, x: number, y: number): number {
  const width = readU16LE(mask.data, mask.offset + 8);
  const at = mask.offset + 12 + 2 * (y * (width >> 4) + (x >> 4)) + ((x & 15) >> 3);
  return ((mask.data[at] ?? 0) >> (7 - (x & 7))) & 1;
}

/** Where the transform reads destination pixel (col, row): `Viewport.cpp:205-210`. */
function source(am: AFFINEMASK, col: number, row: number): [number, number] {
  const wrap = (v: number, m: number): number => Math.floor((((v % m) + m) % m) / 32);
  return [
    am.srcX + wrap(am.Cxx * col + am.Cxy * row + am.Cxc + 16, 32 * am.srcWidth),
    am.srcY + wrap(am.Cyx * col + am.Cyy * row + am.Cyc + 16, 32 * am.srcHeight),
  ];
}

/** A four-plane bitmap section of `width` by `height` from `colour(x, y)`. */
function bitmapOf(width: number, height: number, colour: (x: number, y: number) => number): Uint8Array {
  const bitmap = new Uint8Array(4 + (width * height) / 2);
  writeU32LE(bitmap, 0, width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let plane = 0; plane < 4; plane++) {
        const at = 4 + 2 * ((y * (width >> 4) + (x >> 4)) * 4 + plane) + ((x & 15) >> 3);
        bitmap[at]! |= ((colour(x, y) >> plane) & 1) << (7 - (x & 7));
      }
    }
  }
  return bitmap;
}

const transform = (over: Partial<AFFINEMASK>): AFFINEMASK => ({
  Cxx: 32, Cxy: 0, Cxc: 0, Cyx: 0, Cyy: 32, Cyc: 0, srcX: 0, srcY: 0, srcWidth: 32, srcHeight: 4, dstWidth: 32, dstHeight: 4, ...over,
});

/** `AffineTransform4` of `src` (`srcSize` `i32`s) into a new 32 by 4 bitmap, read back. */
function transformed(src: Uint8Array, srcSize: number, am: AFFINEMASK): number[] {
  const dst = bitmapOf(32, 4, () => 0);
  const s = new CUSTOMBITMAP();
  const d = new CUSTOMBITMAP();
  s.Initialize(src, 4, srcSize - 1);
  d.Initialize(dst, 4, dst.length >> 2);
  AffineTransform4(s, d, am);
  return Array.from({ length: 128 }, (_, i) => pixel4(dst, i & 31, i >> 5));
}

function transforms(): void {
  console.log('1. The transforms');
  const colour = (x: number, y: number): number => (x * 7 + y * 5 + 3) & 15;
  const src = bitmapOf(32, 4, colour);
  const size = src.length >> 2;
  const expect = (f: (x: number, y: number) => number): number[] => Array.from({ length: 128 }, (_, i) => f(i & 31, i >> 5));
  const same = (a: number[], b: number[]): boolean => a.join() === b.join();
  check(same(transformed(src, size, transform({})), expect(colour)), 'the identity copies the bitmap');
  check(same(transformed(src, size, transform({ Cxx: -32, Cxc: 32 * 31 })), expect((x, y) => colour(31 - x, y))),
    'Cxx -32 and Cxc 32 * 31 mirror it');
  check(same(transformed(src, size, transform({ Cxc: 32 * 40 })), expect((x, y) => colour((x + 8) & 31, y))),
    'a Cxc of 40 pixels wraps round the 32 of the width');
  check(same(transformed(src, size, transform({ Cxx: 16, Cyy: 64, srcHeight: 2 })),
    expect((x) => colour((x + 1) >> 1, 0))),
    'Cxx 16 doubles the width, its + 16 rounding to the nearest source pixel; Cyy 64 wraps every line to 0 at srcHeight 2');
  // Eight `i32`s after the width: words 0 to 15, rows 0 and 1, so `m_maxIndex` is 16. Row
  // 2's first group starts at word 16 and is read; its second, at 20, reads -1.
  const short = transformed(src, 9, transform({}));
  check(same(short, expect((x, y) => (y < 2 || (y === 2 && x < 16) ? colour(x, y) : 15))),
    'a group starting at m_maxIndex is read, one past it reads -1 and writes colour 15');

  const mask = new Uint8Array(12 + 2 * 2 * 4);
  writeU16LE(mask, 8, 32);
  writeU16LE(mask, 10, 4);
  for (let i = 12; i < mask.length; i++) mask[i] = (i * 37 + 11) & 0xff;
  const newMask = new Uint8Array(mask.length);
  writeU16LE(newMask, 8, 32);
  writeU16LE(newMask, 10, 4);
  const s = new CUSTOMBITMAP();
  const d = new CUSTOMBITMAP();
  s.InitializeMask({ data: mask, offset: 0 });
  d.InitializeMask({ data: newMask, offset: 0 });
  AffineTransform1(s, d, transform({ Cxx: -32, Cxc: 32 * 31 }));
  let mirrored = true;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 32; x++) {
      if (pixel1({ data: newMask, offset: 0 }, x, y) !== pixel1({ data: mask, offset: 0 }, 31 - x, y)) mirrored = false;
    }
  }
  check(mirrored, 'a mask\'s transform, one bit a pixel: mirrored');
}

/** A mask section of `count` masks of 16 by 1, its offsets after its index. */
function maskSection(count: number): Uint8Array {
  const section = new Uint8Array(4 + 4 * count + 14 * count);
  writeU32LE(section, 0, count);
  for (let i = 0; i < count; i++) {
    const at = 4 + 4 * count + 14 * i;
    writeU32LE(section, 4 + 4 * i, at);
    writeU16LE(section, at + 8, 16);
    writeU16LE(section, at + 10, 1);
    writeU16LE(section, at + 12, 0x1111 * (i + 1));
  }
  return section;
}

function maskIndex(): void {
  console.log('2. The mask sections\' index');
  const lib = new BackgroundLib({ readSection: (_type, id) => (id === 20 || id === 21 ? maskSection(2) : null) });
  const messages: string[] = [];
  lib.messageBox = (line) => messages.push(line);
  const header = { srcX: 16, srcY: 2, dstX: -16, dstY: 7, width: 32, height: 3 };
  const p = lib.CreateNewMask(20, 4, header);
  const old = maskSection(2);
  const index = Array.from({ length: 6 }, (_, i) => readU32LE(p!.data, 4 * i));
  check(index.join() === `5,${4 + 8 + 12},${4 + 8 + 14 + 12},0,0,${old.length + 12}`,
    `CreateNewMask(20, 4): count 5, the two offsets 12 bytes up, entries 2 and 3 zero, the new one at the old end (${index.join()})`);
  check(p !== null && p.offset === old.length + 12 && p.data.length === old.length + 12 + 2 * 3 * 2 + 12,
    'the new mask has its header and two words a line of three');
  check(lib.GetMask(20, 1, 12) !== null && readU16LE(lib.GetMask(20, 1, 12)!.data, lib.GetMask(20, 1, 12)!.offset + 12) === 0x2222,
    'mask 1 is still found where it moved');
  const read = lib.GetMask(20, 4, 12)!;
  check(Array.from({ length: 6 }, (_, i) => readU16LE(read.data, read.offset + 2 * i)).join() === '16,2,65520,7,32,3',
    'GetMask finds mask 4, its header copied, dstX -16 as an i16');
  check(lib.CreateNewMask(20, 4, header) === null && lib.CreateNewMask(20, 4, header) === null && messages.length === 1,
    `made again, it is refused, and the "Design Error" shows once (${messages.join('; ')})`);

  const affine = transform({ Cxc: -5, dstWidth: 48 });
  const a = lib.CreateNewAffineMask(21, 4, affine)!;
  const affineIndex = Array.from({ length: 6 }, (_, i) => readU32LE(a.data, 4 * i));
  check(affineIndex.join() === `5,${4 + 8 + 4},${4 + 8 + 14 + 4},0,0,${old.length + 12}`,
    `CreateNewAffineMask(21, 4): the two offsets up by 4 only, as CSBWin moves them (${affineIndex.join()})`);
  check(JSON.stringify(readAffineMask(lib.GetMask(21, 4, 48)!)) === JSON.stringify(affine), 'the transform is copied whole');
  const fresh = lib.CreateNewMask(30, 2, header)!;
  check(readU32LE(fresh.data, 0) === 3 && fresh.offset === 16 && lib.MaskExists(30, 2) !== null && lib.MaskExists(30, 1) === null,
    'a new id starts a section of its own: count 3, the mask after the index');
}

/** The library the views run on, checking what it makes against the decoder above. */
class CheckedLib extends BackgroundLib {
  bitmaps = 0;
  masks = 0;
  affineMasks = 0;
  bad: string[] = [];
  outside = 0;
  made = new Set<string>();
  madeTwice = 0;
  messages: string[] = [];

  override CreateVirtualBitmap(pGraphic: Uint8Array, srcSize: number, virtualGraphicID: number, pMask: BackgroundPointer): void {
    // `BackgroundGraphicExists` records no miss, where `GetBitmap` would.
    const existed = this.BackgroundGraphicExists(virtualGraphicID, 2, false) >= 0;
    super.CreateVirtualBitmap(pGraphic, srcSize, virtualGraphicID, pMask);
    if (existed || this.BackgroundGraphicExists(virtualGraphicID, 2, false) < 0) return;
    const made = this.GetBitmap(virtualGraphicID, 2)!;
    this.bitmaps++;
    this.once(`bitmap ${virtualGraphicID}`);
    const am = readAffineMask(pMask);
    const maxIndex = 2 * (srcSize - 1);
    for (let row = 0; row < am.dstHeight; row++) {
      for (let col = 0; col < am.dstWidth; col++) {
        const [x, y] = source(am, col, row);
        const inside = word4(pGraphic, x, y) <= maxIndex && x >= 0;
        if (!inside) this.outside++;
        if (pixel4(made.data, col, row) !== (inside ? pixel4(pGraphic, x, y) : 15)) {
          this.bad.push(`bitmap ${virtualGraphicID} (${col}, ${row})`);
          return;
        }
      }
    }
  }

  override CreateNewMask(id: number, number: number, pMask: Parameters<BackgroundLib['CreateNewMask']>[2]): BackgroundPointer | null {
    const p = super.CreateNewMask(id, number, pMask);
    if (p !== null) this.once(`mask ${id}/${number}`);
    return p;
  }

  /** Transforms kept in a section whose index grows past offsets it holds, where CSBWin moves them by 4 only. */
  shortMoves = 0;

  override CreateNewAffineMask(id: number, number: number, pMask: AFFINEMASK): BackgroundPointer | null {
    const idx = this.BackgroundGraphicExists(id, 0, false);
    if (idx >= 0) {
      const section = this['backgroundGraphics'][idx]!.data!;
      const count = readU32LE(section, 0);
      const offsets = Array.from({ length: count }, (_, i) => readU32LE(section, 4 * (i + 1)));
      if (count + 1 < number + 1 && offsets.some((offset) => offset !== 0)) this.shortMoves++;
    }
    const p = super.CreateNewAffineMask(id, number, pMask);
    if (p !== null) {
      this.affineMasks++;
      this.once(`mask ${id}/${number}`);
    }
    return p;
  }

  override CreateVirtualMask(pOldMask: BackgroundPointer, pNewMask: BackgroundPointer, pAffine: AFFINEMASK): void {
    super.CreateVirtualMask(pOldMask, pNewMask, pAffine);
    this.masks++;
    const field = (m: BackgroundPointer, i: number): number => readU16LE(m.data, m.offset + 2 * i);
    const am: AFFINEMASK = {
      ...pAffine, srcX: 0, srcY: 0, srcWidth: field(pOldMask, 4), srcHeight: field(pOldMask, 5),
      dstWidth: field(pNewMask, 4), dstHeight: field(pNewMask, 5),
    };
    for (let row = 0; row < am.dstHeight; row++) {
      for (let col = 0; col < am.dstWidth; col++) {
        const [x, y] = source(am, col, row);
        if (y >= am.srcHeight || x >= am.srcWidth) this.outside++;
        if (pixel1(pNewMask, col, row) !== pixel1(pOldMask, x, y)) {
          this.bad.push(`mask at ${pNewMask.offset} (${col}, ${row})`);
          return;
        }
      }
    }
  }

  private once(key: string): void {
    if (this.made.has(key)) this.madeTwice++;
    this.made.add(key);
  }
}

function views(): void {
  console.log('3. Views, the starting level');
  for (const set of SETS) {
    const base = `tools/fixtures/gamefiles/${set.dir}`;
    const data = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(`${base}/dungeon.dat`)));
    const graphics = new GraphicsLoader();
    graphics.loadFromArray(new Uint8Array(readFileSync(`${base}/graphics.dat`)));
    const csb = new CSBGraphicsLoader();
    csb.loadFromArray(new Uint8Array(readFileSync(`${base}/CSBgraphics.dat`)));
    const game = newGame(data, graphics);
    const tables = graphicsTablesOf(graphics);
    const graphicCache = new Map<string, IndexedBitmap>();
    const renderer = new ViewportRenderer({
      graphicsLoader: graphics,
      dungeonState: game.ctx.dungeon,
      viewportTables: tables.viewport,
      objectTables: tables.objects,
      palette552: tables.ui.graphic232.palette552,
      graphicCache,
      getGraphicBitmap: (graphicNum) => getCachedGraphicBitmap(graphics, graphicCache, graphicNum),
      csbGraphicsLoader: csb,
    });
    const lib = new CheckedLib(csb);
    lib.messageBox = (line) => lib.messages.push(line);
    renderer.context.backgroundLib = lib;
    const virtualDraws = new Set<string>();
    renderer.context.graphicTrace = (line) => {
      const m = /DrawCustomGraphic\((-?\d+), (-?\d+), (-?\d+)\)/.exec(line);
      if (m === null) return;
      const [graphicID, maskID, maskNumber] = [m[1]!, m[2]!, m[3]!].map(Number) as [number, number, number];
      if (lib.made.has(`bitmap ${graphicID >>> 0}`) && lib.made.has(`mask ${maskID >>> 0}/${maskNumber >>> 0}`)
        && lib.GetBitmap(graphicID >>> 0, 2) !== null && lib.GetMask(maskID >>> 0, maskNumber >>> 0, 12) !== null) {
        virtualDraws.add(`${graphicID}/${maskID}/${maskNumber}`);
      }
    };

    const start = game.ctx.party.state.position;
    const { width, height } = data.maps[start.z]!.descriptor;
    renderer.selectLevel(start.z);
    const pass = (): void => {
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          for (let facing = 0; facing < 4; facing++) renderer.draw(new Position(x, y, start.z), facing, false, false);
        }
      }
    };
    pass();
    const first = lib.made.size;
    pass();
    console.log(`  ${set.name}: ${lib.bitmaps} virtual bitmaps, ${lib.masks} virtual masks, ${lib.affineMasks} affine masks made;`
      + ` ${virtualDraws.size} draws of a virtual bitmap through a virtual mask`);
    check(lib.bitmaps > 0 && lib.masks > 0 && lib.affineMasks > 0, `${set.name}: the programs make all three`);
    check(lib.bad.length === 0, `${set.name}: each is the transform of its source (${lib.bad.slice(0, 3).join('; ')})`);
    check(lib.outside === 0, `${set.name}: no pixel is read past its source (${lib.outside})`);
    check(lib.madeTwice === 0 && lib.made.size === first, `${set.name}: each is made once, and the second pass makes none`);
    check(lib.messages.length === 0, `${set.name}: no "Design Error" (${lib.messages.join('; ')})`);
    check(lib.shortMoves === 0, `${set.name}: no transform grows a section's index by more than one past offsets it holds (${lib.shortMoves})`);
    check(virtualDraws.size > 0, `${set.name}: a program draws a virtual bitmap through a virtual mask`);
  }
}

transforms();
maskIndex();
views();
finish();
