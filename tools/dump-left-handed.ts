/**
 * The left-handed screen (`src/renderer/LeftHanded.ts`): each band's pieces of CSBWin's
 * screen moved, the gap between its blocks kept between them, and a point of the canvas
 * moved back.
 *
 * What it asserts:
 * - every `graphics.dat` under `static/gamefiles` fits it: no button the game reads in
 *   play, nor panel it draws outside the viewport, is cut by a region's edge or a gap's,
 *   and each has the top's gap at x 274-280 and the column's at 224-232;
 * - the canaries: the same tables with the turn-left arrow moved across the viewport's
 *   right edge, or into the column's gap, or the top view's squares out of their region,
 *   do not fit, and the settings dialog's LEFT HANDED says so;
 * - the pieces' places: the blocks on the right at the left edge, the gaps after them,
 *   the blocks on the left at the right edge, the messages where they were;
 * - the move is a bijection of each row, the way back undoes it, and `makeLeftHanded`
 *   moves every pixel where `leftHandedX` says;
 * - Conflux's flame, in the column's gap of its first view (golden frame 18), is moved
 *   whole, between the column and the viewport;
 * - a click on the left-handed screen, moved back, finds the button shown there: the
 *   arrows, the spell panel, the formation and the viewport.
 *
 * Run: `npm test -- --only=dump-left-handed.ts`
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { extractUITables, type UIButton, type UITables } from '../src/data/tables/UITables';
import {
  LEFT_HANDED_VIEWPORT,
  bandsOf,
  fitsBands,
  leftHandedFits,
  leftHandedLayout,
  leftHandedX,
  makeLeftHanded,
  playRects,
  rightHandedX,
} from '../src/renderer/LeftHanded';
import { searchMouseButtons, updateButtonLists } from '../src/renderer/ui/Mouse';
import { TABS } from '../src/renderer/ui/SettingsDialog';
import type { UIState } from '../src/renderer/ui/UIState';
import { check, finish } from './lib/check';
import { GAMEFILES_DIR } from './lib/dataSets';
import { newGame, stockDungeon, stockGraphics } from './lib/game';
import { readPng } from './lib/png';
import { newUIState } from './lib/ui';

const W = 320;
const H = 200;

function main(): void {
  // ---- Every shipped graphics.dat fits.
  for (const folder of readdirSync(GAMEFILES_DIR).sort()) {
    const file = `${GAMEFILES_DIR}/${folder}/graphics.dat`;
    if (!existsSync(file)) continue;
    const graphics = new GraphicsLoader();
    graphics.loadFromArray(new Uint8Array(readFileSync(file)));
    const tables = extractUITables(graphics);
    const rects = playRects(tables);
    const bands = bandsOf(tables);
    const cut = rects.filter(({ rect }) => !fitsBands(rect, bands)).map(({ name }) => name);
    const gaps = bands.map((b) => `${b.x}-${b.gapX2}`).join(' and ');
    console.log(`${folder}: gaps ${gaps}, ${rects.length} rectangles, ${cut.length ? `cut: ${cut.join(', ')}` : 'none cut'}`);
    check(rects.length > 100 && leftHandedFits(tables), `${folder}'s screen can be shown left-handed`);
    check(gaps === '274-280 and 224-232', `${folder}'s gaps are x 274-280 at the top and 224-232 by the column (${gaps})`);
  }

  // ---- The canaries.
  const stock = extractUITables(stockGraphics());
  const altered = (change: (tables: UITables) => void): UITables => {
    const tables: UITables = structuredClone(stock);
    change(tables);
    return tables;
  };
  const turnLeft = stock.graphic231.buttons.buttons17304[0]!;
  check(turnLeft.x1 === 234 && turnLeft.y1 === 125, `buttons17304[0] is the turn-left arrow at (234,125) (${turnLeft.x1},${turnLeft.y1})`);
  const acrossViewport = altered((t) => { t.graphic231.buttons.buttons17304[0]!.x1 = 210; });
  check(!leftHandedFits(acrossViewport), 'an arrow across the viewport\'s right edge cannot be shown left-handed');
  check(!leftHandedFits(altered((t) => { t.graphic231.buttons.buttons17304[0]!.x1 = 228; })),
    'nor one from inside the column\'s gap into its panels');
  check(!leftHandedFits(altered((t) => { for (const r of t.graphic232.wRectPos1454) r.x1 = 270; })),
    'nor a top view of positions whose squares start left of x 274');
  const leftHanded = TABS.find((t) => t.tab === 'display')!.settings.find((s) => s.name === 'LEFT HANDED');
  check(leftHanded !== undefined, 'DISPLAY has LEFT HANDED');
  check(leftHanded?.unavailable?.when({ uiTables: acrossViewport } as UIState) === true
    && leftHanded.unavailable.when({ uiTables: stock } as UIState) === false,
    'LEFT HANDED is unavailable for those tables, and available for the stock ones');
  const bands = bandsOf(stock);
  check(fitsBands({ x1: 0, y1: 0, x2: 319, y2: 199 }, bands) && fitsBands({ x1: 0, y1: 33, x2: 319, y2: 199 }, bands)
    && fitsBands({ x1: 224, y1: 124, x2: 319, y2: 168 }, bands) && fitsBands({ x1: 274, y1: 0, x2: 299, y2: 13 }, bands)
    && !fitsBands({ x1: 0, y1: 33, x2: 319, y2: 150 }, bands) && !fitsBands({ x1: 270, y1: 0, x2: 280, y2: 10 }, bands),
    'a rectangle fits in one region or covering the regions it reaches, and across a gap\'s edge only from the block\'s first column');

  // ---- The pieces' places.
  const layout = leftHandedLayout(stock)!;
  const places: Array<[string, number, number, number]> = [
    ['the top view\'s squares, from 281, at the left edge', 281, 0, 0],
    ['the top\'s gap, 274-280, after them', 274, 0, 39],
    ['the gap\'s last column', 280, 32, 45],
    ['the portraits after it, to the right edge', 0, 0, 46],
    ['the column\'s panels, from 233, at the left edge', 233, 33, 0],
    ['the column\'s gap, 224-232, after them', 224, 100, 87],
    ['the gap\'s last column', 232, 168, 95],
    ['the viewport after it, to the right edge', 0, 33, LEFT_HANDED_VIEWPORT.x1],
    ['the viewport\'s last column at the right edge', 223, 168, LEFT_HANDED_VIEWPORT.x2],
    ['the messages where they were', 5, 169, 5],
  ];
  for (const [what, x, y, shown] of places) {
    check(leftHandedX(layout, x, y) === shown, `${what}: (${x},${y}) shown at x ${shown} (${leftHandedX(layout, x, y)})`);
  }

  // ---- The move, point by point and pixel by pixel.
  let bijective = true;
  let undone = true;
  for (let y = 0; y < H; y++) {
    const seen = new Set<number>();
    for (let x = 0; x < W; x++) {
      const shown = leftHandedX(layout, x, y);
      if (shown < 0 || shown >= W) bijective = false;
      seen.add(shown);
      if (rightHandedX(layout, shown, y) !== x) undone = false;
      // A point between pixels moves with its pixel.
      if (rightHandedX(layout, shown + 0.5, y + 0.5) !== x + 0.5) undone = false;
    }
    if (seen.size !== W) bijective = false;
  }
  check(bijective, 'each row\'s pixels are moved one to one');
  check(undone, 'the way back undoes the move, between pixels too');
  for (const shift of [0, 8]) {
    const pixels = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pixels[y * W + x] = (x >> shift) & 0xff;
    makeLeftHanded(layout, pixels, new Uint8Array(W));
    let agrees = true;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pixels[y * W + leftHandedX(layout, x, y)] !== ((x >> shift) & 0xff)) agrees = false;
    check(agrees, `makeLeftHanded moves every pixel where leftHandedX says (${shift ? 'high' : 'low'} byte of x)`);
  }

  // ---- Conflux's flame, the left columns of its movement arrows, in the column's gap.
  const conflux = readPng('tools/frames/18-conflux-start.png').indices;
  const flame = (pixels: Uint8Array, x1: number) => {
    let lit = 0;
    const columns: number[] = [];
    for (let y = 141; y <= 168; y++) for (let x = 0; x < 9; x++) {
      if (pixels[y * W + x1 + x] !== 0) lit++;
      columns.push(pixels[y * W + x1 + x]!);
    }
    return { lit, columns: columns.join(',') };
  };
  const before = flame(conflux, 224);
  const moved = Uint8Array.from(conflux);
  makeLeftHanded(layout, moved, new Uint8Array(W));
  const after = flame(moved, 87);
  console.log(`Conflux's flame: ${before.lit} lit pixels of the gap's 9x28, rows 141-168`);
  check(before.lit > 100 && after.columns === before.columns,
    'Conflux\'s flame is moved whole, from x 224-232 to 87-95, between the column and the viewport');
  check(moved[150 * W + 86] === conflux[150 * W + 319] && moved[150 * W + 96] === conflux[150 * W + 0],
    'the column\'s last column is left of it, the viewport\'s first right of it');

  // ---- A click where the left-handed screen shows a button finds it.
  const graphics = stockGraphics();
  const ui = newUIState(graphics, newGame(stockDungeon(), graphics).ctx);
  updateButtonLists(ui);
  const b = ui.uiTables.graphic231.buttons;
  const clicks: Array<[string, number, number, UIButton]> = [
    // The point shown, and the button of CSBWin's lists at the point it shows.
    ['turn right, (291-318, 125-145) shown at (58-85)', 80, 135, b.buttons17304[2]!],
    ['move forward, (263-289, 125-145) shown at (30-56)', 50, 135, b.buttons17304[1]!],
    ['the spell panel, (233-319, 42-73) shown at (0-86)', 50, 60, b.buttons17196[12]!],
    ['the formation\'s first square, (281-299, 0-13) shown at (0-18)', 10, 5, b.buttons17196[4]!],
    ['the viewport, (0-223, 33-168) shown at (96-319)', 300, 100, b.buttons17304[6]!],
  ];
  for (const [what, x, y, expected] of clicks) {
    const button = searchMouseButtons(ui, rightHandedX(layout, x, y), y, 2);
    console.log(`  (${x},${y}) is CSBWin's (${rightHandedX(layout, x, y)},${y}): button ${button}`);
    check(button !== 0 && button === expected.word0, `a click at (${x},${y}) finds ${what}: button ${expected.word0} (${button})`);
  }

  finish();
}

main();
