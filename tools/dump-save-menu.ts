/**
 * The save/load screen behind the disk icon — everything about it the golden frames
 * cannot see.
 *
 * `tools/check-frames.sh` can prove the *pixels* of a screen that is up, but five things
 * here are invisible to it and each one of them is a place this feature could be wrong
 * while looking right:
 *
 * 1. **The table offsets.** The disk icon's hot spot and the menu's four button-rectangle
 *    sets are read out of `graphics.dat` items 0x231 at parse time. A parser that drifted
 *    by one field would hand back plausible-looking rectangles in the wrong place, and
 *    the only symptom would be a click that does nothing. So the extracted values are
 *    asserted against the ones transcribed from CSBWin — the canary technique.
 * 2. **The layout the list panel rests on.** The panel is made by tiling graphic 0's own
 *    interior band downward over the full-width button frame. Whether that actually
 *    leaves a clean background under every row is a property of the *art*, not of the
 *    code, so the draw is run for real into a buffer and the result is inspected pixel by
 *    pixel.
 * 3. **`SplitLongLine`**, which has an edge case CSBWin does not guard (no space at or
 *    after the midpoint) and which this port reproduces rather than fixes.
 * 4. **The list logic** — ordering, the date format, what fits in 33 characters, when
 *    LOAD is inert. None of it is on screen until there are saves to list.
 * 5. **The metadata path.** A row's playthrough, level and roster come from blocks 1, 2
 *    and 4 of the CSBWin file a save is, the port's or a genuine one. Asserted against
 *    real files.
 * 6. **Entering and leaving.** The disk menu is bracketed by `TAG02076e` and `TAG0207cc`
 *    (`doc/CSBwin-src/SaveGame.cpp:860`, `:1274`). The first repacks a chest open in the
 *    inventory, which is what puts its objects in the save; the second shows the
 *    inventory again and brings the attack buttons back. Run over a real chest, with a
 *    real save restored into a fresh game. The port's quick-save repacks the chest too.
 * 8. **The one save call.** The disk menu's SAVE and F5 both go through `GameSaves.save`
 *    (`src/engine/GameSaves.ts`), which names the save and runs `SaveGame`'s tail: after
 *    the write for the menu, whose clock is stopped, and before it for F5, whose clock
 *    runs. Run against a store in memory, which two games of two data sets then share:
 *    each lists its own set's saves. F5 writes over its playthrough's quick-save, and
 *    F9 loads its playthrough's newest save. And a file that
 *    names no playthrough, loaded: its game joins the playthrough of a save of its data
 *    set and party, or draws one.
 * 9. **The store's upgrade.** The rows of the store's first version, a CSBWin file or a
 *    `.dmweb.json` around one, made today's (`src/data/saves/legacyRows.ts`). The page
 *    runs it once, inside IndexedDB's upgrade; here it runs over rows built by hand.
 * 7. **The press animation.** `_WaitForMenuSelect` paints its second pass over its first
 *    and restores the screen only after both (`doc/CSBwin-src/Menu.cpp:121-179`). The
 *    save menu redraws the whole screen on every frame of the press, so the pixels of a
 *    frame in the second pass are read back here: both passes' edges must be up.
 *
 * Run: `npx tsx tools/dump-save-menu.ts`
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, decodeObjectID, type ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { readCsbwinSaveInfo } from '../src/data/CsbwinSaveInfo';
import {
  abbreviateChampions,
  formatSaveDate,
  formatSaveRow,
  joinedPlaythrough,
  quickSlot,
  SAVE_FILE_EXTENSION,
  sortSaveEntries,
  type SaveEntry,
  type SaveStore,
} from '../src/data/saves/SaveStore';
import { upgradeSaveRecords } from '../src/data/saves/legacyRows';
import { DEFAULT_DATA_SET, dataSetFor } from '../src/data/DataSets';
import { Game } from '../src/engine/Game';
import type { GameHost, MessageSink } from '../src/engine/GameHost';
import type { LoopScript } from '../src/engine/LoopState';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { GameSaves, makeSaveFileName } from '../src/engine/GameSaves';
import { applySaveBytes, buildSaveFile } from '../src/engine/SaveGameFile';
import { loadSaveGameState } from '../src/data/SaveGameLoader';
import { readCsbwinCharacter } from '../src/data/CsbwinCharacters';
import { createPaletteIndexViewportBuffer, type IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import {
  MENU_HEIGHT,
  MENU_PANEL_COLOR,
  MENU_PRESS_PHASE_MS,
  MENU_WIDTH,
  drawMenuBitmap,
  drawMenuPress,
  menuButtonList,
  menuButtonRect,
  splitLongLine,
} from '../src/renderer/ui/Menu';
import { type UIState } from '../src/renderer/ui/UIState';
import { SCREEN_HEIGHT, SCREEN_WIDTH, VIEWPORT_X, VIEWPORT_Y } from '../src/renderer/ViewportGraphics';
import { graphicsTablesOf, newGame } from './lib/game';
import { newUIState } from './lib/ui';
import { check, finish } from './lib/check';
import { SAVE_DIR, genuineSaves } from './lib/saves';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import * as SaveMenu from '../src/renderer/ui/SaveMenu';
import * as Inventory from '../src/renderer/ui/Inventory';

const GRAPHICS = 'static/gamefiles/dm-atari/graphics.dat';
const DUNGEON = 'static/gamefiles/dm-atari/dungeon.dat';


/* ------------------------------------------------------------------------------- */

function loadGraphics(): GraphicsLoader {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(GRAPHICS))));
  return graphics;
}

/** Enough of a `UIState` to run the menu's drawing into a buffer. */
function makeDrawingUI(graphics: GraphicsLoader): UIState {
  const bitmaps = new Map<number, IndexedBitmap>();
  const ui = {
    screenIndexBuffer: createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0),
    fontData: loadFontData(graphics),
    uiTables: graphicsTablesOf(graphics).ui,
    getGraphicBitmap(graphicNum: number): IndexedBitmap | null {
      let bitmap = bitmaps.get(graphicNum);
      if (!bitmap) {
        const image = graphics.getImage(graphicNum);
        bitmap = { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };
        bitmaps.set(graphicNum, bitmap);
      }
      return bitmap;
    },
    renderLastFrame(): void {
      /* nothing to present in a tool */
    },
  };
  return ui as unknown as UIState;
}

function pixelAt(ui: UIState, x: number, y: number): number {
  const buf = ui.screenIndexBuffer!;
  return buf.pixels[y * buf.width + x];
}

/* ------------------------------------------------------- 1. the table offsets ---- */

/**
 * `buttons17760[1]` is the disk icon (`doc/CSBWIN_MENU_REFERENCE.md` -> "The disk
 * icon"), and `d.pButn18970[2][4]` are the menu's own rectangles. Both are read out of
 * `graphics.dat` item 0x231, so both are hostage to the parser's running offset.
 */
