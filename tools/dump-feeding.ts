/**
 * Eating and drinking: what every potion is worth, and what applying it does.
 *
 * `_FeedCharacter` (`doc/CSBwin-src/Character.cpp:4020-4497`) is two halves that never
 * touch: it derives a `FEEDPARAMETERS` block from the object on the cursor, then
 * applies the block. This drives both halves against the **real potion records in
 * `dungeon.dat`**, so the strengths in the table below are the ones the shipped dungeon
 * actually contains.
 *
 * What to look for: a Ku potion raises Current strength and leaves Maximum alone (which
 * is what makes the stats line green, not red); a Vi potion heals in proportion to
 * MaxHP; an Ee potion past the mana ceiling keeps only half the excess; a Ya potion
 * arms a TT_72 that takes the shield back off.
 *
 * Run: `npx tsx tools/dump-feeding.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PotionType } from '../src/core/constants';
import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import {
  AttributeIndex,
  attributeCurrent,
  attributeMaximum,
  makeAddCharacterAttributes,
} from '../src/engine/attributes';
import { clearFeedParameters, derivePotionFeeding } from '../src/engine/Feeding';
import { TimerFunction } from '../src/engine/TimerQueue';
import type { Champion } from '../src/engine/gameTypes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, finish } from './lib/check';

const POTION_NAMES: Record<number, string> = {
  [PotionType.ROS_POTION]: 'ROS (dexterity)',
  [PotionType.KU_POTION]: 'KU (strength)',
  [PotionType.DANE_POTION]: 'DANE (wisdom)',
  [PotionType.NETA_POTION]: 'NETA (vitality)',
  [PotionType.ANTI_VENIN]: 'ANTI-VENIN',
  [PotionType.MON_POTION_B]: 'MON (stamina)',
  [PotionType.YA_POTION]: 'YA (shield)',
  [PotionType.EE_POTION]: 'EE (mana)',
  [PotionType.VI_POTION]: 'VI (healing)',
  [PotionType.WATER_FLASK]: 'WATER FLASK',
};

function champion(name: string): Champion {
  return {
    name,
    attributes: {
      health: 100, maxHealth: 200, stamina: 40, maxStamina: 100, mana: 20, maxMana: 60,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1000, water: 1000,
    skills: [], weaponHand: null, shieldHand: null, quiver: null,
    possessions: new Array(30).fill(null),
    partyPosition: 0,
  };
}

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

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
  game.addChampion(champion('DRINKER'));
  game.party.state.position = new Position(6, 14, 2);
  return game;
}

/** The strength of every potion of a given type actually present in `dungeon.dat`. */
function realPotionStrengths(game: Game): Map<number, number[]> {
  const byType = new Map<number, number[]>();
  const records = game.dungeonState.getData().databases.potions.records;
  for (const rec of records) {
    const type = rec.potionType | 0;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(rec.power | 0);
  }
  for (const list of byType.values()) list.sort((a, b) => a - b);
  return byType;
}

