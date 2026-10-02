/**
 * The save/load screen behind the inventory's disk icon.
 *
 * This is **not** a port of `_DisplayDiskMenu`. It keeps `_DoMenu`'s art, colours, text
 * metrics and press animation, and replaces CSBWin's four-slot chooser, which is a
 * `char fNames[4][20]` on the stack shown as a four-button menu
 * (`doc/CSBwin-src/CSBCode.cpp:9744-9816`). Every divergence is listed in
 * `doc/CSBWIN_MENU_REFERENCE.md` → "Deliberate divergences in this port". In short: a
 * dialog of its own over the screen, an unbounded scrolling list of the data set's saves,
 * a date and roster per row instead of a filename and a recency letter, no "save and
 * quit", and Esc/right-click to cancel.
 *
 * ## The dialog
 *
 * `_DoMenu` draws graphic 0, 224x136, in the viewport's place, and each of its four
 * layouts is that bitmap blitted over itself (`Menu.ts`). A list of saves beside a
 * preview needs more room than the bitmap has, so the dialog is 304x184 on a screen
 * cleared to black, and is drawn from three pieces of graphic 0 (`drawPiece`): the grey
 * frame, the sunken title panel and a button frame. A piece drawn at another size keeps
 * its corners and repeats the column and the row just inside them, so no art is
 * invented. Two panels, the list's and the preview's, stand over a row of four button
 * frames: LOAD, SAVE and EXPORT under the list, CANCEL under the preview.
 *
 * A label sits in its frame where `_DoMenu` puts one, and a click and the press
 * animation take the rectangle CSBWin's table gives a frame (`buttonRect`,
 * `buttonLabelAt`). A button that can do nothing is drawn with **no label at all**, which
 * is what CSBWin does to an empty save slot: `strcpy(fNames[i],"   ")` blanks the name
 * and the button sits there inert (`doc/CSBwin-src/CSBCode.cpp:9772`). EXPORT's frame is
 * such a button.
 *
 * ## The "new save" row
 *
 * SAVE writes over the selected save, as CSBWin's writes over the slot chosen
 * (`_SelectSaveGame`, `:9738`). A save of its own is made from the list's first row,
 * "NEW SAVE", which only the full menu has. With that row selected there is nothing to
 * load, so LOAD is inert.
 *
 * Either menu opens on the last save used, written or loaded (`lastUsedSave`): SAVE at
 * once writes over the save the game came from, and LOAD goes back to it. With no save
 * in the data set, the full menu opens on "NEW SAVE".
 *
 * ## The question
 *
 * LOAD and SAVE ask first when the selected save is of another playthrough than the
 * running game's (`asksFirst`): the one would leave the game being played for another,
 * the other would write this game over a save of another. The question is `_DoMenu`'s
 * two-option menu, centred, in the dialog's place, under CSBWin's own line for a save of
 * another `d.RandomGameID`, "THAT'S NOT THE SAME GAME"
 * (`doc/CSBwin-src/SaveGame.cpp:1605-1606`, where it refuses the save outright), with the
 * action and CANCEL. The load-only chooser has no game to leave and never asks.
 *
 * ## Modality and the clock
 *
 * `_WaitForMenuSelect` nulls `SecondaryButtonList` and both `pKeyXlate`s and replaces
 * `PrimaryButtonList`, so nothing outside the menu can be clicked, and it never returns
 * to the main loop, so `d.Time` stops. Here the click comes **straight from the DOM
 * event** rather than through the game's mouse queue, which is the same exclusivity.
 * This port's loop keeps running, so the clock is stopped explicitly, with
 * `ctx.state.paused` (`d.Time++` is the main loop's, `doc/CSBwin-src/CSBCode.cpp:660`).
 */