function checkButtonTables(graphics: GraphicsLoader): void {
  const buttons = graphicsTablesOf(graphics).ui.graphic231.buttons;

  console.log('=== the inventory panel\'s secondary list, `buttons17760` ===');
  console.log(['id', 'x1', 'x2', 'y1', 'y2', 'button'].join('\t'));
  for (const entry of buttons.buttons17760.slice(0, 4)) {
    console.log([entry.word0, entry.x1, entry.x2, entry.y1, entry.y2, entry.button].join('\t'));
  }

  const disk = buttons.buttons17760[1];
  check(disk.word0 === 140, `the disk icon is id 140 (got ${disk.word0})`);
  check(
    disk.x1 === 174 && disk.x2 === 182 && disk.y1 === 36 && disk.y2 === 44,
    `the disk icon sits at x 174..182, y 36..44 (got ${disk.x1}..${disk.x2}, ${disk.y1}..${disk.y2})`,
  );
  check(disk.button === 2, `the disk icon is left-click only (got ${disk.button})`);
  // Its neighbours pin the offset from the other side: a list read one entry early or
  // late would still produce a plausible 8x8 rectangle here.
  check(buttons.buttons17760[2].word0 === 145, 'the entry after the disk icon is 145, sleep');
  check(buttons.buttons17760[3].word0 === 11, 'the entry after that is 11, close inventory');

  console.log('');
  console.log('=== the menu button sets, `d.pButn18970[set][count-1]` ===');
  console.log(['set', 'options', 'ids', 'rects'].join('\t'));
  const viewport = [buttons.buttons18624, buttons.buttons18660, buttons.buttons18708, buttons.buttons18768];
  const centred = [buttons.buttons18792, buttons.buttons18828, buttons.buttons18876, buttons.buttons18936];
  for (let set = 0; set < 2; set++) {
    const lists = set === 0 ? viewport : centred;
    for (let n = 0; n < 4; n++) {
      const real = lists[n].filter((e) => e.word0 !== 0);
      console.log(
        [
          set,
          n + 1,
          real.map((e) => e.word0).join(','),
          real.map((e) => `${e.x1}..${e.x2}/${e.y1}..${e.y2}`).join(' '),
        ].join('\t'),
      );
      check(real.length === n + 1, `set ${set}, ${n + 1} options: ${real.length} live entries`);
      check(
        real.every((e, i) => e.word0 === 210 + i),
        `set ${set}, ${n + 1} options: ids run 210..${210 + n}`,
      );
      check(
        real.every((e) => e.button === 2),
        `set ${set}, ${n + 1} options: every button is left-click only`,
      );
    }
  }

  // `BLT2Screen` puts the centred menu at screen x 47 (`doc/CSBwin-src/Menu.cpp:450-458`),
  // so set 1 must be set 0 shifted by exactly that and nothing else.
  for (let n = 0; n < 4; n++) {
    const a = viewport[n].filter((e) => e.word0 !== 0);
    const b = centred[n].filter((e) => e.word0 !== 0);
    const shifted = a.every((e, i) => b[i].x1 === e.x1 + 47 && b[i].x2 === e.x2 + 47);
    const sameRows = a.every((e, i) => b[i].y1 === e.y1 && b[i].y2 === e.y2);
    check(shifted, `${n + 1} options: the centred set is the viewport set shifted +47 in x`);
    check(sameRows, `${n + 1} options: the centred set keeps the same rows`);
  }

  // The two rows the art carries, confirmed against the C++ label positions: a label is
  // drawn at y 77 and y 114 in menu coordinates, which is y 110 and 147 on screen.
  const four = viewport[3].filter((e) => e.word0 !== 0);
  check(four[0].y1 === 101 && four[0].y2 === 115, 'the four-option top row is y 101..115');
  check(four[2].y1 === 138 && four[2].y2 === 152, 'the four-option bottom row is y 138..152');
  check(
    four[2].word0 === SaveMenu.SAVE_MENU_GEOMETRY.loadButtonId && four[3].word0 === SaveMenu.SAVE_MENU_GEOMETRY.saveButtonId,
    'LOAD and SAVE take the bottom row, ids 212 and 213',
  );
}

/* -------------------------------------------------------------- 2. the layout ---- */

/**
 * Graphic 0 and the self-blit rectangles `_DoMenu` patches it with, then the real draw.
 */
function checkLayout(graphics: GraphicsLoader): void {
  const g231 = graphicsTablesOf(graphics).ui.graphic231;
  const image = graphics.getImage(0);

  console.log('');
  console.log('=== graphic 0, the dialog bitmap ===');
  console.log(`  raw (after file decompression): ${graphics.getRawGraphic(0).length} bytes`);
  console.log(`  expanded                      : ${image.width}x${image.height}`);
  check(
    image.width === MENU_WIDTH && image.height === MENU_HEIGHT,
    `graphic 0 expands to ${MENU_WIDTH}x${MENU_HEIGHT} (got ${image.width}x${image.height})`,
  );

  const rects: Array<[string, { x1: number; y1: number; x2: number; y2: number }, number[]]> = [
    ['rect18576', g231.rect18576, [0, 0, 223, 74]],
    ['rect18584', g231.rect18584, [0, 51, 223, 125]],
    ['rect18592', g231.rect18592, [102, 89, 122, 125]],
    ['rect18600', g231.rect18600, [102, 62, 122, 97]],
  ];
  console.log('  layout patch rectangles:');
  for (const [name, rect, expected] of rects) {
    console.log(`    ${name}\t(${rect.x1},${rect.y1})-(${rect.x2},${rect.y2})`);
    check(
      rect.x1 === expected[0] && rect.y1 === expected[1] && rect.x2 === expected[2] && rect.y2 === expected[3],
      `${name} is (${expected[0]},${expected[1]})-(${expected[2]},${expected[3]})`,
    );
  }

  /* ---- the panel the list is drawn on, built for real and then measured ---- */

  const ui = makeDrawingUI(graphics);
  drawMenuBitmap(ui, false);

  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  // Before the extension, the full-width button frame is in the way: the art is *not*
  // panel colour where the list's lower rows will go. If this ever stops being true the
  // extension has become unnecessary, and this tool should say so rather than pass.
  const lowerRowY = VIEWPORT_Y + g.rowFirstY + 7 * g.rowStep;
  const dirtyBefore = countNot(ui, VIEWPORT_X + g.panelInnerX1, VIEWPORT_X + g.panelInnerX2, lowerRowY - 4, lowerRowY + 1, MENU_PANEL_COLOR);
  check(dirtyBefore > 0, `the unpatched art is not clean under the last row (${dirtyBefore} pixels differ)`);

  SaveMenu.extendListPanel(ui);

  console.log('');
  console.log('=== the list panel, after tiling graphic 0\'s own interior band down ===');
  console.log(['row', 'baseline y (screen)', 'non-panel pixels'].join('\t'));
  let dirtyTotal = 0;
  const bands: Array<[string, number]> = [['header', g.headerY], ['status', g.statusY]];
  for (let row = 0; row < g.rows; row++) bands.push([`row ${row}`, g.rowFirstY + row * g.rowStep]);
  for (const [name, y] of bands) {
    const screenY = VIEWPORT_Y + y;
    // `drawTextLineIndex` puts the glyph cell at `y-4` and it is six rows tall.
    const dirty = countNot(
      ui,
      VIEWPORT_X + g.textX,
      VIEWPORT_X + g.panelInnerX2,
      screenY - 4,
      screenY + 1,
      MENU_PANEL_COLOR,
    );
    dirtyTotal += dirty;
    console.log([name, screenY, dirty].join('\t'));
  }
  check(dirtyTotal === 0, `every text row sits on clean panel background (${dirtyTotal} stray pixels)`);

  // The new bottom edge has to be the panel's own border, not a torn copy of the middle.
  const borderSrcY = VIEWPORT_Y + g.panelBottomBorderSrcY;
  const borderDstY = VIEWPORT_Y + g.panelExtendedBottomY;
  let borderMismatch = 0;
  for (let x = 0; x < MENU_WIDTH; x++) {
    if (pixelAt(ui, VIEWPORT_X + x, borderDstY) !== pixelAt(ui, VIEWPORT_X + x, borderSrcY)) borderMismatch++;
  }
  check(borderMismatch === 0, `the extended panel's bottom border matches the original (${borderMismatch} differ)`);

  // The bottom button frames must survive the tiling untouched — they are what LOAD and
  // SAVE are drawn in, and the extension stops one pixel short of them on purpose.
  const untouched = graphics.getImage(0);
  let frameDamage = 0;
  for (let y = 100; y <= 125; y++) {
    for (let x = 0; x < MENU_WIDTH; x++) {
      if (pixelAt(ui, VIEWPORT_X + x, VIEWPORT_Y + y) !== untouched.pixels[y * MENU_WIDTH + x]) frameDamage++;
    }
  }
  check(frameDamage === 0, `the bottom button frames are untouched by the extension (${frameDamage} pixels changed)`);

  // A row is 33 characters of a six-pixel cell starting at x 14; it has to stop at the
  // panel's inner right edge, not run into the border.
  const rowRight = g.textX + g.textMaxChars * 6 - 1;
  console.log('');
  console.log(`  a full row runs x ${g.textX}..${rowRight}, panel interior ends at ${g.panelInnerX2}`);
  check(rowRight <= g.panelInnerX2, `a full-width row fits inside the panel (${rowRight} <= ${g.panelInnerX2})`);
}

function countNot(ui: UIState, x1: number, x2: number, y1: number, y2: number, color: number): number {
  let count = 0;
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) if (pixelAt(ui, x, y) !== color) count++;
  }
  return count;
}

/* ------------------------------------------------------------ 3. SplitLongLine ---- */

