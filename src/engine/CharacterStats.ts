/**
 * The character-stat chain from `doc/CSBwin-src/Character.cpp` and
 * `doc/CSBwin-src/Code11f52.cpp`: what a champion weighs, what they can carry, how
 * fast they dodge, and how far they can throw.
 *
 * These four things share one dependency chain — `GetObjectWeight` → `MaxLoad` →
 * `DetermineThrowingDistance` — and until this module existed the engine had none of
 * it. Three separate places were estimating around the gap: `Game`'s throw range,
 * damage and decay were invented formulas, `TAG01680a` dropped the throwing-distance
 * term from a shield held in hand, and `Quickness` ignored load entirely so a laden
 * champion dodged as well as an empty one.
 *
 * **One structural divergence, deliberate.** CSBWin caches the carried weight in
 * `CHARDESC.load` and adjusts it at each of its eight possession writers
 * (`Character.cpp:1926`, `:1965`, `Mouse.cpp:642`, `:1224`, `CSBCode.cpp:4467`,
 * `:6877`, `Magic.cpp:1255`). `characterLoad()` here re-sums the possessions instead.
 * The value is the same — the cache is only ever the running sum of those weights —
 * and a recomputation cannot drift out of step with the inventory the way a cache
 * spread across the UI and the engine can. Recorded in PLAN.md.
 */
import type { CsbRandom } from '../core/random';
import { DBType, decodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, type ObjectID } from '../core/types';
import type { DungeonState } from './DungeonState';
import type { Champion } from './gameTypes';
import { determineMastery } from './skills';
import { OBJNI_ELVEN_BOOTS } from '../core/objectNameIndex';
import type { WeaponDesc } from '../renderer/csbwin/ObjectTables';
import { AttributeIndex, championAttribute } from './attributes';
import { PotionType } from '../core/constants';

/** `potion_EmptyFlask`. */
/** `misc_WaterSkin` — the one misc type whose weight depends on how full it is. */
const MISC_WATERSKIN = 1;
/**
 * The chest's own weight before its contents. CSBWin reads it from the expansion pool
 * (`EDBT_ObjectWeights`) and falls back to 50 when a dungeon does not override it
 * (`doc/CSBwin-src/Mouse.cpp:64-67`); the shipped DM dungeon does not override it.
 */
const DEFAULT_CHEST_WEIGHT = 50;

export interface CharacterStatsTables {
  /** `d.weapons[46]` (`WEAPONDESC`), via `TAG0099d2`. */
  weaponDesc?: ArrayLike<WeaponDesc>;
  /** `d.weapons[46].weight`. */
  weaponWeights?: ArrayLike<number>;
  /** `d.ClothingDesc[58].weight`. */
  clothingWeights?: ArrayLike<number>;
  /** `d.Byte8946[54]` — misc object weights. */
  miscWeights?: ArrayLike<number>;
}

export interface CharacterStatsDeps {
  dungeon: DungeonState;
  tables: CharacterStatsTables;
  random: CsbRandom;
  /**
   * `RN::NameIndex()`. Supplied rather than derived: the desc-index walk already
   * exists three times over (`Game`, `ActuatorSystem`, `renderer/ui/Objects`), and a
   * fourth copy here would be one more place for them to disagree.
   */
  nameIndex(rn: ObjectID): number;
}

