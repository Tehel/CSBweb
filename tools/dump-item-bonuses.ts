/**
 * What carrying an object does to its bearer — `AdjustStatsForItemCarried`
 * (`doc/CSBwin-src/Character.cpp:1569-1780`), `DEBT.md` C32.
 *
 *   npx tsx tools/dump-item-bonuses.ts
 *
 * 1. Every row of the table, against the real objects of the Atari DM data: the object
 *    is found through `ObjDesc` by the name index CSBWin tests, and its name in graphic
 *    `0x22c` must spell the CSBWin identifier (the canary for the `OBJNI_*` constants).
 *    Put on, the named attribute's maximum, current and minimum all move by the bonus —
 *    or `MaxMana` does, and the current mana not at all. Taken off, all is as before.
 * 2. The places a row does not apply: a staff in the off hand, Powertowers on the body,
 *    a Rabbit's Foot in a chest slot, a cursed dagger past slot 12, a cursed misc object.
 * 3. A curse: -3 Luck in slots 0-12, before any other bonus (a cursed staff in the
 *    weapon hand gives no mana), and four of them wrap the Luck minimum below zero.
 * 4. The writers: `RemoveCharacterPossession` through a death, the UI's inventory click
 *    (`setChampionPossession`), a DSA move, and a Hall of Champions recruit arriving with
 *    the bonuses of what the mirror hands out.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as NI from '../src/core/objectNameIndex';
import { DBType, Direction, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, encodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import type { DatabaseRecord } from '../src/data/dungeonTypes';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { AdjustStatsForItemCarried } from '../src/engine/AdjustStatsForItemCarried';
import { Game } from '../src/engine/Game';
import {
  AttributeIndex, attributeMinimum, makeAddCharacterAttributes, type Attribute,
} from '../src/engine/attributes';
import { emptyPossessions, type Champion } from '../src/engine/gameTypes';
import { DescIndexOfRecord, NameIndex, OBJDI_CAPE, OBJDI_COMPASS, OBJDI_EYE_OF_TIME } from '../src/engine/objectIndex';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { setChampionPossession } from '../src/renderer/ui/Character';
import { createUIState } from '../src/renderer/ui/UIState';
import { check, finish } from './lib/check';
import { addCharacterDefaults } from '../src/engine/AddCharacter';

const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
const viewportTables = extractViewportTables(graphics);
const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
const uiTables = extractUITables(graphics);

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const game = new Game(
    data,
    {
      roomTimerFunctions: uiTables.graphic232.byte1596,
      monsterDesc: objectTables.monsterDesc,
      objDescObjectType: objectTables.objDescObjectType,
      objDescCarryMask: objectTables.objDescCarryMask,
      carryLocation: uiTables.graphic232.carryLocation,
      byte640: uiTables.graphic232.byte640,
      word1074: uiTables.graphic232.word1074,
      weaponDesc: objectTables.weaponDesc,
      weaponWeights: objectTables.weaponWeights,
      clothingWeights: objectTables.clothingWeights,
      miscWeights: objectTables.miscWeights,
    },
    {
      monsterDesc: objectTables.monsterDesc,
      word1074: uiTables.graphic232.word1074,
      dropOrder: uiTables.graphic232.dropOrder,
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
  return game;
}

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 20, maxHealth: 20, stamina: 12, maxStamina: 12, mana: 7, maxMana: 20,
      stats: makeAddCharacterAttributes([40, 41, 42, 43, 44, 45, 46]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

type Kind = DBType.WEAPON | DBType.CLOTHING | DBType.MISC;

/** The type whose `ObjDesc` row is named `objNI`, searched within its own category's rows. */
function typeNamed(objNI: number): { category: Kind; type: number } | null {
  const table = objectTables.objDescObjectType;
  const ranges: [Kind, number][] = [
    [DBType.WEAPON, OBJDI_CAPE - OBJDI_EYE_OF_TIME],
    [DBType.CLOTHING, OBJDI_COMPASS - OBJDI_CAPE],
    [DBType.MISC, table.length - OBJDI_COMPASS],
  ];
  for (const [category, count] of ranges) {
    for (let t = 0; t < count; t++) {
      const record = category === DBType.WEAPON ? { weaponType: t }
        : category === DBType.CLOTHING ? { clothingType: t } : { miscType: t };
      if (table[DescIndexOfRecord(category, record as unknown as DatabaseRecord)] === objNI) {
        return { category, type: t };
      }
    }
  }
  return null;
}

