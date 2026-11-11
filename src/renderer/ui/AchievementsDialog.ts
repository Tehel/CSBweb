/**
 * The achievements dialog: the set's achievements, unlocked or not, for the playthrough
 * being played (`doc/ACHIEVEMENTS.md` → "The page"), in the game's own screen, as the
 * dialog over the game (`Dialog.ts`), from the widget kit (`Widgets.ts`). It is the
 * port's own.
 *
 * ## The dialog
 *
 * It takes the whole screen, 320x200, as the settings do. From the top:
 *
 * - **The title line**: ACHIEVEMENTS and how many of them the game has unlocked, on a
 *   panel, and at its right CLOSE, where the settings have theirs.
 * - **The list**, a row an achievement in the file's order: its name and its tier, in
 *   the tier's colour once the game has unlocked it (`TIER_COLORS`), grey until then.
 *   The selected row is inverted, the first when it opens. A click selects a row, the
 *   wheel and the scrollbar's arrows scroll the list, and the up and down arrows move
 *   the selection.
 * - **The selected achievement**, on a panel at the foot: whether it is unlocked, and its
 *   text, cut into lines at its words. One that needs the whole game, in a game whose
 *   history starts at a save that kept none, says it cannot be unlocked in this game
 *   (`AchievementState`).
 *
 * The rows are the tracker's (`AchievementsView`): the game's history, the one its save's
 * row kept, so a save loaded shows what that save had unlocked.
 *
 * ## Opening and closing
 *
 * GAME's ACHIEVEMENTS button in the settings opens it in the settings' place
 * (`SettingsDialog.ts`); it is inert where the page tracks no achievements, a recording
 * played back. Esc, CLOSE or a right click close it, back to the game. While it is up the
 * clock is held, as under every dialog, and it is shown through the interface's palette
 * whole, as the settings are.
 */
import type { Rect, UIButton } from '../../data/tables/UITables';
import type { AchievementProof } from '../../data/saves/AchievementStore';
import type { AchievementDef } from '../../engine/achievements/AchievementFile';
import { TIER_COLORS } from './AchievementBanner';
import { closeDialog, openDialog, type Dialog, type DialogPoint } from './Dialog';
import { searchButtonList } from './HitTest';
import { MENU_TITLE1_COLOR } from './Menu';
import type { UIState } from './UIState';
import {
  CHAR_WIDTH,
  DIM_COLOR,
  LINE_STEP,
  LIT_COLOR,
  LOW_BUTTON_HEIGHT,
  buttonLabelAt,
  buttonOf,
  clampScrollTop,
  drawButton,
  drawCentredText,
  drawList,
  drawPanel,
  drawPlate,
  drawText,
  listButtons,
  listIn,
  listInner,
  listTextX,
  scrollToRow,
  wheelRows,
  type ButtonLook,
  type WheelTravel,
} from './Widgets';

/** What the dialog shows of the game's achievements: the tracker's (`PageAchievements.view`). */
export interface AchievementsView {
  /** The set's achievements, in the file's order. */
  readonly defs: readonly AchievementDef[];
  /** Those the game's history has unlocked. */
  readonly unlocked: ReadonlySet<string>;
  /** Whether the history goes back to the game's start, so a needs-the-whole-game one can unlock. */
  readonly whole: boolean;
  /** How far the proof of the playthrough's unlock `id` has got on the server (`doc/ACHIEVEMENTS.md` → "Proofs"), `null` for none stored. */
  readonly proof: (id: string) => AchievementProof | null;
}

/** What the detail says of an unlock by its proof: verified by the server's replay, or a replay that did not unlock it. */
const PROOF_STATUS: Record<AchievementProof, string> = { unverified: 'UNLOCKED', verified: 'UNLOCKED, VERIFIED', dropped: 'UNLOCKED, NOT VERIFIED' };

/* ------------------------------------------------------------------ geometry ---- */

