/**
 * The champion dialog: the party's permanent numbers, a column a champion, in the game's
 * own screen, as the dialog over the game (`Dialog.ts`), from the widget kit
 * (`Widgets.ts`). It is the port's own: CSBWin shows a champion's levels and attributes
 * only one at a time, in the inventory, and never a sub-skill.
 *
 * ## The dialog
 *
 * It takes the whole screen, 320x200, as the settings do. From the top:
 *
 * - **The title line**: two tabs, ATTRIBUTES and SKILLS, the selected one pressed, and at
 *   its right CLOSE.
 * - **The table**, on a panel down to the plate's foot: a line of the champions' names,
 *   a blank line, then the tab's rows, each a label and four columns. ATTRIBUTES holds the
 *   levels of the four classes, the maxima of health, stamina and mana, and the seven
 *   attributes' maxima, Luck included, which the game never shows; SKILLS the sixteen
 *   sub-skills, four to a class, in skill order.
 *
 * A level or a sub-skill is its mastery, as `DetermineMastery(chIdx, skill | 0xc000)`
 * counts it, with neither a potion's boost nor a held object's (`doc/TRAINING.md`), and
 * beside it a bar: how far the experience it counts has got towards the next mastery
 * (`skillProgress`). Stamina is shown as the inventory shows it, a tenth of the stored
 * value. A dead champion's column is dim; an empty slot's is blank.
 *
 * Nothing is highlighted as it changes: the clock is held while the dialog is up.
 *
 * ## Opening and closing
 *
 * Only with CHAMPION VIEW on (`SettingsValues.championView`): the key bound to
 * CHAMPIONS, which no preset binds, or a long press on a champion's stat bars
 * (`GameInput`), which marks that champion's column, the name and every reading lit.
 * Esc, the CHAMPIONS key again, CLOSE or a right click close it. While it is up the clock
 * is held, as under every dialog, and the game is left as it was. It is shown through the
 * interface's palette whole, as the settings are (`SettingsDialog.ts` → "The palette").
 */
import type { Rect, UIButton } from '../../data/tables/UITables';
import { attributeMaximum } from '../../engine/attributes';
import type { Champion } from '../../engine/gameTypes';
import { determineMastery, ensureSkills } from '../../engine/skills';
import { fillRectIndex } from '../csbwin/CanvasBlitter';
import { closeDialog, openDialog, type Dialog, type DialogPoint } from './Dialog';
import { searchButtonList } from './HitTest';
import { keyAction } from './Keyboard';
import { searchMouseButtons } from './Mouse';
import { MENU_OPTION_COLOR } from './Menu';
import type { UIState } from './UIState';
import {
  CHAR_WIDTH,
  DIM_COLOR,
  LINE_STEP,
  LIT_COLOR,
  LOW_BUTTON_HEIGHT,
  buttonOf,
  drawButton,
  drawCentredText,
  drawPanel,
  drawPlate,
  drawText,
  framesAcross,
  type ButtonLook,
} from './Widgets';

/* ------------------------------------------------------------------ geometry ---- */

/** All in screen coordinates, the title line where the settings have theirs. */
const DIALOG: Rect = { x1: 0, y1: 0, x2: 319, y2: 199 };
const TITLE_Y1 = 10;
const TITLE_Y2 = TITLE_Y1 + LOW_BUTTON_HEIGHT - 1;
export const CLOSE_FRAME: Rect = { x1: 250, y1: TITLE_Y1, x2: 309, y2: TITLE_Y2 };
/** The two tabs, as far as graphic 0's ten pixels short of CLOSE. */
export const TAB_FRAMES = framesAcross({ x1: 10, y1: TITLE_Y1, x2: CLOSE_FRAME.x1 - 10, y2: TITLE_Y2 }, 2);
/** The table's panel: six rows of the plate under the title line, down to the plate's frame. */
export const TABLE_PANEL: Rect = { x1: 10, y1: TITLE_Y2 + 7, x2: 309, y2: 189 };
/** The lines the panel holds, two pixels of it above the first and below the last, as a list's. */
export const TABLE_LINES = Math.floor((TABLE_PANEL.y2 - TABLE_PANEL.y1 - 6) / LINE_STEP);
/** Line `line`'s baseline. */
export function lineY(line: number): number {
  return TABLE_PANEL.y1 + 9 + line * LINE_STEP;
}

