/**
 * The viewport overlay's screen half (`src/renderer/csbwin/OverlayScreen.ts`), on `tools/fixtures/csbgraphics/CSBgraphics.dat`: the table
 * `CreateOverlayTable` builds, and the viewport `UpdateScreenArea` composes through it.
 *
 * 1. **The straight branch** (`doc/CSBwin-src/Graphics.cpp:3096-3117`): each intensity as
 *    five bits `(i << 2) | (i >> 1)`. The canvas shows the rest of the screen in each
 *    intensity times 36 instead, a deliberate divergence (`DEBT.md` H): both are printed.
 * 2. **No overlay up** (`:3076-3095`): through the identity overlay palette, every Atari
 *    colour is the straight branch's, which is why the screen keeps its straight path then
 *    (`overlayDrawsNothing`). A palette from `&PALETTE`, a graphic jitter or an overlay up
 *    each make it draw.
 * 3. **An overlay up** (`:3016-3075`): entry `(I << 4) + i` is `m_p2` percent of colour
 *    `i` and the rest of overlay colour `I`, each channel `/ 800`; with bit 0 of `m_p1`,
 *    colour `m_p4` is colour `i`'s alone.
 * 4. **The composition** (`WinScreen.cpp:1064-1300`): each viewport pixel is
 *    `table[(overlay << 4) + colour]`, the overlay's line `line` its bitmap's `135 - line`;
 *    a graphic jitter moves the screen's picture under the overlay, colour 0 where it has
 *    left, a line from below the viewport down to line 136; an overlay jitter is
 *    `NotImplemented`.
 *
 * Run: `npm test -- --only=overlay-screen.ts`
 */
import { readFileSync } from 'node:fs';

import { CSBGraphicsLoader, CSBGraphicType } from '../../src/data/CSBGraphicsLoader';
import { readU32LE } from '../../src/core/bytes';
import { Overlay, OVERLAY_HEIGHT, OVERLAY_WIDTH } from '../../src/engine/Overlay';
import { identityOverlayPalette } from '../../src/engine/OverlayPalette';
import { updateImageDataFromIndex } from '../../src/renderer/csbwin/CanvasBlitter';
import {
  CreateOverlayTable, OVERLAY_TABLE_SIZE, overlayDrawsNothing, UpdateViewportArea, widen5,
} from '../../src/renderer/csbwin/OverlayScreen';
import { check, finish } from '../lib/check';
import { standInOf } from '../lib/standIn';

const csbGraphics = new CSBGraphicsLoader();
csbGraphics.loadFromArray(new Uint8Array(readFileSync('tools/fixtures/csbgraphics/CSBgraphics.dat')));
const sections = (type: CSBGraphicType): number =>
  Array.from({ length: 1000 }, (_, i) => i).filter((i) => csbGraphics.readSection(type, i, 0) !== null).length;
console.log(`the fixture CSBgraphics.dat: ${sections(CSBGraphicType.ViewportOverlay)} overlays, ${sections(CSBGraphicType.OverlayPalette)} overlay palettes`);

const ATARI = Array.from({ length: 512 }, (_, n) => ((n >> 6) << 8) | (((n >> 3) & 7) << 4) | (n & 7));
const channels = (pixel: number): number[] => [(pixel >> 10) & 0x1f, (pixel >> 5) & 0x1f, pixel & 0x1f];
const five = (i: number): number => (i << 2) | (i >> 1);
const straight = (colour: number): number => (five((colour >> 8) & 7) << 10) | (five((colour >> 4) & 7) << 5) | five(colour & 7);
const newOverlay = (): Overlay => {
  const overlay = new Overlay(identityOverlayPalette(), () => {});
  overlay.csbGraphics = csbGraphics;
  return overlay;
};
/** The table for 16 colours of `ATARI`, from `first`. */
const tableFor = (overlay: Overlay, palette: number[], useOverlay: boolean, overlayPalette = identityOverlayPalette()): Uint16Array => {
  const table = new Uint16Array(OVERLAY_TABLE_SIZE);
  overlay.current.Allocate();
  CreateOverlayTable(table, palette, useOverlay, overlay, overlayPalette);
  return table;
};
const palettes = Array.from({ length: 32 }, (_, k) => ATARI.slice(16 * k, 16 * k + 16));

