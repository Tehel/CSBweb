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
 * 2. **The art the dialog is made of.** The dialog is drawn from three pieces of graphic
 *    0, each stretched by repeating the column and the row inside its corners. Whether a
 *    piece is plain there, and whether that leaves a clean background under every row
 *    and every label, is a property of the *art*, not of the code, so the draw is run
 *    for real into a buffer and the result is inspected pixel by pixel.
 * 3. **`SplitLongLine`**, which has an edge case CSBWin does not guard (no space at or
 *    after the midpoint) and which this port reproduces rather than fixes.
 * 4. **The list logic** — ordering, the playthroughs the saves are listed under, the
 *    date format, what fits in 32 characters, when LOAD is inert. None of it is on
 *    screen until there are saves to list.
 * 5. **The metadata path.** A row's playthrough, level and roster come from blocks 1, 2
 *    and 4 of the CSBWin file a save is, the port's or a genuine one. Asserted against
 *    real files.
 * 6. **Entering and leaving.** The disk menu is bracketed by `TAG02076e` and `TAG0207cc`
 *    (`doc/CSBwin-src/SaveGame.cpp:877`, `:1375`). The first repacks a chest open in the
 *    inventory, which is what puts its objects in the save; the second shows the
 *    inventory again and brings the attack buttons back. Run over a real chest, with a
 *    real save restored into a fresh game. The port's quick-save repacks the chest too.
 * 8. **The one save call.** The disk menu's SAVE and F5 both go through `GameSaves.save`
 *    (`src/engine/GameSaves.ts`), which names the save and runs `SaveGame`'s tail: after
 *    the write for the menu, whose clock is stopped, and before it for F5, whose clock
 *    runs. Run against a store in memory, which two games of two data sets then share:
 *    each lists its own set's saves. F5 writes over its playthrough's quick-save, and
 *    F9 loads its playthrough's newest save. SAVE over a listed save writes that row.
 *    F5 saves nothing while a DSA has disabled saves, and says so.
 *    A save read into a game is marked as the last one used. And a new game's
 *    playthrough is drawn again while a save of the data set holds it.
 * 9. **The store's upgrade.** The rows of the store's first version, a CSBWin file or a
 *    `.dmweb.json` around one, made today's (`src/data/saves/legacyRows.ts`), and the
 *    rows that name no playthrough each given one, stamped into its file, then the files
 *    that hold 0 in all four of `GAMEBLOCK1`'s words of `_ReadEntireGame` given them,
 *    which RISE then takes. The page runs it once, inside IndexedDB's upgrade; here it
 *    runs over rows built by hand.
 * 10. **The selection.** The menu driven by its own clicks and keys over that store:
 *    the full menu opens on its "new save" row in an empty store, where LOAD is inert
 *    and SAVE makes a save; on a save, SAVE writes over it, and on the game's heading it
 *    makes another. Either menu then opens on the last save used, written or loaded.
 *    The load-only chooser has no "new save" row.
 * 11. **The question.** LOAD and SAVE on a save of another playthrough than the running
 *    game's ask first, and do nothing until the answer; on a save of the game's own, or
 *    in the load-only chooser, neither asks.
 * 13. **The two-level list.** The saves of three games in one store: a heading for each
 *    playthrough, the last one used first and alone unfolded, and the last save used
 *    selected. A click on a heading folds and unfolds it. From a heading LOAD reads its
 *    playthrough's last save used, and SAVE makes a new save on the running game's own
 *    and is inert on another's. "NEW SAVE" is listed for a game with no save alone.
 *    While a DSA has disabled saves the dialog says so, and SAVE is inert everywhere.
 * 12. **The play time.** The player's time in a game is the VBLs its loop runs, the
 *    frozen game's and the save menu's left out. No file holds it: a save's row does,
 *    and a load takes it back from the row.
 * 14. **The preview.** The panel beside the list shows the save LOAD would read: its
 *    party, its level, its play time and its date, a line each on the list's rows. The
 *    lines are drawn for real and the panel read back: which rows hold ink, that none
 *    leaves the panel's interior, that a heading shows its last save used and "NEW
 *    SAVE" nothing, and that the dialog's message takes the panel's last lines; and
 *    the import's hint on the two a full preview leaves, while the pointer is on the
 *    panel or EXPORT's frame and no message is up.
 * 15. **The scrolling.** A list longer than the panel, and its scrollbar read back from
 *    the screen: the slider's place and height, the dither of the track around it, the
 *    two arrows. A click on an arrow and a notch of the wheel scroll a row, neither
 *    moving the selection, which a key brings the list back to.
 * 16. **The double click.** A second click on a save soon after the first is LOAD: its
 *    press, its question across playthroughs, and its load. Not after the delay, not on
 *    another save, a heading or "NEW SAVE".
 * 17. **EXPORT.** The selected save's file handed to the page, the store's bytes as they
 *    are: its label and its press on a save alone, no question across playthroughs, the
 *    store and the game left as they were, a read that fails, and the load-only chooser.
 * 18. **The import.** A file from outside taken into the store (`GameSaves.importSave`):
 *    the data set's own dungeon stored under the file's name, date and playthrough, and
 *    a file that names none joined to its party's playthrough or given a new one; a
 *    modified dungeon stored only once confirmed, as an unofficial row, which the saves
 *    of a game read from it are too; another dungeon's, an unknown one's, a file with no
 *    `GAMEBLOCK1` ("NOT A SAVED GAME") and a save that does not read past it ("SAVED
 *    GAME DAMAGED!") never stored. A player's own set is checked against its record's
 *    signature alone: one that holds Dungeon Master's dungeon takes its saves, and any
 *    other save it takes once confirmed.
 * 19. **The drop.** A file dropped on the dialog, by the menu's own entry and clicks: a
 *    save of the dungeon listed and selected with nothing loaded; a modified dungeon's
 *    asked about in `_DoMenu`'s two-option menu and stored on CONFIRM alone; another
 *    dungeon's and an unknown one's refused under OK; a file that is no save, and one
 *    that does not read, in the dialog's message; and the load-only chooser taking a
 *    drop as the disk menu does.
 * 20. **RISE's dialog.** The chooser in `rise` mode: a title panel of graphic 0 over
 *    the list, its two lines on clean panel; the list panel ten rows below it, as
 *    graphic 0 spaces its panels, holding eleven whole rows; LOAD labelled RISE; no
 *    EXPORT on any row, nor a click on it; the rows' clicks and PageDown on the eleven;
 *    no drop taken, the store left alone, and no import's hint over the preview's panel
 *    or EXPORT's frame. In EXPORT's frame, for a set with the utility's portraits, the
 *    toggle: NEW FACE whenever the dialog opens, its eight characters inside the frame's
 *    bevels; a click on it OLD FACE, another NEW FACE again; LOAD passes what it shows
 *    to the new adventure. For a set without them, and in the other modes, there is
 *    none.
 * 7. **The press animation.** `_WaitForMenuSelect` paints its second pass over its first
 *    and restores the screen only after both (`doc/CSBwin-src/Menu.cpp:121-179`). The
 *    save menu redraws the whole screen on every frame of the press, so the pixels of a
 *    frame in the second pass are read back here: both passes' edges must be up.
 *
 * Run: `npx tsx tools/dump-save-menu.ts`
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { CsbRandom } from '../src/core/random';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../src/core/types';
import { emptyDungeonData } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { readCsbwinSaveInfo } from '../src/data/CsbwinSaveInfo';
import {
  formatPlaythroughRow,
  formatPlayTime,
  formatSaveDate,
  formatSavePreview,
  formatSaveRow,
  formatSaveTime,
  joinedPlaythrough,
  lastUsedSave,
  playthroughsOf,
  readSaveFileFields,
  saveEntryOf,
  SAVE_FILE_EXTENSION,
  slotOf,
  sortSaveEntries,
  type SaveEntry,
  type SaveStore,
  type StoredSaveRecord,
} from '../src/data/saves/SaveStore';
import { ROWS_UPGRADED_VERSION, stampBlock1Rows, stampSaveRecords, upgradeSaveRecords, upgradeStoredRows } from '../src/data/saves/legacyRows';
import { dungeonWalls, KNOWN_DUNGEONS, type KnownDungeon } from '../src/data/DungeonSignature';
import type { DataSetFiles } from '../src/data/DataSetFiles';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { LOCAL_DATA_SET_TEXT_LIMITS, type DataSet } from '../src/data/DataSets';
import { localDataSet, recordFiles, type LocalDataSetRecord } from '../src/data/LocalDataSets';
import { Game } from '../src/engine/Game';
import type { GameHost, MessageSink } from '../src/engine/GameHost';
import { freeze, thaw, type LoopScript } from '../src/engine/LoopState';
import type { Champion } from '../src/engine/gameTypes';
import { drawRandomGameID } from '../src/engine/GameContext';
import { GameSaves, NOT_A_SAVED_GAME, SAVED_GAME_DAMAGED, drawPlaythrough, importedFileName, makeSaveFileName } from '../src/engine/GameSaves';
import { applySaveBytes, buildSaveFile } from '../src/engine/SaveGameFile';
import { readExtendedFeatures } from '../src/data/CsbwinExtendedFeatures';
import { holdsNoBlock1Words, loadSaveGameState, readsGameBlock1, stampRandomGameID } from '../src/data/SaveGameLoader';
import { ReadSavedGame, TAG00260e } from '../src/engine/Chaos';
import { readCsbwinCharacter } from '../src/data/CsbwinCharacters';
import type { IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { drawTextLineIndex } from '../src/renderer/csbwin/TextRenderer';
import {
  MENU_HEIGHT,
  MENU_OPTION_COLOR,
  MENU_PANEL_COLOR,
  MENU_TITLE1_COLOR,
  MENU_TITLE_MAX_CHARS,
  MENU_PRESS_PHASE_MS,
  MENU_WIDTH,
  doMenu,
  drawMenuPress,
  menuButtonList,
  menuButtonRect,
  splitLongLine,
} from '../src/renderer/ui/Menu';
import { type UIState } from '../src/renderer/ui/UIState';
import { SCREEN_HEIGHT, SCREEN_WIDTH, VIEWPORT_X, VIEWPORT_Y } from '../src/renderer/ViewportGraphics';
import { DEFAULT_DATA_SET, dataSetNamed, diskFiles } from './lib/dataSets';
import { graphicsTablesOf, newGame, stockGame, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';
import { check, finish } from './lib/check';
import { SAVE_DIR, genuineSaves, memoryStore, savePath } from './lib/saves';
import * as SaveMenu from '../src/renderer/ui/SaveMenu';
import * as Widgets from '../src/renderer/ui/Widgets';
import * as Inventory from '../src/renderer/ui/Inventory';
import { testChampion } from './lib/champion';

const DUNGEON = 'static/gamefiles/dm-atari/dungeon.dat';
const GRAPHICS_DAT = 'static/gamefiles/dm-atari/graphics.dat';


/* ------------------------------------------------------------------------------- */

function loadGraphics(): GraphicsLoader {
  return stockGraphics();
}

/** A graphic of `graphics` as the bitmap the menu's drawing blits. */
function graphicBitmaps(graphics: GraphicsLoader): (graphicNum: number) => IndexedBitmap | null {
  const bitmaps = new Map<number, IndexedBitmap>();
  return (graphicNum) => {
    let bitmap = bitmaps.get(graphicNum);
    if (!bitmap) {
      const image = graphics.getImage(graphicNum);
      bitmap = { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };
      bitmaps.set(graphicNum, bitmap);
    }
    return bitmap;
  };
}

/** The interface over a game with no dungeon, to run the menu's drawing into its screen. */
function makeDrawingUI(graphics: GraphicsLoader): UIState {
  return newUIState(graphics, newGame(emptyDungeonData(), graphics).ctx, { getGraphicBitmap: graphicBitmaps(graphics) });
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

  // The dialog's buttons are graphic 0's frame drawn elsewhere, and take the rectangle
  // and the label CSBWin gives the frame where it stands: its bottom pair, at (10,99) and
  // (117,99) in the bitmap, ids 212 and 213 of this set.
  const pair = [
    { frame: { x1: 10, y1: 99, x2: 107, y2: 125 }, table: four[2], label: [59, 114] },
    { frame: { x1: 117, y1: 99, x2: 213, y2: 125 }, table: four[3], label: [166, 114] },
  ];
  for (const { frame, table, label } of pair) {
    const onScreen = { x1: frame.x1 + VIEWPORT_X, y1: frame.y1 + VIEWPORT_Y, x2: frame.x2 + VIEWPORT_X, y2: frame.y2 + VIEWPORT_Y };
    const rect = Widgets.buttonRect(onScreen);
    const at = Widgets.buttonLabelAt(frame);
    check(
      rect.x1 === table.x1 && rect.x2 === table.x2 && rect.y1 === table.y1 && rect.y2 === table.y2,
      `button ${table.word0}'s rectangle is its frame less six pixels a side (${rect.x1}..${rect.x2}/${rect.y1}..${rect.y2})`,
    );
    check(at.x === label[0] && at.y === label[1], `and _DoMenu centres its label on (${label[0]},${label[1]}) (Menu.cpp:339-346)`);
  }
}

/* -------------------------------------------------------------- 2. the layout ---- */

/**
 * Graphic 0 and the self-blit rectangles `_DoMenu` patches it with, then the real draw.
 */
function checkLayout(graphics: GraphicsLoader): void {
  const ui = makeDrawingUI(graphics);
  const g231 = ui.uiTables.graphic231;
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

  /* ---- the pieces, each drawn at its own size: the art itself ---- */

  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  const size = (r: { x1: number; y1: number; x2: number; y2: number }): string => `${r.x2 - r.x1 + 1}x${r.y2 - r.y1 + 1}`;
  /** How many pixels of `piece`, drawn at its own size and place, are not graphic 0's. */
  const ownSize = (piece: Widgets.DialogPiece, within: (x: number, y: number) => boolean): number => {
    ui.screenIndexBuffer!.pixels.fill(7);
    Widgets.drawPiece(ui, piece, piece);
    let wrong = 0;
    for (let y = piece.y1; y <= piece.y2; y++) {
      for (let x = piece.x1; x <= piece.x2; x++) {
        if (within(x, y) && pixelAt(ui, x, y) !== image.pixels[y * MENU_WIDTH + x]) wrong++;
      }
    }
    return wrong;
  };
  console.log('');
  console.log('=== the dialog\'s pieces of graphic 0, each drawn at its own size ===');
  // The frame's middle holds graphic 0's panels, so only its ring can be the art's.
  const f = g.framePiece;
  const ring = ownSize(f, (x, y) => x < f.left || x > f.x2 - f.right || y < f.top || y > f.y2 - f.bottom);
  const panel = ownSize(g.panelPiece, () => true);
  const button = ownSize(g.buttonPiece, () => true);
  console.log(['piece', 'in graphic 0', 'kept l/t/r/b', 'pixels that differ'].join('\t'));
  for (const [name, piece, wrong] of [['frame (its ring)', f, ring], ['panel', g.panelPiece, panel], ['button', g.buttonPiece, button]] as const) {
    console.log([name, `(${piece.x1},${piece.y1})-(${piece.x2},${piece.y2})`, `${piece.left}/${piece.top}/${piece.right}/${piece.bottom}`, wrong].join('\t'));
  }
  check(ring === 0, `the frame at its own size is graphic 0's ring: its edges are plain between the corners (${ring} differ)`);
  check(panel === 0, `the panel at its own size is graphic 0's panel: plain between its corners (${panel} differ)`);
  check(button === 0, `the button at its own size is graphic 0's frame: its rows are plain between the bevels (${button} differ)`);
  // One column less on a side and a bevel would be repeated: the art, not the code, sets
  // the six.
  const narrow = { ...g.buttonPiece, left: g.buttonPiece.left - 1, right: g.buttonPiece.right - 1 };
  check(ownSize(narrow, () => true) > 0, 'a button kept five columns a side would not be: the bevels are six columns');
  check(g.buttonPiece.top + g.buttonPiece.bottom === g.buttonPiece.y2 - g.buttonPiece.y1 + 1,
    'every row of the button is kept: it is drawn at its own height alone');
  const frames = Object.entries(g.buttonFrames);
  check(frames.every(([, frame]) => frame.y2 - frame.y1 === g.buttonPiece.y2 - g.buttonPiece.y1),
    'and every button frame of the dialog has that height');

  /* ---- the dialog, drawn for real and then measured ---- */

  const blank: SaveMenu.SaveMenuState = {
    mode: 'full', entries: [], unfolded: new Set(), rows: [], selected: -1, scrollTop: 0, wheelDelta: 0, busy: true, message: '',
    press: null, pending: null, confirm: null, dropped: null, adventure: null, frameHandle: null, lastSaveClick: null, pointer: null, newFace: null,
    deleteArmed: null, longPress: null,
  };
  ui.saveMenu = blank;
  ui.screenIndexBuffer!.pixels.fill(7);
  SaveMenu.drawSaveMenu(ui);
  ui.saveMenu = null;
  let outside = 0;
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const inDialog = x >= g.dialog.x1 && x <= g.dialog.x2 && y >= g.dialog.y1 && y <= g.dialog.y2;
      if (!inDialog && pixelAt(ui, x, y) !== 0) outside++;
    }
  }
  console.log('');
  console.log(`=== the dialog, ${size(g.dialog)} at (${g.dialog.x1},${g.dialog.y1}) ===`);
  check(outside === 0, `the screen around the dialog is cleared to colour 0 (${outside} pixels are not)`);

  ui.screenIndexBuffer!.pixels.fill(7);
  SaveMenu.drawDialog(ui);
  console.log(`  list panel ${size(g.listPanel)} at (${g.listPanel.x1},${g.listPanel.y1}), preview panel ${size(g.previewPanel)} at (${g.previewPanel.x1},${g.previewPanel.y1})`);
  const bar = g.scrollbar;
  console.log(`  scrollbar ${size(bar)} at (${bar.x1},${bar.y1}), its arrows' boxes ${g.arrowBox} rows each`);
  check(bar.x2 === g.listPanel.x2 - 1 && bar.y1 === g.listPanel.y1 + 2 && bar.y2 === g.listPanel.y2 - 1,
    'the scrollbar stands against the right edge of the list\'s panel, over the whole height of its interior');
  check(g.listInnerX2 === bar.x1 - 1 && g.arrowBox === bar.x2 - bar.x1 + 1, 'the rows reach as far as it, and an arrow\'s box is as tall as it is wide');

  // Graphic 0's own margins: ten pixels of frame, ten rows from a panel to the buttons,
  // nine columns between two frames.
  const border = [g.listPanel.x1 - g.dialog.x1, g.listPanel.y1 - g.dialog.y1, g.dialog.x2 - g.previewPanel.x2, g.dialog.y2 - frames[0][1].y2];
  check(border.every((n) => n === 10), `ten pixels of frame on every side (${border.join(', ')})`);
  check(frames[0][1].y1 - g.listPanel.y2 - 1 === 10 && g.previewPanel.y2 === g.listPanel.y2 && g.previewPanel.y1 === g.listPanel.y1,
    'ten rows between the panels and the buttons, as between graphic 0\'s panel and its frame');
  const gaps = frames.slice(1).map(([, frame], i) => frame.x1 - frames[i][1].x2 - 1);
  console.log(`  buttons: ${frames.map(([name, frame]) => `${name} x ${frame.x1}..${frame.x2}`).join(', ')}`);
  check(gaps.every((n) => n === 9) && g.previewPanel.x1 - g.listPanel.x2 - 1 === 9,
    `nine columns between two buttons and between the panels, as between graphic 0's bottom pair (${gaps.join(', ')})`);
  check(frames[0][1].x1 === g.listPanel.x1 && frames[2][1].x2 === g.listPanel.x2
    && frames[3][1].x1 === g.previewPanel.x1 && frames[3][1].x2 === g.previewPanel.x2,
    'three buttons span the list\'s panel, and the fourth the preview\'s');

  console.log(['row', 'baseline y', 'non-panel pixels'].join('\t'));
  let dirtyTotal = 0;
  const bands: Array<[string, number]> = [];
  for (let row = 0; row < g.rows; row++) bands.push([`row ${row}`, g.rowFirstY + row * g.rowStep]);
  for (const [name, y] of bands) {
    // A row's highlight runs from `y-5` to `y+2`, across the panel's interior; the glyph
    // cell `drawTextLineIndex` fills is inside it.
    const dirty = countNot(ui, g.listInnerX1, g.listInnerX2, y - 5, y + 2, MENU_PANEL_COLOR);
    dirtyTotal += dirty;
    console.log([name, y, dirty].join('\t'));
  }
  check(dirtyTotal === 0, `every row sits on clean panel background (${dirtyTotal} stray pixels)`);
  const above = g.rowFirstY - 5 - (g.listPanel.y1 + 2);
  const below = g.listPanel.y2 - 1 - (g.rowFirstY + (g.rows - 1) * g.rowStep + 2);
  console.log(`  ${g.rows} rows of ${g.rowStep}: ${above} pixels of panel above the first, ${below} below the last`);
  check(above === 2 && below === above, 'the rows fill the panel, the same two pixels of it above the first and below the last');
  check(pixelAt(ui, g.listInnerX1 - 1, g.rowFirstY) !== MENU_PANEL_COLOR && pixelAt(ui, g.listPanel.x2, g.rowFirstY) !== MENU_PANEL_COLOR
    && countNot(ui, bar.x1, bar.x2, bar.y1, bar.y2, MENU_PANEL_COLOR) === 0,
    'the highlight runs from the panel\'s left edge, and the scrollbar stands on clean panel as far as its right one');

  // A row is 32 characters of a six-pixel cell; it has to stop short of the scrollbar.
  const rowRight = g.textX + g.textMaxChars * 6 - 1;
  console.log(`  a full row runs x ${g.textX}..${rowRight}, the rows' interior ends at ${g.listInnerX2}`);
  check(rowRight <= g.listInnerX2, `a full-width row stops short of the scrollbar (${rowRight} <= ${g.listInnerX2})`);

  const previewDirty = countNot(ui, g.previewPanel.x1 + 2, g.previewPanel.x2 - 1, g.previewPanel.y1 + 2, g.previewPanel.y2 - 1, MENU_PANEL_COLOR);
  check(previewDirty === 0, `the preview's panel is clean inside its edges (${previewDirty} stray pixels)`);
  const previewRight = g.previewTextX + g.previewMaxChars * 6 - 1;
  console.log(`  a full line of the preview runs x ${g.previewTextX}..${previewRight}, its panel's interior x ${g.previewPanel.x1 + 2}..${g.previewPanel.x2 - 1}`);
  check(g.previewTextX >= g.previewPanel.x1 + 2 && previewRight <= g.previewPanel.x2 - 1,
    `${g.previewMaxChars} characters fit inside the preview's panel (${previewRight} <= ${g.previewPanel.x2 - 1})`);
  check(g.previewTextX - g.previewPanel.x1 === g.textX - g.listPanel.x1, 'which start as far from its edge as a row does from the list\'s');

  // A label is six characters at most, and its cell has to lie on the button's face.
  let labelDirty = 0;
  for (const [, frame] of frames) {
    const at = Widgets.buttonLabelAt(frame);
    labelDirty += countNot(ui, at.x - 18, at.x + 17, at.y - 4, at.y + 1, MENU_PANEL_COLOR);
  }
  check(labelDirty === 0, `a six-character label lies on the face of every button (${labelDirty} stray pixels)`);
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
    sleep: false,
    savedAt: 0,
    playTime: 0,
    level: 0,
    champions: [],
    unofficial: false,
    ...over,
    // A row not used since it was saved, unless the caller says otherwise.
    usedAt: over.usedAt ?? over.savedAt ?? 0,
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

  const night = new Date(2026, 0, 9, 3, 7).getTime();
  check(formatSaveTime(night) === '03:07' && formatSaveTime(Number.NaN) === '??:??',
    'the time is HH:MM with both fields padded, and an unreadable one is not "Invalid Date"');

  // A save's row is its own alone: the day, the time, the level and F5's word. The party
  // is its heading's.
  const max = SaveMenu.SAVE_MENU_GEOMETRY.textMaxChars;
  const afternoon = new Date(2026, 8, 13, 14, 5).getTime();
  const rows: Array<[SaveEntry, string]> = [
    [entry({ savedAt: afternoon, level: 14, champions: ['DAROO', 'SONJA', 'LEYLA', 'ESMARDA'] }), '  2026-09-13 14:05 L14'],
    [entry({ savedAt: afternoon, level: 14, quick: true, champions: ['HALK'] }), '  2026-09-13 14:05 L14 QUICKSAVE'],
  ];
  console.log('');
  console.log(['row', 'chars'].join('\t'));
  for (const [row, expected] of rows) {
    const text = formatSaveRow(row);
    console.log([JSON.stringify(text), text.length].join('\t'));
    check(text === expected && text.length <= max, `a save's row is "${expected}": the day, the time, the level, and QUICKSAVE on F5's`);
  }

  // A heading is its playthrough's party, the champions of its newest save.
  const heading = (champions: string[], folded: boolean): string =>
    formatPlaythroughRow(playthroughsOf([entry({ champions })])[0], folded);
  const longest = heading(['HISSSSA', 'GOTHMOG', 'LINFLAS', 'ABCDEFG'], true);
  for (const text of [heading(['DAROO', 'SONJA', 'LEYLA', 'ESMARDA'], true), heading(['Halk '], false), longest, heading([], true)]) {
    console.log([JSON.stringify(text), text.length].join('\t'));
  }
  check(heading(['DAROO', 'SONJA', 'LEYLA', 'ESMARDA'], true) === '+ DAROO SONJA LEYLA ESMARDA' && heading(['Halk '], false) === '- HALK',
    'a heading is "+" folded and "-" unfolded, then the champions\' names in full');
  check(longest.length === max && longest.endsWith('ABCDEF'), `four names of seven characters are one more than the row's ${max}, and the last loses a letter`);
  check(heading(['GOTHMOG', 'HISSSSA', 'LINFLAS', 'DAROOU'], true).endsWith('DAROOU'), 'three of seven and one of six, the longest party of the Hall\'s own names, fit');
  check(heading([], true) === '+ ', 'and an empty party leaves the mark alone');

  // The preview: a line of its panel each.
  const hours = (h: number, m: number, sec: number): number => ((h * 60 + m) * 60 + sec) * 1000;
  const times: Array<[number, string]> = [
    [0, '0:00:00'], [999, '0:00:00'], [10_000, '0:00:10'], [hours(1, 2, 3), '1:02:03'], [hours(123, 59, 59) + 999, '123:59:59'],
    [-5, '0:00:00'], [Number.NaN, '0:00:00'],
  ];
  console.log('');
  console.log(`  play times: ${times.map(([ms]) => `${ms} ms -> ${formatPlayTime(ms)}`).join(', ')}`);
  check(times.every(([ms, expected]) => formatPlayTime(ms) === expected),
    'a play time is H:MM:SS, the seconds cut and not rounded, and what is no time is none');
  const wide = SaveMenu.SAVE_MENU_GEOMETRY.previewMaxChars;
  const full = formatSavePreview(entry({ savedAt: afternoon, level: 14, playTime: hours(12, 34, 56), champions: ['HISSSSA', 'Gothmog ', 'LINFLAS', 'ABCDEFG'] }));
  const alone = formatSavePreview(entry({ savedAt: afternoon, level: 5, quick: true, champions: ['HALK'] }));
  console.log(`  a preview: ${JSON.stringify(full)}`);
  console.log(`  of one champion: ${JSON.stringify(alone)}`);
  check(full.join('|') === 'HISSSSA|GOTHMOG|LINFLAS|ABCDEFG||LEVEL 14||PLAYED|12:34:56||SAVED|2026-09-13|14:05',
    'a preview is the champions\' names, the level, the play time, and the day and the time of the save');
  check(alone.join('|') === 'HALK|||||LEVEL 5||PLAYED|0:00:00||SAVED|2026-09-13|14:05',
    'a smaller party leaves its lines empty, so the rest stands where it does for four');
  check(full.length <= SaveMenu.SAVE_MENU_ROWS && full.every((line) => line.length <= wide),
    `it is no more lines than the list has rows, none longer than the panel's ${wide} characters`);
  check(formatSavePreview(entry({ playTime: hours(9_999, 59, 59) }))[8].length === wide,
    'a play time under ten thousand hours fits');

  // A message is wrapped at the preview's width.
  const wraps: Array<[string, string]> = [
    ['GAME SAVED', 'GAME SAVED'],
    ['WORKING...', 'WORKING...'],
    ['UNABLE TO SAVE GAME!', 'UNABLE TO|SAVE GAME!'],
    ['THE SAVE FILE DOES NOT READ BACK', 'THE SAVE|FILE DOES|NOT READ|BACK'],
    ['QUOTAEXCEEDEDERROR: FULL', 'QUOTAEXCEE|DEDERROR:|FULL'],
    ['  TWO  SPACES ', 'TWO SPACES'],
    ['', ''],
  ];
  for (const [message] of wraps) console.log(`  ${JSON.stringify(message)} -> ${JSON.stringify(SaveMenu.wrapMessage(message, wide))}`);
  check(wraps.every(([message, expected]) => SaveMenu.wrapMessage(message, wide).join('|') === expected),
    'a message is broken at its spaces into lines of the panel\'s width, a longer word cut at the line\'s end, and no message is no line');

  // The playthroughs: the saves of one id, the last one used first.
  const games = [
    entry({ name: 'a1', playthrough: 7, savedAt: 100, champions: ['OLD'] }),
    entry({ name: 'a2', playthrough: 7, savedAt: 400, champions: ['DAROO'] }),
    entry({ name: 'b1', playthrough: 9, savedAt: 200, usedAt: 500, champions: ['WUUF'] }),
    entry({ name: 'b2', playthrough: 9, savedAt: 300, champions: ['WUUF', 'HALK'] }),
    entry({ name: 'c1', playthrough: 3, savedAt: 50, champions: ['LEYLA'] }),
    entry({ name: 'c2', playthrough: 3, savedAt: 60, champions: ['SONJA'] }),
  ];
  const describe = (list: SaveEntry[]): string => playthroughsOf(list)
    .map((game) => `${game.id}: ${game.saves.map((e) => e.name).join(' ')} (last used ${game.lastUsed.name})`).join('; ');
  console.log('');
  console.log(`  playthroughs: ${describe(games)}`);
  check(describe(games) === '9: b2 b1 (last used b1); 7: a2 a1 (last used a2); 3: c2 c1 (last used c2)',
    'the saves are grouped by playthrough, each group\'s newest first, and the groups by their last use: a load counts as a save does');
  check(describe([...games].reverse()) === describe(games), 'in whatever order the rows come');
  check(playthroughsOf(games)[0].lastUsed === lastUsedSave(games), 'so the first playthrough holds the last save used of all');
  check(formatPlaythroughRow(playthroughsOf(games)[0], true) === '+ WUUF HALK' && formatPlaythroughRow(playthroughsOf(games)[1], true) === '+ DAROO',
    'a playthrough is named by its newest save\'s party, not the one last used nor the oldest');
  check(playthroughsOf([]).length === 0, 'and no save is no playthrough');

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
  // party that names one: the rule the store's upgrade stamps its rows by
  // (`tools/dump-save-stamp.ts`).
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
  ];
  const slot = (dataSet: string, playthrough: number): string => slotOf(slots, 'quick', dataSet, playthrough)?.name ?? 'none';
  console.log(`  F5's slot: playthrough 7 "${slot(DEFAULT_DATA_SET.id, 7)}", 9 "${slot(DEFAULT_DATA_SET.id, 9)}", 7 in csb "${slot('csb', 7)}", 8 "${slot(DEFAULT_DATA_SET.id, 8)}"`);
  check(slot(DEFAULT_DATA_SET.id, 7) === 'quick, newer', 'F5\'s slot is the playthrough\'s newest quick-save, never the menu\'s save');
  check(slot(DEFAULT_DATA_SET.id, 9) === 'quick, another playthrough' && slot('csb', 7) === 'quick, another set',
    'each playthrough has its own, in its own data set');
  check(slot(DEFAULT_DATA_SET.id, 8) === 'none', 'a playthrough not quick-saved yet has none');

  // The last save used: the latest `usedAt`, which a write and a load both set.
  const used = [
    entry({ name: 'saved last', savedAt: 300 }),
    entry({ name: 'loaded since', savedAt: 100, usedAt: 400 }),
    entry({ name: 'saved first', savedAt: 50 }),
  ];
  const last = (rows: SaveEntry[]): string => lastUsedSave(rows)?.name ?? 'none';
  const tie = [entry({ name: 'older, loaded', savedAt: 100, usedAt: 300 }), entry({ name: 'newer', savedAt: 300 })];
  console.log(`  the last save used: "${last(used)}"; without it "${last(used.filter((e) => e.name !== 'loaded since'))}"; of two used at once "${last(tie)}"; of none "${last([])}"`);
  check(last(used) === 'loaded since' && last([...used].reverse()) === 'loaded since',
    'the last save used is the one of the latest use, a load counting as a save does');
  check(last(used.filter((e) => e.name !== 'loaded since')) === 'saved last', 'with no load since, the save written last');
  check(last(tie) === 'newer' && last([...tie].reverse()) === 'newer' && last([]) === 'none',
    'of two used at once the one saved last, and of no save none');
  const { usedAt: _none, ...before } = { ...entry({ name: 'before', savedAt: 250 }), bytes: new ArrayBuffer(0) };
  check(saveEntryOf(before).usedAt === 250 && saveEntryOf({ ...before, usedAt: 900 }).usedAt === 900,
    'a stored row from before rows held the time counts as used when it was saved');
}

