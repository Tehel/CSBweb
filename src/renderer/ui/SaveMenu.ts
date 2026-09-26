/**
 * The save/load screen behind the inventory's disk icon.
 *
 * This is **not** a port of `_DisplayDiskMenu`. It keeps `_DoMenu`'s bitmap, colours,
 * text metrics and press animation — all of that is `Menu.ts` — and replaces CSBWin's
 * four-slot chooser, which is a `char fNames[4][20]` on the stack shown as a four-button
 * menu (`doc/CSBwin-src/CSBCode.cpp:9744-9816`). Every divergence is listed in
 * `doc/CSBWIN_MENU_REFERENCE.md` → "Deliberate divergences in this port". In short: an
 * unbounded scrolling list, a browser/file source toggle, a date and roster per row
 * instead of a filename and a recency letter, no "save and quit", and Esc/right-click to
 * cancel.
 *
 * ## The list panel
 *
 * Graphic 0 carries a title panel (viewport y 10..51) above a full-width button frame
 * (y 62..89) and a split pair below it (y 100..125). A list needs one tall clean area,
 * so the panel's own interior band is tiled downward over the full-width frame and its
 * bottom border copied to the new bottom edge — the same self-blit technique the 1-, 2-
 * and 4-option layouts use, so no art is invented. That leaves the bottom pair for LOAD
 * and SAVE, hit-tested and animated through CSBWin's own rectangles (ids 212 and 213 of
 * the four-option set).
 *
 * An unavailable LOAD is drawn with **no label at all**, which is what CSBWin does to an
 * empty save slot: `strcpy(fNames[i],"   ")` blanks the name and the button sits there
 * inert (`doc/CSBwin-src/CSBCode.cpp:9772`).
 *
 * ## Modality and the clock
 *
 * `_WaitForMenuSelect` nulls `SecondaryButtonList` and both `pKeyXlate`s and replaces
 * `PrimaryButtonList`, so nothing outside the menu can be clicked, and it never returns
 * to the main loop, so `d.Time` stops. Here the click comes **straight from the DOM
 * event** rather than through the game's mouse queue — which is the same exclusivity,
 * and is also what keeps the browser's transient user activation alive for
 * `showDirectoryPicker`. The clock is stopped explicitly with `onSetPaused`.
 */
import type { SaveEntry, SaveEntryMeta, SaveStore, SaveStoreKind } from '../../data/saves';
import {
  FileSaveStore,
  formatSaveDetail,
  formatSaveRow,
  getSaveSource,
  saveStore,
  setSaveSource,
} from '../../data/saves';
import { fillRectIndex } from '../csbwin/CanvasBlitter';
import { drawTextLineIndex } from '../csbwin/TextRenderer';
import type { UIButton } from '../csbwin/UITables';
import { VIEWPORT_X, VIEWPORT_Y } from '../ViewportGraphics';
import { searchButtonList } from './HitTest';
import {
  MENU_OPTION_COLOR,
  MENU_PANEL_COLOR,
  MENU_PRESS_PHASE_MS,
  MENU_TITLE1_COLOR,
  centeredText,
  copyMenuRegion,
  drawMenuBitmap,
  drawMenuPress,
  menuButtonList,
  menuButtonRect,
  menuPressFinished,
  type MenuPress,
} from './Menu';
import { tag02076e, tag0207cc } from './Mouse';
import { nowMs, type UIState } from './UIState';

/* ------------------------------------------------------------------ geometry ---- */

/** All in graphic 0's own coordinates; `+VIEWPORT_X/Y` puts them on screen. */
const PANEL_BAND_Y = 44;
const PANEL_BAND_H = 7;
const PANEL_BOTTOM_BORDER_SRC_Y = 51;
const PANEL_EXTENDED_BOTTOM_Y = 95;
const PANEL_INNER_X1 = 12;
const PANEL_INNER_X2 = 212;

const TEXT_X = 14;
const TEXT_MAX_CHARS = 33;
const HEADER_Y = 17;
const ROW_FIRST_Y = 25;
const ROW_STEP = 8;
export const SAVE_MENU_ROWS = 8;
const STATUS_Y = 89;

/** The option-label positions of the four-option layout's bottom row (`Menu.cpp:339`). */
const LOAD_LABEL_X = 59;
const SAVE_LABEL_X = 166;
const BOTTOM_LABEL_Y = 114;

/** Ids for the parts of the screen CSBWin has no button for. 210..213 stay CSBWin's. */
const BTN_LOAD = 212;
const BTN_SAVE = 213;
const BTN_BROWSER = 900;
const BTN_FILE = 901;
const BTN_CANCEL = 902;
const BTN_ROW0 = 910;

