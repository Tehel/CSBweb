/**
 * Which random stream a cloud's mirror and flip come from, in which order, and where the
 * mirrored bitmap is read from when the cloud is clipped at the viewport's left edge.
 *
 * CSBWin's `DrawClouds` (`doc/CSBwin-src/Code51a4.cpp:257-313`, label `tag006932`):
 *
 *     w_142    = STRandomBool() != 0;          // vertical flip (TAG008840)
 *     LOCAL_30 = 0;
 *     LOCAL_36 = STRandomBool() != 0;          // mirror
 *     if (LOCAL_36) LOCAL_30 = 2 * (7 - ((LOCAL_22-1)&7));
 *     y2 = Smaller(135, y + LOCAL_24/2);
 *     y1 = Larger(0, y - LOCAL_24/2 + (LOCAL_24 even ? 1 : 0));   // skipped if >= 136
 *     x2 = Smaller(223, x + LOCAL_22);                            // skipped if < 0
 *     x1 = ApplyLimits(0, x - LOCAL_22 + 1, 223);
 *     srcX = x1 != 0 ? LOCAL_30 : Larger(LOCAL_30, LOCAL_22 - x - 1);
 *
 * `STRandomBool()` inside `DrawViewport` reads the viewport's own stream
 * (`Viewport.cpp:6706-6707`), seeded once with `0x34175432` (`:6697`), not `GraphicRandom`, which only `DrawTeleporter` calls.
 * The port used to roll `graphicRandom(2)` twice, mirror first — the wrong stream,
 * the wrong bit (`>> 7` instead of `>> 8`) and the flags swapped.
 *
 * `LOCAL_30` is the row padding: CSBWin's bitmap rows are padded to 16 pixels, and
 * `Mirror` moves the padding to the left. The port's bitmaps are unpadded, so the port
 * reads at `srcX - LOCAL_30`, which is `max(0, clip - LOCAL_30)` when mirrored: a
 * mirrored cloud at the left edge is clipped by less than its overhang, as in CSBWin.
 *
 * Then the rest of `DrawClouds` (C14), against the real tables and a synthetic graphic
 * of each real graphic's size:
 *
 *  4. the scale: `Larger(4, Byte5758[cell/3] * Larger(48, value+1) >> 8) & 0xfffe`
 *     (`:251-254`), clamped to 32 as a *scale* in `TAG005088` (`:29`) — a full-size cloud
 *     is the whole graphic, and a value-0 cloud is small, not full size;
 *  5. `TAG005088`'s source graphic `348 + Smaller(type, 2)` and colour map — identity
 *     for types 0-2, `d.Byte5712` for type 3 (poison), always (`:39-66`);
 *  6. lightning (type 100): size *and position* from `d.Word7246`, which runs on into
 *     `d.Word7222` for cells 7-9, shrunk through the identity map (`:139-170`);
 *  7. the cell under the party (`RelativeCellNumber == 12`, `:178-218`): graphic
 *     `351 + 3·D4W + (value>>5 != 0) + (value>>5 > 3)`, tiled over `d.Word2530` by
 *     `TAG008c98` (`Graphics.cpp:1169`) from group `STRandom() & 63`, wrapping at
 *     `STRandom0_3() + 87`.
 *  8. a Fluxcage (type 50): no cloud, but the teleporter's shimmer over its cell from cell 4
 *     on, which `d.Word1868` takes away (`Code51a4.cpp:2769-2782`).
 *  9. an alcove's clouds.
 * 10. the cells around the ten that hold objects: the row four ahead (`RelativeCellNumber`
 *     0-2) and the two beside the party (13, 14), whose clouds `DrawRoomObjects` draws
 *     too (`:2768-2773`) — from the tables, and in whole frames of the real dungeon.
 *
 * Run: `npx tsx tools/dump-cloud-draw.ts`
 */
import { readFileSync } from 'node:fs';

import { DBType, OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../src/core/types';
import { applyLimits } from '../src/core/intCast';
import { CsbRandom } from '../src/core/random';
import { RN_POISON_CLOUD } from '../src/core/spellRn';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { DrawTeleporter, graphicRandomState } from '../src/renderer/bytecode/DrawDoor';
import { DrawClouds, DrawRoomObjects } from '../src/renderer/bytecode/DrawRoomObjects';
import { ViewportDraw, viewportRandom } from '../src/renderer/bytecode/ViewportDraw';
import { createPaletteIndexViewportBuffer, shrinkBlt, type IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { ViewportRenderer } from '../src/renderer/ViewportRenderer';
import { check, finish } from './lib/check';
import { graphicsTablesOf, newGame } from './lib/game';
import { RnMaps } from '../src/core/RnMaps';

const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync('static/gamefiles/dm-atari/graphics.dat')));
const viewportTables = graphicsTablesOf(graphics).viewport;
const realTables = graphicsTablesOf(graphics).objects;