/** The labels' column, past the panel's edge: ANTI-MAGIC's ten characters. */
export const LABEL_X = TABLE_PANEL.x1 + 4;
export const LABEL_CHARS = 10;
/** The champions' four columns, right of the labels'. */
export const COLUMN_X0 = LABEL_X + LABEL_CHARS * CHAR_WIDTH + 2;
export const COLUMN_WIDTH = 57;
/** A reading is right-aligned in the column's first three characters. */
export const VALUE_CHARS = 3;
/** The bar: right of the reading, a character's width short of the column's end. */
export const BAR_X1 = VALUE_CHARS * CHAR_WIDTH + 3;
export const BAR_X2 = COLUMN_WIDTH - 1 - CHAR_WIDTH;

export function columnX(chIdx: number): number {
  return COLUMN_X0 + chIdx * COLUMN_WIDTH;
}

/** The bar beside a reading on the line whose baseline is `y`: as tall as a capital, outline and all. */
export function barRect(chIdx: number, y: number): Rect {
  const x = columnX(chIdx);
  return { x1: x + BAR_X1, y1: y - 4, x2: x + BAR_X2, y2: y };
}

/* ------------------------------------------------------------------ contents ---- */

export const PARTY_SIZE = 4;

/** `d.Pointer16596` (`doc/CSBwin-src/CSBCode.cpp:373-376`), the four classes. */
const CLASS_NAMES = ['FIGHTER', 'NINJA', 'PRIEST', 'WIZARD'];
/** The inventory's attribute names (`Character.ts`), and Luck, attribute 0 (`doc/CSBwin-src/CSB.h:631-637`). */
const ATTRIBUTE_NAMES = ['LUCK', 'STRENGTH', 'DEXTERITY', 'WISDOM', 'VITALITY', 'ANTI-MAGIC', 'ANTI-FIRE'];
/** Skills 4 to 19, four to a class (`doc/TRAINING.md`). */
const SUBSKILL_NAMES = [
  'SWING', 'THRUST', 'CLUB', 'PARRY',
  'STEAL', 'FIGHT', 'THROW', 'SHOOT',
  'IDENTIFY', 'HEAL', 'INFLUENCE', 'DEFEND',
  'FIRE', 'AIR', 'EARTH', 'WATER',
];

/** A row of the table: its label, and what a champion's cell reads. */
export interface TableRow {
  readonly label: string;
  /** The reading; a skill's carries its bar too. */
  readonly read: (champion: Champion) => Reading;
}

export interface Reading {
  readonly value: number;
  /** How far towards the next mastery, 0 to 1, for a level or a sub-skill. */
  readonly progress?: number;
}

/** A blank line between two groups of rows. */
const GAP = null;

export type ChampionTab = 'attributes' | 'skills';

/**
 * Skill `skill`'s mastery and its progress: the experience `DetermineMastery` counts, a
 * sub-skill's own and its class's halved, from where the mastery began, `500 × 2^(m-2)`,
 * to where the next does (`doc/TRAINING.md`).
 */
export function skillProgress(champion: Champion, skill: number): Required<Reading> {
  const skills = ensureSkills(champion.skills ?? []);
  const own = skills[skill].experience;
  const counted = skill < 4 ? own : Math.floor((own + skills[(skill - 4) >> 2].experience) / 2);
  const mastery = determineMastery(champion, skill | 0xc000);
  const low = mastery <= 1 ? 0 : 500 * 2 ** (mastery - 2);
  const high = 500 * 2 ** (mastery - 1);
  return { value: mastery, progress: Math.max(0, Math.min(1, (counted - low) / (high - low))) };
}

const skillRow = (label: string, skill: number): TableRow => ({ label, read: (c) => skillProgress(c, skill) });

