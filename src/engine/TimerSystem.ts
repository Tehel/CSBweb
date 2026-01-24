import { decodeObjectID, DBType, OBJECT_ID_EOF, Position, RoomType } from '../core/types';
import type { DungeonState } from './DungeonState';
import type { PartyState } from './gameTypes';
import type { ActuatorRecord, TextRecord } from '../data/dungeonTypes';
import {
  ActuatorAction,
  getActuatorAction,
  getActuatorAndOrEdge,
  getActuatorDelay,
  getActuatorDisableTime,
  getActuatorDrawAsSize4,
  getActuatorHitPointMultiplier,
  getActuatorSetResponses,
  getActuatorClearResponses,
  getActuatorToggleResponses,
  getActuatorState,
  getActuatorTargetPos,
  getActuatorType,
  getActuatorValue,
  isActuatorNormallyClosed,
  isActuatorAudible,
  isActuatorOnceOnly,
  setActuatorState,
  setActuatorType,
  setActuatorValue,
} from '../data/actuatorHelpers';
import { TimerFunction, type TimerEntry, TimerQueue } from './TimerQueue';
import type { ActuatorSystem } from './ActuatorSystem';

export interface TimerTables {
  monsterDesc?: ArrayLike<{ word2: number }>;
}

export interface TimerHooks {
  onDsaTimer5?: (rn: number, timer: TimerEntry, location: Position) => boolean;
  onDsaTimer6?: (rn: number, timer: TimerEntry, location: Position) => boolean;
  onDsaTimer7?: (rn: number, timer: TimerEntry, location: Position) => boolean;
  onSpawnMonster?: (options: {
    type: number;
    hitPointMultiplier: number;
    countMinus1: number;
    facing: number;
    x: number;
    y: number;
    normallyClosed: boolean;
    drawAsSize4: boolean;
    audible: boolean;
  }) => void;
  onTriggerMissileLauncher?: (options: {
    actuator: ActuatorRecord;
    timer: TimerEntry;
    mapX: number;
    mapY: number;
  }) => void;
}

export class TimerSystem {
  constructor(
    private dungeon: DungeonState,
    private getPartyState: () => PartyState,
    private timers: TimerQueue,
    private actuators: ActuatorSystem,
    private tables?: TimerTables,
    private hooks?: TimerHooks,
  ) {}

  processTimers(currentTime: number): void {
    let processed = 0;
    let next = this.timers.peekNext();

    while (next && next.time <= currentTime) {
      const timer = this.timers.shiftNext();
      if (!timer) break;
      this.dispatch(timer);

      processed++;
      if (processed > 50000) break;
      next = this.timers.peekNext();
    }
  }

  private dispatch(timer: TimerEntry): void {
    switch (timer.function) {
      case TimerFunction.TT_OPENROOM:
        this.processOpenRoom(timer);
        break;
      case TimerFunction.TT_STONEROOM:
        this.processStoneRoom(timer);
        break;
      case TimerFunction.TT_FALSEWALL:
        this.processFalseWall(timer);
        break;
      case TimerFunction.TT_TELEPORTER:
        this.processTeleporter(timer);
        break;
      case TimerFunction.TT_PIT:
        this.processPit(timer);
        break;
      case TimerFunction.TT_DOOR:
        this.processDoor(timer);
        break;
      case TimerFunction.TT_DESSAGE:
        this.processOpenRoom(timer);
        break;
      case TimerFunction.TT_PARAMETER_MESSAGE:
        this.processParameterMessage(timer);
        break;
      case TimerFunction.TT_REACTIVATE_GENERATOR:
        this.processReactivateGenerator(timer);
        break;
      default:
        break;
    }
  }

  private processOpenRoom(timer: TimerEntry): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    const target = new Position(timer.uByte6, timer.uByte7, timer.level);
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;

