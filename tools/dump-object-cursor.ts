/**
 * The cursor of an object in hand: `CreateObjectCursor` (`doc/CSBwin-src/CSBCode.cpp:2005`)
 * builds it twice, and `CreateCursorBitmap` (`:2241`) picks between the two and the arrow.
 *
 * `d.Pointer23186` is the icon over a black shadow two pixels down and right.
 * `d.Pointer23190` is the same shadow under the icon's silhouette in colour 4, which every
 * light level's viewport palette keeps as it is. While the dungeon view is shown
 * (`d.DynamicPaletteSwitching`), the cursor rows on screen row 29 and below come from
 * `d.Pointer23190`, so an icon drawn through the viewport palette, whose colours 9 and 10
 * the level's monsters change (`ModifyPalettes`, `Code390e.cpp:323-343`), never shows.
 * Outside the viewport and the portraits the cursor is the arrow.
 *
 * The port's extra (`DEBT.md` H), on by default, shows the icon itself over the dungeon
 * view, through the interface palette. The checks of CSBWin's cursor run with it off.
 *
 * What to look for: the copper coin's icon is mostly colour 9. Over the viewport it is a
 * colour-4 shape, over the portraits it is itself, and over the right-hand panel and the
 * message area it is the arrow. With the extra, it is itself over the viewport too, in
 * the interface palette's colour 9 however the viewport palette changed it.
 *
 * Run: `npx tsx tools/dump-object-cursor.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Direction, OBJECT_ID_NULL, Position, type ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Party } from '../src/engine/Party';
import {
  reconvertThroughPalette,
  updateImageDataFromIndexWithViewportPalette,
  type IndexedBitmap,
} from '../src/renderer/csbwin/CanvasBlitter';
import { type UIState } from '../src/renderer/ui/UIState';
import { objectIconBitmap } from '../src/renderer/ui/Draw';
import { resolveObjectNameIndex } from '../src/renderer/ui/Objects';
import { check, finish } from './lib/check';
import { graphicsTablesOf, newGame } from './lib/game';
import { newUIState } from './lib/ui';
import * as mouse from '../src/renderer/ui/Mouse';

/** The copper coin's name index: an icon mostly of colour 9. */
const COPPER_COIN = 125;
/** RN category of the junk objects the coins are. */
const CATEGORY_JUNK = 10;

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const uiTables = graphicsTablesOf(graphics).ui;
  const objectTables = graphicsTablesOf(graphics).objects;

  const party = new Party(new Position(1, 1, 0), Direction.NORTH);
  const bitmaps = new Map<number, IndexedBitmap>();
  const ui: UIState = newUIState(graphics, newGame(data, graphics).ctx, {
    getGraphicBitmap: (n: number) => {
      let bitmap = bitmaps.get(n);
      if (!bitmap) {
        const image = graphics.getImage(n);
        bitmap = { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };
        bitmaps.set(n, bitmap);
      }
      return bitmap;
    },
  });
  ui.partyState = party.state;

  // ---- A copper coin from the dungeon, in hand.
  check(objectTables.objectNames[COPPER_COIN] === 'COPPER COIN', `name index ${COPPER_COIN} should be the copper coin`);
  let coin = -1;
  const junk = data.databases.misc.records;
  for (let i = 0; i < junk.length && coin < 0; i++) {
    if (junk[i]!.nextObject === OBJECT_ID_NULL) continue;
    const rn = data.rnMaps.rn(CATEGORY_JUNK, i);
    if (resolveObjectNameIndex(ui, rn) === COPPER_COIN) coin = rn;
  }
  check(coin >= 0, 'dungeon.dat should hold a copper coin');
  if (coin < 0) return finish();
  party.state.objectInHand = coin as ObjectID;
  const icon = objectIconBitmap(ui, COPPER_COIN, uiTables.graphic232.word612)!;
  let colour9 = 0;
  for (const p of icon.pixels) if (p === 9) colour9++;
  console.log(`copper coin RN 0x${coin.toString(16)}, icon ${COPPER_COIN}: ${colour9} of 256 pixels colour 9`);
  check(colour9 > 32, 'the copper coin icon should be mostly colour 9');

  // The two cursors, from the icon: `CSBCode.cpp:2015-2054`.
  const iconAt = (x: number, y: number): number => (x < 16 && y < 16 ? icon.pixels[y * 16 + x] : 12);
  const shadowAt = (x: number, y: number): boolean => x >= 2 && y >= 2 && iconAt(x - 2, y - 2) !== 12;
  const want23186 = (x: number, y: number): number => (iconAt(x, y) !== 12 ? iconAt(x, y) : shadowAt(x, y) ? 0 : 12);
  const want23190 = (x: number, y: number): number => (iconAt(x, y) !== 12 ? 4 : shadowAt(x, y) ? 0 : 12);

  const screen = ui.screenIndexBuffer;
  /** Pixels of an 18-row cursor drawn with the pointer at (px, py) that differ from `want`. */
  const offBy = (px: number, py: number, want: (x: number, y: number, screenY: number) => number): number => {
    let bad = 0;
    for (let row = 0; row < 18; row++) {
      for (let col = 0; col < 32; col++) {
        const sx = px - 8 + col;
        const sy = py - 8 + row;
        if (sx < 0 || sx >= 320 || sy < 0 || sy >= 200) continue;
        const w = want(col, row, sy);
        if (screen.pixels[sy * 320 + sx] !== (w === 12 ? 1 : w)) bad++;
      }
    }
    return bad;
  };
  const draw = (x: number, y: number, dynamicPaletteSwitching: boolean): void => {
    ui.hoverPoint = { x, y };
    screen.pixels.fill(1);
    mouse.drawCursorItem(ui, dynamicPaletteSwitching);
  };
  const colourCount = (c: number): number => screen.pixels.reduce((n, p) => n + (p === c ? 1 : 0), 0);

  console.log(['pointer', 'palette switching', 'colour 9', 'colour 4'].join('\t'));
  const row = (what: string, x: number, y: number, dps: boolean): void => {
    draw(x, y, dps);
    console.log([`${what} (${x},${y})`, dps, colourCount(9), colourCount(4)].join('\t'));
  };

  // ---- CSBWin's cursor, the extra off.
  check(ui.colouredObjectCursor, 'the coloured object cursor should be on by default');
  ui.colouredObjectCursor = false;

  // ---- Over the viewport, the dungeon view shown: the silhouette throughout.
  row('viewport', 100, 100, true);
  check(offBy(100, 100, want23190) === 0, 'over the viewport the cursor should be d.Pointer23190, the colour-4 silhouette');
  check(colourCount(9) === 0, 'over the viewport no pixel of the coin should be drawn in colour 9');

  // ---- Straddling row 29: the rows above it are the icon (`:2352-2421`).
  row('split', 100, 30, true);
  check(offBy(100, 30, (x, y, sy) => (sy >= 29 ? want23190(x, y) : want23186(x, y))) === 0,
    'straddling row 29 the cursor should be d.Pointer23186 above it and d.Pointer23190 from it');

  // ---- An inventory open, no palette switching: the icon throughout.
  row('inventory', 100, 100, false);
  check(offBy(100, 100, want23186) === 0, 'with the inventory open the cursor should be d.Pointer23186, the icon');

  // ---- Over the portraits: the icon (`tag0029ba`, then `:2338` with D6 <= 0).
  row('portraits', 100, 15, true);
  check(offBy(100, 15, want23186) === 0, 'over the portraits the cursor should be the icon');

  // ---- The right-hand panel and the message area: the arrow (`tag0029f8`).
  const arrow = mouse.getCursorArrowBitmap(ui)!;
  const wantArrow = (px: number, py: number): number => {
    let bad = 0;
    for (let y = 0; y < arrow.height; y++) {
      for (let x = 0; x < arrow.width; x++) {
        const p = arrow.pixels[y * arrow.width + x] & 15;
        const sx = px + x;
        const sy = py + y;
        if (sx >= 320 || sy >= 200) continue;
        if (screen.pixels[sy * 320 + sx] !== (p === 12 ? 1 : p)) bad++;
      }
    }
    return bad + colourCount(9);
  };
  row('right panel', 250, 100, true);
  check(wantArrow(250, 100) === 0, 'over the right-hand panel the cursor should be the arrow');
  row('message area', 100, 180, true);
  check(wantArrow(100, 180) === 0, 'over the message area the cursor should be the arrow');
  check(ui.objectCursorFootprint === null, 'with the extra off the screen should be told of no footprint');

  // ---- The extra: the icon over the viewport, converted through the interface palette.
  ui.colouredObjectCursor = true;
  row('extra, viewport', 100, 100, true);
  check(offBy(100, 100, want23186) === 0, 'with the extra, over the viewport the cursor should be d.Pointer23186, the icon');
  const footprint = ui.objectCursorFootprint as { x: number; y: number; bitmap: IndexedBitmap } | null;
  check(footprint !== null && footprint.x === 92 && footprint.y === 92, 'the footprint should be the cursor, 8 pixels up and left of the pointer');
  row('extra, right panel', 250, 100, true);
  check(wantArrow(250, 100) === 0 && ui.objectCursorFootprint === null, 'with the extra, the right-hand panel keeps the arrow');
  row('extra, inventory', 100, 100, false);
  check(offBy(100, 100, want23186) === 0 && ui.objectCursorFootprint === null,
    'with the inventory open the extra has nothing to do');

  // A level whose monsters give colour 9 another scheme (`ModifyPalettes(9, 0)`): the
  // coin's colour-9 pixels must come out as the interface palette's colour 9.
  draw(100, 100, true);
  const uiPalette = uiTables.graphic232.palette552[0];
  const viewportPalette = uiPalette.slice();
  viewportPalette[9] = objectTables.specialColors[0].paletteEntries[0];
  check(viewportPalette[9] !== uiPalette[9], 'the test palette should change colour 9');
  const rgb = (c: number): number[] => [((c >> 8) & 7) * 36, ((c >> 4) & 7) * 36, (c & 7) * 36];
  const image = { width: 320, height: 200, data: new Uint8ClampedArray(320 * 200 * 4) } as unknown as ImageData;
  const viewportRect = { x1: 0, y1: 33, x2: 223, y2: 168 };
  const colour9Rgb = (): { ui: number; viewport: number } => {
    const counts = { ui: 0, viewport: 0 };
    const [ur, ug, ub] = rgb(uiPalette[9]);
    const [vr, vg, vb] = rgb(viewportPalette[9]);
    for (let i = 0; i < 320 * 200; i++) {
      if (screen.pixels[i] !== 9) continue;
      const [r, g, b] = [image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2]];
      if (r === ur && g === ug && b === ub) counts.ui++;
      if (r === vr && g === vg && b === vb) counts.viewport++;
    }
    return counts;
  };
  updateImageDataFromIndexWithViewportPalette(image, screen, viewportRect, viewportPalette, uiPalette);
  const before = colour9Rgb();
  reconvertThroughPalette(image, screen, footprint!, 12, uiPalette);
  const after = colour9Rgb();
  console.log(`coin colour 9 over the viewport: ${before.viewport} in the level's colour, then ${after.ui} in the interface's`);
  check(before.viewport === colour9 && after.ui === colour9 && after.viewport === 0,
    `with the extra, the coin's ${colour9} colour-9 pixels should show the interface palette's colour 9`);
  const [br, bg, bb] = rgb(viewportPalette[1]);
  const background = (70 * 320 + 40) * 4; // (40, 70): viewport, clear of the cursor
  check(image.data[background] === br && image.data[background + 1] === bg && image.data[background + 2] === bb,
    'the viewport around the cursor should keep the viewport palette');

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
