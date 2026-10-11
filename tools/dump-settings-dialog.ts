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
 * 2. **The layout**: every control inside the plate's interior, none over another, every
 *    name inside its panel and every help line inside the help line.
 * 3. **The controls**: a tab, a toggle, the slider clicked, dragged past the track's end and
 *    released; a click on the chosen side of a toggle changes nothing; the CRT effect's
 *    toggle inert without WebGL, the help line saying why; Esc, CLOSE and a right click
 *    close it; the clock held while it is up.
 * 4. **The help line** follows the pointer, and the pointer's move says when it changes.
 * 5. **Opening it**, through `GameInput` over the interface's real lists: Esc, awake, asleep
 *    and frozen, but not over the Reincarnate screen; Pause freezes; a double click on
 *    the message area, not a slow one, not one on the freeze's pixel, and never in a
 *    frozen game, whose first click thaws it. A key reaches KEYS by its code.
 * 6. **KEYS** (`SettingsKeys.ts`): its layout; a slot clicked waits for its key, which
 *    fills it and leaves every other slot, Esc cancelling and never bound; a right click
 *    empties a slot; the presets, CUSTOM inert until a key is changed; the labels'
 *    layout, inert where the browser gives the keyboard's; the list scrolled by the wheel,
 *    its arrows and the keys. `tools/dump-key-bindings.ts` checks the tables and labels.
 *
 * Run: `npx tsx tools/dump-settings-dialog.ts`
 */