function checkSplitLongLine(): void {
  console.log('');
  console.log('=== SplitLongLine (`doc/CSBwin-src/Menu.cpp:211`) ===');
  const cases: Array<[string, [string, string] | null]> = [
    ['SHORT ENOUGH', null],
    // 29 characters: still under the threshold.
    ['ABCDEFGHIJ ABCDEFGHIJ ABCDEFG', null],
    // 30 characters, midpoint 15 lands mid-word, so it scans on to the next space.
    ['READY TO SAVE GAME AND ALSO XX', ['READY TO SAVE GAME', 'AND ALSO XX']],
    // No space at or after the midpoint: CSBWin leaves line two empty rather than
    // breaking hard, and so does this.
    ['AAAA BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', ['AAAA BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', '']],
  ];
  for (const [input, expected] of cases) {
    const got = splitLongLine(input);
    console.log(`  ${JSON.stringify(input)} -> ${JSON.stringify(got)}`);
    check(JSON.stringify(got) === JSON.stringify(expected), `SplitLongLine(${JSON.stringify(input)})`);
  }
}

/* -------------------------------------------------------------- 4. list logic ---- */

function entry(over: Partial<SaveEntry>): SaveEntry {
  return {
    id: 'x',
    name: 'x',
    dataSet: DEFAULT_DATA_SET.id,
    playthrough: 0,
    quick: false,
    savedAt: 0,
    level: 0,
    champions: [],
    ...over,
  };
}

function checkListLogic(): void {
  console.log('');
  console.log('=== the list ===');

  // Newest first — the opposite way up from CSBWin's 'A' = oldest lettering, and the
  // reason the date replaces that letter.
  const unsorted = [
    entry({ name: 'middle', savedAt: Date.UTC(2026, 4, 2, 12) }),
    entry({ name: 'newest', savedAt: Date.UTC(2026, 8, 13, 9) }),
    entry({ name: 'oldest', savedAt: Date.UTC(2025, 0, 1, 0) }),
  ];
  const sorted = sortSaveEntries(unsorted);
  console.log(`  order: ${sorted.map((e) => e.name).join(' -> ')}`);
  check(
    sorted.map((e) => e.name).join(',') === 'newest,middle,oldest',
    'the list is ordered newest first',
  );
  check(unsorted[0].name === 'middle', 'sortSaveEntries does not mutate its argument');

  // Ties break on name, so the order cannot wobble between two listings.
  const tied = sortSaveEntries([entry({ name: 'b', savedAt: 100 }), entry({ name: 'a', savedAt: 100 })]);
  check(tied.map((e) => e.name).join(',') === 'a,b', 'saves made in the same millisecond order by name');

  // The date is local, because it is the date the player would call it.
  const local = new Date(2026, 0, 9, 23, 30);
  console.log(`  ${local.toString()} -> ${formatSaveDate(local.getTime())}`);
  check(formatSaveDate(local.getTime()) === '2026-01-09', 'the date is YYYY-MM-DD with both fields padded');
  check(formatSaveDate(Number.NaN) === '????-??-??', 'an unreadable date does not produce "Invalid Date"');

  check(abbreviateChampions(['DAROO', 'SONJA', 'LEYLA', 'ESMARDA']) === 'DAR SON LEY ESM', 'four champions abbreviate to three letters each');
  check(abbreviateChampions(['HALK']) === 'HAL', 'a lone champion still abbreviates');
  check(abbreviateChampions([]) === '', 'an empty party abbreviates to nothing');
  check(abbreviateChampions(['A', 'B', 'C', 'D', 'E']) === 'A B C D', 'only four champions are ever shown');

  console.log('');
  console.log(['row', 'chars'].join('\t'));
  const rows: SaveEntry[] = [
    entry({ savedAt: Date.UTC(2026, 8, 13, 12), level: 14, champions: ['DAROO', 'SONJA', 'LEYLA', 'ESMARDA'] }),
    entry({ savedAt: Date.UTC(2026, 8, 13, 12), level: 5, champions: ['HALK'] }),
    entry({
      savedAt: Date.UTC(2026, 8, 13, 12),
      level: 2,
      champions: ['HISSSSA', 'GOTHMOG', 'WUUF', 'ELIJA'],
    }),
  ];
  for (const row of rows) {
    const text = formatSaveRow(row);
    console.log([JSON.stringify(text), text.length].join('\t'));
    check(text.length <= SaveMenu.SAVE_MENU_GEOMETRY.textMaxChars, `"${text}" fits in ${SaveMenu.SAVE_MENU_GEOMETRY.textMaxChars} characters`);
  }
  check(formatSaveRow(rows[0]).startsWith('2026-09-13 L14 '), 'a row leads with the date and the level');

  // The file name has to be unique, because unlike CSBWin this port does not overwrite
  // one of four fixed slots.
  const at = Date.UTC(2026, 8, 13, 14, 5, 6);
  const first = makeSaveFileName(at);
  const second = makeSaveFileName(at, new Set([first]));
  const third = makeSaveFileName(at, new Set([first, second]));
  console.log('');
  console.log(`  names: ${first}, ${second}, ${third}`);
  check(first.endsWith(SAVE_FILE_EXTENSION), `a save file ends in ${SAVE_FILE_EXTENSION}`);
  check(first !== second && second !== third, 'two saves in the same second get different names');

  // A save that names no playthrough joins the newest save of its data set and its
  // party that names one.
  const party = ['DAROO', 'LEYLA'];
  const nameless = entry({ name: 'nameless', champions: party });
  const named = [
    entry({ name: 'older', playthrough: 7, savedAt: 100, champions: party }),
    entry({ name: 'newer', playthrough: 9, savedAt: 200, champions: party }),
    entry({ name: 'nameless too', playthrough: 0, savedAt: 300, champions: party }),
    entry({ name: 'one champion', playthrough: 11, savedAt: 400, champions: ['DAROO'] }),
    entry({ name: 'another order', playthrough: 12, savedAt: 500, champions: ['LEYLA', 'DAROO'] }),
    entry({ name: 'another set', playthrough: 13, savedAt: 600, dataSet: 'csb', champions: party }),
  ];
  const joins = (e: SaveEntry, rows: SaveEntry[]): number => joinedPlaythrough(e, rows);
  console.log('');
  console.log(`  a save of no playthrough, ${party.join('/')}: joins ${joins(nameless, named)} of ${named.map((e) => e.playthrough).join(', ')}; `
    + `without the newer ${joins(nameless, named.filter((e) => e.name !== 'newer'))}; with neither ${joins(nameless, named.slice(2))}`);
  check(joins(nameless, named) === 9 && joins(nameless, [...named].reverse()) === 9,
    'a save of no playthrough joins the newest save of its party that names one, in whatever order the rows come');
  check(joins(nameless, named.filter((e) => e.name !== 'newer')) === 7, 'the next newest without it');
  check(joins(nameless, named.slice(2)) === 0,
    'and none when the others name none, or are of another party, another order of it, or another data set');
  check(joins(entry({ champions: ['DAROO'] }), named) === 11 && joins(entry({ dataSet: 'csb', champions: party }), named) === 13,
    'each of those is joined by a save of its own party and set');

  // F5's slot: the playthrough's quick-save in the data set.
  const slots = [
    entry({ name: 'menu', playthrough: 7, savedAt: 900 }),
    entry({ name: 'quick, older', playthrough: 7, quick: true, savedAt: 100 }),
    entry({ name: 'quick, newer', playthrough: 7, quick: true, savedAt: 200 }),
    entry({ name: 'quick, another playthrough', playthrough: 9, quick: true, savedAt: 300 }),
    entry({ name: 'quick, another set', playthrough: 7, quick: true, dataSet: 'csb', savedAt: 400 }),
    entry({ name: 'quick, no playthrough', playthrough: 0, quick: true, savedAt: 500 }),
  ];
  const slot = (dataSet: string, playthrough: number): string => quickSlot(slots, dataSet, playthrough)?.name ?? 'none';
  console.log(`  F5's slot: playthrough 7 "${slot(DEFAULT_DATA_SET.id, 7)}", 9 "${slot(DEFAULT_DATA_SET.id, 9)}", 7 in csb "${slot('csb', 7)}", 8 "${slot(DEFAULT_DATA_SET.id, 8)}", 0 "${slot(DEFAULT_DATA_SET.id, 0)}"`);
  check(slot(DEFAULT_DATA_SET.id, 7) === 'quick, newer', 'F5\'s slot is the playthrough\'s newest quick-save, never the menu\'s save');
  check(slot(DEFAULT_DATA_SET.id, 9) === 'quick, another playthrough' && slot('csb', 7) === 'quick, another set',
    'each playthrough has its own, in its own data set');
  check(slot(DEFAULT_DATA_SET.id, 8) === 'none' && slot(DEFAULT_DATA_SET.id, 0) === 'none',
    'a playthrough not quick-saved yet has none, and playthrough 0 never has one');
}

