/**
 * The `ATTRIBUTE` triple: (maximum, current, minimum) per attribute.
 *
 * Nothing here shows on a golden frame except one line of colour in the stats panel,
 * yet the triple is what the whole champion lifecycle is built on — so this tool
 * stands the real rules up against `doc/CSBwin-src`:
 *
 *   1. the byte semantics (`doc/CSBwin-src/data.cpp:1698-1744`) — setters wrap,
 *      getters read anything above 240 as zero;
 *   2. `AddCharacter`'s initial values from the real Hall of Champions mirrors
 *      (`doc/CSBwin-src/Character.cpp:641-660`) — minimum 30, 10 for Luck, cap 224,
 *      Maximum == Current;
 *   3. `LevelUp` raising **Maximum** and leaving Current behind
 *      (`doc/CSBwin-src/Magic.cpp:101-151`) — the bug this triple was added to fix;
 *   4. `AdjustCurrentAttribute`'s lopsided curve
 *      (`doc/CSBwin-src/Character.cpp:3917-3951`) — taxed gains, a 170 ceiling, and a
 *      loss that stops at the attribute's own Minimum;
 *   5. `IsCharacterLucky` spending luck inside Minimum..Maximum
 *      (`doc/CSBwin-src/Character.cpp:2199`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../src/engine/AddCharacter';
import {
  ADD_CHARACTER_ATTRIBUTE_CAP,
  ADD_CHARACTER_ATTRIBUTE_MINIMUM,
  ADD_CHARACTER_LUCK_MINIMUM,
  ATTRIBUTE_COUNT,
  AttributeIndex,
  adjustCurrentAttribute,
  attributeCurrent,
  attributeMaximum,
  attributeMinimum,
  incrAttributeMinimum,
  makeAddCharacterAttributes,
  makeAttribute,
  setAttributeCurrentWithinLimits,
} from '../src/engine/attributes';
import { CsbRandom } from '../src/core/random';
import { levelUp } from '../src/engine/skills';
import type { Champion } from '../src/engine/gameTypes';
import { check, finish } from './lib/check';
import { presetHeroesOf, stockGraphics } from './lib/game';

const NAMES = ['LUCK', 'STRENGTH', 'DEXTERITY', 'WISDOM', 'VITALITY', 'ANTI-MAGIC', 'ANTI-FIRE'];

function row(label: string, cells: (string | number)[]): void {
  console.log(`${label.padEnd(22)}\t${cells.join('\t')}`);
}

function main(): void {
  /* ------------------------------------------------- 1. byte semantics ---------- */

  console.log('=== ATTRIBUTE byte semantics (doc/CSBwin-src/data.cpp:1713-1744) ===');
  console.log(['stored', 'reads as', 'note'].join('\t'));

  const boundaries: [number, string][] = [
    [0, 'zero'],
    [240, 'the last value read literally'],
    [241, 'first value read as negative'],
    [255, 'minus one'],
  ];
  for (const [stored, note] of boundaries) {
    const attr = makeAttribute(stored, stored, stored);
    console.log([stored, attributeCurrent(attr), note].join('\t'));
  }
  check(attributeCurrent(makeAttribute(0, 240, 0)) === 240, '240 reads back as 240');
  check(attributeCurrent(makeAttribute(0, 241, 0)) === 0, '241 reads back as 0 (it went negative)');
  check(attributeCurrent(makeAttribute(0, 255, 0)) === 0, '255 reads back as 0');

  // Four cursed objects take the Luck minimum of 10 to -2, which CSBWin stores as 254
  // and reads back as 0. This is the exact case its comment describes.
  const cursed = makeAddCharacterAttributes([50, 50, 50, 50, 50, 50, 50])[AttributeIndex.Luck];
  for (let i = 0; i < 4; i++) incrAttributeMinimum(cursed, -3);
  check(cursed.minimum === 254, `four cursed objects wrap the Luck minimum to 254 (got ${cursed.minimum})`);
  check(attributeMinimum(cursed) === 0, 'and it reads back as 0, not 254');

  /* ------------------------------------------------- 2. AddCharacter ------------ */

  console.log('');
  console.log('=== AddCharacter, from the real Hall of Champions mirrors ===');

  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const heroes = presetHeroesOf(data, stockGraphics());
  check(heroes.length > 0, `the dungeon defines preset heroes (got ${heroes.length})`);

  const tables = { carryLocation: new Array(16).fill(0), objDescWord4: new Array(256).fill(0) };
  console.log(['hero', ...NAMES.map((n) => n.slice(0, 4))].join('\t'));
  for (const hero of heroes.slice(0, 6)) {
    const champ = createChampionFromPreset(hero, 0, assignPresetHeroPossessions(hero.inventory, tables));
    const cells = champ.attributes.stats.map(
      (a) => `${attributeCurrent(a)}/${attributeMaximum(a)}/${attributeMinimum(a)}`,
    );
    row(hero.name, cells);
  }

  const sample = createChampionFromPreset(heroes[0], 0, []);
  check(sample.attributes.stats.length === ATTRIBUTE_COUNT, 'a new champion has seven attributes');
  for (let i = 0; i < ATTRIBUTE_COUNT; i++) {
    const attr = sample.attributes.stats[i];
    check(
      attributeCurrent(attr) === attributeMaximum(attr),
      `${NAMES[i]} starts with Current == Maximum`,
    );
    const expectedMin = i === AttributeIndex.Luck
      ? ADD_CHARACTER_LUCK_MINIMUM
      : ADD_CHARACTER_ATTRIBUTE_MINIMUM;
    check(attributeMinimum(attr) === expectedMin, `${NAMES[i]} starts with minimum ${expectedMin}`);
  }
  const capped = makeAddCharacterAttributes([250, 250, 250, 250, 250, 250, 250]);
  check(
    attributeMaximum(capped[AttributeIndex.Strength]) === ADD_CHARACTER_ATTRIBUTE_CAP,
    `a mirror value above 224 is capped at ${ADD_CHARACTER_ATTRIBUTE_CAP}`,
  );

  /* ------------------------------------------------- 3. LevelUp ----------------- */

  console.log('');
  console.log('=== LevelUp raises Maximum, never Current (doc/CSBwin-src/Magic.cpp:101-151) ===');
  console.log(['skill', 'attribute', 'before cur/max', 'after cur/max'].join('\t'));

  let sawARaise = false;
  const random = new CsbRandom(0x12345678);
  for (const basicSkill of [0, 1, 2, 3]) {
    const champ: Champion = createChampionFromPreset(heroes[0], 0, []);
    // A champion with real skill experience, so DetermineMastery returns a live level.
    champ.skills = champ.skills.map((s) => ({ ...s, experience: 125 << 6 }));
    const before = champ.attributes.stats.map((a) => ({ ...a }));
    levelUp(champ, basicSkill, random);
    for (let i = 0; i < ATTRIBUTE_COUNT; i++) {
      const was = before[i];
      const now = champ.attributes.stats[i];
      if (was.maximum === now.maximum) continue;
      sawARaise = true;
      row(
        `${basicSkill}`,
        [NAMES[i], `${attributeCurrent(was)}/${attributeMaximum(was)}`,
          `${attributeCurrent(now)}/${attributeMaximum(now)}`],
      );
      check(
        now.current === was.current,
        `${NAMES[i]}: a level gain leaves Current alone (was ${was.current}, now ${now.current})`,
      );
      check(
        attributeMaximum(now) > attributeMaximum(was),
        `${NAMES[i]}: a level gain raises Maximum`,
      );
    }
  }
  check(sawARaise, 'at least one level gain raised an attribute maximum');

  /* ------------------------------- 4. AdjustCurrentAttribute -------------------- */

  console.log('');
  console.log('=== AdjustCurrentAttribute (doc/CSBwin-src/Character.cpp:3917-3951) ===');
  console.log(['current', 'minimum', 'adjust', 'result', 'why'].join('\t'));

  const adjustCase = (current: number, minimum: number, adjust: number, why: string): number => {
    const attr = makeAttribute(224, current, minimum);
    adjustCurrentAttribute(attr, adjust);
    const result = attributeCurrent(attr);
    console.log([current, minimum, adjust, result, why].join('\t'));
    return result;
  };

  check(adjustCase(50, 30, 20, 'a plain gain below 120 is untaxed') === 70, 'gain below 120 applies in full');
  // Above 120: 20 -> 20/2 + 1 = 11.
  check(adjustCase(130, 30, 20, 'above 120 the gain is halved, then +1') === 141, 'gain above 120 is halved');
  // Above 150: 20 -> 20/2/2 + 1 = 6.
  check(adjustCase(160, 30, 20, 'above 150 it is quartered, then +1') === 166, 'gain above 150 is quartered');
  check(adjustCase(168, 30, 20, 'the ceiling is 170') === 170, 'a gain never pushes Current past 170');
  check(adjustCase(50, 30, -40, 'a loss stops at the minimum') === 30, 'a loss stops at Minimum');
  check(adjustCase(50, 30, -10, 'a loss inside the floor applies in full') === 40, 'a loss above Minimum applies in full');
  {
    const attr = makeAttribute(224, 50, 30);
    adjustCurrentAttribute(attr, 0);
    check(attributeCurrent(attr) === 50, 'a zero adjustment changes nothing');
    check(attributeMaximum(attr) === 224, 'and never touches Maximum');
  }

  /* ------------------------------------------- 5. spending luck ----------------- */

  console.log('');
  console.log('=== IsCharacterLucky spends Luck inside Minimum..Maximum ===');
  const luckFloor = makeAttribute(60, 11, 10);
  setAttributeCurrentWithinLimits(luckFloor, attributeCurrent(luckFloor) - 2);
  check(attributeCurrent(luckFloor) === 10, `luck cannot be spent below its minimum (got ${attributeCurrent(luckFloor)})`);
  const luckCeiling = makeAttribute(60, 59, 10);
  setAttributeCurrentWithinLimits(luckCeiling, attributeCurrent(luckCeiling) + 2);
  check(attributeCurrent(luckCeiling) === 60, `unspent luck cannot rise above its maximum (got ${attributeCurrent(luckCeiling)})`);
  console.log(`floor 10, current 11, -2 -> ${attributeCurrent(luckFloor)}`);
  console.log(`ceiling 60, current 59, +2 -> ${attributeCurrent(luckCeiling)}`);

  console.log('');
  finish();
}

main();
