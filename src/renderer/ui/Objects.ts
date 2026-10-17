/**
 * Object identity, naming, description and weight.
 *
 * Ports CSBWin's object-description machinery (`doc/CSBwin-src/Objects.cpp`,
 * `doc/CSBwin-src/Code17818.cpp`): resolving an object reference to its `OBJNI_*` name
 * index, the phrase/attribute lines the eye shows, carried weight, and `DetermineMastery`.
 */
import { OBJNI_APPLE, OBJNI_BONES_A, OBJNI_COMPASS_N, OBJNI_DRAGON_STEAK, OBJNI_COMPASS_W, OBJNI_EMPTY_FLASK, OBJNI_SPECIAL_F, OBJNI_SPECIAL_J, OBJNI_SPECIAL_N, OBJNI_TORCH_A, OBJNI_TORCH_D, OBJNI_WATER, OBJNI_WATERSKIN, OBJNI_WATER_FLASK } from '../../core/objectNameIndex';
import {
  adjustAntiFire, adjustAntiMagic, adjustDexterity, adjustLuck, adjustMaxMana, adjustStrength, adjustVitality,
  adjustWisdom, itemCarriedAdjustment,
} from '../../engine/AdjustStatsForItemCarried';
import { ammunitionClassFor } from '../../engine/CharacterSystem';
import { feetMaxLoadShift, feetMoveTimeBonus } from '../../engine/CharacterStats';
import { FOOD_WATER_MAX, WATERSKIN_GULP, potionEffect } from '../../engine/Feeding';
import { DescIndex, GetBasicObjectType, NameIndex, OBJDI_EYE_OF_TIME } from '../../engine/objectIndex';
import { DBType, ObjectID } from '../../core/types';
import { ViewingFilterResult, ViewingFilterSite } from '../../engine/DsaSystem';
import { Champion } from '../../engine/gameTypes';
import { copyCharacter } from '../../engine/Party';
import { determineMastery as determineMasteryEngine } from '../../engine/skills';
import { drawTextLineIndex } from '../csbwin/TextRenderer';
import { UIState } from './UIState';
export type ItemDescriptionLine = { text: string; color: number };

/**
 * `RN::NameIndex` (`src/engine/objectIndex.ts`) with the UI's tables and the party's
 * facing. -1 for a negative value, which some callers pass for "no object".
 */
export function resolveObjectNameIndex(ui: UIState, value: ObjectID): number {
  if (value < 0) return -1;
  return NameIndex(
    ui.ctx.dungeon,
    {
      objDescObjectType: ui.objectTables.objDescObjectType,
      byte640: ui.uiTables.graphic232.byte640,
    },
    ui.partyState.facing,
    value,
  );
}

/** `GetBasicObjectType` (`src/engine/objectIndex.ts`). -1 as `resolveObjectNameIndex`. */
export function getBaseObjectNameIndex(ui: UIState, rn: ObjectID): number {
  if (rn < 0) return -1;
  return GetBasicObjectType(ui.ctx.dungeon, ui.objectTables.objDescObjectType, rn);
}

/** `d.ObjDesc[rn.DescIndex()].attackClass`; 0, "no attacks", when there is no row. */
export function getAttackClass(ui: UIState, rn: ObjectID): number {
  if (rn < 0) return 0;
  const descIndex = DescIndex(ui.ctx.dungeon, rn);
  if (descIndex === -1) return 0;
  return ui.objectTables.objDescAttackClass[descIndex] ?? 0;
}

/** `RN::DescIndex` (`src/engine/objectIndex.ts`), with `null` for -1. */
export function descIndexForObject(ui: UIState, rn: ObjectID): number | null {
  const descIndex = DescIndex(ui.ctx.dungeon, rn);
  return descIndex === -1 ? null : descIndex;
}

export function isChestRecord(ui: UIState, value: ObjectID): boolean {
  return ui.ctx.dungeon.rnMaps.dbType(value) === DBType.CHEST;
}

