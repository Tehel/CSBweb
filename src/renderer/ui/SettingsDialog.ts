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
 * - **A row of tabs**: GAME, DISPLAY, SOUND and KEYS, over the page they open
 *   (`drawTabbedPage`): the selected one open into it, the others behind its edge.
 * - **The tab's settings**, on the page. On GAME and DISPLAY, each is a button holding its name,
 *   pressed when on and raised when off, two buttons a line (`settingButtonFrame`); a
 *   click turns it over. ASPECT RATIO's is a choice of two and names the one chosen:
 *   16:10 raised, the default, and 4:3 pressed. On SOUND, each is a line: its name on a panel, and beside it a
 *   toggle, ON and OFF, the chosen one pressed, or a slider. The panel holds five lines.
 *   KEYS has its presets, its labels' layout and the list of the keys instead
 *   (`SettingsKeys.ts`).
 * - **The help line**, at the foot (`helpText`).
 *
 * A setting that cannot work, SCANLINES and SCREEN CURVE where
 * the browser gives no WebGL (`UIState.isCrtAvailable`), FULLSCREEN where it gives no
 * fullscreen (`UIState.fullscreen`), or LEFT HANDED where the data set's buttons would be
 * cut by it (`leftHandedFits`, `src/renderer/LeftHanded.ts`), keeps its name: its button is raised, its label dim,
 * it takes no click, and the help line says why.
 *
 * Every change goes to the settings model at once, which saves it and tells its
 * listeners: the page applies it to the sound, the CRT effect and the game. FULLSCREEN
 * alone is no setting but the page's state, asked of the page (`src/lib/fullscreen.ts`)
 * and kept by nobody: a browser enters fullscreen only at the player's gesture.
 *
 * ## EXIT
 *
 * EXIT leaves the game for the welcome page, and what has not been saved is lost, so it
 * asks first: `_DoMenu`'s two-option menu, centred, in the dialog's place on a screen
 * cleared to black, as the save menu asks (`SaveMenu.ts` → "The question"), "LEAVE THE
 * GAME?" over "WHAT IS NOT SAVED IS LOST", with EXIT and CANCEL. The button chosen flashes
 * as `_WaitForMenuSelect` flashes it (`playMenuPress`); then EXIT asks the page to open
 * itself without `?dungeon=` (`UIState.onExit`), and CANCEL puts the dialog back. Esc or a
 * right click is CANCEL, without the flash, and no other key does anything.
 *
 * ## The help line
 *
 * It names what the pointer is over: a setting, its button, its name or its control, a
 * tab, CLOSE or EXIT. A button under the pointer is lit, the kit's hovered look. The pointer's move
 * draws nothing: the VBL's frame draws the dialog again, as it draws the cursor
 * (`GameScreen.takeCursorMoved`). A touch screen has no hover, but its pointer stays where
 * the finger lifted (`bindCanvasEvents`, `src/ui/events.ts`), so the help line names the
 * last control touched.
 *
 * ## Opening and closing
 *
 * Esc opens it in play, over the inventory and the sleep and freeze screens too, and so
 * does a double click on the message area (`GameInput`). Esc again, CLOSE or a right click
 * close it, unless KEYS takes them: Esc while a slot waits for its key, a right click on
 * a slot. While it is up the clock is held, as under every dialog, and the game is left
 * as it was: no `TAG02076e`, nothing repacked or shaded.
 *
 * It opens on GAME the first time, and after that where it was last closed: on its tab,
 * KEYS' list scrolled as it was, no slot waiting (`UIState.settingsDialogLast`). That is
 * kept for the page's life only, not with the settings.
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
import { clearIndex } from '../csbwin/CanvasBlitter';
import {
  MENU_TITLE1_COLOR, doMenu, drawMenuPress, menuButtonList, menuButtonRect, menuHitTest, playMenuPress, type MenuPress,
} from './Menu';
import {
  drawKeysTab, keysTabButtons, keysTabClick, keysTabHelp, keysTabHoverButtons, keysTabKey, keysTabRightClick,
  keysTabWheel, newKeysTabState, type KeysArea, type KeysTabState,
} from './SettingsKeys';
import { nowMs, type UIState } from './UIState';
import { leftHandedFits } from '../LeftHanded';
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
  drawTabbedPage,
  drawText,
  framesAcross,
  sliderButton,
  sliderValueAt,
  TAB_HEIGHT,
  tabButtons,
  tabsOver,
  type ButtonLook,
} from './Widgets';

