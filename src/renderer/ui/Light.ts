/**
 * How bright the dungeon is, and therefore which viewport palette to draw it with.
 *
 * CSBWin sums the party's light sources — lit torches (brightest four, weighted), the
 * magic-light counter and the map's own ambient level — then walks `paletteBrightness`
 * for the first threshold above that total. The resulting index selects one of the
 * `palette552` sets extracted from graphics.dat item `0x232`.
 */
import { OBJNI_TORCH_A, OBJNI_TORCH_D } from '../../core/objectNameIndex';
import { ObjectID } from '../../core/types';
import { getChampionPossession } from './Character';
import { getBaseObjectNameIndex } from './Objects';
import { isLikelyObjectRecord } from '../../engine/objectIndex';
import { UIState } from './UIState';

export function selectPaletteIndexForLightLevel(ui: UIState): number {
  if (!ui.uiTables || !ui.partyState) return 0;
  const { paletteBrightness, word1074 } = ui.uiTables.graphic232;
  if (!paletteBrightness || paletteBrightness.length === 0 || !word1074 || word1074.length === 0) return 0;

  const map = ui.dungeonState.getMap(ui.partyState.position.z);
  const experienceMultiplier = map?.descriptor.difficulty ?? 0;
  if (experienceMultiplier === 0) return 0;

  const torchLight = computeTorchLight(ui, word1074);
  const totalLight = (ui.partyState.brightness ?? 0) + torchLight;

  if (totalLight <= 0) return paletteBrightness.length - 1;

  let paletteIndex = 0;
  for (let i = 0; i < paletteBrightness.length; i++) {
    if ((paletteBrightness[i] ?? 0) > totalLight) {
      paletteIndex++;
    } else {
      break;
    }
  }

  if (paletteIndex < 0) paletteIndex = 0;
  if (paletteIndex >= paletteBrightness.length) paletteIndex = paletteBrightness.length - 1;
  return paletteIndex;
}

export function computeTorchLight(ui: UIState, word1074: number[]): number {
  if (!ui.partyState) return 0;
  const charges = collectTorchCharges(ui);

  // CSBWin selection-sort: bring four brightest charges to the front.
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < charges.length; j++) {
      if (charges[j] > charges[i]) {
        const temp = charges[j];
        charges[j] = charges[i];
        charges[i] = temp;
      }
    }
  }

  let total = 0;
  let shift = 6;
  for (let i = 0; i < 5 && i < charges.length; i++) {
    const charge = charges[i] ?? 0;
    if (charge === 0) continue;
    const idx = Math.max(0, Math.min(charge, word1074.length - 1));
    let value = word1074[idx] ?? 0;
    value &= 0xffff;
    value = (value << shift) >>> 0;
    value = (value >>> 6) & 0x3ff;
    total += value;
    shift = Math.max(0, shift - 1);
  }

  return total;
}

export function collectTorchCharges(ui: UIState): number[] {
  const charges = new Array(8).fill(0);
  if (!ui.partyState) return charges;

  let outIndex = 0;
  for (let chIdx = 0; chIdx < 4; chIdx++) {
    const champ = ui.partyState.champions[chIdx];
    for (let hand = 0; hand < 2; hand++) {
      if (!champ) {
        charges[outIndex++] = 0;
        continue;
      }
      const objectId = getChampionPossession(champ, hand);
      if (objectId === null) {
        charges[outIndex++] = 0;
        continue;
      }
      const baseNameIndex = getBaseObjectNameIndex(ui, objectId);
      if (baseNameIndex >= OBJNI_TORCH_A && baseNameIndex <= OBJNI_TORCH_D) {
        charges[outIndex++] = getTorchCharge(ui, objectId);
      } else {
        charges[outIndex++] = 0;
      }
    }
  }
  return charges;
}

export function getTorchCharge(ui: UIState, objectId: number): number {
  if (!isLikelyObjectRecord(ui.dungeonState, objectId)) return 0;
  const weapon = ui.dungeonState.getWeaponRecord(objectId as ObjectID);
  if (!weapon) return 0;
  return weapon.charges & 0xf;
}