import { emptyDungeonData } from '../src/data/DungeonLoader';
import type { Rect } from '../src/data/tables/UITables';
import type { Game } from '../src/engine/Game';
import { GameInput, MESSAGE_DOUBLE_CLICK_MS, type KeyPress } from '../src/renderer/GameInput';
import type { GameScreen } from '../src/renderer/GameScreen';
import { MESSAGE_AREA } from '../src/renderer/csbwin/ScrollingText';
import { isDialogOpen } from '../src/renderer/ui/Dialog';
import { DEFAULT_KEY_BINDINGS, keyAction, tableKeyButton } from '../src/renderer/ui/Keyboard';
import { MENU_GRAPHIC } from '../src/renderer/ui/Menu';
import { searchMouseButtons, syncInventoryButtons, updateButtonLists } from '../src/renderer/ui/Mouse';
import {
  CLOSE_FRAME, EXIT_FRAME, HELP_LINE, KEYS_AREA, SETTING_LINES, TABS, TAB_FRAMES, closeSettingsDialog, drawSettingsDialog,
  helpText, openSettingsDialog, settingsDialogButtons, settingsDialogClick, settingsDialogKey, settingsDialogPointer,
  sliderRect, toggleFrames,
} from '../src/renderer/ui/SettingsDialog';
import {
  CAPTURE_HELP, CAPTURE_LABEL, KEY_ACTION_NAMES, LABELS_FROM_KEYBOARD_HELP, LABELS_HELP, LABELS_NAME, PRESETS, SLOT_HELP,
  keysList, labelsNamePanel, layoutFrames, presetFrames, slotLabel, slotRect,
} from '../src/renderer/ui/SettingsKeys';
import { KEY_LABEL_CHARS } from '../src/renderer/ui/KeyLabels';
import { KEYPAD_KEY_BINDINGS } from '../src/renderer/ui/Keyboard';
import { arrowBox, listTextX } from '../src/renderer/ui/Widgets';
import { UIMode, type UIState } from '../src/renderer/ui/UIState';
import { CHAR_WIDTH, buttonRect } from '../src/renderer/ui/Widgets';
import { Settings } from '../src/settings/Settings';
import { check, finish } from './lib/check';
import { newGame, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';

const graphics = stockGraphics();
const image = graphics.getImage(MENU_GRAPHIC);
const menuBitmap = { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };

function freshUI(crt = true, layoutMap: ReadonlyMap<string, string> | null = null): UIState {
  return newUIState(graphics, newGame(emptyDungeonData(), graphics).ctx, {
    getGraphicBitmap: (n) => (n === MENU_GRAPHIC ? menuBitmap : null),
    settings: new Settings(null),
    isCrtAvailable: () => crt,
    keyboardLayout: () => layoutMap,
  });
}

const centre = (r: Rect) => ({ x: (r.x1 + r.x2) >> 1, y: (r.y1 + r.y2) >> 1 });
const inside = (r: Rect, outer: Rect) => r.x1 >= outer.x1 && r.x2 <= outer.x2 && r.y1 >= outer.y1 && r.y2 <= outer.y2;
const overlap = (a: Rect, b: Rect) => a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
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
  const interior: Rect = { x1: 10, y1: 10, x2: 309, y2: 189 };
  const frames: Array<[string, Rect]> = [['CLOSE', CLOSE_FRAME], ['EXIT', EXIT_FRAME], ...TAB_FRAMES.map((f, i): [string, Rect] => [`tab ${TABS[i].label}`, f])];
  for (let line = 0; line < SETTING_LINES; line++) {
    const [on, off] = toggleFrames(line);
    frames.push([`line ${line} ON`, on], [`line ${line} OFF`, off]);
  }
  frames.push(['help line', HELP_LINE]);
  check(frames.every(([, f]) => inside(f, interior)), 'every frame inside the plate\'s interior');
  const clashes = frames.flatMap(([a, fa], i) => frames.slice(i + 1).filter(([, fb]) => overlap(fa, fb)).map(([b]) => `${a}/${b}`));
  check(clashes.length === 0, `no frame over another${clashes.length ? `: ${clashes.join(', ')}` : ''}`);
  const nameChars = Math.floor((toggleFrames(0)[0].x1 - 10 - 1 - 14 + 1) / CHAR_WIDTH);
  const helpChars = Math.floor((HELP_LINE.x2 - 1 - (HELP_LINE.x1 + 4) + 1) / CHAR_WIDTH);
  const settings = TABS.flatMap((t) => t.settings ?? []);
  check(TABS.every((t) => (t.settings?.length ?? 0) <= SETTING_LINES), `no tab has more than ${SETTING_LINES} lines`);
  check(settings.every((s) => s.name.length <= nameChars), `every name fits its panel, ${nameChars} characters`);
  const helps = [...settings.flatMap((s) => [s.help, s.unavailable?.help ?? '']), ...TABS.map((t) => t.help)];
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
  click(ui, toggleFrames(0)[0]);
  check(values().extras.gatherThrownWeapons && !values().extras.drinkAtFountain, 'GATHER THROWN WEAPONS\' ON turns that extra on, alone');
  click(ui, toggleFrames(0)[0]);
  check(updates === 1, 'a click on the side already chosen changes nothing');
  click(ui, toggleFrames(3)[1]);
  check(!values().statistics, 'SEND STATISTICS\' OFF turns them off');

  click(ui, TAB_FRAMES[2]);
  check(state.tab === 'sound', 'SOUND\'s tab selects it');
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
  click(ui, EXIT_FRAME);
  check(isDialogOpen(ui), 'EXIT is inert');

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

  const noWebGL = freshUI(false);
  openSettingsDialog(noWebGL);
  noWebGL.settingsDialog!.tab = 'display';
  check(!settingsDialogButtons(noWebGL, noWebGL.settingsDialog!).some((b) => b.name?.startsWith('settings.line0')),
    'without WebGL, the CRT effect\'s toggle has no button');
  click(noWebGL, toggleFrames(0)[0]);
  check(!noWebGL.settings.values.crt, 'and a click on its ON does nothing');
  settingsDialogPointer(noWebGL, centre(toggleFrames(0)[0]));
  check(helpText(noWebGL, noWebGL.settingsDialog!) === 'THE CRT EFFECT NEEDS WEBGL', 'the help line says why');
}