// The test sizes its own cloud: d.Byte5696[0..1] (half-width, height) = 5, 12, and
// d.Byte5758[1] = 171, which makes CSBWin's scale `171 * Larger(48, value+1) >> 8`
// exactly 32 at value 0 — the unscaled graphic, drawn as is. A half-width of 5 gives a
// row padding (LOCAL_30) of 6 when mirrored, and an even height exercises the +1 on y1.
// Every pixel is neither 0 (the cleared viewport) nor 10 (transparent), and the
// pattern has no symmetry, so a mirror or a flip always shows.
const cloudScaleBase = new Uint8Array(realTables.cloudScaleBase);
cloudScaleBase[0] = 5;
cloudScaleBase[1] = 12;
const cloudScale = new Uint8Array(realTables.cloudScale);
cloudScale[1] = 171;
const bw = cloudScaleBase[0] * 2;
const bh = cloudScaleBase[1];
const cloudBitmap = {
  width: bw,
  height: bh,
  pixels: new Uint8Array(bw * bh).map((_, i) => {
    const x = i % bw;
    const y = Math.floor(i / bw);
    const v = 1 + ((x * 7 + y * 13 + x * y) % 14);
    return v >= 10 ? v + 1 : v;
  }),
};

// relativeCellNumber 0 → CSBWin's RelativeCellNumber 3. `bit7` selects d.Word7042,
// overridden here so the test places the cloud where it wants.
const RELATIVE_CELL = 0;
const REL_CELL = RELATIVE_CELL + 3;
const cloudRn = ((DBType.CLOUD << 10) | 0) as ObjectID;
const cloud = { nextObject: OBJECT_ID_EOF, value: 0, cloudType: 0, bit7: true };

interface Drawn { x1: number; y1: number; x2: number; y2: number; rows: number[][] }

function drawCloudAt(px: number, py: number, viewportSeed: number): Drawn {
  const cloudPositions7042 = new Int16Array(realTables.cloudPositions7042);
  cloudPositions7042[REL_CELL * 2] = px;
  cloudPositions7042[REL_CELL * 2 + 1] = py;
  const viewportIndexBuffer = createPaletteIndexViewportBuffer(224, 136, 0);
  const context: any = {
    viewportIndexBuffer,
    objectTables: { ...realTables, cloudPositions7042, cloudScaleBase, cloudScale },
    getGraphicBitmap: () => cloudBitmap,
    dungeonState: {
      rnMaps: new RnMaps(),
      getDBRecordLink: () => OBJECT_ID_EOF,
      getCloudRecord: () => cloud,
    },
  };
  viewportRandom.setSeed(viewportSeed);
  DrawClouds(new ViewportDraw(context), RELATIVE_CELL, cloudRn, 0, 0);

  const { width, pixels } = viewportIndexBuffer;
  let x1 = 999, y1 = 999, x2 = -1, y2 = -1;
  for (let y = 0; y < 136; y++) {
    for (let x = 0; x < 224; x++) {
      if (pixels[y * width + x] === 0) continue;
      x1 = Math.min(x1, x); x2 = Math.max(x2, x);
      y1 = Math.min(y1, y); y2 = Math.max(y2, y);
    }
  }
  const rows: number[][] = [];
  for (let y = y1; y <= y2; y++) rows.push(Array.from(pixels.slice(y * width + x1, y * width + x2 + 1)));
  return { x1, y1, x2, y2, rows };
}

/** The two viewport-stream draws CSBWin makes for this cloud: [flip, mirror]. */
function predicted(seed: number): { flip: boolean; mirror: boolean } {
  const r = new CsbRandom(seed);
  const flip = r.bool() !== 0;
  const mirror = r.bool() !== 0;
  return { flip, mirror };
}

const same = (a: number[][], b: number[][]) => JSON.stringify(a) === JSON.stringify(b);
const mirrored = (rows: number[][]) => rows.map((r) => [...r].reverse());
const flipped = (rows: number[][]) => [...rows].reverse();

// 0. The stream's seed is CSBWin's static initialiser, not a host random value.
check(viewportRandom.getSeed() === 0x34175432,
  'viewportRandom starts at 0x34175432 (Viewport.cpp:6697)');

// 1. The stream. Two draws from the viewport's own stream, none from GraphicRandom.
{
  const seed = 0x1234567;
  const graphicRandomBefore = graphicRandomState.r;
  drawCloudAt(100, 60, seed);
  const oracle = new CsbRandom(seed);
  oracle.bool();
  oracle.bool();
  check(viewportRandom.getSeed() === oracle.getSeed(),
    'one cloud consumes exactly two STRandomBool() draws from the viewport stream');
  check(graphicRandomState.r === graphicRandomBefore,
    'a cloud draws nothing from GraphicRandom (only DrawTeleporter calls it)');
}

// 2. The order: the first draw flips, the second mirrors.
const seedFor = (flip: boolean, mirror: boolean): number => {
  for (let s = 1; ; s++) {
    const p = predicted(s);
    if (p.flip === flip && p.mirror === mirror) return s;
  }
};
const px = 100;
const py = 60;
const plain = drawCloudAt(px, py, seedFor(false, false));
check(!same(plain.rows, mirrored(plain.rows)) && !same(plain.rows, flipped(plain.rows)),
  'the test bitmap is asymmetric both ways, so a mirror or a flip is visible');
