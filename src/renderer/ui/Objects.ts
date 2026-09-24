/**
 * Object identity, naming, description and weight.
 *
 * Ports CSBWin's object-description machinery (`doc/CSBwin-src/Objects.cpp`,
 * `doc/CSBwin-src/Code17818.cpp`): resolving an object reference to its `OBJNI_*` name
 * index, the phrase/attribute lines the eye shows, carried weight, and `DetermineMastery`.
 */
import { OBJNI_BONES_A, OBJNI_COMPASS_N, OBJNI_COMPASS_W, OBJNI_EMPTY_FLASK, OBJNI_SPECIAL_F, OBJNI_SPECIAL_J, OBJNI_SPECIAL_N, OBJNI_TORCH_A, OBJNI_TORCH_D, OBJNI_WATER, OBJNI_WATERSKIN, OBJNI_WATER_FLASK } from '../../core/objectNameIndex';
import { DescIndex, GetBasicObjectType, NameIndex } from '../../engine/objectIndex';
import { DBType, ObjectID, decodeObjectID } from '../../core/types';
import { ViewingFilterResult } from '../../engine/DsaSystem';
import { TextDecodeTables } from '../../engine/DungeonState';
import { Champion } from '../../engine/gameTypes';
import { findChampionByFingerprint } from '../../engine/Party';
import { determineMastery as determineMasteryEngine } from '../../engine/skills';
import { drawTextLineIndex } from '../csbwin/TextRenderer';
import { UIMode, UIState } from './UIState';
export type ItemDescriptionLine = { text: string; color: number };

/**
 * `RN::NameIndex` (`src/engine/objectIndex.ts`) with the UI's tables and the party's
 * facing. -1 for a negative value, which some callers pass for "no object".
 */
export function resolveObjectNameIndex(ui: UIState, value: number): number {
  if (value < 0 || !ui.objectTables) return -1;
  return NameIndex(
    ui.dungeonState,
    {
      objDescObjectType: ui.objectTables.objDescObjectType,
      byte640: ui.uiTables?.graphic232.byte640 ?? [],
    },
    ui.partyState?.facing ?? 0,
    value,
  );
}

/** `GetBasicObjectType` (`src/engine/objectIndex.ts`). -1 as `resolveObjectNameIndex`. */
export function getBaseObjectNameIndex(ui: UIState, rn: number): number {
  if (rn < 0 || !ui.objectTables) return -1;
  return GetBasicObjectType(ui.dungeonState, ui.objectTables.objDescObjectType, rn);
}

/** `d.ObjDesc[rn.DescIndex()].attackClass`; 0, "no attacks", when there is no row. */
export function getAttackClass(ui: UIState, rn: number): number {
  if (!ui.objectTables || rn < 0) return 0;
  const descIndex = DescIndex(ui.dungeonState, rn);
  if (descIndex === -1) return 0;
  return ui.objectTables.objDescAttackClass[descIndex] ?? 0;
}

/** `RN::DescIndex` (`src/engine/objectIndex.ts`), with `null` for -1. */
export function descIndexForObject(ui: UIState, rn: ObjectID): number | null {
  const descIndex = DescIndex(ui.dungeonState, rn);
  return descIndex === -1 ? null : descIndex;
}

export function isChestRecord(value: number | null): value is ObjectID {
  if (value === null) return false;
  return decodeObjectID(value as ObjectID).category === DBType.CHEST;
}

export function isBaseObjectNameIndex(ui: UIState, objectId: number, min: number, max: number): boolean {
  const base = getBaseObjectNameIndex(ui, objectId);
  return base >= min && base <= max;
}

export function getObjectName(ui: UIState, objectNameIndex: number): string {
  const names = ui.objectTables?.objectNames ?? [];
  if (objectNameIndex >= 0 && objectNameIndex < names.length) {
    return names[objectNameIndex] ?? '';
  }
  return `OBJECT ${objectNameIndex}`;
}

/**
 * The champion a bones object belongs to, or `null`.
 *
 * The same four-step lookup CSBWin spells out twice — in the eye's object panel
 * (`doc/CSBwin-src/Character.cpp:3549-3580`) and in `DrawNameOfHeldObject`
 * (`doc/CSBwin-src/Code11f52.cpp:38-59`). Both key on the *name index* being
 * `objNI_Bones_a` rather than on the `DB10` misc type, and both refuse bones whose
 * `value()` is 0: those are inert scenery, not anybody's remains
 * (`doc/CSBwin-src/CSB.h:1258-1264`).
 *
 * ⚠️ `CopyCharacter` searches the party and then `GetFromWings`; this port has no
 * wings, so a fingerprint matching nobody still in the party goes unresolved and the
 * bones keep their plain name — see `findChampionByFingerprint`.
 */
export function getBonesChampion(ui: UIState, objectId: ObjectID, objectNameIndex: number): Champion | null {
  if (objectNameIndex !== OBJNI_BONES_A) return null;
  const misc = ui.dungeonState.getMiscRecord(objectId);
  if (!misc) return null;
  // `value = pBones->value(); if (value != 0)` — are these bones a champion's at all?
  if ((misc.specialState | 0) === 0) return null;
  const fingerprint = ui.dungeonState.copyChampionBonesRecord(objectId);
  if (fingerprint === null || !ui.partyState) return null;
  const chIdx = findChampionByFingerprint(ui.partyState, fingerprint);
  if (chIdx === -1) return null;
  return ui.partyState.champions[chIdx] ?? null;
}

export function getObjectDisplayName(ui: UIState, objectId: ObjectID, objectNameIndex: number): string {
  let name = getObjectName(ui, objectNameIndex);
  if (!name) return name;
  const { category } = decodeObjectID(objectId);

  // `StrCpy(descriptiveText, pcA0->name); StrCat(descriptiveText, d.ObjectNames[objNID6])`
  // — no separator, so the two run together exactly as CSBWin prints them.
  const owner = getBonesChampion(ui, objectId, objectNameIndex);
  if (owner?.name) name = `${owner.name} ${name}`;

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

/**
 * `GetObjectWeight` / `TAG0091e6`, in the engine (`src/engine/CharacterStats.ts`).
 */
export function getObjectWeightForRecord(ui: UIState, rn: ObjectID, visited: Set<number>): number {
  return ui.characterStats?.getObjectWeight(rn, visited) ?? 0;
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

  const weight = getObjectWeightForRecord(ui, objectId, new Set<number>());
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
