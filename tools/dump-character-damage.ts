/**
 * The damage a champion takes, from the blow to the red figure over their name.
 *
 * `DamageCharacter` (`doc/CSBwin-src/Character.cpp:2703`) takes nothing off the HP: it
 * adds the blow to `d.PendingDamage` (`:2900`) and its wounds to `d.PendingOuches`
 * (`:2803`). Once a main-loop tick, after the viewport is drawn,
 * `DisplayCharacterDamage` (`doc/CSBwin-src/CSBCode.cpp:7084`, called at `:657`) ORs the
 * wounds into `ouches`, takes the sum off the HP or kills, and blits graphic 15 over the
 * name — graphic 16 over the portrait of an open inventory — with the figure on it. A
 * `TT_12` five ticks on (`:7172-7202`) runs `TAG011366` (`doc/CSBwin-src/Timer.cpp:2686`),
 * which draws the name or the portrait back over it.
 *
 *   1. The engine: pending damage and wounds, the HP, the `TT_12`, the host's two calls,
 *      a kill, the recruit in a mirror, and the order inside `Game`'s tick.
 *   2. The screen: `drawPartyStatus` with the real graphics and font — what the readout
 *      covers in each mode, and when it is dropped.
 *
 * Run: `npx tsx tools/dump-character-damage.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Direction, Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { DungeonState } from '../src/engine/DungeonState';
import { Game } from '../src/engine/Game';
import { Party } from '../src/engine/Party';
import { TimerFunction } from '../src/engine/TimerQueue';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { addCharacterDefaults, assignPresetHeroPossessions, createChampionFromPreset } from '../src/engine/AddCharacter';
import { emptyPossessions, type Champion } from '../src/engine/gameTypes';
import { createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { drawPartyStatus } from '../src/renderer/ui/Character';
import { createUIState, type UIState } from '../src/renderer/ui/UIState';
import { graphicsTablesOf, newGame, processTimersAt } from './lib/game';
import { check, finish } from './lib/check';

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

const dungeonLoader = new DungeonLoader();
dungeonLoader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
const data = dungeonLoader.getData();
if (!data) throw new Error('dungeon.dat did not load');
const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

/** A game of `count` champions, with the host's two damage calls written to `calls`. */
function makeGame(count: number, calls: string[]): Game {
  const game = newGame(data!, graphics, {
    displayCharacterDamage: (chIdx, damage) => calls.push(`display ${chIdx} ${damage}`),
    tag011366: (chIdx) => calls.push(`tag011366 ${chIdx}`),
  });
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < count; i++) game.addChampion(champion(i));
  game.ctx.party.state.position = new Position(6, 14, 2);
  return game;
}

function tt12s(game: Game): { index: number; time: number; chIdx: number }[] {
  return game.ctx.timers.getTimers()
    .filter((t) => t.function === TimerFunction.TT_12)
    .map((t) => ({ index: t.index, time: t.time, chIdx: t.uByte5 & 0xff }));
}