const halfWidth = (plain.x2 - plain.x1 + 1) >> 1; // LOCAL_22
const height = plain.y2 - plain.y1 + 1; // LOCAL_24
console.log(`drawn at (${px},${py}): x ${plain.x1}..${plain.x2}, y ${plain.y1}..${plain.y2}  (LOCAL_22=${halfWidth}, LOCAL_24=${height})`);
check(plain.x1 === px - halfWidth + 1 && plain.x2 === px + halfWidth, 'x1 = x - LOCAL_22 + 1, x2 = x + LOCAL_22');
check(plain.y1 === py - (height >> 1) + ((height & 1) === 0 ? 1 : 0) && plain.y2 === py + (height >> 1),
  'y1 = y - LOCAL_24/2 (+1 when LOCAL_24 is even), y2 = y + LOCAL_24/2');
check(height === bh, 'the cloud is drawn exactly LOCAL_24 rows tall');

for (const [flip, mirror] of [[true, false], [false, true], [true, true]] as const) {
  const d = drawCloudAt(px, py, seedFor(flip, mirror));
  let expected = plain.rows;
  if (mirror) expected = mirrored(expected);
  if (flip) expected = flipped(expected);
  check(same(d.rows, expected), `first STRandomBool ${flip ? 1 : 0} → ${flip ? '' : 'no '}flip, second ${mirror ? 1 : 0} → ${mirror ? '' : 'no '}mirror`);
}

// 3. Clipped at the left edge: srcX = max(LOCAL_30, LOCAL_22 - x - 1), in padded columns.
const clipX = 1;
const clip = halfWidth - clipX - 1;
const pad = 2 * (7 - ((halfWidth - 1) & 7));
for (const mirror of [false, true]) {
  const d = drawCloudAt(clipX, py, seedFor(false, mirror));
  const reference = mirror ? mirrored(plain.rows) : plain.rows;
  const srcX = mirror ? Math.max(0, clip - pad) : clip; // unpadded
  const expected = reference.map((r) => r.slice(srcX, srcX + (d.x2 - d.x1 + 1)));
  console.log(`clipped at x=${clipX}, ${mirror ? 'mirrored' : 'plain'}: overhang ${clip}, LOCAL_30 ${mirror ? pad : 0}, drawn x ${d.x1}..${d.x2}, read from column ${srcX}`);
  check(d.x1 === 0 && d.x2 === clipX + halfWidth, `a ${mirror ? 'mirrored' : 'plain'} cloud clipped at the left spans x 0..x+LOCAL_22`);
  check(same(d.rows, expected), `a ${mirror ? 'mirrored' : 'plain'} cloud clipped at the left reads from column ${mirror ? 'max(LOCAL_30, overhang) - LOCAL_30' : 'overhang'}`);
}

// ---------------------------------------------------------------------------------------
// 4-7. The rest of DrawClouds, against the real tables.

const IDENTITY = new Uint8Array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]);
const lightningDesc = realTables.missileGraphics[3]; // GetGraphicClass(RNLightning) = -4
const LIGHTNING_GRAPHIC = (lightningDesc.uByte0 & 0xff) + 317;

// Canary: the tables sit at the right offsets if they describe the real graphics' sizes.
for (let t = 0; t < 3; t++) {
  const img = graphics.getImage(348 + t);
  check(img.width === 2 * realTables.cloudScaleBase[2 * t] && img.height === realTables.cloudScaleBase[2 * t + 1],
    `graphic ${348 + t} is 2·Byte5696[${2 * t}] × Byte5696[${2 * t + 1}] (${img.width}×${img.height})`);
}
check(realTables.cloudScaleBase[6] === realTables.cloudScaleBase[4] && realTables.cloudScaleBase[7] === realTables.cloudScaleBase[5],
  "type 3's Byte5696 entry is type 2's: poison borrows graphic 350");
for (let n = 351; n <= 359; n++) {
  const img = graphics.getImage(n);
  // CSBWin asks for 48×32 and pads the missing row: "This error occurs in the standard
  // Graphic.dat" (Graphics.cpp:2560). The tiling never reads it (see 7).
  check(img.width === 48 && img.height === 31, `graphic ${n} is 48×31 (${img.width}×${img.height})`);
}
{
  const img = graphics.getImage(LIGHTNING_GRAPHIC);
  check(img.width === 2 * lightningDesc.widthBytes && img.height === lightningDesc.height,
    `lightning graphic ${LIGHTNING_GRAPHIC} is 2·${lightningDesc.widthBytes} × ${lightningDesc.height}`);
}
check(realTables.cloudPositions7246.length === 21
  && [9, 10, 11, 12, 13, 14, 15, 16, 17].every((i) => realTables.cloudPositions7246[12 + i - 9] === realTables.cloudPositions7222[i - 9]),
  'Word7246 read as 21 words runs on into Word7222 (7246 - 2·12 = 7222)');
