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
 * export of a save's file and an import of one, a delete behind a long press, no "save
 * and quit", and Esc/right-click to close.
 *
 * ## The dialog
 *
 * `_DoMenu` draws graphic 0, 224x136, in the viewport's place, and each of its four
 * layouts is that bitmap blitted over itself (`Menu.ts`). A list of saves beside a
 * preview needs more room than the bitmap has, so the dialog is 304x184 on a screen
 * cleared to black, and is drawn from the dialogs' widget kit (`Widgets.ts`), whose
 * widgets are pieces of graphic 0: the plate, two panels, a list and four buttons. Two
 * panels, the list's and the preview's, stand over a row of four buttons: LOAD, SAVE and
 * EXPORT under the list, CLOSE under the preview. The list's is 32 characters and its
 * scrollbar wide, and the preview's ten characters.
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
 * window's, in the dialog's two colours (`drawList`): a boxed arrow at each end, and
 * between them a slider, plain, for the rows shown, in a track that is dithered where
 * rows lie beyond them. A click on an arrow scrolls the list by a row, and a notch of the
 * wheel by three (`Widgets.wheelRows`); the slider and the track take no click. Scrolling does not move the
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
 * ## DELETE
 *
 * A save is deleted from EXPORT's frame, where nothing would put it by accident: a long
 * press on a save's row (`SAVE_MENU_LONG_PRESS_MS`, held on the row), or the Delete key
 * on a save selected, turns EXPORT into DELETE for that save (`deleteArmed`). Another
 * selection, a heading's or another save's, turns it back, as does the list read again
 * after a save, an import or the delete itself. DELETE asks first, always, in
 * `_DoMenu`'s two-option menu in the dialog's place: "DELETE THIS SAVE?" over the save's
 * row, with DELETE and CANCEL. Deleted, the row is gone from the store
 * (`UIState.onDeleteSave`), the save after it in its playthrough is selected, or else the
 * one before, and the dialog says "SAVE DELETED". The game is left alone, whichever save
 * it came from. The load-only chooser has it as the disk menu does; RISE's dialog, which
 * has no EXPORT, has no DELETE either.
 *
 * ## The import
 *
 * A file dropped on the page while the dialog is up is taken into the store
 * (`saveMenuDrop`, through `UIState.onImportSave` to `GameSaves.importSave`), in the disk
 * menu and in the load-only chooser alike. A save of the data set's dungeon is listed at
 * once, selected, and the dialog says "SAVE IMPORTED"; nothing is loaded. One of a
 * slightly different dungeon, its levels the set's and some of their walls not, is asked
 * about first, in `_DoMenu`'s three-option menu in the dialog's place: "IT SEEMS THIS
 * SAVE IS FOR A SLIGHTLY DIFFERENT DUNGEON", over LOOK FOR A BETTER MATCH, IMPORT
 * ANYWAY and CANCEL (`importMenu`), so that the author of a set keeps their saves while
 * they build it. A save of another dungeon, or of none the port knows, is refused in
 * `_DoMenu`'s one-option menu, under OK, with the dungeon named and whether a data set
 * plays it. A file with no `GAMEBLOCK1` is the
 * dialog's message "NOT A SAVED GAME", and one that has it and does not read past it
 * CSBWin's "SAVED GAME DAMAGED!". CSBWin has no import: a file put in the game's
 * directory under one of its four names is a save of that game.
 *
 * Nothing else on the dialog says a file is imported so: the message's place shows
 * "DROP .DAT TO IMPORT" while there is no message and the pointer is on the preview's
 * panel or EXPORT's frame while it is not DELETE (`saveMenuPointer`).
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
 * the list, or closes the dialog when it was raised for the question alone. The prison's
 * party has CSB's own faces, so YES asks for no new ones.
 *
 * ## RISE
 *
 * The entrance's RISE opens the load-only chooser over every data set's saves, under a
 * title that says what it does, its LOAD labelled RISE: it makes a new adventure from the
 * chosen save and reads that. It has no EXPORT and takes no dropped file. In EXPORT's
 * frame, when the data set has the utility disk's portraits (`UIState.onHasNewFaces`), is
 * a two-state button, on whenever the dialog opens: NEW FACE while on, the DM champions
 * raised with the utility's portraits of them, and OLD FACE while off, the adventure
 * CSBWin's utility makes (`swapInNewFaces`, `src/engine/Chaos.ts`).
 *
 * ## Modality and the clock
 *
 * `_WaitForMenuSelect` nulls `SecondaryButtonList` and both `pKeyXlate`s and replaces
 * `PrimaryButtonList`, so nothing outside the menu can be clicked, and it never returns
 * to the main loop, so `d.Time` stops. The menu is the dialog over the game
 * (`Dialog.ts`), which has both: its click comes **straight from the DOM event** rather
 * than through the game's mouse queue, which is the same exclusivity, and this port's
 * loop keeps running, so the dialog stops the clock explicitly, with `ctx.state.paused`
 * (`d.Time++` is the main loop's, `doc/CSBwin-src/CSBCode.cpp:670`).
 */
import type { OpenedSave, Playthrough, SaveEntry } from '../../data/saves';
import { SAVES_ARE_DISABLED, type ImportAnswer, type ImportResult, type ImportedFile } from '../../engine/GameSaves';
import { formatPlaythroughRow, formatSavePreview, formatSaveRow, lastUsedSave, playthroughsOf } from '../../data/saves';
import { clearIndex } from '../csbwin/CanvasBlitter';
import { foldToFont } from '../csbwin/TextRenderer';
import { closeDialog, openDialog, type Dialog } from './Dialog';
import type { Rect, UIButton } from '../../data/tables/UITables';
import { searchButtonList } from './HitTest';
import {
  MENU_TITLE1_COLOR,
  MENU_TITLE_MAX_CHARS,
  doMenu,
  drawMenuPress,
  menuButtonList,
  menuButtonRect,
  menuHitTest,
  playMenuPress,
  splitLongLine,
  type MenuPress,
} from './Menu';
import { tag02076e } from '../../engine/ShowHideInventory';
import { nowMs, type UIState } from './UIState';
import {
  BUTTON_PIECE,
  LINE_STEP,
  PANEL_PIECE,
  PLATE_PIECE,
  SCROLL_SLIDER_MIN,
  arrowBox,
  buttonLabelAt,
  buttonOf,
  clampScrollTop,
  contains,
  drawButtonFrame,
  drawButtonLabel,
  drawCentredText,
  drawList,
  drawPanel,
  drawPlate,
  drawText,
  listButtons,
  listIn,
  listInner,
  listTextX,
  scrollSlider as listSlider,
  scrollToRow,
  wheelRows,
  type ListWidget,
  type WheelTravel,
} from './Widgets';

/* ------------------------------------------------------------------ geometry ---- */

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
  close: { x1: 237, y1: BUTTON_Y1, x2: 301, y2: BUTTON_Y2 },
} as const;

