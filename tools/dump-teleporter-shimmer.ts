/**
 * The teleporter's shimmer, `DrawTeleporter` (`doc/CSBwin-src/CSBCode.cpp:4331-4367`) through
 * `TAG008c98` (`doc/CSBwin-src/Graphics.cpp:1193-1340`), against an oracle that runs the C++
 * loop as written: over Atari interleaved bitplanes, four words to a 16-pixel group, with
 * `D0W..D3W &= D5W` for the mask's plane-0 word and `D1W |= ~D5W`, `D3W |= ~D5W` for colour
 * 10. The port's `tag008c98` works on palette indices, so the two share nothing but the
 * graphics, the rectangles and `GraphicRandom`.
 *
 * 1. The data the transcription leans on, for every one of `d.teleporterRectangles` and for
 *    the Fluxcage's reading of it (`x1 + 1`, `Code51a4.cpp:2769-2782`): 16-pixel-wide
 *    graphics, a stream that wraps before the source ends, a mask exactly as long as the
 *    fill, and the two `P9` values CSBWin implements.
 * 2. For each rectangle and eight pinned `GraphicRandom` states, the viewport the port draws
 *    equals the oracle's, pixel for pixel, over a viewport filled with a colour neither
 *    writes, so a masked-out pixel that is drawn shows.
 * 3. The shimmer moves: the eight states do not all draw the same pixels.
 *
 * `GraphicRandom`'s two draws are taken right to left (`P7` first) by both sides: C++ leaves
 * the order unspecified, and that is the port's assumption (`DrawTeleporter`'s comment).
 *
 * Run: `npx tsx tools/dump-teleporter-shimmer.ts`
 */
import type { RectPos } from '../src/data/tables/UITables';
import { DrawTeleporter, GraphicRandom, graphicRandomState } from '../src/renderer/bytecode/DrawDoor';
import { ViewportDraw } from '../src/renderer/bytecode/ViewportDraw';
import { createPaletteIndexViewportBuffer, mirrorBitmap, type IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';
import { graphicsTablesOf, stockGraphics } from './lib/game';

const graphics = stockGraphics();
const viewportTables = graphicsTablesOf(graphics).viewport;
const cache = new Map<string, IndexedBitmap>();
const graphic = (n: number): IndexedBitmap | null => getCachedGraphicBitmap(graphics, cache, n);

const BACKGROUND = 5; // in no teleporter graphic, and neither 0 nor 10
const SEEDS = [1, 12345, 0x2468ace, 0x9e3779b9, 0xdeadbeef, 7, 0x10000, 0xffffffff];

/** A bitmap as CSBWin holds it: rows padded to groups, four plane words a group, bit 15 leftmost. */
function toPlanes(b: IndexedBitmap): Uint16Array {
  const groupsPerRow = (b.width + 15) >> 4;
  const words = new Uint16Array(groupsPerRow * b.height * 4);
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const v = b.pixels[y * b.width + x];
      const g = y * groupsPerRow + (x >> 4);
      for (let p = 0; p < 4; p++) if ((v >> p) & 1) words[g * 4 + p] |= 0x8000 >> (x & 15);
    }
  }
  return words;
}

/** `TAG008c98` as the C++ has it, the temporary bitmap in plane words, then `TAG0088b2`. */
function oracle(src: IndexedBitmap, dst: Uint8Array, mask: IndexedBitmap | null, rect: RectPos,
  P6: number, P7: number, P9: number, P10: number, P11: number): void {
  let masked: boolean;
  if ((P9 & 0xff) === 0xff) masked = false; // D0B == -1
  else if ((P9 & 0xff) < 0x80) masked = true; // D0B >= 0
  else { P9 &= 0x7f; masked = false; }
  const A0src = toPlanes(src);
  const A1mask = mask ? toPlanes(mask) : null;
  const w2 = Math.trunc((rect.x2 - rect.x1) / 16) + 1;
  let D7 = (rect.y2 - rect.y1 + 1) * w2 - 1;
  let D7hi = P7;
  let A0 = 4 * P7;
  let A1 = 0;
  const P4 = new Uint16Array(4 * (D7 + 1));
  let A2 = 0;
  do {
    const D = [A0src[A0], A0src[A0 + 1], A0src[A0 + 2], A0src[A0 + 3]];
    A0 += 4;
    if (masked) {
      let D5 = A1mask![A1];
      A1 += 4;
      for (let p = 0; p < 4; p++) D[p] &= D5;
      D5 ^= 0xffff;
      if (P9 === 10) { D[3] |= D5; D[1] |= D5; } // tag008da4
      else if (P9 !== 0) throw new Error(`NotImplemented(0x8d9a), P9 ${P9}`);
    }
    for (let p = 0; p < 4; p++) P4[A2 + p] = D[p];
    A2 += 4;
    D7hi++;
    if (D7hi === P6) { D7hi = 0; A0 = 0; }
  } while (D7-- !== 0);
  // TAG0088b2(P4, dst, P5, P10, P11, 8 * w_2, 112, P9), pixel by pixel.
  const tempWidth = 16 * w2;
  for (let y = 0; y <= rect.y2 - rect.y1; y++) {
    for (let x = 0; x <= rect.x2 - rect.x1; x++) {
      const sx = P10 + x;
      if (sx >= tempWidth) throw new Error('read past the temporary bitmap');
      const g = (P11 + y) * w2 + (sx >> 4);
      let v = 0;
      for (let p = 0; p < 4; p++) if (P4[g * 4 + p] & (0x8000 >> (sx & 15))) v |= 1 << p;
      if (v !== P9) dst[(rect.y1 + y) * 224 + rect.x1 + x] = v;
    }
  }
}

