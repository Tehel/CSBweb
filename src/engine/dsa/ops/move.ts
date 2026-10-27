import {
  DBType,
  OBJECT_ID_EOF,
  OBJECT_ID_NULL,
  Position,
  locationRelFromInteger,
  rnEquals,
  type ObjectID,
} from '../../../core/types';
import { DescIndex } from '../../objectIndex';
import { forgetThrownWeapon } from '../../ThrownWeapons';
import { TimerFunction } from '../../TimerQueue';
import { CursorFilterType, StkOp } from '../DsaTypes';
import type { DsaOperation, DsaOperationMachine } from '../DsaOperations';
import { choosePositionFromMask, detachedGroupIndex, objectMover } from './objects';

/** `ERRORCODES` (`doc/CSBwin-src/MoveObject.cpp:92-127`): a source's, then a destination's. */
const enum DsaMoveError {
  SER_OK = 0,
  SER_UnknownLocType = 1,
  SER_NoObjInCursor = 2,
  SER_IllegalCharacterIndex = 3,
  SER_IllegalCarryLocation = 4,
  SER_NoObjectAtCarryLocation = 5,
  SER_InvalidCellLocation = 6,
  SER_NoSuchObjectInCell = 7,
  SER_IllegalMonsterID = 8,
  SER_MonsterIsNotMonster = 9,
  SER_NoSuchObjectOnMonster = 10,
  SER_IllegalChestID = 11,
  SER_ChestIsNotChest = 12,
  SER_NoSuchObjectInChest = 13,
  SER_ChestBelongsToCharacter = 14,
  SER_NoCloudsPlease = 15,
  SER_BadCloudTimer = 16,
  DER_OK = 0,
  DER_UnknownLocType = -1,
  DER_IllegalCharacterIndex = -2,
  DER_IllegalPossessionIndex = -3,
  DER_PossessionSlotNotEmpty = -4,
  DER_IllegalObjectForCarryLocation = -5,
  DER_CursorNotEmpty = -6,
  DER_InvalidCellLocation = -7,
  DER_IllegalDepth = -8,
  DER_IllegalChestID = -9,
  DER_ChestIsNotAChest = -10,
  DER_ChestBelongsToCharacter = -11,
  DER_ChestIsFull = -12,
  DER_IllegalMonsterID = -13,
  DER_MonsterIsNotAMonster = -14,
  DER_NoCloudsPlease = -15,
}

/** `&MOVE`'s move. Exported so that `tools/` can make one without a program. */
export function moveObjectDsa(
  machine: DsaOperationMachine,
  srcType: number,
  srcObjMsk: number,
  srcPosMsk: number,
  srcLoc: number,
  srcDepth: number,
  dstType: number,
  dstObjMsk: number,
  dstPosMsk: number,
  dstLoc: number,
  dstDepth: number,
): number {
  const sourceCheck = checkSource(
      machine,
    srcType,
    srcObjMsk,
    srcPosMsk,
    srcLoc,
    srcDepth,
    dstType,
    dstLoc,
    false,
  );
  if (sourceCheck.error !== 0) return sourceCheck.error;
  // `hTimer`: the cloud's timer, found by the check pass only (MoveObject.cpp:721-790).
  const hTimer = sourceCheck.timer ?? -1;
  const destCheck = checkDestination(
      machine,
    dstType,
    dstObjMsk,
    dstPosMsk,
    dstLoc,
    dstDepth,
    sourceCheck.object,
    srcType,
    srcLoc,
    hTimer,
    false,
  );
  if (destCheck !== 0) return destCheck;
  const sourceMove = checkSource(
      machine,
    srcType,
    srcObjMsk,
    srcPosMsk,
    srcLoc,
    srcDepth,
    dstType,
    dstLoc,
    true,
  );
  if (sourceMove.error !== 0) return sourceMove.error;
  const destMove = checkDestination(
      machine,
    dstType,
    dstObjMsk,
    dstPosMsk,
    dstLoc,
    dstDepth,
    sourceMove.object,
    srcType,
    srcLoc,
    hTimer,
    true,
  );
  return destMove;
}