/* ------------------------------------------------------------- 5. the metadata ---- */

function healthyChampion(name: string): Champion {
  return {
    ...addCharacterDefaults(),
    name,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: 0,
  };
}

async function loadGame(host?: Partial<GameHost>): Promise<Game> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve(DUNGEON))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = loadGraphics();

  return newGame(data, graphics, host);
}

/**
 * A real save, built from a real engine, then read the way a row is: from blocks 1, 2
 * and 4 of the file.
 */
async function checkSaveFile(): Promise<void> {
  console.log('');
  console.log('=== a real save, and the row its file gives ===');

  const game = await loadGame();
  game.ctx.party.state.position = new Position(7, 11, 9);
  game.ctx.party.state.champions = [healthyChampion('DAROO'), healthyChampion('LEYLA')];

  const bytes = buildSaveFile(game);
  const info = readCsbwinSaveInfo(bytes);
  const playthrough = game.ctx.state.block1.randomGameID;
  console.log(`  file            : ${bytes.length} bytes`);
  // The id is drawn afresh by every new game, so it is compared and not printed.
  console.log(`  listed          : ${info ? `level ${info.level}, ${info.champions.join('/')}, ${info.randomGameID === playthrough ? 'the game\'s' : 'ANOTHER'} d.RandomGameID` : 'NOT A SAVE'}`);
  check(info?.level === 9, `the file's GAMEBLOCK2 gives the party's level (got ${info?.level})`);
  check(
    info?.champions.join('/') === 'DAROO/LEYLA',
    `and its block 4 the roster (got ${info?.champions.join('/')})`,
  );
  check(info?.randomGameID === playthrough, 'and its GAMEBLOCK1 the game\'s d.RandomGameID');

  // What is not a CSBWin file is refused in a line the menu can show.
  let refused = '';
  try {
    applySaveBytes(await loadGame(), new TextEncoder().encode('{"raw":""}'));
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  console.log(`  not a save      : ${refused}`);
  check(refused.startsWith('CSBWIN SAVE:'), 'a file that is not a CSBWin save is refused: CSBWIN SAVE: ...');
}

/** The genuine CSBWin saves in the repository, listed the way the menu would list them. */
function checkCsbwinListing(): void {
  console.log('');
  console.log('=== genuine CSBWin saves, as the menu would list them ===');
  const { statSync } = require('node:fs') as typeof import('node:fs');
  const paths = genuineSaves();
  check(paths.length > 0, `${SAVE_DIR} holds at least one genuine save`);

  console.log(['file', 'row'].join('\t'));
  for (const path of paths) {
    const file = basename(path);
    const info = readCsbwinSaveInfo(new Uint8Array(readFileSync(path)));
    check(info !== null, `${file}: blocks 2 and 4 read`);
    if (!info) continue;
    const row = formatSaveRow(entry({
      id: file,
      name: file,
      savedAt: statSync(path).mtimeMs,
      level: info.level,
      champions: info.champions,
    }));
    console.log([file, JSON.stringify(row)].join('\t'));
    check(info.level >= 0 && info.level < 64, `${file}: level ${info.level} is plausible`);
    check(info.champions.length >= 1 && info.champions.length <= 4, `${file}: 1..4 champions`);
    check(
      info.champions.every((n) => n.length > 0 && !n.includes('?')),
      `${file}: every champion name is printable ASCII`,
    );
    check(info.randomGameID !== 0, `${file}: a playthrough, d.RandomGameID ${info.randomGameID}`);
  }

  // Not a save at all: it has no row, rather than a row of nonsense.
  check(readCsbwinSaveInfo(new Uint8Array(16)) === null, 'a file that is not a save reads back as null');
}

/* ------------------------------------------------- 6. entering and leaving ---- */

/** The objects in a chest's own chain, as a save writes them. */
function chestContents(game: Game, chest: ObjectID): number {
  const record = game.ctx.dungeon.getContainerRecord(chest);
  let n = 0;
  for (let rn = record?.containedObject ?? OBJECT_ID_EOF; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = game.ctx.dungeon.getDBRecordLink(rn)) n++;
  return n;
}

/** The first chest lying in a cell of `dungeon.dat` with at least two objects in it. */
function findChest(game: Game): { chest: ObjectID; cell: Position } | null {
  for (let level = 0; level < game.ctx.dungeon.getMapCount(); level++) {
    const map = game.ctx.dungeon.getMap(level);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const cell = new Position(x, y, level);
        for (let rn = game.ctx.dungeon.findFirstObject(cell); rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
          if (decodeObjectID(rn).category === DBType.CHEST && chestContents(game, rn) >= 2) return { chest: rn, cell };
        }
      }
    }
  }
  return null;
}

/**
 * A chest in the weapon hand of the champion whose inventory is open, opened by the
 * inventory's own draw, then the disk menu over it.
 */
async function checkEnterAndLeave(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== the disk menu over an open chest: TAG02076e in, TAG0207cc out ===');
  const game = await loadGame();
  game.systems.hallOfChampions.addChampion(healthyChampion('DAROO'));
  const party = game.ctx.party.state;
  const found = findChest(game);
  if (!found) { check(false, 'dungeon.dat has a chest with two objects in it'); return; }
  const { chest, cell } = found;
  const packed = chestContents(game, chest);
  game.ctx.dungeon.removeObjectFromCell(cell, chest);
  party.champions[0]!.possessions[1] = chest;
  party.magicCasterIndex = 0;
  party.selectedCharacterIndex = 0;

  const ui = newUIState(graphics, game.ctx);
  ui.partyState = party;
  // An attack has just been made: `TAG01b1c0` closed the menu, and the tick that brings
  // the buttons back has not run.
  ui.word20252 = 0;
  ui.word20250 = 1;
  const draw = (): void => {
    // `drawInventoryScreen`'s state half: open the chest in the weapon hand, and leave
    // `d.DisplayResurrectChestOrScroll` at 4 behind it.
    const view = Inventory.getActiveChestView(ui, party.champions[0]!);
    Inventory.syncOpenChest(ui, view);
    ui.displayResurrectChestOrScroll = view?.source === 'hand' ? 4 : 0;
  };
  draw();
  console.log(`  chest ${chest} from (${cell.x},${cell.y}) level ${cell.z}: ${packed} objects; open, it holds ${chestContents(game, chest)}`);
  check(ui.openChestId === chest && chestContents(game, chest) === 0, 'the open chest\'s objects are out of its chain');

  SaveMenu.openSaveMenu(ui);
  console.log(`  menu up: open chest ${ui.openChestId}, the chest holds ${chestContents(game, chest)}`);
  check(ui.openChestId === null && chestContents(game, chest) === packed,
    'TAG02076e repacks it (Character.cpp:5116-5125): the chest holds its objects again');

  const fresh = await loadGame();
  applySaveBytes(fresh, buildSaveFile(game));
  const saved = chestContents(fresh, chest);
  console.log(`  a save taken now, restored into a fresh game: the chest holds ${saved}`);
  check(saved === packed, 'so a save taken with the menu up keeps the chest\'s objects');

  SaveMenu.closeSaveMenu(ui);
  console.log(`  menu gone: inventory ${party.selectedCharacterIndex}, caster ${party.magicCasterIndex}, word20252 ${ui.word20252}, word20250 ${ui.word20250}`);
  check(party.selectedCharacterIndex === 0 && party.magicCasterIndex === 0,
    'TAG0207cc shows the inventory again and keeps the living caster (CSBCode.cpp:9945-9958)');
  check(ui.word20252 === 1, 'and, with no attack menu open, brings the attack buttons back (d.Word20252 = 1)');
  check(ui.word20250 === 0,
    'its DrawLegalAttackTypes owes the panel nothing more, so no damage is flashed at the next tick (CSBCode.cpp:8793)');
  draw();
  check(ui.openChestId === chest && chestContents(game, chest) === 0, 'the next draw opens the chest again');

  // The load-only screen is `_ReadEntireGame`, which calls neither.
  ui.word20252 = 0;
  ui.word20250 = 1;
  SaveMenu.openSaveMenu(ui, 'loadOnly');
  check(ui.openChestId === chest, 'the load-only screen leaves the chest open');
  SaveMenu.closeSaveMenu(ui);
  check(ui.word20252 === 0 && ui.word20250 === 1, 'and, closing, leaves the attack panel alone');
}