export function getObjectName(ui: UIState, objectNameIndex: number): string {
  const names = ui.objectTables.objectNames;
  if (objectNameIndex >= 0 && objectNameIndex < names.length) {
    return names[objectNameIndex] ?? '';
  }
  return `OBJECT ${objectNameIndex}`;
}

/**
 * The champion a bones object belongs to, or `null`.
 *
 * The same four-step lookup CSBWin spells out twice — in the eye's object panel
 * (`doc/CSBwin-src/Character.cpp:3563-3597`) and in `DrawNameOfHeldObject`
 * (`doc/CSBwin-src/Code11f52.cpp:73-94`). Both key on the *name index* being
 * `objNI_Bones_a` rather than on the `DB10` misc type, and both refuse bones whose
 * `value()` is 0: those are inert scenery, not anybody's remains
 * (`doc/CSBwin-src/CSB.h:1261-1267`).
 * `CopyCharacter` finds the champion in the party, or in the wings.
 */
export function getBonesChampion(ui: UIState, objectId: ObjectID, objectNameIndex: number): Champion | null {
  if (objectNameIndex !== OBJNI_BONES_A) return null;
  const misc = ui.ctx.dungeon.getMiscRecord(objectId);
  if (!misc) return null;
  // `value = pBones->value(); if (value != 0)` — are these bones a champion's at all?
  if ((misc.specialState | 0) === 0) return null;
  const fingerprint = ui.ctx.dungeon.copyChampionBonesRecord(objectId);
  if (fingerprint === null) return null;
  return copyCharacter(ui.partyState, ui.ctx.dungeon, fingerprint);
}

/**
 * `DescribeChampionBones` (`doc/CSBwin-src/Code11f52.cpp:29-60`): the translation
 * of `"% " + objName`, with the champion's name for each `%`. With no translation (`DEBT.md`
 * G21) `TranslateLanguage` gives its text back (`Translation.cpp:187`), so this reads
 * "NAME BONES". The hand's line and the inventory's description both name bones so
 * (`Code11f52.cpp:91`, `Character.cpp:3587`).
 */
export function describeChampionBones(name: string, objName: string): string {
  return `% ${objName}`.split('%').join(name);
}

export function getObjectDisplayName(ui: UIState, objectId: ObjectID, objectNameIndex: number): string {
  let name = getObjectName(ui, objectNameIndex);
  if (!name) return name;
  const { category } = ui.ctx.dungeon.rnMaps.decode(objectId);

  // `DescribeObject`'s `DescribeChampionBones(descriptiveText, pcA0->name, d.ObjectNames[objNID6])`
  // (doc/CSBwin-src/Character.cpp:3587).
  const owner = getBonesChampion(ui, objectId, objectNameIndex);
  if (owner?.name) name = describeChampionBones(owner.name, name);

  if (category === DBType.POTION && showsPotionPower(ui, objectNameIndex)) {
    const potion = ui.ctx.dungeon.getPotionRecord(objectId);
    const prefix = 95 + Math.floor((potion?.power ?? 0) / 40);
    name = `${String.fromCharCode(prefix)} ${name}`;
  }

  return name;
}

/**
 * Whether the eye shows a potion's power (`doc/CSBwin-src/Character.cpp:3608-3611`): as the
 * rune before its name, for a potion that is not a water flask nor an empty one, to a
 * selected champion of priest mastery above 1. The eye's item properties keep the gate
 * (`getItemPropertyLines`).
 */
export function showsPotionPower(ui: UIState, objectNameIndex: number): boolean {
  if (objectNameIndex === OBJNI_WATER_FLASK || objectNameIndex === OBJNI_EMPTY_FLASK) return false;
  const selected = ui.partyState.selectedCharacterIndex;
  if (selected < 0) return false;
  const champ = ui.partyState.champions[selected];
  return !!champ && determineMastery(ui, champ, 2) > 1;
}

