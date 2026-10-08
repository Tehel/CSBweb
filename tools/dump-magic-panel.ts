/**
 * The spell panel's clicks (`src/renderer/ui/MagicPanel.ts`), against CSBWin's
 * `_HandleMagicClick`, `_MagicSelection`, `TAG01b990`, `BackspaceMagicSelection` and
 * `CastMagic`.
 *
 * 1. The cost of a rune after the first is `(base * Byte19016[first - 96]) >> 3`
 *    (`doc/CSBwin-src/CSBCode.cpp:9078-9084`): a product with a remainder costs the
 *    truncated whole, never a fraction of a point of mana.
 * 2. The caster tabs are hit-tested by `_HandleMagicClick`'s fixed x ranges for each caster
 *    (`doc/CSBwin-src/Magic.cpp:599-702`); the gaps between tabs, and the caster's own tab,
 *    pick nobody; `clickX` 512-515 name a champion; `SelectMagicCaster` refuses a dead one
 *    (`:727`), and a click past the last champion does nothing (`:695`).
 * 3. The cast button acts whenever `incantation[0]` is not zero (`:559-570`), and
 *    `CastMagic` clears the runes unless `CastSpell` returned 3 (`:952-958`).
 * 4. The two deliberate divergences (`DEBT.md` → H): a fifth rune is refused, and a champion
 *    with no mana has no tab to click.
 * 5. Where the runes and the incantation are drawn: `DrawSpellMenuCharacters` from
 *    `D6W = 225` at `D6W += 14`, y 58 (`doc/CSBwin-src/CSBCode.cpp:9051-9065`), and
 *    `DisplayMagicSelection` from `D6W = 232` at `D6W += 9`, y 70
 *    (`doc/CSBwin-src/Magic.cpp:779-799`), a glyph starting at the pen.
 *
 * Run: `npx tsx tools/dump-magic-panel.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { emptyPossessions, type Champion } from '../src/engine/gameTypes';
import { ensureSkills } from '../src/engine/skills';
import { createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import { drawTextLineIndexRaw, loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { drawMagicIncantation, drawSpellMenuCharacters, handleMagicClick } from '../src/renderer/ui/MagicPanel';
import { graphicsTablesOf, newGame } from './lib/game';
import { newUIState } from './lib/ui';
import { wrapMember } from './lib/standIn';
import { check, finish } from './lib/check';

function champion(name: string): Champion {
  return {
    ...addCharacterDefaults(),
    name,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 90, maxMana: 90,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    incantation: [], food: 1500, water: 1500,
    // Every skill mastered, so no cast fails on the dice.
    skills: ensureSkills([]).map((skill) => ({ ...skill, experience: 1 << 24 })),
    possessions: emptyPossessions(),
    partyPosition: 0,
  };
}

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const uiTables = graphicsTablesOf(graphics).ui;
  const base = uiTables.graphic230.spellBaseMana;
  const scale = uiTables.graphic230.spellFirstRuneScale;

  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  const party = game.ctx.party.state;
  const ui = newUIState(graphics, game.ctx);
  ui.partyState = party;
  // The engine's `CastMagic`, the UI's call, wrapped to read its result.
  const magic = game.systems.magic;
  let castResult = -99;
  wrapMember(magic, 'castSpellFromUi', (cast) => (chIdx) => (castResult = cast(chIdx)));

  const reset = (count: number): void => {
    party.champions = ['ALEX', 'BORIS', 'CHANI', 'DARIA'].slice(0, count).map(champion);
    party.magicCasterIndex = 0;
    castResult = -99;
  };
  const button = (id: number): void => {
    const b = uiTables.graphic231.buttons.buttons18060.find((entry) => entry.word0 === id);
    if (!b) throw new Error(`no magic button ${id}`);
    handleMagicClick(ui, (b.x1 + b.x2) >> 1, (b.y1 + b.y2) >> 1);
    // `_MagicSelection` holds the loop for its flashes (`magicSelectionScript`): its VBLs
    // go by, as they would before the player's next click.
    while (game.isRunningScript()) game.runFrame();
  };
  const runes = (): string => party.champions[party.magicCasterIndex]!.incantation.map((c) => c.toString(16)).join(',');

  // ---- 1. The second rune's cost, truncated.
  console.log('first\tsecond\tbase\tscale\tspent\texpected');
  let remainders = 0;
  for (let first = 0; first < 6; first++) {
    for (let second = 0; second < 6; second++) {
      reset(1);
      const caster = party.champions[0]!;
      button(101 + first);
      const before = caster.attributes.mana;
      button(101 + second);
      const spent = before - caster.attributes.mana;
      const expected = (base[6 + second]! * scale[first]!) >> 3;
      if ((base[6 + second]! * scale[first]!) % 8 !== 0) remainders++;
      console.log([first, second, base[6 + second], scale[first], spent, expected].join('\t'));
      check(spent === expected, `rune ${second} after rune ${first} costs ${expected}, got ${spent}`);
      check(runes() === `${(96 + first).toString(16)},${(102 + second).toString(16)}`,
        `rune ${second} after rune ${first} is the second rune`);
    }
  }
  check(remainders > 0, 'at least one second-rune cost has a remainder to truncate');

  // ---- 2. The caster tabs.
  // Each champion's tab as `DrawSpellControls` draws it with `caster` casting
  // (`doc/CSBwin-src/Character.cpp:5027-5110`).
  const tab = (caster: number, box: number): [number, number] =>
    box === caster ? [233 + 14 * box, 277 + 14 * box]
      : box < caster ? [233 + 14 * box, 244 + 14 * box] : [266 + 14 * box, 277 + 14 * box];
  const clickAt = (caster: number, x: number, y = 45): number => {
    party.magicCasterIndex = caster;
    handleMagicClick(ui, x, y);
    return party.magicCasterIndex;
  };
  console.log('\ncaster\tpicked by x in 233..319 (. for none)');
  reset(4);
  for (let caster = 0; caster < 4; caster++) {
    let line = '';
    for (let x = 233; x <= 319; x++) {
      const got = clickAt(caster, x);
      line += got === caster ? '.' : String(got);
      const box = [0, 1, 2, 3].find((b) => b !== caster && x >= tab(caster, b)[0] && x <= tab(caster, b)[1]);
      check(got === (box ?? caster), `caster ${caster}: x ${x} picks ${box ?? 'nobody'}, got ${got}`);
    }
    console.log(`${caster}\t${line}`);
    for (let box = 0; box < 4; box++) {
      check(clickAt(caster, 512 + box) === box, `caster ${caster}: clickX ${512 + box} picks champion ${box}`);
    }
    // Below the tabs is the keypad, never a tab.
    const [x1] = tab(caster, (caster + 1) & 3);
    check(clickAt(caster, x1 + 1, 49) === caster, `caster ${caster}: y 49 under a tab picks nobody`);
  }
  reset(2);
  check(clickAt(0, tab(0, 3)[0] + 1) === 0, 'a tab past the last champion picks nobody');
  reset(4);
  party.champions[2]!.attributes.health = 0;
  check(clickAt(0, tab(0, 2)[0] + 1) === 0, 'SelectMagicCaster refuses a dead champion');

  // ---- 3. The cast button.
  const cast = (runeIds: number[]): { result: number; left: string } => {
    reset(1);
    for (const id of runeIds) button(id);
    button(108);
    return { result: castResult, left: runes() };
  };
  const none = cast([]);
  check(none.result === -99, 'the cast button with no rune casts nothing');
  const lo = cast([101]);
  const loFul = cast([101, 101 + 3]);
  const loVi = cast([101, 101 + 1]);
  console.log(`\nLO: ${lo.result} [${lo.left}]  LO FUL: ${loFul.result} [${loFul.left}]  LO VI: ${loVi.result} [${loVi.left}]`);
  check(lo.result === 0 && lo.left === '', 'a lone power rune is cast, names no spell, and is cleared');
  check(loFul.result === 1 && loFul.left === '', 'LO FUL is cast and cleared');
  check(loVi.result === 3 && loVi.left === '60,67', 'LO VI with no flask is CastSpell\'s 3, and the runes stay');

  // ---- 4. Backspace, and the fifth rune (`DEBT.md` → H, "A fifth rune is refused").
  reset(1);
  const caster = party.champions[0]!;
  for (const id of [101, 102, 103, 104]) button(id);
  const full = runes();
  const manaAtFour = caster.attributes.mana;
  button(105);
  check(runes() === full && caster.attributes.mana === manaAtFour,
    `a fifth rune is refused and costs nothing (${full}, ${manaAtFour})`);
  button(107);
  check(runes() === full.split(',').slice(0, 3).join(',') && caster.attributes.mana === manaAtFour,
    'backspace takes the fourth rune back, and not its mana');
  button(107);
  button(107);
  button(107);
  button(107);
  check(runes() === '', 'backspace empties the incantation, and stops there');

  // Not enough mana: the rune is refused whole.
  reset(1);
  party.champions[0]!.attributes.mana = base[0]! - 1;
  button(101);
  check(runes() === '' && party.champions[0]!.attributes.mana === base[0]! - 1, 'a rune dearer than the mana is refused');

  // No tab without mana (`DEBT.md` → H, "No caster tab without mana").
  reset(4);
  party.champions[1]!.attributes.mana = 0;
  party.champions[1]!.attributes.maxMana = 0;
  check(clickAt(0, tab(0, 1)[0] + 1) === 0, 'a champion with no mana cannot be picked');
  check(clickAt(0, 513) === 0, 'not by clickX 513 either');

  // ---- 5. The runes and the incantation, against glyphs drawn at CSBWin's own pens.
  const font = loadFontData(graphics);
  const drawn = createPaletteIndexViewportBuffer(320, 200, 12);
  const expected = createPaletteIndexViewportBuffer(320, 200, 12);
  ui.screenIndexBuffer = drawn;
  const incantation = [0x60, 0x67, 0x6e];
  drawSpellMenuCharacters(ui, incantation.length);
  drawMagicIncantation(ui, incantation);
  for (let i = 0, x = 225; i < 6; i++) {
    drawTextLineIndexRaw(expected, font, (x += 14), 58, 4, 0, String.fromCharCode(96 + 6 * 3 + i));
  }
  for (let i = 0, x = 232; i < 4; i++) {
    drawTextLineIndexRaw(expected, font, (x += 9), 70, 4, 0, i < incantation.length ? String.fromCharCode(incantation[i]!) : ' ');
  }
  let off = 0;
  for (let p = 0; p < drawn.pixels.length; p++) if (drawn.pixels[p] !== expected.pixels[p]) off++;
  console.log(`runes at 239+14i, incantation at 241+9i: ${off} pixels off`);
  check(off === 0, `the runes and the incantation should sit at CSBWin's pens (${off} pixels off)`);

  finish();
}

main();
