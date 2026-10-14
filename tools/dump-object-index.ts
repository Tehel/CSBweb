/**
 * `DescIndex`, `GetBasicObjectType` and `NameIndex` (`src/engine/objectIndex.ts`) over
 * every object record in `dungeon.dat`.
 *
 * The port used to carry five copies of `RN::DescIndex` and they had drifted: two of
 * them made every chest description 1, where CSBWin adds the chest's `BITS1_2(word4)`
 * (`doc/CSBwin-src/data.cpp:583`), and only the UI had a `NameIndex`. This pins the one
 * copy that is left to CSBWin's shape:
 *
 * - every record of the six object databases has a row in `d.ObjDesc`, and the RN form
 *   agrees with the record form `AddCharacter` uses;
 * - doors, monsters, `RNeof`, `RNnul` and `RNempty` have none, and are "not an object";
 * - an RN no slot holds (an `RNVAL`, 0, the maps' length) is `dbUNKNOWN`, and its corner
 *   and record are refused, not read as its own bits (`doc/PROVEN_FACTS.md` -> "An
 *   `RNVAL` read as a slot is `dbUNKNOWN`");
 * - the name table (`graphics.dat`) spells the right word for a scroll, a chest, a
 *   compass, a torch and a waterskin — the canary that the offsets are right;
 * - `NameIndex` turns the compass with the party, burns a lit torch through `Byte640`,
 *   closes a scroll, fills a waterskin and charges the six charged weapons
 *   (`doc/CSBwin-src/data.cpp:613-701`). Those states are forced on real records, in
 *   memory, since the stock dungeon does not hold every one.
 *
 * Run: `npm test -- --only=dump-object-index.ts`
 */
import * as OBJNI from '../src/core/objectNameIndex';
import { RN_FFE4, RN_FIREBALL } from '../src/core/spellRn';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, type ObjectID } from '../src/core/types';
import type { DatabaseRecord, Databases } from '../src/data/dungeonTypes';
import { DungeonState } from '../src/engine/DungeonState';
import {
  DescIndex,
  DescIndexOfRecord,
  GetBasicObjectType,
  NameIndex,
  OBJDI_CHEST,
  type ObjectIndexTables,
} from '../src/engine/objectIndex';
import { check, finish } from './lib/check';
import { graphicsTablesOf, stockDungeon, stockGraphics } from './lib/game';

const DATABASE_OF: Array<[DBType, keyof Databases]> = [
  [DBType.DOOR, 'doors'],
  [DBType.TELEPORTER, 'teleporters'],
  [DBType.TEXT, 'texts'],
  [DBType.ACTUATOR, 'actuators'],
  [DBType.CREATURE, 'creatures'],
  [DBType.WEAPON, 'weapons'],
  [DBType.CLOTHING, 'clothing'],
  [DBType.SCROLL, 'scrolls'],
  [DBType.POTION, 'potions'],
  [DBType.CHEST, 'containers'],
  [DBType.MISC, 'misc'],
];
const OBJECT_DBS = new Set([
  DBType.WEAPON, DBType.CLOTHING, DBType.SCROLL, DBType.POTION, DBType.CHEST, DBType.MISC,
]);