function checkSource(
  machine: DsaOperationMachine,
  srcType: number,
  srcObjMsk: number,
  srcPosMsk: number,
  srcLoc: number,
  srcDepth: number,
  dstType: number,
  dstLoc: number,
  doit: boolean,
): { error: number; object: ObjectID; timer?: number } {
  switch (srcType) {
    case 2:
      return findCursorSource(machine, doit);
    case 4:
      return findCharacterSource(machine, srcPosMsk, srcLoc, doit);
    case 1:
      return findCellSource(machine, srcObjMsk, srcPosMsk, srcLoc, srcDepth, dstType, dstLoc, doit);
    case 3:
      return findMonsterSource(machine, srcObjMsk, srcLoc, srcDepth, doit);
    case 5:
      return findChestSource(machine, srcObjMsk, srcLoc, srcDepth, doit);
    default:
      return { error: DsaMoveError.SER_UnknownLocType, object: OBJECT_ID_EOF };
  }
}

function checkDestination(
  machine: DsaOperationMachine,
  dstType: number,
  dstObjMsk: number,
  dstPosMsk: number,
  dstLoc: number,
  dstDepth: number,
  object: ObjectID,
  srcType: number,
  srcLoc: number,
  hTimer: number,
  doit: boolean,
): number {
  switch (dstType) {
    case 4:
      return findCharacterDestination(machine, dstPosMsk, dstLoc, object, doit);
    case 2:
      return checkObjectToCursor(machine, object, doit);
    case 1:
      return findCellDestination(machine, dstObjMsk, dstPosMsk, dstLoc, dstDepth, object, srcType, srcLoc, hTimer, doit);
    case 5:
      return findChestDestination(machine, dstLoc, dstDepth, object, doit);
    case 3:
      return findMonsterDestination(machine, dstLoc, dstDepth, object, doit);
    default:
      return DsaMoveError.DER_UnknownLocType;
  }
}

function findCursorSource(machine: DsaOperationMachine, doit: boolean): { error: number; object: ObjectID } {
  const party = machine.ctx.party.state;
  if (!party) return { error: DsaMoveError.SER_NoObjInCursor, object: OBJECT_ID_EOF };
  const obj = party.objectInHand;
  if (obj === OBJECT_ID_NULL) return { error: DsaMoveError.SER_NoObjInCursor, object: OBJECT_ID_EOF };
  if (doit) {
    // `CURSORFILTER_DSA_MoveFrom`, which cannot cancel. The object moved is the one
    // found before it, and the hand is emptied of whatever it holds after
    // (`doc/CSBwin-src/MoveObject.cpp:130-143`).
    machine.filters.cursorFilter({ object: obj, type: CursorFilterType.DSA_MoveFrom, p1: 0, p2: 0, p3: 0, p4: 0 });
    party.objectInHand = OBJECT_ID_NULL;
  }
  return { error: DsaMoveError.SER_OK, object: obj };
}

/** `&MOVE`'s character source. Exported so that `tools/` can take one arm of a move alone. */
export function findCharacterSource(machine: DsaOperationMachine, chIdx: number, carryLoc: number, doit: boolean): { error: number; object: ObjectID } {
  const party = machine.ctx.party.state;
  if (!party) return { error: DsaMoveError.SER_IllegalCharacterIndex, object: OBJECT_ID_EOF };
  if (chIdx < 0 || chIdx >= party.champions.length) {
    return { error: DsaMoveError.SER_IllegalCharacterIndex, object: OBJECT_ID_EOF };
  }
  if (carryLoc < 0 || carryLoc > 29) {
    return { error: DsaMoveError.SER_IllegalCarryLocation, object: OBJECT_ID_EOF };
  }
  const champ = party.champions[chIdx] ?? null;
  if (!champ) return { error: DsaMoveError.SER_IllegalCharacterIndex, object: OBJECT_ID_EOF };
  const obj = champ.possessions[carryLoc]!;
  if (obj === OBJECT_ID_NULL) return { error: DsaMoveError.SER_NoObjectAtCarryLocation, object: OBJECT_ID_EOF };
  if (machine.ctx.dungeon.rnMaps.dbType(obj) === DBType.CLOUD) {
    return { error: DsaMoveError.SER_NoCloudsPlease, object: OBJECT_ID_EOF };
  }
  if (doit) machine.ctx.systems.character.removeCharacterPossession(chIdx, carryLoc);
  return { error: DsaMoveError.SER_OK, object: obj };
}