/** C's integer division: truncate toward zero, not toward negative infinity. */
const div = (a: number, b: number): number => Math.trunc(a / b);
/** `sw()` — signed 16-bit truncation, which CSBWin applies to every intermediate. */
const sw = (v: number): number => (v << 16) >> 16;
/** `ApplyLimits(min, value, max)`. */
const applyLimits = (min: number, value: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export class CharacterStats {
  constructor(private deps: CharacterStatsDeps) {}

  /** Replace the tables after a later load (the graphics may arrive after the engine). */
  setTables(tables: CharacterStatsTables): void {
    this.deps.tables = { ...this.deps.tables, ...tables };
  }

  /**
   * `GetObjectWeight` / `TAG0091e6` (`doc/CSBwin-src/Mouse.cpp:29`) — in tenths of a
   * kilogram. Recursive for chests.
   *
   * `visited` is ours, not CSBWin's: the C++ walks the contents chain with no cycle
   * guard, and a corrupt save would hang it.
   */
  getObjectWeight(item: ObjectID | number | null | undefined, visited = new Set<number>()): number {
    if (item === null || item === undefined) return 0;
    if (item === OBJECT_ID_NULL || item === OBJECT_ID_EOF) return 0;
    const rn = item as ObjectID;
    if (visited.has(rn)) return 0;
    visited.add(rn);

    const { category } = decodeObjectID(rn);
    switch (category) {
      case DBType.WEAPON: {
        const rec = this.deps.dungeon.getWeaponRecord(rn);
        if (!rec) return 0;
        return this.deps.tables.weaponWeights?.[rec.weaponType] ?? 0;
      }
      case DBType.CLOTHING: {
        const rec = this.deps.dungeon.getClothingRecord(rn);
        if (!rec) return 0;
        return this.deps.tables.clothingWeights?.[rec.clothingType] ?? 0;
      }
      case DBType.MISC: {
        const rec = this.deps.dungeon.getMiscRecord(rn);
        if (!rec) return 0;
        let weight = this.deps.tables.miscWeights?.[rec.miscType] ?? 0;
        // A waterskin weighs its contents.
        if (rec.miscType === MISC_WATERSKIN) weight += 2 * (rec.specialState ?? 0);
        return weight;
      }
      case DBType.CHEST: {
        const rec = this.deps.dungeon.getContainerRecord(rn);
        let total = DEFAULT_CHEST_WEIGHT;
        let obj = rec?.containedObject ?? OBJECT_ID_EOF;
        while (obj !== OBJECT_ID_EOF && obj !== OBJECT_ID_NULL) {
          total += this.getObjectWeight(obj, visited);
          obj = this.deps.dungeon.getDBRecordLink(obj);
        }
        return total;
      }
      case DBType.POTION: {
        const rec = this.deps.dungeon.getPotionRecord(rn);
        if (!rec) return 0;
        return rec.potionType === PotionType.EMPTY_FLASK ? 1 : 3;
      }
      case DBType.SCROLL:
        return 1;
      default:
        return 0;
    }
  }

  /**
   * `CHARDESC.load` — everything the champion is carrying, in tenths of a kilogram.
   * Re-summed rather than cached; see the module comment.
   */
  characterLoad(champ: Champion): number {
    const items: Array<number | null | undefined> = champ.possessions?.length
      ? champ.possessions
      : [champ.shieldHand, champ.weaponHand, champ.quiver];
    const visited = new Set<number>();
    let total = 0;
    for (const item of items) {
      if (typeof item !== 'number') continue;
      total += this.getObjectWeight(item as ObjectID, visited);
    }
    return total;
  }

  /**
   * `MaxLoad` (`doc/CSBwin-src/Code11f52.cpp:4280`) — what the champion can carry
   * before slowing down, rounded down to a multiple of 10.
   */
  maxLoad(champ: Champion): number {
    let maxLoad = sw(8 * championAttribute(champ, AttributeIndex.Strength) + 100);
    maxLoad = staminaAdjustedAttribute(champ, maxLoad);

    const wounds = champ.wounds ?? 0;
    if (wounds !== 0) {
      // A wounded torso costs a quarter of the allowance, any other wound an eighth.
      const shift = (wounds & 16) !== 0 ? 2 : 3;
      maxLoad = sw(maxLoad - (maxLoad >> shift));
    }

    const feet = this.possession(champ, 5);
    if (feet !== null && this.deps.nameIndex(feet) === OBJNI_ELVEN_BOOTS) {
      maxLoad = sw(maxLoad + (maxLoad >> 4));
    }

    maxLoad += 9;
    maxLoad = sw(maxLoad - ((maxLoad & 0xffff) % 10));
    return maxLoad;
  }

  /**
   * `DetermineThrowingDistance` (`doc/CSBwin-src/Character.cpp:2267`) — 0 to 100.
   *
   * Not only a throw statistic: `TAG01680a` adds it to the protection a shield held
   * in that hand gives, so it is really "how well this champion is handling what is
   * in this hand". Strength and a random term set the base; the object's weight
   * relative to a sixteenth of the max load moves it up or down, sharply downward
   * once the thing is properly heavy; a weapon adds `uByte2` and twice the mastery of
   * whichever skill its `uByte1` class selects; low stamina scales the lot; and a
   * wound on that very hand halves it.
   */
  determineThrowingDistance(champ: Champion, hand: number, partySleeping = false): number {
    let d7 = sw((this.deps.random.next() & 15) + championAttribute(champ, AttributeIndex.Strength));

    const obj = this.possession(champ, hand);
    const weight = sw(typeof obj === 'number' ? this.getObjectWeight(obj as ObjectID) : 0);
    const sixteenth = sw(div(this.maxLoad(champ), 16));

    if (weight <= sixteenth) {
      d7 = sw(d7 + weight - 12);
    } else {
      const midpoint = sw(div(sixteenth - 12, 2) + sixteenth);
      if (weight <= midpoint) {
        d7 = sw(d7 + div(weight - sixteenth, 2));
      } else {
        d7 = sw(d7 - 2 * (weight - midpoint));
      }
    }

    if (typeof obj === 'number' && decodeObjectID(obj as ObjectID).category === DBType.WEAPON) {
      const desc = this.weaponDescFor(obj as ObjectID);
      if (desc) {
        d7 = sw(d7 + desc.uByte2);
        const weaponClass = desc.uByte1;
        let mastery = 0;
        if (weaponClass === 0 || weaponClass === 2) mastery = this.mastery(champ, 4, partySleeping);
        if (weaponClass !== 0 && weaponClass < 16) mastery = sw(mastery + this.mastery(champ, 10, partySleeping));
        if (weaponClass >= 16 && weaponClass < 112) mastery = sw(mastery + this.mastery(champ, 11, partySleeping));
        d7 = sw(d7 + 2 * mastery);
      }
    }

    d7 = staminaAdjustedAttribute(champ, d7);

    // A wound on the hand doing the work halves it: bit 1 for hand 0, bit 2 for hand 1.
    const handWoundMask = hand === 0 ? 1 : 2;
    if (handWoundMask & (champ.wounds ?? 0)) d7 = div(d7, 2);

    return applyLimits(0, div(d7, 2), 100);
  }

  /**
   * `Quickness` (`doc/CSBwin-src/Character.cpp:2209`) — roughly
   * `0.5 * Dexterity * (1 - load/maxLoad/2)`, with random limits near 5 and 95.
   */
  quickness(champ: Champion, partySleeping: boolean): number {
    let quickness = championAttribute(champ, AttributeIndex.Dexterity) + this.deps.random.below(8);

    const max = this.maxLoad(champ);
    if (max > 0) {
      quickness -= div(div(quickness, 2) * this.characterLoad(champ), max);
    }

    if (partySleeping) quickness = div(quickness, 2);
    quickness = div(quickness, 2);

    const loLimit = this.deps.random.below(8) + 1;
    const hiLimit = 100 - this.deps.random.below(8);
    return applyLimits(loLimit, quickness, hiLimit);
  }

  /**
   * `CHARDESC::Possession(slot)`, with the same fallback the rest of the engine uses
   * for champions that carry only the two hand slots rather than the full 30.
   */
  private possession(champ: Champion, slot: number): ObjectID | null {
    if (champ.possessions && slot >= 0 && slot < champ.possessions.length) {
      const value = champ.possessions[slot];
      if (typeof value === 'number') return value as ObjectID;
      return null;
    }
    if (slot === 0 && typeof champ.shieldHand === 'number') return champ.shieldHand as ObjectID;
    if (slot === 1 && typeof champ.weaponHand === 'number') return champ.weaponHand as ObjectID;
    return null;
  }

  /** `TAG0099d2` (`doc/CSBwin-src/Code51a4.cpp:2875`). */
  weaponDescFor(rn: ObjectID): WeaponDesc | null {
    const rec = this.deps.dungeon.getWeaponRecord(rn);
    if (!rec) return null;
    return this.deps.tables.weaponDesc?.[rec.weaponType] ?? null;
  }

  /**
   * `DetermineMastery(chIdx, skill)` with **no flag bits**: CSBWin's throwing chain
   * passes the plain skill number (`doc/CSBwin-src/Character.cpp:2333`), so the
   * temporary adjustment and the Firestaff/pendant possession bonuses both count.
   */
  private mastery(champ: Champion, skill: number, partySleeping: boolean): number {
    return determineMastery(champ, skill, {
      partySleeping,
      getObjectNameIndex: (objectId: number) => this.deps.nameIndex(objectId as ObjectID),
    });
  }
}

/**
 * `StaminaAdjustedAttribute` (`doc/CSBwin-src/Code11f52.cpp:4253`) — below half
 * stamina an attribute is halved and then scaled by how much stamina is left.
 *
 * Free-standing because the renderer's load display needs it too, and because it
 * needs nothing but the champion.
 */
export function staminaAdjustedAttribute(champ: Champion, baseValue: number): number {
  const stamina = champ.attributes?.stamina ?? 0;
  const half = sw(div(champ.attributes?.maxStamina ?? 0, 2));
  if (stamina >= half) return baseValue;

  const halved = sw(div(baseValue, 2));
  return sw(halved + div(halved * stamina, half));
}
