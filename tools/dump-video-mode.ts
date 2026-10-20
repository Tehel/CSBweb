/**
 * `videoMode` (`LoopFlags.videoMode`): the viewport is drawn through the overlay only in
 * `VM_ADVENTURE` (doc/CSBwin-src/WinScreen.cpp:1527), and the mode is set where CSBWin
 * sets it.
 *
 * - The top of every tick puts any mode back to `VM_ADVENTURE` but an inventory's, or any
 *   while the party sleeps (`CSBCode.cpp:613-621`). A game starts in none of them.
 * - An inventory shown is `VM_INVENTORY` (`ShowHideInventory`, `:7546`), hidden
 *   `VM_ADVENTURE` at once (`:7512`); so is the Hall of Champions' candidate's
 *   (`Character.cpp:797`, `CSBCode.cpp:6693`, `:6866`).
 * - The freeze is `VM_FROZEN` (`Mouse.cpp:1874`), the thaw `VM_ADVENTURE` at once
 *   (`:1903`), and `TAG0207cc` after it shows an open inventory again (`CSBCode.cpp:10077-10082`).
 * - Sleep is `VM_SLEEPING` (`Mouse.cpp:1842`), through every tick it lasts; `WakeUp` is
 *   `VM_ADVENTURE` at once (`CSBCode.cpp:7121`).
 * - The disk menu is `VM_LEFTMENU`, the load-only one `VM_CENTERMENU` (`Menu.cpp:465-472`).
 *   Closed, the mode stays until the next tick's top, or `TAG0207cc` shows the inventory
 *   that was open (`SaveGame.cpp:1375`).
 *
 * Run: `npm test -- --only=dump-video-mode.ts`
 */