const rawItem = graphics.getRawGraphic(0x22e);
const w2530 = realTables.cloudUnderPartyRect;
check(rawItem.length === 0x1270 && [w2530.x1, w2530.x2, w2530.y1, w2530.y2].join() === Array.from(rawItem.slice(-4)).join(),
  `Word2530 is the last 4 bytes of graphic 0x22e: x ${w2530.x1}..${w2530.x2}, y ${w2530.y1}..${w2530.y2}`);

const patternFor = (id: number, w: number, h: number) => ({
  width: w,
  height: h,
  pixels: new Uint8Array(w * h).map((_, i) => {
    const v = 1 + (((i % w) * 7 + Math.floor(i / w) * 13 + (i % w) * Math.floor(i / w) + id * 5) % 14);
    return v >= 10 ? v + 1 : v; // never 0 (the cleared viewport) nor 10 (transparent)
  }),
});
const graphicCache = new Map<number, { width: number; height: number; pixels: Uint8Array }>();
function fakeGraphic(id: number) {
  let b = graphicCache.get(id);
  if (!b) {
    const img = graphics.getImage(id);
    b = patternFor(id, img.width, img.height);
    graphicCache.set(id, b);
  }
  return b;
}
const shrink = (src: any, w: number, h: number, map: Uint8Array) => shrinkBlt(src, src.width, src.height, w, h, map);

interface Scene {
  relCell: number; // CSBWin's RelativeCellNumber
  cloudType: number;
  value: number;
  place?: [number, number]; // overrides d.Word7042[relCell]
  seed?: number;
}
interface SceneResult { requested: number[]; pixels: Uint8Array; width: number; drawn: Drawn | null; seedAfter: number }
function drawScene(sc: Scene): SceneResult {
  const cloudPositions7042 = new Int16Array(realTables.cloudPositions7042);
  if (sc.place) {
    cloudPositions7042[sc.relCell * 2] = sc.place[0];
    cloudPositions7042[sc.relCell * 2 + 1] = sc.place[1];
  }
  const viewportIndexBuffer = createPaletteIndexViewportBuffer(224, 136, 0);
  const requested: number[] = [];
  const rec = { nextObject: OBJECT_ID_EOF, value: sc.value, cloudType: sc.cloudType, bit7: true };
  const context: any = {
    viewportIndexBuffer,
    objectTables: { ...realTables, cloudPositions7042 },
    getGraphicBitmap: (n: number) => { requested.push(n); return fakeGraphic(n); },
    dungeonState: { rnMaps: new RnMaps(), getDBRecordLink: () => OBJECT_ID_EOF, getCloudRecord: () => rec },
  };
  viewportRandom.setSeed(sc.seed ?? seedFor(false, false));
  DrawClouds(new ViewportDraw(context), sc.relCell - 3, cloudRn, 0, 0);
  const { width, pixels } = viewportIndexBuffer;
  let x1 = 999, y1 = 999, x2 = -1, y2 = -1;
  for (let y = 0; y < 136; y++) {
    for (let x = 0; x < 224; x++) {
      if (pixels[y * width + x] === 0) continue;
      x1 = Math.min(x1, x); x2 = Math.max(x2, x);
      y1 = Math.min(y1, y); y2 = Math.max(y2, y);
    }
  }
  const rows: number[][] = [];
  for (let y = y1; y <= y2; y++) rows.push(Array.from(pixels.slice(y * width + x1, y * width + x2 + 1)));
  return {
    requested, pixels, width,
    drawn: x2 < 0 ? null : { x1, y1, x2, y2, rows },
    seedAfter: viewportRandom.getSeed(),
  };
}
const toRows = (b: { width: number; height: number; pixels: Uint8Array }) =>
  Array.from({ length: b.height }, (_, y) => Array.from(b.pixels.slice(y * b.width, (y + 1) * b.width)));

/** tag006932's rectangle for a cloud at (px, py), unclipped. */
const expectedRect = (px: number, py: number, hw: number, h: number) => ({
  x1: applyLimits(0, px - hw + 1, 223), x2: Math.min(223, px + hw),
  y1: Math.max(0, py - (h >> 1) + ((h & 1) === 0 ? 1 : 0)), y2: Math.min(135, py + (h >> 1)),
});
const sameRect = (d: Drawn | null, r: { x1: number; y1: number; x2: number; y2: number }) =>
  !!d && d.x1 === r.x1 && d.x2 === r.x2 && d.y1 === r.y1 && d.y2 === r.y2;