export function formatWeightText(weight: number): string {
  const total = Math.max(0, weight | 0);
  const kg = Math.floor(total / 10);
  const tenths = Math.abs(total % 10);
  return `WEIGHS ${kg}.${tenths} KG.`;
}

/**
 * `GetObjectWeight` / `TAG0091e6`, in the engine (`src/engine/CharacterStats.ts`).
 */
export function getObjectWeightForRecord(ui: UIState, rn: ObjectID, visited: Set<number>): number {
  return ui.ctx.systems.characterStats.getObjectWeight(rn, visited);
}

/**
 * The lines `DescribeObject` draws under an object's name, and whether a viewing filter
 * rewrote them: a DSA's `&DESCRIBE` changed the mask, a phrase's text or a colour. A
 * filter that ran no `&DESCRIBE` let the object through.
 */
export type ObjectDescription = { lines: ItemDescriptionLine[]; rewritten: boolean };

export function getObjectDescriptionLines(ui: UIState, objectId: ObjectID, objectNameIndex: number): ObjectDescription {
  const lines: ItemDescriptionLine[] = [];
  const { category } = ui.ctx.dungeon.rnMaps.decode(objectId);
  const phrases = ['CONSUMABLE', 'POISONED', 'BROKEN', 'CURSED', '', '', '', ''];
  const phraseColors = Array.from({ length: 8 }, () => 13);
  let descriptionMask = 0;
  let flags = 0;

  switch (category) {
    case DBType.WEAPON: {
      const rec = ui.ctx.dungeon.getWeaponRecord(objectId);
      if (objectNameIndex >= OBJNI_TORCH_A && objectNameIndex <= OBJNI_TORCH_D) {
        if ((rec?.charges ?? 0) === 0) {
          lines.push({ text: '(BURNT OUT)', color: 13 });
        }
      }
      descriptionMask = 0x0e;
      if (rec?.cursed) flags |= 0x8;
      if (rec?.poisoned) flags |= 0x2;
      if (rec?.broken) flags |= 0x4;
      break;
    }
    case DBType.CLOTHING: {
      const rec = ui.ctx.dungeon.getClothingRecord(objectId);
      descriptionMask = 0x0c;
      if (rec?.cursed) flags |= 0x8;
      if (rec?.broken) flags |= 0x4;
      break;
    }
    case DBType.POTION: {
      const descIndex = descIndexForObject(ui, objectId);
      descriptionMask = 0x01;
      if (descIndex !== null) flags = ui.objectTables.objDescWord4[descIndex] ?? 0;
      break;
    }
    case DBType.MISC: {
      const rec = ui.ctx.dungeon.getMiscRecord(objectId);
      if (objectNameIndex >= OBJNI_WATERSKIN && objectNameIndex <= OBJNI_WATER) {
        descriptionMask = 0;
        const state = rec?.specialState ?? 0;
        const text =
          state === 3 ? '(FULL)'
            : state === 2 ? '(ALMOST FULL)'
              : state === 1 ? '(ALMOST EMPTY)'
                : '(EMPTY)';
        lines.push({ text, color: 13 });
        break;
      }
      if (objectNameIndex >= OBJNI_COMPASS_N && objectNameIndex <= OBJNI_COMPASS_W) {
        descriptionMask = 0;
        const facing = ui.partyState.facing;
        const directions = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
        lines.push({ text: `PARTY FACING ${directions[facing & 3] ?? ''}`.trim(), color: 13 });
        break;
      }
      const descIndex = descIndexForObject(ui, objectId);
      descriptionMask = 0x09;
      if (descIndex !== null) flags = ui.objectTables.objDescWord4[descIndex] ?? 0;
      break;
    }
    default:
      break;
  }

  let phraseMask = descriptionMask & flags & 0x0f;
  phraseMask |= 0x40;

  const weight = getObjectWeightForRecord(ui, objectId, new Set<number>());
  phrases[6] = formatWeightText(weight);

  const filter = applyViewingFilter(ui, ViewingFilterSite.DESCRIPTION, objectId, phraseMask);
  const rewritten = filter !== null && (filter.phraseMask !== phraseMask
    || filter.phraseTextOverrides.some((text) => text !== null)
    || filter.phraseColorOverrides.some((color) => color !== null));
  if (filter) {
    phraseMask = filter.phraseMask;
    for (let i = 0; i < filter.phraseTextOverrides.length; i++) {
      const text = filter.phraseTextOverrides[i];
      if (text !== null && text !== undefined) phrases[i] = text;
    }
    for (let i = 0; i < filter.phraseColorOverrides.length; i++) {
      const color = filter.phraseColorOverrides[i];
      if (color !== null && color !== undefined) phraseColors[i] = color;
    }
  }

  const phraseLine = buildPhraseSummary(phraseMask & 0x3f, phrases, phraseColors);
  if (phraseLine) lines.push(phraseLine);
  if ((phraseMask & 0x40) !== 0 && phrases[6]) {
    lines.push({ text: phrases[6], color: phraseColors[6] ?? 13 });
  }
  if ((phraseMask & 0x80) !== 0 && phrases[7]) {
    lines.push({ text: phrases[7], color: phraseColors[7] ?? 13 });
  }
  return { lines, rewritten };
}