import { Position } from '../src/core/types';
import { wakeUp } from '../src/engine/LoopState';
import * as Mouse from '../src/renderer/ui/Mouse';
import * as SaveMenu from '../src/renderer/ui/SaveMenu';
import { UIMode, type UIState } from '../src/renderer/ui/UIState';
import { check, finish } from './lib/check';
import { newGame, runVbl, TICK_DUE, stockDungeon, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';
import { testChampion } from './lib/champion';

const data = stockDungeon();
const graphics = stockGraphics();

const game = newGame(data, graphics, {
  sleepChanged: (sleeping) => {
    ui.uiMode = sleeping ? UIMode.Sleeping : UIMode.Adventure;
    Mouse.updateButtonLists(ui);
    Mouse.syncInventoryButtons(ui);
  },
  tag0207cc: () => Mouse.tag0207cc(ui),
  tag02076e: () => Mouse.tag02076e(ui),
  showHideInventory: (chIdx) => Mouse.handleInventoryToggle(ui, chIdx),
});
game.setRandomSeed(0x12345678);
game.systems.hallOfChampions.addChampion(testChampion(0));
game.systems.hallOfChampions.addChampion(testChampion(1));
const party = game.ctx.party.state;
party.position = new Position(6, 14, 2);
game.systems.monsters.loadPartyLevel(2);

const ui: UIState = newUIState(graphics, game.ctx);
Mouse.updateButtonLists(ui);
game.setMouseEventHandlers({
  translate: (x, y, buttons) => Mouse.searchMouseButtons(ui, x, y, buttons),
  button: (num, x, y) => Mouse.handleMouseButton(ui, num, x, y),
  unclick: () => Mouse.handleMouseUnclick(ui),
});

const mode = (): string => game.ctx.loop.videoMode;
/** One VBL that runs a tick. */
const tick = (): void => {
  const before = game.ctx.state.tickCount;
  runVbl(game, TICK_DUE);
  if (game.ctx.state.tickCount !== before + 1) throw new Error('no tick ran');
};
/** `step`, then the mode it leaves and the mode after the next tick. */
const around = (label: string, step: () => void): [string, string] => {
  step();
  const now = mode();
  tick();
  const after = mode();
  console.log(`${label.padEnd(44)} ${now.padEnd(14)} then, after a tick, ${after}`);
  return [now, after];
};

console.log('=== the game start ===');
{
  console.log(`before the first tick: ${mode()}`);
  check(mode() !== 'VM_ADVENTURE', 'a game starts outside VM_ADVENTURE (the prison door, a menu)');
  tick();
  console.log(`after it: ${mode()}`);
  check(mode() === 'VM_ADVENTURE', 'its first tick sets VM_ADVENTURE (CSBCode.cpp:613-621)');
}

console.log('');
console.log('=== the inventory ===');
{
  const [opened, openTick] = around('ShowHideInventory(0)', () => Mouse.handleInventoryToggle(ui, 0));
  check(opened === 'VM_INVENTORY' && openTick === 'VM_INVENTORY', 'shown: VM_INVENTORY, which a tick keeps');
  const [swapped] = around('ShowHideInventory(1), over 0\'s', () => Mouse.handleInventoryToggle(ui, 1));
  check(swapped === 'VM_INVENTORY', 'another champion\'s: VM_INVENTORY still');
  const [closed] = around('ShowHideInventory(4)', () => Mouse.handleInventoryToggle(ui, 4));
  check(closed === 'VM_ADVENTURE', 'hidden: VM_ADVENTURE at once (:7512)');
}

console.log('');
console.log('=== the freeze ===');
{
  Mouse.handleMouseButton(ui, 147, 0, 198);
  console.log(`button 147: ${mode()}`);
  check(mode() === 'VM_FROZEN', 'frozen: VM_FROZEN (Mouse.cpp:1874)');
  Mouse.handleMouseButton(ui, 148, 160, 100);
  console.log(`button 148: ${mode()}`);
  check(mode() === 'VM_ADVENTURE', 'thawed: VM_ADVENTURE at once (:1903)');
  Mouse.handleInventoryToggle(ui, 0);
  Mouse.handleMouseButton(ui, 147, 0, 198);
  Mouse.handleMouseButton(ui, 148, 160, 100);
  console.log(`frozen and thawed over HERO0's inventory: ${mode()}`);
  check(mode() === 'VM_INVENTORY' && party.selectedCharacterIndex === 0,
    'TAG0207cc shows the inventory again: VM_INVENTORY (CSBCode.cpp:10081-10082, :7546)');
  Mouse.handleInventoryToggle(ui, 4);
}

console.log('');
console.log('=== sleep ===');
{
  Mouse.handleInventoryToggle(ui, 0);
  const [slept, sleptTick] = around('button 145, over an inventory', () => Mouse.handleMouseButton(ui, 145, 0, 0));
  check(party.sleeping && party.selectedCharacterIndex === -1, 'the party sleeps, the inventory hidden');
  check(slept === 'VM_SLEEPING' && sleptTick === 'VM_SLEEPING', 'asleep: VM_SLEEPING (Mouse.cpp:1842), which a tick keeps');
  wakeUp(game.ctx);
  console.log(`WakeUp: ${mode()}`);
  check(!party.sleeping && mode() === 'VM_ADVENTURE', 'woken: VM_ADVENTURE at once (CSBCode.cpp:7121)');
}

console.log('');
console.log('=== the disk menu ===');
{
  SaveMenu.openSaveMenu(ui);
  console.log(`open: ${mode()}`);
  check(mode() === 'VM_LEFTMENU', 'the disk menu: VM_LEFTMENU (Menu.cpp:471, ClearOldScreen 0)');
  const [closed, closedTick] = around('closed', () => SaveMenu.closeSaveMenu(ui));
  check(closed === 'VM_LEFTMENU', 'closed, the mode stays: no overlay until the next tick');
  check(closedTick === 'VM_ADVENTURE', 'and the next tick\'s top sets VM_ADVENTURE (CSBCode.cpp:617)');

  Mouse.handleInventoryToggle(ui, 1);
  SaveMenu.openSaveMenu(ui);
  const opened = mode();
  SaveMenu.closeSaveMenu(ui);
  console.log(`over HERO1's inventory: open ${opened}, closed ${mode()}`);
  check(opened === 'VM_LEFTMENU' && mode() === 'VM_INVENTORY' && party.selectedCharacterIndex === 1,
    'over an inventory, TAG0207cc shows it again: VM_INVENTORY at once (SaveGame.cpp:1375)');
  Mouse.handleInventoryToggle(ui, 4);

  SaveMenu.openSaveMenu(ui, 'loadOnly');
  console.log(`load-only: ${mode()}`);
  check(mode() === 'VM_CENTERMENU', '_ReadEntireGame\'s menu: VM_CENTERMENU (Menu.cpp:467, ClearOldScreen 1)');
  SaveMenu.closeSaveMenu(ui);
  tick();
  check(mode() === 'VM_ADVENTURE', 'and a tick puts VM_ADVENTURE back');
}

console.log('');
console.log('=== the Hall of Champions ===');
{
  const hall = game.systems.hallOfChampions;
  check(hall.addCharacter(0), 'a candidate added (the legal hero: no text in the cell)');
  console.log(`candidate: ${mode()}`);
  check(mode() === 'VM_INVENTORY', 'the candidate\'s inventory: VM_INVENTORY (Character.cpp:797)');
  check(hall.resurrectReincarnateCancel(162), 'Cancel');
  console.log(`Cancel: ${mode()}`);
  check(mode() === 'VM_ADVENTURE', 'Cancel hides it: VM_ADVENTURE at once (CSBCode.cpp:6693)');
  check(hall.addCharacter(0), 'the candidate again');
  check(hall.resurrectReincarnateCancel(160), 'Resurrect');
  console.log(`Resurrect: ${mode()}`);
  check(mode() === 'VM_ADVENTURE', 'Resurrect hides it: VM_ADVENTURE at once (:6866)');
}

finish();