/** All in screen coordinates, the title line and CLOSE where the settings have theirs. */
const DIALOG: Rect = { x1: 0, y1: 0, x2: 319, y2: 199 };
const TITLE_Y1 = 10;
const TITLE_Y2 = TITLE_Y1 + LOW_BUTTON_HEIGHT - 1;
export const CLOSE_FRAME: Rect = { x1: 250, y1: TITLE_Y1, x2: 309, y2: TITLE_Y2 };
const TITLE_PANEL: Rect = { x1: 10, y1: TITLE_Y1, x2: CLOSE_FRAME.x1 - 10, y2: TITLE_Y2 };
/** The selected achievement's panel: five lines of text, at the foot of the plate. */
export const DETAIL_LINES = 5;
export const DETAIL_PANEL: Rect = { x1: 10, y1: 189 - (DETAIL_LINES * LINE_STEP + 5), x2: 309, y2: 189 };
/** The list's panel, between the title line and the detail, six rows of the plate from each. */
export const LIST_PANEL: Rect = { x1: 10, y1: TITLE_Y2 + 7, x2: 309, y2: DETAIL_PANEL.y1 - 7 };
export const LIST = listIn(LIST_PANEL);
/** The characters a row holds, up to the scrollbar. */
const ROW_CHARS = Math.floor((listInner(LIST).x2 - listTextX(LIST) + 1) / CHAR_WIDTH);
/** The characters a line of the detail holds. */
export const DETAIL_CHARS = Math.floor((DETAIL_PANEL.x2 - 1 - (DETAIL_PANEL.x1 + 4) + 1) / CHAR_WIDTH);

export const TITLE = 'ACHIEVEMENTS';
export const CLOSE_LABEL = 'CLOSE';

/* --------------------------------------------------------------------- state ---- */

export interface AchievementsDialogState extends WheelTravel {
  /** The first row shown. */
  scrollTop: number;
  /** The row selected, whose achievement the detail shows. */
  selected: number;
  /** Where the pointer is, in screen coordinates, or `null` off the canvas. */
  pointer: DialogPoint;
}

const ACHIEVEMENTS_DIALOG: Dialog = {
  name: 'achievements',
  uiPalette: true,
  draw: (ui) => drawAchievementsDialog(ui),
  click: (ui, x, y, buttons) => achievementsDialogClick(ui, x, y, buttons),
  key: (ui, _key, code) => achievementsDialogKey(ui, code),
  wheel: (ui, deltaY) => achievementsDialogWheel(ui, deltaY),
  pointer: (ui, point) => achievementsDialogPointer(ui, point),
};

/**
 * Put the dialog up on the first achievement, where the page tracks achievements and no
 * other dialog is up. Says whether it did.
 */
export function openAchievementsDialog(ui: UIState): boolean {
  if (ui.dialog || !ui.achievements()) return false;
  openDialog(ui, ACHIEVEMENTS_DIALOG);
  ui.achievementsDialog = { scrollTop: 0, selected: 0, pointer: ui.hoverPoint, wheelDelta: 0 };
  return true;
}

export function closeAchievementsDialog(ui: UIState): void {
  if (!ui.achievementsDialog) return;
  ui.achievementsDialog = null;
  closeDialog(ui);
}

/* ---------------------------------------------------------------- the controls ---- */

const BTN_CLOSE = 1;
const BTN_UP = 2;
const BTN_DOWN = 3;
const BTN_ROW0 = 10;

function achievementsDialogButtons(state: AchievementsDialogState, count: number): UIButton[] {
  return [
    buttonOf(CLOSE_FRAME, BTN_CLOSE, 'achievements.close'),
    ...listButtons(LIST, count, state.scrollTop, { up: BTN_UP, down: BTN_DOWN, row0: BTN_ROW0 }, 'achievements.list'),
  ];
}

function hovered(state: AchievementsDialogState, count: number): number {
  const at = state.pointer;
  return at ? searchButtonList(achievementsDialogButtons(state, count), Math.floor(at.x), Math.floor(at.y), 2) : 0;
}

/* ------------------------------------------------------------------- drawing ---- */

/** A row: the name, and the tier at the row's end. */
export function rowText(def: AchievementDef): string {
  const tier = def.tier.toUpperCase();
  return `${def.name.toUpperCase().slice(0, ROW_CHARS - tier.length - 1).padEnd(ROW_CHARS - tier.length)}${tier}`;
}

/** `text` cut into lines of `width` characters at its spaces, a word longer than a line cut where it must. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    let rest = word;
    while (rest.length > width) {
      if (line) { lines.push(line); line = ''; }
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (!line) line = rest;
    else if (line.length + 1 + rest.length <= width) line += ` ${rest}`;
    else { lines.push(line); line = rest; }
  }
  if (line) lines.push(line);
  return lines;
}

/** What the detail says of `def`: whether it is unlocked, and the server's verdict on it, and its text. */
export function detailLines(view: AchievementsView, def: AchievementDef): string[] {
  const status = view.unlocked.has(def.id) ? PROOF_STATUS[view.proof(def.id) ?? 'unverified']
    : def.whole && !view.whole ? 'LOCKED: NEEDS A GAME PLAYED FROM ITS START' : 'LOCKED';
  return [status, ...wrapText(def.text.toUpperCase(), DETAIL_CHARS)].slice(0, DETAIL_LINES);
}