/**
 * RISE's title panel, over its list: its two lines centred on the list's width, two
 * pixels of the panel's colour above and below them, and graphic 0's ten pixels between
 * it and the list panel, which is that much shorter (`RISE_LIST`).
 */
const RISE_TITLE_PANEL: Rect = { x1: LIST_PANEL.x1, y1: LIST_PANEL.y1, x2: LIST_PANEL.x2, y2: 39 };
/** What RISE does, on its title panel's two lines. */
export const RISE_TITLE = ['RAISE A PARTY INTO A NEW', 'CHAOS STRIKES BACK ADVENTURE'] as const;
const RISE_TITLE_FIRST_Y = RISE_TITLE_PANEL.y1 + 8;

const FULL_LIST = listIn(LIST_PANEL);
/** RISE's list: graphic 0's ten pixels under its title panel, and eleven rows. */
const RISE_LIST = listIn({ ...LIST_PANEL, y1: RISE_TITLE_PANEL.y2 + 11 });

const SCROLLBAR = FULL_LIST.scrollbar;
const ARROW_BOX = arrowBox(FULL_LIST);
const LIST_INNER = listInner(FULL_LIST);

const TEXT_X = listTextX(FULL_LIST);
const TEXT_MAX_CHARS = 32;
const ROW_FIRST_Y = FULL_LIST.rowFirstY;
const ROW_STEP = LINE_STEP;
/** The rows fill the panel: two pixels of it above the first, and two below the last. */
export const SAVE_MENU_ROWS = FULL_LIST.rows;

/** A list's panel, its scrollbar, and its rows: where the first is, and how many fit. */
type SaveMenuList = ListWidget;

/** The list of a mode: RISE's is under its title panel, the others' fills the column. */
export function saveMenuList(mode: SaveMenuMode): SaveMenuList {
  return mode === 'rise' ? RISE_LIST : FULL_LIST;
}

/** The preview's lines are on the list's rows: ten characters between its panel's edges. */
const PREVIEW_TEXT_X = PREVIEW_PANEL.x1 + 4;
const PREVIEW_MAX_CHARS = 10;
/** The most lines a message takes at the foot of the preview's panel. */
const MESSAGE_MAX_LINES = 5;
const WORKING_MESSAGE = 'WORKING...';
/**
 * The import's hint, in the message's place while the pointer is on the preview's panel
 * or EXPORT's frame (`pointsAtImportHint`): two lines, the two a full preview leaves free.
 */
export const SAVE_MENU_IMPORT_HINT = 'DROP .DAT TO IMPORT';

/** How long after a click on a save a second one on it is LOAD, in milliseconds. */
export const SAVE_MENU_DOUBLE_CLICK_MS = 500;
/**
 * How long a press on a save's row is held for EXPORT to become DELETE, in milliseconds:
 * as long as the long presses on the message area and the stat bars (`MESSAGE_LONG_PRESS_MS`, `Dialog.ts`).
 */
export const SAVE_MENU_LONG_PRESS_MS = 500;

/** The full menu's first row, for a game with no save yet: SAVE there makes its first. */
const NEW_SAVE_LABEL = 'NEW SAVE';

/** The question's title, and its two options: the action asked about, then this. */
export const SAVE_MENU_QUESTION = 'THAT\'S NOT THE SAME GAME';
const CANCEL_LABEL = 'CANCEL';
const ACTION_LABELS = { load: 'LOAD', save: 'SAVE', delete: 'DELETE' } as const;
/** The dialog's own button that takes it down: it undoes nothing. */
const CLOSE_LABEL = 'CLOSE';
/** DELETE's question, over the save's row. */
const SAVE_MENU_DELETE_QUESTION = 'DELETE THIS SAVE?';
/** LOAD's label in RISE's dialog: the entrance's button that opened it. */
const RISE_LABEL = 'RISE';
/**
 * RISE's toggle, on and off. Eight characters is the most a button's face holds: 52
 * pixels between graphic 0's two six-column bevels, and a ninth character takes 53.
 */
