/**
 * Sleep: `d.PartySleeping`, from the icon that sets it to the blow that clears it.
 *
 * - Button 145, the sleep icon, lives in the inventory list `buttons17760`. It closes the
 *   inventory (`ShowHideInventory(4)`), sets `d.PartySleeping`, installs `Buttons17796`
 *   with no secondary list, and `DiscardAllInput()`s — refused while a champion is only
 *   provisionally joined (doc/CSBwin-src/Mouse.cpp:1683-1708).
 * - `Buttons17796` is the viewport, either mouse button, as button 146; nothing else can
 *   be clicked. The key table `Byte18440` binds Return to 146 (read from graphics.dat).
 * - Asleep, `d.Speed = 0`, and a tick is due on every VBL (`CSBCode.cpp:1066-1077`).
 * - `WakeUp` (`CSBCode.cpp:7047`): `d.clockTick = 1` — the tick runs in the very frame —
 *   and the adventure lists back. A blow wakes the party from `MonsterDamagesCharacter`
 *   *before* its dodge test (`Monster.cpp:4531-4536`), and from `DamageCharacter` only
 *   on its armour branch, `P4 != 0` (`Character.cpp:2809-2812`). The tick then clears
 *   `clockTick` (`CSBCode.cpp:704`), so a blow buys no extra tick.
 * - `DisplaySleepScreen` (`CSBCode.cpp:8542`): colour 0 and "WAKE UP" in colour 4 at
 *   viewport (93, 65), 65 being the bottom row (`Graphics.cpp:320`).
 * - A game never starts asleep (`CSBCode.cpp:10479`), a quick-save included.
 *
 * Run: `npx tsx tools/dump-sleep.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults, createChampionFromPreset } from '../src/engine/AddCharacter';
import { AttributeIndex } from '../src/engine/attributes';
import { determineMastery } from '../src/engine/skills';
import { createUIState, UIMode, type UIState } from '../src/renderer/ui/UIState';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { check, finish } from './lib/check';

/** As in `tools/dump-hand-owner.ts`: `ui/Mouse` reaches `@/ui`, which touches `document`. */
async function importUI(): Promise<[typeof import('../src/renderer/ui/Mouse'), typeof import('../src/renderer/ui/Draw')]> {
  const g = globalThis as Record<string, unknown>;
  if (!g.document) g.document = { getElementById: () => null, addEventListener: () => {} };
  if (!g.window) g.window = g;
  return Promise.all([import('../src/renderer/ui/Mouse'), import('../src/renderer/ui/Draw')]);
}

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

