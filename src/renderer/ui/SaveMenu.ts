/**
 * The save/load screen behind the inventory's disk icon.
 *
 * This is **not** a port of `_DisplayDiskMenu`. It keeps `_DoMenu`'s art, colours, text
 * metrics and press animation, and replaces CSBWin's four-slot chooser, which is a
 * `char fNames[4][20]` on the stack shown as a four-button menu
 * (`doc/CSBwin-src/CSBCode.cpp:9868-9940`). Every divergence is listed in
 * `doc/CSBWIN_MENU_REFERENCE.md` → "Deliberate divergences in this port". In short: a
 * dialog of its own over the screen, an unbounded scrolling list of the data set's saves
 * under their playthroughs' headings, a date per save and a roster per playthrough
 * instead of a filename and a recency letter, a preview of the save beside the list, an
 * export of a save's file and an import of one, no "save and quit", and Esc/right-click
 * to cancel.
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
 * frames: LOAD, SAVE and EXPORT under the list, CANCEL under the preview. The list's is
 * 32 characters and its scrollbar wide, and the preview's ten characters.
 *
 * A label sits in its frame where `_DoMenu` puts one, and a click and the press
 * animation take the rectangle CSBWin's table gives a frame (`buttonRect`,
 * `buttonLabelAt`). A button that can do nothing is drawn with **no label at all**, which
 * is what CSBWin does to an empty save slot: `strcpy(fNames[i],"   ")` blanks the name
 * and the button sits there inert (`doc/CSBwin-src/CSBCode.cpp:9896`).
 *
 * ## The list
 *
 * Two levels (`layoutRows`): a heading for each playthrough of the data set
 * (`playthroughsOf`), the last one used first, and under it its saves, newest first,
 * when it is unfolded. A click on a heading selects it, and folds or unfolds it; the
 * right and left arrows do the same to the heading selected.
 *
 * Either menu opens on the last save used, written or loaded (`lastUsedSave`): SAVE at
 * once writes over the save the game came from, and LOAD goes back to it. Its
 * playthrough, the first, is the one unfolded; the others are folded.
 *
 * SAVE writes over the selected save, as CSBWin's writes over the slot chosen
 * (`_SelectSaveGame`, `:9862`). A save of its own is made from the heading of the
 * running game's playthrough. A game with no save yet has no heading: the full menu then
 * has a first row, "NEW SAVE", for it, and opens on it when the data set has no save at
 * all. On another playthrough's heading SAVE is inert: a file holds the running game's
 * `d.RandomGameID`, so a new save is never another playthrough's.
 *
 * While a DSA has disabled saves (`DsaSystem.disableSaves`), SAVE is inert everywhere and
 * there is no "NEW SAVE", and the dialog's message is what CSBWin's disk menu says in its
 * place, "SAVES ARE DISABLED" (`savesDisabled`). LOAD and EXPORT are as ever.
 *
 * LOAD reads the selected save, and from a heading the last save used of its playthrough.
 * On "NEW SAVE" there is nothing to load, so it is inert. A second click on a save
 * within half a second of the first is LOAD too, its button's press and its question
 * included; a heading has no such shortcut, since a click folds it.
 *
 * The panel shows fifteen rows, which fill it, beside a scrollbar in the manner of a GEM
 * window's, in the dialog's two colours (`drawScrollbar`): a boxed arrow at each end, and
 * between them a slider, plain, for the rows shown, in a track that is dithered where
 * rows lie beyond them. A click on an arrow scrolls the list by a row, as a notch of the
 * wheel does; the slider and the track take no click. Scrolling does not move the
 * selection, which may leave the panel; a move of the selection brings the list back to
 * it (`showSelection`).
 *
 * ## The preview
 *
 * The panel beside the list shows the save LOAD would read (`loadTarget`): the selected
 * save, or from a heading the last save used of its playthrough, and nothing on "NEW
 * SAVE". Its lines are the list's rows, ten characters each (`formatSavePreview`): the
 * champions' names, the level, the play time, and the day and the time it was saved. The
 * panel's last lines are the dialog's message, when it has one: what went wrong, what was
 * done, or that it is working, wrapped at the panel's width (`wrapMessage`) and drawn
 * over whatever lines of the preview it needs.
 *
 * ## EXPORT
 *
 * EXPORT hands the player the selected save's file, the bare `.dat` the store holds,
 * which CSBWin opens (`UIState.onExportSave`: the page downloads it under the row's
 * name). On a heading and on "NEW SAVE" no save is selected, and it is inert. It reads
 * the store and nothing else: the game is left alone, so it never asks, whatever the
 * save's playthrough, and the save is no more the last one used for it. The load-only
 * chooser has it as the disk menu does.
 *
 * ## The import
 *
 * A file dropped on the page while the dialog is up is taken into the store
 * (`saveMenuDrop`, through `UIState.onImportSave` to `GameSaves.importSave`), in the disk
 * menu and in the load-only chooser alike. A save of the data set's dungeon is listed at
 * once, selected, and the dialog says "SAVE IMPORTED"; nothing is loaded. One that is
 * most of that dungeon and not the whole is asked about first, in `_DoMenu`'s two-option
 * menu in the dialog's place: "THIS LOOKS LIKE A SAVE FROM A MODIFIED VERSION OF" over
 * the dungeon's name, with CONFIRM and CANCEL (`importMenu`). A save of another dungeon,
 * or of none the port knows, is refused in `_DoMenu`'s one-option menu, under OK, with
 * the dungeon named and whether a data set plays it. A file that does not read is the
 * dialog's message, CSBWin's "SAVED GAME DAMAGED!". CSBWin has no import: a file put in
 * the game's directory under one of its four names is a save of that game.
 *
 * ## The question
 *
 * LOAD and SAVE ask first when the save one would read, or the other write over, is of
 * another playthrough than the running game's (`asksFirst`): the one would leave the game being played for another,
 * the other would write this game over a save of another. The question is `_DoMenu`'s
 * two-option menu, centred, in the dialog's place, under CSBWin's own line for a save of
 * another `d.RandomGameID`, "THAT'S NOT THE SAME GAME"
 * (`doc/CSBwin-src/SaveGame.cpp:1730-1731`, where it refuses the save outright), with the
 * action and CANCEL. The load-only chooser has no game to leave and never asks.
 *
 * ## The prison's question
 *
 * CSB's prison has no way out: the party chosen there is saved, and carried into the
 * adventure by the utility. So in the prison (`UIState.isPrison`) the disk menu's SAVE,
 * F5 and the fourth champion joining ask "BEGIN THE ADVENTURE?", YES and NOT YET, in
 * `_DoMenu`'s two-option menu in the dialog's place (`askBeginAdventure`). YES makes the
 * new adventure from the save just written, or, after the fourth champion, from a
 * quick-save it writes first, and reads it, as the entrance's RISE does
 * (`UIState.onMakeNewAdventure`); a refusal is the dialog's message. NOT YET goes back to
 * the list, or closes the dialog when it was raised for the question alone.
 *
 * ## Modality and the clock
 *
 * `_WaitForMenuSelect` nulls `SecondaryButtonList` and both `pKeyXlate`s and replaces
 * `PrimaryButtonList`, so nothing outside the menu can be clicked, and it never returns
 * to the main loop, so `d.Time` stops. Here the click comes **straight from the DOM
 * event** rather than through the game's mouse queue, which is the same exclusivity.
 * This port's loop keeps running, so the clock is stopped explicitly, with
 * `ctx.state.paused` (`d.Time++` is the main loop's, `doc/CSBwin-src/CSBCode.cpp:670`).
 */