/**
 * `FindCellSource` (`doc/CSBwin-src/MoveObject.cpp:166-251`). Unlike the character,
 * monster and chest sources, a cell hands a cloud over: the check pass finds the
 * cloud's `TT_25` (or a Fluxcage's `TT_24`) and returns it as `hTimer` for
 * `FindCellDestination` to retarget, or `SER_BadCloudTimer` when there is none.
 * `TIMER_SEARCH` walks the slots in order, so the lowest slot wins, and `RN`'s `!=`
 * compares the indirect index only (`CSBTypes.h:359`) — the corner is not part of it.
 */
function findCellSource(
  machine: DsaOperationMachine,
  srcObjMsk: number,
  srcPosMsk: number,
  srcLoc: number,
  srcDepth: number,
  dstType: number,
  dstLoc: number,
  doit: boolean,
): { error: number; object: ObjectID; timer?: number } {
  const locr = locationRelFromInteger(srcLoc);
  if (!machine.ctx.dungeon.isValidLocation(locr)) {
    return { error: DsaMoveError.SER_InvalidCellLocation, object: OBJECT_ID_EOF };
  }
  let positionMask = srcPosMsk;
  if (positionMask === -1) positionMask = 1 << (locr.p & 3);
  let depth = srcDepth;
  const pos = new Position(locr.x, locr.y, locr.l);
  let object = OBJECT_ID_EOF;
  for (let rn = machine.ctx.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = machine.ctx.dungeon.getDBRecordLink(rn)) {
    const decoded = machine.ctx.dungeon.rnMaps.decode(rn);
    if (((1 << decoded.position) & positionMask) === 0) continue;
    if (((1 << decoded.category) & srcObjMsk) === 0) continue;
    if (depth === 0) {
      object = rn;
      break;
    }
    depth -= 1;
  }
  if (object === OBJECT_ID_EOF) return { error: DsaMoveError.SER_NoSuchObjectInCell, object: OBJECT_ID_EOF };
  if (doit) {
    // A monster moved within the party's level is not lifted: `FindCellDestination`
    // moves it square to square (`MoveObject.cpp:203-220`).
    const partyLevel = machine.ctx.party.state.position.z;
    const sameLevelMonsterMove = machine.ctx.dungeon.rnMaps.dbType(object) === DBType.CREATURE
      && dstType === 1
      && locationRelFromInteger(dstLoc).l === partyLevel
      && locr.l === partyLevel;
    if (!sameLevelMonsterMove) objectMover(machine).moveObject(object, locr.x, locr.y, -1, 0, locr.l);
  } else if (machine.ctx.dungeon.rnMaps.dbType(object) === DBType.CLOUD) {
    // The first match in `TIMER_SEARCH` order (`MoveObject.cpp:233-241`).
    for (const entry of machine.ctx.timers.searchOrder()) {
      if (entry.function !== TimerFunction.TT_25 && entry.function !== TimerFunction.TT_24) continue;
      if (entry.object === undefined || !rnEquals(entry.object, object)) continue;
      return { error: DsaMoveError.SER_OK, object, timer: entry.index };
    }
    return { error: DsaMoveError.SER_BadCloudTimer, object };
  }
  return { error: DsaMoveError.SER_OK, object };
}

