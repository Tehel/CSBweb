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
 * (`Character.cpp:1931`, `:1970`, `Mouse.cpp:643`, `:1225`, `CSBCode.cpp:4532`,
 * `:6936`, `Magic.cpp:1257`). `characterLoad()` here re-sums the possessions instead.
 * The value is the same — the cache is only ever the running sum of those weights —
 * and a recomputation cannot drift out of step with the inventory the way a cache
 * spread across the UI and the engine can. Recorded in PLAN.md.
 */
import { applyLimits, div, sw } from '../core/intCast';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, type ObjectID } from '../core/types';
import { nameIndexOf, type GameContext } from './GameContext';
import { getChampionPossession, type Champion } from './gameTypes';
import { determineMastery } from './skills';
import { OBJNI_BOOTS_OF_SPEED, OBJNI_ELVEN_BOOTS } from '../core/objectNameIndex';
import type { WeaponDesc } from '../data/tables/ObjectTables';
import { AttributeIndex, championAttribute } from './attributes';
import { PotionType } from '../core/constants';

/** `potion_EmptyFlask`. */
/** `misc_WaterSkin` — the one misc type whose weight depends on how full it is. */
const MISC_WATERSKIN = 1;
/**
 * The chest's own weight before its contents. CSBWin reads it from the expansion pool
 * (`EDBT_ObjectWeights`) and falls back to 50 when a dungeon does not override it
 * (`doc/CSBwin-src/Mouse.cpp:65-68`); the shipped DM dungeon does not override it.
 */
const DEFAULT_CHEST_WEIGHT = 50;

export class CharacterStats {
  constructor(private readonly ctx: GameContext) {}

  /**
   * `GetObjectWeight` / `TAG0091e6` (`doc/CSBwin-src/Mouse.cpp:30`) — in tenths of a
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

    const { category } = this.ctx.dungeon.rnMaps.decode(rn);
    switch (category) {
      case DBType.WEAPON: {
        const rec = this.ctx.dungeon.getWeaponRecord(rn);
        if (!rec) return 0;
        return this.ctx.tables.weaponWeights[rec.weaponType] ?? 0;
      }
      case DBType.CLOTHING: {
        const rec = this.ctx.dungeon.getClothingRecord(rn);
        if (!rec) return 0;
        return this.ctx.tables.clothingWeights[rec.clothingType] ?? 0;
      }
      case DBType.MISC: {
        const rec = this.ctx.dungeon.getMiscRecord(rn);
        if (!rec) return 0;
        let weight = this.ctx.tables.byte8946[rec.miscType] ?? 0;
        // A waterskin weighs its contents.
        if (rec.miscType === MISC_WATERSKIN) weight += 2 * (rec.specialState ?? 0);
        return weight;
      }
      case DBType.CHEST: {
        const rec = this.ctx.dungeon.getContainerRecord(rn);
        let total = DEFAULT_CHEST_WEIGHT;
        let obj = rec?.containedObject ?? OBJECT_ID_EOF;
        while (obj !== OBJECT_ID_EOF && obj !== OBJECT_ID_NULL) {
          total += this.getObjectWeight(obj, visited);
          obj = this.ctx.dungeon.getDBRecordLink(obj);
        }
        return total;
      }
      case DBType.POTION: {
        const rec = this.ctx.dungeon.getPotionRecord(rn);
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
    const visited = new Set<number>();
    let total = 0;
    for (const item of champ.possessions) {
      if (item === OBJECT_ID_NULL) continue;
      total += this.getObjectWeight(item, visited);
    }
    return total;
  }

  /**
   * `MaxLoad` (`doc/CSBwin-src/Code11f52.cpp:4318`) — what the champion can carry
   * before slowing down, rounded down to a multiple of 10.
   */
  maxLoad(champ: Champion): number {
    let maxLoad = sw(8 * championAttribute(champ, AttributeIndex.Strength) + 100);
    maxLoad = staminaAdjustedAttribute(champ, maxLoad);

    const wounds = champ.wounds;
    if (wounds !== 0) {
      // A wounded torso costs a quarter of the allowance, any other wound an eighth.
      const shift = (wounds & 16) !== 0 ? 2 : 3;
      maxLoad = sw(maxLoad - (maxLoad >> shift));
    }

    const feet = getChampionPossession(champ, 5);
    if (feet !== OBJECT_ID_NULL && nameIndexOf(this.ctx, feet) === OBJNI_ELVEN_BOOTS) {
      maxLoad = sw(maxLoad + (maxLoad >> 4));
    }

    maxLoad += 9;
    maxLoad = sw(maxLoad - ((maxLoad & 0xffff) % 10));
    return maxLoad;
  }