/**
 * A save store in memory. `onWrite` runs as a write arrives, before it is kept; a store
 * made to `fail` rejects every write; `onList` runs as the store is listed.
 */
function memoryStore(
  onWrite: () => void = () => {},
  fail = false,
  onList: () => void = () => {},
): SaveStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const entries = new Map<string, SaveEntry>();
  return {
    files,
    list: async (dataSet) => {
      onList();
      return sortSaveEntries([...entries.values()].filter((e) => dataSet === null || e.dataSet === dataSet));
    },
    read: async (id) => {
      const bytes = files.get(id);
      if (!bytes) throw new Error(`no save ${id}`);
      return bytes;
    },
    write: async (written, bytes) => {
      onWrite();
      if (fail) throw new Error('the store is full');
      files.set(written.id, bytes);
      entries.set(written.id, written);
    },
  };
}

/**
 * The quick-save (`GameSaves.quickSave`), which CSBWin does not have, over the same open
 * chest: it must repack it as the disk menu does, or the save restores the chest empty.
 */
async function checkQuickSaveOverOpenChest(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== the quick-save over an open chest ===');
  const game = await loadGame();
  game.systems.hallOfChampions.addChampion(healthyChampion('DAROO'));
  const party = game.ctx.party.state;
  const found = findChest(game);
  if (!found) { check(false, 'dungeon.dat has a chest with two objects in it'); return; }
  const { chest, cell } = found;
  const packed = chestContents(game, chest);
  game.ctx.dungeon.removeObjectFromCell(cell, chest);
  party.champions[0]!.possessions[1] = chest;
  party.selectedCharacterIndex = 0;

  const ui = newUIState(graphics, game.ctx);
  ui.partyState = party;
  const draw = (): void => {
    Inventory.syncOpenChest(ui, Inventory.getActiveChestView(ui, party.champions[0]!));
  };
  draw();
  check(ui.openChestId === chest && chestContents(game, chest) === 0, 'the open chest\'s objects are out of its chain');

  // F5's save, to a store in memory instead of the page's.
  const store = memoryStore();
  const saves = new GameSaves(game, DEFAULT_DATA_SET, store, {
    portraitOf: () => undefined,
    repackOpenChest: () => Inventory.repackOpenChest(ui),
  }, () => {});
  const row = await saves.save('running', true);
  const fresh = await loadGame();
  applySaveBytes(fresh, await store.read(row.id));
  const saved = chestContents(fresh, chest);
  console.log(`  quick-saved with the chest open, restored into a fresh game: the chest holds ${saved} of ${packed}`);
  check(saved === packed, 'the quick-save repacks the chest: the restored chest holds its objects');
  draw();
  check(ui.openChestId === chest && chestContents(game, chest) === 0, 'and the next draw opens the chest again');
}

/* ----------------------------------------------------- 7. the press animation ---- */

/**
 * A press on SAVE, drawn as the save menu draws it: onto a fresh screen each frame. The
 * screen is a colour none of the edges use, so every pixel the press leaves is its own.
 */
function checkPressAnimation(graphics: GraphicsLoader): void {
  console.log('');
  console.log('=== the press animation (`doc/CSBwin-src/Menu.cpp:100-180`) ===');
  const ui = makeDrawingUI(graphics);
  const saveId = SaveMenu.SAVE_MENU_GEOMETRY.saveButtonId;
  const rect = menuButtonRect(menuButtonList(ui, 4, false), saveId);
  if (!rect) { check(false, `the four-option set has button ${saveId}`); return; }
  const press = { buttonId: saveId, rect, startedMs: 0 };
  const SCREEN = 7;
  const frame = (elapsed: number): Uint8Array => {
    ui.screenIndexBuffer!.pixels.fill(SCREEN);
    drawMenuPress(ui, press, elapsed);
    return ui.screenIndexBuffer!.pixels.slice();
  };
  const passA = frame(0);
  const passB = frame(MENU_PRESS_PHASE_MS);
  const after = frame(MENU_PRESS_PHASE_MS * 2);

  // `rect34`, grown as `Menu.cpp:103-106` grows it.
  const x1 = rect.x1 - 3;
  const x2 = rect.x2 + 3;
  const y1 = rect.y1 - 3;
  const y2 = rect.y2 + 4;
  const w = ui.screenIndexBuffer!.width;
  const at = (pixels: Uint8Array, x: number, y: number): number => pixels[y * w + x];
  const count = (pixels: Uint8Array, xa: number, xb: number, ya: number, yb: number, color: number): number => {
    let wrong = 0;
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) if (at(pixels, x, y) !== color) wrong++;
    return wrong;
  };
  const changed = (pixels: Uint8Array): number => pixels.reduce((n, p) => n + (p === SCREEN ? 0 : 1), 0);
  console.log(`  SAVE at (${rect.x1},${rect.y1})-(${rect.x2},${rect.y2}), grown to (${x1},${y1})-(${x2},${y2})`);
  console.log(`  pixels painted: first pass ${changed(passA)}, second pass ${changed(passB)}, after ${changed(after)}`);

  // The first pass alone: its four edges, and nothing of the second's yet.
  check(count(passA, x1, x2 - 1, y1, y1, 5) === 0, 'first pass: the top row is colour 5 (Menu.cpp:123-125)');
  check(count(passA, x1, x1, y1, y2 - 2, 5) === 0, 'first pass: the left column is colour 5 (:126-129)');
  check(count(passA, x1 - 2, x2, y2 - 1, y2 - 1, 0) === 0, 'first pass: the row above the bottom is colour 0 (:130-134)');
  check(count(passA, x2, x2, y1, y2, 0) === 0, 'first pass: the right column is colour 0 (:135-137)');
  check(at(passA, x1 + 2, y1 + 1) === SCREEN && at(passA, x2 + 3, y1) === SCREEN, 'first pass: the second pass is not up yet');

  // The second pass, over the first: the first pass's edges are still there, except
  // where the second paints over them (column x2-1 crosses the top row, column x1+1 the
  // row above the bottom).
  check(count(passB, x1, x2 - 2, y1, y1, 5) === 0, 'second pass: the first pass\'s top row is still colour 5');
  check(count(passB, x1, x1, y1, y2 - 2, 5) === 0, 'second pass: the first pass\'s left column is still colour 5');
  check(count(passB, x2, x2, y1, y2, 0) === 0, 'second pass: the first pass\'s right column is still colour 0');
  check(
    count(passB, x1 - 2, x1, y2 - 1, y2 - 1, 0) === 0 && count(passB, x1 + 2, x2, y2 - 1, y2 - 1, 0) === 0,
    'second pass: the first pass\'s row above the bottom is still colour 0',
  );
  check(count(passB, x1, x2 - 2, y1 + 1, y1 + 1, 5) === 0, 'second pass: its own top row is colour 5 (:139-143)');
  // Its row above the bottom, drawn after it, crosses it at y2-2.
  check(
    count(passB, x1 + 1, x1 + 1, y1, y2 - 3, 5) === 0 && at(passB, x1 + 1, y2 - 1) === 5,
    'second pass: its own left column is colour 5 (:144-148)',
  );
  check(count(passB, x2 - 1, x2 - 1, y1, y2, 0) === 0, 'second pass: its own right column is colour 0 (:149-152)');
  check(count(passB, x1 + 1, x2, y2 - 2, y2 - 2, 0) === 0, 'second pass: its own row above the bottom is colour 0 (:153-157)');
  check(count(passB, x1 - 1, x2 + 2, y2 + 2, y2 + 2, 13) === 0, 'second pass: the highlight below is colour 13 (:158-163)');
  check(count(passB, x2 + 3, x2 + 3, y1, y2 + 2, 13) === 0, 'second pass: the highlight to the right is colour 13 (:164-168)');

  // The boot's `waitForMenuSelect` paints the first pass into the screen and the second
  // over it, without a redraw between them; a fresh screen must come out the same.
  ui.screenIndexBuffer!.pixels.set(passA);
  drawMenuPress(ui, press, MENU_PRESS_PHASE_MS);
  const layered = ui.screenIndexBuffer!.pixels;
  check(layered.every((p, i) => p === passB[i]), 'the second pass on a fresh screen is the second pass over the first');

  check(changed(after) === 0, 'after both passes nothing is painted: the saved screen is back (:170-179)');
}

