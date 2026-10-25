/**
 * The wall and floor decorations of a `CSBgraphics.dat` (`getWallDecoration` and
 * `getFloorDecoration`, `src/data/CSBGraphicsLoader.ts`), as `DrawWallDecoration` and
 * `DrawFloorDecorations` read them: their bitmaps are Atari bitplanes, drawn through the
 * same `ShrinkBLT` and `TAG0088b2` as a `graphics.dat` graphic (`pExtendedBitmap`,
 * `doc/CSBwin-src/CSBCode.cpp:3263-3267`, `:3383-3392`; `pGraphic`, `:3898`).
 *
 * 1. **The layout.** In every section of both files here, the tools fixture and Conflux
 *    3.5's, each source descriptor's `width` is whole groups of 16 pixels, and is its
 *    rectangle's width taken to a group, in bytes: the side and front views, `desc[11]`
 *    and `desc[12]`, `desc[10]` as wide and as high as `desc[11]` (it sizes the left side
 *    view, `:3443-3459`), and a floor's `desc[7]`. So the bitmaps' rows are the strides
 *    CSBWin reads them at, and the port's crop and scale widths are CSBWin's. The section
 *    holds its descriptors and both bitmaps.
 * 2. **The decode.** Each bitmap the loader gives is the section's bytes read as
 *    bitplanes (`decodePlanar`), at their offsets: past the 13 descriptors and two bytes
 *    for a wall, the side view then the front; past the 9 and `mirrorFlags` for a floor.
 *    The canary: read as packed nibbles, high nibble first, every bitmap is noise in
 *    vertical bands. Its share of pixels equal to their right neighbour, which a picture
 *    keeps high, is lower than the bitplanes' in every bitmap of both files.
 * 3. **The right side views.** Positions 1, 6 and 11 draw the side view mirrored into
 *    rectangles that mirror those of 0, 5 and 10 about the viewport's centre, from source
 *    descriptors of one size. So each of Conflux's wall decorations, drawn alone through
 *    `DrawWallDecoration`, is at the right the mirror image of itself at the left, pixel
 *    for pixel. CSBWin mirrors a scaled one in a buffer of whole groups and starts its
 *    blit `15 - (finalBitmapWidth & 15)` pixels in, past the padding the mirror moved to
 *    the left (`doc/CSBwin-src/CSBCode.cpp:3597-3604`); the port mirrors the bitmap at its
 *    width, so it starts at 0, as for a basic decoration (`DEBT.md` H → "The mirrored
 *    far-right sidewalls' `srcOffsetX`").
 *
 * `tools/frames/20-conflux-bookshelf.png` shows two in a view: Conflux's wall decoration
 * 5, a bookshelf, as it stands at F1, and 11, a ladder, scaled at F2.
 *
 * Run: `npm test -- --only=extended-decorations.ts`
 */
import { readFileSync } from 'node:fs';

import { CSBGraphicsLoader, CSBGraphicType, decodePlanar, type IndexedBitmap } from '../../src/data/CSBGraphicsLoader';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { DrawWallDecoration } from '../../src/renderer/bytecode/DrawDecorations';
import { ViewportDraw } from '../../src/renderer/bytecode/ViewportDraw';
import { getCachedGraphicBitmap } from '../../src/renderer/ViewportGraphics';
import { ViewportRenderer } from '../../src/renderer/ViewportRenderer';
import { check, finish } from '../lib/check';
import { graphicsTablesOf, newGame } from '../lib/game';

const FILES = [
  { name: 'tools fixture', path: 'tools/fixtures/gamefiles/csbgraphics/CSBgraphics.dat' },
  { name: 'Conflux 3.5', path: 'tools/fixtures/gamefiles/conflux-3.5-b8/CSBgraphics.dat' },
];
/** Two pictures to print: a bookshelf and a breaking wave. */
const SHOWN = new Set(['wall 5', 'floor 61']);