import type { OpenedSave, Playthrough, SaveEntry } from '../../data/saves';
import { SAVES_ARE_DISABLED, type ImportResult, type ImportedFile } from '../../engine/GameSaves';
import { formatPlaythroughRow, formatSavePreview, formatSaveRow, lastUsedSave, playthroughsOf } from '../../data/saves';
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
/** For the 32 characters of a row and the scrollbar beside them. */
const LIST_PANEL: Rect = { x1: 18, y1: 18, x2: 227, y2: 144 };
/** For the ten characters of a line of the preview. */
const PREVIEW_PANEL: Rect = { x1: 237, y1: 18, x2: 301, y2: 144 };
const BUTTON_Y1 = 155;
const BUTTON_Y2 = 181;
const BUTTON_FRAMES = {
  load: { x1: 18, y1: BUTTON_Y1, x2: 81, y2: BUTTON_Y2 },
  save: { x1: 91, y1: BUTTON_Y1, x2: 154, y2: BUTTON_Y2 },
  export: { x1: 164, y1: BUTTON_Y1, x2: 227, y2: BUTTON_Y2 },
  cancel: { x1: 237, y1: BUTTON_Y1, x2: 301, y2: BUTTON_Y2 },
} as const;

/**
 * The scrollbar: eleven columns against the list panel's right edge, from the top of its
 * clean interior, past its two rows of edge, to the bottom, short of its one.
 */
const SCROLLBAR: Rect = { x1: LIST_PANEL.x2 - 11, y1: LIST_PANEL.y1 + 2, x2: LIST_PANEL.x2 - 1, y2: LIST_PANEL.y2 - 1 };
/** An arrow's box is as tall as the bar is wide, its outline included. */
const ARROW_BOX = SCROLLBAR.x2 - SCROLLBAR.x1 + 1;
/**
 * The up arrow, hollow and on a stem as a GEM window's is, in the nine columns and rows
 * inside its box; the down arrow is the same rows from the last to the first.
 */
const ARROW_UP = [
  '.........',
  '....#....',
  '...#.#...',
  '..#...#..',
  '.###.###.',
  '...#.#...',
  '...#.#...',
  '...###...',
  '.........',
];
/** The least a slider is tall, its two outlines included. */
const SLIDER_MIN = 7;

/** The rows' clean interior: past the panel's two columns of edge, as far as the scrollbar. */
const LIST_INNER_X1 = LIST_PANEL.x1 + 2;
const LIST_INNER_X2 = SCROLLBAR.x1 - 1;

const TEXT_X = LIST_PANEL.x1 + 4;
const TEXT_MAX_CHARS = 32;
const ROW_FIRST_Y = LIST_PANEL.y1 + 9;
const ROW_STEP = 8;
/** The rows fill the panel: two pixels of it above the first, and two below the last. */
export const SAVE_MENU_ROWS = 15;

/** The preview's lines are on the list's rows: ten characters between its panel's edges. */
const PREVIEW_TEXT_X = PREVIEW_PANEL.x1 + 4;
const PREVIEW_MAX_CHARS = 10;
/** The most lines a message takes at the foot of the preview's panel. */
const MESSAGE_MAX_LINES = 5;
const WORKING_MESSAGE = 'WORKING...';

/** How long after a click on a save a second one on it is LOAD, in milliseconds. */
export const SAVE_MENU_DOUBLE_CLICK_MS = 500;

/** The full menu's first row, for a game with no save yet: SAVE there makes its first. */
const NEW_SAVE_LABEL = 'NEW SAVE';

/** The question's title, and its two options: the action asked about, then this. */
export const SAVE_MENU_QUESTION = 'THAT\'S NOT THE SAME GAME';
const CANCEL_LABEL = 'CANCEL';
const ACTION_LABELS = { load: 'LOAD', save: 'SAVE' } as const;
const EXPORT_LABEL = 'EXPORT';
/** The dialog's message once a save's file has been handed to the player. */
export const SAVE_MENU_EXPORTED = 'SAVE EXPORTED';
/** The dialog's message once a dropped file is a save of the store. */
export const SAVE_MENU_IMPORTED = 'SAVE IMPORTED';