/* ------------------------------------------------------ 8. the one save call ---- */

/**
 * `GameSaves.save` as the disk menu calls it (the clock stopped) and as F5 does (the
 * clock running). The tail is seen through `d.CanRestartFromSavegame`, which a new game
 * has at 0 and `SaveGame`'s tail sets (`doc/CSBwin-src/SaveGame.cpp:1260`). Then one
 * store under two games of two data sets.
 */
async function checkSaveCall(): Promise<void> {
  console.log('');
  console.log('=== the one save call (`GameSaves.save`) ===');
  // What F5 and F9 leave behind: a line in the message area, each after a linefeed, and
  // one for the console.
  const told: string[] = [];
  const reports: string[] = [];
  const messages: MessageSink = {
    printLinefeed: () => { told.push('\n'); },
    quePrintLines: (color, text) => { told.push(`${color}:${text}`); },
    printLines: () => {},
    setNewSpeed: () => {},
    resetTime: () => {},
    clockTick: () => {},
    printNextQueued: () => {},
    vblInterrupt: () => {},
  };
  const toldSince = (from: number): string => told.slice(from).join('').replace(/\n/g, '/');
  const stage = async (fail: boolean, dataSet = DEFAULT_DATA_SET, shared?: ReturnType<typeof memoryStore>, name = 'DAROO') => {
    const game = await loadGame({ messages });
    game.systems.hallOfChampions.addChampion(healthyChampion(name));
    let tailAtWrite: boolean | null = null;
    const store = shared ?? memoryStore(() => { tailAtWrite = game.canRestartFromSavegame(); }, fail);
    const saves = new GameSaves(game, dataSet, store, { portraitOf: () => undefined, repackOpenChest: () => {} },
      (message: string) => { reports.push(message); });
    return { game, store, saves, tailAtWrite: (): boolean | null => tailAtWrite };
  };
  const attempt = async (save: Promise<unknown>): Promise<string> => save.then(() => 'written', (error: Error) => `refused (${error.message})`);

  // Every save here is made in the same second until the clock is moved, so only the
  // rule tells their names apart.
  const realNow = Date.now;
  let now = Date.UTC(2026, 8, 13, 14, 5, 6);
  Date.now = () => now;
  try {
    const menu = await stage(false);
    const first = await menu.saves.save('stopped', false);
    console.log(`  clock stopped: tail run at the write ${menu.tailAtWrite()}, after it ${menu.game.canRestartFromSavegame()}`);
    check(menu.tailAtWrite() === false && menu.game.canRestartFromSavegame(),
      'the menu\'s save runs its tail once the file is written (SaveGame.cpp:1245-1260)');
    const second = await menu.saves.save('stopped', false);
    const third = await menu.saves.save('running', true);
    console.log(`  names: ${first.name}, ${second.name}, ${third.name}`);
    check(first.name === makeSaveFileName(Date.now()), 'a save in an empty store takes the plain name');
    check(second.name === makeSaveFileName(Date.now(), new Set([first.name]))
      && third.name === makeSaveFileName(Date.now(), new Set([first.name, second.name])),
      'the store is listed, and its names are not taken again');
    check(menu.store.files.size === 3, 'so three saves in one second are three files');
    const listed = (await menu.saves.list()).find((e) => e.id === first.id);
    check(listed?.level === first.level && listed?.champions.join() === 'DAROO' && first.savedAt === Date.now(),
      'the row is the file\'s level and party, and the date of the save');
    const playthrough = menu.game.ctx.state.block1.randomGameID;
    console.log(`  the row: data set ${first.dataSet}, ${first.playthrough === playthrough ? 'the game\'s' : 'ANOTHER'} playthrough, quick ${first.quick}; F5's: quick ${third.quick}`);
    check(first.dataSet === DEFAULT_DATA_SET.id, 'the row names the game\'s data set');
    check([first, second, third].every((e) => e.playthrough === playthrough),
      'and its playthrough, the game\'s d.RandomGameID, as the file holds it');
    check(!first.quick && !second.quick && third.quick, 'and whether the save is F5\'s or the menu\'s');

    // A second F5 writes over the first: the playthrough has one slot.
    now += 60_000;
    const fourth = await menu.saves.save('running', true);
    const afterSlot = await menu.saves.list();
    console.log(`  F5 again, a minute later: ${fourth.id === third.id ? 'the same row' : 'ANOTHER ROW'}, ${menu.store.files.size} files, listed ${afterSlot[0]?.id === third.id ? 'first' : 'NOT FIRST'}`);
    check(fourth.id === third.id && fourth.name === third.name && menu.store.files.size === 3,
      'F5 writes over the playthrough\'s quick-save, under its key and its name');
    check(fourth.savedAt === now && afterSlot[0]?.id === third.id && afterSlot[0]?.savedAt === now,
      'which takes the new save\'s date, and is listed first');
    check(afterSlot.filter((e) => !e.quick).map((e) => e.id).sort().join() === [first.id, second.id].sort().join()
      && afterSlot.filter((e) => !e.quick).every((e) => e.savedAt < now),
      'and the menu\'s saves are as they were');
    const fifth = await menu.saves.save('stopped', false);
    check(fifth.id !== third.id && menu.store.files.size === 4, 'the menu\'s SAVE still makes a row of its own');
    now -= 60_000;

    const menuFails = await stage(true);
    const refused = await attempt(menuFails.saves.save('stopped', false));
    console.log(`  clock stopped, the write fails: ${refused}, tail run ${menuFails.game.canRestartFromSavegame()}`);
    check(refused !== 'written' && !menuFails.game.canRestartFromSavegame(),
      'a failed write skips the tail, as SaveError jumps past it (SaveGame.cpp:1264)');

    const quick = await stage(false);
    await quick.saves.save('running', true);
    console.log(`  clock running: tail run at the write ${quick.tailAtWrite()}`);
    check(quick.tailAtWrite() === true, 'F5\'s save runs its tail before the write, on the world the file holds');

    const quickFails = await stage(true);
    const refusedQuick = await attempt(quickFails.saves.save('running', true));
    console.log(`  clock running, the write fails: ${refusedQuick}, tail run ${quickFails.game.canRestartFromSavegame()}`);
    check(refusedQuick !== 'written' && quickFails.game.canRestartFromSavegame(), 'and has run it when the write fails');

    // F5 lists the store while the game runs on, and the file is made before that.
    const slowGame = await loadGame({ messages });
    slowGame.systems.hallOfChampions.addChampion(healthyChampion('DAROO'));
    const champion = slowGame.ctx.party.state.champions[0]!;
    const atTheKey = champion.attributes.health;
    const slow = memoryStore(() => {}, false, () => { champion.attributes.health = 1; });
    const slowSaves = new GameSaves(slowGame, DEFAULT_DATA_SET, slow, { portraitOf: () => undefined, repackOpenChest: () => {} }, () => {});
    const late = await slowSaves.save('running', true);
    const held = readCsbwinCharacter(loadSaveGameState(await slow.read(late.id)).characterBlock!, 0).champion.attributes.health;
    console.log(`  clock running, a champion hurt while the store is listed: health ${atTheKey} at the key, ${held} in the file`);
    check(held === atTheKey, 'F5\'s file holds the party as it stood at the key, with the dungeon it was saved with');

    // A read through the owner, and what the boot's chooser then learns of it.
    const reader = await stage(false);
    check(reader.saves.consumeSavedGameRead() === 'cancelled', 'no read yet: the chooser was cancelled');
    reader.saves.read(await menu.saves.open(first));
    const afterRead = reader.saves.consumeSavedGameRead();
    reader.saves.readFailed();
    const afterFailure = reader.saves.consumeSavedGameRead();
    console.log(`  the chooser's read: ${afterRead}, then ${afterFailure}, then ${reader.saves.consumeSavedGameRead()}; d.CanRestartFromSavegame ${reader.game.canRestartFromSavegame()}`);
    check(afterRead === 'loaded' && reader.game.canRestartFromSavegame(),
      'a read restores the save into the game (SaveGame.cpp:1883) and is \'loaded\'');
    check(afterFailure === 'damaged' && reader.saves.consumeSavedGameRead() === 'cancelled',
      'a failed one is \'damaged\', and each is forgotten once asked for');
    check(told.length === 0 && reports.length === 0, 'none of it is told in the message area: only F5 and F9 are');

    // F5 where the disk icon does nothing (`doc/CSBwin-src/Mouse.cpp:1716-1718`): a
    // champion still being chosen, whom a file would bring back as a member, or no party.
    // And F5 and F9 while a script holds the loop. Each says so in the message area.
    const choosing = await stage(false);
    choosing.game.ctx.party.state.potentialChampionIndex = 0;
    await choosing.saves.quickSave();
    const nobody = await stage(false);
    nobody.game.ctx.party.state.champions = [];
    await nobody.saves.quickSave();
    const refusals = toldSince(0);
    console.log(`  F5 with a champion being chosen, then with no party: ${refusals}`);
    check(refusals === '/15:CANNOT SAVE NOW/15:CANNOT SAVE NOW',
      'F5 saves nothing while a champion is being chosen, nor with no party, and says so on a line of its own');
    check(!choosing.game.canRestartFromSavegame() && !nobody.game.canRestartFromSavegame(),
      'and the save\'s tail has not run');

    const scripted = await stage(false);
    function* hold(): LoopScript {
      for (;;) yield 1;
    }
    scripted.game.runScript(hold());
    const beforeScript = told.length;
    await scripted.saves.quickSave();
    await scripted.saves.quickLoad();
    console.log(`  F5, then F9, while a script holds the loop: ${toldSince(beforeScript)}`);
    check(scripted.game.isRunningScript() && toldSince(beforeScript) === '/15:CANNOT SAVE NOW/15:CANNOT LOAD NOW',
      'neither key does anything while a script holds the loop, and each says so');
    check(!scripted.game.canRestartFromSavegame(), 'and the save\'s tail has not run');
    console.log(`  and for the console: ${reports.join(' | ')}`);
    check(reports.length === 4 && reports.slice(0, 3).every((report) => report.startsWith('Quick-save refused'))
      && reports[3]!.startsWith('Quick-load refused'), 'each refusal is a line for the console too');

    // F5 with a party, where the store cannot be written.
    const unwritable = await stage(true);
    const beforeFailure = told.length;
    await unwritable.saves.quickSave();
    console.log(`  F5 where the store cannot be written: ${toldSince(beforeFailure)} (${reports[4]})`);
    check(toldSince(beforeFailure) === '/15:UNABLE TO SAVE GAME!' && reports.length === 5 && reports[4] === 'Quick-save failed',
      'a write that fails is SaveError\'s line (SaveGame.cpp:1266), and its error is reported');

    // One store, two data sets: a game lists, and F9 loads, its own set's saves.
    console.log('');
    console.log('=== one store, two data sets ===');
    const shared = memoryStore();
    const csbSet = dataSetFor('csb');
    const dm = await stage(false, DEFAULT_DATA_SET, shared, 'DAROO');
    const csb = await stage(false, csbSet, shared, 'LEYLA');
    const dmOld = await dm.saves.save('stopped', false);
    const csbSame = await csb.saves.save('stopped', false);
    now += 60_000;
    const dmNew = await dm.saves.quickSave().then(async () => (await dm.saves.list())[0]!);
    now += 60_000;
    const csbNew = await csb.saves.save('stopped', false);
    const names = (entries: SaveEntry[]): string => entries.map((e) => e.name).join(', ');
    const dmList = await dm.saves.list();
    const csbList = await csb.saves.list();
    console.log(`  ${DEFAULT_DATA_SET.id}: ${names(dmList)}`);
    console.log(`  ${csbSet.id}: ${names(csbList)}`);
    console.log(`  every set: ${(await shared.list(null)).length} rows`);
    check(csbSet.id === 'csb' && dmList.length === 2 && dmList.every((e) => e.dataSet === DEFAULT_DATA_SET.id)
      && dmList[0]!.id === dmNew.id && dmList[1]!.id === dmOld.id,
      'a game lists its own data set\'s saves, newest first');
    check(csbList.length === 2 && csbList.every((e) => e.dataSet === csbSet.id) && csbList[0]!.id === csbNew.id,
      'and the other set\'s game lists the other set\'s');
    check((await shared.list(null)).length === 4, 'the store lists every set\'s when asked for none');
    check(csbSame.name !== dmOld.name && shared.files.size === 4,
      'a name taken in one set is not taken again in another: a row\'s name is its key');
    check(dmNew.quick && dm.game.ctx.state.block1.randomGameID !== csb.game.ctx.state.block1.randomGameID
      && dmNew.playthrough === dm.game.ctx.state.block1.randomGameID && csbNew.playthrough === csb.game.ctx.state.block1.randomGameID,
      'two new games are two playthroughs, each on its own saves');

    // F9 in the first set's game: its playthrough's newest save, though the store's
    // newest is the other set's. The party is changed first, to see it come back.
    dm.game.ctx.party.state.champions[0]!.name = 'CHANGED';
    const beforeLoad = told.length;
    const reportsBefore = reports.length;
    await dm.saves.quickLoad();
    const loadedParty = dm.game.ctx.party.state.champions.map((c) => c.name).join('/');
    console.log(`  F9 in ${DEFAULT_DATA_SET.id}: ${toldSince(beforeLoad)}, party ${loadedParty} (${reports.slice(reportsBefore).join(' | ')})`);
    check(toldSince(beforeLoad) === '/15:GAME LOADED' && loadedParty === 'DAROO'
      && reports[reports.length - 1] === `Quick-loaded ${dmNew.name}`,
      'F9 loads the newest save of the game\'s playthrough, F5\'s here, and says so');

    // The menu's save, once it is the newer of the playthrough's.
    now += 60_000;
    const dmMenu = await dm.saves.save('stopped', false);
    await dm.saves.quickLoad();
    check(reports[reports.length - 1] === `Quick-loaded ${dmMenu.name}`, 'and the menu\'s save when that is the newer');

    // Another playthrough of the same set has no save of its own to load, and neither
    // has a set with no save at all.
    const stranger = await stage(false, DEFAULT_DATA_SET, shared, 'WUUF');
    const empty = await stage(false, dataSetFor('dm-windows'), shared);
    const beforeNone = told.length;
    await stranger.saves.quickLoad();
    await empty.saves.quickLoad();
    console.log(`  F9 in another playthrough of ${DEFAULT_DATA_SET.id}, then in dm-windows: ${toldSince(beforeNone)}`);
    check(toldSince(beforeNone) === '/15:CAN\'T FIND SAVED GAME!/15:CAN\'T FIND SAVED GAME!'
      && stranger.game.ctx.party.state.champions[0]!.name === 'WUUF' && empty.game.ctx.party.state.champions[0]!.name === 'DAROO',
      'F9 in a playthrough with no save finds none (SaveGame.cpp:1585), whatever the others hold, and loads nothing');

    // Each playthrough's F5 has its own slot.
    const strangerQuick = await stranger.saves.save('running', true);
    const dmQuick = await dm.saves.save('running', true);
    check(strangerQuick.id !== dmNew.id && dmQuick.id === dmNew.id && shared.files.size === 6,
      'and each playthrough\'s F5 writes its own slot');

    // A file whose RandomGameID is 0, as an earlier build of the port wrote them: its
    // game is given a playthrough at the load.
    console.log('');
    console.log('=== a save that names no playthrough ===');
    const kept = memoryStore();
    const idOf = (of: { game: Game }): number => of.game.ctx.state.block1.randomGameID;
    const nameless = async (dataSet = DEFAULT_DATA_SET, name = 'DAROO', quick = false): Promise<SaveEntry> => {
      const early = await stage(false, dataSet, kept, name);
      early.game.ctx.state.block1.randomGameID = 0;
      now += 60_000;
      return early.saves.save('stopped', quick);
    };
    const load = async (row: SaveEntry, dataSet = DEFAULT_DATA_SET) => {
      const loaded = await stage(false, dataSet, kept, 'WUUF');
      loaded.saves.read(await loaded.saves.open(row));
      return loaded;
    };
    const old = await nameless();
    check(old.playthrough === 0, 'a file whose RandomGameID is 0 is a row of playthrough 0');

    const alone = await load(old);
    const again = await load(old);
    const plain = await loadGame();
    applySaveBytes(plain, await kept.read(old.id));
    console.log(`  loaded with no save to join: ${idOf(alone) !== 0 ? 'a playthrough' : 'NONE'}; loaded again: ${idOf(again) !== 0 && idOf(again) !== idOf(alone) ? 'another' : 'THE SAME'}`);
    check(plain.ctx.state.block1.randomGameID === 0 && idOf(alone) !== 0, 'with no save to join, the loaded game draws a playthrough, where the file alone gives 0');
    check(idOf(again) !== 0 && idOf(again) !== idOf(alone), 'and a second load of the file draws another');
    check(alone.game.ctx.random.getSeed() === plain.ctx.random.getSeed(),
      'the draw is not the game\'s stream: d.RandomNumber is the file\'s, as after CSBWin\'s load');

    now += 60_000;
    const carried = await alone.saves.save('stopped', false);
    const joiner = await load(old);
    const stillOld = (await kept.list(null)).find((e) => e.id === old.id);
    console.log(`  the loaded game saved, and the file loaded again: ${idOf(joiner) === idOf(alone) ? 'the saved game\'s playthrough' : 'ANOTHER'}; the old row's: ${stillOld?.playthrough}`);
    check(carried.playthrough === idOf(alone), 'the loaded game\'s save carries the playthrough it was given');
    check(idOf(joiner) === idOf(alone), 'and the file loaded again joins it: a save of the same data set and party names it');
    check(stillOld?.playthrough === 0 && readCsbwinSaveInfo(await kept.read(old.id))?.randomGameID === 0,
      'the old row and its file keep 0');
    const named = await load(carried);
    check(idOf(named) === carried.playthrough, 'a file that names a playthrough gives its own');

    const otherParty = await load(await nameless(DEFAULT_DATA_SET, 'LEYLA'));
    const csbRow = await nameless(csbSet);
    const otherSet = await load(csbRow, csbSet);
    console.log(`  another party's: ${idOf(otherParty) !== 0 && idOf(otherParty) !== idOf(alone) ? 'another playthrough' : 'THE SAME'}; `
      + `the same party's in ${csbSet.id}: ${idOf(otherSet) !== 0 && idOf(otherSet) !== idOf(alone) ? 'another playthrough' : 'THE SAME'}`);
    check(idOf(otherParty) !== 0 && idOf(otherParty) !== idOf(alone), 'a file of another party does not join it');
    check(csbRow.champions.join() === 'DAROO' && idOf(otherSet) !== 0 && idOf(otherSet) !== idOf(alone),
      'nor does the same party\'s in another data set');

    // F9 is the playthrough's, so it takes no file that names none: not the one its
    // game was loaded from, nor a newer one.
    const newest = await nameless(DEFAULT_DATA_SET, 'DAROO', true);
    const beforeAgain = told.length;
    await again.saves.quickLoad();
    await alone.saves.quickLoad();
    console.log(`  F9 in a game loaded from it and not saved: ${toldSince(beforeAgain).split('/')[1]}; in the one that saved: ${reports[reports.length - 1] === `Quick-loaded ${carried.name}` ? 'its save' : 'ANOTHER'}`);
    check(toldSince(beforeAgain) === '/15:CAN\'T FIND SAVED GAME!/15:GAME LOADED',
      'F9 in a game loaded from such a file and not saved since finds no save of its playthrough');
    check(newest.quick && newest.savedAt > carried.savedAt && reports[reports.length - 1] === `Quick-loaded ${carried.name}`,
      'and in the game that saved, loads that save, not the newer file that names none');

    // Nor does F5 write over a quick-save that names none.
    const quickOver = await alone.saves.save('running', true);
    check(quickOver.id !== newest.id && (await kept.list(null)).find((e) => e.id === newest.id)?.playthrough === 0,
      'F5 makes its own slot beside a quick-save that names no playthrough');
  } finally {
    Date.now = realNow;
  }
}