// 4 + 5. The scale, the size, the source graphic and the colour map. Centred at (112, 68)
// so that even the full-size graphic (160×111) is not clipped.
console.log('\nscale (Code51a4.cpp:251-254) and TAG005088 (:21-74):');
for (const [relCell, cloudType, value] of [[9, 0, 255], [7, 0, 255], [3, 0, 0], [6, 3, 90], [6, 40, 255], [9, 40, 255]]) {
  const type = cloudType === 40 ? 3 : cloudType === 0 ? 0 : 1;
  const scaleIn = Math.max(4, (realTables.cloudScale[Math.floor(relCell / 3)] * Math.max(48, value + 1)) >> 8) & 0xfffe;
  const p2 = Math.min(32, scaleIn);
  const hw = Math.trunc((p2 * realTables.cloudScaleBase[2 * type] + Math.trunc(p2 / 2)) / 32);
  const h = Math.trunc((p2 * realTables.cloudScaleBase[2 * type + 1] + Math.trunc(p2 / 2)) / 32);
  const graphic = 348 + Math.min(type, 2);
  const full = p2 === 32 && type !== 3;
  const expected = full
    ? fakeGraphic(graphic)
    : shrink(fakeGraphic(graphic), 2 * hw, h, type === 3 ? realTables.cloudColorMap : IDENTITY);
  const r = drawScene({ relCell, cloudType, value, place: [112, 68] });
  const what = `cell ${relCell}, type ${cloudType}, value ${value}: scale ${scaleIn}, ${2 * hw}×${h} from graphic ${graphic}` +
    (full ? ' as is' : ` through ${type === 3 ? 'Byte5712' : 'the identity map'}`);
  console.log(`  ${what}; drawn ${r.drawn ? `${r.drawn.x2 - r.drawn.x1 + 1}×${r.drawn.y2 - r.drawn.y1 + 1}` : 'nothing'}`);
  check(r.requested.includes(graphic) && r.requested.every((n) => n >= 348 && n <= 350), `${what}: reads graphic ${graphic} only`);
  check(sameRect(r.drawn, expectedRect(112, 68, hw, h)), `${what}: drawn at the size TAG005088 gives`);
  check(!!r.drawn && same(r.drawn.rows, toRows(expected)), `${what}: pixel for pixel`);
}

// 6. Lightning: from d.Word7246 — position too — for every cell 3..9, identity map.
console.log('\nlightning (Code51a4.cpp:139-170):');
for (let relCell = 3; relCell <= 9; relCell++) {
  const pw = 3 * (relCell - 3);
  const [px, py, scale] = [0, 1, 2].map((i) => realTables.cloudPositions7246[pw + i]);
  const hw = (lightningDesc.widthBytes * scale + (scale >> 1)) >> 5;
  const h = (lightningDesc.height * scale + (scale >> 1)) >> 5;
  const src = fakeGraphic(LIGHTNING_GRAPHIC);
  const expected = relCell === 9 ? src : shrink(src, 2 * hw, h, IDENTITY);
  const rect = expectedRect(px, py, hw, h);
  // Word7042 moved out of the way, so a cloud placed from it would show elsewhere.
  const r = drawScene({ relCell, cloudType: 100, value: 0, place: [5, 5] });
  const what = `cell ${relCell}: Word7246 (${px}, ${py}, ${scale}) → x ${rect.x1}..${rect.x2}, y ${rect.y1}..${rect.y2}`;
  console.log(`  ${what}; drawn ${r.drawn ? `x ${r.drawn.x1}..${r.drawn.x2}, y ${r.drawn.y1}..${r.drawn.y2}` : 'nothing'}`);
  check(sameRect(r.drawn, rect), `lightning ${what}`);
  const srcX = rect.x1 !== 0 ? 0 : Math.max(0, hw - px - 1);
  const cropped = toRows(expected).slice(0, rect.y2 - rect.y1 + 1).map((row) => row.slice(srcX, srcX + rect.x2 - rect.x1 + 1));
  check(!!r.drawn && same(r.drawn.rows, cropped), `lightning at cell ${relCell}: graphic ${LIGHTNING_GRAPHIC}${relCell === 9 ? ' as is' : ' through the identity map'}`);
}

// 7. The cell under the party.
console.log('\nthe cell under the party (Code51a4.cpp:178-218, TAG008c98):');
const rect = realTables.cloudUnderPartyRect;
for (const [cloudType, value, graphic] of [[0, 0, 351], [0, 40, 352], [2, 200, 353], [3, 255, 356], [7, 0, 357], [40, 31, 357], [40, 128, 359]]) {
  const seed = 0x5eed0000 + graphic * 17 + value;
  const r = drawScene({ relCell: 12, cloudType, value, seed });
  const oracle = new CsbRandom(seed);
  const start = oracle.next() & 63; // the right-hand argument first
  const wrap = oracle.zeroTo3() + 87;
  let src = fakeGraphic(graphic);
  if (cloudType === 40) src = shrink(src, 48, 31, realTables.cloudColorMap);
  check(wrap <= 30 * 3, 'the tiling wraps within the 30 rows every graphic has');
  const groupsPerRow = Math.trunc((rect.x2 - rect.x1) / 16) + 1;
  const expected = new Uint8Array(224 * 136);
  let g = start;
  for (let y = rect.y1; y <= rect.y2; y++) {
    for (let c = 0; c < groupsPerRow; c++) {
      for (let i = 0; i < 16; i++) {
        const x = rect.x1 + c * 16 + i;
        if (x <= rect.x2) expected[y * 224 + x] = src.pixels[Math.floor(g / 3) * 48 + (g % 3) * 16 + i];
      }
      if (++g === wrap) g = 0;
    }
  }
  const what = `type ${cloudType}, value ${value} → graphic ${graphic}${cloudType === 40 ? ' through Byte5712' : ''}, groups from ${start}, wrapping at ${wrap}`;
  console.log(`  ${what}`);
  check(r.requested.length === 1 && r.requested[0] === graphic, `under the party, ${what}: reads graphic ${graphic} only (read ${r.requested.join()})`);
  check(Array.from(r.pixels).join() === Array.from(expected).join(), `under the party, ${what}: tiles Word2530 pixel for pixel`);
  check(r.seedAfter === oracle.getSeed(), `under the party, ${what}: exactly two viewport-stream draws`);
}

