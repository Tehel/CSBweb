import {
  decodeObjectID,
  encodeObjectID,
  DBType,
  OBJECT_ID_EOF,
  OBJECT_ID_NULL,
  Position,
  RoomType,
  type ObjectID,
} from '../core/types';
import type { DungeonState } from './DungeonState';
import type { PartyState } from './gameTypes';
import { limitSkillExperience, populateBaseSkillExperience } from './skills';
import type {
  ActuatorRecord,
  ContainerRecord,
  MiscRecord,
  PotionRecord,
  WeaponRecord,
  ClothingRecord,
} from '../data/dungeonTypes';
import {
  ActuatorAction,
  getActuatorAction,
  getActuatorDelay,
  getActuatorLocalActionType,
  getActuatorState,
  getActuatorTargetPos,
  getActuatorTargetX,
  getActuatorTargetY,
  getActuatorType,
  getActuatorValue,
  isActuatorAudible,
  isActuatorLocalActionOnly,
  isActuatorNormallyClosed,
  isActuatorOnceOnly,
  setActuatorType,
} from '../data/actuatorHelpers';
import { TimerQueue } from './TimerQueue';
import { SoundIndex } from '../core/constants';
import { constructPredefinedMissile } from './missileHelpers';

const OBJNI_NOT_AN_OBJECT = 255;
const DEFAULT_ROOM_TIMER_FUNCTIONS = [6, 5, 9, 0, 10, 8, 7, 0];
const PORTRAIT_INACTIVE = 1;

export enum CursorFilterType {
  TakeKey = 'TakeKey',
  TakeFromTorchHolder = 'TakeFromTorchHolder',
  PlaceInTorchHolder = 'PlaceInTorchHolder',
  SwapRemove = 'SwapRemove',
  SwapReplace = 'SwapReplace',
  GiftFromGod = 'GiftFromGod',
}

export interface CursorFilterPacket {
  type: CursorFilterType;
  object: ObjectID;
  level: number;
  x: number;
  y: number;
  pos: number;
}

export type CursorFilterHook = (packet: CursorFilterPacket) => boolean;

export type AddCharacterHook = (portraitIndex: number, position: Position, pos: number) => boolean;

export interface ActuatorTables {
  roomTimerFunctions?: ArrayLike<number>;
  objDescObjectType?: ArrayLike<number>;
  objDescCarryMask?: ArrayLike<number>;
  carryLocation?: ArrayLike<number>;
  cursorFilter?: CursorFilterHook;
  onAddCharacter?: AddCharacterHook;
  onTextMessage?: (text: string) => void;
  playSound?: (soundId: number, rateIdx?: number) => void;
}

export class ActuatorSystem {
  private roomTimerFunctions: ArrayLike<number> | null;
  private objDescObjectType: ArrayLike<number> | null;
  private cursorFilter?: CursorFilterHook;
  private onAddCharacter?: AddCharacterHook;
  private onTextMessage?: (text: string) => void;
  private playSound?: (soundId: number, rateIdx?: number) => void;
  private delayedAction = -1;
  private delayedActionX = 0;
  private delayedActionY = 0;
  private delayedActionZ = 0;
  private delayedActionPos = -1;

  constructor(
    private dungeon: DungeonState,
    private getPartyState: () => PartyState,
    private timers: TimerQueue,
    private timeSource: () => number,
    tables?: ActuatorTables,
  ) {
    this.roomTimerFunctions = tables?.roomTimerFunctions ?? null;
    this.objDescObjectType = tables?.objDescObjectType ?? null;
    this.cursorFilter = tables?.cursorFilter;
    this.onAddCharacter = tables?.onAddCharacter;
    this.onTextMessage = tables?.onTextMessage;
    this.playSound = tables?.playSound;
  }

  setTables(tables: ActuatorTables): void {
    if (tables.roomTimerFunctions) this.roomTimerFunctions = tables.roomTimerFunctions;
    if (tables.objDescObjectType) this.objDescObjectType = tables.objDescObjectType;
    if (tables.cursorFilter) this.cursorFilter = tables.cursorFilter;
    if (tables.onAddCharacter) this.onAddCharacter = tables.onAddCharacter;
    if (tables.onTextMessage) this.onTextMessage = tables.onTextMessage;
    if (tables.playSound) this.playSound = tables.playSound;
  }

