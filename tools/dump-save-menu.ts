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
 * 5. **The metadata path.** A row's level and roster come either from our own header,
 *    read out of the first 8 KB of the file, or from blocks 2 and 4 of a genuine CSBWin
 *    save. Both are asserted against the real files.
 *
 * Run: `npx tsx tools/dump-save-menu.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { readCsbwinSaveInfo } from '../src/data/CsbwinSaveInfo';
import {
  abbreviateChampions,
  extractHeaderFromPrefix,
  formatSaveDate,
  formatSaveRow,
  pickLatestLoadable,
  sortSaveEntries,
  type SaveEntry,
} from '../src/data/saves/SaveStore';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import {
  buildSavePayload,
  decodeSavePayload,
  encodeSavePayload,
  makeSaveFileName,
  SAVE_FILE_EXTENSION,
} from '../src/engine/SaveGamePayload';
import { createPaletteIndexViewportBuffer, type IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { MENU_HEIGHT, MENU_PANEL_COLOR, MENU_WIDTH, drawMenuBitmap, splitLongLine } from '../src/renderer/ui/Menu';
import { SAVE_MENU_GEOMETRY, extendListPanel } from '../src/renderer/ui/SaveMenu';
import type { UIState } from '../src/renderer/ui/UIState';
import { SCREEN_HEIGHT, SCREEN_WIDTH, VIEWPORT_X, VIEWPORT_Y } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';

const GRAPHICS = 'static/gamefiles/dm-atari/graphics.dat';
const DUNGEON = 'static/gamefiles/dm-atari/dungeon.dat';
const SAVES = 'static/gamefiles/saves';

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
    uiTables: extractUITables(graphics),
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
  const buttons = extractUITables(graphics).graphic231.buttons;

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
    four[2].word0 === SAVE_MENU_GEOMETRY.loadButtonId && four[3].word0 === SAVE_MENU_GEOMETRY.saveButtonId,
    'LOAD and SAVE take the bottom row, ids 212 and 213',
  );
}

/* -------------------------------------------------------------- 2. the layout ---- */

/**
 * Graphic 0 and the self-blit rectangles `_DoMenu` patches it with, then the real draw.
 */
function checkLayout(graphics: GraphicsLoader): void {
  const g231 = extractUITables(graphics).graphic231;
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

  const g = SAVE_MENU_GEOMETRY;
  // Before the extension, the full-width button frame is in the way: the art is *not*
  // panel colour where the list's lower rows will go. If this ever stops being true the
  // extension has become unnecessary, and this tool should say so rather than pass.
  const lowerRowY = VIEWPORT_Y + g.rowFirstY + 7 * g.rowStep;
  const dirtyBefore = countNot(ui, VIEWPORT_X + g.panelInnerX1, VIEWPORT_X + g.panelInnerX2, lowerRowY - 4, lowerRowY + 1, MENU_PANEL_COLOR);
  check(dirtyBefore > 0, `the unpatched art is not clean under the last row (${dirtyBefore} pixels differ)`);

  extendListPanel(ui);

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
    savedAt: 0,
    level: 0,
    champions: [],
    loadable: true,
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
      loadable: false,
      note: 'CSBWIN SAVE — NOT READABLE YET',
    }),
  ];
  for (const row of rows) {
    const text = formatSaveRow(row);
    console.log([JSON.stringify(text), text.length].join('\t'));
    check(text.length <= SAVE_MENU_GEOMETRY.textMaxChars, `"${text}" fits in ${SAVE_MENU_GEOMETRY.textMaxChars} characters`);
  }
  check(formatSaveRow(rows[0]).startsWith('2026-09-13 L14 '), 'a row leads with the date and the level');
  check(formatSaveRow(rows[2]).startsWith('*'), 'a save that cannot be loaded is marked with a star');
  check(!formatSaveRow(rows[0]).startsWith('*'), 'a loadable save is not marked');

  /* ---- what F9 picks up ---- */

  // The quick-load takes "the most recent save" to mean the most recent one *anywhere*,
  // so that F9 does not answer differently depending on which source the menu was last
  // showing. A store that cannot be listed simply does not take part.
  const browserEntries = [
    entry({ name: 'browser-old', savedAt: Date.UTC(2026, 0, 1) }),
    entry({ name: 'browser-new', savedAt: Date.UTC(2026, 5, 1) }),
  ];
  const fileEntries = [
    entry({ name: 'file-newest', savedAt: Date.UTC(2026, 8, 1) }),
    // A genuine CSBWin save is the newest thing in the folder and must still be skipped:
    // picking it would hand the player a refusal instead of a game.
    entry({ name: 'csbgame.dat', savedAt: Date.UTC(2026, 8, 30), loadable: false }),
  ];
  const across = pickLatestLoadable([
    { source: 'browser', entries: browserEntries },
    { source: 'file', entries: fileEntries },
  ]);
  console.log('');
  console.log(`  latest across both stores: ${across?.entry.name} (${across?.source})`);
  check(across?.entry.name === 'file-newest', 'the latest save is found across stores, not within one');
  check(across?.source === 'file', 'the picker reports which store to read it from');

  const browserOnly = pickLatestLoadable([{ source: 'browser', entries: browserEntries }]);
  check(browserOnly?.entry.name === 'browser-new', 'with one store, the latest in it wins');
  check(pickLatestLoadable([]) === null, 'no stores yields null');
  check(pickLatestLoadable([{ source: 'file', entries: [fileEntries[1]] }]) === null, 'a store holding only unloadable saves yields null');

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
}

/* ------------------------------------------------------------- 5. the metadata ---- */

function healthyChampion(name: string): Champion {
  return {
    name,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: new Array(30).fill(null),
    partyPosition: 0,
  };
}

async function loadGame(): Promise<Game> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve(DUNGEON))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = loadGraphics();
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

  return new Game(
    data,
    {
      roomTimerFunctions: uiTables.graphic232.byte1596,
      monsterDesc: objectTables.monsterDesc,
      objDescObjectType: objectTables.objDescObjectType,
      weaponDesc: objectTables.weaponDesc,
      weaponWeights: objectTables.weaponWeights,
      clothingWeights: objectTables.clothingWeights,
      miscWeights: objectTables.miscWeights,
    },
    {
      monsterDesc: objectTables.monsterDesc,
      word1074: uiTables.graphic232.word1074,
      soundTable: uiTables.graphic232.soundTable,
      doorCharacteristics: objectTables.doorCharacteristics,
      monsterDroppings: objectTables.monsterDroppings,
      facingReplication: objectTables.facingReplication,
    },
  );
}

/**
 * A real save, built from a real engine, then read back the way the file store reads it:
 * out of the first few kilobytes only.
 */
async function checkPayload(): Promise<void> {
  console.log('');
  console.log('=== a real save, and the header a directory listing reads back ===');

  const game = await loadGame();
  game.party.state.position = new Position(7, 11, 9);
  game.party.state.champions = [healthyChampion('DAROO'), healthyChampion('LEYLA')];

  const payload = buildSavePayload(game);
  const bytes = encodeSavePayload(payload);
  console.log(`  payload         : ${bytes.length} bytes`);
  console.log(`  header          : level ${payload.header.level}, ${payload.header.champions.join('/')}`);
  check(payload.header.level === 9, `the header records the party's level (got ${payload.header.level})`);
  check(
    payload.header.champions.join('/') === 'DAROO/LEYLA',
    `the header records the roster (got ${payload.header.champions.join('/')})`,
  );
  check(payload.header.savedAt > 0, 'the header carries a wall-clock date');

  // The whole point of putting `header` first: a listing must never have to read the
  // runtime state. 8192 is what `FileSaveStore` slices.
  const prefix = new TextDecoder().decode(bytes.subarray(0, 8192));
  const recovered = extractHeaderFromPrefix(prefix) as { level: number; champions: string[] } | null;
  console.log(`  from 8 KB prefix: ${recovered ? `level ${recovered.level}, ${recovered.champions.join('/')}` : 'NOT FOUND'}`);
  check(recovered !== null, 'the header is inside the first 8 KB of the file');
  check(recovered?.level === 9, 'the level read from the prefix matches the save');
  check(recovered?.champions.join('/') === 'DAROO/LEYLA', 'the roster read from the prefix matches the save');
  check(bytes.length > 8192, 'the save is bigger than the prefix, so the shortcut is doing real work');

  // A brace inside a champion name must not end the scan early.
  const tricky = extractHeaderFromPrefix('{"header":{"champions":["A}B","C\\"D"],"level":3},"runtime":{') as
    | { level: number; champions: string[] }
    | null;
  check(tricky?.level === 3, 'the header scan is string-aware');
  check(extractHeaderFromPrefix('{"runtime":{}}') === null, 'a file with no header yields null, not a throw');

  const round = decodeSavePayload(bytes);
  check(round.header.level === 9, 'the payload round-trips through encode/decode');
  check(round.runtime.party.champions.length === 2, 'the runtime half survives the round trip');

  // An older format is refused outright, never half-restored.
  const stale = new TextEncoder().encode(JSON.stringify({ runtime: { version: 1 }, raw: '' }));
  let refused = '';
  try {
    decodeSavePayload(stale);
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  console.log(`  a v1 save       : ${refused}`);
  check(refused.includes('V1'), 'a save from an older format is refused by version');
}