// 8. A Fluxcage (type 50) draws no cloud, but `DrawRoomObjects` draws a teleporter's
// shimmer over its cell, from its teleporter rectangle one pixel on (`x1 + 1`), from
// cell 4 on and not from the far side of a door, and only while `d.Word1868` is clear
// (`doc/CSBwin-src/Code51a4.cpp:2769-2782`); `_FusionSequence` sets it (`Attack.cpp:2367`).
console.log('\nthe Fluxcage\'s shimmer (Code51a4.cpp:2769-2782):');
for (const word1868 of [false, true]) {
  for (const relativeCell of [0, 1, 4]) {
    const rec = { nextObject: OBJECT_ID_EOF, value: 0, cloudType: 50, bit7: false };
    const context: any = {
      viewportIndexBuffer: createPaletteIndexViewportBuffer(224, 136, 0),
      objectTables: realTables,
      wallRectangles: viewportTables.wallRectangles,
      teleporterRectangles: viewportTables.teleporterRectangles,
      getGraphicBitmap: (n: number) => fakeGraphic(n),
      dungeonState: { rnMaps: new RnMaps(), getDBRecordLink: () => OBJECT_ID_EOF, getCloudRecord: () => rec },
      word1868,
    };
    const seed = 0x2468ace;
    graphicRandomState.r = seed;
    // Position list 1: the cell's first position, at the cloud's (0) with facing 0.
    DrawRoomObjects(new ViewportDraw(context), cloudRn, 0, 0, 0, relativeCell, 0x1);
    const after = graphicRandomState.r;
    // The one shimmer the cell owes, drawn directly from the same `GraphicRandom` state:
    // the cell's drawing must match it pixel for pixel, or be nothing at all.
    const teleporter = viewportTables.teleporterRectangles[relativeCell]!;
    const wall = viewportTables.wallRectangles[relativeCell]!;
    const expected = createPaletteIndexViewportBuffer(224, 136, 0);
    graphicRandomState.r = seed;
    DrawTeleporter(new ViewportDraw({ ...context, viewportIndexBuffer: expected }), { ...teleporter, x1: teleporter.x1 + 1 }, wall);
    const pixels: Uint8Array = context.viewportIndexBuffer.pixels;
    const untouched = after === seed && pixels.every((p) => p === 0);
    const drawn = after === graphicRandomState.r && expected.pixels.some((p) => p !== 0)
      && Buffer.compare(pixels, expected.pixels) === 0;
    const shimmers = drawn ? 1 : untouched ? 0 : -1;
    const what = `cell ${relativeCell + 3}, d.Word1868 ${word1868 ? 1 : 0}`;
    console.log(`  ${what}: ${shimmers} shimmer(s)`);
    check(word1868 || relativeCell === 0 ? untouched : drawn,
      word1868 ? `${what}: no shimmer` : relativeCell === 0 ? `${what}: no shimmer, the cell is 3`
        : `${what}: the shimmer, with teleporterRectangles[${relativeCell}] one pixel on`);
  }
}

// 9. An alcove's clouds. `DrawRoomObjects` with drawing order 0 draws the alcove's
// objects at `CurAbsPos = (facing+2)&3` (`Code51a4.cpp:2177-2183`) and still ends in
// `DrawClouds` (`:2768-2773`) with that position. The Vi altar's lightning (type 100) and
// explosion (101) are a cloud in its alcove (`Timer.cpp:2730`, `:555`); a special cloud
// is drawn only at `CurAbsPos` (`:111-114`).
console.log('\nclouds in an alcove (Code51a4.cpp:2177-2183, 2768-2773):');
for (const facing of [0, 1, 2, 3]) {
  for (const [cloudType, pos] of [[100, (facing + 2) & 3], [101, (facing + 2) & 3], [100, facing]]) {
    const rec = { nextObject: OBJECT_ID_EOF, value: 0, cloudType, bit7: false };
    const viewportIndexBuffer = createPaletteIndexViewportBuffer(224, 136, 0);
    const context: any = {
      viewportIndexBuffer,
      objectTables: realTables,
      getGraphicBitmap: (n: number) => fakeGraphic(n),
      dungeonState: { rnMaps: new RnMaps(), getDBRecordLink: () => OBJECT_ID_EOF, getCloudRecord: () => rec },
    };
    const rn = ((pos << 14) | (DBType.CLOUD << 10)) as ObjectID;
    // Relative cell 6 is CSBWin's 9: the wall straight ahead, where the altar stands.
    DrawRoomObjects(new ViewportDraw(context), rn, facing, 0, 0, 6, 0);
    const lit = viewportIndexBuffer.pixels.some((p) => p !== 0);
    const atCurAbsPos = pos === ((facing + 2) & 3);
    const what = `facing ${facing}, type ${cloudType} at position ${pos}`;
    console.log(`  ${what}: ${lit ? 'drawn' : 'nothing'}`);
    check(lit === atCurAbsPos, atCurAbsPos ? `${what}: drawn in the alcove` : `${what}: not drawn, it is not at (facing+2)&3`);
  }
}

