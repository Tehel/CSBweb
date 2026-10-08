/**
 * `FEEDPARAMETERS` and the apply half of `_FeedCharacter`
 * (`doc/CSBwin-src/Character.cpp:3956-4514`).
 *
 * CSBWin does not touch the champion while it works out what an object is worth. It
 * fills in a `FEEDPARAMETERS` block, hands the whole block to the feeding filter's DSAs
 * so a dungeon can rewrite any field of it, and only then applies the result. That
 * indirection is the reason the struct exists, so it is kept as one here: the UI half
 * in `src/renderer/ui/Feeding.ts` derives the block, `DsaSystem.feedingFilter` hands it
 * to the DSAs as the 27 words below, and this file applies it, reaching
 * the engine (`CurePoison`, `AdjustStamina`, `KillCharacter`, the shield timer) through
 * the context.
 *
 * The order below is CSBWin's own (`:4365-4440`) and matters: attributes, poison,
 * stamina, shield, mana, hit points, wounds, then water and food, then the
 * stamina/HP ceilings. A champion killed by the hit-point step never reaches the
 * wound heal.
 */
import { PotionType } from '../core/constants';
import {
  AttributeIndex,
  adjustCurrentAttribute,
} from './attributes';
import type { GameContext } from './GameContext';
import { CHARFLAG_PORTRAIT_CHANGED, type Champion } from './gameTypes';
import { drawCharacterState } from './Party';

/** `MAXMANA` (`doc/CSBwin-src/Character.cpp:4413`). */
const MAX_MANA = 900;
/** `LIMIT(-1023, …, 2048)` on food and water (`doc/CSBwin-src/Character.cpp:4440`). */
const FOOD_WATER_MIN = -1023;
const FOOD_WATER_MAX = 2048;

/**
 * `FEEDPARAMETERS` (`doc/CSBwin-src/Character.cpp:3956-3983`).
 *
 * `potionType`/`potionStrength` are marked readonly in CSBWin — the filter may look
 * at them but changing them does nothing, because the switch that reads them has
 * already run.
 */
export interface FeedParameters {
  performFeeding: boolean;
  characterIndex: number;
  objectDB: number;
  objectType: number;
  objectID: number;
  foodValue: number;
  waterValue: number;
  /** Readonly. */
  potionType: number;
  /** Readonly. */
  potionStrength: number;
  strengthAdjust: number;
  dexterityAdjust: number;
  wisdomAdjust: number;
  vitalityAdjust: number;
  antiVenin: boolean;
  staminaAdjust: number;
  shieldStrengthAdjust: number;
  shieldDuration: number;
  manaAdjust: number;
  hitpointAdjust: number;
  healCount: number;
  emptyFlask: boolean;
  emptyHand: boolean;
  chew: boolean;
  /** The sound ordinal, or -1 for silence — CSBWin's `fp.gulp`. */
  gulp: number;
  location: number;
  antiMagicAdjust: number;
  antiFireAdjust: number;
}

/** `FEEDPARAMETERS::Clear` (`doc/CSBwin-src/Character.cpp:3986-4014`). */
export function clearFeedParameters(): FeedParameters {
  return {
    performFeeding: false,
    characterIndex: -1,
    objectDB: -1,
    objectType: -1,
    objectID: -1,
    foodValue: 0,
    waterValue: 0,
    potionType: -1,
    potionStrength: -1,
    strengthAdjust: 0,
    dexterityAdjust: 0,
    wisdomAdjust: 0,
    vitalityAdjust: 0,
    antiVenin: false,
    staminaAdjust: 0,
    shieldStrengthAdjust: 0,
    shieldDuration: 0,
    manaAdjust: 0,
    hitpointAdjust: 0,
    healCount: 0,
    emptyFlask: false,
    emptyHand: false,
    chew: false,
    gulp: -1,
    location: -1,
    antiMagicAdjust: 0,
    antiFireAdjust: 0,
  };
}

