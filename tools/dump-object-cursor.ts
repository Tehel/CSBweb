/**
 * The cursor of an object in hand: `CreateObjectCursor` (`doc/CSBwin-src/CSBCode.cpp:1976`)
 * builds it twice, and `CreateCursorBitmap` (`:2208`) picks between the two and the arrow.
 *
 * `d.Pointer23186` is the icon over a black shadow two pixels down and right.
 * `d.Pointer23190` is the same shadow under the icon's silhouette in colour 4, which every
 * light level's viewport palette keeps as it is. While the dungeon view is shown
 * (`d.DynamicPaletteSwitching`), the cursor rows on screen row 29 and below come from
 * `d.Pointer23190`, so an icon drawn through the viewport palette, whose colours 9 and 10
 * the level's monsters change (`ModifyPalettes`, `Code390e.cpp:323-343`), never shows.
 * Outside the viewport and the portraits the cursor is the arrow.
 *
 * What to look for: the copper coin's icon is mostly colour 9. Over the viewport it is a
 * colour-4 shape, over the portraits it is itself, and over the right-hand panel and the
 * message area it is the arrow.
 *
 * Run: `npx tsx tools/dump-object-cursor.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Direction, Position, type ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { DungeonState } from '../src/engine/DungeonState';
import { Party } from '../src/engine/Party';
import { createPaletteIndexViewportBuffer, type IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { createUIState, type UIState } from '../src/renderer/ui/UIState';
import { objectIconBitmap } from '../src/renderer/ui/Draw';
import { resolveObjectNameIndex } from '../src/renderer/ui/Objects';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';

/** `ui/Mouse` reaches the debug chrome through `@/ui`; see `dump-hand-owner.ts`. */
async function importMouse(): Promise<typeof import('../src/renderer/ui/Mouse')> {
  const g = globalThis as Record<string, unknown>;
  if (!g.document) g.document = { getElementById: () => null, addEventListener: () => {} };
  if (!g.window) g.window = g;
  return import('../src/renderer/ui/Mouse');
}

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
  const uiTables = extractUITables(graphics);
  const objectTables = extractObjectTables(graphics, extractViewportTables(graphics).wallRectanglesOffset);

  const party = new Party(new Position(1, 1, 0), Direction.NORTH);
  const bitmaps = new Map<number, IndexedBitmap>();
  const ui: UIState = createUIState(graphics, new DungeonState(data), {
    getGraphicBitmap: (n: number) => {
      let bitmap = bitmaps.get(n);
      if (!bitmap) {
        const image = graphics.getImage(n);
        bitmap = { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };
        bitmaps.set(n, bitmap);
      }
      return bitmap;
    },
    renderLastFrame: () => {},
  });
  ui.uiTables = uiTables;
  ui.objectTables = objectTables;
  ui.partyState = party.state;
  ui.screenIndexBuffer = createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0);
  const mouse = await importMouse();

  // ---- A copper coin from the dungeon, in hand.
  check(objectTables.objectNames[COPPER_COIN] === 'COPPER COIN', `name index ${COPPER_COIN} should be the copper coin`);
  let coin = -1;
  for (let i = 0; i < 1024 && coin < 0; i++) {
    const rn = ((CATEGORY_JUNK << 10) | i) as ObjectID;
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

  // The two cursors, from the icon: `CSBCode.cpp:1986-2025`.
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

  // ---- Over the viewport, the dungeon view shown: the silhouette throughout.
  row('viewport', 100, 100, true);
  check(offBy(100, 100, want23190) === 0, 'over the viewport the cursor should be d.Pointer23190, the colour-4 silhouette');
  check(colourCount(9) === 0, 'over the viewport no pixel of the coin should be drawn in colour 9');

  // ---- Straddling row 29: the rows above it are the icon (`:2319-2388`).
  row('split', 100, 30, true);
  check(offBy(100, 30, (x, y, sy) => (sy >= 29 ? want23190(x, y) : want23186(x, y))) === 0,
    'straddling row 29 the cursor should be d.Pointer23186 above it and d.Pointer23190 from it');

  // ---- An inventory open, no palette switching: the icon throughout.
  row('inventory', 100, 100, false);
  check(offBy(100, 100, want23186) === 0, 'with the inventory open the cursor should be d.Pointer23186, the icon');

  // ---- Over the portraits: the icon (`tag0029ba`, then `:2305` with D6 <= 0).
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

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