/**
 * Everything the layout depends on, in one place, so `tools/dump-save-menu.ts` can
 * check it against the art instead of against a copy of these numbers.
 */
export const SAVE_MENU_GEOMETRY = {
  panelBandY: PANEL_BAND_Y,
  panelBandHeight: PANEL_BAND_H,
  panelBottomBorderSrcY: PANEL_BOTTOM_BORDER_SRC_Y,
  panelExtendedBottomY: PANEL_EXTENDED_BOTTOM_Y,
  panelInnerX1: PANEL_INNER_X1,
  panelInnerX2: PANEL_INNER_X2,
  textX: TEXT_X,
  textMaxChars: TEXT_MAX_CHARS,
  headerY: HEADER_Y,
  rowFirstY: ROW_FIRST_Y,
  rowStep: ROW_STEP,
  rows: SAVE_MENU_ROWS,
  statusY: STATUS_Y,
  loadLabelX: LOAD_LABEL_X,
  saveLabelX: SAVE_LABEL_X,
  bottomLabelY: BOTTOM_LABEL_Y,
  loadButtonId: BTN_LOAD,
  saveButtonId: BTN_SAVE,
} as const;

/* --------------------------------------------------------------------- state ---- */

export type SaveMenuMode = 'full' | 'loadOnly';

export interface SaveMenuState {
  mode: SaveMenuMode;
  source: SaveStoreKind;
  entries: SaveEntry[];
  /** Index into `entries`, or -1. LOAD is inert while it is -1. */
  selected: number;
  scrollTop: number;
  /** An async list/read/write is in flight; every button is inert. */
  busy: boolean;
  /** The status line: an error, a prompt, or where the current store points. */
  message: string;
  press: MenuPress | null;
  /** What the press animation will do when it finishes. */
  pending: 'load' | 'save' | null;
  frameHandle: number | null;
}

function currentStore(state: SaveMenuState): SaveStore {
  return saveStore(state.source);
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
  ui.onSetPaused?.(true);
  ui.saveMenu = {
    mode,
    // Whichever source was last chosen, here or by a quick-save.
    source: getSaveSource(),
    entries: [],
    selected: -1,
    scrollTop: 0,
    busy: true,
    message: '',
    press: null,
    pending: null,
    frameHandle: null,
  };
  void refreshSaveMenu(ui);
}

export function closeSaveMenu(ui: UIState): void {
  if (!ui.saveMenu) return;
  const { mode } = ui.saveMenu;
  if (ui.saveMenu.frameHandle !== null) cancelFrame(ui.saveMenu.frameHandle);
  ui.saveMenu = null;
  ui.onSetPaused?.(false);
  if (mode === 'full') tag0207cc(ui);
}

/* ------------------------------------------------------------------ the list ---- */

