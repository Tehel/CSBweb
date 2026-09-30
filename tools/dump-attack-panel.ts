/**
 * What the attack panel shows between CSBWin's redraws of it.
 *
 * CSBWin draws the panel only at `DrawLegalAttackTypes` (`doc/CSBwin-src/CSBCode.cpp:8718`)
 * and `FlashAttackDamage` (`doc/CSBwin-src/Attack.cpp:949`); between them the screen keeps
 * the last drawing. The port composes the panel from state every frame
 * (`drawAttackPanel`, `src/renderer/ui/Attack.ts`), so the state must say what that last
 * drawing was. `TAG01b1c0` (`doc/CSBwin-src/Character.cpp:4887-4897`) closes the menu and
 * draws nothing, so the menu stays up until the next tick's `TAG01b29a`
 * (`CSBCode.cpp:8843-8854`) draws the damage or the champions' buttons over it.
 *
 * The panel is drawn with the real graphics and font; each row of the output is a state
 * and a hash of the panel's pixels, and the checks compare the states' pixels.
 *
 * The last block is `TAG01b29a`'s other job, the flinch, which it skips while a
 * candidate stands at a mirror as it does asleep (`CSBCode.cpp:8808-8816`).
 *
 * Run: `npx tsx tools/dump-attack-panel.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Direction, Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { DungeonState } from '../src/engine/DungeonState';
import { Party } from '../src/engine/Party';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../src/engine/AddCharacter';
import { createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import {
  attackPanelTick, closeAttackMenu, drawAttackPanel, executeAttack, prepareAttack, takeAttackOption,
} from '../src/renderer/ui/Attack';
import { createUIState, type UIState } from '../src/renderer/ui/UIState';
import { check, finish } from './lib/check';
import { graphicsTablesOf } from './lib/game';

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const uiTables = graphicsTablesOf(graphics).ui;
  const objectTables = graphicsTablesOf(graphics).objects;

  const heroes = (data.presetHeroes ?? []).filter((h) => (h.inventory?.length ?? 0) > 0);
  if (heroes.length < 2) throw new Error('dungeon.dat carries fewer than two equipped preset heroes');
  const party = new Party(new Position(1, 1, 0), Direction.NORTH);
  for (let i = 0; i < 2; i++) {
    party.addChampion(createChampionFromPreset(heroes[i], i, assignPresetHeroPossessions(heroes[i].inventory, {
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
  let damageToDisplay = 0;
  ui.onConsumeAttackDamage = () => {
    const damage = damageToDisplay;
    damageToDisplay = 0;
    return damage;
  };
  ui.onChampionAttack = () => {
    damageToDisplay = 20;
    return 1;
  };

  /** Draw the panel over a screen of 7s and hand back its rectangle's pixels. */
  const panel = uiTables.graphic232.word20;
  function render(label: string): string {
    const screen = createPaletteIndexViewportBuffer(320, 200, 7);
    ui.screenIndexBuffer = screen;
    drawAttackPanel(ui);
    const rows: string[] = [];
    for (let y = panel.y1; y <= panel.y2; y++) {
      rows.push(Array.from(screen.pixels.subarray(y * 320 + panel.x1, y * 320 + panel.x2 + 1)).join(','));
    }
    const pixels = rows.join('/');
    let hash = 0;
    for (let i = 0; i < pixels.length; i++) hash = (hash * 31 + pixels.charCodeAt(i)) >>> 0;
    const black = pixels.split(/[,/]/).every((p) => p === '0');
    console.log([label, `ordinal ${ui.attackingCharacterOrdinal}`, `word20252 ${ui.word20252}`,
      `word20250 ${ui.word20250}`, black ? 'black' : hash.toString(16).padStart(8, '0')].join('\t'));
    return pixels;
  }

  console.log(`=== the panel, (${panel.x1},${panel.y1})-(${panel.x2},${panel.y2}) ===`);
  const buttons = render('the buttons');
  prepareAttack(ui, 0);
  const menu = render("champion 1's menu");
  check(menu !== buttons, 'the menu replaces the buttons');

  executeAttack(ui, -1);
  check(render('PASS, before the tick') === menu,
    'a PASS draws nothing: the menu stays on the panel (TAG01b1c0, Character.cpp:4887-4897)');
  attackPanelTick(ui);
  check(render('the tick') === buttons, "the tick's TAG01b29a draws the buttons over it (CSBCode.cpp:8849-8853)");

  prepareAttack(ui, 1);
  const menu2 = render("champion 2's menu");
  closeAttackMenu(ui);
  check(render('closed by TAG01b1c0') === menu2, "a close from elsewhere leaves champion 2's menu up too");
  prepareAttack(ui, 0);
  check(render("champion 1's menu again") === menu, "a new menu is champion 1's, not the closed one's");

  takeAttackOption(ui, 0);
  check(render('attack, before the tick') === menu, 'an attack leaves the menu up until the tick');
  attackPanelTick(ui);
  const damage = render('the tick: the damage');
  check(damage !== menu && damage !== buttons, "the tick's FlashAttackDamage draws the damage over it");
  ui.attackFlashUntilMs = 0;
  check(render('the flash over, before the tick') === damage,
    'the damage stays up after its VBLDelay(15) (Attack.cpp:1039)');
  attackPanelTick(ui);
  check(render('the next tick') === buttons, 'and the next tick draws the buttons');

  prepareAttack(ui, 0);
  takeAttackOption(ui, 0);
  attackPanelTick(ui);
  check(render('the damage again') === damage, 'another attack flashes the damage');
  prepareAttack(ui, 0);
  check(render("a key opens champion 1's menu") === menu,
    'a menu opened over the damage is drawn without it (DrawLegalAttackTypes)');
  executeAttack(ui, -1);
  attackPanelTick(ui);
  check(render('PASS, and the tick') === buttons, 'and its PASS brings the buttons back at the tick');

  console.log('');
  console.log('=== the three bursts (Attack.cpp:985-1025) ===');
  // Graphic 14 is the 96x45 burst, drawn off-centre in it so that it centres on x=274,
  // where the digits are (`D5W = 274`, Attack.cpp:1027). The two smaller ones are it
  // shrunk to 64x37 and 42x37, so they centre there too and their rectangle's edge cuts
  // none of them; a crop of the big one instead would sit right of 274 and be cut.
  const g230 = uiTables.graphic230;
  for (const [value, rect, name] of [
    [50, g230.wRectPos20202, 'wRectPos20202'],
    [20, g230.wRectPos20226, 'wRectPos20226'],
    [9, g230.wRectPos20234, 'wRectPos20234'],
  ] as const) {
    const screen = createPaletteIndexViewportBuffer(320, 200, 7);
    ui.screenIndexBuffer = screen;
    ui.attackingCharacterOrdinal = 0;
    ui.attackFlashValue = value;
    drawAttackPanel(ui);
    let x1 = 320, x2 = -1;
    for (let y = panel.y1; y <= panel.y2; y++) {
      for (let x = panel.x1; x <= panel.x2; x++) {
        if (screen.pixels[y * 320 + x] !== 0) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); }
      }
    }
    console.log(`damage ${value}\t${name} x ${rect.x1}-${rect.x2}\tburst x ${x1}-${x2}`);
    check(x1 > rect.x1 && x2 < rect.x2 && Math.abs((x1 + x2) / 2 - 274) <= 1.5,
      `damage ${value}: the burst is whole inside ${name} and centred on the digits`);
  }
  ui.attackFlashValue = 0;

  console.log('');
  console.log('=== the flinch, with a candidate at the mirror (CSBCode.cpp:8808-8837) ===');
  const champ = party.state.champions[0]!;
  party.state.cursorOwner = -1;
  const flinch = (label: string): void => console.log([label, `facing ${champ.facing}`,
    `from ${champ.damageFromDirection}`, `maxRecentDamage ${champ.maxRecentDamage}`,
    `ordinal ${ui.attackingCharacterOrdinal}`].join('\t'));
  const facing = champ.facing;
  champ.damageFromDirection = (facing + 2) & 3;
  champ.maxRecentDamage = 12;
  party.state.potentialChampionIndex = 1;
  prepareAttack(ui, 0);
  attackPanelTick(ui);
  flinch('candidate, menu open: tick');
  check(ui.attackingCharacterOrdinal === 0, 'the tick closes the menu (TAG01b1c0)');
  check(champ.facing === facing && champ.maxRecentDamage === 12, 'and nobody turns');
  attackPanelTick(ui);
  flinch('candidate: tick');
  check(champ.facing === facing && champ.maxRecentDamage === 12,
    'while the candidate stands, nobody turns, and the damage is kept');
  render('candidate: the panel, its buttons shaded');
  check(ui.word20250 === 0 && ui.word20252 === 1, 'but the buttons are drawn again (CSBCode.cpp:8849-8853)');
  party.state.potentialChampionIndex = -1;
  attackPanelTick(ui);
  flinch('candidate gone: tick');
  check(champ.facing === champ.damageFromDirection && champ.maxRecentDamage === 0,
    'the first tick after it, the champion turns to the blow');

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