export function buildPhraseSummary(mask: number, phrases: string[], colors: number[]): ItemDescriptionLine | null {
  if (mask === 0) return null;
  const chosen: string[] = [];
  let color = 13;
  for (let i = 0; i < phrases.length; i++) {
    if ((mask & (1 << i)) === 0) continue;
    if (!phrases[i]) continue;
    chosen.push(phrases[i]);
    color = colors[i] ?? 13;
  }
  if (chosen.length === 0) return null;
  if (chosen.length === 1) return { text: `(${chosen[0]})`, color };
  if (chosen.length === 2) return { text: `(${chosen[0]} AND ${chosen[1]})`, color };
  return { text: `(${chosen.slice(0, -1).join(', ')} AND ${chosen[chosen.length - 1]})`, color };
}

export function applyViewingFilter(
  ui: UIState,
  site: ViewingFilterSite,
  objectId: ObjectID,
  phraseMask: number,
): ViewingFilterResult | null {
  const selected = ui.partyState.selectedCharacterIndex;
  if (selected < 0) return null;
  return ui.ctx.systems.dsa.processViewingFilter({
    site,
    phraseMask,
    objectId,
    selectedCharacter: selected,
  });
}

/** The eye's description: its first line's viewport row, a line's height, and its width in characters. */
export const ITEM_DESCRIPTION_Y = 87;
export const ITEM_LINE_STEP = 7;
export const ITEM_LINE_CHARS = 18;
/** The last row the eye panel holds a line at: its frame's inner edge is y 123. */
export const ITEM_PROPERTY_Y = 122;

/** A description line as the eye draws it, cut into rows of at most 18 characters. */
export function wrapItemDescriptionLine(text: string): string[] {
  const rows: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let line = remaining;
    let next = '';
    if (line.length > ITEM_LINE_CHARS) {
      let cut = ITEM_LINE_CHARS - 1;
      while (cut > 2 && line[cut] !== ' ') cut--;
      if (cut === 2) cut = ITEM_LINE_CHARS - 1;
      next = remaining.slice(cut + 1);
      line = remaining.slice(0, cut);
    }
    rows.push(line);
    remaining = next;
  }
  return rows;
}

export function drawItemDescriptionLine(ui: UIState, text: string, color: number, state: { x: number; y: number }): void {
  for (const line of wrapItemDescriptionLine(text)) {
    drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, state.x, state.y, color, null, line);
    state.y += ITEM_LINE_STEP;
  }
}

/**
 * The extra's lines for an object (`showItemProperties`, `DEBT.md` X), in their priority
 * order, each one labelled figure of at most 18 characters, from the set's own tables.
 */