import type { OpenedSave, SaveEntry } from '../../data/saves';
import { formatSaveDetail, formatSaveRow, lastUsedSave } from '../../data/saves';
import { clearIndex, fillRectIndex } from '../csbwin/CanvasBlitter';
import { drawTextLineIndex } from '../csbwin/TextRenderer';
import type { Rect, UIButton } from '../../data/tables/UITables';
import { searchButtonList } from './HitTest';
import {
  MENU_GRAPHIC,
  MENU_OPTION_COLOR,
  MENU_PANEL_COLOR,
  MENU_PRESS_PHASE_MS,
  MENU_TITLE1_COLOR,
  doMenu,
  drawMenuPress,
  menuButtonList,
  menuButtonRect,
  menuHitTest,
  menuPressFinished,
  type MenuPress,
} from './Menu';
import { tag02076e, tag0207cc } from './Mouse';
import { nowMs, type UIState } from './UIState';

/* ------------------------------------------------------------------ geometry ---- */

/**
 * A rectangle of graphic 0, and how much of each side is kept as it is when the piece is
 * drawn at another size (`drawPiece`).
 */
export interface DialogPiece extends Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The grey frame: graphic 0 whole, whose edges are plain as far as its panel, at 10. */
const FRAME_PIECE: DialogPiece = { x1: 0, y1: 0, x2: 223, y2: 135, left: 9, top: 9, right: 9, bottom: 9 };
/** The title panel: two rows and two columns of edge around the panel colour. */
const PANEL_PIECE: DialogPiece = { x1: 10, y1: 10, x2: 213, y2: 51, left: 2, top: 2, right: 2, bottom: 2 };
/**
 * The left frame of the bottom pair. Its bevels are six columns each; its rows are all
 * kept, so it is drawn at its own height alone.
 */
const BUTTON_PIECE: DialogPiece = { x1: 10, y1: 99, x2: 107, y2: 125, left: 6, top: 13, right: 6, bottom: 14 };

/**
 * All in screen coordinates. The margins are graphic 0's own: ten pixels of frame around
 * what it holds, ten rows between its panel and the button frame below, nine columns
 * between the frames of its bottom pair.
 */
const DIALOG: Rect = { x1: 8, y1: 8, x2: 311, y2: 191 };
/** As wide as graphic 0's panel, for the 33 characters of a row. */
const LIST_PANEL: Rect = { x1: 18, y1: 18, x2: 221, y2: 144 };
const PREVIEW_PANEL: Rect = { x1: 231, y1: 18, x2: 301, y2: 144 };
const BUTTON_Y1 = 155;
const BUTTON_Y2 = 181;
const BUTTON_FRAMES = {
  load: { x1: 18, y1: BUTTON_Y1, x2: 79, y2: BUTTON_Y2 },
  save: { x1: 89, y1: BUTTON_Y1, x2: 150, y2: BUTTON_Y2 },
  export: { x1: 160, y1: BUTTON_Y1, x2: 221, y2: BUTTON_Y2 },
  cancel: { x1: 231, y1: BUTTON_Y1, x2: 301, y2: BUTTON_Y2 },
} as const;

/** The list panel's clean interior: past its two columns of edge, and short of its one. */
const LIST_INNER_X1 = LIST_PANEL.x1 + 2;
const LIST_INNER_X2 = LIST_PANEL.x2 - 1;

const TEXT_X = LIST_PANEL.x1 + 4;
const TEXT_MAX_CHARS = 33;
const ROW_FIRST_Y = LIST_PANEL.y1 + 9;
const ROW_STEP = 8;
export const SAVE_MENU_ROWS = 14;
const STATUS_Y = ROW_FIRST_Y + SAVE_MENU_ROWS * ROW_STEP + 1;

/** The full menu's first row: SAVE with it selected makes a new save. */
const NEW_SAVE_LABEL = 'NEW SAVE';

/** The question's title, and its two options: the action asked about, then this. */
export const SAVE_MENU_QUESTION = 'THAT\'S NOT THE SAME GAME';
const CANCEL_LABEL = 'CANCEL';
const ACTION_LABELS = { load: 'LOAD', save: 'SAVE' } as const;

/** The dialog's own buttons; the question's are CSBWin's 210 and 211. */
const BTN_LOAD = 900;
const BTN_SAVE = 901;
const BTN_CANCEL = 902;
const BTN_ROW0 = 910;

