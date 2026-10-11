/**
 * The settings dialog: the player's settings (`src/settings/Settings.ts`) in the game's
 * own screen, as the dialog over the game (`Dialog.ts`), drawn from the widget kit
 * (`Widgets.ts`). It is the port's own: CSBWin's settings are its `config.txt` and its
 * Windows menus, and nothing on the game's screen.
 *
 * ## The dialog
 *
 * It takes the whole screen, 320x200: height is what 200 lines lack, so nothing takes a
 * row of its own that can share one. From the top:
 *
 * - **The title line**: SETTINGS on a panel, and at its right CLOSE and EXIT, the kit's
 *   low buttons.
 * - **A row of tabs**: GAME, DISPLAY, SOUND and KEYS, the selected one pressed.
 * - **The tab's settings**, one a line: its name on a panel, and beside it a toggle, ON
 *   and OFF, the chosen one pressed, or a slider. The panel holds five lines.
 * - **The help line**, at the foot (`helpText`).
 *
 * KEYS (`DEBT.md` U5) and EXIT, which leaves for the welcome page (E15), are drawn inert,
 * unlabelled, as the kit draws a button that can do nothing. So is the CRT effect's
 * toggle where the browser gives no WebGL (`UIState.isCrtAvailable`); the help line
 * then says why.
 *
 * Every change goes to the settings model at once, which saves it and tells its
 * listeners: the page applies it to the sound, the CRT effect and the game.
 *
 * ## The help line
 *
 * It names what the pointer is over: a setting, its name or its control, a tab, or
 * CLOSE. A button under the pointer is lit, the kit's hovered look. The pointer's move
 * draws nothing: the VBL's frame draws the dialog again, as it draws the cursor
 * (`GameScreen.takeCursorMoved`). A touch screen has no hover, but its pointer stays where
 * the finger lifted (`bindCanvasEvents`, `src/ui/events.ts`), so the help line names the
 * last control touched.
 *
 * ## Opening and closing
 *
 * Esc opens it in play, over the inventory and the sleep and freeze screens too, and so
 * does a double click on the message area (`GameInput`). Esc again, CLOSE or a right click
 * close it. While it is up the clock is held, as under every dialog, and the game is left
 * as it was: no `TAG02076e`, nothing repacked or shaded.
 *
 * ## The palette
 *
 * The screen is shown through the interface's palette whole while it is up
 * (`Dialog.uiPalette`). CSBWin shows the viewport's lines through the light level's
 * palette whatever is drawn there, its menus included
 * (`doc/CSBwin-src/WinScreen.cpp:1493-1527`), and the save menu keeps that; this dialog is
 * not CSBWin's, and in a dark level its middle would not read.
 */
import type { Rect, UIButton } from '../../data/tables/UITables';
import type { SettingsValues } from '../../settings/Settings';
import { closeDialog, openDialog, type Dialog, type DialogPoint } from './Dialog';
import { searchButtonList } from './HitTest';
import { MENU_TITLE1_COLOR } from './Menu';
import type { UIState } from './UIState';
import {
  BUTTON_GAP,
  LOW_BUTTON_HEIGHT,
  SLIDER_HEIGHT,
  buttonLabelAt,
  buttonOf,
  drawButton,
  drawCentredText,
  drawHelpLine,
  drawPanel,
  drawPlate,
  drawSlider,
  drawText,
  framesAcross,
  sliderButton,
  sliderValueAt,
  type ButtonLook,
} from './Widgets';

/* ------------------------------------------------------------------ geometry ---- */

/**
 * All in screen coordinates. The plate's frame is ten pixels, as graphic 0's; between the
 * title line, the tabs and the settings are six rows of it, and nine above the help line.
 */
