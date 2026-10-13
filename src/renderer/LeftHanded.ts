/**
 * The left-handed screen: the port's own display setting (`SettingsValues.leftHanded`),
 * for a player whose left hand would otherwise cover the dungeon view on a touch screen.
 * The panels the hand works go left, the view right:
 *
 *   CSBWin's screen                      left-handed
 *   +--------------------+---------+     +---------+--------------------+
 *   | portraits  0-273   | 274-319 |     |  0-45   | portraits  46-319  |   rows   0-32
 *   +--------------+-----+---------+     +---------+--+-----------------+
 *   | viewport     | column 224-319|     | column 0-95| viewport 96-319  |   rows  33-168
 *   +--------------+---------------+     +------------+-----------------+
 *   | messages                     |     | messages                     |   rows 169-199
 *
 * Nothing is drawn differently: CSBWin's code draws its screen where it always does, and
 * the screen composed, the regions are moved, pixel for pixel, before the cursor goes on
 * and the colours are converted (`GameScreen.presentViewport`). A point of the canvas is
 * moved back the other way before the interface sees it (`GameScreen.screenPoint`), so
 * every button list, the viewport's picking and the cursor's zones read CSBWin's screen.
 *
 * The seams are CSBWin's, from its code rather than its tables, since its code is what
 * places the regions: the viewport is 224x136 at (0, 33) (`VIEWPORT_X`, `VIEWPORT_Y`); the
 * top of the screen is rows 0-32 and the scrolling text from row 169, the rectangles it
 * clears them by (`d.wRectPos1780`, `d.wRectPos1796`, `doc/CSBwin-src/CSBCode.cpp:10666-10668`);
 * and the top view of positions starts at x 274, where the cursor stops being the hand
 * (`doc/CSBwin-src/CSBCode.cpp:2266-2285`) and a champion in hand is let go
 * (`:948-955`). Its column, `d.wRectPos1788`, reaches row 169, under the messages' first
 * row: the row is the messages'.
 *
 * A data set's `graphics.dat` carries CSBWin's button lists and panel rectangles, and
 * one could put a button across a seam, where the move would cut it in two. Such a set
 * cannot be shown left-handed (`leftHandedFits`).
 */
import type { Rect, UITables } from '../data/tables/UITables';
import { SCREEN_WIDTH, VIEWPORT_HEIGHT, VIEWPORT_WIDTH, VIEWPORT_X, VIEWPORT_Y } from './ViewportGraphics';

/** The top of the screen's last row, `d.wRectPos1780.y2`. */
const TOP_Y2 = VIEWPORT_Y - 1;
/** The viewport's last row; the scrolling text's area, `d.wRectPos1796`, starts under it. */
const MIDDLE_Y2 = VIEWPORT_Y + VIEWPORT_HEIGHT - 1;
/** Where the top view of positions starts. */
const FORMATION_X1 = 274;
/** Where the right-hand column starts, right of the viewport. */
const COLUMN_X1 = VIEWPORT_X + VIEWPORT_WIDTH;

/** A region of CSBWin's screen, ends inclusive, and how far right the left-handed screen moves it. */
interface Region extends Rect {
  readonly dx: number;
}

/** The regions that move, in pairs that swap across a band. The messages stay. */
const REGIONS: readonly Region[] = [
  { x1: 0, y1: 0, x2: FORMATION_X1 - 1, y2: TOP_Y2, dx: SCREEN_WIDTH - FORMATION_X1 },
  { x1: FORMATION_X1, y1: 0, x2: SCREEN_WIDTH - 1, y2: TOP_Y2, dx: -FORMATION_X1 },
  { x1: 0, y1: VIEWPORT_Y, x2: COLUMN_X1 - 1, y2: MIDDLE_Y2, dx: SCREEN_WIDTH - COLUMN_X1 },
  { x1: COLUMN_X1, y1: VIEWPORT_Y, x2: SCREEN_WIDTH - 1, y2: MIDDLE_Y2, dx: -COLUMN_X1 },
];

/** Where the left-handed screen shows the viewport. */
export const LEFT_HANDED_VIEWPORT: Rect = {
  x1: SCREEN_WIDTH - VIEWPORT_WIDTH,
  y1: VIEWPORT_Y,
  x2: SCREEN_WIDTH - 1,
  y2: MIDDLE_Y2,
};

/**
 * The x the left-handed screen shows CSBWin's point `(x, y)` at. Its row is the same. A
 * point between pixels, as the pointer can be, moves with the pixel it is in.
 */
export function leftHandedX(x: number, y: number): number {
  const px = Math.floor(x);
  const py = Math.floor(y);
  for (const r of REGIONS) {
    if (py >= r.y1 && py <= r.y2 && px >= r.x1 && px <= r.x2) return x + r.dx;
  }
  return x;
}