/* ------------------------------------------------------------- 5. the metadata ---- */

function healthyChampion(name: string): Champion {
  return testChampion(0, { name, attributes: { mana: 0, maxMana: 0 } });
}

async function loadGame(host?: Partial<GameHost>): Promise<Game> {
  return stockGame(host);
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
          if (game.ctx.dungeon.rnMaps.dbType(rn) === DBType.CHEST && chestContents(game, rn) >= 2) return { chest: rn, cell };
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
    'TAG02076e repacks it (Character.cpp:5141-5150): the chest holds its objects again');

  const fresh = await loadGame();
  applySaveBytes(fresh, buildSaveFile(game));
  const saved = chestContents(fresh, chest);
  console.log(`  a save taken now, restored into a fresh game: the chest holds ${saved}`);
  check(saved === packed, 'so a save taken with the menu up keeps the chest\'s objects');

  SaveMenu.closeSaveMenu(ui);
  console.log(`  menu gone: inventory ${party.selectedCharacterIndex}, caster ${party.magicCasterIndex}, word20252 ${ui.word20252}, word20250 ${ui.word20250}`);
  check(party.selectedCharacterIndex === 0 && party.magicCasterIndex === 0,
    'TAG0207cc shows the inventory again and keeps the living caster (CSBCode.cpp:10069-10082)');
  check(ui.word20252 === 1, 'and, with no attack menu open, brings the attack buttons back (d.Word20252 = 1)');
  check(ui.word20250 === 0,
    'its DrawLegalAttackTypes owes the panel nothing more, so no damage is flashed at the next tick (CSBCode.cpp:8898)');
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
  const saves = new GameSaves(game, DEFAULT_DATA_SET, diskFiles(DEFAULT_DATA_SET), store, {
    portraitOf: () => undefined,
    repackOpenChest: () => Inventory.repackOpenChest(ui),
  }, () => {});
  const row = await saves.save('running', 'quick');
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
  const rect = Widgets.buttonRect(SaveMenu.SAVE_MENU_GEOMETRY.buttonFrames.save);
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
 * has at 0 and `SaveGame`'s tail sets (`doc/CSBwin-src/SaveGame.cpp:1358`). Then one
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
    discardText: () => {},
  };
  const toldSince = (from: number): string => told.slice(from).join('').replace(/\n/g, '/');
  const stage = async (fail: boolean, dataSet = DEFAULT_DATA_SET, shared?: ReturnType<typeof memoryStore>, name = 'DAROO') => {
    const game = await loadGame({ messages });
    game.systems.hallOfChampions.addChampion(healthyChampion(name));
    let tailAtWrite: boolean | null = null;
    const store = shared ?? memoryStore(() => { tailAtWrite = game.canRestartFromSavegame(); }, fail);
    const saves = new GameSaves(game, dataSet, diskFiles(dataSet), store, { portraitOf: () => undefined, repackOpenChest: () => {} },
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
    const first = await menu.saves.save('stopped', 'new');
    console.log(`  clock stopped: tail run at the write ${menu.tailAtWrite()}, after it ${menu.game.canRestartFromSavegame()}`);
    check(menu.tailAtWrite() === false && menu.game.canRestartFromSavegame(),
      'the menu\'s save runs its tail once the file is written (SaveGame.cpp:1343-1358)');
    const second = await menu.saves.save('stopped', 'new');
    const third = await menu.saves.save('running', 'quick');
    console.log(`  names: ${first.name}, ${second.name}, ${third.name}`);
    check(first.name === makeSaveFileName(Date.now()), 'a save in an empty store takes the plain name');
    check(second.name === makeSaveFileName(Date.now(), new Set([first.name]))
      && third.name === makeSaveFileName(Date.now(), new Set([first.name, second.name])),
      'the store is listed, and its names are not taken again');
    check(menu.store.files.size === 3, 'so three saves in one second are three files');
    const listed = (await menu.saves.list()).find((e) => e.id === first.id);
    check(listed?.level === first.level && listed?.champions.join() === 'DAROO' && first.savedAt === Date.now(),
      'the row is the file\'s level and party, and the date of the save');
    check([first, second, third].every((e) => e.usedAt === e.savedAt), 'which is when it was last used');
    const playthrough = menu.game.ctx.state.block1.randomGameID;
    console.log(`  the row: data set ${first.dataSet}, ${first.playthrough === playthrough ? 'the game\'s' : 'ANOTHER'} playthrough, quick ${first.quick}; F5's: quick ${third.quick}`);
    check(first.dataSet === DEFAULT_DATA_SET.id, 'the row names the game\'s data set');
    check([first, second, third].every((e) => e.playthrough === playthrough),
      'and its playthrough, the game\'s d.RandomGameID, as the file holds it');
    check(!first.quick && !second.quick && third.quick, 'and whether the save is F5\'s or the menu\'s');

    // A second F5 writes over the first: the playthrough has one slot.
    now += 60_000;
    const fourth = await menu.saves.save('running', 'quick');
    const afterSlot = await menu.saves.list();
    console.log(`  F5 again, a minute later: ${fourth.id === third.id ? 'the same row' : 'ANOTHER ROW'}, ${menu.store.files.size} files, listed ${afterSlot[0]?.id === third.id ? 'first' : 'NOT FIRST'}`);
    check(fourth.id === third.id && fourth.name === third.name && menu.store.files.size === 3,
      'F5 writes over the playthrough\'s quick-save, under its key and its name');
    check(fourth.savedAt === now && afterSlot[0]?.id === third.id && afterSlot[0]?.savedAt === now,
      'which takes the new save\'s date, and is listed first');
    check(afterSlot.filter((e) => !e.quick).map((e) => e.id).sort().join() === [first.id, second.id].sort().join()
      && afterSlot.filter((e) => !e.quick).every((e) => e.savedAt < now),
      'and the menu\'s saves are as they were');
    const fifth = await menu.saves.save('stopped', 'new');
    check(fifth.id !== third.id && menu.store.files.size === 4, 'the menu\'s SAVE still makes a row of its own');

    // SAVE over a listed save: the row keeps its key and its name, and takes the file.
    now += 60_000;
    menu.game.ctx.party.state.champions[0]!.name = 'LATER';
    const over = await menu.saves.save('stopped', first);
    const afterOver = await menu.saves.list();
    const overParty = readCsbwinSaveInfo(await menu.store.read(first.id))?.champions.join('/');
    console.log(`  SAVE over the first save, the champion renamed: ${over.id === first.id ? 'the same row' : 'ANOTHER ROW'}, ${menu.store.files.size} files, its file's party ${overParty}, listed ${afterOver[0]?.id === first.id ? 'first' : 'NOT FIRST'}`);
    check(over.id === first.id && over.name === first.name && menu.store.files.size === 4,
      'SAVE over a listed save writes that row, under its key and its name');
    check(over.savedAt === now && over.champions.join() === 'LATER' && overParty === 'LATER' && afterOver[0]?.id === first.id,
      'which takes the new file, its party and its date, and is listed first');
    check(afterOver.filter((e) => e.id !== first.id).every((e) => e.champions.join() === 'DAROO' && e.savedAt < now),
      'and the other saves are as they were');

    // Over F5's slot: the row is the menu's save from then on, and F5 makes another.
    const overQuick = await menu.saves.save('stopped', third);
    const nextQuick = await menu.saves.save('running', 'quick');
    console.log(`  SAVE over F5's slot: ${overQuick.id === third.id ? 'the same row' : 'ANOTHER ROW'}, quick ${overQuick.quick}; F5 after it: ${nextQuick.id === third.id ? 'THE SAME ROW' : 'a row of its own'}, ${menu.store.files.size} files`);
    check(overQuick.id === third.id && !overQuick.quick, 'a quick-save that SAVE writes over is the menu\'s save');
    check(nextQuick.quick && nextQuick.id !== third.id && menu.store.files.size === 5,
      'so the next F5 leaves it alone, and makes a slot of its own');

    // Over a save of another playthrough: the row is the saved game's.
    const other = await stage(false, DEFAULT_DATA_SET, menu.store, 'WUUF');
    const taken = await other.saves.save('stopped', second);
    const otherPlaythrough = other.game.ctx.state.block1.randomGameID;
    console.log(`  SAVE over a save of another playthrough: ${taken.id === second.id ? 'the same row' : 'ANOTHER ROW'}, ${taken.playthrough === otherPlaythrough ? 'the saved game\'s' : 'ANOTHER'} playthrough, party ${taken.champions.join('/')}`);
    check(second.playthrough === playthrough && otherPlaythrough !== playthrough, 'another game is another playthrough than the save\'s');
    check(taken.id === second.id && taken.playthrough === otherPlaythrough && taken.champions.join() === 'WUUF' && menu.store.files.size === 5,
      'its SAVE over that save makes the row its own: its playthrough and its party');
    now -= 120_000;

    const menuFails = await stage(true);
    const refused = await attempt(menuFails.saves.save('stopped', 'new'));
    console.log(`  clock stopped, the write fails: ${refused}, tail run ${menuFails.game.canRestartFromSavegame()}`);
    check(refused !== 'written' && !menuFails.game.canRestartFromSavegame(),
      'a failed write skips the tail, as goto tag01e4f0 jumps past it (SaveGame.cpp:1361)');

    const quick = await stage(false);
    await quick.saves.save('running', 'quick');
    console.log(`  clock running: tail run at the write ${quick.tailAtWrite()}`);
    check(quick.tailAtWrite() === true, 'F5\'s save runs its tail before the write, on the world the file holds');

    const quickFails = await stage(true);
    const refusedQuick = await attempt(quickFails.saves.save('running', 'quick'));
    console.log(`  clock running, the write fails: ${refusedQuick}, tail run ${quickFails.game.canRestartFromSavegame()}`);
    check(refusedQuick !== 'written' && quickFails.game.canRestartFromSavegame(), 'and has run it when the write fails');

    // F5 lists the store while the game runs on, and the file is made before that.
    const slowGame = await loadGame({ messages });
    slowGame.systems.hallOfChampions.addChampion(healthyChampion('DAROO'));
    const champion = slowGame.ctx.party.state.champions[0]!;
    const atTheKey = champion.attributes.health;
    const slow = memoryStore(() => {}, false, () => { champion.attributes.health = 1; });
    const slowSaves = new GameSaves(slowGame, DEFAULT_DATA_SET, diskFiles(DEFAULT_DATA_SET), slow, { portraitOf: () => undefined, repackOpenChest: () => {} }, () => {});
    const late = await slowSaves.save('running', 'quick');
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
      'a read restores the save into the game (SaveGame.cpp:2087) and is \'loaded\'');
    check(afterFailure === 'damaged' && reader.saves.consumeSavedGameRead() === 'cancelled',
      'a failed one is \'damaged\', and each is forgotten once asked for');
    check(told.length === 0 && reports.length === 0, 'none of it is told in the message area: only F5 and F9 are');

    // F5 where the disk icon does nothing (`doc/CSBwin-src/Mouse.cpp:1855-1857`): a
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
      'a write that fails is tag01e4f0\'s line (SaveGame.cpp:1363), and its error is reported');

    // F5 while a DSA has disabled saves: CSBWin's disk menu's words, and no save.
    const disabled = await stage(false);
    disabled.game.systems.dsa.disableSaves = true;
    const beforeDisabled = told.length;
    await disabled.saves.quickSave();
    console.log(`  F5 with saves disabled: ${toldSince(beforeDisabled)}`);
    check(toldSince(beforeDisabled) === '/15:SAVES ARE DISABLED' && !disabled.game.canRestartFromSavegame(),
      'F5 saves nothing while a DSA has disabled saves, and says "SAVES ARE DISABLED"');
    check(reports.length === 6 && reports[5] === 'Quick-save refused: a DSA has disabled saves', 'and that is a line for the console');

    // F5 while the party slides, when the queue throws the disk icon's click away
    // (`doc/CSBwin-src/Mouse.cpp:1482-1491`).
    const sliding = await stage(false);
    sliding.game.ctx.loop.gravityMove = true;
    const beforeSlide = told.length;
    await sliding.saves.quickSave();
    console.log(`  F5 while the party slides: ${toldSince(beforeSlide)}`);
    check(toldSince(beforeSlide) === '/15:CANNOT SAVE NOW' && !sliding.game.canRestartFromSavegame()
      && reports.length === 7 && reports[6]!.startsWith('Quick-save refused'), 'F5 saves nothing while the party slides, and says so');

    // One store, two data sets: a game lists, and F9 loads, its own set's saves.
    console.log('');
    console.log('=== one store, two data sets ===');
    const shared = memoryStore();
    const csbSet = dataSetNamed('csb');
    const dm = await stage(false, DEFAULT_DATA_SET, shared, 'DAROO');
    const csb = await stage(false, csbSet, shared, 'LEYLA');
    const dmOld = await dm.saves.save('stopped', 'new');
    const csbSame = await csb.saves.save('stopped', 'new');
    now += 60_000;
    const dmNew = await dm.saves.quickSave().then(async () => (await dm.saves.list())[0]!);
    now += 60_000;
    const csbNew = await csb.saves.save('stopped', 'new');
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
    const afterF9 = await dm.saves.list();
    const f9Row = afterF9.find((e) => e.id === dmNew.id);
    console.log(`  the save F9 loaded: saved ${(now - (f9Row?.savedAt ?? 0)) / 60_000} minute ago, used ${(now - (f9Row?.usedAt ?? 0)) / 60_000}; the last used of ${DEFAULT_DATA_SET.id}: ${lastUsedSave(afterF9)?.id === dmNew.id ? 'that one' : 'ANOTHER'}`);
    check(f9Row?.usedAt === now && f9Row.savedAt === dmNew.savedAt && f9Row.savedAt < now && lastUsedSave(afterF9)?.id === dmNew.id,
      'the save it loaded is marked as used then, its date kept: the last save used of its data set');
    check((await csb.saves.list()).every((e) => e.usedAt === e.savedAt), 'and the other set\'s rows are untouched');

    // The menu's save, once it is the newer of the playthrough's.
    now += 60_000;
    const dmMenu = await dm.saves.save('stopped', 'new');
    await dm.saves.quickLoad();
    check(reports[reports.length - 1] === `Quick-loaded ${dmMenu.name}`, 'and the menu\'s save when that is the newer');

    // Another playthrough of the same set has no save of its own to load, and neither
    // has a set with no save at all.
    const stranger = await stage(false, DEFAULT_DATA_SET, shared, 'WUUF');
    const empty = await stage(false, dataSetNamed('dm-windows'), shared);
    const beforeNone = told.length;
    await stranger.saves.quickLoad();
    await empty.saves.quickLoad();
    console.log(`  F9 in another playthrough of ${DEFAULT_DATA_SET.id}, then in dm-windows: ${toldSince(beforeNone)}`);
    check(toldSince(beforeNone) === '/15:CAN\'T FIND SAVED GAME!/15:CAN\'T FIND SAVED GAME!'
      && stranger.game.ctx.party.state.champions[0]!.name === 'WUUF' && empty.game.ctx.party.state.champions[0]!.name === 'DAROO',
      'F9 in a playthrough with no save finds none (SaveGame.cpp:1710), whatever the others hold, and loads nothing');

    // Each playthrough's F5 has its own slot.
    const strangerQuick = await stranger.saves.save('running', 'quick');
    const dmQuick = await dm.saves.save('running', 'quick');
    check(strangerQuick.id !== dmNew.id && dmQuick.id === dmNew.id && shared.files.size === 6,
      'and each playthrough\'s F5 writes its own slot');

    const idOf = (of: { game: Game }): number => of.game.ctx.state.block1.randomGameID;

    // A drawn id is no stored save's. With the host's `rand()` pinned, every stream is
    // the same one, so every draw gives the same first id.
    console.log('');
    console.log('=== a drawn playthrough is no stored save\'s ===');
    const SEED = 0x2468ace0;
    const stream = new CsbRandom(SEED);
    const firstId = drawRandomGameID(stream);
    const secondId = drawRandomGameID(stream);
    const afterSecond = stream.getSeed();
    const thirdId = drawRandomGameID(stream);
    const hex = (id: number): string => id.toString(16);
    console.log(`  the stream of seed ${hex(SEED)} draws ${hex(firstId)}, ${hex(secondId)}, ${hex(thirdId)}`);
    const drawn = memoryStore();
    /** A new game as the page reads one: `dungeon.dat`, then the store's say on its id. */
    const fresh = async (store: SaveStore, dataSet = DEFAULT_DATA_SET) => {
      const game = await loadGame({ messages });
      const before = game.ctx.state.block1.randomGameID;
      const saves = new GameSaves(game, dataSet, diskFiles(dataSet), store, { portraitOf: () => undefined, repackOpenChest: () => {} },
        (message: string) => { reports.push(message); });
      await saves.newGameRead();
      return { game, saves, before };
    };
    const saved = async (of: { game: Game; saves: GameSaves }, name: string): Promise<SaveEntry> => {
      of.game.systems.hallOfChampions.addChampion(healthyChampion(name));
      return of.saves.save('stopped', 'new');
    };
    const random = Math.random;
    Math.random = () => SEED / 0x100000000;
    try {
      const one = await fresh(drawn);
      check(one.before === firstId && idOf(one) === firstId, 'a new game keeps the id it drew when no save holds it');
      await saved(one, 'DAROO');

      const two = await fresh(drawn);
      console.log(`  a new game, a save holding ${hex(firstId)}: drew ${hex(two.before)}, plays under ${hex(idOf(two))}`);
      check(two.before === firstId && idOf(two) === secondId, 'a new game that drew a stored save\'s id takes the next of its stream');
      check(two.game.ctx.random.getSeed() === afterSecond, 'which is the game\'s own stream, two draws further on');
      await saved(two, 'DAROO');

      const three = await fresh(drawn);
      const elsewhere = await fresh(drawn, csbSet);
      console.log(`  and with one holding ${hex(secondId)} too: ${hex(idOf(three))}; in ${csbSet.id}, which has no save: ${hex(idOf(elsewhere))}`);
      check(idOf(three) === thirdId, 'and the one after while a save holds that');
      check(idOf(elsewhere) === firstId, 'another data set\'s saves do not count: every comparison is a data set\'s');

      const reportsBefore = reports.length;
      const unlisted = await fresh(memoryStore(() => {}, false, () => { throw new Error('no store'); }));
      check(idOf(unlisted) === firstId && reports.length === reportsBefore + 1 && reports[reports.length - 1]!.startsWith('New game:'),
        'a store that cannot be listed leaves the id as drawn, and says so on the console');
    } finally {
      Math.random = random;
    }
  } finally {
    Date.now = realNow;
  }
}