/**
 * The rectangle a click on a button frame takes, and its press animation grows from, as
 * the table holds one: the frame less six pixels a side, `x2` and `y2` exclusive, which
 * is what `d.pButn18970` gives graphic 0's own frames.
 */
export function buttonRect(frame: Rect): Rect {
  return { x1: frame.x1 + 6, y1: frame.y1 + 6, x2: frame.x2 - 6, y2: frame.y2 - 6 };
}

/**
 * Where a label is centred in a button frame: where `_DoMenu` centres one in graphic 0's
 * own, (59,114) and (166,114) in its bottom pair (`doc/CSBwin-src/Menu.cpp:339-346`).
 */
export function buttonLabelAt(frame: Rect): { x: number; y: number } {
  return { x: ((frame.x1 + frame.x2) >> 1) + 1, y: frame.y1 + 15 };
}

/**
 * Everything the layout depends on, in one place, so `tools/dump-save-menu.ts` can
 * check it against the art instead of against a copy of these numbers.
 */
export const SAVE_MENU_GEOMETRY = {
  framePiece: FRAME_PIECE,
  panelPiece: PANEL_PIECE,
  buttonPiece: BUTTON_PIECE,
  dialog: DIALOG,
  listPanel: LIST_PANEL,
  previewPanel: PREVIEW_PANEL,
  buttonFrames: BUTTON_FRAMES,
  listInnerX1: LIST_INNER_X1,
  listInnerX2: LIST_INNER_X2,
  textX: TEXT_X,
  textMaxChars: TEXT_MAX_CHARS,
  rowFirstY: ROW_FIRST_Y,
  rowStep: ROW_STEP,
  rows: SAVE_MENU_ROWS,
  statusY: STATUS_Y,
  loadButtonId: BTN_LOAD,
  saveButtonId: BTN_SAVE,
  cancelButtonId: BTN_CANCEL,
} as const;

/* --------------------------------------------------------------------- state ---- */

export type SaveMenuMode = 'full' | 'loadOnly';

/** What the bottom pair of buttons does. */
export type SaveMenuAction = 'load' | 'save';

export interface SaveMenuState {
  mode: SaveMenuMode;
  /** The running data set's saves, newest first (`UIState.onListSaves`). */
  entries: SaveEntry[];
  /**
   * Index into the list's rows, or -1: the full menu's "new save" row and then
   * `entries`, the load-only menu's `entries` alone. LOAD is inert unless it is a save's
   * (`selectedEntry`).
   */
  selected: number;
  scrollTop: number;
  /** An async list/read/write is in flight; every button is inert. */
  busy: boolean;
  /** The status line: an error, or what the last action did. */
  message: string;
  press: MenuPress | null;
  /** What the press animation will do when it finishes. */
  pending: (() => void) | null;
  /** The action the question on screen asks about, in the dialog's place, or `null`. */
  confirm: SaveMenuAction | null;
  frameHandle: number | null;
}

export function isSaveMenuOpen(ui: UIState): boolean {
  return ui.saveMenu !== null;
}

/**
 * Raise the screen. `loadOnly` is what the title screen will want: the same list with
 * no SAVE button.
 *
 * The full screen is the disk menu, `_DisplayDiskMenu`, so `TAG02076e` runs first
 * (`doc/CSBwin-src/SaveGame.cpp:860`) and `TAG0207cc` last (`:1274`): `tag02076e` and
 * `tag0207cc`. The load-only one is `_ReadEntireGame` (`:1435`), which calls neither.
 */
export function openSaveMenu(ui: UIState, mode: SaveMenuMode = 'full'): void {
  if (ui.saveMenu) return;
  if (mode === 'full') tag02076e(ui);
  ui.ctx.state.paused = true;
  ui.saveMenu = {
    mode,
    entries: [],
    selected: -1,
    scrollTop: 0,
    busy: true,
    message: '',
    press: null,
    pending: null,
    confirm: null,
    frameHandle: null,
  };
  void refreshSaveMenu(ui);
}