/** The genuine CSBWin saves in the repository, listed the way the menu would list them. */
function checkCsbwinListing(): void {
  console.log('');
  console.log('=== genuine CSBWin saves, as the menu would list them ===');
  const dir = resolve(SAVES);
  const { readdirSync, existsSync, statSync } = require('node:fs') as typeof import('node:fs');
  if (!existsSync(dir)) {
    check(false, `${SAVES} should hold the genuine saves the reader is proven against`);
    return;
  }
  const files = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.dat') && !n.includes(':')).sort();
  check(files.length > 0, `${SAVES} holds at least one genuine save`);

  console.log(['file', 'row'].join('\t'));
  for (const file of files) {
    const path = resolve(dir, file);
    const info = readCsbwinSaveInfo(new Uint8Array(readFileSync(path)));
    check(info !== null, `${file}: blocks 2 and 4 read`);
    if (!info) continue;
    const row = formatSaveRow({
      id: file,
      name: file,
      savedAt: statSync(path).mtimeMs,
      level: info.level,
      champions: info.champions,
      loadable: true,
    });
    console.log([file, JSON.stringify(row)].join('\t'));
    check(info.level >= 0 && info.level < 64, `${file}: level ${info.level} is plausible`);
    check(info.champions.length >= 1 && info.champions.length <= 4, `${file}: 1..4 champions`);
    check(
      info.champions.every((n) => n.length > 0 && !n.includes('?')),
      `${file}: every champion name is printable ASCII`,
    );
    // Unmarked since the object indirect index was ported: these files load.
    // `tools/dump-csbwin-load.ts` restores each of them into a real `Game`.
    check(!row.startsWith('*'), `${file}: listed as loadable`);
  }

  // Not a save at all: the listing must drop it rather than show a row of nonsense.
  check(readCsbwinSaveInfo(new Uint8Array(16)) === null, 'a file that is not a save reads back as null');
}

/* ------------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const graphics = loadGraphics();
  checkButtonTables(graphics);
  checkLayout(graphics);
  checkSplitLongLine();
  checkListLogic();
  await checkPayload();
  checkCsbwinListing();
  finish();
}

void main();
