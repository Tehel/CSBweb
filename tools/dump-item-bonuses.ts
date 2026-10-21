/**
 * What carrying an object does to its bearer — `AdjustStatsForItemCarried`
 * (`doc/CSBwin-src/Character.cpp:1574-1785`) — and what else `AddCharacterPossession` /
 * `RemoveCharacterPossession` (`:1941-2042`, `:1827-1935`), the one pair every writer
 * goes through, do.
 *
 *   npm test -- --only=dump-item-bonuses.ts
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
 * 4. The writers: `RemoveCharacterPossession` through a death, the inventory click
 *    (`HandleClothingClick`), a DSA `&MOVE` to and from a character, and a Hall of
 *    Champions recruit arriving with the bonuses of what the mirror hands out.
 * 5. The rest of the pair, along those same paths: a torch lit in either hand (a hand
 *    refilled from the backpack, ZED's torch from his mirror) and put out again, a scroll
 *    opened in the weapon hand, an Illumulet lighting the party and a Jewel Symal waking
 *    round the neck, and the two notices to the UI: the attack menu closes on any change
 *    to the weapon hand, and the open inventory's chest is repacked when it leaves it.
 */
import * as NI from '../src/core/objectNameIndex';
import { DBType, Direction, OBJECT_ID_EOF, OBJECT_ID_NULL, Position } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import type { GameHost } from '../src/engine/GameHost';
import type { ClothingRecord, MiscRecord, WeaponRecord } from '../src/data/dungeonTypes';
import { AdjustStatsForItemCarried } from '../src/engine/AdjustStatsForItemCarried';
import { repackChest, showChestContents } from '../src/engine/CharacterSystem';
import { Game } from '../src/engine/Game';
import {
  AttributeIndex, attributeMinimum, makeAddCharacterAttributes, type Attribute,
} from '../src/engine/attributes';
import { type Champion } from '../src/engine/gameTypes';
import { DescIndexOfRecord, NameIndex, OBJDI_CAPE, OBJDI_COMPASS, OBJDI_EYE_OF_TIME } from '../src/engine/objectIndex';
import { type UIState } from '../src/renderer/ui/UIState';
import { graphicsTablesOf, newGame, presetHeroesOfGame, stockDungeon, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';
import { check, finish } from './lib/check';
import { handleClothingClick } from '../src/renderer/ui/Mouse';
import { testChampion } from './lib/champion';
import { standInOf } from './lib/standIn';

const graphics = stockGraphics();
const objectTables = graphicsTablesOf(graphics).objects;

function makeGame(host?: Partial<GameHost>): Game {
  const data = stockDungeon();
  const game = newGame(data, graphics, host);
  game.setRandomSeed(0x12345678);
  return game;
}

/** The interface over `g`, whose inventory click calls the engine's pair. */
function uiOver(g: Game): UIState {
  const ui = newUIState(graphics, g.ctx);
  return ui;
}

/** The first record of `category` in the dungeon, as an object ID. */
function firstRecord(g: Game, category: DBType.SCROLL | DBType.CHEST): ObjectID {
  const databases = g.ctx.dungeon.getData().databases;
  const db = category === DBType.SCROLL ? databases.scrolls : databases.containers;
  if (db.records.length === 0) throw new Error(`dungeon.dat has no ${DBType[category]} record`);
  return g.ctx.dungeon.rnMaps.rn(category, 0);
}

function champion(i: number): Champion {
  return testChampion(i, {
    attributes: {
      health: 20, maxHealth: 20, stamina: 12, maxStamina: 12, mana: 7, maxMana: 20,
      stats: makeAddCharacterAttributes([40, 41, 42, 43, 44, 45, 46]),
    },
  });
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
      const record = category === DBType.WEAPON ? standInOf<WeaponRecord>({ weaponType: t })
        : category === DBType.CLOTHING ? standInOf<ClothingRecord>({ clothingType: t }) : standInOf<MiscRecord>({ miscType: t });
      if (table[DescIndexOfRecord(category, record)] === objNI) {
        return { category, type: t };
      }
    }
  }
  return null;
}