/* ------------------------------------------------------------ 10. the selection ---- */

/** The menu's buttons answer the left button (`UIButton.button` 2), and a right-click is 1. */
const LEFT = 2;
const RIGHT = 1;

/**
 * A game of one champion and its disk menu, the menu's hooks on a `GameSaves` over
 * `store`, with the clicks a tool makes on it.
 */
async function menuRig(
  graphics: GraphicsLoader, store: SaveStore, champion: string,
  hooks: Partial<Pick<UIState, 'onHasNewFaces' | 'onMakeNewAdventure'>> = {},
  dataSet: DataSet = DEFAULT_DATA_SET,
  files: DataSetFiles = diskFiles(dataSet),
) {
  const game = await loadGame();
  game.systems.hallOfChampions.addChampion(healthyChampion(champion));
  const saves = new GameSaves(game, dataSet, files, store, { portraitOf: () => undefined, repackOpenChest: () => {} }, () => {});
  let drawsWithNoMenu = 0;
  const exported: { name: string; bytes: Uint8Array }[] = [];
  const ui: UIState = newUIState(graphics, game.ctx, {
    getGraphicBitmap: graphicBitmaps(graphics),
    renderLastFrame: () => { if (!ui.saveMenu) drawsWithNoMenu++; },
    onListSaves: () => saves.list(),
    onListEverySave: () => saves.listEverySet(),
    onReadSave: (listed) => saves.open(listed),
    onSaveGame: (over) => saves.save('stopped', over ?? 'new'),
    // As the page's, with the download kept instead of made.
    onExportSave: async (listed) => { exported.push({ name: listed.name, bytes: (await saves.open(listed)).bytes }); },
    onDeleteSave: (listed) => saves.remove(listed),
    onImportSave: (file, answer) => saves.importSave(file, answer),
    onRestoreSave: (save) => saves.read(save),
    ...hooks,
  });
  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  return {
    game,
    saves,
    ui,
    /** What EXPORT handed the page, in order: a file's name and its bytes. */
    exported,
    /** Raise the menu, and wait for its list. */
    async open(mode: SaveMenu.SaveMenuMode = 'full'): Promise<SaveMenu.SaveMenuState> {
      ui.partyState = game.ctx.party.state;
      SaveMenu.openSaveMenu(ui, mode);
      await this.settled();
      return ui.saveMenu!;
    },
    /** Wait out a listing, or a press and the save or load behind it. */
    async settled(): Promise<void> {
      for (let i = 0; i < 300 && ui.saveMenu && (ui.saveMenu.busy || ui.saveMenu.press); i++) {
        await new Promise((done) => setTimeout(done, 10));
      }
    },
    /** A file dropped on the dialog, and the wait for its import; whether the dialog took it. */
    async drop(name: string, bytes: Uint8Array): Promise<boolean> {
      const taken = SaveMenu.saveMenuDrop(ui, { name, bytes });
      await this.settled();
      return taken;
    },
    /** A click on row `row` of the list, which is in view: its press and its release. */
    clickRow(row: number): void {
      this.pressRow(row);
      ui.dialog?.release?.(ui);
    },
    /** A press on row `row` of the list, which is in view, held until `ui.dialog.release`. */
    pressRow(row: number): void {
      const { rowFirstY } = SaveMenu.saveMenuList(ui.saveMenu!.mode);
      SaveMenu.saveMenuClick(ui, g.textX, rowFirstY + (row - ui.saveMenu!.scrollTop) * g.rowStep, LEFT);
    },
    /** The row of a playthrough's heading, as the menu lists it now. */
    headingOf(playthrough: number): number {
      return ui.saveMenu!.rows.findIndex((row) => row.kind === 'heading' && row.playthrough.id === playthrough);
    },
    /** A click on the save `id`, after one on its heading when its playthrough is folded. */
    select(id: string): void {
      const state = ui.saveMenu!;
      if (this.rowOf(id) < 0) this.clickRow(this.headingOf(state.entries.find((e) => e.id === id)!.playthrough));
      this.clickRow(this.rowOf(id));
    },
    /** The list as the dialog shows it, the selected row marked. */
    list(): string {
      const state = ui.saveMenu!;
      return state.rows.map((row, i) => `    ${i === state.selected ? '>' : ' '} ${SaveMenu.rowText(state, row)}`).join('\n');
    },
    /**
     * A click on button `id`, and the wait for what it does: one of the dialog's own, or
     * with `options` one of the question's, `_DoMenu`'s centred set of that many.
     */
    async click(id: number, options?: number): Promise<void> {
      const rect = menuButtonRect(options ? menuButtonList(ui, options, true) : SaveMenu.saveMenuButtons(ui.saveMenu!), id);
      if (!rect) throw new Error(`the menu has no button ${id}`);
      SaveMenu.saveMenuClick(ui, rect.x1 + 1, rect.y1 + 1, LEFT);
      await this.settled();
    },
    /** The row of the list that shows the save `id`, as the menu lists it now: -1 under a folded heading. */
    rowOf(id: string): number {
      return ui.saveMenu!.rows.findIndex((row) => row.kind === 'save' && row.entry.id === id);
    },
    party(): string {
      return game.ctx.party.state.champions.map((c) => c.name).join('/');
    },
    /** How many times the screen has been drawn with no menu up. */
    drawsWithNoMenu(): number {
      return drawsWithNoMenu;
    },
  };
}

/**
 * The disk menu driven by its own clicks and keys, its hooks on a `GameSaves` over a
 * store in memory: what is selected when it opens, and what SAVE writes for it.
 */
async function checkSelection(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== the menu\'s selection, and what SAVE writes ===');
  const store = memoryStore();
  const rig = await menuRig(graphics, store, 'DAROO');
  const { game, ui } = rig;
  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  const selection = (): string => {
    const state = ui.saveMenu;
    if (!state) return 'no menu';
    const selected = SaveMenu.selectedEntry(state);
    return `row ${state.selected} of ${state.rows.length}, ${state.entries.length} saves, ${selected ? `the save of ${formatSaveDate(selected.savedAt)} ${new Date(selected.savedAt).getUTCMinutes()}'` : 'no save'}`;
  };

  const realNow = Date.now;
  let now = Date.UTC(2026, 8, 13, 14, 5, 6);
  Date.now = () => now;
  try {
    const state = await rig.open();
    console.log(`  the full menu, an empty store: ${selection()}`);
    check(state.selected === 0 && SaveMenu.selectedEntry(state) === null && state.entries.length === 0,
      'the full menu opens on its "new save" row, the one row of an empty store');
    SaveMenu.saveMenuKey(ui, 'Enter');
    const pressAtEnter = state.press;
    await rig.click(g.loadButtonId);
    check(pressAtEnter === null && SaveMenu.isSaveMenuOpen(ui) && game.ctx.party.state.champions.length === 1,
      'where LOAD is inert, and Enter, which is LOAD: the row holds nothing to load');
    await rig.click(g.exportButtonId);
    check(state.press === null && SaveMenu.isSaveMenuOpen(ui) && rig.exported.length === 0 && state.message === '',
      'nor EXPORT: "new save" is no save');

    await rig.click(g.saveButtonId);
    const made = SaveMenu.selectedEntry(state);
    console.log(`  SAVE: ${store.files.size} file, ${selection()}, "${state.message}"`);
    check(store.files.size === 1 && made !== null && made.savedAt === now && state.message === 'GAME SAVED',
      'SAVE there makes a save, which is the selection afterwards');
    check(state.rows.length === 2 && state.rows[0].kind === 'heading' && state.selected === 1,
      'under its playthrough\'s heading, which has taken the place of "new save"');

    now += 60_000;
    await rig.click(g.saveButtonId);
    console.log(`  SAVE again, a minute later: ${store.files.size} file, ${selection()}`);
    check(store.files.size === 1 && SaveMenu.selectedEntry(state)?.id === made?.id && SaveMenu.selectedEntry(state)?.savedAt === now,
      'SAVE on a save writes over it: one file still, with the new date');

    now += 60_000;
    rig.clickRow(0);
    check(SaveMenu.selectedEntry(state) === null && state.selected === 0 && state.rows.length === 1,
      'a click on the heading selects it, and folds its save away');
    await rig.click(g.saveButtonId);
    const newer = SaveMenu.selectedEntry(state);
    console.log(`  the heading, then SAVE: ${store.files.size} files, ${selection()}`);
    check(store.files.size === 2 && newer !== null && newer.id !== made?.id && state.selected === 1 && state.rows.length === 3,
      'and SAVE there makes another, the first of the saves, its playthrough unfolded again');

    // The keys run over the same rows.
    SaveMenu.saveMenuKey(ui, 'End');
    const atEnd = SaveMenu.selectedEntry(state)?.id;
    SaveMenu.saveMenuKey(ui, 'ArrowRight');
    SaveMenu.saveMenuKey(ui, 'ArrowLeft');
    const fromSave = [state.selected, state.rows.length].join();
    SaveMenu.saveMenuKey(ui, 'ArrowLeft');
    const folded = state.rows.length;
    SaveMenu.saveMenuKey(ui, 'ArrowLeft');
    SaveMenu.saveMenuKey(ui, 'End');
    const endFolded = state.selected;
    SaveMenu.saveMenuKey(ui, 'ArrowRight');
    SaveMenu.saveMenuKey(ui, 'ArrowRight');
    SaveMenu.saveMenuKey(ui, 'End');
    SaveMenu.saveMenuKey(ui, 'Home');
    check(atEnd === made?.id && SaveMenu.selectedEntry(state) === null && state.selected === 0,
      'End is the oldest save, and Home the heading');
    check(fromSave === '0,3' && folded === 1 && endFolded === 0 && state.rows.length === 3,
      'the left arrow goes from a save to its heading, and there folds it; the right one unfolds it; neither does it twice');

    // LOAD takes the selected save.
    now += 60_000;
    game.ctx.party.state.champions[0]!.name = 'CHANGED';
    rig.clickRow(2);
    check(SaveMenu.selectedEntry(state)?.id === made?.id, 'a click on the third row selects the older save');
    await rig.click(g.loadButtonId);
    console.log(`  the older save, then LOAD: ${selection()}, party ${rig.party()}`);
    check(!SaveMenu.isSaveMenuOpen(ui) && rig.party() === 'DAROO', 'LOAD reads it into the game, and the menu closes');

    // The menu opens on the last save used, and the save just loaded is that.
    const again = await rig.open();
    const reopened = SaveMenu.selectedEntry(again);
    console.log(`  the full menu again: ${selection()}`);
    check(reopened?.id === made?.id && again.selected === 2 && reopened?.usedAt === now && reopened.savedAt < now,
      'the full menu opens on the last save used: the one loaded, though the other was saved later');

    // LOAD from the heading takes the last save used of the playthrough, not its newest.
    now += 60_000;
    game.ctx.party.state.champions[0]!.name = 'CHANGED';
    rig.clickRow(0);
    const fromHeading = SaveMenu.loadTarget(again)?.id;
    await rig.click(g.loadButtonId);
    const usedThen = (await rig.saves.list()).map((e) => `${e.id === made?.id ? 'older' : 'newer'} ${e.usedAt === now ? 'now' : 'before'}`).join(', ');
    console.log(`  the heading, then LOAD: ${selection()}, party ${rig.party()}, used: ${usedThen}`);
    check(fromHeading === made?.id && !SaveMenu.isSaveMenuOpen(ui) && rig.party() === 'DAROO' && usedThen === 'newer before, older now',
      'LOAD on the heading reads the playthrough\'s last save used, though the other is its newest');

    // A read that fails marks nothing.
    let refused = false;
    try {
      rig.saves.read({ entry: newer!, bytes: new Uint8Array(64) });
    } catch {
      refused = true;
    }
    check(refused && lastUsedSave(await rig.saves.list())?.id === made?.id, 'a save that does not read is not the last one used');

    // The boot's chooser lists the saves alone.
    const chooser = await rig.open('loadOnly');
    console.log(`  the load-only chooser: ${selection()}`);
    check(chooser.entries.length === 2 && chooser.rows.length === 3 && chooser.selected === 2 && SaveMenu.selectedEntry(chooser)?.id === made?.id,
      'the load-only chooser lists the same rows, and opens on the last save used too');
    await rig.click(g.saveButtonId);
    check(store.files.size === 2 && SaveMenu.isSaveMenuOpen(ui), 'and its SAVE is inert');

    // CLOSE is a button like the others: its press plays first.
    const cancel = Widgets.buttonRect(g.buttonFrames.close);
    SaveMenu.saveMenuClick(ui, cancel.x1, cancel.y1, LEFT);
    const pressed = chooser.press?.buttonId === g.closeButtonId && SaveMenu.isSaveMenuOpen(ui);
    const drawsThen = rig.drawsWithNoMenu();
    await rig.settled();
    console.log(`  CLOSE: ${pressed ? 'pressed' : 'NOT PRESSED'}, then ${SaveMenu.isSaveMenuOpen(ui) ? 'THE MENU' : 'the menu gone'}, the screen drawn ${rig.drawsWithNoMenu() - drawsThen} time(s) after it, party ${rig.party()}`);
    check(pressed && !SaveMenu.isSaveMenuOpen(ui) && rig.party() === 'DAROO', 'CLOSE plays its press, then closes the chooser, and nothing is loaded');
    check(rig.drawsWithNoMenu() === drawsThen + 1, 'and the screen is drawn once more with the chooser gone, which the entrance waits on');

    // Saved over, the other save is the last one used.
    now += 60_000;
    const third = await rig.open();
    rig.clickRow(1);
    await rig.click(g.saveButtonId);
    SaveMenu.closeSaveMenu(ui);
    const fourth = await rig.open();
    console.log(`  the newer save written over, and the full menu again: ${selection()}`);
    check(third.entries.length === 2 && SaveMenu.selectedEntry(fourth)?.id === newer?.id && store.files.size === 2,
      'and the full menu then opens on the save written last');
    SaveMenu.closeSaveMenu(ui);

    // A list longer than the panel is scrolled to it. The save is loaded through the row
    // as it was first listed: only the time is the load's to write.
    for (let n = 0; n < SaveMenu.SAVE_MENU_ROWS; n++) {
      now += 60_000;
      await rig.saves.save('stopped', 'new');
    }
    now += 60_000;
    rig.saves.read(await rig.saves.open(made!));
    const long = await rig.open();
    console.log(`  ${long.entries.length} saves, the oldest loaded: ${selection()}, the list scrolled to row ${long.scrollTop}`);
    check(SaveMenu.selectedEntry(long)?.id === made?.id && long.selected === long.entries.length
      && long.scrollTop === long.selected - SaveMenu.SAVE_MENU_ROWS + 1, 'the list opens scrolled to the last save used');
    check(made?.savedAt !== reopened?.savedAt && SaveMenu.selectedEntry(long)?.savedAt === reopened?.savedAt && SaveMenu.selectedEntry(long)?.usedAt === now,
      'a load sets the time of its row and nothing else: the date is the store\'s, not that of the row the load was handed');
    SaveMenu.closeSaveMenu(ui);
  } finally {
    Date.now = realNow;
  }
}

/* ------------------------------------------------------------- 11. the question ---- */

/**
 * One store, the saves of two games, and the first game's menu over them: which LOAD and which SAVE ask first, and what each answer does.
 */
async function checkQuestion(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== the question before a load or a save across playthroughs ===');
  const store = memoryStore();
  const mine = await menuRig(graphics, store, 'DAROO');
  const theirs = await menuRig(graphics, store, 'WUUF');
  const idOf = (rig: { game: Game }): number => rig.game.ctx.state.block1.randomGameID;
  const { ui } = mine;
  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  const rowOfStore = async (id: string): Promise<SaveEntry | undefined> => (await store.list(null)).find((e) => e.id === id);
  /** Select a save and press LOAD or SAVE; what is up once the press has played. */
  const press = async (save: SaveEntry, button: number): Promise<string> => {
    mine.select(save.id);
    await mine.click(button);
    const state = ui.saveMenu;
    return !state ? 'no menu' : state.confirm ? `asks (${state.confirm})` : `no question, "${state.message}"`;
  };

  const realNow = Date.now;
  let now = Date.UTC(2026, 8, 13, 14, 5, 6);
  Date.now = () => now;
  const later = (): void => { now += 60_000; };
  try {
    const theirOlder = await theirs.saves.save('stopped', 'new');
    later();
    const theirNewer = await theirs.saves.save('stopped', 'new');
    later();
    const own = await mine.saves.save('stopped', 'new');
    later();
    check(idOf(mine) !== idOf(theirs), 'two games are two playthroughs');

    const state = await mine.open();
    const files = store.files.size;

    // The game's own save: neither asks.
    const ownSave = await press(own, g.saveButtonId);
    console.log(`  SAVE on the game's own save: ${ownSave}`);
    check(ownSave === 'no question, "GAME SAVED"' && (await rowOfStore(own.id))?.savedAt === now && store.files.size === files,
      'SAVE over a save of the running game\'s playthrough does not ask');
    later();

    // Another playthrough's: SAVE asks, and writes nothing until the answer.
    const held = store.files.get(theirNewer.id);
    const asked = await press(theirNewer, g.saveButtonId);
    console.log(`  SAVE on another playthrough's save: ${asked}`);
    check(asked === 'asks (save)' && store.files.get(theirNewer.id) === held,
      'SAVE over a save of another playthrough asks first, and has written nothing');

    // The question is `_DoMenu`'s two-option menu, centred, in the dialog's place.
    SaveMenu.drawSaveMenu(ui);
    const drawn = ui.screenIndexBuffer!.pixels.slice();
    ui.screenIndexBuffer!.pixels.fill(0);
    doMenu(ui, SaveMenu.SAVE_MENU_QUESTION, null, ['SAVE', 'CANCEL'], true);
    check(drawn.every((p, i) => p === ui.screenIndexBuffer!.pixels[i]),
      `it is _DoMenu's two-option menu, centred on the cleared screen: "${SaveMenu.SAVE_MENU_QUESTION}", SAVE, CANCEL`);

    SaveMenu.saveMenuClick(ui, VIEWPORT_X + 4, VIEWPORT_Y + 4, LEFT);
    SaveMenu.saveMenuKey(ui, 'Enter');
    SaveMenu.saveMenuWheel(ui, 100);
    await mine.settled();
    check(state.confirm === 'save' && state.press === null && state.scrollTop === 0,
      'a click off its buttons, Enter and the wheel leave it up');

    await mine.click(211, 2);
    console.log(`  CANCEL: ${state.confirm ? 'STILL ASKING' : 'the list'}, the selection ${SaveMenu.selectedEntry(state)?.id === theirNewer.id ? 'kept' : 'LOST'}`);
    check(state.confirm === null && SaveMenu.isSaveMenuOpen(ui) && SaveMenu.selectedEntry(state)?.id === theirNewer.id
      && store.files.get(theirNewer.id) === held, 'CANCEL brings the list back, the save selected and unwritten');

    await mine.click(g.saveButtonId);
    SaveMenu.saveMenuKey(ui, 'Escape');
    const afterEscape = state.confirm;
    await mine.click(g.saveButtonId);
    SaveMenu.saveMenuClick(ui, VIEWPORT_X + 4, VIEWPORT_Y + 4, RIGHT);
    check(afterEscape === null && state.confirm === null && SaveMenu.isSaveMenuOpen(ui) && store.files.get(theirNewer.id) === held,
      'Esc and a right-click cancel the question, not the menu');

    await mine.click(g.saveButtonId);
    await mine.click(210, 2);
    const written = await rowOfStore(theirNewer.id);
    console.log(`  SAVE, then its first button: "${state.message}", the row ${written?.playthrough === idOf(mine) ? 'the running game\'s' : 'NOT WRITTEN'}, party ${written?.champions.join('/')}`);
    check(state.confirm === null && state.message === 'GAME SAVED' && written?.playthrough === idOf(mine)
      && written.champions.join() === 'DAROO' && store.files.size === files, 'its first button saves over it');
    later();

    // A new save writes over nothing.
    mine.clickRow(mine.headingOf(idOf(mine)));
    await mine.click(g.saveButtonId);
    check(state.confirm === null && store.files.size === files + 1, 'SAVE from the game\'s own heading does not ask');
    later();

    // LOAD asks the same.
    const askedLoad = await press(theirOlder, g.loadButtonId);
    console.log(`  LOAD on another playthrough's save: ${askedLoad}, party ${mine.party()}`);
    check(askedLoad === 'asks (load)' && mine.party() === 'DAROO' && idOf(mine) !== idOf(theirs),
      'LOAD of a save of another playthrough asks first, and has loaded nothing');
    await mine.click(210, 2);
    console.log(`  LOAD, then its first button: ${SaveMenu.isSaveMenuOpen(ui) ? 'THE MENU' : 'the menu gone'}, party ${mine.party()}`);
    check(!SaveMenu.isSaveMenuOpen(ui) && mine.party() === 'WUUF' && idOf(mine) === idOf(theirs),
      'its first button loads it: the game is that playthrough\'s');

    // The loaded game is of that playthrough now, and its saves are its own.
    await mine.open();
    const sameNow = await press(theirOlder, g.loadButtonId);
    console.log(`  LOAD on the same save, from the game it loaded: ${sameNow}`);
    check(sameNow === 'no menu' && mine.party() === 'WUUF', 'which that save is now of: LOAD does not ask again');

    // The load-only chooser has no game behind it.
    const stranger = await menuRig(graphics, store, 'HALK');
    const chooser = await stranger.open('loadOnly');
    check(SaveMenu.selectedEntry(chooser)?.playthrough !== idOf(stranger) && !SaveMenu.asksFirst(stranger.ui, chooser, 'load'),
      'the load-only chooser asks about no save');
    await stranger.click(g.loadButtonId);
    console.log(`  the load-only chooser, LOAD on the last save used: ${SaveMenu.isSaveMenuOpen(stranger.ui) ? 'THE MENU' : 'the menu gone'}, party ${stranger.party()}`);
    check(!SaveMenu.isSaveMenuOpen(stranger.ui) && stranger.party() === 'WUUF', 'and loads it at once');
  } finally {
    Date.now = realNow;
  }
}

/* ------------------------------------------------------ 13. the two-level list ---- */

/**
 * One store, the saves of three games, and the menus over them: what is listed, folded
 * and selected, and what LOAD and SAVE do from a heading.
 */
/** How many pixels of a button's label are up: none on a button that can do nothing. */
function labelOf(ui: UIState, frame: { x1: number; y1: number; x2: number; y2: number }): number {
  SaveMenu.drawSaveMenu(ui);
  const at = Widgets.buttonLabelAt(frame);
  return countNot(ui, at.x - 18, at.x + 17, at.y - 4, at.y + 1, MENU_PANEL_COLOR);
}