console.log('1. The straight branch');
{
  const overlay = newOverlay();
  const wrong = palettes.filter((p) => !tableFor(overlay, p, false).subarray(0, 16).every((v, i) => v === straight(p[i]!)));
  check(wrong.length === 0, 'without useOverlay, each intensity is five bits (i << 2) | (i >> 1)');
  const image = standInOf<ImageData>({ data: new Uint8ClampedArray(8 * 4), width: 8, height: 1 });
  updateImageDataFromIndex(image, { width: 8, height: 1, pixels: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]) }, [0, 0x111, 0x222, 0x333, 0x444, 0x555, 0x666, 0x777]);
  console.log(`  RGB555 widened:     ${Array.from({ length: 8 }, (_, i) => widen5(five(i))).join(' ')}`);
  console.log(`  canvas intensities: ${Array.from({ length: 8 }, (_, i) => image.data[4 * i]!).join(' ')}`);
  check(Array.from({ length: 8 }, (_, i) => image.data[4 * i]!).every((v, i) => v === 36 * i), 'the canvas colours are the intensity times 36');
}

console.log('2. No overlay up');
{
  const overlay = newOverlay();
  const wrong = palettes.filter((p) => !tableFor(overlay, p, true).subarray(0, 16).every((v, i) => v === straight(p[i]!)));
  check(wrong.length === 0, "through the identity overlay palette, all 512 Atari colours are the straight branch's");
  const palette = identityOverlayPalette();
  check(overlayDrawsNothing(overlay, palette), 'a fresh game draws the straight picture');
  overlay.Jitter(0, 1, 0, 0);
  check(!overlayDrawsNothing(overlay, palette), 'a graphic jitter draws');
  overlay.Jitter(0, 0, 0, 0);
  const tinted = new Overlay(palette, () => {});
  tinted.csbGraphics = csbGraphics;
  tinted.SetOverlayPalette(1, 100);
  check(!overlayDrawsNothing(tinted, palette), "&PALETTE's palette draws");
  tinted.SetOverlayPalette(-1, 100);
  check(overlayDrawsNothing(tinted, palette), 'and its identity, given back, draws the straight picture again');
  overlay.SelectOverlay(1, 0, 50, 0, 0, 0);
  check(overlay.active && !overlayDrawsNothing(overlay, palette), 'an overlay up draws');
}

console.log('3. An overlay up');
{
  const overlay = newOverlay();
  const section = csbGraphics.readSection(CSBGraphicType.ViewportOverlay, 1, 0)!;
  const colours = Array.from({ length: 256 }, (_, i) => readU32LE(section, 14 + 40 + 4 * i));
  const rgb = (c: number): number[] => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
  const p = palettes[9]!;
  const identity = identityOverlayPalette();
  const through = (colour: number): number[] => {
    const n = ((colour & 0x700) >> 2) | ((colour & 0x070) >> 1) | (colour & 7);
    return [identity[n]!, identity[512 + n]!, identity[1024 + n]!];
  };
  for (const p2 of [100, 0, 50, 30]) {
    overlay.SelectOverlay(1, 0, p2, 0, 0, 0);
    const table = tableFor(overlay, p, true);
    let wrong = 0;
    for (let I = 0; I < 256; I++) {
      for (let i = 0; i < 16; i++) {
        const want = through(p[i]!).map((v, k) => Math.floor((v * p2 + rgb(colours[I]!)[k]! * (100 - p2)) / 800));
        if (channels(table[(I << 4) + i]!).some((v, k) => v !== want[k])) wrong++;
      }
    }
    console.log(`  m_p2 ${p2}: ${wrong} entries of 4096 off the blend`);
    check(wrong === 0, `m_p2 ${p2}: each entry is m_p2 percent of the colour and the rest of the overlay's, / 800`);
  }
  overlay.SelectOverlay(1, 1, 0, 0, 7, 0);
  const table = tableFor(overlay, p, true);
  const transparent = Array.from({ length: 16 }, (_, i) => channels(table[(7 << 4) + i]!).join(','));
  const plain = Array.from({ length: 16 }, (_, i) => channels(straight(p[i]!)).join(','));
  check(transparent.every((v, i) => v === plain[i]), "with bit 0 of m_p1, colour m_p4 is the graphic's colour alone, even at m_p2 0");
  check(channels(table[(8 << 4) + 3]!).join(',') === rgb(colours[8]!).map((v) => v >> 3).join(','),
    "and another overlay colour at m_p2 0 is the overlay's alone");
}

