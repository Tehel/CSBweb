/**
 * The settings dialog (`src/renderer/ui/SettingsDialog.ts`): everything about it the
 * golden frames cannot see.
 *
 * 1. **The message area's buttons.** A double click there opens the dialog, and the
 *    gesture is meant to take nothing from the game: a click counts only where it hits no
 *    button (`GameInput.messageAreaDoubleClick`). So every list of every mode is searched
 *    over the strip, from `graphics.dat` as the game reads it: only the freeze's pixel
 *    (x 0, y 198, `Buttons17196`) and the frozen game's thaw (`Buttons17832`, the whole
 *    screen) take a left click there.
 * 2. **The layout**: the title line and the help line inside the plate's interior, the
 *    tabs on the page's top edge, every setting's control inside the page, none over
 *    another, every name inside its button or its panel and every help line inside the
 *    help line.
 * 3. **The controls**: a tab, a setting's button, which a click turns over, a toggle, the
 *    slider clicked, dragged past the track's end and released; a click on the chosen side
 *    of a toggle changes nothing; SCANLINES' and SCREEN CURVE's buttons dim without WebGL,
 *    taking no click, the help line saying why; ASPECT RATIO's button naming the shape chosen,
 *    raised at 16:10 and pressed at 4:3; FULLSCREEN asking the page, changing no setting,
 *    shown as the page says, its help line as Esc leaves it, and inert where the browser
 *    has none; Esc, CLOSE and a right click close it; the clock held while it is up.
 * 3b. **EXIT** asks first, `_DoMenu`'s centred two-option menu on black, which takes no
 *    key but Esc and no notch of the wheel; Esc, a right click and CANCEL put the
 *    dialog back, CANCEL and EXIT once their button has flashed, and only EXIT leaves
 *    for the welcome page (`UIState.onExit`), the clock held until the page goes.
 * 4. **The help line** follows the pointer, and the pointer's move says when it changes.
 * 5. **Opening it**, through `GameInput` over the interface's real lists: Esc, awake, asleep
 *    and frozen, but not over the Reincarnate screen; Pause freezes; a double click on
 *    the message area, not a slow one, not one on the freeze's pixel, and never in a
 *    frozen game, whose first click thaws it. Esc held down, repeating, opens and closes
 *    nothing. A key reaches KEYS by its code.
 * 6. **KEYS** (`SettingsKeys.ts`): its layout; a slot clicked waits for its key, which
 *    fills it and leaves every other slot, Esc cancelling and never bound; a right click
 *    empties a slot; the presets, CUSTOM inert until a key is changed; the labels'
 *    layout, left out where the browser gives the keyboard's, the list taking its line;
 *    the list scrolled by the wheel, three rows a notch and a touchpad's small deltas
 *    added up, its arrows and the keys; the wheel's scroll says it is to be drawn. `tools/dump-key-bindings.ts` checks the tables and labels.
 *
 * Run: `npm test -- --only=dump-settings-dialog.ts`
 */
