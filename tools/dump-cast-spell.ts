/**
 * Prove `CastSpell` honours a spell filter's overrides where CSBWin does, and only there.
 *
 * A DSA spell filter (`DsaSystem.processSpellFilter`) can rewrite the `SPELL_PARAMETERS`
 * `CastSpell` receives (`doc/CSBwin-src/Magic.cpp:1090`). No dungeon this port loads defines
 * one, so this calls `Game.castSpell` with the parameters directly:
 *
 * - the difficulty is `D4W = pSpell->skillRequired + spellPower` — the spell's own skill,
 *   not the filter's — while the filter's `skillRequired` feeds only the experience's
 *   middle term `8 * (spellPower - 1) * skillRequired` (`:1199-1211`);
 * - a filter's `missileType` replaces `BITS4_9(pSpell->word6)` (`:1201-1205`), so it
 *   changes what a class-3 spell does;
 * - `action` is handled first, before `chIdx >= d.NumCharacter` and `HP() == 0`
 *   (`:1110-1153`): a filter's abort message prints for a dead caster, and an action with
 *   no message (8) casts normally.
 *
 * Run: `npx tsx tools/dump-cast-spell.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import type { SpellParameters } from '../src/engine/magicTypes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, finish } from './lib/check';
import { emptyPossessions } from '../src/engine/gameTypes';

/** Rune 0x69 alone: class 3, missile type 5, skill 1, `byte5` 16 in the Atari table. */
const SPELL_RUNE = 0x69;
/** Power rune 0x61: `spellPower = 0x61 - 95 = 2`, so the middle term is not zero. */
const POWER_RUNE = 0x61;

function champion(i: number): Champion {
  // Wizard base (3) and subskill 16 at 2000 each: mastery 3, enough for D4W = 1 + 2.
  const skills = Array.from({ length: 20 }, () => ({ experience: 0, tempAdjust: 0 }));
  skills[3].experience = 2000;
  skills[16].experience = 2000;
  return {
    name: `HERO${i}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills,
    possessions: emptyPossessions(),
    partyPosition: i,
  } as unknown as Champion;
}

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

  const printed: string[] = [];
  const game = new Game(
    data,
    {
      roomTimerFunctions: uiTables.graphic232.byte1596,
      monsterDesc: objectTables.monsterDesc,
      objDescObjectType: objectTables.objDescObjectType,
      messages: {
        printLinefeed: () => {},
        quePrintLines: (_color, text) => { printed.push(text); },
      },
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
      byte586: uiTables.graphic232.byte586,
      clothingArmour: objectTables.clothingArmour,
      clothingFlags: objectTables.clothingFlags,
    },
  );
  game.setSpellDefinitions(uiTables.graphic230.spells);
  game.party.state.position = new Position(2, 2, 0);

  type Internals = {
    castSpell(chIdx: number, p: SpellParameters): number;
    fillSpellParameters(chIdx: number, incantation: number[], party: unknown): SpellParameters;
  };
  const internals = game as unknown as Internals;

  /** One cast from a fresh party with the same seed, under `overrides`. */
  const cast = (overrides: Partial<SpellParameters>, setup?: (c: Champion) => void) => {
    game.setRandomSeed(0x12345678);
    game.party.state.champions = [champion(0)];
    game.party.state.seeThruWalls = 0;
    const c = game.party.state.champions[0];
    c.incantation = [POWER_RUNE, SPELL_RUNE];
    setup?.(c);
    printed.length = 0;
    const params = { ...internals.fillSpellParameters(0, c.incantation, game.party.state), ...overrides };
    const result = internals.castSpell(0, params);
    const skills = c.skills as unknown as Array<{ experience: number }>;
    return {
      result,
      experience: skills[16].experience - 2000,
      seeThruWalls: game.party.state.seeThruWalls,
      printed: printed.join(' '),
    };
  };

  const plain = cast({});
  const hardSkill = cast({ skillRequired: 60 });
  const seeThru = cast({ missileType: 2 });
  const deadAbort = cast({ action: 3 }, (c) => { c.attributes.health = 0; });
  const silentAbort = cast({ action: 1 });
  const unknownAction = cast({ action: 8 });

  const row = (label: string, r: ReturnType<typeof cast>): void =>
    console.log(`${label.padEnd(28)} result ${r.result}  exp +${r.experience}  seeThru ${r.seeThruWalls}  printed ${JSON.stringify(r.printed)}`);
  row('unfiltered', plain);
  row('skillRequired 60', hardSkill);
  row('missileType 2', seeThru);
  row('action 3, dead caster', deadAbort);
  row('action 1', silentAbort);
  row('action 8', unknownAction);
  console.log('');

  check(plain.result === 1, 'the unfiltered spell should succeed (mastery 3 >= D4W 3)');
  check(plain.seeThruWalls === 0, 'type 5 is not see-through-walls');
  check(hardSkill.result === 1,
    "a filter's skillRequired should not make the spell harder: D4W is the spell's own skill + power");
  // Same seed, same `STRandom() & 7`, same D4W: only `8 * (spellPower - 1) * skillRequired`
  // differs, by 8 * 1 * (60 - 1). AdjustSkills adds it unscaled on level 0.
  check(hardSkill.experience - plain.experience === 8 * 1 * (60 - 1),
    `a filter's skillRequired should enter only the experience's middle term (+${hardSkill.experience} vs +${plain.experience})`);
  check(seeThru.result === 1 && seeThru.seeThruWalls === 1,
    "a filter's missileType 2 should make the class-3 spell see-through-walls");
  check(deadAbort.result === 0 && deadAbort.printed === 'THE SPELL FIZZLES.',
    `a filter's abort should print for a dead caster, as CSBWin checks the action first (${JSON.stringify(deadAbort.printed)})`);
  check(silentAbort.result === 0 && silentAbort.printed === '', 'action 1 should abort silently');
  check(unknownAction.result === 1, 'an action with no message (8) should cast normally');

  finish();
}

main();