async function main(): Promise<void> {
  const data = stockDungeon();
  const dungeon = new DungeonState(data);
  const graphics = stockGraphics();
  const objectTables = graphicsTablesOf(graphics).objects;
  const uiTables = graphicsTablesOf(graphics).ui;
  const names = objectTables.objectNames;
  const tables: ObjectIndexTables = {
    objDescObjectType: objectTables.objDescObjectType,
    byte640: uiTables.graphic232.byte640,
  };
  const basic = (rn: ObjectID): number => GetBasicObjectType(dungeon, tables.objDescObjectType, rn);
  const nameIndex = (rn: ObjectID, facing = 0): number => NameIndex(dungeon, tables, facing, rn);

  // --- every record --------------------------------------------------------------
  console.log(['database', 'records', 'rows seen', 'first name'].join('\t'));
  for (const [category, key] of DATABASE_OF) {
    const records = data.databases[key].records as DatabaseRecord[];
    const rows = new Set<number>();
    let firstName = '-';
    let mismatches = 0;
    for (let index = 0; index < records.length; index++) {
      const rn = dungeon.rnMaps.rn(category, index);
      const descIndex = DescIndex(dungeon, rn);
      if (descIndex !== DescIndexOfRecord(category, records[index] ?? null)) mismatches++;
      if (OBJECT_DBS.has(category)) {
        check(
          descIndex >= 0 && descIndex < objectTables.objDescObjectType.length,
          `${key}[${index}] has a d.ObjDesc row (got ${descIndex})`,
        );
        const type = basic(rn);
        check(type < names.length, `${key}[${index}] has a real name index (got ${type})`);
        if (rows.size === 0) firstName = names[type] ?? '?';
        rows.add(descIndex);
      } else {
        check(descIndex === -1, `${key}[${index}] has no d.ObjDesc row`);
        check(basic(rn) === OBJNI.OBJNI_NOT_AN_OBJECT, `${key}[${index}] is not an object`);
      }
    }
    check(mismatches === 0, `${key}: DescIndex and DescIndexOfRecord agree on every record`);
    console.log([key, String(records.length), String(rows.size), firstName].join('\t'));
  }

  // --- the sentinels -------------------------------------------------------------
  for (const [label, rn] of [['RNnul', OBJECT_ID_NULL], ['RNeof', OBJECT_ID_EOF], ['RNempty', 0 as ObjectID]] as const) {
    check(DescIndex(dungeon, rn) === -1, `${label}: DescIndex is -1`);
    check(basic(rn) === OBJNI.OBJNI_NOT_AN_OBJECT, `${label}: GetBasicObjectType is objNI_NotAnObject`);
    check(nameIndex(rn) === OBJNI.OBJNI_NOT_AN_OBJECT, `${label}: NameIndex is objNI_NotAnObject`);
  }

  // --- an RN no slot of the maps holds -------------------------------------------
  // `RN::checkIndirectIndex` refuses 0 and anything from `dataMapLength` on, and every
  // `RNVAL` is past it: `dbType()` answers `dbUNKNOWN`, while `pos()` and `idx()` would
  // read outside the maps, which the port refuses (`doc/CSBwin-src/CSBTypes.h:330-353`).
  const throws = (read: () => unknown): boolean => {
    try { read(); return false; } catch { return true; }
  };
  const maps = dungeon.rnMaps;
  for (const [label, rn] of [
    ['RNnul', OBJECT_ID_NULL], ['RNeof', OBJECT_ID_EOF], ['RNFireball', RN_FIREBALL], ['RNffe4', RN_FFE4],
    ['RNempty', 0 as ObjectID], ['dataMapLength', maps.length as ObjectID],
  ] as const) {
    check(maps.dbType(rn) === DBType.UNKNOWN, `${label}: dbType is dbUNKNOWN, not ${maps.dbType(rn)}`);
    check(throws(() => maps.pos(rn)) && throws(() => maps.idx(rn)) && throws(() => maps.setPos(rn, 1)),
      `${label}: pos, idx and pos(p) refuse it`);
  }
  console.log(`dataMapLength ${maps.length}: dbType of RNnul, RNeof, two spells, 0 and the length is dbUNKNOWN`);

  // --- canaries: the name each database's first row spells ------------------------
  const firstOf = (category: DBType, pick: (type: number) => boolean): ObjectID | null => {
    const [, key] = DATABASE_OF.find(([c]) => c === category)!;
    const records = data.databases[key].records;
    for (let index = 0; index < records.length; index++) {
      const rn = dungeon.rnMaps.rn(category, index);
      if (pick(basic(rn))) return rn;
    }
    return null;
  };
  const scroll = firstOf(DBType.SCROLL, () => true);
  const chest = firstOf(DBType.CHEST, () => true);
  const compass = firstOf(DBType.MISC, (t) => t === OBJNI.OBJNI_COMPASS_N);
  const torch = firstOf(DBType.WEAPON, (t) => t === OBJNI.OBJNI_TORCH_A);
  const waterskin = firstOf(DBType.MISC, (t) => t === OBJNI.OBJNI_WATERSKIN);
  const apple = firstOf(DBType.MISC, (t) => t === OBJNI.OBJNI_APPLE);
  for (const [label, rn, word] of [
    ['scroll', scroll, 'OPEN SCROLL'],
    ['chest', chest, 'CHEST'],
    ['compass', compass, 'COMPASS'],
    ['torch', torch, 'TORCH'],
    ['waterskin', waterskin, 'WATERSKIN'],
    ['apple', apple, 'APPLE'],
  ] as const) {
    check(rn !== null, `dungeon.dat holds a ${label}`);
    if (rn === null) continue;
    const name = names[basic(rn)];
    console.log(`${label}\trn=0x${rn.toString(16)}\tname index ${basic(rn)}\t${name}`);
    check(name === word, `a ${label}'s basic name is ${word}, not ${name}`);
  }

  // --- the chest's BITS1_2(word4) --------------------------------------------------
  if (chest !== null) {
    const record = dungeon.getContainerRecord(chest)!;
    const saved = record.containerType;
    check(DescIndex(dungeon, chest) === OBJDI_CHEST + saved, 'a chest is objDI_Chest + its type');
    record.containerType = 1;
    check(DescIndex(dungeon, chest) === OBJDI_CHEST + 1, 'a type-1 container is row objDI_Chest + 1');
    record.containerType = saved;
  }

  // --- NameIndex --------------------------------------------------------------------
  if (compass !== null) {
    for (let facing = 0; facing < 4; facing++) {
      check(
        nameIndex(compass, facing) === OBJNI.OBJNI_COMPASS_N + facing,
        `the compass points ${facing} when the party faces ${facing}`,
      );
    }
  }
  if (torch !== null) {
    const record = dungeon.getWeaponRecord(torch)!;
    const saved = { lit: record.litTorch, charges: record.charges };
    record.litTorch = false;
    record.charges = 15;
    check(nameIndex(torch) === OBJNI.OBJNI_TORCH_A, 'an unlit torch is Torch_a whatever its charge');
    record.litTorch = true;
    const seen: number[] = [];
    for (let charges = 0; charges < 16; charges++) {
      record.charges = charges;
      const ni = nameIndex(torch);
      seen.push(ni - OBJNI.OBJNI_TORCH_A);
      check(ni === OBJNI.OBJNI_TORCH_A + (tables.byte640[charges] ?? 0), `a lit torch at charge ${charges} reads Byte640`);
      check(ni >= OBJNI.OBJNI_TORCH_A && ni <= OBJNI.OBJNI_TORCH_D, `a lit torch at charge ${charges} stays a torch`);
    }
    console.log(`lit torch, charge 0..15 -> Torch_a + [${seen.join(',')}]`);
    check(seen[0] === 0 && seen[15] === 3, 'a burnt-out torch is Torch_a, a full one Torch_d');
    record.litTorch = saved.lit;
    record.charges = saved.charges;
  }
  if (scroll !== null) {
    const record = dungeon.getScrollRecord(scroll)!;
    const saved = record.open;
    check(basic(scroll) === OBJNI.OBJNI_OPEN_SCROLL, "a scroll's basic type is the open scroll");
    record.open = true;
    check(nameIndex(scroll) === OBJNI.OBJNI_OPEN_SCROLL, 'an open scroll names as open');
    record.open = false;
    check(nameIndex(scroll) === OBJNI.OBJNI_SCROLL, 'a closed scroll names as a scroll');
    record.open = saved;
  }
  if (waterskin !== null) {
    const record = dungeon.getMiscRecord(waterskin)!;
    const saved = record.specialState;
    record.specialState = 0;
    check(nameIndex(waterskin) === OBJNI.OBJNI_WATERSKIN, 'an empty waterskin');
    record.specialState = 2;
    check(nameIndex(waterskin) === OBJNI.OBJNI_WATER, 'a waterskin with water in it');
    record.specialState = saved;
  }
  if (apple !== null) {
    check(nameIndex(apple) === basic(apple), 'an apple is not modifiable: NameIndex is its basic type');
  }

  // The six charged weapons, forced onto one real weapon record by its weapon type.
  const weapon = firstOf(DBType.WEAPON, () => true);
  if (weapon !== null) {
    const record = dungeon.getWeaponRecord(weapon)!;
    const saved = { type: record.weaponType, charges: record.charges };
    for (const constant of [
      'OBJNI_STORM_A', 'OBJNI_FLAMITT_A', 'OBJNI_STORM_RING_A',
      'OBJNI_RA_BLADE_A', 'OBJNI_EYE_OF_TIME_A', 'OBJNI_STAFF_OF_CLAWS_A',
    ] as const) {
      const target = OBJNI[constant] as number;
      const row = Array.from(tables.objDescObjectType).indexOf(target);
      check(row >= 23 && row < 69, `${constant} has a weapon row in d.ObjDesc`);
      record.weaponType = row - 23;
      record.charges = 0;
      check(nameIndex(weapon) === target, `${constant} without charges`);
      record.charges = 3;
      check(nameIndex(weapon) === target + 1, `${constant} with charges is the next index`);
    }
    record.weaponType = saved.type;
    record.charges = saved.charges;
  }

  finish();
}

void main();
