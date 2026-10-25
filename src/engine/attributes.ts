/**
 * `ATTRIBUTE` — the (maximum, current, minimum) triple CSBWin keeps for each of a
 * champion's seven attributes (`doc/CSBwin-src/CSB.h:2468-2494`, stored as
 * `CHARDESC.Attributes[7]` at `doc/CSBwin-src/CSB.h:2624`).
 *
 * The three are not decoration. Nearly everything in the champion lifecycle reads or
 * writes a *specific* one of them:
 *
 * - **Current** is what the game plays with — `MaxLoad`, `Quickness`, spell success,
 *   `IsCharacterLucky`, the numbers in the stats panel.
 * - **Maximum** is what a level gain raises (`LevelUp` calls `IncrMaximum`, never
 *   `IncrCurrent`, `doc/CSBwin-src/Magic.cpp:101-151`), and what Current is compared
 *   against to colour the stats panel red and to light the red box around the eye
 *   (`doc/CSBwin-src/Character.cpp:1384-1397`, `:4630-4643`).
 * - **Minimum** is the floor a drain cannot push Current below
 *   (`AdjustCurrentAttribute`, `doc/CSBwin-src/Character.cpp:3917-3951`), and it is
 *   itself moved by worn items — a cursed object drops the Luck minimum by three
 *   (`doc/CSBwin-src/Character.cpp:1779-1781`).
 *
 * All three are stored as *unsigned bytes that are allowed to wrap*. CSBWin's own
 * comment explains why: four cursed objects take the Luck minimum of 10 below zero,
 * and the byte wraps to something enormous. The setters therefore wrap and the
 * getters return 0 for anything above 240 — that is the "it went negative" test, and
 * the wrapped value still exports to an Atari save file bit-for-bit
 * (`doc/CSBwin-src/data.cpp:1698-1744`).
 */
import type { Tuple, ui8 } from '../core/types';
import type { Champion } from './gameTypes';

/** `#define Luck 0 … #define AntiFire 6` (`doc/CSBwin-src/CSB.h:631-637`). */
export enum AttributeIndex {
  Luck = 0,
  Strength = 1,
  Dexterity = 2,
  Wisdom = 3,
  Vitality = 4,
  AntiMagic = 5,
  AntiFire = 6,
}

export const ATTRIBUTE_COUNT = 7;

/** One `ATTRIBUTE`, in CSBWin's own field order (maximum, current, minimum). */
export interface Attribute {
  maximum: ui8;
  current: ui8;
  minimum: ui8;
}

/** A champion's seven attributes, `CHARDESC.Attributes[7]`, indexed by `AttributeIndex`. */
export type Attributes = Tuple<Attribute, typeof ATTRIBUTE_COUNT>;

/** `ub()` — the unsigned-byte truncation every `ATTRIBUTE` setter applies. */
const ub = (value: number): number => value & 0xff;

/**
 * The getters' negative test: `if (ub > 240) return 0`
 * (`doc/CSBwin-src/data.cpp:1713-1729`). Note it is 240, not 128 — values between
 * 241 and 255 are read as zero even though nothing ever legitimately reaches them.
 */
const readByte = (value: ui8): number => (value > 240 ? 0 : value);

export function attributeCurrent(attr: Attribute): number {
  return readByte(attr.current);
}

export function attributeMaximum(attr: Attribute): number {
  return readByte(attr.maximum);
}

export function attributeMinimum(attr: Attribute): number {
  return readByte(attr.minimum);
}

export function setAttributeCurrent(attr: Attribute, value: number): void {
  attr.current = ub(value);
}

export function setAttributeMaximum(attr: Attribute, value: number): void {
  attr.maximum = ub(value);
}

export function setAttributeMinimum(attr: Attribute, value: number): void {
  attr.minimum = ub(value);
}

export function incrAttributeCurrent(attr: Attribute, increment: number): void {
  attr.current = ub(attr.current + increment);
}

export function incrAttributeMaximum(attr: Attribute, increment: number): void {
  attr.maximum = ub(attr.maximum + increment);
}

export function incrAttributeMinimum(attr: Attribute, increment: number): void {
  attr.minimum = ub(attr.minimum + increment);
}

export function makeAttribute(maximum: number, current: number, minimum: number): Attribute {
  return { maximum: ub(maximum), current: ub(current), minimum: ub(minimum) };
}

/**
 * The seven attributes as `AddCharacter` builds them for a new champion
 * (`doc/CSBwin-src/Character.cpp:641-660`): every value is capped at 224 and becomes
 * both Maximum and Current, the minimum is 30 — except Luck, whose minimum is 10.
 */
export const ADD_CHARACTER_ATTRIBUTE_MINIMUM = 30;
export const ADD_CHARACTER_LUCK_MINIMUM = 10;
export const ADD_CHARACTER_ATTRIBUTE_CAP = 224;

export function makeAddCharacterAttributes(values: ArrayLike<number>): Attributes {
  const attrs: Attribute[] = [];
  for (let i = 0; i < ATTRIBUTE_COUNT; i++) {
    let value = values[i] ?? 0;
    if (value > ADD_CHARACTER_ATTRIBUTE_CAP) value = ADD_CHARACTER_ATTRIBUTE_CAP;
    attrs.push(makeAttribute(value, value, ADD_CHARACTER_ATTRIBUTE_MINIMUM));
  }
  const stats = attrs as Attributes;
  setAttributeMinimum(stats[AttributeIndex.Luck], ADD_CHARACTER_LUCK_MINIMUM);
  return stats;
}

/**
 * Set Current to `value` held inside the attribute's own floor and ceiling —
 * `ApplyLimits(Minimum(), value, Maximum())` (`doc/CSBwin-src/CSB.h:3169`), the shape
 * `IsCharacterLucky` uses when it spends luck (`doc/CSBwin-src/Character.cpp:2199`).
 */
export function setAttributeCurrentWithinLimits(attr: Attribute, value: number): void {
  const min = attributeMinimum(attr);
  const max = attributeMaximum(attr);
  setAttributeCurrent(attr, Math.min(max, Math.max(min, value)));
}

/**
 * `AdjustCurrentAttribute` (`doc/CSBwin-src/Character.cpp:3917-3951`) — how a potion,
 * or anything else, moves one attribute's Current value.
 *
 * It is deliberately lopsided. A *gain* is taxed once Current is already high — halved
 * above 120, quartered above 150, then one point handed back — and is capped so
 * Current never passes 170. A *loss* is only bounded by the attribute's own Minimum.
 * Neither direction touches Maximum, which is why drinking a Ku potion turns the
 * strength line red rather than raising the ceiling.
 */
export function adjustCurrentAttribute(attr: Attribute, adjustment: number): void {
  let adj = adjustment | 0;
  if (adj === 0) return;

  let delta: number;
  if (adj > 0) {
    const current = attributeCurrent(attr);
    if (current > 120) {
      adj = Math.trunc(adj / 2);
      if (current > 150) adj = Math.trunc(adj / 2);
      adj += 1;
    }
    delta = Math.min(170 - current, adj);
  } else {
    // Both terms are negative or zero; the larger is the most we may subtract.
    delta = Math.max(attributeMinimum(attr) - attributeCurrent(attr), adj);
  }
  incrAttributeCurrent(attr, delta);
}

/**
 * The Current value of one of a champion's attributes — the reading almost every
 * gameplay formula wants (`MaxLoad`, `Quickness`, spell success, `IsCharacterLucky`).
 */
export function championAttribute(champ: Champion, index: AttributeIndex): number {
  const attr = champ.attributes.stats[index];
  return attr ? attributeCurrent(attr) : 0;
}