/* ------------------------------------------------------------ 1. the engine ------ */
console.log('=== DamageCharacter and DisplayCharacterDamage ===');
{
  const calls: string[] = [];
  const g = makeGame(2, calls);
  const hero = g.ctx.party.state.champions[0]!;
  g.ctx.state.tickCount = 100;

  // Two blows in one tick. Kind 0: no armour, no wounds, the damage as it is given.
  const a = g.systems.monsterAttack.damageCharacter(0, 7, 0, 0);
  const b = g.systems.monsterAttack.damageCharacter(0, 5, 0, 0);
  console.log(`two blows of 7 and 5: returned ${a} and ${b}, HP ${hero.attributes.health}, `
    + `pending ${g.ctx.party.state.pendingDamage.join(',')}`);
  check(a === 7 && b === 5, 'DamageCharacter returns what it dealt');
  check(hero.attributes.health === 200, 'and takes nothing off the HP (Character.cpp:2900)');
  check(g.ctx.party.state.pendingDamage[0] === 12, 'the blows add up in d.PendingDamage');

  // Wounds wait too. A 300-point blow over mask 0x3f wounds on this seed.
  const probe = makeGame(1, []);
  probe.systems.monsterAttack.damageCharacter(0, 300, 0x3f, 3);
  const pendingOuches = probe.ctx.party.state.pendingOuches[0]!;
  const woundsBefore = probe.ctx.party.state.champions[0]!.wounds;
  probe.systems.monsterAttack.displayCharacterDamage();
  const woundsAfter = probe.ctx.party.state.champions[0]!.wounds;
  console.log(`a 300-point blow: pending ouches 0x${pendingOuches.toString(16)}, `
    + `wounds 0x${woundsBefore.toString(16)} -> 0x${woundsAfter.toString(16)}`);
  check(pendingOuches !== 0 && woundsBefore === 0, 'wounds wait in d.PendingOuches (Character.cpp:2803)');
  check(woundsAfter === pendingOuches && probe.ctx.party.state.pendingOuches[0] === 0,
    'DisplayCharacterDamage ORs them into ouches and clears them (CSBCode.cpp:7098-7100)');

  g.systems.monsterAttack.displayCharacterDamage();
  const timers = tt12s(g);
  console.log(`DisplayCharacterDamage: HP ${hero.attributes.health}, calls [${calls.join('; ')}], `
    + `TT_12 ${JSON.stringify(timers)}, timerIndex ${hero.timerIndex}`);
  check(hero.attributes.health === 188 && g.ctx.party.state.pendingDamage[0] === 0,
    'the sum comes off the HP once, and the pending damage is cleared');
  check(calls.join(';') === 'display 0 12', 'the screen is asked to show 12 over champion 0');
  check(timers.length === 1 && timers[0]!.time === 105 && timers[0]!.chIdx === 0,
    'a TT_12 for champion 0, five ticks on (CSBCode.cpp:7176-7190)');
  check(hero.timerIndex === timers[0]!.index, "and it is the champion's timerIndex");

  // Another blow two ticks later moves the same timer rather than adding one.
  g.ctx.state.tickCount = 102;
  g.systems.monsterAttack.damageCharacter(0, 3, 0, 0);
  g.systems.monsterAttack.displayCharacterDamage();
  const moved = tt12s(g);
  console.log(`a blow of 3 at 102: TT_12 ${JSON.stringify(moved)}, calls [${calls.join('; ')}]`);
  check(moved.length === 1 && moved[0]!.index === timers[0]!.index && moved[0]!.time === 107,
    'a second loss moves the TT_12 to five ticks after it (CSBCode.cpp:7194-7201)');
  check(calls[1] === 'display 0 3', 'and shows the new loss, not the sum');

  // Nothing is due until then.
  calls.length = 0;
  for (let t = 103; t <= 106; t++) processTimersAt(g, t);
  check(calls.length === 0 && hero.timerIndex !== -1, 'the figure stays up until the timer is due');
  processTimersAt(g, 107);
  console.log(`at 107: calls [${calls.join('; ')}], timerIndex ${hero.timerIndex}, TT_12 left ${tt12s(g).length}`);
  check(calls.join(';') === 'tag011366 0' && hero.timerIndex === -1 && tt12s(g).length === 0,
    'the TT_12 runs TAG011366: timerIndex -1, and the name goes back over it (Timer.cpp:2690-2703)');

  // A blow that kills: no figure, no timer.
  calls.length = 0;
  g.systems.monsterAttack.damageCharacter(1, 250, 0, 0);
  check(g.ctx.party.state.champions[1]!.attributes.health !== 0, 'a killing blow does not kill yet');
  g.systems.monsterAttack.displayCharacterDamage();
  console.log(`a blow of 250 on champion 1: alive ${g.ctx.party.state.champions[1]!.attributes.health !== 0}, calls [${calls.join('; ')}], `
    + `TT_12 ${tt12s(g).length}`);
  check(g.ctx.party.state.champions[1]!.attributes.health === 0, 'DisplayCharacterDamage kills (CSBCode.cpp:7110-7114)');
  check(calls.length === 0 && tt12s(g).length === 0, 'and shows nothing and arms nothing for the dead');

  // A TT_12 that falls due after its champion died redraws nothing (Timer.cpp:2692).
  const late = makeGame(1, calls);
  calls.length = 0;
  late.systems.monsterAttack.damageCharacter(0, 10, 0, 0);
  late.systems.monsterAttack.displayCharacterDamage();
  late.systems.monsterAttack.damageCharacter(0, 999, 0, 0);
  late.systems.monsterAttack.displayCharacterDamage();
  processTimersAt(late, late.ctx.state.tickCount + 5);
  console.log(`shown, then killed before the TT_12: calls [${calls.join('; ')}]`);
  check(calls.join(';') === 'display 0 10', "a dead champion's TT_12 draws nothing back");
  check(late.ctx.party.state.champions[0]!.timerIndex === -1, 'but still clears timerIndex');

  // The recruit in a Hall of Champions mirror: `DamageCharacter` refuses them, and a
  // pending sum is dropped, not taken (CSBCode.cpp:7101-7104).
  const hall = makeGame(2, calls);
  calls.length = 0;
  hall.ctx.party.state.pendingDamage[1] = 30;
  hall.ctx.party.state.potentialChampionIndex = 1;
  hall.systems.monsterAttack.displayCharacterDamage();
  check(hall.ctx.party.state.champions[1]!.attributes.health === 200 && hall.ctx.party.state.pendingDamage[1] === 0
    && calls.length === 0, "the recruit's pending damage is cleared and not taken");
}

