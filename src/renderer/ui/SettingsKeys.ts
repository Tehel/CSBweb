/**
 * The settings dialog's KEYS tab (`SettingsDialog.ts`): every action a key can be bound
 * to (`KeyAction`, `Keyboard.ts`), and its two keys, which the player changes here.
 *
 * ## The tab
 *
 * In the dialog's lines, from the top:
 *
 * - **The presets**: CSBWIN, KEYPAD and ARROWS (`KEY_PRESETS`), the one in force pressed.
 *   A click puts its table in force. A table changed by hand is CUSTOM, the fourth
 *   frame, pressed; with a preset in force it is inert, as nothing makes a table custom
 *   but a key changed.
 * - **KEY LABELS**: QWERTY or AZERTY, the keyboard the keys are named for
 *   (`KeyLabels.ts`). Where the browser gives the keyboard's own layout, the keys are
 *   named as it prints them, and the line is left out: the list takes its place.
 * - **The list**: a row an action, its name and its two keys, in a panel with a
 *   scrollbar. The wheel, the scrollbar's arrows, and the arrow keys, Page Up and Page
 *   Down, Home and End scroll it, and so does the wheel, three rows a notch
 *   (`Widgets.wheelRows`).
 *
 * ## Binding a key
 *
 * A click on a slot shows PRESS A KEY there. The next key pressed without a modifier
 * fills the slot, and is taken out of any other (`bindKey`), so a key does one thing.
 * Esc cancels, and cannot be bound: it is the dialog's. Any click cancels too, and does
 * what it does. A right click on a slot empties it; anywhere else, it closes the dialog.
 * Every change goes to the settings at once, which makes the table CUSTOM.
 */
import type { Rect, UIButton } from '../../data/tables/UITables';
import { fillRectIndex } from '../csbwin/CanvasBlitter';
import { KEY_LABEL_CHARS, KEY_LABEL_LAYOUTS, keyLabel, type KeyLabelLayout } from './KeyLabels';
import { bindKey, clearKey, isBindableKey, type KeyAction, type KeyPreset } from './Keyboard';
import { MENU_OPTION_COLOR, MENU_PANEL_COLOR } from './Menu';
import type { UIState } from './UIState';
import {
  CHAR_WIDTH,
  LINE_STEP as ROW_STEP,
  LIT_COLOR,
  LOW_BUTTON_HEIGHT,
  buttonLabelAt,
  buttonOf,
  clampScrollTop,
  drawButton,
  drawList,
  drawPanel,
  drawText,
  framesAcross,
  listButtons,
  listIn,
  listInner,
  listRowRect,
  wheelRows,
  type ButtonLook,
  type ListWidget,
  type WheelTravel,
} from './Widgets';

/* ------------------------------------------------------------------ contents ---- */

const CHAMPIONS = [0, 1, 2, 3] as const;

/** Every action, in the list's order, and its name. */
export const KEY_ACTION_NAMES: ReadonlyArray<readonly [KeyAction, string]> = [
  ['move.forward', 'MOVE FORWARD'],
  ['move.backward', 'MOVE BACKWARD'],
  ['move.turnLeft', 'TURN LEFT'],
  ['move.turnRight', 'TURN RIGHT'],
  ['move.strafeLeft', 'STRAFE LEFT'],
  ['move.strafeRight', 'STRAFE RIGHT'],
  ['move.down', 'MOVE DOWN'],
  ['move.up', 'MOVE UP'],
  ...CHAMPIONS.flatMap((c) => ([0, 1, 2] as const).map((row): [KeyAction, string] => [`attack.${c}.${row}`, `CHAMPION ${c + 1} ATTACK ${row + 1}`])),
  ...CHAMPIONS.map((c): [KeyAction, string] => [`inventory.${c}`, `INVENTORY ${c + 1}`]),
  ...([0, 1, 2, 3, 4, 5] as const).map((n): [KeyAction, string] => [`rune.${n}`, `RUNE ${n + 1}`]),
  ['runeBack', 'RUNE BACK'],
  ['cast', 'CAST'],
  ['pass', 'PASS'],
  ...CHAMPIONS.map((c): [KeyAction, string] => [`caster.${c}`, `CASTER ${c + 1}`]),
  ['freeze', 'FREEZE'],
  ['wake', 'WAKE'],
  ['quickSave', 'QUICK SAVE'],
  ['quickLoad', 'QUICK LOAD'],
  ['map', 'MAP'],
  ['champions', 'CHAMPIONS'],
];

