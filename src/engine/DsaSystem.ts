import {
  DBType,
  TilePosition,
  OBJECT_ID_EOF,
  OBJECT_ID_NULL,
  type ObjectID,
  type LocationRel,
  locationRelFromInteger,
  locationRelToInteger,
  Position,
  RoomType,
  rnEquals,
} from '../core/types';
import { DescIndex, GetBasicObjectType } from './objectIndex';
import { addToSkill, determineMastery } from './skills';
import { attributeCurrent, attributeMaximum, attributeMinimum, setAttributeCurrent, setAttributeMaximum, setAttributeMinimum } from './attributes';
import { sw } from '../core/intCast';
import type { ActuatorRecord, CreatureRecord, DsaDefinition, DsaState, TeleporterRecord, TextRecord } from '../data/dungeonTypes';
import type { SpellParameters } from './magicTypes';
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
import type { DungeonState } from './DungeonState';
import { nameIndexOf, type GameContext } from './GameContext';
import { getChampionPossession, type PartyState, type Champion } from './gameTypes';
import { vacantPossession } from '../data/CsbwinCharacters';
import { TimerFunction } from './TimerQueue';
import type { TimerEntry, TimerQueue } from './TimerQueue';
import type { MonsterSystem } from './MonsterSystem';
import type { WorldMove } from './WorldMove';
import type { CsbRandom } from '../core/random';
import type { MonsterDesc } from '../data/tables/MonsterDesc';
import { monsterHorizontalSize } from '../data/tables/MonsterDesc';

export interface ViewingFilterOptions {
  phraseMask: number;
  objectId: number;
  selectedCharacter: number;
}

/** The one type-47 actuator `SetupDSAParam` picked out (`doc/CSBwin-src/Attack.cpp:434`). */
export interface PartyAttackFilter {
  position: Position;
  actuator: ObjectID;
}

export interface ViewingFilterResult {
  phraseMask: number;
  objectId: number;
  phraseTextOverrides: Array<string | null>;
  phraseColorOverrides: Array<number | null>;
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

/** `STKOP` (`doc/CSBwin-src/Data.h:1721-1861`): every `&` operation, in CSBWin's order. */
export enum StkOp {
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
  TWO_DUP = 23,
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
  OVERLAY = 35,
  DISABLE_SAVES = 36,
  GEAR = 37,
  FETCH = 38,
  STORE = 39,
  PARAM_FETCH = 40,
  PARAM_STORE = 41,
  MESSAGE = 42,
  CAST = 43,
  FETCH_EX_CELL_FLG = 44,
  STORE_EX_CELL_FLG = 45,
  CH_POSS = 46,
  SAY = 47,
  LOC_TO_ABS_COORD = 48,
  MASTERY = 49,
  ULESS = 50,
  GET_CURSE = 51,
  SET_CURSE = 52,
  GET_CHARGES = 53,
  SET_CHARGES = 54,
  GET_BROKEN = 55,
  SET_BROKEN = 56,
  CELL_FETCH = 57,
  CELL_STORE = 58,
  GLOBAL_FETCH = 59,
  MONSTER_FETCH = 60,
  THROW = 61,
  TELEPORT_PARTY = 62,
  MONSTER_STORE = 63,
  PARTY_FETCH = 64,
  CHAR_FETCH = 65,
  CHAR_STORE = 66,
  RANDOM = 67,
  CREATE_CLOUD = 68,
  SOUND = 69,
  XOR = 70,
  MON_BLK = 71,
  DESCRIBE = 72,
  MOVE = 73,
  GET_POISONED = 74,
  SET_POISONED = 75,
  COPY = 76,
  MON_POSS = 77,
  PALETTE = 78,
  I_DEL = 79,
  I_ADD = 80,
  I_CREATE_CLOUD = 81,
  I_CAST = 82,
  I_TELEPORT_PARTY = 83,
  I_MONSTER_STORE = 84,
  I_CHAR_STORE = 85,
  I_MOVE = 86,
  I_COPY = 87,
  I_CELL_STORE = 88,
  I_THROW = 89,
  I_INDIRECT = 90,
  I_DELAY = 91,
  SET_ADJUST_SKILLS_PARAMETERS = 92,
  I_DEL_MON = 93,
  I_INS_MON = 94,
  DEL_MON = 95,
  INS_MON = 96,
  TIME_FETCH = 97,
  JUMP_GEAR = 98,
  GOSUB_GEAR = 99,
  GENERATOR_DELAY_FETCH = 100,
  MISSILE_INFO_FETCH = 101,
  MISSILE_INFO_STORE = 102,
  TEXT_FETCH = 103,
  TEXT_SAY = 104,
  MON_LAND_D = 105,
  COUNT_INJURY = 106,
  NEIGHBORS = 107,
  BIT_COUNT = 108,
  THIS_CELL = 109,
  CAUSE_POISON = 110,
  I_CAUSE_POISON = 111,
  MULTIPLIER_FETCH = 112,
  EXPERIENCE_PLUS = 113,
  IS_CARRIED = 114,
  DISCARD_TEXT = 115,
  WHERE_IS_CHAR = 116,
  WHO_HAS_TALENT = 117,
  SWAP_CHARACTER = 118,
  FILTERED_CAST = 119,
  I_FILTERED_CAST = 120,
  GLOBAL_TEXT_STORE = 121,
  CHAR_NAME_FETCH = 122,
  OBJECT_ID = 123,
  GET_SUB_TYPE = 124,
  SET_SUB_TYPE = 125,
  I_SWAP_CHARACTER = 126,
  PARTY_DISTANCE = 129,
  DSA_INFO_FETCH = 130,
  GET_SKIN = 131,
  SET_SKIN = 132,
  THIS_DSA_ID = 133,
  TALENTS_FETCH = 134,
  TALENTS_STORE = 135,
  VSET = 136,
  JITTER = 137,
  MODIFY_MESSAGE = 138,
  NUM_PARAM = 139,
}

const EDT_SPECIAL_LOCATIONS = 3;
const ESL_MISSILE_ENCOUNTER_FILTER = 13;
const ESL_ADJUST_SKILLS_FILTER = 6;
const ESL_VIEWING_FILTER = 3;
const ESL_PARTY_ATTACK_FILTER = 4;
const MISSILE_ENCOUNTER_FILTER_KEY = (EDT_SPECIAL_LOCATIONS << 24) | ESL_MISSILE_ENCOUNTER_FILTER;
const ADJUST_SKILLS_FILTER_KEY = (EDT_SPECIAL_LOCATIONS << 24) | ESL_ADJUST_SKILLS_FILTER;
const VIEWING_FILTER_KEY = (EDT_SPECIAL_LOCATIONS << 24) | ESL_VIEWING_FILTER;
const PARTY_ATTACK_FILTER_KEY = (EDT_SPECIAL_LOCATIONS << 24) | ESL_PARTY_ATTACK_FILTER;

/**
 * `sizeof(ATTACKPARAMETERS)` — what `SetupDSAParam` writes into `pDSAparameters[0]`
 * (`doc/CSBwin-src/Attack.cpp:1361`). It is a byte count where every other filter
 * stores a word count, which is CSBWin's own inconsistency; since `PARAM_FETCH`
 * clamps its request to 100 first, an over-large count behaves as "all of them".
 */
const PARTY_ATTACK_PARAM_SIZEOF = 124;

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
  /**
   * `m_objectDeleteList` (`doc/CSBwin-src/DSA.cpp:132`) — what `&DEL` has condemned,
   * chained through the records' own links, freed only once the run is over.
   */
  objectDeleteList: ObjectID = OBJECT_ID_EOF;

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
  locrMaster: LocationRel;
  locrSlave: LocationRel;
  rnMaster: ObjectID;
  rnSlave: ObjectID;
  master: DsaDefinition;
  slave: DsaDefinition;
  subroutineLevel: number;
}

function signExtend(value: number, bits: number): number {
  const sign = 1 << (bits - 1);
  return (value & (sign - 1)) - (value & sign);
}

/**
 * `IsMaxState` (`doc/CSBwin-src/Data.h:1889-2384`): every command compares its
 * relative-state field with `-MAXSTATE`. For all but `QUESTION`, whose `MAXSTATE` is 2,
 * that value is out of the signed field's range, so no other command reads the word.
 */
function isMaxState(relState: number, maxState: number): boolean {
  return relState === -maxState;
}

function readSignedWord(word: number): number {
  const value = word & 0xffff;
  return value & 0x8000 ? value - 0x10000 : value;
}

/** `bitCounts` (`doc/CSBwin-src/DSA.cpp:45`): the set bits of a nibble. */
const BIT_COUNTS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** `EDT_Character` (`doc/CSBwin-src/CSB.h:1568`): a champion in the wings, keyed by fingerprint. */
const EDT_CHARACTER = 8;

/** `LIMIT(min, x, max)` (`doc/CSBwin-src/CSB.h:3109`): `max` is tested first. */
function limit(min: number, x: number, max: number): number {
  return x > max ? max : x < min ? min : x;
}

export class DsaSystem {
  private readonly dungeon: DungeonState;
  private readonly timers: TimerQueue;
  private readonly random: CsbRandom;
  /** `d.Byte1596`, the room-type timer functions. */
  private readonly byte1596: ArrayLike<number>;
  /** `d.ObjDesc[].word4`. */
  private readonly objDescWord4: ArrayLike<number>;
  private readonly carryLocation: ArrayLike<number>;
  private timerTypeModifier = [0, 1, 2];
  private parameters: Int32Array = new Int32Array(101);
  private adjustSkillsParameters = new Int32Array(5);
  /**
   * `d.GlobalVariables` — where a dungeon's DSAs keep their puzzle progress, so a read
   * has to carry them (`getGlobalVariables` / `setGlobalVariables`).
   */
  private globalVariables = new Int32Array(100);
  private warnedOps = new Set<number>();
  private overridePos = 0;
  private overrideP = false;
  private viewingFilterContext: ViewingFilterContext | null = null;
  private readonly monsterDesc: ArrayLike<MonsterDesc>;