/** `sizeof(fp) / 4` (`doc/CSBwin-src/Character.cpp:4351`): the 27 longwords of `FEEDPARAMETERS`. */
export const FEED_PARAMETER_WORDS = 27;

/**
 * `memcpy(pDSAparameters + 1, &fp, sizeof(fp))` (`doc/CSBwin-src/Character.cpp:4350`): the
 * block as the feeding filter's DSA sees it, a longword per field in the struct's order
 * (`:3953-3983`), a `bool32` 1 or 0.
 */
export function feedParametersToWords(fp: FeedParameters): number[] {
  const flag = (value: boolean): number => (value ? 1 : 0);
  return [
    flag(fp.performFeeding), fp.characterIndex, fp.objectDB, fp.objectType, fp.objectID,
    fp.foodValue, fp.waterValue, fp.potionType, fp.potionStrength,
    fp.strengthAdjust, fp.dexterityAdjust, fp.wisdomAdjust, fp.vitalityAdjust,
    flag(fp.antiVenin), fp.staminaAdjust, fp.shieldStrengthAdjust, fp.shieldDuration,
    fp.manaAdjust, fp.hitpointAdjust, fp.healCount,
    flag(fp.emptyFlask), flag(fp.emptyHand), flag(fp.chew), fp.gulp, fp.location,
    fp.antiMagicAdjust, fp.antiFireAdjust,
  ].map((word) => word | 0);
}

/**
 * `memcpy(&fp, pDSAparameters + 1, sizeof(fp))` (`doc/CSBwin-src/Character.cpp:4353`): the
 * block back from the feeding filter's DSA, `word(i)` its longword `i`. A `bool32` is
 * true when it is not 0, as CSBWin's tests of it read it.
 */
export function feedParametersFromWords(word: (index: number) => number): FeedParameters {
  const w = (index: number): number => word(index) | 0;
  return {
    performFeeding: w(0) !== 0,
    characterIndex: w(1),
    objectDB: w(2),
    objectType: w(3),
    objectID: w(4),
    foodValue: w(5),
    waterValue: w(6),
    potionType: w(7),
    potionStrength: w(8),
    strengthAdjust: w(9),
    dexterityAdjust: w(10),
    wisdomAdjust: w(11),
    vitalityAdjust: w(12),
    antiVenin: w(13) !== 0,
    staminaAdjust: w(14),
    shieldStrengthAdjust: w(15),
    shieldDuration: w(16),
    manaAdjust: w(17),
    hitpointAdjust: w(18),
    healCount: w(19),
    emptyFlask: w(20) !== 0,
    emptyHand: w(21) !== 0,
    chew: w(22) !== 0,
    gulp: w(23),
    location: w(24),
    antiMagicAdjust: w(25),
    antiFireAdjust: w(26),
  };
}

/**
 * What a potion is worth (`doc/CSBwin-src/Character.cpp:4159-4285`).
 *
 * The three derived terms come straight from the record's `strength`, and each potion
 * uses a different one, so they are computed up front exactly as CSBWin does:
 *
 * - `w_30 = 32 + (strength + 1) / 8`
 * - `w_14 = ((511 - strength) / w_30) / 2` — the *divisor* for the healing potions, so
 *   a stronger Vi potion (smaller `w_14`) restores a larger fraction of MaxHP;
 * - `w_12 = strength / 25 + 8` — the flat attribute bump.
 *
 * Every branch ends with `emptyFlask = true`, including the potion types with no case
 * of their own — but nothing happens for those, because the apply step is gated on
 * `performFeeding`.
 */
