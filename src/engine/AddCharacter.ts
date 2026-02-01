/**
 * AddCharacter helpers (CSBWin Character.cpp:716+)
 *
 * Maps preset hero inventory items to possession slots.
 */

import { DBType, type Direction, type ObjectID } from '../core/types';
import type { DatabaseRecord, HeroInventoryItem, PresetHero } from '../data/dungeonTypes';
import type { Champion } from './gameTypes';
import { createSkillsFromSubskillLevels } from './skills';

const FIGHTER_SUBSKILLS = ['Swing', 'Thrust', 'Club', 'Parry'];
const NINJA_SUBSKILLS = ['Steal', 'Fight', 'Throw', 'Shoot'];
const PRIEST_SUBSKILLS = ['Identify', 'Heal', 'Influence', 'Defend'];
const WIZARD_SUBSKILLS = ['Fire', 'Air', 'Earth', 'Water'];

export interface AddCharacterTables {
  carryLocation: ArrayLike<number>;
  objDescCarryMask: ArrayLike<number>;
}

export function assignPresetHeroPossessions(
  items: HeroInventoryItem[],
  tables: AddCharacterTables,
): Array<ObjectID | null> {
  const possessions: Array<ObjectID | null> = new Array(30).fill(null);
  let nextBackpackSlot = 13;

  for (const item of items) {
    const carryMask = getCarryMask(item, tables.objDescCarryMask);
    const canNeck = carryMask !== null && (carryMask & getCarryLocation(tables.carryLocation, 10)) !== 0;

    let slot = -1;
    switch (item.category) {
      case DBType.CLOTHING:
        for (let loc = 2; loc <= 5; loc++) {
          if (carryMask === null) continue;
          if ((carryMask & getCarryLocation(tables.carryLocation, loc)) !== 0) {
            slot = loc;
            break;
          }
        }
        if (slot === -1) {
          if (canNeck && possessions[10] === null) {
            slot = 10;
          } else {
            slot = -1;
          }
        }
        break;
      case DBType.WEAPON:
        if (possessions[1] === null) slot = 1;
        break;
      case DBType.SCROLL:
      case DBType.POTION:
        if (possessions[11] === null) slot = 11;
        else if (possessions[6] === null) slot = 6;
        break;
      case DBType.CHEST:
      case DBType.MISC:
        slot = -1;
        break;
      default:
        slot = -1;
        break;
    }

    if (slot >= 0 && possessions[slot] !== null) {
      slot = -1;
    }

    if (slot < 0) {
      if (canNeck && possessions[10] === null) {
        slot = 10;
      } else {
        slot = nextBackpackSlot++;
      }
    }

    if (slot >= 0 && slot < possessions.length) {
      possessions[slot] = item.rn;
    }
  }

  return possessions;
}

export function createChampionFromPreset(
  hero: PresetHero,
  partyPosition: number,
  possessions?: Array<ObjectID | null>,
): Champion {
  const maxHealth = hero.health;
  const maxStamina = hero.stamina;
  const maxMana = hero.mana;
  const fighter = maxSkill(hero.fighter);
  const ninja = maxSkill(hero.ninja);
  const priest = maxSkill(hero.priest);
  const wizard = maxSkill(hero.wizard);
  const slots = possessions ?? new Array(30).fill(null);
  const skills = createSkillsFromSubskillLevels(getPresetSubskillLevels(hero));

  return {
    name: hero.name,
    title: hero.title,
    attributes: {
      health: maxHealth,
      maxHealth,
      stamina: maxStamina,
      maxStamina,
      mana: maxMana,
      maxMana,
      luck: hero.luck,
      strength: hero.strength,
      dexterity: hero.dexterity,
      wisdom: hero.wisdom,
      vitality: hero.vitality,
      antiMagic: hero.antiMagic,
      antiFire: hero.antiFire,
      experience: 0,
      fighter,
      ninja,
      priest,
      wizard,
    },
    alive: true,
    portraitGraphic: hero.portraitIndex,
    incantation: [],
    food: 1500,
    water: 1500,
    skills,
    actionDisabledUntil: 0,
    busyTimerIndex: -1,
    weaponHand: slots[1] ?? null,
    shieldHand: slots[0] ?? null,
    quiver: slots[8] ?? null,
    possessions: slots,
    partyPosition,
    facing: (partyPosition & 3) as Direction,
  };
}

function maxSkill(skills: Record<string, number>): number {
  let max = 0;
  for (const value of Object.values(skills)) {
    if (value > max) max = value;
  }
  return max;
}

function getPresetSubskillLevels(hero: PresetHero): number[] {
  return [
    ...collectLevels(hero.fighter, FIGHTER_SUBSKILLS),
    ...collectLevels(hero.ninja, NINJA_SUBSKILLS),
    ...collectLevels(hero.priest, PRIEST_SUBSKILLS),
    ...collectLevels(hero.wizard, WIZARD_SUBSKILLS),
  ];
}

function collectLevels(skills: Record<string, number>, names: string[]): number[] {
  return names.map((name) => {
    const value = skills[name];
    return typeof value === 'number' ? value : 0;
  });
}

function getCarryLocation(carryLocation: ArrayLike<number>, slot: number): number {
  const value = carryLocation[slot];
  return typeof value === 'number' ? value : 0;
}

function getCarryMask(item: HeroInventoryItem, masks: ArrayLike<number>): number | null {
  const objDescIndex = getObjDescIndex(item.category, item.record);
  if (objDescIndex === null) return null;
  const mask = masks[objDescIndex];
  return typeof mask === 'number' ? mask : null;
}

function getObjDescIndex(category: DBType, record: DatabaseRecord | null): number | null {
  if (!record) return null;
  switch (category) {
    case DBType.SCROLL:
      return 0;
    case DBType.CHEST:
      return 1;
    case DBType.POTION: {
      const potionType = (record as { potionType?: number }).potionType;
      return typeof potionType === 'number' ? 2 + potionType : null;
    }
    case DBType.WEAPON: {
      const weaponType = (record as { weaponType?: number }).weaponType;
      return typeof weaponType === 'number' ? 23 + weaponType : null;
    }
    case DBType.CLOTHING: {
      const clothingType = (record as { clothingType?: number }).clothingType;
      return typeof clothingType === 'number' ? 69 + clothingType : null;
    }
    case DBType.MISC: {
      const miscType = (record as { miscType?: number }).miscType;
      return typeof miscType === 'number' ? 127 + miscType : null;
    }
    default:
      return null;
  }
}
