import {
  DBType,
  TilePosition,
  decodeObjectID,
  encodeObjectID,
  OBJECT_ID_EOF,
  OBJECT_ID_NULL,
  type ObjectID,
  Position,
  RoomType,
} from '../core/types';
import type { ActuatorRecord, DsaDefinition, DsaState, TextRecord } from '../data/dungeonTypes';
import {
  getActuatorDsaSelector,
  getActuatorDsaState,
  getActuatorDisableTime,
  getActuatorParameterA,
  getActuatorParameterB,
  getActuatorType,
  isActuatorAudible,
  isActuatorOnceOnly,
  setActuatorDsaState,
  setActuatorDisableTime,
  setActuatorParameterA,
  setActuatorParameterB,
} from '../data/actuatorHelpers';
import type { DungeonState, TextDecodeTables } from './DungeonState';
import type { PartyState, Champion } from './gameTypes';
import { TimerFunction } from './TimerQueue';
import type { TimerEntry, TimerQueue } from './TimerQueue';
import type { ActuatorSystem } from './ActuatorSystem';

export interface DsaTables {
  roomTimerFunctions?: ArrayLike<number>;
  objDescCarryMask?: ArrayLike<number>;
  carryLocation?: ArrayLike<number>;
}

export interface ViewingFilterOptions {
  phraseMask: number;
  objectId: number;
  selectedCharacter: number;
  textTables?: TextDecodeTables;
}

export interface ViewingFilterResult {
  phraseMask: number;
  objectId: number;
  phraseTextOverrides: Array<string | null>;
  phraseColorOverrides: Array<number | null>;
}

interface DsaLocation {
  l: number;
  x: number;
  y: number;
  p: number;
}

enum DsaCommand {
  MESSAGE = 1,
  OVERRIDE = 2,
  NOOP = 3,
  COPYTELEPORTER = 4,
  GOSUB = 5,
  LOAD = 6,
  FETCH = 7,
  EQUAL = 8,
  QUESTION = 9,
  AMPERSAND = 11,
  JUMP = 12,
  STORE = 13,
  COPYTELEPORTER32 = 14,
  MESSAGE32 = 15,
  CASE = 16,
  VARIABLEFETCH = 17,
  VARIABLESTORE = 18,
  GLOBALFETCH = 19,
  GLOBALSTORE = 20,
  AMPERSAND2 = 21,
  DESSAGE32 = 22,
}

enum MessageType {
  NULL = 0,
  SET = 1,
  CLEAR = 2,
  TOGGLE = 3,
}

enum TargetType {
  A = 0,
  B = 1,
  ABS = 2,
  GEAR = 3,
}

enum DsaVarType {
  Undefined = 0,
  WellDefined = 1,
  NonParameter = 2,
}

enum StkOp {
  NOOP = 0,
  PLUS = 1,
  ROLL = 2,
  PICK = 3,
  NEG = 4,
  EQUAL = 5,
  POKE = 6,
  DROP = 7,
  TYPE = 8,
  DEL = 9,
  ADD = 10,
  DUP = 11,
  ONE_MINUS = 12,
  SWAP = 13,
  ONE_PLUS = 14,
  OVER = 15,
  MINUS_ROLL = 16,
  ROT = 17,
  MINUS_ROT = 18,
  AND = 19,
  SHIFT = 20,
  COMP = 21,
  OR = 22,
  SLASH = 24,
  PERCENT = 25,
  SET_NEW_STATE = 26,
  LESS = 27,
  TWO_DROP = 28,
  NOT_EQUAL = 29,
  TWO_PICK = 30,
  RSHIFT = 31,
  NOT = 32,
  FALSE_PIT = 33,
  GENERATOR_DELAY_STORE = 34,
  GEAR = 37,
  FETCH = 38,
  STORE = 39,
  PARAM_FETCH = 40,
  PARAM_STORE = 41,
  CELL_FETCH = 57,
  CELL_STORE = 58,
  GLOBAL_FETCH = 59,
  ULESS = 50,
  RANDOM = 67,
  XOR = 70,
  DESCRIBE = 72,
  COPY = 76,
  TIME_FETCH = 97,
  GENERATOR_DELAY_FETCH = 100,
  MOVE = 73,
  OBJECT_ID = 123,
  MODIFY_MESSAGE = 138,
  NUM_PARAM = 139,
}

const EDT_SPECIAL_LOCATIONS = 3;
const ESL_MISSILE_ENCOUNTER_FILTER = 13;
const ESL_VIEWING_FILTER = 3;
const MISSILE_ENCOUNTER_FILTER_KEY = (EDT_SPECIAL_LOCATIONS << 24) | ESL_MISSILE_ENCOUNTER_FILTER;
const VIEWING_FILTER_KEY = (EDT_SPECIAL_LOCATIONS << 24) | ESL_VIEWING_FILTER;

const DEFAULT_ROOM_TIMER_FUNCTIONS = [6, 5, 9, 0, 10, 8, 7, 0];

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

class DsaVars {
  definedFlags: Uint8Array;
  values: Int32Array;

  constructor() {
    this.definedFlags = new Uint8Array(100);
    this.values = new Int32Array(100);
  }

  reset(): void {
    this.definedFlags.fill(DsaVarType.Undefined);
    this.values.fill(0);
  }
}

interface ViewingFilterContext {
  phraseMask: number;
  phraseTextOverrides: Array<string | null>;
  phraseColorOverrides: Array<number | null>;
  textTables?: TextDecodeTables;
  modified: boolean;
}

class DsaStack {
  private stack: number[] = [];

  clear(): void {
    this.stack.length = 0;
  }

  push(value: number): void {
    this.stack.push(value | 0);
  }

  pop(): number {
    const value = this.stack.pop();
    return value === undefined ? 0 : value;
  }

  pick(index: number): void {
    const idx = this.stack.length - 1 - index;
    if (idx < 0 || idx >= this.stack.length) {
      this.push(0);
      return;
    }
    this.push(this.stack[idx] ?? 0);
  }

  poke(index: number): void {
    const value = this.pop();
    const idx = this.stack.length - index;
    if (idx < 0 || idx >= this.stack.length) return;
    this.stack[idx] = value;
  }

  roll(index: number): void {
    const start = this.stack.length - 1 - index;
    if (start < 0 || start >= this.stack.length) return;
    const value = this.stack[start];
    for (let i = start; i < this.stack.length - 1; i++) {
      this.stack[i] = this.stack[i + 1] ?? 0;
    }
    this.stack[this.stack.length - 1] = value ?? 0;
  }

  minusRoll(index: number): void {
    const end = this.stack.length - 1;
    const start = end - index;
    if (start < 0 || start >= this.stack.length) return;
    const value = this.stack[end];
    for (let i = end; i > start; i--) {
      this.stack[i] = this.stack[i - 1] ?? 0;
    }
    this.stack[start] = value ?? 0;
  }
}

class DsaBank {
  stack = new DsaStack();
  forceState = -1;
  mostRecentInterestingObjectID = -1;
  filter = false;
  indirectActionDelay = -1;

  constructor(public vars: DsaVars) {}

  getVar(index: number): number {
    if (index < 0 || index >= this.vars.values.length) return 0;
    if (this.vars.definedFlags[index] === DsaVarType.Undefined) {
      this.vars.values[index] = 0;
      return 0;
    }
    return this.vars.values[index] ?? 0;
  }

  setVar(index: number, value: number): void {
    if (index < 0 || index >= this.vars.values.length) return;
    this.vars.values[index] = value | 0;
    this.vars.definedFlags[index] = DsaVarType.WellDefined;
  }

  setVarBit(index: number, bitmask: number): void {
    const current = this.getVar(index);
    this.setVar(index, current | bitmask);
  }

  setVarState(index: number, state: DsaVarType): void {
    if (index < 0 || index >= this.vars.definedFlags.length) return;
    this.vars.definedFlags[index] = state;
  }

  getVarState(index: number): DsaVarType {
    if (index < 0 || index >= this.vars.definedFlags.length) return DsaVarType.Undefined;
    return this.vars.definedFlags[index] as DsaVarType;
  }
}

interface ExecutionPacket {
  program: Uint16Array;
  pc: number;
  wordsRemaining: number;
  curState: number;
  column: number;
  nextState: number;
  transferState: number;
  transferCol: number;
  locrMaster: DsaLocation;
  locrSlave: DsaLocation;
  rnMaster: number;
  rnSlave: number;
  master: DsaDefinition;
  slave: DsaDefinition;
  subroutineLevel: number;
}

function signExtend(value: number, bits: number): number {
  const sign = 1 << (bits - 1);
  return (value & (sign - 1)) - (value & sign);
}

function readSignedWord(word: number): number {
  const value = word & 0xffff;
  return value & 0x8000 ? value - 0x10000 : value;
}

function locationToInt(locr: DsaLocation): number {
  return ((locr.p & 3) << 16) | ((locr.l & 0x3f) << 10) | ((locr.x & 0x1f) << 5) | (locr.y & 0x1f);
}

function intToLocation(value: number): DsaLocation {
  return {
    p: (value >> 16) & 3,
    l: (value >> 10) & 0x3f,
    x: (value >> 5) & 0x1f,
    y: value & 0x1f,
  };
}

export class DsaSystem {
  private roomTimerFunctions: ArrayLike<number> | null;
  private objDescCarryMask: ArrayLike<number> | null;
  private carryLocation: ArrayLike<number> | null;
  private timerTypeModifier = [0, 1, 2];
  private parameters = new Int32Array(101);
  private globalVariables = new Int32Array(100);
  private warnedOps = new Set<number>();
  private overridePos = 0;
  private overrideP = false;
  private viewingFilterContext: ViewingFilterContext | null = null;

  constructor(
    private dungeon: DungeonState,
    private getTime: () => number,
    private timers: TimerQueue,
    private getPartyState?: () => PartyState,
    tables?: DsaTables,
    private actuators?: ActuatorSystem,
  ) {
    this.roomTimerFunctions = tables?.roomTimerFunctions ?? null;
    this.objDescCarryMask = tables?.objDescCarryMask ?? null;
    this.carryLocation = tables?.carryLocation ?? null;
  }

  setTables(tables: DsaTables): void {
    if (tables.roomTimerFunctions) this.roomTimerFunctions = tables.roomTimerFunctions;
    if (tables.objDescCarryMask) this.objDescCarryMask = tables.objDescCarryMask;
    if (tables.carryLocation) this.carryLocation = tables.carryLocation;
  }

  setParameters(count: number, values: ArrayLike<number>): void {
    const n = Math.min(Math.max(count, 0), 100);
    this.parameters[0] = n;
    for (let i = 0; i < n; i++) {
      this.parameters[1 + i] = values[i] ?? 0;
    }
  }

  getParameter(index: number): number {
    if (index < 0 || index >= 100) return 0;
    return this.parameters[1 + index] ?? 0;
  }