/** Re-read the current store. Never throws — the failure becomes the status line. */
export async function refreshSaveMenu(ui: UIState): Promise<void> {
  const state = ui.saveMenu;
  if (!state) return;
  const store = currentStore(state);
  state.busy = true;
  state.message = '';
  ui.renderLastFrame();
  try {
    if (!store.isSupported()) {
      state.entries = [];
      state.selected = -1;
      state.message = store.describe();
      return;
    }
    if (!store.isReady()) {
      // The file store can often come back without a prompt, from the handle it
      // remembered; if it cannot, the player has to click, and the status line says so.
      const restored = store instanceof FileSaveStore ? await store.restore() : await store.connect();
      if (!restored) {
        state.entries = [];
        state.selected = -1;
        state.message = store.describe();
        return;
      }
    }
    state.entries = await store.list();
    state.selected = state.entries.length > 0 ? 0 : -1;
    state.scrollTop = 0;
    state.message = store.describe();
  } catch (error) {
    state.entries = [];
    state.selected = -1;
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

function selectedEntry(state: SaveMenuState): SaveEntry | null {
  if (state.selected < 0 || state.selected >= state.entries.length) return null;
  return state.entries[state.selected];
}

function canLoad(state: SaveMenuState): boolean {
  const entry = selectedEntry(state);
  return !state.busy && entry !== null && entry.loadable;
}

function canSave(state: SaveMenuState): boolean {
  return !state.busy && state.mode === 'full' && currentStore(state).isReady();
}

function clampScroll(state: SaveMenuState): void {
  const maxTop = Math.max(0, state.entries.length - SAVE_MENU_ROWS);
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
 * Tile the title panel's interior band down over the full-width button frame, then put
 * its bottom border back at the new edge. `Menu.cpp` patches its own layouts exactly
 * this way (`rect18576`/`rect18592`/`rect18600`); this is one more patch in the same
 * idiom, and it is the only reason the list has room.
 */
export function extendListPanel(ui: UIState): void {
  const ox = VIEWPORT_X;
  const oy = VIEWPORT_Y;
  for (let y = PANEL_BAND_Y + PANEL_BAND_H; y < PANEL_EXTENDED_BOTTOM_Y; y += PANEL_BAND_H) {
    const height = Math.min(PANEL_BAND_H, PANEL_EXTENDED_BOTTOM_Y - y);
    copyMenuRegion(ui, ox, oy + PANEL_BAND_Y, 224, height, ox, oy + y);
  }
  copyMenuRegion(ui, ox, oy + PANEL_BOTTOM_BORDER_SRC_Y, 224, 1, ox, oy + PANEL_EXTENDED_BOTTOM_Y);
}

function text(ui: UIState, s: string, x: number, y: number, color: number, background: number): void {
  if (!ui.screenIndexBuffer || !ui.fontData) return;
  drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, x + VIEWPORT_X, y + VIEWPORT_Y, color, background, s);
}

/** One half of the source toggle: inverted while it is the live one. */
function drawSourceLabel(ui: UIState, label: string, x: number, active: boolean): void {
  if (!ui.screenIndexBuffer) return;
  if (active) {
    const rect = labelRect(x, HEADER_Y, label.length);
    fillRectIndex(ui.screenIndexBuffer, rect, MENU_OPTION_COLOR);
    text(ui, label, x, HEADER_Y, MENU_PANEL_COLOR, MENU_OPTION_COLOR);
    return;
  }
  text(ui, label, x, HEADER_Y, MENU_OPTION_COLOR, MENU_PANEL_COLOR);
}

/** The clickable rectangle of a text label, in screen coordinates. */
function labelRect(x: number, y: number, chars: number): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: x + VIEWPORT_X,
    y1: y + VIEWPORT_Y - 5,
    x2: x + VIEWPORT_X + chars * 6 - 1,
    y2: y + VIEWPORT_Y + 2,
  };
}

export function drawSaveMenu(ui: UIState): void {
  const state = ui.saveMenu;
  if (!state || !ui.screenIndexBuffer) return;

  drawMenuBitmap(ui, false);
  extendListPanel(ui);

  // Header: the source toggle on the left, CANCEL on the right. The chosen source is
  // inverted rather than merely recoloured — colours 9 and 11 are close enough in this
  // palette that a player could not tell which one was live.
  drawSourceLabel(ui, 'BROWSER', TEXT_X, state.source === 'browser');
  drawSourceLabel(ui, 'FILE', TEXT_X + 8 * 6, state.source === 'file');
  const cancelX = PANEL_INNER_X2 - 6 * 6;
  text(ui, 'CANCEL', cancelX, HEADER_Y, MENU_OPTION_COLOR, MENU_PANEL_COLOR);

  // The rows.
  clampScroll(state);
  for (let row = 0; row < SAVE_MENU_ROWS; row++) {
    const index = state.scrollTop + row;
    if (index >= state.entries.length) break;
    const entry = state.entries[index];
    const y = ROW_FIRST_Y + row * ROW_STEP;
    const highlighted = index === state.selected;
    if (highlighted) {
      fillRectIndex(ui.screenIndexBuffer, {
        x1: PANEL_INNER_X1 + VIEWPORT_X,
        y1: y + VIEWPORT_Y - 5,
        x2: PANEL_INNER_X2 + VIEWPORT_X,
        y2: y + VIEWPORT_Y + 2,
      }, MENU_OPTION_COLOR);
    }
    text(
      ui,
      formatSaveRow(entry, TEXT_MAX_CHARS),
      TEXT_X,
      y,
      highlighted ? MENU_PANEL_COLOR : MENU_OPTION_COLOR,
      highlighted ? MENU_OPTION_COLOR : MENU_PANEL_COLOR,
    );
  }

  // The status line: whatever went wrong, else the selected save's full roster.
  const status = state.busy
    ? 'WORKING . . .'
    : state.message || formatSaveDetail(selectedEntry(state), TEXT_MAX_CHARS);
  if (status) text(ui, status, TEXT_X, STATUS_Y, MENU_TITLE1_COLOR, MENU_PANEL_COLOR);
  if (state.entries.length === 0 && !state.busy) {
    // An empty list has to say so; the status line underneath says *why* when the store
    // is not usable, and repeating that here would only crowd the panel.
    const store = currentStore(state);
    const hint = store.isReady()
      ? 'NO SAVED GAMES HERE'
      : store.isSupported()
        ? 'CLICK FILE TO CHOOSE A FOLDER'
        : '';
    if (hint) text(ui, hint, TEXT_X, ROW_FIRST_Y, MENU_OPTION_COLOR, MENU_PANEL_COLOR);
  }

  // The two real buttons. An unavailable one is left unlabelled, as CSBWin leaves an
  // empty save slot unlabelled.
  if (canLoad(state)) centeredText(ui, 'LOAD', LOAD_LABEL_X, BOTTOM_LABEL_Y, false);
  if (canSave(state)) centeredText(ui, 'SAVE', SAVE_LABEL_X, BOTTOM_LABEL_Y, false);

  if (state.press) drawMenuPress(ui, state.press, nowMs());
}