  constructor(private readonly ctx: GameContext) {
    this.dungeon = ctx.dungeon;
    this.timers = ctx.timers;
    this.random = ctx.random;
    this.byte1596 = ctx.tables.byte1596;
    this.objDescWord4 = ctx.tables.objDescWord4;
    this.carryLocation = ctx.tables.carryLocation;
    this.monsterDesc = ctx.tables.monsterDesc;
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

  /**
   * `NEWDSAPARAMETERS` (`doc/CSBwin-src/CSB.h:4220-4235`): `fn` runs on a parameter array
   * of its own, whose count is 0, and the caller's is back once it returns. Every filter
   * but the party attack's is called so, and so is a DSA that `ActivateDSA` starts
   * (`doc/CSBwin-src/Timer.cpp:1525`); a program that runs one, `&EXPERIENCE+` reaching
   * the adjust-skills filter, finds its own parameters after it. CSBWin leaves the words
   * past the count uninitialised; `&PARAM@` reads none past the count, so the port's
   * zeros cannot be told from them.
   */
  newDsaParameters<T>(fn: () => T): T {
    const saved = this.parameters;
    this.parameters = new Int32Array(101);
    try {
      return fn();
    } finally {
      this.parameters = saved;
    }
  }

  getAdjustSkillsParameters(): Int32Array {
    return this.adjustSkillsParameters;
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
    const locrFilter = locationRelFromInteger(special);
    if (!this.dungeon.isValidLocation(locrFilter)) return 0;
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
      timerWord6: 0,
    };

    const encounterLoc = locationRelToInteger({
      l: options.position.z & 0x3f,
      x: options.position.x & 0x1f,
      y: options.position.y & 0x1f,
      p: options.posInCell & 0x3,
    });

    return this.newDsaParameters(() => {
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
    });
  }

  processViewingFilter(options: ViewingFilterOptions): ViewingFilterResult | null {
    const special = this.dungeon.getSpecialLocation(VIEWING_FILTER_KEY);
    if (special === null) return null;
    const locrFilter = locationRelFromInteger(special);
    if (!this.dungeon.isValidLocation(locrFilter)) return null;
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
      timerWord6: 0,
    };

    return this.newDsaParameters(() => {
      this.setParameters(3, [options.phraseMask | 0, options.objectId | 0, options.selectedCharacter | 0]);
      this.viewingFilterContext = {
        phraseMask: options.phraseMask | 0,
        phraseTextOverrides: Array.from({ length: 8 }, () => null),
        phraseColorOverrides: Array.from({ length: 8 }, () => null),
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
    });
  }

  processAdjustSkillsFilter(options: {
    chIdx: number;
    skillNumber: number;
    experience: number;
    why: number;
  }): { chIdx: number; skillNumber: number; experience: number } | null {
    const special = this.dungeon.getSpecialLocation(ADJUST_SKILLS_FILTER_KEY);
    if (special === null) return null;
    const locrFilter = locationRelFromInteger(special);
    if (!this.dungeon.isValidLocation(locrFilter)) return null;
    const filterPos = new Position(locrFilter.x, locrFilter.y, locrFilter.l);

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
      timerWord6: 0,
    };

    let chIdx = options.chIdx | 0;
    let skillNumber = options.skillNumber | 0;
    let experience = options.experience | 0;
    let why = options.why | 0;

    const found = this.newDsaParameters(() => {
      let found = false;
      for (let rn = this.dungeon.findFirstObject(filterPos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
        if (this.dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
        const rec = this.dungeon.getActuatorRecord(rn);
        if (!rec || getActuatorType(rec) !== 47) continue;
        found = true;
        this.setParameters(9, [
          chIdx,
          skillNumber,
          experience,
          why,
          this.adjustSkillsParameters[0] ?? 0,
          this.adjustSkillsParameters[1] ?? 0,
          this.adjustSkillsParameters[2] ?? 0,
          this.adjustSkillsParameters[3] ?? 0,
          this.adjustSkillsParameters[4] ?? 0,
        ]);
        this.processTimer6Internal(rn, timer, filterPos, true, new DsaVars());
        chIdx = this.getParameter(0);
        skillNumber = this.getParameter(1);
        experience = this.getParameter(2);
        why = this.getParameter(3);
      }
      return found;
    });

    if (!found) return null;
    return { chIdx, skillNumber, experience };
  }

  /**
   * `SetupDSAParam` (`doc/CSBwin-src/Attack.cpp:1346`) — locate the Party Attack
   * Filter once, at the top of `_Attack`, so every later `CallAttackFilter` runs the
   * *same* actuator rather than re-searching the cell.
   *
   * Returns null when the dungeon has no such filter, which is the common case and
   * the reason `CallAttackFilter` is free.
   */
  findPartyAttackFilter(): PartyAttackFilter | null {
    const special = this.dungeon.getSpecialLocation(PARTY_ATTACK_FILTER_KEY);
    if (special === null) return null;
    const locrFilter = locationRelFromInteger(special);
    if (!this.dungeon.isValidLocation(locrFilter)) return null;
    const position = new Position(locrFilter.x, locrFilter.y, locrFilter.l);
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (this.dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec || getActuatorType(rec) !== 47) continue;
      return { position, actuator: rn };
    }
    return null;
  }

  /**
   * `CallAttackFilter` (`doc/CSBwin-src/Attack.cpp:457`).
   *
   * `_Attack` calls this three times for one blow — `msg` 0 before it decides
   * anything, 1 once the attack type's own code has filled in its half of the block,
   * and 2 after everything has been applied — and the DSA sees the *same* parameter
   * block each time, mutated in place. So the caller keeps the words and passes them
   * back in; this only marshals them across.
   *
   * `msg` rides in the timer's `uByte9` (`timerFunction`), which is how the DSA tells
   * the three calls apart.
   */
  callPartyAttackFilter(filter: PartyAttackFilter, words: ArrayLike<number>, msg: number): number[] {
    const timer: TimerEntry = {
      index: -1,
      time: 0,
      level: filter.position.z & 0xff,
      function: msg & 0xff,
      uByte5: 0,
      uByte6: filter.position.x & 0xff,
      uByte7: filter.position.y & 0xff,
      uByte8: 0,
      uByte9: msg & 0xff,
      sequence: 0,
      timerWord8: 0,
      timerWord6: 0,
    };

    const count = Math.min(words.length, 100);
    this.parameters.fill(0);
    this.parameters[0] = PARTY_ATTACK_PARAM_SIZEOF;
    for (let i = 0; i < count; i++) this.parameters[1 + i] = words[i] ?? 0;

    this.processTimer6Internal(filter.actuator, timer, filter.position, true, new DsaVars());

    const out = new Array<number>(words.length);
    for (let i = 0; i < words.length; i++) out[i] = this.getParameter(i);
    return out;
  }

  processSpellFilter(params: SpellParameters): SpellParameters | null {
    const location = this.dungeon.getSpellFilterLocation();
    if ((location & 0x80000000) === 0) return null;
    const locrFilter = locationRelFromInteger(location & 0x7fffffff);
    if (!this.dungeon.isValidLocation(locrFilter)) return null;
    const filterPos = new Position(locrFilter.x, locrFilter.y, locrFilter.l);

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
      timerWord6: 0,
    };

    let updated: SpellParameters = { ...params };