export function closeSaveMenu(ui: UIState): void {
  if (!ui.saveMenu) return;
  const { mode } = ui.saveMenu;
  if (ui.saveMenu.frameHandle !== null) cancelFrame(ui.saveMenu.frameHandle);
  ui.saveMenu = null;
  ui.ctx.state.paused = false;
  if (mode === 'full') tag0207cc(ui);
}

/* ------------------------------------------------------------------ the list ---- */

/** List the saves again. Never throws — the failure becomes the status line. */
export async function refreshSaveMenu(ui: UIState): Promise<void> {
  const state = ui.saveMenu;
  if (!state) return;
  state.busy = true;
  state.message = '';
  ui.renderLastFrame();
  try {
    state.entries = await ui.onListSaves();
    selectLastUsed(state);
  } catch (error) {
    state.entries = [];
    selectLastUsed(state);
    state.message = shortError(error);
  } finally {
    state.busy = false;
    ui.renderLastFrame();
  }
}

function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.toUpperCase().slice(0, TEXT_MAX_CHARS);
}

/** The rows above the saves: the full menu's "new save" row. */
function newSaveRows(state: SaveMenuState): number {
  return state.mode === 'full' ? 1 : 0;
}

function rowCount(state: SaveMenuState): number {
  return newSaveRows(state) + state.entries.length;
}

/** The save a row of the list shows, or `null` for the "new save" row and past the end. */
function entryAt(state: SaveMenuState, row: number): SaveEntry | null {
  return state.entries[row - newSaveRows(state)] ?? null;
}

/** The selected save: what LOAD reads and SAVE writes over. `null` on the "new save" row. */
export function selectedEntry(state: SaveMenuState): SaveEntry | null {
  return entryAt(state, state.selected);
}

function canLoad(state: SaveMenuState): boolean {
  return !state.busy && selectedEntry(state) !== null;
}

function canSave(state: SaveMenuState): boolean {
  return !state.busy && state.mode === 'full';
}

/**
 * Whether LOAD or SAVE asks before it acts: in the full menu, on a save of another
 * playthrough than the running game's (`d.RandomGameID`). The order of two saves of one
 * playthrough is never checked, and the "new save" row writes over nothing. The
 * load-only chooser never asks: no game is being played behind it, at the entrance or
 * after a lost one, where CSBWin's own test cannot fire either
 * (`doc/CSBWIN_TITLE_SCREEN_REFERENCE.md` → ""THAT'S NOT THE SAME GAME" cannot happen
 * after a restart").
 */
export function asksFirst(ui: UIState, state: SaveMenuState): boolean {
  const entry = selectedEntry(state);
  return state.mode === 'full' && entry !== null
    && entry.playthrough !== ui.ctx.state.block1.randomGameID;
}

/**
 * The selection of a list just read: the last save used, scrolled into view; with no
 * save, the list's first row, which is the full menu's "new save".
 */
function selectLastUsed(state: SaveMenuState): void {
  const last = lastUsedSave(state.entries);
  state.selected = last ? newSaveRows(state) + state.entries.indexOf(last) : rowCount(state) > 0 ? 0 : -1;
  state.scrollTop = 0;
  clampScroll(state);
}

function clampScroll(state: SaveMenuState): void {
  const maxTop = Math.max(0, rowCount(state) - SAVE_MENU_ROWS);
  if (state.scrollTop > maxTop) state.scrollTop = maxTop;
  if (state.scrollTop < 0) state.scrollTop = 0;
  if (state.selected >= 0) {
    if (state.selected < state.scrollTop) state.scrollTop = state.selected;
    else if (state.selected >= state.scrollTop + SAVE_MENU_ROWS) {
      state.scrollTop = state.selected - SAVE_MENU_ROWS + 1;
    }
  }
}

/* ------------------------------------------------------------------ drawing ---- */

/**
 * Draw a piece of graphic 0 into `box`, at the box's size. The piece's corners are kept,
 * `left` by `top` and so on; between them every row repeats the column just inside the
 * left corner, and every column the row just inside the top one. `Menu.cpp` makes its
 * layouts out of graphic 0 blitted over itself (`rect18576` to `rect18600`); this makes
 * a larger one out of the same art.
 */
