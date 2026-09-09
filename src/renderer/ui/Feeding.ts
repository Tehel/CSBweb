/**
 * Eating and drinking: the mouth button and its chew animation.
 *
 * Mirrors CSBWin's mouth handling in `doc/CSBwin-src/Character.cpp` — what a given object
 * in the cursor is worth as food or water, whether the record survives being consumed,
 * and the short chew animation the portrait plays afterwards.
 */
import { OBJNI_APPLE, OBJNI_DRAGON_STEAK, OBJNI_SPECIAL_G, OBJNI_SPECIAL_H, OBJNI_WATER, OBJNI_WATERSKIN } from '../../core/objectNameIndex';
import { PotionType } from '../../core/constants';
import { clearFeedParameters, derivePotionFeeding, type FeedParameters } from '../../engine/Feeding';
import { DBType, ObjectID, decodeObjectID } from '../../core/types';
import { VIEWPORT_X, VIEWPORT_Y } from '../ViewportGraphics';
import { drawObjectIconAt } from './Draw';
import { descIndexForObject, getBaseObjectNameIndex, getDescIndexForObjectType, isLikelyObjectRecord, normalizeObjectValue, resolveObjectNameIndex } from './Objects';
import { UIState, nowMs } from './UIState';
import { SoundIndex } from '@/core';

/**
 * The derivation half of `_FeedCharacter` (`doc/CSBwin-src/Character.cpp:4062-4287`).
 *
 * Works out what the object on the cursor is worth and fills in a `FeedParameters`
 * block. Nothing on the champion changes here: `applyFeedParameters` in
 * `src/engine/Feeding.ts` does that, after the Feeding Filter DSA would have had its
 * chance to rewrite the block.
 */
export function computeFeedParameters(
  ui: UIState,
  chIdx: number,
  objectId: number,
): FeedParameters | null {
  if (!ui.objectTables || !ui.partyState) return null;
  const champ = ui.partyState.champions[chIdx];
  if (!champ) return null;

  const isRecord = isLikelyObjectRecord(ui, objectId);
  const nameIndex = isRecord ? resolveObjectNameIndex(ui, objectId) : getBaseObjectNameIndex(ui, objectId);
  if (nameIndex < 0) return null;
  const category = isRecord ? decodeObjectID(objectId as ObjectID).category : null;

  const fp = clearFeedParameters();
  fp.characterIndex = chIdx;
  fp.objectID = objectId;
  fp.objectType = nameIndex;
  fp.objectDB = category ?? -1;

  // `d.ObjDesc[objDI].word4 & 1` — the mouth bit of the carry-location mask. Anything
  // without it is inedible, and a chest or a scroll is refused outright; other objects
  // fall through so a waterskin or a bones can still reach the branches below.
  const descIndex = isRecord
    ? descIndexForObject(ui, objectId as ObjectID)
    : getDescIndexForObjectType(ui, objectId | 0);
  const carryMask = descIndex !== null ? ui.objectTables.objDescCarryMask[descIndex] ?? 0 : 0;
  if ((carryMask & 1) === 0) {
    if (category === DBType.CHEST || category === DBType.SCROLL) return null;
  } else {
    fp.performFeeding = true;
  }

  if (nameIndex >= OBJNI_WATERSKIN && nameIndex <= OBJNI_WATER) {
    // A waterskin holds gulps in the misc record's `value`, and each drink spends one.
    const rec = isRecord ? ui.dungeonState.getMiscRecord(objectId as ObjectID) : null;
    if ((rec?.specialState ?? 0) === 0) {
      fp.waterValue = 0;
      fp.emptyFlask = false;
    } else {
      fp.waterValue = 800;
      fp.gulp = SoundIndex.SWALLOW;
      fp.emptyFlask = true;
    }
    fp.emptyHand = false;
    fp.performFeeding = true;
    return fp;
  }

  if (category === DBType.POTION) {
    const rec = ui.dungeonState.getPotionRecord(objectId as ObjectID);
    if (!rec) return null;
    fp.emptyHand = false;
    fp.gulp = SoundIndex.SWALLOW;
    derivePotionFeeding(fp, champ, rec.potionType | 0, rec.power | 0);
    return fp;
  }

  if (nameIndex >= OBJNI_APPLE && nameIndex <= OBJNI_DRAGON_STEAK) {
    fp.foodValue = getFoodValue(ui, nameIndex);
    fp.emptyHand = true;
    fp.performFeeding = true;
    fp.chew = true;
    fp.gulp = SoundIndex.SWALLOW;
    return fp;
  }

  return fp;
}

export function handleMouthPress(ui: UIState): void {
  if (!ui.partyState || !ui.objectTables) return;
  if ((ui.partyState.cursorOwner ?? -1) < 0) return;
  // `if (d.PotentialCharacterOrdinal != 0) RETURN;` — the mouth is inert while the
  // Hall of Champions menu is up (`doc/CSBwin-src/Character.cpp:4061`).
  if ((ui.partyState.potentialChampionIndex ?? -1) >= 0) return;
  const selected = ui.partyState.selectedCharacterIndex ?? -1;
  if (selected < 0) return;
  const champ = ui.partyState.champions[selected] ?? null;
  if (!champ || champ.alive === false) return;

  const objectId = normalizeObjectValue(ui.partyState.objectInHand);
  if (objectId === null) return;

  const fp = computeFeedParameters(ui, selected, objectId);
  if (!fp) return;

  // Where the Feeding Filter DSA would rewrite the block
  // (`doc/CSBwin-src/Character.cpp:4288-4344`). ⏳ Not ported: no dungeon we load
  // defines `ESL_FEEDINGFILTER`, and the DSA parameter marshalling is its own job.
  const applied = ui.applyFeeding?.(selected, fp) ?? false;
  if (!applied) return;

  const isRecord = isLikelyObjectRecord(ui, objectId);
  if (fp.chew) {
    startMouthChewAnimation(ui);
  } else if (fp.emptyFlask) {
    // A drained potion becomes an empty flask; a waterskin just loses one gulp.
    if (decodeObjectID(objectId as ObjectID).category === DBType.POTION) {
      const rec = ui.dungeonState.getPotionRecord(objectId as ObjectID);
      if (rec) rec.potionType = PotionType.EMPTY_FLASK;
    }
    if (fp.objectType >= OBJNI_WATERSKIN && fp.objectType <= OBJNI_WATER) {
      const rec = ui.dungeonState.getMiscRecord(objectId as ObjectID);
      if (rec) rec.specialState = Math.max(0, (rec.specialState ?? 0) - 1);
    }
  }

  if (fp.emptyHand) {
    ui.partyState.objectInHand = null;
    if (isRecord) ui.dungeonState.deleteDBEntry(objectId as ObjectID);
  }

  if (fp.gulp >= 0) ui.playSound?.(fp.gulp);
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