/** The presets' frames, in their row's order, and CUSTOM last. */
export const PRESETS: ReadonlyArray<{ readonly preset: KeyPreset; readonly label: string; readonly help: string }> = [
  { preset: 'csbwin', label: 'CSBWIN', help: 'CSBWIN\'S KEYS: THE MOVES ON LETTERS AND KEYPAD' },
  { preset: 'keypad', label: 'KEYPAD', help: 'THE MOVES ON THE KEYPAD ALONE' },
  { preset: 'arrows', label: 'ARROWS', help: 'THE MOVES ON THE ARROWS, DELETE AND PAGE DOWN' },
  { preset: 'custom', label: 'CUSTOM', help: 'YOUR OWN KEYS: A PRESET REPLACES THEM' },
];

export const LABELS_NAME = 'KEY LABELS';
export const LABELS_HELP = 'THE KEYBOARD THE KEYS ARE NAMED FOR';
const LAYOUT_LABELS: Readonly<Record<KeyLabelLayout, string>> = { qwerty: 'QWERTY', azerty: 'AZERTY' };
export const SLOT_HELP = 'CLICK A KEY TO CHANGE IT, RIGHT CLICK TO CLEAR';
export const CAPTURE_HELP = 'PRESS THE NEW KEY, OR ESC TO CANCEL';
export const CAPTURE_LABEL = 'PRESS A KEY';
/** What an empty slot shows. */
const EMPTY_SLOT_LABEL = '-';

/* ------------------------------------------------------------------ geometry ---- */

/** Where the tab is drawn: the dialog's lines, and the left edge of their controls' column. */
export interface KeysArea extends Rect {
  readonly controlX1: number;
}

/** A line of the dialog is a low button high, a row of the plate between two. */
const LINE_STEP = LOW_BUTTON_HEIGHT + 1;

/** The presets' row, the first line. */
export function presetFrames(area: KeysArea): Rect[] {
  return framesAcross({ x1: area.x1, y1: area.y1, x2: area.x2, y2: area.y1 + LOW_BUTTON_HEIGHT - 1 }, PRESETS.length);
}

function labelsLine(area: KeysArea): Rect {
  const y1 = area.y1 + LINE_STEP;
  return { x1: area.x1, y1, x2: area.x2, y2: y1 + LOW_BUTTON_HEIGHT - 1 };
}

/** KEY LABELS' name, on a panel a line high, as far as graphic 0's nine columns short of its toggle. */
export function labelsNamePanel(area: KeysArea): Rect {
  return { ...labelsLine(area), x2: area.controlX1 - 10 };
}

/** KEY LABELS' toggle, QWERTY then AZERTY, in the controls' column. */
export function layoutFrames(area: KeysArea): Rect[] {
  return framesAcross({ ...labelsLine(area), x1: area.controlX1 }, KEY_LABEL_LAYOUTS.length);
}

/** The list, from a row of the plate under KEY LABELS, or under the presets without it, to the area's foot. */
export function keysList(ui: UIState, area: KeysArea): ListWidget {
  const above = hasLabelsLine(ui) ? labelsLine(area) : presetFrames(area)[0]!;
  return listIn({ x1: area.x1, y1: above.y2 + 2, x2: area.x2, y2: area.y2 });
}

/** Slot `slot` of the list's row `row`, counted from the first shown: as wide as the longest label, the second against the scrollbar. */
export function slotRect(list: ListWidget, row: number, slot: 0 | 1): Rect {
  const { y1, y2 } = listRowRect(list, row);
  const width = KEY_LABEL_CHARS * CHAR_WIDTH + 4;
  const x2 = listInner(list).x2 - (1 - slot) * (width + 4);
  return { x1: x2 - width + 1, y1, x2, y2 };
}