/* ------------------------------------------------------------------ hit test ---- */

/**
 * The menu's own button list — CSBWin's rectangles for LOAD and SAVE, ours for
 * everything it has no equivalent of. Built fresh on each click because the row
 * rectangles follow the scroll position.
 */
function saveMenuButtons(ui: UIState, state: SaveMenuState): UIButton[] {
  const csbwin = menuButtonList(ui, 4, false);
  const buttons: UIButton[] = [];
  const push = (word0: number, r: { x1: number; y1: number; x2: number; y2: number }, name: string): void => {
    buttons.push({ word0, x1: r.x1, x2: r.x2 + 1, y1: r.y1, y2: r.y2 + 1, button: 2, name });
  };

  push(BTN_BROWSER, labelRect(TEXT_X, HEADER_Y, 7), 'saveMenu.browser');
  push(BTN_FILE, labelRect(TEXT_X + 8 * 6, HEADER_Y, 4), 'saveMenu.file');
  push(BTN_CANCEL, labelRect(PANEL_INNER_X2 - 6 * 6, HEADER_Y, 6), 'saveMenu.cancel');

  const visible = Math.min(SAVE_MENU_ROWS, Math.max(0, state.entries.length - state.scrollTop));
  for (let row = 0; row < visible; row++) {
    const y = ROW_FIRST_Y + row * ROW_STEP;
    push(
      BTN_ROW0 + row,
      {
        x1: PANEL_INNER_X1 + VIEWPORT_X,
        y1: y + VIEWPORT_Y - 5,
        x2: PANEL_INNER_X2 + VIEWPORT_X,
        y2: y + VIEWPORT_Y + 2,
      },
      `saveMenu.row${row}`,
    );
  }

  // CSBWin's own two, straight out of `graphics.dat` — `x2`/`y2` are already exclusive
  // there, so they are pushed unmodified rather than through `push`.
  for (const entry of csbwin) {
    if (entry.word0 === BTN_LOAD || entry.word0 === BTN_SAVE) buttons.push(entry);
  }
  return buttons;
}

/**
 * One iteration of `_WaitForMenuSelect`'s loop body. Called **straight from the DOM
 * mousedown handler**, not from the game's mouse queue: that is both the modality
 * CSBWin gets by swapping button lists, and the only way the folder picker still has
 * the transient user activation it requires.
 */