async function checkTwoLevels(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== the two-level list ===');
  const store = memoryStore();
  const daroo = await menuRig(graphics, store, 'DAROO');
  const wuuf = await menuRig(graphics, store, 'WUUF');
  const halk = await menuRig(graphics, store, 'HALK');
  const idOf = (rig: { game: Game }): number => rig.game.ctx.state.block1.randomGameID;
  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  const usedAt = async (id: string): Promise<number | undefined> => (await store.list(null)).find((e) => e.id === id)?.usedAt;
  /** The list's headings, in order, each by its game's champion and folded or not. */
  const headings = (state: SaveMenu.SaveMenuState): string => state.rows
    .flatMap((row) => row.kind === 'heading' ? [`${row.playthrough.saves[0].champions[0]}${state.unfolded.has(row.playthrough.id) ? ' unfolded' : ''}`] : [])
    .join(', ');
  const realNow = Date.now;
  let now = new Date(2026, 8, 13, 14, 5, 6).getTime();
  Date.now = () => now;
  const later = (): void => { now += 60_000; };
  try {
    const darooFirst = await daroo.saves.save('stopped', 'new');
    later();
    const wuufOlder = await wuuf.saves.save('stopped', 'new');
    later();
    const halkOnly = await halk.saves.save('stopped', 'new');
    later();
    const wuufNewer = await wuuf.saves.save('stopped', 'new');
    later();
    await daroo.saves.quickSave();
    const darooQuick = (await store.list(null)).find((e) => e.quick)!;
    later();
    wuuf.saves.read(await wuuf.saves.open(wuufOlder));
    later();

    // DAROO's menu: his own save is the newest, and WUUF's playthrough the last one used.
    const { ui } = daroo;
    const state = await daroo.open();
    console.log('  DAROO\'s menu, WUUF\'s older save the last one used:');
    console.log(daroo.list());
    check(headings(state) === 'WUUF unfolded, DAROO, HALK',
      'a heading for each playthrough, the last one used first, and that one alone unfolded');
    check(state.rows.length === 5 && state.rows.every((row) => row.kind !== 'new'),
      'no "new save" row: the running game\'s playthrough has a heading');
    check(SaveMenu.selectedEntry(state)?.id === wuufOlder.id && state.selected === 2 && daroo.rowOf(wuufNewer.id) === 1,
      'the last save used is selected, under its playthrough\'s newest');
    check(SaveMenu.rowText(state, state.rows[0]) === '- WUUF' && SaveMenu.rowText(state, state.rows[3]) === '+ DAROO'
      && SaveMenu.rowText(state, state.rows[1]) === '  2026-09-13 14:08 L0',
      'a heading shows its party behind its fold mark, and a save its day, time and level');

    // A click on a heading selects it, and unfolds it or folds it.
    daroo.clickRow(daroo.headingOf(idOf(daroo)));
    console.log('  a click on DAROO\'s heading:');
    console.log(daroo.list());
    check(headings(state) === 'WUUF unfolded, DAROO unfolded, HALK' && state.selected === 3 && SaveMenu.selectedEntry(state) === null
      && daroo.rowOf(darooQuick.id) === 4 && daroo.rowOf(darooFirst.id) === 5,
      'a click on a folded heading selects it and lists its saves under it, newest first');
    check(SaveMenu.rowText(state, state.rows[4]) === '  2026-09-13 14:09 L0 QUICKSAVE', 'F5\'s save is marked');
    daroo.clickRow(0);
    check(headings(state) === 'WUUF, DAROO unfolded, HALK' && state.selected === 0 && daroo.headingOf(idOf(daroo)) === 1,
      'a click on an unfolded one folds it, and the rows below move up');

    // Another playthrough's heading: SAVE is inert, and LOAD asks.
    const files = store.files.size;
    const labels = [labelOf(ui, g.buttonFrames.load), labelOf(ui, g.buttonFrames.save)];
    await daroo.click(g.saveButtonId);
    console.log(`  WUUF's heading selected: LOAD's label ${labels[0]} pixels, SAVE's ${labels[1]}; SAVE clicked: ${store.files.size - files} file(s) more, ${state.confirm ? 'ASKS' : 'no question'}, "${state.message}"`);
    check(labels[0] > 0 && labels[1] === 0 && store.files.size === files && state.confirm === null && state.message === '',
      'on another playthrough\'s heading SAVE has no label and takes no click');
    check(SaveMenu.loadTarget(state)?.id === wuufOlder.id, 'and LOAD is for its last save used, not its newest');
    await daroo.click(g.loadButtonId);
    const asked = state.confirm;
    await daroo.click(211, 2);
    check(asked === 'load' && state.confirm === null && daroo.party() === 'DAROO', 'LOAD there asks first, as on a save of that playthrough');

    // The running game's own heading: SAVE makes a new save, and LOAD reads the last one used.
    daroo.clickRow(daroo.headingOf(idOf(halk)));
    daroo.clickRow(daroo.headingOf(idOf(daroo)));
    const ownLabels = [labelOf(ui, g.buttonFrames.load), labelOf(ui, g.buttonFrames.save)];
    await daroo.click(g.saveButtonId);
    const darooNew = SaveMenu.selectedEntry(state);
    console.log('  DAROO\'s own heading, then SAVE:');
    console.log(daroo.list());
    check(ownLabels.every((n) => n > 0) && store.files.size === files + 1 && state.confirm === null && state.message === 'GAME SAVED'
      && darooNew !== null && darooNew.playthrough === idOf(daroo) && !darooNew.quick && darooNew.savedAt === now,
      'on the running game\'s own heading SAVE makes a new save of its playthrough, and does not ask');
    check(headings(state) === 'DAROO unfolded, WUUF, HALK unfolded' && state.selected === 1,
      'which is selected, its playthrough now the first; a heading the player unfolded stays so');
    later();

    daroo.game.ctx.party.state.champions[0]!.name = 'CHANGED';
    daroo.select(darooFirst.id);
    await daroo.click(g.loadButtonId);
    later();
    await daroo.open();
    const reopened = SaveMenu.selectedEntry(ui.saveMenu!)?.id;
    daroo.clickRow(0);
    daroo.game.ctx.party.state.champions[0]!.name = 'CHANGED';
    await daroo.click(g.loadButtonId);
    console.log(`  DAROO's oldest save loaded, then LOAD from his heading: ${SaveMenu.isSaveMenuOpen(ui) ? 'THE MENU' : 'the menu gone'}, party ${daroo.party()}`);
    check(reopened === darooFirst.id && !SaveMenu.isSaveMenuOpen(ui) && daroo.party() === 'DAROO'
      && await usedAt(darooFirst.id) === now && await usedAt(darooNew!.id) === darooNew!.savedAt,
      'LOAD on the game\'s own heading reads its last save used at once, though two are newer');
    later();

    // A game with no save yet has no heading, and a "new save" row in its place.
    const leyla = await menuRig(graphics, store, 'LEYLA');
    const fresh = await leyla.open();
    console.log('  the menu of a game not saved yet:');
    console.log(leyla.list());
    check(fresh.rows[0].kind === 'new' && headings(fresh) === 'DAROO unfolded, WUUF, HALK' && SaveMenu.selectedEntry(fresh)?.id === darooFirst.id,
      'a game with no save has the "new save" row over the headings, and its menu opens on the last save used all the same');
    leyla.clickRow(leyla.headingOf(idOf(wuuf)));
    await leyla.click(g.saveButtonId);
    check(store.files.size === files + 1 && fresh.confirm === null, 'where every heading is another playthrough\'s, and SAVE inert on each');
    leyla.clickRow(0);
    await leyla.click(g.saveButtonId);
    console.log('  "NEW SAVE", then SAVE:');
    console.log(leyla.list());
    check(store.files.size === files + 2 && fresh.rows.every((row) => row.kind !== 'new') && headings(fresh) === 'LEYLA unfolded, DAROO unfolded, WUUF unfolded, HALK'
      && fresh.selected === 1, 'its first save gives it a heading, the first, and takes the "new save" row away');
    SaveMenu.closeSaveMenu(leyla.ui);
    later();

    // A game whose DSA has disabled saves (`&DISABLESAVES`): CSBWin's disk menu says only
    // "SAVES ARE DISABLED" (`doc/CSBwin-src/SaveGame.cpp:856-873`). The dialog says it,
    // and saves nothing, with no "new save" row though the game has no save; LOAD loads.
    const shut = await menuRig(graphics, store, 'TIGGY');
    shut.game.systems.dsa.disableSaves = true;
    const disabled = await shut.open();
    const shutMessage = disabled.message;
    const shutFiles = store.files.size;
    shut.select(darooFirst.id);
    const shutLabels = [labelOf(shut.ui, g.buttonFrames.load), labelOf(shut.ui, g.buttonFrames.save)];
    await shut.click(g.saveButtonId);
    console.log(`  saves disabled: "${shutMessage}", ${disabled.rows.filter((row) => row.kind === 'new').length} "new save" row, on a save LOAD's label ${shutLabels[0]} pixels, SAVE's ${shutLabels[1]}; SAVE clicked: ${store.files.size - shutFiles} file(s) more`);
    check(shutMessage === 'SAVES ARE DISABLED' && disabled.rows.every((row) => row.kind !== 'new'),
      'with saves disabled the dialog says "SAVES ARE DISABLED", and has no "new save" row');
    check(shutLabels[0] > 0 && shutLabels[1] === 0 && store.files.size === shutFiles && disabled.confirm === null,
      'SAVE has no label and takes no click, and LOAD has its label');
    await shut.click(g.loadButtonId);
    const shutAsked = disabled.confirm;
    await shut.click(211, 2);
    check(shutAsked === 'load', 'and LOAD asks before it reads another playthrough\'s save, as ever');
    SaveMenu.closeSaveMenu(shut.ui);

    // The load-only chooser: the same list, and no question from a heading either.
    const stranger = await menuRig(graphics, store, 'SONJA');
    const chooser = await stranger.open('loadOnly');
    check(headings(chooser) === 'LEYLA unfolded, DAROO, WUUF, HALK' && chooser.rows.every((row) => row.kind !== 'new') && chooser.selected === 1,
      'the load-only chooser lists the playthroughs the same way, with no "new save" row');
    stranger.clickRow(stranger.headingOf(idOf(wuuf)));
    await stranger.click(g.loadButtonId);
    console.log(`  the load-only chooser, LOAD on WUUF's heading: ${SaveMenu.isSaveMenuOpen(stranger.ui) ? 'THE MENU' : 'the menu gone'}, party ${stranger.party()}`);
    check(!SaveMenu.isSaveMenuOpen(stranger.ui) && stranger.party() === 'WUUF' && await usedAt(wuufOlder.id) === now && idOf(stranger) === idOf(wuuf)
      && halkOnly.playthrough === idOf(halk),
      'and LOAD on a heading reads its last save used at once');
  } finally {
    Date.now = realNow;
  }
}

/* -------------------------------------------------------------- 14. the preview ---- */

/**
 * The preview's panel, drawn by the menu and read back: two saves of one game, of
 * another party and another day, and a second game's.
 */
async function checkPreview(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== the preview ===');
  const store = memoryStore();
  const rig = await menuRig(graphics, store, 'DAROO');
  const { game, ui } = rig;
  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  const panel = g.previewPanel;
  const baseline = (row: number): number => g.rowFirstY + row * g.rowStep;
  /** The panel's interior as the menu draws it now, a row of pixels after another. */
  const drawn = (): string => {
    SaveMenu.drawSaveMenu(ui);
    let pixels = '';
    for (let y = panel.y1 + 2; y <= panel.y2 - 1; y++) {
      for (let x = panel.x1 + 2; x <= panel.x2 - 1; x++) pixels += pixelAt(ui, x, y).toString(16);
    }
    return pixels;
  };
  /** The lines of the panel that hold ink, `#` for one that does: a glyph's cell is `y-4` to `y+1`. */
  const inked = (): string => {
    SaveMenu.drawSaveMenu(ui);
    let lines = '';
    for (let row = 0; row < g.rows; row++) {
      lines += countNot(ui, g.previewTextX, g.previewTextX + g.previewMaxChars * 6 - 1, baseline(row) - 4, baseline(row) + 1, MENU_PANEL_COLOR) > 0 ? '#' : '.';
    }
    return lines;
  };
  /** The pixels of the panel's interior that are not background, and not in a line's cells. */
  const stray = (): number => {
    SaveMenu.drawSaveMenu(ui);
    let count = 0;
    for (let y = panel.y1 + 2; y <= panel.y2 - 1; y++) {
      const row = (y + 4 - g.rowFirstY) / g.rowStep;
      const inLine = row >= 0 && row < g.rows && (y + 4 - g.rowFirstY) % g.rowStep <= 5;
      for (let x = panel.x1 + 2; x <= panel.x2 - 1; x++) {
        const inCells = inLine && x >= g.previewTextX && x < g.previewTextX + g.previewMaxChars * 6;
        if (!inCells && pixelAt(ui, x, y) !== MENU_PANEL_COLOR) count++;
      }
    }
    return count;
  };
  /** The pixels of `color` in the panel's lines `from` to `to`. */
  const inkOf = (color: number, from: number, to: number): number => {
    SaveMenu.drawSaveMenu(ui);
    let count = 0;
    for (let y = baseline(from) - 4; y <= baseline(to) + 1; y++) {
      for (let x = g.previewTextX; x < g.previewTextX + g.previewMaxChars * 6; x++) if (pixelAt(ui, x, y) === color) count++;
    }
    return count;
  };
  /** The lines a preview and a message of `message` lines ink: the message has the last ones. */
  const expected = (lines: string[], message = 0): string => Array.from({ length: g.rows }, (_, row) => (row >= g.rows - message || lines[row] ? '#' : '.')).join('');
  /** Move the selection off its row and back, which takes the message down. */
  const reselect = (): void => {
    SaveMenu.saveMenuKey(ui, 'ArrowUp');
    SaveMenu.saveMenuKey(ui, 'ArrowDown');
  };

  const realNow = Date.now;
  let now = new Date(2026, 8, 13, 14, 5, 6).getTime();
  Date.now = () => now;
  try {
    // "NEW SAVE" holds no save, and shows none.
    const state = await rig.open();
    console.log(`  "NEW SAVE": lines ${inked()}`);
    check(SaveMenu.loadTarget(state) === null && inked() === '.'.repeat(g.rows) && stray() === 0,
      'on "NEW SAVE" the preview\'s panel is empty');

    // A save of one champion, ten seconds played.
    SaveMenu.closeSaveMenu(ui);
    for (let n = 0; n < 600; n++) game.runFrame();
    await rig.open();
    await rig.click(g.saveButtonId);
    const first = SaveMenu.selectedEntry(ui.saveMenu!)!;
    const firstLines = formatSavePreview(first);
    console.log(`  a save of DAROO alone: ${JSON.stringify(firstLines)}`);
    console.log(`    lines ${inked()}, ${stray()} stray pixels, the message "${ui.saveMenu!.message}"`);
    check(firstLines.join('|') === 'DAROO|||||LEVEL 0||PLAYED|0:00:10||SAVED|2026-09-13|14:05',
      'the save\'s row gives the preview its party, its level, its play time and its date');
    check(inked() === expected(firstLines, 1) && inkOf(MENU_TITLE1_COLOR, g.rows - 1, g.rows - 1) > 0 && inkOf(MENU_TITLE1_COLOR, 0, g.rows - 2) === 0,
      'each line is drawn on the row of its number, an empty one draws nothing, and the panel\'s last line says what was done, in the title\'s colour');
    check(stray() === 0, 'and nothing is drawn outside the lines\' cells: the panel\'s edges are left whole');
    reselect();
    check(ui.saveMenu!.message === '' && inked() === expected(firstLines), 'a move of the selection takes the message down');
    const firstDrawn = drawn();

    // A second save: another champion in the party, a minute on.
    now += 60_000;
    game.systems.hallOfChampions.addChampion(healthyChampion('LEYLA'));
    rig.clickRow(0);
    const fromHeading = drawn();
    check(SaveMenu.selectedEntry(ui.saveMenu!) === null && fromHeading === firstDrawn,
      'a heading shows the save LOAD reads from it, its playthrough\'s last save used');
    await rig.click(g.saveButtonId);
    const second = SaveMenu.selectedEntry(ui.saveMenu!)!;
    const secondLines = formatSavePreview(second);
    reselect();
    console.log(`  a save of DAROO and LEYLA, a minute on: ${JSON.stringify(secondLines)}`);
    console.log(`    lines ${inked()}`);
    const secondDrawn = drawn();
    check(secondLines[1] === 'LEYLA' && secondLines[12] === '14:06' && inked() === expected(secondLines) && secondDrawn !== firstDrawn,
      'another save shows its own party and its own time');
    rig.select(first.id);
    check(drawn() === firstDrawn, 'and the first, selected again, its own as before');

    // A message longer than a line takes the lines it needs, over the preview's.
    const state2 = ui.saveMenu!;
    state2.message = 'THE SAVE FILE DOES NOT READ BACK';
    const wrapped = SaveMenu.wrapMessage(state2.message, g.previewMaxChars);
    const over = g.rows - wrapped.length;
    console.log(`  a message of ${wrapped.length} lines, ${JSON.stringify(wrapped)}: lines ${inked()}`);
    check(wrapped.length === 4 && inked() === expected(firstLines, wrapped.length)
      && inkOf(MENU_TITLE1_COLOR, 0, over - 1) === 0 && inkOf(MENU_OPTION_COLOR, over, g.rows - 1) === 0 && stray() === 0,
      'a longer message takes the panel\'s last lines, as many as it wraps to, and the preview\'s lines there are not drawn');
    state2.message = 'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z A B C D E F G H I J K L M N O P Q R S T U V W X Y Z';
    check(inkOf(MENU_TITLE1_COLOR, 0, g.rows - 6) === 0 && inkOf(MENU_TITLE1_COLOR, g.rows - 5, g.rows - 5) > 0,
      'and five lines at most, whatever its length');
    state2.message = '';

    // The import's hint: on the two lines a full preview leaves, while the pointer is on
    // the preview's panel or EXPORT's frame.
    const hint = SaveMenu.wrapMessage(SaveMenu.SAVE_MENU_IMPORT_HINT, g.previewMaxChars);
    const offHint = inked();
    const onPreview = SaveMenu.saveMenuPointer(ui, { x: panel.x1 + 30, y: panel.y1 + 60 });
    const hinted = drawn();
    console.log(`  the pointer on the preview: the hint ${JSON.stringify(hint)}, lines ${inked()}`);
    check(hint.join('|') === 'DROP .DAT|TO IMPORT' && secondLines.length + hint.length <= g.rows,
      'the hint is two lines, which fit under the thirteen of a full preview');
    check(onPreview && inked() === expected(firstLines, hint.length) && inkOf(MENU_TITLE1_COLOR, g.rows - 2, g.rows - 1) > 0
      && inkOf(MENU_TITLE1_COLOR, 0, g.rows - 3) === 0 && inked().slice(0, g.rows - 2) === offHint.slice(0, g.rows - 2) && stray() === 0,
      "the pointer on the preview's panel brings it up, on the panel's last two lines, in the title's colour, the preview's lines left as they were");
    const moves = [
      SaveMenu.saveMenuPointer(ui, { x: panel.x1, y: panel.y2 }),
      SaveMenu.saveMenuPointer(ui, { x: g.buttonFrames.export.x1, y: g.buttonFrames.export.y2 }),
    ];
    check(moves.every((changed) => !changed) && drawn() === hinted,
      "it stays from one corner of the panel to EXPORT's frame, and says nothing changed");
    const onList = SaveMenu.saveMenuPointer(ui, { x: panel.x1 - 1, y: panel.y1 + 60 });
    check(onList && inked() === offHint, 'a column left of the panel, it goes, and says so');
    check(!SaveMenu.saveMenuPointer(ui, { x: g.buttonFrames.close.x1 + 4, y: g.buttonFrames.close.y1 + 4 })
      && SaveMenu.saveMenuPointer(ui, { x: g.buttonFrames.export.x2, y: g.buttonFrames.export.y1 }) && inked() === expected(firstLines, hint.length)
      && SaveMenu.saveMenuPointer(ui, null) && inked() === offHint,
      'not on CLOSE\'s frame; on EXPORT\'s, unlabelled or not; and off the canvas, gone');
    SaveMenu.saveMenuPointer(ui, { x: panel.x1 + 30, y: panel.y1 + 60 });
    state2.message = SaveMenu.SAVE_MENU_EXPORTED;
    const messageOnly = inked();
    check(!SaveMenu.saveMenuPointer(ui, { x: panel.x1 - 1, y: panel.y1 }) && inked() === messageOnly
      && messageOnly === expected(firstLines, SaveMenu.wrapMessage(SaveMenu.SAVE_MENU_EXPORTED, g.previewMaxChars).length),
      'the dialog\'s message takes its place, and the pointer moving off changes nothing then');
    state2.message = '';
    SaveMenu.saveMenuPointer(ui, null);

    // The heading again: the last save used is now the second.
    rig.clickRow(0);
    check(SaveMenu.loadTarget(ui.saveMenu!)?.id === second.id && drawn() === secondDrawn,
      'the heading now shows the second save, the last one used');
    SaveMenu.closeSaveMenu(ui);

    // The load-only chooser shows the same.
    await rig.open('loadOnly');
    check(SaveMenu.selectedEntry(ui.saveMenu!)?.id === second.id && drawn() === secondDrawn, 'the load-only chooser previews its selection the same way');
    SaveMenu.closeSaveMenu(ui);
  } finally {
    Date.now = realNow;
  }
}

/* ------------------------------------------------------------ 15. the scrolling ---- */

/**
 * One playthrough of twenty saves, twenty-one rows under its heading for a panel of
 * fifteen: the scrollbar as it is drawn, the clicks on its arrows, the wheel and the keys.
 */