export function getItemPropertyLines(ui: UIState, objectId: ObjectID): string[] {
  switch (ui.ctx.dungeon.rnMaps.dbType(objectId)) {
    case DBType.WEAPON:
      return weaponPropertyLines(ui, objectId);
    case DBType.CLOTHING:
      return garmentPropertyLines(ui, objectId);
    case DBType.POTION:
      return potionPropertyLines(ui, objectId);
    case DBType.MISC:
      return miscPropertyLines(ui, objectId);
    default:
      return [];
  }
}

/**
 * A weapon's lines: its damage, what it gives while carried, its energy as a missile,
 * the ammunition a launcher fires or the launcher an ammunition needs, then a torch's
 * light or the charges its attacks spend.
 */
function weaponPropertyLines(ui: UIState, objectId: ObjectID): string[] {
  const rec = ui.ctx.dungeon.getWeaponRecord(objectId);
  const desc = rec ? ui.objectTables.weaponDesc[rec.weaponType] : undefined;
  if (!rec || !desc) return [];
  // `uByte2`: what a melee blow starts from (`DeterminePhysicalAttackDamage`,
  // `doc/CSBwin-src/Attack.cpp:652`) and what a throw adds (`Character.cpp:2323-2325`).
  const lines = [`DAMAGE ${desc.uByte2}`, ...carriedPropertyLines(ui, objectId)];
  // `uByte3`: a missile's impact (`Code11f52.cpp:1606-1617`), a throw's energy
  // (`Mouse.cpp:728-737`) and a shot's range (`Attack.cpp:1903`).
  if (desc.uByte3 !== 0) lines.push(`MISSILE ${desc.uByte3}`);
  const shot = shotPropertyLine(ui, desc.uByte1);
  if (shot) lines.push(shot);
  const nameIndex = resolveObjectNameIndex(ui, objectId);
  if (nameIndex >= OBJNI_TORCH_A && nameIndex <= OBJNI_TORCH_D) {
    // A torch in hand lights the party by `d.Word1074[charges]` (`CSBCode.cpp:7320-7364`).
    lines.push(`LIGHT ${ui.uiTables.graphic232.word1074[rec.charges] ?? 0}`);
  } else if (spendsCharges(ui, objectId)) {
    lines.push(`CHARGES ${rec.charges}`);
  }
  return lines;
}

/**
 * A garment's lines: its armour and its resistance to sharp blows, whether it is a
 * shield, what wearing it gives, then what it gives on the feet.
 */
function garmentPropertyLines(ui: UIState, objectId: ObjectID): string[] {
  const rec = ui.ctx.dungeon.getClothingRecord(objectId);
  if (!rec) return [];
  const armour = ui.objectTables.clothingArmour[rec.clothingType] ?? 0;
  const flags = ui.objectTables.clothingFlags[rec.clothingType] ?? 0;
  // `uByte1` and `uByte2 & 7`, `TAG009470`'s figures (`doc/CSBwin-src/Character.cpp:168-176`).
  // One space between them: the Plate of Darc's armour is 160.
  const lines = [`ARMOUR ${armour} SHARP ${flags & 7}`];
  // `uByte2` bit 7: in either hand, it adds to every part's defence (`TAG01680a`,
  // `Character.cpp:2396-2432`).
  if ((flags & 0x80) !== 0) lines.push('SHIELDS ALL PARTS');
  lines.push(...carriedPropertyLines(ui, objectId));
  const nameIndex = resolveObjectNameIndex(ui, objectId);
  const loadShift = feetMaxLoadShift(nameIndex);
  if (loadShift !== 0) lines.push(`MAX LOAD +1/${1 << loadShift}`);
  const moveTime = feetMoveTimeBonus(nameIndex);
  if (moveTime !== 0) lines.push(`MOVE TIME -${moveTime}`);
  return lines;
}

/** A figure of food or water, against the 2048 a champion's are capped at (`LIMIT`, `doc/CSBwin-src/Character.cpp:4442-4443`). */
const foodWaterLine = (what: 'FOOD' | 'WATER', value: number): string => `${what} ${value} OF ${FOOD_WATER_MAX}`;