import { emptyDungeonData } from '../src/data/DungeonLoader';
import type { Rect } from '../src/data/tables/UITables';
import type { Game } from '../src/engine/Game';
import { GameInput, MESSAGE_DOUBLE_CLICK_MS, type KeyPress } from '../src/renderer/GameInput';
import type { GameScreen } from '../src/renderer/GameScreen';
import { MESSAGE_AREA } from '../src/renderer/csbwin/ScrollingText';
import { isDialogOpen } from '../src/renderer/ui/Dialog';
import { DEFAULT_KEY_BINDINGS, keyAction, tableKeyButton } from '../src/renderer/ui/Keyboard';
import { MENU_GRAPHIC, MENU_PRESS_PHASE_MS, menuButtonList } from '../src/renderer/ui/Menu';
import { searchMouseButtons, syncInventoryButtons, updateButtonLists } from '../src/renderer/ui/Mouse';
import {
  CLOSE_FRAME, EXIT_FRAME, EXIT_HELP, EXIT_LABEL, EXIT_QUESTION, EXIT_WARNING, HELP_LINE, KEYS_AREA, PAGE, SETTING_LINES, TABS, TAB_FRAMES, closeSettingsDialog, drawSettingsDialog,
  helpText, openSettingsDialog, settingsDialogButtons, settingsDialogClick, settingsDialogKey, settingsDialogPointer,
  settingButtonFrame, sliderRect, toggleFrames,
} from '../src/renderer/ui/SettingsDialog';
import {
  CAPTURE_HELP, CAPTURE_LABEL, KEY_ACTION_NAMES, LABELS_HELP, LABELS_NAME, PRESETS, SLOT_HELP,
  keysList, labelsNamePanel, layoutFrames, presetFrames, slotLabel, slotRect,
} from '../src/renderer/ui/SettingsKeys';
import { KEY_LABEL_CHARS } from '../src/renderer/ui/KeyLabels';
import { KEYPAD_KEY_BINDINGS } from '../src/renderer/ui/Keyboard';
import { WHEEL_ROW_DELTA, arrowBox, listTextX } from '../src/renderer/ui/Widgets';
import { UIMode, type UIState } from '../src/renderer/ui/UIState';
import { CHAR_WIDTH, DIM_COLOR, LIT_COLOR, buttonLabelAt, buttonRect, drawButton } from '../src/renderer/ui/Widgets';
import { MENU_OPTION_COLOR } from '../src/renderer/ui/Menu';
import { Settings } from '../src/settings/Settings';
import { NO_FULLSCREEN, type Fullscreen } from '../src/lib/fullscreen';
import { check, finish } from './lib/check';
import { newGame, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';

const graphics = stockGraphics();
const image = graphics.getImage(MENU_GRAPHIC);
const menuBitmap = { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };

function freshUI(crt = true, layoutMap: ReadonlyMap<string, string> | null = null, fullscreen = NO_FULLSCREEN, onExit = () => {}): UIState {
  return newUIState(graphics, newGame(emptyDungeonData(), graphics).ctx, {
    onExit,
    getGraphicBitmap: (n) => (n === MENU_GRAPHIC ? menuBitmap : null),
    settings: new Settings(null),
    isCrtAvailable: () => crt,
    fullscreen,
    keyboardLayout: () => layoutMap,
  });
}

/** A page's fullscreen, which `toggle` turns over at once, as a browser does once it has. */
function fakeFullscreen(keepsEscape: boolean): Fullscreen & { asked: number } {
  let on = false;
  const fullscreen = {
    asked: 0,
    isAvailable: () => true,
    isOn: () => on,
    toggle: () => { fullscreen.asked++; on = !on; },
    keepsEscape: () => keepsEscape,
  };
  return fullscreen;
}

const centre = (r: Rect) => ({ x: (r.x1 + r.x2) >> 1, y: (r.y1 + r.y2) >> 1 });
const inside = (r: Rect, outer: Rect) => r.x1 >= outer.x1 && r.x2 <= outer.x2 && r.y1 >= outer.y1 && r.y2 <= outer.y2;
const overlap = (a: Rect, b: Rect) => a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
/** The plate's interior, inside its ten pixels of frame; the page's, inside its two of outline. */
const interior: Rect = { x1: 10, y1: 10, x2: 309, y2: 189 };
const pageInterior: Rect = { x1: PAGE.x1 + 2, y1: PAGE.y1 + 2, x2: PAGE.x2 - 2, y2: PAGE.y2 - 2 };
/** The title line and the help line inside the plate's interior, clear of the page and its tabs. */
function checkDialogFrames(): void {
  const common: Array<[string, Rect]> = [['CLOSE', CLOSE_FRAME], ['EXIT', EXIT_FRAME], ['help line', HELP_LINE]];
  check(common.every(([, f]) => inside(f, interior) && !overlap(f, PAGE) && TAB_FRAMES.every((t) => !overlap(f, t))),
    'CLOSE, EXIT and the help line inside the plate\'s interior, clear of the page and its tabs');
  check(TAB_FRAMES.every((t) => t.y2 === PAGE.y1 + 1 && t.x1 > PAGE.x1 && t.x2 < PAGE.x2) && TAB_FRAMES[0].y1 > CLOSE_FRAME.y2,
    'the tabs stand on the page\'s top edge, under the title line');
}
const click = (ui: UIState, r: Rect, buttons = 2) => {
  const at = centre(buttonRect(r));
  settingsDialogClick(ui, at.x, at.y, buttons);
};

console.log('=== 1. the message area\'s buttons ===');
{
  const ui = freshUI();
  const lists: Array<[string, () => void]> = [
    ['adventure', () => { ui.uiMode = UIMode.Adventure; updateButtonLists(ui); }],
    ['inventory', () => { ui.partyState.selectedCharacterIndex = 0; syncInventoryButtons(ui); }],
    ['asleep', () => { ui.partyState.selectedCharacterIndex = -1; ui.uiMode = UIMode.Sleeping; updateButtonLists(ui); }],
    ['frozen', () => { ui.uiMode = UIMode.Frozen; updateButtonLists(ui); }],
  ];
  const found: Record<string, string[]> = {};
  for (const [mode, enter] of lists) {
    enter();
    const hits = new Map<number, number>();
    for (let y = MESSAGE_AREA.y1; y <= MESSAGE_AREA.y2; y++) {
      for (let x = MESSAGE_AREA.x1; x <= MESSAGE_AREA.x2; x++) {
        const id = searchMouseButtons(ui, x, y, 2);
        if (id !== 0) hits.set(id, (hits.get(id) ?? 0) + 1);
      }
    }
    found[mode] = [...hits].map(([id, n]) => `${id} on ${n} pixels`);
    console.log(`  ${mode}: ${found[mode].join(', ') || 'no left button'}`);
  }
  const strip = (MESSAGE_AREA.x2 - MESSAGE_AREA.x1 + 1) * (MESSAGE_AREA.y2 - MESSAGE_AREA.y1 + 1);
  check(found.adventure.join() === '147 on 1 pixels', 'awake, the freeze\'s one pixel is the strip\'s one left button');
  check(found.inventory.join() === '147 on 1 pixels', 'the inventory adds none: its whole-screen button is a right click');
  check(found.asleep.length === 0, 'asleep, nothing in the strip takes a left click');
  check(found.frozen.join() === `148 on ${strip - 320 - 27} pixels`,
    'frozen, the thaw takes the whole strip, but for the last row and column its exclusive x2 and y2 leave out');
}

console.log('\n=== 2. the layout ===');
{
  checkDialogFrames();
  const lineFrames: Array<[string, Rect]> = [];
  for (let line = 0; line < SETTING_LINES; line++) {
    const [on, off] = toggleFrames(line);
    lineFrames.push([`line ${line} ON`, on], [`line ${line} OFF`, off]);
  }
  const buttonFrames = Array.from({ length: 2 * SETTING_LINES }, (_, i): [string, Rect] => [`button ${i}`, settingButtonFrame(i)]);
  for (const [layout, frames] of [['lines', lineFrames], ['buttons', buttonFrames]] as const) {
    check(frames.every(([, f]) => inside(f, pageInterior)), `${layout}: every frame inside the page`);
    const clashes = frames.flatMap(([a, fa], i) => frames.slice(i + 1).filter(([, fb]) => overlap(fa, fb)).map(([b]) => `${a}/${b}`));
    check(clashes.length === 0, `${layout}: no frame over another${clashes.length ? `: ${clashes.join(', ')}` : ''}`);
  }
  const nameChars = Math.floor((toggleFrames(0)[0].x1 - 10 - 1 - 14 + 1) / CHAR_WIDTH);
  const helpChars = Math.floor((HELP_LINE.x2 - 1 - (HELP_LINE.x1 + 4) + 1) / CHAR_WIDTH);
  const settings = TABS.flatMap((t) => t.settings ?? []);
  const lineCount = (t: (typeof TABS)[number]) => (t.buttons ? Math.ceil(t.settings.length / 2) : t.settings.length);
  console.log(`  lines: ${TABS.map((t) => `${t.label} ${lineCount(t)}`).join(', ')}`);
  check(TABS.every((t) => lineCount(t) <= SETTING_LINES), `no tab has more than ${SETTING_LINES} lines`);
  check(TABS.every((t) => !t.buttons || t.settings.every((s) => s.kind !== 'slider')), 'a tab of buttons has only toggles');
  const outside = TABS.filter((t) => t.buttons).flatMap((t) => t.settings.flatMap((s, i) => {
    const frame = settingButtonFrame(i);
    return [s.name, s.onName ?? s.name].filter((name) => {
      const x1 = buttonLabelAt(frame).x - (CHAR_WIDTH / 2) * name.length;
      return x1 < frame.x1 + 6 || x1 + name.length * CHAR_WIDTH - 1 > frame.x2 - 6;
    });
  }));
  check(outside.length === 0, `every name inside its button's face${outside.length ? `: ${outside.join(', ')}` : ''}`);
  check(TABS.filter((t) => !t.buttons).every((t) => t.settings.every((s) => Math.max(s.name.length, s.onName?.length ?? 0) <= nameChars)),
    `every line's name fits its panel, ${nameChars} characters`);
  const helps = [EXIT_HELP, ...settings.flatMap((s) => [s.help, s.variant?.help ?? '', s.unavailable?.help ?? '']), ...TABS.map((t) => t.help)];
  check(helps.every((h) => h.length <= helpChars), `every help line fits, ${helpChars} characters`);
}

console.log('\n=== 3. the controls ===');
{
  const ui = freshUI();
  openSettingsDialog(ui);
  const state = ui.settingsDialog!;
  check(isDialogOpen(ui) && ui.ctx.state.paused, 'open, it is the dialog, and the clock is held');
  check(state.tab === 'game', 'it opens on GAME');
  const values = () => ui.settings.values;

  let updates = 0;
  ui.settings.subscribe(() => updates++);
  updates = 0;
  click(ui, settingButtonFrame(2));
  check(values().extras.gatherThrownWeapons && !values().extras.drinkAtFountain, 'GATHER THROWN WEAPONS\' button turns that extra on, alone');
  click(ui, settingButtonFrame(2));
  check(updates === 2 && !values().extras.gatherThrownWeapons, 'a click on it pressed turns it off');
  click(ui, settingButtonFrame(3));
  check(values().mapView, 'MAP VIEW\'s button, below COLOUR NEW MASTERY\'s, turns the map on');
  click(ui, settingButtonFrame(4));
  check(!values().statistics, 'SEND STATISTICS\', pressed, turns them off');
  click(ui, settingButtonFrame(5));
  check(values().championView, 'CHAMPION VIEW\'s, beside it, turns the champions on');
  const gaps = [
    { x: settingButtonFrame(0).x2 + 4, y: centre(settingButtonFrame(0)).y },
    { x: centre(settingButtonFrame(6)).x, y: centre(settingButtonFrame(6)).y },
  ];
  updates = 0;
  for (const at of gaps) settingsDialogClick(ui, at.x, at.y, 2);
  check(updates === 0, 'a click between two buttons, or where no seventh setting is, changes nothing');

  click(ui, TAB_FRAMES[2]);
  check(state.tab === 'sound', 'SOUND\'s tab selects it');
  click(ui, toggleFrames(0)[1]);
  check(!values().sound, 'SOUND, a line, has its toggle: OFF turns the sound off');
  updates = 0;
  click(ui, toggleFrames(0)[1]);
  check(updates === 0, 'a click on the side already chosen changes nothing');
  click(ui, toggleFrames(0)[0]);

  const track = sliderRect(1);
  settingsDialogClick(ui, track.x1, centre(track).y, 2);
  check(values().volume === 0 && state.sliding === 1, 'a click at the slider\'s left end sets the volume to 0, and holds the knob');
  ui.dialog?.drag?.(ui, track.x2 + 40, centre(track).y);
  check(values().volume === 1, 'dragged past the track\'s right end, the volume is 1');
  ui.dialog?.drag?.(ui, centre(track).x, 0);
  const middle = values().volume;
  check(middle > 0.45 && middle < 0.55, `dragged to the track's middle, the volume is a half (${middle.toFixed(3)})`);
  ui.dialog?.release?.(ui);
  ui.dialog?.drag?.(ui, track.x1, centre(track).y);
  check(state.sliding === null && values().volume === middle, 'released, a move drags nothing');

  click(ui, TAB_FRAMES[3]);
  check(state.tab === 'keys', 'KEYS\' tab selects it');

  click(ui, TAB_FRAMES[0]);
  settingsDialogKey(ui, 'Enter', 'Enter');
  check(isDialogOpen(ui), 'a key other than Esc does nothing');
  settingsDialogKey(ui, 'Escape', 'Escape');
  check(!isDialogOpen(ui) && !ui.ctx.state.paused, 'Esc closes it, and the clock runs');
  openSettingsDialog(ui);
  settingsDialogClick(ui, 100, 100, 1);
  check(!isDialogOpen(ui), 'a right click closes it');
  openSettingsDialog(ui);
  click(ui, CLOSE_FRAME);
  check(!isDialogOpen(ui), 'CLOSE closes it');
  // It opens again where it was closed: on its tab, KEYS' list scrolled as it was.
  openSettingsDialog(ui);
  click(ui, TAB_FRAMES[3]);
  ui.settingsDialog!.keys.scrollTop = 6;
  click(ui, CLOSE_FRAME);
  openSettingsDialog(ui);
  check(ui.settingsDialog!.tab === 'keys' && ui.settingsDialog!.keys.scrollTop === 6 && ui.settingsDialog!.keys.capture === null,
    'closed on KEYS scrolled six rows, it opens there again, no slot waiting');
  click(ui, TAB_FRAMES[2]);
  settingsDialogKey(ui, 'Escape', 'Escape');
  openSettingsDialog(ui);
  check(ui.settingsDialog!.tab === 'sound' && ui.settingsDialog!.keys.scrollTop === 6, 'closed by Esc on SOUND, it opens on SOUND, KEYS still scrolled');
  click(ui, CLOSE_FRAME);
  check(freshUI().settingsDialogLast.tab === 'game', 'a new page opens it on GAME');

  const noWebGL = freshUI(false);
  openSettingsDialog(noWebGL);
  noWebGL.settingsDialog!.tab = 'display';
  const names = settingsDialogButtons(noWebGL, noWebGL.settingsDialog!).map((b) => b.name);
  check(!names.includes('settings.button3') && !names.includes('settings.button5') && names.includes('settings.button2'),
    'without WebGL, SCANLINES and SCREEN CURVE have no button in the list, and STARTUP ANIMATIONS has');
  click(noWebGL, settingButtonFrame(3));
  click(noWebGL, settingButtonFrame(5));
  check(!noWebGL.settings.values.scanlines && !noWebGL.settings.values.curve, 'and a click on either does nothing');
  settingsDialogPointer(noWebGL, centre(settingButtonFrame(5)));
  check(helpText(noWebGL, noWebGL.settingsDialog!) === 'THE SCREEN CURVE NEEDS WEBGL', 'the help line says why');
  settingsDialogPointer(noWebGL, centre(settingButtonFrame(3)));
  check(helpText(noWebGL, noWebGL.settingsDialog!) === 'THE SCANLINES NEED WEBGL', 'and of the scanlines');
  // Its label is grey, and not lit under the pointer; STARTUP ANIMATIONS', on, is lit.
  drawSettingsDialog(noWebGL);
  const colours = (r: Rect) => {
    const face = buttonRect(r);
    const found = new Set<number>();
    const buf = noWebGL.screenIndexBuffer;
    for (let y = face.y1; y <= face.y2; y++) for (let x = face.x1; x <= face.x2; x++) found.add(buf.pixels[y * buf.width + x]);
    return found;
  };
  const crt = colours(settingButtonFrame(3));
  const startup = colours(settingButtonFrame(2));
  check(crt.has(DIM_COLOR) && !crt.has(MENU_OPTION_COLOR) && !crt.has(LIT_COLOR), 'SCANLINES\' label is dim, under the pointer');
  check(startup.has(LIT_COLOR) && !startup.has(DIM_COLOR), 'STARTUP ANIMATIONS\', on, is pressed and lit');

  // ASPECT RATIO, DISPLAY's second button: a choice of two, its button named for the one
  // chosen, raised at 16:10, the default, and pressed at 4:3; drawn as the kit draws a
  // button of that name and look.
  {
    const ui = freshUI();
    openSettingsDialog(ui);
    click(ui, TAB_FRAMES[1]);
    const frame = settingButtonFrame(1);
    const face = (of: UIState) => {
      const r = buttonRect(frame);
      const buf = of.screenIndexBuffer;
      const rows: number[] = [];
      for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) rows.push(buf.pixels[y * buf.width + x]);
      return rows.join(',');
    };
    const drawnAs = (label: string, look: 'raised' | 'pressed') => {
      const other = freshUI();
      drawButton(other, frame, label, look);
      return face(other);
    };
    const shown = () => {
      settingsDialogPointer(ui, null);
      drawSettingsDialog(ui);
      return face(ui);
    };
    check(ui.settings.values.aspectRatio === '16:10' && shown() === drawnAs('ASPECT RATIO 16:10', 'raised'),
      'ASPECT RATIO is 16:10 by default, its button raised and so named');
    click(ui, frame);
    check(ui.settings.values.aspectRatio === '4:3' && shown() === drawnAs('ASPECT RATIO 4:3', 'pressed'),
      'a click makes it 4:3, its button pressed and so named');
    click(ui, frame);
    check(ui.settings.values.aspectRatio === '16:10' && shown() === drawnAs('ASPECT RATIO 16:10', 'raised'),
      'a second click makes it 16:10 again');
    settingsDialogPointer(ui, centre(frame));
    check(helpText(ui, ui.settingsDialog!) === 'SQUARE PIXELS, OR 4:3 AS ON AN ST MONITOR', 'the help line names both');
  }

  // FULLSCREEN, DISPLAY's first button: the page's state, no setting.
  check(!names.includes('settings.button0'), 'where the browser has no fullscreen, FULLSCREEN has no button in the list');
  settingsDialogPointer(noWebGL, centre(settingButtonFrame(0)));
  check(helpText(noWebGL, noWebGL.settingsDialog!) === 'THE BROWSER GIVES NO FULLSCREEN', 'and the help line says why');
  for (const keepsEscape of [true, false]) {
    const page = fakeFullscreen(keepsEscape);
    const full = freshUI(true, null, page);
    openSettingsDialog(full);
    click(full, TAB_FRAMES[1]);
    let changes = 0;
    full.settings.subscribe(() => changes++);
    changes = 0;
    settingsDialogPointer(full, centre(settingButtonFrame(0)));
    const help = helpText(full, full.settingsDialog!);
    console.log(`  Esc ${keepsEscape ? 'kept' : 'not kept'}: "${help}"`);
    check(help === (keepsEscape ? 'THE WHOLE SCREEN: HOLD ESC DOWN TO LEAVE IT' : 'THE WHOLE SCREEN: ESC LEAVES IT'),
      `the help line says how fullscreen is left, Esc ${keepsEscape ? 'held down where the page keeps it' : 'where it does not'}`);
    if (!keepsEscape) continue;
    // Its label lit, with the pointer off the canvas: pressed.
    const lit = () => {
      settingsDialogPointer(full, null);
      drawSettingsDialog(full);
      const face = buttonRect(settingButtonFrame(0));
      const buf = full.screenIndexBuffer;
      for (let y = face.y1; y <= face.y2; y++) for (let x = face.x1; x <= face.x2; x++) if (buf.pixels[y * buf.width + x] === LIT_COLOR) return true;
      return false;
    };
    check(!lit(), 'out of fullscreen, its button is raised');
    click(full, settingButtonFrame(0));
    check(page.asked === 1 && page.isOn() && changes === 0, 'a click on FULLSCREEN asks the page, and changes no setting');
    check(lit(), 'in fullscreen, it is pressed and lit');
    click(full, settingButtonFrame(0));
    check(page.asked === 2 && !page.isOn(), 'a second click asks the page out of it');
  }
}