  /**
   * `TimeToMove` (`doc/CSBwin-src/CSBCode.cpp:7062`) — the ticks this champion needs
   * between steps. 2 unladen, 3 past five-eighths of `MaxLoad`, and past `MaxLoad`
   * 4 plus a quarter-load per excess `MaxLoad`; a wounded foot (`ouches & 32`) adds 1,
   * or 2 when overloaded, and Boots of Speed take 1 off.
   */
  timeToMove(champ: Champion): number {
    const maxLoad = this.maxLoad(champ);
    const load = this.characterLoad(champ);
    let time: number;
    let footPenalty: number;
    if (maxLoad > load) {
      time = 2;
      if (8 * (load & 0xffff) > 5 * (maxLoad & 0xffff)) time++;
      footPenalty = 1;
    } else {
      time = 4;
      time = sw(time + div((4 * (load - maxLoad)) & 0xffff, maxLoad));
      footPenalty = 2;
    }
    if ((champ.wounds & 32) !== 0) time = sw(time + footPenalty);
    const feet = getChampionPossession(champ, 5);
    if (feet !== OBJECT_ID_NULL && nameIndexOf(this.ctx, feet) === OBJNI_BOOTS_OF_SPEED) time--;
    return time;
  }

  /**
   * `DetermineThrowingDistance` (`doc/CSBwin-src/Character.cpp:2272`) — 0 to 100.
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
    let d7 = sw((this.ctx.random.next() & 15) + championAttribute(champ, AttributeIndex.Strength));

    const obj = getChampionPossession(champ, hand);
    const weight = sw(obj !== OBJECT_ID_NULL ? this.getObjectWeight(obj) : 0);
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

    if (typeof obj === 'number' && this.ctx.dungeon.rnMaps.dbType(obj as ObjectID) === DBType.WEAPON) {
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
    if (handWoundMask & champ.wounds) d7 = div(d7, 2);

    return applyLimits(0, div(d7, 2), 100);
  }

  /**
   * `Quickness` (`doc/CSBwin-src/Character.cpp:2214`) — roughly
   * `0.5 * Dexterity * (1 - load/maxLoad/2)`, with random limits near 5 and 95.
   */
  quickness(champ: Champion, partySleeping: boolean): number {
    let quickness = championAttribute(champ, AttributeIndex.Dexterity) + this.ctx.random.below(8);

    const max = this.maxLoad(champ);
    if (max > 0) {
      quickness -= div(div(quickness, 2) * this.characterLoad(champ), max);
    }

    if (partySleeping) quickness = div(quickness, 2);
    quickness = div(quickness, 2);

    const loLimit = this.ctx.random.below(8) + 1;
    const hiLimit = 100 - this.ctx.random.below(8);
    return applyLimits(loLimit, quickness, hiLimit);
  }


  /** `TAG0099d2` (`doc/CSBwin-src/Code51a4.cpp:2875`). */
  weaponDescFor(rn: ObjectID): WeaponDesc | null {
    const rec = this.ctx.dungeon.getWeaponRecord(rn);
    if (!rec) return null;
    return this.ctx.tables.weaponDesc[rec.weaponType] ?? null;
  }

  /**
   * `DetermineMastery(chIdx, skill)` with **no flag bits**: CSBWin's throwing chain
   * passes the plain skill number (`doc/CSBwin-src/Character.cpp:2338`), so the
   * temporary adjustment and the Firestaff/pendant possession bonuses both count.
   */
  private mastery(champ: Champion, skill: number, partySleeping: boolean): number {
    return determineMastery(champ, skill, {
      partySleeping,
      getObjectNameIndex: (objectId: ObjectID) => nameIndexOf(this.ctx, objectId),
    });
  }
}

/**
 * `StaminaAdjustedAttribute` (`doc/CSBwin-src/Code11f52.cpp:4291`) — below half
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
