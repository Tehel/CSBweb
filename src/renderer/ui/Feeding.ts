/**
 * Eating and drinking: the mouth button and its chew animation.
 *
 * Mirrors CSBWin's mouth handling in `doc/CSBwin-src/Character.cpp` — what a given object
 * in the cursor is worth as food or water, whether the record survives being consumed,
 * and the short chew animation the portrait plays afterwards.
 */
import { OBJNI_APPLE, OBJNI_DRAGON_STEAK, OBJNI_SPECIAL_G, OBJNI_SPECIAL_H, OBJNI_WATER, OBJNI_WATERSKIN } from '../../core/objectNameIndex';
import { PotionType } from '../../core/constants';
import { CursorFilterType } from '../../engine/DsaSystem';
import { applyFeedParameters, clearFeedParameters, derivePotionFeeding, type FeedParameters } from '../../engine/Feeding';
import { CHARFLAG_CHEST_OR_SCROLL } from '../../engine/gameTypes';
import { drawCharacterState } from '../../engine/Party';
import { DBType, OBJECT_ID_NULL, ObjectID, locationRelToInteger } from '../../core/types';
import { VIEWPORT_X, VIEWPORT_Y } from '../ViewportGraphics';
import { drawObjectIconAt } from './Draw';
import { descIndexForObject, resolveObjectNameIndex } from './Objects';
import { UIState, nowMs } from './UIState';

/** The swallow, sound ordinal 8 (`fp.gulp = 8`, `doc/CSBwin-src/Character.cpp:4111`). */
const SOUND_GULP = 8;

/**
 * The derivation half of `_FeedCharacter` (`doc/CSBwin-src/Character.cpp:4062-4287`).
 *
 * Works out what the object on the cursor is worth and fills in a `FeedParameters`
 * block. Nothing on the champion changes here: `applyFeedParameters` in
 * `src/engine/Feeding.ts` does that, after the feeding filter's DSAs have had their
 * chance to rewrite the block (`DsaSystem.feedingFilter`).
 */
export function computeFeedParameters(
  ui: UIState,
  chIdx: number,
  objectId: ObjectID,
): FeedParameters | null {
  const champ = ui.partyState.champions[chIdx];
  if (!champ) return null;

  const nameIndex = resolveObjectNameIndex(ui, objectId);
  if (nameIndex < 0) return null;
  const category = ui.ctx.dungeon.rnMaps.dbType(objectId as ObjectID);

  // `doc/CSBwin-src/Character.cpp:4032-4038`, `:4086-4096`: a scroll has no `objectType`,
  // and the party's square and facing are the block's `location`.
  const fp = clearFeedParameters();
  const party = ui.partyState;
  fp.location = locationRelToInteger({ l: party.position.z, x: party.position.x, y: party.position.y, p: party.facing });
  fp.characterIndex = chIdx;
  fp.objectID = objectId;
  if (category !== DBType.SCROLL) fp.objectType = nameIndex;
  fp.objectDB = category;

  // `d.ObjDesc[objDI].word4 & 1` — the mouth bit of the carry-location mask. Anything
  // without it is inedible, and a chest or a scroll is refused outright; other objects
  // fall through so a waterskin or a bones can still reach the branches below.
  const descIndex = descIndexForObject(ui, objectId as ObjectID);
  const carryMask = descIndex !== null ? ui.objectTables.objDescWord4[descIndex] ?? 0 : 0;
  if ((carryMask & 1) === 0) {
    if (category === DBType.CHEST || category === DBType.SCROLL) return null;
  } else {
    fp.performFeeding = true;
  }

  if (nameIndex >= OBJNI_WATERSKIN && nameIndex <= OBJNI_WATER) {
    // A waterskin holds gulps in the misc record's `value`, and each drink spends one.
    const rec = ui.ctx.dungeon.getMiscRecord(objectId as ObjectID);
    if ((rec?.specialState ?? 0) === 0) {
      fp.waterValue = 0;
      fp.emptyFlask = false;
    } else {
      fp.waterValue = 800;
      fp.gulp = SOUND_GULP;
      fp.emptyFlask = true;
    }
    fp.emptyHand = false;
    fp.performFeeding = true;
    return fp;
  }

  if (category === DBType.POTION) {
    const rec = ui.ctx.dungeon.getPotionRecord(objectId as ObjectID);
    if (!rec) return null;
    fp.emptyHand = false;
    fp.gulp = SOUND_GULP;
    derivePotionFeeding(fp, champ, rec.potionType | 0, rec.power | 0);
    return fp;
  }

  if (nameIndex >= OBJNI_APPLE && nameIndex <= OBJNI_DRAGON_STEAK) {
    fp.foodValue = getFoodValue(ui, nameIndex);
    fp.emptyHand = true;
    fp.performFeeding = true;
    fp.chew = true;
    fp.gulp = SOUND_GULP;
    return fp;
  }

  return fp;
}