export function drawAchievementsDialog(ui: UIState): void {
  const state = ui.achievementsDialog;
  const view = ui.achievements();
  if (!state || !view) return;
  const { defs, unlocked } = view;
  const over = hovered(state, defs.length);
  const look: ButtonLook = over === BTN_CLOSE ? 'hover' : 'raised';

  drawPlate(ui, DIALOG);
  drawPanel(ui, TITLE_PANEL);
  const title = buttonLabelAt(TITLE_PANEL);
  const count = defs.filter((def) => unlocked.has(def.id)).length;
  drawCentredText(ui, `${TITLE} ${count}/${defs.length}`, title.x, title.y, MENU_TITLE1_COLOR);
  drawButton(ui, CLOSE_FRAME, CLOSE_LABEL, look);

  drawPanel(ui, LIST_PANEL);
  drawList(ui, LIST, defs.length, state.scrollTop, state.selected, (i) => rowText(defs[i]!),
    (i) => (unlocked.has(defs[i]!.id) ? TIER_COLORS[defs[i]!.tier] : DIM_COLOR));

  drawPanel(ui, DETAIL_PANEL);
  const def = defs[state.selected];
  if (!def) return;
  detailLines(view, def).forEach((line, i) => {
    drawText(ui, line, DETAIL_PANEL.x1 + 4, DETAIL_PANEL.y1 + 9 + i * LINE_STEP, i === 0 && unlocked.has(def.id) ? LIT_COLOR : undefined);
  });
}

/* ------------------------------------------------------------------- the input ---- */

/** A click: a right one closes it, a left one on CLOSE too; on a row it selects it, on an arrow it scrolls. */
export function achievementsDialogClick(ui: UIState, x: number, y: number, buttons: number): void {
  const state = ui.achievementsDialog;
  const count = ui.achievements()?.defs.length ?? 0;
  if (!state) return;
  const id = searchButtonList(achievementsDialogButtons(state, count), Math.floor(x), Math.floor(y), buttons);
  if ((buttons & 1) !== 0 || id === BTN_CLOSE) {
    closeAchievementsDialog(ui);
    return;
  }
  if (id === BTN_UP || id === BTN_DOWN) {
    state.scrollTop = clampScrollTop(LIST, count, state.scrollTop + (id === BTN_UP ? -1 : 1));
    return;
  }
  if (id >= BTN_ROW0) state.selected = state.scrollTop + id - BTN_ROW0;
}

/** Esc closes it; the up and down arrows move the selection, the list scrolled to it. */
export function achievementsDialogKey(ui: UIState, code: string): void {
  const state = ui.achievementsDialog;
  const count = ui.achievements()?.defs.length ?? 0;
  if (!state) return;
  if (code === 'Escape') {
    closeAchievementsDialog(ui);
    return;
  }
  const step = code === 'ArrowUp' ? -1 : code === 'ArrowDown' ? 1 : 0;
  if (step === 0 || count === 0) return;
  state.selected = Math.max(0, Math.min(count - 1, state.selected + step));
  state.scrollTop = scrollToRow(LIST, count, state.scrollTop, state.selected);
}

/** The wheel scrolls the list. Says whether it moved. */
export function achievementsDialogWheel(ui: UIState, deltaY: number): boolean {
  const state = ui.achievementsDialog;
  const count = ui.achievements()?.defs.length ?? 0;
  if (!state) return false;
  const top = clampScrollTop(LIST, count, state.scrollTop + wheelRows(state, deltaY));
  if (top === state.scrollTop) return false;
  state.scrollTop = top;
  return true;
}

/** The pointer moved. Nothing is drawn here: says whether CLOSE's look changed. */
export function achievementsDialogPointer(ui: UIState, point: DialogPoint): boolean {
  const state = ui.achievementsDialog;
  if (!state) return false;
  const count = ui.achievements()?.defs.length ?? 0;
  const was = hovered(state, count) === BTN_CLOSE;
  state.pointer = point;
  return (hovered(state, count) === BTN_CLOSE) !== was;
}