/* ------------------------------------------------------------------ geometry ---- */

/**
 * All in screen coordinates. The plate's frame is ten pixels, as graphic 0's; six rows of
 * it under the title line, the tabs stand on the page, and five rows above the help line.
 * The page is wider than the title and the help line by five columns a side, so its
 * controls keep their places, ten columns from the plate's edges, eight rows under the
 * page's top edge.
 */
const DIALOG: Rect = { x1: 0, y1: 0, x2: 319, y2: 199 };
const TITLE_Y1 = 10;
const TITLE_Y2 = TITLE_Y1 + LOW_BUTTON_HEIGHT - 1;
export const EXIT_FRAME: Rect = { x1: 250, y1: TITLE_Y1, x2: 309, y2: TITLE_Y2 };
export const CLOSE_FRAME: Rect = { x1: EXIT_FRAME.x1 - BUTTON_GAP - 60, y1: TITLE_Y1, x2: EXIT_FRAME.x1 - BUTTON_GAP - 1, y2: TITLE_Y2 };
/** SETTINGS, on a panel as far as graphic 0's ten pixels short of CLOSE. */
const TITLE_PANEL: Rect = { x1: 10, y1: TITLE_Y1, x2: CLOSE_FRAME.x1 - 10, y2: TITLE_Y2 };
export const HELP_LINE: Rect = { x1: 10, y1: 175, x2: 309, y2: 189 };
/** The tab's page, the tabs' rows above it. */
export const PAGE: Rect = { x1: 5, y1: TITLE_Y2 + 6 + TAB_HEIGHT - 2, x2: 314, y2: HELP_LINE.y1 - 5 };
/** A tab is as wide as DISPLAY and five columns either side. */
export const TAB_FRAMES = tabsOver(PAGE, 4, 7 * 6 + 22);

/** A line of settings is a low button high, a row of the plate between two. */
const LINE_STEP = LOW_BUTTON_HEIGHT + 1;
/** The most lines a tab has. */
export const SETTING_LINES = 5;
const LINES_Y1 = PAGE.y1 + 8;
/** The settings' names, on a panel as tall as the five lines. */
const NAME_PANEL: Rect = { x1: 10, y1: LINES_Y1, x2: 190, y2: LINES_Y1 + SETTING_LINES * LINE_STEP - 2 };
/** The controls' column, right of the names' panel by graphic 0's nine columns. */
const CONTROL_X1 = NAME_PANEL.x2 + 10;
const CONTROL_X2 = 309;
/** KEYS' lines: the five lines, and down to six rows short of the page's foot. */
export const KEYS_AREA: KeysArea = { x1: NAME_PANEL.x1, y1: LINES_Y1, x2: CONTROL_X2, y2: PAGE.y2 - 6, controlX1: CONTROL_X1 };

/** Line `line`'s rectangle across the dialog: the names' panel and the controls' column. */
function lineRect(line: number): Rect {
  const y1 = LINES_Y1 + line * LINE_STEP;
  return { x1: NAME_PANEL.x1, y1, x2: CONTROL_X2, y2: y1 + LOW_BUTTON_HEIGHT - 1 };
}

