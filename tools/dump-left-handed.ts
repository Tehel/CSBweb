/**
 * The left-handed screen (`src/renderer/LeftHanded.ts`): the regions of CSBWin's screen
 * moved, and a point of the canvas moved back.
 *
 * What it asserts:
 * - every `graphics.dat` under `static/gamefiles` fits it: no button the game reads in
 *   play, nor panel it draws outside the viewport, crosses a seam;
 * - the canary: the same tables with the turn-left arrow moved across the viewport's
 *   right edge do not fit, and the settings dialog's LEFT HANDED says so;
 * - the move is a bijection of each row, the way back undoes it, and `makeLeftHanded`
 *   moves every pixel where `leftHandedX` says;
 * - a click on the left-handed screen, moved back, finds the button shown there: the
 *   arrows, the spell panel, the formation and the viewport.
 *
 * Run: `npx tsx tools/dump-left-handed.ts`
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { extractUITables, type UIButton, type UITables } from '../src/data/tables/UITables';
import {
  LEFT_HANDED_VIEWPORT,
  fitsRegions,
  leftHandedFits,
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
    const crossing = rects.filter(({ rect }) => !fitsRegions(rect)).map(({ name }) => name);
    console.log(`${folder}: ${rects.length} rectangles, ${crossing.length ? `across a seam: ${crossing.join(', ')}` : 'none across a seam'}`);
    check(rects.length > 100 && leftHandedFits(tables), `${folder}'s screen can be shown left-handed`);
  }

  // ---- The canary: the turn-left arrow moved across the viewport's right edge.
  const stock = extractUITables(stockGraphics());
  const moved: UITables = structuredClone(stock);
  const turnLeft = moved.graphic231.buttons.buttons17304[0]!;
  check(turnLeft.x1 === 234 && turnLeft.y1 === 125, `buttons17304[0] is the turn-left arrow at (234,125) (${turnLeft.x1},${turnLeft.y1})`);
  turnLeft.x1 = 210;
  check(!leftHandedFits(moved), 'an arrow across the viewport\'s right edge cannot be shown left-handed');
  const leftHanded = TABS.find((t) => t.tab === 'display')!.settings.find((s) => s.name === 'LEFT HANDED');
  check(leftHanded !== undefined, 'DISPLAY has LEFT HANDED');
  check(leftHanded?.unavailable?.when({ uiTables: moved } as UIState) === true
    && leftHanded.unavailable.when({ uiTables: stock } as UIState) === false,
    'LEFT HANDED is unavailable for those tables, and available for the stock ones');
  check(fitsRegions({ x1: 0, y1: 0, x2: 319, y2: 199 }) && fitsRegions({ x1: 0, y1: 33, x2: 319, y2: 199 })
    && !fitsRegions({ x1: 0, y1: 33, x2: 319, y2: 150 }) && !fitsRegions({ x1: 270, y1: 0, x2: 280, y2: 10 }),
    'a rectangle fits when it covers each region it reaches, and not when it cuts one');

  // ---- The move, point by point and pixel by pixel.
  let bijective = true;
  let undone = true;
  for (let y = 0; y < H; y++) {
    const seen = new Set<number>();
    for (let x = 0; x < W; x++) {
      const shown = leftHandedX(x, y);
      if (shown < 0 || shown >= W) bijective = false;
      seen.add(shown);
      if (rightHandedX(shown, y) !== x) undone = false;
      // A point between pixels moves with its pixel.
      if (rightHandedX(shown + 0.5, y + 0.5) !== x + 0.5) undone = false;
    }
    if (seen.size !== W) bijective = false;
  }
  check(bijective, 'each row\'s pixels are moved one to one');
  check(undone, 'the way back undoes the move, between pixels too');
  check(leftHandedX(0, 33) === LEFT_HANDED_VIEWPORT.x1 && leftHandedX(223, 168) === LEFT_HANDED_VIEWPORT.x2
    && leftHandedX(224, 33) === 0 && leftHandedX(274, 0) === 0 && leftHandedX(0, 0) === 46 && leftHandedX(5, 169) === 5,
    'the viewport goes right, the column and the formation left, the messages stay');
  for (const shift of [0, 8]) {
    const pixels = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pixels[y * W + x] = (x >> shift) & 0xff;
    makeLeftHanded(pixels, new Uint8Array(W));
    let agrees = true;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pixels[y * W + leftHandedX(x, y)] !== ((x >> shift) & 0xff)) agrees = false;
    check(agrees, `makeLeftHanded moves every pixel where leftHandedX says (${shift ? 'high' : 'low'} byte of x)`);
  }

  // ---- A click where the left-handed screen shows a button finds it.
  const graphics = stockGraphics();
  const ui = newUIState(graphics, newGame(stockDungeon(), graphics).ctx);
  updateButtonLists(ui);
  const b = ui.uiTables.graphic231.buttons;
  const clicks: Array<[string, number, number, UIButton]> = [
    // The point shown, and the button of CSBWin's lists at the point it shows.
    ['turn right, (291-318, 125-145) shown at (67-94)', 80, 135, b.buttons17304[2]!],
    ['move forward, (263-289, 125-145) shown at (39-65)', 50, 135, b.buttons17304[1]!],
    ['the spell panel, (233-319, 42-73) shown at (9-95)', 50, 60, b.buttons17196[12]!],
    ['the formation\'s first square, (274-299, 0-13) shown at (0-25)', 10, 5, b.buttons17196[4]!],
    ['the viewport, (0-223, 33-168) shown at (96-319)', 300, 100, b.buttons17304[6]!],
  ];
  for (const [what, x, y, expected] of clicks) {
    const button = searchMouseButtons(ui, rightHandedX(x, y), y, 2);
    console.log(`  (${x},${y}) is CSBWin's (${rightHandedX(x, y)},${y}): button ${button}`);
    check(button !== 0 && button === expected.word0, `a click at (${x},${y}) finds ${what}: button ${expected.word0} (${button})`);
  }

  finish();
}

main();
