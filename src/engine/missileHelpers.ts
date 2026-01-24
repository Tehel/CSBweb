import { encodeObjectID, OBJECT_ID_EOF, type ObjectID, DBType } from '../core/types';
import type { DungeonData } from '../data/dungeonTypes';

const TORCH_NAME_INDEX = 4;
const MISSILE_TYPE_TORCH_MIN = 4;
const MISSILE_TYPE_TORCH_MAX = 7;
const MISSILE_TYPE_DAGGER = 32;
const MISSILE_TYPE_ARROW = 51;
const MISSILE_TYPE_SLAYER = 52;
const MISSILE_TYPE_ROCK = 54;
const MISSILE_TYPE_POISON_DART = 55;
const MISSILE_TYPE_THROWING_STAR = 56;
const MISSILE_TYPE_BOULDER = 128;

const WEAPON_TORCH = 2;
const WEAPON_DAGGER = 8;
const WEAPON_ARROW = 27;
const WEAPON_SLAYER = 28;
const WEAPON_ROCK = 30;
const WEAPON_POISON_DART = 31;
const WEAPON_THROWING_STAR = 32;
const MISC_BOULDER = 25;

const MAGIC_SPELL_BASE = 0xff80;

export function spellObjectId(missileType: number): ObjectID {
  return ((MAGIC_SPELL_BASE + (missileType & 0x7f)) & 0xffff) as ObjectID;
}

export function constructPredefinedMissile(data: DungeonData, missileType: number): ObjectID | null {
  let normalized = missileType | 0;
  if (normalized >= MISSILE_TYPE_TORCH_MIN && normalized <= MISSILE_TYPE_TORCH_MAX) {
    normalized = TORCH_NAME_INDEX;
  }

  let dbType: DBType | null = null;
  let weaponType: number | null = null;
  let miscType: number | null = null;

  switch (normalized) {
    case MISSILE_TYPE_ROCK:
      dbType = DBType.WEAPON;
      weaponType = WEAPON_ROCK;
      break;
    case MISSILE_TYPE_BOULDER:
      dbType = DBType.MISC;
      miscType = MISC_BOULDER;
      break;
    case MISSILE_TYPE_ARROW:
      dbType = DBType.WEAPON;
      weaponType = WEAPON_ARROW;
      break;
    case MISSILE_TYPE_SLAYER:
      dbType = DBType.WEAPON;
      weaponType = WEAPON_SLAYER;
      break;
    case MISSILE_TYPE_POISON_DART:
      dbType = DBType.WEAPON;
      weaponType = WEAPON_POISON_DART;
      break;
    case MISSILE_TYPE_THROWING_STAR:
      dbType = DBType.WEAPON;
      weaponType = WEAPON_THROWING_STAR;
      break;
    case MISSILE_TYPE_DAGGER:
      dbType = DBType.WEAPON;
      weaponType = WEAPON_DAGGER;
      break;
    case TORCH_NAME_INDEX:
      dbType = DBType.WEAPON;
      weaponType = WEAPON_TORCH;
      break;
    default:
      return null;
  }

  const maxIndex = 1023;
  const bumpCount = (): void => {
    const prev = data.header.objectCounts[dbType] ?? 0;
    data.header.objectCounts[dbType] = (prev + 1) & 0xffff;
  };

  if (dbType === DBType.WEAPON && weaponType !== null) {
    if (data.databases.weapons.records.length >= maxIndex + 1) return null;
    data.databases.weapons.records.push({
      nextObject: OBJECT_ID_EOF,
      broken: false,
      charges: 0,
      litTorch: false,
      poisoned: false,
      cursed: false,
      important: false,
      weaponType,
    });
    data.databases.weapons.count++;
    bumpCount();
    const newIndex = data.databases.weapons.records.length - 1;
    return encodeObjectID(0, DBType.WEAPON, newIndex);
  }

  if (dbType === DBType.MISC && miscType !== null) {
    if (data.databases.misc.records.length >= maxIndex + 1) return null;
    data.databases.misc.records.push({
      nextObject: OBJECT_ID_EOF,
      specialState: 0,
      important: false,
      miscType,
    });
    data.databases.misc.count++;
    bumpCount();
    const newIndex = data.databases.misc.records.length - 1;
    return encodeObjectID(0, DBType.MISC, newIndex);
  }

  return null;
}
