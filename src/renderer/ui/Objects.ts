/**
 * Object identity, naming, description and weight.
 *
 * Ports CSBWin's object-description machinery (`doc/CSBwin-src/Objects.cpp`,
 * `doc/CSBwin-src/Code17818.cpp`): resolving an object reference to its `OBJNI_*` name
 * index, the phrase/attribute lines the eye shows, carried weight, and `DetermineMastery`.
 */
import { OBJNI_COMPASS_N, OBJNI_COMPASS_W, OBJNI_EMPTY_FLASK, OBJNI_EYE_OF_TIME_A, OBJNI_FIRST_FULL_FLASK, OBJNI_FIRST_MODIFIABLE, OBJNI_FLAMITT_A, OBJNI_ILLUMULET_A, OBJNI_JEWEL_SYMAL_A, OBJNI_LAST_FULL_FLASK, OBJNI_LAST_MODIFIABLE, OBJNI_OPEN_SCROLL, OBJNI_RA_BLADE_A, OBJNI_SCROLL, OBJNI_SPECIAL_F, OBJNI_SPECIAL_J, OBJNI_SPECIAL_N, OBJNI_STAFF_OF_CLAWS_A, OBJNI_STORM_A, OBJNI_STORM_RING_A, OBJNI_TORCH_A, OBJNI_TORCH_D, OBJNI_WATER, OBJNI_WATERSKIN, OBJNI_WATER_FLASK } from '../../core/objectNameIndex';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, ObjectID, decodeObjectID } from '../../core/types';
import { ViewingFilterResult } from '../../engine/DsaSystem';
import { TextDecodeTables } from '../../engine/DungeonState';
import { Champion } from '../../engine/gameTypes';
import { findChampionByFingerprint } from '../../engine/Party';
import { determineMastery as determineMasteryEngine } from '../../engine/skills';
import { drawTextLineIndex } from '../csbwin/TextRenderer';
import { UIMode, UIState } from './UIState';
import { MISC_BONES_OF_HERO } from '@/core';
export type ItemDescriptionLine = { text: string; color: number };
const DEFAULT_CHEST_WEIGHT = 50;

export function resolveObjectNameIndex(ui: UIState, value: number): number {
  if (value < 0) return -1;
  if (!ui.objectTables) return value | 0;
  const descIndex = descIndexForObject(ui, value as ObjectID);
  if (descIndex === null) return value | 0;
  let objectType = ui.objectTables.objDescObjectType[descIndex];
  if (typeof objectType !== 'number') return value | 0;

  objectType |= 0;
  if (
    objectType > OBJNI_LAST_MODIFIABLE ||
    objectType < OBJNI_FIRST_MODIFIABLE
  ) {
    if (objectType < OBJNI_FIRST_FULL_FLASK || objectType > OBJNI_LAST_FULL_FLASK) {
      if (objectType !== OBJNI_EMPTY_FLASK) return objectType;
    }
  }

  if (objectType === OBJNI_COMPASS_N) {
    const facing = ui.partyState?.facing ?? 0;
    return (objectType + (facing & 0x3)) | 0;
  }

  if (objectType === OBJNI_TORCH_A) {
    const weapon = ui.dungeonState.getWeaponRecord(value as ObjectID);
    if (weapon?.litTorch) {
      const charge = weapon.charges ?? 0;
      const byte640 = ui.uiTables?.graphic232.byte640 ?? [];
      const offset = byte640[charge] ?? 0;
      return (objectType + (offset & 0xff)) | 0;
    }
    return objectType;
  }

  if (objectType === OBJNI_OPEN_SCROLL) {
    const scroll = ui.dungeonState.getScrollRecord(value as ObjectID);
    if (scroll && !scroll.open) return OBJNI_SCROLL;
    return objectType;
  }

  if (
    objectType === OBJNI_WATERSKIN ||
    objectType === OBJNI_ILLUMULET_A ||
    objectType === OBJNI_JEWEL_SYMAL_A
  ) {
    const misc = ui.dungeonState.getMiscRecord(value as ObjectID);
    if (misc && misc.specialState !== 0) return objectType + 1;
    return objectType;
  }

  if (
    objectType === OBJNI_STORM_A ||
    objectType === OBJNI_FLAMITT_A ||
    objectType === OBJNI_STORM_RING_A ||
    objectType === OBJNI_RA_BLADE_A ||
    objectType === OBJNI_EYE_OF_TIME_A ||
    objectType === OBJNI_STAFF_OF_CLAWS_A
  ) {
    const weapon = ui.dungeonState.getWeaponRecord(value as ObjectID);
    if (weapon && weapon.charges > 0) return objectType + 1;
    return objectType;
  }

  return objectType;
}