/** The question about a dropped save of a modified dungeon, over the dungeon's name. */
export const SAVE_MENU_MODIFIED = 'THIS LOOKS LIKE A SAVE FROM A MODIFIED VERSION OF';
const CONFIRM_LABEL = 'CONFIRM';
const OK_LABEL = 'OK';

/** A dropped file that was not stored: what its dungeon is to the data set's. */
export type ImportRefusal = Exclude<ImportResult, { kind: 'stored' }>;

/**
 * The menu about a dropped file that was not stored, `_DoMenu`'s: the question for a
 * save of a modified version of the data set's dungeon, whose first option stores it, or
 * the refusal of another dungeon's save, which names the dungeon and says whether a data
 * set plays it, and of an unknown one's, under one option.
 */
export function importMenu(refusal: ImportRefusal): { title1: string; title2: string | null; options: string[] } {
  switch (refusal.kind) {
    case 'modified':
      return { title1: SAVE_MENU_MODIFIED, title2: refusal.dungeon.name.toUpperCase(), options: [CONFIRM_LABEL, CANCEL_LABEL] };
    case 'other':
      return {
        title1: `THIS LOOKS LIKE A SAVE OF ${refusal.dungeon.name.toUpperCase()}`,
        title2: refusal.dungeon.dataSets.length > 0 ? 'SWITCH TO IT TO IMPORT IT' : 'NOT SUPPORTED YET',
        options: [OK_LABEL],
      };
    case 'unknown':
      return { title1: 'THIS IS A SAVE OF AN UNKNOWN DUNGEON', title2: 'NOT SUPPORTED YET', options: [OK_LABEL] };
  }
}

/** The prison's question (`askBeginAdventure`), and its two options. */
export const BEGIN_ADVENTURE_QUESTION = 'BEGIN THE ADVENTURE?';
const YES_LABEL = 'YES';
const NOT_YET_LABEL = 'NOT YET';

/** The dialog's own buttons; the question's are CSBWin's 210 and 211. */
const BTN_LOAD = 900;
const BTN_SAVE = 901;
const BTN_CANCEL = 902;
const BTN_SCROLL_UP = 903;
const BTN_SCROLL_DOWN = 904;
const BTN_EXPORT = 905;
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
  previewTextX: PREVIEW_TEXT_X,
  previewMaxChars: PREVIEW_MAX_CHARS,
  scrollbar: SCROLLBAR,
  arrowBox: ARROW_BOX,
  sliderMin: SLIDER_MIN,
  loadButtonId: BTN_LOAD,
  saveButtonId: BTN_SAVE,
  exportButtonId: BTN_EXPORT,
  cancelButtonId: BTN_CANCEL,
} as const;

/* --------------------------------------------------------------------- state ---- */

/**
 * The disk menu (`full`), the entrance's RESUME and a lost game's restart (`loadOnly`),
 * or the entrance's RISE (`rise`): the load-only chooser over every data set's saves,
 * whose LOAD makes a new adventure from the chosen one and reads that
 * (`src/renderer/intro/PrisonDoor.ts`).
 */
export type SaveMenuMode = 'full' | 'loadOnly' | 'rise';

/** What the bottom pair of buttons does. */
export type SaveMenuAction = 'load' | 'save';

/** A row of the list: the full menu's "new save", a playthrough's heading, or a save under one. */
export type SaveMenuRow =
  | { kind: 'new' }
  | { kind: 'heading'; playthrough: Playthrough }
  | { kind: 'save'; entry: SaveEntry };

export interface SaveMenuState {
  mode: SaveMenuMode;
  /** The running data set's saves, newest first (`UIState.onListSaves`); RISE's, every set's. */
  entries: SaveEntry[];
  /** The playthroughs whose saves are listed under their heading; the others are folded. */
  unfolded: Set<number>;
  /** The list as it is shown: `layoutRows`, run whenever `entries` or `unfolded` change. */
  rows: SaveMenuRow[];
  /** Index into `rows`, or -1 in a list with none. */
  selected: number;
  scrollTop: number;
  /** An async list/read/write is in flight; every button is inert. */
  busy: boolean;
  /** The dialog's message, at the foot of the preview's panel: an error, or what the last action did. */
  message: string;
  press: MenuPress | null;
  /** What the press animation will do when it finishes. */
  pending: (() => void) | null;
  /** The action the question on screen asks about, in the dialog's place, or `null`. */
  confirm: SaveMenuAction | null;
  /**
   * The dropped file that was not stored, while the menu about it is up in the dialog's
   * place (`importMenu`), or `null`.
   */
  dropped: { file: ImportedFile; refusal: ImportRefusal } | null;
  /**
   * The prison's question while it is up (`askBeginAdventure`): the save YES makes the
   * adventure from, `null` for a quick-save written first, and whether the dialog was
   * raised for the question `alone`, so that NOT YET closes it.
   */
  adventure: { source: SaveEntry | null; alone: boolean } | null;
  frameHandle: number | null;
  /** The save a click last selected, and when (`nowMs`): a second click on it soon after is LOAD. */
  lastSaveClick: { id: string; atMs: number } | null;
}

export function isSaveMenuOpen(ui: UIState): boolean {
  return ui.saveMenu !== null;
}

/**
 * Raise the screen. `loadOnly` is what the title screen will want: the same list with
 * no SAVE button.
 *
 * The full screen is the disk menu, `_DisplayDiskMenu`, so `TAG02076e` runs first
 * (`doc/CSBwin-src/SaveGame.cpp:877`) and `TAG0207cc` last (`:1375`): `tag02076e` and
 * `tag0207cc`. The load-only one is `_ReadEntireGame` (`:1536`), which calls neither.
 * `_DoMenu` sets `videoMode` (`Menu.cpp:465-472`): `VM_LEFTMENU` for the disk menu's
 * `ClearOldScreen` of 0 (`SaveGame.cpp:889`), `VM_CENTERMENU` for `_ReadEntireGame`'s 1
 * (`:1665`). Closing the menu leaves it, until `TAG0207cc` shows an open inventory again
 * or the next tick's top (`CSBCode.cpp:613-621`).
 */