console.log('\n=== 3b. EXIT ===');
{
  let exits = 0;
  const ui = freshUI(true, null, NO_FULLSCREEN, () => exits++);
  const pressOut = () => new Promise((resolve) => setTimeout(resolve, 2 * MENU_PRESS_PHASE_MS + 50));
  const drawn = () => {
    drawSettingsDialog(ui);
    return ui.screenIndexBuffer.pixels;
  };
  const colours = (r: Rect) => {
    const pixels = drawn();
    const seen = new Set<number>();
    for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) seen.add(pixels[y * 320 + x]);
    return seen;
  };
  const [exit, cancel] = menuButtonList(ui, 2, true);
  const at = (b: { x1: number; y1: number; x2: number; y2: number }) => ({ x: (b.x1 + b.x2 - 1) >> 1, y: (b.y1 + b.y2 - 1) >> 1 });
  const menuClick = (b: typeof exit, buttons = 2) => settingsDialogClick(ui, at(b).x, at(b).y, buttons);

  openSettingsDialog(ui);
  const state = ui.settingsDialog!;
  check(settingsDialogButtons(ui, state).some((b) => b.name === 'settings.exit'), 'EXIT is in the dialog\'s button list');
  check(colours(buttonRect(EXIT_FRAME)).has(MENU_OPTION_COLOR), `EXIT is labelled, "${EXIT_LABEL}"`);
  click(ui, TAB_FRAMES[3]);
  click(ui, EXIT_FRAME);
  check(state.exiting && isDialogOpen(ui) && exits === 0, 'EXIT, from KEYS too, asks first: the question is up, and nothing has left');
  const pixels = drawn();
  check(pixels.slice(0, 320 * 33).every((p) => p === 0), 'the question is on black, the dialog gone');
  check(colours({ x1: 47, y1: 33, x2: 47 + 223, y2: 33 + 135 }).size > 2, `"${EXIT_QUESTION}" / "${EXIT_WARNING}" is drawn centred, where _DoMenu puts it`);
  check(!settingsDialogPointer(ui, centre(CLOSE_FRAME)), 'under the question, the pointer moved over CLOSE changes nothing drawn');

  settingsDialogKey(ui, 'Enter', 'Enter');
  ui.dialog?.wheel(ui, 100);
  check(state.exiting && state.keys.scrollTop === 0, 'it takes no key but Esc, and no notch of the wheel');
  settingsDialogKey(ui, 'Escape', 'Escape');
  check(!state.exiting && isDialogOpen(ui) && state.tab === 'keys', 'Esc is CANCEL: the dialog is back, on its tab');
  click(ui, EXIT_FRAME);
  settingsDialogClick(ui, 5, 5, 1);
  check(!state.exiting && isDialogOpen(ui), 'a right click is CANCEL too');

  click(ui, EXIT_FRAME);
  settingsDialogClick(ui, 5, 5, 2);
  check(state.exiting && state.press === null, 'a click on neither button does nothing');
  menuClick(cancel);
  check(state.press?.buttonId === 211 && state.exiting, 'CANCEL flashes, the question still up');
  settingsDialogKey(ui, 'Escape', 'Escape');
  menuClick(exit);
  check(state.press?.buttonId === 211, 'while it flashes, Esc and a click do nothing');
  await pressOut();
  check(!state.exiting && state.press === null && isDialogOpen(ui) && exits === 0, 'then the dialog is back, and nothing has left');

  click(ui, EXIT_FRAME);
  menuClick(exit);
  check(state.press?.buttonId === 210 && exits === 0, 'EXIT flashes, and leaves nothing yet');
  await pressOut();
  check(exits === 1, 'then it asks the page to leave for the welcome page');
  check(isDialogOpen(ui) && ui.ctx.state.paused, 'and the clock is held till the page goes');
}