  processMissileEncounterFilter(options: {
    type: number;
    position: Position;
    posInCell: number;
    missile: number;
    projectile: number;
    direction: number;
    index: number;
  }): number {
    const special = this.dungeon.getSpecialLocation(MISSILE_ENCOUNTER_FILTER_KEY);
    if (special === null) return 0;
    const locrFilter = intToLocation(special);
    if (!this.isValidLocation(locrFilter)) return 0;
    const filterPos = new Position(locrFilter.x, locrFilter.y, locrFilter.l);
    const dsaActuator = this.findFirstDsaActuator(filterPos);
    if (dsaActuator === OBJECT_ID_EOF) return 0;

    const timer: TimerEntry = {
      index: -1,
      time: 0,
      level: locrFilter.l & 0xff,
      function: 0,
      uByte5: 0,
      uByte6: locrFilter.x & 0xff,
      uByte7: locrFilter.y & 0xff,
      uByte8: 0,
      uByte9: 0,
      sequence: 0,
      timerWord8: 0,
    };

    const encounterLoc = locationToInt({
      l: options.position.z & 0x3f,
      x: options.position.x & 0x1f,
      y: options.position.y & 0x1f,
      p: options.posInCell & 0x3,
    });

    this.setParameters(7, [
      0,
      options.type | 0,
      encounterLoc,
      options.missile | 0,
      options.projectile | 0,
      options.direction | 0,
      options.index | 0,
    ]);

    this.processTimer6Internal(dsaActuator, timer, filterPos, true, new DsaVars());
    return this.getParameter(0);
  }

  processViewingFilter(options: ViewingFilterOptions): ViewingFilterResult | null {
    const special = this.dungeon.getSpecialLocation(VIEWING_FILTER_KEY);
    if (special === null) return null;
    const locrFilter = intToLocation(special);
    if (!this.isValidLocation(locrFilter)) return null;
    const filterPos = new Position(locrFilter.x, locrFilter.y, locrFilter.l);
    const dsaActuator = this.findFirstDsaActuator(filterPos);
    if (dsaActuator === OBJECT_ID_EOF) return null;

    const timer: TimerEntry = {
      index: -1,
      time: 0,
      level: locrFilter.l & 0xff,
      function: 0,
      uByte5: 0,
      uByte6: locrFilter.x & 0xff,
      uByte7: locrFilter.y & 0xff,
      uByte8: 0,
      uByte9: 0,
      sequence: 0,
      timerWord8: 0,
    };

    this.setParameters(3, [options.phraseMask | 0, options.objectId | 0, options.selectedCharacter | 0]);
    this.viewingFilterContext = {
      phraseMask: options.phraseMask | 0,
      phraseTextOverrides: Array.from({ length: 8 }, () => null),
      phraseColorOverrides: Array.from({ length: 8 }, () => null),
      textTables: options.textTables,
      modified: false,
    };

    this.processTimer6Internal(dsaActuator, timer, filterPos, true, new DsaVars());

    const ctx = this.viewingFilterContext;
    this.viewingFilterContext = null;
    if (!ctx) return null;
    const paramMask = this.getParameter(0);
    const phraseMask = ctx.modified ? ctx.phraseMask : (paramMask | 0);
    const objectId = this.getParameter(1);

    return {
      phraseMask,
      objectId,
      phraseTextOverrides: ctx.phraseTextOverrides,
      phraseColorOverrides: ctx.phraseColorOverrides,
    };
  }

  processTimer5(rn: number, timer: TimerEntry, location: Position): boolean {
    const vars = new DsaVars();
    return this.processTimer6Internal(rn, timer, location, false, vars);
  }

  processTimer6(rn: number, timer: TimerEntry, location: Position): boolean {
    const vars = new DsaVars();
    return this.processTimer6Internal(rn, timer, location, false, vars);
  }

  processTimer7(rn: number, timer: TimerEntry, location: Position): boolean {
    const vars = new DsaVars();
    return this.processTimer6Internal(rn, timer, location, false, vars);
  }

  private processTimer6Internal(
    rn: number,
    timer: TimerEntry,
    location: Position,
    filter: boolean,
    vars: DsaVars,
  ): boolean {
    const action = this.timerTypeModifier[timer.uByte9] ?? 3;
    if (action === 3) return false;
    const level = location.z;
    const slaveRecord = this.dungeon.getActuatorRecord(rn);
    if (!slaveRecord) return false;
    const slaveSelector = getActuatorDsaSelector(slaveRecord);
    const slaveIndex = this.getAbsDsaIndex(level, slaveSelector);
    if (slaveIndex === null) return false;
    const slaveDsa = this.getDsa(slaveIndex);
    if (!slaveDsa) return false;

    const locrSlave: DsaLocation = {
      l: level,
      x: location.x,
      y: location.y,
      p: decodeObjectID(rn).position & 3,
    };
    const master = this.findMaster(slaveDsa, rn, timer.uByte6, timer.uByte7, locrSlave);
    const masterRecord = this.dungeon.getActuatorRecord(master.rn);
    if (!masterRecord) return false;
    const masterSelector = getActuatorDsaSelector(masterRecord);
    const masterIndex = this.getAbsDsaIndex(level, masterSelector);
    if (masterIndex === null) return false;
    const masterDsa = this.getDsa(masterIndex);
    if (!masterDsa) return false;

    const currentState = this.getState(masterRecord, masterDsa);
    const msgType = 3 * (timer.uByte8 & 3) + action;

    const bank = new DsaBank(vars);
    bank.stack.clear();
    bank.filter = filter;
    const finalState = this.execute({
      program: new Uint16Array(),
      pc: 0,
      wordsRemaining: 0,
      curState: currentState,
      column: msgType,
      nextState: currentState,
      transferState: -1,
      transferCol: -1,
      locrMaster: master.locr,
      locrSlave,
      rnMaster: master.rn,
      rnSlave: rn,
      master: masterDsa,
      slave: slaveDsa,
      subroutineLevel: 0,
    }, bank);

    const nextState = bank.forceState >= 0 ? bank.forceState : finalState;
    if (nextState >= 0) {
      this.putState(masterRecord, masterDsa, nextState);
    }
    return false;
  }