/** The share of pixels equal to their right neighbour. */
function coherence(pixels: Uint8Array, width: number, height: number): number {
  let same = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x + 1 < width; x++) if (pixels[y * width + x] === pixels[y * width + x + 1]) same++;
  }
  return same / (height * (width - 1));
}

/** The foil: bytes read as two pixels each, high nibble first. */
function nibbles(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i += 2) {
    const b = data[i >> 1] ?? 0;
    out[i] = b >> 4;
    out[i + 1] = b & 15;
  }
  return out;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

for (const file of FILES) {
  const csb = new CSBGraphicsLoader();
  csb.loadFromArray(new Uint8Array(readFileSync(file.path)));
  console.log(`${file.name}: ${file.path}`);

  let layoutOk = true;
  let decodeOk = true;
  let canaryOk = true;
  let margin = 1;
  let bitmaps = 0;
  const counts = { wall: 0, floor: 0 };

  const examine = (what: string, raw: Uint8Array, offset: number, bitmap: IndexedBitmap): void => {
    bitmaps++;
    const { width, height } = bitmap;
    const bytes = raw.subarray(offset, offset + (width >> 1) * height);
    if (!sameBytes(bitmap.pixels, decodePlanar(bytes, width, height))) {
      decodeOk = false;
      console.log(`  ${what}: not the section's bytes read as bitplanes`);
    }
    const planar = coherence(bitmap.pixels, width, height);
    const packed = coherence(nibbles(bytes, width, height), width, height);
    margin = Math.min(margin, planar - packed);
    if (planar <= packed) {
      canaryOk = false;
      console.log(`  ${what}: ${planar.toFixed(2)} as bitplanes, ${packed.toFixed(2)} as nibbles`);
    }
    if (SHOWN.has(what.replace(/ \w+ view$/, ''))) {
      console.log(`  ${what} ${width}x${height}: neighbours alike ${planar.toFixed(2)} as bitplanes, ${packed.toFixed(2)} as nibbles`);
    }
  };
  /** `width` is whole groups, and the rectangle's width taken to a group. */
  const sized = (r: { x1: number; x2: number; widthBytes: number }): boolean =>
    r.widthBytes % 8 === 0 && ((r.x2 - r.x1 + 1 + 15) & ~15) >> 1 === r.widthBytes;

  for (let id = 0; ; id++) {
    const raw = csb.readSection(CSBGraphicType.WallDecoration, id, 0, false);
    if (!raw) break;
    counts.wall++;
    const wall = csb.getWallDecoration(id);
    const [left, side, front] = [wall?.desc[10], wall?.desc[11], wall?.desc[12]];
    if (!wall || !left || !side || !front) {
      layoutOk = false;
      console.log(`  wall ${id}: does not read`);
      continue;
    }
    const sideBytes = side.widthBytes * side.height;
    if (!sized(side) || !sized(front) || left.widthBytes !== side.widthBytes || left.height !== side.height
      || raw.length < 80 + sideBytes + front.widthBytes * front.height) {
      layoutOk = false;
      console.log(`  wall ${id}: descriptors 10-12 ${[left, side, front].map((r) => `${r.x1}-${r.x2} ${r.widthBytes}x${r.height}`).join(', ')}, ${raw.length} bytes`);
    }
    examine(`wall ${id} side view`, raw, 80, wall.sideBitmap);
    examine(`wall ${id} front view`, raw, 80 + sideBytes, wall.frontBitmap);
  }
  for (let id = 0; ; id++) {
    const raw = csb.readSection(CSBGraphicType.FloorDecoration, id, 0, false);
    if (!raw) break;
    counts.floor++;
    const floor = csb.getFloorDecoration(id);
    const base = floor?.desc[7];
    if (!floor || !base) {
      layoutOk = false;
      console.log(`  floor ${id}: does not read`);
      continue;
    }
    if (!sized(base) || raw.length < 56 + base.widthBytes * base.height) {
      layoutOk = false;
      console.log(`  floor ${id}: descriptor 7 ${base.x1}-${base.x2} ${base.widthBytes}x${base.height}, ${raw.length} bytes`);
    }
    examine(`floor ${id}`, raw, 56, floor.bitmap);
  }

  console.log(`  ${counts.wall} wall and ${counts.floor} floor decorations, ${bitmaps} bitmaps;`
    + ` bitplanes ahead of nibbles by ${margin.toFixed(2)} at least`);
  check(counts.wall > 0 && counts.floor > 0, `${file.name}: has wall and floor decorations`);
  check(layoutOk, `${file.name}: every source descriptor is whole groups, its rectangle's width, and the section holds its bitmaps`);
  check(decodeOk, `${file.name}: every bitmap is its section's bytes read as bitplanes`);
  check(canaryOk, `${file.name}: read as nibbles, every bitmap is less like a picture than read as bitplanes`);
}

