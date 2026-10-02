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
 *    date format, what fits in 33 characters, when LOAD is inert. None of it is on
 *    screen until there are saves to list.
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
 *    F9 loads its playthrough's newest save. SAVE over a listed save writes that row.
 *    And a file that
 *    A save read into a game is marked as the last one used. And a file that
 *    names no playthrough, loaded: its game joins the playthrough of a save of its data
 *    set and party, or draws one. And a drawn playthrough, a new game's or such a
 *    file's, is drawn again while a save of the data set holds it.
 * 9. **The store's upgrade.** The rows of the store's first version, a CSBWin file or a
 *    `.dmweb.json` around one, made today's (`src/data/saves/legacyRows.ts`). The page
 *    runs it once, inside IndexedDB's upgrade; here it runs over rows built by hand.
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
 * 12. **The play time.** The player's time in a game is the VBLs its loop runs, the
 *    frozen game's and the save menu's left out. No file holds it: a save's row does,
 *    and a load takes it back from the row.
 * 14. **The preview.** The panel beside the list shows the save LOAD would read: its
 *    party, its level, its play time and its date, a line each on the list's rows. The
 *    lines are drawn for real and the panel read back: which rows hold ink, that none
 *    leaves the panel's interior, that a heading shows its last save used and "NEW
 *    SAVE" nothing, and that the line under the list no longer names the party.
 * 7. **The press animation.** `_WaitForMenuSelect` paints its second pass over its first
 *    and restores the screen only after both (`doc/CSBwin-src/Menu.cpp:121-179`). The
 *    save menu redraws the whole screen on every frame of the press, so the pixels of a
 *    frame in the second pass are read back here: both passes' edges must be up.
 *
 * Run: `npx tsx tools/dump-save-menu.ts`
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { CsbRandom } from '../src/core/random';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, decodeObjectID, type ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
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
  quickSlot,
  saveEntryOf,
  SAVE_FILE_EXTENSION,
  sortSaveEntries,
  type SaveEntry,
  type SaveStore,
} from '../src/data/saves/SaveStore';
import { upgradeSaveRecords } from '../src/data/saves/legacyRows';
import { DEFAULT_DATA_SET, dataSetFor } from '../src/data/DataSets';
import { Game } from '../src/engine/Game';
import type { GameHost, MessageSink } from '../src/engine/GameHost';
import { freeze, thaw, type LoopScript } from '../src/engine/LoopState';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { drawRandomGameID } from '../src/engine/GameContext';
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
  doMenu,
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