function main(): void {
  const probe = makeGame();
  const strengths = realPotionStrengths(probe);

  /* ------------------------------------------- 1. what each potion is worth ----- */

  console.log('=== derivePotionFeeding, over the strengths in dungeon.dat ===');
  console.log(['potion', 'strength', 'effect'].join('\t'));

  let described = 0;
  for (const [type, name] of Object.entries(POTION_NAMES)) {
    const potionType = Number(type);
    const list = strengths.get(potionType);
    if (!list || list.length === 0) continue;
    const strength = list[Math.floor(list.length / 2)]!;
    const g = makeGame();
    const champ = g.party.state.champions[0]!;
    const fp = clearFeedParameters();
    derivePotionFeeding(fp, champ, potionType, strength);

    const parts: string[] = [];
    if (fp.strengthAdjust) parts.push(`strength +${fp.strengthAdjust}`);
    if (fp.dexterityAdjust) parts.push(`dexterity +${fp.dexterityAdjust}`);
    if (fp.wisdomAdjust) parts.push(`wisdom +${fp.wisdomAdjust}`);
    if (fp.vitalityAdjust) parts.push(`vitality +${fp.vitalityAdjust}`);
    if (fp.antiVenin) parts.push('cures poison');
    if (fp.staminaAdjust) parts.push(`stamina +${fp.staminaAdjust}`);
    if (fp.shieldStrengthAdjust) parts.push(`shield +${fp.shieldStrengthAdjust} for ${fp.shieldDuration} ticks`);
    if (fp.manaAdjust) parts.push(`mana +${fp.manaAdjust}`);
    if (fp.hitpointAdjust) parts.push(`health +${fp.hitpointAdjust}, heals ${fp.healCount}`);
    if (fp.waterValue) parts.push(`water +${fp.waterValue}`);
    console.log([name, strength, parts.join(', ') || '(nothing)'].join('\t'));

    check(fp.performFeeding, `${name} is a potion the game acts on`);
    check(fp.emptyFlask, `${name} leaves an empty flask`);
    described++;
  }
  check(described >= 8, `the shipped dungeon carries most potion types (found ${described})`);

  // The shipped dungeon holds no Mon or Ee potion *records* — both are only ever
  // conjured by their spells — so their derivation gets synthetic strengths rather
  // than going untested.
  console.log('');
  console.log('(no MON or EE potion exists in dungeon.dat; both come from spells)');
  console.log(['potion', 'strength', 'effect'].join('\t'));
  {
    const g = makeGame();
    const champ = g.party.state.champions[0]!;
    const mon = clearFeedParameters();
    derivePotionFeeding(mon, champ, PotionType.MON_POTION_B, 150);
    console.log(['MON (stamina)', 150, `stamina +${mon.staminaAdjust}`].join('\t'));
    check(mon.performFeeding, 'a Mon potion is acted on');
    // The champion is at 40/100 stamina, so the gain is capped by the 60 missing.
    check(mon.staminaAdjust > 0 && mon.staminaAdjust <= 60, 'a Mon potion never overfills stamina');

    const ee = clearFeedParameters();
    derivePotionFeeding(ee, champ, PotionType.EE_POTION, 150);
    console.log(['EE (mana)', 150, `mana +${ee.manaAdjust}`].join('\t'));
    check(ee.performFeeding, 'an Ee potion is acted on');
    check(ee.manaAdjust > 0, 'an Ee potion restores mana');
  }

  // An empty flask is a potion with no case of its own: nothing happens to the
  // champion, but the mouth still accepts and empties it.
  {
    const g = makeGame();
    const champ = g.party.state.champions[0]!;
    const fp = clearFeedParameters();
    derivePotionFeeding(fp, champ, PotionType.EMPTY_FLASK, 0);
    check(!fp.performFeeding, 'an empty flask does nothing on its own');
    check(fp.emptyFlask, 'though every potion branch sets emptyFlask');
  }

  /* ------------------------------------------- 2. the attribute potions --------- */

  console.log('');
  console.log('=== a Ku potion raises Current, not Maximum ===');

  {
    const g = makeGame();
    const champ = g.party.state.champions[0]!;
    const attr = champ.attributes.stats[AttributeIndex.Strength]!;
    const before = { cur: attributeCurrent(attr), max: attributeMaximum(attr) };
    const fp = clearFeedParameters();
    fp.characterIndex = 0;
    derivePotionFeeding(fp, champ, PotionType.KU_POTION, 140);
    const applied = g.applyFeeding(0, fp);
    const after = { cur: attributeCurrent(attr), max: attributeMaximum(attr) };
    console.log(`strength ${before.cur}/${before.max} -> ${after.cur}/${after.max}`);

    check(applied, 'the potion was applied');
    // 140/35 + 5 = 9, and 60 is below the 120 tax line, so all nine land.
    check(after.cur === before.cur + 9, `Current rose by 9 (got ${after.cur - before.cur})`);
    check(after.max === before.max, 'Maximum did not move');
    check(after.cur > after.max, 'so Current now sits above Maximum, which colours the line green');
  }

  /* ------------------------------------------- 3. healing and mana -------------- */

  console.log('');
  console.log('=== Vi and Ee potions ===');
  console.log(['potion', 'before', 'after'].join('\t'));

  {
    const g = makeGame();
    const champ = g.party.state.champions[0]!;
    champ.wounds = 0xffff;
    const fp = clearFeedParameters();
    fp.characterIndex = 0;
    derivePotionFeeding(fp, champ, PotionType.VI_POTION, 200);
    const before = champ.attributes.health;
    g.applyFeeding(0, fp);
    console.log(['VI (healing)', `${before} hp, wounds ffff`,
      `${champ.attributes.health} hp, wounds ${(champ.wounds ?? 0).toString(16)}`].join('\t'));
    check(champ.attributes.health > before, 'a Vi potion restores health');
    check(champ.attributes.health <= champ.attributes.maxHealth, 'and never past MaxHP');
    check((champ.wounds ?? 0) !== 0xffff, 'and clears some wounds');
  }

  {
    // Mana already at the ceiling: only half the excess is kept.
    const g = makeGame();
    const champ = g.party.state.champions[0]!;
    champ.attributes.mana = champ.attributes.maxMana;
    const fp = clearFeedParameters();
    fp.characterIndex = 0;
    derivePotionFeeding(fp, champ, PotionType.EE_POTION, 200);
    const before = champ.attributes.mana;
    g.applyFeeding(0, fp);
    console.log(['EE (mana), full', `${before} mana`, `${champ.attributes.mana} mana`].join('\t'));
    const w12 = Math.trunc(200 / 25) + 8;
    const raw = before + w12 + w12 - 8;
    check(champ.attributes.mana > before, 'an Ee potion still helps at the ceiling');
    check(champ.attributes.mana < raw, 'but only half the excess above MaxMana is kept');
  }

  /* ------------------------------------------- 4. the Ya potion timer ----------- */

  console.log('');
  console.log('=== a Ya potion arms a TT_72 that takes the shield back off ===');

  {
    const g = makeGame();
    const champ = g.party.state.champions[0]!;
    const fp = clearFeedParameters();
    fp.characterIndex = 0;
    derivePotionFeeding(fp, champ, PotionType.YA_POTION, 150);
    g.applyFeeding(0, fp);
    const raised = champ.shieldStrength ?? 0;
    const timers = g.timerQueue.getTimers().filter((t) => t.function === TimerFunction.TT_72);
    console.log(`shield ${raised}, expires in ${fp.shieldDuration} ticks, ${timers.length} TT_72 queued`);

    check(raised === fp.shieldStrengthAdjust, 'the shield went up by the derived amount');
    check(timers.length === 1, 'one TT_72 is queued');
    check(fp.shieldDuration > 0, 'with a real duration');

    for (let t = 0; t <= fp.shieldDuration + 1; t++) {
      (g as unknown as { state: { tickCount: number } }).state.tickCount = t;
      g.timerSystem.processTimers(t);
    }
    console.log(`after ${fp.shieldDuration + 1} ticks: shield ${champ.shieldStrength}`);
    check((champ.shieldStrength ?? 0) === 0, `the shield expired back to 0 (got ${champ.shieldStrength})`);
  }

  /* ------------------------------------------- 5. anti-venin ------------------- */

  console.log('');
  console.log('=== anti-venin cancels the poison chain ===');

  {
    const g = makeGame();
    const champ = g.party.state.champions[0]!;
    g.monsterAttack.poisonCharacter(0, 200);
    const poisonedHealth = champ.attributes.health;
    const before = g.timerQueue.getTimers().filter((t) => t.function === TimerFunction.TT_75).length;
    const fp = clearFeedParameters();
    fp.characterIndex = 0;
    derivePotionFeeding(fp, champ, PotionType.ANTI_VENIN, 100);
    g.applyFeeding(0, fp);
    const after = g.timerQueue.getTimers().filter((t) => t.function === TimerFunction.TT_75).length;
    console.log(`TT_75 timers ${before} -> ${after}, poisonCount ${champ.poisonCount}`);
    check(before === 1, 'the champion was poisoned first');
    check(after === 0, 'anti-venin deleted the pending poison timer');
    check((champ.poisonCount ?? 0) === 0, 'and cleared the count');
    check(champ.attributes.health === poisonedHealth, 'anti-venin heals nothing itself');
  }

  /* ------------------------------------------- 6. a lethal potion --------------- */

  console.log('');
  console.log('=== a hit-point adjustment that would kill goes through KillCharacter ===');

  {
    const g = makeGame();
    g.addChampion(champion('SPARE'));
    const champ = g.party.state.champions[0]!;
    champ.attributes.health = 5;
    const fp = clearFeedParameters();
    fp.characterIndex = 0;
    fp.performFeeding = true;
    fp.hitpointAdjust = -10;
    g.applyFeeding(0, fp);
    console.log(`health 5 with a -10 adjustment: alive=${champ.alive}, health=${champ.attributes.health}`);
    check(champ.alive === false, 'the champion died');
    check(champ.attributes.health === 0, 'and is at zero health');
  }

  {
    // An unconfirmed champion in a mirror takes none of it.
    const g = makeGame();
    const champ = g.party.state.champions[0]!;
    g.party.state.potentialChampionIndex = 0;
    champ.attributes.health = 5;
    const fp = clearFeedParameters();
    fp.characterIndex = 0;
    fp.performFeeding = true;
    fp.hitpointAdjust = -10;
    fp.manaAdjust = 10;
    fp.foodValue = 500;
    g.applyFeeding(0, fp);
    check(champ.alive !== false, 'a champion still in a mirror cannot be killed by a potion');
    check(champ.attributes.mana === 20, 'and takes no mana from it');
    check(champ.food === 1500, 'but food and water still apply');
  }

  /* ------------------------------------------- 7. food and water clamps --------- */

  console.log('');
  console.log('=== food and water clamp to CSBWin LIMIT(-1023, .., 2048) ===');
  console.log(['before', 'delta', 'after'].join('\t'));

  {
    const g = makeGame();
    const champ = g.party.state.champions[0]!;
    const fp = clearFeedParameters();
    fp.characterIndex = 0;
    fp.performFeeding = true;
    fp.foodValue = 5000;
    fp.waterValue = 5000;
    g.applyFeeding(0, fp);
    console.log([1000, 5000, `food ${champ.food}, water ${champ.water}`].join('\t'));
    check(champ.food === 2048, 'food tops out at 2048');
    check(champ.water === 2048, 'water tops out at 2048');
  }

  console.log('');
  finish();
}

main();