/* --------------------------------------------------------------------- state ---- */

export interface KeysTabState extends WheelTravel {
  /** The list's first row shown. */
  scrollTop: number;
  /** The slot a click chose, waiting for its key, or `null`. */
  capture: { action: KeyAction; slot: 0 | 1 } | null;
}

export function newKeysTabState(): KeysTabState {
  return { scrollTop: 0, capture: null, wheelDelta: 0 };
}

/* ---------------------------------------------------------------- the controls ---- */

/** The ids of the tab's controls, clear of the dialog's own. */
const BTN_PRESET0 = 100;
const BTN_LAYOUT0 = 110;
const BTN_SCROLL_UP = 120;
const BTN_SCROLL_DOWN = 121;
/** The list's row `r` shown: its first slot `BTN_SLOT0 + 2r`, its second the next. */
const BTN_SLOT0 = 200;
/** The list's row `r` shown, across: the help line's alone. */
const BTN_ROW0 = 300;
/** KEY LABELS' name: the help line's alone. */
const BTN_LABELS_NAME = 400;

/** Whether KEY LABELS is shown: where the browser does not give the keyboard's layout. */
function hasLabelsLine(ui: UIState): boolean {
  return ui.keyboardLayout() === null;
}

/**
 * The tab's button list, in the form of CSBWin's: the presets but CUSTOM, the layout
 * toggle where it is shown, the scrollbar's arrows, and the slots shown. A slot takes
 * the right button too, which empties it.
 */
export function keysTabButtons(ui: UIState, state: KeysTabState, area: KeysArea): UIButton[] {
  const buttons: UIButton[] = [];
  presetFrames(area).forEach((frame, i) => {
    const { preset } = PRESETS[i]!;
    if (preset !== 'custom') buttons.push(buttonOf(frame, BTN_PRESET0 + i, `settings.keys.preset.${preset}`));
  });
  if (hasLabelsLine(ui)) {
    layoutFrames(area).forEach((frame, i) => buttons.push(buttonOf(frame, BTN_LAYOUT0 + i, `settings.keys.layout.${KEY_LABEL_LAYOUTS[i]}`)));
  }
  const list = keysList(ui, area);
  buttons.push(...listButtons(list, KEY_ACTION_NAMES.length, state.scrollTop,
    { up: BTN_SCROLL_UP, down: BTN_SCROLL_DOWN, row0: BTN_ROW0 }, 'settings.keys').slice(0, 2));
  for (let row = 0; row < shownRows(list, state); row++) {
    for (const slot of [0, 1] as const) {
      const r = slotRect(list, row, slot);
      buttons.push({ word0: BTN_SLOT0 + 2 * row + slot, x1: r.x1, y1: r.y1, x2: r.x2 + 1, y2: r.y2 + 1, button: 3, name: `settings.keys.row${row}.slot${slot}` });
    }
  }
  return buttons;
}

/** The buttons, then every row's whole width, CUSTOM and KEY LABELS' name: what the help line names. */
export function keysTabHoverButtons(ui: UIState, state: KeysTabState, area: KeysArea): UIButton[] {
  const list = keysList(ui, area);
  const rows = Array.from({ length: shownRows(list, state) }, (_, row): UIButton => {
    const r = listRowRect(list, row);
    return { word0: BTN_ROW0 + row, x1: r.x1, y1: r.y1, x2: r.x2 + 1, y2: r.y2 + 1, button: 2, name: `settings.keys.row${row}` };
  });
  const presets = presetFrames(area);
  const custom = presets[presets.length - 1]!;
  const names: UIButton[] = [buttonOf(custom, BTN_PRESET0 + presets.length - 1, 'settings.keys.preset.custom')];
  if (hasLabelsLine(ui)) {
    names.push({ word0: BTN_LABELS_NAME, ...rectButton(labelsNamePanel(area)), button: 2, name: 'settings.keys.labels' });
  }
  return [...keysTabButtons(ui, state, area), ...rows, ...names];
}