const DIALOG: Rect = { x1: 0, y1: 0, x2: 319, y2: 199 };
const TITLE_Y1 = 10;
const TITLE_Y2 = TITLE_Y1 + LOW_BUTTON_HEIGHT - 1;
export const EXIT_FRAME: Rect = { x1: 250, y1: TITLE_Y1, x2: 309, y2: TITLE_Y2 };
export const CLOSE_FRAME: Rect = { x1: EXIT_FRAME.x1 - BUTTON_GAP - 60, y1: TITLE_Y1, x2: EXIT_FRAME.x1 - BUTTON_GAP - 1, y2: TITLE_Y2 };
/** SETTINGS, on a panel as far as graphic 0's ten pixels short of CLOSE. */
const TITLE_PANEL: Rect = { x1: 10, y1: TITLE_Y1, x2: CLOSE_FRAME.x1 - 10, y2: TITLE_Y2 };
const TAB_ROW: Rect = { x1: 10, y1: TITLE_Y2 + 7, x2: 309, y2: TITLE_Y2 + 6 + LOW_BUTTON_HEIGHT };
export const TAB_FRAMES = framesAcross(TAB_ROW, 4);

/** A line of settings is a low button high, a row of the plate between two. */
const LINE_STEP = LOW_BUTTON_HEIGHT + 1;
/** The most lines a tab has. */
export const SETTING_LINES = 5;
const LINES_Y1 = TAB_ROW.y2 + 7;
/** The settings' names, on a panel as tall as the five lines. */
const NAME_PANEL: Rect = { x1: 10, y1: LINES_Y1, x2: 190, y2: LINES_Y1 + SETTING_LINES * LINE_STEP - 2 };
/** The controls' column, right of the names' panel by graphic 0's nine columns. */
const CONTROL_X1 = NAME_PANEL.x2 + 10;
const CONTROL_X2 = 309;
export const HELP_LINE: Rect = { x1: 10, y1: 175, x2: 309, y2: 189 };

/** Line `line`'s rectangle across the dialog: the names' panel and the controls' column. */
function lineRect(line: number): Rect {
  const y1 = LINES_Y1 + line * LINE_STEP;
  return { x1: NAME_PANEL.x1, y1, x2: CONTROL_X2, y2: y1 + LOW_BUTTON_HEIGHT - 1 };
}

/** A toggle's two frames on line `line`: ON, then OFF. */
export function toggleFrames(line: number): [Rect, Rect] {
  const { y1, y2 } = lineRect(line);
  const [on, off] = framesAcross({ x1: CONTROL_X1, y1, x2: CONTROL_X2, y2 }, 2);
  return [on, off];
}

/** A slider on line `line`, across the controls' column and centred on the line. */
export function sliderRect(line: number): Rect {
  const y1 = lineRect(line).y1 + ((LOW_BUTTON_HEIGHT - SLIDER_HEIGHT) >> 1);
  return { x1: CONTROL_X1, y1, x2: CONTROL_X2, y2: y1 + SLIDER_HEIGHT - 1 };
}

/* ------------------------------------------------------------------ contents ---- */

export type SettingsTab = 'game' | 'display' | 'sound' | 'keys';

/** A setting: its name, what the help line says of it, and its control. */
type Setting = {
  readonly name: string;
  readonly help: string;
  /** Where its control is inert, and what the help line says instead: the CRT effect without WebGL. */
  readonly unavailable?: { readonly when: (ui: UIState) => boolean; readonly help: string };
} & (
  | { readonly kind: 'toggle'; readonly get: (values: SettingsValues) => boolean; readonly set: (values: SettingsValues, on: boolean) => Partial<SettingsValues> }
  | { readonly kind: 'slider'; readonly get: (values: SettingsValues) => number; readonly set: (values: SettingsValues, value: number) => Partial<SettingsValues> }
);

const extra = (key: keyof SettingsValues['extras']) => ({
  kind: 'toggle' as const,
  get: (values: SettingsValues) => values.extras[key],
  set: (values: SettingsValues, on: boolean) => ({ extras: { ...values.extras, [key]: on } }),
});