/** Enough of a `UIState` to run the menu's drawing into a buffer. */
function makeDrawingUI(graphics: GraphicsLoader): UIState {
  const ui = {
    screenIndexBuffer: createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0),
    fontData: loadFontData(graphics),
    uiTables: graphicsTablesOf(graphics).ui,
    getGraphicBitmap: graphicBitmaps(graphics),
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

  // The dialog's buttons are graphic 0's frame drawn elsewhere, and take the rectangle
  // and the label CSBWin gives the frame where it stands: its bottom pair, at (10,99) and
  // (117,99) in the bitmap, ids 212 and 213 of this set.
  const pair = [
    { frame: { x1: 10, y1: 99, x2: 107, y2: 125 }, table: four[2], label: [59, 114] },
    { frame: { x1: 117, y1: 99, x2: 213, y2: 125 }, table: four[3], label: [166, 114] },
  ];
  for (const { frame, table, label } of pair) {
    const onScreen = { x1: frame.x1 + VIEWPORT_X, y1: frame.y1 + VIEWPORT_Y, x2: frame.x2 + VIEWPORT_X, y2: frame.y2 + VIEWPORT_Y };
    const rect = SaveMenu.buttonRect(onScreen);
    const at = SaveMenu.buttonLabelAt(frame);
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

  /* ---- the pieces, each drawn at its own size: the art itself ---- */

  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  const ui = makeDrawingUI(graphics);
  const size = (r: { x1: number; y1: number; x2: number; y2: number }): string => `${r.x2 - r.x1 + 1}x${r.y2 - r.y1 + 1}`;
  /** How many pixels of `piece`, drawn at its own size and place, are not graphic 0's. */
  const ownSize = (piece: SaveMenu.DialogPiece, within: (x: number, y: number) => boolean): number => {
    ui.screenIndexBuffer!.pixels.fill(7);
    SaveMenu.drawPiece(ui, piece, piece);
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
    mode: 'full', entries: [], unfolded: new Set(), rows: [], selected: -1, scrollTop: 0, busy: true, message: '',
    press: null, pending: null, confirm: null, frameHandle: null,
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
  check(size(g.listPanel).startsWith(`${g.panelPiece.x2 - g.panelPiece.x1 + 1}x`), 'the list\'s panel is as wide as graphic 0\'s own');

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
  bands.push(['status', g.statusY]);
  for (const [name, y] of bands) {
    // A row's highlight runs from `y-5` to `y+2`, across the panel's interior; the glyph
    // cell `drawTextLineIndex` fills is inside it.
    const dirty = countNot(ui, g.listInnerX1, g.listInnerX2, y - 5, y + 2, MENU_PANEL_COLOR);
    dirtyTotal += dirty;
    console.log([name, y, dirty].join('\t'));
  }
  check(dirtyTotal === 0, `every row and the status line sit on clean panel background (${dirtyTotal} stray pixels)`);
  check(g.statusY - 4 > g.rowFirstY + (g.rows - 1) * g.rowStep + 2, 'the status line is clear of the last row\'s highlight');
  check(pixelAt(ui, g.listInnerX1 - 1, g.rowFirstY) !== MENU_PANEL_COLOR && pixelAt(ui, g.listInnerX2 + 1, g.rowFirstY) !== MENU_PANEL_COLOR,
    'and the highlight runs from one edge of the panel to the other');

  // A row is 33 characters of a six-pixel cell; it has to stop at the panel's inner right
  // edge, not run into the border.
  const rowRight = g.textX + g.textMaxChars * 6 - 1;
  console.log(`  a full row runs x ${g.textX}..${rowRight}, the panel's interior ends at ${g.listInnerX2}`);
  check(rowRight <= g.listInnerX2, `a full-width row fits inside the panel (${rowRight} <= ${g.listInnerX2})`);

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
    const at = SaveMenu.buttonLabelAt(frame);
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
    savedAt: 0,
    playTime: 0,
    level: 0,
    champions: [],
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

  // A save's row is its own alone: the day, the time, the level and F5's mark. The party
  // is its heading's.
  const max = SaveMenu.SAVE_MENU_GEOMETRY.textMaxChars;
  const afternoon = new Date(2026, 8, 13, 14, 5).getTime();
  const rows: Array<[SaveEntry, string]> = [
    [entry({ savedAt: afternoon, level: 14, champions: ['DAROO', 'SONJA', 'LEYLA', 'ESMARDA'] }), '  2026-09-13 14:05 L14'],
    [entry({ savedAt: afternoon, level: 5, quick: true, champions: ['HALK'] }), '  2026-09-13 14:05 L5 F5'],
  ];
  console.log('');
  console.log(['row', 'chars'].join('\t'));
  for (const [row, expected] of rows) {
    const text = formatSaveRow(row);
    console.log([JSON.stringify(text), text.length].join('\t'));
    check(text === expected && text.length <= max, `a save's row is "${expected}": the day, the time, the level, and F5 on a quick-save`);
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
  check(longest.length === max && longest.endsWith('ABCDEFG'), `four names of seven characters are the row's ${max}`);
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
  check(formatSavePreview(entry({ playTime: hours(99_999, 59, 59) }))[8].length === wide,
    'a play time under a hundred thousand hours fits');

  // The playthroughs: the saves of one id, the last one used first.
  const games = [
    entry({ name: 'a1', playthrough: 7, savedAt: 100, champions: ['OLD'] }),
    entry({ name: 'a2', playthrough: 7, savedAt: 400, champions: ['DAROO'] }),
    entry({ name: 'b1', playthrough: 9, savedAt: 200, usedAt: 500, champions: ['WUUF'] }),
    entry({ name: 'b2', playthrough: 9, savedAt: 300, champions: ['WUUF', 'HALK'] }),
    entry({ name: 'c1', playthrough: 0, savedAt: 50, champions: ['LEYLA'] }),
    entry({ name: 'c2', playthrough: 0, savedAt: 60, champions: ['SONJA'] }),
  ];
  const describe = (list: SaveEntry[]): string => playthroughsOf(list)
    .map((game) => `${game.id}: ${game.saves.map((e) => e.name).join(' ')} (last used ${game.lastUsed.name})`).join('; ');
  console.log('');
  console.log(`  playthroughs: ${describe(games)}`);
  check(describe(games) === '9: b2 b1 (last used b1); 7: a2 a1 (last used a2); 0: c2 c1 (last used c2)',
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
    markUsed: async (id, usedAt) => {
      const held = entries.get(id);
      if (held) entries.set(id, { ...held, usedAt });
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
  const rect = SaveMenu.buttonRect(SaveMenu.SAVE_MENU_GEOMETRY.buttonFrames.save);
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
    const first = await menu.saves.save('stopped', 'new');
    console.log(`  clock stopped: tail run at the write ${menu.tailAtWrite()}, after it ${menu.game.canRestartFromSavegame()}`);
    check(menu.tailAtWrite() === false && menu.game.canRestartFromSavegame(),
      'the menu\'s save runs its tail once the file is written (SaveGame.cpp:1245-1260)');
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
      'a failed write skips the tail, as SaveError jumps past it (SaveGame.cpp:1264)');

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
    const slowSaves = new GameSaves(slowGame, DEFAULT_DATA_SET, slow, { portraitOf: () => undefined, repackOpenChest: () => {} }, () => {});
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
    const empty = await stage(false, dataSetFor('dm-windows'), shared);
    const beforeNone = told.length;
    await stranger.saves.quickLoad();
    await empty.saves.quickLoad();
    console.log(`  F9 in another playthrough of ${DEFAULT_DATA_SET.id}, then in dm-windows: ${toldSince(beforeNone)}`);
    check(toldSince(beforeNone) === '/15:CAN\'T FIND SAVED GAME!/15:CAN\'T FIND SAVED GAME!'
      && stranger.game.ctx.party.state.champions[0]!.name === 'WUUF' && empty.game.ctx.party.state.champions[0]!.name === 'DAROO',
      'F9 in a playthrough with no save finds none (SaveGame.cpp:1585), whatever the others hold, and loads nothing');

    // Each playthrough's F5 has its own slot.
    const strangerQuick = await stranger.saves.save('running', 'quick');
    const dmQuick = await dm.saves.save('running', 'quick');
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
      return early.saves.save('stopped', quick ? 'quick' : 'new');
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
    const carried = await alone.saves.save('stopped', 'new');
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
    const quickOver = await alone.saves.save('running', 'quick');
    check(quickOver.id !== newest.id && (await kept.list(null)).find((e) => e.id === newest.id)?.playthrough === 0,
      'F5 makes its own slot beside a quick-save that names no playthrough');

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
      const saves = new GameSaves(game, dataSet, store, { portraitOf: () => undefined, repackOpenChest: () => {} },
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

      // A file that names no playthrough, of a party no save is of: its draw is held to
      // the same rows.
      const earlier = await fresh(drawn);
      earlier.game.ctx.state.block1.randomGameID = 0;
      const unnamed = await saved(earlier, 'LEYLA');
      const loaded = await fresh(memoryStore());
      loaded.saves.read(await earlier.saves.open(unnamed));
      console.log(`  a file of no playthrough and of another party, loaded: ${hex(idOf(loaded))}`);
      check(unnamed.playthrough === 0 && idOf(loaded) === thirdId,
        'a file that names no playthrough is given the first id its stream draws that no save holds');
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
async function menuRig(graphics: GraphicsLoader, store: SaveStore, champion: string) {
  const game = await loadGame();
  game.systems.hallOfChampions.addChampion(healthyChampion(champion));
  const saves = new GameSaves(game, DEFAULT_DATA_SET, store, { portraitOf: () => undefined, repackOpenChest: () => {} }, () => {});
  let drawsWithNoMenu = 0;
  const ui: UIState = newUIState(graphics, game.ctx, {
    getGraphicBitmap: graphicBitmaps(graphics),
    renderLastFrame: () => { if (!ui.saveMenu) drawsWithNoMenu++; },
    onListSaves: () => saves.list(),
    onReadSave: (listed) => saves.open(listed),
    onSaveGame: (over) => saves.save('stopped', over ?? 'new'),
    onRestoreSave: (save) => saves.read(save),
  });
  const g = SaveMenu.SAVE_MENU_GEOMETRY;
  return {
    game,
    saves,
    ui,
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
    /** A click on row `row` of the list, which is in view. */
    clickRow(row: number): void {
      SaveMenu.saveMenuClick(ui, g.textX, g.rowFirstY + (row - ui.saveMenu!.scrollTop) * g.rowStep, LEFT);
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
    const exportRect = SaveMenu.buttonRect(g.buttonFrames.export);
    SaveMenu.saveMenuClick(ui, exportRect.x1, exportRect.y1, LEFT);
    check(state.press === null && SaveMenu.isSaveMenuOpen(ui), 'EXPORT\'s frame, which has no label, takes no click');

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
      rig.saves.read({ entry: newer!, bytes: new Uint8Array(64), joins: 0 });
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

    // CANCEL is a button like the others: its press plays first.
    const cancel = SaveMenu.buttonRect(g.buttonFrames.cancel);
    SaveMenu.saveMenuClick(ui, cancel.x1, cancel.y1, LEFT);
    const pressed = chooser.press?.buttonId === g.cancelButtonId && SaveMenu.isSaveMenuOpen(ui);
    const drawsThen = rig.drawsWithNoMenu();
    await rig.settled();
    console.log(`  CANCEL: ${pressed ? 'pressed' : 'NOT PRESSED'}, then ${SaveMenu.isSaveMenuOpen(ui) ? 'THE MENU' : 'the menu gone'}, the screen drawn ${rig.drawsWithNoMenu() - drawsThen} time(s) after it, party ${rig.party()}`);
    check(pressed && !SaveMenu.isSaveMenuOpen(ui) && rig.party() === 'DAROO', 'CANCEL plays its press, then closes the chooser, and nothing is loaded');
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
 * One store, the saves of two games and a file that names no playthrough, and the first
 * game's menu over them: which LOAD and which SAVE ask first, and what each answer does.
 */
async function checkQuestion(graphics: GraphicsLoader): Promise<void> {
  console.log('');
  console.log('=== the question before a load or a save across playthroughs ===');
  const store = memoryStore();
  const mine = await menuRig(graphics, store, 'DAROO');
  const theirs = await menuRig(graphics, store, 'WUUF');
  const early = await menuRig(graphics, store, 'LEYLA');
  early.game.ctx.state.block1.randomGameID = 0;
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
    const nameless = await early.saves.save('stopped', 'new');
    later();
    check(idOf(mine) !== idOf(theirs) && nameless.playthrough === 0, 'two games are two playthroughs, and the third file names none');

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
    SaveMenu.saveMenuWheel(ui, 1);
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

    // LOAD asks the same, of a file that names no playthrough too.
    const askedNameless = await press(nameless, g.loadButtonId);
    await mine.click(211, 2);
    const askedLoad = await press(theirOlder, g.loadButtonId);
    console.log(`  LOAD on a file that names no playthrough: ${askedNameless}; on another playthrough's save: ${askedLoad}, party ${mine.party()}`);
    check(askedNameless === 'asks (load)', 'LOAD of a file that names no playthrough asks first');
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
  /** How many pixels of a button's label are up: none on a button that can do nothing. */
  const labelOf = (ui: UIState, frame: { x1: number; y1: number; x2: number; y2: number }): number => {
    SaveMenu.drawSaveMenu(ui);
    const at = SaveMenu.buttonLabelAt(frame);
    return countNot(ui, at.x - 18, at.x + 17, at.y - 4, at.y + 1, MENU_PANEL_COLOR);
  };

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
    check(SaveMenu.rowText(state, state.rows[4]) === '  2026-09-13 14:09 L0 F5', 'F5\'s save is marked');
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
  const statusInk = (): number => {
    SaveMenu.drawSaveMenu(ui);
    return countNot(ui, g.listInnerX1, g.listInnerX2, g.statusY - 4, g.statusY + 1, MENU_PANEL_COLOR);
  };
  const expected = (lines: string[]): string => Array.from({ length: g.rows }, (_, row) => (lines[row] ? '#' : '.')).join('');

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
    const saved = statusInk();
    console.log(`  a save of DAROO alone: ${JSON.stringify(firstLines)}`);
    console.log(`    lines ${inked()}, ${stray()} stray pixels, the line under the list "${ui.saveMenu!.message}" (${saved} pixels)`);
    check(firstLines.join('|') === 'DAROO|||||LEVEL 0||PLAYED|0:00:10||SAVED|2026-09-13|14:05',
      'the save\'s row gives the preview its party, its level, its play time and its date');
    check(inked() === expected(firstLines), 'each line is drawn on the row of its number, and an empty one draws nothing');
    check(stray() === 0, 'and nothing is drawn outside the lines\' cells: the panel\'s edges are left whole');
    check(saved > 0, 'the line under the list says what was done');
    const firstDrawn = drawn();

    // A second save: another champion in the party, a minute on.
    now += 60_000;
    game.systems.hallOfChampions.addChampion(healthyChampion('LEYLA'));
    rig.clickRow(0);
    const fromHeading = drawn();
    const onHeading = statusInk();
    check(SaveMenu.selectedEntry(ui.saveMenu!) === null && fromHeading === firstDrawn,
      'a heading shows the save LOAD reads from it, its playthrough\'s last save used');
    check(onHeading === 0, 'and a move of the selection leaves the line under the list empty');
    await rig.click(g.saveButtonId);
    const second = SaveMenu.selectedEntry(ui.saveMenu!)!;
    const secondLines = formatSavePreview(second);
    console.log(`  a save of DAROO and LEYLA, a minute on: ${JSON.stringify(secondLines)}`);
    console.log(`    lines ${inked()}`);
    const secondDrawn = drawn();
    check(secondLines[1] === 'LEYLA' && secondLines[12] === '14:06' && inked() === expected(secondLines) && secondDrawn !== firstDrawn,
      'another save shows its own party and its own time');
    rig.select(first.id);
    const back = drawn();
    const onSave = statusInk();
    check(back === firstDrawn, 'and the first, selected again, its own as before');
    check(onSave === 0, 'with a save selected and nothing to report, the line under the list is empty: the party is the preview\'s');

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
      saves.read({ entry: { ...exact, playTime: 1 }, bytes: new Uint8Array(64), joins: 0 });
    } catch {
      refused = true;
    }
    check(refused && game.playTime() === counted, 'a file that does not read leaves the game\'s play time as it was');

    // A row from before rows held it, and a new game.
    const { playTime: _none, ...before } = { ...exact, bytes: new ArrayBuffer(0) };
    saves.read({ entry: saveEntryOf(before), bytes: await store.read(exact.id), joins: 0 });
    const fromOldRow = game.playTime();
    play(30);
    const read = game.readDungeonDat(new Uint8Array(readFileSync(resolve(DUNGEON))));
    console.log(`  a save whose row holds no play time, loaded: ${seconds(fromOldRow)}; a new game read after 30 VBLs: ${seconds(game.playTime())}`);
    check(saveEntryOf(before).playTime === 0 && fromOldRow === 0,
      'a stored row from before rows held the play time counts none, and its game starts from 0');
    check(read && game.playTime() === 0, 'a new game read into the running one has played no time');
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
  await checkPlayTime(graphics);
  await checkUpgrade();
  finish();
}

void main();