async function checkScrolling(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== the scrolling ===');
  const store = memoryStore();
  const rig = await menuRig(graphics, store, 'DAROO');
  const { ui } = rig;
  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  const bar = g.scrollbar;
  const last = g.rows - 1;
  /** The track: from the up arrow's inner outline to the down arrow's. */
  const trackTop = bar.y1 + g.arrowBox - 1;
  const trackBottom = bar.y2 - g.arrowBox + 1;
  /** A row of the bar between its side outlines, as drawn: `outline`, `plain`, or `dither`. */
  const rowKind = (y: number): string => {
    let ink = 0;
    for (let x = bar.x1 + 1; x < bar.x2; x++) if (pixelAt(ui, x, y) === MENU_OPTION_COLOR) ink++;
    return ink === 0 ? 'plain' : ink === bar.x2 - bar.x1 - 1 ? 'outline' : 'dither';
  };
  /** The slider as the pixels show it: the first and the last row of the track that are not dithered. */
  const sliderDrawn = (): { y1: number; y2: number } => {
    SaveMenu.drawSaveMenu(ui);
    let y1 = trackTop;
    while (y1 < trackBottom && rowKind(y1 + 1) === 'dither') y1++;
    while (y1 < trackBottom && rowKind(y1) === 'dither') y1++;
    let y2 = trackBottom;
    while (y2 > y1 && rowKind(y2 - 1) === 'dither') y2--;
    if (y2 < trackBottom) y2--;
    return { y1, y2 };
  };
  const sliderText = (): string => {
    const drawn = sliderDrawn();
    return `slider ${drawn.y1}..${drawn.y2} of ${trackTop}..${trackBottom}`;
  };
  /** The pixels of the track, outside the slider, that a checkerboard of the two colours would not have. */
  const ditherFaults = (): number => {
    const slider = sliderDrawn();
    let faults = 0;
    for (let y = trackTop + 1; y < trackBottom; y++) {
      if (y >= slider.y1 && y <= slider.y2) continue;
      for (let x = bar.x1 + 1; x < bar.x2; x++) {
        const here = pixelAt(ui, x, y);
        if (here !== MENU_OPTION_COLOR && here !== MENU_PANEL_COLOR) faults++;
        if (x + 1 < bar.x2 && pixelAt(ui, x + 1, y) === here) faults++;
        if (y + 1 < trackBottom && (y + 1 < slider.y1 || y + 1 > slider.y2) && pixelAt(ui, x, y + 1) === here) faults++;
      }
    }
    return faults;
  };
  const buttonOf = (name: string) => SaveMenu.saveMenuButtons(ui.saveMenu!).find((b) => b.name === name)!;
  const clickArrow = (name: string): void => {
    const b = buttonOf(name);
    SaveMenu.saveMenuClick(ui, (b.x1 + b.x2) >> 1, (b.y1 + b.y2) >> 1, LEFT);
  };
  const where = (): string => {
    const state = ui.saveMenu!;
    return `rows ${state.scrollTop}..${state.scrollTop + last} of ${state.rows.length}, row ${state.selected} selected, ${sliderText()}`;
  };
  const same = (a: { y1: number; y2: number }, b: { y1: number; y2: number }): boolean => a.y1 === b.y1 && a.y2 === b.y2;

  const realNow = Date.now;
  let now = new Date(2026, 8, 13, 14, 5, 6).getTime();
  Date.now = () => now;
  try {
    for (let n = 0; n < 20; n++) {
      now += 60_000;
      await rig.saves.save('stopped', 'new');
    }
    const state = await rig.open();
    const rows = state.rows.length;
    const maxTop = rows - g.rows;
    const track = trackBottom - trackTop + 1;
    console.log(`  the menu opens: ${where()}`);
    check(rows === 21 && state.scrollTop === 0 && state.selected === 1, 'twenty saves under their heading are twenty-one rows, the newest selected');

    // The bar as it is drawn.
    const atTop = sliderDrawn();
    const height = atTop.y2 - atTop.y1 + 1;
    check(same(atTop, SaveMenu.scrollSlider(state)) && atTop.y1 === trackTop && rowKind(atTop.y1) === 'outline' && rowKind(atTop.y2) === 'outline'
      && rowKind(atTop.y1 + 1) === 'plain' && rowKind(atTop.y2 - 1) === 'plain',
      'at the first row the slider starts on the up arrow\'s outline: two outlines and plain panel between them');
    check(height === Math.round((track * g.rows) / rows), `its height is to the track's as the rows shown are to the list's (${height} of ${track}, ${g.rows} of ${rows})`);
    check(rowKind(atTop.y2 + 1) === 'dither' && rowKind(trackBottom - 1) === 'dither' && ditherFaults() === 0,
      'and the track below it is dithered, a checkerboard of the outline\'s colour and the panel\'s');
    let outline = 0;
    for (let y = bar.y1; y <= bar.y2; y++) outline += (pixelAt(ui, bar.x1, y) === MENU_OPTION_COLOR ? 0 : 1) + (pixelAt(ui, bar.x2, y) === MENU_OPTION_COLOR ? 0 : 1);
    for (const y of [bar.y1, trackTop, trackBottom, bar.y2]) if (rowKind(y) !== 'outline') outline++;
    check(outline === 0, 'the bar and its two boxes are outlined');
    const box = (top: number): string[] => Array.from({ length: g.arrowBox - 2 }, (_, dy) =>
      Array.from({ length: g.arrowBox - 2 }, (_, dx) => (pixelAt(ui, bar.x1 + 1 + dx, top + 1 + dy) === MENU_OPTION_COLOR ? '#' : '.')).join(''));
    const up = box(bar.y1);
    const down = box(trackBottom);
    console.log('  the arrows:');
    for (let row = 0; row < up.length; row++) console.log(`    ${up[row]}  ${down[row]}`);
    check(up.join('|') === [...down].reverse().join('|') && up.every((row) => row === [...row].reverse().join(''))
      && up.join('').includes('#') && !up[0].includes('#') && !up[up.length - 1].includes('#') && up.every((row) => row[0] === '.' && row[row.length - 1] === '.'),
      'the down arrow is the up arrow upside down, each the same from left and from right, and clear of its box');
    const inkedRows = up.filter((row) => row.includes('#'));
    check(inkedRows[0].split('#').length === 2 && inkedRows[inkedRows.length - 1].includes('###') && inkedRows.some((row) => row.includes('#.#')),
      'the up arrow comes to a point at its top, is hollow, and stands on a stem');

    // The buttons: the two arrows, and rows that stop short of the bar.
    const upButton = buttonOf('saveMenu.scrollUp');
    const downButton = buttonOf('saveMenu.scrollDown');
    const firstRow = buttonOf('saveMenu.row0');
    check(upButton.x1 === bar.x1 && upButton.x2 === bar.x2 + 1 && upButton.y1 === bar.y1 && upButton.y2 === trackTop + 1
      && downButton.x1 === bar.x1 && downButton.x2 === bar.x2 + 1 && downButton.y1 === trackBottom && downButton.y2 === bar.y2 + 1,
      'each arrow\'s button is its box');
    check(firstRow.x2 === bar.x1, 'and a row\'s button ends where the bar begins');

    // An arrow: a row a click, and the selection is left.
    const previewed = SaveMenu.loadTarget(state)?.id;
    clickArrow('saveMenu.scrollDown');
    const afterOne = sliderDrawn();
    console.log(`  a click on the down arrow: ${where()}`);
    check(state.scrollTop === 1 && state.selected === 1 && SaveMenu.loadTarget(state)?.id === previewed,
      'a click on the down arrow scrolls a row, and leaves the selection and the preview');
    check(same(afterOne, SaveMenu.scrollSlider(state)) && afterOne.y1 === trackTop + Math.round((track - height) / maxTop) && afterOne.y2 - afterOne.y1 + 1 === height
      && rowKind(afterOne.y1 - 1) === 'dither' && ditherFaults() === 0,
      'the slider moves down by its share of the track, the same height, and the track above it is dithered too');

    // The wheel: three rows a notch, a touchpad's small deltas added up, and the selection
    // may leave the panel.
    for (let n = 0; n < 8; n++) SaveMenu.saveMenuWheel(ui, 4);
    check(state.scrollTop === 1, 'a touchpad\'s small deltas scroll nothing short of a row');
    SaveMenu.saveMenuWheel(ui, Widgets.WHEEL_ROW_DELTA - 32);
    check(state.scrollTop === 2, 'and add up to one');
    SaveMenu.saveMenuWheel(ui, -100);
    check(state.scrollTop === 0, 'a notch up scrolls three rows back, as far as the top');
    SaveMenu.saveMenuWheel(ui, 100);
    check(state.scrollTop === 3, 'a notch down scrolls three rows');
    SaveMenu.saveMenuWheel(ui, Widgets.WHEEL_ROW_DELTA);
    console.log(`  the wheel, a notch and a row down: ${where()}`);
    check(state.scrollTop === 4 && state.selected === 1 && same(sliderDrawn(), SaveMenu.scrollSlider(state)),
      'and a third of one a row more; the selection is out of the panel, and drawing the list does not scroll it back');

    // The track and the slider take no click.
    const slider = sliderDrawn();
    SaveMenu.saveMenuClick(ui, bar.x1 + 5, slider.y1 - 3, LEFT);
    SaveMenu.saveMenuClick(ui, bar.x1 + 5, slider.y1 + 3, LEFT);
    SaveMenu.saveMenuClick(ui, bar.x1 + 5, slider.y2 + 3, LEFT);
    check(state.scrollTop === 4 && state.selected === 1, 'a click on the track or on the slider does nothing: it neither scrolls nor selects a row');

    // To the end, and no further.
    for (let n = 0; n < 5; n++) clickArrow('saveMenu.scrollDown');
    const atEnd = sliderDrawn();
    console.log(`  the down arrow, five times more: ${where()}`);
    check(state.scrollTop === maxTop && atEnd.y2 === trackBottom && atEnd.y2 - atEnd.y1 + 1 === height && rowKind(trackBottom - 1) === 'plain' && ditherFaults() === 0,
      'the list stops at its last page, where the slider ends on the down arrow\'s outline');
    clickArrow('saveMenu.scrollUp');
    console.log(`  a click on the up arrow: ${where()}`);
    check(state.scrollTop === maxTop - 1 && state.selected === 1, 'a click on the up arrow scrolls a row back');

    // A key moves the selection, and the list back to it.
    SaveMenu.saveMenuKey(ui, 'ArrowDown');
    console.log(`  the down arrow key: ${where()}`);
    check(state.selected === 2 && state.scrollTop === 2, 'a move of the selection scrolls the list to it, by as little as shows it');
    SaveMenu.saveMenuKey(ui, 'End');
    check(state.selected === rows - 1 && state.scrollTop === maxTop, 'End is the last row, and the last page');

    // A list that fits has the whole track for a slider.
    SaveMenu.saveMenuKey(ui, 'Home');
    rig.clickRow(0);
    const whole = sliderDrawn();
    console.log(`  the heading folded: ${where()}`);
    check(state.rows.length === 1 && whole.y1 === trackTop && whole.y2 === trackBottom && rowKind(trackTop + 1) === 'plain' && rowKind(trackBottom - 1) === 'plain'
      && same(whole, SaveMenu.scrollSlider(state)), 'a list that fits its panel has the whole track for a slider, and no dither');
    clickArrow('saveMenu.scrollDown');
    SaveMenu.saveMenuWheel(ui, 100);
    check(state.scrollTop === 0, 'and neither the arrow nor the wheel scrolls it');
    SaveMenu.closeSaveMenu(ui);

    // A list far longer than its panel keeps a slider one can see.
    const longState = { ...state, rows: Array.from({ length: 2000 }, () => state.rows[0]), scrollTop: 2000 - g.rows };
    const small = SaveMenu.scrollSlider(longState);
    check(small.y2 - small.y1 + 1 === g.sliderMin && small.y2 === trackBottom, `a slider is never less than ${g.sliderMin} rows tall, and still ends on the down arrow at the last page`);
  } finally {
    Date.now = realNow;
  }
}

/* --------------------------------------------------------- 16. the double click ---- */

/**
 * Two saves of one game and one of another, and the first game's menu over them: which
 * pairs of clicks are LOAD.
 */
async function checkDoubleClick(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== the double click ===');
  const store = memoryStore();
  const daroo = await menuRig(graphics, store, 'DAROO');
  const wuuf = await menuRig(graphics, store, 'WUUF');
  const { ui } = daroo;
  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  const idOf = (rig: { game: Game }): number => rig.game.ctx.state.block1.randomGameID;
  const pause = (): Promise<void> => new Promise((done) => setTimeout(done, SaveMenu.SAVE_MENU_DOUBLE_CLICK_MS + 60));
  const what = (): string => {
    const state = ui.saveMenu;
    return !state ? 'the menu gone' : state.press ? `button ${state.press.buttonId} pressed` : state.confirm ? `asks (${state.confirm})` : `row ${state.selected} selected`;
  };

  const realNow = Date.now;
  let now = new Date(2026, 8, 13, 14, 5, 6).getTime();
  Date.now = () => now;
  try {
    await wuuf.saves.save('stopped', 'new');
    now += 60_000;
    const older = await daroo.saves.save('stopped', 'new');
    now += 60_000;
    await daroo.saves.save('stopped', 'new');
    now += 60_000;
    const state = await daroo.open();
    console.log(daroo.list());
    check(state.rows.length === 4 && state.selected === 1 && daroo.rowOf(older.id) === 2, 'DAROO\'s two saves under his heading, the newer selected, over WUUF\'s folded one');

    // Clicks that are no double click.
    daroo.clickRow(2);
    const afterOne = what();
    await pause();
    daroo.clickRow(2);
    const afterSlow = what();
    daroo.clickRow(1);
    daroo.clickRow(2);
    console.log(`  a click on the older save: ${afterOne}; another after the delay: ${afterSlow}; then the newer and the older at once: ${what()}`);
    check(afterOne === 'row 2 selected' && afterSlow === 'row 2 selected', `a click selects, and a second one more than ${SaveMenu.SAVE_MENU_DOUBLE_CLICK_MS} ms later selects again`);
    check(what() === 'row 2 selected' && daroo.party() === 'DAROO', 'two clicks at once on two saves select the second');
    await pause();
    daroo.clickRow(0);
    daroo.clickRow(0);
    console.log(`  two clicks at once on the heading: ${what()}, ${state.rows.length} rows`);
    check(what() === 'row 0 selected' && state.rows.length === 4, 'two clicks at once on a heading fold it and unfold it, and load nothing');

    // The double click.
    daroo.game.ctx.party.state.champions[0]!.name = 'CHANGED';
    daroo.clickRow(2);
    daroo.clickRow(2);
    const pressed = what();
    await daroo.settled();
    const used = (await store.list(null)).find((e) => e.id === older.id)?.usedAt;
    console.log(`  two clicks at once on the older save: ${pressed}, then ${what()}, party ${daroo.party()}`);
    check(pressed === `button ${g.loadButtonId} pressed`, 'a second click on a save, at once, presses LOAD');
    check(!SaveMenu.isSaveMenuOpen(ui) && daroo.party() === 'DAROO' && used === now, 'and the save is loaded, as LOAD loads it');

    // Across playthroughs it asks, as LOAD does.
    now += 60_000;
    await daroo.open();
    daroo.clickRow(daroo.headingOf(idOf(wuuf)));
    const theirs = ui.saveMenu!.rows.findIndex((row) => row.kind === 'save' && row.entry.playthrough === idOf(wuuf));
    daroo.clickRow(theirs);
    daroo.clickRow(theirs);
    await daroo.settled();
    console.log(`  two clicks at once on WUUF's save: ${what()}, party ${daroo.party()}`);
    check(ui.saveMenu?.confirm === 'load' && daroo.party() === 'DAROO', 'on a save of another playthrough the double click asks first, as LOAD does');
    await daroo.click(211, 2);
    SaveMenu.closeSaveMenu(ui);

    // "NEW SAVE" has nothing to load.
    const leyla = await menuRig(graphics, store, 'LEYLA');
    const fresh = await leyla.open();
    leyla.clickRow(0);
    leyla.clickRow(0);
    check(fresh.rows[0].kind === 'new' && fresh.press === null && SaveMenu.isSaveMenuOpen(leyla.ui), 'two clicks at once on "NEW SAVE" load nothing');
    SaveMenu.closeSaveMenu(leyla.ui);

    // The load-only chooser: the same shortcut, and no question.
    const chooser = await leyla.open('loadOnly');
    leyla.clickRow(leyla.headingOf(idOf(wuuf)));
    const row = chooser.rows.findIndex((r) => r.kind === 'save' && r.entry.playthrough === idOf(wuuf));
    leyla.clickRow(row);
    leyla.clickRow(row);
    await leyla.settled();
    console.log(`  the load-only chooser, two clicks at once on WUUF's save: ${SaveMenu.isSaveMenuOpen(leyla.ui) ? 'THE MENU' : 'the menu gone'}, party ${leyla.party()}`);
    check(!SaveMenu.isSaveMenuOpen(leyla.ui) && leyla.party() === 'WUUF', 'in the load-only chooser the double click loads at once');
  } finally {
    Date.now = realNow;
  }
}

/* ---------------------------------------------------------------- 17. EXPORT ---- */

/**
 * EXPORT by the menu's own clicks, its hook the page's with the download kept instead of
 * made (`menuRig`): which rows it works on, and that the file handed over is the
 * store's, byte for byte, with nothing else moved.
 */
async function checkExport(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== EXPORT ===');
  const store = memoryStore();
  const daroo = await menuRig(graphics, store, 'DAROO');
  const wuuf = await menuRig(graphics, store, 'WUUF');
  const { ui } = daroo;
  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  const idOf = (rig: { game: Game }): number => rig.game.ctx.state.block1.randomGameID;
  const same = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean =>
    a !== undefined && b !== undefined && a.length === b.length && a.every((byte, i) => byte === b[i]);
  const rowsOf = async (): Promise<string> => JSON.stringify(await store.list(null));

  const realNow = Date.now;
  let now = new Date(2026, 8, 13, 14, 5, 6).getTime();
  Date.now = () => now;
  try {
    const theirs = await wuuf.saves.save('stopped', 'new');
    now += 60_000;
    const older = await daroo.saves.save('stopped', 'new');
    now += 60_000;
    // A file holds no date: the game has to have moved for the next to differ.
    daroo.game.ctx.party.state.champions[0]!.attributes.health = 1;
    const newer = await daroo.saves.save('stopped', 'new');
    now += 60_000;
    const state = await daroo.open();
    console.log(daroo.list());

    // A heading has no save selected.
    daroo.clickRow(daroo.headingOf(idOf(wuuf)));
    const onHeading = labelOf(ui, g.buttonFrames.export);
    await daroo.click(g.exportButtonId);
    daroo.clickRow(daroo.headingOf(idOf(wuuf)));
    daroo.select(newer.id);
    const onSave = labelOf(ui, g.buttonFrames.export);
    console.log(`  EXPORT's label: ${onHeading} pixels on a heading, ${onSave} on a save`);
    check(onHeading === 0 && SaveMenu.loadTarget(state) !== null && daroo.exported.length === 0,
      'on a heading EXPORT has no label and takes no click, though LOAD has a save to read there');
    check(onSave > 0, 'on a save it has its label');

    // The selected save, as the store holds it.
    const rows = await rowsOf();
    const rect = menuButtonRect(SaveMenu.saveMenuButtons(state), g.exportButtonId)!;
    SaveMenu.saveMenuClick(ui, rect.x1 + 1, rect.y1 + 1, LEFT);
    const pressed = state.press?.buttonId;
    const atPress = daroo.exported.length;
    await daroo.settled();
    const first = daroo.exported[0];
    const fields = first ? readSaveFileFields(first.bytes) : null;
    console.log(`  EXPORT on the newer save: button ${pressed} pressed, then ${first?.name} of ${first?.bytes.length} bytes, "${state.message}"`);
    check(pressed === g.exportButtonId && atPress === 0, 'a click presses EXPORT, and nothing is handed over before the press has played');
    check(daroo.exported.length === 1 && first.name === newer.name && first.name.endsWith(SAVE_FILE_EXTENSION),
      'then the page is handed one file, under the selected save\'s name, a .dat');
    check(same(first?.bytes, store.files.get(newer.id)), 'whose bytes are the store\'s, byte for byte');
    check(fields !== null && fields.playthrough === idOf(daroo) && fields.champions.join('/') === 'DAROO',
      'and read as a CSBWin save of the game\'s playthrough and party');
    check(SaveMenu.isSaveMenuOpen(ui) && !state.busy && state.message === SaveMenu.SAVE_MENU_EXPORTED && SaveMenu.selectedEntry(state)?.id === newer.id,
      `the menu stays up, on the same save, and says "${SaveMenu.SAVE_MENU_EXPORTED}"`);
    check((await rowsOf()) === rows && store.files.size === 3 && daroo.party() === 'DAROO',
      'no row is written, the last save used included, and the game is left alone');

    // The older one, and another playthrough's: no question.
    daroo.select(older.id);
    await daroo.click(g.exportButtonId);
    daroo.select(theirs.id);
    await daroo.click(g.exportButtonId);
    console.log(`  then the older save and WUUF's: ${daroo.exported.slice(1).map((file) => file.name).join(', ')}; ${state.confirm ? 'ASKS' : 'no question'}`);
    check(daroo.exported.length === 3 && same(daroo.exported[1].bytes, store.files.get(older.id)) && !same(daroo.exported[1].bytes, first.bytes),
      'each save is its own file');
    check(state.confirm === null && same(daroo.exported[2]?.bytes, store.files.get(theirs.id))
      && readSaveFileFields(daroo.exported[2].bytes)?.playthrough === idOf(wuuf),
      'a save of another playthrough is exported without a question: the game is not left');

    // A file the store cannot read.
    const kept = store.files.get(older.id)!;
    store.files.delete(older.id);
    daroo.select(older.id);
    await daroo.click(g.exportButtonId);
    console.log(`  a save the store cannot read: "${state.message}"`);
    check(daroo.exported.length === 3 && !state.busy && SaveMenu.isSaveMenuOpen(ui) && state.message === `NO SAVE ${older.id}`.toUpperCase(),
      'a read that fails hands nothing over, and its error is the dialog\'s message');
    store.files.set(older.id, kept);
    SaveMenu.closeSaveMenu(ui);

    // The load-only chooser has it too.
    const leyla = await menuRig(graphics, store, 'LEYLA');
    const chooser = await leyla.open('loadOnly');
    leyla.select(theirs.id);
    const labels = [labelOf(leyla.ui, g.buttonFrames.save), labelOf(leyla.ui, g.buttonFrames.export)];
    await leyla.click(g.exportButtonId);
    console.log(`  the load-only chooser, WUUF's save: SAVE's label ${labels[0]} pixels, EXPORT's ${labels[1]}; exported ${leyla.exported.map((file) => file.name).join(', ')}`);
    check(labels[0] === 0 && labels[1] > 0 && leyla.exported.length === 1 && same(leyla.exported[0].bytes, store.files.get(theirs.id)),
      'the load-only chooser exports as the disk menu does');
    check(SaveMenu.isSaveMenuOpen(leyla.ui) && chooser.message === SaveMenu.SAVE_MENU_EXPORTED && leyla.party() === 'LEYLA',
      'and stays up, with nothing loaded');
    SaveMenu.closeSaveMenu(leyla.ui);
  } finally {
    Date.now = realNow;
  }
}

/* ---------------------------------------------------------------- 18. DELETE ---- */

/**
 * DELETE by the menu's own presses and keys (`menuRig`): what turns EXPORT into it and
 * back, its question, and the store and the list after it.
 */
async function checkDelete(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== DELETE ===');
  const store = memoryStore();
  const daroo = await menuRig(graphics, store, 'DAROO');
  const wuuf = await menuRig(graphics, store, 'WUUF');
  const { ui } = daroo;
  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  const idOf = (rig: { game: Game }): number => rig.game.ctx.state.block1.randomGameID;
  const hold = (): Promise<void> => new Promise((done) => setTimeout(done, SaveMenu.SAVE_MENU_LONG_PRESS_MS + 60));
  const release = (): void => ui.dialog?.release?.(ui);
  /** What EXPORT's frame is now, by the button the dialog has there. */
  const frame = (rig = daroo): string => {
    const ids = SaveMenu.saveMenuButtons(rig.ui.saveMenu!).map((b) => b.word0);
    return ids.includes(g.deleteButtonId) ? 'DELETE' : ids.includes(g.exportButtonId) ? 'EXPORT' : '?';
  };
  const stored = async (): Promise<string[]> => (await store.list(null)).map((e) => e.id);

  const realNow = Date.now;
  let now = new Date(2026, 8, 13, 14, 5, 6).getTime();
  Date.now = () => now;
  try {
    const theirs = await wuuf.saves.save('stopped', 'new');
    now += 60_000;
    const oldest = await daroo.saves.save('stopped', 'new');
    now += 60_000;
    const middle = await daroo.saves.save('stopped', 'new');
    now += 60_000;
    const newest = await daroo.saves.save('stopped', 'new');
    now += 60_000;
    const state = await daroo.open();
    console.log(daroo.list());

    // What does not turn EXPORT into DELETE.
    daroo.clickRow(daroo.rowOf(middle.id));
    await hold();
    const afterClick = frame();
    daroo.pressRow(daroo.rowOf(oldest.id));
    SaveMenu.saveMenuDrag(ui, g.textX, SaveMenu.saveMenuList('full').rowFirstY + daroo.rowOf(newest.id) * g.rowStep);
    await hold();
    release();
    const afterDrag = frame();
    daroo.pressRow(daroo.headingOf(idOf(daroo)));
    await hold();
    release();
    const onHeading = frame();
    SaveMenu.saveMenuKey(ui, 'Delete');
    const keyOnHeading = state.deleteArmed;
    console.log(`  EXPORT's frame after a click on a save and the delay: ${afterClick}; a press moved off its row: ${afterDrag}; a press on a heading, and Delete there: ${onHeading}, ${keyOnHeading ?? 'nothing armed'}`);
    check(afterClick === 'EXPORT' && afterDrag === 'EXPORT', 'a click on a save, and a press moved off its row, leave EXPORT as it is');
    check(onHeading === 'EXPORT' && keyOnHeading === null, 'so do a long press on a heading and the Delete key there');
    daroo.clickRow(daroo.headingOf(idOf(daroo)));

    // The long press, and what turns DELETE back.
    daroo.pressRow(daroo.rowOf(middle.id));
    const before = frame();
    await hold();
    const held = frame();
    const label = labelOf(ui, g.buttonFrames.export);
    release();
    console.log(`  a press held on the middle save: ${before}, then ${held} (${label} pixels of label), selected ${SaveMenu.selectedEntry(state)?.id === middle.id ? 'it' : 'ANOTHER'}`);
    check(before === 'EXPORT' && held === 'DELETE' && label > 0, `a press held ${SaveMenu.SAVE_MENU_LONG_PRESS_MS} ms on a save turns EXPORT into DELETE, labelled`);
    check(SaveMenu.selectedEntry(state)?.id === middle.id && state.press === null && state.confirm === null, 'the save is selected, and nothing is pressed or asked');
    daroo.clickRow(daroo.rowOf(middle.id));
    const sameAgain = frame();
    daroo.clickRow(daroo.rowOf(newest.id));
    const other = frame();
    daroo.clickRow(daroo.rowOf(middle.id));
    const back = frame();
    console.log(`  then a click on it again: ${sameAgain}; on another save: ${other}; on it once more: ${back}`);
    check(sameAgain === 'DELETE' && other === 'EXPORT' && back === 'EXPORT', 'a click on the same save keeps DELETE, another selection turns it back for good');

    // The Delete key.
    await hold();
    SaveMenu.saveMenuKey(ui, 'Delete');
    const keyed = frame();
    SaveMenu.saveMenuKey(ui, 'ArrowDown');
    const moved = frame();
    SaveMenu.saveMenuKey(ui, 'ArrowUp');
    SaveMenu.saveMenuKey(ui, 'Backspace');
    const backspace = frame();
    console.log(`  Delete on a save: ${keyed}; the arrow down: ${moved}; up again and Backspace: ${backspace}`);
    check(keyed === 'DELETE' && moved === 'EXPORT' && backspace === 'DELETE', 'Delete and Backspace turn EXPORT into DELETE, and a move of the selection turns it back');

    // The question.
    const rows = await stored();
    await daroo.click(g.deleteButtonId);
    const asked = state.confirm;
    await daroo.click(211, 2);
    const cancelled = await stored();
    await daroo.click(g.deleteButtonId);
    SaveMenu.saveMenuKey(ui, 'Escape');
    const escaped = { confirm: state.confirm, open: SaveMenu.isSaveMenuOpen(ui), rows: (await stored()).length };
    console.log(`  DELETE: asks (${asked}); CANCEL: ${cancelled.length} rows, ${frame()}; Esc: ${escaped.open ? 'the menu up' : 'THE MENU GONE'}, ${escaped.rows} rows`);
    check(asked === 'delete' && cancelled.length === rows.length && rows.length === 4, 'DELETE asks first, and CANCEL deletes nothing');
    check(escaped.confirm === null && escaped.open && escaped.rows === 4 && frame() === 'DELETE', 'Esc takes the question down, and leaves the menu up on DELETE');

    // Deleted.
    await daroo.click(g.deleteButtonId);
    await daroo.click(210, 2);
    const left = await stored();
    console.log(daroo.list());
    console.log(`  DELETE and its DELETE: ${left.length} rows, "${state.message}", selected ${SaveMenu.selectedEntry(state)?.id === oldest.id ? 'the older save' : 'ANOTHER ROW'}, ${frame()}`);
    check(left.length === 3 && !left.includes(middle.id) && !store.files.has(middle.id), 'the save is deleted from the store, its file with it');
    check(SaveMenu.isSaveMenuOpen(ui) && !state.busy && state.message === SaveMenu.SAVE_MENU_DELETED && daroo.rowOf(middle.id) < 0,
      `the menu stays up, the list without it, and says "${SaveMenu.SAVE_MENU_DELETED}"`);
    check(SaveMenu.selectedEntry(state)?.id === oldest.id && frame() === 'EXPORT', 'the save after it is selected, under EXPORT');
    check(daroo.party() === 'DAROO', 'and the game is left alone');

    // The newest's neighbour is the one before, and the last save of a playthrough takes its heading.
    daroo.select(oldest.id);
    SaveMenu.saveMenuKey(ui, 'Delete');
    await daroo.click(g.deleteButtonId);
    await daroo.click(210, 2);
    const afterLast = SaveMenu.selectedEntry(state)?.id === newest.id;
    daroo.select(theirs.id);
    SaveMenu.saveMenuKey(ui, 'Delete');
    await daroo.click(g.deleteButtonId);
    await daroo.click(210, 2);
    console.log(daroo.list());
    check(afterLast, 'the last save of a playthrough deleted, the one before it is selected');
    check(daroo.headingOf(idOf(wuuf)) < 0 && state.selected === state.rows.length - 1 && (await stored()).join() === newest.id,
      'a playthrough\'s only save deleted, its heading goes, and the row in its place is selected');
    SaveMenu.closeSaveMenu(ui);

    // The load-only chooser has it; RISE's dialog does not.
    const leyla = await menuRig(graphics, store, 'LEYLA');
    // It opens on the save, the last used: a click on it now would be a double click.
    await leyla.open('loadOnly');
    leyla.pressRow(leyla.rowOf(newest.id));
    await hold();
    leyla.ui.dialog?.release?.(leyla.ui);
    const chooser = frame(leyla);
    await leyla.click(g.deleteButtonId);
    await leyla.click(210, 2);
    console.log(`  the load-only chooser: ${chooser}, then ${(await stored()).length} rows`);
    check(chooser === 'DELETE' && (await stored()).length === 0 && SaveMenu.isSaveMenuOpen(leyla.ui), 'the load-only chooser deletes as the disk menu does');
    SaveMenu.closeSaveMenu(leyla.ui);

    await leyla.saves.save('stopped', 'new');
    const rise = await leyla.open('rise');
    leyla.pressRow(1);
    await hold();
    leyla.ui.dialog?.release?.(leyla.ui);
    SaveMenu.saveMenuKey(leyla.ui, 'Delete');
    const riseIds = SaveMenu.saveMenuButtons(rise).map((b) => b.word0);
    console.log(`  RISE's dialog, a press held on a save and Delete: ${riseIds.includes(g.deleteButtonId) ? 'DELETE' : 'no DELETE'}`);
    check(SaveMenu.selectedEntry(rise) !== null && rise.deleteArmed === null && !riseIds.includes(g.deleteButtonId), 'RISE\'s dialog has no DELETE');
    SaveMenu.closeSaveMenu(leyla.ui);
  } finally {
    Date.now = realNow;
  }
}