/** The tabs, in their row's order: a label, the help line's words, and the settings, or `null` for one drawn inert. */
export const TABS: ReadonlyArray<{ readonly tab: SettingsTab; readonly label: string; readonly help: string; readonly settings: readonly Setting[] | null }> = [
  {
    tab: 'game',
    label: 'GAME',
    help: 'THE EXTRAS, AND THE STATISTICS',
    settings: [
      { name: 'GATHER THROWN WEAPONS', help: 'WALK OVER A THROWN WEAPON TO TAKE IT BACK', ...extra('gatherThrownWeapons') },
      { name: 'DRINK AT FOUNTAINS', help: 'AN EMPTY HAND ON A FOUNTAIN DRINKS FROM IT', ...extra('drinkAtFountain') },
      { name: 'COLOUR NEW MASTERY', help: 'A MASTERY JUST GAINED SHOWN IN COLOUR', ...extra('colourNewMastery') },
      {
        name: 'SEND STATISTICS',
        help: 'TELL THE SITE A GAME STARTED, WON OR LOST',
        kind: 'toggle',
        get: (values) => values.statistics,
        set: (_values, on) => ({ statistics: on }),
      },
    ],
  },
  {
    tab: 'display',
    label: 'DISPLAY',
    help: 'THE SCREEN',
    settings: [
      {
        name: 'CRT EFFECT',
        help: 'THE CURVE AND THE SCANLINES OF A TUBE',
        unavailable: { when: (ui) => !ui.isCrtAvailable(), help: 'THE CRT EFFECT NEEDS WEBGL' },
        kind: 'toggle',
        get: (values) => values.crt,
        set: (_values, on) => ({ crt: on }),
      },
      {
        name: 'STARTUP ANIMATIONS',
        help: 'THE FTL LOGO AND THE TITLE BEFORE THE ENTRANCE',
        kind: 'toggle',
        get: (values) => values.startupAnimations,
        set: (_values, on) => ({ startupAnimations: on }),
      },
    ],
  },
  {
    tab: 'sound',
    label: 'SOUND',
    help: 'THE SOUND',
    settings: [
      {
        name: 'SOUND',
        help: 'THE GAME\'S SOUNDS, ON OR OFF',
        kind: 'toggle',
        get: (values) => values.sound,
        set: (_values, on) => ({ sound: on }),
      },
      {
        name: 'VOLUME',
        help: 'HOW LOUD THE SOUNDS ARE',
        kind: 'slider',
        get: (values) => values.volume,
        set: (_values, volume) => ({ volume }),
      },
    ],
  },
  { tab: 'keys', label: 'KEYS', help: '', settings: null },
];

export const TITLE = 'SETTINGS';
export const CLOSE_LABEL = 'CLOSE';
export const CLOSE_HELP = 'BACK TO THE GAME, AS ESC AND A RIGHT CLICK ARE';
export const TOGGLE_LABELS = ['ON', 'OFF'] as const;

/* --------------------------------------------------------------------- state ---- */

export interface SettingsDialogState {
  tab: SettingsTab;
  /** Where the pointer is, in screen coordinates, or `null` off the canvas. */
  pointer: DialogPoint;
  /** The line whose slider a click took and the button still holds, or `null`. */
  sliding: number | null;
}

export function isSettingsDialogOpen(ui: UIState): boolean {
  return ui.settingsDialog !== null;
}

const SETTINGS_DIALOG: Dialog = {
  uiPalette: true,
  draw: (ui) => drawSettingsDialog(ui),
  click: (ui, x, y, buttons) => settingsDialogClick(ui, x, y, buttons),
  key: (ui, key) => settingsDialogKey(ui, key),
  wheel: () => {},
  pointer: (ui, point) => settingsDialogPointer(ui, point),
  drag: (ui, x) => settingsDialogDrag(ui, x),
  release: (ui) => {
    if (ui.settingsDialog) ui.settingsDialog.sliding = null;
  },
};