export function getBaseObjectNameIndex(ui: UIState, value: number): number {
  if (value < 0) return -1;
  if (!ui.objectTables) return value | 0;

  const descIndex = isLikelyObjectRecord(ui, value)
    ? descIndexForObject(ui, value as ObjectID)
    : getDescIndexForObjectType(ui, value | 0);
  if (descIndex === null) return value | 0;

  const objectType = ui.objectTables.objDescObjectType[descIndex];
  return typeof objectType === 'number' ? objectType | 0 : value | 0;
}

export function getAttackClass(ui: UIState, value: number): number {
  if (!ui.objectTables) return 0;
  if (value < 0) return 0;

  const descIndex = isLikelyObjectRecord(ui, value)
    ? descIndexForObject(ui, value as ObjectID)
    : getDescIndexForObjectType(ui, value | 0);
  if (descIndex === null) return 0;

  return ui.objectTables.objDescAttackClass[descIndex] ?? 0;
}

export function descIndexForObject(ui: UIState, rn: ObjectID): number | null {
  const { category } = decodeObjectID(rn);
  switch (category) {
    case DBType.SCROLL:
      return 0;
    case DBType.CHEST: {
      const rec = ui.dungeonState.getContainerRecord(rn);
      return rec ? 1 + (rec.containerType & 0xff) : null;
    }
    case DBType.POTION: {
      const rec = ui.dungeonState.getPotionRecord(rn);
      return rec ? 2 + (rec.potionType & 0xff) : null;
    }
    case DBType.WEAPON: {
      const rec = ui.dungeonState.getWeaponRecord(rn);
      return rec ? 23 + (rec.weaponType & 0xff) : null;
    }
    case DBType.CLOTHING: {
      const rec = ui.dungeonState.getClothingRecord(rn);
      return rec ? 69 + (rec.clothingType & 0xff) : null;
    }
    case DBType.MISC: {
      const rec = ui.dungeonState.getMiscRecord(rn);
      return rec ? 127 + (rec.miscType & 0xff) : null;
    }
    default:
      return null;
  }
}

export function getDescIndexForObjectType(ui: UIState, objectType: number): number | null {
  if (!ui.objectTables) return null;
  const table = ui.objectTables.objDescObjectType;
  for (let i = 0; i < table.length; i++) {
    if (table[i] === objectType) return i;
  }
  return null;
}

export function isLikelyObjectRecord(ui: UIState, value: number): boolean {
  const { category, index } = decodeObjectID(value as ObjectID);
  switch (category) {
    case DBType.WEAPON:
      return index < ui.dungeonState.getData().databases.weapons.records.length;
    case DBType.CLOTHING:
      return index < ui.dungeonState.getData().databases.clothing.records.length;
    case DBType.SCROLL:
      return index < ui.dungeonState.getData().databases.scrolls.records.length;
    case DBType.POTION:
      return index < ui.dungeonState.getData().databases.potions.records.length;
    case DBType.CHEST:
      return index < ui.dungeonState.getData().databases.containers.records.length;
    case DBType.MISC:
      return index < ui.dungeonState.getData().databases.misc.records.length;
    default:
      return false;
  }
}

export function normalizeObjectValue(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (value === OBJECT_ID_NULL || value === OBJECT_ID_EOF) return null;
  return value;
}

export function isChestRecord(ui: UIState, value: number | null): value is ObjectID {
  if (value === null || value === undefined) return false;
  if (!isLikelyObjectRecord(ui, value)) return false;
  const { category } = decodeObjectID(value as ObjectID);
  return category === DBType.CHEST;
}

export function isBaseObjectNameIndex(ui: UIState, objectId: number, min: number, max: number): boolean {
  const base = getBaseObjectNameIndex(ui, objectId);
  return base >= min && base <= max;
}

export function normalizeWord6(value: number): number {
  return (value << 16) >> 16;
}