export function derivePotionFeeding(
  fp: FeedParameters,
  champ: Champion,
  potionType: number,
  strength: number,
): void {
  const w30 = 32 + Math.trunc((strength + 1) / 8);
  const w14 = Math.trunc(Math.trunc((511 - strength) / w30) / 2);
  const w12 = Math.trunc(strength / 25) + 8;

  fp.potionStrength = strength;
  fp.potionType = potionType;

  switch (potionType) {
    case PotionType.ROS_POTION:
      fp.dexterityAdjust = w12;
      fp.performFeeding = true;
      break;
    case PotionType.KU_POTION:
      fp.strengthAdjust = Math.trunc(strength / 35) + 5;
      fp.performFeeding = true;
      break;
    case PotionType.DANE_POTION:
      fp.wisdomAdjust = w12;
      fp.performFeeding = true;
      break;
    case PotionType.NETA_POTION:
      fp.vitalityAdjust = w12;
      fp.performFeeding = true;
      break;
    case PotionType.ANTI_VENIN:
      fp.antiVenin = true;
      fp.performFeeding = true;
      break;
    case PotionType.MON_POTION_B: {
      const maxStamina = champ.attributes.maxStamina | 0;
      const stamina = champ.attributes.stamina | 0;
      fp.staminaAdjust = Math.min(maxStamina - stamina, Math.trunc(maxStamina / w14));
      fp.performFeeding = true;
      break;
    }
    case PotionType.YA_POTION: {
      // A champion already well shielded gets a quarter of the benefit.
      let amount = w12 + Math.trunc(w12 / 2);
      if (champ.shieldStrength > 50) amount = Math.trunc(amount / 4);
      fp.shieldStrengthAdjust = amount;
      fp.shieldDuration = amount * amount;
      fp.performFeeding = true;
      break;
    }
    case PotionType.EE_POTION: {
      const mana = champ.attributes.mana | 0;
      const maxMana = champ.attributes.maxMana | 0;
      let target = Math.min(900, mana + w12 + w12 - 8);
      if (target > maxMana) {
        // Past the ceiling only half the excess is kept, measured from whichever of
        // the current and maximum mana is already higher.
        const from = Math.max(mana, maxMana);
        target -= Math.trunc((target - from) / 2);
      }
      fp.manaAdjust = target - mana;
      fp.performFeeding = true;
      break;
    }
    case PotionType.VI_POTION: {
      const maxHealth = champ.attributes.maxHealth | 0;
      const health = champ.attributes.health | 0;
      const healed = Math.min(health + Math.trunc(maxHealth / w14), maxHealth);
      fp.hitpointAdjust = healed - health;
      fp.healCount = Math.max(Math.trunc(strength / 42), 1);
      fp.performFeeding = true;
      break;
    }
    case PotionType.WATER_FLASK:
      fp.waterValue = 1600;
      fp.performFeeding = true;
      break;
    default:
      break;
  }
  fp.emptyFlask = true;
}

/**
 * The "Now we do the actual changes to the character's stats" block
 * (`doc/CSBwin-src/Character.cpp:4365-4447`).
 *
 * `chIdx` is the caller's, not `fp.characterIndex`: CSBWin resolves `pcA2` and `chIdx`
 * *before* handing the block to the filter and never re-reads them, so a filter that
 * rewrote `characterIndex` would be feeding the champion who reached for the mouth
 * anyway. The field stays in the block because the filter is allowed to read it.
 *
 * Returns whether anything was applied, which is CSBWin's `fp.performFeeding`.
 */
