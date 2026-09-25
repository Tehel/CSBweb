/**
 * An object's place in CSBWin's object tables: `RN::DescIndex`, `GetBasicObjectType` and
 * `RN::NameIndex`.
 *
 * The one copy of each. The engine, the renderer and the UI used to carry five of
 * `DescIndex` and four of `GetBasicObjectType`, and they had drifted — a chest was always
 * description 1, the failure values disagreed, and only the UI had a `NameIndex`
 * (`DEBT.md` B1).
 *
 * - `DescIndex` picks an object's row in `d.ObjDesc[180]` from its database and its
 *   type field.
 * - `GetBasicObjectType` reads that row's `objectType`: the index into the object-name
 *   table, the same for every compass or every torch.
 * - `NameIndex` refines it by the object's state: which way the compass points, how far
 *   a lit torch has burnt, whether a scroll is open, whether a waterskin or a charged
 *   weapon has anything left in it. This is the index the name, the icon and the
 *   mastery bonuses all go by.
 */
import {
  OBJNI_COMPASS_N,
  OBJNI_EMPTY_FLASK,
  OBJNI_EYE_OF_TIME_A,
  OBJNI_FIRST_FULL_FLASK,
  OBJNI_FIRST_KEY,
  OBJNI_FIRST_MODIFIABLE,
  OBJNI_FLAMITT_A,
  OBJNI_ILLUMULET_A,
  OBJNI_JEWEL_SYMAL_A,
  OBJNI_LAST_FULL_FLASK,
  OBJNI_LAST_KEY,
  OBJNI_LAST_MODIFIABLE,
  OBJNI_NOT_AN_OBJECT,
  OBJNI_OPEN_SCROLL,
  OBJNI_RA_BLADE_A,
  OBJNI_SCROLL,
  OBJNI_STAFF_OF_CLAWS_A,
  OBJNI_STORM_A,
  OBJNI_STORM_RING_A,
  OBJNI_TORCH_A,
  OBJNI_WATERSKIN,
} from '../core/objectNameIndex';
import { DBType, OBJECT_ID_NULL, decodeObjectID, type ObjectID } from '../core/types';
import type {
  ClothingRecord,
  ContainerRecord,
  DatabaseRecord,
  MiscRecord,
  PotionRecord,
  WeaponRecord,
} from '../data/dungeonTypes';
import type { DungeonState } from './DungeonState';

/** The first `d.ObjDesc` row of each database (`OBJ_DESC_INDEX`, `doc/CSBwin-src/Objects.h:247-379`). */
export const OBJDI_SCROLL = 0;
export const OBJDI_CHEST = 1;
export const OBJDI_MON_POTION_A = 2;
export const OBJDI_EYE_OF_TIME = 23;
export const OBJDI_CAPE = 69;
export const OBJDI_COMPASS = 127;

/** The tables `NameIndex` reads besides the dungeon. */
export interface ObjectIndexTables {
  /** `d.ObjDesc[180].objectType()`. */
  objDescObjectType: ArrayLike<number>;
  /** `d.Byte640[16]` — a lit torch's charge to its name-index offset. */
  byte640: ArrayLike<number>;
}

/**
 * `RN::DescIndex` (`doc/CSBwin-src/data.cpp:568`). -1 for anything that has no row: a
 * door, a monster, `RNeof`, `RNnul`, or `RNempty` (0).
 *
 * Divergence: CSBWin reads the record without checking it exists. An RN whose index
 * runs past its database also answers -1 here, since there is nothing to read.
 */
export function DescIndex(dungeon: DungeonState, rn: ObjectID): number {
  if (rn === 0) return -1; // RNempty
  const { category, index } = decodeObjectID(rn);
  const { databases } = dungeon.getData();
  const records: ArrayLike<DatabaseRecord> | undefined =
    category === DBType.SCROLL ? databases.scrolls.records :
    category === DBType.CHEST ? databases.containers.records :
    category === DBType.MISC ? databases.misc.records :
    category === DBType.WEAPON ? databases.weapons.records :
    category === DBType.CLOTHING ? databases.clothing.records :
    category === DBType.POTION ? databases.potions.records :
    undefined;
  return DescIndexOfRecord(category, records?.[index] ?? null);
}

/**
 * `DescIndex`'s switch over a record already in hand, for the one caller that has an
 * object but no `DungeonState` to find it in: `AddCharacter`'s slot choice over a
 * pre-scanned hero inventory.
 */