function rectButton(r: Rect): Pick<UIButton, 'x1' | 'y1' | 'x2' | 'y2'> {
  return { x1: r.x1, y1: r.y1, x2: r.x2 + 1, y2: r.y2 + 1 };
}

function shownRows(list: ListWidget, state: KeysTabState): number {
  return Math.min(list.rows, Math.max(0, KEY_ACTION_NAMES.length - state.scrollTop));
}

/** The action and the slot a slot's id stands for, or `null`. */
function slotOf(state: KeysTabState, id: number): { action: KeyAction; slot: 0 | 1 } | null {
  if (id < BTN_SLOT0 || id >= BTN_ROW0) return null;
  const entry = KEY_ACTION_NAMES[state.scrollTop + ((id - BTN_SLOT0) >> 1)];
  return entry ? { action: entry[0], slot: ((id - BTN_SLOT0) & 1) as 0 | 1 } : null;
}

/** What the help line says of the control `id`, or `undefined` for none of the tab's. */
export function keysTabHelp(state: KeysTabState, id: number): string | undefined {
  if (state.capture) return CAPTURE_HELP;
  if (id >= BTN_PRESET0 && id < BTN_PRESET0 + PRESETS.length) return PRESETS[id - BTN_PRESET0]!.help;
  if (id === BTN_LABELS_NAME || (id >= BTN_LAYOUT0 && id < BTN_LAYOUT0 + KEY_LABEL_LAYOUTS.length)) return LABELS_HELP;
  if (id >= BTN_SLOT0 && id < BTN_LABELS_NAME) return SLOT_HELP;
  return id >= BTN_SCROLL_UP && id <= BTN_SCROLL_DOWN ? '' : undefined;
}

/* ------------------------------------------------------------------- drawing ---- */

/** A key's label as the tab shows it: by the browser's layout where it gives one, else the player's choice. */
export function slotLabel(ui: UIState, code: string): string {
  return keyLabel(code, ui.settings.values.keyLabels, ui.keyboardLayout()) || EMPTY_SLOT_LABEL;
}

/** The tab, over the dialog's plate; `over` is the control under the pointer. */
export function drawKeysTab(ui: UIState, state: KeysTabState, area: KeysArea, over: number): void {
  const values = ui.settings.values;
  const look = (id: number, pressed: boolean): ButtonLook => (pressed ? 'pressed' : over === id ? 'hover' : 'raised');

  presetFrames(area).forEach((frame, i) => {
    const { preset, label } = PRESETS[i]!;
    const chosen = values.keyPreset === preset;
    drawButton(ui, frame, label, preset === 'custom' && !chosen ? 'inert' : look(BTN_PRESET0 + i, chosen));
  });

  if (hasLabelsLine(ui)) {
    const namePanel = labelsNamePanel(area);
    drawPanel(ui, namePanel);
    drawText(ui, LABELS_NAME, namePanel.x1 + 4, buttonLabelAt(namePanel).y);
    layoutFrames(area).forEach((frame, i) => {
      const layout = KEY_LABEL_LAYOUTS[i]!;
      drawButton(ui, frame, LAYOUT_LABELS[layout], look(BTN_LAYOUT0 + i, values.keyLabels === layout));
    });
  }

  const list = keysList(ui, area);
  drawPanel(ui, list.panel);
  drawList(ui, list, KEY_ACTION_NAMES.length, state.scrollTop, -1, (index) => KEY_ACTION_NAMES[index]![1]);
  for (let row = 0; row < shownRows(list, state); row++) {
    const action = KEY_ACTION_NAMES[state.scrollTop + row]![0];
    for (const slot of [0, 1] as const) {
      const r = slotRect(list, row, slot);
      const y = list.rowFirstY + row * ROW_STEP;
      if (state.capture?.action === action && state.capture.slot === slot) {
        fillRectIndex(ui.screenIndexBuffer, r, MENU_OPTION_COLOR);
        drawText(ui, CAPTURE_LABEL, r.x1 + 2, y, MENU_PANEL_COLOR, MENU_OPTION_COLOR);
      } else {
        const lit = over === BTN_SLOT0 + 2 * row + slot;
        drawText(ui, slotLabel(ui, values.keyBindings[action][slot]), r.x1 + 2, y, lit ? LIT_COLOR : MENU_OPTION_COLOR);
      }
    }
  }
}