/* ------------------------------------------------------- 9. the store's upgrade ---- */

/**
 * `upgradeSaveRecords` over version-1 rows: `{ id, name, savedAt, level, champions,
 * bytes }`, the bytes a CSBWin file or a `.dmweb.json`, which is JSON around such a file
 * as `raw`, in base64.
 */
async function checkUpgrade(): Promise<void> {
  console.log('');
  console.log('=== the store\'s upgrade (`upgradeSaveRecords`) ===');
  const game = await loadGame();
  game.ctx.party.state.position = new Position(7, 11, 9);
  game.ctx.party.state.champions = [healthyChampion('DAROO'), healthyChampion('LEYLA')];
  const file = buildSaveFile(game);
  const playthrough = game.ctx.state.block1.randomGameID;
  const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;
  const json = (value: unknown): ArrayBuffer => buffer(new TextEncoder().encode(JSON.stringify(value)));
  const wrapped = {
    header: { format: 'dmweb-save', version: 14, savedAt: 1, level: 3, champions: ['OLD'] },
    runtime: { version: 14 },
    raw: Buffer.from(file).toString('base64'),
  };
  // What the row says of the level and the party is not what is kept: the file is read.
  const v1 = (name: string, savedAt: number, bytes: unknown) => ({ id: name, name, savedAt, level: 3, champions: ['OLD'], bytes });
  const old = [
    v1('a.dat', 100, buffer(file)),
    v1('b.dmweb.json', 200, json(wrapped)),
    // The same save under both names: one row, the newer.
    v1('c.dmweb.json', 300, json(wrapped)),
    v1('c.dat', 250, buffer(file)),
    // No CSBWin file in them: a JSON save with no `raw`, one whose `raw` is no save, bytes
    // that are neither, and a row with no bytes.
    v1('d.dmweb.json', 400, json({ header: wrapped.header, runtime: wrapped.runtime })),
    v1('e.dmweb.json', 500, json({ raw: 'AAAA' })),
    v1('f.dat', 600, buffer(new Uint8Array(64))),
    v1('g.dat', 700, undefined),
  ];
  const rows = upgradeSaveRecords(old, DEFAULT_DATA_SET.id);
  console.log(['id', 'name', 'data set', 'playthrough', 'quick', 'savedAt', 'level', 'champions', 'bytes'].join('\t'));
  for (const row of rows) {
    console.log([row.id, row.name, row.dataSet, row.playthrough === playthrough ? 'the file\'s' : 'ANOTHER', row.quick, row.savedAt, row.level, row.champions.join('/'), row.bytes.byteLength].join('\t'));
  }
  const sameFile = (bytes: ArrayBuffer): boolean => {
    const got = new Uint8Array(bytes);
    return got.length === file.length && got.every((b, i) => b === file[i]);
  };
  check(rows.map((r) => r.id).join() === 'a.dat,b.dat,c.dat', `the rows that hold a CSBWin file are kept, each named a .dat (got ${rows.map((r) => r.id).join()})`);
  check(rows.every((r) => r.id === r.name), 'and keyed by that name');
  check(rows.every((r) => sameFile(r.bytes)), 'a row\'s bytes are the CSBWin file alone, the JSON\'s `raw` decoded');
  check(rows.every((r) => r.level === 9 && r.champions.join('/') === 'DAROO/LEYLA' && r.playthrough === playthrough),
    'the level, the party and the playthrough are read from the file, not kept from the old row');
  check(rows.every((r) => r.dataSet === DEFAULT_DATA_SET.id && !r.quick), 'every row is the default data set\'s, and none is a quick save');
  check(rows.map((r) => r.savedAt).join() === '100,200,300', 'the date is the old row\'s, and of two rows that come to one name the newer is kept');
  for (const row of rows) {
    const fresh = await loadGame();
    applySaveBytes(fresh, new Uint8Array(row.bytes));
    check(fresh.ctx.party.state.position.z === 9 && fresh.ctx.party.state.champions.length === 2, `${row.id} loads`);
  }
  check(upgradeSaveRecords([null, 'x', {}], DEFAULT_DATA_SET.id).length === 0, 'what is not a row is dropped, not thrown on');
}

/* ------------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const graphics = loadGraphics();
  checkButtonTables(graphics);
  checkLayout(graphics);
  checkSplitLongLine();
  checkListLogic();
  await checkSaveFile();
  checkCsbwinListing();
  await checkEnterAndLeave(graphics);
  await checkQuickSaveOverOpenChest(graphics);
  checkPressAnimation(graphics);
  await checkSaveCall();
  await checkUpgrade();
  finish();
}

void main();