function newObject(game: Game, objNI: number, extra: { cursed?: boolean; charges?: number } = {}): ObjectID {
  const found = typeNamed(objNI);
  if (!found) throw new Error(`no object is named ${objNI}`);
  const databases = game.dungeonState.getData().databases;
  const common = { nextObject: OBJECT_ID_EOF, important: false, cursed: extra.cursed ?? false };
  let db: { records: object[]; count: number };
  if (found.category === DBType.WEAPON) {
    db = databases.weapons;
    db.records.push({ ...common, broken: false, charges: extra.charges ?? 0, litTorch: false, poisoned: false, weaponType: found.type });
  } else if (found.category === DBType.CLOTHING) {
    db = databases.clothing;
    db.records.push({ ...common, broken: false, charges: 0, clothingType: found.type });
  } else {
    db = databases.misc;
    db.records.push({ ...common, specialState: 0, miscType: found.type });
  }
  db.count++;
  return encodeObjectID(0, found.category, db.records.length - 1) as ObjectID;
}

/** Everything the function may move, as one comparable string. */
function snapshot(c: Champion): string {
  const s = c.attributes.stats.map((a: Attribute) => `${a.maximum}/${a.current}/${a.minimum}`).join(' ');
  return `${s} mana ${c.attributes.mana}/${c.attributes.maxMana}`;
}

const letters = (s: string): string => s.toUpperCase().replace(/[^A-Z]/g, '');

type Stat = AttributeIndex | 'maxMana';
/** `dm` is the name in the Atari DM data where it is not the CSBWin identifier's (CSB's). */
interface Row { id: string; dm?: string; objNI: number; slot: number; stat: Stat; bonus: number }

// `doc/CSBwin-src/Character.cpp:1616-1760`, top to bottom.
const table: Row[] = [
  { id: 'RabbitsFoot', objNI: NI.OBJNI_RABBITS_FOOT, slot: 29, stat: AttributeIndex.Luck, bonus: 10 },
  { id: 'MaceOfOrder', objNI: NI.OBJNI_MACE_OF_ORDER, slot: 1, stat: AttributeIndex.Strength, bonus: 5 },
  { id: 'StaffOfClaws', objNI: NI.OBJNI_STAFF_OF_CLAWS_A, slot: 1, stat: 'maxMana', bonus: 4 },
  { id: 'Staff', objNI: NI.OBJNI_STAFF, slot: 1, stat: 'maxMana', bonus: 2 },
  { id: 'Wand', objNI: NI.OBJNI_WAND, slot: 1, stat: 'maxMana', bonus: 1 },
  { id: 'TeoWand', objNI: NI.OBJNI_TEO_WAND, slot: 1, stat: 'maxMana', bonus: 6 },
  { id: 'YewStaff', objNI: NI.OBJNI_YEW_STAFF, slot: 1, stat: 'maxMana', bonus: 4 },
  { id: 'StaffOfIrra', dm: 'STAFF OF MANAR', objNI: NI.OBJNI_STAFF_OF_IRRA, slot: 1, stat: 'maxMana', bonus: 10 },
  { id: 'CrossOfNeta', dm: 'SNAKE STAFF', objNI: NI.OBJNI_CROSS_OF_NETA, slot: 1, stat: 'maxMana', bonus: 8 },
  { id: 'SerpentStaff', dm: 'THE CONDUIT', objNI: NI.OBJNI_SERPENT_STAFF, slot: 1, stat: 'maxMana', bonus: 16 },
  { id: 'DragonSpit', objNI: NI.OBJNI_DRAGON_SPIT, slot: 1, stat: 'maxMana', bonus: 7 },
  { id: 'SceptreOfLyf', objNI: NI.OBJNI_SCEPTRE_OF_LYF, slot: 1, stat: 'maxMana', bonus: 5 },
  { id: 'SideSplitter', dm: 'DELTA', objNI: NI.OBJNI_SIDE_SPLITTER, slot: 1, stat: 'maxMana', bonus: 1 },
  { id: 'DragonFang', dm: 'THE INQUISITOR', objNI: NI.OBJNI_DRAGON_FANG, slot: 1, stat: 'maxMana', bonus: 2 },
  { id: 'VorpalBlade', objNI: NI.OBJNI_VORPAL_BLADE, slot: 1, stat: 'maxMana', bonus: 4 },
  { id: 'Powertowers', objNI: NI.OBJNI_POWERTOWERS, slot: 4, stat: AttributeIndex.Strength, bonus: 10 },
  { id: 'CrownOfNerra', objNI: NI.OBJNI_CROWN_OF_NERRA, slot: 2, stat: AttributeIndex.Wisdom, bonus: 10 },
  { id: 'Dexhelm', objNI: NI.OBJNI_DEXHELM, slot: 2, stat: AttributeIndex.Dexterity, bonus: 10 },
  { id: 'Flamebain', objNI: NI.OBJNI_FLAMEBAIN, slot: 3, stat: AttributeIndex.AntiFire, bonus: 12 },
  { id: 'CloakOfNight', objNI: NI.OBJNI_CLOAK_OF_NIGHT, slot: 3, stat: AttributeIndex.Dexterity, bonus: 8 },
  { id: 'JewelSymal', objNI: NI.OBJNI_JEWEL_SYMAL_A, slot: 10, stat: AttributeIndex.AntiMagic, bonus: 15 },
  { id: 'CloakOfNight', objNI: NI.OBJNI_CLOAK_OF_NIGHT, slot: 10, stat: AttributeIndex.Dexterity, bonus: 8 },
  { id: 'Moonstone', objNI: NI.OBJNI_MOONSTONE, slot: 10, stat: 'maxMana', bonus: 3 },
];

