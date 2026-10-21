/**
 * `FEEDPARAMETERS` and the apply half of `_FeedCharacter`
 * (`doc/CSBwin-src/Character.cpp:3956-4514`).
 *
 * CSBWin does not touch the champion while it works out what an object is worth. It
 * fills in a `FEEDPARAMETERS` block, hands the whole block to the feeding filter's DSAs
 * so a dungeon can rewrite any field of it, and only then applies the result. That
 * indirection is the reason the struct exists, so it is kept as one here: the UI half
 * in `src/renderer/ui/Feeding.ts` derives the block, `DsaSystem.feedingFilter` hands it
 * to the DSAs as 27 words (`filterParameters.ts`), and this file applies it, reaching
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
import { CHARFLAG_PORTRAIT_CHANGED } from '../core/charDesc';
import type { Champion } from './gameTypes';
import { drawCharacterState } from './Party';
import type { FeedParameters } from './filterParameters';

/** `MAXMANA` (`doc/CSBwin-src/Character.cpp:4413`). */
const MAX_MANA = 900;
/** `LIMIT(-1023, …, 2048)` on food and water (`doc/CSBwin-src/Character.cpp:4440`). */
const FOOD_WATER_MIN = -1023;
export const FOOD_WATER_MAX = 2048;
/** What a gulp from a waterskin gives (`doc/CSBwin-src/Character.cpp:4127`). */
export const WATERSKIN_GULP = 800;

/**
 * What a potion does before the drinker is looked at: the half of `_FeedCharacter`'s
 * `switch (fp.potionType)` (`doc/CSBwin-src/Character.cpp:4159-4285`) that reads the
 * potion alone. `derivePotionFeeding` finishes it on the champion, and the eye's item
 * properties show it (`getItemPropertyLines`, `src/renderer/ui/Objects.ts`).
 *
 * The three derived terms come straight from the record's `strength`, and each potion
 * uses a different one, so they are computed up front exactly as CSBWin does:
 *
 * - `w_30 = 32 + (strength + 1) / 8`
 * - `w_14 = ((511 - strength) / w_30) / 2` — the *divisor* for the healing potions, so
 *   a stronger Vi potion (smaller `w_14`) restores a larger fraction of MaxHP;
 * - `w_12 = strength / 25 + 8` — the flat attribute bump.
 *
 * `drinkable` is the switch's `fp.performFeeding = true`: a type with no case of its own
 * leaves it as it was.
 */
interface PotionEffect {
  drinkable: boolean;
  dexterityAdjust: number;
  strengthAdjust: number;
  wisdomAdjust: number;
  vitalityAdjust: number;
  antiVenin: boolean;
  /** Mon B's `w_14`: it gives back `1 / w_14` of the maximum stamina. */
  staminaDivisor: number;
  /** Vi's `w_14`: it gives back `1 / w_14` of the maximum hit points. */
  hitpointDivisor: number;
  /** Ya's shield, quartered for a champion already shielded past 50. */
  shieldStrength: number;
  /** EE's `w_12 + w_12 - 8`, added to the mana before the 900 cap and the halving past MaxMana. */
  mana: number;
  /** Vi's wound heals. */
  healCount: number;
  waterValue: number;
}