// 10. The cells that hold no objects. `ProcessOnePosition` notes a cloud in any cell
// (`Code51a4.cpp:2219-2221`), and `DrawRoomObjects` ends in `DrawClouds` whatever the cell
// (`:2768-2773`): `RelativeCellNumber` 0-2 are the row four ahead (F4, F4L1, F4R1), 13
// and 14 the cells beside the party (F0L1, F0R1). A special cloud (type 100 or more) is
// left out of them (`:111-114`), and a Fluxcage shimmers from cell 4 on, so beside the
// party and not four rows ahead (`:166-171`, `:2774-2782`).
console.log('\nthe row four ahead and the cells beside the party (Code51a4.cpp:2768-2773):');
const OUTER = [[0, 'F4'], [1, 'F4L1'], [2, 'F4R1'], [13, 'F0L1'], [14, 'F0R1']] as const;
for (const [relCell, name] of OUTER) {
  // Canary: the tables reach these cells, the far row small and centred, left and right
  // of it, the side cells off the viewport's edges at full size.
  const px = realTables.cloudPositions7042[2 * relCell]!;
  const py = realTables.cloudPositions7042[2 * relCell + 1]!;
  const byte5758 = realTables.cloudScale[Math.floor(relCell / 3)]!;
  const scaleIn = Math.max(4, (byte5758 * Math.max(48, 255 + 1)) >> 8) & 0xfffe;
  const p2 = Math.min(32, scaleIn);
  const hw = Math.trunc((p2 * realTables.cloudScaleBase[4]! + Math.trunc(p2 / 2)) / 32);
  const h = Math.trunc((p2 * realTables.cloudScaleBase[5]! + Math.trunc(p2 / 2)) / 32);
  const rect = expectedRect(px, py, hw, h);
  const r = drawScene({ relCell, cloudType: 7, value: 255 });
  const what = `cell ${relCell} (${name}): Word7042 (${px}, ${py}), Byte5758 ${byte5758} → scale ${scaleIn}, x ${rect.x1}..${rect.x2}, y ${rect.y1}..${rect.y2}`;
  console.log(`  ${what}; drawn ${r.drawn ? `x ${r.drawn.x1}..${r.drawn.x2}, y ${r.drawn.y1}..${r.drawn.y2}` : 'nothing'}`);
  check(sameRect(r.drawn, rect), `a poison cloud at ${what}`);
  check(r.requested.every((n) => n === 350), `cell ${relCell}: from graphic 350`);
  const lightning = drawScene({ relCell, cloudType: 100, value: 0 });
  const explosion = drawScene({ relCell, cloudType: 101, value: 255 });
  check(lightning.drawn === null && explosion.drawn === null && lightning.seedAfter === seedFor(false, false),
    `cell ${relCell}: a special cloud (type 100, 101) is not drawn, and draws nothing from the stream`);
}
check(realTables.cloudPositions7042.length === 30 && realTables.cloudPositions7162.length === 60 && realTables.cloudScale.length === 6,
  'Word7042 has 2·15 words, Word7162 4·15 and Byte5758 6 bytes: every cell 0..14 is inside them');
check([0, 1, 2].every((c) => realTables.cloudPositions7042[2 * c + 1] === 47) && realTables.cloudScale[0] === 10
  && realTables.cloudPositions7042[26]! < 0 && realTables.cloudPositions7042[28]! > 223 && realTables.cloudScale[4] === 32,
  'the far row sits at y 47 at scale 10, and the side cells off the left and right edges at scale 32');