function main(): void {
  const game = makeGame();
  const dungeon = game.dungeonState;
  const nameIndex = (rn: ObjectID): number => NameIndex(
    dungeon,
    { objDescObjectType: objectTables.objDescObjectType, byte640: uiTables.graphic232.byte640 },
    0,
    rn,
  );
  const adjust = (c: Champion, slot: number, sign: number, rn: ObjectID): void =>
    AdjustStatsForItemCarried(c, slot, sign, rn, dungeon, nameIndex);

  /* ---------------------------------------- 1. the table ------------------------- */
  console.log('=== The table ===');
  console.log(['object', 'name in 0x22c', 'slot', 'attribute', 'before', 'worn', 'bonus'].join('\t'));
  for (const row of table) {
    const name = objectTables.objectNames[row.objNI] ?? '';
    check(letters(name) === letters(row.dm ?? row.id), `${row.id}: name index ${row.objNI} is "${name}" in the data`);
    const c = champion(0);
    const rn = newObject(game, row.objNI);
    const before = snapshot(c);
    const read = (): number[] => row.stat === 'maxMana'
      ? [c.attributes.maxMana]
      : [c.attributes.stats[row.stat]!.maximum, c.attributes.stats[row.stat]!.current, c.attributes.stats[row.stat]!.minimum];
    const was = read();
    c.possessions[row.slot] = rn;
    adjust(c, row.slot, 1, rn);
    const now = read();
    const label = row.stat === 'maxMana' ? 'maxMana' : AttributeIndex[row.stat];
    console.log([row.id, name, row.slot, label, was.join('/'), now.join('/'), row.bonus].join('\t'));
    check(now.every((v, i) => v === was[i]! + row.bonus),
      `${row.id} in slot ${row.slot}: ${label} ${row.stat === 'maxMana' ? '' : 'maximum, current and minimum '}+${row.bonus}`);
    if (row.stat === 'maxMana') check(c.attributes.mana === 7, `${row.id}: the current mana does not move`);
    c.possessions[row.slot] = OBJECT_ID_NULL;
    adjust(c, row.slot, -1, rn);
    check(snapshot(c) === before, `${row.id}: taken off, everything is as before`);
  }
  // A Staff of Claws with charges names itself `_b` (`NameIndex`), and is still +4.
  {
    const c = champion(0);
    const rn = newObject(game, NI.OBJNI_STAFF_OF_CLAWS_A, { charges: 3 });
    adjust(c, 1, 1, rn);
    console.log(`a charged Staff of Claws is name index ${nameIndex(rn)}: maxMana ${c.attributes.maxMana}`);
    check(nameIndex(rn) === NI.OBJNI_STAFF_OF_CLAWS_A + 1 && c.attributes.maxMana === 24,
      'a charged Staff of Claws (_b) gives the same 4 mana');
  }

  /* ---------------------------------------- 2. where a row does not apply -------- */
  console.log('');
  console.log('=== Where nothing happens ===');
  const none: [string, number, number, { cursed?: boolean }][] = [
    ['a Staff in the off hand', NI.OBJNI_STAFF, 0, {}],
    ['a Staff round the neck', NI.OBJNI_STAFF, 10, {}],
    ['Powertowers on the body', NI.OBJNI_POWERTOWERS, 3, {}],
    ['a Dexhelm on the legs', NI.OBJNI_DEXHELM, 4, {}],
    ['a Moonstone in the weapon hand', NI.OBJNI_MOONSTONE, 1, {}],
    ['a Rabbit\'s Foot in a chest slot', NI.OBJNI_RABBITS_FOOT, 30, {}],
    ['a cursed Mace of Order in the backpack, slot 13', NI.OBJNI_MACE_OF_ORDER, 13, { cursed: true }],
    ['a cursed Moonstone (misc objects are never tested)', NI.OBJNI_MOONSTONE, 5, { cursed: true }],
  ];
  for (const [label, objNI, slot, extra] of none) {
    const c = champion(0);
    const before = snapshot(c);
    adjust(c, slot, 1, newObject(game, objNI, extra));
    console.log(`${label}: ${snapshot(c) === before ? 'no change' : snapshot(c)}`);
    check(snapshot(c) === before, `${label} changes nothing`);
  }

  /* ---------------------------------------- 3. curses ---------------------------- */
  console.log('');
  console.log('=== Curses ===');
  {
    const c = champion(0);
    const luck = c.attributes.stats[AttributeIndex.Luck]!;
    const staff = newObject(game, NI.OBJNI_STAFF, { cursed: true });
    adjust(c, 1, 1, staff);
    console.log(`a cursed Staff in the weapon hand: Luck ${luck.maximum}/${luck.current}/${luck.minimum}, maxMana ${c.attributes.maxMana}`);
    check(luck.maximum === 37 && luck.current === 37 && luck.minimum === 7 && c.attributes.maxMana === 20,
      'a cursed Staff in the weapon hand costs 3 Luck and gives no mana');
    const cloak = newObject(game, NI.OBJNI_FLAMEBAIN, { cursed: true });
    adjust(c, 12, 1, cloak);
    check(luck.current === 34 && c.attributes.stats[AttributeIndex.AntiFire]!.current === 46,
      'cursed clothing in slot 12, the last slot a curse counts in, costs 3 more, and no anti-fire');

    // Four curses take the minimum of 10 below zero: the byte wraps, and reads as 0.
    const d = champion(1);
    const dLuck = d.attributes.stats[AttributeIndex.Luck]!;
    const daggers = [0, 5, 7, 12].map((slot) => {
      const rn = newObject(game, NI.OBJNI_MACE_OF_ORDER, { cursed: true });
      adjust(d, slot, 1, rn);
      return [slot, rn] as const;
    });
    console.log(`four cursed maces: Luck minimum byte ${dLuck.minimum}, read as ${attributeMinimum(dLuck)}`);
    check(dLuck.minimum === 254 && attributeMinimum(dLuck) === 0,
      'four curses wrap the Luck minimum to 254, which reads as 0 ("it went negative")');
    for (const [slot, rn] of daggers) adjust(d, slot, -1, rn);
    check(dLuck.minimum === 10 && dLuck.current === 40, 'and taking them off wraps it back to 10');
  }

  /* ---------------------------------------- 4. the writers ----------------------- */
  console.log('');
  console.log('=== The writers ===');
  {
    // `RemoveCharacterPossession`, through a death's `DropAllPossessions`.
    const g = makeGame();
    g.addChampion(champion(0));
    g.addChampion(champion(1));
    const c = g.party.state.champions[0]!;
    const staff = newObject(g, NI.OBJNI_SERPENT_STAFF);
    const helm = newObject(g, NI.OBJNI_CROWN_OF_NERRA);
    c.possessions[1] = staff;
    c.possessions[2] = helm;
    const gNameIndex = (rn: ObjectID): number => NameIndex(
      g.dungeonState,
      { objDescObjectType: objectTables.objDescObjectType, byte640: uiTables.graphic232.byte640 }, 0, rn,
    );
    AdjustStatsForItemCarried(c, 1, 1, staff, g.dungeonState, gNameIndex);
    AdjustStatsForItemCarried(c, 2, 1, helm, g.dungeonState, gNameIndex);
    const worn = `${c.attributes.maxMana} ${c.attributes.stats[AttributeIndex.Wisdom]!.current}`;
    g.monsterAttack.damageCharacter(0, 999, 0, 0);
    const after = `${c.attributes.maxMana} ${c.attributes.stats[AttributeIndex.Wisdom]!.current}`;
    console.log(`dying with a Serpent Staff and the Crown of Nerra: maxMana/Wisdom ${worn} -> ${after}`);
    check(worn === '36 53' && after === '20 43', 'a death takes each bonus off as the object drops');

    // The UI's inventory click.
    const ui = createUIState(graphics, g.dungeonState, { getGraphicBitmap: () => null, renderLastFrame: () => {} });
    ui.uiTables = uiTables;
    ui.objectTables = objectTables;
    ui.partyState = g.party.state;
    const b = g.party.state.champions[1]!;
    const dexhelm = newObject(g, NI.OBJNI_DEXHELM);
    const dex = b.attributes.stats[AttributeIndex.Dexterity]!;
    setChampionPossession(ui, b, 2, dexhelm);
    const on = dex.current;
    setChampionPossession(ui, b, 2, OBJECT_ID_NULL);
    console.log(`the inventory click: Dexterity 42 -> ${on} with the Dexhelm on -> ${dex.current} off`);
    check(on === 52 && dex.current === 42 && dex.minimum === 30, 'the inventory click puts the bonus on and takes it off');

    // The DSA's writer, behind `&MOVE` to and from a character (`MoveObject.cpp:160`, `:435`).
    const dsa = (g as unknown as { dsaSystem: { setChampionPossession(c: Champion, slot: number, rn: ObjectID): void } }).dsaSystem;
    const towers = newObject(g, NI.OBJNI_POWERTOWERS);
    const strength = b.attributes.stats[AttributeIndex.Strength]!;
    dsa.setChampionPossession(b, 4, towers);
    const dsaOn = strength.current;
    dsa.setChampionPossession(b, 4, OBJECT_ID_NULL);
    console.log(`a DSA move: Strength 41 -> ${dsaOn} with Powertowers on -> ${strength.current} off`);
    check(dsaOn === 51 && strength.current === 41, 'a DSA move puts the bonus on and takes it off');
  }
  {
    // A Hall of Champions recruit carries what the mirror hands out, and CSBWin places
    // each object with `AddCharacterPossession` (`Character.cpp:789`), so the recruit
    // arrives with the bonuses. BORIS's mirror holds a Rabbit's Foot, +10 Luck anywhere.
    const g = makeGame();
    const data = g.dungeonState.getData();
    for (const hero of data.presetHeroes ?? []) {
      const carried = (hero.inventory ?? []).map((item) => nameIndex(item.rn as ObjectID))
        .filter((objNI) => table.some((row) => row.objNI === objNI));
      if (carried.length) console.log(`${hero.name} carries ${carried.map((n) => objectTables.objectNames[n]).join(', ')}`);
    }
    const boris = (data.presetHeroes ?? []).find((h) => h.name === 'BORIS');
    if (!boris) throw new Error('no BORIS in dungeon.dat');
    const facing = (boris.location.wall + 2) & 3;
    const party = g.party.state;
    party.position = new Position(
      boris.location.x - [0, 1, 0, -1][facing]!, boris.location.y - [-1, 0, 1, 0][facing]!, boris.location.map,
    );
    party.facing = facing as Direction;
    g.handleWallClick();
    const recruit = party.champions[0];
    const luck = recruit?.attributes.stats[AttributeIndex.Luck];
    const foot = recruit?.possessions.findIndex((rn) => rn !== OBJECT_ID_NULL && nameIndex(rn) === NI.OBJNI_RABBITS_FOOT) ?? -1;
    console.log(`BORIS recruited: Luck ${luck?.maximum}/${luck?.current}/${luck?.minimum} (the mirror says ${boris.luck}), `
      + `Rabbit's Foot in slot ${foot}`);
    check(foot >= 0 && luck?.current === Math.min(boris.luck, 224) + 10 && luck?.minimum === 20,
      'a recruit arrives with the bonus of what they carry');
  }

  finish();
}

main();