export function openSaveMenu(ui: UIState, mode: SaveMenuMode = 'full'): void {
  if (ui.saveMenu) return;
  if (mode === 'full') tag02076e(ui);
  ui.ctx.loop.videoMode = mode === 'full' ? 'VM_LEFTMENU' : 'VM_CENTERMENU';
  ui.ctx.state.paused = true;
  ui.saveMenu = {
    mode,
    entries: [],
    unfolded: new Set(),
    rows: [],
    selected: -1,
    scrollTop: 0,
    busy: true,
    message: '',
    press: null,
    pending: null,
    confirm: null,
    dropped: null,
    adventure: null,
    frameHandle: null,
    lastSaveClick: null,
  };
  void refreshSaveMenu(ui);
}

/**
 * "BEGIN THE ADVENTURE?", in the prison: over the disk menu, or in a dialog raised for it
 * alone, as the disk menu is raised, the clock stopped (see "The prison's question").
 */
export function askBeginAdventure(ui: UIState, source: SaveEntry | null): void {
  const alone = !ui.saveMenu;
  openSaveMenu(ui);
  if (!ui.saveMenu) return;
  ui.saveMenu.adventure = { source, alone };
  ui.renderLastFrame();
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

/** List the saves again. Never throws — the failure becomes the dialog's message. */
export async function refreshSaveMenu(ui: UIState): Promise<void> {
  const state = ui.saveMenu;
  if (!state) return;
  state.busy = true;
  state.message = savesDisabled(ui, state) ? SAVES_ARE_DISABLED : '';
  ui.renderLastFrame();
  try {
    state.entries = await (state.mode === 'rise' ? ui.onListEverySave() : ui.onListSaves());
    selectLastUsed(ui, state);
  } catch (error) {
    state.entries = [];
    selectLastUsed(ui, state);
    state.message = shortError(error);
  } finally {
    state.busy = false;
    ui.renderLastFrame();
  }
}

function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.toUpperCase();
}

/**
 * A message as lines of `maxChars` at most, broken at its spaces; a word longer than a
 * line is cut at the line's end.
 */
export function wrapMessage(message: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (let word of message.split(' ').filter((w) => w.length > 0)) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line);
      line = '';
    }
    for (; word.length > maxChars; word = word.slice(maxChars)) lines.push(word.slice(0, maxChars));
    line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Whether the disk menu saves nothing: a DSA has disabled saves, and CSBWin's
 * `_DisplayDiskMenu` would show "SAVES ARE DISABLED" in its place
 * (`doc/CSBwin-src/SaveGame.cpp:856-873`).
 */
function savesDisabled(ui: UIState, state: SaveMenuState): boolean {
  return state.mode === 'full' && ui.ctx.systems.dsa.disableSaves;
}

/** The running game's playthrough, `d.RandomGameID`: never 0 (`drawRandomGameID`). */
function runningPlaythrough(ui: UIState): number {
  return ui.ctx.state.block1.randomGameID;
}

/**
 * The list's rows, from the saves and the folds: each playthrough's heading, the last
 * one used first, with its saves under it when it is unfolded. The full menu has
 * "NEW SAVE" above them while the running game's playthrough has no save, hence no
 * heading to make one from, and saves are not disabled.
 */
function layoutRows(ui: UIState, state: SaveMenuState): void {
  const playthroughs = playthroughsOf(state.entries);
  const rows: SaveMenuRow[] = [];
  if (state.mode === 'full' && !savesDisabled(ui, state) && !playthroughs.some((p) => p.id === runningPlaythrough(ui))) {
    rows.push({ kind: 'new' });
  }
  for (const playthrough of playthroughs) {
    rows.push({ kind: 'heading', playthrough });
    if (state.unfolded.has(playthrough.id)) {
      for (const entry of playthrough.saves) rows.push({ kind: 'save', entry });
    }
  }
  state.rows = rows;
}

function selectedRow(state: SaveMenuState): SaveMenuRow | null {
  return state.rows[state.selected] ?? null;
}

/** The selected save: what SAVE writes over. `null` on a heading and on "new save". */
export function selectedEntry(state: SaveMenuState): SaveEntry | null {
  const row = selectedRow(state);
  return row?.kind === 'save' ? row.entry : null;
}

/**
 * What LOAD reads: the selected save, or from a heading the last save used of its
 * playthrough. `null` on "new save".
 */
export function loadTarget(state: SaveMenuState): SaveEntry | null {
  const row = selectedRow(state);
  return row?.kind === 'save' ? row.entry : row?.kind === 'heading' ? row.playthrough.lastUsed : null;
}

function canLoad(state: SaveMenuState): boolean {
  return !state.busy && loadTarget(state) !== null;
}

/**
 * SAVE writes over a save, any playthrough's, and makes a new one from "new save" and
 * from the heading of the running game's playthrough. Another playthrough's heading
 * has nothing to write over, and a new save is never its own. Nothing is saved while
 * saves are disabled.
 */
function canSave(ui: UIState, state: SaveMenuState): boolean {
  const row = selectedRow(state);
  return !state.busy && state.mode === 'full' && !savesDisabled(ui, state) && row !== null
    && (row.kind !== 'heading' || row.playthrough.id === runningPlaythrough(ui));
}

/** EXPORT hands out the selected save's file; a heading and "new save" have none. */
function canExport(state: SaveMenuState): boolean {
  return !state.busy && selectedEntry(state) !== null;
}

