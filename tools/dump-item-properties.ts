/**
 * The eye's item properties (`showItemProperties`, `DEBT.md` X): the extra's lines under
 * CSBWin's description (`DescribeObject`, `doc/CSBwin-src/Character.cpp:3424`).
 *
 * 1. **Every object type of the default dungeon**, its CSBWin lines and the extra's, each
 *    of the extra's lines at most 18 characters, so that it never wraps. With the setting
 *    off, the panel holds CSBWin's lines alone: under its last row, the rows are the
 *    blank panel's (graphic 20). With it on, it differs from the panel off only in the
 *    rows `placeItemPropertyLines` gives the extra.
 * 2. **The layout**, on lines this tool supplies: the first at viewport y 122, the next 7
 *    rows up, and under every count of CSBWin's rows from one to five no line of the
 *    extra reaches CSBWin's last row (a line covers rows y-4 to y+1). A line that does
 *    not fit is dropped, and every line after it. Drawn, the extra's lines change no pixel
 *    of CSBWin's rows, and none outside their own rows or the panel's inner edge.
 * 3. **A viewing filter that rewrites the description hides the extra**: a DSA's
 *    `&DESCRIBE` marks the description rewritten, one that runs none does not, and a
 *    dungeon with no filter neither (`processViewingFilter`, `src/engine/DsaSystem.ts`).
 *
 * Run: `npm test -- --only=dump-item-properties.ts`
 */
import { DBType, OBJECT_ID_NULL } from '../src/core/types';
import { NO_EXTRAS, type GameContext } from '../src/engine/GameContext';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { describeObject, drawItemPropertyLines, drawObjectInfoPanel } from '../src/renderer/ui/Inventory';
import { blitBasicGraphicToViewport } from '../src/renderer/ui/Draw';
import {
  ITEM_DESCRIPTION_Y, ITEM_LINE_CHARS, ITEM_LINE_STEP, ITEM_PROPERTY_Y,
  drawItemDescriptionLine, getItemPropertyLines, getObjectDisplayName, placeItemPropertyLines,
  resolveObjectNameIndex, wrapItemDescriptionLine, type ItemDescriptionLine,
} from '../src/renderer/ui/Objects';
import type { UIState } from '../src/renderer/ui/UIState';
import { SCREEN_WIDTH, VIEWPORT_X, VIEWPORT_Y, getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';
import { globalStore, int, op, varFetch, withFilterDsas } from './lib/dsa';
import { stockGame, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';

/** The eye panel, graphic 20 at viewport (80, 52)-(223, 124), its frame's inner edge at y 123. */
const PANEL = { x1: 80, y1: 52, x2: 223, y2: 123 };
const TEXT_X = 108;

function uiFor(game: Game): UIState {
  const graphics = stockGraphics();
  const cache = new Map();
  const ui = newUIState(graphics, game.ctx, {
    getGraphicBitmap: (n, format) => getCachedGraphicBitmap(graphics, cache, n, format),
  });
  ui.partyState = game.ctx.party.state;
  return ui;
}

const setExtra = (ctx: GameContext, on: boolean): void => {
  ctx.extras = { ...NO_EXTRAS, showItemProperties: on };
};

/** The panel's pixels, row by row, in viewport rows `y1` to `y2`. */
function panelRows(ui: UIState, y1: number, y2: number): number[][] {
  const pixels = ui.screenIndexBuffer.pixels;
  const rows: number[][] = [];
  for (let y = y1; y <= y2; y++) {
    const row: number[] = [];
    for (let x = PANEL.x1; x <= PANEL.x2; x++) row.push(pixels[(VIEWPORT_Y + y) * SCREEN_WIDTH + VIEWPORT_X + x]!);
    rows.push(row);
  }
  return rows;
}

/** The viewport points where two snapshots of the whole panel differ. */
function differences(before: number[][], after: number[][]): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < before.length; r++) {
    for (let c = 0; c < before[r]!.length; c++) {
      if (before[r]![c] !== after[r]![c]) out.push({ x: PANEL.x1 + c, y: PANEL.y1 + r });
    }
  }
  return out;
}

const rowsOf = (lines: ItemDescriptionLine[]): number =>
  lines.reduce((n, line) => n + wrapItemDescriptionLine(line.text).length, 0);