export function saveMenuClick(ui: UIState, x: number, y: number, buttons: number): void {
  const state = ui.saveMenu;
  if (!state) return;
  // Right-click cancels. CSBWin has no such thing; see the divergence list.
  if ((buttons & 1) !== 0) {
    closeSaveMenu(ui);
    return;
  }
  if (state.busy || state.press) return;

  const id = searchButtonList(saveMenuButtons(ui, state), x, y, buttons);
  if (id === 0) return;

  if (id === BTN_CANCEL) {
    closeSaveMenu(ui);
    return;
  }
  if (id === BTN_BROWSER || id === BTN_FILE) {
    const source: SaveStoreKind = id === BTN_FILE ? 'file' : 'browser';
    if (state.source !== source) {
      state.source = source;
      setSaveSource(source);
      state.entries = [];
      state.selected = -1;
      state.scrollTop = 0;
    }
    // The click that chose FILE is the user gesture the picker needs, so ask for the
    // folder now if the store is not already usable. `connect()` is the only call in
    // this module that may raise a browser dialog.
    const store = currentStore(state);
    if (source === 'file' && store.isSupported() && !store.isReady()) {
      state.busy = true;
      void store.connect().then(() => refreshSaveMenu(ui));
      ui.renderLastFrame();
      return;
    }
    void refreshSaveMenu(ui);
    return;
  }
  if (id >= BTN_ROW0 && id < BTN_ROW0 + SAVE_MENU_ROWS) {
    const index = state.scrollTop + (id - BTN_ROW0);
    if (index < state.entries.length) {
      state.selected = index;
      state.message = '';
      ui.renderLastFrame();
    }
    return;
  }
  if (id === BTN_LOAD && canLoad(state)) beginPress(ui, state, BTN_LOAD, 'load');
  if (id === BTN_SAVE && canSave(state)) beginPress(ui, state, BTN_SAVE, 'save');
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
function beginPress(ui: UIState, state: SaveMenuState, buttonId: number, action: 'load' | 'save'): void {
  const rect = menuButtonRect(menuButtonList(ui, 4, false), buttonId);
  if (!rect) {
    void runPending(ui, action);
    return;
  }
  // The rectangle is passed exactly as the table holds it: `_WaitForMenuSelect` MemMoves
  // the button's four words straight into its own rect and grows them from there
  // (`doc/CSBwin-src/Menu.cpp:99-104`), exclusive `xMax`/`yMax` and all.
  state.press = { buttonId, rect, startedMs: nowMs() };
  state.pending = action;

  const tick = (): void => {
    const live = ui.saveMenu;
    if (!live || !live.press) return;
    if (menuPressFinished(live.press, nowMs())) {
      live.frameHandle = null;
      live.press = null;
      const pending = live.pending;
      live.pending = null;
      ui.renderLastFrame();
      if (pending) void runPending(ui, pending);
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

async function runPending(ui: UIState, action: 'load' | 'save'): Promise<void> {
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
  if (!entry || !entry.loadable) {
    state.busy = false;
    return;
  }
  const bytes = await currentStore(state).read(entry.id);
  ui.onRestoreSave?.(bytes);
  // The menu closes on a successful load: the world it was listing is gone.
  closeSaveMenu(ui);
  ui.renderLastFrame();
}

async function doSave(ui: UIState, state: SaveMenuState): Promise<void> {
  const built = ui.onCreateSave?.();
  if (!built) throw new Error('NOTHING TO SAVE');
  const taken = new Set(state.entries.map((e) => e.name));
  const meta: SaveEntryMeta = { ...built.meta, name: uniqueName(built.meta.name, taken) };
  await currentStore(state).write(meta, built.bytes);
  await refreshSaveMenu(ui);
  const at = state.entries.findIndex((e) => e.name === meta.name);
  if (at >= 0) state.selected = at;
  state.message = 'GAME SAVED';
  ui.renderLastFrame();
}

/** The store may already hold a save made in the same second. */
function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.indexOf('.');
  const stem = dot < 0 ? name : name.slice(0, dot);
  const ext = dot < 0 ? '' : name.slice(dot);
  let n = 2;
  while (taken.has(`${stem}-${n}${ext}`)) n++;
  return `${stem}-${n}${ext}`;
}

/* ------------------------------------------------------------------- keyboard ---- */

/**
 * CSBWin's menus take one key, Return, and only on a one-button menu
 * (`doc/CSBwin-src/Menu.cpp:82-93`). A list needs arrows, and Esc is the cancel every
 * player will try; both are additions, recorded as such.
 *
 * Returns whether the key was taken, so the host can stop it reaching the movement keys
 * exactly as it does for the Reincarnate screen.
 */
export function saveMenuKey(ui: UIState, key: string): boolean {
  const state = ui.saveMenu;
  if (!state) return false;
  if (state.busy || state.press) return true;

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
      moveSelection(ui, state, -state.entries.length);
      return true;
    case 'End':
      moveSelection(ui, state, state.entries.length);
      return true;
    case 'Enter':
      if (canLoad(state)) beginPress(ui, state, BTN_LOAD, 'load');
      return true;
    default:
      return true;
  }
}

function moveSelection(ui: UIState, state: SaveMenuState, delta: number): void {
  if (state.entries.length === 0) return;
  const next = Math.max(0, Math.min(state.entries.length - 1, (state.selected < 0 ? 0 : state.selected) + delta));
  state.selected = next;
  state.message = '';
  clampScroll(state);
  ui.renderLastFrame();
}

/** The wheel scrolls the list without moving the selection. */
export function saveMenuWheel(ui: UIState, delta: number): boolean {
  const state = ui.saveMenu;
  if (!state) return false;
  const maxTop = Math.max(0, state.entries.length - SAVE_MENU_ROWS);
  state.scrollTop = Math.max(0, Math.min(maxTop, state.scrollTop + (delta > 0 ? 1 : -1)));
  ui.renderLastFrame();
  return true;
}
