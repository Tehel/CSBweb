/**
 * Sleep: `d.PartySleeping`, from the icon that sets it to the blow that clears it.
 *
 * - Button 145, the sleep icon, lives in the inventory list `buttons17760`. It closes the
 *   inventory (`ShowHideInventory(4)`), sets `d.PartySleeping`, installs `Buttons17796`
 *   with no secondary list, and `DiscardAllInput()`s — refused while a champion is only
 *   provisionally joined (doc/CSBwin-src/Mouse.cpp:1822-1847).
 * - `Buttons17796` is the viewport, either mouse button, as button 146; nothing else can
 *   be clicked. The key table `Byte18440` binds Return to 146 (read from graphics.dat).
 * - Asleep, `d.Speed = 0`, and a tick is due on every VBL (`CSBCode.cpp:1076-1087`).
 * - `TAG02076e` on the way to sleep (`Mouse.cpp:1830`) shades the interface and shows the
 *   arrow cursor until `WakeUp`'s `TAG0207cc` (`CSBCode.cpp:7120`).
 * - `WakeUp` (`CSBCode.cpp:7106`): `d.clockTick = 1` — the tick runs in the very frame —
 *   and the adventure lists back. A blow wakes the party from `MonsterDamagesCharacter`
 *   *before* its dodge test (`Monster.cpp:4544-4549`), and from `DamageCharacter` only
 *   on its armour branch, `P4 != 0` (`Character.cpp:2814-2817`). The tick then clears
 *   `clockTick` (`CSBCode.cpp:714`), so a blow buys no extra tick.
 * - `DisplaySleepScreen` (`CSBCode.cpp:8647`): colour 0 and "WAKE UP" in colour 4 at
 *   viewport (93, 65), 65 being the bottom row (`Graphics.cpp:321`).
 * - A game never starts asleep (`CSBCode.cpp:10603`), a quick-save included.
 * - `SetNewSpeed` (`CSBCode.cpp:1608`): falling asleep multiplies what is left of each
 *   message row's timeout by 16 (`d.Speed` 15 -> 0, `Mouse.cpp:1835`), and `WakeUp` divides
 *   it by 16, rounding up (0 -> 15, `CSBCode.cpp:7112`).
 * - A load keeps the rows on screen and rebases their timeouts onto the loaded clock
 *   (`ResetTime`, `SaveGame.cpp:1747-1748`); CSBWin saves no message state.
 *
 * Run: `npx tsx tools/dump-sleep.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults, createChampionFromPreset } from '../src/engine/AddCharacter';
import { AttributeIndex } from '../src/engine/attributes';
import { determineMastery } from '../src/engine/skills';
import { tenSecondUpdate } from '../src/engine/PeriodicUpdates';
import { UIMode, type UIState } from '../src/renderer/ui/UIState';
import { ScrollingText } from '../src/renderer/csbwin/ScrollingText';
import { graphicsTablesOf, newGame, presetHeroesOfGame, runVbl } from './lib/game';
import { newUIState } from './lib/ui';
import { wakeUp } from '../src/engine/LoopState';
import { check, finish } from './lib/check';
import * as Mouse from '../src/renderer/ui/Mouse';
import * as Draw from '../src/renderer/ui/Draw';

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const uiTables = graphicsTablesOf(graphics).ui;
  const lists = uiTables.graphic231.buttons;

  console.log('=== the button lists (graphics.dat 0x231) ===');
  const icon = lists.buttons17760.find((b) => b.word0 === 145);
  console.log(`sleep icon: ${JSON.stringify(icon)}`);
  check(icon !== undefined, 'button 145 is in the inventory list buttons17760');
  const sleepList = lists.buttons17796.filter((b) => b.word0 !== 0);
  console.log(`Buttons17796: ${JSON.stringify(sleepList)}`);
  check(sleepList.length === 2 && sleepList.every((b) =>
    b.word0 === 146 && b.x1 === 0 && b.x2 === 223 && b.y1 === 33 && b.y2 === 168),
  'asleep, the viewport and only the viewport is button 146');
  check((sleepList[0]!.button | sleepList[1]!.button) === 3, 'either mouse button wakes');

  // The host's `sleepChanged`, wired as `main.ts` wires it (the UI half is built below).
  const notified: boolean[] = [];
  const messages = new ScrollingText();
  const game = newGame(data, graphics, {
    messages,
    sleepChanged: (sleeping) => {
      notified.push(sleeping);
      ui.uiMode = sleeping ? UIMode.Sleeping : UIMode.Adventure;
      Mouse.updateButtonLists(ui);
      Mouse.syncInventoryButtons(ui);
    },
    tag0207cc: () => Mouse.tag0207cc(ui),
  });
  game.setRandomSeed(0x12345678);
  game.systems.hallOfChampions.addChampion(champion(0));
  game.systems.hallOfChampions.addChampion(champion(1));
  const party = game.ctx.party.state;
  party.position = new Position(6, 14, 2);
  game.systems.monsters.loadPartyLevel(2);

  // The UI half, wired as `GameInput.install` wires it.
  const ui: UIState = newUIState(graphics, game.ctx);
  ui.partyState = party;
  Mouse.updateButtonLists(ui);
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
  const iconX = icon ? (icon.x1 + icon.x2) >> 1 : 0;
  const iconY = icon ? (icon.y1 + icon.y2) >> 1 : 0;

  console.log('');
  console.log('=== button 145 (Mouse.cpp:1822-1847) ===');
  {
    party.potentialChampionIndex = 1;
    party.selectedCharacterIndex = 0;
    Mouse.syncInventoryButtons(ui);
    check(click(iconX, iconY) === 145, 'the icon is found in the open inventory\'s list');
    frame();
    check(!game.isPartySleeping(), 'refused while a champion is only provisionally joined');
    party.potentialChampionIndex = -1;
  }
  {
    game.lastInputTime = 0;
    handled.length = 0;
    click(iconX, iconY);
    // Queued behind the icon: `DiscardAllInput()` must lose it.
    game.enqueueKeyButton(1);
    frame();
    console.log(`handled=${JSON.stringify(handled)} sleeping=${game.isPartySleeping()} selected=${party.selectedCharacterIndex}`);
    check(game.isPartySleeping(), 'the party is asleep');
    check(notified.join() === 'true', 'the listeners heard it once');
    check(party.selectedCharacterIndex === -1, 'ShowHideInventory(4): the inventory is closed');
    check(ui.shadedByTag02076e, 'TAG02076e (Mouse.cpp:1830): the interface shaded, the arrow cursor');
    check(ui.primaryButtons === lists.buttons17796 && ui.secondaryButtons === null,
      'PrimaryButtonList = Buttons17796, SecondaryButtonList = NULL');
    check(game.ctx.mouseQueue.count() === 0 && !handled.includes(1), 'DiscardAllInput(): the turn behind it is gone');
    check(Mouse.searchMouseButtons(ui, 20, 10, 2) === 0, 'a portrait is not a button while asleep');
    check(Mouse.searchMouseButtons(ui, 300, 150, 2) === 0, 'nor is a movement arrow');
    check(Mouse.searchMouseButtons(ui, 100, 100, 1) === 146, 'a right click in the viewport is 146');
  }

  console.log('');
  console.log('=== d.Speed = 0: a tick every VBL ===');
  {
    const before = game.ctx.state.tickCount;
    for (let i = 0; i < 10; i++) frame(1);
    const asleep = game.ctx.state.tickCount - before;
    console.log(`asleep: ${asleep} ticks in 10 frames`);
    check(asleep === 10, 'asleep, every frame is a tick');
  }

  console.log('');
  console.log('=== WakeUp by click (CSBCode.cpp:7106) ===');
  {
    notified.length = 0;
    game.lastInputTime = 0;
    click(100, 100);
    const before = game.ctx.state.tickCount;
    frame(1); // a VBL since the last tick: only clockTick = 1 lets this one through
    console.log(`sleeping=${game.isPartySleeping()} ticks=${game.ctx.state.tickCount - before}`);
    check(!game.isPartySleeping(), 'a click in the viewport wakes the party');
    check(notified.join() === 'false', 'the listeners heard it');
    check(ui.primaryButtons === lists.buttons17196 && ui.secondaryButtons === lists.buttons17304,
      'the adventure lists are back');
    check(!ui.shadedByTag02076e, 'TAG0207cc last (CSBCode.cpp:7120): the interface and cursor restored');
    check(game.ctx.state.tickCount - before === 1, 'd.clockTick = 1: the tick runs in the same frame');
    const awake = game.ctx.state.tickCount;
    for (let i = 0; i < 10; i++) frame(-1);
    console.log(`awake: ${game.ctx.state.tickCount - awake} ticks in 10 frames (170 ms)`);
    check(game.ctx.state.tickCount === awake, 'awake, 170 ms is not a tick (one per 250 ms)');
  }

  console.log('');
  console.log('=== WakeUp by Return (Byte18440) ===');
  {
    game.systems.mouse.sleep();
    game.lastInputTime = 0;
    check(game.enqueueKeyButton(146), 'Return is queued as 146');
    frame();
    check(!game.isPartySleeping(), 'and wakes the party');
  }

  console.log('');
  console.log('=== SetNewSpeed (CSBCode.cpp:1608): a message row across a sleep ===');
  {
    const t0 = game.ctx.state.tickCount;
    messages.quePrintLines(15, 'HELLO');
    messages.printNextQueued(t0);
    const placed = messages.timeouts()[0]!;
    game.systems.mouse.sleep();
    const asleep = messages.timeouts()[0]!;
    for (let i = 0; i < 100; i++) frame(1);
    const t1 = game.ctx.state.tickCount;
    wakeUp(game.ctx);
    const awake = messages.timeouts()[0]!;
    wakeUp(game.ctx);
    const again = messages.timeouts()[0]!;
    console.log(`placed at ${t0}: ${placed}; asleep: ${asleep}; woken at ${t1}: ${awake}; again: ${again}; row 1: ${messages.timeouts()[1]}`);
    check(placed === t0 + 70, 'awake, a row lasts 70 ticks (CSBCode.cpp:1562)');
    check(asleep === t0 + 70 * 16, 'SetNewSpeed(15, 0): the 70 ticks left become 70 * 16');
    check(t1 === t0 + 100 && awake === t1 + Math.ceil((asleep - t1) / 16),
      'SetNewSpeed(0, 15): the 1020 left become ceil(1020 / 16) = 64');
    check(again === awake, 'WakeUp awake is SetNewSpeed(15, 15), which changes nothing');
    check(messages.timeouts()[1] === -1, 'an empty row stays empty');
  }

  console.log('');
  console.log('=== WakeUp by a blow ===');
  {
    game.systems.mouse.sleep();
    game.systems.monsterAttack.damageCharacter(0, 40, 0, 0);
    check(game.isPartySleeping(), 'DamageCharacter with P4 == 0 does not wake (Character.cpp:2814 is on the armour branch)');
    const hp = party.champions[0]!.attributes.health;
    game.systems.monsterAttack.damageCharacter(0, 40, 1, 2);
    console.log(`P4 == 2: health ${hp} -> ${party.champions[0]!.attributes.health}, sleeping=${game.isPartySleeping()}`);
    check(!game.isPartySleeping(), 'DamageCharacter with P4 == 2 (a pit, a cloud) wakes');
  }
  {
    // Any creature of the dungeon: the wake-up comes before anything reads the record.
    const monster = game.ctx.dungeon.getCreatureRecordByIndex(0);
    check(monster !== null, 'a monster to strike with');
    if (monster) {
      game.systems.mouse.sleep();
      game.systems.monsterAttack.monsterDamagesCharacter(monster, 0, true);
      check(!game.isPartySleeping(), 'MonsterDamagesCharacter wakes the party whatever the outcome');
      // In a tick: the blow's clockTick = 1 is cleared by the tick's own clockTick = 0.
      game.systems.mouse.sleep();
      game.onTick(() => { if (game.isPartySleeping()) wakeUp(game.ctx); });
      game.gameTick();
      const before = game.ctx.state.tickCount;
      frame(1);
      check(game.ctx.state.tickCount === before, 'woken inside a tick, the next frame is not a tick');
    }
  }

  console.log('');
  console.log('=== DisplaySleepScreen (CSBCode.cpp:8647) ===');
  {
    const width = 224;
    const height = 136;
    const pixels = new Uint8Array(width * height).fill(9);
    ui.context = { viewportIndexBuffer: { width, height, pixels } } as unknown as UIState['context'];
    Draw.displaySleepScreen(ui);
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
    // `A3 += (D6W - 4) * destWidth` (doc/CSBwin-src/Graphics.cpp:321): y is the glyphs'
    // bottom row, not their top.
    check(ink > 0 && minX >= 93 && minY === 65 - 4 && maxY === 65 && maxX < 93 + 7 * 6,
      '"WAKE UP" sits in rows 61-65 from x 93, seven 6-pixel cells wide');
  }

  console.log('');
  console.log('=== TenSecondUpdate asleep: every mastery is 1 (Code17818.cpp:29-36) ===');
  {
    // SYRA: Wisdom 43 and Wizard + Priest mastery 7 awake. Asleep the roll is
    // `random112 < 1 + 1 + 43`, so the r = 48 step (Time 0x180) gives no mana; with her
    // real levels it would (48 < 50). That step is the canary.
    const syraHero = presetHeroesOfGame(game).find((h) => h.name === 'SYRA');
    check(syraHero !== undefined, 'SYRA is a preset hero');
    if (syraHero) {
      wakeUp(game.ctx);
      party.champions.length = 0;
      game.systems.hallOfChampions.addChampion(createChampionFromPreset(syraHero, 0));
      const syra = party.champions[0]!;
      const awake = determineMastery(syra, 3) + determineMastery(syra, 2);
      const wisdom = syra.attributes.stats[AttributeIndex.Wisdom]!.current;
      console.log(`SYRA: Wisdom ${wisdom}, Wizard + Priest mastery ${awake} awake`);
      check(awake + wisdom > 48 && 2 + wisdom <= 48, 'the canary: r = 48 separates the two thresholds');
      game.systems.mouse.sleep();
      syra.attributes.mana = 0;
      game.ctx.state.tickCount = 0x180; // random112 = 48
      tenSecondUpdate(game.ctx);
      console.log(`r=48 asleep: mana ${syra.attributes.mana}`);
      check(syra.attributes.mana === 0, 'asleep, r = 48 is not below Wisdom + 2: no mana');
      game.ctx.state.tickCount = 0x200; // random112 = 0
      syra.attributes.stamina = 200;
      tenSecondUpdate(game.ctx);
      check(syra.attributes.mana === 1, 'r = 0 is: MaxMana 15 / 40 * 2 + 1 = one point');
      wakeUp(game.ctx);
      syra.attributes.mana = 0;
      game.ctx.state.tickCount = 0x380; // random112 = 48 again (bit 9 is not read), awake
      tenSecondUpdate(game.ctx);
      check(syra.attributes.mana === 1, 'awake, her levels count: r = 48 < 50 gives mana');
    }
  }

  console.log('');
  console.log('=== never restored asleep (CSBCode.cpp:10603) ===');
  {
    game.systems.mouse.sleep();
    const save = game.getRuntimeSaveState();
    wakeUp(game.ctx);
    game.systems.mouse.sleep();
    notified.length = 0;
    game.applyRuntimeSaveState(save);
    check(!game.isPartySleeping(), 'a save taken asleep loads awake');
    check(notified.join() === 'false', 'and the UI is told');
  }

  console.log('');
  console.log('=== a load keeps the message rows (SaveGame.cpp:1747-1748) ===');
  {
    const save = game.getRuntimeSaveState();
    const saved = save.game.tickCount;
    game.ctx.state.tickCount = saved + 500;
    messages.printLinefeed();
    messages.quePrintLines(15, 'LOADED');
    messages.printNextQueued(game.ctx.state.tickCount);
    messages.printNextQueued(game.ctx.state.tickCount);
    const row = messages.snapshot().findIndex((line) => line.includes('LOADED'));
    const before = messages.timeouts()[row]!;
    game.applyRuntimeSaveState(save);
    const after = messages.timeouts()[row]!;
    console.log(`row ${row} placed at ${saved + 500}: ${before}; loaded at ${saved}: ${after} ${JSON.stringify(messages.snapshot()[row])}`);
    check(row >= 0 && messages.snapshot()[row]!.includes('LOADED'), 'the row is still on screen');
    check(after === saved + 70, 'ResetTime: its 70 ticks left count from the loaded clock');

    // Loaded over a sleeping party, the next tick's SetNewSpeed(0, 15) (CSBCode.cpp:622-626).
    game.systems.mouse.sleep();
    const stretched = messages.timeouts()[row]!;
    game.applyRuntimeSaveState(save);
    const loaded = messages.timeouts()[row]!;
    console.log(`asleep: ${stretched}; loaded awake: ${loaded}`);
    check(stretched === saved + 70 * 16 && loaded === saved + 70,
      'loaded over a sleeping party, the rows shrink back as a WakeUp would shrink them');
  }

  finish();
}

void main();