/* ---------------------------------------------------------- 20. RISE's dialog ---- */

/**
 * The chooser in `rise` mode: its title over a shorter list, measured on the pixels as
 * the full dialog's panels are (`checkLayout`), and driven by its own clicks and keys.
 */
async function checkRise(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== RISE\'s dialog ===');
  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  const full = SaveMenu.saveMenuList('full');
  const list = SaveMenu.saveMenuList('rise');
  const title = g.riseTitlePanel;
  const store = memoryStore();
  const rig = await menuRig(graphics, store, 'DAROO');
  const { ui } = rig;

  // The panels, from the art.
  ui.screenIndexBuffer!.pixels.fill(7);
  SaveMenu.drawDialog(ui, 'rise');
  const panelOf = (r: { x1: number; y1: number; x2: number; y2: number }): number =>
    countNot(ui, r.x1 + 2, r.x2 - 2, r.y1 + 2, r.y2 - 2, MENU_PANEL_COLOR);
  const gap = list.panel.y1 - title.y2 - 1;
  console.log(`  title panel (${title.x1},${title.y1})-(${title.x2},${title.y2}), list panel (${list.panel.x1},${list.panel.y1})-(${list.panel.x2},${list.panel.y2}), ${gap} rows between`);
  check(panelOf(title) === 0 && panelOf(list.panel) === 0 && pixelAt(ui, title.x1, title.y1) !== MENU_PANEL_COLOR,
    'the title panel and the list\'s are graphic 0\'s panel, edged and clean inside');
  check(title.x1 === full.panel.x1 && title.x2 === full.panel.x2 && title.y1 === full.panel.y1
    && list.panel.x1 === full.panel.x1 && list.panel.x2 === full.panel.x2 && list.panel.y2 === full.panel.y2,
    'the two stand in the full list\'s column, from its top to its bottom');
  let unlike = 0;
  for (let y = 0; y < gap; y++) {
    for (let x = title.x1; x <= title.x2; x++) if (pixelAt(ui, x, title.y2 + 1 + y) !== pixelAt(ui, x, list.panel.y2 + 1 + y)) unlike++;
  }
  check(gap === 10 && unlike === 0,
    `with ten rows of the frame between them, as between the panels and the buttons (${unlike} pixels differ)`);
  const bar = list.scrollbar;
  check(bar.x2 === list.panel.x2 - 1 && bar.y1 === list.panel.y1 + 2 && bar.y2 === list.panel.y2 - 1,
    'the scrollbar stands against the shorter list\'s right edge, over the whole height of its interior');
  const above = list.rowFirstY - 5 - (list.panel.y1 + 2);
  const below = list.panel.y2 - 1 - (list.rowFirstY + (list.rows - 1) * g.rowStep + 2);
  console.log(`  ${list.rows} rows of ${g.rowStep}: ${above} pixels of panel above the first, ${below} below the last`);
  check(list.rows === 11 && above === 2 && below === 2, 'eleven whole rows fill it, two pixels of panel above the first and below the last');

  // The title, on clean panel inside its edges.
  const realNow = Date.now;
  let now = new Date(2026, 8, 13, 14, 5, 6).getTime();
  Date.now = () => now;
  try {
    for (let n = 0; n < 14; n++) {
      now += 60_000;
      await rig.saves.save('stopped', 'new');
    }
    const state = await rig.open('rise');
    ui.screenIndexBuffer!.pixels.fill(7);
    SaveMenu.drawSaveMenu(ui);
    const inner = { x1: title.x1 + 2, y1: title.y1 + 2, x2: title.x2 - 2, y2: title.y2 - 2 };
    let ink = 0;
    let stray = 0;
    let top = SCREEN_HEIGHT;
    let bottom = -1;
    for (let y = inner.y1; y <= inner.y2; y++) {
      for (let x = inner.x1; x <= inner.x2; x++) {
        const here = pixelAt(ui, x, y);
        if (here === MENU_TITLE1_COLOR) {
          ink++;
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        } else if (here !== MENU_PANEL_COLOR) stray++;
      }
    }
    const firstCell = g.riseTitleFirstY - 4;
    const lastCell = g.riseTitleFirstY + (SaveMenu.RISE_TITLE.length - 1) * g.rowStep + 1;
    console.log(`  the title: "${SaveMenu.RISE_TITLE.join(' / ')}", ${ink} pixels of ink in rows ${top}..${bottom}, its cells ${firstCell}..${lastCell} of ${inner.y1}..${inner.y2}`);
    check(ink > 0 && stray === 0 && top >= firstCell && bottom <= lastCell,
      'its two lines are drawn in the title\'s colour, on clean panel');
    check(firstCell - inner.y1 === 2 && inner.y2 - lastCell === 2, 'with two pixels of panel above the first line\'s cells and below the last\'s');
    check(SaveMenu.RISE_TITLE.every((line) => line.length * 6 - 1 <= inner.x2 - inner.x1 + 1), 'each line fits its panel');

    // RISE where LOAD is, and no EXPORT.
    console.log(rig.list());
    const at = Widgets.buttonLabelAt(g.buttonFrames.load);
    const band = (): number[] => {
      const pixels: number[] = [];
      for (let y = at.y - 4; y <= at.y + 1; y++) for (let x = at.x - 18; x <= at.x + 17; x++) pixels.push(pixelAt(ui, x, y));
      return pixels;
    };
    SaveMenu.drawSaveMenu(ui);
    const shown = band();
    ui.screenIndexBuffer!.pixels.fill(MENU_PANEL_COLOR);
    drawTextLineIndex(ui.screenIndexBuffer!, ui.fontData, at.x - 12, at.y, MENU_OPTION_COLOR, MENU_PANEL_COLOR, 'RISE');
    const rise = band();
    check(shown.every((pixel, i) => pixel === rise[i]), 'LOAD\'s button reads RISE');
    SaveMenu.saveMenuKey(ui, 'Home');
    const exportLabels = state.rows.map(() => {
      const label = labelOf(ui, g.buttonFrames.export);
      SaveMenu.saveMenuKey(ui, 'ArrowDown');
      return label;
    });
    const selected = SaveMenu.selectedEntry(state);
    const buttonIds = SaveMenu.saveMenuButtons(state).map((b) => b.word0);
    await rig.click(g.faceButtonId);
    console.log(`  EXPORT's label on each of the ${state.rows.length} rows: ${exportLabels.join(', ')} pixels; a click on its frame on ${selected?.name}: ${rig.exported.length} files, press ${state.press ? 'UP' : 'none'}, toggle ${state.newFace}`);
    check(state.rows.some((row) => row.kind === 'save') && exportLabels.every((n) => n === 0),
      'with no utility portraits, EXPORT\'s frame has no label, on a heading or a save');
    check(!buttonIds.includes(g.exportButtonId), 'and no EXPORT button');
    check(selected !== null && rig.exported.length === 0 && state.press === null && state.newFace === null && SaveMenu.isSaveMenuOpen(ui),
      'and a click on the frame does nothing');

    // No import: a drop is not taken, and no hint says one would be.
    const rows = JSON.stringify(await store.list(null));
    const takes = SaveMenu.saveMenuTakesDrops(ui);
    const taken = await rig.drop('CSBGAME7.DAT', new Uint8Array(readFileSync(resolve(savePath('csbgame7.dat')))));
    console.log(`  a genuine DM save dropped: ${taken ? 'TAKEN' : 'not taken'}, ${store.files.size} files stored, message "${state.message}"`);
    check(!takes && !taken && JSON.stringify(await store.list(null)) === rows && state.message === '' && state.dropped === null && !state.busy,
      'a drop is not taken, and nothing is stored or said');
    const drawn = (): number[] => { SaveMenu.drawSaveMenu(ui); return Array.from(ui.screenIndexBuffer!.pixels); };
    SaveMenu.saveMenuPointer(ui, null);
    const bare = drawn();
    const hinted = [g.previewPanel, g.buttonFrames.export].map((r) => {
      const changed = SaveMenu.saveMenuPointer(ui, { x: (r.x1 + r.x2) >> 1, y: (r.y1 + r.y2) >> 1 });
      const pixels = drawn();
      return changed || pixels.some((p, i) => p !== bare[i]);
    });
    SaveMenu.saveMenuPointer(ui, null);
    console.log(`  the pointer on the preview's panel, then EXPORT's frame: ${hinted.map((h) => (h ? 'A HINT' : 'nothing')).join(', ')}`);
    check(hinted.every((h) => !h), 'the pointer on the preview\'s panel or EXPORT\'s frame brings up no import\'s hint');

    // The eleven rows: a click on each selects it, the heading last, which folds its
    // saves; and PageDown moves by eleven.
    SaveMenu.saveMenuKey(ui, 'Home');
    const listed = state.rows.length;
    const rowButtons = SaveMenu.saveMenuButtons(state).filter((b) => b.name?.startsWith('saveMenu.row'));
    const picked: number[] = [];
    for (const row of [...Array(list.rows).keys()].slice(1).concat(0)) {
      rig.clickRow(row);
      picked.push(state.selected);
    }
    const folded = state.rows.length;
    console.log(`  ${listed} rows listed, ${rowButtons.length} row buttons in y ${rowButtons[0]?.y1}..${rowButtons.at(-1)?.y2}, the clicks select rows ${picked.join(',')}, the heading's folds the list to ${folded}`);
    check(listed > list.rows && rowButtons.length === list.rows && rowButtons.every((b) => b.y1 > list.panel.y1 && b.y2 <= list.panel.y2),
      'a list longer than the panel shows eleven rows, all inside it');
    check(picked.join(',') === [...Array(list.rows).keys()].slice(1).concat(0).join(',') && folded === 1, 'and a click on each selects it');
    rig.clickRow(0);
    const from = state.selected;
    SaveMenu.saveMenuKey(ui, 'PageDown');
    console.log(`  PageDown from row ${from}: row ${state.selected}, the list from row ${state.scrollTop}`);
    check(state.selected === from + list.rows && state.selected - state.scrollTop === list.rows - 1, 'PageDown moves by the eleven rows shown, and scrolls to the selection');
    SaveMenu.closeSaveMenu(ui);

    // The other modes keep the whole column, and take drops.
    const loadOnly = await rig.open('loadOnly');
    check(SaveMenu.saveMenuTakesDrops(ui) && loadOnly.mode === 'loadOnly', 'the load-only chooser takes drops');
    SaveMenu.closeSaveMenu(ui);
    check(SaveMenu.saveMenuList('loadOnly') === full && full.rows === SaveMenu.SAVE_MENU_ROWS && full.panel === g.listPanel,
      'the disk menu and the load-only chooser keep their fifteen rows');
  } finally {
    Date.now = realNow;
  }
}

/**
 * RISE's NEW FACE / OLD FACE, in EXPORT's frame, for a set with the utility's portraits:
 * what it reads, what a click does, and what LOAD passes on.
 */