console.log('\n=== 4. the help line ===');
{
  const ui = freshUI();
  openSettingsDialog(ui);
  const state = ui.settingsDialog!;
  check(helpText(ui, state) === '', 'with the pointer off the canvas it says nothing');
  check(settingsDialogPointer(ui, { x: 40, y: centre(toggleFrames(1)[0]).y }), 'the pointer onto a setting\'s name changes it');
  console.log(`  "${helpText(ui, state)}"`);
  check(helpText(ui, state) === TABS[0].settings![1].help, 'it names the setting under the pointer');
  check(settingsDialogPointer(ui, centre(buttonRect(toggleFrames(1)[1]))), 'onto its toggle\'s OFF, it changes: OFF is lit');
  check(helpText(ui, state) === TABS[0].settings![1].help, 'and the help line still names the setting');
  const off = buttonRect(toggleFrames(1)[1]);
  check(!settingsDialogPointer(ui, { x: off.x1, y: off.y1 }), 'a move within OFF changes nothing');
  settingsDialogPointer(ui, centre(buttonRect(TAB_FRAMES[1])));
  check(helpText(ui, state) === TABS[1].help, 'over a tab, the tab');
  settingsDialogPointer(ui, centre(buttonRect(CLOSE_FRAME)));
  check(helpText(ui, state).startsWith('BACK TO THE GAME'), 'over CLOSE, what it does');
  settingsDialogPointer(ui, centre(buttonRect(EXIT_FRAME)));
  check(helpText(ui, state) === '', 'over the inert EXIT, nothing');
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
    openSettings: () => openSettingsDialog(ui),
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
  const slot = centre(slotRect(keysList(KEYS_AREA), 0, 1));
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
  const interior: Rect = { x1: 10, y1: 10, x2: 309, y2: 189 };
  const list = keysList(KEYS_AREA);
  const frames: Array<[string, Rect]> = [
    ...TAB_FRAMES.map((f, i): [string, Rect] => [`tab ${TABS[i].label}`, f]),
    ...presetFrames(KEYS_AREA).map((f, i): [string, Rect] => [`preset ${PRESETS[i].label}`, f]),
    ['labels name', labelsNamePanel(KEYS_AREA)],
    ...layoutFrames(KEYS_AREA).map((f, i): [string, Rect] => [`layout ${i}`, f]),
    ['list', list.panel], ['help line', HELP_LINE],
  ];
  check(frames.every(([, f]) => inside(f, interior)), 'every frame inside the plate\'s interior');
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
  const helps = [...PRESETS.map((p) => p.help), LABELS_HELP, LABELS_FROM_KEYBOARD_HELP, SLOT_HELP, CAPTURE_HELP];
  check(helps.every((h) => h.length <= helpChars), `every help line fits, ${helpChars} characters`);

  const ui = freshUI();
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
  ui.dialog?.wheel(ui, 100);
  check(state.keys.scrollTop === 1, 'a notch of the wheel down scrolls a row');
  settingsDialogKey(ui, 'End', 'End');
  check(state.keys.scrollTop === maxTop, 'End shows the last page');
  ui.dialog?.wheel(ui, 100);
  check(state.keys.scrollTop === maxTop, 'and the wheel goes no further');
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

  // Where the browser gives the layout, the toggle is inert and the names are the map's.
  const french = new Map([['KeyQ', 'a'], ['Digit2', 'é'], ['Quote', 'ù'], ['Semicolon', 'm']]);
  const mapped = freshUI(true, french);
  openSettingsDialog(mapped);
  mapped.settingsDialog!.tab = 'keys';
  check(!settingsDialogButtons(mapped, mapped.settingsDialog!).some((b) => b.name?.startsWith('settings.keys.layout')),
    'with the keyboard\'s layout, KEY LABELS\' toggle has no button');
  settingsDialogPointer(mapped, centre(layoutFrames(KEYS_AREA)[0]));
  check(helpText(mapped, mapped.settingsDialog!) === LABELS_FROM_KEYBOARD_HELP, 'and the help line says the names are the keyboard\'s');
  check(slotLabel(mapped, 'KeyQ') === 'A' && slotLabel(mapped, 'Semicolon') === 'M', 'the names are the map\'s');
  drawSettingsDialog(mapped);
  check(mapped.screenIndexBuffer.pixels.some((p) => p !== 0), 'it draws');
}

finish();