    const found = this.newDsaParameters(() => {
      let found = false;
      for (let rn = this.dungeon.findFirstObject(filterPos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
        if (this.dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
        const rec = this.dungeon.getActuatorRecord(rn);
        if (!rec || getActuatorType(rec) !== 47) continue;
        found = true;
        this.setParameters(14, [
          updated.action,
          updated.incantation,
          updated.chIdx,
          updated.disableTime,
          updated.missileType,
          updated.locationAbs,
          updated.facing,
          updated.skillRequired,
          updated.spellByte5,
          updated.spellClass,
          updated.unused1,
          updated.unused2,
          updated.unused3,
          updated.unused4,
        ]);
        this.processTimer6Internal(rn, timer, filterPos, true, new DsaVars());
        updated = {
          action: this.getParameter(0),
          incantation: this.getParameter(1),
          chIdx: this.getParameter(2),
          disableTime: this.getParameter(3),
          missileType: this.getParameter(4),
          locationAbs: this.getParameter(5),
          facing: this.getParameter(6),
          skillRequired: this.getParameter(7),
          spellByte5: this.getParameter(8),
          spellClass: this.getParameter(9),
          unused1: this.getParameter(10),
          unused2: this.getParameter(11),
          unused3: this.getParameter(12),
          unused4: this.getParameter(13),
        };
      }
      return found;
    });

    if (!found) return null;
    return updated;
  }

  processTimer5(rn: ObjectID, timer: TimerEntry, location: Position): boolean {
    const vars = new DsaVars();
    return this.processTimer6Internal(rn, timer, location, false, vars);
  }

  processTimer6(rn: ObjectID, timer: TimerEntry, location: Position): boolean {
    const vars = new DsaVars();
    return this.processTimer6Internal(rn, timer, location, false, vars);
  }

  processTimer7(rn: ObjectID, timer: TimerEntry, location: Position): boolean {
    const vars = new DsaVars();
    return this.processTimer6Internal(rn, timer, location, false, vars);
  }

  /** The DSA global variables, for the state a read restores (`RuntimeSave.ts`). */
  getGlobalVariables(): number[] {
    return Array.from(this.globalVariables);
  }

  setGlobalVariables(values: readonly number[]): void {
    this.globalVariables.fill(0);
    const count = Math.min(values.length, this.globalVariables.length);
    for (let i = 0; i < count; i++) this.globalVariables[i] = values[i] | 0;
  }

  private processTimer6Internal(
    rn: ObjectID,
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

    const locrSlave: LocationRel = {
      l: level,
      x: location.x,
      y: location.y,
      p: this.dungeon.rnMaps.pos(rn) & 3,
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
    // `ProcessDSATimer6` returns `deletedSlave` (`doc/CSBwin-src/DSA.cpp:5483-5486`),
    // and every timer walk that runs a DSA breaks out of the cell's chain on it
    // (`Timer.cpp:1433`, `:1757`, `:2230`) — the slave's link is no longer the cell's.
    return this.consumateDeletes(bank, rn);
  }

  /**
   * `DSADBANK::DeleteObject` (`doc/CSBwin-src/DSA.cpp:157-163`) — condemn a record by
   * pushing it on the run's delete list through its own link. Nothing is freed yet.
   */
  private deleteObject(bank: DsaBank, rn: ObjectID): void {
    this.dungeon.setDBRecordLink(rn, bank.objectDeleteList);
    bank.objectDeleteList = rn;
  }

  /**
   * `DSADBANK::ConsumateDeletes` (`doc/CSBwin-src/DSA.cpp:178-191`) — free everything
   * `&DEL` condemned during the run, and say whether the DSA's own actuator was among
   * it. `==` on an `RN` compares the indirect index alone (`CSBTypes.h:349`).
   */
  private consumateDeletes(bank: DsaBank, rnSlave: ObjectID): boolean {
    let result = false;
    while (bank.objectDeleteList !== OBJECT_ID_EOF) {
      const obj = bank.objectDeleteList;
      if (rnEquals(obj, rnSlave)) result = true;
      bank.objectDeleteList = this.dungeon.getDBRecordLink(obj as ObjectID);
      this.dungeon.deleteDBEntry(obj as ObjectID);
    }
    return result;
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
            if (isMaxState(relState, -512)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = next;
            }
            nextState = curState + relState;
            break;
          }
          case DsaCommand.MESSAGE:
          case DsaCommand.MESSAGE32:
          case DsaCommand.DESSAGE32: {
            let relState = signExtend((word >> 12) & 0xf, 4);
            if (isMaxState(relState, -8)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = next;
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
              delay = next;
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
            if (isMaxState(relState, -32)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = next;
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
            if (isMaxState(relState, -4)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = next;
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
            if (isMaxState(relState, -4)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = next;
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
            if (isMaxState(relState, 2)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = next;
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
            if (isMaxState(relState, -512)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = next;
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
            if (isMaxState(relState, -512)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = next;
            }
            const v1 = bank.stack.pop();
            const v2 = bank.stack.pop();
            bank.stack.push(v1 === v2 ? 1 : 0);
            nextState = curState + relState;
            break;
          }
          case DsaCommand.LOAD: {
            let relState = signExtend((word >> 11) & 0x1f, 5);
            if (isMaxState(relState, -16)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const where = (word >> 6) & 0x1f;
            // `m_PC` is a `ui16 *` (`doc/CSBwin-src/DSA.cpp:250`): LOAD_INTEGER pushes the
            // word unsigned (`:1099-1106`).
            if (where === 26) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              bank.stack.push(next);
            } else if (where === 27) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              bank.stack.push(next);
            } else if (where === 28) {
              bank.stack.push(locationRelToInteger(exPkt.locrMaster));
            } else if (where === 30) {
              const lo = program[pc++] ?? 0;
              const hi = program[pc++] ?? 0;
              wordsRemaining -= 2;
              bank.stack.push((hi << 16) | lo);
            } else if (where <= 25) {
              const value = this.loadParameter(where, exPkt.rnMaster);
              bank.stack.push(value);
            }
            // 29 (`LOAD_ABS32`) and 31 are "Illegal DSA load command", and push nothing
            // (`:1138-1143`).
            break;
          }
          case DsaCommand.STORE: {
            // `EX_STORE` (`doc/CSBwin-src/DSA.cpp:1317-1386`): a `where` above 25 is
            // "Illegal DSA store command", which pops nothing and leaves the next state.
            const where = (word >> 6) & 0x1f;
            if (where > 25) break;
            this.storeParameter(where, exPkt.rnMaster, bank.stack.pop());
            let relState = signExtend((word >> 11) & 0x1f, 5);
            if (isMaxState(relState, -16)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = next;
            }
            nextState = curState + relState;
            break;
          }
          case DsaCommand.VARIABLESTORE: {
            let relState = signExtend((word >> 13) & 0x7, 3);
            if (isMaxState(relState, -4)) {
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
            if (isMaxState(relState, -4)) {
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
            if (isMaxState(relState, -4)) {
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
            if (isMaxState(relState, -4)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = readSignedWord(next);
            }
            nextState = curState + relState;
            const index = (word >> 6) & 0x7f;
            // Past the last variable, "Gloal fetch from non-existent variable" pushes
            // 0xcdcdcdcd (`doc/CSBwin-src/DSA.cpp:1302-1306`).
            const value = index < this.globalVariables.length ? this.globalVariables[index] : 0xcdcdcdcd;
            bank.stack.push(value);
            break;
          }
          case DsaCommand.FETCH: {
            let relState = signExtend((word >> 6) & 0x3ff, 10);
            if (isMaxState(relState, -512)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = next;
            }
            nextState = curState + relState;
            const objMask = bank.stack.pop();
            const posMask = bank.stack.pop();
            const location = bank.stack.pop();
            let depth = bank.stack.pop();
            const locr = locationRelFromInteger(location);
            if (!this.dungeon.isValidLocation(locr)) {
              bank.stack.push(-1);
              break;
            }
            let positionMask = posMask;
            if (positionMask === -1) positionMask = 1 << locr.p;
            let result = -1;
            const pos = new Position(locr.x, locr.y, locr.l);
            for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
              const decoded = this.dungeon.rnMaps.decode(rn);
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
            if (isMaxState(relState, -4)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = next;
            }
            nextState = curState + relState;
            const subcode = ((word >> 6) & 0x7f) + (opcode === DsaCommand.AMPERSAND2 ? 128 : 0);
            this.executeAmpersand(subcode, bank);
            break;
          }
          case DsaCommand.OVERRIDE: {
            // `EX_OVERRIDE` (`doc/CSBwin-src/DSA.cpp:1037-1072`): any `what` but 1 is
            // "Illegal DSA override command", which leaves the next state.
            const what = (word >> 6) & 0x7;
            const value = (word >> 9) & 0x7;
            if (what !== 1) break;
            this.overrideP = true;
            this.overridePos = value;
            if (value === 7) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              this.overridePos = next & 0xff;
            }
            let relState = signExtend((word >> 12) & 0xf, 4);
            if (isMaxState(relState, -8)) {
              const next = program[pc++] ?? 0;
              wordsRemaining--;
              relState = next;
            }
            nextState = curState + relState;
            break;
          }
          default:
            if (!this.warnedOps.has(opcode)) {
              this.warnedOps.add(opcode);
              this.ctx.host.trace(`Unimplemented DSA opcode ${opcode}`);
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
            this.deleteLinkedScrollText(removed, bank);
            this.deleteObject(bank, removed);
          }
          break;
        }
        const locr = locationRelFromInteger(location);
        if (!this.dungeon.isValidLocation(locr)) {
          this.ctx.host.trace('Illegal location in DSA &DEL');
          break;
        }
        const pos = new Position(locr.x, locr.y, locr.l);
        for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
          if (!this.isValidObjectId(objId) || !rnEquals(rn, objId)) continue;
          const { category } = this.dungeon.rnMaps.decode(rn);
          if (!this.canDeleteFromCell(category)) break;
          this.dungeon.removeObjectFromCell(pos, rn);
          this.ctx.systems.actuators.triggerObjectMove(pos, rn as ObjectID, false, false, this.ctx.party.state.facing);
          this.deleteLinkedScrollText(rn, bank);
          this.deleteObject(bank, rn);
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
          const locr = locationRelFromInteger(location);
          if (!this.dungeon.isValidLocation(locr)) break;
          const pos = this.choosePositionFromMask(posMask);
          const placed = this.dungeon.rnMaps.setPos(cloned, pos);
          this.ctx.systems.actuators.triggerObjectMove(new Position(locr.x, locr.y, locr.l), placed, true, false, this.ctx.party.state.facing);
          this.dungeon.addObjectToCell(new Position(locr.x, locr.y, locr.l), placed);
        } else if (location === -1) {
          const party = this.ctx.party.state;
          if (!party) break;
          party.objectInHand = cloned;
        } else if (location > -1000) {
          const party = this.ctx.party.state;
          if (!party) break;
          const loc = this.decodeCharacterLocation(location);
          if (!loc) break;
          const champ = this.getChampion(party, loc.chIdx);
          if (!champ) break;
          this.ctx.systems.character.addCharacterPossession(loc.chIdx, cloned, loc.posIdx);
        } else {
          const monsterId = this.decodeMonsterLocation(location);
          if (monsterId === null) break;
          const monster = this.dungeon.getCreatureRecord(monsterId);
          if (!monster) break;
          // `doc/CSBwin-src/DSA.cpp:2083-2085`: the copy, its link already `RNeof`,
          // heads an empty chain, else `AddObjectToRoom(newObj, *pDest, -1, 0, NULL)`.
          if (monster.possession === OBJECT_ID_EOF) monster.possession = cloned;
          else this.dungeon.addObjectToChain(cloned, monster.possession);
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
        const locr = locationRelFromInteger(loc);
        if (!this.dungeon.isValidLocation(locr)) break;
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
        const locr = locationRelFromInteger(location);
        if (!this.dungeon.isValidLocation(locr)) break;
        const map = this.dungeon.getMap(locr.l);
        if (!map) break;
        const cellFlag = map.cellFlags[locr.x][locr.y];
        if (((cellFlag >> 5) & 0x7) === RoomType.STONE) break;
        let firstDisabled: ObjectID | null = null;
        const pos = new Position(locr.x, locr.y, locr.l);
        for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
          const decoded = this.dungeon.rnMaps.decode(rn);
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
      case StkOp.TELEPORT_PARTY:
      case StkOp.I_TELEPORT_PARTY: {
        const location = bank.stack.pop();
        const locr = locationRelFromInteger(location);
        if (!this.dungeon.isValidLocation(locr)) break;
        this.teleportParty(locr);
        break;
      }
      case StkOp.DESCRIBE: {
        const color = bank.stack.pop();
        const index = bank.stack.pop();
        let locrInt = bank.stack.pop();
        if (this.overrideP) {
          this.overrideP = false;
          if (locrInt >= 0) {
            const locr = locationRelFromInteger(locrInt);
            locr.p = this.overridePos & 0x3;
            locrInt = locationRelToInteger(locr);
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
        // `(ui32)STRandom() % V` (doc/CSBwin-src/DSA.cpp:2729) — the full 24-bit
        // draw modulo V, *not* `STRandom(V)`, which masks to 16 bits first.
        const result = this.random.next() % v;
        bank.stack.push(result);
        break;
      }
      case StkOp.COPY: {
        const dstId = bank.stack.pop();
        const srcId = bank.stack.pop();
        if (!this.isValidObjectId(srcId) || !this.isValidObjectId(dstId)) break;
        const srcDecoded = this.dungeon.rnMaps.decode(srcId);
        const dstDecoded = this.dungeon.rnMaps.decode(dstId);
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
        bank.stack.push(this.ctx.state.tickCount);
        break;
      case StkOp.GENERATOR_DELAY_FETCH: {
        const loc = bank.stack.pop();
        const locr = locationRelFromInteger(loc);
        if (!this.dungeon.isValidLocation(locr)) {
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
        let found: ObjectID | null = null;
        for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
          const decoded = this.dungeon.rnMaps.decode(rn);
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
      case StkOp.SET_ADJUST_SKILLS_PARAMETERS: {
        this.adjustSkillsParameters[4] = bank.stack.pop();
        this.adjustSkillsParameters[3] = bank.stack.pop();
        this.adjustSkillsParameters[2] = bank.stack.pop();
        this.adjustSkillsParameters[1] = bank.stack.pop();
        this.adjustSkillsParameters[0] = bank.stack.pop();
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
        const locr = locationRelFromInteger(loc);
        if (!this.dungeon.isValidLocation(locr)) break;
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
            const destLoc = locationRelToInteger({
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
        const locr = locationRelFromInteger(loc);
        if (!this.dungeon.isValidLocation(locr)) break;
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
        if (which === 1) {
          const party = this.ctx.party.state;
          result = locationRelToInteger({
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
      case StkOp.CH_POSS: {
        // `doc/CSBwin-src/DSA.cpp:3330-3357`.
        const party = this.ctx.party.state;
        let possIndex = bank.stack.pop() >>> 0;
        let chIndex = bank.stack.pop();
        if (chIndex > 4) chIndex = 0;
        if (chIndex === 4) chIndex = party.cursorOwner;
        if (possIndex > 29) possIndex = 0;
        let object: ObjectID;
        if (chIndex >= 0) {
          // A slot past `d.NumCharacter` is read all the same, from the record left there.
          const champ = this.getChampion(party, chIndex);
          object = champ ? getChampionPossession(champ, possIndex)
            : vacantPossession(party.vacantCharacters[chIndex]!, possIndex);
        } else {
          object = party.objectInHand;
        }
        bank.stack.push(object === OBJECT_ID_NULL ? -1 : object);
        break;
      }
      case StkOp.MASTERY: {
        // `DSA.cpp:3389-3410`. The indices are `ui32`, so a negative one is out of range.
        const party = this.ctx.party.state;
        const flags = bank.stack.pop();
        let skillIndex = bank.stack.pop() >>> 0;
        let chIndex = bank.stack.pop() >>> 0;
        if (chIndex === 4) chIndex = party.cursorOwner >>> 0;
        const champ = chIndex < party.champions.length ? party.champions[chIndex] : undefined;
        if (!champ || skillIndex >= 20) {
          bank.stack.push(0);
          break;
        }
        if (flags & 1) skillIndex |= 0x4000;
        if (flags & 2) skillIndex |= 0x8000;
        bank.stack.push(determineMastery(champ, skillIndex, {
          partySleeping: party.sleeping,
          getObjectNameIndex: (rn: ObjectID) => nameIndexOf(this.ctx, rn),
        }));
        break;
      }
      case StkOp.PARTY_FETCH: {
        // `DSA.cpp:4127-4165`.
        const party = this.ctx.party.state;
        const num = bank.stack.pop() >>> 0;
        const index = bank.stack.pop() >>> 0;
        if (((index + num) >>> 0) > 100) break;
        const result = [
          party.champions.length,
          party.position.z,
          party.position.x,
          party.position.y,
          party.facing,
          party.sleeping ? 1 : 0,
          party.seeThruWalls,
          party.magicFootprintsActive,
          party.cursorOwner,
          party.invisible,
          party.fireShield,
          party.spellShield,
        ];
        const n = Math.min(result.length, num);
        for (let i = 0; i < n; i++) bank.setVar(index + i, result[i]!);
        break;
      }
      case StkOp.CHAR_FETCH: {
        // `DSA.cpp:4166-4241`.
        const party = this.ctx.party.state;
        const num = bank.stack.pop() >>> 0;
        const index = bank.stack.pop() >>> 0;
        let charIdx = bank.stack.pop();
        if (charIdx === 4) charIdx = party.cursorOwner;
        const result = new Array<number>(59).fill(0);
        if (((index + num) >>> 0) > 100 || (charIdx < 0x10000 && charIdx >= party.champions.length) || charIdx < 0) {
          // `memset(result, 0, …)`.
        } else if (charIdx & 0x10000) {
          // `GetFromWings` finds nobody, so the record is `memset` to zero (`DEBT.md` G3).
        } else {
          // An index of 0x20000 or more without bit 16 reads nobody (`DEBT.md` H).
          const pc = this.getChampion(party, charIdx);
          if (pc) {
            result[0] = pc.facing;
            result[1] = pc.food;
            result[2] = Math.max(pc.attributes.health - (party.pendingDamage[charIdx] ?? 0), 0);
            // `pc->load`, which the port sums from the possessions (`DEBT.md` H).
            result[3] = this.ctx.systems.characterStats.characterLoad(pc);
            result[4] = pc.attributes.mana;
            result[5] = pc.wounds;
            result[6] = pc.partyPosition;
            result[7] = pc.shieldStrength;
            result[8] = pc.attributes.stamina;
            result[9] = pc.water;
            for (let i = 0; i < 7; i++) {
              const attr = pc.attributes.stats[i]!;
              result[10 + i] = (attributeMinimum(attr) << 16) | (attributeMaximum(attr) << 8) | attributeCurrent(attr);
            }
            for (let i = 0; i < 40; i += 2) {
              const skill = pc.skills[i / 2];
              result[17 + i] = skill?.tempAdjust ?? 0;
              result[17 + i + 1] = skill?.experience ?? 0;
            }
            result[57] = pc.fingerprint;
            result[58] = pc.talents;
          }
        }
        const n = Math.min(59, num);
        for (let i = 0; i < n; i++) {
          if (index + i > 99) break;
          bank.setVar(index + i, result[i]!);
        }
        break;
      }
      case StkOp.TALENTS_FETCH: {
        // `DSA.cpp:4242-4290`. A wings index finds nobody (`DEBT.md` G3).
        const party = this.ctx.party.state;
        let charIdx = bank.stack.pop();
        if (charIdx === 4) charIdx = party.cursorOwner;
        const pc = charIdx & 0x10000 ? null : this.getChampion(party, charIdx);
        bank.stack.push(pc ? pc.talents : 0);
        break;
      }
      case StkOp.TALENTS_STORE: {
        // `DSA.cpp:4291-4347`. A wings index finds nobody (`DEBT.md` G3).
        const party = this.ctx.party.state;
        let charIdx = bank.stack.pop();
        const newTalents = bank.stack.pop() >>> 0;
        if (charIdx === 4) charIdx = party.cursorOwner;
        const pc = charIdx & 0x10000 ? null : this.getChampion(party, charIdx);
        if (pc) pc.talents = newTalents;
        break;
      }
      case StkOp.CAUSE_POISON: {
        // `DSA.cpp:4348-4362`.
        const charIdx = bank.stack.pop();
        const val = bank.stack.pop();
        this.noFilter(bank);
        if (charIdx >= this.ctx.party.state.champions.length) break;
        if (charIdx < 0) break;
        this.ctx.systems.monsterAttack.poisonCharacter(charIdx, val);
        break;
      }
      case StkOp.WHO_HAS_TALENT: {
        // `DSA.cpp:4363-4382`.
        const talents = bank.stack.pop() >>> 0;
        let val = 0;
        this.ctx.party.state.champions.forEach((champ, charIdx) => {
          if (((champ.talents & talents) >>> 0) === talents) val |= 1 << charIdx;
        });
        bank.stack.push(val);
        break;
      }
      case StkOp.WHERE_IS_CHAR: {
        // `DSA.cpp:4383-4412`: the last champion with the fingerprint, else 5 when the
        // wings hold its first record, else 4.
        const fingerPrint = bank.stack.pop();
        let val = 4;
        this.ctx.party.state.champions.forEach((champ, charIdx) => {
          if (champ.fingerprint === fingerPrint) val = charIdx;
        });
        if (val === 4) {
          const key = ((EDT_CHARACTER << 24) | (fingerPrint & 0xffff)) >>> 0;
          if (this.dungeon.locateExpoolRecord(key)?.length === 25) val = 5;
        }
        bank.stack.push(val);
        break;
      }
      case StkOp.CHAR_STORE:
        this.charStore(bank);
        break;
      case StkOp.EXPERIENCE_PLUS: {
        // `DSA.cpp:4542-4557`. A negative index reads nobody (`DEBT.md` H).
        const experience = bank.stack.pop();
        const skillnum = bank.stack.pop();
        const charnum = bank.stack.pop();
        const champ = this.getChampion(this.ctx.party.state, charnum);
        if (champ && champ.attributes.health > 0) addToSkill(this.ctx, charnum, skillnum, experience);
        break;
      }
      case StkOp.IS_CARRIED:
        this.isCarried(bank);
        break;
      case StkOp.GET_CURSE:
      case StkOp.GET_BROKEN:
      case StkOp.GET_POISONED:
      case StkOp.GET_CHARGES:
      case StkOp.GET_SUB_TYPE:
        bank.stack.push(this.getObjectField(subcode, bank.stack.pop()));
        break;
      case StkOp.SET_CURSE:
      case StkOp.SET_BROKEN:
      case StkOp.SET_POISONED:
      case StkOp.SET_CHARGES:
      case StkOp.SET_SUB_TYPE: {
        const value = bank.stack.pop();
        this.setObjectField(subcode, bank.stack.pop(), value);
        break;
      }
      case StkOp.COUNT_INJURY: {
        // `DSA.cpp:4798-4818`.
        const injuryMask = bank.stack.pop();
        let chMask = bank.stack.pop();
        let count = 0;
        const champions = this.ctx.party.state.champions;
        for (let chidx = 0; chidx < champions.length; chidx++, chMask >>= 1) {
          if ((chMask & 1) === 0) continue;
          if (champions[chidx]!.attributes.health <= 0) continue;
          const injuries = champions[chidx]!.wounds & injuryMask;
          count += BIT_COUNTS[injuries & 15]! + BIT_COUNTS[(injuries >> 4) & 15]!
            + BIT_COUNTS[(injuries >> 8) & 15]! + BIT_COUNTS[(injuries >> 12) & 15]!;
        }
        bank.stack.push(count);
        break;
      }
      default:
        if (!this.warnedOps.has(subcode)) {
          this.warnedOps.add(subcode);
          this.ctx.host.trace(`Unimplemented DSA & opcode ${subcode}`);
        }
        break;
    }
  }

  /**
   * `NOFILTER` (`doc/CSBwin-src/DSA.cpp:457-462`): an operation that changes the dungeon,
   * run from a filter, warns the dungeon's author.
   */
  private noFilter(bank: DsaBank): void {
    if (bank.filter) this.ctx.host.trace('Filter Modifying Dungeon');
  }

  /**
   * `STKOP_CharStore` (`doc/CSBwin-src/DSA.cpp:4426-4541`): the variables from `index` on
   * written back over the fields `&CHAR@` reads, but for those CSBWin leaves alone.
   * `CHARFLAG_statsChanged` and `DrawCharacterState` have no counterpart: the panels are
   * redrawn every frame.
   */
  private charStore(bank: DsaBank): void {
    const party = this.ctx.party.state;
    const num = bank.stack.pop() >>> 0;
    const index = bank.stack.pop() >>> 0;
    let charIdx = bank.stack.pop();
    if (charIdx === 4) charIdx = party.cursorOwner;
    this.noFilter(bank);
    if (((index + num) >>> 0) > 100) return;
    if (charIdx >= party.champions.length) return;
    if (charIdx < 0) return;
    if (party.potentialChampionIndex === charIdx) return;
    const pc = party.champions[charIdx]!;
    let n = Math.min(59, num);
    if (n > 100 - index) n = 100 - index;
    if (n > 1) pc.food = sw(limit(-1023, bank.getVar(1 + index), 2048));
    const pending = party.pendingDamage[charIdx] ?? 0;
    // "Nothing we can do about dead heroes!"
    if (pc.attributes.health - pending > 0 && n > 2) {
      if (bank.getVar(2 + index) < 0) bank.setVar(2 + index, 0);
      if (bank.getVar(2 + index) > pc.attributes.maxHealth) bank.setVar(2 + index, pc.attributes.maxHealth);
      if (bank.getVar(2 + index) < pc.attributes.health - pending) {
        party.pendingDamage[charIdx] = sw((pc.attributes.health - bank.getVar(2 + index)) & 0xffff);
      } else {
        pc.attributes.health = sw(bank.getVar(2 + index) + pending);
      }
    }
    if (n > 4) pc.attributes.mana = sw(limit(0, bank.getVar(4 + index), pc.attributes.maxMana));
    if (n > 8) pc.attributes.stamina = sw(limit(0, bank.getVar(8 + index), pc.attributes.maxStamina));
    if (n > 9) pc.water = sw(limit(-1023, bank.getVar(9 + index), 2048));
    for (let i = 0; i < 7; i++) {
      if (n <= i + 10) break;
      const value = bank.getVar(10 + index + i);
      const attr = pc.attributes.stats[i]!;
      setAttributeMinimum(attr, value >> 16);
      setAttributeMaximum(attr, (value >> 8) & 0xff);
      setAttributeCurrent(attr, value & 0xff);
    }
    if (n > 58) pc.talents = bank.getVar(index + 58) >>> 0;
  }

  /**
   * `EX_IsCarried` (`doc/CSBwin-src/DSA.cpp:1613-1641`). An object ID asks where that
   * object is: `256 * chIdx` plus its slot, 255 for the hand, or -1. A negative one is a
   * basic object type, -1 for type 0, and asks how many such objects are carried. A chest
   * is searched, and so is what it holds. Champion 4 is the hand's owner, 5 every
   * champion.
   */
  /**
   * `&CURSE@`, `&BROKEN@`, `&POISONED@`, `&CHARGES@` and `&SUBTYPE@`
   * (`doc/CSBwin-src/DSA.cpp:3411-3439`, `:3458-3483`, `:3511-3536`, `:3564-3595`,
   * `:3629-3651`): the field of the object at slot `objIndex`, 0 for an invalid slot or a
   * database without it. A potion's charges are its strength, a misc object's its
   * `value()`; only a weapon has a poison bit, and only a misc object a subtype.
   */
  private getObjectField(subcode: number, objIndex: number): number {
    if (!this.isValidObjectId(objIndex)) return 0;
    const dbType = this.dungeon.rnMaps.dbType(objIndex);
    const weapon = dbType === DBType.WEAPON ? this.dungeon.getWeaponRecord(objIndex) : null;
    const clothing = dbType === DBType.CLOTHING ? this.dungeon.getClothingRecord(objIndex) : null;
    const potion = dbType === DBType.POTION ? this.dungeon.getPotionRecord(objIndex) : null;
    const misc = dbType === DBType.MISC ? this.dungeon.getMiscRecord(objIndex) : null;
    const bit = (b: boolean | undefined): number => (b ? 1 : 0);
    switch (subcode) {
      case StkOp.GET_CURSE:
        return weapon ? bit(weapon.cursed) : clothing ? bit(clothing.cursed) : misc ? bit(misc.cursed) : 0;
      case StkOp.GET_BROKEN:
        return weapon ? bit(weapon.broken) : clothing ? bit(clothing.broken) : 0;
      case StkOp.GET_POISONED:
        return weapon ? bit(weapon.poisoned) : 0;
      case StkOp.GET_CHARGES:
        return weapon ? weapon.charges : clothing ? clothing.charges
          : potion ? potion.power : misc ? misc.specialState : 0;
      default:
        return misc ? misc.subType ?? 0 : 0;
    }
  }

  /**
   * `&CURSE!`, `&BROKEN!`, `&POISONED!`, `&CHARGES!` and `&SUBTYPE!`
   * (`doc/CSBwin-src/DSA.cpp:3440-3457`, `:3484-3510`, `:3537-3563`, `:3596-3628`,
   * `:3652-3675`): the setters of `getObjectField`'s fields, each value cut to its
   * field's width by `SETWBITS` (`CSB.h:746-774`), a flag set by any non-zero value.
   * A curse goes through `SetCursed`.
   */
  private setObjectField(subcode: number, objIndex: number, value: number): void {
    if (!this.isValidObjectId(objIndex)) return;
    const dbType = this.dungeon.rnMaps.dbType(objIndex);
    if (subcode === StkOp.SET_CURSE) {
      this.setCursed(objIndex, value !== 0);
      return;
    }
    const weapon = dbType === DBType.WEAPON ? this.dungeon.getWeaponRecord(objIndex) : null;
    const clothing = dbType === DBType.CLOTHING ? this.dungeon.getClothingRecord(objIndex) : null;
    const potion = dbType === DBType.POTION ? this.dungeon.getPotionRecord(objIndex) : null;
    const misc = dbType === DBType.MISC ? this.dungeon.getMiscRecord(objIndex) : null;
    switch (subcode) {
      case StkOp.SET_BROKEN:
        if (weapon) weapon.broken = value !== 0;
        else if (clothing) clothing.broken = value !== 0;
        break;
      case StkOp.SET_POISONED:
        if (weapon) weapon.poisoned = value !== 0;
        break;
      case StkOp.SET_CHARGES:
        if (weapon) weapon.charges = value & 0xf;
        else if (clothing) clothing.charges = value & 0xf;
        else if (potion) potion.power = value & 0xff;
        else if (misc) misc.specialState = value & 3;
        break;
      default:
        if (misc) misc.subType = value & 0x1f;
    }
  }

  /**
   * `SetCursed` (`doc/CSBwin-src/Character.cpp:1782-1816`): the curse bracketed by
   * `AdjustStatsForItemCarried`'s -1 and +1 on the champion carrying the object, at the
   * slot it is in. CSBWin's search leaves only its inner loop, so it passes that slot
   * only when the bearer is the last champion, and slot 30 for any other; the port's
   * leaves both (`DEBT.md` H).
   */
  private setCursed(obj: ObjectID, curse: boolean): void {
    const champions = this.ctx.party.state.champions;
    let pCH: Champion | null = null;
    let loc = -1;
    search: for (let ch = 0; ch < champions.length; ch++) {
      for (loc = 0; loc < 30; loc++) {
        if (obj === getChampionPossession(champions[ch]!, loc)) {
          pCH = champions[ch]!;
          break search;
        }
      }
    }
    const character = this.ctx.systems.character;
    if (pCH) character.adjustStatsForItemCarried(pCH, loc, -1, obj);
    switch (this.dungeon.rnMaps.dbType(obj)) {
      case DBType.WEAPON: this.dungeon.getWeaponRecord(obj)!.cursed = curse; break;
      case DBType.CLOTHING: this.dungeon.getClothingRecord(obj)!.cursed = curse; break;
      case DBType.MISC: this.dungeon.getMiscRecord(obj)!.cursed = curse; break;
      default: break;
    }
    if (pCH) character.adjustStatsForItemCarried(pCH, loc, +1, obj);
  }

  private isCarried(bank: DsaBank): void {
    const party = this.ctx.party.state;
    const objid = bank.stack.pop();
    const charnum = bank.stack.pop();
    bank.stack.push(0);
    for (let chidx = 0; chidx < party.champions.length; chidx++) {
      if (charnum === chidx || (charnum === 4 && chidx === party.cursorOwner) || charnum === 5) {
        if (this.forEach(bank, -chidx - 1, objid)) {
          bank.stack.push(bank.stack.pop() + 256 * chidx);
          return;
        }
      }
    }
    if (objid >= 0) {
      bank.stack.pop();
      bank.stack.push(-1);
    }
  }

  /**
   * `ForEach` with `IsCarriedCallback` (`doc/CSBwin-src/DSA.cpp:1520-1611`), true to end the
   * search. `thisObj` below 0 is champion `-thisObj - 1`: a find replaces the count on the
   * stack with the slot.
   */
  private forEach(bank: DsaBank, thisObj: number, srcObj: number): boolean {
    if (thisObj === OBJECT_ID_NULL) return false;
    if (thisObj < 0) {
      const chIdx = -thisObj - 1;
      const champ = this.ctx.party.state.champions[chIdx]!;
      for (let i = 0; i < 30; i++) {
        if (this.forEach(bank, getChampionPossession(champ, i), srcObj)) {
          bank.stack.pop();
          bank.stack.push(i);
          return true;
        }
      }
      if (chIdx === this.ctx.party.state.cursorOwner) {
        if (this.forEach(bank, this.ctx.party.state.objectInHand, srcObj)) {
          bank.stack.pop();
          bank.stack.push(255);
          return true;
        }
      }
      return false;
    }
    const obj = thisObj as ObjectID;
    // `IsCarriedCallback`.
    if (srcObj < 0) {
      const type = -srcObj === 1 ? 0 : -srcObj;
      if (type === GetBasicObjectType(this.dungeon, this.ctx.tables.objDescObjectType, obj)) {
        bank.stack.push(bank.stack.pop() + 1);
      }
    } else if (srcObj === thisObj) {
      bank.stack.push(bank.stack.pop() + 1);
      return true;
    }
    switch (this.dungeon.rnMaps.decode(obj).category) {
      case DBType.SCROLL:
      case DBType.POTION:
      case DBType.MISC:
      case DBType.CLOTHING:
      case DBType.WEAPON:
        break;
      case DBType.CHEST: {
        const chest = this.dungeon.getContainerRecord(obj);
        for (let contents = chest?.containedObject ?? OBJECT_ID_EOF; contents !== OBJECT_ID_EOF;
          contents = this.dungeon.getDBRecordLink(contents)) {
          if (this.forEach(bank, contents, srcObj)) return true;
        }
        break;
      }
      default:
        // `NotImplemented(0xdd6a)`.
        this.ctx.host.trace('DSA &ISCARRIED: not implemented 0xdd6a');
        break;
    }
    return false;
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

  private findMaster(slave: DsaDefinition, rnSlave: ObjectID, x: number, y: number, locrSlave: LocationRel): {
    rn: ObjectID;
    locr: LocationRel;
  } {
    if (slave.localState !== 3) {
      return { rn: rnSlave, locr: { l: locrSlave.l, x, y, p: locrSlave.p } };
    }
    this.ctx.host.trace('Slave DSA not implemented');
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
        this.ctx.host.trace(`Illegal DSA localState ${dsa.localState}`);
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
        this.ctx.host.trace(`Illegal DSA localState ${dsa.localState}`);
        break;
    }
  }

  private getTarget(
    targetType: number,
    thirtyTwo: boolean,
    readWord: () => number,
    bank: DsaBank,
    rnMaster: ObjectID,
  ): LocationRel | null {
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
    const locr = locationRelFromInteger(target);
    if (this.overrideP) {
      locr.p = this.overridePos & 3;
      this.overrideP = false;
    }
    return locr;
  }

  private queueDsaSwitchAction(delay: number, action: number, locr: LocationRel, morD: 'M' | 'D'): void {
    const actionTime = (this.ctx.state.tickCount + delay) >>> 0;
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
      const mapping = this.byte1596[roomType];
      if (mapping === 0) {
        this.ctx.host.trace(`Illegal DSA timer target (${locr.x},${locr.y}) L${locr.l}`);
        return;
      }
      functionType = mapping;
      this.timers.createTimer(functionType, locr.x, locr.y, targetPos, action, actionTime, locr.l);
      return;
    }

    this.timers.createTimer(functionType, locr.x, locr.y, locr.p, action, actionTime, locr.l);
  }

  private loadParameter(where: number, rnMaster: ObjectID): number {
    let rn = rnMaster;
    let slot = where;
    while (slot > 1) {
      rn = this.dungeon.getDBRecordLink(rn);
      if (rn === OBJECT_ID_EOF) break;
      const decoded = this.dungeon.rnMaps.decode(rn);
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

  private storeParameter(where: number, rnMaster: ObjectID, value: number): void {
    let rn = rnMaster;
    let slot = where;
    while (slot > 1) {
      rn = this.dungeon.getDBRecordLink(rn);
      if (rn === OBJECT_ID_EOF) break;
      const decoded = this.dungeon.rnMaps.decode(rn);
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

  private copyTeleporter(src: LocationRel, dst: LocationRel): void {
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

  private findFirstTeleporter(position: Position): ObjectID {
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (this.dungeon.rnMaps.dbType(rn) === DBType.TELEPORTER) return rn;
    }
    return OBJECT_ID_EOF;
  }

  private findFirstDsaActuator(position: Position): ObjectID {
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (this.dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
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
    const { index } = this.dungeon.rnMaps.decode(rn);
    return this.dungeon.getDoorRecordByIndex(index);
  }

  private updateCellFlag(locr: LocationRel, cellFlag: number): void {
    const map = this.dungeon.getMap(locr.l);
    if (!map) return;
    if (locr.x < 0 || locr.y < 0) return;
    if (locr.x >= map.descriptor.width || locr.y >= map.descriptor.height) return;
    map.cellFlags[locr.x][locr.y] = cellFlag & 0xff;
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
    const locr = locationRelFromInteger(locrInt);
    if (!this.dungeon.isValidLocation(locr)) return;
    const record = this.findTextRecordAtLocation(locr);
    if (!record) return;
    const text = this.dungeon.decodeTextString(record, 0x8001, this.ctx.tables.textDecode);
    if (!text) return;
    ctx.phraseTextOverrides[index] = text;
    ctx.phraseMask |= 1 << index;
    ctx.modified = true;
  }

  private findTextRecordAtLocation(locr: LocationRel): TextRecord | null {
    const pos = new Position(locr.x, locr.y, locr.l);
    for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = this.dungeon.rnMaps.decode(rn);
      if (decoded.category !== DBType.TEXT) continue;
      if ((decoded.position & 0x3) !== (locr.p & 0x3)) continue;
      return this.dungeon.getTextRecord(rn);
    }
    return null;
  }

  /** `RN::checkIndirectIndex(i)` (`doc/CSBwin-src/data.cpp:529-534`): a slot of the maps. */
  private isValidObjectId(objectId: number): objectId is ObjectID {
    return objectId >= 0 && this.dungeon.rnMaps.checkIndirectIndex(objectId);
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

  private deleteFromNegativeLocation(location: number): ObjectID | null {
    const party = this.ctx.party.state;
    if (!party) return null;
    if (location === -1) {
      const removed = party.objectInHand;
      if (removed === OBJECT_ID_NULL) return null;
      party.objectInHand = OBJECT_ID_NULL;
      return removed;
    }
    const loc = this.decodeCharacterLocation(location);
    if (!loc) return null;
    const champ = this.getChampion(party, loc.chIdx);
    if (!champ) return null;
    const possessions = champ.possessions;
    if (loc.posIdx < 0 || loc.posIdx >= possessions.length) return null;
    const removed = possessions[loc.posIdx]!;
    if (removed === OBJECT_ID_NULL) return null;
    return this.ctx.systems.character.removeCharacterPossession(loc.chIdx, loc.posIdx);
  }

  /** `EX_DEL`'s scroll arm (`doc/CSBwin-src/DSA.cpp:1715-1722`): its text goes first. */
  private deleteLinkedScrollText(rn: ObjectID, bank: DsaBank): void {
    if (!this.isValidObjectId(rn)) return;
    const { category } = this.dungeon.rnMaps.decode(rn);
    if (category !== DBType.SCROLL) return;
    const scroll = this.dungeon.getScrollRecord(rn);
    if (!scroll) return;
    // `pScroll->text()`, the six-byte scroll's RN.
    this.deleteObject(bank, scroll.textObject ?? this.dungeon.rnMaps.rn(DBType.TEXT, scroll.textReference & 0x3ff));
  }


  private canAddToLocation(location: number): boolean {
    if (location >= 0) {
      const locr = locationRelFromInteger(location);
      return this.dungeon.isValidLocation(locr);
    }
    const party = this.ctx.party.state;
    if (!party) return false;
    if (location === -1) {
      return party.objectInHand === OBJECT_ID_NULL;
    }
    if (location > -1000) {
      const loc = this.decodeCharacterLocation(location);
      if (!loc) return false;
      const champ = this.getChampion(party, loc.chIdx);
      if (!champ) return false;
      if (loc.posIdx < 0 || loc.posIdx >= 30) return false;
      return champ.possessions[loc.posIdx] === OBJECT_ID_NULL;
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

  private decodeMonsterLocation(location: number): ObjectID | null {
    if (location > -1000) return null;
    const monsterId = Math.trunc(-location / 1000);
    if (!this.isValidObjectId(monsterId)) return null;
    const decoded = this.dungeon.rnMaps.decode(monsterId);
    if (decoded.category !== DBType.CREATURE) return null;
    return monsterId;
  }

  private getChampion(party: PartyState, index: number): Champion | null {
    if (index < 0 || index >= party.champions.length) return null;
    return party.champions[index] ?? null;
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
    // `hTimer`: the cloud's timer, found by the check pass only (MoveObject.cpp:721-790).
    const hTimer = sourceCheck.timer ?? -1;
    const destCheck = this.checkDestination(
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
      hTimer,
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
  ): { error: number; object: ObjectID; timer?: number } {
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
    object: ObjectID,
    srcType: number,
    srcLoc: number,
    hTimer: number,
    doit: boolean,
  ): number {
    switch (dstType) {
      case 4:
        return this.findCharacterDestination(dstPosMsk, dstLoc, object, doit);
      case 2:
        return this.checkObjectToCursor(object, doit);
      case 1:
        return this.findCellDestination(dstObjMsk, dstPosMsk, dstLoc, dstDepth, object, srcType, srcLoc, hTimer, doit);
      case 5:
        return this.findChestDestination(dstLoc, dstDepth, object, doit);
      case 3:
        return this.findMonsterDestination(dstLoc, dstDepth, object, doit);
      default:
        return DsaMoveError.DER_UnknownLocType;
    }
  }

  private findCursorSource(doit: boolean): { error: number; object: ObjectID } {
    const party = this.ctx.party.state;
    if (!party) return { error: DsaMoveError.SER_NoObjInCursor, object: OBJECT_ID_EOF };
    const obj = party.objectInHand;
    if (obj === OBJECT_ID_NULL) return { error: DsaMoveError.SER_NoObjInCursor, object: OBJECT_ID_EOF };
    if (doit) party.objectInHand = OBJECT_ID_NULL;
    return { error: DsaMoveError.SER_OK, object: obj };
  }

  private findCharacterSource(chIdx: number, carryLoc: number, doit: boolean): { error: number; object: ObjectID } {
    const party = this.ctx.party.state;
    if (!party) return { error: DsaMoveError.SER_IllegalCharacterIndex, object: OBJECT_ID_EOF };
    if (chIdx < 0 || chIdx >= party.champions.length) {
      return { error: DsaMoveError.SER_IllegalCharacterIndex, object: OBJECT_ID_EOF };
    }
    if (carryLoc < 0 || carryLoc > 29) {
      return { error: DsaMoveError.SER_IllegalCarryLocation, object: OBJECT_ID_EOF };
    }
    const champ = this.getChampion(party, chIdx);
    if (!champ) return { error: DsaMoveError.SER_IllegalCharacterIndex, object: OBJECT_ID_EOF };
    const obj = champ.possessions[carryLoc]!;
    if (obj === OBJECT_ID_NULL) return { error: DsaMoveError.SER_NoObjectAtCarryLocation, object: OBJECT_ID_EOF };
    if (this.dungeon.rnMaps.dbType(obj) === DBType.CLOUD) {
      return { error: DsaMoveError.SER_NoCloudsPlease, object: OBJECT_ID_EOF };
    }
    if (doit) this.ctx.systems.character.removeCharacterPossession(chIdx, carryLoc);
    return { error: DsaMoveError.SER_OK, object: obj };
  }

  /**
   * `FindCellSource` (`doc/CSBwin-src/MoveObject.cpp:166-251`). Unlike the character,
   * monster and chest sources, a cell hands a cloud over: the check pass finds the
   * cloud's `TT_25` (or a Fluxcage's `TT_24`) and returns it as `hTimer` for
   * `FindCellDestination` to retarget, or `SER_BadCloudTimer` when there is none.
   * `TIMER_SEARCH` walks the slots in order, so the lowest slot wins, and `RN`'s `!=`
   * compares the indirect index only (`CSBTypes.h:353`) — the corner is not part of it.
   */
  private findCellSource(
    srcObjMsk: number,
    srcPosMsk: number,
    srcLoc: number,
    srcDepth: number,
    dstType: number,
    dstLoc: number,
    doit: boolean,
  ): { error: number; object: ObjectID; timer?: number } {
    const locr = locationRelFromInteger(srcLoc);
    if (!this.dungeon.isValidLocation(locr)) {
      return { error: DsaMoveError.SER_InvalidCellLocation, object: OBJECT_ID_EOF };
    }
    let positionMask = srcPosMsk;
    if (positionMask === -1) positionMask = 1 << (locr.p & 3);
    let depth = srcDepth;
    const pos = new Position(locr.x, locr.y, locr.l);
    let object = OBJECT_ID_EOF;
    for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = this.dungeon.rnMaps.decode(rn);
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
      const partyLevel = this.ctx.party.state.position.z;
      const sameLevelMonsterMove = this.dungeon.rnMaps.dbType(object) === DBType.CREATURE
        && dstType === 1
        && locationRelFromInteger(dstLoc).l === partyLevel
        && locr.l === partyLevel;
      if (!sameLevelMonsterMove) this.objectMover().moveObject(object as ObjectID, locr.x, locr.y, -1, 0, locr.l);
    } else if (this.dungeon.rnMaps.dbType(object) === DBType.CLOUD) {
      // The first match in `TIMER_SEARCH` order (`MoveObject.cpp:233-241`).
      for (const entry of this.timers.searchOrder()) {
        if (entry.function !== TimerFunction.TT_25 && entry.function !== TimerFunction.TT_24) continue;
        if (entry.object === undefined || !rnEquals(entry.object, object)) continue;
        return { error: DsaMoveError.SER_OK, object, timer: entry.index };
      }
      return { error: DsaMoveError.SER_BadCloudTimer, object };
    }
    return { error: DsaMoveError.SER_OK, object };
  }

  private findMonsterSource(
    srcObjMsk: number,
    srcLoc: number,
    srcDepth: number,
    doit: boolean,
  ): { error: number; object: ObjectID } {
    if (!this.isValidObjectId(srcLoc)) {
      return { error: DsaMoveError.SER_IllegalMonsterID, object: OBJECT_ID_EOF };
    }
    const decodedMon = this.dungeon.rnMaps.decode(srcLoc);
    if (decodedMon.category !== DBType.CREATURE) {
      return { error: DsaMoveError.SER_MonsterIsNotMonster, object: OBJECT_ID_EOF };
    }
    const monster = this.dungeon.getCreatureRecord(srcLoc);
    if (!monster) return { error: DsaMoveError.SER_MonsterIsNotMonster, object: OBJECT_ID_EOF };
    let depth = srcDepth;
    let prev = OBJECT_ID_EOF;
    for (let rn = monster.possession; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = this.dungeon.rnMaps.decode(rn);
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
  ): { error: number; object: ObjectID } {
    if (!this.isValidObjectId(srcLoc)) {
      return { error: DsaMoveError.SER_IllegalChestID, object: OBJECT_ID_EOF };
    }
    const decodedChest = this.dungeon.rnMaps.decode(srcLoc);
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
      const decoded = this.dungeon.rnMaps.decode(rn);
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
    object: ObjectID,
    doit: boolean,
  ): number {
    if (this.dungeon.rnMaps.dbType(object) === DBType.CLOUD) return DsaMoveError.DER_NoCloudsPlease;
    const party = this.ctx.party.state;
    if (!party) return DsaMoveError.DER_IllegalCharacterIndex;
    if (chIdx < 0 || chIdx >= party.champions.length) return DsaMoveError.DER_IllegalCharacterIndex;
    if (carryLoc < 0 || carryLoc > 29) return DsaMoveError.DER_IllegalPossessionIndex;
    const champ = this.getChampion(party, chIdx);
    if (!champ) return DsaMoveError.DER_IllegalCharacterIndex;
    if (champ.possessions[carryLoc] !== OBJECT_ID_NULL) return DsaMoveError.DER_PossessionSlotNotEmpty;
    const carryMask = this.getObjectCarryMask(object);
    const slotMask = this.getCarryLocationMask(carryLoc);
    if (carryMask === null || (carryMask & slotMask) === 0) {
      return DsaMoveError.DER_IllegalObjectForCarryLocation;
    }
    if (doit) this.ctx.systems.character.addCharacterPossession(chIdx, object, carryLoc);
    return DsaMoveError.DER_OK;
  }

  private checkObjectToCursor(object: ObjectID, doit: boolean): number {
    if (this.dungeon.rnMaps.dbType(object) === DBType.CLOUD) return DsaMoveError.DER_NoCloudsPlease;
    const party = this.ctx.party.state;
    if (!party) return DsaMoveError.DER_CursorNotEmpty;
    if (party.objectInHand !== OBJECT_ID_NULL) return DsaMoveError.DER_CursorNotEmpty;
    if (doit) party.objectInHand = object;
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
   * the `RN` (`CSBTypes.h:336-341`). Here the corner is part of the ID, so both timers
   * are handed the placed ID outright — the one `ProcessTT_25` and the missile's
   * removal will look for.
   */
  private findCellDestination(
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
    if (!this.dungeon.isValidLocation(locr)) return DsaMoveError.DER_InvalidCellLocation;
    if (dstDepth !== 0) return DsaMoveError.DER_IllegalDepth;
    const pos = this.choosePositionFromMask(dstPosMsk, locr.p & 3);
    if (doit) {
      const decoded = this.dungeon.rnMaps.decode(object);
      const placed = this.dungeon.rnMaps.setPos(object, pos);
      const partyLevel = this.ctx.party.state.position.z;
      const srcLocr = srcType === 1 ? locationRelFromInteger(srcLoc) : null;
      const sameLevelMonsterMove = decoded.category === DBType.CREATURE
        && locr.l === partyLevel
        && srcLocr !== null
        && srcLocr.l === locr.l;
      if (decoded.category === DBType.CREATURE && !sameLevelMonsterMove) {
        // Off the party's level, or arriving on it from elsewhere: the group has no
        // `ITEM16` until `MoveObject` attaches one (`:504-521`).
        const monster = this.dungeon.getCreatureRecord(object);
        if (monster) monster.groupIndex = this.detachedGroupIndex(monster);
      }
      if (decoded.category === DBType.CLOUD) {
        const timer = this.timers.getTimer(hTimer);
        if (timer) {
          timer.uByte6 = locr.x & 0xff;
          timer.uByte7 = locr.y & 0xff;
          timer.object = placed;
          timer.level = locr.l & 0xff;
        }
      }
      const mover = this.objectMover();
      if (!sameLevelMonsterMove) {
        this.dungeon.setDBRecordLink(object, OBJECT_ID_EOF);
        if (decoded.category === DBType.CREATURE) {
          // `object.pos(p)` rewrites the indirect index, so the monster's corner is `p`
          // wherever it ends up, whatever the stairs made of it.
          mover.moveMonster(object, -1, 0, locr.x, locr.y, locr.l, pos);
        } else {
          // `MoveObject(object, -1, 0, x, y)` and then `object.pos(p)` (`:531-538`): the
          // pads see the corner the object came with, and it lies in corner `p`.
          const result = mover.moveObject(object as ObjectID, -1, 0, locr.x, locr.y, locr.l);
          if (result.placed !== null && result.position && result.placed !== placed) {
            this.dungeon.removeObjectFromCell(result.position, result.placed);
            this.dungeon.addObjectToCell(result.position, placed);
          }
        }
      } else if (srcLocr) {
        // `MoveObject(object, srcX, srcY, x, y)`, and when it returns 0 — the group
        // is still there and its `ITEM16` did not change — every monster AI timer on
        // the level that named the source square is pointed at the destination
        // (`:539-571`). `MoveObject` itself leaves them behind, as the AI's own
        // steps do.
        const moved = mover.moveMonster(object as ObjectID, srcLocr.x, srcLocr.y, locr.x, locr.y, locr.l);
        if (moved.code === 0) {
          for (const timer of this.timers.getTimers()) {
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
        const missile = this.dungeon.getMissileRecord(placed);
        const timer = missile ? this.timers.getTimer(missile.timerIndex) : null;
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

  /**
   * The two halves of CSBWin's low-level `MoveObject` (`doc/CSBwin-src/Code11f52.cpp:2796`)
   * a DSA cell move goes through: `WorldMove.moveObject`, and its monster branch,
   * `MonsterSystem.moveMonster`.
   */
  private objectMover(): { moveObject: WorldMove['moveObject']; moveMonster: MonsterSystem['moveMonster'] } {
    const { worldMove, monsters } = this.ctx.systems;
    return {
      moveObject: (object, oldX, oldY, newX, newY, level) => worldMove.moveObject(object, oldX, oldY, newX, newY, level),
      moveMonster: (monster, oldX, oldY, newX, newY, level, cornerAfter) =>
        monsters.moveMonster(monster, oldX, oldY, newX, newY, level, cornerAfter),
    };
  }

  /** `groupIndex(0xd8)`, or `0xff` for a monster that fills the cell (`MoveObject.cpp:511-518`). */
  private detachedGroupIndex(monster: CreatureRecord): number {
    const desc = this.monsterDesc[monster.creatureType];
    return desc && monsterHorizontalSize(desc) === 2 ? 0xff : 0xd8;
  }

  private findChestDestination(dstLoc: number, dstDepth: number, object: ObjectID, doit: boolean): number {
    if (!this.isValidObjectId(dstLoc)) return DsaMoveError.DER_IllegalChestID;
    if (this.dungeon.rnMaps.dbType(object) === DBType.CLOUD) return DsaMoveError.DER_NoCloudsPlease;
    const decodedChest = this.dungeon.rnMaps.decode(dstLoc);
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

  private findMonsterDestination(dstLoc: number, dstDepth: number, object: ObjectID, doit: boolean): number {
    if (!this.isValidObjectId(dstLoc)) return DsaMoveError.DER_IllegalMonsterID;
    if (this.dungeon.rnMaps.dbType(object) === DBType.CLOUD) return DsaMoveError.DER_NoCloudsPlease;
    const decoded = this.dungeon.rnMaps.decode(dstLoc);
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
    if (!this.isValidObjectId(objectId)) return null;
    const descIndex = DescIndex(this.dungeon, objectId);
    if (descIndex === -1) return null;
    const mask = this.objDescWord4[descIndex];
    return typeof mask === 'number' ? mask : null;
  }

  private getCarryLocationMask(slot: number): number {
    const value = this.carryLocation[slot];
    return typeof value === 'number' ? value : 0;
  }


  private isObjectInCharactersOrCursor(objectId: ObjectID): boolean {
    const party = this.ctx.party.state;
    if (!party) return false;
    const visited = new Set<number>();
    for (const champion of party.champions) {
      for (const item of champion.possessions) {
        if (item === OBJECT_ID_NULL) continue;
        if (this.searchListForObject(objectId, item, visited)) return true;
      }
    }
    const cursorObj = party.objectInHand;
    if (cursorObj !== OBJECT_ID_NULL) {
      if (this.searchListForObject(objectId, cursorObj, visited)) return true;
    }
    return false;
  }

  private searchListForObject(target: ObjectID, head: ObjectID, visited: Set<number>): boolean {
    for (let rn = head; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = this.dungeon.getDBRecordLink(rn)) {
      if (rnEquals(rn, target)) return true;
      if (visited.has(rn)) continue;
      visited.add(rn);
      const decoded = this.dungeon.rnMaps.decode(rn);
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
    const { category, index } = this.dungeon.rnMaps.decode(objectId);
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

  private getActuator(rn: ObjectID): ActuatorRecord | null {
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
    const idx = this.random.below(positions.length); // STRandom(n), doc/CSBwin-src/DSA.cpp:2042
    return positions[idx] ?? fallback;
  }

  private copyItem(objectId: number): ObjectID | null {
    if (!this.isValidObjectId(objectId)) return null;
    const { category, index, position } = this.dungeon.rnMaps.decode(objectId);
    const data = this.dungeon.getData();
    // Each copy takes a record through `FindEmptyDB<n>Entry(true)` (`DSA.cpp:1773-1868`,
    // `DungeonState.findEmptyDBEntry`).
    const placed = (rn: ObjectID): ObjectID | null =>
      rn === OBJECT_ID_NULL ? null : this.dungeon.rnMaps.setPos(rn, position);

    switch (category) {
      case DBType.ACTUATOR: {
        const rec = data.databases.actuators.records[index];
        if (!rec) return null;
        return placed(this.dungeon.findEmptyDBEntry('actuators', { ...rec, nextObject: OBJECT_ID_EOF }, true));
      }
      case DBType.MISC: {
        const rec = data.databases.misc.records[index];
        if (!rec) return null;
        return placed(this.dungeon.findEmptyDBEntry('misc', { ...rec, nextObject: OBJECT_ID_EOF }, true));
      }
      case DBType.WEAPON: {
        const rec = data.databases.weapons.records[index];
        if (!rec) return null;
        return placed(this.dungeon.findEmptyDBEntry('weapons', { ...rec, nextObject: OBJECT_ID_EOF }, true));
      }
      case DBType.CLOTHING: {
        const rec = data.databases.clothing.records[index];
        if (!rec) return null;
        return placed(this.dungeon.findEmptyDBEntry('clothing', { ...rec, nextObject: OBJECT_ID_EOF }, true));
      }
      case DBType.POTION: {
        const rec = data.databases.potions.records[index];
        if (!rec) return null;
        return placed(this.dungeon.findEmptyDBEntry('potions', { ...rec, nextObject: OBJECT_ID_EOF }, true));
      }
      case DBType.CREATURE: {
        const rec = data.databases.creatures.records[index];
        if (!rec) return null;
        const copiedPossessions = this.copyItemList(rec.possession);
        // The copy must not inherit the original's ITEM16 slot. CSBWin parks it at
        // 0xd8, or 0xff for a monster that fills the whole cell, so that every
        // `groupIndex() < d.MaxITEM16` test reads it as unattached
        // (doc/CSBwin-src/DSA.cpp:1884-1887).
        return placed(this.dungeon.findEmptyDBEntry('creatures', {
          ...rec,
          nextObject: OBJECT_ID_EOF,
          possession: copiedPossessions,
          groupIndex: this.detachedGroupIndex(rec),
        }, true));
      }
      default:
        this.ctx.host.trace(`DSA &ADD unsupported object type ${category}`);
        return null;
    }
  }

  private copyItemList(head: ObjectID): ObjectID {
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

  /**
   * `STKOP_TeleportParty` (doc/CSBwin-src/DSA.cpp:4583): the party moved by a pretend
   * teleporter — `what(2)`, party and objects — through the world `MoveObject`, which
   * resolves whatever the destination does to them.
   */
  private teleportParty(locr: LocationRel): void {
    const party = this.ctx.party.state;
    const pretendTeleporter: TeleporterRecord = {
      nextObject: OBJECT_ID_EOF,
      sound: false,
      scope: 2,
      absoluteRotation: false,
      rotation: locr.p & 0x3,
      destX: locr.x & 0x1f,
      destY: locr.y & 0x1f,
      destMap: locr.l & 0xff,
    };

    this.ctx.systems.worldMove.moveParty(
      party.position.x, party.position.y, party.position.x, party.position.y, pretendTeleporter,
    );
  }
}
