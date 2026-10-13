/**
 * The left-handed screen: the port's own display setting (`SettingsValues.leftHanded`),
 * for a player whose left hand would otherwise cover the dungeon view on a touch screen.
 * The panels the hand works go left, the view right:
 *
 *   CSBWin's screen                         left-handed
 *   +-------------------+---+-------+       +-------+---+-------------------+
 *   | portraits 0-273   |gap|  281- |       | 0-38  |gap| portraits 46-319  |  rows   0-32
 *   +-------------+---+-+---+-------+       +-------+-+-+-+-----------------+
 *   | viewport    |gap| column 233- |       | column  |gap| viewport 96-319 |  rows  33-168
 *   +-------------+---+-------------+       +---------+---+-----------------+
 *   | messages                      |       | messages                      |  rows 169-199
 *
 * Each band is three pieces: the block on the left, the gap CSBWin leaves between it and
 * the block on the right, and that block. The left-handed screen puts the right block at
 * the screen's left edge, the gap after it and the left block after that, so the gap is
 * between the two blocks still, and each block keeps its edge of the screen. The gap is
 * moved whole, whatever it holds: Conflux draws a flame in the column's, the left columns
 * of its movement arrows' graphic.
 *
 * Nothing is drawn differently: CSBWin's code draws its screen where it always does, and
 * the screen composed, the pieces are moved, pixel for pixel, before the cursor goes on
 * and the colours are converted (`GameScreen.presentViewport`). A point of the canvas is
 * moved back the other way before the interface sees it (`GameScreen.screenPoint`), so
 * every button list, the viewport's picking and the cursor's zones read CSBWin's screen.
 *
 * The regions are CSBWin's, from its code, since its code is what places them: the
 * viewport is 224x136 at (0, 33) (`VIEWPORT_X`, `VIEWPORT_Y`); the top of the screen is
 * rows 0-32 and the scrolling text from row 169, the rectangles it clears them by
 * (`d.wRectPos1780`, `d.wRectPos1796`, `doc/CSBwin-src/CSBCode.cpp:10666-10668`); and the
 * top view of positions starts at x 274, where the cursor stops being the hand
 * (`doc/CSBwin-src/CSBCode.cpp:2276-2279`) and a champion in hand is let go (`:948-955`).
 * The right-hand column, `d.wRectPos1788`, reaches row 169, under the messages' first
 * row: the row is the messages'.
 *
 * The gaps end where the blocks on the right begin. The column's is the pen x 0xe9 its
 * panels start at: the held object's name (`DrawNameOfHeldObject`,
 * `doc/CSBwin-src/Code11f52.cpp:101-109`) and the spell panel's first champion
 * (`doc/CSBwin-src/Magic.cpp:627`). The top view's is its four squares' left edge,
 * `d.wRectPos1454` (`doc/CSBwin-src/Character.cpp:1470`), read from the data set's tables.
 *
 * A data set's `graphics.dat` carries CSBWin's button lists and panel rectangles, and
 * one could put a button across a region's edge or a gap's, where the move would cut it
 * in two. Such a set cannot be shown left-handed (`leftHandedLayout` is `null`).
 */
import type { Rect, UITables } from '../data/tables/UITables';
import { SCREEN_HEIGHT, SCREEN_WIDTH, VIEWPORT_HEIGHT, VIEWPORT_WIDTH, VIEWPORT_X, VIEWPORT_Y } from './ViewportGraphics';

/** The top of the screen's last row, `d.wRectPos1780.y2`. */
const TOP_Y2 = VIEWPORT_Y - 1;
/** The viewport's last row; the scrolling text's area, `d.wRectPos1796`, starts under it. */
const MIDDLE_Y2 = VIEWPORT_Y + VIEWPORT_HEIGHT - 1;
/** Where the top view of positions starts. */
const FORMATION_X1 = 274;
/** Where the right-hand column starts, right of the viewport. */
const COLUMN_X1 = VIEWPORT_X + VIEWPORT_WIDTH;
/** Where the column's panels start, the pen x of the held object's name. */
const COLUMN_PANELS_X1 = 0xe9;

/** A piece of CSBWin's screen, ends inclusive, and how far right the left-handed screen moves it. */
interface Piece extends Rect {
  readonly dx: number;
}

/**
 * A band of the screen: rows `y1` to `y2`, its left block up to `x - 1`, its right block
 * from `x`, whose first columns, up to `gapX2`, are the gap between the two.
 */
interface Band {
  readonly y1: number;
  readonly y2: number;
  readonly x: number;
  readonly gapX2: number;
}

/** Where the left-handed screen puts what, for one data set's tables. */
export interface LeftHandedLayout {
  readonly pieces: readonly Piece[];
}

/** Where the left-handed screen shows the viewport. */
export const LEFT_HANDED_VIEWPORT: Rect = {
  x1: SCREEN_WIDTH - VIEWPORT_WIDTH,
  y1: VIEWPORT_Y,
  x2: SCREEN_WIDTH - 1,
  y2: MIDDLE_Y2,
};

/** The two bands, the top's gap ending where `tables`' top view of positions starts. */
function bands(tables: UITables): Band[] {
  const squaresX1 = Math.min(...tables.graphic232.wRectPos1454.map((r) => r.x1));
  return [
    { y1: 0, y2: TOP_Y2, x: FORMATION_X1, gapX2: squaresX1 - 1 },
    { y1: VIEWPORT_Y, y2: MIDDLE_Y2, x: COLUMN_X1, gapX2: COLUMN_PANELS_X1 - 1 },
  ];
}