/* ------------------------------------------------------------------- the input ---- */

function scrollBy(ui: UIState, state: KeysTabState, area: KeysArea, delta: number): void {
  state.scrollTop = clampScrollTop(keysList(ui, area), KEY_ACTION_NAMES.length, state.scrollTop + delta);
}

/**
 * A left click on the tab's control `id`, or on none (0). A slot waiting for its key
 * waits no more, whatever the click.
 */
export function keysTabClick(ui: UIState, state: KeysTabState, area: KeysArea, id: number): void {
  state.capture = null;
  if (id >= BTN_PRESET0 && id < BTN_PRESET0 + PRESETS.length) {
    const { preset } = PRESETS[id - BTN_PRESET0]!;
    if (preset !== 'custom' && ui.settings.values.keyPreset !== preset) ui.settings.update({ keyPreset: preset });
  } else if (id >= BTN_LAYOUT0 && id < BTN_LAYOUT0 + KEY_LABEL_LAYOUTS.length) {
    const layout = KEY_LABEL_LAYOUTS[id - BTN_LAYOUT0];
    if (ui.settings.values.keyLabels !== layout) ui.settings.update({ keyLabels: layout });
  } else if (id === BTN_SCROLL_UP || id === BTN_SCROLL_DOWN) {
    scrollBy(ui, state, area, id === BTN_SCROLL_UP ? -1 : 1);
  } else {
    state.capture = slotOf(state, id);
  }
}

/** A right click on the control `id`. Says whether it took it: a slot, which it empties. */
export function keysTabRightClick(ui: UIState, state: KeysTabState, id: number): boolean {
  const at = slotOf(state, id);
  if (!at) return false;
  state.capture = null;
  const values = ui.settings.values;
  if (values.keyBindings[at.action][at.slot] !== '') {
    ui.settings.update({ keyBindings: clearKey(values.keyBindings, at.action, at.slot) });
  }
  return true;
}

/**
 * A key, its `KeyboardEvent.code`. Says whether the tab took it: with a slot waiting,
 * every key; else the keys that scroll the list. Esc, untaken, closes the dialog.
 */
export function keysTabKey(ui: UIState, state: KeysTabState, area: KeysArea, code: string): boolean {
  const capture = state.capture;
  if (capture) {
    if (code === 'Escape') {
      state.capture = null;
    } else if (isBindableKey(code)) {
      state.capture = null;
      const values = ui.settings.values;
      if (values.keyBindings[capture.action][capture.slot] !== code) {
        ui.settings.update({ keyBindings: bindKey(values.keyBindings, capture.action, capture.slot, code) });
      }
    }
    return true;
  }
  const page = keysList(ui, area).rows;
  const delta: Readonly<Record<string, number>> = {
    ArrowUp: -1, ArrowDown: 1, PageUp: -page, PageDown: page,
    Home: -KEY_ACTION_NAMES.length, End: KEY_ACTION_NAMES.length,
  };
  if (!(code in delta)) return false;
  scrollBy(ui, state, area, delta[code]!);
  return true;
}

/** The wheel turned by `deltaY` scrolls the list (`wheelRows`). Says whether it scrolled. */
export function keysTabWheel(ui: UIState, state: KeysTabState, area: KeysArea, deltaY: number): boolean {
  const rows = wheelRows(state, deltaY);
  if (rows === 0) return false;
  const was = state.scrollTop;
  scrollBy(ui, state, area, rows);
  return state.scrollTop !== was;
}
