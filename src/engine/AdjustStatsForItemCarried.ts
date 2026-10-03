/**
 * `AdjustStatsForItemCarried` (`doc/CSBwin-src/Character.cpp:1569-1780`, `TAG0157e8`) —
 * what carrying an object does to its bearer.
 *
 * CSBWin calls it with `+1` from `AddCharacterPossession` (`:1970`) and with `-1` from
 * `RemoveCharacterPossession` (`:1858`), and brackets a curse change with a `-1` and a
 * `+1` in `SetCursed` (`:1801`, `:1815`). Every writer of a champion's slots must do the
 * same, or a bonus goes on along one path and comes off along another.
 *
 * The bonus is baked into the attributes, not recomputed: a CSBWin save stores the
 * adjusted values, and so does this port's.
 */
import { sw } from '../core/intCast';
import { DBType, type ObjectID } from '../core/types';
import {
  OBJNI_CLOAK_OF_NIGHT,
  OBJNI_CROSS_OF_NETA,
  OBJNI_CROWN_OF_NERRA,
  OBJNI_DEXHELM,
  OBJNI_DRAGON_FANG,
  OBJNI_DRAGON_SPIT,
  OBJNI_FLAMEBAIN,
  OBJNI_JEWEL_SYMAL_A,
  OBJNI_JEWEL_SYMAL_B,
  OBJNI_MACE_OF_ORDER,
  OBJNI_MOONSTONE,
  OBJNI_POWERTOWERS,
  OBJNI_RABBITS_FOOT,
  OBJNI_SCEPTRE_OF_LYF,
  OBJNI_SERPENT_STAFF,
  OBJNI_SIDE_SPLITTER,
  OBJNI_STAFF,
  OBJNI_STAFF_OF_CLAWS_A,
  OBJNI_STAFF_OF_CLAWS_C,
  OBJNI_STAFF_OF_IRRA,
  OBJNI_TEO_WAND,
  OBJNI_VORPAL_BLADE,
  OBJNI_WAND,
  OBJNI_YEW_STAFF,
} from '../core/objectNameIndex';
import { incrAttributeCurrent, incrAttributeMaximum, incrAttributeMinimum } from './attributes';
import type { DungeonState } from './DungeonState';
import type { Champion } from './gameTypes';

// `whatToAdjust` (`:1581-1592`) — the first seven are `Attributes[]` indices.
const adjustLuck = 0;
const adjustStrength = 1;
const adjustDexterity = 2;
const adjustWisdom = 3;
const adjustAntiMagic = 5;
const adjustAntiFire = 6;
const adjustMaxMana = 8;
const adjustIllegal = 99;

/**
 * `nameIndex` is `RN::NameIndex` with the caller's tables (`src/engine/objectIndex.ts`);
 * `dungeon` is where the `cursed()` bit is read.
 */