/**
 * Whether LOAD or SAVE asks before it acts: in the full menu, when the save LOAD would
 * read, or SAVE write over, is of another playthrough than the running game's
 * (`d.RandomGameID`). The order of two saves of one playthrough is never checked, and a
 * new save writes over nothing. The load-only chooser never asks: no game is being
 * played behind it, at the entrance or after a lost one, where CSBWin's own test cannot
 * fire either (`doc/CSBWIN_TITLE_SCREEN_REFERENCE.md` → ""THAT'S NOT THE SAME GAME"
 * cannot happen after a restart").
 */
export function asksFirst(ui: UIState, state: SaveMenuState, action: SaveMenuAction): boolean {
  const entry = action === 'load' ? loadTarget(state) : selectedEntry(state);
  return state.mode === 'full' && entry !== null && entry.playthrough !== runningPlaythrough(ui);
}

/** Select a listed save, its playthrough unfolded and the list scrolled to it. */
function selectSave(ui: UIState, state: SaveMenuState, entry: SaveEntry): void {
  state.unfolded.add(entry.playthrough);
  layoutRows(ui, state);
  state.selected = state.rows.findIndex((row) => row.kind === 'save' && row.entry.id === entry.id);
  showSelection(state);
}

/**
 * The selection of a list just read: the last save used, its playthrough unfolded
 * beside those that already were; with no save, the list's first row, which is the full
 * menu's "new save".
 */
function selectLastUsed(ui: UIState, state: SaveMenuState): void {
  state.scrollTop = 0;
  const last = lastUsedSave(state.entries);
  if (last) {
    selectSave(ui, state, last);
    return;
  }
  layoutRows(ui, state);
  state.selected = state.rows.length > 0 ? 0 : -1;
  showSelection(state);
}

/** Fold a playthrough's saves away under its heading, or list them again. */
function setFolded(ui: UIState, state: SaveMenuState, playthrough: Playthrough, folded: boolean): void {
  if (folded) state.unfolded.delete(playthrough.id);
  else state.unfolded.add(playthrough.id);
  layoutRows(ui, state);
}

/** Keep the list on its rows: no further down than its last page. */
function clampScroll(state: SaveMenuState): void {
  const maxTop = Math.max(0, state.rows.length - SAVE_MENU_ROWS);
  if (state.scrollTop > maxTop) state.scrollTop = maxTop;
  if (state.scrollTop < 0) state.scrollTop = 0;
}

/** Scroll the list to the selection, by as little as shows it: what a move of it does. */
function showSelection(state: SaveMenuState): void {
  clampScroll(state);
  if (state.selected >= 0) {
    if (state.selected < state.scrollTop) state.scrollTop = state.selected;
    else if (state.selected >= state.scrollTop + SAVE_MENU_ROWS) {
      state.scrollTop = state.selected - SAVE_MENU_ROWS + 1;
    }
  }
}

/**
 * The scrollbar's slider, its first and last rows on screen, which are its outlines. It
 * moves in the track between the arrows' boxes, whose inner outlines its own lie on at
 * either end. Its height is to the track's as the rows shown are to the list's, and its
 * place as the first row shown is to the last it can be; a list that fits its panel
 * has the whole track for a slider.
 */
export function scrollSlider(state: SaveMenuState): { y1: number; y2: number } {
  const top = SCROLLBAR.y1 + ARROW_BOX - 1;
  const track = SCROLLBAR.y2 - ARROW_BOX + 1 - top + 1;
  const maxTop = state.rows.length - SAVE_MENU_ROWS;
  if (maxTop <= 0) return { y1: top, y2: top + track - 1 };
  const height = Math.max(SLIDER_MIN, Math.round((track * SAVE_MENU_ROWS) / state.rows.length));
  const y1 = top + Math.round(((track - height) * Math.min(state.scrollTop, maxTop)) / maxTop);
  return { y1, y2: y1 + height - 1 };
}