export function drawPiece(ui: UIState, piece: DialogPiece, box: Rect): void {
  const graphic = ui.getGraphicBitmap(MENU_GRAPHIC);
  if (!graphic) return;
  const buf = ui.screenIndexBuffer;
  const width = box.x2 - box.x1 + 1;
  const height = box.y2 - box.y1 + 1;
  const pieceWidth = piece.x2 - piece.x1 + 1;
  const pieceHeight = piece.y2 - piece.y1 + 1;
  const along = (at: number, size: number, pieceSize: number, lead: number, trail: number): number =>
    at < lead ? at : at >= size - trail ? pieceSize - (size - at) : lead;
  for (let y = 0; y < height; y++) {
    const srcRow = (piece.y1 + along(y, height, pieceHeight, piece.top, piece.bottom)) * graphic.width;
    const dstRow = (box.y1 + y) * buf.width + box.x1;
    for (let x = 0; x < width; x++) {
      buf.pixels[dstRow + x] = graphic.pixels[srcRow + piece.x1 + along(x, width, pieceWidth, piece.left, piece.right)];
    }
  }
}

/** The dialog with nothing in it: the frame, the two panels and the four button frames. */
export function drawDialog(ui: UIState): void {
  drawPiece(ui, FRAME_PIECE, DIALOG);
  drawPiece(ui, PANEL_PIECE, LIST_PANEL);
  drawPiece(ui, PANEL_PIECE, PREVIEW_PANEL);
  for (const frame of Object.values(BUTTON_FRAMES)) drawPiece(ui, BUTTON_PIECE, frame);
}

function text(ui: UIState, s: string, x: number, y: number, color: number, background: number): void {
  drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, x, y, color, background, s);
}

/** A button's label, `CenteredText`'s way (`doc/CSBwin-src/Menu.cpp:192`). */
function drawLabel(ui: UIState, s: string, frame: Rect): void {
  const at = buttonLabelAt(frame);
  text(ui, s, at.x - 3 * s.length, at.y, MENU_OPTION_COLOR, MENU_PANEL_COLOR);
}

/** The rectangle of the list's row `row`, counted from the first one shown. */
function rowRect(row: number): Rect {
  const y = ROW_FIRST_Y + row * ROW_STEP;
  return { x1: LIST_INNER_X1, y1: y - 5, x2: LIST_INNER_X2, y2: y + 2 };
}

/**
 * The whole screen: the dialog, or the question in its place, on black. `_DoMenu` clears
 * the screen under a menu its caller asks it to (`ClearOldScreen`,
 * `doc/CSBwin-src/Menu.cpp:285-291`), as the entrance's chooser does; the disk menu's
 * does not, and this one is cleared there too, since the dialog leaves no part of the
 * game's picture whole.
 */