/**
 * `_FeedCharacter` (`doc/CSBwin-src/Character.cpp:4004`), the mouth pressed. With an empty
 * hand, the mouth is held (`:4041-4058`) unless the eye panel already shows food and
 * water: `drawInventoryScreen` draws them over the chest, the scroll or the Resurrect
 * menu until the release (`handleMouseUnclick`). As with the eye (`handleEyePress`), the
 * button is taken to be down at the press, and the release comes through the queue.
 */
export function handleMouthPress(ui: UIState): void {
  if (ui.partyState.cursorOwner < 0) return;
  const selected = ui.partyState.selectedCharacterIndex;
  if (selected < 0) return;
  const champ = ui.partyState.champions[selected] ?? null;
  if (!champ || (champ.attributes.health | 0) === 0) return;

  const objectId = ui.partyState.objectInHand;
  if (objectId === OBJECT_ID_NULL) {
    if (ui.displayResurrectChestOrScroll === 0) return;
    ui.pressingMouth = true;
    return;
  }
  // `if (d.PotentialCharacterOrdinal != 0) RETURN;` — with an object in hand, the mouth
  // is inert while the Hall of Champions menu is up (`:4061`).
  if (ui.partyState.potentialChampionIndex >= 0) return;

  const derived = computeFeedParameters(ui, selected, objectId);
  if (!derived) return;
  // `objNID6`, which the filter cannot change, as it can `fp.objectType` (`:4457`).
  const objNID6 = derived.objectType;
  const fp = ui.ctx.systems.dsa.feedingFilter(derived);
  if (!applyFeedParameters(ui.ctx, selected, fp)) return;

  if (fp.chew) {
    startMouthChewAnimation(ui);
  } else if (fp.emptyFlask) {
    // A drained potion becomes an empty flask; a waterskin just loses one gulp.
    if (ui.ctx.dungeon.rnMaps.dbType(objectId as ObjectID) === DBType.POTION) {
      const rec = ui.ctx.dungeon.getPotionRecord(objectId as ObjectID);
      if (rec) rec.potionType = PotionType.EMPTY_FLASK;
    }
    // `value(value() - 1)` sets the record's two bits (`doc/CSBwin-src/CSB.h:1274`), so an
    // empty waterskin, which only the filter empties again, holds 3.
    if (objNID6 >= OBJNI_WATERSKIN && objNID6 <= OBJNI_WATER) {
      const rec = ui.ctx.dungeon.getMiscRecord(objectId as ObjectID);
      if (rec) rec.specialState = ((rec.specialState ?? 0) - 1) & 3;
    }
  }

  if (fp.emptyHand) {
    // `CURSORFILTER_Eat`, whose cancel nothing reads (`doc/CSBwin-src/Character.cpp:4471-4479`).
    const inHand = ui.partyState.objectInHand;
    if (inHand !== OBJECT_ID_NULL) {
      ui.ctx.systems.dsa.cursorFilter({ object: inHand, type: CursorFilterType.Eat, p1: 0, p2: 0, p3: 0, p4: 0 });
    }
    ui.partyState.objectInHand = OBJECT_ID_NULL;
    ui.ctx.dungeon.deleteDBEntry(objectId as ObjectID);
  }

  if (fp.gulp >= 0) ui.ctx.sounds.queueSound(fp.gulp, ui.partyState.position.x, ui.partyState.position.y, 0, ui.ctx.party.state.position.z);
  // `CHARFLAG_statsChanged` has no counterpart, the panels being drawn from live state;
  // `CHARFLAG_chestOrScroll` has, with food and water in the eye panel, and the
  // `DrawCharacterState` that ends the feeding (`doc/CSBwin-src/Character.cpp:4486-4492`).
  if (ui.displayResurrectChestOrScroll === 0) champ.charFlags |= CHARFLAG_CHEST_OR_SCROLL;
  drawCharacterState(ui.partyState, selected, 0, ui.ctx.host);
}

export function getFoodValue(ui: UIState, nameIndex: number): number {
  const values = ui.objectTables.foodValue;
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
