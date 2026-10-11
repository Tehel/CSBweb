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
 *    frozen game, whose first click thaws it.
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
  CLOSE_FRAME, EXIT_FRAME, HELP_LINE, SETTING_LINES, TABS, TAB_FRAMES, closeSettingsDialog, drawSettingsDialog,
  helpText, openSettingsDialog, settingsDialogButtons, settingsDialogClick, settingsDialogKey, settingsDialogPointer,
  sliderRect, toggleFrames,
} from '../src/renderer/ui/SettingsDialog';
import { UIMode, type UIState } from '../src/renderer/ui/UIState';
import { CHAR_WIDTH, buttonRect } from '../src/renderer/ui/Widgets';
import { Settings } from '../src/settings/Settings';
import { check, finish } from './lib/check';
import { newGame, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';

const graphics = stockGraphics();
const image = graphics.getImage(MENU_GRAPHIC);
const menuBitmap = { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };

function freshUI(crt = true): UIState {
  return newUIState(graphics, newGame(emptyDungeonData(), graphics).ctx, {
    getGraphicBitmap: (n) => (n === MENU_GRAPHIC ? menuBitmap : null),
    settings: new Settings(null),
    isCrtAvailable: () => crt,
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
  check(state.tab === 'sound', 'KEYS\' tab is inert');
  click(ui, EXIT_FRAME);
  check(isDialogOpen(ui), 'EXIT is inert');

  settingsDialogKey(ui, 'Enter');
  check(isDialogOpen(ui), 'a key other than Esc does nothing');
  settingsDialogKey(ui, 'Escape');
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
    handleDialogKey: (key: string) => ui.dialog?.key(ui, key),
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
}

finish();