export function DescIndexOfRecord(category: DBType, record: DatabaseRecord | null): number {
  switch (category) {
    case DBType.SCROLL:
      return OBJDI_SCROLL;
    case DBType.CHEST:
      // `BITS1_2(word4)` — `containerType` is already those two bits.
      return record ? (record as ContainerRecord).containerType + OBJDI_CHEST : -1;
    case DBType.MISC:
      return record ? (record as MiscRecord).miscType + OBJDI_COMPASS : -1;
    case DBType.WEAPON:
      return record ? (record as WeaponRecord).weaponType + OBJDI_EYE_OF_TIME : -1;
    case DBType.CLOTHING:
      return record ? (record as ClothingRecord).clothingType + OBJDI_CAPE : -1;
    case DBType.POTION:
      return record ? (record as PotionRecord).potionType + OBJDI_MON_POTION_A : -1;
    default:
      return -1;
  }
}

/**
 * `GetBasicObjectType` (`doc/CSBwin-src/CSBCode.cpp:1245`). `OBJNI_NOT_AN_OBJECT` for
 * `RNnul` and for anything `DescIndex` has no row for.
 */
export function GetBasicObjectType(
  dungeon: DungeonState,
  objDescObjectType: ArrayLike<number>,
  rn: ObjectID,
): number {
  if (rn === OBJECT_ID_NULL) return OBJNI_NOT_AN_OBJECT;
  const objDI = DescIndex(dungeon, rn);
  if (objDI === -1) return OBJNI_NOT_AN_OBJECT;
  return objDescObjectType[objDI] ?? OBJNI_NOT_AN_OBJECT;
}

/** `RN::NameIndex` (`doc/CSBwin-src/data.cpp:612`). `partyFacing` is `d.partyFacing`. */
export function NameIndex(
  dungeon: DungeonState,
  tables: ObjectIndexTables,
  partyFacing: number,
  rn: ObjectID,
): number {
  let objNID7 = GetBasicObjectType(dungeon, tables.objDescObjectType, rn);
  if (objNID7 === OBJNI_NOT_AN_OBJECT) return objNID7;
  // Firstly, if it is not a modifiable object or a flask of some sort, then return it
  // as is.
  if (objNID7 > OBJNI_LAST_MODIFIABLE || objNID7 < OBJNI_FIRST_MODIFIABLE) {
    if (objNID7 < OBJNI_FIRST_FULL_FLASK || objNID7 > OBJNI_LAST_FULL_FLASK) {
      if (objNID7 !== OBJNI_EMPTY_FLASK) return objNID7;
    }
  }
  const object = rn as ObjectID;
  if (objNID7 === OBJNI_COMPASS_N) {
    return objNID7 + partyFacing;
  }
  if (objNID7 === OBJNI_TORCH_A) {
    const weapon = dungeon.getWeaponRecord(object);
    if (weapon?.litTorch) {
      objNID7 += (tables.byte640[weapon.charges] ?? 0) & 0xff;
    }
    return objNID7;
  }
  if (objNID7 === OBJNI_OPEN_SCROLL) {
    if (!dungeon.getScrollRecord(object)?.open) objNID7 = OBJNI_SCROLL;
    return objNID7;
  }
  if (
    objNID7 === OBJNI_WATERSKIN ||
    objNID7 === OBJNI_ILLUMULET_A ||
    objNID7 === OBJNI_JEWEL_SYMAL_A
  ) {
    // `value()`, `BITS14_15(word2)` (`doc/CSBwin-src/CSB.h:1273`).
    if (dungeon.getMiscRecord(object)?.specialState) objNID7++;
    return objNID7;
  }
  if (
    objNID7 === OBJNI_STORM_A ||
    objNID7 === OBJNI_FLAMITT_A ||
    objNID7 === OBJNI_STORM_RING_A ||
    objNID7 === OBJNI_RA_BLADE_A ||
    objNID7 === OBJNI_EYE_OF_TIME_A ||
    objNID7 === OBJNI_STAFF_OF_CLAWS_A
  ) {
    if (dungeon.getWeaponRecord(object)?.charges) objNID7++;
  }
  return objNID7;
}

/** `RN::IsAKey` (`doc/CSBwin-src/data.cpp:686-694`) — a misc object named as a key. */
export function IsAKey(
  dungeon: DungeonState,
  tables: ObjectIndexTables,
  partyFacing: number,
  rn: ObjectID,
): boolean {
  if (decodeObjectID(rn).category !== DBType.MISC) return false;
  const objNI = NameIndex(dungeon, tables, partyFacing, rn);
  if (objNI < OBJNI_FIRST_KEY) return false;
  if (objNI > OBJNI_LAST_KEY) return false;
  return true;
}