export function drawSaveMenu(ui: UIState): void {
  const state = ui.saveMenu;
  if (!state) return;
  clearIndex(ui.screenIndexBuffer, 0);

  if (state.confirm) {
    doMenu(ui, SAVE_MENU_QUESTION, null, [ACTION_LABELS[state.confirm], CANCEL_LABEL], true);
    if (state.press) drawMenuPress(ui, state.press, nowMs());
    return;
  }

  drawDialog(ui);

  // The rows.
  clampScroll(state);
  for (let row = 0; row < SAVE_MENU_ROWS; row++) {
    const index = state.scrollTop + row;
    if (index >= rowCount(state)) break;
    const entry = entryAt(state, index);
    const highlighted = index === state.selected;
    if (highlighted) fillRectIndex(ui.screenIndexBuffer, rowRect(row), MENU_OPTION_COLOR);
    text(
      ui,
      entry ? formatSaveRow(entry, TEXT_MAX_CHARS) : NEW_SAVE_LABEL,
      TEXT_X,
      ROW_FIRST_Y + row * ROW_STEP,
      highlighted ? MENU_PANEL_COLOR : MENU_OPTION_COLOR,
      highlighted ? MENU_OPTION_COLOR : MENU_PANEL_COLOR,
    );
  }

  // The status line: whatever went wrong, else the selected save's full roster.
  const status = state.busy
    ? 'WORKING . . .'
    : state.message || formatSaveDetail(selectedEntry(state), TEXT_MAX_CHARS);
  if (status) text(ui, status, TEXT_X, STATUS_Y, MENU_TITLE1_COLOR, MENU_PANEL_COLOR);
  if (rowCount(state) === 0 && !state.busy && !state.message) {
    // An empty list has to say so, which the load-only menu's can be; when the store
    // could not be listed, the status line says why, and repeating that here would only
    // crowd the panel.
    text(ui, 'NO SAVED GAMES HERE', TEXT_X, ROW_FIRST_Y, MENU_OPTION_COLOR, MENU_PANEL_COLOR);
  }

  // A button that can do nothing is left unlabelled, as CSBWin leaves an empty save
  // slot unlabelled.
  if (canLoad(state)) drawLabel(ui, ACTION_LABELS.load, BUTTON_FRAMES.load);
  if (canSave(state)) drawLabel(ui, ACTION_LABELS.save, BUTTON_FRAMES.save);
  if (!state.busy) drawLabel(ui, CANCEL_LABEL, BUTTON_FRAMES.cancel);

  if (state.press) drawMenuPress(ui, state.press, nowMs());
}

/* ------------------------------------------------------------------ hit test ---- */

/**
 * The dialog's own button list, in the form of CSBWin's (`x2` and `y2` exclusive): the
 * three buttons that have a label, and the rows shown. Built fresh on each click because
 * the rows follow the scroll position.
 */
export function saveMenuButtons(state: SaveMenuState): UIButton[] {
  const buttons: UIButton[] = [
    { word0: BTN_LOAD, ...buttonRect(BUTTON_FRAMES.load), button: 2, name: 'saveMenu.load' },
    { word0: BTN_SAVE, ...buttonRect(BUTTON_FRAMES.save), button: 2, name: 'saveMenu.save' },
    { word0: BTN_CANCEL, ...buttonRect(BUTTON_FRAMES.cancel), button: 2, name: 'saveMenu.cancel' },
  ];
  const visible = Math.min(SAVE_MENU_ROWS, Math.max(0, rowCount(state) - state.scrollTop));
  for (let row = 0; row < visible; row++) {
    const r = rowRect(row);
    buttons.push({ word0: BTN_ROW0 + row, x1: r.x1, x2: r.x2 + 1, y1: r.y1, y2: r.y2 + 1, button: 2, name: `saveMenu.row${row}` });
  }
  return buttons;
}

/**
 * One iteration of `_WaitForMenuSelect`'s loop body. Called **straight from the DOM
 * mousedown handler**, not from the game's mouse queue: that is the modality CSBWin gets
 * by swapping button lists.
 */
export function saveMenuClick(ui: UIState, x: number, y: number, buttons: number): void {
  const state = ui.saveMenu;
  if (!state) return;
  // Right-click cancels, the question when one is up. CSBWin has no such thing; see the
  // divergence list.
  if ((buttons & 1) !== 0) {
    if (state.confirm && !state.press) cancelQuestion(ui, state);
    else closeSaveMenu(ui);
    return;
  }
  if (state.busy || state.press) return;

  if (state.confirm) {
    answerQuestion(ui, state, state.confirm, menuHitTest(menuButtonList(ui, 2, true), x, y, buttons));
    return;
  }

  const id = searchButtonList(saveMenuButtons(state), x, y, buttons);
  if (id === 0) return;

  if (id === BTN_CANCEL) {
    // The screen is drawn again once the dialog is gone: the entrance's chooser waits on
    // that draw to know it has closed (`openLoadMenu`, `src/renderer/intro/BootSequence.ts`).
    beginPress(ui, state, saveMenuButtons(state), BTN_CANCEL, () => {
      closeSaveMenu(ui);
      ui.renderLastFrame();
    });
    return;
  }
  if (id >= BTN_ROW0 && id < BTN_ROW0 + SAVE_MENU_ROWS) {
    const index = state.scrollTop + (id - BTN_ROW0);
    if (index < rowCount(state)) {
      state.selected = index;
      state.message = '';
      ui.renderLastFrame();
    }
    return;
  }
  if (id === BTN_LOAD && canLoad(state)) pressAction(ui, state, 'load');
  if (id === BTN_SAVE && canSave(state)) pressAction(ui, state, 'save');
}