console.log('4. The composition');
{
  const screen = new Uint8Array(320 * 200);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) screen[320 * y + x] = (x + 3 * y) & 15;
  const pal = palettes[5]!;
  const compose = (overlay: Overlay): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(320 * 200 * 4);
    const table = tableFor(overlay, pal, true);
    UpdateViewportArea(out, screen, table, overlay, true, (n) => { throw new Error(`NotImplemented 0x${n.toString(16)}`); });
    return out;
  };
  const shownAt = (out: Uint8ClampedArray, x: number, line: number): string =>
    Array.from(out.subarray(4 * (320 * (33 + line) + x), 4 * (320 * (33 + line) + x) + 3)).join(',');
  const want = (overlay: Overlay, nibble: number, overlayX: number, line: number): string => {
    const table = tableFor(overlay, pal, true);
    const byte = overlay.active ? overlay.current.overlay![OVERLAY_WIDTH * (OVERLAY_HEIGHT - 1 - line) + overlayX]! : 0;
    return channels(table[(byte << 4) + nibble]!).map(widen5).join(',');
  };
  const at = (x: number, y: number): number => screen[320 * y + x]!;

  const overlay = newOverlay();
  overlay.SelectOverlay(1, 0, 50, 0, 0, 0);
  let out = compose(overlay);
  let wrong = 0;
  for (let line = 0; line < 136; line++) for (let x = 0; x < 224; x++) if (shownAt(out, x, line) !== want(overlay, at(x, 33 + line), x, line)) wrong++;
  const untouched = out.subarray(0, 4 * 320 * 33).every((v) => v === 0) && out[4 * (320 * 33 + 224)] === 0;
  console.log(`  overlay 1 at m_p2 50: ${wrong} pixels of ${224 * 136} off; the screen outside the viewport untouched ${untouched}`);
  check(wrong === 0 && untouched, "each viewport pixel is table[(overlay << 4) + colour], the overlay's line 135 - line, and nothing else is written");

  const cases: { jitter: [number, number]; probes: [number, number, number, number][]; what: string }[] = [
    // [x, line, the screen's colour there, the overlay's x]
    { jitter: [3, 0], probes: [[0, 10, 0, 0], [2, 10, 0, 2], [3, 10, at(0, 43), 3], [223, 10, at(220, 43), 223]],
      what: 'x +3: colour 0 in the first three columns, then the picture from its column 0, under the overlay unmoved' },
    { jitter: [-3, 0], probes: [[0, 10, at(3, 43), 0], [220, 10, at(223, 43), 220], [221, 10, 0, 221], [223, 10, 0, 223]],
      what: 'x -3: the picture from its column 3, colour 0 in the last three columns' },
    { jitter: [0, 2], probes: [[5, 0, 0, 5], [5, 1, 0, 5], [5, 2, at(5, 33), 5], [5, 135, at(5, 166), 5]],
      what: 'y +2: two lines of colour 0, then the picture from its line 0' },
    { jitter: [0, -2], probes: [[5, 0, at(5, 35), 5], [5, 133, at(5, 168), 5], [5, 134, at(5, 169), 5], [5, 135, 0, 5]],
      what: "y -2: the picture from its line 2, the screen's line 169 below it, then colour 0" },
  ];
  for (const { jitter, probes, what } of cases) {
    overlay.Jitter(jitter[0], jitter[1], 0, 0);
    out = compose(overlay);
    const bad = probes.filter(([x, line, nibble, ox]) => shownAt(out, x, line) !== want(overlay, nibble, ox, line));
    console.log(`  jitter ${jitter.join(',')}: ${probes.length - bad.length} of ${probes.length} probes as CSBWin's`);
    check(bad.length === 0, what);
  }
  for (const [xg, xo, code] of [[0, 5, 0x777104], [0, -5, 0x777101], [-3, -5, 0x777107], [-3, 5, 0x777109], [3, -5, 0x777111], [3, 5, 0x777112]] as const) {
    overlay.Jitter(xg, 0, xo, 0);
    let said = '';
    try { compose(overlay); } catch (e) { said = (e as Error).message; }
    check(said === `NotImplemented 0x${code.toString(16)}`, `graphic x ${xg}, overlay x ${xo}: NotImplemented(0x${code.toString(16)})`);
  }
}

finish();