/** The x of CSBWin's screen the left-handed screen shows at `(x, y)`: `leftHandedX` undone. */
export function rightHandedX(x: number, y: number): number {
  const px = Math.floor(x);
  const py = Math.floor(y);
  for (const r of REGIONS) {
    if (py >= r.y1 && py <= r.y2 && px >= r.x1 + r.dx && px <= r.x2 + r.dx) return x - r.dx;
  }
  return x;
}

/**
 * `pixels`, CSBWin's 320x200 screen, made the left-handed screen in place: each region's
 * rows moved to where it goes, through `scratch`, a row's worth of room.
 */
export function makeLeftHanded(pixels: Uint8Array, scratch: Uint8Array): void {
  for (let y = 0; y <= MIDDLE_Y2; y++) {
    const row = y * SCREEN_WIDTH;
    scratch.set(pixels.subarray(row, row + SCREEN_WIDTH));
    for (const r of REGIONS) {
      if (y < r.y1 || y > r.y2) continue;
      pixels.set(scratch.subarray(r.x1, r.x2 + 1), row + r.x1 + r.dx);
    }
  }
}

/**
 * Whether `tables`' screen can be shown left-handed: each button the game reads in play,
 * and each panel it draws outside the viewport, lies in one region, or covers each region
 * it reaches (a list's click anywhere on the screen, or under the portraits). Left out are
 * `_DoMenu`'s buttons, only ever on a dialog, which no left-handed screen shows; the
 * rectangles CSBWin clears the regions by; and those counted from the viewport's corner
 * (the inventory's panels, `rect18576` to `rect18600`, the drop areas).
 */
export function leftHandedFits(tables: UITables): boolean {
  let fits = cache.get(tables);
  if (fits === undefined) {
    fits = playRects(tables).every(({ rect }) => fitsRegions(rect));
    cache.set(tables, fits);
  }
  return fits;
}

const cache = new WeakMap<UITables, boolean>();

/** The rectangles `leftHandedFits` asks about, by their CSBWin names. */
export function playRects(tables: UITables): Array<{ name: string; rect: Rect }> {
  const g230 = tables.graphic230;
  const g231 = tables.graphic231;
  const g232 = tables.graphic232;
  const b = g231.buttons;
  const rects: Array<{ name: string; rect: Rect }> = [];
  const add = (name: string, list: readonly Rect[]) => list.forEach((rect, i) => rects.push({ name: `${name}[${i}]`, rect }));
  // Every list `updateButtonLists` and the panels install, `_DoMenu`'s left out.
  add('buttons17196', b.buttons17196);
  add('buttons17304', b.buttons17304);
  add('buttons17796', b.buttons17796);
  add('buttons17832', b.buttons17832);
  add('buttons17760', b.buttons17760);
  add('buttons18060', b.buttons18060);
  add('buttons17952', b.buttons17952);
  add('buttons17892', b.buttons17892);
  add('buttons18216', b.buttons18216);
  add('buttons18324', b.buttons18324);
  add('buttons18372', b.buttons18372);
  add('buttons16956', b.buttons16956);
  add('moveButtons', g231.moveButtons);
  add('word18552', g231.word18552);
  add('wRectPos1454', g232.wRectPos1454);
  rects.push(
    { name: 'word20242', rect: g230.word20242 },
    { name: 'wRectPos20234', rect: g230.wRectPos20234 },
    { name: 'wRectPos20226', rect: g230.wRectPos20226 },
    { name: 'wRectPos20218', rect: g230.wRectPos20218 },
    { name: 'wRectPos20210', rect: g230.wRectPos20210 },
    { name: 'wRectPos20202', rect: g230.wRectPos20202 },
    { name: 'wRectPos624', rect: g232.wRectPos624 },
    { name: 'word12', rect: g232.word12 },
    { name: 'word20', rect: g232.word20 },
    { name: 'word28', rect: g232.word28 },
  );
  // A list's end, `(0,0)-(0,0)` and button 0, is no button.
  return rects.filter(({ rect }) => rect.x1 !== 0 || rect.x2 !== 0 || rect.y1 !== 0 || rect.y2 !== 0);
}

/** The regions of the whole screen, the messages' included. */
const ALL_REGIONS: readonly Rect[] = [
  ...REGIONS,
  { x1: 0, y1: MIDDLE_Y2 + 1, x2: SCREEN_WIDTH - 1, y2: 199 },
];

/** Whether `rect` lies in one region, or covers each region it reaches. */
export function fitsRegions(rect: Rect): boolean {
  const reached = ALL_REGIONS.filter((r) => rect.x1 <= r.x2 && rect.x2 >= r.x1 && rect.y1 <= r.y2 && rect.y2 >= r.y1);
  return reached.length <= 1
    || reached.every((r) => rect.x1 <= r.x1 && rect.x2 >= r.x2 && rect.y1 <= r.y1 && rect.y2 >= r.y2);
}
