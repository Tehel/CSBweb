/**
 * The freeze: button 147 stops the game, button 148 starts it again.
 *
 * - Button 147 (doc/CSBwin-src/Mouse.cpp:1870-1898): Esc in the adventure key table
 *   `Byte18400` and the sleep table `Byte18440`, or a left click on the one pixel x 0,
 *   y 198 of the adventure list `Buttons17196` (its rectangle is 0-1 by 198-199, and
 *   `SearchButtonList` excludes the upper bounds, `CSBCode.cpp:7620-7623`). `d.ClockRunning = 0`, `gameFrozen = true`,
 *   `TAG02076e()`, "GAME FROZEN" in the viewport, the lists and key tables saved and
 *   replaced by `Buttons17832` (the whole screen is 148) and `Byte18448` (Esc is 148),
 *   `DiscardAllInput()`.
 * - Frozen, no tick runs (`CSBCode.cpp:775`), and `HandleMouseEvents` throws away every
 *   entry but 148, one per call (`Mouse.cpp:1548-1565`). The thaw is never made to wait
 *   for a tick that cannot come (`thawCommand`, `:1591-1604`).
 * - Button 148 (`:1899-1912`): `d.ClockRunning = 1`, `TAG0207cc()`, the saved lists and
 *   key tables back, `DiscardAllInput()`. The tick that fell due while frozen runs in the
 *   frame that thaws.
 * - The port's key for the tables' Esc is Pause (`DEFAULT_KEY_BINDINGS`): Esc opens the
 *   settings (`DEBT.md` H).
 * - Asleep, `TAG02076e` does nothing and `TAG0207cc` only redraws the sleep screen
 *   (`Character.cpp:5136`, `CSBCode.cpp:10062-10066`): the thaw goes back to the sleep lists.
 *
 * Run: `npm test -- --only=dump-freeze.ts`
 */