/** A band's three pieces: the right block to the left edge, the gap after it, the left block to the right edge. */
function piecesOf(band: Band): Piece[] {
  const { y1, y2, x, gapX2 } = band;
  const panelsWidth = SCREEN_WIDTH - (gapX2 + 1);
  return [
    { x1: gapX2 + 1, y1, x2: SCREEN_WIDTH - 1, y2, dx: -(gapX2 + 1) },
    { x1: x, y1, x2: gapX2, y2, dx: panelsWidth - x },
    { x1: 0, y1, x2: x - 1, y2, dx: SCREEN_WIDTH - x },
  ];
}

/**
 * The left-handed screen for `tables`, or `null` where it cannot be shown: a gap that is
 * not in its region, or a button the game reads in play, or a panel it draws outside the
 * viewport, cut by a region's edge or a gap's (`fitsLayout`).
 */
export function leftHandedLayout(tables: UITables): LeftHandedLayout | null {
  let layout = cache.get(tables);
  if (layout === undefined) {
    const found = bands(tables);
    const inRegion = found.every((b) => b.gapX2 >= b.x - 1 && b.gapX2 < SCREEN_WIDTH - 1);
    layout = inRegion && playRects(tables).every(({ rect }) => fitsBands(rect, found))
      ? { pieces: found.flatMap(piecesOf) }
      : null;
    cache.set(tables, layout);
  }
  return layout;
}

const cache = new WeakMap<UITables, LeftHandedLayout | null>();

/** Whether `tables`' screen can be shown left-handed. */
export function leftHandedFits(tables: UITables): boolean {
  return leftHandedLayout(tables) !== null;
}

/**
 * The x the left-handed screen shows CSBWin's point `(x, y)` at. Its row is the same. A
 * point between pixels, as the pointer can be, moves with the pixel it is in.
 */
export function leftHandedX(layout: LeftHandedLayout, x: number, y: number): number {
  const px = Math.floor(x);
  const py = Math.floor(y);
  for (const p of layout.pieces) {
    if (py >= p.y1 && py <= p.y2 && px >= p.x1 && px <= p.x2) return x + p.dx;
  }
  return x;
}

/** The x of CSBWin's screen the left-handed screen shows at `(x, y)`: `leftHandedX` undone. */
export function rightHandedX(layout: LeftHandedLayout, x: number, y: number): number {
  const px = Math.floor(x);
  const py = Math.floor(y);
  for (const p of layout.pieces) {
    if (py >= p.y1 && py <= p.y2 && px >= p.x1 + p.dx && px <= p.x2 + p.dx) return x - p.dx;
  }
  return x;
}

/**
 * `pixels`, CSBWin's 320x200 screen, made the left-handed screen in place: each piece's
 * rows moved to where it goes, through `scratch`, a row's worth of room.
 */
export function makeLeftHanded(layout: LeftHandedLayout, pixels: Uint8Array, scratch: Uint8Array): void {
  for (let y = 0; y <= MIDDLE_Y2; y++) {
    const row = y * SCREEN_WIDTH;
    scratch.set(pixels.subarray(row, row + SCREEN_WIDTH));
    for (const p of layout.pieces) {
      if (y < p.y1 || y > p.y2) continue;
      pixels.set(scratch.subarray(p.x1, p.x2 + 1), row + p.x1 + p.dx);
    }
  }
}

/**
 * The rectangles the layout must not cut, by their CSBWin names: each button the game
 * reads in play, and each panel it draws outside the viewport. Left out are `_DoMenu`'s
 * buttons, only ever on a dialog, which no left-handed screen shows; the rectangles
 * CSBWin clears the regions by; and those counted from the viewport's corner (the
 * inventory's panels, `rect18576` to `rect18600`, the drop areas).
 */
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

/** The five regions of the whole screen: each band's two blocks, and the messages. */
function regionsOf(found: readonly Band[]): Rect[] {
  return [
    ...found.flatMap(({ y1, y2, x }) => [{ x1: 0, y1, x2: x - 1, y2 }, { x1: x, y1, x2: SCREEN_WIDTH - 1, y2 }]),
    { x1: 0, y1: MIDDLE_Y2 + 1, x2: SCREEN_WIDTH - 1, y2: SCREEN_HEIGHT - 1 },
  ];
}

/**
 * Whether the layout leaves `rect` whole: it lies in one region, or covers each region it
 * reaches (a list's click anywhere on the screen, or under the portraits); and in a
 * block on the right, it is on one side of the gap's edge, or covers the gap from the
 * block's first column (a panel's area, its first columns the gap's).
 */
export function fitsBands(rect: Rect, found: readonly Band[]): boolean {
  const reached = regionsOf(found).filter((r) => rect.x1 <= r.x2 && rect.x2 >= r.x1 && rect.y1 <= r.y2 && rect.y2 >= r.y1);
  if (reached.length > 1) {
    return reached.every((r) => rect.x1 <= r.x1 && rect.x2 >= r.x2 && rect.y1 <= r.y1 && rect.y2 >= r.y2);
  }
  return found.every(({ y1, y2, x, gapX2 }) => rect.y2 < y1 || rect.y1 > y2 || rect.x2 < x
    || rect.x2 <= gapX2 || rect.x1 > gapX2 || rect.x1 <= x);
}

/** The bands `tables` has, for `fitsBands`. */
export function bandsOf(tables: UITables): readonly Band[] {
  return bands(tables);
}