console.log('\n=== 4. the help line ===');
{
  const ui = freshUI();
  openSettingsDialog(ui);
  const state = ui.settingsDialog!;
  check(helpText(ui, state) === '', 'with the pointer off the canvas it says nothing');
  check(settingsDialogPointer(ui, centre(settingButtonFrame(0))), 'the pointer onto a setting\'s button changes it');
  console.log(`  "${helpText(ui, state)}"`);
  check(helpText(ui, state) === TABS[0].settings[0].help, 'it names the setting under the pointer');
  const drink = buttonRect(settingButtonFrame(0));
  check(!settingsDialogPointer(ui, { x: drink.x1, y: drink.y1 }), 'a move within the button changes nothing');
  check(settingsDialogPointer(ui, { x: settingButtonFrame(0).x1 + 2, y: centre(settingButtonFrame(0)).y }),
    'onto its bevel, it changes: the button is no longer lit');
  check(helpText(ui, state) === TABS[0].settings[0].help, 'and the help line still names the setting');
  check(settingsDialogPointer(ui, centre(settingButtonFrame(4))), 'onto the third line\'s button, it changes');
  check(helpText(ui, state) === TABS[0].settings[4].help, 'and names SEND STATISTICS');
  state.tab = 'sound';
  settingsDialogPointer(ui, { x: 40, y: centre(toggleFrames(0)[0]).y });
  check(helpText(ui, state) === TABS[2].settings[0].help, 'on SOUND, a line\'s name names its setting');
  check(settingsDialogPointer(ui, centre(buttonRect(toggleFrames(0)[1]))), 'onto its toggle\'s OFF, it changes: OFF is lit');
  check(helpText(ui, state) === TABS[2].settings[0].help, 'and the help line still names the setting');
  state.tab = 'game';
  settingsDialogPointer(ui, centre(buttonRect(TAB_FRAMES[1])));
  check(helpText(ui, state) === TABS[1].help, 'over a tab, the tab');
  settingsDialogPointer(ui, centre(buttonRect(CLOSE_FRAME)));
  check(helpText(ui, state).startsWith('BACK TO THE GAME'), 'over CLOSE, what it does');
  settingsDialogPointer(ui, centre(buttonRect(EXIT_FRAME)));
  check(helpText(ui, state) === EXIT_HELP, 'over EXIT, where it leads');
  drawSettingsDialog(ui);
  check(ui.screenIndexBuffer.pixels.some((p) => p !== 0), 'it draws');
  closeSettingsDialog(ui);
}

