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
 * Run: `npx tsx tools/dump-cloud-draw.ts`
 */
import { readFileSync } from 'node:fs';

import { DBType, OBJECT_ID_EOF } from '../src/core/types';
import { CsbRandom } from '../src/core/random';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { BytecodeInterpreter } from '../src/renderer/bytecode/BytecodeInterpreter';
import { createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { check, finish } from './lib/check';

const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync('static/gamefiles/dm-atari/graphics.dat')));
const viewportTables = extractViewportTables(graphics);
const realTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);

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
const cloudRn = (DBType.CLOUD << 10) | 0;
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
      getDBRecordLink: () => OBJECT_ID_EOF,
      getCloudRecord: () => cloud,
    },
  };
  (BytecodeInterpreter as any).viewportRandom.setSeed(viewportSeed);
  (new BytecodeInterpreter(context) as any).drawClouds(RELATIVE_CELL, cloudRn, 0, 0);

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
check((BytecodeInterpreter as any).viewportRandom.getSeed() === 0x34175432,
  'viewportRandom starts at 0x34175432 (Viewport.cpp:6697)');

// 1. The stream. Two draws from the viewport's own stream, none from GraphicRandom.
{
  const seed = 0x1234567;
  const graphicRandomBefore = (BytecodeInterpreter as any).graphicRandomState;
  drawCloudAt(100, 60, seed);
  const oracle = new CsbRandom(seed);
  oracle.bool();
  oracle.bool();
  check((BytecodeInterpreter as any).viewportRandom.getSeed() === oracle.getSeed(),
    'one cloud consumes exactly two STRandomBool() draws from the viewport stream');
  check((BytecodeInterpreter as any).graphicRandomState === graphicRandomBefore,
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

finish();