/** LOAD or SAVE pressed: once the press has played, the question, or the action at once. */
function pressAction(ui: UIState, state: SaveMenuState, action: SaveMenuAction): void {
  beginPress(ui, state, saveMenuButtons(state), action === 'load' ? BTN_LOAD : BTN_SAVE, () => {
    if (asksFirst(ui, state)) {
      state.confirm = action;
      ui.renderLastFrame();
    } else {
      void runPending(ui, action);
    }
  });
}

/**
 * A click on the question, `choice` being `_WaitForMenuSelect`'s: 1 is the action, 2 is
 * CANCEL, and 0 neither button. Either button flashes as any menu's does, with the
 * question still up; then the list is back, and the action runs from it.
 */
function answerQuestion(ui: UIState, state: SaveMenuState, action: SaveMenuAction, choice: number): void {
  if (choice !== 1 && choice !== 2) return;
  beginPress(ui, state, menuButtonList(ui, 2, true), 209 + choice, () => {
    state.confirm = null;
    if (choice === 1) void runPending(ui, action);
    else ui.renderLastFrame();
  });
}

/** Esc or a right-click on the question: CANCEL, without the press. */
function cancelQuestion(ui: UIState, state: SaveMenuState): void {
  state.confirm = null;
  ui.renderLastFrame();
}

/* ------------------------------------------------------ the press animation ---- */

function scheduleFrame(cb: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => cb());
  return setTimeout(cb, 16) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

/**
 * `_WaitForMenuSelect` flashes the chosen button for two five-VBL passes and only
 * *then* returns the choice (`doc/CSBwin-src/Menu.cpp:100-180`), so the action happens
 * after the animation here too. The game clock is stopped, so the frames come from
 * `requestAnimationFrame` rather than from the tick.
 */
function beginPress(ui: UIState, state: SaveMenuState, buttons: UIButton[], buttonId: number, then: () => void): void {
  const rect = menuButtonRect(buttons, buttonId);
  if (!rect) {
    then();
    return;
  }
  // The rectangle is passed exactly as the table holds it: `_WaitForMenuSelect` MemMoves
  // the button's four words straight into its own rect and grows them from there
  // (`doc/CSBwin-src/Menu.cpp:99-104`), exclusive `xMax`/`yMax` and all.
  state.press = { buttonId, rect, startedMs: nowMs() };
  state.pending = then;

  const tick = (): void => {
    const live = ui.saveMenu;
    if (!live || !live.press) return;
    if (menuPressFinished(live.press, nowMs())) {
      live.frameHandle = null;
      live.press = null;
      const pending = live.pending;
      live.pending = null;
      ui.renderLastFrame();
      if (pending) pending();
      return;
    }
    ui.renderLastFrame();
    live.frameHandle = scheduleFrame(tick);
  };
  state.frameHandle = scheduleFrame(tick);
  ui.renderLastFrame();
}

/** How long the press takes end to end, for anything that needs to wait it out. */
export const SAVE_MENU_PRESS_MS = MENU_PRESS_PHASE_MS * 2;

/* -------------------------------------------------------------- the actions ---- */

async function runPending(ui: UIState, action: SaveMenuAction): Promise<void> {
  const state = ui.saveMenu;
  if (!state) return;
  state.busy = true;
  state.message = '';
  ui.renderLastFrame();
  try {
    if (action === 'load') await doLoad(ui, state);
    else await doSave(ui, state);
  } catch (error) {
    state.busy = false;
    state.message = shortError(error);
    ui.renderLastFrame();
  }
}

async function doLoad(ui: UIState, state: SaveMenuState): Promise<void> {
  const entry = selectedEntry(state);
  if (!entry) {
    state.busy = false;
    return;
  }
  restoreChosenSave(ui, await ui.onReadSave(entry));
}