console.log('\n=== 5. opening it ===');
{
  check(DEFAULT_KEY_BINDINGS.freeze[0] === 'Pause' && keyAction('Pause') === 'freeze', 'Pause freezes');
  check(keyAction('Escape') === null, 'Esc is bound to no action');

  const ui = freshUI();
  const queued: Array<{ x: number; y: number }> = [];
  let reincarnate = false;
  const screen = {
    isDialogOpen: () => isDialogOpen(ui),
    screenPoint: (x: number, y: number) => ({ x, y }),
    openSettings: () => openSettingsDialog(ui),
    // MAP VIEW is off: a press held on the message area opens nothing (`tools/dump-map-dialog.ts`).
    openMap: () => false,
    // CHAMPION VIEW is off too: no press is held back (`tools/dump-champion-dialog.ts`).
    championBarsAt: () => -1,
    handleDialogClick: (x: number, y: number, b: number) => ui.dialog?.click(ui, x, y, b),
    handleDialogKey: (key: string, code: string) => ui.dialog?.key(ui, key, code),
    isReincarnateScreenOpen: () => reincarnate,
    handleReincarnateKey: () => {},
    handleReincarnateClick: () => {},
    searchMouseButtons: (x: number, y: number, b: number) => searchMouseButtons(ui, x, y, b),
    translateKey: (code: string) => tableKeyButton(ui, code),
    handleUIKey: () => false,
    isHintOracleUp: () => false,
    setHoverPoint: () => {},
  } as unknown as GameScreen;
  const tableButtons: number[] = [];
  const game = {
    mainLoopHasReturned: () => false,
    isDead: () => false,
    onMouseClick: (x: number, y: number) => queued.push({ x, y }),
    enqueueKeyButton: (button: number) => tableButtons.push(button),
    isPartySleeping: () => ui.uiMode === UIMode.Sleeping,
    isFrozen: () => ui.uiMode === UIMode.Frozen,
  } as unknown as Game;
  const input = new GameInput({ game, screen, refreshScreen: () => {}, onQuickSave: () => {}, onQuickLoad: () => {} });
  const press = (code: string): KeyPress => ({ key: code, code, ctrlKey: false, metaKey: false, altKey: false });
  const mode = (m: UIMode) => { ui.uiMode = m; updateButtonLists(ui); };

  for (const m of [UIMode.Adventure, UIMode.Sleeping, UIMode.Frozen]) {
    mode(m);
    check(input.keyDown(press('Escape')) && isDialogOpen(ui), `${m}, Esc opens it`);
    input.keyDown(press('Escape'));
    check(!isDialogOpen(ui), `${m}, Esc again closes it`);
  }
  check(input.keyDown({ ...press('Escape'), repeat: true }) && !isDialogOpen(ui), 'Esc held down, repeating, does not open it');
  input.keyDown(press('Escape'));
  check(input.keyDown({ ...press('Escape'), repeat: true }) && isDialogOpen(ui), 'nor close it');
  input.keyDown(press('Escape'));
  reincarnate = true;
  input.keyDown(press('Escape'));
  check(!isDialogOpen(ui), 'over the Reincarnate screen, Esc does not open it');
  reincarnate = false;

  mode(UIMode.Adventure);
  tableButtons.length = 0;
  input.keyDown(press('Pause'));
  check(tableButtons.length === 1 && tableButtons[0] === 147, 'awake, Pause is the freeze, button 147');

  const wait = (ms: number) => { const until = performance.now() + ms; while (performance.now() < until) { /* spin */ } };
  queued.length = 0;
  input.mouseDown(100, 185, 0);
  check(!isDialogOpen(ui) && queued.length === 1, 'a click on the message area is queued as any click, and opens nothing');
  input.mouseDown(150, 190, 0);
  check(isDialogOpen(ui) && queued.length === 1, 'a second one soon after opens the settings, and is not queued');
  input.mouseDown(100, 100, 2);
  check(!isDialogOpen(ui), 'a right click closes them');

  input.mouseDown(100, 185, 0);
  wait(MESSAGE_DOUBLE_CLICK_MS + 50);
  input.mouseDown(100, 185, 0);
  check(!isDialogOpen(ui), 'a second click after the delay opens nothing');
  input.mouseDown(100, 185, 0);
  check(isDialogOpen(ui), 'and a third, soon after the second, does');
  closeSettingsDialog(ui);

  input.mouseDown(100, 100, 0);
  input.mouseDown(100, 185, 0);
  check(!isDialogOpen(ui), 'a click elsewhere, then one on the message area, opens nothing');
  input.mouseDown(0, 198, 0);
  input.mouseDown(100, 185, 0);
  check(!isDialogOpen(ui), 'nor does one on the freeze\'s pixel, which the game takes, then one beside it');
  closeSettingsDialog(ui);

  mode(UIMode.Frozen);
  queued.length = 0;
  input.mouseDown(100, 185, 0);
  input.mouseDown(100, 185, 0);
  check(!isDialogOpen(ui) && queued.length === 2, 'frozen, both clicks are the thaw\'s, and open nothing');

  // KEYS binds the physical key: AZERTY's A is the code KeyQ.
  mode(UIMode.Adventure);
  input.keyDown(press('Escape'));
  const keys = ui.settingsDialog!;
  keys.tab = 'keys';
  const slot = centre(slotRect(keysList(ui, KEYS_AREA), 0, 1));
  input.mouseDown(slot.x, slot.y, 0);
  check(keys.keys.capture?.action === 'move.forward', 'a click on MOVE FORWARD\'s second slot waits for its key');
  check(!input.keyDown({ key: 'a', code: 'KeyA', ctrlKey: true, metaKey: false, altKey: false }) && keys.keys.capture !== null,
    'a key with Ctrl is the browser\'s, and the slot still waits');
  check(input.keyDown({ key: 'a', code: 'KeyQ', ctrlKey: false, metaKey: false, altKey: false }), 'a key without one is the dialog\'s');
  check(ui.settings.values.keyBindings['move.forward'][1] === 'KeyQ' && ui.settings.values.keyBindings['attack.0.0'][0] === '',
    'its code fills the slot, and leaves attack 1 of champion 1');
  input.mouseDown(slot.x, slot.y, 0);
  input.keyDown(press('Escape'));
  check(isDialogOpen(ui) && keys.keys.capture === null, 'Esc while the slot waits cancels, and the dialog stays up');
  input.keyDown(press('Escape'));
  check(!isDialogOpen(ui), 'Esc again closes it');
}