/** The tabs, in their row's order: a label, and the rows, a `null` for a blank line. */
export const TABS: ReadonlyArray<{ readonly tab: ChampionTab; readonly label: string; readonly rows: ReadonlyArray<TableRow | null> }> = [
  {
    tab: 'attributes',
    label: 'ATTRIBUTES',
    rows: [
      ...CLASS_NAMES.map((name, skill) => skillRow(name, skill)),
      GAP,
      { label: 'HEALTH', read: (c) => ({ value: c.attributes.maxHealth }) },
      { label: 'STAMINA', read: (c) => ({ value: Math.floor(c.attributes.maxStamina / 10) }) },
      { label: 'MANA', read: (c) => ({ value: c.attributes.maxMana }) },
      GAP,
      ...ATTRIBUTE_NAMES.map((label, i): TableRow => ({
        label,
        read: (c) => ({ value: c.attributes.stats[i] ? attributeMaximum(c.attributes.stats[i]) : 0 }),
      })),
    ],
  },
  {
    tab: 'skills',
    label: 'SKILLS',
    rows: SUBSKILL_NAMES.map((name, i) => skillRow(name, 4 + i)),
  },
];
export const CLOSE_LABEL = 'CLOSE';

/* --------------------------------------------------------------------- state ---- */

export interface ChampionDialogState {
  tab: ChampionTab;
  /** The champion whose column is marked, the one whose bars were held, or `null`. */
  marked: number | null;
  /** Where the pointer is, in screen coordinates, or `null` off the canvas. */
  pointer: DialogPoint;
}

export function isChampionDialogOpen(ui: UIState): boolean {
  return ui.championDialog !== null;
}

const CHAMPION_DIALOG: Dialog = {
  uiPalette: true,
  draw: (ui) => drawChampionDialog(ui),
  click: (ui, x, y, buttons) => championDialogClick(ui, x, y, buttons),
  key: (ui, _key, code) => {
    if (code === 'Escape' || keyAction(code) === 'champions') closeChampionDialog(ui);
  },
  wheel: () => {},
  pointer: (ui, point) => championDialogPointer(ui, point),
};

/**
 * Put the dialog up on ATTRIBUTES, `marked`'s column marked, with CHAMPION VIEW on and no
 * other dialog up. Says whether it did.
 */
export function openChampionDialog(ui: UIState, marked: number | null = null): boolean {
  if (ui.dialog || !ui.settings.values.championView) return false;
  openDialog(ui, CHAMPION_DIALOG);
  ui.championDialog = { tab: 'attributes', marked, pointer: ui.hoverPoint };
  return true;
}

export function closeChampionDialog(ui: UIState): void {
  if (!ui.championDialog) return;
  ui.championDialog = null;
  closeDialog(ui);
}

/**
 * The champion whose stat bars a left press at `(x, y)` is on, where CHAMPION VIEW holds
 * it back for the long press that opens the dialog (`GameInput`): where the left click is
 * the box's inventory button, 7-10, as `searchMouseButtons` finds it, not the name and
 * hands' 12-15, and a champion is in the box. Else -1.
 */
export function championBarsAt(ui: UIState, x: number, y: number): number {
  if (!ui.settings.values.championView) return -1;
  const id = searchMouseButtons(ui, x, y, 2);
  return id >= 7 && id <= 10 && id - 7 < ui.ctx.party.state.champions.length ? id - 7 : -1;
}

/* ---------------------------------------------------------------- the controls ---- */

const BTN_CLOSE = 1;
const BTN_TAB0 = 10;

/** The dialog's button list, in the form of CSBWin's: CLOSE, and the tabs. */
export function championDialogButtons(): UIButton[] {
  return [
    buttonOf(CLOSE_FRAME, BTN_CLOSE, 'champions.close'),
    ...TABS.map((t, i) => buttonOf(TAB_FRAMES[i], BTN_TAB0 + i, `champions.tab.${t.tab}`)),
  ];
}

function hovered(state: ChampionDialogState): number {
  const at = state.pointer;
  return at ? searchButtonList(championDialogButtons(), Math.floor(at.x), Math.floor(at.y), 2) : 0;
}

/* ------------------------------------------------------------------- drawing ---- */