console.log('the rectangles (d.teleporterRectangles, graphic 0x22e) and what they read:');
const cases: { what: string; teleporter: RectPos; wall: RectPos }[] = [];
viewportTables.teleporterRectangles.forEach((teleporter, i) => {
  const wall = viewportTables.wallRectangles[i]!;
  cases.push({ what: `rect ${i}`, teleporter, wall });
  if (i >= 1) cases.push({ what: `rect ${i}, Fluxcage`, teleporter: { ...teleporter, x1: teleporter.x1 + 1 }, wall });
});
for (const { what, teleporter: t, wall } of cases) {
  const src = graphic(t.x1 + 73)!;
  const srcGroups = (src.width >> 4) * src.height;
  const w2 = Math.trunc((wall.x2 - wall.x1) / 16) + 1;
  const fill = w2 * (wall.y2 - wall.y1 + 1);
  let line = `  ${what}: graphic ${t.x1 + 73} ${src.width}x${src.height}, wraps at ${t.x2}+0..1 of ${srcGroups} groups,`
    + ` P9 ${t.y1}, wall ${wall.x1}..${wall.x2} x ${wall.y1}..${wall.y2}, ${fill} groups`;
  check(src.width % 16 === 0, `${what}: the source is whole groups wide`);
  check(t.x2 + 1 <= srcGroups && 31 < t.x2, `${what}: the stream wraps before the source ends, and after group 31`);
  check((t.y2 === 0xff) === ((t.y1 & 0x80) !== 0), `${what}: a mask exactly when P9 has bit 7 clear`);
  check([0, 10].includes(t.y1 & 0x7f), `${what}: P9 is 0 or 10, the two CSBWin implements`);
  if (t.y2 !== 0xff) {
    const mask = graphic((t.y2 & 0x7f) + 69)!;
    const width = t.srcWidth!;
    line += `, mask ${(t.y2 & 0x7f) + 69}${t.y2 & 0x80 ? ' mirrored' : ''} ${width}x${t.srcHeight}`;
    check(mask.width === width && mask.height === t.srcHeight && width % 16 === 0,
      `${what}: the mask is its whole graphic, whole groups wide`);
    check((width >> 4) * t.srcHeight! === fill, `${what}: the mask has one group for every group filled`);
  }
  console.log(line);
}

console.log('\nthe port against the oracle, eight GraphicRandom states each:');
for (const { what, teleporter: t, wall } of cases) {
  const drawings = new Set<string>();
  let same = 0;
  for (const seed of SEEDS) {
    const port = createPaletteIndexViewportBuffer(224, 136, BACKGROUND);
    graphicRandomState.r = seed;
    DrawTeleporter(new ViewportDraw({ viewportIndexBuffer: port, getGraphicBitmap: graphic } as any), t, wall);
    const after = graphicRandomState.r;

    const want = createPaletteIndexViewportBuffer(224, 136, BACKGROUND).pixels;
    graphicRandomState.r = seed;
    const P7 = GraphicRandom(32);
    const P6 = t.x2 + GraphicRandom(2);
    let mask: IndexedBitmap | null = null;
    if (t.y2 !== 0xff) {
      const m = graphic((t.y2 & 0x7f) + 69)!;
      mask = t.y2 & 0x80 ? mirrorBitmap(m) : m;
    }
    oracle(graphic(t.x1 + 73)!, want, mask, wall, P6, P7, t.y1, t.srcX ?? 0, 0);
    check(after === graphicRandomState.r, `${what}, seed ${seed}: two GraphicRandom draws`);
    if (Buffer.compare(port.pixels, want) === 0) same++;
    drawings.add(Buffer.from(port.pixels).toString('base64'));
  }
  console.log(`  ${what}: ${same}/${SEEDS.length} identical, ${drawings.size} distinct drawings`);
  check(same === SEEDS.length, `${what}: every drawing is the oracle's`);
  check(drawings.size > 1, `${what}: the shimmer moves from one state to the next`);
}

finish();
