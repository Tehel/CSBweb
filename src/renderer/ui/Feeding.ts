/**
 * Eating and drinking: the mouth button and its chew animation.
 *
 * Mirrors CSBWin's mouth handling in `doc/CSBwin-src/Character.cpp` — what a given object
 * in the cursor is worth as food or water, whether the record survives being consumed,
 * and the short chew animation the portrait plays afterwards.
 */
import { OBJNI_APPLE, OBJNI_DRAGON_STEAK, OBJNI_SPECIAL_G, OBJNI_SPECIAL_H, OBJNI_WATER, OBJNI_WATERSKIN } from '../../core/objectNameIndex';
import { DBType, ObjectID, decodeObjectID } from '../../core/types';
import { VIEWPORT_X, VIEWPORT_Y } from '../ViewportGraphics';
import { drawObjectIconAt } from './Draw';
import { descIndexForObject, getBaseObjectNameIndex, getDescIndexForObjectType, isLikelyObjectRecord, normalizeObjectValue, resolveObjectNameIndex } from './Objects';
import { UIState, nowMs } from './UIState';
import { SoundIndex } from '@/core';

const POTION_EMPTY_FLASK = 20;
const POTION_WATER_FLASK = 15;

type FeedingOutcome = {
  foodDelta: number;
  waterDelta: number;
  removeFromHand: boolean;
  deleteRecord: boolean;
  chew: boolean;
  playGulp: boolean;
};

export function handleMouthPress(ui: UIState): void {
  if (!ui.partyState || !ui.objectTables) return;
  if ((ui.partyState.cursorOwner ?? -1) < 0) return;
  const selected = ui.partyState.selectedCharacterIndex ?? -1;
  if (selected < 0) return;
  const champ = ui.partyState.champions[selected] ?? null;
  if (!champ || champ.alive === false) return;

  const objectId = normalizeObjectValue(ui.partyState.objectInHand);
  if (objectId === null) return;

  const outcome = computeFeedingOutcome(ui, objectId);
  if (!outcome) return;

  if (outcome.removeFromHand) {
    ui.partyState.objectInHand = null;
    if (outcome.deleteRecord && isLikelyObjectRecord(ui, objectId)) {
      ui.dungeonState.deleteDBEntry(objectId as ObjectID);
    }
  }

  champ.food = clampFoodWater((champ.food ?? 0) + outcome.foodDelta);
  champ.water = clampFoodWater((champ.water ?? 0) + outcome.waterDelta);

  if (outcome.chew) startMouthChewAnimation(ui);
  if (outcome.playGulp && ui.playSound) ui.playSound(SoundIndex.SWALLOW);
}

export function computeFeedingOutcome(ui: UIState, objectId: number): FeedingOutcome | null {
  if (!ui.objectTables) return null;
  const isRecord = isLikelyObjectRecord(ui, objectId);
  const nameIndex = isRecord ? resolveObjectNameIndex(ui, objectId) : getBaseObjectNameIndex(ui, objectId);
  if (nameIndex < 0) return null;

  const descIndex = isRecord
    ? descIndexForObject(ui, objectId as ObjectID)
    : getDescIndexForObjectType(ui, objectId | 0);
  const carryMask = descIndex !== null ? ui.objectTables.objDescCarryMask[descIndex] ?? 0 : 0;
  const mouthAllowed = (carryMask & 1) !== 0;

  const isFood = isFoodNameIndex(nameIndex);
  const isWater = isWaterNameIndex(nameIndex);
  const isWaterFlask = isRecord && isWaterFlaskRecord(ui, objectId as ObjectID);

  if (!mouthAllowed && !isFood && !isWater && !isWaterFlask) return null;

  const outcome: FeedingOutcome = {
    foodDelta: 0,
    waterDelta: 0,
    removeFromHand: false,
    deleteRecord: false,
    chew: false,
    playGulp: false,
  };

  if (isWaterFlask) {
    const rec = ui.dungeonState.getPotionRecord(objectId as ObjectID);
    if (!rec) return null;
    outcome.waterDelta = 1600;
    outcome.playGulp = true;
    rec.potionType = POTION_EMPTY_FLASK;
    return outcome;
  }

  if (isWater) {
    if (isRecord && decodeObjectID(objectId as ObjectID).category === DBType.MISC) {
      const rec = ui.dungeonState.getMiscRecord(objectId as ObjectID);
      const value = rec?.specialState ?? 0;
      if (value > 0) {
        outcome.waterDelta = 800;
        outcome.playGulp = true;
        if (rec) rec.specialState = Math.max(0, value - 1);
      }
    } else {
      outcome.waterDelta = 800;
      outcome.playGulp = true;
      outcome.removeFromHand = true;
      outcome.deleteRecord = isRecord;
    }
    return outcome;
  }

  if (isFood) {
    outcome.foodDelta = getFoodValue(ui, nameIndex);
    outcome.removeFromHand = true;
    outcome.deleteRecord = isRecord;
    outcome.chew = true;
    outcome.playGulp = true;
    return outcome;
  }

  return null;
}