function findMonsterSource(
  machine: DsaOperationMachine,
  srcObjMsk: number,
  srcLoc: number,
  srcDepth: number,
  doit: boolean,
): { error: number; object: ObjectID } {
  if (!machine.isValidObjectId(srcLoc)) {
    return { error: DsaMoveError.SER_IllegalMonsterID, object: OBJECT_ID_EOF };
  }
  const decodedMon = machine.ctx.dungeon.rnMaps.decode(srcLoc);
  if (decodedMon.category !== DBType.CREATURE) {
    return { error: DsaMoveError.SER_MonsterIsNotMonster, object: OBJECT_ID_EOF };
  }
  const monster = machine.ctx.dungeon.getCreatureRecord(srcLoc);
  if (!monster) return { error: DsaMoveError.SER_MonsterIsNotMonster, object: OBJECT_ID_EOF };
  let depth = srcDepth;
  let prev = OBJECT_ID_EOF;
  for (let rn = monster.possession; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = machine.ctx.dungeon.getDBRecordLink(rn)) {
    const decoded = machine.ctx.dungeon.rnMaps.decode(rn);
    if (((1 << decoded.category) & srcObjMsk) === 0) {
      prev = rn;
      continue;
    }
    if (depth === 0) {
      if (decoded.category === DBType.CLOUD) {
        return { error: DsaMoveError.SER_NoCloudsPlease, object: OBJECT_ID_EOF };
      }
      if (doit) {
        const next = machine.ctx.dungeon.getDBRecordLink(rn);
        if (prev === OBJECT_ID_EOF) monster.possession = next;
        else machine.ctx.dungeon.setDBRecordLink(prev, next);
        machine.ctx.dungeon.setDBRecordLink(rn, OBJECT_ID_EOF);
      }
      return { error: DsaMoveError.SER_OK, object: rn };
    }
    depth -= 1;
    prev = rn;
  }
  return { error: DsaMoveError.SER_NoSuchObjectOnMonster, object: OBJECT_ID_EOF };
}

function findChestSource(
  machine: DsaOperationMachine,
  srcObjMsk: number,
  srcLoc: number,
  srcDepth: number,
  doit: boolean,
): { error: number; object: ObjectID } {
  if (!machine.isValidObjectId(srcLoc)) {
    return { error: DsaMoveError.SER_IllegalChestID, object: OBJECT_ID_EOF };
  }
  const decodedChest = machine.ctx.dungeon.rnMaps.decode(srcLoc);
  if (decodedChest.category !== DBType.CHEST) {
    return { error: DsaMoveError.SER_ChestIsNotChest, object: OBJECT_ID_EOF };
  }
  if (isObjectInCharactersOrCursor(machine, srcLoc)) {
    return { error: DsaMoveError.SER_ChestBelongsToCharacter, object: OBJECT_ID_EOF };
  }
  const chest = machine.ctx.dungeon.getContainerRecord(srcLoc);
  if (!chest) return { error: DsaMoveError.SER_ChestIsNotChest, object: OBJECT_ID_EOF };
  let depth = srcDepth;
  let prev = OBJECT_ID_EOF;
  for (let rn = chest.containedObject; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = machine.ctx.dungeon.getDBRecordLink(rn)) {
    const decoded = machine.ctx.dungeon.rnMaps.decode(rn);
    if (((1 << decoded.category) & srcObjMsk) === 0) {
      prev = rn;
      continue;
    }
    if (depth === 0) {
      if (decoded.category === DBType.CLOUD) {
        return { error: DsaMoveError.SER_NoCloudsPlease, object: OBJECT_ID_EOF };
      }
      if (doit) {
        const next = machine.ctx.dungeon.getDBRecordLink(rn);
        if (prev === OBJECT_ID_EOF) chest.containedObject = next;
        else machine.ctx.dungeon.setDBRecordLink(prev, next);
        machine.ctx.dungeon.setDBRecordLink(rn, OBJECT_ID_EOF);
      }
      return { error: DsaMoveError.SER_OK, object: rn };
    }
    depth -= 1;
    prev = rn;
  }
  return { error: DsaMoveError.SER_NoSuchObjectInChest, object: OBJECT_ID_EOF };
}

/** `&MOVE`'s character destination. Exported so that `tools/` can take one arm of a move alone. */
export function findCharacterDestination(
  machine: DsaOperationMachine,
  chIdx: number,
  carryLoc: number,
  object: ObjectID,
  doit: boolean,
): number {
  if (machine.ctx.dungeon.rnMaps.dbType(object) === DBType.CLOUD) return DsaMoveError.DER_NoCloudsPlease;
  const party = machine.ctx.party.state;
  if (!party) return DsaMoveError.DER_IllegalCharacterIndex;
  if (chIdx < 0 || chIdx >= party.champions.length) return DsaMoveError.DER_IllegalCharacterIndex;
  if (carryLoc < 0 || carryLoc > 29) return DsaMoveError.DER_IllegalPossessionIndex;
  const champ = party.champions[chIdx] ?? null;
  if (!champ) return DsaMoveError.DER_IllegalCharacterIndex;
  if (champ.possessions[carryLoc] !== OBJECT_ID_NULL) return DsaMoveError.DER_PossessionSlotNotEmpty;
  const carryMask = getObjectCarryMask(machine, object);
  const slotMask = getCarryLocationMask(machine, carryLoc);
  if (carryMask === null || (carryMask & slotMask) === 0) {
    return DsaMoveError.DER_IllegalObjectForCarryLocation;
  }
  if (doit) {
    forgetThrownWeapon(machine.ctx, object);
    machine.ctx.systems.character.addCharacterPossession(chIdx, object, carryLoc);
  }
  return DsaMoveError.DER_OK;
}