export function AdjustStatsForItemCarried(
  pChar: Champion,
  possessionIndex: number,
  addOrRemove: number,
  item: ObjectID,
  dungeon: DungeonState,
  nameIndex: (rn: ObjectID) => number,
): void {
  let whatToAdjust = adjustIllegal;
  const objNI = nameIndex(item);
  let D4W = 0; // Assume no adjustment to Luck
  const dbType = dungeon.rnMaps.dbType(item);
  for (;;) {
    // Fake to avoid 'goto's.
    if (dbType === DBType.WEAPON && possessionIndex >= 0 && possessionIndex <= 12) {
      // Weapon or clothing. Person, purse, or quiver.
      if (dungeon.getWeaponRecord(item)?.cursed) {
        whatToAdjust = adjustLuck;
        D4W = -3;
        break;
      }
    }
    if (dbType === DBType.CLOTHING && possessionIndex >= 0 && possessionIndex <= 12) {
      if (dungeon.getClothingRecord(item)?.cursed) {
        whatToAdjust = adjustLuck;
        D4W = -3;
        break;
      }
    }
    if (objNI === OBJNI_RABBITS_FOOT && possessionIndex < 30) {
      whatToAdjust = adjustLuck;
      D4W = 10;
      break;
    }
    if (possessionIndex === 1) {
      // Weapon hand
      if (objNI === OBJNI_MACE_OF_ORDER) {
        whatToAdjust = adjustStrength;
        D4W = 5;
        break;
      }
      whatToAdjust = adjustMaxMana;
      if (objNI >= OBJNI_STAFF_OF_CLAWS_A && objNI <= OBJNI_STAFF_OF_CLAWS_C) {
        D4W = 4;
      } else if (objNI >= OBJNI_STAFF && objNI <= OBJNI_SCEPTRE_OF_LYF) {
        switch (objNI) {
          case OBJNI_STAFF: D4W = 2; break;
          case OBJNI_WAND: D4W = 1; break;
          case OBJNI_TEO_WAND: D4W = 6; break;
          case OBJNI_YEW_STAFF: D4W = 4; break;
          case OBJNI_STAFF_OF_IRRA: D4W = 10; break;
          case OBJNI_CROSS_OF_NETA: D4W = 8; break;
          case OBJNI_SERPENT_STAFF: D4W = 16; break;
          case OBJNI_DRAGON_SPIT: D4W = 7; break;
          case OBJNI_SCEPTRE_OF_LYF: D4W = 5; break;
        }
      } else if (objNI === OBJNI_SIDE_SPLITTER) {
        D4W = 1;
      } else if (objNI === OBJNI_DRAGON_FANG) {
        D4W = 2;
      } else if (objNI === OBJNI_VORPAL_BLADE) {
        D4W = 4;
      }
      break;
    }
    if (possessionIndex === 4) {
      // Legs
      if (objNI === OBJNI_POWERTOWERS) {
        whatToAdjust = adjustStrength;
        D4W = 10;
      }
      break;
    }
    if (possessionIndex === 2) {
      // Head
      if (objNI === OBJNI_CROWN_OF_NERRA) {
        whatToAdjust = adjustWisdom;
        D4W = 10;
      } else if (objNI === OBJNI_DEXHELM) {
        whatToAdjust = adjustDexterity;
        D4W = 10;
      }
      break;
    }
    if (possessionIndex === 3) {
      // on Body
      if (objNI === OBJNI_FLAMEBAIN) {
        whatToAdjust = adjustAntiFire;
        D4W = 12;
      } else if (objNI === OBJNI_CLOAK_OF_NIGHT) {
        whatToAdjust = adjustDexterity;
        D4W = 8;
      }
      break;
    }
    if (possessionIndex !== 10) break; // Necklace
    if (objNI >= OBJNI_JEWEL_SYMAL_A && objNI <= OBJNI_JEWEL_SYMAL_B) {
      whatToAdjust = adjustAntiMagic;
      D4W = 15;
      break;
    }
    if (objNI === OBJNI_CLOAK_OF_NIGHT) {
      whatToAdjust = adjustDexterity;
      D4W = 8;
      break;
    }
    if (objNI !== OBJNI_MOONSTONE) break;
    whatToAdjust = adjustMaxMana;
    D4W = 3;
    break;
  }
  if (D4W === 0) return;
  if (whatToAdjust === adjustIllegal) throw new Error('AdjustStatsForItemCarried: Illegal adjust');
  D4W = sw(D4W * addOrRemove); // Increment or decrement
  if (whatToAdjust === adjustMaxMana) {
    pChar.attributes.maxMana = sw(pChar.attributes.maxMana + D4W);
  } else if (whatToAdjust <= adjustAntiFire) {
    const attribute = pChar.attributes.stats[whatToAdjust]!;
    incrAttributeMaximum(attribute, D4W);
    incrAttributeCurrent(attribute, D4W);
    incrAttributeMinimum(attribute, D4W);
  }
  // `charFlags |= CHARFLAG_chestOrScroll | CHARFLAG_statsChanged` has no counterpart:
  // the panels are drawn from live state every frame.
}