/** Scroll the list by `rows`, the selection left where it is, in the panel or out of it. */
function scrollBy(ui: UIState, state: SaveMenuState, rows: number): void {
  state.scrollTop += rows;
  clampScroll(state);
  ui.renderLastFrame();
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

/** A row as the list shows it. */
export function rowText(state: SaveMenuState, row: SaveMenuRow): string {
  switch (row.kind) {
    case 'new':
      return NEW_SAVE_LABEL;
    case 'heading':
      return formatPlaythroughRow(row.playthrough, !state.unfolded.has(row.playthrough.id), TEXT_MAX_CHARS);
    case 'save':
      return formatSaveRow(row.entry, TEXT_MAX_CHARS);
  }
}

/** The rectangle of the list's row `row`, counted from the first one shown. */
function rowRect(row: number): Rect {
  const y = ROW_FIRST_Y + row * ROW_STEP;
  return { x1: LIST_INNER_X1, y1: y - 5, x2: LIST_INNER_X2, y2: y + 2 };
}

/**
 * The list's scrollbar: an outline, the two arrows in their boxes, and between them the
 * slider (`scrollSlider`), plain between its two outlines, in a track dithered of the
 * outline's colour and the panel's.
 */
function drawScrollbar(ui: UIState, state: SaveMenuState): void {
  const buf = ui.screenIndexBuffer;
  const { x1, y1, x2, y2 } = SCROLLBAR;
  const line = (y: number): void => fillRectIndex(buf, { x1, y1: y, x2, y2: y }, MENU_OPTION_COLOR);
  fillRectIndex(buf, SCROLLBAR, MENU_PANEL_COLOR);
  fillRectIndex(buf, { x1, y1, x2: x1, y2 }, MENU_OPTION_COLOR);
  fillRectIndex(buf, { x1: x2, y1, x2, y2 }, MENU_OPTION_COLOR);
  for (const y of [y1, y1 + ARROW_BOX - 1, y2 - ARROW_BOX + 1, y2]) line(y);

  const arrow = (top: number, rows: string[]): void => {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        if (row[dx] === '#') buf.pixels[(top + dy) * buf.width + x1 + 1 + dx] = MENU_OPTION_COLOR;
      }
    });
  };
  arrow(y1 + 1, ARROW_UP);
  arrow(y2 - ARROW_BOX + 2, [...ARROW_UP].reverse());

  const slider = scrollSlider(state);
  for (let y = y1 + ARROW_BOX; y <= y2 - ARROW_BOX; y++) {
    if (y >= slider.y1 && y <= slider.y2) continue;
    for (let x = x1 + 1; x < x2; x++) {
      if (((x + y) & 1) === 0) buf.pixels[y * buf.width + x] = MENU_OPTION_COLOR;
    }
  }
  line(slider.y1);
  line(slider.y2);
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

  if (state.adventure) {
    doMenu(ui, BEGIN_ADVENTURE_QUESTION, null, [YES_LABEL, NOT_YET_LABEL], true);
    if (state.press) drawMenuPress(ui, state.press, nowMs());
    return;
  }
  if (state.confirm) {
    doMenu(ui, SAVE_MENU_QUESTION, null, [ACTION_LABELS[state.confirm], CANCEL_LABEL], true);
    if (state.press) drawMenuPress(ui, state.press, nowMs());
    return;
  }
  if (state.dropped) {
    const menu = importMenu(state.dropped.refusal);
    doMenu(ui, menu.title1, menu.title2, menu.options, true);
    if (state.press) drawMenuPress(ui, state.press, nowMs());
    return;
  }

  drawDialog(ui);

  // The rows, and their scrollbar.
  clampScroll(state);
  drawScrollbar(ui, state);
  for (let row = 0; row < SAVE_MENU_ROWS; row++) {
    const index = state.scrollTop + row;
    if (index >= state.rows.length) break;
    const highlighted = index === state.selected;
    const color = highlighted ? MENU_PANEL_COLOR : MENU_OPTION_COLOR;
    const background = highlighted ? MENU_OPTION_COLOR : MENU_PANEL_COLOR;
    const y = ROW_FIRST_Y + row * ROW_STEP;
    if (highlighted) fillRectIndex(ui.screenIndexBuffer, rowRect(row), MENU_OPTION_COLOR);
    text(ui, rowText(state, state.rows[index]), TEXT_X, y, color, background);
  }

  if (state.rows.length === 0 && !state.busy && !state.message) {
    // An empty list has to say so, which the load-only menu's can be; when the store
    // could not be listed, the message says why, and repeating that here would only
    // crowd the panel.
    text(ui, 'NO SAVED GAMES HERE', TEXT_X, ROW_FIRST_Y, MENU_OPTION_COLOR, MENU_PANEL_COLOR);
  }

  // The preview's panel: the save LOAD would read, and on its last lines the message,
  // whatever went wrong or what was done.
  const message = wrapMessage(state.busy ? WORKING_MESSAGE : state.message, PREVIEW_MAX_CHARS).slice(0, MESSAGE_MAX_LINES);
  const messageRow = SAVE_MENU_ROWS - message.length;
  const previewed = loadTarget(state);
  if (previewed) {
    formatSavePreview(previewed, PREVIEW_MAX_CHARS).forEach((line, row) => {
      if (line && row < messageRow) text(ui, line, PREVIEW_TEXT_X, ROW_FIRST_Y + row * ROW_STEP, MENU_OPTION_COLOR, MENU_PANEL_COLOR);
    });
  }
  message.forEach((line, i) => {
    text(ui, line, PREVIEW_TEXT_X, ROW_FIRST_Y + (messageRow + i) * ROW_STEP, MENU_TITLE1_COLOR, MENU_PANEL_COLOR);
  });

  // A button that can do nothing is left unlabelled, as CSBWin leaves an empty save
  // slot unlabelled.
  if (canLoad(state)) drawLabel(ui, ACTION_LABELS.load, BUTTON_FRAMES.load);
  if (canSave(ui, state)) drawLabel(ui, ACTION_LABELS.save, BUTTON_FRAMES.save);
  if (canExport(state)) drawLabel(ui, EXPORT_LABEL, BUTTON_FRAMES.export);
  if (!state.busy) drawLabel(ui, CANCEL_LABEL, BUTTON_FRAMES.cancel);

  if (state.press) drawMenuPress(ui, state.press, nowMs());
}

/* ------------------------------------------------------------------ hit test ---- */

/**
 * The dialog's own button list, in the form of CSBWin's (`x2` and `y2` exclusive): the
 * four buttons, the scrollbar's two arrows, and the rows shown. Built
 * fresh on each click because the rows follow the scroll position.
 */