function checkObjectToCursor(machine: DsaOperationMachine, object: ObjectID, doit: boolean): number {
  if (machine.ctx.dungeon.rnMaps.dbType(object) === DBType.CLOUD) return DsaMoveError.DER_NoCloudsPlease;
  const party = machine.ctx.party.state;
  if (!party) return DsaMoveError.DER_CursorNotEmpty;
  if (party.objectInHand !== OBJECT_ID_NULL) return DsaMoveError.DER_CursorNotEmpty;
  if (doit) {
    // `CURSORFILTER_DSA_MoveTo`, which cannot cancel (`doc/CSBwin-src/MoveObject.cpp:449-455`).
    if (object !== OBJECT_ID_NULL) {
      machine.filters.cursorFilter({ object, type: CursorFilterType.DSA_MoveTo, p1: 0, p2: 0, p3: 0, p4: 0 });
    }
    party.objectInHand = object;
    forgetThrownWeapon(machine.ctx, object);
  }
  return DsaMoveError.DER_OK;
}

/**
 * `FindCellDestination` (`doc/CSBwin-src/MoveObject.cpp:477-599`). A cloud's timer
 * (`hTimer`, from `FindCellSource`) follows it to the new square and level
 * (`:522-529`); a missile's timer gets the new square in `timerWord8`'s low ten bits
 * and the new level (`:574-596`).
 *
 * CSBWin sets the cloud timer's corner from `d.NewPos` and then `object.pos(p)`
 * overwrites it, because the corner lives in the indirect-index table rather than in
 * the `RN` (`CSBTypes.h:342-347`). Here the corner is part of the ID, so both timers
 * are handed the placed ID outright — the one `ProcessTT_25` and the missile's
 * removal will look for.
 */