export function drawChampionDialog(ui: UIState): void {
  const state = ui.championDialog;
  if (!state) return;
  const over = hovered(state);
  const look = (id: number, pressed = false): ButtonLook => (pressed ? 'pressed' : over === id ? 'hover' : 'raised');

  drawPlate(ui, DIALOG);
  TABS.forEach((t, i) => drawButton(ui, TAB_FRAMES[i], t.label, look(BTN_TAB0 + i, t.tab === state.tab)));
  drawButton(ui, CLOSE_FRAME, CLOSE_LABEL, look(BTN_CLOSE));

  drawPanel(ui, TABLE_PANEL);
  const champions = ui.ctx.party.state.champions;
  const rows = TABS.find((t) => t.tab === state.tab)?.rows ?? [];
  for (let chIdx = 0; chIdx < PARTY_SIZE; chIdx++) {
    const champion = champions[chIdx];
    if (!champion) continue;
    const color = columnColor(state, champion, chIdx);
    drawCentredText(ui, champion.name, columnX(chIdx) + (COLUMN_WIDTH >> 1), lineY(0), color);
    rows.forEach((row, i) => {
      if (row) drawReading(ui, chIdx, lineY(2 + i), row.read(champion), color);
    });
  }
  rows.forEach((row, i) => {
    if (row) drawText(ui, row.label, LABEL_X, lineY(2 + i));
  });
}

/** A column's colour: lit where marked, dim for a dead champion, else the option colour. */
export function columnColor(state: ChampionDialogState, champion: Champion, chIdx: number): number {
  if (state.marked === chIdx) return LIT_COLOR;
  return champion.attributes.health === 0 ? DIM_COLOR : MENU_OPTION_COLOR;
}

/**
 * A reading on the line whose baseline is `y`: its number right-aligned in the column's
 * first three characters, and a level's or a sub-skill's bar, an outline filled from the
 * left as far as its progress.
 */
function drawReading(ui: UIState, chIdx: number, y: number, reading: Reading, color: number): void {
  const text = String(reading.value);
  drawText(ui, text, columnX(chIdx) + (VALUE_CHARS - text.length) * CHAR_WIDTH, y, color);
  if (reading.progress === undefined) return;
  const bar = barRect(chIdx, y);
  const buf = ui.screenIndexBuffer;
  fillRectIndex(buf, { x1: bar.x1, y1: bar.y1, x2: bar.x2, y2: bar.y1 }, color);
  fillRectIndex(buf, { x1: bar.x1, y1: bar.y2, x2: bar.x2, y2: bar.y2 }, color);
  fillRectIndex(buf, { x1: bar.x1, y1: bar.y1, x2: bar.x1, y2: bar.y2 }, color);
  fillRectIndex(buf, { x1: bar.x2, y1: bar.y1, x2: bar.x2, y2: bar.y2 }, color);
  const filled = barFill(bar, reading.progress);
  if (filled > 0) fillRectIndex(buf, { x1: bar.x1 + 1, y1: bar.y1 + 1, x2: bar.x1 + filled, y2: bar.y2 - 1 }, color);
}

/** How many of the bar's inside columns `progress` fills: none at 0, all at 1. */
export function barFill(bar: Rect, progress: number): number {
  return Math.floor((bar.x2 - bar.x1 - 1) * progress);
}

/* ------------------------------------------------------------------- the input ---- */

/** A click: a right one closes it, a left one on CLOSE too; a left one on a tab shows it. */
export function championDialogClick(ui: UIState, x: number, y: number, buttons: number): void {
  const state = ui.championDialog;
  if (!state) return;
  const id = searchButtonList(championDialogButtons(), Math.floor(x), Math.floor(y), buttons);
  if ((buttons & 1) !== 0 || id === BTN_CLOSE) {
    closeChampionDialog(ui);
    return;
  }
  if (id >= BTN_TAB0 && id < BTN_TAB0 + TABS.length) state.tab = TABS[id - BTN_TAB0].tab;
}

/** The pointer moved. Nothing is drawn here: says whether a button's look changed. */
export function championDialogPointer(ui: UIState, point: DialogPoint): boolean {
  const state = ui.championDialog;
  if (!state) return false;
  const was = hovered(state);
  state.pointer = point;
  return hovered(state) !== was;
}