/** Put the dialog up, on GAME. Nothing, while another dialog is up. */
export function openSettingsDialog(ui: UIState): void {
  if (ui.dialog) return;
  openDialog(ui, SETTINGS_DIALOG);
  ui.settingsDialog = { tab: 'game', pointer: ui.hoverPoint, sliding: null };
}

export function closeSettingsDialog(ui: UIState): void {
  if (!ui.settingsDialog) return;
  ui.settingsDialog = null;
  closeDialog(ui);
}

/* ---------------------------------------------------------------- the controls ---- */

const BTN_CLOSE = 1;
const BTN_TAB0 = 10;
/** Line `n`'s ON is `BTN_LINE0 + 3n`, its OFF the next, its slider the one after. */
const BTN_LINE0 = 20;
/** Line `n`'s name, which takes no click: the help line's alone (`hoverButtons`). */
const BTN_NAME0 = 60;

function tabOf(state: SettingsDialogState) {
  return TABS.find((t) => t.tab === state.tab) ?? TABS[0];
}

function settingsOf(state: SettingsDialogState): readonly Setting[] {
  return tabOf(state).settings ?? [];
}

function inert(ui: UIState, setting: Setting): boolean {
  return setting.unavailable?.when(ui) ?? false;
}

/**
 * The dialog's button list, in the form of CSBWin's (`x2` and `y2` exclusive): CLOSE, the
 * tabs, and each line's toggle or slider. An inert control has none.
 */
export function settingsDialogButtons(ui: UIState, state: SettingsDialogState): UIButton[] {
  const buttons = [buttonOf(CLOSE_FRAME, BTN_CLOSE, 'settings.close')];
  TABS.forEach((t, i) => {
    if (t.settings) buttons.push(buttonOf(TAB_FRAMES[i], BTN_TAB0 + i, `settings.tab.${t.tab}`));
  });
  settingsOf(state).forEach((setting, line) => {
    if (inert(ui, setting)) return;
    const id = BTN_LINE0 + 3 * line;
    if (setting.kind === 'slider') {
      buttons.push(sliderButton(sliderRect(line), id + 2, `settings.line${line}.slider`));
    } else {
      const [on, off] = toggleFrames(line);
      buttons.push(buttonOf(on, id, `settings.line${line}.on`), buttonOf(off, id + 1, `settings.line${line}.off`));
    }
  });
  return buttons;
}

/** The buttons, then every line's whole width: what the help line names under the pointer. */
function hoverButtons(ui: UIState, state: SettingsDialogState): UIButton[] {
  const lines = settingsOf(state).map((_setting, line): UIButton => {
    const r = lineRect(line);
    return { word0: BTN_NAME0 + line, x1: r.x1, y1: r.y1, x2: r.x2 + 1, y2: r.y2 + 1, button: 2, name: `settings.line${line}` };
  });
  return [...settingsDialogButtons(ui, state), ...lines];
}

/** The control under the pointer: a button's id, a line's name's, or 0. */
function hovered(ui: UIState, state: SettingsDialogState): number {
  const at = state.pointer;
  return at ? searchButtonList(hoverButtons(ui, state), Math.floor(at.x), Math.floor(at.y), 2) : 0;
}

/** The line a control's id stands for, or -1. */
function lineOf(id: number): number {
  if (id >= BTN_NAME0) return id - BTN_NAME0;
  return id >= BTN_LINE0 ? Math.floor((id - BTN_LINE0) / 3) : -1;
}

/** What the help line says: what the pointer is over, or nothing. */
export function helpText(ui: UIState, state: SettingsDialogState): string {
  const id = hovered(ui, state);
  if (id === BTN_CLOSE) return CLOSE_HELP;
  if (id >= BTN_TAB0 && id < BTN_TAB0 + TABS.length) return TABS[id - BTN_TAB0].help;
  const setting = settingsOf(state)[lineOf(id)];
  if (!setting) return '';
  return inert(ui, setting) ? setting.unavailable?.help ?? '' : setting.help;
}

/* ------------------------------------------------------------------- drawing ---- */

