import { isAlive } from './rules';
import { GetBasicObjectType } from './objectIndex';
import {
  rnEquals,
  DBType,
  OBJECT_ID_EMPTY,
  OBJECT_ID_EOF,
  OBJECT_ID_NULL,
  Position,
  RoomType,
  type ObjectID,
  getRoomType,
} from '../core/types';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import type { PartyState } from './gameTypes';
import { adjustSkills, AdjustSkillsWhy } from './skills';
import type { ActuatorRecord } from '../data/dungeonTypes';
import {
  ActuatorAction,
  getActuatorAction,
  getActuatorDelay,
  getActuatorLocalActionType,
  getActuatorState,
  PORTRAIT_INACTIVE,
  getActuatorTargetPos,
  getActuatorTargetX,
  getActuatorTargetY,
  getActuatorType,
  getActuatorValue,
  isActuatorAudible,
  isActuatorLocalActionOnly,
  isActuatorNormallyClosed,
  isActuatorOnceOnly,
} from '../data/actuatorHelpers';
import { TimerQueue } from './TimerQueue';
import { constructPredefinedMissile } from './missileHelpers';
import {
    OBJNI_CHEST,
    OBJNI_NOT_AN_OBJECT,
} from '../core/objectNameIndex';
import { CursorFilterType } from './dsa/DsaTypes';

/** CSBWin message colours (`doc/CSBWIN_MESSAGES_REFERENCE.md`). */
export const MSG_COLOR_SPELL = 4;
export const MSG_COLOR_ROOM_TEXT = 15;

/** `soundPRESSUREPAD` (`doc/CSBwin-src/CSB.h:626`). */
const SOUND_PRESSURE_PAD = 1;

export class ActuatorSystem {
  private readonly dungeon: DungeonState;
  private readonly timers: TimerQueue;
  /** `d.Byte1596`, the room-type timer functions. */
  private readonly byte1596: ArrayLike<number>;
  private readonly objDescObjectType: ArrayLike<number>;
  /** Per-champion message colour, CSBWin `d.Byte1386[4]` (`doc/CSBwin-src/Data.h:1431`). */
  private readonly byte1386: ArrayLike<number>;
  private delayedAction = -1;
  private delayedActionX = 0;
  private delayedActionY = 0;
  private delayedActionZ = 0;
  private delayedActionPos = -1;

  constructor(private readonly ctx: GameContext) {
    this.dungeon = ctx.dungeon;
    this.timers = ctx.timers;
    this.byte1596 = ctx.tables.byte1596;
    this.objDescObjectType = ctx.tables.objDescObjectType;
    this.byte1386 = ctx.tables.byte1386;
  }

  /**
   * A champion's colour, `d.Byte1386[chIdx]`, one per champion in graphic 232, which
   * `_ResurrectReincarnateCancel` prints their name in (`doc/CSBwin-src/CSBCode.cpp:6856`).
   */
  getChampionMessageColor(chIdx: number): number {
    return this.byte1386[chIdx]!;
  }

  triggerPressurePads(position: Position, facing: number, pressed: boolean, unchangedRoom = false): boolean {
    return this.triggerObjectMove(position, OBJECT_ID_NULL, pressed, unchangedRoom, facing);
  }

  /**
   * `PlaceOrRemoveObjectInRoom` (`doc/CSBwin-src/Code11f52.cpp:3917`): every actuator in
   * the cell gets `PressurePadOrAlcove`. `facing` stands in for the `d.partyFacing` that
   * `PressurePadOrAlcove` reads (`:3811`), and only matters when the party itself moves.
   */
  triggerObjectMove(
    position: Position,
    object: ObjectID,
    place: boolean,
    unchangedRoom: boolean,
    facing: number,
  ): boolean {
    const map = this.dungeon.getMap(position.z);
    if (!map) return false;
    const cellFlag = map.cellFlags[position.x]?.[position.y];
    if (cellFlag === undefined) return false;
    const roomType = getRoomType(cellFlag);
    const movedObjectDBType = object === OBJECT_ID_NULL ? -1 : this.dungeon.rnMaps.dbType(object);
    const movedObjectNameIndex = object === OBJECT_ID_NULL ? OBJNI_NOT_AN_OBJECT : this.getBasicObjectType(object);
    const positionOfObject = roomType === RoomType.STONE
      ? (object === OBJECT_ID_NULL ? 0 : (this.dungeon.rnMaps.pos(object) & 0x3))
      : -1;

    const context = this.scanObjectMoveContext(
      position,
      place,
      unchangedRoom,
      movedObjectDBType,
      movedObjectNameIndex,
      positionOfObject,
      place && object !== OBJECT_ID_NULL ? object : null,
    );

    let triggered = false;
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (this.dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec) continue;
      if (this.pressurePadOrAlcove(
        rn,
        rec,
        position,
        place,
        unchangedRoom,
        object,
        positionOfObject,
        facing,
        context,
      )) {
        triggered = true;
      }
    }