  queueSwitchActionForActuator(actuator: ActuatorRecord, action: ActuatorAction, level: number, mapPos?: number): void {
    const source = new Position(getActuatorTargetX(actuator), getActuatorTargetY(actuator), level);
    const pos = mapPos ?? getActuatorTargetPos(actuator);
    this.queueSwitchAction(actuator, action, source, pos);
  }

  triggerPressurePads(position: Position, facing: number, pressed: boolean, unchangedRoom = false): boolean {
    return this.triggerObjectMove(position, OBJECT_ID_NULL, pressed, unchangedRoom, facing);
  }

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
    const roomType = (cellFlag >> 5) & 0x7;
    const movedObjectDBType = object === OBJECT_ID_NULL ? -1 : decodeObjectID(object).category;
    const movedObjectNameIndex = object === OBJECT_ID_NULL ? OBJNI_NOT_AN_OBJECT : this.getBasicObjectType(object);
    const positionOfObject = roomType === RoomType.STONE
      ? (object === OBJECT_ID_NULL ? 0 : (decodeObjectID(object).position & 0x3))
      : -1;

    const context = this.scanObjectMoveContext(
      position,
      place,
      unchangedRoom,
      movedObjectDBType,
      movedObjectNameIndex,
      positionOfObject,
    );

    let triggered = false;
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (decodeObjectID(rn).category !== DBType.ACTUATOR) continue;
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

  triggerWallSwitch(position: Position, facing: number): boolean {
    const target = this.getForwardPosition(position, facing);
    if (!target) return false;
    const switchPosition = (facing + 2) & 0x3;
    return this.touchWall(target, switchPosition);
  }