export function drawSettingsDialog(ui: UIState): void {
  const state = ui.settingsDialog;
  if (!state) return;
  const over = hovered(ui, state);
  const look = (id: number, pressed = false): ButtonLook => (pressed ? 'pressed' : over === id ? 'hover' : 'raised');

  drawPlate(ui, DIALOG);
  drawPanel(ui, TITLE_PANEL);
  const title = buttonLabelAt(TITLE_PANEL);
  drawCentredText(ui, TITLE, title.x, title.y, MENU_TITLE1_COLOR);
  drawButton(ui, CLOSE_FRAME, CLOSE_LABEL, look(BTN_CLOSE));
  drawButton(ui, EXIT_FRAME, '', 'inert');

  TABS.forEach((t, i) => {
    drawButton(ui, TAB_FRAMES[i], t.label, t.settings ? look(BTN_TAB0 + i, t.tab === state.tab) : 'inert');
  });

  drawPanel(ui, NAME_PANEL);
  const values = ui.settings.values;
  settingsOf(state).forEach((setting, line) => {
    drawText(ui, setting.name, NAME_PANEL.x1 + 4, buttonLabelAt(lineRect(line)).y);
    const id = BTN_LINE0 + 3 * line;
    if (setting.kind === 'slider') {
      drawSlider(ui, sliderRect(line), setting.get(values));
      return;
    }
    const frames = toggleFrames(line);
    const on = setting.get(values);
    frames.forEach((frame, i) => {
      drawButton(ui, frame, TOGGLE_LABELS[i], inert(ui, setting) ? 'inert' : look(id + i, on === (i === 0)));
    });
  });

  drawHelpLine(ui, HELP_LINE, helpText(ui, state));
}

/* ------------------------------------------------------------------- the input ---- */

/** A click: a right one closes it; a left one on a control acts at once. */
export function settingsDialogClick(ui: UIState, x: number, y: number, buttons: number): void {
  const state = ui.settingsDialog;
  if (!state) return;
  if ((buttons & 1) !== 0) {
    closeSettingsDialog(ui);
    return;
  }
  const id = searchButtonList(settingsDialogButtons(ui, state), Math.floor(x), Math.floor(y), buttons);
  if (id === BTN_CLOSE) {
    closeSettingsDialog(ui);
    return;
  }
  if (id >= BTN_TAB0 && id < BTN_TAB0 + TABS.length) {
    state.tab = TABS[id - BTN_TAB0].tab;
    return;
  }
  const line = lineOf(id);
  const setting = settingsOf(state)[line];
  if (!setting) return;
  const values = ui.settings.values;
  if (setting.kind === 'slider') {
    state.sliding = line;
    ui.settings.update(setting.set(values, sliderValueAt(sliderRect(line), x)));
    return;
  }
  const on = (id - BTN_LINE0) % 3 === 0;
  if (setting.get(values) !== on) ui.settings.update(setting.set(values, on));
}

/** The pointer moved with a slider's click held: the knob follows it, as far as the track's ends. */
function settingsDialogDrag(ui: UIState, x: number): void {
  const state = ui.settingsDialog;
  if (!state || state.sliding === null) return;
  const setting = settingsOf(state)[state.sliding];
  if (setting?.kind !== 'slider') return;
  const value = sliderValueAt(sliderRect(state.sliding), x);
  if (value !== setting.get(ui.settings.values)) ui.settings.update(setting.set(ui.settings.values, value));
}

/** Esc closes it; no other key does anything. */
export function settingsDialogKey(ui: UIState, key: string): void {
  if (key === 'Escape') closeSettingsDialog(ui);
}

/**
 * The pointer moved, to `point` or off the canvas. Nothing is drawn here: says whether
 * the control under it changed, and with it the help line and the lit button.
 */
export function settingsDialogPointer(ui: UIState, point: DialogPoint): boolean {
  const state = ui.settingsDialog;
  if (!state) return false;
  const was = hovered(ui, state);
  state.pointer = point;
  return hovered(ui, state) !== was;
}