function findCellDestination(
  machine: DsaOperationMachine,
  dstObjMsk: number,
  dstPosMsk: number,
  dstLoc: number,
  dstDepth: number,
  object: ObjectID,
  srcType: number,
  srcLoc: number,
  hTimer: number,
  doit: boolean,
): number {
  void dstObjMsk;
  const locr = locationRelFromInteger(dstLoc);
  if (!machine.ctx.dungeon.isValidLocation(locr)) return DsaMoveError.DER_InvalidCellLocation;
  if (dstDepth !== 0) return DsaMoveError.DER_IllegalDepth;
  const pos = choosePositionFromMask(machine.ctx.random, dstPosMsk, locr.p & 3);
  if (doit) {
    const decoded = machine.ctx.dungeon.rnMaps.decode(object);
    const placed = machine.ctx.dungeon.rnMaps.setPos(object, pos);
    const partyLevel = machine.ctx.party.state.position.z;
    const srcLocr = srcType === 1 ? locationRelFromInteger(srcLoc) : null;
    const sameLevelMonsterMove = decoded.category === DBType.CREATURE
      && locr.l === partyLevel
      && srcLocr !== null
      && srcLocr.l === locr.l;
    if (decoded.category === DBType.CREATURE && !sameLevelMonsterMove) {
      // Off the party's level, or arriving on it from elsewhere: the group has no
      // `ITEM16` until `MoveObject` attaches one (`:504-521`).
      const monster = machine.ctx.dungeon.getCreatureRecord(object);
      if (monster) monster.groupIndex = detachedGroupIndex(machine.ctx.tables.monsterDesc, monster);
    }
    if (decoded.category === DBType.CLOUD) {
      const timer = machine.ctx.timers.getTimer(hTimer);
      if (timer) {
        timer.uByte6 = locr.x & 0xff;
        timer.uByte7 = locr.y & 0xff;
        timer.object = placed;
        timer.level = locr.l & 0xff;
      }
    }
    const mover = objectMover(machine);
    if (!sameLevelMonsterMove) {
      machine.ctx.dungeon.setDBRecordLink(object, OBJECT_ID_EOF);
      if (decoded.category === DBType.CREATURE) {
        // `object.pos(p)` rewrites the indirect index, so the monster's corner is `p`
        // wherever it ends up, whatever the stairs made of it.
        mover.moveMonster(object, -1, 0, locr.x, locr.y, locr.l, pos);
      } else {
        // `MoveObject(object, -1, 0, x, y)` and then `object.pos(p)` (`:531-538`): the
        // pads see the corner the object came with, and it lies in corner `p`.
        const result = mover.moveObject(object, -1, 0, locr.x, locr.y, locr.l);
        if (result.placed !== null && result.position && result.placed !== placed) {
          machine.ctx.dungeon.removeObjectFromCell(result.position, result.placed);
          machine.ctx.dungeon.addObjectToCell(result.position, placed);
        }
      }
    } else if (srcLocr) {
      // `MoveObject(object, srcX, srcY, x, y)`, and when it returns 0 — the group
      // is still there and its `ITEM16` did not change — every monster AI timer on
      // the level that named the source square is pointed at the destination
      // (`:539-571`). `MoveObject` itself leaves them behind, as the AI's own
      // steps do.
      const moved = mover.moveMonster(object, srcLocr.x, srcLocr.y, locr.x, locr.y, locr.l);
      if (moved.code === 0) {
        for (const timer of machine.ctx.timers.getTimers()) {
          if (timer.level !== (locr.l & 0xff)) continue;
          if (timer.function < TimerFunction.TT_FIRST_MONSTER_AI) continue;
          if (timer.function > TimerFunction.TT_LAST_MONSTER_AI) continue;
          if (timer.uByte6 !== (srcLocr.x & 0xff)) continue;
          if (timer.uByte7 !== (srcLocr.y & 0xff)) continue;
          timer.uByte6 = locr.x & 0xff;
          timer.uByte7 = locr.y & 0xff;
        }
      }
    }
    if (decoded.category === DBType.MISSILE) {
      const missile = machine.ctx.dungeon.getMissileRecord(placed);
      const timer = missile ? machine.ctx.timers.getTimer(missile.timerIndex) : null;
      if (timer) {
        timer.timerWord8 = (timer.timerWord8 & 0xffe0) | (locr.x & 31);
        timer.timerWord8 = (timer.timerWord8 & 0xfc1f) | ((locr.y & 31) << 5);
        timer.level = locr.l & 0xff;
        // The port's missile timer also carries the ID and the square, which CSBWin's
        // `timerObj6` does through the indirect index (see `updateMissileTimerEntry`).
        timer.object = placed;
        timer.uByte6 = locr.x & 0xff;
        timer.uByte7 = locr.y & 0xff;
      }
    }
  }
  return DsaMoveError.DER_OK;
}

function findChestDestination(machine: DsaOperationMachine, dstLoc: number, dstDepth: number, object: ObjectID, doit: boolean): number {
  if (!machine.isValidObjectId(dstLoc)) return DsaMoveError.DER_IllegalChestID;
  if (machine.ctx.dungeon.rnMaps.dbType(object) === DBType.CLOUD) return DsaMoveError.DER_NoCloudsPlease;
  const decodedChest = machine.ctx.dungeon.rnMaps.decode(dstLoc);
  if (decodedChest.category !== DBType.CHEST) return DsaMoveError.DER_ChestIsNotAChest;
  if (dstDepth !== 0) return DsaMoveError.DER_IllegalDepth;
  if (isObjectInCharactersOrCursor(machine, dstLoc)) return DsaMoveError.DER_ChestBelongsToCharacter;
  const chest = machine.ctx.dungeon.getContainerRecord(dstLoc);
  if (!chest) return DsaMoveError.DER_ChestIsNotAChest;
  let count = 0;
  for (let rn = chest.containedObject; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = machine.ctx.dungeon.getDBRecordLink(rn)) {
    count += 1;
  }
  if (count > 7) return DsaMoveError.DER_ChestIsFull;
  if (doit) {
    machine.ctx.dungeon.setDBRecordLink(object, chest.containedObject);
    chest.containedObject = object;
  }
  return DsaMoveError.DER_OK;
}