  private touchWall(position: Position, touchedPosition: number): boolean {
    const remainingActuators = [0, 0, 0, 0];
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category === DBType.ACTUATOR) {
        remainingActuators[decoded.position & 0x3] += 1;
      } else if (decoded.category >= DBType.CREATURE) {
        break;
      }
    }

    let result = false;
    let characterAdded = false;
    const party = this.getPartyState();
    let objectInHand = this.normalizeObjectInHand(party.objectInHand ?? null);
    let emptyHanded = objectInHand === null;
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; ) {
      const next = this.dungeon.getDBRecordLink(rn);
      const decoded = decodeObjectID(rn);

      if (decoded.category === DBType.ACTUATOR) {
        const actuatorPos = decoded.position & 0x3;
        remainingActuators[actuatorPos] = Math.max(0, remainingActuators[actuatorPos] - 1);
        if (actuatorPos !== (touchedPosition & 0x3)) {
          rn = next;
          continue;
        }

        const rec = this.dungeon.getActuatorRecord(rn);
        const actuatorType = rec ? getActuatorType(rec) : 0;
        if (!rec || actuatorType === 0) {
          rn = next;
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
            const objType = this.getBasicObjectTypeFromValue(objectInHand ?? OBJNI_NOT_AN_OBJECT);
            switchOpen = isActuatorNormallyClosed(rec) === (getActuatorValue(rec) === objType);
            if (!switchOpen && actuatorType === 11) {
              this.performLocalAction(2, position.x, position.y, position.z, actuatorPos);
            }
            if (!switchOpen && actuatorType === 17) {
              setActuatorType(rec, 0);
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
              const objType = this.getBasicObjectTypeFromValue(objectInHand ?? OBJNI_NOT_AN_OBJECT);
              if (objType !== actuatorValue) {
                skip = true;
                break;
              }
              const existing = this.findObjectOfTypeAtPosition(position, actuatorPos, actuatorValue);
              if (existing !== null) {
                skip = true;
                break;
              }
              if (!this.applyCursorFilter(CursorFilterType.PlaceInTorchHolder, objectInHand ?? OBJECT_ID_NULL, position, actuatorPos)) {
                skip = true;
                break;
              }
              const placed = this.setObjectPosition(objectInHand ?? OBJECT_ID_NULL, actuatorPos);
              this.dungeon.addObjectToCell(position, placed);
              party.objectInHand = null;
              objectInHand = null;
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
            const objType = this.getBasicObjectTypeFromValue(objectInHand ?? OBJNI_NOT_AN_OBJECT);
            if (objType !== getActuatorValue(rec)) {
              skip = true;
              break;
            }
            const firstObject = this.findFirstDrawableObject(position);
            if (firstObject === null) {
              skip = true;
              break;
            }
            if (!this.applyCursorFilter(CursorFilterType.SwapRemove, objectInHand ?? OBJECT_ID_NULL, position, actuatorPos)) {
              skip = true;
              break;
            }
            this.dungeon.removeObjectFromCell(position, firstObject);
            const placed = this.setObjectPosition(objectInHand ?? OBJECT_ID_NULL, actuatorPos);
            this.dungeon.addObjectToCell(position, placed);
            this.applyCursorFilter(CursorFilterType.SwapReplace, firstObject, position, actuatorPos);
            party.objectInHand = firstObject;
            objectInHand = firstObject;
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
            if (emptyHanded && this.onAddCharacter) {
              const added = this.onAddCharacter(getActuatorValue(rec), position, actuatorPos);
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
              this.playSound?.(SoundIndex.SWITCH);
            }
            if (!emptyHanded && (actuatorType === 4 || actuatorType === 11 || actuatorType === 17)) {
              const allow = this.applyCursorFilter(CursorFilterType.TakeKey, objectInHand ?? OBJECT_ID_NULL, position, actuatorPos);
              if (allow) {
                const deleted = objectInHand;
                party.objectInHand = null;
                objectInHand = null;
                emptyHanded = true;
                if (deleted !== null && deleted !== undefined) {
                  this.dungeon.deleteDBEntry(deleted);
                }
              }
            } else if (emptyHanded && actuatorType === 12) {
              const allow = this.applyCursorFilter(CursorFilterType.GiftFromGod, OBJECT_ID_NULL, position, actuatorPos);
              if (allow) {
                const gift = constructPredefinedMissile(this.dungeon.getData(), getActuatorValue(rec));
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
      rn = next;
    }

    this.rotateActuatorList();
    return result;
  }

  private pressurePadOrAlcove(
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
          if (this.getPartyState().champions.length === 0) return false;
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
      if ((switchPosition & 0x3) !== (decodeObjectID(rn).position & 0x3)) return false;
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
      this.playSound?.(SoundIndex.SWITCH);
    }

    this.queueSwitchAction(rec, padAction, position, switchPosition);
    return true;
  }

  private queueSwitchAction(
    actuator: ActuatorRecord,
    action: ActuatorAction,
    source: Position,
    mapPos: number,
  ): void {
    if (isActuatorOnceOnly(actuator)) {
      actuator.word2 &= ~0x7f;
    }

    const actionTime = (this.timeSource() + getActuatorDelay(actuator)) >>> 0;
    if (isActuatorLocalActionOnly(actuator)) {
      if (this.isDebugTimersEnabled()) {
        console.log('[Actuator] local action', {
          action,
          source,
          localType: getActuatorLocalActionType(actuator),
          pos: mapPos,
        });
      }
      this.performLocalAction(getActuatorLocalActionType(actuator), source.x, source.y, source.z, mapPos);
      return;
    }

    const targetX = getActuatorTargetX(actuator);
    const targetY = getActuatorTargetY(actuator);
    const map = this.dungeon.getMap(source.z);
    if (!map) return;
    if (targetX < 0 || targetY < 0 || targetX >= map.descriptor.width || targetY >= map.descriptor.height) return;

    const cellFlag = map.cellFlags[targetX][targetY];
    const targetRoomType = (cellFlag >> 5) & 0x7;
    const targetPos = (targetRoomType === RoomType.STONE || targetRoomType === RoomType.FALSEWALL)
      ? getActuatorTargetPos(actuator)
      : 0;

    const timerFunction = this.getRoomTimerFunction(targetRoomType);
    if (timerFunction === 0) {
      console.warn('Illegal actuator timer target', {
        source,
        targetX,
        targetY,
        targetRoomType,
      });
      return;
    }

    if (this.isDebugTimersEnabled()) {
      console.log('[Actuator] queue timer', {
        action,
        actionTime,
        level: source.z,
        targetX,
        targetY,
        targetPos,
        timerFunction,
      });
    }
    this.timers.createTimer(timerFunction, targetX, targetY, targetPos, action, actionTime, source.z);
  }

  private getRoomTimerFunction(roomType: number): number {
    const table = this.roomTimerFunctions ?? DEFAULT_ROOM_TIMER_FUNCTIONS;
    return table[roomType] ?? 0;
  }

  private scanObjectMoveContext(
    position: Position,
    place: boolean,
    unchangedRoom: boolean,
    movedObjectDBType: number,
    movedObjectNameIndex: number,
    positionOfObject: number,
  ): PressurePadContext {
    let objectDB5To13Present = false;
    let monstersPresent = false;
    let sameTypeObjectPresent = false;
    let differentTypeObjectPresent = false;

    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      const dbType = decoded.category;

      if (positionOfObject === -1) {
        if (dbType === DBType.CREATURE) {
          monstersPresent = true;
          continue;
        }
        if (dbType === DBType.TEXT && movedObjectDBType === -1 && place && !unchangedRoom) {
          const rec = this.dungeon.getTextRecord(rn);
          const text = rec ? this.dungeon.decodeMessageText(rec) : null;
          if (text && this.onTextMessage) {
            this.onTextMessage(text);
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

  private doesPartyHave(targetObjectNameIndex: number): boolean {
    const party = this.getPartyState();
    for (const champ of party.champions) {
      if (!champ.alive) continue;
      const possessions = champ.possessions ?? [];
      for (const item of possessions) {
        if (item === null || item === undefined) continue;
        if (this.getBasicObjectTypeFromValue(item) === targetObjectNameIndex) return true;
      }
      if (champ.weaponHand !== null && champ.weaponHand !== undefined) {
        if (this.getBasicObjectTypeFromValue(champ.weaponHand) === targetObjectNameIndex) return true;
      }
      if (champ.shieldHand !== null && champ.shieldHand !== undefined) {
        if (this.getBasicObjectTypeFromValue(champ.shieldHand) === targetObjectNameIndex) return true;
      }
      if (champ.quiver !== null && champ.quiver !== undefined) {
        if (this.getBasicObjectTypeFromValue(champ.quiver) === targetObjectNameIndex) return true;
      }
    }
    return false;
  }

  private performLocalAction(localActionType: number, mapX: number, mapY: number, mapZ: number, mapPos: number): void {
    if (localActionType === 10) {
      const adjustment = 300;
      const party = this.getPartyState();
      const alive = party.champions.filter((c) => c.alive);
      const divisor = party.champions.length > 0 ? party.champions.length : 1;
      const perChampion = Math.floor(adjustment / divisor);

      if (mapPos === -1) {
        for (const champ of alive) {
          this.applySkillIncrease(champ.skills, 8, perChampion);
        }
      } else {
        const target = alive.find((c) => c.partyPosition === (mapPos & 3));
        if (target) {
          this.applySkillIncrease(target.skills, 8, adjustment);
        }
      }
      return;
    }

    this.delayedAction = localActionType;
    this.delayedActionX = mapX | 0;
    this.delayedActionY = mapY | 0;
    this.delayedActionZ = mapZ | 0;
    this.delayedActionPos = mapPos | 0;
  }

  private applySkillIncrease(skills: PartyState['champions'][number]['skills'], index: number, delta: number): void {
    if (!skills || index < 0 || index >= skills.length) return;
    const current = skills[index]?.experience ?? 0;
    skills[index].experience = limitSkillExperience(current + delta);
    populateBaseSkillExperience(skills);
  }

  private isDebugTimersEnabled(): boolean {
    return typeof globalThis !== 'undefined' && (globalThis as { __DM_DEBUG_TIMERS?: boolean }).__DM_DEBUG_TIMERS === true;
  }

  private rotateActuatorList(): void {
    if (this.delayedAction === -1) return;
    const action = this.delayedAction;
    const posFilter = this.delayedActionPos;
    const position = new Position(this.delayedActionX, this.delayedActionY, this.delayedActionZ);

    if (action === 1 || action === 2) {
      let prev: ObjectID | null = null;
      let first = this.dungeon.findFirstObject(position);

      while (first !== OBJECT_ID_EOF) {
        const decoded = decodeObjectID(first);
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
          const decoded = decodeObjectID(second);
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
          while (cursor !== OBJECT_ID_EOF && decodeObjectID(cursor).category === DBType.ACTUATOR) {
            const decoded = decodeObjectID(cursor);
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

  private getForwardPosition(position: Position, facing: number): Position {
    const dir = facing & 3;
    return (dir === 0) ? position.north
      : (dir === 1) ? position.east
      : (dir === 2) ? position.south
      : position.west;
  }

  private normalizeObjectInHand(value: ObjectID | null | undefined): ObjectID | null {
    if (value === null || value === undefined) return null;
    if (value === OBJECT_ID_NULL || value === OBJECT_ID_EOF) return null;
    return value;
  }

  private getBasicObjectTypeFromValue(value: number): number {
    const id = value & 0xffff;
    const decoded = decodeObjectID(id as ObjectID);
    if (decoded.category >= 0 && decoded.category < DBType.UNKNOWN) {
      if (this.hasRecord(decoded.category, decoded.index)) {
        return this.getBasicObjectType(id as ObjectID);
      }
    }
    return value | 0;
  }

  private hasRecord(category: DBType, index: number): boolean {
    switch (category) {
      case DBType.WEAPON:
        return index >= 0 && index < this.dungeon.getData().databases.weapons.records.length;
      case DBType.CLOTHING:
        return index >= 0 && index < this.dungeon.getData().databases.clothing.records.length;
      case DBType.SCROLL:
        return index >= 0 && index < this.dungeon.getData().databases.scrolls.records.length;
      case DBType.POTION:
        return index >= 0 && index < this.dungeon.getData().databases.potions.records.length;
      case DBType.CHEST:
        return index >= 0 && index < this.dungeon.getData().databases.containers.records.length;
      case DBType.MISC:
        return index >= 0 && index < this.dungeon.getData().databases.misc.records.length;
      default:
        return false;
    }
  }

  private getBasicObjectType(rn: ObjectID): number {
    if (!this.objDescObjectType) return OBJNI_NOT_AN_OBJECT;
    if (rn === OBJECT_ID_NULL || rn === OBJECT_ID_EOF) return OBJNI_NOT_AN_OBJECT;

    const decoded = decodeObjectID(rn);
    const descIndex = this.getDescIndex(decoded.category, decoded.index);
    if (descIndex < 0 || descIndex >= this.objDescObjectType.length) return OBJNI_NOT_AN_OBJECT;
    return this.objDescObjectType[descIndex] ?? OBJNI_NOT_AN_OBJECT;
  }

  private getDescIndex(category: DBType, index: number): number {
    switch (category) {
      case DBType.SCROLL:
        return 0;
      case DBType.CHEST: {
        const record = this.dungeon.getData().databases.containers.records[index] as ContainerRecord | undefined;
        if (!record) return -1;
        return (record.containerType & 0x3) + 1;
      }
      case DBType.MISC: {
        const record = this.dungeon.getData().databases.misc.records[index] as MiscRecord | undefined;
        if (!record) return -1;
        return (record.miscType | 0) + 127;
      }
      case DBType.WEAPON: {
        const record = this.dungeon.getData().databases.weapons.records[index] as WeaponRecord | undefined;
        if (!record) return -1;
        return (record.weaponType | 0) + 23;
      }
      case DBType.CLOTHING: {
        const record = this.dungeon.getData().databases.clothing.records[index] as ClothingRecord | undefined;
        if (!record) return -1;
        return (record.clothingType | 0) + 69;
      }
      case DBType.POTION: {
        const record = this.dungeon.getData().databases.potions.records[index] as PotionRecord | undefined;
        if (!record) return -1;
        return (record.potionType | 0) + 2;
      }
      default:
        return -1;
    }
  }

  private applyCursorFilter(
    type: CursorFilterType,
    object: ObjectID,
    position: Position,
    pos: number,
  ): boolean {
    if (!this.cursorFilter) return true;
    return this.cursorFilter({
      type,
      object,
      level: position.z,
      x: position.x,
      y: position.y,
      pos,
    });
  }

  private findFirstDrawableObject(position: Position): ObjectID | null {
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category <= DBType.CREATURE) continue;
      if (decoded.category >= DBType.MISSILE) continue;
      return rn;
    }
    return null;
  }

  private findObjectOfTypeAtPosition(position: Position, pos: number, objectNameIndex: number): ObjectID | null {
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category <= DBType.ACTUATOR) continue;
      if (decoded.category >= DBType.MISSILE) continue;
      if (pos !== -1 && (decoded.position & 0x3) !== (pos & 0x3)) continue;
      if (this.getBasicObjectType(rn) === objectNameIndex) return rn;
    }
    return null;
  }

  private setObjectPosition(rn: ObjectID, pos: number): ObjectID {
    if (rn === OBJECT_ID_NULL || rn === OBJECT_ID_EOF) return rn;
    const decoded = decodeObjectID(rn);
    return encodeObjectID(pos & 0x3, decoded.category, decoded.index);
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