// 3. The right side views, in Conflux 3.5.
{
  const BASE = 'tools/fixtures/gamefiles/conflux-3.5-b8';
  const read = (name: string): Uint8Array => new Uint8Array(readFileSync(`${BASE}/${name}`));
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(read('graphics.dat'));
  const game = newGame(new DungeonLoader().loadDungeonDat(read('dungeon.dat')), graphics);
  const csb = new CSBGraphicsLoader();
  csb.loadFromArray(read('CSBgraphics.dat'));
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
  const viewport: IndexedBitmap = { width: 224, height: 136, pixels: new Uint8Array(224 * 136) };
  renderer.context.viewportIndexBuffer = viewport;
  const draw = new ViewportDraw(renderer.context);
  /** Decoration `id` drawn alone at `position`, over colour 0. */
  const drawn = (id: number, position: number): Uint8Array => {
    viewport.pixels.fill(0);
    DrawWallDecoration(draw, 0x10000 | id, position, 0, null);
    return viewport.pixels.slice();
  };
  const mirrored = (pixels: Uint8Array): Uint8Array => {
    const out = new Uint8Array(pixels.length);
    for (let y = 0; y < 136; y++) for (let x = 0; x < 224; x++) out[y * 224 + 223 - x] = pixels[y * 224 + x]!;
    return out;
  };

  const PAIRS = [[0, 1], [5, 6], [10, 11]] as const;
  let pairs = 0;
  let unpadded = 0;
  const wrong: string[] = [];
  let symmetric = true;
  for (let id = 0; ; id++) {
    const wall = csb.getWallDecoration(id);
    if (!wall) break;
    for (const [left, right] of PAIRS) {
      const l = wall.desc[left]!;
      const r = wall.desc[right]!;
      if (l.x1 + r.x2 !== 223 || l.x2 + r.x1 !== 223 || l.y1 !== r.y1 || l.y2 !== r.y2 || l.height !== r.height) {
        symmetric = false;
        console.log(`  wall ${id}: positions ${left} and ${right} are not mirror rectangles`);
        continue;
      }
      pairs++;
      if (right < 10 && ((r.x2 - r.x1) & 15) !== 15) unpadded++;
      if (!sameBytes(drawn(id, right), mirrored(drawn(id, left)))) wrong.push(`${id} at ${right}`);
    }
  }
  console.log(`Conflux 3.5: ${pairs} pairs of side views, ${unpadded} of them scaled to a width that is not whole groups`);
  if (wrong.length) console.log(`  not the mirror of the left: ${wrong.join(', ')}`);
  check(symmetric && pairs > 0, 'Conflux 3.5: positions 1, 6 and 11 are the mirror rectangles of 0, 5 and 10');
  check(unpadded > 0, 'Conflux 3.5: some side view is scaled to a width that is not whole groups');
  check(wrong.length === 0, 'Conflux 3.5: every wall decoration at the right is the mirror image of itself at the left');
}

finish();