export function saveMenuButtons(state: SaveMenuState): UIButton[] {
  const buttons: UIButton[] = [
    { word0: BTN_LOAD, ...buttonRect(BUTTON_FRAMES.load), button: 2, name: 'saveMenu.load' },
    { word0: BTN_SAVE, ...buttonRect(BUTTON_FRAMES.save), button: 2, name: 'saveMenu.save' },
    { word0: BTN_EXPORT, ...buttonRect(BUTTON_FRAMES.export), button: 2, name: 'saveMenu.export' },
    { word0: BTN_CANCEL, ...buttonRect(BUTTON_FRAMES.cancel), button: 2, name: 'saveMenu.cancel' },
  ];
  const arrow = (id: number, y1: number, name: string): UIButton => (
    { word0: id, x1: SCROLLBAR.x1, x2: SCROLLBAR.x2 + 1, y1, y2: y1 + ARROW_BOX, button: 2, name }
  );
  buttons.push(arrow(BTN_SCROLL_UP, SCROLLBAR.y1, 'saveMenu.scrollUp'));
  buttons.push(arrow(BTN_SCROLL_DOWN, SCROLLBAR.y2 - ARROW_BOX + 1, 'saveMenu.scrollDown'));
  const visible = Math.min(SAVE_MENU_ROWS, Math.max(0, state.rows.length - state.scrollTop));
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
    if ((state.confirm || state.dropped || state.adventure) && !state.press) cancelQuestion(ui, state);
    else closeSaveMenu(ui);
    return;
  }
  if (state.busy || state.press) return;

  if (state.adventure) {
    answerAdventure(ui, state, state.adventure, menuHitTest(menuButtonList(ui, 2, true), x, y, buttons));
    return;
  }

  if (state.dropped) {
    const options = importMenu(state.dropped.refusal).options.length;
    answerDropped(ui, state, state.dropped, options, menuHitTest(menuButtonList(ui, options, true), x, y, buttons));
    return;
  }

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
  if (id === BTN_SCROLL_UP || id === BTN_SCROLL_DOWN) {
    scrollBy(ui, state, id === BTN_SCROLL_UP ? -1 : 1);
    return;
  }
  if (id >= BTN_ROW0 && id < BTN_ROW0 + SAVE_MENU_ROWS) {
    const index = state.scrollTop + (id - BTN_ROW0);
    const row = state.rows[index];
    if (row) {
      // A second click on a save, soon after the first, is LOAD; a third starts again.
      const now = nowMs();
      const last = state.lastSaveClick;
      const second = row.kind === 'save' && last !== null && last.id === row.entry.id && now - last.atMs <= SAVE_MENU_DOUBLE_CLICK_MS;
      state.lastSaveClick = row.kind === 'save' && !second ? { id: row.entry.id, atMs: now } : null;
      // A heading keeps its place in the list whichever way its saves go.
      state.selected = index;
      if (row.kind === 'heading') setFolded(ui, state, row.playthrough, state.unfolded.has(row.playthrough.id));
      state.message = '';
      if (second && canLoad(state)) pressAction(ui, state, 'load');
      else ui.renderLastFrame();
    }
    return;
  }
  if (id === BTN_LOAD && canLoad(state)) pressAction(ui, state, 'load');
  if (id === BTN_SAVE && canSave(ui, state)) pressAction(ui, state, 'save');
  if (id === BTN_EXPORT && canExport(state)) {
    beginPress(ui, state, saveMenuButtons(state), BTN_EXPORT, () => void runPending(ui, 'export'));
  }
}