  private execute(exPkt: ExecutionPacket, bank: DsaBank): number {
    let finalState = -1;
    let curState = exPkt.curState;
    let column = exPkt.column;

    do {
      const state = this.getDsaState(exPkt.slave, curState);
      if (!state) {
        if (finalState === -1) finalState = curState;
        return finalState;
      }
      const program = this.getProgramForColumn(state, column);
      if (!program || program.length === 0) {
        if (finalState === -1) finalState = curState;
        return finalState;
      }
      let pc = 0;
      let wordsRemaining = program.length;
      let transferState = -1;
      let transferCol = -1;
      let nextState = curState;

      while (wordsRemaining > 0) {
        const word = program[pc++] ?? 0;
        wordsRemaining--;
        const opcode = word & 0x3f;
        switch (opcode) {
          case DsaCommand.NOOP: {
            let relState = signExtend((word >> 6) & 0x3ff, 10);
            if (relState === -512) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            break;
          }
          case DsaCommand.MESSAGE:
          case DsaCommand.MESSAGE32:
          case DsaCommand.DESSAGE32: {
            let relState = signExtend((word >> 12) & 0xf, 4);
            if (relState === -8) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const msgType = (word >> 6) & 0x3;
            const delayType = (word >> 8) & 0x3;
            const targetType = (word >> 10) & 0x3;
            let delay = 0;
            const masterRec = this.getActuator(exPkt.rnMaster);
            if (delayType === 1) delay = masterRec ? getActuatorParameterA(masterRec) : 0;
            else if (delayType === 2) delay = masterRec ? getActuatorParameterB(masterRec) : 0;
            else if (delayType === 3) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              delay = readSignedWord(next);
            }
            const target = this.getTarget(targetType, opcode !== DsaCommand.MESSAGE, () => {
              const value = program[pc++] ?? 0;
              wordsRemaining--;
              return value;
            }, bank, exPkt.rnMaster);
            if (msgType !== MessageType.NULL && target) {
              const action = msgType - 1;
              const morD = opcode === DsaCommand.DESSAGE32 ? 'D' : 'M';
              this.queueDsaSwitchAction(delay, action, target, morD);
            }
            break;
          }
          case DsaCommand.COPYTELEPORTER:
          case DsaCommand.COPYTELEPORTER32: {
            let relState = signExtend((word >> 10) & 0x3f, 6);
            if (relState === -32) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const targetFrom = (word >> 6) & 0x3;
            const targetTo = (word >> 8) & 0x3;
            const locSrc = this.getTarget(targetFrom, opcode === DsaCommand.COPYTELEPORTER32, () => {
              const value = program[pc++] ?? 0;
              wordsRemaining--;
              return value;
            }, bank, exPkt.rnMaster);
            const locDst = this.getTarget(targetTo, opcode === DsaCommand.COPYTELEPORTER32, () => {
              const value = program[pc++] ?? 0;
              wordsRemaining--;
              return value;
            }, bank, exPkt.rnMaster);
            if (locSrc && locDst) this.copyTeleporter(locSrc, locDst);
            break;
          }
          case DsaCommand.GOSUB: {
            let relState = signExtend((word >> 13) & 0x7, 3);
            if (relState === -4) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            let row = (word >> 6) & 0x3f;
            const colFlag = (word >> 12) & 0x1;
            if (row === 63) {
              row = program[pc++] ?? 0;
              wordsRemaining--;
            }
            let col = 0;
            if (colFlag !== 0) {
              col = program[pc++] ?? 0;
              wordsRemaining--;
            }
            const subPacket: ExecutionPacket = {
              ...exPkt,
              curState: row,
              column: col,
              subroutineLevel: exPkt.subroutineLevel + 1,
              slave: exPkt.master,
            };
            this.execute(subPacket, bank);
            break;
          }
          case DsaCommand.JUMP: {
            let relState = signExtend((word >> 13) & 0x7, 3);
            if (relState === -4) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            let row = (word >> 6) & 0x3f;
            const colFlag = (word >> 12) & 0x1;
            if (row === 63) {
              row = program[pc++] ?? 0;
              wordsRemaining--;
            }
            transferState = row;
            transferCol = 0;
            if (colFlag !== 0) {
              transferCol = program[pc++] ?? 0;
              wordsRemaining--;
            }
            break;
          }
          case DsaCommand.QUESTION: {
            let relState = signExtend((word >> 6) & 0xf, 4);
            if (relState === -2) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const ifColumn = (word >> 10) & 0x1;
            const ifCmd = (word >> 11) & 0x3;
            const elseColumn = (word >> 13) & 0x1;
            const elseCmd = (word >> 14) & 0x3;

            const cond = bank.stack.pop() !== 0;
            let cmd = 0;
            let addr = 0;
            let col = 0;
            if (cond) {
              cmd = ifCmd;
              if (cmd !== 0) {
                addr = program[pc++] ?? 0;
                wordsRemaining--;
              }
              if (ifColumn !== 0) {
                col = program[pc++] ?? 0;
                wordsRemaining--;
              }
              if (elseCmd !== 0) {
                pc++;
                wordsRemaining--;
              }
              if (elseColumn !== 0) {
                pc++;
                wordsRemaining--;
              }
            } else {
              if (ifCmd !== 0) {
                pc++;
                wordsRemaining--;
              }
              if (ifColumn !== 0) {
                pc++;
                wordsRemaining--;
              }
              cmd = elseCmd;
              if (cmd !== 0) {
                addr = program[pc++] ?? 0;
                wordsRemaining--;
              }
              if (elseColumn !== 0) {
                col = program[pc++] ?? 0;
                wordsRemaining--;
              }
            }
            if (cmd === 1) {
              transferState = addr;
              transferCol = col;
            } else if (cmd === 2) {
              const subPacket: ExecutionPacket = {
                ...exPkt,
                curState: addr,
                column: col,
                subroutineLevel: exPkt.subroutineLevel + 1,
                slave: exPkt.master,
              };
              this.execute(subPacket, bank);
            }
            break;
          }
          case DsaCommand.CASE: {
            let relState = signExtend((word >> 6) & 0x3ff, 10);
            if (relState === -512) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const value = bank.stack.pop();
            const numCase = program[pc++] ?? 0;
            wordsRemaining--;
            let found = false;
            for (let i = 0; i < numCase; i++) {
              const low = program[pc++] ?? 0;
              const high = program[pc++] ?? 0;
              const targetLow = program[pc++] ?? 0;
              const targetHigh = program[pc++] ?? 0;
              const caseValue = ((high << 16) | low) >>> 0;
              const target = ((targetHigh << 16) | targetLow) >>> 0;
              if (!found && caseValue === (value >>> 0)) {
                transferState = (target >>> 8) & 0xffff;
                transferCol = target & 0xff;
                found = true;
              }
            }
            wordsRemaining = program.length - pc;
            break;
          }
          case DsaCommand.EQUAL: {
            let relState = signExtend((word >> 6) & 0x3ff, 10);
            if (relState === -512) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            const v1 = bank.stack.pop();
            const v2 = bank.stack.pop();
            bank.stack.push(v1 === v2 ? 1 : 0);
            nextState = curState + relState;
            break;
          }
          case DsaCommand.LOAD: {
            let relState = signExtend((word >> 11) & 0x1f, 5);
            if (relState === -16) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const where = (word >> 6) & 0x1f;
            if (where === 26) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              bank.stack.push(readSignedWord(next));
            } else if (where === 27) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              bank.stack.push(next);
            } else if (where === 28) {
              bank.stack.push(locationToInt(exPkt.locrMaster));
            } else if (where === 30) {
              const lo = program[pc++] ?? 0;
              const hi = program[pc++] ?? 0;
              wordsRemaining -= 2;
              bank.stack.push((hi << 16) | lo);
            } else if (where <= 25) {
              const value = this.loadParameter(where, exPkt.rnMaster);
              bank.stack.push(value);
            } else {
              bank.stack.push(0);
            }
            break;
          }
          case DsaCommand.STORE: {
            let relState = signExtend((word >> 11) & 0x1f, 5);
            if (relState === -16) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const where = (word >> 6) & 0x1f;
            if (where <= 25) {
              this.storeParameter(where, exPkt.rnMaster, bank.stack.pop());
            } else {
              bank.stack.pop();
            }
            break;
          }
          case DsaCommand.VARIABLESTORE: {
            let relState = signExtend((word >> 13) & 0x7, 3);
            if (relState === -4) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const index = (word >> 6) & 0x7f;
            bank.setVar(index, bank.stack.pop());
            break;
          }
          case DsaCommand.VARIABLEFETCH: {
            let relState = signExtend((word >> 13) & 0x7, 3);
            if (relState === -4) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const index = (word >> 6) & 0x7f;
            bank.stack.push(bank.getVar(index));
            break;
          }
          case DsaCommand.GLOBALSTORE: {
            let relState = signExtend((word >> 13) & 0x7, 3);
            if (relState === -4) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const index = (word >> 6) & 0x7f;
            const value = bank.stack.pop();
            if (index >= 0 && index < this.globalVariables.length) {
              this.globalVariables[index] = value;
            }
            break;
          }
          case DsaCommand.GLOBALFETCH: {
            let relState = signExtend((word >> 13) & 0x7, 3);
            if (relState === -4) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const index = (word >> 6) & 0x7f;
            const value = index >= 0 && index < this.globalVariables.length ? this.globalVariables[index] : 0;
            bank.stack.push(value);
            break;
          }
          case DsaCommand.FETCH: {
            let relState = signExtend((word >> 6) & 0x3ff, 10);
            if (relState === -512) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const objMask = bank.stack.pop();
            const posMask = bank.stack.pop();
            const location = bank.stack.pop();
            let depth = bank.stack.pop();
            const locr = intToLocation(location);
            if (!this.isValidLocation(locr)) {
              bank.stack.push(-1);
              break;
            }
            let positionMask = posMask;
            if (positionMask === -1) positionMask = 1 << locr.p;
            let result = -1;
            const pos = new Position(locr.x, locr.y, locr.l);
            for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
              const decoded = decodeObjectID(rn);
              if (((1 << (decoded.position & 3)) & positionMask) === 0) continue;
              if (((1 << decoded.category) & objMask) === 0) continue;
              if (depth === 0) {
                result = rn;
                break;
              }
              depth -= 1;
            }
            bank.stack.push(result);
            break;
          }
          case DsaCommand.AMPERSAND:
          case DsaCommand.AMPERSAND2: {
            let relState = signExtend((word >> 13) & 0x7, 3);
            if (relState === -4) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const subcode = ((word >> 6) & 0x7f) + (opcode === DsaCommand.AMPERSAND2 ? 128 : 0);
            this.executeAmpersand(subcode, bank);
            break;
          }
          case DsaCommand.OVERRIDE: {
            let relState = signExtend((word >> 12) & 0xf, 4);
            if (relState === -8) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const what = (word >> 6) & 0x7;
            const value = (word >> 9) & 0x7;
            if (what === 1) {
              this.overrideP = true;
              this.overridePos = value;
              if (value === 7) {
                const next = program[pc++] ?? 0;
                wordsRemaining--;
                this.overridePos = next & 0xff;
              }
            }
            break;
          }
          default:
            if (!this.warnedOps.has(opcode)) {
              this.warnedOps.add(opcode);
              console.warn('Unimplemented DSA opcode', opcode);
            }
            break;
        }

        if (transferState >= 0) break;
        if (finalState === -1 && nextState >= 0) finalState = nextState;
      }

      if (nextState >= 0 && finalState === -1) finalState = nextState;
      curState = transferState;
      column = transferCol;
      transferState = -1;
      transferCol = -1;
    } while (curState >= 0);

    return finalState;
  }

  private executeAmpersand(subcode: number, bank: DsaBank): void {
    switch (subcode) {
      case StkOp.TWO_DROP:
        bank.stack.pop();
        bank.stack.pop();
        break;
      case StkOp.ONE_PLUS:
        bank.stack.push(bank.stack.pop() + 1);
        break;
      case StkOp.SWAP:
        bank.stack.roll(1);
        break;
      case StkOp.NEG:
        bank.stack.push(-bank.stack.pop());
        break;
      case StkOp.COMP:
        bank.stack.push(~bank.stack.pop());
        break;
      case StkOp.DUP: {
        const v = bank.stack.pop();
        bank.stack.push(v);
        bank.stack.push(v);
        break;
      }
      case StkOp.DEL: {
        const location = bank.stack.pop();
        const objId = bank.stack.pop();
        if (location < 0) {
          const removed = this.deleteFromNegativeLocation(location);
          if (removed !== null && removed !== undefined) {
            this.deleteLinkedScrollText(removed);
            this.dungeon.deleteDBEntry(removed);
          }
          break;
        }
        const locr = intToLocation(location);
        if (!this.isValidLocation(locr)) {
          console.warn('Illegal location in DSA &DEL');
          break;
        }
        const pos = new Position(locr.x, locr.y, locr.l);
        for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
          if (rn !== objId) continue;
          const { category } = decodeObjectID(rn);
          if (!this.canDeleteFromCell(category)) break;
          this.dungeon.removeObjectFromCell(pos, rn);
          this.triggerObjectMove(pos, rn, false, false);
          this.deleteLinkedScrollText(rn);
          this.dungeon.deleteDBEntry(rn);
          break;
        }
        break;
      }
      case StkOp.ADD: {
        const objId = bank.stack.pop();
        const location = bank.stack.pop();
        const posMask = bank.stack.pop() & 0xf;
        if (!this.canAddToLocation(location)) break;
        if (!this.isValidObjectId(objId)) break;
        const cloned = this.copyItem(objId);
        bank.mostRecentInterestingObjectID = cloned ?? OBJECT_ID_EOF;
        if (cloned === null) break;
        if (location >= 0) {
          const locr = intToLocation(location);
          if (!this.isValidLocation(locr)) break;
          const pos = this.choosePositionFromMask(posMask);
          const { category, index } = decodeObjectID(cloned);
          const placed = encodeObjectID(pos, category, index);
          this.triggerObjectMove(new Position(locr.x, locr.y, locr.l), placed, true, false);
          this.dungeon.addObjectToCell(new Position(locr.x, locr.y, locr.l), placed);
        } else if (location === -1) {
          const party = this.getPartyState?.();
          if (!party) break;
          party.objectInHand = cloned;
        } else if (location > -1000) {
          const party = this.getPartyState?.();
          if (!party) break;
          const loc = this.decodeCharacterLocation(location);
          if (!loc) break;
          const champ = this.getChampion(party, loc.chIdx);
          if (!champ) break;
          this.setChampionPossession(champ, loc.posIdx, cloned);
        } else {
          const monsterId = this.decodeMonsterLocation(location);
          if (monsterId === null) break;
          const monster = this.dungeon.getCreatureRecord(monsterId);
          if (!monster) break;
          this.addObjectToMonster(monsterId, cloned);
        }
        break;
      }
      case StkOp.OBJECT_ID:
        bank.stack.push(bank.mostRecentInterestingObjectID);
        break;
      case StkOp.TYPE:
        bank.stack.push(this.getTypeId(bank.stack.pop()));
        break;
      case StkOp.FETCH: {
        const idx = bank.stack.pop();
        bank.stack.push(bank.getVar(idx));
        break;
      }
      case StkOp.STORE: {
        const idx = bank.stack.pop();
        bank.setVar(idx, bank.stack.pop());
        break;
      }
      case StkOp.DROP:
        bank.stack.pop();
        break;
      case StkOp.FALSE_PIT: {
        const value = bank.stack.pop();
        const loc = bank.stack.pop();
        const locr = intToLocation(loc);
        if (!this.isValidLocation(locr)) break;
        const map = this.dungeon.getMap(locr.l);
        if (!map) break;
        const cellFlag = map.cellFlags[locr.x][locr.y];
        if (((cellFlag >> 5) & 0x7) !== RoomType.PIT) break;
        const next = value !== 0 ? (cellFlag | 0x01) : (cellFlag & 0xfe);
        this.updateCellFlag(locr, next);
        break;
      }
      case StkOp.GENERATOR_DELAY_STORE: {
        const location = bank.stack.pop();
        const delay = bank.stack.pop();
        const locr = intToLocation(location);
        if (!this.isValidLocation(locr)) break;
        const map = this.dungeon.getMap(locr.l);
        if (!map) break;
        const cellFlag = map.cellFlags[locr.x][locr.y];
        if (((cellFlag >> 5) & 0x7) === RoomType.STONE) break;
        let firstDisabled: number | null = null;
        const pos = new Position(locr.x, locr.y, locr.l);
        for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
          const decoded = decodeObjectID(rn);
          if (decoded.category !== DBType.ACTUATOR) continue;
          const rec = this.dungeon.getActuatorRecord(rn);
          if (!rec) continue;
          const type = getActuatorType(rec);
          if (type === 6) {
            setActuatorDisableTime(rec, delay);
            return;
          }
          if (type === 0 && firstDisabled === null) {
            firstDisabled = rn;
          }
        }
        if (firstDisabled !== null) {
          const rec = this.dungeon.getActuatorRecord(firstDisabled);
          if (rec) setActuatorDisableTime(rec, delay);
        }
        break;
      }
      case StkOp.DESCRIBE: {
        const color = bank.stack.pop();
        const index = bank.stack.pop();
        let locrInt = bank.stack.pop();
        if (this.overrideP) {
          this.overrideP = false;
          if (locrInt >= 0) {
            const locr = intToLocation(locrInt);
            locr.p = this.overridePos & 0x3;
            locrInt = locationToInt(locr);
          }
        }
        this.modifyDescription(locrInt, index, color);
        break;
      }
      case StkOp.PLUS:
        bank.stack.push(bank.stack.pop() + bank.stack.pop());
        break;
      case StkOp.GEAR:
        bank.stack.push(bank.stack.pop() * bank.stack.pop());
        break;
      case StkOp.ONE_MINUS:
        bank.stack.push(bank.stack.pop() - 1);
        break;
      case StkOp.ROLL:
        bank.stack.roll(bank.stack.pop());
        break;
      case StkOp.ROT:
        bank.stack.roll(2);
        break;
      case StkOp.MINUS_ROLL:
        bank.stack.minusRoll(bank.stack.pop());
        break;
      case StkOp.MINUS_ROT:
        bank.stack.minusRoll(2);
        break;
      case StkOp.PICK:
        bank.stack.pick(bank.stack.pop());
        break;
      case StkOp.TWO_PICK:
        bank.stack.pick(2);
        break;
      case StkOp.OVER:
        bank.stack.pick(1);
        break;
      case StkOp.POKE:
        bank.stack.poke(bank.stack.pop());
        break;
      case StkOp.EQUAL:
        bank.stack.push(bank.stack.pop() === bank.stack.pop() ? 1 : 0);
        break;
      case StkOp.NOT_EQUAL:
        bank.stack.push(bank.stack.pop() === bank.stack.pop() ? 0 : 1);
        break;
      case StkOp.NOT:
        bank.stack.push(bank.stack.pop() === 0 ? 1 : 0);
        break;
      case StkOp.AND:
        bank.stack.push(bank.stack.pop() & bank.stack.pop());
        break;
      case StkOp.XOR:
        bank.stack.push(bank.stack.pop() ^ bank.stack.pop());
        break;
      case StkOp.OR:
        bank.stack.push(bank.stack.pop() | bank.stack.pop());
        break;
      case StkOp.SHIFT: {
        const v = bank.stack.pop();
        const w = bank.stack.pop();
        bank.stack.push(v >= 0 ? (w << (v & 31)) : (w >> ((-v) & 31)));
        break;
      }
      case StkOp.RSHIFT: {
        const v = bank.stack.pop();
        const w = bank.stack.pop();
        bank.stack.push(v >= 0 ? (w >> (v & 31)) : (w << ((-v) & 31)));
        break;
      }
      case StkOp.LESS: {
        const v = bank.stack.pop();
        const w = bank.stack.pop();
        bank.stack.push(w < v ? 1 : 0);
        break;
      }
      case StkOp.ULESS: {
        const v = bank.stack.pop() >>> 0;
        const w = bank.stack.pop() >>> 0;
        bank.stack.push(w < v ? 1 : 0);
        break;
      }
      case StkOp.SLASH: {
        const v = bank.stack.pop();
        const w = bank.stack.pop();
        bank.stack.push(v === 0 ? 0 : Math.trunc(w / v));
        break;
      }
      case StkOp.PERCENT: {
        const v = bank.stack.pop();
        const w = bank.stack.pop();
        bank.stack.push(v === 0 ? 0 : w % v);
        break;
      }
      case StkOp.RANDOM: {
        let v = bank.stack.pop();
        if (v === 0) v = 1;
        const result = Math.floor(Math.random() * v);
        bank.stack.push(result);
        break;
      }
      case StkOp.COPY: {
        const dstId = bank.stack.pop();
        const srcId = bank.stack.pop();
        if (!this.isValidObjectId(srcId) || !this.isValidObjectId(dstId)) break;
        const srcDecoded = decodeObjectID(srcId);
        const dstDecoded = decodeObjectID(dstId);
        if (srcDecoded.category !== dstDecoded.category) break;
        if (srcDecoded.category === DBType.ACTUATOR) {
          const src = this.dungeon.getActuatorRecord(srcId);
          const dst = this.dungeon.getActuatorRecord(dstId);
          if (!src || !dst) break;
          dst.word2 = src.word2;
          dst.word4 = src.word4;
          dst.word6 = src.word6;
        }
        break;
      }
      case StkOp.MOVE: {
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
        this.moveObjectDsa(
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
        break;
      }
      case StkOp.TIME_FETCH:
        bank.stack.push(this.getTime());
        break;
      case StkOp.GENERATOR_DELAY_FETCH: {
        const loc = bank.stack.pop();
        const locr = intToLocation(loc);
        if (!this.isValidLocation(locr)) {
          bank.stack.push(-1);
          break;
        }
        const map = this.dungeon.getMap(locr.l);
        if (!map) {
          bank.stack.push(-1);
          break;
        }
        if (((map.cellFlags[locr.x][locr.y] >> 5) & 0x7) === RoomType.STONE) {
          bank.stack.push(-1);
          break;
        }
        const pos = new Position(locr.x, locr.y, locr.l);
        let found: number | null = null;
        for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
          const decoded = decodeObjectID(rn);
          if (decoded.category !== DBType.ACTUATOR) continue;
          const rec = this.dungeon.getActuatorRecord(rn);
          if (!rec) continue;
          if (getActuatorType(rec) === 6) {
            found = rn;
            break;
          }
        }
        if (found === null) {
          bank.stack.push(-1);
          break;
        }
        const rec = this.dungeon.getActuatorRecord(found);
        bank.stack.push(rec ? getActuatorDisableTime(rec) : -1);
        break;
      }
      case StkOp.SET_NEW_STATE:
        bank.forceState = bank.stack.pop();
        break;
      case StkOp.PARAM_FETCH: {
        const index = bank.stack.pop();
        const count = bank.stack.pop();
        let n = count;
        if (n > 100) n = 100;
        const paramCount = this.parameters[0] ?? 0;
        if (n > paramCount) {
          for (let j = paramCount; j < n; j++) {
            bank.setVar(index + j, 0);
            bank.setVarState(index + j, DsaVarType.NonParameter);
          }
          n = paramCount;
        }
        for (let j = 0; j < n; j++) {
          bank.setVar(index + j, this.parameters[1 + j] ?? 0);
        }
        break;
      }
      case StkOp.PARAM_STORE: {
        const index = bank.stack.pop();
        const count = bank.stack.pop();
        let n = count;
        if (n > 100) n = 100;
        for (let j = 0; j < n; j++) {
          if (bank.getVarState(index + j) !== DsaVarType.NonParameter) {
            this.parameters[1 + j] = bank.getVar(index + j);
          }
        }
        break;
      }
      case StkOp.CELL_FETCH: {
        const arraySize = bank.stack.pop();
        const arrayIndex = bank.stack.pop();
        if (arrayIndex < 0 || arrayIndex + arraySize > 100) break;
        for (let i = 0; i < arraySize; i++) {
          bank.setVar(arrayIndex + i, 0);
        }
        const loc = bank.stack.pop();
        const locr = intToLocation(loc);
        if (!this.isValidLocation(locr)) break;
        const map = this.dungeon.getMap(locr.l);
        if (!map) break;
        const cellFlag = map.cellFlags[locr.x][locr.y];
        const roomType = (cellFlag >> 5) & 0x7;
        if (arraySize === 0) break;
        bank.setVar(arrayIndex, roomType);
        if (arraySize < 2) break;
        switch (roomType) {
          case RoomType.STONE:
            if (cellFlag & 0x8) bank.setVarBit(arrayIndex + 1, 0x01);
            if (cellFlag & 0x4) bank.setVarBit(arrayIndex + 1, 0x02);
            if (cellFlag & 0x2) bank.setVarBit(arrayIndex + 1, 0x04);
            if (cellFlag & 0x1) bank.setVarBit(arrayIndex + 1, 0x08);
            break;
          case RoomType.OPEN:
            if (cellFlag & 0x08) bank.setVarBit(arrayIndex + 1, 0x01);
            break;
          case RoomType.TELEPORTER: {
            if (cellFlag & 0x08) bank.setVarBit(arrayIndex + 1, 0x08);
            if (cellFlag & 0x04) bank.setVarBit(arrayIndex + 1, 0x04);
            if (arraySize < 3) break;
            const tp = this.getFirstTeleporterRecord(new Position(locr.x, locr.y, locr.l));
            if (!tp) break;
            bank.setVar(arrayIndex + 2, (tp.rotation & 0x3) | ((tp.absoluteRotation ? 1 : 0) << 2));
            if (arraySize < 4) break;
            bank.setVar(arrayIndex + 3, tp.scope & 0x3);
            if (arraySize < 5) break;
            const destLoc = locationToInt({
              l: tp.destMap & 0x3f,
              x: tp.destX & 0x1f,
              y: tp.destY & 0x1f,
              p: 0,
            });
            bank.setVar(arrayIndex + 4, destLoc);
            break;
          }
          case RoomType.STAIRS:
            if (cellFlag & 0x04) bank.setVarBit(arrayIndex + 1, 0x04);
            if (cellFlag & 0x08) bank.setVarBit(arrayIndex + 1, 0x08);
            break;
          case RoomType.PIT:
            if (cellFlag & 0x01) bank.setVarBit(arrayIndex + 1, 0x01);
            if (cellFlag & 0x04) bank.setVarBit(arrayIndex + 1, 0x04);
            if (cellFlag & 0x08) bank.setVarBit(arrayIndex + 1, 0x08);
            break;
          case RoomType.FALSEWALL:
            if (cellFlag & 0x01) bank.setVarBit(arrayIndex + 1, 0x01);
            if (cellFlag & 0x04) bank.setVarBit(arrayIndex + 1, 0x04);
            break;
          case RoomType.DOOR: {
            const door = this.getFirstDoorRecord(new Position(locr.x, locr.y, locr.l));
            if (!door) break;
            if (cellFlag & 0x04) bank.setVarBit(arrayIndex + 1, 0x01);
            if (door.vertical) bank.setVarBit(arrayIndex + 1, 0x02);
            if (door.hasButton) bank.setVarBit(arrayIndex + 1, 0x04);
            if (door.destructibleByFireball) bank.setVarBit(arrayIndex + 1, 0x08);
            if (door.destructibleByChop) bank.setVarBit(arrayIndex + 1, 0x10);
            if (arraySize < 3) break;
            bank.setVar(arrayIndex + 2, cellFlag & 0x7);
            if (arraySize < 4) break;
            bank.setVar(arrayIndex + 3, door.doorType & 0x1);
            if (arraySize < 5) break;
            bank.setVar(arrayIndex + 4, door.ornateNumber & 0xf);
            break;
          }
          default:
            break;
        }
        break;
      }
      case StkOp.CELL_STORE: {
        const arraySize = bank.stack.pop();
        const arrayIndex = bank.stack.pop();
        const loc = bank.stack.pop();
        const locr = intToLocation(loc);
        if (!this.isValidLocation(locr)) break;
        if (arrayIndex < 0 || arrayIndex + arraySize > 100) break;
        const map = this.dungeon.getMap(locr.l);
        if (!map) break;
        let cellFlag = map.cellFlags[locr.x][locr.y];
        const roomType = (cellFlag >> 5) & 0x7;
        if (arraySize === 0) break;
        if (bank.getVar(arrayIndex) !== roomType) break;
        if (arraySize < 2) break;
        switch (roomType) {
          case RoomType.STONE: {
            cellFlag &= 0xe0;
            if (bank.getVar(arrayIndex + 1) & 0x01) cellFlag |= 0x8;
            if (bank.getVar(arrayIndex + 1) & 0x02) cellFlag |= 0x4;
            if (bank.getVar(arrayIndex + 1) & 0x04) cellFlag |= 0x2;
            if (bank.getVar(arrayIndex + 1) & 0x08) cellFlag |= 0x1;
            break;
          }
          case RoomType.OPEN:
            cellFlag &= 0xf7;
            if (bank.getVar(arrayIndex + 1) & 0x01) cellFlag |= 0x08;
            break;
          case RoomType.TELEPORTER: {
            const tp = this.getFirstTeleporterRecord(new Position(locr.x, locr.y, locr.l));
            if (!tp) break;
            if (bank.getVar(arrayIndex + 1) & 0x08) cellFlag |= 0x08;
            else cellFlag &= 0xf7;
            if (bank.getVar(arrayIndex + 1) & 0x04) cellFlag |= 0x04;
            else cellFlag &= 0xfb;
            if (arraySize < 3) break;
            tp.rotation = bank.getVar(arrayIndex + 2) & 0x3;
            tp.absoluteRotation = ((bank.getVar(arrayIndex + 2) >> 2) & 0x1) !== 0;
            if (arraySize < 4) break;
            tp.scope = bank.getVar(arrayIndex + 3) & 0x3;
            break;
          }
          case RoomType.PIT:
            cellFlag &= 0xf2;
            if (bank.getVar(arrayIndex + 1) & 0x01) cellFlag |= 0x01;
            if (bank.getVar(arrayIndex + 1) & 0x04) cellFlag |= 0x04;
            if (bank.getVar(arrayIndex + 1) & 0x08) cellFlag |= 0x08;
            break;
          case RoomType.FALSEWALL:
            cellFlag &= 0xfa;
            if (bank.getVar(arrayIndex + 1) & 0x01) cellFlag |= 0x01;
            if (bank.getVar(arrayIndex + 1) & 0x04) cellFlag |= 0x04;
            break;
          case RoomType.DOOR: {
            const door = this.getFirstDoorRecord(new Position(locr.x, locr.y, locr.l));
            if (!door) break;
            door.vertical = (bank.getVar(arrayIndex + 1) & 0x02) !== 0;
            door.hasButton = (bank.getVar(arrayIndex + 1) & 0x04) !== 0;
            door.destructibleByFireball = (bank.getVar(arrayIndex + 1) & 0x08) !== 0;
            door.destructibleByChop = (bank.getVar(arrayIndex + 1) & 0x10) !== 0;
            if (arraySize < 3) break;
            let oldState = cellFlag & 0x7;
            const newState = bank.getVar(arrayIndex + 2) & 0x7;
            if (oldState === 5) {
              if (newState === 0) oldState = newState;
            } else if (oldState === 4) {
              if (newState === 5) oldState = newState;
            }
            cellFlag = (cellFlag & ~0x7) | oldState;
            if (arraySize < 4) break;
            door.doorType = bank.getVar(arrayIndex + 3) & 0x1;
            if (arraySize < 5) break;
            door.ornateNumber = bank.getVar(arrayIndex + 4) & 0xf;
            break;
          }
          default:
            break;
        }
        this.updateCellFlag(locr, cellFlag);
        break;
      }
      case StkOp.GLOBAL_FETCH: {
        const which = bank.stack.pop();
        let result = 0;
        if (which === 1 && this.getPartyState) {
          const party = this.getPartyState();
          result = locationToInt({
            l: party.position.z,
            x: party.position.x,
            y: party.position.y,
            p: party.facing & 3,
          });
        }
        bank.stack.push(result);
        break;
      }
      case StkOp.MODIFY_MESSAGE: {
        const s = bank.stack.pop() & 0x3;
        const c = bank.stack.pop() & 0x3;
        const t = bank.stack.pop() & 0x3;
        this.timerTypeModifier[0] = s;
        this.timerTypeModifier[1] = c;
        this.timerTypeModifier[2] = t;
        break;
      }
      case StkOp.NUM_PARAM:
        bank.stack.push(this.parameters[0] ?? 0);
        break;
      default:
        if (!this.warnedOps.has(subcode)) {
          this.warnedOps.add(subcode);
          console.warn('Unimplemented DSA & opcode', subcode);
        }
        break;
    }
  }

  private getDsa(index: number): DsaDefinition | null {
    const dsaIndex = this.dungeon.getData().dsaIndex;
    if (!dsaIndex) return null;
    return dsaIndex.entries[index] ?? null;
  }

  private getDsaState(dsa: DsaDefinition, state: number): DsaState | null {
    return dsa.states[state] ?? null;
  }

  private getProgramForColumn(state: DsaState, column: number): Uint16Array | null {
    for (const action of state.actions) {
      if (action.column === column) return action.program;
    }
    return null;
  }

  private getAbsDsaIndex(level: number, selector: number): number | null {
    const idx = this.dungeon.getDsaLevelIndex(level, selector);
    if (idx === null || idx === undefined) return null;
    if (idx > 255) return null;
    return idx;
  }

  private findMaster(slave: DsaDefinition, rnSlave: number, x: number, y: number, locrSlave: DsaLocation): {
    rn: number;
    locr: DsaLocation;
  } {
    if (slave.localState !== 3) {
      return { rn: rnSlave, locr: { l: locrSlave.l, x, y, p: locrSlave.p } };
    }
    console.warn('Slave DSA not implemented');
    return { rn: rnSlave, locr: { l: locrSlave.l, x, y, p: locrSlave.p } };
  }

  private getState(rec: ActuatorRecord, dsa: DsaDefinition): number {
    switch (dsa.localState) {
      case 0:
        return getActuatorDsaState(rec);
      case 1:
        return dsa.state;
      case 2:
        return getActuatorParameterB(rec);
      default:
        console.warn('Illegal DSA localState', dsa.localState);
        return 0;
    }
  }

  private putState(rec: ActuatorRecord, dsa: DsaDefinition, state: number): void {
    switch (dsa.localState) {
      case 0:
        setActuatorDsaState(rec, state);
        break;
      case 1:
        dsa.state = state;
        break;
      case 2:
        setActuatorParameterB(rec, state);
        break;
      default:
        console.warn('Illegal DSA localState', dsa.localState);
        break;
    }
  }

  private getTarget(
    targetType: number,
    thirtyTwo: boolean,
    readWord: () => number,
    bank: DsaBank,
    rnMaster: number,
  ): DsaLocation | null {
    let target = 0;
    switch (targetType) {
      case TargetType.A: {
        const rec = this.getActuator(rnMaster);
        target = rec ? getActuatorParameterA(rec) : 0;
        break;
      }
      case TargetType.B: {
        const rec = this.getActuator(rnMaster);
        target = rec ? getActuatorParameterB(rec) : 0;
        break;
      }
      case TargetType.ABS: {
        target = readWord();
        if (thirtyTwo) {
          target |= (readWord() << 16) >>> 0;
        }
        break;
      }
      case TargetType.GEAR:
        target = bank.stack.pop();
        break;
      default:
        return null;
    }
    const locr = intToLocation(target);
    if (this.overrideP) {
      locr.p = this.overridePos & 3;
      this.overrideP = false;
    }
    return locr;
  }

  private queueDsaSwitchAction(delay: number, action: number, locr: DsaLocation, morD: 'M' | 'D'): void {
    const actionTime = (this.getTime() + delay) >>> 0;
    let functionType = TimerFunction.TT_DESSAGE;

    if (morD === 'M') {
      const map = this.dungeon.getMap(locr.l);
      if (!map) return;
      const cellFlag = map.cellFlags[locr.x]?.[locr.y];
      if (cellFlag === undefined) return;
      const roomType = (cellFlag >> 5) & 0x7;
      let targetPos = locr.p;
      if (roomType !== RoomType.STONE && roomType !== RoomType.FALSEWALL) {
        targetPos = 0;
      }
      const mapping = this.getRoomTimerFunction(roomType);
      if (mapping === 0) {
        console.warn('Illegal DSA timer target', { level: locr.l, x: locr.x, y: locr.y });
        return;
      }
      functionType = mapping;
      this.timers.createTimer(functionType, locr.x, locr.y, targetPos, action, actionTime, locr.l);
      return;
    }

    this.timers.createTimer(functionType, locr.x, locr.y, locr.p, action, actionTime, locr.l);
  }

  private getRoomTimerFunction(roomType: number): number {
    const table = this.roomTimerFunctions ?? DEFAULT_ROOM_TIMER_FUNCTIONS;
    return table[roomType] ?? 0;
  }

  private loadParameter(where: number, rnMaster: number): number {
    let rn = rnMaster;
    let slot = where;
    while (slot > 1) {
      rn = this.dungeon.getDBRecordLink(rn);
      if (rn === OBJECT_ID_EOF) break;
      const decoded = decodeObjectID(rn);
      if (decoded.category !== DBType.ACTUATOR) continue;
      const rec = this.getActuator(rn);
      if (!rec || getActuatorType(rec) !== 47) continue;
      slot -= 2;
    }
    if (rn === OBJECT_ID_EOF) return 0;
    const rec = this.getActuator(rn);
    if (!rec) return 0;
    return slot === 0 ? getActuatorParameterA(rec) : getActuatorParameterB(rec);
  }

  private storeParameter(where: number, rnMaster: number, value: number): void {
    let rn = rnMaster;
    let slot = where;
    while (slot > 1) {
      rn = this.dungeon.getDBRecordLink(rn);
      if (rn === OBJECT_ID_EOF) break;
      const decoded = decodeObjectID(rn);
      if (decoded.category !== DBType.ACTUATOR) continue;
      const rec = this.getActuator(rn);
      if (!rec || getActuatorType(rec) !== 47) continue;
      slot -= 2;
    }
    if (rn === OBJECT_ID_EOF) return;
    const rec = this.getActuator(rn);
    if (!rec) return;
    if (slot === 0) setActuatorParameterA(rec, value);
    else setActuatorParameterB(rec, value);
  }

  private copyTeleporter(src: DsaLocation, dst: DsaLocation): void {
    const srcPos = new Position(src.x, src.y, src.l);
    const dstPos = new Position(dst.x, dst.y, dst.l);
    const srcRn = this.findFirstTeleporter(srcPos);
    const dstRn = this.findFirstTeleporter(dstPos);
    if (srcRn === OBJECT_ID_EOF || dstRn === OBJECT_ID_EOF) return;
    const srcRec = this.dungeon.getTeleporterRecord(srcRn);
    const dstRec = this.dungeon.getTeleporterRecord(dstRn);
    if (!srcRec || !dstRec) return;
    dstRec.sound = srcRec.sound;
    dstRec.scope = srcRec.scope;
    dstRec.absoluteRotation = srcRec.absoluteRotation;
    dstRec.rotation = srcRec.rotation;
    dstRec.destX = srcRec.destX;
    dstRec.destY = srcRec.destY;
    dstRec.destMap = srcRec.destMap;
    const srcMap = this.dungeon.getMap(src.l);
    if (!srcMap) return;
    this.updateCellFlag(dst, srcMap.cellFlags[src.x][src.y]);
  }

  private findFirstTeleporter(position: Position): number {
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (decodeObjectID(rn).category === DBType.TELEPORTER) return rn;
    }
    return OBJECT_ID_EOF;
  }

  private findFirstDsaActuator(position: Position): number {
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (decodeObjectID(rn).category !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec) continue;
      if (getActuatorType(rec) === 47) return rn;
    }
    return OBJECT_ID_EOF;
  }

  private getFirstTeleporterRecord(position: Position): {
    sound: boolean;
    scope: number;
    absoluteRotation: boolean;
    rotation: number;
    destX: number;
    destY: number;
    destMap: number;
  } | null {
    const rn = this.findFirstTeleporter(position);
    if (rn === OBJECT_ID_EOF) return null;
    return this.dungeon.getTeleporterRecord(rn);
  }

  private getFirstDoorRecord(position: Position): {
    destructibleByChop: boolean;
    destructibleByFireball: boolean;
    hasButton: boolean;
    vertical: boolean;
    ornateNumber: number;
    doorType: number;
  } | null {
    const rn = this.dungeon.findFirstDoor(position);
    if (rn === OBJECT_ID_EOF) return null;
    const { index } = decodeObjectID(rn);
    return this.dungeon.getDoorRecordByIndex(index);
  }

  private updateCellFlag(locr: DsaLocation, cellFlag: number): void {
    const map = this.dungeon.getMap(locr.l);
    if (!map) return;
    if (locr.x < 0 || locr.y < 0) return;
    if (locr.x >= map.descriptor.width || locr.y >= map.descriptor.height) return;
    const next = cellFlag & 0xff;
    map.cellFlags[locr.x][locr.y] = next;
    const tile = map.tiles[locr.x]?.[locr.y];
    if (!tile) return;
    tile.cellFlag = next;
    tile.attributes = next & 0xf;
    tile.roomType = (next >> 5) & 0x7;
    tile.hasObjects = (next & 0x10) !== 0;
  }

  private modifyDescription(locrInt: number, index: number, color: number): void {
    const ctx = this.viewingFilterContext;
    if (!ctx) return;
    if (index < 0 || index > 7) return;
    ctx.phraseColorOverrides[index] = color | 0;
    if (locrInt === -1) {
      ctx.phraseMask |= 1 << index;
      ctx.modified = true;
      return;
    }
    if (locrInt === -2) {
      ctx.phraseMask &= ~(1 << index);
      ctx.modified = true;
      return;
    }
    if (locrInt < 0) return;
    const locr = intToLocation(locrInt);
    if (!this.isValidLocation(locr)) return;
    const record = this.findTextRecordAtLocation(locr);
    if (!record) return;
    const text = this.dungeon.decodeTextString(record, 0x8001, ctx.textTables);
    if (!text) return;
    ctx.phraseTextOverrides[index] = text;
    ctx.phraseMask |= 1 << index;
    ctx.modified = true;
  }

  private findTextRecordAtLocation(locr: DsaLocation): TextRecord | null {
    const pos = new Position(locr.x, locr.y, locr.l);
    for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category !== DBType.TEXT) continue;
      if ((decoded.position & 0x3) !== (locr.p & 0x3)) continue;
      return this.dungeon.getTextRecord(rn);
    }
    return null;
  }

  private isValidObjectId(objectId: number): boolean {
    if (objectId < 0) return false;
    if (objectId === OBJECT_ID_EOF || objectId === OBJECT_ID_NULL) return false;
    const { category, index } = decodeObjectID(objectId);
    const data = this.dungeon.getData().databases;
    switch (category) {
      case DBType.DOOR:
        return index >= 0 && index < data.doors.records.length;
      case DBType.TELEPORTER:
        return index >= 0 && index < data.teleporters.records.length;
      case DBType.TEXT:
        return index >= 0 && index < data.texts.records.length;
      case DBType.ACTUATOR:
        return index >= 0 && index < data.actuators.records.length;
      case DBType.CREATURE:
        return index >= 0 && index < data.creatures.records.length;
      case DBType.WEAPON:
        return index >= 0 && index < data.weapons.records.length;
      case DBType.CLOTHING:
        return index >= 0 && index < data.clothing.records.length;
      case DBType.SCROLL:
        return index >= 0 && index < data.scrolls.records.length;
      case DBType.POTION:
        return index >= 0 && index < data.potions.records.length;
      case DBType.CHEST:
        return index >= 0 && index < data.containers.records.length;
      case DBType.MISC:
        return index >= 0 && index < data.misc.records.length;
      case DBType.MISSILE:
        return index >= 0 && index < data.missiles.records.length;
      case DBType.CLOUD:
        return index >= 0 && index < data.clouds.records.length;
      default:
        return false;
    }
  }

  private canDeleteFromCell(category: DBType): boolean {
    return (
      category === DBType.ACTUATOR ||
      category === DBType.MISC ||
      category === DBType.POTION ||
      category === DBType.WEAPON ||
      category === DBType.CLOTHING
    );
  }

  private deleteFromNegativeLocation(location: number): number | null {
    const party = this.getPartyState?.();
    if (!party) return null;
    if (location === -1) {
      if (this.isEmptyObject(party.objectInHand ?? null)) return null;
      const removed = party.objectInHand ?? null;
      party.objectInHand = null;
      return removed;
    }
    const loc = this.decodeCharacterLocation(location);
    if (!loc) return null;
    const champ = this.getChampion(party, loc.chIdx);
    if (!champ) return null;
    const possessions = champ.possessions ?? [];
    if (loc.posIdx < 0 || loc.posIdx >= possessions.length) return null;
    if (this.isEmptyObject(possessions[loc.posIdx])) return null;
    const removed = possessions[loc.posIdx] ?? null;
    this.setChampionPossession(champ, loc.posIdx, null);
    return removed;
  }

  private deleteLinkedScrollText(rn: number): void {
    if (!this.isValidObjectId(rn)) return;
    const { category } = decodeObjectID(rn);
    if (category !== DBType.SCROLL) return;
    const scroll = this.dungeon.getScrollRecord(rn);
    if (!scroll) return;
    const raw = scroll.textReference & 0xffff;
    const decoded = decodeObjectID(raw as ObjectID);
    const textRn = decoded.category === DBType.TEXT
      ? (raw as ObjectID)
      : encodeObjectID(0, DBType.TEXT, raw & 0x3ff);
    this.dungeon.deleteDBEntry(textRn);
  }

  private triggerObjectMove(position: Position, object: number, place: boolean, unchangedRoom: boolean): void {
    if (!this.actuators) return;
    this.actuators.triggerObjectMove(position, object as ObjectID, place, unchangedRoom, 0);
  }

  private canAddToLocation(location: number): boolean {
    if (location >= 0) {
      const locr = intToLocation(location);
      return this.isValidLocation(locr);
    }
    const party = this.getPartyState?.();
    if (!party) return false;
    if (location === -1) {
      return this.isEmptyObject(party.objectInHand ?? null);
    }
    if (location > -1000) {
      const loc = this.decodeCharacterLocation(location);
      if (!loc) return false;
      const champ = this.getChampion(party, loc.chIdx);
      if (!champ) return false;
      const possessions = champ.possessions ?? [];
      if (loc.posIdx < 0 || loc.posIdx >= 30) return false;
      return this.isEmptyObject(possessions[loc.posIdx]);
    }
    const monsterId = this.decodeMonsterLocation(location);
    if (monsterId === null) return false;
    return this.dungeon.getCreatureRecord(monsterId) !== null;
  }

  private decodeCharacterLocation(location: number): { chIdx: number; posIdx: number } | null {
    if (location >= -1 || location <= -1000) return null;
    const value = -location;
    const chIdx = Math.floor(value / 100) - 1;
    const posIdx = value % 100;
    if (chIdx < 0 || posIdx < 0) return null;
    return { chIdx, posIdx };
  }

  private decodeMonsterLocation(location: number): number | null {
    if (location > -1000) return null;
    const monsterId = Math.trunc(-location / 1000);
    if (!this.isValidObjectId(monsterId)) return null;
    const decoded = decodeObjectID(monsterId);
    if (decoded.category !== DBType.CREATURE) return null;
    return monsterId;
  }

  private getChampion(party: PartyState, index: number): Champion | null {
    if (index < 0 || index >= party.champions.length) return null;
    return party.champions[index] ?? null;
  }

  private setChampionPossession(champion: Champion, slot: number, objectId: number | null): void {
    if (slot < 0 || slot >= 30) return;
    const next = this.normalizePossessionValue(objectId);
    if (!champion.possessions || champion.possessions.length < 30) {
      const slots = new Array(30).fill(null) as Array<number | null>;
      if (champion.possessions) {
        for (let i = 0; i < champion.possessions.length && i < slots.length; i++) {
          slots[i] = this.normalizePossessionValue(champion.possessions[i]);
        }
      }
      champion.possessions = slots;
    }
    champion.possessions[slot] = next;
    if (slot === 0) champion.shieldHand = next;
    if (slot === 1) champion.weaponHand = next;
    if (slot === 8) champion.quiver = next;
  }

  private normalizePossessionValue(value: number | null | undefined): number | null {
    if (value === undefined || value === null) return null;
    if (value === OBJECT_ID_EOF || value === OBJECT_ID_NULL) return null;
    return value;
  }

  private isEmptyObject(value: number | null | undefined): boolean {
    return this.normalizePossessionValue(value) === null;
  }

  private addObjectToMonster(monsterId: number, objectId: number): void {
    const monster = this.dungeon.getCreatureRecord(monsterId);
    if (!monster) return;
    let head = monster.possession;
    if (head === OBJECT_ID_EOF || head === OBJECT_ID_NULL) {
      monster.possession = objectId;
      this.dungeon.setDBRecordLink(objectId, OBJECT_ID_EOF);
      return;
    }
    let current = head;
    for (;;) {
      const next = this.dungeon.getDBRecordLink(current);
      if (next === OBJECT_ID_EOF) break;
      current = next;
    }
    this.dungeon.setDBRecordLink(current, objectId);
    this.dungeon.setDBRecordLink(objectId, OBJECT_ID_EOF);
  }

  private moveObjectDsa(
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
    const sourceCheck = this.checkSource(
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
    const destCheck = this.checkDestination(
      dstType,
      dstObjMsk,
      dstPosMsk,
      dstLoc,
      dstDepth,
      sourceCheck.object,
      srcType,
      srcLoc,
      false,
    );
    if (destCheck !== 0) return destCheck;
    const sourceMove = this.checkSource(
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
    const destMove = this.checkDestination(
      dstType,
      dstObjMsk,
      dstPosMsk,
      dstLoc,
      dstDepth,
      sourceMove.object,
      srcType,
      srcLoc,
      true,
    );
    return destMove;
  }

  private checkSource(
    srcType: number,
    srcObjMsk: number,
    srcPosMsk: number,
    srcLoc: number,
    srcDepth: number,
    dstType: number,
    dstLoc: number,
    doit: boolean,
  ): { error: number; object: number } {
    switch (srcType) {
      case 2:
        return this.findCursorSource(doit);
      case 4:
        return this.findCharacterSource(srcPosMsk, srcLoc, doit);
      case 1:
        return this.findCellSource(srcObjMsk, srcPosMsk, srcLoc, srcDepth, dstType, dstLoc, doit);
      case 3:
        return this.findMonsterSource(srcObjMsk, srcLoc, srcDepth, doit);
      case 5:
        return this.findChestSource(srcObjMsk, srcLoc, srcDepth, doit);
      default:
        return { error: DsaMoveError.SER_UnknownLocType, object: OBJECT_ID_EOF };
    }
  }

  private checkDestination(
    dstType: number,
    dstObjMsk: number,
    dstPosMsk: number,
    dstLoc: number,
    dstDepth: number,
    object: number,
    srcType: number,
    srcLoc: number,
    doit: boolean,
  ): number {
    switch (dstType) {
      case 4:
        return this.findCharacterDestination(dstPosMsk, dstLoc, object, doit);
      case 2:
        return this.checkObjectToCursor(object, doit);
      case 1:
        return this.findCellDestination(dstObjMsk, dstPosMsk, dstLoc, dstDepth, object, srcType, srcLoc, doit);
      case 5:
        return this.findChestDestination(dstLoc, dstDepth, object, doit);
      case 3:
        return this.findMonsterDestination(dstLoc, dstDepth, object, doit);
      default:
        return DsaMoveError.DER_UnknownLocType;
    }
  }

  private findCursorSource(doit: boolean): { error: number; object: number } {
    const party = this.getPartyState?.();
    if (!party) return { error: DsaMoveError.SER_NoObjInCursor, object: OBJECT_ID_EOF };
    const obj = this.normalizePossessionValue(party.objectInHand);
    if (obj === null) return { error: DsaMoveError.SER_NoObjInCursor, object: OBJECT_ID_EOF };
    if (doit) party.objectInHand = null;
    return { error: DsaMoveError.SER_OK, object: obj };
  }

  private findCharacterSource(chIdx: number, carryLoc: number, doit: boolean): { error: number; object: number } {
    const party = this.getPartyState?.();
    if (!party) return { error: DsaMoveError.SER_IllegalCharacterIndex, object: OBJECT_ID_EOF };
    if (chIdx < 0 || chIdx >= party.champions.length) {
      return { error: DsaMoveError.SER_IllegalCharacterIndex, object: OBJECT_ID_EOF };
    }
    if (carryLoc < 0 || carryLoc > 29) {
      return { error: DsaMoveError.SER_IllegalCarryLocation, object: OBJECT_ID_EOF };
    }
    const champ = this.getChampion(party, chIdx);
    if (!champ) return { error: DsaMoveError.SER_IllegalCharacterIndex, object: OBJECT_ID_EOF };
    const possessions = champ.possessions ?? [];
    const obj = this.normalizePossessionValue(possessions[carryLoc]);
    if (obj === null) return { error: DsaMoveError.SER_NoObjectAtCarryLocation, object: OBJECT_ID_EOF };
    if (decodeObjectID(obj).category === DBType.CLOUD) {
      return { error: DsaMoveError.SER_NoCloudsPlease, object: OBJECT_ID_EOF };
    }
    if (doit) this.setChampionPossession(champ, carryLoc, null);
    return { error: DsaMoveError.SER_OK, object: obj };
  }

  private findCellSource(
    srcObjMsk: number,
    srcPosMsk: number,
    srcLoc: number,
    srcDepth: number,
    dstType: number,
    dstLoc: number,
    doit: boolean,
  ): { error: number; object: number } {
    const locr = intToLocation(srcLoc);
    if (!this.isValidLocation(locr)) {
      return { error: DsaMoveError.SER_InvalidCellLocation, object: OBJECT_ID_EOF };
    }
    let positionMask = srcPosMsk;
    if (positionMask === -1) positionMask = 1 << (locr.p & 3);
    let depth = srcDepth;
    const pos = new Position(locr.x, locr.y, locr.l);
    for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (((1 << decoded.position) & positionMask) === 0) continue;
      if (((1 << decoded.category) & srcObjMsk) === 0) continue;
      if (depth === 0) {
        if (decoded.category === DBType.CLOUD) {
          return { error: DsaMoveError.SER_NoCloudsPlease, object: OBJECT_ID_EOF };
        }
        if (doit) {
          this.dungeon.removeObjectFromCell(pos, rn);
          this.triggerObjectMove(pos, rn, false, dstType === 1 && dstLoc === srcLoc);
        }
        return { error: DsaMoveError.SER_OK, object: rn };
      }
      depth -= 1;
    }
    return { error: DsaMoveError.SER_NoSuchObjectInCell, object: OBJECT_ID_EOF };
  }

  private findMonsterSource(
    srcObjMsk: number,
    srcLoc: number,
    srcDepth: number,
    doit: boolean,
  ): { error: number; object: number } {
    if (!this.isValidObjectId(srcLoc)) {
      return { error: DsaMoveError.SER_IllegalMonsterID, object: OBJECT_ID_EOF };
    }
    const decodedMon = decodeObjectID(srcLoc);
    if (decodedMon.category !== DBType.CREATURE) {
      return { error: DsaMoveError.SER_MonsterIsNotMonster, object: OBJECT_ID_EOF };
    }
    const monster = this.dungeon.getCreatureRecord(srcLoc);
    if (!monster) return { error: DsaMoveError.SER_MonsterIsNotMonster, object: OBJECT_ID_EOF };
    let depth = srcDepth;
    let prev = OBJECT_ID_EOF;
    for (let rn = monster.possession; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (((1 << decoded.category) & srcObjMsk) === 0) {
        prev = rn;
        continue;
      }
      if (depth === 0) {
        if (decoded.category === DBType.CLOUD) {
          return { error: DsaMoveError.SER_NoCloudsPlease, object: OBJECT_ID_EOF };
        }
        if (doit) {
          const next = this.dungeon.getDBRecordLink(rn);
          if (prev === OBJECT_ID_EOF) monster.possession = next;
          else this.dungeon.setDBRecordLink(prev, next);
          this.dungeon.setDBRecordLink(rn, OBJECT_ID_EOF);
        }
        return { error: DsaMoveError.SER_OK, object: rn };
      }
      depth -= 1;
      prev = rn;
    }
    return { error: DsaMoveError.SER_NoSuchObjectOnMonster, object: OBJECT_ID_EOF };
  }

  private findChestSource(
    srcObjMsk: number,
    srcLoc: number,
    srcDepth: number,
    doit: boolean,
  ): { error: number; object: number } {
    if (!this.isValidObjectId(srcLoc)) {
      return { error: DsaMoveError.SER_IllegalChestID, object: OBJECT_ID_EOF };
    }
    const decodedChest = decodeObjectID(srcLoc);
    if (decodedChest.category !== DBType.CHEST) {
      return { error: DsaMoveError.SER_ChestIsNotChest, object: OBJECT_ID_EOF };
    }
    if (this.isObjectInCharactersOrCursor(srcLoc)) {
      return { error: DsaMoveError.SER_ChestBelongsToCharacter, object: OBJECT_ID_EOF };
    }
    const chest = this.dungeon.getContainerRecord(srcLoc);
    if (!chest) return { error: DsaMoveError.SER_ChestIsNotChest, object: OBJECT_ID_EOF };
    let depth = srcDepth;
    let prev = OBJECT_ID_EOF;
    for (let rn = chest.containedObject; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (((1 << decoded.category) & srcObjMsk) === 0) {
        prev = rn;
        continue;
      }
      if (depth === 0) {
        if (decoded.category === DBType.CLOUD) {
          return { error: DsaMoveError.SER_NoCloudsPlease, object: OBJECT_ID_EOF };
        }
        if (doit) {
          const next = this.dungeon.getDBRecordLink(rn);
          if (prev === OBJECT_ID_EOF) chest.containedObject = next;
          else this.dungeon.setDBRecordLink(prev, next);
          this.dungeon.setDBRecordLink(rn, OBJECT_ID_EOF);
        }
        return { error: DsaMoveError.SER_OK, object: rn };
      }
      depth -= 1;
      prev = rn;
    }
    return { error: DsaMoveError.SER_NoSuchObjectInChest, object: OBJECT_ID_EOF };
  }

  private findCharacterDestination(
    chIdx: number,
    carryLoc: number,
    object: number,
    doit: boolean,
  ): number {
    if (decodeObjectID(object).category === DBType.CLOUD) return DsaMoveError.DER_NoCloudsPlease;
    const party = this.getPartyState?.();
    if (!party) return DsaMoveError.DER_IllegalCharacterIndex;
    if (chIdx < 0 || chIdx >= party.champions.length) return DsaMoveError.DER_IllegalCharacterIndex;
    if (carryLoc < 0 || carryLoc > 29) return DsaMoveError.DER_IllegalPossessionIndex;
    const champ = this.getChampion(party, chIdx);
    if (!champ) return DsaMoveError.DER_IllegalCharacterIndex;
    const possessions = champ.possessions ?? [];
    if (!this.isEmptyObject(possessions[carryLoc])) return DsaMoveError.DER_PossessionSlotNotEmpty;
    const carryMask = this.getObjectCarryMask(object);
    const slotMask = this.getCarryLocationMask(carryLoc);
    if (carryMask === null || (carryMask & slotMask) === 0) {
      return DsaMoveError.DER_IllegalObjectForCarryLocation;
    }
    if (doit) this.setChampionPossession(champ, carryLoc, object);
    return DsaMoveError.DER_OK;
  }

  private checkObjectToCursor(object: number, doit: boolean): number {
    if (decodeObjectID(object).category === DBType.CLOUD) return DsaMoveError.DER_NoCloudsPlease;
    const party = this.getPartyState?.();
    if (!party) return DsaMoveError.DER_CursorNotEmpty;
    if (!this.isEmptyObject(party.objectInHand ?? null)) return DsaMoveError.DER_CursorNotEmpty;
    if (doit) party.objectInHand = object;
    return DsaMoveError.DER_OK;
  }

  private findCellDestination(
    dstObjMsk: number,
    dstPosMsk: number,
    dstLoc: number,
    dstDepth: number,
    object: number,
    srcType: number,
    srcLoc: number,
    doit: boolean,
  ): number {
    void dstObjMsk;
    const locr = intToLocation(dstLoc);
    if (!this.isValidLocation(locr)) return DsaMoveError.DER_InvalidCellLocation;
    if (dstDepth !== 0) return DsaMoveError.DER_IllegalDepth;
    const pos = this.choosePositionFromMask(dstPosMsk, locr.p & 3);
    if (doit) {
      if (decodeObjectID(object).category === DBType.CLOUD) return DsaMoveError.DER_NoCloudsPlease;
      const decoded = decodeObjectID(object);
      const placed = encodeObjectID(pos, decoded.category, decoded.index);
      this.dungeon.setDBRecordLink(placed, OBJECT_ID_EOF);
      this.triggerObjectMove(new Position(locr.x, locr.y, locr.l), placed, true, srcType === 1 && srcLoc === dstLoc);
      this.dungeon.addObjectToCell(new Position(locr.x, locr.y, locr.l), placed);
    }
    return DsaMoveError.DER_OK;
  }

  private findChestDestination(dstLoc: number, dstDepth: number, object: number, doit: boolean): number {
    if (!this.isValidObjectId(dstLoc)) return DsaMoveError.DER_IllegalChestID;
    if (decodeObjectID(object).category === DBType.CLOUD) return DsaMoveError.DER_NoCloudsPlease;
    const decodedChest = decodeObjectID(dstLoc);
    if (decodedChest.category !== DBType.CHEST) return DsaMoveError.DER_ChestIsNotAChest;
    if (dstDepth !== 0) return DsaMoveError.DER_IllegalDepth;
    if (this.isObjectInCharactersOrCursor(dstLoc)) return DsaMoveError.DER_ChestBelongsToCharacter;
    const chest = this.dungeon.getContainerRecord(dstLoc);
    if (!chest) return DsaMoveError.DER_ChestIsNotAChest;
    let count = 0;
    for (let rn = chest.containedObject; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = this.dungeon.getDBRecordLink(rn)) {
      count += 1;
    }
    if (count > 7) return DsaMoveError.DER_ChestIsFull;
    if (doit) {
      this.dungeon.setDBRecordLink(object, chest.containedObject);
      chest.containedObject = object;
    }
    return DsaMoveError.DER_OK;
  }

  private findMonsterDestination(dstLoc: number, dstDepth: number, object: number, doit: boolean): number {
    if (!this.isValidObjectId(dstLoc)) return DsaMoveError.DER_IllegalMonsterID;
    if (decodeObjectID(object).category === DBType.CLOUD) return DsaMoveError.DER_NoCloudsPlease;
    const decoded = decodeObjectID(dstLoc);
    if (decoded.category !== DBType.CREATURE) return DsaMoveError.DER_MonsterIsNotAMonster;
    if (dstDepth !== 0) return DsaMoveError.DER_IllegalDepth;
    const monster = this.dungeon.getCreatureRecord(dstLoc);
    if (!monster) return DsaMoveError.DER_MonsterIsNotAMonster;
    if (doit) {
      this.dungeon.setDBRecordLink(object, monster.possession);
      monster.possession = object;
    }
    return DsaMoveError.DER_OK;
  }

  private getObjectCarryMask(objectId: number): number | null {
    const descIndex = this.getObjectDescIndex(objectId);
    if (descIndex === null) return null;
    const mask = this.objDescCarryMask?.[descIndex];
    return typeof mask === 'number' ? mask : null;
  }

  private getCarryLocationMask(slot: number): number {
    const value = this.carryLocation?.[slot];
    return typeof value === 'number' ? value : 0;
  }

  private getObjectDescIndex(objectId: number): number | null {
    if (!this.isValidObjectId(objectId)) return null;
    const decoded = decodeObjectID(objectId);
    switch (decoded.category) {
      case DBType.SCROLL:
        return 0;
      case DBType.CHEST:
        return 1;
      case DBType.POTION: {
        const rec = this.dungeon.getPotionRecord(objectId);
        if (!rec) return null;
        return 2 + (rec.potionType & 0x7f);
      }
      case DBType.WEAPON: {
        const rec = this.dungeon.getWeaponRecord(objectId);
        if (!rec) return null;
        return 23 + (rec.weaponType & 0x7f);
      }
      case DBType.CLOTHING: {
        const rec = this.dungeon.getClothingRecord(objectId);
        if (!rec) return null;
        return 69 + (rec.clothingType & 0x7f);
      }
      case DBType.MISC: {
        const rec = this.dungeon.getMiscRecord(objectId);
        if (!rec) return null;
        return 127 + (rec.miscType & 0x7f);
      }
      default:
        return null;
    }
  }

  private isObjectInCharactersOrCursor(objectId: number): boolean {
    const party = this.getPartyState?.();
    if (!party) return false;
    const visited = new Set<number>();
    for (const champion of party.champions) {
      const possessions = champion.possessions ?? [];
      for (const item of possessions) {
        const normalized = this.normalizePossessionValue(item);
        if (normalized === null) continue;
        if (this.searchListForObject(objectId, normalized, visited)) return true;
      }
    }
    const cursorObj = this.normalizePossessionValue(party.objectInHand);
    if (cursorObj !== null) {
      if (this.searchListForObject(objectId, cursorObj, visited)) return true;
    }
    return false;
  }

  private searchListForObject(target: number, head: number, visited: Set<number>): boolean {
    for (let rn = head; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = this.dungeon.getDBRecordLink(rn)) {
      if (rn === target) return true;
      if (visited.has(rn)) continue;
      visited.add(rn);
      const decoded = decodeObjectID(rn);
      if (decoded.category === DBType.CHEST) {
        const chest = this.dungeon.getContainerRecord(rn);
        if (chest && chest.containedObject !== OBJECT_ID_EOF) {
          if (this.searchListForObject(target, chest.containedObject, visited)) return true;
        }
      } else if (decoded.category === DBType.CREATURE) {
        return false;
      }
    }
    return false;
  }

  private getTypeId(objectId: number): number {
    if (!this.isValidObjectId(objectId)) return -1;
    const { category, index } = decodeObjectID(objectId);
    const data = this.dungeon.getData().databases;
    let id = 0;
    switch (category) {
      case DBType.DOOR: {
        const rec = data.doors.records[index];
        if (!rec) return -1;
        id = (rec.hasButton ? 1 : 0);
        if (rec.destructibleByChop) id |= 0x02;
        if (rec.destructibleByFireball) id |= 0x04;
        if (rec.vertical) id |= 0x08;
        id |= (rec.ornateNumber & 0xf) << 4;
        id |= (rec.doorType & 0x1) << 8;
        break;
      }
      case DBType.TELEPORTER: {
        const rec = data.teleporters.records[index];
        if (!rec) return -1;
        id = rec.rotation & 0x3;
        if (rec.absoluteRotation) id |= 0x04;
        id |= (rec.scope & 0x3) << 3;
        if (rec.sound) id |= 0x20;
        break;
      }
      case DBType.TEXT: {
        const rec = data.texts.records[index];
        if (!rec) return -1;
        id = rec.visible ? 1 : 0;
        break;
      }
      case DBType.ACTUATOR: {
        const rec = data.actuators.records[index];
        if (!rec) return -1;
        id = 0;
        if (isActuatorAudible(rec)) id |= 0x01;
        if (isActuatorOnceOnly(rec)) id |= 0x02;
        id |= (getActuatorType(rec) & 0x7f) << 2;
        break;
      }
      case DBType.CREATURE: {
        const rec = data.creatures.records[index];
        if (!rec) return -1;
        id = rec.creatureType & 0xff;
        break;
      }
      case DBType.WEAPON: {
        const rec = data.weapons.records[index];
        if (!rec) return -1;
        id = rec.weaponType & 0x7f;
        break;
      }
      case DBType.CLOTHING: {
        const rec = data.clothing.records[index];
        if (!rec) return -1;
        id = rec.clothingType & 0x7f;
        break;
      }
      case DBType.SCROLL:
        id = 0;
        break;
      case DBType.POTION: {
        const rec = data.potions.records[index];
        if (!rec) return -1;
        id = ((rec.potionType & 0x7f) << 8) | (rec.power & 0xff);
        break;
      }
      case DBType.CHEST: {
        const rec = data.containers.records[index];
        if (!rec) return -1;
        let count = 0;
        for (
          let rn = rec.containedObject;
          rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
          rn = this.dungeon.getDBRecordLink(rn)
        ) {
          count += 1;
        }
        id = count;
        break;
      }
      case DBType.MISC: {
        const rec = data.misc.records[index];
        if (!rec) return -1;
        id = rec.miscType & 0x7f;
        break;
      }
      case DBType.CLOUD: {
        const rec = data.clouds.records[index];
        if (!rec) return -1;
        id = rec.cloudType & 0x7f;
        break;
      }
      default:
        id = 0;
        break;
    }
    return category * 10000 + id;
  }

  private isValidLocation(locr: DsaLocation): boolean {
    const map = this.dungeon.getMap(locr.l);
    if (!map) return false;
    if (locr.x < 0 || locr.y < 0) return false;
    if (locr.x >= map.descriptor.width || locr.y >= map.descriptor.height) return false;
    return true;
  }

  private getActuator(rn: number): ActuatorRecord | null {
    return this.dungeon.getActuatorRecord(rn);
  }

  private choosePositionFromMask(mask: number, fallback: TilePosition = TilePosition.NORTH): TilePosition {
    const m = mask & 0xf;
    if (m === 0) return fallback;
    const positions: TilePosition[] = [];
    for (let p = 0; p < 4; p++) {
      if ((m & (1 << p)) !== 0) positions.push(p as TilePosition);
    }
    if (positions.length === 0) return fallback;
    const idx = Math.floor(Math.random() * positions.length);
    return positions[idx] ?? fallback;
  }

  private copyItem(objectId: number): number | null {
    if (!this.isValidObjectId(objectId)) return null;
    const { category, index, position } = decodeObjectID(objectId);
    const data = this.dungeon.getData();
    const maxIndex = 1023;

    const bumpCount = (): void => {
      data.header.objectCounts[category] = ((data.header.objectCounts[category] ?? 0) + 1) & 0xffff;
    };

    switch (category) {
      case DBType.ACTUATOR: {
        const rec = data.databases.actuators.records[index];
        if (!rec) return null;
        if (data.databases.actuators.records.length >= maxIndex + 1) return null;
        data.databases.actuators.records.push({ ...rec, nextObject: OBJECT_ID_EOF });
        data.databases.actuators.count++;
        bumpCount();
        const newIndex = data.databases.actuators.records.length - 1;
        return encodeObjectID(position, category, newIndex);
      }
      case DBType.MISC: {
        const rec = data.databases.misc.records[index];
        if (!rec) return null;
        if (data.databases.misc.records.length >= maxIndex + 1) return null;
        data.databases.misc.records.push({ ...rec, nextObject: OBJECT_ID_EOF });
        data.databases.misc.count++;
        bumpCount();
        const newIndex = data.databases.misc.records.length - 1;
        return encodeObjectID(position, category, newIndex);
      }
      case DBType.WEAPON: {
        const rec = data.databases.weapons.records[index];
        if (!rec) return null;
        if (data.databases.weapons.records.length >= maxIndex + 1) return null;
        data.databases.weapons.records.push({ ...rec, nextObject: OBJECT_ID_EOF });
        data.databases.weapons.count++;
        bumpCount();
        const newIndex = data.databases.weapons.records.length - 1;
        return encodeObjectID(position, category, newIndex);
      }
      case DBType.CLOTHING: {
        const rec = data.databases.clothing.records[index];
        if (!rec) return null;
        if (data.databases.clothing.records.length >= maxIndex + 1) return null;
        data.databases.clothing.records.push({ ...rec, nextObject: OBJECT_ID_EOF });
        data.databases.clothing.count++;
        bumpCount();
        const newIndex = data.databases.clothing.records.length - 1;
        return encodeObjectID(position, category, newIndex);
      }
      case DBType.POTION: {
        const rec = data.databases.potions.records[index];
        if (!rec) return null;
        if (data.databases.potions.records.length >= maxIndex + 1) return null;
        data.databases.potions.records.push({ ...rec, nextObject: OBJECT_ID_EOF });
        data.databases.potions.count++;
        bumpCount();
        const newIndex = data.databases.potions.records.length - 1;
        return encodeObjectID(position, category, newIndex);
      }
      case DBType.CREATURE: {
        const rec = data.databases.creatures.records[index];
        if (!rec) return null;
        if (data.databases.creatures.records.length >= maxIndex + 1) return null;
        const copiedPossessions = this.copyItemList(rec.possession);
        data.databases.creatures.records.push({
          ...rec,
          nextObject: OBJECT_ID_EOF,
          possession: copiedPossessions,
          groupIndex: undefined,
        });
        data.databases.creatures.count++;
        bumpCount();
        const newIndex = data.databases.creatures.records.length - 1;
        return encodeObjectID(position, category, newIndex);
      }
      default:
        console.warn('DSA &ADD unsupported object type', category);
        return null;
    }
  }

  private copyItemList(head: number): number {
    let result = OBJECT_ID_EOF;
    let last = OBJECT_ID_EOF;
    for (let rn = head; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = this.dungeon.getDBRecordLink(rn)) {
      const copied = this.copyItem(rn);
      if (copied === null) return OBJECT_ID_EOF;
      if (result === OBJECT_ID_EOF) {
        result = copied;
      } else {
        this.dungeon.setDBRecordLink(last, copied);
      }
      last = copied;
    }
    return result;
  }
}