    for (let rn = this.dungeon.findFirstObject(target); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category === DBType.TEXT) {
        const rec = this.dungeon.getTextRecord(rn);
        if (!rec) continue;
        this.applyTextVisibility(rec, action);
        continue;
      }
      if (decoded.category === DBType.ACTUATOR) {
        const rec = this.dungeon.getActuatorRecord(rn);
        if (!rec) continue;
        const type = getActuatorType(rec);
        if (type === 47) {
          const loc = new Position(target.x, target.y, target.z);
          if (this.hooks?.onDsaTimer5?.(rn, timer, loc)) break;
          continue;
        }
        if (type === 48) {
          this.operateCounterActuator(timer, rec, target);
        }
        if (type === 6) {
          this.spawnMonsterGenerator(timer, rec, rn, target);
        }
      }
    }
  }

  private processStoneRoom(timer: TimerEntry): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    const target = new Position(timer.uByte6, timer.uByte7, timer.level);
    const targetPos = timer.uByte8 & 3;

    for (let rn = this.dungeon.findFirstObject(target); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category === DBType.TEXT && decoded.position === targetPos) {
        const rec = this.dungeon.getTextRecord(rn);
        if (!rec) continue;
        this.applyTextVisibility(rec, action);
        continue;
      }
      if (decoded.category !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec) continue;
      const type = getActuatorType(rec);
      if (type === 47) {
        const loc = new Position(target.x, target.y, target.z);
        if (this.hooks?.onDsaTimer6?.(rn, timer, loc)) break;
        continue;
      }
      if (type === 127 && decoded.position === targetPos) {
        this.processPortraitTimer(timer, rec);
        continue;
      }
      if (type === 6 || type === 48) {
        this.operateCounterActuator(timer, rec, target);
        continue;
      }
      if (type === 5) {
        this.processBitwiseCompare(timer, rec, target, decoded.position);
        continue;
      }
      if ((type >= 7 && type <= 10) || type === 14 || type === 15) {
        if (decoded.position === targetPos) {
          this.triggerMissileLauncher(rec, timer);
          if (isActuatorOnceOnly(rec)) setActuatorType(rec, 0);
        }
      }
    }
  }

  private processFalseWall(timer: TimerEntry): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    const target = new Position(timer.uByte6, timer.uByte7, timer.level);
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;

    for (let rn = this.dungeon.findFirstObject(target); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (this.getTimerAction(timer) === 3) return;
      const decoded = decodeObjectID(rn);
      if (decoded.category !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec) continue;
      const type = getActuatorType(rec);
      if (type === 127 && decoded.position === (timer.uByte8 & 3)) {
        this.processPortraitTimer(timer, rec);
        continue;
      }
      if (type === 47) {
        const loc = new Position(target.x, target.y, target.z);
        if (this.hooks?.onDsaTimer7?.(rn, timer, loc)) break;
        continue;
      }
    }

    let nextAction = action;
    if (action === ActuatorAction.TOGGLE) {
      const isSet = (map.cellFlags[target.x][target.y] & 0x04) !== 0;
      nextAction = isSet ? ActuatorAction.CLEAR : ActuatorAction.SET;
    }

    if (nextAction === ActuatorAction.CLEAR) {
      if (this.isPartyAt(target) || this.isNonMaterialMonsterAt(target)) {
        timer.time = (timer.time + 1) >>> 0;
        this.timers.addTimer(timer);
        return;
      }
      map.cellFlags[target.x][target.y] &= 0xfb;
    } else {
      map.cellFlags[target.x][target.y] |= 0x04;
    }
  }

  private processTeleporter(timer: TimerEntry): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;

    this.activateDsa(timer);

    let nextAction = action;
    if (action === ActuatorAction.TOGGLE) {
      const isSet = (map.cellFlags[timer.uByte6][timer.uByte7] & 0x08) !== 0;
      nextAction = isSet ? ActuatorAction.CLEAR : ActuatorAction.SET;
    }

    if (nextAction === ActuatorAction.SET) {
      map.cellFlags[timer.uByte6][timer.uByte7] |= 0x08;
      // TODO: WiggleEverything() to force falls (Timer.cpp:2410+).
    } else {
      map.cellFlags[timer.uByte6][timer.uByte7] &= 0xf7;
    }
  }

  private processPit(timer: TimerEntry): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;

    this.activateDsa(timer);

    let nextAction = action;
    if (action === ActuatorAction.TOGGLE) {
      const isSet = (map.cellFlags[timer.uByte6][timer.uByte7] & 0x08) !== 0;
      nextAction = isSet ? ActuatorAction.CLEAR : ActuatorAction.SET;
    }

    if (nextAction === ActuatorAction.SET) {
      const wasClosed = (map.cellFlags[timer.uByte6][timer.uByte7] & 0x08) === 0;
      map.cellFlags[timer.uByte6][timer.uByte7] |= 0x08;
      if (wasClosed) {
        // TODO: WiggleEverything() to force falls (Timer.cpp:2548+).
      }
    } else {
      map.cellFlags[timer.uByte6][timer.uByte7] &= 0xf7;
    }
  }

  private processDoor(timer: TimerEntry): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;
    const cellFlag = map.cellFlags[timer.uByte6][timer.uByte7];
    if (((cellFlag >> 5) & 7) !== RoomType.DOOR) return;

    this.activateDsa(timer);

    let nextAction = action;
    const doorState = cellFlag & 0x7;
    if (action === ActuatorAction.TOGGLE) {
      nextAction = doorState === 0 ? ActuatorAction.CLEAR : ActuatorAction.SET;
    } else if (action === ActuatorAction.SET) {
      if (doorState === 0) return;
    } else if (action === ActuatorAction.CLEAR) {
      if (doorState === 4) return;
    }

    this.dungeon.applyDoorActionAtPosition(timer.level, timer.uByte6, timer.uByte7, nextAction);
  }

  private processParameterMessage(timer: TimerEntry): void {
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;
    const x = timer.uByte6;
    const y = timer.uByte7;
    const cellFlag = map.cellFlags[x]?.[y];
    if (cellFlag === undefined) return;
    const roomType = (cellFlag >> 5) & 0x7;
    if (roomType !== RoomType.STONE) {
      this.processOpenRoom(timer);
    } else {
      this.processStoneRoom(timer);
    }
  }

  private operateCounterActuator(timer: TimerEntry, actuator: ActuatorRecord, target: Position): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    let counter = getActuatorValue(actuator);
    if (counter === 0) return;

    if (action === ActuatorAction.SET) {
      if (counter < 511) counter += 1;
    } else {
      counter -= 1;
    }

    setActuatorValue(actuator, counter);

    if (getActuatorAction(actuator) === ActuatorAction.CONSTPRESSURE) {
      const pressed = counter === 0;
      const closed = pressed !== isActuatorNormallyClosed(actuator);
      this.actuators.queueSwitchActionForActuator(
        actuator,
        closed ? ActuatorAction.SET : ActuatorAction.CLEAR,
        target.z,
        getActuatorTargetPos(actuator),
      );
    } else if (counter === 0) {
      this.actuators.queueSwitchActionForActuator(
        actuator,
        getActuatorAction(actuator),
        target.z,
        getActuatorTargetPos(actuator),
      );
    }
  }

  private processBitwiseCompare(
    timer: TimerEntry,
    actuator: ActuatorRecord,
    target: Position,
    actuatorPos: number,
  ): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;

    const oldValue = getActuatorValue(actuator);
    const bitmask = 1 << (timer.uByte8 & 0xf);
    let newValue = oldValue;
    if (action === ActuatorAction.TOGGLE) {
      newValue ^= bitmask;
    } else if (action === ActuatorAction.CLEAR) {
      newValue &= ~bitmask;
    } else {
      newValue |= bitmask;
    }

    const oldState = oldValue & 0xf;
    const oldTarget = (oldValue >> 4) & 0xf;
    const newState = newValue & 0xf;
    const newTarget = (newValue >> 4) & 0xf;
    const oldMatch = oldState === oldTarget;
    const newMatch = newState === newTarget;

    const edge = getActuatorAndOrEdge(actuator);
    switch (edge) {
      case 1:
        if (oldState === newState) return;
        break;
      case 2:
        if (oldMatch === newMatch) return;
        break;
      case 3:
        if (oldState === newState) return;
        if (oldMatch !== newMatch) return;
        break;
      case 4:
        if (action !== ActuatorAction.SET) return;
        break;
      case 5:
        if (action !== ActuatorAction.CLEAR) return;
        break;
      case 6:
        if (oldState === newState) return;
        if (oldState & bitmask) return;
        break;
      case 7:
        if (oldState === newState) return;
        if (newState & bitmask) return;
        break;
      default:
        break;
    }

    setActuatorValue(actuator, newValue);

    const pressed = newState === newTarget;
    const closed = pressed !== isActuatorNormallyClosed(actuator);
    if (getActuatorAction(actuator) === ActuatorAction.CONSTPRESSURE) {
      this.actuators.queueSwitchActionForActuator(
        actuator,
        closed ? ActuatorAction.SET : ActuatorAction.CLEAR,
        target.z,
        actuatorPos & 3,
      );
    } else if (closed) {
      this.actuators.queueSwitchActionForActuator(
        actuator,
        getActuatorAction(actuator),
        target.z,
        actuatorPos & 3,
      );
    }
  }

  private getTimerAction(timer: TimerEntry): ActuatorAction | 3 {
    if (timer.uByte9 > 2) return 3;
    return timer.uByte9 as ActuatorAction;
  }

  private applyTextVisibility(record: TextRecord, action: ActuatorAction | 3): void {
    if (action === 3) return;
    if (action === ActuatorAction.SET) record.visible = true;
    else if (action === ActuatorAction.CLEAR) record.visible = false;
    else record.visible = !record.visible;
  }

  private isPartyAt(position: Position): boolean {
    const party = this.getPartyState();
    const pos = party.position;
    return pos.x === position.x && pos.y === position.y && pos.z === position.z;
  }

  private isNonMaterialMonsterAt(position: Position): boolean {
    const table = this.tables?.monsterDesc;
    if (!table) return false;
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category !== DBType.CREATURE) continue;
      const rec = this.dungeon.getCreatureRecord(rn);
      if (!rec) continue;
      const desc = table[rec.creatureType];
      if (!desc) continue;
      if ((desc.word2 & 0x40) !== 0) return true;
    }
    return false;
  }

  private processPortraitTimer(timer: TimerEntry, actuator: ActuatorRecord): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    let responses = 0;
    if (action === ActuatorAction.SET) responses = getActuatorSetResponses(actuator);
    else if (action === ActuatorAction.CLEAR) responses = getActuatorClearResponses(actuator);
    else responses = getActuatorToggleResponses(actuator);

    let state = getActuatorState(actuator);
    state = this.applyPortraitResponse(state, 1, responses, 0);
    state = this.applyPortraitResponse(state, 2, responses, 2);
    state = this.applyPortraitResponse(state, 4, responses, 4);
    setActuatorState(actuator, state);
  }

  private applyPortraitResponse(state: number, bitmask: number, responses: number, fieldStart: number): number {
    const response = (responses >> fieldStart) & 3;
    switch (response) {
      case 1:
        return state & ~bitmask;
      case 2:
        return state | bitmask;
      case 3:
        return state ^ bitmask;
      default:
        return state;
    }
  }

  private spawnMonsterGenerator(timer: TimerEntry, actuator: ActuatorRecord, rn: number, target: Position): void {
    let countMinus1 = getActuatorDelay(actuator);
    if ((countMinus1 & 0x8) !== 0) {
      countMinus1 = this.randomInt(0, countMinus1 & 0x7);
    } else {
      countMinus1 = (countMinus1 - 1) & 0xffff;
    }

    const hitPointMultiplier = getActuatorHitPointMultiplier(actuator) || 0;
    const facing = this.randomInt(0, 3);
    const drawAsSize4 = getActuatorDrawAsSize4(actuator);
    const normallyClosed = isActuatorNormallyClosed(actuator);
    const audible = isActuatorAudible(actuator);

    if (this.hooks?.onSpawnMonster) {
      this.hooks.onSpawnMonster({
        type: getActuatorValue(actuator),
        hitPointMultiplier,
        countMinus1,
        facing,
        x: target.x,
        y: target.y,
        normallyClosed,
        drawAsSize4,
        audible,
      });
    }

    if (isActuatorOnceOnly(actuator)) {
      setActuatorType(actuator, 0);
    } else {
      let disableTime = getActuatorDisableTime(actuator);
      if (disableTime !== 0) {
        setActuatorType(actuator, 0);
        if (disableTime >= 128) {
          disableTime = 64 * (disableTime - 126);
        }
        const actionTime = (timer.time + disableTime) >>> 0;
        this.timers.createTimer(
          TimerFunction.TT_REACTIVATE_GENERATOR,
          target.x,
          target.y,
          0,
          0,
          actionTime,
          target.z,
          rn,
        );
      }
    }
  }

  private processReactivateGenerator(timer: TimerEntry): void {
    const target = new Position(timer.uByte6, timer.uByte7, timer.level);
    let firstTypeZero: number | null = null;
    let match: number | null = null;

    for (let rn = this.dungeon.findFirstObject(target); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec) continue;
      if (getActuatorType(rec) !== 0) continue;
      if (firstTypeZero === null) firstTypeZero = rn;
      if (timer.object !== undefined && rn === timer.object) {
        match = rn;
        break;
      }
    }

    const targetRn = match ?? firstTypeZero;
    if (targetRn === null) return;
    const rec = this.dungeon.getActuatorRecord(targetRn);
    if (!rec) return;
    setActuatorType(rec, getActuatorType(rec) | 6);
  }

  private triggerMissileLauncher(actuator: ActuatorRecord, timer: TimerEntry): void {
    if (this.hooks?.onTriggerMissileLauncher) {
      this.hooks.onTriggerMissileLauncher({
        actuator,
        timer,
        mapX: timer.uByte6,
        mapY: timer.uByte7,
      });
    }
  }

  private activateDsa(timer: TimerEntry): void {
    if (!this.hooks?.onDsaTimer5) return;
    const target = new Position(timer.uByte6, timer.uByte7, timer.level);
    for (let rn = this.dungeon.findFirstObject(target); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec || getActuatorType(rec) !== 47) continue;
      this.hooks.onDsaTimer5(rn, timer, target);
    }
  }

  private randomInt(min: number, max: number): number {
    if (max <= min) return min;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