async function checkRiseFaces(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== RISE\'s NEW FACE ===');
  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  const frame = g.buttonFrames.export;
  const store = memoryStore();
  const made: boolean[] = [];
  const rig = await menuRig(graphics, store, 'DAROO', {
    onHasNewFaces: async () => true,
    onMakeNewAdventure: async (_source, newFaces) => { made.push(newFaces === true); throw new Error('stop here'); },
  });
  const { ui } = rig;
  await rig.saves.save('stopped', 'new');
  rig.game.ctx.state.paused = false;

  const at = Widgets.buttonLabelAt(frame);
  const band = (): number[] => {
    const pixels: number[] = [];
    for (let y = at.y - 4; y <= at.y + 1; y++) for (let x = frame.x1 + 6; x <= frame.x2 - 6; x++) pixels.push(pixelAt(ui, x, y));
    return pixels;
  };
  const labelIs = (label: string): boolean => {
    SaveMenu.drawSaveMenu(ui);
    const shown = band();
    const saved = Uint8Array.from(ui.screenIndexBuffer!.pixels);
    for (let y = at.y - 4; y <= at.y + 1; y++) for (let x = frame.x1 + 6; x <= frame.x2 - 6; x++) ui.screenIndexBuffer!.pixels[y * SCREEN_WIDTH + x] = MENU_PANEL_COLOR;
    drawTextLineIndex(ui.screenIndexBuffer!, ui.fontData, at.x - 3 * label.length, at.y, MENU_OPTION_COLOR, MENU_PANEL_COLOR, label);
    const expected = band();
    ui.screenIndexBuffer!.pixels.set(saved);
    return shown.every((pixel, i) => pixel === expected[i]);
  };

  const state = await rig.open('rise');
  SaveMenu.drawSaveMenu(ui);
  let left = SCREEN_WIDTH;
  let right = -1;
  for (let y = at.y - 4; y <= at.y + 1; y++) {
    for (let x = frame.x1; x <= frame.x2; x++) {
      if (pixelAt(ui, x, y) === MENU_OPTION_COLOR) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  console.log(`  opened: ${state.newFace ? 'NEW FACE' : String(state.newFace)}, its ink in columns ${left}..${right} of the frame's ${frame.x1 + 6}..${frame.x2 - 6} between its bevels`);
  check(state.newFace === true && labelIs(SaveMenu.NEW_FACE_LABEL), 'it opens on, and reads NEW FACE');
  check(SaveMenu.NEW_FACE_LABEL.length === 8 && SaveMenu.OLD_FACE_LABEL.length === 8 && left >= frame.x1 + 6 && right <= frame.x2 - 6,
    'its eight characters stand between the frame\'s six-column bevels');

  await rig.click(g.faceButtonId);
  const off = state.newFace;
  const offReads = labelIs(SaveMenu.OLD_FACE_LABEL);
  await rig.click(g.faceButtonId);
  console.log(`  a click: ${off ? 'NEW FACE' : 'OLD FACE'}; another: ${state.newFace ? 'NEW FACE' : 'OLD FACE'}`);
  check(off === false && offReads, 'a click turns it off, and it reads OLD FACE');
  check(state.newFace === true && labelIs(SaveMenu.NEW_FACE_LABEL), 'another turns it back on');

  await rig.click(g.faceButtonId);
  const entry = state.entries[0]!;
  rig.select(entry.id);
  await rig.click(g.loadButtonId);
  const reopened = await rig.open('rise');
  const reopenedOn = reopened.newFace;
  rig.select(entry.id);
  await rig.click(g.loadButtonId);
  console.log(`  LOAD under OLD FACE, then reopened (${reopenedOn ? 'NEW FACE' : 'OLD FACE'}) and LOAD: newFaces ${made.join(', ')}`);
  check(made.join() === 'false,true', 'LOAD passes what the toggle shows to the new adventure');
  check(reopenedOn === true, 'and the dialog opens on NEW FACE again');
  SaveMenu.closeSaveMenu(ui);

  for (const mode of ['full', 'loadOnly'] as const) {
    const other = await rig.open(mode);
    const ids = SaveMenu.saveMenuButtons(other).map((b) => b.word0);
    check(other.newFace === null && !ids.includes(g.faceButtonId) && ids.includes(g.exportButtonId),
      `the ${mode} dialog has EXPORT and no toggle`);
    SaveMenu.closeSaveMenu(ui);
  }
}

/* ---------------------------------------------------------------- 18. the import ---- */

/** A save of Chaos Strikes Back, and the save its game starts from (`doc/SAVES.md` → "RISE makes a save of its own"). */
const CSB_SAVE = 'static/gamefiles/csb/csbgame2.dat';
const CSB_MINI = 'static/gamefiles/csb/mini.dat';

/**
 * The port's save of a new game of `champion`, playthrough `id`, in a dungeon whose cell
 * flags have been put through `change`, level by level.
 */
async function saveOfDungeon(champion: string, id: number, change: (level: number, cellFlags: number[][]) => void): Promise<Uint8Array> {
  const game = await loadGame();
  game.systems.hallOfChampions.addChampion(healthyChampion(champion));
  game.ctx.state.block1.randomGameID = id;
  game.ctx.dungeon.getData().maps.forEach((map, level) => change(level, map.cellFlags));
  return buildSaveFile(game);
}

/** Make the first stone cell of a level a plain floor: one wall opened. */
function openAWall(cellFlags: number[][]): void {
  for (const column of cellFlags) {
    const y = column.findIndex((flag) => flag >> 5 === 0);
    if (y >= 0) {
      column[y] = 0x20;
      return;
    }
  }
}

/**
 * Files from outside into a store in memory, through `GameSaves.importSave`: which are
 * stored and as what row, which wait for the player's word, and which never are.
 */
async function checkImport(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== the import ===');
  const store = memoryStore();
  const logged: string[] = [];
  const log = (message: string, error?: unknown): void => { logged.push(error ? `${message}: ${(error as Error).message}` : message); };
  const SEED = 0x1d2c3b4a;
  const game = await loadGame();
  game.systems.hallOfChampions.addChampion(healthyChampion('DAROO'));
  // The games' playthroughs are given, so that every line printed is the same at each run.
  game.ctx.state.block1.randomGameID = 0x0da200;
  const screen = { portraitOf: () => undefined, repackOpenChest: () => {} };
  const saves = new GameSaves(game, DEFAULT_DATA_SET, diskFiles(DEFAULT_DATA_SET), store, screen, log, new CsbRandom(SEED));
  const csbSaves = new GameSaves(game, dataSetNamed('csb'), diskFiles(dataSetNamed('csb')), store, screen, log, new CsbRandom(SEED));
  const read = (path: string): Uint8Array => new Uint8Array(readFileSync(resolve(path)));
  const same = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean =>
    a !== undefined && b !== undefined && a.length === b.length && a.every((byte, i) => byte === b[i]);
  const rowsOf = async (): Promise<string> => JSON.stringify(await store.list(null));
  const idIn = (bytes: Uint8Array | undefined): number | undefined => (bytes ? readSaveFileFields(bytes)?.playthrough : undefined);
  const show = (what: string, row: SaveEntry): void => {
    console.log(`  ${what}: ${row.name}, set ${row.dataSet}, playthrough ${row.playthrough}, L${row.level} ${row.champions.join('/')}, `
      + `saved ${formatSaveDate(row.savedAt)} ${formatSaveTime(row.savedAt)}, played ${formatPlayTime(row.playTime)}${row.quick ? ', quick' : ''}${row.unofficial ? ', unofficial' : ''}`);
  };
  /** What an import that stored nothing came back with. */
  const refusal = (result: Awaited<ReturnType<GameSaves['importSave']>>): string =>
    result.kind === 'stored' ? `STORED ${result.entry.name}`
      : result.kind === 'other' ? `other (${result.dungeon.name}; sets ${result.dungeon.dataSets.join(' ')})` : result.kind;

  // The name a file is stored under.
  check(importedFileName('CSBGAME.DAT', new Set()) === 'CSBGAME.DAT', 'a file keeps its name, in its own case');
  check(importedFileName('CSBGAME.DAT', new Set(['CSBGAME.DAT'])) === 'CSBGAME-2.DAT'
    && importedFileName('a.dat', new Set(['a.dat', 'a-2.dat'])) === 'a-3.dat', 'with a number after it while a save has that name');
  check(importedFileName('csbgame.bak', new Set()) === 'csbgame.bak.dat', 'and a .dat after one that is not a .dat');

  const realNow = Date.now;
  let now = new Date(2026, 9, 2, 10, 0, 0).getTime();
  Date.now = () => now;
  try {
    const gameId = game.ctx.state.block1.randomGameID;
    const gameSeed = game.ctx.random.getSeed();
    const mine = await saves.save('stopped', 'new');
    now += 60_000;

    // The data set's own dungeon: a genuine CSBWin save of Dungeon Master.
    const genuine = read(savePath('csbgame7.dat'));
    const written = new Date(2024, 0, 5, 9, 30, 0).getTime();
    const own = await saves.importSave({ name: 'CSBGAME7.DAT', bytes: genuine, modifiedAt: written });
    if (own.kind !== 'stored') throw new Error(`csbgame7.dat was not stored: ${refusal(own)}`);
    show('a genuine save of Dungeon Master', own.entry);
    const info = readCsbwinSaveInfo(genuine)!;
    check(own.entry.id === 'CSBGAME7.DAT' && own.entry.name === 'CSBGAME7.DAT' && own.entry.dataSet === DEFAULT_DATA_SET.id,
      'a save of the data set\'s own dungeon is stored, under the file\'s name, as a row of the data set');
    check(own.entry.playthrough === info.randomGameID && info.randomGameID !== 0 && own.entry.level === info.level
      && own.entry.champions.join('/') === info.champions.join('/'), 'its playthrough, level and champions are the file\'s');
    check(own.entry.savedAt === written && own.entry.usedAt === now && own.entry.playTime === 0 && !own.entry.quick && !own.entry.unofficial,
      'its date is the file\'s; it is the last save used, counts no time played, and is neither F5\'s nor unofficial');
    check(same(store.files.get('CSBGAME7.DAT'), genuine), 'the stored file is the file, byte for byte');
    check((await store.list(DEFAULT_DATA_SET.id)).some((row) => row.id === 'CSBGAME7.DAT') && lastUsedSave(await saves.list())?.id === 'CSBGAME7.DAT',
      'the game\'s list has it, as the last save used');
    now += 60_000;

    // The same file again, and with no date: a row of its own.
    const again = await saves.importSave({ name: 'CSBGAME7.DAT', bytes: genuine }, 'anyway');
    if (again.kind !== 'stored') throw new Error('the second csbgame7.dat was not stored');
    show('the same file again, with no date', again.entry);
    check(again.entry.id === 'CSBGAME7-2.DAT' && again.entry.savedAt === now && same(store.files.get('CSBGAME7.DAT'), genuine),
      'a name a save has is numbered, the first row left as it was; a file with no date is saved now');
    check(again.entry.playthrough === own.entry.playthrough && !again.entry.unofficial,
      'a file that names a playthrough keeps it, a stored save\'s or not; IMPORT ANYWAY on a whole dungeon marks nothing');
    now += 60_000;

    // A file that names no playthrough: its party's, or a new one.
    const joined = await saves.importSave({ name: 'old-build.dat', bytes: stampRandomGameID(store.files.get(mine.id)!, 0) });
    if (joined.kind !== 'stored') throw new Error('old-build.dat was not stored');
    show('the game\'s save with RandomGameID 0', joined.entry);
    check(joined.entry.playthrough === gameId && idIn(store.files.get('old-build.dat')) === gameId
      && same(store.files.get('old-build.dat'), store.files.get(mine.id)),
      'a file that names none joins the playthrough of the save of its party, and is stamped: the file that save is');
    now += 60_000;
    const early = stampRandomGameID(read(savePath('csbgame-early-1hero.dat')), 0);
    const drawn = await saves.importSave({ name: 'early.dat', bytes: early });
    if (drawn.kind !== 'stored') throw new Error('early.dat was not stored');
    show('a genuine save of another party, RandomGameID 0', drawn.entry);
    const expected = drawPlaythrough(new CsbRandom(SEED), []);
    check(drawn.entry.playthrough === expected && expected !== 0 && idIn(store.files.get('early.dat')) === expected,
      `with no save of its party, it takes a new one, the first its stream draws (${expected}), stamped into the file`);
    check((await store.list(null)).filter((row) => row.playthrough === expected).length === 1 && idIn(early) === 0,
      'which no other save holds; the file handed in is left as it was');
    now += 60_000;
    const later = await saves.importSave({ name: 'early-2.dat', bytes: stampRandomGameID(read(savePath('csbgame4-door-opening.dat')), 0) });
    check(later.kind === 'stored' && later.entry.playthrough === expected, 'a second file of that party, naming none, joins it');
    check(game.ctx.random.getSeed() === gameSeed && game.ctx.state.block1.randomGameID === gameId
      && game.ctx.party.state.champions.map((c) => c.name).join() === 'DAROO', 'the game is left alone, its random stream included');
    now += 60_000;

    // The data set's dungeon with a wall moved: a slightly different one.
    const modified = await saveOfDungeon('WUUF', 0x00f00f, (level, cellFlags) => { if (level === 3) openAWall(cellFlags); });
    const before = await rowsOf();
    const asked = await saves.importSave({ name: 'modified.dat', bytes: modified });
    console.log(`  a save of Dungeon Master with a wall of level 3 opened: ${refusal(asked)}`);
    check(asked.kind === 'different' && (await rowsOf()) === before,
      'the data set\'s levels, as large, and some of their walls not its own is a slightly different dungeon: nothing is stored');
    const elsewhere = await saves.importSave({ name: 'modified.dat', bytes: modified }, 'elsewhere');
    console.log(`  the same, a better match looked for: ${refusal(elsewhere)}`);
    check(elsewhere.kind === 'unknown' && (await rowsOf()) === before,
      'a better match looked for among the other sets: none has Dungeon Master, so it is unknown, and nothing is stored');
    const confirmed = await saves.importSave({ name: 'modified.dat', bytes: modified }, 'anyway');
    if (confirmed.kind !== 'stored') throw new Error('modified.dat was not stored');
    show('the same, imported anyway', confirmed.entry);
    check(confirmed.entry.unofficial && confirmed.entry.dataSet === DEFAULT_DATA_SET.id && same(store.files.get('modified.dat'), modified),
      'imported anyway, it is stored as a row of the data set, marked unofficial');
    now += 60_000;

    // The mark follows the game read from such a row.
    const halk = await menuRig(graphics, store, 'HALK');
    const fresh = await halk.saves.save('stopped', 'new');
    now += 60_000;
    halk.saves.read(await halk.saves.open(confirmed.entry));
    const fromModified = await halk.saves.save('stopped', 'new');
    now += 60_000;
    const quick = await halk.saves.save('running', 'quick');
    now += 60_000;
    show('a save of the game read from it', fromModified);
    check(!fresh.unofficial && !mine.unofficial, 'a save of a new game is not unofficial');
    check(halk.party() === 'WUUF' && fromModified.unofficial && quick.unofficial,
      'the saves of a game read from an unofficial row are unofficial, SAVE\'s and F5\'s');
    halk.saves.read(await halk.saves.open(own.entry));
    const fromOwn = await halk.saves.save('stopped', confirmed.entry);
    now += 60_000;
    check(!fromOwn.unofficial && fromOwn.id === confirmed.entry.id && (await store.list(null)).find((row) => row.id === confirmed.entry.id)?.unofficial === false,
      'a game read from another row is not, and its save written over the unofficial row leaves it official');
    halk.saves.read(await halk.saves.open(fromModified));
    await halk.saves.newGameRead();
    check(!(await halk.saves.save('stopped', 'new')).unofficial, 'nor is a new game read after an unofficial one');
    now += 60_000;

    // Another dungeon's, and an unknown one's.
    const stored = await rowsOf();
    const csb = read(CSB_SAVE);
    const other = [await saves.importSave({ name: 'CSBGAME2.DAT', bytes: csb }), await saves.importSave({ name: 'CSBGAME2.DAT', bytes: csb }, 'anyway')];
    console.log(`  a save of Chaos Strikes Back, in Dungeon Master: ${refusal(other[0])}`);
    check(other.every((result) => result.kind === 'other' && result.dungeon.name === 'Chaos Strikes Back' && result.dungeon.dataSets.includes('csb')),
      'a save of another dungeon is not stored, IMPORT ANYWAY or not: the dungeon it is comes back, with the sets that play it');
    const unknown = await saveOfDungeon('BORIS', 0x0b0215, (_level, cellFlags) => openAWall(cellFlags));
    const none = await saves.importSave({ name: 'unknown.dat', bytes: unknown }, 'anyway');
    console.log(`  a save with a wall of every level opened: ${refusal(none)}`);
    check(none.kind === 'unknown', 'a save of the set\'s levels, as large, and no level\'s walls its own, is another dungeon: not stored either');
    check((await rowsOf()) === stored, 'none of them has written a row');

    // The published sets' dungeons, which the page asks the server for (`publishedDungeons`).
    const keep: KnownDungeon = { name: 'Boris\'s keep', dataSets: ['boris-keep'], ...(await dungeonWalls(loadCsbwinWorld(unknown).dungeon)) };
    const wuuf: KnownDungeon = { name: 'Wuuf', dataSets: ['wuuf'], ...(await dungeonWalls(loadCsbwinWorld(modified).dungeon)) };
    let askedFor = 0;
    const withPublished = (set: DataSet): GameSaves => new GameSaves(game, set, diskFiles(set), store, screen, log, new CsbRandom(SEED),
      async () => { askedFor++; return [keep, wuuf]; });
    const inDm = withPublished(DEFAULT_DATA_SET);
    const unasked = await inDm.importSave({ name: 'modified.dat', bytes: modified });
    check(unasked.kind === 'different' && askedFor === 0, 'an import held against the set\'s own dungeon does not ask for the published sets');
    const named = [
      await inDm.importSave({ name: 'modified.dat', bytes: modified }, 'elsewhere'),
      await withPublished(dataSetNamed('csb')).importSave({ name: 'unknown.dat', bytes: unknown }),
      await withPublished(dataSetNamed('csb')).importSave({ name: 'CSBGAME7.DAT', bytes: genuine }),
    ];
    console.log(`  with two sets published, the modified save looked for elsewhere, the unknown one and a save of Dungeon Master, in csb: ${named.map(refusal).join('; ')}`);
    check(named.map(refusal).join('; ') === 'other (Wuuf; sets wuuf); other (Boris\'s keep; sets boris-keep); other (Dungeon Master; sets dm-atari dm-windows dm-atari-1.2 dm-atari-1.3-fr)'
      && askedFor === 3, 'LOOK FOR A BETTER MATCH and the other sets name a published set, askedFor for at each import that goes on to them, and Dungeon Master is still the catalogue\'s');
    const inKeep = await withPublished({ ...DEFAULT_DATA_SET, id: 'boris-keep', name: 'Boris\'s keep' }).importSave({ name: 'unknown.dat', bytes: unknown }, 'elsewhere');
    console.log(`  the unknown save looked for elsewhere, in Boris's keep: ${refusal(inKeep)}`);
    check(inKeep.kind === 'other' && inKeep.dungeon === wuuf, 'a published set\'s own entry never names it, in it: the set most of its levels match does');
    const failing = await new GameSaves(game, dataSetNamed('csb'), diskFiles(dataSetNamed('csb')), store, screen, log, new CsbRandom(SEED),
      async () => []).importSave({ name: 'unknown.dat', bytes: unknown });
    check(failing.kind === 'unknown' && (await rowsOf()) === stored, 'with none published, it is unknown, and still nothing is stored');

    // What does not read: a save whose later blocks fail, and a file that is no save.
    const flipped = genuine.slice();
    flipped[flipped.length - 100] ^= 0x01;
    // GAMEBLOCK1 is the 512 bytes past the Extended Features block.
    const block1End = readExtendedFeatures(genuine).offset + 512;
    const unread: Array<[string, Uint8Array, string]> = [
      ['a save with one bit of its dungeon image flipped', flipped, SAVED_GAME_DAMAGED],
      [`a save cut after its GAMEBLOCK1, at ${block1End} bytes`, genuine.slice(0, block1End), SAVED_GAME_DAMAGED],
      ['a save cut a byte short of that', genuine.slice(0, block1End - 1), NOT_A_SAVED_GAME],
      ['the dungeon.dat', read(DUNGEON), NOT_A_SAVED_GAME],
      ['the graphics.dat', read(GRAPHICS_DAT), NOT_A_SAVED_GAME],
      ['a JSON text', new TextEncoder().encode('{"raw":"AAAA"}'), NOT_A_SAVED_GAME],
      ['an empty file', new Uint8Array(0), NOT_A_SAVED_GAME],
    ];
    for (const [what, bytes, line] of unread) {
      const at = logged.length;
      const outcome = await saves.importSave({ name: 'damaged.dat', bytes }, 'anyway').then(refusal, (error: Error) => `throws "${error.message}"`);
      console.log(`  ${what}: ${outcome}; logged "${logged.slice(at).join(' | ')}"`);
      check(outcome === `throws "${line}"` && logged.length === at + 1 && readsGameBlock1(bytes) === (line === SAVED_GAME_DAMAGED),
        line === SAVED_GAME_DAMAGED
          ? `${what} holds a GAMEBLOCK1 and is CSBWin's "${SAVED_GAME_DAMAGED}", its reason logged`
          : `${what} holds no GAMEBLOCK1 and is "${NOT_A_SAVED_GAME}", its reason logged`);
    }
    check((await rowsOf()) === stored, 'and none of them is stored');

    // The other way round: the `csb` set, whose dungeons are two.
    const inCsb = [await csbSaves.importSave({ name: 'CSBGAME2.DAT', bytes: csb }), await csbSaves.importSave({ name: 'MINI.DAT', bytes: read(CSB_MINI) })];
    for (const result of inCsb) if (result.kind === 'stored') show('in the csb set', result.entry);
    check(inCsb.every((result) => result.kind === 'stored' && result.entry.dataSet === 'csb' && !result.entry.unofficial),
      'in the csb set, a save of Chaos Strikes Back and mini.dat are stored, rows of that set');
    const dmInCsb = await csbSaves.importSave({ name: 'CSBGAME7.DAT', bytes: genuine }, 'anyway');
    console.log(`  a save of Dungeon Master, in the csb set: ${refusal(dmInCsb)}`);
    check(dmInCsb.kind === 'other' && dmInCsb.dungeon.name === 'Dungeon Master' && dmInCsb.dungeon.dataSets.includes(DEFAULT_DATA_SET.id),
      'and a save of Dungeon Master is another dungeon\'s there');
    check((await saves.list()).every((row) => row.dataSet === DEFAULT_DATA_SET.id) && (await csbSaves.list()).length === 2,
      'each game lists its own set\'s');
    now += 60_000;

    // A set the catalogue does not list, a published one, that holds Dungeon Master's
    // dungeon: its dungeon.dat says its saves, which the catalogue alone calls another's.
    const published: DataSet = { ...DEFAULT_DATA_SET, id: 'published-dm', name: 'Published' };
    const publishedSaves = new GameSaves(game, published, diskFiles(DEFAULT_DATA_SET), store, screen, log, new CsbRandom(SEED));
    const inPublished = await publishedSaves.importSave({ name: 'CSBGAME7.DAT', bytes: genuine });
    if (inPublished.kind === 'stored') show('in a published set holding Dungeon Master', inPublished.entry);
    check(inPublished.kind === 'stored' && inPublished.entry.dataSet === 'published-dm' && !inPublished.entry.unofficial,
      'in a set the catalogue does not list, a save of its dungeon.dat\'s dungeon is its own, a row of that set');
    now += 60_000;

    // A player's own set that holds Dungeon Master's dungeon: its record's dungeon.dat.
    const record: LocalDataSetRecord = { id: 'local:mine', name: 'My own', description: '', authors: [], dmRules: false, baseSet: 'dm-atari',
      files: { 'dungeon.dat': new Blob([read(DUNGEON).slice()]) }, dungeonSignature: [], createdAt: 0 };
    const localSaves = new GameSaves(game, localDataSet(record), recordFiles(record, null), store, screen, log, new CsbRandom(SEED));
    const inLocal = await localSaves.importSave({ name: 'CSBGAME7.DAT', bytes: genuine });
    if (inLocal.kind === 'stored') show('in a local set holding Dungeon Master', inLocal.entry);
    check(inLocal.kind === 'stored' && inLocal.entry.dataSet === 'local:mine' && !inLocal.entry.unofficial
      && (await localSaves.list()).length === 1,
      'in a local set that holds Dungeon Master\'s dungeon, a save of it is the set\'s own, a row of that set');
    const asks = [
      await localSaves.importSave({ name: 'modified.dat', bytes: modified }),
      await localSaves.importSave({ name: 'modified.dat', bytes: modified }, 'elsewhere'),
      await localSaves.importSave({ name: 'CSBGAME2.DAT', bytes: csb }, 'anyway'),
      await localSaves.importSave({ name: 'unknown.dat', bytes: unknown }, 'anyway'),
    ];
    console.log(`  in it, a modified save, the same looked for elsewhere, a save of Chaos Strikes Back and an unknown one: ${asks.map(refusal).join('; ')}`);
    check(asks.map(refusal).join('; ') === 'different; other (Dungeon Master; sets dm-atari dm-windows dm-atari-1.2 dm-atari-1.3-fr); '
      + 'other (Chaos Strikes Back; sets csb); unknown' && (await localSaves.list()).length === 1,
      'in it, the same rules as in any set: a wall moved asks, and looked for elsewhere is Dungeon Master\'s; another shape is another set\'s; '
      + 'nothing is refused for being a local set\'s, and nothing stored unasked');
    const forced = await localSaves.importSave({ name: 'modified.dat', bytes: modified }, 'anyway');
    if (forced.kind === 'stored') show('the modified save, imported anyway in it', forced.entry);
    check(forced.kind === 'stored' && forced.entry.dataSet === 'local:mine' && forced.entry.unofficial && same(store.files.get(forced.entry.id), modified),
      'imported anyway, it is stored, a row of the local set, unofficial');
  } finally {
    Date.now = realNow;
  }
}

/* ------------------------------------------------------------------ 19. the drop ---- */

/**
 * Files dropped on the dialog (`saveMenuDrop`), its hook the page's (`menuRig`): what is
 * listed, what is asked and what is refused, each menu against `_DoMenu`'s own drawing.
 */
async function checkDrop(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== the drop ===');
  const store = memoryStore();
  const daroo = await menuRig(graphics, store, 'DAROO');
  const { ui } = daroo;
  const read = (path: string): Uint8Array => new Uint8Array(readFileSync(resolve(path)));
  const rowsOf = async (): Promise<string> => JSON.stringify(await store.list(null));
  /** Whether the screen is `_DoMenu`'s centred menu of these titles and options, on the cleared screen. */
  const isMenu = (title1: string, title2: string | null, options: string[], on: UIState = ui): boolean => {
    SaveMenu.drawSaveMenu(on);
    const drawn = on.screenIndexBuffer!.pixels.slice();
    on.screenIndexBuffer!.pixels.fill(0);
    doMenu(on, title1, title2, options, true);
    return drawn.every((p, i) => p === on.screenIndexBuffer!.pixels[i]);
  };
  /** The lines `_DoMenu` draws a menu's titles as. */
  const linesOf = (menu: { title1: string; title2: string | null }): string[] =>
    [menu.title1, menu.title2].flatMap((title) => (title === null ? [] : splitLongLine(title) ?? [title]));

  /** Whether each of a menu's options is narrower than its button in `_DoMenu`'s centred set, six pixels a character. */
  const widthOf = (options: number, i: number): number => {
    const rect = menuButtonRect(menuButtonList(ui, options, true), 210 + i)!;
    return rect.x2 - rect.x1 + 1;
  };
  const optionsFit = (options: string[]): boolean => options.every((option, i) => 6 * option.length < widthOf(options.length, i));

  // Every menu a dropped file can bring up fits the title panel, and its options their buttons:
  // a published set's name too, the longest the form takes, cut where it does not fit.
  const longest = LOCAL_DATA_SET_TEXT_LIMITS.name;
  const published = [
    'A Dungeon Of Many Words, The Longest Name A Player Could Give',
    'X'.repeat(longest),
    'The Keep',
  ].map((name): KnownDungeon => ({ name: name.slice(0, longest), dataSets: ['published'], signature: [] }));
  for (const dungeon of [...KNOWN_DUNGEONS, ...published]) {
    const menu = SaveMenu.importMenu({ kind: 'other', dungeon });
    console.log(`  ${dungeon.name}: ${linesOf(menu).join(' / ')}  [${menu.options.join(', ')}]`);
    check(linesOf(menu).length <= 4 && linesOf(menu).every((line) => line.length > 0 && line.length <= MENU_TITLE_MAX_CHARS) && optionsFit(menu.options),
      `${dungeon.name}: its menu is four lines at most, none wider than the title panel`);
  }
  for (const kind of ['different', 'unknown'] as const) {
    const menu = SaveMenu.importMenu({ kind });
    console.log(`  ${kind}: ${linesOf(menu).join(' / ')}  [${menu.options.join(', ')}]`);
    check(linesOf(menu).length <= 4 && linesOf(menu).every((line) => line.length > 0 && line.length <= MENU_TITLE_MAX_CHARS) && optionsFit(menu.options),
      `nor is the ${kind} dungeon's, whose options fit their buttons, ${menu.options.map((_, i) => widthOf(menu.options.length, i)).join(', ')} pixels wide`);
  }
  const unplayed = SaveMenu.importMenu({ kind: 'other', dungeon: { name: 'Elsewhere', dataSets: [], signature: [] } });
  check(unplayed.title1 === 'THIS LOOKS LIKE A SAVE OF ELSEWHERE' && unplayed.title2 === 'NOT SUPPORTED YET' && unplayed.options.join() === 'OK',
    'a known dungeon no data set plays is "NOT SUPPORTED YET", where one that a set plays is "SWITCH TO IT TO IMPORT IT"');
  check(SaveMenu.importMenu({ kind: 'other', dungeon: KNOWN_DUNGEONS[1] }).title2 === 'SWITCH TO IT TO IMPORT IT', 'as Chaos Strikes Back is');
  const titles = published.map((dungeon) => SaveMenu.importMenu({ kind: 'other', dungeon }).title1);
  check(titles[0].endsWith('...') && titles[1].endsWith('...') && titles[2] === 'THIS LOOKS LIKE A SAVE OF THE KEEP',
    'a name too long for the panel is cut and ends in "...", and a short one is whole');

  const realNow = Date.now;
  let now = new Date(2026, 9, 2, 10, 0, 0).getTime();
  Date.now = () => now;
  try {
    check(!(await daroo.drop('CSBGAME7.DAT', read(savePath('csbgame7.dat')))) && store.files.size === 0, 'with no dialog up a drop is not taken');
    const own = await daroo.saves.save('stopped', 'new');
    now += 60_000;
    const state = await daroo.open();

    // A save of the data set's dungeon.
    const genuine = read(savePath('csbgame7.dat'));
    const taken = await daroo.drop('CSBGAME7.DAT', genuine);
    console.log(`  csbgame7.dat dropped: "${state.message}"`);
    console.log(daroo.list());
    check(taken && store.files.size === 2 && state.message === SaveMenu.SAVE_MENU_IMPORTED && !state.busy && SaveMenu.isSaveMenuOpen(ui),
      `a save of the data set's dungeon is stored at once: the dialog stays up and says "${SaveMenu.SAVE_MENU_IMPORTED}"`);
    check(SaveMenu.selectedEntry(state)?.id === 'CSBGAME7.DAT' && SaveMenu.loadTarget(state)?.champions.join('/') === 'HISSSSA/SONJA/GOTHMOG/WUUF'
      && daroo.rowOf(own.id) >= 0, 'it is listed and selected, its playthrough unfolded beside the game\'s, and previewed');
    check(daroo.party() === 'DAROO' && state.dropped === null && SaveMenu.asksFirst(ui, state, 'load'),
      'nothing is loaded; LOAD on it asks, as on any save of another playthrough');
    check(wrapMessageFits(SaveMenu.SAVE_MENU_IMPORTED), 'the message fits the preview\'s panel');
    now += 60_000;

    // A save of a slightly different dungeon: the question.
    const DIFFERENT_OPTIONS = ['LOOK FOR A BETTER MATCH', 'IMPORT ANYWAY', 'CANCEL'];
    const modified = await saveOfDungeon('WUUF', 0x00f00f, (level, cellFlags) => { if (level === 3) openAWall(cellFlags); });
    const before = await rowsOf();
    await daroo.drop('modified.dat', modified);
    console.log(`  a save with a wall of level 3 opened, dropped: ${state.dropped ? `asks (${state.dropped.refusal.kind})` : 'NO QUESTION'}`);
    check(state.dropped?.refusal.kind === 'different' && !state.busy && (await rowsOf()) === before,
      'a save of a slightly different dungeon is asked about, and nothing is stored');
    check(isMenu(SaveMenu.SAVE_MENU_DIFFERENT, null, DIFFERENT_OPTIONS),
      `the question is _DoMenu's three-option menu, centred on the cleared screen: "${SaveMenu.SAVE_MENU_DIFFERENT}", ${DIFFERENT_OPTIONS.join(', ')}`);
    SaveMenu.saveMenuClick(ui, VIEWPORT_X + 4, VIEWPORT_Y + 4, LEFT);
    SaveMenu.saveMenuKey(ui, 'Enter');
    SaveMenu.saveMenuWheel(ui, 100);
    const second = await daroo.drop('CSBGAME7.DAT', genuine);
    check(state.dropped?.refusal.kind === 'different' && state.press === null && state.scrollTop === 0 && !second && (await rowsOf()) === before,
      'a click off its buttons, Enter, the wheel and another drop leave it up');
    await daroo.click(212, 3);
    check(state.dropped === null && SaveMenu.isSaveMenuOpen(ui) && state.message === '' && (await rowsOf()) === before
      && SaveMenu.selectedEntry(state)?.id === 'CSBGAME7.DAT', 'CANCEL brings the list back as it was, and stores nothing');
    await daroo.drop('modified.dat', modified);
    SaveMenu.saveMenuKey(ui, 'Escape');
    const afterEscape = state.dropped;
    await daroo.drop('modified.dat', modified);
    SaveMenu.saveMenuClick(ui, VIEWPORT_X + 4, VIEWPORT_Y + 4, RIGHT);
    check(afterEscape === null && state.dropped === null && SaveMenu.isSaveMenuOpen(ui) && (await rowsOf()) === before,
      'Esc and a right-click cancel the question, not the dialog');
    await daroo.drop('modified.dat', modified);
    await daroo.click(210, 3);
    console.log(`  LOOK FOR A BETTER MATCH: ${state.dropped ? `refused (${state.dropped.refusal.kind})` : 'NO MENU'}`);
    check(state.dropped?.refusal.kind === 'unknown' && isMenu('THIS IS A SAVE OF AN UNKNOWN DUNGEON', 'NOT SUPPORTED YET', ['OK'])
      && (await rowsOf()) === before, 'LOOK FOR A BETTER MATCH holds it against the other sets: in Dungeon Master, none has it, and it is refused');
    await daroo.click(210, 1);
    await daroo.drop('modified.dat', modified);
    await daroo.click(211, 3);
    const stored = (await store.list(null)).find((row) => row.id === 'modified.dat');
    console.log(`  IMPORT ANYWAY: "${state.message}", the row ${stored ? `of set ${stored.dataSet}${stored.unofficial ? ', unofficial' : ', OFFICIAL'}` : 'NOT STORED'}`);
    console.log(daroo.list());
    check(state.dropped === null && state.message === SaveMenu.SAVE_MENU_IMPORTED && stored?.unofficial === true && stored.dataSet === DEFAULT_DATA_SET.id,
      'IMPORT ANYWAY stores it, a row of the running data set, unofficial');
    check(SaveMenu.selectedEntry(state)?.id === 'modified.dat' && store.files.size === 3, 'and it is listed and selected');
    now += 60_000;

    // Another dungeon's, and an unknown one's: refused.
    const held = await rowsOf();
    await daroo.drop('CSBGAME2.DAT', read(CSB_SAVE));
    console.log(`  a Chaos Strikes Back save dropped: ${state.dropped ? `refused (${state.dropped.refusal.kind})` : 'NO MENU'}`);
    check(state.dropped?.refusal.kind === 'other'
      && isMenu('THIS LOOKS LIKE A SAVE OF CHAOS STRIKES BACK', 'SWITCH TO IT TO IMPORT IT', ['OK']),
      'a save of another dungeon is refused in _DoMenu\'s one-option menu: the dungeon named, "SWITCH TO IT TO IMPORT IT", OK');
    await daroo.click(210, 1);
    check(state.dropped === null && SaveMenu.isSaveMenuOpen(ui) && (await rowsOf()) === held && SaveMenu.selectedEntry(state)?.id === 'modified.dat',
      'OK brings the list back as it was');
    await daroo.drop('unknown.dat', await saveOfDungeon('BORIS', 0x0b0215, (_level, cellFlags) => openAWall(cellFlags)));
    check(state.dropped?.refusal.kind === 'unknown' && isMenu('THIS IS A SAVE OF AN UNKNOWN DUNGEON', 'NOT SUPPORTED YET', ['OK']),
      'a save of an unknown dungeon the same: "THIS IS A SAVE OF AN UNKNOWN DUNGEON", "NOT SUPPORTED YET", OK');
    SaveMenu.saveMenuKey(ui, 'Escape');
    check(state.dropped === null && (await rowsOf()) === held, 'which Esc dismisses too');

    // A file that does not read, and a drop while the dialog is at something else.
    await daroo.drop('notes.txt', new TextEncoder().encode('not a save'));
    console.log(`  a text file dropped: "${state.message}"`);
    check(state.message === NOT_A_SAVED_GAME && !state.busy && state.dropped === null && SaveMenu.isSaveMenuOpen(ui) && (await rowsOf()) === held,
      `a file that is no save is the dialog's message, "${NOT_A_SAVED_GAME}", and the list stays`);
    const damaged = genuine.slice();
    damaged[damaged.length - 100] ^= 0x01;
    await daroo.drop('damaged.dat', damaged);
    console.log(`  a save with a bit flipped dropped: "${state.message}"`);
    check(state.message === SAVED_GAME_DAMAGED && (await rowsOf()) === held,
      `a save that does not read is CSBWin's "${SAVED_GAME_DAMAGED}"`);
    check(wrapMessageFits(SAVED_GAME_DAMAGED) && wrapMessageFits(NOT_A_SAVED_GAME), 'both fit the preview\'s panel');
    const rect = menuButtonRect(SaveMenu.saveMenuButtons(state), SaveMenu.SAVE_MENU_GEOMETRY.exportButtonId)!;
    SaveMenu.saveMenuClick(ui, rect.x1 + 1, rect.y1 + 1, LEFT);
    const pressing = state.press !== null;
    const duringPress = await daroo.drop('CSBGAME7.DAT', genuine);
    check(pressing && !duringPress && (await rowsOf()) === held, 'a drop while a button is pressed is not taken');
    SaveMenu.closeSaveMenu(ui);

    // A player's own set, which holds Dungeon Master's dungeon: the same question, whose
    // LOOK FOR A BETTER MATCH finds Dungeon Master among the other sets.
    const record: LocalDataSetRecord = { id: 'local:mine', name: 'My own', description: '', authors: [], dmRules: false, baseSet: 'dm-atari',
      files: { 'dungeon.dat': new Blob([read(DUNGEON).slice()]) }, dungeonSignature: [], createdAt: 0 };
    const builder = await menuRig(graphics, store, 'HALK', {}, localDataSet(record), recordFiles(record, null));
    const inLocal = await builder.open();
    await builder.drop('modified.dat', modified);
    check(inLocal.dropped?.refusal.kind === 'different' && isMenu(SaveMenu.SAVE_MENU_DIFFERENT, null, DIFFERENT_OPTIONS, builder.ui),
      'in a local set, a save of a slightly different dungeon is asked about the same way');
    await builder.click(210, 3);
    console.log(`  in a local set, LOOK FOR A BETTER MATCH: ${inLocal.dropped ? `refused (${inLocal.dropped.refusal.kind})` : 'NO MENU'}`);
    check(inLocal.dropped?.refusal.kind === 'other'
      && isMenu('THIS LOOKS LIKE A SAVE OF DUNGEON MASTER', 'SWITCH TO IT TO IMPORT IT', ['OK'], builder.ui) && (await rowsOf()) === held,
      'and LOOK FOR A BETTER MATCH names Dungeon Master, the other sets\' dungeon, in the menu that refuses it');
    await builder.click(210, 1);
    await builder.drop('modified.dat', modified);
    await builder.click(211, 3);
    const forced = (await store.list('local:mine')).find((row) => row.id === 'modified-2.dat');
    check(inLocal.dropped === null && inLocal.message === SaveMenu.SAVE_MENU_IMPORTED && forced?.unofficial === true
      && SaveMenu.selectedEntry(inLocal)?.id === 'modified-2.dat',
      'IMPORT ANYWAY stores it, a row of the local set, unofficial, listed and selected');
    SaveMenu.closeSaveMenu(builder.ui);

    // The load-only chooser takes a drop as the disk menu does.
    const leyla = await menuRig(graphics, store, 'LEYLA');
    const chooser = await leyla.open('loadOnly');
    await leyla.drop('EARLY.DAT', read(savePath('csbgame-early-1hero.dat')));
    console.log(`  the load-only chooser, a genuine save dropped: "${chooser.message}", selected ${SaveMenu.selectedEntry(chooser)?.name}`);
    check(chooser.message === SaveMenu.SAVE_MENU_IMPORTED && SaveMenu.selectedEntry(chooser)?.id === 'EARLY.DAT' && leyla.party() === 'LEYLA',
      'the load-only chooser imports a dropped save and selects it, with nothing loaded');
    await leyla.click(SaveMenu.SAVE_MENU_GEOMETRY.loadButtonId);
    console.log(`  then LOAD: ${SaveMenu.isSaveMenuOpen(leyla.ui) ? 'THE MENU' : 'the menu gone'}, party ${leyla.party()}`);
    check(!SaveMenu.isSaveMenuOpen(leyla.ui) && leyla.party() === 'IAIDO', 'and LOAD then reads it: a genuine CSBWin save, played');
  } finally {
    Date.now = realNow;
  }
}

/** Whether a message is drawn whole at the foot of the preview's panel. */
function wrapMessageFits(message: string): boolean {
  const lines = SaveMenu.wrapMessage(message, SaveMenu.SAVE_MENU_GEOMETRY.previewMaxChars);
  return lines.length <= 5 && lines.join(' ') === message;
}

/* ------------------------------------------------------------ 12. the play time ---- */

/**
 * `Game.playTime` under the loop's VBLs, sixty a second, and through the saves: the
 * menu's SAVE and LOAD, by its own clicks, and F5 and F9.
 */
async function checkPlayTime(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== the play time ===');
  const store = memoryStore();
  const rig = await menuRig(graphics, store, 'DAROO');
  const { game, saves, ui } = rig;
  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  const play = (vbls: number): void => {
    for (let n = 0; n < vbls; n++) game.runFrame();
  };
  const seconds = (milliseconds: number | undefined): string => `${(milliseconds ?? NaN) / 1000} s`;
  const rowOfStore = async (id: string): Promise<SaveEntry | undefined> => (await store.list(null)).find((e) => e.id === id);

  const realNow = Date.now;
  let now = Date.UTC(2026, 8, 13, 14, 5, 6);
  Date.now = () => now;
  try {
    const atStart = game.playTime();
    play(600);
    const played = game.playTime();
    freeze(game.ctx);
    play(120);
    const frozen = game.playTime();
    thaw(game.ctx);
    console.log(`  a new game: ${seconds(atStart)}; after 600 VBLs: ${seconds(played)}; after 120 more, frozen: ${seconds(frozen)}`);
    check(atStart === 0 && played === 10_000, 'a new game has played no time, and counts its VBLs, sixty a second');
    check(frozen === played, 'the frozen game\'s VBLs are not counted');

    // The disk menu holds the clock, and SAVE writes the count into the row.
    const state = await rig.open();
    play(180);
    const underMenu = game.playTime();
    await rig.click(g.saveButtonId);
    const made = SaveMenu.selectedEntry(state);
    SaveMenu.closeSaveMenu(ui);
    console.log(`  after 180 more under the disk menu: ${seconds(underMenu)}; its SAVE's row: ${seconds(made?.playTime)}`);
    check(underMenu === played, 'nor are the VBLs under the disk menu');
    check(made !== null && made.playTime === played && (await rowOfStore(made.id))?.playTime === played,
      'SAVE writes the game\'s play time into the save\'s row');

    // F5 writes its own, and leaves the menu's save's alone.
    now += 60_000;
    play(90);
    await saves.quickSave();
    const quick = (await saves.list())[0]!;
    console.log(`  after 90 more VBLs, F5: its row ${seconds(quick.playTime)}, the menu's ${seconds((await rowOfStore(made!.id))?.playTime)}`);
    check(quick.quick && quick.playTime === 11_500 && (await rowOfStore(made!.id))?.playTime === played,
      'F5 writes the count of its own moment, and another save\'s row keeps its own');

    // LOAD takes the row's, whatever the game had counted.
    now += 60_000;
    play(300);
    const beforeLoad = game.playTime();
    await rig.open();
    rig.select(made!.id);
    await rig.click(g.loadButtonId);
    const afterLoad = game.playTime();
    console.log(`  after 300 more: ${seconds(beforeLoad)}; the menu's save loaded: ${seconds(afterLoad)}`);
    check(beforeLoad === 16_500 && !SaveMenu.isSaveMenuOpen(ui) && afterLoad === played,
      'LOAD gives the game the play time of the save\'s row');
    check((await rowOfStore(made!.id))?.playTime === played, 'and a load leaves the row\'s as it was');

    // F9 loads the playthrough's newest save, F5's, and takes its row's.
    play(60);
    const beforeF9 = game.playTime();
    await saves.quickLoad();
    console.log(`  after 60 more: ${seconds(beforeF9)}; F9: ${seconds(game.playTime())}`);
    check(beforeF9 === 11_000 && game.playTime() === quick.playTime, 'F9 takes the play time of the save it loads');

    // The count is in VBLs, so a save and a load lose nothing of it: three VBLs are
    // 50 ms, where three times one VBL's 17 would be 51.
    play(1);
    const one = game.playTime();
    now += 60_000;
    const exact = await saves.save('stopped', 'new');
    saves.read(await saves.open(exact));
    play(2);
    console.log(`  one VBL on: ${one - quick.playTime} ms more; saved, loaded and two VBLs on: ${game.playTime() - quick.playTime} ms more`);
    check(one === quick.playTime + 17 && exact.playTime === one && game.playTime() === quick.playTime + 50,
      'a save and a load keep the count to the VBL');

    // A read that fails leaves the game, and its count.
    const counted = game.playTime();
    let refused = false;
    try {
      saves.read({ entry: { ...exact, playTime: 1 }, bytes: new Uint8Array(64) });
    } catch {
      refused = true;
    }
    check(refused && game.playTime() === counted, 'a file that does not read leaves the game\'s play time as it was');

    // A row from before rows held it, and a new game.
    const { playTime: _none, ...before } = { ...exact, bytes: new ArrayBuffer(0) };
    saves.read({ entry: saveEntryOf(before), bytes: await store.read(exact.id) });
    const fromOldRow = game.playTime();
    play(30);
    game.readDungeonDat(new Uint8Array(readFileSync(resolve(DUNGEON))));
    console.log(`  a save whose row holds no play time, loaded: ${seconds(fromOldRow)}; a new game read after 30 VBLs: ${seconds(game.playTime())}`);
    check(saveEntryOf(before).playTime === 0 && fromOldRow === 0,
      'a stored row from before rows held the play time counts none, and its game starts from 0');
    check(game.playTime() === 0, 'a new game read into the running one has played no time');
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
  check(rows.every((r) => r.usedAt === r.savedAt), 'and is when the row was last used');
  check(rows.every((r) => r.playTime === 0), 'and a row counts no time played: no earlier build kept any');
  for (const row of rows) {
    const fresh = await loadGame();
    applySaveBytes(fresh, new Uint8Array(row.bytes));
    check(fresh.ctx.party.state.position.z === 9 && fresh.ctx.party.state.champions.length === 2, `${row.id} loads`);
  }
  check(upgradeSaveRecords([null, 'x', {}], DEFAULT_DATA_SET.id).length === 0, 'what is not a row is dropped, not thrown on');

  // Version 3: a row that names no playthrough is given one, stamped into its file.
  console.log('');
  console.log('=== the store\'s upgrade: no row holds playthrough 0 (`stampSaveRecords`) ===');
  const SEED = 0x2468ace0;
  const ids = new CsbRandom(SEED);
  const [firstId, secondId, thirdId] = [drawRandomGameID(ids), drawRandomGameID(ids), drawRandomGameID(ids)];
  const hex = (id: number): string => id.toString(16);
  /** The upgrade's draw as the page gives it: one stream, held to the data set's rows. */
  const drawFrom = (seed: number) => {
    const stream = new CsbRandom(seed);
    return (held: SaveEntry[]): number => drawPlaythrough(stream, held);
  };
  /** The game's save with `names` for a party, under `id`: 0 for a file that names none. */
  const fileOf = (names: string[], id: number): Uint8Array => {
    game.ctx.party.state.champions = names.map(healthyChampion);
    game.ctx.state.block1.randomGameID = id;
    return buildSaveFile(game);
  };
  const csbSet = dataSetNamed('csb');
  const v2 = (name: string, dataSet: string, names: string[], id: number, savedAt: number, more: Partial<StoredSaveRecord> = {}): StoredSaveRecord => {
    const bytes = fileOf(names, id);
    return { id: name, name, dataSet, quick: false, savedAt, ...readSaveFileFields(bytes)!, bytes: buffer(bytes), ...more };
  };
  const pair = ['DAROO', 'LEYLA'];
  const held = [
    v2('pair, named, older', DEFAULT_DATA_SET.id, pair, 0x700, 100),
    v2('pair, named, newer', DEFAULT_DATA_SET.id, pair, 0x900, 200),
    v2('pair, nameless, oldest', DEFAULT_DATA_SET.id, pair, 0, 50),
    v2('pair, nameless, newest', DEFAULT_DATA_SET.id, pair, 0, 300, { quick: true, usedAt: 400, playTime: 5000 }),
    v2('wuuf, nameless, older', DEFAULT_DATA_SET.id, ['WUUF'], 0, 150),
    v2('wuuf, nameless, newer', DEFAULT_DATA_SET.id, ['WUUF'], 0, 250),
    v2('wuuf, nameless, csb', csbSet.id, ['WUUF'], 0, 260),
    // The ids the stream draws first, held already: one in each data set.
    v2('halk, named', DEFAULT_DATA_SET.id, ['HALK'], firstId, 10),
    v2('halk, named, csb', csbSet.id, ['HALK'], secondId, 20),
  ];
  const stamped = stampSaveRecords(held, drawFrom(SEED));
  const after = (list: StoredSaveRecord[], name: string): number | undefined => list.find((r) => r.name === name)?.playthrough;
  console.log(`  the stream of seed ${hex(SEED)} draws ${hex(firstId)}, ${hex(secondId)}, ${hex(thirdId)}`);
  console.log(['name', 'data set', 'party', 'playthrough', 'stamped', 'its file\'s'].join('\t'));
  for (const row of held) {
    const now = stamped.find((r) => r.name === row.name);
    console.log([row.name, row.dataSet, row.champions.join('/'), hex(row.playthrough), now ? hex(now.playthrough) : 'DROPPED',
      now ? hex(readSaveFileFields(new Uint8Array(now.bytes))?.playthrough ?? 0) : ''].join('\t'));
  }
  check(stamped.length === held.length && stamped.every((r, i) => r.name === held[i]!.name), 'every row is kept, in its place');
  check(stamped.every((r) => r.playthrough !== 0), 'and none names no playthrough');
  check(stamped.every((r) => readSaveFileFields(new Uint8Array(r.bytes))?.playthrough === r.playthrough),
    'a row\'s file holds the row\'s playthrough: the id is stamped into it');
  check(stamped.every((r, i) => (held[i]!.playthrough === 0) !== (r === held[i])), 'a row that named a playthrough is returned as it was, its file untouched');
  check(after(stamped, 'pair, nameless, oldest') === 0x900 && after(stamped, 'pair, nameless, newest') === 0x900,
    'a row that named none joins the newest save of its data set and party that names one');
  check(after(stamped, 'wuuf, nameless, older') === secondId && after(stamped, 'wuuf, nameless, newer') === secondId,
    'with none to join, the first such row of a party draws an id no row of its data set holds, and the next joins it: one party, one playthrough');
  check(after(stamped, 'wuuf, nameless, csb') === thirdId, 'the same party\'s in another data set does not join it, and draws its own');
  const newest = stamped.find((r) => r.name === 'pair, nameless, newest')!;
  const oldest = stamped.find((r) => r.name === 'pair, nameless, oldest')!;
  check(newest.id === newest.name && newest.quick && newest.savedAt === 300 && newest.usedAt === 400 && newest.playTime === 5000
    && newest.level === 9 && newest.champions.join('/') === 'DAROO/LEYLA' && newest.dataSet === DEFAULT_DATA_SET.id,
    'a stamped row keeps the rest of what it held');
  check(!('usedAt' in oldest) && !('playTime' in oldest), 'and a row from before rows held a last use or a play time is given neither');

  // The stamp is the writer's: the same game saved under the id.
  const wuufStamped = new Uint8Array(stamped.find((r) => r.name === 'wuuf, nameless, older')!.bytes);
  const wuufWritten = fileOf(['WUUF'], secondId);
  const wuufNameless = new Uint8Array(held.find((r) => r.name === 'wuuf, nameless, older')!.bytes);
  const differ = wuufNameless.reduce((n, byte, i) => n + (byte === wuufStamped[i] ? 0 : 1), 0);
  console.log(`  a stamped file against the same game saved under the id: ${wuufStamped.length} bytes, ${wuufStamped.every((b, i) => b === wuufWritten[i]) ? 'the same' : 'DIFFERENT'}; against the file that named none: ${differ} bytes differ`);
  check(wuufStamped.length === wuufWritten.length && wuufStamped.every((b, i) => b === wuufWritten[i]),
    'a stamped file is, byte for byte, the file the game writes under that id');
  check(differ > 0 && differ <= 6, 'which differs from the file that named none in six bytes at most');
  const loaded = await loadGame();
  applySaveBytes(loaded, wuufStamped);
  check(loaded.ctx.state.block1.randomGameID === secondId && loaded.ctx.party.state.champions.map((c) => c.name).join() === 'WUUF',
    'and loads: the game is of that playthrough');

  // The order the store hands its rows in changes which id a new playthrough draws, not
  // which rows share one.
  const groups = (list: StoredSaveRecord[]): string => held.map((row) => {
    const id = after(list, row.name);
    return held.findIndex((other) => other.dataSet === row.dataSet && after(list, other.name) === id);
  }).join();
  const reversed = stampSaveRecords([...held].reverse(), drawFrom(SEED));
  console.log(`  the rows in reverse: wuuf ${hex(after(reversed, 'wuuf, nameless, older') ?? 0)}, in csb ${hex(after(reversed, 'wuuf, nameless, csb') ?? 0)}; the rows that share a playthrough: ${groups(reversed) === groups(stamped) ? 'the same' : 'OTHERS'}`);
  check(groups(reversed) === groups(stamped) && after(reversed, 'pair, nameless, oldest') === 0x900,
    'in whatever order the rows come, the same rows share a playthrough');
  check(after(reversed, 'wuuf, nameless, csb') === firstId && after(reversed, 'wuuf, nameless, older') === secondId,
    'another data set\'s rows do not hold an id against a draw: every comparison is a data set\'s');
  check(stampSaveRecords(stamped, drawFrom(SEED)).every((r, i) => r === stamped[i]), 'a store already stamped is left as it is');

  // A version-1 row goes through both: the `.dmweb.json` of an earlier build, whose file names none.
  const earlyFile = fileOf(pair, 0);
  const early = stampSaveRecords(upgradeSaveRecords([
    v1('early.dmweb.json', 100, json({ ...wrapped, raw: Buffer.from(earlyFile).toString('base64') })),
    v1('early-too.dat', 200, buffer(earlyFile)),
  ], DEFAULT_DATA_SET.id), drawFrom(SEED));
  console.log(`  two version-1 rows of one party, their files naming none: ${early.map((r) => `${r.name} ${hex(r.playthrough)}`).join(', ')}`);
  check(early.length === 2 && early.every((r) => r.playthrough === firstId && readSaveFileFields(new Uint8Array(r.bytes))?.playthrough === firstId),
    'version-1 rows whose files name no playthrough come out of both upgrades in one, stamped');

  // What takes no stamp is no CSBWin file.
  const broken: StoredSaveRecord = { ...held[2]!, bytes: buffer(new Uint8Array(64)) };
  const keptBroken = stampSaveRecords([broken, held[0]!], drawFrom(SEED));
  check(keptBroken.length === 2 && keptBroken[0] === broken && keptBroken[1] === held[0],
    'a row that names no playthrough and holds no file it can read is kept as it is: the store is a save\'s only copy');

  // Version 4: a file that holds none of GAMEBLOCK1's four words of `_ReadEntireGame`
  // takes them, and RISE then takes it.
  console.log('');
  console.log('=== the store\'s upgrade: no file holds GAMEBLOCK1\'s four words at 0 (`stampBlock1Rows`) ===');
  const block1 = game.ctx.state.block1;
  /** The game's save under `id`, with `words` for `Word22598`, `Word22596`, `Word22594` and `Word22592`. */
  const fileWith = (id: number, words: [number, number, number, number]): Uint8Array => {
    [block1.word22598, block1.word22596, block1.word22594, block1.word22592] = words;
    const bytes = fileOf(pair, id);
    [block1.word22598, block1.word22596, block1.word22594, block1.word22592] = [1, 2, 1, 13];
    return bytes;
  };
  const v3 = (name: string, bytes: Uint8Array, more: Partial<StoredSaveRecord> = {}): StoredSaveRecord =>
    ({ id: name, name, dataSet: DEFAULT_DATA_SET.id, quick: false, savedAt: 100, ...readSaveFileFields(bytes)!, bytes: buffer(bytes), ...more });
  /** What RISE answers the file: `TAG00260e`'s refusal, or "TAKEN". */
  const rise = (bytes: Uint8Array): string => {
    try {
      TAG00260e(ReadSavedGame(bytes, 0));
      return 'TAKEN';
    } catch (error) {
      return error instanceof Error ? error.message.replace(/\n/g, ' ').trim() : String(error);
    }
  };
  const earlyBytes = fileWith(0x2d431dd2, [0, 0, 0, 0]);
  const csbwinBytes = fileWith(0x2d431dd2, [1, 2, 1, 13]);
  const atariBytes = fileWith(0x2d431dd2, [0, 1, 0, 0]);
  const v3Rows = [
    v3('early', earlyBytes, { quick: true, usedAt: 400, playTime: 5000 }),
    v3('csbwin', csbwinBytes),
    v3('atari', atariBytes),
  ];
  const block1Stamped = stampBlock1Rows(v3Rows);
  console.log(['name', 'holds none', 'RISE before', 'stamped', 'RISE after'].join('\t'));
  for (const row of v3Rows) {
    const now = block1Stamped.find((r) => r.name === row.name);
    console.log([row.name, holdsNoBlock1Words(new Uint8Array(row.bytes)), rise(new Uint8Array(row.bytes)),
      now === row ? 'as it was' : now ? 'stamped' : 'DROPPED', now ? rise(new Uint8Array(now.bytes)) : ''].join('\t'));
  }
  const earlyNow = block1Stamped[0]!;
  const earlyStamped = new Uint8Array(earlyNow.bytes);
  check(holdsNoBlock1Words(earlyBytes) && !holdsNoBlock1Words(csbwinBytes) && !holdsNoBlock1Words(atariBytes),
    'a file holds none of the four only when all four are 0: an Atari save\'s Byte22596 1 is one');
  check(/ALREADY UTILIZED/.test(rise(earlyBytes)), 'RISE refuses the early file, as CSBWin\'s utility would');
  check(earlyStamped.length === csbwinBytes.length && earlyStamped.every((b, i) => b === csbwinBytes[i]),
    'stamped, it is byte for byte the file the game writes with _ReadEntireGame\'s 1, 2, 1 and 13 (SaveGame.cpp:1568-1571)');
  check(rise(earlyStamped) === 'TAKEN', 'and RISE takes it');
  check(earlyNow.id === 'early' && earlyNow.quick && earlyNow.usedAt === 400 && earlyNow.playTime === 5000
    && earlyNow.playthrough === 0x2d431dd2 && earlyNow.champions.join('/') === pair.join('/') && earlyNow.level === 9,
    'the stamped row keeps the rest of what it held');
  check(block1Stamped.length === 3 && block1Stamped[1] === v3Rows[1] && block1Stamped[2] === v3Rows[2],
    'a row whose file holds a word of the four is returned as it is, its file untouched');
  check(stampBlock1Rows(block1Stamped).every((r, i) => r === block1Stamped[i]), 'a store already stamped is left as it is');
  const brokenV3: StoredSaveRecord = { ...v3Rows[0]!, bytes: buffer(new Uint8Array(64)) };
  const keptBrokenV3 = stampBlock1Rows([brokenV3, v3Rows[1]!]);
  check(keptBrokenV3.length === 2 && keptBrokenV3[0] === brokenV3 && keptBrokenV3[1] === v3Rows[1],
    'a row whose file does not read is kept as it is');
  const loadedEarly = await loadGame();
  applySaveBytes(loadedEarly, earlyStamped);
  const loadedBlock1 = loadedEarly.ctx.state.block1;
  check(loadedBlock1.word22598 === 1 && loadedBlock1.word22596 === 2 && loadedBlock1.word22594 === 1 && loadedBlock1.word22592 === 13,
    'and a game read from it carries CSBWin\'s four words into its next save');

  // Each step runs on a store of a version before its own alone.
  console.log('');
  console.log('=== the store\'s upgrade: each step on a store of a version before its own (`upgradeStoredRows`) ===');
  const imported = v3('imported since', earlyBytes);
  const nameless = held[2]!;
  const later = [imported, nameless, brokenV3];
  const steps = (oldVersion: number): string => {
    const now = upgradeStoredRows(later, oldVersion, DEFAULT_DATA_SET.id, drawFrom(SEED));
    return now.map((r, i) => now.length !== later.length ? 'DROPPED' : r === later[i] ? 'kept' : r.playthrough !== later[i]!.playthrough ? 'playthrough' : 'block 1').join(', ');
  };
  console.log(`  a file holding none of the four, a row naming no playthrough, a row not read: at 2 ${steps(2)}; at 3 ${steps(3)}; at ${ROWS_UPGRADED_VERSION} ${steps(ROWS_UPGRADED_VERSION)}`);
  check(steps(2) === 'block 1, playthrough, kept', 'from version 2, both later steps run, and the row not read is kept');
  check(steps(3) === 'block 1, kept, kept', 'from version 3, only the stamp of GAMEBLOCK1\'s four words');
  check(steps(ROWS_UPGRADED_VERSION) === 'kept, kept, kept' && steps(ROWS_UPGRADED_VERSION + 1) === 'kept, kept, kept',
    `from version ${ROWS_UPGRADED_VERSION} on, none: a file imported since is left as it is (doc/SAVES.md)`);
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
  await checkSelection(graphics);
  await checkQuestion(graphics);
  await checkTwoLevels(graphics);
  await checkPreview(graphics);
  await checkScrolling(graphics);
  await checkDoubleClick(graphics);
  await checkExport(graphics);
  await checkDelete(graphics);
  await checkImport(graphics);
  await checkDrop(graphics);
  await checkPlayTime(graphics);
  await checkUpgrade();
  await checkRise(graphics);
  await checkRiseFaces(graphics);
  finish();
}

void main();