/**
 * A misc object's lines: what eating food gives (`d.FoodValue`, `Character.cpp:4290-4299`)
 * or a gulp from a waterskin that is not empty (`:4116-4128`), then what carrying it gives.
 */
function miscPropertyLines(ui: UIState, objectId: ObjectID): string[] {
  const lines: string[] = [];
  const nameIndex = resolveObjectNameIndex(ui, objectId);
  if (nameIndex >= OBJNI_APPLE && nameIndex <= OBJNI_DRAGON_STEAK) {
    lines.push(foodWaterLine('FOOD', ui.objectTables.foodValue[nameIndex - OBJNI_APPLE] ?? 0));
  } else if (nameIndex >= OBJNI_WATERSKIN && nameIndex <= OBJNI_WATER) {
    if ((ui.ctx.dungeon.getMiscRecord(objectId)?.specialState ?? 0) !== 0) lines.push(foodWaterLine('WATER', WATERSKIN_GULP));
  }
  lines.push(...carriedPropertyLines(ui, objectId));
  return lines;
}

/**
 * A potion's lines: its power, then what drinking it does (`potionEffect`). Only where
 * the eye shows its power as a rune (`showsPotionPower`): to anyone else, it has none.
 * A water flask, which has no rune, gives its water to all.
 */
function potionPropertyLines(ui: UIState, objectId: ObjectID): string[] {
  const rec = ui.ctx.dungeon.getPotionRecord(objectId);
  if (!rec) return [];
  const effect = potionEffect(rec.potionType, rec.power);
  if (effect.waterValue !== 0) return [foodWaterLine('WATER', effect.waterValue)];
  if (!showsPotionPower(ui, resolveObjectNameIndex(ui, objectId))) return [];
  const lines = [`POWER ${rec.power}`];
  const add = (name: string, amount: number): void => {
    if (amount !== 0) lines.push(`${name} ${amount > 0 ? '+' : ''}${amount}`);
  };
  add('STRENGTH', effect.strengthAdjust);
  add('DEXTERITY', effect.dexterityAdjust);
  add('WISDOM', effect.wisdomAdjust);
  add('VITALITY', effect.vitalityAdjust);
  if (effect.antiVenin) lines.push('CURES POISON');
  if (effect.staminaDivisor !== 0) lines.push(`STAMINA +MAX/${effect.staminaDivisor}`);
  if (effect.hitpointDivisor !== 0) lines.push(`HEALTH +MAX/${effect.hitpointDivisor}`);
  if (effect.healCount !== 0) lines.push('HEALS WOUNDS');
  add('SHIELD', effect.shieldStrength);
  add('MANA', effect.mana);
  return lines;
}

/** The attributes `itemCarriedAdjustment` names, as the attribute panel and the mana bar do. */
const CARRIED_ATTRIBUTE_NAMES: Readonly<Record<number, string>> = {
  [adjustLuck]: 'LUCK',
  [adjustStrength]: 'STRENGTH',
  [adjustDexterity]: 'DEXTERITY',
  [adjustWisdom]: 'WISDOM',
  [adjustVitality]: 'VITALITY',
  [adjustAntiMagic]: 'ANTI-MAGIC',
  [adjustAntiFire]: 'ANTI-FIRE',
  [adjustMaxMana]: 'MANA',
};

/**
 * What carrying the object gives, in any of a champion's 30 slots: each adjustment
 * `AdjustStatsForItemCarried` makes for it (`itemCarriedAdjustment`), once.
 */
function carriedPropertyLines(ui: UIState, objectId: ObjectID): string[] {
  const lines: string[] = [];
  for (let slot = 0; slot < 30; slot++) {
    const { whatToAdjust, amount } = itemCarriedAdjustment(slot, objectId, ui.ctx.dungeon, (rn) => resolveObjectNameIndex(ui, rn));
    const name = CARRIED_ATTRIBUTE_NAMES[whatToAdjust];
    if (amount === 0 || !name) continue;
    const line = `${name} ${amount > 0 ? '+' : ''}${amount}`;
    if (!lines.includes(line)) lines.push(line);
  }
  return lines;
}