export function getObjectName(ui: UIState, objectNameIndex: number): string {
  const names = ui.objectTables?.objectNames ?? [];
  if (objectNameIndex >= 0 && objectNameIndex < names.length) {
    return names[objectNameIndex] ?? '';
  }
  return `OBJECT ${objectNameIndex}`;
}

export function getObjectDisplayName(ui: UIState, objectId: ObjectID, objectNameIndex: number): string {
  let name = getObjectName(ui, objectNameIndex);
  if (!name) return name;
  const { category } = decodeObjectID(objectId);

  if (category === DBType.MISC) {
    const misc = ui.dungeonState.getMiscRecord(objectId);
    if (misc?.miscType === MISC_BONES_OF_HERO) {
      const fingerprint = ui.dungeonState.copyChampionBonesRecord(objectId);
      if (fingerprint !== null && ui.partyState) {
        const chIdx = findChampionByFingerprint(ui.partyState, fingerprint);
        const champ = chIdx === -1 ? null : ui.partyState.champions[chIdx];
        if (champ?.name) name = `${champ.name}${name}`;
      }
    }
  }

  if (category === DBType.POTION) {
    if (objectNameIndex !== OBJNI_WATER_FLASK && objectNameIndex !== OBJNI_EMPTY_FLASK) {
      const selected = ui.partyState?.selectedCharacterIndex ?? -1;
      if (selected >= 0 && ui.partyState) {
        const champ = ui.partyState.champions[selected];
        if (champ && determineMastery(ui, champ, 2) > 1) {
          const potion = ui.dungeonState.getPotionRecord(objectId);
          const prefix = 95 + Math.floor((potion?.power ?? 0) / 40);
          name = `${String.fromCharCode(prefix)} ${name}`;
        }
      }
    }
  }

  return name;
}

export function formatWeightText(weight: number): string {
  const total = Math.max(0, weight | 0);
  const kg = Math.floor(total / 10);
  const tenths = Math.abs(total % 10);
  return `WEIGHS ${kg}.${tenths} KG.`;
}

export function getObjectWeight(ui: UIState, value: number, visited: Set<number>): number {
  if (!ui.objectTables) return 0;
  if (value === OBJECT_ID_EOF || value === OBJECT_ID_NULL) return 0;
  if (isLikelyObjectRecord(ui, value)) {
    return getObjectWeightForRecord(ui, value as ObjectID, visited);
  }
  return getObjectWeightForObjectType(ui, value | 0);
}

/**
 * `GetObjectWeight` / `TAG0091e6` for an object *record*, in the engine
 * (`src/engine/CharacterStats.ts`). The name-index form below stays here: it exists for
 * the icons and the eye panel, which deal in object types rather than records.
 */
export function getObjectWeightForRecord(ui: UIState, rn: ObjectID, visited: Set<number>): number {
  return ui.characterStats?.getObjectWeight(rn, visited) ?? 0;
}

export function getObjectWeightForObjectType(ui: UIState, objectType: number): number {
  if (!ui.objectTables) return 0;
  let descIndex = getDescIndexForObjectType(ui, objectType);
  if (descIndex === null) {
    if (objectType === OBJNI_SCROLL || objectType === OBJNI_OPEN_SCROLL) return 1;
    if (objectType === OBJNI_WATERSKIN || objectType === OBJNI_WATER) {
      descIndex = 127 + 1;
    }
    if (descIndex === null) {
      if (objectType === OBJNI_EMPTY_FLASK) return 1;
      if (objectType >= OBJNI_FIRST_FULL_FLASK && objectType <= OBJNI_LAST_FULL_FLASK) return 3;
      return 0;
    }
  }

  if (descIndex === 0) return 1;
  if (descIndex === 1) return DEFAULT_CHEST_WEIGHT;
  if (descIndex >= 2 && descIndex <= 22) {
    if (objectType === OBJNI_EMPTY_FLASK) return 1;
    return 3;
  }
  if (descIndex >= 23 && descIndex <= 68) {
    return ui.objectTables.weaponWeights[descIndex - 23] ?? 0;
  }
  if (descIndex >= 69 && descIndex <= 126) {
    return ui.objectTables.clothingWeights[descIndex - 69] ?? 0;
  }
  if (descIndex >= 127 && descIndex <= 179) {
    let weight = ui.objectTables.miscWeights[descIndex - 127] ?? 0;
    if (objectType === OBJNI_WATER) weight += 6;
    return weight;
  }
  return 0;
}