// Whole frames. Level 12's (6,13) has no object within three squares (`dump-fusion.ts`);
// the squares around it are opened, the party stands at (6,14) facing north, and each
// frame is the empty one with the cell's `DrawClouds` or shimmer over it, pixel for pixel.
{
  const LEVEL = 12;
  const CX = 6;
  const CY = 13;
  const at = new Position(CX, CY + 1, LEVEL);
  /** [relativeCell, name, x, y]: the square each cell is, facing north. */
  const CELLS = [[-3, 'F4', CX, CY - 3], [-2, 'F4L1', CX - 1, CY - 3], [-1, 'F4R1', CX + 1, CY - 3],
    [10, 'F0L1', CX - 1, CY + 1], [11, 'F0R1', CX + 1, CY + 1]] as const;

  // A dungeon of its own each time: a game plays in the data it is given.
  const arena = () => {
    const loader = new DungeonLoader();
    loader.loadFromArray(new Uint8Array(readFileSync('static/gamefiles/dm-atari/dungeon.dat')));
    const data = loader.getData();
    if (!data) throw new Error('dungeon.dat did not load');
    const game = newGame(data, graphics);
    const map = game.ctx.dungeon.getMap(LEVEL)!;
    for (let x = CX - 3; x <= CX + 3; x++) {
      for (let y = CY - 3; y <= CY + 3; y++) {
        if (game.ctx.dungeon.findFirstObject(new Position(x, y, LEVEL)) !== OBJECT_ID_EOF) throw new Error(`the arena holds an object at (${x},${y})`);
        map.cellFlags[x]![y] = RoomType.OPEN << 5;
      }
    }
    game.ctx.party.state.position = at;
    game.ctx.party.state.facing = 0;
    game.loadNewPartyLevel();
    const graphicCache = new Map<string, IndexedBitmap>();
    const tables = graphicsTablesOf(graphics);
    const renderer = new ViewportRenderer({
      graphicsLoader: graphics,
      dungeonState: game.ctx.dungeon,
      viewportTables: tables.viewport,
      objectTables: tables.objects,
      palette552: tables.ui.graphic232.palette552,
      graphicCache,
      getGraphicBitmap: (graphicNum) => getCachedGraphicBitmap(graphics, graphicCache, graphicNum),
    });
    const frame = (viewportSeed: number, graphicSeed: number): Uint8Array => {
      viewportRandom.setSeed(viewportSeed);
      graphicRandomState.r = graphicSeed;
      renderer.selectLevel(LEVEL);
      renderer.draw(at, 0, false, false);
      return renderer.buffer.pixels.slice();
    };
    return { game, renderer, frame };
  };
  const cloudAt = (dungeon: ReturnType<typeof arena>['game']['ctx']['dungeon'], x: number, y: number): ObjectID => {
    for (let rn = dungeon.findFirstObject(new Position(x, y, LEVEL)); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      if (dungeon.rnMaps.dbType(rn) === DBType.CLOUD) return rn;
    }
    throw new Error(`no cloud at (${x},${y})`);
  };
  const GRAPHIC_SEED = 0x2468ace;
  const differing = (a: Uint8Array, b: Uint8Array): number => a.reduce((n, p, i) => n + (p === b[i] ? 0 : 1), 0);

  for (const [relativeCell, name, x, y] of CELLS) {
    // A poison cloud, centred in its square (`posInCell` 255, `b7`).
    {
      const { game, renderer, frame } = arena();
      const seed = seedFor(true, true);
      const empty = frame(seed, GRAPHIC_SEED);
      game.ctx.systems.missileEncounter.createCloud(RN_POISON_CLOUD, 255, x, y, new Position(x, y, LEVEL), 255);
      const drawn = frame(seed, GRAPHIC_SEED);
      const seedAfter = viewportRandom.getSeed();
      // The same cloud drawn alone over the empty frame, from the stream where the frame took it.
      const expected = createPaletteIndexViewportBuffer(224, 136, 0);
      expected.pixels.set(empty);
      viewportRandom.setSeed(seed);
      DrawClouds(new ViewportDraw({ ...renderer.context, viewportIndexBuffer: expected }), relativeCell, cloudAt(game.ctx.dungeon, x, y), 0, 0);
      const changed = differing(empty, drawn);
      console.log(`  a poison cloud in ${name} (${x},${y}): ${changed} pixels of the frame change`);
      check(changed > 0, `a poison cloud in ${name} shows in the frame`);
      check(Buffer.compare(drawn, expected.pixels) === 0 && seedAfter === viewportRandom.getSeed(),
        `and it is DrawClouds' cell ${relativeCell + 3}, pixel for pixel, with its two draws from the stream`);
    }
    // A Fluxcage: the shimmer beside the party, nothing four rows ahead.
    {
      const { game, renderer, frame } = arena();
      const seed = seedFor(false, false);
      const empty = frame(seed, GRAPHIC_SEED);
      game.ctx.systems.missileEncounter.createFluxcage(new Position(x, y, LEVEL), 0);
      const drawn = frame(seed, GRAPHIC_SEED);
      const graphicAfter = graphicRandomState.r;
      const changed = differing(empty, drawn);
      console.log(`  a Fluxcage in ${name}: ${changed} pixels of the frame change`);
      if (relativeCell < 0) {
        check(changed === 0 && graphicAfter === GRAPHIC_SEED, `a Fluxcage in ${name} does not shimmer: cell ${relativeCell + 3} is below 4`);
      } else {
        const tables = graphicsTablesOf(graphics).viewport;
        const teleporter = tables.teleporterRectangles[relativeCell]!;
        const expected = createPaletteIndexViewportBuffer(224, 136, 0);
        expected.pixels.set(empty);
        graphicRandomState.r = GRAPHIC_SEED;
        DrawTeleporter(new ViewportDraw({ ...renderer.context, viewportIndexBuffer: expected }),
          { ...teleporter, x1: teleporter.x1 + 1 }, tables.wallRectangles[relativeCell]!);
        check(changed > 0 && Buffer.compare(drawn, expected.pixels) === 0 && graphicAfter === graphicRandomState.r,
          `a Fluxcage in ${name} shimmers over teleporterRectangles[${relativeCell}] one pixel on, pixel for pixel`);
      }
    }
  }
}

finish();