function findMonsterDestination(machine: DsaOperationMachine, dstLoc: number, dstDepth: number, object: ObjectID, doit: boolean): number {
  if (!machine.isValidObjectId(dstLoc)) return DsaMoveError.DER_IllegalMonsterID;
  if (machine.ctx.dungeon.rnMaps.dbType(object) === DBType.CLOUD) return DsaMoveError.DER_NoCloudsPlease;
  const decoded = machine.ctx.dungeon.rnMaps.decode(dstLoc);
  if (decoded.category !== DBType.CREATURE) return DsaMoveError.DER_MonsterIsNotAMonster;
  if (dstDepth !== 0) return DsaMoveError.DER_IllegalDepth;
  const monster = machine.ctx.dungeon.getCreatureRecord(dstLoc);
  if (!monster) return DsaMoveError.DER_MonsterIsNotAMonster;
  if (doit) {
    machine.ctx.dungeon.setDBRecordLink(object, monster.possession);
    monster.possession = object;
  }
  return DsaMoveError.DER_OK;
}

function getObjectCarryMask(machine: DsaOperationMachine, objectId: number): number | null {
  if (!machine.isValidObjectId(objectId)) return null;
  const descIndex = DescIndex(machine.ctx.dungeon, objectId);
  if (descIndex === -1) return null;
  const mask = machine.ctx.tables.objDescWord4[descIndex];
  return typeof mask === 'number' ? mask : null;
}

function getCarryLocationMask(machine: DsaOperationMachine, slot: number): number {
  const value = machine.ctx.tables.carryLocation[slot];
  return typeof value === 'number' ? value : 0;
}


function isObjectInCharactersOrCursor(machine: DsaOperationMachine, objectId: ObjectID): boolean {
  const party = machine.ctx.party.state;
  if (!party) return false;
  const visited = new Set<number>();
  for (const champion of party.champions) {
    for (const item of champion.possessions) {
      if (item === OBJECT_ID_NULL) continue;
      if (searchListForObject(machine, objectId, item, visited)) return true;
    }
  }
  const cursorObj = party.objectInHand;
  if (cursorObj !== OBJECT_ID_NULL) {
    if (searchListForObject(machine, objectId, cursorObj, visited)) return true;
  }
  return false;
}

function searchListForObject(machine: DsaOperationMachine, target: ObjectID, head: ObjectID, visited: Set<number>): boolean {
  for (let rn = head; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = machine.ctx.dungeon.getDBRecordLink(rn)) {
    if (rnEquals(rn, target)) return true;
    if (visited.has(rn)) continue;
    visited.add(rn);
    const decoded = machine.ctx.dungeon.rnMaps.decode(rn);
    if (decoded.category === DBType.CHEST) {
      const chest = machine.ctx.dungeon.getContainerRecord(rn);
      if (chest && chest.containedObject !== OBJECT_ID_EOF) {
        if (searchListForObject(machine, target, chest.containedObject, visited)) return true;
      }
    } else if (decoded.category === DBType.CREATURE) {
      return false;
    }
  }
  return false;
}

/**
 * `&MOVE`: `EX_AMPERSAND`'s case (`doc/CSBwin-src/DSA.cpp:4664`), and the ten-argument
 * `MoveObject` it calls (`MoveObject.cpp:721`).
 */
export const moveOperations: ReadonlyMap<StkOp, DsaOperation> = new Map<StkOp, DsaOperation>([
  [StkOp.MOVE, (bank, _exPkt, machine) => {
    const dstDepth = bank.stack.pop();
    const dstLoc = bank.stack.pop();
    const dstPosMsk = bank.stack.pop();
    const dstObjMsk = bank.stack.pop();
    const dstType = bank.stack.pop();
    const srcDepth = bank.stack.pop();
    const srcLoc = bank.stack.pop();
    const srcPosMsk = bank.stack.pop();
    const srcObjMsk = bank.stack.pop();
    const srcType = bank.stack.pop();
    bank.noFilter();
    moveObjectDsa(
      machine,
      srcType,
      srcObjMsk,
      srcPosMsk,
      srcLoc,
      srcDepth,
      dstType,
      dstObjMsk,
      dstPosMsk,
      dstLoc,
      dstDepth,
    );
  }],
]);