console.log('\n=== 6. KEYS ===');
{
  const ui = freshUI();
  const list = keysList(ui, KEYS_AREA);
  const frames: Array<[string, Rect]> = [
    ...presetFrames(KEYS_AREA).map((f, i): [string, Rect] => [`preset ${PRESETS[i].label}`, f]),
    ['labels name', labelsNamePanel(KEYS_AREA)],
    ...layoutFrames(KEYS_AREA).map((f, i): [string, Rect] => [`layout ${i}`, f]),
    ['list', list.panel],
  ];
  checkDialogFrames();
  check(frames.every(([, f]) => inside(f, pageInterior)), 'every frame inside the page');
  const clashes = frames.flatMap(([a, fa], i) => frames.slice(i + 1).filter(([, fb]) => overlap(fa, fb)).map(([b]) => `${a}/${b}`));
  check(clashes.length === 0, `no frame over another${clashes.length ? `: ${clashes.join(', ')}` : ''}`);
  const first = slotRect(list, 0, 0);
  const second = slotRect(list, 0, 1);
  check(second.x1 > first.x2 && second.x2 < list.scrollbar.x1, 'the slots side by side, short of the scrollbar');
  check(KEY_ACTION_NAMES.every(([, name]) => listTextX(list) + name.length * CHAR_WIDTH <= first.x1 - 2),
    'every action\'s name ends before its first slot');
  check(KEY_LABEL_CHARS * CHAR_WIDTH + 2 <= first.x2 - first.x1 + 1 && CAPTURE_LABEL.length <= KEY_LABEL_CHARS,
    `a slot holds ${KEY_LABEL_CHARS} characters, PRESS A KEY among them`);
  check(LABELS_NAME.length * CHAR_WIDTH + 4 < labelsNamePanel(KEYS_AREA).x2 - labelsNamePanel(KEYS_AREA).x1, 'KEY LABELS fits its panel');
  console.log(`  the list shows ${list.rows} of ${KEY_ACTION_NAMES.length} actions`);
  check(list.rows >= 7, 'the list shows seven rows at least');
  const helpChars = Math.floor((HELP_LINE.x2 - 1 - (HELP_LINE.x1 + 4) + 1) / CHAR_WIDTH);
  const helps = [...PRESETS.map((p) => p.help), LABELS_HELP, SLOT_HELP, CAPTURE_HELP];
  check(helps.every((h) => h.length <= helpChars), `every help line fits, ${helpChars} characters`);

  openSettingsDialog(ui);
  const state = ui.settingsDialog!;
  click(ui, TAB_FRAMES[3]);
  const values = () => ui.settings.values;
  const slotAt = (row: number, slot: 0 | 1) => centre(slotRect(list, row, slot));
  const clickSlot = (row: number, slot: 0 | 1, buttons = 2) => {
    const at = slotAt(row, slot);
    settingsDialogClick(ui, at.x, at.y, buttons);
  };
  const presetIds = settingsDialogButtons(ui, state).filter((b) => b.name?.startsWith('settings.keys.preset')).map((b) => b.name);
  check(presetIds.join() === 'settings.keys.preset.csbwin,settings.keys.preset.keypad,settings.keys.preset.arrows',
    'CSBWIN, KEYPAD and ARROWS take a click, and CUSTOM none');
  check(values().keyPreset === 'csbwin', 'CSBWIN is in force');

  // MOVE FORWARD is the first row: K, then keypad 8.
  check(slotLabel(ui, values().keyBindings['move.forward'][0]) === 'K', 'MOVE FORWARD\'s first slot shows K');
  clickSlot(0, 0);
  check(state.keys.capture?.action === 'move.forward' && state.keys.capture.slot === 0, 'a click on it waits for its key');
  settingsDialogPointer(ui, { x: 5, y: 5 });
  check(helpText(ui, state) === CAPTURE_HELP, 'and the help line says to press it');
  settingsDialogKey(ui, 'Escape', 'Escape');
  check(state.keys.capture === null && isDialogOpen(ui) && values().keyBindings['move.forward'][0] === 'KeyK',
    'Esc cancels, and binds nothing');
  clickSlot(0, 0);
  settingsDialogKey(ui, 'w', 'KeyW');
  check(values().keyBindings['move.forward'][0] === 'KeyW' && values().keyBindings['attack.1.0'][0] === '',
    'W fills it, and is no longer champion 2\'s first attack');
  check(values().keyPreset === 'custom', 'the table is now CUSTOM');
  check(state.keys.capture === null, 'the slot waits no more');
  clickSlot(0, 1);
  clickSlot(1, 0);
  check(state.keys.capture?.action === 'move.backward', 'a click on another slot moves the wait there');
  click(ui, TAB_FRAMES[3]);
  check(state.keys.capture === null, 'and any other click cancels it');

  clickSlot(0, 1, 1);
  check(isDialogOpen(ui) && values().keyBindings['move.forward'][1] === '', 'a right click on a slot empties it');
  check(slotLabel(ui, '') === '-', 'and it shows a dash');
  settingsDialogPointer(ui, slotAt(0, 1));
  check(helpText(ui, state) === SLOT_HELP, 'the help line names what a slot does');

  click(ui, presetFrames(KEYS_AREA)[1]);
  check(values().keyPreset === 'keypad' && values().keyBindings === KEYPAD_KEY_BINDINGS, 'KEYPAD puts its table in force');
  click(ui, presetFrames(KEYS_AREA)[0]);
  check(values().keyPreset === 'csbwin' && values().keyBindings === DEFAULT_KEY_BINDINGS, 'and CSBWIN its own back');

  // The labels: QWERTY by default, AZERTY at a click; Champion 1's first attack is KeyQ.
  const attackRow = KEY_ACTION_NAMES.findIndex(([action]) => action === 'attack.0.0');
  check(slotLabel(ui, values().keyBindings['attack.0.0'][0]) === 'Q', 'on QWERTY, champion 1\'s first attack is Q');
  click(ui, layoutFrames(KEYS_AREA)[1]);
  check(values().keyLabels === 'azerty' && slotLabel(ui, 'KeyQ') === 'A', 'AZERTY names the same key A');
  check(values().keyBindings['attack.0.0'][0] === 'KeyQ', 'and binds nothing new');
  settingsDialogPointer(ui, centre(labelsNamePanel(KEYS_AREA)));
  check(helpText(ui, state) === LABELS_HELP, 'the help line names KEY LABELS');

  // The list, a row an action, scrolled by the wheel, its arrows and the keys.
  const maxTop = KEY_ACTION_NAMES.length - list.rows;
  check(ui.dialog?.wheel(ui, 100) === true && state.keys.scrollTop === 3, 'a notch of the wheel down scrolls three rows, and is to be drawn');
  const touchpad = Array.from({ length: 8 }, () => ui.dialog?.wheel(ui, 4));
  check(state.keys.scrollTop === 3 && touchpad.every((drawn) => drawn === false), 'a touchpad\'s small deltas scroll nothing, nor ask a redraw, short of a row');
  check(ui.dialog?.wheel(ui, WHEEL_ROW_DELTA - 32) === true && state.keys.scrollTop === 4, 'and add up to one');
  ui.dialog?.wheel(ui, 30);
  check(ui.dialog?.wheel(ui, -100) === true && state.keys.scrollTop === 1, 'up, what was left of the way down is dropped: three rows back');
  settingsDialogKey(ui, 'End', 'End');
  check(state.keys.scrollTop === maxTop, 'End shows the last page');
  check(ui.dialog?.wheel(ui, 100) === false && state.keys.scrollTop === maxTop, 'and the wheel goes no further, nothing to draw');
  settingsDialogKey(ui, 'PageUp', 'PageUp');
  check(state.keys.scrollTop === maxTop - list.rows, 'Page Up scrolls a page');
  settingsDialogKey(ui, 'Home', 'Home');
  settingsDialogKey(ui, 'ArrowDown', 'ArrowDown');
  check(state.keys.scrollTop === 1, 'Home, then Down, shows from the second row');
  const down = { x: centre(list.scrollbar).x, y: list.scrollbar.y2 - (arrowBox(list) >> 1) };
  settingsDialogClick(ui, down.x, down.y, 2);
  check(state.keys.scrollTop === 2, 'the scrollbar\'s down arrow scrolls a row');
  state.keys.scrollTop = attackRow;
  clickSlot(0, 0);
  check(state.keys.capture?.action === 'attack.0.0', 'scrolled, a slot is its row\'s action');
  settingsDialogKey(ui, 'Escape', 'Escape');
  settingsDialogKey(ui, 'Escape', 'Escape');
  check(!isDialogOpen(ui), 'with no slot waiting, Esc closes the dialog');

  // Where the browser gives the layout, KEY LABELS is left out, the list takes its line,
  // and the names are the map's.
  const french = new Map([['KeyQ', 'a'], ['Digit2', 'é'], ['Quote', 'ù'], ['Semicolon', 'm']]);
  const mapped = freshUI(true, french);
  openSettingsDialog(mapped);
  mapped.settingsDialog!.tab = 'keys';
  check(!settingsDialogButtons(mapped, mapped.settingsDialog!).some((b) => b.name?.startsWith('settings.keys.layout')),
    'with the keyboard\'s layout, KEY LABELS\' toggle has no button');
  settingsDialogPointer(mapped, centre(labelsNamePanel(KEYS_AREA)));
  check(helpText(mapped, mapped.settingsDialog!) !== LABELS_HELP, 'and the help line does not name it');
  const mappedList = keysList(mapped, KEYS_AREA);
  console.log(`  without KEY LABELS, the list shows ${mappedList.rows} rows`);
  check(mappedList.panel.y1 === presetFrames(KEYS_AREA)[0].y2 + 2 && mappedList.panel.y2 === list.panel.y2 && mappedList.rows > list.rows,
    'the list starts under the presets, and shows more rows');
  check(slotLabel(mapped, 'KeyQ') === 'A' && slotLabel(mapped, 'Semicolon') === 'M', 'the names are the map\'s');
  drawSettingsDialog(mapped);
  check(mapped.screenIndexBuffer.pixels.some((p) => p !== 0), 'it draws');
}

finish();