export function applyFeedParameters(
  ctx: GameContext,
  chIdx: number,
  fp: FeedParameters,
): boolean {
  if (!fp.performFeeding) return false;
  const party = ctx.party.state;
  const champ = party.champions[chIdx];
  if (!champ) return false;

  const stats = champ.attributes.stats;
  adjustCurrentAttribute(stats[AttributeIndex.Strength], fp.strengthAdjust);
  adjustCurrentAttribute(stats[AttributeIndex.Dexterity], fp.dexterityAdjust);
  adjustCurrentAttribute(stats[AttributeIndex.Wisdom], fp.wisdomAdjust);
  adjustCurrentAttribute(stats[AttributeIndex.Vitality], fp.vitalityAdjust);
  adjustCurrentAttribute(stats[AttributeIndex.AntiMagic], fp.antiMagicAdjust);
  adjustCurrentAttribute(stats[AttributeIndex.AntiFire], fp.antiFireAdjust);

  // `CurePoison` (`doc/CSBwin-src/Character.cpp:3012`).
  if (fp.antiVenin) ctx.systems.monsterAttack.curePoison(chIdx);
  // `AdjustStamina` (`doc/CSBwin-src/Code11f52.cpp:4451`), negated: `staminaAdjust` is a
  // gain, `AdjustStamina` takes a cost.
  ctx.systems.monsterAttack.adjustStamina(chIdx, -fp.staminaAdjust);

  if (fp.shieldStrengthAdjust !== 0) {
    // `shieldStrengthAdjust` is a `ui32` (`:3970`), so the sum `:4404` tests is unsigned and
    // never below 0: a negative adjustment, which only the filter makes, wraps to 16 bits.
    champ.shieldStrength = (champ.shieldStrength + fp.shieldStrengthAdjust) & 0xffff;
    // The `TT_72` shield-expiry timer (`doc/CSBwin-src/Character.cpp:4403-4408`).
    ctx.systems.timer.scheduleChampionShieldExpiry(
      chIdx,
      fp.shieldStrengthAdjust,
      fp.shieldDuration,
      party.position.z,
    );
    // `CHARFLAG_portraitChanged` (`:4410`), which the `DrawCharacterState` that ends the
    // feeding draws (`:4509`); nothing in between shows on the champion's box.
    drawCharacterState(party, chIdx, CHARFLAG_PORTRAIT_CHANGED, ctx.host);
  }

  // The unconfirmed champion in a Hall of Champions mirror takes no mana, no healing
  // and, above all, cannot be killed by a bad potion.
  if (party.potentialChampionIndex !== chIdx) {
    champ.attributes.mana = limit(0, (champ.attributes.mana | 0) + fp.manaAdjust, MAX_MANA);
    if ((champ.attributes.health | 0) + fp.hitpointAdjust <= 0) {
      // `KillCharacter` (`doc/CSBwin-src/Character.cpp:2531`).
      ctx.systems.monsterAttack.killCharacter(chIdx);
    } else {
      champ.attributes.health = (champ.attributes.health | 0) + fp.hitpointAdjust;
      // `STRandom()` — the whole 16-bit word, which the wound heal masks with.
      healWounds(champ, fp.healCount, () => ctx.random.next() & 0xffff);
    }
  }

  champ.water = limit(FOOD_WATER_MIN, (champ.water | 0) + fp.waterValue, FOOD_WATER_MAX);
  champ.food = limit(FOOD_WATER_MIN, (champ.food | 0) + fp.foodValue, FOOD_WATER_MAX);

  if ((champ.attributes.stamina | 0) > (champ.attributes.maxStamina | 0)) {
    champ.attributes.stamina = champ.attributes.maxStamina;
  }
  if ((champ.attributes.health | 0) > (champ.attributes.maxHealth | 0)) {
    champ.attributes.health = champ.attributes.maxHealth;
  }
  return true;
}

/**
 * The wound heal of a Vi potion (`doc/CSBwin-src/Character.cpp:4421-4436`).
 *
 * Not "heal N wounds": the wound mask is AND-ed with `healCount` fresh random words,
 * so each pass clears roughly half the remaining bits per draw. Up to ten passes are
 * tried, and the loop stops at the first pass that changed anything — after which
 * every further pass would use a single draw anyway, because `i_18` is set to 1.
 */
function healWounds(champ: Champion, healCount: number, random: () => number): void {
  let draws = healCount | 0;
  if (draws <= 0) return;
  const before = champ.wounds;
  if (before === 0) return;
  for (let pass = 10; pass !== 0; pass--) {
    for (let i = 0; i < draws; i++) {
      champ.wounds = champ.wounds & random() & 0xffff;
    }
    draws = 1;
    if (before !== champ.wounds) break;
  }
}

/** `LIMIT(min, value, max)`. */
function limit(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