const lastRowY = (lines: ItemDescriptionLine[]): number => ITEM_DESCRIPTION_Y + (rowsOf(lines) - 1) * ITEM_LINE_STEP;

const DATABASES: Array<[DBType, 'weapons' | 'clothing' | 'potions' | 'misc']> = [
  [DBType.WEAPON, 'weapons'], [DBType.CLOTHING, 'clothing'], [DBType.POTION, 'potions'], [DBType.MISC, 'misc'],
];

console.log('=== 1. every object type of the default dungeon ===');
{
  const game = stockGame();
  const ui = uiFor(game);
  const dungeon = game.ctx.dungeon;
  const seen = new Set<number>();
  let types = 0;
  let tooLong = 0;
  let offNotCsbwin = 0;
  let onOutsideRows = 0;
  for (const [db, key] of DATABASES) {
    const records = dungeon.getData().databases[key].records;
    for (let i = 0; i < records.length; i++) {
      if (records[i]!.nextObject === OBJECT_ID_NULL) continue;
      const rn = dungeon.rnMaps.rn(db, i);
      const nameIndex = resolveObjectNameIndex(ui, rn);
      if (nameIndex < 0 || seen.has(nameIndex)) continue;
      seen.add(nameIndex);
      types++;

      ui.describedObject = describeObject(ui, rn);
      const csbwin = ui.describedObject.lines;
      const extra = getItemPropertyLines(ui, rn);
      console.log(`${String(nameIndex).padStart(3)} ${getObjectDisplayName(ui, rn, nameIndex).padEnd(16)} `
        + `${csbwin.map((l) => l.text).join(' / ')}${extra.length ? `  ||  ${extra.join(' / ')}` : ''}`);
      for (const line of extra) {
        if (line.length > ITEM_LINE_CHARS) {
          tooLong++;
          console.log(`    over ${ITEM_LINE_CHARS} characters: "${line}"`);
        }
      }

      const under = lastRowY(csbwin) + 2;
      setExtra(game.ctx, false);
      drawObjectInfoPanel(ui, rn);
      const off = panelRows(ui, PANEL.y1, PANEL.y2);
      setExtra(game.ctx, true);
      drawObjectInfoPanel(ui, rn);
      const on = panelRows(ui, PANEL.y1, PANEL.y2);
      blitBasicGraphicToViewport(ui, 20, ui.uiTables.graphic232.wRectPos926, 144, 8);
      const blank = panelRows(ui, PANEL.y1, PANEL.y2);
      if (JSON.stringify(off.slice(under - PANEL.y1)) !== JSON.stringify(blank.slice(under - PANEL.y1))) {
        offNotCsbwin++;
        console.log(`    the setting off draws something under CSBWin's last row`);
      }
      const placed = placeItemPropertyLines(csbwin, extra);
      const stray = differences(off, on).filter((p) => p.x < TEXT_X || !placed.some(({ y }) => p.y >= y - 4 && p.y <= y + 1));
      if (stray.length > 0) {
        onOutsideRows++;
        console.log(`    the setting on changes ${stray.length} pixels outside the extra's rows`);
      }
    }
  }
  setExtra(game.ctx, false);
  console.log(`${types} object types`);
  check(types > 100, 'the default dungeon holds over a hundred object types');
  check(tooLong === 0, `no line of the extra is over ${ITEM_LINE_CHARS} characters`);
  check(offNotCsbwin === 0, "with the setting off, every panel holds CSBWin's lines alone: under them, the blank panel");
  check(onOutsideRows === 0, "with the setting on, a panel differs from the panel off only in the extra's rows");
}