export const NEW_FACE_LABEL = 'NEW FACE';
export const OLD_FACE_LABEL = 'OLD FACE';
const EXPORT_LABEL = 'EXPORT';
/** The dialog's message once a save's file has been handed to the player. */
export const SAVE_MENU_EXPORTED = 'SAVE EXPORTED';
/** The dialog's message once a save has been deleted. */
export const SAVE_MENU_DELETED = 'SAVE DELETED';
/** The dialog's message once a dropped file is a save of the store. */
export const SAVE_MENU_IMPORTED = 'SAVE IMPORTED';

/** The question about a dropped save of a slightly different dungeon. */
export const SAVE_MENU_DIFFERENT = 'IT SEEMS THIS SAVE IS FOR A SLIGHTLY DIFFERENT DUNGEON';
/**
 * Its options, in `_DoMenu`'s three-option layout: the first is the wide button, which
 * alone holds the longest label, and the two others share the row under it.
 */
const ELSEWHERE_LABEL = 'LOOK FOR A BETTER MATCH';
const ANYWAY_LABEL = 'IMPORT ANYWAY';
const OK_LABEL = 'OK';

/** A dropped file that was not stored: what its dungeon is to the data set's. */
type ImportRefusal = Exclude<ImportResult, { kind: 'stored' }>;

/**
 * The menu about a dropped file that was not stored, `_DoMenu`'s: the question for a
 * save of a slightly different dungeon, whose options send it on to the other sets or
 * store it (`importAnswer`); or the refusal of another dungeon's save, which names the
 * dungeon and says whether a data set plays it, and of an unknown one's, under one option.
 * A published set's name is a player's: folded to what the font draws (`foldToFont`),
 * and cut to fit the title panel (`fittedTitle`).
 */
export function importMenu(refusal: ImportRefusal): { title1: string; title2: string | null; options: string[] } {
  switch (refusal.kind) {
    case 'different':
      return { title1: SAVE_MENU_DIFFERENT, title2: null, options: [ELSEWHERE_LABEL, ANYWAY_LABEL, CANCEL_LABEL] };
    case 'other':
      return {
        title1: fittedTitle('THIS LOOKS LIKE A SAVE OF ', foldToFont(refusal.dungeon.name)),
        title2: refusal.dungeon.dataSets.length > 0 ? 'SWITCH TO IT TO IMPORT IT' : 'NOT SUPPORTED YET',
        options: [OK_LABEL],
      };
    case 'unknown':
      return { title1: 'THIS IS A SAVE OF AN UNKNOWN DUNGEON', title2: 'NOT SUPPORTED YET', options: [OK_LABEL] };
  }
}

/**
 * `prefix` and `name`, where `_DoMenu` draws them within the title panel
 * (`MENU_TITLE_MAX_CHARS`) once `splitLongLine` has split them; otherwise `name` cut short
 * and ended by `...`, as many of its words as fit, or of its characters where no word does.
 */
function fittedTitle(prefix: string, name: string): string {
  const fits = (title: string): boolean =>
    (splitLongLine(title) ?? [title]).every((line) => line.length <= MENU_TITLE_MAX_CHARS);
  if (fits(prefix + name)) return prefix + name;
  const lengths = Array.from(name, (_, i) => name.length - 1 - i);
  const wordEnds = lengths.filter((length) => name[length] === ' ' && name[length - 1] !== ' ');
  for (const length of [...wordEnds, ...lengths]) {
    const title = `${prefix}${name.slice(0, length).trimEnd()}...`;
    if (length > 0 && fits(title)) return title;
  }
  return `${prefix}...`;
}

/** What option `choice` of `refusal`'s menu answers, 1-based: `null` for CANCEL and OK. */
function importAnswer(refusal: ImportRefusal, choice: number): ImportAnswer | null {
  if (refusal.kind !== 'different') return null;
  return choice === 1 ? 'elsewhere' : choice === 2 ? 'anyway' : null;
}

/** The prison's question (`askBeginAdventure`), and its two options. */
const BEGIN_ADVENTURE_QUESTION = 'BEGIN THE ADVENTURE?';
const YES_LABEL = 'YES';
const NOT_YET_LABEL = 'NOT YET';

/** The dialog's own buttons; the question's are CSBWin's 210 and 211. */
const BTN_LOAD = 900;
const BTN_SAVE = 901;
const BTN_CLOSE = 902;
const BTN_SCROLL_UP = 903;
const BTN_SCROLL_DOWN = 904;
const BTN_EXPORT = 905;
const BTN_FACE = 906;
const BTN_DELETE = 907;
const BTN_ROW0 = 910;

/**
 * Everything the layout depends on, in one place, so `tools/checks/save-menu.ts` can
 * check it against the art instead of against a copy of these numbers.
 */