/**
 * A launcher's ammunition, or an ammunition's launcher (`ammunitionClassFor`), named by
 * the set's first weapon type of that class. Nothing for any other weapon, or a set with
 * no weapon of the class wanted.
 */
function shotPropertyLine(ui: UIState, weaponClass: number): string | null {
  const weapons = ui.objectTables.weaponDesc;
  const nameOf = (weaponType: number): string =>
    getObjectName(ui, ui.objectTables.objDescObjectType[OBJDI_EYE_OF_TIME + weaponType] ?? -1);
  const ammunitionClass = ammunitionClassFor(weaponClass);
  if (ammunitionClass >= 0) {
    const ammunition = weapons.findIndex((desc) => desc.uByte1 === ammunitionClass);
    return ammunition >= 0 ? `SHOOTS ${nameOf(ammunition)}` : null;
  }
  const launcher = weapons.findIndex((desc) => ammunitionClassFor(desc.uByte1) === weaponClass);
  return launcher >= 0 ? `AMMO FOR ${nameOf(launcher)}` : null;
}

/**
 * Whether an object's attacks spend its charges: its `legalAttacks` row asks for charges
 * left (bit 7 of a mastery byte) for one of its options, which `GetLegalAttackTypes`
 * offers only while `ItemHasChargesLeft` (`doc/CSBwin-src/Character.cpp:4805-4808`).
 */
function spendsCharges(ui: UIState, objectId: ObjectID): boolean {
  const row = ui.uiTables.graphic230.legalAttacks[getAttackClass(ui, objectId)];
  return !!row && (((row[4] ?? 0) | (row[5] ?? 0)) & 128) !== 0;
}

/**
 * Where the extra's lines go under the description's: anchored at the bottom, the first
 * at viewport y 122, the next 7 rows up, and so on. A line whose row would be at or above
 * the description's last row is dropped, and every line after it.
 */
export function placeItemPropertyLines(description: ItemDescriptionLine[], properties: string[]): Array<{ text: string; y: number }> {
  const rows = description.reduce((n, line) => n + wrapItemDescriptionLine(line.text).length, 0);
  const lastY = ITEM_DESCRIPTION_Y + (rows - 1) * ITEM_LINE_STEP;
  const placed: Array<{ text: string; y: number }> = [];
  for (const text of properties) {
    const y = ITEM_PROPERTY_Y - placed.length * ITEM_LINE_STEP;
    if (y <= lastY) break;
    placed.push({ text, y });
  }
  return placed;
}

export function getInventoryPlaceholderIndex(champion: Champion, slot: number): number {
  if (slot >= 0 && slot <= 5) {
    const wounds = champion.wounds;
    const wounded = (wounds & (1 << slot)) !== 0;
    return OBJNI_SPECIAL_N + 2 * slot + (wounded ? 1 : 0);
  }
  if (slot >= 10 && slot <= 13) {
    return OBJNI_SPECIAL_J + (slot - 10);
  }
  return OBJNI_SPECIAL_F;
}

export function determineMastery(ui: UIState, champion: Champion, skill: number): number {
  return determineMasteryEngine(champion, skill, {
    partySleeping: ui.partyState.sleeping,
    getObjectNameIndex: (objectId) => resolveObjectNameIndex(ui, objectId),
  });
}

/**
 * `DetermineMastery(chIdx, role|0x8000)` (`doc/CSBwin-src/Character.cpp:4610`) — the rank
 * the eye panel prints is the earned one, so the `0x8000` flag drops the temporary
 * adjustment a spell or potion may be carrying.
 */
export function getRoleMastery(ui: UIState, champion: Champion, roleIndex: number): number {
  return determineMastery(ui, champion, roleIndex | 0x8000);
}