/**
 * Restore the save the player chose, and close the menu: after a load the world it was
 * listing is gone.
 *
 * A read that fails in the full menu throws, and its message goes on the status line
 * (`runPending`). The load-only chooser is `_ReadEntireGame`'s, where every failed read
 * ends at `tag01efee` instead (`doc/CSBwin-src/SaveGame.cpp:1741-1742`, `:1895`): it
 * closes, and `onRestoreFailed` hands the failure to its caller
 * (`src/renderer/intro/BootSequence.ts`).
 */
export function restoreChosenSave(ui: UIState, save: OpenedSave): void {
  const state = ui.saveMenu;
  if (!state) return;
  if (state.mode === 'full') {
    ui.onRestoreSave(save);
  } else {
    try {
      ui.onRestoreSave(save);
    } catch (error) {
      ui.onRestoreFailed(error);
    }
  }
  closeSaveMenu(ui);
  ui.renderLastFrame();
}

async function doSave(ui: UIState, state: SaveMenuState): Promise<void> {
  // The clock has been stopped since the menu opened, so the save's tail still runs on
  // the world the file holds, and before the menu's `tag0207cc`, as in CSBWin. The save
  // is written over the selected one, or is a new one from the "new save" row, and is
  // the selection afterwards.
  const saved = await ui.onSaveGame(selectedEntry(state));
  await refreshSaveMenu(ui);
  const at = state.entries.findIndex((e) => e.id === saved.id);
  if (at >= 0) state.selected = newSaveRows(state) + at;
  clampScroll(state);
  state.message = 'GAME SAVED';
  ui.renderLastFrame();
}

/* ------------------------------------------------------------------- keyboard ---- */

/**
 * CSBWin's menus take no key (`doc/PROVEN_FACTS.md` → "A one-button menu takes no key").
 * A list needs arrows, and Esc is the cancel every player will try; both are additions,
 * recorded as such.
 *
 * Returns whether the key was taken, so the host can stop it reaching the movement keys
 * exactly as it does for the Reincarnate screen.
 */
export function saveMenuKey(ui: UIState, key: string): boolean {
  const state = ui.saveMenu;
  if (!state) return false;
  if (state.busy || state.press) return true;
  // The question takes no key but its cancel.
  if (state.confirm) {
    if (key === 'Escape') cancelQuestion(ui, state);
    return true;
  }

  switch (key) {
    case 'Escape':
      closeSaveMenu(ui);
      return true;
    case 'ArrowUp':
      moveSelection(ui, state, -1);
      return true;
    case 'ArrowDown':
      moveSelection(ui, state, 1);
      return true;
    case 'PageUp':
      moveSelection(ui, state, -SAVE_MENU_ROWS);
      return true;
    case 'PageDown':
      moveSelection(ui, state, SAVE_MENU_ROWS);
      return true;
    case 'Home':
      moveSelection(ui, state, -rowCount(state));
      return true;
    case 'End':
      moveSelection(ui, state, rowCount(state));
      return true;
    case 'Enter':
      if (canLoad(state)) pressAction(ui, state, 'load');
      return true;
    default:
      return true;
  }
}

function moveSelection(ui: UIState, state: SaveMenuState, delta: number): void {
  if (rowCount(state) === 0) return;
  const next = Math.max(0, Math.min(rowCount(state) - 1, (state.selected < 0 ? 0 : state.selected) + delta));
  state.selected = next;
  state.message = '';
  clampScroll(state);
  ui.renderLastFrame();
}

/** The wheel scrolls the list without moving the selection. */
export function saveMenuWheel(ui: UIState, delta: number): boolean {
  const state = ui.saveMenu;
  if (!state) return false;
  if (state.confirm) return true;
  const maxTop = Math.max(0, rowCount(state) - SAVE_MENU_ROWS);
  state.scrollTop = Math.max(0, Math.min(maxTop, state.scrollTop + (delta > 0 ? 1 : -1)));
  ui.renderLastFrame();
  return true;
}