export function getObjectDescriptionLines(ui: UIState, objectId: ObjectID, objectNameIndex: number): ItemDescriptionLine[] {
  if (!ui.objectTables) return [];
  const lines: ItemDescriptionLine[] = [];
  const { category } = decodeObjectID(objectId);
  const phrases = ['CONSUMABLE', 'POISONED', 'BROKEN', 'CURSED', '', '', '', ''];
  const phraseColors = Array.from({ length: 8 }, () => 13);
  let descriptionMask = 0;
  let flags = 0;

  switch (category) {
    case DBType.WEAPON: {
      const rec = ui.dungeonState.getWeaponRecord(objectId);
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
      const rec = ui.dungeonState.getClothingRecord(objectId);
      descriptionMask = 0x0c;
      if (rec?.cursed) flags |= 0x8;
      if (rec?.broken) flags |= 0x4;
      break;
    }
    case DBType.POTION: {
      const descIndex = descIndexForObject(ui, objectId);
      descriptionMask = 0x01;
      if (descIndex !== null) flags = ui.objectTables.objDescCarryMask[descIndex] ?? 0;
      break;
    }
    case DBType.MISC: {
      const rec = ui.dungeonState.getMiscRecord(objectId);
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
        const facing = ui.partyState?.facing ?? 0;
        const directions = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
        lines.push({ text: `PARTY FACING ${directions[facing & 3] ?? ''}`.trim(), color: 13 });
        break;
      }
      const descIndex = descIndexForObject(ui, objectId);
      descriptionMask = 0x09;
      if (descIndex !== null) flags = ui.objectTables.objDescCarryMask[descIndex] ?? 0;
      break;
    }
    default:
      break;
  }

  let phraseMask = descriptionMask & flags & 0x0f;
  phraseMask |= 0x40;

  const weight = getObjectWeight(ui, objectId | 0, new Set<number>());
  phrases[6] = formatWeightText(weight);

  const filter = applyViewingFilter(ui, objectId, phraseMask);
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
  return lines;
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

export function applyViewingFilter(ui: UIState, objectId: ObjectID, phraseMask: number): ViewingFilterResult | null {
  if (!ui.viewingFilter || !ui.objectTables) return null;
  const selected = ui.partyState?.selectedCharacterIndex ?? -1;
  if (selected < 0) return null;
  const textTables: TextDecodeTables = {
    escape1: ui.objectTables.textEscape1,
    escape2Wall: ui.objectTables.textEscape2Wall,
    escape2Other: ui.objectTables.textEscape2Other,
  };
  return ui.viewingFilter({
    phraseMask,
    objectId: objectId | 0,
    selectedCharacter: selected,
    textTables,
  });
}

export function drawItemDescriptionLine(ui: UIState, text: string, color: number, state: { x: number; y: number }): void {
  if (!ui.fontData || !ui.screenIndexBuffer) return;
  let remaining = text;
  while (remaining.length > 0) {
    let line = remaining;
    let next = '';
    if (line.length > 18) {
      let cut = 17;
      while (cut > 2 && line[cut] !== ' ') cut--;
      if (cut === 2) cut = 17;
      next = remaining.slice(cut + 1);
      line = remaining.slice(0, cut);
    }
    drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, state.x, state.y, color, null, line);
    state.y += 7;
    remaining = next;
  }
}

export function getInventoryPlaceholderIndex(champion: Champion, slot: number): number {
  if (slot >= 0 && slot <= 5) {
    const wounds = champion.wounds ?? 0;
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
    partySleeping: ui.uiMode === UIMode.Sleeping,
    getObjectNameIndex: (objectId) => resolveObjectNameIndex(ui, objectId),
  });
}

/**
 * `DetermineMastery(chIdx, role|0x8000)` (`doc/CSBwin-src/Character.cpp:4593`) — the rank
 * the eye panel prints is the earned one, so the `0x8000` flag drops the temporary
 * adjustment a spell or potion may be carrying.
 */
export function getRoleMastery(ui: UIState, champion: Champion, roleIndex: number): number {
  return determineMastery(ui, champion, roleIndex | 0x8000);
}