export const SAVE_MENU_GEOMETRY = {
  framePiece: PLATE_PIECE,
  panelPiece: PANEL_PIECE,
  buttonPiece: BUTTON_PIECE,
  dialog: DIALOG,
  listPanel: LIST_PANEL,
  riseTitlePanel: RISE_TITLE_PANEL,
  riseTitleFirstY: RISE_TITLE_FIRST_Y,
  previewPanel: PREVIEW_PANEL,
  buttonFrames: BUTTON_FRAMES,
  listInnerX1: LIST_INNER.x1,
  listInnerX2: LIST_INNER.x2,
  textX: TEXT_X,
  textMaxChars: TEXT_MAX_CHARS,
  rowFirstY: ROW_FIRST_Y,
  rowStep: ROW_STEP,
  rows: SAVE_MENU_ROWS,
  previewTextX: PREVIEW_TEXT_X,
  previewMaxChars: PREVIEW_MAX_CHARS,
  scrollbar: SCROLLBAR,
  arrowBox: ARROW_BOX,
  sliderMin: SCROLL_SLIDER_MIN,
  loadButtonId: BTN_LOAD,
  saveButtonId: BTN_SAVE,
  exportButtonId: BTN_EXPORT,
  faceButtonId: BTN_FACE,
  deleteButtonId: BTN_DELETE,
  closeButtonId: BTN_CLOSE,
} as const;

/* --------------------------------------------------------------------- state ---- */

/**
 * The disk menu (`full`), the entrance's RESUME and a lost game's restart (`loadOnly`),
 * or the entrance's RISE (`rise`): the load-only chooser over every data set's saves,
 * whose LOAD makes a new adventure from the chosen one and reads that
 * (`src/renderer/intro/PrisonDoor.ts`). RISE's says so in a title over its list, labels
 * LOAD RISE, and has NEW FACE in EXPORT's place (see "RISE").
 */
export type SaveMenuMode = 'full' | 'loadOnly' | 'rise';

/** What the bottom pair of buttons does. */
type SaveMenuAction = 'load' | 'save';

/** What a question in the dialog's place asks about: LOAD or SAVE across playthroughs, or DELETE. */
type SaveMenuQuestion = SaveMenuAction | 'delete';

/** A row of the list: the full menu's "new save", a playthrough's heading, or a save under one. */
type SaveMenuRow =
  | { kind: 'new' }
  | { kind: 'heading'; playthrough: Playthrough }
  | { kind: 'save'; entry: SaveEntry };

export interface SaveMenuState extends WheelTravel {
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
  /** The action the question on screen asks about, in the dialog's place, or `null`. */
  confirm: SaveMenuQuestion | null;
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
  /** The save a click last selected, and when (`nowMs`): a second click on it soon after is LOAD. */
  lastSaveClick: { id: string; atMs: number } | null;
  /** Where the pointer is, in screen coordinates, or `null` off the canvas (`saveMenuPointer`). */
  pointer: { x: number; y: number } | null;
  /** RISE's toggle, NEW FACE (`true`) or OLD FACE, or `null` where there is none (see "RISE"). */
  newFace: boolean | null;
  /** The save whose long press turned EXPORT into DELETE, by its id, or `null` (see "DELETE"). */
  deleteArmed: string | null;
  /** A press on a save's row still held, and the timer that arms DELETE for it, or `null`. */
  longPress: { row: number; timer: ReturnType<typeof setTimeout> } | null;
}

export function isSaveMenuOpen(ui: UIState): boolean {
  return ui.saveMenu !== null;
}

/** The menu as the dialog over the game: what the slot asks of it. */
const SAVE_MENU_DIALOG: Dialog = {
  draw: (ui) => drawSaveMenu(ui),
  click: (ui, x, y, buttons) => saveMenuClick(ui, x, y, buttons),
  key: (ui, key) => saveMenuKey(ui, key),
  // The menu draws itself at once (`scrollBy`), which leaves the VBL's frame nothing to draw.
  wheel: (ui, deltaY) => {
    saveMenuWheel(ui, deltaY);
    return false;
  },
  pointer: (ui, point) => saveMenuPointer(ui, point),
  drag: (ui, x, y) => saveMenuDrag(ui, x, y),
  release: (ui) => releaseLongPress(ui.saveMenu),
};

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
 *
 * While a recording plays (`RecordingPlayer`), the game opens the menu in a VBL and no
 * dialog shows: `TAG02076e`, the video mode and the clock held, which the recording's
 * logged `pause` and `tag0207cc` undo, as the menu's close did.
 */
