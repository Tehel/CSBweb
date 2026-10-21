/**
 * What the attack panel shows between CSBWin's redraws of it.
 *
 * CSBWin draws the panel only at `DrawLegalAttackTypes` (`doc/CSBwin-src/CSBCode.cpp:8823`)
 * and `FlashAttackDamage` (`doc/CSBwin-src/Attack.cpp:949`); between them the screen keeps
 * the last drawing. The port composes the panel from state every frame
 * (`drawAttackPanel`, `src/renderer/ui/Attack.ts`), so the state must say what that last
 * drawing was. `TAG01b1c0` (`doc/CSBwin-src/Character.cpp:4904-4922`) closes the menu and
 * draws nothing, so the menu stays up until the next tick's `TAG01b29a`
 * (`CSBCode.cpp:8948-8959`) draws the damage or the champions' buttons over it.
 *
 * The panel is drawn with the real graphics and font; each row of the output is a state
 * and a hash of the panel's pixels, and the checks compare the states' pixels.
 *
 * The last block is `TAG01b29a`'s other job, the flinch, which it skips while a
 * candidate stands at a mirror as it does asleep (`CSBCode.cpp:8913-8921`).
 *
 * Run: `npm test -- --only=dump-attack-panel.ts`
 */
import { Direction, Position } from '../src/core/types';
import { Party } from '../src/engine/Party';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../src/engine/AddCharacter';
import { createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { tag01b1c0, tag01b29a } from '../src/engine/AttackMenu';
import { drawAttackPanel, executeAttack, FLASH_MS, prepareAttack, takeAttackOption } from '../src/renderer/ui/Attack';
import { VBL_PER_TICK } from '../src/engine/LoopState';
import { type UIState } from '../src/renderer/ui/UIState';
import { check, finish } from './lib/check';
import { gameTablesOf, newGame, presetHeroesOf, stockDungeon, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';
import { standIn } from './lib/standIn';

async function main(): Promise<void> {
  const data = stockDungeon();

  const graphics = stockGraphics();

  const heroes = presetHeroesOf(data, graphics).filter((h) => (h.inventory?.length ?? 0) > 0);
  if (heroes.length < 2) throw new Error('dungeon.dat carries fewer than two equipped preset heroes');
  const party = new Party(new Position(1, 1, 0), Direction.NORTH);
  for (let i = 0; i < 2; i++) {
    party.addChampion(createChampionFromPreset(heroes[i], i, assignPresetHeroPossessions(heroes[i].inventory, gameTablesOf(graphics))));
  }

  const cache = new Map();
  const game = newGame(data, graphics);
  const ui: UIState = newUIState(graphics, game.ctx, {
    getGraphicBitmap: (n, format) => getCachedGraphicBitmap(graphics, cache, n, format),
  });
  ui.ctx.party.state = party.state;
  let damageToDisplay = 0;
  standIn(game.systems.attack, 'consumeAttackDamageToDisplay', () => {
    const damage = damageToDisplay;
    damageToDisplay = 0;
    return damage;
  });
  standIn(game.systems.character, 'executeAttack', () => {
    damageToDisplay = 20;
    return 1;
  });

  /** Draw the panel over a screen of 7s and hand back its rectangle's pixels. */
  const panel = ui.uiTables.graphic232.word20;
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
    console.log([label, `ordinal ${ui.ctx.interface.attackingCharacterOrdinal}`, `word20252 ${ui.ctx.interface.word20252}`,
      `word20250 ${ui.ctx.interface.word20250}`, black ? 'black' : hash.toString(16).padStart(8, '0')].join('\t'));
    return pixels;
  }

  console.log(`=== the panel, (${panel.x1},${panel.y1})-(${panel.x2},${panel.y2}) ===`);
  const buttons = render('the buttons');
  prepareAttack(ui, 0);
  const menu = render("champion 1's menu");
  check(menu !== buttons, 'the menu replaces the buttons');

  executeAttack(ui, -1);
  check(render('PASS, before the tick') === menu,
    'a PASS draws nothing: the menu stays on the panel (TAG01b1c0, Character.cpp:4904-4922)');
  tag01b29a(ui.ctx);
  check(render('the tick') === buttons, "the tick's TAG01b29a draws the buttons over it (CSBCode.cpp:8954-8958)");

  prepareAttack(ui, 1);
  const menu2 = render("champion 2's menu");
  tag01b1c0(ui.ctx);
  check(render('closed by TAG01b1c0') === menu2, "a close from elsewhere leaves champion 2's menu up too");
  prepareAttack(ui, 0);
  check(render("champion 1's menu again") === menu, "a new menu is champion 1's, not the closed one's");

  takeAttackOption(ui, 0);
  check(render('attack, before the tick') === menu, 'an attack leaves the menu up until the tick');
  tag01b29a(ui.ctx);
  const damage = render('the tick: the damage');
  check(damage !== menu && damage !== buttons, "the tick's FlashAttackDamage draws the damage over it");
  // The author's flash (DEBT.md H): over one tick and under two, where CSBWin's
  // VBLDelay(15) is one. The next tick, a tick's milliseconds on, leaves the damage up.
  const tickMs = (VBL_PER_TICK * 1000) / 60;
  check(FLASH_MS > tickMs && FLASH_MS < 2 * tickMs, `the flash, ${FLASH_MS} ms, is over one tick and under two`);
  ui.attackFlashUntilMs -= tickMs;
  tag01b29a(ui.ctx);
  check(render('a tick on') === damage, 'the first tick after the flash leaves the damage up');
  ui.attackFlashUntilMs = 0;
  check(render('the flash over, before the tick') === damage,
    'the damage stays up after its VBLDelay(15) (Attack.cpp:1039)');
  tag01b29a(ui.ctx);
  check(render('the next tick') === buttons, 'and the next tick draws the buttons');

  prepareAttack(ui, 0);
  takeAttackOption(ui, 0);
  tag01b29a(ui.ctx);
  check(render('the damage again') === damage, 'another attack flashes the damage');
  prepareAttack(ui, 0);
  check(render("a key opens champion 1's menu") === menu,
    'a menu opened over the damage is drawn without it (DrawLegalAttackTypes)');
  executeAttack(ui, -1);
  tag01b29a(ui.ctx);
  check(render('PASS, and the tick') === buttons, 'and its PASS brings the buttons back at the tick');

  console.log('');
  console.log('=== the three bursts (Attack.cpp:985-1025) ===');
  // Graphic 14 is the 96x45 burst, drawn off-centre in it so that it centres on x=274,
  // where the digits are (`D5W = 274`, Attack.cpp:1027). The two smaller ones are it
  // shrunk to 64x37 and 42x37, so they centre there too and their rectangle's edge cuts
  // none of them; a crop of the big one instead would sit right of 274 and be cut.
  const g230 = ui.uiTables.graphic230;
  for (const [value, rect, name] of [
    [50, g230.wRectPos20202, 'wRectPos20202'],
    [20, g230.wRectPos20226, 'wRectPos20226'],
    [9, g230.wRectPos20234, 'wRectPos20234'],
  ] as const) {
    const screen = createPaletteIndexViewportBuffer(320, 200, 7);
    ui.screenIndexBuffer = screen;
    ui.ctx.interface.attackingCharacterOrdinal = 0;
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
  console.log("=== CAN'T REACH and NEED AMMO, centred on x 272 (Attack.cpp:972-980) ===");
  // `TextOutToScreen_Centered` takes five pixels a character (CSBCode.cpp:1791), so the
  // texts start at 272 - 55 / 2 = 245 and 272 - 45 / 2 = 250, where the original's were
  // at 242 and 248. Both texts' first letters light their left column.
  for (const [value, left] of [[-1, 245], [-2, 250]] as const) {
    const screen = createPaletteIndexViewportBuffer(320, 200, 7);
    ui.screenIndexBuffer = screen;
    ui.ctx.interface.attackingCharacterOrdinal = 0;
    ui.attackFlashValue = value;
    drawAttackPanel(ui);
    let x1 = 320;
    for (let y = panel.y1; y <= panel.y2; y++) {
      for (let x = panel.x1; x <= panel.x2; x++) {
        if (screen.pixels[y * 320 + x] === 4) x1 = Math.min(x1, x);
      }
    }
    console.log(`damage ${value}\ttext from x ${x1}`);
    check(x1 === left, `damage ${value}: the text starts at x ${left}`);
  }
  ui.attackFlashValue = 0;

  console.log('');
  console.log('=== the flinch, with a candidate at the mirror (CSBCode.cpp:8913-8942) ===');
  const champ = party.state.champions[0]!;
  party.state.cursorOwner = -1;
  const flinch = (label: string): void => console.log([label, `facing ${champ.facing}`,
    `from ${champ.damageFromDirection}`, `maxRecentDamage ${champ.maxRecentDamage}`,
    `ordinal ${ui.ctx.interface.attackingCharacterOrdinal}`].join('\t'));
  const facing = champ.facing;
  champ.damageFromDirection = (facing + 2) & 3;
  champ.maxRecentDamage = 12;
  party.state.potentialChampionIndex = 1;
  prepareAttack(ui, 0);
  tag01b29a(ui.ctx);
  flinch('candidate, menu open: tick');
  check(ui.ctx.interface.attackingCharacterOrdinal === 0, 'the tick closes the menu (TAG01b1c0)');
  check(champ.facing === facing && champ.maxRecentDamage === 12, 'and nobody turns');
  tag01b29a(ui.ctx);
  flinch('candidate: tick');
  check(champ.facing === facing && champ.maxRecentDamage === 12,
    'while the candidate stands, nobody turns, and the damage is kept');
  render('candidate: the panel, its buttons shaded');
  check(ui.ctx.interface.word20250 === 0 && ui.ctx.interface.word20252 === 1, 'but the buttons are drawn again (CSBCode.cpp:8954-8958)');
  party.state.potentialChampionIndex = -1;
  tag01b29a(ui.ctx);
  flinch('candidate gone: tick');
  check(champ.facing === champ.damageFromDirection && champ.maxRecentDamage === 0,
    'the first tick after it, the champion turns to the blow');

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