async function main(): Promise<void> {
  const [Mouse, Draw] = await importUI();
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);
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

  const game = new Game(
    data,
    {
      roomTimerFunctions: uiTables.graphic232.byte1596,
      monsterDesc: objectTables.monsterDesc,
      objDescObjectType: objectTables.objDescObjectType,
      weaponDesc: objectTables.weaponDesc,
      weaponWeights: objectTables.weaponWeights,
      clothingWeights: objectTables.clothingWeights,
      miscWeights: objectTables.miscWeights,
    },
    {
      monsterDesc: objectTables.monsterDesc,
      word1074: uiTables.graphic232.word1074,
      soundTable: uiTables.graphic232.soundTable,
      doorCharacteristics: objectTables.doorCharacteristics,
      monsterDroppings: objectTables.monsterDroppings,
      facingReplication: objectTables.facingReplication,
      monsterAttackSounds: objectTables.monsterAttackSounds,
      uByte590: uiTables.graphic232.uByte590,
      byte586: uiTables.graphic232.byte586,
      clothingArmour: objectTables.clothingArmour,
      clothingFlags: objectTables.clothingFlags,
      byte1412: uiTables.graphic232.byte1412,
    },
  );
  game.setRandomSeed(0x12345678);
  game.addChampion(champion(0));
  game.addChampion(champion(1));
  const party = game.party.state;
  party.position = new Position(6, 14, 2);
  game.monsterSystem.loadPartyLevel(2);

  // The UI half, wired as `main.ts` and `ui/events.ts` wire it.
  const ui: UIState = createUIState(graphics, game.dungeonState, {
    getGraphicBitmap: () => null,
    renderLastFrame: () => {},
  });
  ui.uiTables = uiTables;
  ui.partyState = party;
  ui.fontData = loadFontData(graphics);
  Mouse.updateButtonLists(ui);
  ui.onSleep = () => game.sleep();
  ui.onWakeUp = () => game.wakeUp();
  const notified: boolean[] = [];
  game.onSleepChanged((sleeping) => {
    notified.push(sleeping);
    ui.uiMode = sleeping ? UIMode.Sleeping : UIMode.Adventure;
    Mouse.updateButtonLists(ui);
    Mouse.syncInventoryButtons(ui);
  });
  const handled: number[] = [];
  game.setMouseEventHandlers({
    button: (num, x, y) => { handled.push(num); Mouse.handleMouseButton(ui, num, x, y); },
    unclick: () => Mouse.handleMouseUnclick(ui),
  });

  type Internals = { lastTickTime: number; lastInputTime: number; state: { tickCount: number } };
  const internals = game as unknown as Internals;
  let t = Date.now() + 60_000;
  /** One VBL, 17 ms on; the last tick was `sinceTick` ms ago. */
  const frame = (sinceTick = 0): void => {
    t += 17;
    if (sinceTick >= 0) internals.lastTickTime = t - sinceTick;
    game.runFrame(t);
  };
  const click = (x: number, y: number, buttons = 2): number => {
    const num = Mouse.searchMouseButtons(ui, x, y, buttons);
    game.onMouseClick(num, x, y);
    game.onMouseUnClick();
    return num;
  };
  const iconX = icon ? (icon.x1 + icon.x2) >> 1 : 0;
  const iconY = icon ? (icon.y1 + icon.y2) >> 1 : 0;

  console.log('');
  console.log('=== button 145 (Mouse.cpp:1683-1708) ===');
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
    internals.lastInputTime = 0;
    handled.length = 0;
    click(iconX, iconY);
    // Queued behind the icon: `DiscardAllInput()` must lose it.
    game.enqueueKeyButton(1);
    frame();
    console.log(`handled=${JSON.stringify(handled)} sleeping=${game.isPartySleeping()} selected=${party.selectedCharacterIndex}`);
    check(game.isPartySleeping(), 'the party is asleep');
    check(notified.join() === 'true', 'the listeners heard it once');
    check(party.selectedCharacterIndex === -1, 'ShowHideInventory(4): the inventory is closed');
    check(ui.primaryButtons === lists.buttons17796 && ui.secondaryButtons === null,
      'PrimaryButtonList = Buttons17796, SecondaryButtonList = NULL');
    check(game.queuedInputCount() === 0 && !handled.includes(1), 'DiscardAllInput(): the turn behind it is gone');
    check(Mouse.searchMouseButtons(ui, 20, 10, 2) === 0, 'a portrait is not a button while asleep');
    check(Mouse.searchMouseButtons(ui, 300, 150, 2) === 0, 'nor is a movement arrow');
    check(Mouse.searchMouseButtons(ui, 100, 100, 1) === 146, 'a right click in the viewport is 146');
  }

  console.log('');
  console.log('=== d.Speed = 0: a tick every VBL ===');
  {
    const before = internals.state.tickCount;
    for (let i = 0; i < 10; i++) frame(17);
    const asleep = internals.state.tickCount - before;
    console.log(`asleep: ${asleep} ticks in 10 frames`);
    check(asleep === 10, 'asleep, every frame is a tick');
  }

  console.log('');
  console.log('=== WakeUp by click (CSBCode.cpp:7047) ===');
  {
    notified.length = 0;
    internals.lastInputTime = 0;
    click(100, 100);
    const before = internals.state.tickCount;
    frame(17); // 17 ms since the last tick: only clockTick = 1 lets this one through
    console.log(`sleeping=${game.isPartySleeping()} ticks=${internals.state.tickCount - before}`);
    check(!game.isPartySleeping(), 'a click in the viewport wakes the party');
    check(notified.join() === 'false', 'the listeners heard it');
    check(ui.primaryButtons === lists.buttons17196 && ui.secondaryButtons === lists.buttons17304,
      'the adventure lists are back');
    check(internals.state.tickCount - before === 1, 'd.clockTick = 1: the tick runs in the same frame');
    const awake = internals.state.tickCount;
    for (let i = 0; i < 10; i++) frame(-1);
    console.log(`awake: ${internals.state.tickCount - awake} ticks in 10 frames (170 ms)`);
    check(internals.state.tickCount === awake, 'awake, 170 ms is not a tick (one per 250 ms)');
  }

  console.log('');
  console.log('=== WakeUp by Return (Byte18440) ===');
  {
    game.sleep();
    internals.lastInputTime = 0;
    check(game.enqueueKeyButton(146), 'Return is queued as 146');
    frame();
    check(!game.isPartySleeping(), 'and wakes the party');
  }

  console.log('');
  console.log('=== WakeUp by a blow ===');
  {
    game.sleep();
    game.monsterAttack.damageCharacter(0, 40, 0, 0);
    check(game.isPartySleeping(), 'DamageCharacter with P4 == 0 does not wake (Character.cpp:2809 is on the armour branch)');
    const hp = party.champions[0]!.attributes.health;
    game.monsterAttack.damageCharacter(0, 40, 1, 2);
    console.log(`P4 == 2: health ${hp} -> ${party.champions[0]!.attributes.health}, sleeping=${game.isPartySleeping()}`);
    check(!game.isPartySleeping(), 'DamageCharacter with P4 == 2 (a pit, a cloud) wakes');
  }
  {
    // Any creature of the dungeon: the wake-up comes before anything reads the record.
    const monster = game.dungeonState.getCreatureRecordByIndex(0);
    check(monster !== null, 'a monster to strike with');
    if (monster) {
      game.sleep();
      game.monsterAttack.monsterDamagesCharacter(monster, 0, true);
      check(!game.isPartySleeping(), 'MonsterDamagesCharacter wakes the party whatever the outcome');
      // In a tick: the blow's clockTick = 1 is cleared by the tick's own clockTick = 0.
      game.sleep();
      const internalsTick = game as unknown as { gameTick(): void };
      game.onTick(() => { if (game.isPartySleeping()) game.wakeUp(); });
      internalsTick.gameTick();
      const before = internals.state.tickCount;
      frame(17);
      check(internals.state.tickCount === before, 'woken inside a tick, the next frame is not a tick');
    }
  }

  console.log('');
  console.log('=== DisplaySleepScreen (CSBCode.cpp:8542) ===');
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
    // `A3 += (D6W - 4) * destWidth` (doc/CSBwin-src/Graphics.cpp:320): y is the glyphs'
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
    const syraHero = game.dungeonState.getData().presetHeroes?.find((h) => h.name === 'SYRA');
    check(syraHero !== undefined, 'SYRA is a preset hero');
    if (syraHero) {
      game.wakeUp();
      party.champions.length = 0;
      game.addChampion(createChampionFromPreset(syraHero, 0));
      const syra = party.champions[0]!;
      const awake = determineMastery(syra, 3) + determineMastery(syra, 2);
      const wisdom = syra.attributes.stats[AttributeIndex.Wisdom]!.current;
      console.log(`SYRA: Wisdom ${wisdom}, Wizard + Priest mastery ${awake} awake`);
      check(awake + wisdom > 48 && 2 + wisdom <= 48, 'the canary: r = 48 separates the two thresholds');
      const tenSecond = game as unknown as { processTenSecondUpdate(): void };
      game.sleep();
      syra.attributes.mana = 0;
      internals.state.tickCount = 0x180; // random112 = 48
      tenSecond.processTenSecondUpdate();
      console.log(`r=48 asleep: mana ${syra.attributes.mana}`);
      check(syra.attributes.mana === 0, 'asleep, r = 48 is not below Wisdom + 2: no mana');
      internals.state.tickCount = 0x200; // random112 = 0
      syra.attributes.stamina = 200;
      tenSecond.processTenSecondUpdate();
      check(syra.attributes.mana === 1, 'r = 0 is: MaxMana 15 / 40 * 2 + 1 = one point');
      game.wakeUp();
      syra.attributes.mana = 0;
      internals.state.tickCount = 0x380; // random112 = 48 again (bit 9 is not read), awake
      tenSecond.processTenSecondUpdate();
      check(syra.attributes.mana === 1, 'awake, her levels count: r = 48 < 50 gives mana');
    }
  }

  console.log('');
  console.log('=== never restored asleep (CSBCode.cpp:10479) ===');
  {
    game.sleep();
    const save = game.getRuntimeSaveState();
    game.wakeUp();
    game.sleep();
    notified.length = 0;
    game.applyRuntimeSaveState(save);
    check(!game.isPartySleeping(), 'a save taken asleep loads awake');
    check(notified.join() === 'false', 'and the UI is told');
  }

  finish();
}

void main();