function newObject(game: Game, objNI: number, extra: { cursed?: boolean; charges?: number } = {}): ObjectID {
  const found = typeNamed(objNI);
  if (!found) throw new Error(`no object is named ${objNI}`);
  const databases = game.ctx.dungeon.getData().databases;
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
  return game.ctx.dungeon.rnMaps.rn(found.category, db.records.length - 1);
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

// `doc/CSBwin-src/Character.cpp:1621-1765`, top to bottom.
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

async function main(): Promise<void> {
  const game = makeGame();
  const dungeon = game.ctx.dungeon;
  const nameIndex = (rn: ObjectID): number => NameIndex(
    dungeon,
    game.ctx.tables,
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
    g.systems.hallOfChampions.addChampion(champion(0));
    g.systems.hallOfChampions.addChampion(champion(1));
    const c = g.ctx.party.state.champions[0]!;
    const staff = newObject(g, NI.OBJNI_SERPENT_STAFF);
    const helm = newObject(g, NI.OBJNI_CROWN_OF_NERRA);
    c.possessions[1] = staff;
    c.possessions[2] = helm;
    const gNameIndex = (rn: ObjectID): number => NameIndex(
      g.ctx.dungeon,
      g.ctx.tables, 0, rn,
    );
    AdjustStatsForItemCarried(c, 1, 1, staff, g.ctx.dungeon, gNameIndex);
    AdjustStatsForItemCarried(c, 2, 1, helm, g.ctx.dungeon, gNameIndex);
    const worn = `${c.attributes.maxMana} ${c.attributes.stats[AttributeIndex.Wisdom]!.current}`;
    g.systems.monsterAttack.damageCharacter(0, 999, 0, 0);
    g.systems.monsterAttack.displayCharacterDamage();
    const after = `${c.attributes.maxMana} ${c.attributes.stats[AttributeIndex.Wisdom]!.current}`;
    console.log(`dying with a Serpent Staff and the Crown of Nerra: maxMana/Wisdom ${worn} -> ${after}`);
    check(worn === '36 53' && after === '20 43', 'a death takes each bonus off as the object drops');

    // The inventory click: champion 1's inventory is open, so a button of 8 and up is a
    // slot of theirs (`slot = button - 8`, `doc/CSBwin-src/CSBCode.cpp:7003`).
    const ui = uiOver(g);
    g.ctx.party.state.selectedCharacterIndex = 1;
    const b = g.ctx.party.state.champions[1]!;
    const dexhelm = newObject(g, NI.OBJNI_DEXHELM);
    const dex = b.attributes.stats[AttributeIndex.Dexterity]!;
    g.ctx.party.state.objectInHand = dexhelm;
    handleClothingClick(ui, 8 + 2);
    const on = dex.current;
    handleClothingClick(ui, 8 + 2);
    console.log(`the inventory click: Dexterity 42 -> ${on} with the Dexhelm on -> ${dex.current} off`);
    check(on === 52 && dex.current === 42 && dex.minimum === 30 && g.ctx.party.state.objectInHand === dexhelm,
      'the inventory click puts the bonus on and takes it off');

    // The DSA's `&MOVE` to and from a character (`MoveObject.cpp:435`, `:160`).
    const dsa = g.systems.dsa;
    const towers = newObject(g, NI.OBJNI_POWERTOWERS);
    const strength = b.attributes.stats[AttributeIndex.Strength]!;
    dsa.findCharacterDestination(1, 4, towers, true);
    const dsaOn = strength.current;
    dsa.findCharacterSource(1, 4, true);
    console.log(`a DSA move: Strength 41 -> ${dsaOn} with Powertowers on -> ${strength.current} off`);
    check(dsaOn === 51 && strength.current === 41, 'a DSA move puts the bonus on and takes it off');
  }
  {
    // A Hall of Champions recruit carries what the mirror hands out, and CSBWin places
    // each object with `AddCharacterPossession` (`Character.cpp:790`), so the recruit
    // arrives with the bonuses. BORIS's mirror holds a Rabbit's Foot, +10 Luck anywhere.
    const g = makeGame();
    for (const hero of presetHeroesOfGame(g)) {
      const carried = (hero.inventory ?? []).map((item) => nameIndex(item.rn as ObjectID))
        .filter((objNI) => table.some((row) => row.objNI === objNI));
      if (carried.length) console.log(`${hero.name} carries ${carried.map((n) => objectTables.objectNames[n]).join(', ')}`);
    }
    const boris = presetHeroesOfGame(g).find((h) => h.name === 'BORIS');
    if (!boris) throw new Error('no BORIS in dungeon.dat');
    const facing = (boris.location.wall + 2) & 3;
    const party = g.ctx.party.state;
    party.position = new Position(
      boris.location.x - [0, 1, 0, -1][facing]!, boris.location.y - [-1, 0, 1, 0][facing]!, boris.location.map,
    );
    party.facing = facing as Direction;
    g.systems.mouse.handleWallClick();
    const recruit = party.champions[0];
    const luck = recruit?.attributes.stats[AttributeIndex.Luck];
    const foot = recruit?.possessions.findIndex((rn) => rn !== OBJECT_ID_NULL && nameIndex(rn) === NI.OBJNI_RABBITS_FOOT) ?? -1;
    console.log(`BORIS recruited: Luck ${luck?.maximum}/${luck?.current}/${luck?.minimum} (the mirror says ${boris.luck}), `
      + `Rabbit's Foot in slot ${foot}`);
    check(foot >= 0 && luck?.current === Math.min(boris.luck, 224) + 10 && luck?.minimum === 20,
      'a recruit arrives with the bonus of what they carry');
  }

  /* ---------------------------------------- 5. the rest of the pair -------------- */
  console.log('');
  console.log('=== The rest of the pair ===');
  {
    const notices: string[] = [];
    const g = makeGame({
      closeAttackMenuOf: (chIdx) => notices.push(`closeAttackMenuOf(${chIdx})`),
    });
    g.systems.hallOfChampions.addChampion(champion(0));
    g.systems.hallOfChampions.addChampion(champion(1));
    const ui = uiOver(g);
    const party = g.ctx.party.state;
    party.selectedCharacterIndex = 1;
    const weapons = g.ctx.dungeon.getData().databases.weapons.records;
    const gNameIndex = (rn: ObjectID): number => NameIndex(
      g.ctx.dungeon,
      g.ctx.tables, 0, rn,
    );

    // A torch refilled into an empty hand from the backpack (`TAG011594`,
    // `CSBCode.cpp:6305-6306`) is lit: `NameIndex == Torch_a` (`Character.cpp:1993`).
    const torch = newObject(g, NI.OBJNI_TORCH_A, { charges: 15 });
    const torchIndex = g.ctx.dungeon.rnMaps.idx(torch);
    party.champions[1]!.possessions[7] = torch;
    g.ctx.systems.character.refillPossessionSlot(1, 0);
    const refilled = party.champions[1]!.possessions[0] === torch;
    const litByRefill = weapons[torchIndex]!.litTorch;
    handleClothingClick(ui, 8 + 0);
    const outByClick = weapons[torchIndex]!.litTorch;
    console.log(`a torch refilled into hand 0 from slot 7: lit ${litByRefill}, name ${gNameIndex(torch)} in the cursor`
      + ` after the click took it out: lit ${outByClick}`);
    check(refilled && litByRefill === true, 'a hand refilled with a torch lights it');
    check(outByClick === false && party.objectInHand === torch, 'and taking it out of the hand puts it out');
    party.objectInHand = OBJECT_ID_NULL;

    // A scroll opens in the weapon hand and closes out of it (`:1986-1991`, `:1897-1901`).
    const scroll = firstRecord(g, DBType.SCROLL);
    const scrolls = g.ctx.dungeon.getData().databases.scrolls.records;
    scrolls[0]!.open = false;
    party.objectInHand = scroll;
    handleClothingClick(ui, 8 + 1);
    const openInHand = scrolls[0]!.open;
    const openName = gNameIndex(scroll);
    handleClothingClick(ui, 8 + 1);
    console.log(`a scroll into the weapon hand: open ${openInHand} (name ${openName}), out again: open ${scrolls[0]!.open}`);
    check(openInHand && openName === NI.OBJNI_OPEN_SCROLL && !scrolls[0]!.open && gNameIndex(scroll) === NI.OBJNI_SCROLL,
      'a scroll in the weapon hand is open, and closed again out of it');
    party.objectInHand = OBJECT_ID_NULL;

    // Round the neck an Illumulet gets `value(1)` and adds `d.Word1074[2]` to the party's
    // light (`:2016-2024`); a Jewel Symal gets `value(1)` (`:2027-2033`).
    const misc = g.ctx.dungeon.getData().databases.misc.records;
    const step = g.ctx.tables.word1074[2]!;
    const brightness = party.brightness;
    const illumulet = newObject(g, NI.OBJNI_ILLUMULET_A);
    party.objectInHand = illumulet;
    handleClothingClick(ui, 8 + 10);
    const lit = `${party.brightness} ${misc[g.ctx.dungeon.rnMaps.idx(illumulet)]!.specialState} ${gNameIndex(illumulet)}`;
    handleClothingClick(ui, 8 + 10);
    const unlit = `${party.brightness} ${misc[g.ctx.dungeon.rnMaps.idx(illumulet)]!.specialState} ${gNameIndex(illumulet)}`;
    console.log(`an Illumulet round the neck (Word1074[2] = ${step}): brightness/value/name ${brightness} -> ${lit} -> ${unlit}`);
    check(step !== 0 && lit === `${brightness + step} 1 ${NI.OBJNI_ILLUMULET_B}`,
      'a worn Illumulet lights the party and reads as its _b');
    check(unlit === `${brightness} 0 ${NI.OBJNI_ILLUMULET_A}`, 'and taken off it goes dark again');
    party.objectInHand = OBJECT_ID_NULL;
    const symal = newObject(g, NI.OBJNI_JEWEL_SYMAL_A);
    g.systems.dsa.findCharacterDestination(1, 10, symal, true);
    const symalOn = gNameIndex(symal);
    g.systems.dsa.findCharacterSource(1, 10, true);
    console.log(`a Jewel Symal round the neck by a DSA move: name ${symalOn}, off: ${gNameIndex(symal)}`);
    check(symalOn === NI.OBJNI_JEWEL_SYMAL_B && gNameIndex(symal) === NI.OBJNI_JEWEL_SYMAL_A,
      'a worn Jewel Symal reads as its _b, and as its _a again off');

    // The notices. Any change to a weapon hand asks the UI to close that champion's attack
    // menu (`:1893-1896`, `:1982-1985`); a chest out of the weapon hand of the champion
    // whose inventory is open is repacked (`:1911-1919`). Each move runs with the chest
    // open, as the inventory's draw leaves it, and a repack is noted as the chest found
    // closed after it.
    const chest = firstRecord(g, DBType.CHEST);
    const noticed = (move: () => void): string => {
      notices.length = 0;
      showChestContents(g.ctx, chest);
      move();
      if (g.ctx.interface.openChestId === null) notices.push('repackChest');
      else repackChest(g.ctx);
      return notices.join(' ');
    };
    party.objectInHand = chest;
    const chestIn = noticed(() => handleClothingClick(ui, 8 + 1));
    const chestOut = noticed(() => handleClothingClick(ui, 8 + 1));
    party.objectInHand = OBJECT_ID_NULL;
    const otherChest = noticed(() => {
      g.systems.character.addCharacterPossession(0, chest, 1);
      g.systems.character.removeCharacterPossession(0, 1);
    });
    const shieldHand = noticed(() => {
      g.systems.character.addCharacterPossession(1, chest, 0);
      g.systems.character.removeCharacterPossession(1, 0);
    }) || 'none';
    console.log(`a chest into champion 1's weapon hand: ${chestIn}; out: ${chestOut}`);
    console.log(`into and out of champion 0's (inventory closed): ${otherChest}; champion 1's shield hand: ${shieldHand}`);
    check(chestIn === 'closeAttackMenuOf(1)' && chestOut === 'closeAttackMenuOf(1) repackChest',
      'the open inventory\'s chest is repacked when it leaves the weapon hand, and the attack menu closes both ways');
    check(otherChest === 'closeAttackMenuOf(0) closeAttackMenuOf(0)' && shieldHand === 'none',
      'another champion\'s chest is not repacked, and the shield hand notices nothing');
  }
  {
    // ZED's mirror hands out a torch, and `AddCharacter` puts it in with
    // `AddCharacterPossession` (`Character.cpp:790`), so if it lands in a hand it is lit.
    const g = makeGame();
    const data = g.ctx.dungeon.getData();
    const zed = presetHeroesOfGame(g).find((h) => h.name === 'ZED');
    if (!zed) throw new Error('no ZED in dungeon.dat');
    const facing = (zed.location.wall + 2) & 3;
    const party = g.ctx.party.state;
    party.position = new Position(
      zed.location.x - [0, 1, 0, -1][facing]!, zed.location.y - [-1, 0, 1, 0][facing]!, zed.location.map,
    );
    party.facing = facing as Direction;
    g.systems.mouse.handleWallClick();
    const recruit = party.champions[0];
    const slot = recruit?.possessions.findIndex((rn) => rn !== OBJECT_ID_NULL
      && g.ctx.dungeon.rnMaps.dbType(rn) === DBType.WEAPON && typeNamed(NI.OBJNI_TORCH_A)?.type
        === data.databases.weapons.records[g.ctx.dungeon.rnMaps.idx(rn)]!.weaponType) ?? -1;
    const torch = slot >= 0 ? recruit!.possessions[slot]! : OBJECT_ID_NULL;
    const lit = slot >= 0 && data.databases.weapons.records[g.ctx.dungeon.rnMaps.idx(torch)]!.litTorch;
    console.log(`ZED recruited: the torch is in slot ${slot}, lit ${lit}`);
    check(slot === 1 && lit, 'a recruit\'s torch, put in the weapon hand, is lit');
  }

  finish();
}

main();