/* ------------------------------------------------------- the order in the tick -- */
console.log('');
console.log("=== Game's tick ===");
{
  // A blow inside `ProcessTimers`. The tick draws (`onTick`, `DrawViewport` at
  // CSBCode.cpp:638) with the HP untouched; `DisplayCharacterDamage` follows (`:657`).
  const calls: string[] = [];
  const g = makeGame(1, calls);
  g.systems.timer.processTimers = () => { g.systems.monsterAttack.damageCharacter(0, 9, 0, 0); return false; };
  const seen: number[] = [];
  g.onTick(() => seen.push(g.ctx.party.state.champions[0]!.attributes.health));
  (g as unknown as { gameTick(): void }).gameTick();
  const hp = g.ctx.party.state.champions[0]!.attributes.health;
  console.log(`the tick draws at HP ${seen.join(',')}, and ends at HP ${hp}; calls [${calls.join('; ')}]`);
  check(seen.join(',') === '200' && hp === 191, 'the tick draws first, then takes the damage off');
  check(calls.join(';') === 'display 0 9', 'and the same tick shows it');
}

/* ------------------------------------------------------------- 2. the screen ---- */
console.log('');
console.log('=== drawPartyStatus ===');
{
  const uiTables = graphicsTablesOf(graphics).ui;
  const objectTables = graphicsTablesOf(graphics).objects;
  const heroes = (data.presetHeroes ?? []).filter((h) => (h.inventory?.length ?? 0) > 0);
  const party = new Party(new Position(1, 1, 0), Direction.NORTH);
  for (let i = 0; i < 2; i++) {
    party.addChampion(createChampionFromPreset(heroes[i]!, i, assignPresetHeroPossessions(heroes[i]!.inventory, {
      carryLocation: uiTables.graphic232.carryLocation,
      objDescWord4: objectTables.objDescWord4,
    })));
  }
  const cache = new Map();
  const ui: UIState = createUIState(graphics, new DungeonState(data), {
    getGraphicBitmap: (n, format) => getCachedGraphicBitmap(graphics, cache, n, format),
    renderLastFrame: () => {},
  });
  ui.uiTables = uiTables;
  ui.objectTables = objectTables;
  ui.fontData = loadFontData(graphics);
  ui.partyState = party.state;

  // Canary: the two graphics are the sizes `DisplayCharacterDamage`'s rectangles are
  // (`x2 = x1 + 47`, `y2 = 6`; `x2 = x1 + 31`, `y2 = 28`).
  const g15 = ui.getGraphicBitmap(15)!;
  const g16 = ui.getGraphicBitmap(16)!;
  console.log(`graphic 15 is ${g15.width}x${g15.height}, graphic 16 ${g16.width}x${g16.height}`);
  check(g15.width === 48 && g15.height === 7, 'graphic 15 is 48x7');
  check(g16.width === 32 && g16.height === 29, 'graphic 16 is 32x29');

  const render = (): Uint8Array => {
    const screen = createPaletteIndexViewportBuffer(320, 200, 7);
    ui.screenIndexBuffer = screen;
    drawPartyStatus(ui);
    return screen.pixels.slice(0, 320 * 29);
  };
  /** The bounding box of the pixels that differ, and how many are the figure's colour 15. */
  const diff = (a: Uint8Array, b: Uint8Array): { x1: number; y1: number; x2: number; y2: number; fifteen: number } => {
    const box = { x1: 999, y1: 999, x2: -1, y2: -1, fifteen: 0 };
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const x = i % 320;
      const y = Math.floor(i / 320);
      box.x1 = Math.min(box.x1, x); box.y1 = Math.min(box.y1, y);
      box.x2 = Math.max(box.x2, x); box.y2 = Math.max(box.y2, y);
      if (b[i] === 15) box.fifteen++;
    }
    return box;
  };
  const within = (box: { x1: number; y1: number; x2: number; y2: number }, x1: number, y1: number, x2: number, y2: number): boolean =>
    box.x2 >= 0 && box.x1 >= x1 && box.y1 >= y1 && box.x2 <= x2 && box.y2 <= y2;

  const plain = render();
  ui.characterDamage[1] = { damage: 7, inventoryOpen: false };
  const overName = diff(plain, render());
  console.log(`7 over champion 1's name changes (${overName.x1},${overName.y1})-(${overName.x2},${overName.y2}), `
    + `${overName.fifteen} pixels of colour 15`);
  check(within(overName, 69, 0, 69 + 47, 6), "graphic 15 and the figure lie in the name's rectangle, 69*chIdx..+47 by 0..6");
  check(overName.fifteen > 0, 'the figure is drawn in colour 15');

  ui.characterDamage[1] = { damage: 777, inventoryOpen: false };
  const wide = diff(plain, render());
  check(within(wide, 69, 0, 69 + 47, 6) && wide.fifteen > overName.fifteen, 'three digits fit the same rectangle');

  ui.characterDamage[1] = null;
  party.state.selectedCharacterIndex = 1;
  const inventory = render();
  ui.characterDamage[1] = { damage: 42, inventoryOpen: true };
  const overPortrait = diff(inventory, render());
  console.log(`42 over the open inventory's portrait changes (${overPortrait.x1},${overPortrait.y1})-`
    + `(${overPortrait.x2},${overPortrait.y2}), ${overPortrait.fifteen} pixels of colour 15`);
  check(within(overPortrait, 69 + 7, 0, 69 + 38, 28), "graphic 16 and the figure lie over the portrait, 69*chIdx+7..+38 by 0..28");
  check(overPortrait.fifteen > 0, 'with the figure in colour 15');

  // Opening or closing the inventory fills the box afresh (`CHARFLAG_portraitChanged`).
  ui.characterDamage[1] = { damage: 42, inventoryOpen: false };
  check(diff(inventory, render()).x2 < 0 && ui.characterDamage[1] === null,
    'a figure shown over the name is gone once the inventory is open');

  // Death: `KillCharacter` blits graphic 8 over the box.
  party.state.selectedCharacterIndex = -1;
  const dead = party.state.champions[1]!;
  dead.attributes.health = 0;
  const deadPlain = render();
  ui.characterDamage[1] = { damage: 3, inventoryOpen: false };
  check(diff(deadPlain, render()).x2 < 0 && ui.characterDamage[1] === null, 'a dead champion shows no figure');
}

finish();