export function potionEffect(potionType: number, strength: number): PotionEffect {
  const w30 = 32 + Math.trunc((strength + 1) / 8);
  const w14 = Math.trunc(Math.trunc((511 - strength) / w30) / 2);
  const w12 = Math.trunc(strength / 25) + 8;
  const effect: PotionEffect = {
    drinkable: false, dexterityAdjust: 0, strengthAdjust: 0, wisdomAdjust: 0, vitalityAdjust: 0,
    antiVenin: false, staminaDivisor: 0, hitpointDivisor: 0, shieldStrength: 0, mana: 0, healCount: 0, waterValue: 0,
  };

  switch (potionType) {
    case PotionType.ROS_POTION:
      effect.dexterityAdjust = w12;
      effect.drinkable = true;
      break;
    case PotionType.KU_POTION:
      effect.strengthAdjust = Math.trunc(strength / 35) + 5;
      effect.drinkable = true;
      break;
    case PotionType.DANE_POTION:
      effect.wisdomAdjust = w12;
      effect.drinkable = true;
      break;
    case PotionType.NETA_POTION:
      effect.vitalityAdjust = w12;
      effect.drinkable = true;
      break;
    case PotionType.ANTI_VENIN:
      effect.antiVenin = true;
      effect.drinkable = true;
      break;
    case PotionType.MON_POTION_B:
      effect.staminaDivisor = w14;
      effect.drinkable = true;
      break;
    case PotionType.YA_POTION:
      effect.shieldStrength = w12 + Math.trunc(w12 / 2);
      effect.drinkable = true;
      break;
    case PotionType.EE_POTION:
      effect.mana = w12 + w12 - 8;
      effect.drinkable = true;
      break;
    case PotionType.VI_POTION:
      effect.hitpointDivisor = w14;
      effect.healCount = Math.max(Math.trunc(strength / 42), 1);
      effect.drinkable = true;
      break;
    case PotionType.WATER_FLASK:
      effect.waterValue = 1600;
      effect.drinkable = true;
      break;
    default:
      break;
  }
  return effect;
}

/**
 * What a potion is worth to `champ` (`doc/CSBwin-src/Character.cpp:4159-4285`):
 * `potionEffect`, finished on the champion.
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
  const effect = potionEffect(potionType, strength);

  fp.potionStrength = strength;
  fp.potionType = potionType;

  switch (potionType) {
    case PotionType.ROS_POTION:
      fp.dexterityAdjust = effect.dexterityAdjust;
      break;
    case PotionType.KU_POTION:
      fp.strengthAdjust = effect.strengthAdjust;
      break;
    case PotionType.DANE_POTION:
      fp.wisdomAdjust = effect.wisdomAdjust;
      break;
    case PotionType.NETA_POTION:
      fp.vitalityAdjust = effect.vitalityAdjust;
      break;
    case PotionType.ANTI_VENIN:
      fp.antiVenin = effect.antiVenin;
      break;
    case PotionType.MON_POTION_B: {
      const maxStamina = champ.attributes.maxStamina | 0;
      const stamina = champ.attributes.stamina | 0;
      fp.staminaAdjust = Math.min(maxStamina - stamina, Math.trunc(maxStamina / effect.staminaDivisor));
      break;
    }
    case PotionType.YA_POTION: {
      // A champion already well shielded gets a quarter of the benefit.
      let amount = effect.shieldStrength;
      if (champ.shieldStrength > 50) amount = Math.trunc(amount / 4);
      fp.shieldStrengthAdjust = amount;
      fp.shieldDuration = amount * amount;
      break;
    }
    case PotionType.EE_POTION: {
      const mana = champ.attributes.mana | 0;
      const maxMana = champ.attributes.maxMana | 0;
      let target = Math.min(MAX_MANA, mana + effect.mana);
      if (target > maxMana) {
        // Past the ceiling only half the excess is kept, measured from whichever of
        // the current and maximum mana is already higher.
        const from = Math.max(mana, maxMana);
        target -= Math.trunc((target - from) / 2);
      }
      fp.manaAdjust = target - mana;
      break;
    }
    case PotionType.VI_POTION: {
      const maxHealth = champ.attributes.maxHealth | 0;
      const health = champ.attributes.health | 0;
      const healed = Math.min(health + Math.trunc(maxHealth / effect.hitpointDivisor), maxHealth);
      fp.hitpointAdjust = healed - health;
      fp.healCount = effect.healCount;
      break;
    }
    case PotionType.WATER_FLASK:
      fp.waterValue = effect.waterValue;
      break;
    default:
      break;
  }
  if (effect.drinkable) fp.performFeeding = true;
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
    // `shieldStrengthAdjust` is a `ui32` (`:3970`), so the sum `:4383` tests is unsigned and
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
    drawCharacterState(ctx, chIdx, CHARFLAG_PORTRAIT_CHANGED);
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