import { Position } from '../src/core/types';
import { UIMode, type UIState } from '../src/renderer/ui/UIState';
import { newGame, runVbl, TICK_DUE, stockDungeon, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';
import { wakeUp } from '../src/engine/MouseSystem';
import { check, finish } from './lib/check';
import * as Mouse from '../src/renderer/ui/Mouse';
import * as Draw from '../src/renderer/ui/Draw';
import * as Keyboard from '../src/renderer/ui/Keyboard';
import { showHideInventory } from '../src/engine/ShowHideInventory';
import { testChampion } from './lib/champion';

async function main(): Promise<void> {
  const data = stockDungeon();
  const graphics = stockGraphics();
  const game = newGame(data, graphics, {
    sleepChanged: (sleeping) => {
      ui.uiMode = sleeping ? UIMode.Sleeping : UIMode.Adventure;
      Mouse.updateButtonLists(ui);
      Mouse.syncInventoryButtons(ui);
    },
  });
  game.setRandomSeed(0x12345678);
  game.systems.hallOfChampions.addChampion(testChampion(0));
  game.systems.hallOfChampions.addChampion(testChampion(1));
  const party = game.ctx.party.state;
  party.position = new Position(6, 14, 2);
  game.systems.monsters.loadPartyLevel(2);

  // The UI half, wired as `GameInput.install` wires it.
  const ui: UIState = newUIState(graphics, game.ctx);
  Mouse.updateButtonLists(ui);

  const lists = ui.uiTables.graphic231.buttons;
  const keys = ui.uiTables.graphic231.keys;

  console.log('=== the key tables and button lists (graphics.dat 0x231) ===');
  const show = (table: { mouse: number; keyscan: number }[]): string =>
    table.map((k) => `{${k.mouse}, 0x${k.keyscan.toString(16)}}`).join(' ');
  console.log(`Byte18448: ${show(keys.byte18448)}`);
  console.log(`Byte18440: ${show(keys.byte18440)}`);
  console.log(`Byte18428: ${show(keys.byte18428)}`);
  console.log(`Byte18400: ${show(keys.byte18400)}`);
  check(show(keys.byte18448) === '{148, 0x1b}', 'frozen: Esc is 148, and nothing else');
  check(show(keys.byte18440) === '{146, 0xd} {147, 0x1b}', 'asleep: Return is 146, Esc 147');
  check(keys.byte18400.some((k) => k.mouse === 147 && k.keyscan === 0x1b), 'adventuring: Esc is 147');
  check(keys.byte18428.length === 6 && keys.byte18428.every((k) => k.mouse >= 1 && k.mouse <= 6),
    'the second adventure table is six movement buttons');
  const thawList = lists.buttons17832.filter((b) => b.word0 !== 0);
  console.log(`Buttons17832: ${JSON.stringify(thawList)}`);
  check(thawList.length === 2 && thawList.every((b) =>
    b.word0 === 148 && b.x1 === 0 && b.x2 === 319 && b.y1 === 0 && b.y2 === 199),
  'frozen, the whole screen is button 148');
  check((thawList[0]!.button | thawList[1]!.button) === 3, 'either mouse button thaws');
  const corner = lists.buttons17196.find((b) => b.word0 === 147);
  console.log(`button 147: ${JSON.stringify(corner)}`);
  check(corner !== undefined && corner.x1 === 0 && corner.x2 === 1 && corner.y1 === 198 && corner.y2 === 199
    && corner.button === 2, 'adventuring, a left click on the pixel x 0, y 198 is 147');

  const handled: number[] = [];
  game.setMouseEventHandlers({
    translate: (x, y, buttons) => Mouse.searchMouseButtons(ui, x, y, buttons),
    button: (num, x, y) => { handled.push(num); Mouse.handleMouseButton(ui, num, x, y); },
    unclick: () => Mouse.handleMouseUnclick(ui),
  });

  /**
   * One VBL, the last tick's top `sinceTick` VBLs ago, this one included (`runVbl`);
   * -1 lets the count run on.
   */
  const frame = (sinceTick = 1): void => {
    runVbl(game, sinceTick >= 0 ? sinceTick : undefined);
  };
  const click = (x: number, y: number, buttons = 2): number => {
    const num = Mouse.searchMouseButtons(ui, x, y, buttons);
    game.onMouseClick(x, y, buttons);
    game.onMouseUnClick();
    return num;
  };
  /** `TAG0196da`: the key through the current tables, queued. */
  const press = (key: string): number => {
    const num = Keyboard.translateKey(ui, Keyboard.keyScanOf(key));
    if (num !== 0) game.enqueueKeyButton(num);
    return num;
  };
  const state = (): string =>
    `frozen=${game.isFrozen()} mode=${ui.uiMode} shaded=${ui.shadedByTag02076e} sleeping=${game.isPartySleeping()}`;

  console.log('');
  console.log('=== Esc adventuring: button 147 (Mouse.cpp:1870-1898) ===');
  {
    game.lastInputTime = 0;
    handled.length = 0;
    check(press('Pause') === 147, 'Byte18400 turns Esc, which Pause sends, into 147');
    // Queued behind the freeze: `DiscardAllInput()` must lose it.
    game.enqueueKeyButton(1);
    const facing = party.facing;
    frame();
    console.log(`handled=${JSON.stringify(handled)} ${state()}`);
    check(game.isFrozen() && ui.uiMode === UIMode.Frozen, 'the game is frozen');
    check(handled.join() === '147' && party.facing === facing && game.ctx.mouseQueue.count() === 0,
      'DiscardAllInput(): the turn behind it is gone');
    check(ui.primaryButtons === lists.buttons17832 && ui.secondaryButtons === null,
      'PrimaryButtonList = Buttons17832, SecondaryButtonList = NULL');
    check(ui.keyXlate2 === keys.byte18448 && ui.keyXlate1 === null, 'pKeyXlate2 = Byte18448, pKeyXlate1 = NULL');
    check(ui.shadedByTag02076e, 'TAG02076e: the three areas shaded, the arrow cursor');
    check(Keyboard.translateKey(ui, Keyboard.keyScanOf('Pause')) === 148, 'Esc, Pause, is now 148');
    check(Keyboard.translateKey(ui, 0x0d) === 0, 'and Return nothing');
  }

  console.log('');
  console.log('=== frozen: no tick, and every entry but 148 thrown away ===');
  {
    const before = game.ctx.state.tickCount;
    for (let i = 0; i < 10; i++) frame(TICK_DUE);
    console.log(`${game.ctx.state.tickCount - before} ticks in 10 frames, each 300 ms after the last tick`);
    check(game.ctx.state.tickCount === before, 'd.ClockRunning == 0: no tick runs');
    handled.length = 0;
    game.lastInputTime = 0;
    game.enqueueKeyButton(1);
    game.enqueueKeyButton(3);
    const facing = party.facing;
    frame(-1);
    const afterOne = game.ctx.mouseQueue.count();
    frame(-1);
    console.log(`queued 2: ${afterOne} left after one frame, ${game.ctx.mouseQueue.count()} after two; handled=${JSON.stringify(handled)}`);
    check(afterOne === 1 && game.ctx.mouseQueue.count() === 0, 'one entry thrown away per call');
    check(handled.length === 0 && party.facing === facing, 'and none of them handled');
  }

  console.log('');
  console.log('=== a click anywhere: button 148 (Mouse.cpp:1899-1912) ===');
  {
    handled.length = 0;
    // An entry was handled this tick, and no tick can come: only `thawCommand` lets it in.
    game.lastInputTime = game.ctx.state.tickCount;
    check(click(160, 100, 1) === 148, 'a right click in the middle of the screen is 148');
    const before = game.ctx.state.tickCount;
    frame(-1);
    console.log(`handled=${JSON.stringify(handled)} ${state()} ticks=${game.ctx.state.tickCount - before}`);
    check(!game.isFrozen() && ui.uiMode === UIMode.Adventure, 'thawed');
    check(handled.join() === '148', 'the thaw did not wait for a tick');
    check(game.ctx.state.tickCount - before === 1, 'the tick that fell due while frozen runs in the thawing frame');
    check(ui.primaryButtons === lists.buttons17196 && ui.secondaryButtons === lists.buttons17304,
      'the adventure lists are back');
    check(ui.keyXlate2 === keys.byte18400 && ui.keyXlate1 === keys.byte18428, 'and the adventure key tables');
    check(!ui.shadedByTag02076e, 'TAG0207cc: the areas and the cursor restored');
  }

  console.log('');
  console.log('=== the bottom-left corner freezes, Esc thaws, over an open inventory ===');
  {
    showHideInventory(ui.ctx, 0);
    check(party.selectedCharacterIndex === 0 && ui.secondaryButtons === lists.buttons17760, 'HERO0\'s inventory is open');
    game.lastInputTime = 0;
    check(Mouse.searchMouseButtons(ui, 0, 199, 2) === 0, 'x 0, y 199 is not: the upper bounds are excluded');
    check(click(0, 198) === 147, 'x 0, y 198 is 147');
    frame(-1);
    console.log(`${state()} selected=${party.selectedCharacterIndex}`);
    check(game.isFrozen(), 'frozen by the click');
    check(press('Pause') === 148, 'Pause is queued as 148');
    frame(-1);
    console.log(`${state()} selected=${party.selectedCharacterIndex}`);
    check(!game.isFrozen(), 'thawed by Pause');
    check(party.selectedCharacterIndex === 0 && ui.secondaryButtons === lists.buttons17760,
      'TAG0207cc shows the inventory again, and its list is back');
    showHideInventory(ui.ctx, 0);
  }

  console.log('');
  console.log('=== asleep: Esc freezes, and the thaw goes back to sleep ===');
  {
    game.systems.mouse.sleep();
    check(Keyboard.translateKey(ui, 0x0d) === 146, 'asleep, Return is 146');
    game.lastInputTime = 0;
    check(press('Pause') === 147, 'and Esc, Pause, 147');
    frame(-1);
    console.log(`${state()} before=${ui.modeBeforeFreeze}`);
    check(game.isFrozen() && game.isPartySleeping(), 'frozen, and still asleep');
    check(!ui.shadedByTag02076e, 'TAG02076e does nothing asleep (Character.cpp:5136)');
    const before = game.ctx.state.tickCount;
    for (let i = 0; i < 5; i++) frame(1);
    check(game.ctx.state.tickCount === before, 'asleep, every frame is a tick, but frozen none is');
    press('Pause');
    frame(-1);
    console.log(`${state()} ticks=${game.ctx.state.tickCount - before}`);
    check(!game.isFrozen() && game.isPartySleeping() && ui.uiMode === UIMode.Sleeping, 'thawed, still asleep');
    check(ui.primaryButtons === lists.buttons17796 && ui.keyXlate2 === keys.byte18440,
      'the sleep list and key table are back');
    const asleep = game.ctx.state.tickCount;
    for (let i = 0; i < 5; i++) frame(1);
    check(game.ctx.state.tickCount - asleep === 5, 'and a tick runs every frame again');
    wakeUp(game.ctx);
  }

  console.log('');
  console.log('=== "GAME FROZEN" (Mouse.cpp:1876-1885) ===');
  {
    const width = 224;
    const height = 136;
    const pixels = new Uint8Array(width * height).fill(9);
    ui.context.viewportIndexBuffer = { width, height, pixels };
    Draw.displayFrozenScreen(ui);
    let ink = 0;
    let other = 0;
    let minX = width, maxX = 0, minY = height, maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = pixels[y * width + x]!;
        if (p === 0) continue;
        if (p !== 4) { other++; continue; }
        ink++;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    console.log(`ink=${ink} box=(${minX},${minY})-(${maxX},${maxY}) other=${other}`);
    check(other === 0, 'only colours 0 and 4');
    // `TextOut_OneLine` draws up from y (`doc/CSBwin-src/Graphics.cpp:321`), as the sleep
    // screen's "WAKE UP" does.
    check(ink > 0 && minX >= 81 && minY === 69 - 4 && maxY === 69 && maxX < 81 + 11 * 6,
      '"GAME FROZEN" sits in rows 65-69 from x 81, eleven 6-pixel cells wide');
  }

  finish();
}

void main();