    this.rotateActuatorList();
    return triggered;
  }

  /**
   * `TouchWall` (doc/CSBwin-src/Mouse.cpp:291): the party's hand on side
   * `touchedPosition` of the wall at `position`. True when a switch fired, CSBWin's
   * `result = 1` (`:538-540`), which `TouchWallF1` makes `d.clockTick`
   * (`MouseSystem.handleWallClick`).
   */
  touchWall(position: Position, touchedPosition: number): boolean {
    const remainingActuators = [0, 0, 0, 0];
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = this.dungeon.rnMaps.decode(rn);
      if (decoded.category === DBType.ACTUATOR) {
        remainingActuators[decoded.position & 0x3]! += 1;
      } else if (decoded.category >= DBType.CREATURE) {
        break;
      }
    }

    let result = false;
    let characterAdded = false;
    const party = this.ctx.party.state;
    let objectInHand = party.objectInHand;
    let emptyHanded = objectInHand === OBJECT_ID_NULL;
    // CSBWin's `previousListObject`, which a type 17 unlinks itself from.
    const first = this.dungeon.findFirstObject(position);
    for (let rn = first, previous = first; rn !== OBJECT_ID_EOF; previous = rn, rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = this.dungeon.rnMaps.decode(rn);

      if (decoded.category === DBType.ACTUATOR) {
        const actuatorPos = decoded.position & 0x3;
        remainingActuators[actuatorPos] = Math.max(0, remainingActuators[actuatorPos]! - 1);
        const rec = this.dungeon.getActuatorRecord(rn);
        const actuatorType = rec ? getActuatorType(rec) : 0;
        if (!rec || actuatorType === 0) {
          continue;
        }
        // With nobody owning the cursor, `d.HandChar == -1`, only a portrait answers
        // (`Mouse.cpp:358-361`). Read at each actuator, as a recruit gives it an owner.
        if (party.cursorOwner === -1 && actuatorType !== 127) {
          continue;
        }
        if (actuatorPos !== (touchedPosition & 0x3)) {
          continue;
        }

        let action = getActuatorAction(rec);
        let switchOpen = false;
        let skip = false;

        switch (actuatorType) {
          case 1:
            if (action === ActuatorAction.CONSTPRESSURE) {
              skip = true;
            } else {
              switchOpen = false;
            }
            break;
          case 2:
            switchOpen = emptyHanded;
            switchOpen = isActuatorNormallyClosed(rec) !== switchOpen;
            break;
          case 3:
          case 4:
          case 11:
          case 17: {
            if ((actuatorType === 11 || actuatorType === 17) && remainingActuators[actuatorPos] !== 0) {
              skip = true;
              break;
            }
            const objType = this.getBasicObjectType(objectInHand);
            switchOpen = isActuatorNormallyClosed(rec) === (getActuatorValue(rec) === objType);
            if (!switchOpen && actuatorType === 11) {
              this.performLocalAction(2, position.x, position.y, position.z, actuatorPos);
            }
            // A type 17 takes itself off the wall (`Mouse.cpp:390-399`): unlinked and
            // deleted, so the actuators before it no longer count it as remaining and
            // the wall shows the ornament of the one now last. The loop goes on from
            // `previous`, whose link is now the deleted one's. One first on the square
            // has no `previous` and stays, still type 17. `DeleteDBEntry` only frees
            // the link, so `rec` is still read below.
            if (!switchOpen && actuatorType === 17) {
              if (previous === rn) break;
              this.dungeon.setDBRecordLink(previous, this.dungeon.getDBRecordLink(rn));
              this.dungeon.deleteDBEntry(rn);
              rn = previous;
            }
            break;
          }
          case 12:
            if (remainingActuators[actuatorPos] !== 0) {
              skip = true;
              break;
            }
            switchOpen = !emptyHanded;
            if (!switchOpen) {
              this.performLocalAction(2, position.x, position.y, position.z, actuatorPos);
            }
            break;
          case 13: {
            const actuatorValue = getActuatorValue(rec);
            if (emptyHanded) {
              const found = this.findObjectOfTypeAtPosition(position, actuatorPos, actuatorValue);
              if (found === null) {
                skip = true;
                break;
              }
              if (!this.applyCursorFilter(CursorFilterType.TakeFromTorchHolder, found, position, actuatorPos)) {
                skip = true;
                break;
              }
              this.dungeon.removeObjectFromCell(position, found);
              objectInHand = found;
              party.objectInHand = found;
              emptyHanded = false;
            } else {
              const objType = this.getBasicObjectType(objectInHand);
              if (objType !== actuatorValue) {
                skip = true;
                break;
              }
              const existing = this.findObjectOfTypeAtPosition(position, actuatorPos, actuatorValue);
              if (existing !== null) {
                skip = true;
                break;
              }
              if (!this.applyCursorFilter(CursorFilterType.PlaceInTorchHolder, objectInHand, position, actuatorPos)) {
                skip = true;
                break;
              }
              const placed = this.dungeon.rnMaps.setPos(objectInHand, actuatorPos);
              this.dungeon.addObjectToCell(position, placed);
              party.objectInHand = OBJECT_ID_NULL;
              objectInHand = OBJECT_ID_NULL;
              emptyHanded = true;
            }
            this.performLocalAction(2, position.x, position.y, position.z, actuatorPos);
            switchOpen = true;
            if (action !== ActuatorAction.CONSTPRESSURE || emptyHanded) {
              switchOpen = false;
            }
            break;
          }
          case 16: {
            if (remainingActuators[actuatorPos] !== 0) {
              skip = true;
              break;
            }
            if (emptyHanded) {
              skip = true;
              break;
            }
            const objType = this.getBasicObjectType(objectInHand);
            if (objType !== getActuatorValue(rec)) {
              skip = true;
              break;
            }
            const firstObject = this.findFirstDrawableObject(position);
            if (firstObject === null) {
              skip = true;
              break;
            }
            if (!this.applyCursorFilter(CursorFilterType.SwapRemove, objectInHand, position, actuatorPos)) {
              skip = true;
              break;
            }
            this.dungeon.removeObjectFromCell(position, firstObject);
            const placed = this.dungeon.rnMaps.setPos(objectInHand, actuatorPos);
            this.dungeon.addObjectToCell(position, placed);
            this.applyCursorFilter(CursorFilterType.SwapReplace, firstObject, position, actuatorPos);
            // `ObjectToCursor` (`Mouse.cpp:508`) fills the hand, not the local
            // `objectInHand`, which stays the object now on the wall. No later actuator
            // of this touch reads it: a type 16 is the last of its side.
            party.objectInHand = firstObject;
            emptyHanded = false;
            switchOpen = false;
            break;
          }
          case 127:
            if (characterAdded) {
              skip = true;
              break;
            }
            if ((getActuatorState(rec) & PORTRAIT_INACTIVE) !== 0) {
              skip = true;
              break;
            }
            // A click on a Hall of Champions mirror (`doc/CSBwin-src/Mouse.cpp:514`).
            if (emptyHanded) {
              const added = this.ctx.systems.hallOfChampions.addCharacter(getActuatorValue(rec));
              if (added) characterAdded = true;
            }
            skip = true;
            break;
          default:
            skip = true;
            break;
        }

        if (!skip) {
          if (action === ActuatorAction.CONSTPRESSURE) {
            action = switchOpen ? ActuatorAction.CLEAR : ActuatorAction.SET;
            switchOpen = false;
          }

          if (!switchOpen) {
            result = true;
            if (isActuatorAudible(rec)) {
              this.ctx.sounds.queueSound(1, party.position.x, party.position.y, 1, party.position.z);
            }
            if (!emptyHanded && (actuatorType === 4 || actuatorType === 11 || actuatorType === 17)) {
              const allow = this.applyCursorFilter(CursorFilterType.TakeKey, objectInHand, position, actuatorPos);
              if (allow) {
                const deleted = objectInHand;
                party.objectInHand = OBJECT_ID_NULL;
                // A gift's packet carries `RNempty` after it (`Mouse.cpp:568`).
                objectInHand = OBJECT_ID_EMPTY;
                emptyHanded = true;
                if (deleted !== OBJECT_ID_NULL) {
                  this.dungeon.deleteDBEntry(deleted);
                }
              }
            } else if (emptyHanded && actuatorType === 12) {
              const allow = this.applyCursorFilter(CursorFilterType.GiftFromGod, objectInHand, position, actuatorPos);
              if (allow) {
                const gift = constructPredefinedMissile(this.dungeon, getActuatorValue(rec));
                if (gift !== null) {
                  party.objectInHand = gift;
                  objectInHand = gift;
                  emptyHanded = false;
                }
              }
            }
            this.queueSwitchAction(rec, action, position, actuatorPos);
          }
        }
      } else if (decoded.category >= DBType.CREATURE) {
        break;
      }
    }

    this.rotateActuatorList();
    return result;
  }

  /**
   * `PressurePadOrAlcove` (doc/CSBwin-src/Code11f52.cpp:3720). Public so that `tools/` can
   * fire one actuator without the move that reaches it.
   */
  pressurePadOrAlcove(
    rn: ObjectID,
    rec: ActuatorRecord,
    position: Position,
    place: boolean,
    unchangedRoom: boolean,
    object: ObjectID,
    switchPosition: number,
    facing: number,
    context: PressurePadContext,
  ): boolean {
    const actuatorType = getActuatorType(rec);
    const actuatorValue = getActuatorValue(rec);
    if (actuatorType === 0) return false;

    let switchPressed = place;

    if (switchPosition === -1) {
      switch (actuatorType) {
        case 1:
          if (unchangedRoom) return false;
          if (context.objectDB5To13Present) return false;
          if (object !== OBJECT_ID_NULL) {
            if (context.movedObjectDBNum < DBType.CREATURE || context.movedObjectDBNum > DBType.DB13) return false;
          }
          if (context.monstersPresent) return false;
          break;
        case 2:
          if (context.movedObjectDBNum > DBType.CREATURE) return false;
          if (unchangedRoom) return false;
          if (context.monstersPresent) return false;
          break;
        case 3:
          if (context.movedObjectDBNum !== -1) return false;
          if (this.ctx.party.state.champions.length === 0) return false;
          if (actuatorValue === 0) {
            if (unchangedRoom) return false;
          } else {
            if (!place) {
              switchPressed = false;
            } else {
              switchPressed = (facing + 1) === actuatorValue;
            }
          }
          break;
        case 4:
          if (actuatorValue !== context.movedObjectNameIndex) return false;
          if (context.sameTypeObjectPresent) return false;
          break;
        case 5:
        case 6:
          return false;
        case 7:
          if (context.movedObjectDBNum > DBType.CREATURE) return false;
          if (context.movedObjectDBNum === -1) return false;
          if (context.monstersPresent) return false;
          break;
        case 8:
          if (context.movedObjectDBNum !== -1) return false;
          switchPressed = this.doesPartyHave(actuatorValue);
          break;
        case 9:
          if (context.movedObjectDBNum !== -1) return false;
          if (!place) return false;
          if (unchangedRoom) return false;
          switchPressed = actuatorValue <= 20;
          break;
        default:
          return false;
      }
    } else {
      if ((switchPosition & 0x3) !== (this.dungeon.rnMaps.pos(rn) & 0x3)) return false;
      switch (actuatorType) {
        case 1:
          if (context.objectDB5To13Present) return false;
          break;
        case 2:
          if (context.sameTypeObjectPresent) return false;
          if (actuatorValue !== context.movedObjectNameIndex) return false;
          break;
        case 3:
          if (context.differentTypeObjectPresent) return false;
          if (actuatorValue === context.movedObjectNameIndex) return false;
          break;
        default:
          return false;
      }
    }

    const switchClosed = switchPressed !== isActuatorNormallyClosed(rec);
    let padAction = getActuatorAction(rec);
    if (padAction === ActuatorAction.CONSTPRESSURE) {
      padAction = switchClosed ? ActuatorAction.SET : ActuatorAction.CLEAR;
    } else if (!switchClosed) {
      return false;
    }

    if (isActuatorAudible(rec)) {
      this.ctx.sounds.queueSound(SOUND_PRESSURE_PAD, position.x, position.y, 1, position.z);
    }

    // Always -1, an alcove's wall position included (doc/CSBwin-src/Code11f52.cpp:3910).
    this.queueSwitchAction(rec, padAction, position, -1);
    return true;
  }

  /**
   * `QueueSwitchAction` (doc/CSBwin-src/Code11f52.cpp:3601-3640). `source` and `mapPos` are
   * where the switch is, and a local action is all they are read for: `PerformLocalAction`
   * gets them, and `RotateActuatorList` then rotates that square's actuators.
   */
  queueSwitchAction(
    actuator: ActuatorRecord,
    action: ActuatorAction,
    source: Position,
    mapPos: number,
  ): void {
    if (isActuatorOnceOnly(actuator)) {
      actuator.word2 &= ~0x7f;
    }

    const actionTime = (this.ctx.state.tickCount + getActuatorDelay(actuator)) >>> 0;
    if (isActuatorLocalActionOnly(actuator)) {
      this.performLocalAction(getActuatorLocalActionType(actuator), source.x, source.y, source.z, mapPos);
      return;
    }

    const targetX = getActuatorTargetX(actuator);
    const targetY = getActuatorTargetY(actuator);
    const map = this.dungeon.getMap(source.z);
    if (!map) return;
    if (targetX < 0 || targetY < 0 || targetX >= map.descriptor.width || targetY >= map.descriptor.height) return;

    const cellFlag = map.cellFlags[targetX]![targetY]!;
    const targetRoomType = getRoomType(cellFlag);
    const targetPos = (targetRoomType === RoomType.STONE || targetRoomType === RoomType.FALSEWALL)
      ? getActuatorTargetPos(actuator)
      : 0;

    const timerFunction = this.byte1596[targetRoomType]!;
    if (timerFunction === 0) {
      this.ctx.host.trace(
        `Illegal actuator timer target (${targetX},${targetY}) L${source.z}, room type ${targetRoomType}`,
      );
      return;
    }

    this.timers.createTimer({
      function: timerFunction,
      uByte6: targetX,
      uByte7: targetY,
      uByte8: targetPos,
      uByte9: action,
      time: actionTime,
      level: source.z,
    });
  }

  private scanObjectMoveContext(
    position: Position,
    place: boolean,
    unchangedRoom: boolean,
    movedObjectDBType: number,
    movedObjectNameIndex: number,
    positionOfObject: number,
    ignoreObject: ObjectID | null,
  ): PressurePadContext {
    let objectDB5To13Present = false;
    let monstersPresent = false;
    let sameTypeObjectPresent = false;
    let differentTypeObjectPresent = false;

    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (ignoreObject !== null && rnEquals(rn, ignoreObject)) continue;
      const decoded = this.dungeon.rnMaps.decode(rn);
      const dbType = decoded.category;

      if (positionOfObject === -1) {
        if (dbType === DBType.CREATURE) {
          monstersPresent = true;
          continue;
        }
        if (dbType === DBType.TEXT && movedObjectDBType === -1 && place && !unchangedRoom) {
          const rec = this.dungeon.getTextRecord(rn);
          const text = rec ? this.dungeon.decodeMessageText(rec, this.ctx.tables.textDecode) : null;
          // CSBWin: `QuePrintLines(15, text)` with no preceding PrintLinefeed() — the
          // decoder prepends the linefeed itself for typeOfText 1
          // (doc/CSBwin-src/Code11f52.cpp:3997, doc/CSBwin-src/CSBCode.cpp:5575).
          if (text) {
            this.ctx.host.messages.quePrintLines(MSG_COLOR_ROOM_TEXT, text);
          }
          continue;
        }
        if (dbType > DBType.CREATURE && dbType < DBType.MISSILE) {
          objectDB5To13Present = true;
          const objNameIndex = this.getBasicObjectType(rn);
          if (objNameIndex === movedObjectNameIndex) sameTypeObjectPresent = true;
          if (objNameIndex !== movedObjectNameIndex) differentTypeObjectPresent = true;
        }
      } else {
        if ((decoded.position & 0x3) !== (positionOfObject & 0x3)) continue;
        if (dbType > DBType.CREATURE) {
          objectDB5To13Present = true;
          const objNameIndex = this.getBasicObjectType(rn);
          if (objNameIndex === movedObjectNameIndex) sameTypeObjectPresent = true;
          if (objNameIndex !== movedObjectNameIndex) differentTypeObjectPresent = true;
        }
      }
    }

    return {
      objectDB5To13Present,
      monstersPresent,
      sameTypeObjectPresent,
      differentTypeObjectPresent,
      movedObjectDBNum: movedObjectDBType,
      movedObjectNameIndex,
    };
  }

  /**
   * `DoesPartyHave` (`doc/CSBwin-src/Code11f52.cpp:3657-3715`), for actuator type 8: the 30
   * possessions of every champion with hit points, then the cursor — which the `goto` back
   * into the loop checks whoever holds it — and, for each one that is a chest, the chest's
   * contents too. Public so that `tools/` can ask it without an actuator.
   */
  doesPartyHave(actuatorValue: number): boolean {
    const matches = (obj: ObjectID | null | undefined): boolean => {
      if (obj === null || obj === undefined || obj === OBJECT_ID_NULL) return false;
      const objNI = this.getBasicObjectType(obj);
      if (objNI === actuatorValue) return true;
      if (objNI !== OBJNI_CHEST) return false;
      const chest = this.dungeon.getContainerRecord(obj);
      for (let rn = chest?.containedObject ?? OBJECT_ID_EOF; rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
        if (this.getBasicObjectType(rn) === actuatorValue) return true;
      }
      return false;
    };
    const party = this.ctx.party.state;
    for (const champ of party.champions) {
      if (!isAlive(champ)) continue;
      for (let slot = 0; slot < 30; slot++) {
        if (matches(champ.possessions[slot])) return true;
      }
    }
    return matches(party.objectInHand);
  }

  /**
   * `PerformLocalAction` (doc/CSBwin-src/Mouse.cpp:239). Public so that `tools/` can run
   * one without an actuator, and watch the actuators' calls.
   */
  performLocalAction(localActionType: number, mapX: number, mapY: number, mapZ: number, mapPos: number): void {
    if (localActionType === 10) {
      // SkillIncreaser(8, 300, mapPos == -1 ? 0 : 1) (doc/CSBwin-src/Mouse.cpp:210-231).
      let adjustment = 300;
      const party = this.ctx.party.state;
      const experienceMultiplier = this.dungeon.levelDifficulty(mapZ);

      if (mapPos !== -1) {
        // The champion who owns the cursor, d.HandChar — not whoever stands in cell mapPos.
        const handChar = party.cursorOwner;
        if (handChar !== -1) {
          this.applySkillIncrease(party.champions[handChar]!, handChar, 8, adjustment, experienceMultiplier, AdjustSkillsWhy.SkillIncreaser1);
        }
        return;
      }
      adjustment = Math.trunc(adjustment / (party.champions.length || 1));
      for (let i = 0; i < party.champions.length; i++) {
        const champ = party.champions[i]!;
        // `if (d.CH16482[D7W].HP() != 0)` (`doc/CSBwin-src/Mouse.cpp:226`).
        if (!isAlive(champ)) continue;
        this.applySkillIncrease(champ, i, 8, adjustment, experienceMultiplier, AdjustSkillsWhy.SkillIncreaser2);
      }
      return;
    }

    this.delayedAction = localActionType;
    this.delayedActionX = mapX | 0;
    this.delayedActionY = mapY | 0;
    this.delayedActionZ = mapZ | 0;
    this.delayedActionPos = mapPos | 0;
  }

  private applySkillIncrease(
    champion: PartyState['champions'][number],
    chIdx: number,
    index: number,
    delta: number,
    experienceMultiplier: number,
    why: AdjustSkillsWhy,
  ): void {
    if (!champion || index < 0) return;
    adjustSkills(this.ctx, chIdx, index, delta, why, experienceMultiplier);
  }

  /**
   * `RotateActuatorList` (doc/CSBwin-src/Code11f52.cpp:3500-3560): the local action 1 or 2
   * that `PerformLocalAction` put off moves the first actuator at its square (and
   * position) behind the last. Called where CSBWin calls it: the end of
   * `PlaceOrRemoveObjectInRoom`, `TouchWall` and `ProcessTT_STONEROOM`.
   */
  rotateActuatorList(): void {
    if (this.delayedAction === -1) return;
    const action = this.delayedAction;
    const posFilter = this.delayedActionPos;
    const position = new Position(this.delayedActionX, this.delayedActionY, this.delayedActionZ);

    if (action === 1 || action === 2) {
      let prev: ObjectID | null = null;
      let first = this.dungeon.findFirstObject(position);

      while (first !== OBJECT_ID_EOF) {
        const decoded = this.dungeon.rnMaps.decode(first);
        if (
          decoded.category === DBType.ACTUATOR
          && (posFilter === -1 || decoded.position === (posFilter & 3))
        ) {
          break;
        }
        prev = first;
        first = this.dungeon.getDBRecordLink(first);
      }

      if (first !== OBJECT_ID_EOF) {
        let second = this.dungeon.getDBRecordLink(first);
        while (second !== OBJECT_ID_EOF) {
          const decoded = this.dungeon.rnMaps.decode(second);
          if (
            decoded.category === DBType.ACTUATOR
            && (posFilter === -1 || decoded.position === (posFilter & 3))
          ) {
            break;
          }
          second = this.dungeon.getDBRecordLink(second);
        }

        if (second !== OBJECT_ID_EOF) {
          let lastMatch = second;
          let cursor = this.dungeon.getDBRecordLink(second);
          while (cursor !== OBJECT_ID_EOF && this.dungeon.rnMaps.dbType(cursor) === DBType.ACTUATOR) {
            const decoded = this.dungeon.rnMaps.decode(cursor);
            if (posFilter === -1 || decoded.position === (posFilter & 3)) {
              lastMatch = cursor;
            }
            cursor = this.dungeon.getDBRecordLink(cursor);
          }

          const firstNext = this.dungeon.getDBRecordLink(first);
          if (prev === null) {
            this.dungeon.setFirstObject(position, firstNext);
          } else {
            this.dungeon.setDBRecordLink(prev, firstNext);
          }

          const lastNext = this.dungeon.getDBRecordLink(lastMatch);
          this.dungeon.setDBRecordLink(lastMatch, first);
          this.dungeon.setDBRecordLink(first, lastNext);
        }
      }
    }

    this.delayedAction = -1;
  }

  /** `GetBasicObjectType` (`src/engine/objectIndex.ts`). */
  private getBasicObjectType(rn: ObjectID): number {
    return GetBasicObjectType(this.dungeon, this.objDescObjectType, rn);
  }

  /**
   * `CursorFilter` on a packet of `type` for `object`, with `TouchWall`'s four words: the
   * level, the wall's square and the side touched (`doc/CSBwin-src/Mouse.cpp:422-430`).
   * False when a DSA cancelled.
   */
  private applyCursorFilter(
    type: CursorFilterType,
    object: ObjectID,
    position: Position,
    pos: number,
  ): boolean {
    const cfp = { object, type, p1: position.z, p2: position.x, p3: position.y, p4: pos };
    this.ctx.systems.dsa.filters.cursorFilter(cfp);
    return cfp.type !== CursorFilterType.Cancel;
  }

  private findFirstDrawableObject(position: Position): ObjectID | null {
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = this.dungeon.rnMaps.decode(rn);
      if (decoded.category <= DBType.CREATURE) continue;
      if (decoded.category >= DBType.MISSILE) continue;
      return rn;
    }
    return null;
  }

  private findObjectOfTypeAtPosition(position: Position, pos: number, objectNameIndex: number): ObjectID | null {
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = this.dungeon.rnMaps.decode(rn);
      if (decoded.category <= DBType.ACTUATOR) continue;
      if (decoded.category >= DBType.MISSILE) continue;
      if (pos !== -1 && (decoded.position & 0x3) !== (pos & 0x3)) continue;
      if (this.getBasicObjectType(rn) === objectNameIndex) return rn;
    }
    return null;
  }

}

interface PressurePadContext {
  objectDB5To13Present: boolean;
  monstersPresent: boolean;
  sameTypeObjectPresent: boolean;
  differentTypeObjectPresent: boolean;
  movedObjectDBNum: number;
  movedObjectNameIndex: number;
}
