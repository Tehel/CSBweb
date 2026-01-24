import { decodeObjectID, encodeObjectID, DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType } from '../core/types';
import { SoundIndex } from '../core/constants';
import type { DungeonState } from './DungeonState';
import type { PartyState } from './gameTypes';
import type { ActuatorRecord, CreatureRecord, MapData, MissileRecord, TeleporterRecord, TextRecord } from '../data/dungeonTypes';
import {
  ActuatorAction,
  getActuatorAction,
  getActuatorAndOrEdge,
  getActuatorDelay,
  getActuatorEnergyRemaining,
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
import { constructPredefinedMissile, spellObjectId } from './missileHelpers';

export interface TimerTables {
  monsterDesc?: ArrayLike<{ word2: number }>;
}

export interface TimerHooks {
  onDsaTimer5?: (rn: number, timer: TimerEntry, location: Position) => boolean;
  onDsaTimer6?: (rn: number, timer: TimerEntry, location: Position) => boolean;
  onDsaTimer7?: (rn: number, timer: TimerEntry, location: Position) => boolean;
  onMissileHitParty?: (options: {
    missile: number;
    projectile: number;
    position: Position;
    posInCell: number;
    direction: number;
    damage: number;
    range: number;
  }) => boolean;
  onMissileHitMonster?: (options: {
    missile: number;
    projectile: number;
    monster: number;
    position: Position;
    posInCell: number;
    direction: number;
    damage: number;
    range: number;
  }) => boolean;
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
  playSound?: (soundId: number, rateIdx?: number) => void;
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
      case TimerFunction.TT_DOOR_STEP:
        this.processDoorStep(timer);
        break;
      case TimerFunction.TT_MISSILE0:
      case TimerFunction.TT_MISSILE:
        this.processMissileTimer(timer);
        break;
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
      this.wiggleEverything(timer.uByte6, timer.uByte7, timer.level);
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
        this.wiggleEverything(timer.uByte6, timer.uByte7, timer.level);
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
    const doorState = cellFlag & 0x7;
    if (doorState === 5) return;

    this.activateDsa(timer);

    let nextAction = action;
    if (action === ActuatorAction.TOGGLE) {
      nextAction = doorState === 0 ? ActuatorAction.CLEAR : ActuatorAction.SET;
    } else if (action === ActuatorAction.SET) {
      if (doorState === 0) return;
    } else if (action === ActuatorAction.CLEAR) {
      if (doorState === 4) return;
    }

    timer.function = TimerFunction.TT_DOOR_STEP;
    timer.uByte9 = nextAction & 0xff;
    this.timers.addTimer(timer);
  }

  private processDoorStep(timer: TimerEntry): void {
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;
    const x = timer.uByte6;
    const y = timer.uByte7;
    const cellFlag = map.cellFlags[x]?.[y];
    if (cellFlag === undefined) return;
    if (((cellFlag >> 5) & 7) !== RoomType.DOOR) return;
    let doorState = cellFlag & 0x7;
    if (doorState === 5) return;

    const action = timer.uByte9 & 0xff;
    timer.time = (timer.time + 1) >>> 0;

    if (action === ActuatorAction.CLEAR && doorState !== 0) {
      const target = new Position(x, y, timer.level);
      if (this.isPartyAt(target)) {
        this.setDoorState(map, x, y, 0);
        this.timers.addTimer(timer);
        return;
      }
    }

    if ((action === ActuatorAction.SET && doorState === 0) || (action === ActuatorAction.CLEAR && doorState === 4)) {
      return;
    }

    const prevState = doorState;
    const delta = action === ActuatorAction.SET ? -1 : 1;
    doorState = Math.max(0, Math.min(4, doorState + delta));
    this.setDoorState(map, x, y, doorState);
    if (prevState !== doorState) {
      this.hooks?.playSound?.(SoundIndex.DOOR);
    }

    if ((action === ActuatorAction.SET && doorState !== 0) || (action === ActuatorAction.CLEAR && doorState !== 4)) {
      this.timers.addTimer(timer);
    }
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

  private launchMissile(
    projectileObject: number,
    launchX: number,
    launchY: number,
    level: number,
    position: number,
    direction: number,
    rangeEnergy: number,
    damageEnergy: number,
    startTime: number,
    missileDelay: boolean,
  ): boolean {
    const eventIndex = this.allocateMissileTimerWord8(launchX, launchY, direction, 0);
    const rn = this.createMissileRecord(projectileObject, rangeEnergy, damageEnergy, eventIndex, position);
    if (rn === null) return false;
    if (!this.dungeon.addObjectToCell(new Position(launchX, launchY, level), rn)) return false;
    const functionType = missileDelay ? TimerFunction.TT_MISSILE : TimerFunction.TT_MISSILE0;
    this.timers.createTimer(functionType, launchX, launchY, 0, 0, (startTime + 1) >>> 0, level, rn);
    return true;
  }

  private createMissileRecord(
    projectileObject: number,
    rangeEnergy: number,
    damageEnergy: number,
    eventIndex: number,
    position: number,
  ): number | null {
    const data = this.dungeon.getData();
    const maxIndex = 1023;
    if (data.databases.missiles.records.length >= maxIndex + 1) return null;
    data.databases.missiles.records.push({
      nextObject: OBJECT_ID_EOF,
      projectileObject: projectileObject & 0xffff,
      rangeEnergy: rangeEnergy & 0xff,
      damageEnergy: damageEnergy & 0xff,
      eventIndex: eventIndex & 0xffff,
    });
    data.databases.missiles.count++;
    data.header.objectCounts[DBType.MISSILE] = ((data.header.objectCounts[DBType.MISSILE] ?? 0) + 1) & 0xffff;
    const index = data.databases.missiles.records.length - 1;
    return encodeObjectID(position & 0x3, DBType.MISSILE, index);
  }

  private allocateMissileTimerWord8(
    x: number,
    y: number,
    direction: number,
    deltaEnergy: number,
  ): number {
    const data = this.dungeon.getData();
    if (!data.timers) data.timers = [];
    if (data.timers.length >= 0xffff) return 0xffff;
    const word8 = ((x & 0x1f) | ((y & 0x1f) << 5) | ((direction & 0x3) << 10) | ((deltaEnergy & 0xf) << 12)) & 0xffff;
    data.timers.push({ timerWord8: word8 });
    return data.timers.length - 1;
  }

  private setDoorState(map: MapData, x: number, y: number, doorState: number): void {
    const cellFlag = map.cellFlags[x][y];
    const newCellFlag = (cellFlag & 0xf8) | (doorState & 0x7);
    map.cellFlags[x][y] = newCellFlag;
    const tile = map.tiles[x][y];
    tile.cellFlag = newCellFlag;
    tile.attributes = newCellFlag & 0x0f;
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
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;

    const actuatorType = getActuatorType(actuator);
    const missileType = getActuatorValue(actuator);
    const energyRemaining = getActuatorEnergyRemaining(actuator) & 0xff;

    const timerPos = timer.uByte8 & 0x3;
    let initialPosition = (timerPos + 2) & 0x3;
    let singleMissile = actuatorType === 7 || actuatorType === 8 || actuatorType === 14;

    const source = new Position(timer.uByte6, timer.uByte7, timer.level);
    const altPos = (timerPos + 1) & 0x3;
    const takeObject = (): number => {
      for (let rn = this.dungeon.findFirstObject(source); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
        const decoded = decodeObjectID(rn);
        if (decoded.category <= DBType.ACTUATOR) continue;
        const objPos = decoded.position & 0x3;
        if (objPos !== timerPos && objPos !== altPos) continue;
        this.dungeon.removeObjectFromCell(source, rn);
        return rn;
      }
      return OBJECT_ID_EOF;
    };

    let firstObject = OBJECT_ID_EOF;
    let secondObject = OBJECT_ID_EOF;

    if (actuatorType === 8 || actuatorType === 10) {
      firstObject = spellObjectId(missileType);
      secondObject = firstObject;
    } else if (actuatorType === 14 || actuatorType === 15) {
      firstObject = takeObject();
      if (firstObject === OBJECT_ID_EOF) return;
      if (!singleMissile) {
        secondObject = takeObject();
        if (secondObject === OBJECT_ID_EOF) singleMissile = true;
      }
    } else {
      const constructed = constructPredefinedMissile(this.dungeon.getData(), missileType);
      if (constructed === null) return;
      firstObject = constructed;
      if (!singleMissile) {
        const constructedSecond = constructPredefinedMissile(this.dungeon.getData(), missileType);
        if (constructedSecond === null) {
          singleMissile = true;
        } else {
          secondObject = constructedSecond;
        }
      }
    }

    if (singleMissile) {
      initialPosition = (initialPosition + this.randomInt(0, 1)) & 0x3;
    }

    const dir = timerPos & 0x3;
    const launchX = timer.uByte6 + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
    const launchY = timer.uByte7 + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
    if (launchX < 0 || launchY < 0 || launchX >= map.descriptor.width || launchY >= map.descriptor.height) return;

    const launchLevel = timer.level;
    const launched = this.launchMissile(
      firstObject,
      launchX,
      launchY,
      launchLevel,
      initialPosition,
      dir,
      energyRemaining,
      100,
      timer.time,
      true,
    );
    if (!launched) return;

    if (!singleMissile && secondObject !== OBJECT_ID_EOF) {
      this.launchMissile(
        secondObject,
        launchX,
        launchY,
        launchLevel,
        (initialPosition + 1) & 0x3,
        dir,
        energyRemaining,
        100,
        timer.time,
        true,
      );
    }

    if (this.hooks?.onTriggerMissileLauncher) {
      this.hooks.onTriggerMissileLauncher({
        actuator,
        timer,
        mapX: timer.uByte6,
        mapY: timer.uByte7,
      });
    }
  }

  private processMissileTimer(timer: TimerEntry): void {
    const missileRn = (timer.object ?? OBJECT_ID_EOF) as number;
    if (missileRn === OBJECT_ID_EOF) return;
    const missile = this.dungeon.getMissileRecord(missileRn);
    if (!missile) return;
    const word8 = this.getMissileTimerWord8(missile);
    if (word8 === null) return;

    const map = this.dungeon.getMap(timer.level);
    if (!map) return;

    const { x: origMapX, y: origMapY, dir: missileDir, deltaEnergy } = this.decodeMissileTimerWord8(word8);
    const decoded = decodeObjectID(missileRn);
    let curPos = decoded.position & 0x3;
    let curMapX = origMapX;
    let curMapY = origMapY;

    if (timer.function === TimerFunction.TT_MISSILE0) {
      timer.function = TimerFunction.TT_MISSILE;
    } else {
      const current = new Position(curMapX, curMapY, timer.level);
      if (this.isPartyAt(current) && this.hooks?.onMissileHitParty) {
        const consumed = this.hooks.onMissileHitParty({
          missile: missileRn,
          projectile: missile.projectileObject,
          position: current,
          posInCell: curPos,
          direction: missileDir,
          damage: missile.damageEnergy & 0xff,
          range: missile.rangeEnergy & 0xff,
        });
        if (consumed) {
          this.finishMissile(missileRn, missile, current, curPos);
          return;
        }
      }

      const monster = this.findFirstMonsterAt(current);
      if (monster !== null && this.hooks?.onMissileHitMonster) {
        const consumed = this.hooks.onMissileHitMonster({
          missile: missileRn,
          projectile: missile.projectileObject,
          monster,
          position: current,
          posInCell: curPos,
          direction: missileDir,
          damage: missile.damageEnergy & 0xff,
          range: missile.rangeEnergy & 0xff,
        });
        if (consumed) {
          this.finishMissile(missileRn, missile, current, curPos);
          return;
        }
      }
      if (deltaEnergy > 0) {
        if ((missile.rangeEnergy & 0xff) <= deltaEnergy) {
          this.finishMissile(missileRn, missile, new Position(curMapX, curMapY, timer.level), curPos);
          return;
        }
        missile.rangeEnergy = (missile.rangeEnergy - deltaEnergy) & 0xff;
        if ((missile.damageEnergy & 0xff) <= deltaEnergy) {
          missile.damageEnergy = 0;
        } else {
          missile.damageEnergy = (missile.damageEnergy - deltaEnergy) & 0xff;
        }
      }
    }

    const leavingThisCell = (missileDir === curPos) || (((missileDir + 1) & 0x3) === curPos);
    let blocked = false;

    if (leavingThisCell) {
      const nextX = curMapX + (missileDir === 1 ? 1 : missileDir === 3 ? -1 : 0);
      const nextY = curMapY + (missileDir === 2 ? 1 : missileDir === 0 ? -1 : 0);
      if (nextX < 0 || nextY < 0 || nextX >= map.descriptor.width || nextY >= map.descriptor.height) {
        blocked = true;
      } else {
        const nextCellFlag = map.cellFlags[nextX][nextY];
        const nextRoomType = (nextCellFlag >> 5) & 0x7;
        const origCellFlag = map.cellFlags[curMapX][curMapY];
        const origRoomType = (origCellFlag >> 5) & 0x7;
        const nextIsStone = nextRoomType === RoomType.STONE;
        const nextIsFalseWall = nextRoomType === RoomType.FALSEWALL;
        const falseWallIsSolid = (nextCellFlag & 0x5) === 0;
        const nextIsStairs = nextRoomType === RoomType.STAIRS;
        const origIsStairs = origRoomType === RoomType.STAIRS;
        if (nextIsStone || (nextIsFalseWall && falseWallIsSolid) || (nextIsStairs && origIsStairs)) {
          blocked = true;
        } else {
          curMapX = nextX;
          curMapY = nextY;
        }
      }
    }

    if (blocked) {
      this.finishMissile(missileRn, missile, new Position(origMapX, origMapY, timer.level), curPos);
      return;
    }

    const parityMatch = (missileDir & 0x1) === (curPos & 0x1);
    curPos = parityMatch ? (curPos + 3) & 0x3 : (curPos + 1) & 0x3;

    const oldPos = new Position(origMapX, origMapY, timer.level);
    const newPos = new Position(curMapX, curMapY, timer.level);
    const newRn = encodeObjectID(curPos & 0x3, DBType.MISSILE, decoded.index);

    if (leavingThisCell) {
      this.dungeon.removeObjectFromCell(oldPos, missileRn);
      if (!this.dungeon.addObjectToCell(newPos, newRn)) return;
      timer.object = newRn;
      timer.uByte6 = curMapX & 0xff;
      timer.uByte7 = curMapY & 0xff;
      const updatedWord8 = this.encodeMissileTimerWord8(curMapX, curMapY, missileDir, deltaEnergy);
      this.setMissileTimerWord8(missile, updatedWord8);
    } else {
      const cellFlag = map.cellFlags[curMapX][curMapY];
      const roomType = (cellFlag >> 5) & 0x7;
      if (roomType === RoomType.DOOR) {
        const doorState = cellFlag & 0x7;
        if (doorState !== 0 && doorState !== 5) {
          this.finishMissile(missileRn, missile, oldPos, curPos);
          return;
        }
      }
      this.dungeon.removeObjectFromCell(oldPos, missileRn);
      if (!this.dungeon.addObjectToCell(oldPos, newRn)) return;
      timer.object = newRn;
    }

    timer.time = (timer.time + 1) >>> 0;
    this.timers.addTimer(timer);
  }

  private finishMissile(
    missileRn: number,
    missile: { projectileObject: number },
    position: Position,
    posInCell: number,
  ): void {
    this.dungeon.removeObjectFromCell(position, missileRn as number);
    this.dropMissileObject(missile.projectileObject, position, posInCell);
    this.dungeon.deleteDBEntry(missileRn as number);
  }

  private dropMissileObject(projectileObject: number, position: Position, posInCell: number): void {
    if (projectileObject >= 0xff80) return;
    const decoded = decodeObjectID(projectileObject as number);
    if (decoded.category === DBType.CLOUD) return;
    const dropped = encodeObjectID(posInCell & 0x3, decoded.category, decoded.index);
    this.dungeon.addObjectToCell(position, dropped);
  }

  private findFirstMonsterAt(position: Position): number | null {
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category === DBType.CREATURE) return rn;
    }
    return null;
  }

  private getMissileTimerWord8(missile: { eventIndex: number }): number | null {
    const timers = this.dungeon.getData().timers;
    if (!timers) return null;
    const rec = timers[missile.eventIndex];
    return rec ? rec.timerWord8 : null;
  }

  private setMissileTimerWord8(missile: { eventIndex: number }, word8: number): void {
    const timers = this.dungeon.getData().timers;
    if (!timers) return;
    const rec = timers[missile.eventIndex];
    if (!rec) return;
    rec.timerWord8 = word8 & 0xffff;
  }

  private decodeMissileTimerWord8(word8: number): { x: number; y: number; dir: number; deltaEnergy: number } {
    return {
      x: word8 & 0x1f,
      y: (word8 >> 5) & 0x1f,
      dir: (word8 >> 10) & 0x3,
      deltaEnergy: (word8 >> 12) & 0xf,
    };
  }

  private encodeMissileTimerWord8(x: number, y: number, dir: number, deltaEnergy: number): number {
    return ((x & 0x1f) | ((y & 0x1f) << 5) | ((dir & 0x3) << 10) | ((deltaEnergy & 0xf) << 12)) & 0xffff;
  }

  private wiggleEverything(mapX: number, mapY: number, level: number): void {
    const position = new Position(mapX, mapY, level);

    if (this.isPartyAt(position)) {
      this.wiggleParty(position);
    }

    const monster = this.findFirstMonsterAt(position);
    if (monster !== null) {
      this.wiggleMonster(monster, position);
    }

    const objects: number[] = [];
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category <= DBType.CREATURE) continue;
      objects.push(rn);
    }

    for (const rn of objects) {
      this.wiggleObject(rn, position);
    }
  }

  private wiggleParty(position: Position): void {
    const party = this.getPartyState();
    const result = this.resolveCellEffects(position, -1, 0, party.facing, undefined, true);
    if (!result.moved) return;

    const oldPos = new Position(position.x, position.y, position.z);
    party.position = result.position;
    party.facing = result.facing & 0x3;

    const unchanged = this.isSamePosition(oldPos, result.position);
    this.actuators.triggerObjectMove(oldPos, OBJECT_ID_NULL, false, unchanged, party.facing);
    this.actuators.triggerObjectMove(result.position, OBJECT_ID_NULL, true, unchanged, party.facing);
  }

  private wiggleMonster(monsterRn: number, position: Position): void {
    const rec = this.dungeon.getCreatureRecord(monsterRn);
    const decoded = decodeObjectID(monsterRn);
    const canFall = !this.isMonsterLevitating(rec);
    const facing = rec?.facing ?? 0;
    const result = this.resolveCellEffects(position, DBType.CREATURE, decoded.position & 0x3, facing, undefined, canFall);
    if (!result.moved) return;

    const oldPos = new Position(position.x, position.y, position.z);
    const newRn = encodeObjectID(result.objectPos & 0x3, DBType.CREATURE, decoded.index);
    this.dungeon.removeObjectFromCell(oldPos, monsterRn);
    this.dungeon.addObjectToCell(result.position, newRn);
    if (rec) rec.facing = result.facing & 0x3;

    const unchanged = this.isSamePosition(oldPos, result.position);
    this.actuators.triggerObjectMove(oldPos, monsterRn, false, unchanged, result.facing);
    this.actuators.triggerObjectMove(result.position, newRn, true, unchanged, result.facing);
  }

  private wiggleObject(rn: number, position: Position): void {
    const decoded = decodeObjectID(rn);
    const posInCell = decoded.position & 0x3;
    const partyFacing = this.getPartyState().facing;

    let missileDir: number | undefined;
    let deltaEnergy = 0;
    let missile: MissileRecord | null = null;

    if (decoded.category === DBType.MISSILE) {
      missile = this.dungeon.getMissileRecord(rn);
      if (!missile) return;
      const word8 = this.getMissileTimerWord8(missile);
      if (word8 === null) return;
      const decodedWord = this.decodeMissileTimerWord8(word8);
      missileDir = decodedWord.dir;
      deltaEnergy = decodedWord.deltaEnergy;
    }

    const canFall = decoded.category !== DBType.MISSILE && decoded.category !== DBType.CLOUD;
    const result = this.resolveCellEffects(position, decoded.category, posInCell, partyFacing, missileDir, canFall);
    if (!result.moved) return;

    const oldPos = new Position(position.x, position.y, position.z);
    const newRn = encodeObjectID(result.objectPos & 0x3, decoded.category, decoded.index);
    this.dungeon.removeObjectFromCell(oldPos, rn);
    this.dungeon.addObjectToCell(result.position, newRn);

    const unchanged = this.isSamePosition(oldPos, result.position);
    this.actuators.triggerObjectMove(oldPos, rn, false, unchanged, partyFacing);
    this.actuators.triggerObjectMove(result.position, newRn, true, unchanged, partyFacing);

    if (decoded.category === DBType.MISSILE) {
      const dir = result.missileDir ?? missileDir ?? 0;
      const updatedWord8 = this.encodeMissileTimerWord8(result.position.x, result.position.y, dir, deltaEnergy);
      if (missile) this.setMissileTimerWord8(missile, updatedWord8);
      this.updateMissileTimerEntry(rn, newRn, result.position);
    }
  }

  private resolveCellEffects(
    start: Position,
    objectType: number,
    objectPos: number,
    facing: number,
    missileDir: number | undefined,
    allowFall: boolean,
  ): { position: Position; objectPos: number; facing: number; missileDir?: number; moved: boolean } {
    let position = new Position(start.x, start.y, start.z);
    let curFacing = facing & 0x3;
    let curPos = objectPos & 0x3;
    let curDir = missileDir;
    let moved = false;

    for (let step = 0; step < 1000; step++) {
      const teleporter = this.getActiveTeleporterAt(position);
      if (teleporter && this.teleporterAllowsObject(teleporter, objectType)) {
        const destination = this.getTeleporterDestination(teleporter);
        if (!destination) break;

        const rotation = teleporter.rotation & 0x3;
        const prev = position;

        if (objectType === -1) {
          curFacing = teleporter.absoluteRotation ? rotation : (curFacing + rotation) & 0x3;
          if (teleporter.sound) this.hooks?.playSound?.(SoundIndex.TELEPORT);
        } else if (objectType === DBType.MISSILE) {
          if (teleporter.absoluteRotation) {
            curDir = rotation;
          } else {
            curDir = ((curDir ?? 0) + rotation) & 0x3;
            curPos = (curPos + rotation) & 0x3;
          }
        } else {
          if (!teleporter.absoluteRotation) {
            curPos = (curPos + rotation) & 0x3;
          }
          if (objectType === DBType.CREATURE) {
            curFacing = teleporter.absoluteRotation ? rotation : (curFacing + rotation) & 0x3;
          }
        }

        position = destination;
        moved = true;
        if (this.isSamePosition(prev, position)) break;
        continue;
      }

      if (allowFall && this.isActivePitAt(position)) {
        const next = this.dungeon.incrementLevel(position, 1);
        if (!next) break;
        position = next;
        moved = true;
        continue;
      }

      break;
    }

    return { position, objectPos: curPos, facing: curFacing, missileDir: curDir, moved };
  }

  private getActiveTeleporterAt(position: Position): TeleporterRecord | null {
    const map = this.dungeon.getMap(position.z);
    if (!map) return null;
    const cellFlag = map.cellFlags[position.x]?.[position.y];
    if (cellFlag === undefined) return null;
    const roomType = (cellFlag >> 5) & 0x7;
    if (roomType !== RoomType.TELEPORTER) return null;
    if ((cellFlag & 0x08) === 0) return null;

    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category !== DBType.TELEPORTER) continue;
      return this.dungeon.getTeleporterRecord(rn);
    }

    return null;
  }

  private getTeleporterDestination(teleporter: TeleporterRecord): Position | null {
    const destLevel = teleporter.destMap & 0xff;
    const destAbsX = teleporter.destX & 0x1f;
    const destAbsY = teleporter.destY & 0x1f;

    for (let idx = 0; idx < this.dungeon.getMapCount(); idx++) {
      const map = this.dungeon.getMap(idx as number);
      if (!map) continue;
      const desc = map.descriptor;
      if (desc.level !== destLevel) continue;
      const minX = desc.offsetX;
      const minY = desc.offsetY;
      const maxX = desc.offsetX + desc.width - 1;
      const maxY = desc.offsetY + desc.height - 1;
      if (destAbsX < minX || destAbsX > maxX || destAbsY < minY || destAbsY > maxY) continue;
      return new Position(destAbsX - desc.offsetX, destAbsY - desc.offsetY, idx as number);
    }

    return null;
  }

  private teleporterAllowsObject(teleporter: TeleporterRecord, objectType: number): boolean {
    const scope = teleporter.scope & 0x3;
    if (objectType === -1) return scope === 2 || scope === 3;
    if (objectType === DBType.CREATURE) return scope === 1 || scope === 3;
    return scope === 0 || scope === 2 || scope === 3;
  }

  private isActivePitAt(position: Position): boolean {
    const map = this.dungeon.getMap(position.z);
    if (!map) return false;
    const cellFlag = map.cellFlags[position.x]?.[position.y];
    if (cellFlag === undefined) return false;
    const roomType = (cellFlag >> 5) & 0x7;
    if (roomType !== RoomType.PIT) return false;
    if ((cellFlag & 0x08) === 0) return false;
    return (cellFlag & 0x01) === 0;
  }

  private isMonsterLevitating(rec: CreatureRecord | null): boolean {
    if (!rec) return false;
    const desc = this.tables?.monsterDesc?.[rec.creatureType];
    if (!desc) return false;
    return (desc.word2 & 0x20) !== 0;
  }

  private updateMissileTimerEntry(oldRn: number, newRn: number, position: Position): void {
    for (const entry of this.timers.getTimers()) {
      if (entry.object !== oldRn) continue;
      entry.object = newRn;
      entry.uByte6 = position.x & 0xff;
      entry.uByte7 = position.y & 0xff;
      entry.level = position.z & 0xff;
      break;
    }
  }

  private isSamePosition(a: Position, b: Position): boolean {
    return a.x === b.x && a.y === b.y && a.z === b.z;
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