export function openSaveMenu(ui: UIState, mode: SaveMenuMode = 'full'): void {
  if (ui.dialog) return;
  if (mode === 'full') tag02076e(ui.ctx);
  ui.ctx.loop.videoMode = mode === 'full' ? 'VM_LEFTMENU' : 'VM_CENTERMENU';
  const { input } = ui.ctx.systems.mainLoop;
  if (input.playing) {
    input.apply({ kind: 'pause', paused: true });
    return;
  }
  openDialog(ui, SAVE_MENU_DIALOG);
  ui.saveMenu = {
    mode,
    entries: [],
    unfolded: new Set(),
    rows: [],
    selected: -1,
    scrollTop: 0,
    wheelDelta: 0,
    busy: true,
    message: '',
    press: null,
    confirm: null,
    dropped: null,
    adventure: null,
    lastSaveClick: null,
    pointer: ui.hoverPoint,
    newFace: null,
    deleteArmed: null,
    longPress: null,
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
  releaseLongPress(ui.saveMenu);
  ui.saveMenu = null;
  closeDialog(ui);
  if (mode === 'full') ui.ctx.systems.mainLoop.input.apply({ kind: 'tag0207cc' });
}

/* ------------------------------------------------------------------ the list ---- */

/** List the saves again. Never throws — the failure becomes the dialog's message. */
async function refreshSaveMenu(ui: UIState): Promise<void> {
  const state = ui.saveMenu;
  if (!state) return;
  state.busy = true;
  state.message = savesDisabled(ui, state) ? SAVES_ARE_DISABLED : '';
  state.deleteArmed = null;
  ui.renderLastFrame();
  try {
    state.entries = await (state.mode === 'rise' ? ui.onListEverySave() : ui.onListSaves());
    if (state.mode === 'rise' && state.newFace === null && await ui.onHasNewFaces()) state.newFace = true;
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

/** An error's message, the browser's own among them, as the font draws it. */
function shortError(error: unknown): string {
  return foldToFont(error instanceof Error ? error.message : String(error));
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

/**
 * EXPORT hands out the selected save's file; a heading and "new save" have none. RISE's
 * dialog has no EXPORT: it raises a party, and hands nothing out.
 */
function canExport(state: SaveMenuState): boolean {
  return !state.busy && state.mode !== 'rise' && selectedEntry(state) !== null && !deleteShown(state);
}

/** Whether EXPORT's frame is DELETE: a long press armed it for the save selected (see "DELETE"). */
function deleteShown(state: SaveMenuState): boolean {
  return state.mode !== 'rise' && state.deleteArmed !== null && state.deleteArmed === selectedEntry(state)?.id;
}

function canDelete(state: SaveMenuState): boolean {
  return !state.busy && deleteShown(state);
}

/** RISE's NEW FACE / OLD FACE, in EXPORT's frame: a save need not be selected. */
function canToggleFace(state: SaveMenuState): boolean {
  return !state.busy && state.mode === 'rise' && state.newFace !== null;
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
  state.scrollTop = clampScrollTop(saveMenuList(state.mode), state.rows.length, state.scrollTop);
}

/** Scroll the list to the selection, by as little as shows it: what a move of it does. */
function showSelection(state: SaveMenuState): void {
  state.scrollTop = scrollToRow(saveMenuList(state.mode), state.rows.length, state.scrollTop, state.selected);
}

/** The scrollbar's slider over the list as it is scrolled (`Widgets.scrollSlider`). */
export function scrollSlider(state: SaveMenuState): { y1: number; y2: number } {
  return listSlider(saveMenuList(state.mode), state.rows.length, state.scrollTop);
}

/** Scroll the list by `rows`, the selection left where it is, in the panel or out of it. */
function scrollBy(ui: UIState, state: SaveMenuState, rows: number): void {
  state.scrollTop += rows;
  clampScroll(state);
  ui.renderLastFrame();
}

/* ------------------------------------------------------------------ drawing ---- */

/** The dialog with nothing in it: the frame, the two panels and the four button frames. */
export function drawDialog(ui: UIState, mode: SaveMenuMode = 'full'): void {
  drawPlate(ui, DIALOG);
  if (mode === 'rise') drawPanel(ui, RISE_TITLE_PANEL);
  drawPanel(ui, saveMenuList(mode).panel);
  drawPanel(ui, PREVIEW_PANEL);
  for (const frame of Object.values(BUTTON_FRAMES)) drawButtonFrame(ui, frame);
}

/** RISE's title, each line centred on its panel as a button's label is. */
function drawRiseTitle(ui: UIState): void {
  const x = buttonLabelAt(RISE_TITLE_PANEL).x;
  RISE_TITLE.forEach((line, i) => drawCentredText(ui, line, x, RISE_TITLE_FIRST_Y + i * ROW_STEP, MENU_TITLE1_COLOR));
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
    const deleted = state.confirm === 'delete' ? selectedEntry(state) : null;
    doMenu(ui, deleted ? SAVE_MENU_DELETE_QUESTION : SAVE_MENU_QUESTION, deleted ? formatSaveRow(deleted, TEXT_MAX_CHARS).trim() : null,
      [ACTION_LABELS[state.confirm], CANCEL_LABEL], true);
    if (state.press) drawMenuPress(ui, state.press, nowMs());
    return;
  }
  if (state.dropped) {
    const menu = importMenu(state.dropped.refusal);
    doMenu(ui, menu.title1, menu.title2, menu.options, true);
    if (state.press) drawMenuPress(ui, state.press, nowMs());
    return;
  }

  drawDialog(ui, state.mode);
  if (state.mode === 'rise') drawRiseTitle(ui);

  // The rows, and their scrollbar.
  const list = saveMenuList(state.mode);
  clampScroll(state);
  drawList(ui, list, state.rows.length, state.scrollTop, state.selected, (index) => rowText(state, state.rows[index]!));

  if (state.rows.length === 0 && !state.busy && !state.message) {
    // An empty list has to say so, which the load-only menu's can be; when the store
    // could not be listed, the message says why, and repeating that here would only
    // crowd the panel.
    drawText(ui, 'NO SAVED GAMES HERE', TEXT_X, list.rowFirstY);
  }

  // The preview's panel: the save LOAD would read, and on its last lines the message,
  // whatever went wrong or what was done, or else the import's hint.
  const message = wrapMessage(shownMessage(state), PREVIEW_MAX_CHARS).slice(0, MESSAGE_MAX_LINES);
  const messageRow = SAVE_MENU_ROWS - message.length;
  const previewed = loadTarget(state);
  if (previewed) {
    formatSavePreview(previewed, PREVIEW_MAX_CHARS).forEach((line, row) => {
      if (line && row < messageRow) drawText(ui, line, PREVIEW_TEXT_X, ROW_FIRST_Y + row * ROW_STEP);
    });
  }
  message.forEach((line, i) => {
    drawText(ui, line, PREVIEW_TEXT_X, ROW_FIRST_Y + (messageRow + i) * ROW_STEP, MENU_TITLE1_COLOR);
  });

  // A button that can do nothing is left unlabelled, as CSBWin leaves an empty save
  // slot unlabelled.
  if (canLoad(state)) drawButtonLabel(ui, BUTTON_FRAMES.load, state.mode === 'rise' ? RISE_LABEL : ACTION_LABELS.load);
  if (canSave(ui, state)) drawButtonLabel(ui, BUTTON_FRAMES.save, ACTION_LABELS.save);
  if (canExport(state)) drawButtonLabel(ui, BUTTON_FRAMES.export, EXPORT_LABEL);
  if (canDelete(state)) drawButtonLabel(ui, BUTTON_FRAMES.export, ACTION_LABELS.delete);
  if (canToggleFace(state)) drawButtonLabel(ui, BUTTON_FRAMES.export, state.newFace ? NEW_FACE_LABEL : OLD_FACE_LABEL);
  if (!state.busy) drawButtonLabel(ui, BUTTON_FRAMES.close, CLOSE_LABEL);

  if (state.press) drawMenuPress(ui, state.press, nowMs());
}

/** The message at the foot of the preview's panel: "WORKING...", the dialog's, or the import's hint. */
function shownMessage(state: SaveMenuState): string {
  if (state.busy) return WORKING_MESSAGE;
  if (state.message) return state.message;
  return pointsAtImportHint(state) ? SAVE_MENU_IMPORT_HINT : '';
}

/**
 * Whether the pointer is where the import's hint shows: on the preview's panel, or on
 * EXPORT's frame, labelled or not, unless it is DELETE. Nothing on the dialog says a
 * dropped file is imported, and a hint always up would take lines the preview needs.
 * RISE's dialog imports nothing (`saveMenuTakesDrops`), so it has no hint.
 */
function pointsAtImportHint(state: SaveMenuState): boolean {
  const at = state.pointer;
  return state.mode !== 'rise' && at !== null
    && (contains(PREVIEW_PANEL, at) || (contains(BUTTON_FRAMES.export, at) && !deleteShown(state)));
}

/**
 * The pointer moved, to `point` or off the canvas. Nothing is drawn here: says whether
 * what the dialog shows changed, the import's hint come up or gone, for the entrance's
 * chooser, which no VBL's frame draws again (`GameScreen.moveDialogPointer`). In play,
 * the frame a moved pointer asks for draws the dialog anyway.
 */
export function saveMenuPointer(ui: UIState, point: { x: number; y: number } | null): boolean {
  const state = ui.saveMenu;
  if (!state) return false;
  const shown = shownMessage(state);
  state.pointer = point;
  // A question in the dialog's place shows no message.
  if (state.confirm || state.dropped || state.adventure) return false;
  return shownMessage(state) !== shown;
}

/* ------------------------------------------------------------------ hit test ---- */

/**
 * The dialog's own button list, in the form of CSBWin's (`x2` and `y2` exclusive): the
 * four buttons, the scrollbar's two arrows, and the rows shown. Built
 * fresh on each click because the rows follow the scroll position.
 */
export function saveMenuButtons(state: SaveMenuState): UIButton[] {
  return [
    buttonOf(BUTTON_FRAMES.load, BTN_LOAD, 'saveMenu.load'),
    buttonOf(BUTTON_FRAMES.save, BTN_SAVE, 'saveMenu.save'),
    state.mode === 'rise'
      ? buttonOf(BUTTON_FRAMES.export, BTN_FACE, 'saveMenu.face')
      : deleteShown(state)
        ? buttonOf(BUTTON_FRAMES.export, BTN_DELETE, 'saveMenu.delete')
        : buttonOf(BUTTON_FRAMES.export, BTN_EXPORT, 'saveMenu.export'),
    buttonOf(BUTTON_FRAMES.close, BTN_CLOSE, 'saveMenu.close'),
    ...listButtons(saveMenuList(state.mode), state.rows.length, state.scrollTop,
      { up: BTN_SCROLL_UP, down: BTN_SCROLL_DOWN, row0: BTN_ROW0 }, 'saveMenu'),
  ];
}

/**
 * One iteration of `_WaitForMenuSelect`'s loop body. Called **straight from the DOM
 * mousedown handler**, not from the game's mouse queue: that is the modality CSBWin gets
 * by swapping button lists.
 */
export function saveMenuClick(ui: UIState, x: number, y: number, buttons: number): void {
  const state = ui.saveMenu;
  if (!state) return;
  // Nothing while a save, a load, a list or an import is under way: closing the menu
  // would let the game play on under it.
  if (state.busy) return;
  // Right-click closes the dialog, or cancels the question when one is up. CSBWin has no
  // such thing; see the divergence list.
  if ((buttons & 1) !== 0) {
    if ((state.confirm || state.dropped || state.adventure) && !state.press) cancelQuestion(ui, state);
    else closeSaveMenu(ui);
    return;
  }
  if (state.press) return;

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

  if (id === BTN_CLOSE) {
    // The screen is drawn again once the dialog is gone: the entrance's chooser waits on
    // that draw to know it has closed (`openLoadMenu`, `src/renderer/intro/BootSequence.ts`).
    beginPress(ui, state, saveMenuButtons(state), BTN_CLOSE, () => {
      closeSaveMenu(ui);
      ui.renderLastFrame();
    });
    return;
  }
  if (id === BTN_SCROLL_UP || id === BTN_SCROLL_DOWN) {
    scrollBy(ui, state, id === BTN_SCROLL_UP ? -1 : 1);
    return;
  }
  if (id >= BTN_ROW0 && id < BTN_ROW0 + saveMenuList(state.mode).rows) {
    const index = state.scrollTop + (id - BTN_ROW0);
    const row = state.rows[index];
    if (row) {
      // A second click on a save, soon after the first, is LOAD; a third starts again.
      const now = nowMs();
      const last = state.lastSaveClick;
      const second = row.kind === 'save' && last !== null && last.id === row.entry.id && now - last.atMs <= SAVE_MENU_DOUBLE_CLICK_MS;
      state.lastSaveClick = row.kind === 'save' && !second ? { id: row.entry.id, atMs: now } : null;
      if (index !== state.selected) state.deleteArmed = null;
      // A heading keeps its place in the list whichever way its saves go.
      state.selected = index;
      if (row.kind === 'save' && !second) holdLongPress(ui, state, index);
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
  if (id === BTN_DELETE && canDelete(state)) {
    beginPress(ui, state, saveMenuButtons(state), BTN_DELETE, () => {
      state.confirm = 'delete';
      ui.renderLastFrame();
    });
  }
  if (id === BTN_FACE && canToggleFace(state)) {
    beginPress(ui, state, saveMenuButtons(state), BTN_FACE, () => {
      state.newFace = !state.newFace;
      ui.renderLastFrame();
    });
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
function answerQuestion(ui: UIState, state: SaveMenuState, action: SaveMenuQuestion, choice: number): void {
  if (choice !== 1 && choice !== 2) return;
  beginPress(ui, state, menuButtonList(ui, 2, true), 209 + choice, () => {
    state.confirm = null;
    if (choice === 1) void runPending(ui, action);
    else ui.renderLastFrame();
  });
}

/**
 * A click on the menu about a dropped file, `choice` being `_WaitForMenuSelect`'s among
 * its `options`. The button flashes with the menu still up; then the list is back, or the
 * import goes on with the player's answer (`importAnswer`): LOOK FOR A BETTER MATCH to
 * the other sets, which may bring up the menu again, IMPORT ANYWAY to the store.
 */
function answerDropped(ui: UIState, state: SaveMenuState, dropped: NonNullable<SaveMenuState['dropped']>, options: number, choice: number): void {
  if (choice < 1 || choice > options) return;
  beginPress(ui, state, menuButtonList(ui, options, true), 209 + choice, () => {
    state.dropped = null;
    const answer = importAnswer(dropped.refusal, choice);
    if (answer) void runImport(ui, dropped.file, answer);
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

/* ------------------------------------------------------------ the long press ---- */

/**
 * A press on the save of row `row`: held `SAVE_MENU_LONG_PRESS_MS` on that row, it turns
 * EXPORT into DELETE for that save (see "DELETE"). Released before, or moved off the
 * row, it was a click.
 */
function holdLongPress(ui: UIState, state: SaveMenuState, row: number): void {
  releaseLongPress(state);
  if (state.mode === 'rise') return;
  const timer = setTimeout(() => {
    state.longPress = null;
    if (ui.saveMenu === state) armDelete(ui, state);
  }, SAVE_MENU_LONG_PRESS_MS);
  state.longPress = { row, timer };
}

/** The press on a row let go of, or moved off it: no long press. */
function releaseLongPress(state: SaveMenuState | null): void {
  if (!state?.longPress) return;
  clearTimeout(state.longPress.timer);
  state.longPress = null;
}

/** The pointer moved with a press held: off the row pressed, it is no long press. */
export function saveMenuDrag(ui: UIState, x: number, y: number): void {
  const state = ui.saveMenu;
  const press = state?.longPress;
  if (!state || !press) return;
  if (searchButtonList(saveMenuButtons(state), x, y, 2) !== BTN_ROW0 + press.row - state.scrollTop) releaseLongPress(state);
}

/**
 * EXPORT turned into DELETE for the save selected: a long press's, or the Delete key's.
 * Nothing while the dialog is working, pressing a button or asking.
 */
function armDelete(ui: UIState, state: SaveMenuState): void {
  const entry = selectedEntry(state);
  if (!entry || state.mode === 'rise' || state.busy || state.press || state.confirm || state.dropped || state.adventure) return;
  state.deleteArmed = entry.id;
  state.lastSaveClick = null;
  state.message = '';
  ui.renderLastFrame();
}

/* ------------------------------------------------------ the press animation ---- */

/**
 * `_WaitForMenuSelect` flashes the chosen button for two five-VBL passes and only
 * *then* returns the choice (`doc/CSBwin-src/Menu.cpp:100-180`), so the action happens
 * after the animation here too. The game clock is stopped, so the frames come from the
 * page's animation clock (`playMenuPress`) rather than from the tick.
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
  const press: MenuPress = { buttonId, rect, startedMs: nowMs() };
  state.press = press;
  playMenuPress(ui, press, () => ui.saveMenu?.press === press, () => {
    state.press = null;
    ui.renderLastFrame();
    then();
  });
}

/* -------------------------------------------------------------- the actions ---- */

async function runPending(ui: UIState, action: SaveMenuQuestion | 'export'): Promise<void> {
  const state = ui.saveMenu;
  if (!state) return;
  state.busy = true;
  state.message = '';
  ui.renderLastFrame();
  try {
    if (action === 'load') await doLoad(ui, state);
    else if (action === 'save') await doSave(ui, state);
    else if (action === 'delete') await doDelete(ui, state);
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
    adventure = await ui.onMakeNewAdventure(entry, state.newFace === true);
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
 * The selected save, deleted from the store, and the list read again: the save after it
 * in its playthrough selected, or else the one before, or else the row that took its
 * heading's place. The game stays as it is.
 */
async function doDelete(ui: UIState, state: SaveMenuState): Promise<void> {
  const entry = selectedEntry(state);
  if (entry) {
    const siblings = playthroughsOf(state.entries).find((p) => p.id === entry.playthrough)?.saves ?? [];
    const at = siblings.findIndex((e) => e.id === entry.id);
    const neighbour = siblings[at + 1] ?? siblings[at - 1] ?? null;
    const heading = state.rows.findIndex((row) => row.kind === 'heading' && row.playthrough.id === entry.playthrough);
    await ui.onDeleteSave(entry);
    state.entries = await ui.onListSaves();
    if (neighbour && state.entries.some((e) => e.id === neighbour.id)) {
      selectSave(ui, state, neighbour);
    } else {
      layoutRows(ui, state);
      state.selected = Math.min(heading, state.rows.length - 1);
      showSelection(state);
    }
    state.message = SAVE_MENU_DELETED;
  }
  state.deleteArmed = null;
  state.busy = false;
  ui.renderLastFrame();
}

/**
 * Whether a file dropped on the page is the dialog's import: in the disk menu and the
 * load-only chooser. RISE's dialog raises a party from a save already stored; a DM save
 * is imported in a DM set, and a CSB one through the entrance's RESUME.
 */
export function saveMenuTakesDrops(ui: UIState): boolean {
  return ui.saveMenu !== null && ui.saveMenu.mode !== 'rise';
}

/**
 * A file dropped on the page while the dialog is up: the import. Says whether the dialog
 * took it, which it does not while it is working, pressing a button or asking, nor ever
 * in RISE's dialog.
 */
export function saveMenuDrop(ui: UIState, file: ImportedFile): boolean {
  const state = ui.saveMenu;
  if (!state || !saveMenuTakesDrops(ui) || state.busy || state.press || state.confirm || state.dropped || state.adventure) return false;
  void runImport(ui, file, null);
  return true;
}

/**
 * Take a dropped file into the store, with the player's `answer` once they have given one
 * for a slightly different dungeon. Stored, it is listed and selected; not stored, the
 * menu about it comes up (`importMenu`). A file that does not read throws, and its line
 * is the dialog's message. Never throws.
 */
async function runImport(ui: UIState, file: ImportedFile, answer: ImportAnswer | null): Promise<void> {
  const state = ui.saveMenu;
  if (!state) return;
  state.busy = true;
  state.message = '';
  ui.renderLastFrame();
  try {
    const result = await ui.onImportSave(file, answer);
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
 * A list needs arrows, and Esc is the close every player will try; both are additions,
 * recorded as such. Up and down move the selection over the rows shown; right unfolds
 * the heading selected and left folds it, and from a save left goes to its heading.
 * Delete, and Backspace, which a Mac's delete key is, turn EXPORT into DELETE for the
 * save selected, as a long press on it does.
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
      moveSelection(ui, state, -saveMenuList(state.mode).rows);
      return true;
    case 'PageDown':
      moveSelection(ui, state, saveMenuList(state.mode).rows);
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
    case 'Delete':
    case 'Backspace':
      armDelete(ui, state);
      return true;
    default:
      return true;
  }
}

function moveSelection(ui: UIState, state: SaveMenuState, delta: number): void {
  if (state.rows.length === 0) return;
  const next = Math.max(0, Math.min(state.rows.length - 1, (state.selected < 0 ? 0 : state.selected) + delta));
  if (next !== state.selected) state.deleteArmed = null;
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
    state.deleteArmed = null;
  } else {
    return;
  }
  state.message = '';
  showSelection(state);
  ui.renderLastFrame();
}

/** The wheel scrolls the list by its travel (`wheelRows`), without moving the selection. */
export function saveMenuWheel(ui: UIState, delta: number): boolean {
  const state = ui.saveMenu;
  if (!state) return false;
  if (state.confirm || state.dropped || state.adventure) return true;
  const rows = wheelRows(state, delta);
  if (rows !== 0) scrollBy(ui, state, rows);
  return true;
}