/** LOAD or SAVE pressed: once the press has played, the question, or the action at once. */
function pressAction(ui: UIState, state: SaveMenuState, action: SaveMenuAction): void {
  beginPress(ui, state, saveMenuButtons(state), action === 'load' ? BTN_LOAD : BTN_SAVE, () => {
    if (asksFirst(ui, state, action)) {
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

/**
 * A click on the menu about a dropped file, `choice` being `_WaitForMenuSelect`'s among
 * its `options`. The button flashes with the menu still up; then the list is back, and
 * the first of two options, CONFIRM, stores the file.
 */
function answerDropped(ui: UIState, state: SaveMenuState, dropped: NonNullable<SaveMenuState['dropped']>, options: number, choice: number): void {
  if (choice < 1 || choice > options) return;
  beginPress(ui, state, menuButtonList(ui, options, true), 209 + choice, () => {
    state.dropped = null;
    if (dropped.refusal.kind === 'modified' && choice === 1) void runImport(ui, dropped.file, true);
    else ui.renderLastFrame();
  });
}

/**
 * A click on the prison's question, `choice` being `_WaitForMenuSelect`'s: 1 is YES, 2
 * is NOT YET, and 0 neither button. The button flashes with the question still up; then
 * YES begins the adventure, and NOT YET is the list again, or no dialog.
 */
function answerAdventure(ui: UIState, state: SaveMenuState, adventure: NonNullable<SaveMenuState['adventure']>, choice: number): void {
  if (choice !== 1 && choice !== 2) return;
  beginPress(ui, state, menuButtonList(ui, 2, true), 209 + choice, () => {
    if (choice === 1) {
      state.adventure = null;
      void beginAdventure(ui, state, adventure.source);
    } else {
      cancelQuestion(ui, state);
    }
  });
}

/**
 * Esc or a right-click on a question, or on the menu about a dropped file: CANCEL, or the
 * prison's NOT YET, without the press. A dialog raised for the prison's question alone
 * closes.
 */
function cancelQuestion(ui: UIState, state: SaveMenuState): void {
  const alone = state.adventure?.alone ?? false;
  state.confirm = null;
  state.dropped = null;
  state.adventure = null;
  if (alone) closeSaveMenu(ui);
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

async function runPending(ui: UIState, action: SaveMenuAction | 'export'): Promise<void> {
  const state = ui.saveMenu;
  if (!state) return;
  state.busy = true;
  state.message = '';
  ui.renderLastFrame();
  try {
    if (action === 'load') await doLoad(ui, state);
    else if (action === 'save') await doSave(ui, state);
    else await doExport(ui, state);
  } catch (error) {
    state.busy = false;
    state.message = shortError(error);
    ui.renderLastFrame();
  }
}

async function doLoad(ui: UIState, state: SaveMenuState): Promise<void> {
  const entry = loadTarget(state);
  if (!entry) {
    state.busy = false;
    return;
  }
  if (state.mode !== 'rise') {
    restoreChosenSave(ui, await ui.onReadSave(entry));
    return;
  }
  // RISE: a refusal, or a source that does not read, is the entrance's to show, as a
  // failed read is the boot's.
  let adventure: OpenedSave;
  try {
    adventure = await ui.onMakeNewAdventure(entry);
  } catch (error) {
    ui.onRestoreFailed(error);
    closeSaveMenu(ui);
    ui.renderLastFrame();
    return;
  }
  restoreChosenSave(ui, adventure);
}

/**
 * Restore the save the player chose, and close the menu: after a load the world it was
 * listing is gone.
 *
 * A read that fails in the full menu throws, and its message is the dialog's
 * (`runPending`). The load-only chooser is `_ReadEntireGame`'s, where every failed read
 * ends at `tag01efee` instead (`doc/CSBwin-src/SaveGame.cpp:1911-1912`, `:2098`): it
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
  // is written over the selected one, or is a new one from "new save" or the game's own
  // heading, and is the selection afterwards.
  const saved = await ui.onSaveGame(selectedEntry(state));
  await refreshSaveMenu(ui);
  selectSave(ui, state, saved);
  state.message = 'GAME SAVED';
  if (ui.isPrison()) state.adventure = { source: saved, alone: false };
  ui.renderLastFrame();
}

/**
 * YES to the prison's question: the new adventure made from `source`, or from F5's
 * quick-save written first (`UIState.onSaveGame`), stored, and read in the game's place,
 * as the entrance's RISE reads it (`doLoad`). A refusal, or a write or a read that
 * fails, is the dialog's message, over the list listed again, the quick-save included.
 */
async function beginAdventure(ui: UIState, state: SaveMenuState, source: SaveEntry | null): Promise<void> {
  state.busy = true;
  state.message = '';
  ui.renderLastFrame();
  try {
    const saved = source ?? await ui.onSaveGame('quick');
    restoreChosenSave(ui, await ui.onMakeNewAdventure(saved));
  } catch (error) {
    await refreshSaveMenu(ui);
    state.message = shortError(error);
    ui.renderLastFrame();
  }
}

/** The selected save's file, handed to the player. The store and the game stay as they are. */
async function doExport(ui: UIState, state: SaveMenuState): Promise<void> {
  const entry = selectedEntry(state);
  if (entry) {
    await ui.onExportSave(entry);
    state.message = SAVE_MENU_EXPORTED;
  }
  state.busy = false;
  ui.renderLastFrame();
}

/**
 * A file dropped on the page while the dialog is up: the import. Says whether the dialog
 * took it, which it does not while it is working, pressing a button or asking.
 */
export function saveMenuDrop(ui: UIState, file: ImportedFile): boolean {
  const state = ui.saveMenu;
  if (!state || state.busy || state.press || state.confirm || state.dropped || state.adventure) return false;
  void runImport(ui, file, false);
  return true;
}

/**
 * Take a dropped file into the store, `confirmed` once the player has answered CONFIRM
 * for a modified dungeon. Stored, it is listed and selected; not stored, the menu about
 * it comes up (`importMenu`). A file that does not read throws, and its line is the
 * dialog's message. Never throws.
 */
async function runImport(ui: UIState, file: ImportedFile, confirmed: boolean): Promise<void> {
  const state = ui.saveMenu;
  if (!state) return;
  state.busy = true;
  state.message = '';
  ui.renderLastFrame();
  try {
    const result = await ui.onImportSave(file, confirmed);
    // A right-click closes the dialog whatever it is doing: the file is stored all the same.
    if (ui.saveMenu !== state) return;
    if (result.kind === 'stored') {
      await refreshSaveMenu(ui);
      selectSave(ui, state, result.entry);
      state.message = SAVE_MENU_IMPORTED;
    } else {
      state.busy = false;
      state.dropped = { file, refusal: result };
    }
  } catch (error) {
    state.busy = false;
    state.message = shortError(error);
  }
  ui.renderLastFrame();
}

/* ------------------------------------------------------------------- keyboard ---- */

/**
 * CSBWin's menus take no key (`doc/PROVEN_FACTS.md` → "A one-button menu takes no key").
 * A list needs arrows, and Esc is the cancel every player will try; both are additions,
 * recorded as such. Up and down move the selection over the rows shown; right unfolds
 * the heading selected and left folds it, and from a save left goes to its heading.
 *
 * Returns whether the key was taken, so the host can stop it reaching the movement keys
 * exactly as it does for the Reincarnate screen.
 */
export function saveMenuKey(ui: UIState, key: string): boolean {
  const state = ui.saveMenu;
  if (!state) return false;
  if (state.busy || state.press) return true;
  // A question takes no key but its cancel, nor does the menu about a dropped file.
  if (state.confirm || state.dropped || state.adventure) {
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
    case 'ArrowRight':
      foldSelection(ui, state, false);
      return true;
    case 'ArrowLeft':
      foldSelection(ui, state, true);
      return true;
    case 'PageUp':
      moveSelection(ui, state, -SAVE_MENU_ROWS);
      return true;
    case 'PageDown':
      moveSelection(ui, state, SAVE_MENU_ROWS);
      return true;
    case 'Home':
      moveSelection(ui, state, -state.rows.length);
      return true;
    case 'End':
      moveSelection(ui, state, state.rows.length);
      return true;
    case 'Enter':
      if (canLoad(state)) pressAction(ui, state, 'load');
      return true;
    default:
      return true;
  }
}

function moveSelection(ui: UIState, state: SaveMenuState, delta: number): void {
  if (state.rows.length === 0) return;
  const next = Math.max(0, Math.min(state.rows.length - 1, (state.selected < 0 ? 0 : state.selected) + delta));
  state.selected = next;
  state.message = '';
  showSelection(state);
  ui.renderLastFrame();
}

/** The right arrow (`folded` false) and the left one, on the row selected. */
function foldSelection(ui: UIState, state: SaveMenuState, folded: boolean): void {
  const row = selectedRow(state);
  if (row?.kind === 'heading') {
    setFolded(ui, state, row.playthrough, folded);
  } else if (row?.kind === 'save' && folded) {
    state.selected = state.rows.findIndex((r) => r.kind === 'heading' && r.playthrough.id === row.entry.playthrough);
  } else {
    return;
  }
  state.message = '';
  showSelection(state);
  ui.renderLastFrame();
}

/** The wheel scrolls the list a row at a time, without moving the selection. */
export function saveMenuWheel(ui: UIState, delta: number): boolean {
  const state = ui.saveMenu;
  if (!state) return false;
  if (state.confirm || state.dropped || state.adventure) return true;
  scrollBy(ui, state, delta > 0 ? 1 : -1);
  return true;
}