export function isWaterFlaskRecord(ui: UIState, objectId: ObjectID): boolean {
  const rec = ui.dungeonState.getPotionRecord(objectId);
  return rec?.potionType === POTION_WATER_FLASK;
}

export function isFoodNameIndex(nameIndex: number): boolean {
  return nameIndex >= OBJNI_APPLE && nameIndex <= OBJNI_DRAGON_STEAK;
}

export function isWaterNameIndex(nameIndex: number): boolean {
  return nameIndex >= OBJNI_WATERSKIN && nameIndex <= OBJNI_WATER;
}

export function getFoodValue(ui: UIState, nameIndex: number): number {
  const values = ui.objectTables?.foodValue;
  if (!values) return 0;
  const offset = nameIndex - OBJNI_APPLE;
  if (offset < 0 || offset >= values.length) return 0;
  return values[offset] ?? 0;
}

export function clampFoodWater(value: number): number {
  return Math.max(-1023, Math.min(2048, Math.floor(value)));
}

export function startMouthChewAnimation(ui: UIState): void {
  const now = nowMs();
  const frameMs = (1000 * 8) / 60;
  ui.mouthChewStartMs = now;
  ui.mouthChewEndMs = now + frameMs * 4;
  ensureMouthChewLoop(ui);
}

export function drawMouthChewAnimation(ui: UIState): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.objectTables) return;
  if (ui.mouthChewStartMs === null) return;
  const now = nowMs();
  if (now >= ui.mouthChewEndMs) return;

  const frameMs = (1000 * 8) / 60;
  const frame = Math.floor((now - ui.mouthChewStartMs) / frameMs);
  const icon = (frame % 2 === 0) ? OBJNI_SPECIAL_H : OBJNI_SPECIAL_G;
  const mouthRect = ui.uiTables.graphic232.word1398;
  const x = VIEWPORT_X + mouthRect.x1 + 1;
  const y = VIEWPORT_Y + mouthRect.y1 + 1;
  drawObjectIconAt(ui, x, y, icon, ui.uiTables.graphic232.word612, -1);
}

export function ensureMouthChewLoop(ui: UIState): void {
  if (ui.mouthChewFrameHandle !== null) return;
  const schedule = (cb: (time: number) => void): number => {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
    return setTimeout(() => cb(nowMs()), 16) as unknown as number;
  };
  const tick = () => {
    if (ui.mouthChewStartMs === null) {
      ui.mouthChewFrameHandle = null;
      return;
    }
    const now = nowMs();
    if (now >= ui.mouthChewEndMs) {
      ui.mouthChewStartMs = null;
      ui.mouthChewFrameHandle = null;
      ui.renderLastFrame();
      return;
    }
    ui.renderLastFrame();
    ui.mouthChewFrameHandle = schedule(tick);
  };
  ui.mouthChewFrameHandle = schedule(tick);
}