/** Setting `index`'s button on a tab of buttons: two a line, the first on the left. */
export function settingButtonFrame(index: number): Rect {
  return framesAcross(lineRect(index >> 1), 2)[index & 1]!;
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

/**
 * A setting: its name, what the help line says of it, and its control. A `page` toggle is
 * the page's state, not a stored setting: fullscreen.
 */
type Setting = {
  readonly name: string;
  /** The name it shows when on, where that is not `name`: a choice of two, the aspect ratio's. */
  readonly onName?: string;
  readonly help: string;
  /** Where the help line says something else of it: fullscreen where Esc leaves it. */
  readonly variant?: { readonly when: (ui: UIState) => boolean; readonly help: string };
  /** Where its control is inert, and what the help line says instead: the CRT effect without WebGL. */
  readonly unavailable?: { readonly when: (ui: UIState) => boolean; readonly help: string | ((ui: UIState) => string) };
} & (
  | { readonly kind: 'toggle'; readonly get: (values: SettingsValues) => boolean; readonly set: (values: SettingsValues, on: boolean) => Partial<SettingsValues> }
  | { readonly kind: 'page'; readonly get: (ui: UIState) => boolean; readonly toggle: (ui: UIState) => void }
  | { readonly kind: 'slider'; readonly get: (values: SettingsValues) => number; readonly set: (values: SettingsValues, value: number) => Partial<SettingsValues> }
);

const extra = (key: keyof SettingsValues['extras']) => ({
  kind: 'toggle' as const,
  get: (values: SettingsValues) => values.extras[key],
  set: (values: SettingsValues, on: boolean) => ({ extras: { ...values.extras, [key]: on } }),
});

/**
 * The tabs, in their row's order: a label, the help line's words, and the settings, which
 * KEYS has none of. A tab of `buttons` has only toggles, each a button holding its name.
 */
export const TABS: ReadonlyArray<{
  readonly tab: SettingsTab;
  readonly label: string;
  readonly help: string;
  readonly buttons?: true;
  readonly settings: readonly Setting[];
}> = [
  {
    tab: 'game',
    label: 'GAME',
    help: 'THE EXTRAS, THE VIEWS AND THE STATISTICS',
    buttons: true,
    settings: [
      { name: 'DRINK AT FOUNTAINS', help: 'AN EMPTY HAND ON A FOUNTAIN DRINKS FROM IT', ...extra('drinkAtFountain') },
      { name: 'HIGHLIGHT NEW MASTERY', help: 'A MASTERY JUST GAINED SHOWN IN COLOUR', ...extra('colourNewMastery') },
      { name: 'GATHER THROWN WEAPONS', help: 'WALK OVER A THROWN WEAPON TAKES IT BACK', ...extra('gatherThrownWeapons') },
      { name: 'SHOW ITEM PROPERTIES', help: 'THE EYE ADDS DAMAGE, ARMOUR, FOOD AND MORE', ...extra('showItemProperties') },
      { name: 'UNLIMITED KEY QUEUE', help: 'A HUNDRED MOVES WAIT THEIR TURN, NOT SEVEN', ...extra('unlimitedKeyQueue') },
      {
        name: 'CHAMPION VIEW',
        help: 'THE CHAMPIONS: A LONG PRESS ON A BAR, OR ITS KEY',
        kind: 'toggle',
        get: (values) => values.championView,
        set: (_values, on) => ({ championView: on }),
      },
      {
        name: 'SEND STATISTICS',
        help: 'TELL THE SITE A GAME STARTED, WON OR LOST',
        kind: 'toggle',
        get: (values) => values.statistics,
        set: (_values, on) => ({ statistics: on }),
      },
      {
        name: 'MAP VIEW',
        help: 'THE MAP: A LONG PRESS ON THE MESSAGES, OR ITS KEY',
        kind: 'toggle',
        get: (values) => values.mapView,
        set: (_values, on) => ({ mapView: on }),
      },
    ],
  },
  {
    tab: 'display',
    label: 'DISPLAY',
    help: 'THE SCREEN',
    buttons: true,
    settings: [
      {
        name: 'FULLSCREEN',
        help: 'THE WHOLE SCREEN: HOLD ESC DOWN TO LEAVE IT',
        variant: { when: (ui) => !ui.fullscreen.keepsEscape(), help: 'THE WHOLE SCREEN: ESC LEAVES IT' },
        unavailable: {
          when: (ui) => !ui.fullscreen.isAvailable() || ui.fullscreen.isInstalled(),
          help: (ui) => ui.fullscreen.isInstalled() ? 'THE INSTALLED GAME IS ALWAYS FULLSCREEN' : 'THE BROWSER GIVES NO FULLSCREEN',
        },
        kind: 'page',
        get: (ui) => ui.fullscreen.isOn(),
        toggle: (ui) => ui.fullscreen.toggle(),
      },
      {
        name: 'ASPECT RATIO 16:10',
        onName: 'ASPECT RATIO 4:3',
        help: 'SQUARE PIXELS, OR 4:3 AS ON AN ST MONITOR',
        kind: 'toggle',
        get: (values) => values.aspectRatio === '4:3',
        set: (_values, on) => ({ aspectRatio: on ? '4:3' : '16:10' }),
      },
      {
        name: 'STARTUP ANIMATIONS',
        help: 'THE FTL LOGO AND THE TITLE BEFORE THE ENTRANCE',
        kind: 'toggle',
        get: (values) => values.startupAnimations,
        set: (_values, on) => ({ startupAnimations: on }),
      },
      {
        name: 'SCANLINES',
        help: 'THE LINES OF A TUBE, A DARK GAP BETWEEN THEM',
        unavailable: { when: (ui) => !ui.isCrtAvailable(), help: 'THE SCANLINES NEED WEBGL' },
        kind: 'toggle',
        get: (values) => values.scanlines,
        set: (_values, on) => ({ scanlines: on }),
      },
      {
        name: 'LEFT HANDED',
        help: 'THE PANELS ON THE LEFT, THE VIEW ON THE RIGHT',
        unavailable: { when: (ui) => !leftHandedFits(ui.uiTables), help: 'THIS GAME\'S SCREEN IS LAID OUT ANOTHER WAY' },
        kind: 'toggle',
        get: (values) => values.leftHanded,
        set: (_values, on) => ({ leftHanded: on }),
      },
      {
        name: 'SCREEN CURVE',
        help: 'THE CURVED GLASS OF A TUBE',
        unavailable: { when: (ui) => !ui.isCrtAvailable(), help: 'THE SCREEN CURVE NEEDS WEBGL' },
        kind: 'toggle',
        get: (values) => values.curve,
        set: (_values, on) => ({ curve: on }),
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
  { tab: 'keys', label: 'KEYS', help: 'THE KEYS, AND WHAT EACH ONE DOES', settings: [] },
];

export const TITLE = 'SETTINGS';
export const CLOSE_LABEL = 'CLOSE';
const CLOSE_HELP = 'BACK TO THE GAME, SAME AS ESC AND RIGHT CLICK';
export const EXIT_LABEL = 'EXIT';
export const EXIT_HELP = 'LEAVE THE GAME FOR THE WELCOME PAGE';
/** EXIT's question (see "EXIT"), and its two options: EXIT, then CANCEL. */
export const EXIT_QUESTION = 'LEAVE THE GAME?';
export const EXIT_WARNING = 'WHAT IS NOT SAVED IS LOST';
const EXIT_OPTIONS = [EXIT_LABEL, 'CANCEL'] as const;
const TOGGLE_LABELS = ['ON', 'OFF'] as const;

/* --------------------------------------------------------------------- state ---- */

export interface SettingsDialogState {
  tab: SettingsTab;
  /** Where the pointer is, in screen coordinates, or `null` off the canvas. */
  pointer: DialogPoint;
  /** The line whose slider a click took and the button still holds, or `null`. */
  sliding: number | null;
  /** KEYS' list and the slot waiting for its key, kept across the tabs while the dialog is up. */
  keys: KeysTabState;
  /** EXIT's question, up in the dialog's place (see "EXIT"). */
  exiting: boolean;
  /** The question's button flashing, or `null`. */
  press: MenuPress | null;
}

const SETTINGS_DIALOG: Dialog = {
  name: 'settings',
  uiPalette: true,
  draw: (ui) => drawSettingsDialog(ui),
  click: (ui, x, y, buttons) => settingsDialogClick(ui, x, y, buttons),
  key: (ui, key, code) => settingsDialogKey(ui, key, code),
  wheel: (ui, deltaY) => {
    const state = ui.settingsDialog;
    return state?.tab === 'keys' && !state.exiting && keysTabWheel(ui, state.keys, KEYS_AREA, deltaY);
  },
  pointer: (ui, point) => settingsDialogPointer(ui, point),
  drag: (ui, x) => settingsDialogDrag(ui, x),
  release: (ui) => {
    if (ui.settingsDialog) ui.settingsDialog.sliding = null;
  },
};

/** Put the dialog up, where it was last closed (see "Opening and closing"). Nothing, while another dialog is up. */
export function openSettingsDialog(ui: UIState): void {
  if (ui.dialog) return;
  openDialog(ui, SETTINGS_DIALOG);
  const { tab, scrollTop } = ui.settingsDialogLast;
  const keys = { ...newKeysTabState(), scrollTop };
  ui.settingsDialog = { tab, pointer: ui.hoverPoint, sliding: null, keys, exiting: false, press: null };
}

export function closeSettingsDialog(ui: UIState): void {
  const state = ui.settingsDialog;
  if (!state) return;
  ui.settingsDialogLast = { tab: state.tab, scrollTop: state.keys.scrollTop };
  ui.settingsDialog = null;
  closeDialog(ui);
}

/* ---------------------------------------------------------------- the controls ---- */

const BTN_CLOSE = 1;
const BTN_EXIT = 2;
const BTN_TAB0 = 10;
/**
 * Line `n`'s ON is `BTN_LINE0 + 3n`, its OFF the next, its slider the one after. On a tab
 * of buttons, setting `n`'s button is `BTN_LINE0 + 3n`.
 */
const BTN_LINE0 = 20;
/**
 * Line `n`'s name, or setting `n`'s button where it takes no click: the help line's
 * alone (`hoverButtons`).
 */
const BTN_NAME0 = 60;

function tabOf(state: SettingsDialogState) {
  return TABS.find((t) => t.tab === state.tab) ?? TABS[0]!;
}

function settingsOf(state: SettingsDialogState): readonly Setting[] {
  return tabOf(state).settings;
}

function isButtonsTab(state: SettingsDialogState): boolean {
  return tabOf(state).buttons === true;
}

function inert(ui: UIState, setting: Setting): boolean {
  return setting.unavailable?.when(ui) ?? false;
}

/** Whether a toggle is on: a stored setting, or the page's state. */
function isOn(ui: UIState, setting: Setting & { kind: 'toggle' | 'page' }): boolean {
  return setting.kind === 'page' ? setting.get(ui) : setting.get(ui.settings.values);
}

/** What a setting is called now: a choice of two, the one chosen. */
function nameOf(ui: UIState, setting: Setting): string {
  return setting.onName !== undefined && setting.kind !== 'slider' && isOn(ui, setting) ? setting.onName : setting.name;
}

/** A toggle turned over. */
function turnOver(ui: UIState, setting: Setting & { kind: 'toggle' | 'page' }): void {
  if (setting.kind === 'page') setting.toggle(ui);
  else ui.settings.update(setting.set(ui.settings.values, !setting.get(ui.settings.values)));
}

/**
 * The dialog's button list, in the form of CSBWin's (`x2` and `y2` exclusive): CLOSE, EXIT,
 * the tabs, and each setting's button, or each line's toggle or slider, or KEYS' controls. A
 * control that cannot work has none.
 */
export function settingsDialogButtons(ui: UIState, state: SettingsDialogState): UIButton[] {
  const buttons = [buttonOf(CLOSE_FRAME, BTN_CLOSE, 'settings.close'), buttonOf(EXIT_FRAME, BTN_EXIT, 'settings.exit')];
  buttons.push(...tabButtons(TAB_FRAMES, BTN_TAB0, 'settings.tab').map((b, i) => ({ ...b, name: `settings.tab.${TABS[i]!.tab}` })));
  if (state.tab === 'keys') buttons.push(...keysTabButtons(ui, state.keys, KEYS_AREA));
  const asButtons = isButtonsTab(state);
  settingsOf(state).forEach((setting, line) => {
    if (inert(ui, setting)) return;
    const id = BTN_LINE0 + 3 * line;
    if (asButtons) {
      buttons.push(buttonOf(settingButtonFrame(line), id, `settings.button${line}`));
    } else if (setting.kind === 'slider') {
      buttons.push(sliderButton(sliderRect(line), id + 2, `settings.line${line}.slider`));
    } else {
      const [on, off] = toggleFrames(line);
      buttons.push(buttonOf(on, id, `settings.line${line}.on`), buttonOf(off, id + 1, `settings.line${line}.off`));
    }
  });
  return buttons;
}

/**
 * The buttons, then every line's whole width, or every setting's button frame: what the
 * help line names under the pointer.
 */
function hoverButtons(ui: UIState, state: SettingsDialogState): UIButton[] {
  if (state.tab === 'keys') {
    return [...settingsDialogButtons(ui, state).slice(0, 2 + TABS.length), ...keysTabHoverButtons(ui, state.keys, KEYS_AREA)];
  }
  const asButtons = isButtonsTab(state);
  const lines = settingsOf(state).map((_setting, line): UIButton => {
    const r = asButtons ? settingButtonFrame(line) : lineRect(line);
    return { word0: BTN_NAME0 + line, x1: r.x1, y1: r.y1, x2: r.x2 + 1, y2: r.y2 + 1, button: 2, name: `settings.line${line}` };
  });
  return [...settingsDialogButtons(ui, state), ...lines];
}

/** The control under the pointer: a button's id, a line's name's, or 0. */
function hovered(ui: UIState, state: SettingsDialogState): number {
  const at = state.pointer;
  return at ? searchButtonList(hoverButtons(ui, state), Math.floor(at.x), Math.floor(at.y), 2) : 0;
}

/** The line, or on a tab of buttons the setting, a control's id stands for, or -1. */
function lineOf(id: number): number {
  if (id >= BTN_NAME0) return id < BTN_NAME0 + 2 * SETTING_LINES ? id - BTN_NAME0 : -1;
  return id >= BTN_LINE0 ? Math.floor((id - BTN_LINE0) / 3) : -1;
}

/** What the help line says: what the pointer is over, or nothing. */
export function helpText(ui: UIState, state: SettingsDialogState): string {
  const id = hovered(ui, state);
  if (id === BTN_CLOSE) return CLOSE_HELP;
  if (id === BTN_EXIT) return EXIT_HELP;
  if (state.tab === 'keys') {
    const keys = keysTabHelp(state.keys, id);
    if (keys !== undefined) return keys;
  }
  if (id >= BTN_TAB0 && id < BTN_TAB0 + TABS.length) return TABS[id - BTN_TAB0]!.help;
  const setting = settingsOf(state)[lineOf(id)];
  if (!setting) return '';
  if (inert(ui, setting)) {
    const help = setting.unavailable?.help ?? '';
    return typeof help === 'function' ? help(ui) : help;
  }
  return setting.variant?.when(ui) ? setting.variant.help : setting.help;
}

/* ------------------------------------------------------------------- drawing ---- */

export function drawSettingsDialog(ui: UIState): void {
  const state = ui.settingsDialog;
  if (!state) return;
  if (state.exiting) {
    clearIndex(ui.screenIndexBuffer, 0);
    doMenu(ui, EXIT_QUESTION, EXIT_WARNING, [...EXIT_OPTIONS], true);
    if (state.press) drawMenuPress(ui, state.press, nowMs());
    return;
  }
  const over = hovered(ui, state);
  const look = (id: number, pressed = false): ButtonLook => (pressed ? 'pressed' : over === id ? 'hover' : 'raised');

  drawPlate(ui, DIALOG);
  drawPanel(ui, TITLE_PANEL);
  const title = buttonLabelAt(TITLE_PANEL);
  drawCentredText(ui, TITLE, title.x, title.y, MENU_TITLE1_COLOR);
  drawButton(ui, CLOSE_FRAME, CLOSE_LABEL, look(BTN_CLOSE));
  drawButton(ui, EXIT_FRAME, EXIT_LABEL, look(BTN_EXIT));

  drawTabbedPage(ui, PAGE, TAB_FRAMES, TABS.map((t) => t.label), TABS.findIndex((t) => t.tab === state.tab), over >= BTN_TAB0 && over < BTN_TAB0 + TABS.length ? over - BTN_TAB0 : -1);

  if (state.tab === 'keys') {
    drawKeysTab(ui, state.keys, KEYS_AREA, over);
  } else if (isButtonsTab(state)) {
    drawSettingButtons(ui, state, look);
  } else {
    drawSettingLines(ui, state, look);
  }

  drawHelpLine(ui, HELP_LINE, helpText(ui, state));
}

/** A tab's settings, a button each holding its name: pressed when on, dim where it cannot work. */
function drawSettingButtons(ui: UIState, state: SettingsDialogState, look: (id: number, pressed?: boolean) => ButtonLook): void {
  settingsOf(state).forEach((setting, index) => {
    if (setting.kind === 'slider') return;
    const frame = settingButtonFrame(index);
    drawButton(ui, frame, nameOf(ui, setting), inert(ui, setting) ? 'dim' : look(BTN_LINE0 + 3 * index, isOn(ui, setting)));
  });
}

/** A tab's settings, one a line: its name on the names' panel, and its toggle or slider. */
function drawSettingLines(ui: UIState, state: SettingsDialogState, look: (id: number, pressed?: boolean) => ButtonLook): void {
  drawPanel(ui, NAME_PANEL);
  const values = ui.settings.values;
  settingsOf(state).forEach((setting, line) => {
    drawText(ui, nameOf(ui, setting), NAME_PANEL.x1 + 4, buttonLabelAt(lineRect(line)).y);
    const id = BTN_LINE0 + 3 * line;
    if (setting.kind === 'slider') {
      drawSlider(ui, sliderRect(line), setting.get(values));
      return;
    }
    const frames = toggleFrames(line);
    const on = isOn(ui, setting);
    frames.forEach((frame, i) => {
      drawButton(ui, frame, TOGGLE_LABELS[i]!, inert(ui, setting) ? 'inert' : look(id + i, on === (i === 0)));
    });
  });
}

/* ------------------------------------------------------------------- the input ---- */

/**
 * A click: a right one closes it, but on KEYS' slots; a left one on a control acts at
 * once, a setting's button turned over, a toggle's side chosen. EXIT's question takes its
 * own (`exitQuestionClick`).
 */
export function settingsDialogClick(ui: UIState, x: number, y: number, buttons: number): void {
  const state = ui.settingsDialog;
  if (!state) return;
  if (state.exiting) {
    exitQuestionClick(ui, state, x, y, buttons);
    return;
  }
  const id = searchButtonList(settingsDialogButtons(ui, state), Math.floor(x), Math.floor(y), buttons);
  if ((buttons & 1) !== 0) {
    if (state.tab !== 'keys' || !keysTabRightClick(ui, state.keys, id)) closeSettingsDialog(ui);
    return;
  }
  if (id === BTN_CLOSE) {
    closeSettingsDialog(ui);
    return;
  }
  state.keys.capture = null;
  if (id === BTN_EXIT) {
    state.exiting = true;
    return;
  }
  if (id >= BTN_TAB0 && id < BTN_TAB0 + TABS.length) {
    state.tab = TABS[id - BTN_TAB0]!.tab;
    return;
  }
  if (state.tab === 'keys') {
    keysTabClick(ui, state.keys, KEYS_AREA, id);
    return;
  }
  const line = lineOf(id);
  const setting = settingsOf(state)[line];
  if (!setting) return;
  if (isButtonsTab(state)) {
    if (setting.kind !== 'slider') turnOver(ui, setting);
    return;
  }
  if (setting.kind === 'slider') {
    state.sliding = line;
    ui.settings.update(setting.set(ui.settings.values, sliderValueAt(sliderRect(line), x)));
    return;
  }
  const on = (id - BTN_LINE0) % 3 === 0;
  if (isOn(ui, setting) !== on) turnOver(ui, setting);
}

/**
 * A click on EXIT's question: a right one is CANCEL, and a left one on EXIT or CANCEL,
 * `_WaitForMenuSelect`'s 1 and 2, flashes it, then leaves the game or puts the dialog
 * back. Nothing while a button flashes.
 */
function exitQuestionClick(ui: UIState, state: SettingsDialogState, x: number, y: number, buttons: number): void {
  if (state.press) return;
  if ((buttons & 1) !== 0) {
    state.exiting = false;
    return;
  }
  const list = menuButtonList(ui, EXIT_OPTIONS.length, true);
  const choice = menuHitTest(list, Math.floor(x), Math.floor(y), buttons);
  const rect = menuButtonRect(list, 209 + choice);
  if (!rect) return;
  const press: MenuPress = { buttonId: 209 + choice, rect, startedMs: nowMs() };
  state.press = press;
  playMenuPress(ui, press, () => ui.settingsDialog?.press === press, () => {
    state.press = null;
    if (choice === 1) ui.onExit();
    else state.exiting = false;
    ui.renderLastFrame();
  });
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

/**
 * KEYS takes its keys (`keysTabKey`); else Esc closes it, or is EXIT's question's CANCEL,
 * and no other key does anything.
 */
export function settingsDialogKey(ui: UIState, _key: string, code: string): void {
  const state = ui.settingsDialog;
  if (!state) return;
  if (state.exiting) {
    if (code === 'Escape' && !state.press) state.exiting = false;
    return;
  }
  if (state.tab === 'keys' && keysTabKey(ui, state.keys, KEYS_AREA, code)) return;
  if (code === 'Escape') closeSettingsDialog(ui);
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
  return !state.exiting && hovered(ui, state) !== was;
}