console.log('\n=== 2. the layout, on lines this tool supplies ===');
{
  const game = stockGame();
  const ui = uiFor(game);
  const supplied = ['FIRST LINE', 'SECOND LINE', 'THIRD LINE', 'FOURTH LINE', 'FIFTH LINE', 'SIXTH 18 CHARACTER'];
  check(supplied.every((line) => line.length <= ITEM_LINE_CHARS), 'the supplied lines are at most 18 characters');
  const weight: ItemDescriptionLine = { text: 'WEIGHS 1.0 KG.', color: 13 };
  const cases: Array<[string, ItemDescriptionLine[]]> = [1, 2, 3, 4, 5].map((n) =>
    [`${n} CSBWin row${n > 1 ? 's' : ''}`, Array.from({ length: n }, () => weight)]);
  cases.push(['a wrapped phrase line and the weight', [{ text: '(POISONED, BROKEN AND CURSED)', color: 13 }, weight]]);
  let first = true;
  for (const [what, description] of cases) {
    const rows = rowsOf(description);
    const last = lastRowY(description);
    const placed = placeItemPropertyLines(description, supplied);
    console.log(`${what}: CSBWin's last row at y ${last}; the extra at ${placed.map(({ text, y }) => `${y} ${text}`).join(', ')}`);
    if (first) check(placed[0]?.y === ITEM_PROPERTY_Y, `the first line of the extra is at y ${ITEM_PROPERTY_Y}`);
    first = false;
    check(placed.every(({ y }, i) => y === ITEM_PROPERTY_Y - i * ITEM_LINE_STEP && y + 1 <= PANEL.y2),
      `${what}: the extra's lines go up from y ${ITEM_PROPERTY_Y}, 7 rows apart, inside the frame`);
    check(placed.every(({ text }, i) => text === supplied[i]), `${what}: in their priority order, the dropped ones last`);
    check(placed.length === 6 - rows, `${what}: ${6 - rows} of the extra's lines fit, the rest dropped`);
    check(placed.every(({ y }) => y - 4 > last + 1), `${what}: no line of the extra reaches CSBWin's last row`);

    const g232 = ui.uiTables.graphic232;
    blitBasicGraphicToViewport(ui, 20, g232.wRectPos926, 144, 8);
    const state = { x: VIEWPORT_X + TEXT_X, y: VIEWPORT_Y + ITEM_DESCRIPTION_Y };
    for (const line of description) drawItemDescriptionLine(ui, line.text, line.color, state);
    const before = panelRows(ui, PANEL.y1, PANEL.y2);
    drawItemPropertyLines(ui, description, supplied);
    const after = panelRows(ui, PANEL.y1, PANEL.y2);
    const changed = differences(before, after);
    check(changed.every((p) => p.y > last + 1 && p.x >= TEXT_X && p.x <= PANEL.x2 && p.y <= PANEL.y2),
      `${what}: drawn, the extra changes no pixel of CSBWin's rows, nor outside the panel's text`);
    check(placed.every(({ y }) => changed.some((p) => p.y >= y - 4 && p.y <= y + 1)),
      `${what}: each line placed is drawn in its own rows`);
  }
}

console.log('\n=== 3. a viewing filter that rewrites the description ===');
{
  /** `ESL_VIEWINGFILTER` (`doc/CSBwin-src/CSB.h:1541`). */
  const ESL_VIEWINGFILTER = 3;
  /** Parameter 0 into global 0, a DSA that changes nothing. */
  const read = [...int(1), ...int(10), op(StkOp.PARAM_FETCH), varFetch(10), globalStore(0)];
  /** `&DESCRIBE`: phrase `index` enabled (-1) or disabled (-2), in `color`. */
  const describe = (locr: number, index: number, color: number): number[] =>
    [...int(locr), ...int(index), ...int(color), op(StkOp.DESCRIBE)];
  const rewritten = (game: Game): boolean => {
    const ui = uiFor(game);
    game.ctx.party.state.selectedCharacterIndex = 1;
    const weapon = game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, 0);
    return describeObject(ui, weapon).rewritten;
  };
  const results: Array<[string, boolean, boolean]> = [
    ['no viewing filter', rewritten(stockGame()), false],
    ['a filter that runs no &DESCRIBE', rewritten(withFilterDsas(ESL_VIEWINGFILTER, [read])), false],
    ['a filter whose &DESCRIBE disables the weight', rewritten(withFilterDsas(ESL_VIEWINGFILTER, [[...read, ...describe(-2, 6, 13)]])), true],
    ['a filter whose &DESCRIBE only colours phrase 6', rewritten(withFilterDsas(ESL_VIEWINGFILTER, [[...read, ...describe(-1, 6, 5)]])), true],
  ];
  for (const [what, got, want] of results) {
    console.log(`${what}: ${got ? 'rewritten, the extra hidden' : 'let through, the extra shown'}`);
    check(got === want, `${what}: ${want ? 'rewritten' : 'let through'}`);
  }
}

finish();
