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
import {
  RN_DISPELL_MISSILE, RN_FIREBALL, RN_FLUX_CAGE, RN_MONSTER_DEATH, RN_POISON_CLOUD, RN_ZO_SPELL,
} from '../core/spellRn';
import type { ActuatorRecord, CreatureRecord, DsaDefinition, DsaState, TeleporterRecord } from '../data/dungeonTypes';
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
import { extendedCellFlagsKey, type DungeonState } from './DungeonState';
import { nameIndexOf, type GameContext } from './GameContext';
import { getChampionPossession, type PartyState, type Champion } from './gameTypes';
import { vacantPossession } from '../data/CsbwinCharacters';
import { TimerFunction } from './TimerQueue';
import type { TimerEntry, TimerQueue } from './TimerQueue';
import type { MonsterSystem } from './MonsterSystem';
import { MonsterEvents, type MmRecord } from './MmRecord';
import type { WorldMove } from './WorldMove';
import type { CsbRandom } from '../core/random';
import type { MonsterDesc } from '../data/tables/MonsterDesc';
import { monsterHorizontalSize } from '../data/tables/MonsterDesc';
import { monsterDrawAsSize4, monsterInvisible, monsterPoisoned, monsterUnique } from './MonsterSystem';
import { printWithSubstitution } from './PrintWithSubstitution';
import { findChampionByFingerprint } from './Party';
import { swapCharacter } from './SwapCharacter';
import { getFromWings, locateInWings, saveToWings, wingsChampion } from './Wings';
import { readU32LE, writeU32LE } from '../core/bytes';
import { decodeCharField } from '../data/CsbwinSaveInfo';
import { EDT_GLOBAL_TEXT, GetText } from '../data/DecodeText';
import { messageParametersKey, readGlobalVariables } from '../data/CsbwinExpool';
import { FEED_PARAMETER_WORDS, feedParametersFromWords, feedParametersToWords, type FeedParameters } from './Feeding';
import {
  ATTACK_PARAMETER_WORDS, attackParametersFromWords, attackParametersToWords, type AttackParameters,
} from './MonsterAttack';
import {
  DELETE_MONSTER_PARAMETER_WORDS, deleteMonsterParametersFromWords, deleteMonsterParametersToWords,
  type DeleteMonsterParameters,
} from './MonsterDamage';
import { PARTY_MOVE_DATA_WORDS, partyMoveDataFromWords, partyMoveDataToWords, type PartyMoveData } from './MovementSystem';

/** Which of CSBWin's viewing-filter sites runs the filter (`doc/CSBwin-src/Character.cpp`). */
export enum ViewingFilterSite {
  /** `DescribeObject`'s description (`:3766`): parameter 0 is the phrase mask as it stands. */
  DESCRIPTION,
  /** `DescribeObject`'s scroll (`:3506`): parameter 0 is 0, and a DSA may name another scroll. */
  SCROLL,
  /**
   * `TAG019036`'s, the eye clicked with an empty hand (`:4524-4578`): parameter 0 is 0
   * and the object -1, whatever `objectId` says, and nothing the DSAs leave is read.
   */
  ATTRIBUTES,
}

export interface ViewingFilterOptions {
  site: ViewingFilterSite;
  phraseMask: number;
  objectId: ObjectID;
  selectedCharacter: number;
}

/** The one type-47 actuator `SetupDSAParam` picked out (`doc/CSBwin-src/Attack.cpp:434`). */
export interface PartyAttackFilter {
  position: Position;
  actuator: ObjectID;
}

export interface ViewingFilterResult {
  phraseMask: number;
  /** The scroll the scroll site draws: the last one a DSA named, or the object it was given. */
  objectId: ObjectID;
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
/** `CURSORFILTER_TYPE` (`doc/CSBwin-src/CSB.h:1395-1514`): what is about to happen to the object. */
export enum CursorFilterType {
  Unknown = 0,
  ReadGame = 1,
  PickFromFloor = 2,
  PlaceOnCharacter = 3,
  PickFromCharacter = 4,
  Throw = 5,
  EnteringPrison = 6,
  DropObject = 7,
  Eat = 8,
  ResumeSavedGame = 9,
  DSA_DEL = 10,
  DSA_ADD = 11,
  TakeFromTorchHolder = 12,
  PlaceInTorchHolder = 13,
  SwapRemove = 14,
  SwapReplace = 15,
  GiftFromGod = 16,
  TakeKey = 17,
  DSA_MoveFrom = 18,
  DSA_MoveTo = 19,
  /** What a DSA sets `type` to, to cancel what can be cancelled. */
  Cancel = 20,
}

/**
 * `CURSORFILTER_PACKET` (`doc/CSBwin-src/CSB.h:1517-1526`), six `int`s. `object` is the RN
 * as `ConvertToInteger` gives it, `RNnul` 0xFFFF for none; `p1` to `p4` are the type's
 * own, 0 when it has none: for an actuator's, the level, the square and the wall side.
 */
export interface CursorFilterPacket {
  object: number;
  type: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
}

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
/** `gameVolume`'s default (`doc/CSBwin-src/Data.h:42`, `data.cpp:277`). */
const VOLUME_FULL = 0;
const ESL_MISSILE_ENCOUNTER_FILTER = 13;
const ESL_ADJUST_SKILLS_FILTER = 6;
const ESL_VIEWING_FILTER = 3;
const ESL_PARTY_ATTACK_FILTER = 4;
const VIEWING_FILTER_KEY = (EDT_SPECIAL_LOCATIONS << 24) | ESL_VIEWING_FILTER;
const PARTY_ATTACK_FILTER_KEY = (EDT_SPECIAL_LOCATIONS << 24) | ESL_PARTY_ATTACK_FILTER;
const ESL_SOUND_FILTER = 8;
const ESL_ACTION_NAME_FILTER = 10;
const ESL_FEEDING_FILTER = 1;
const ESL_CHAR_DEATH_FILTER = 11;
const ESL_DAMAGE_CHAR_FILTER = 15;
const ESL_EQUIP_FILTER = 12;
const ESL_PARTY_MOVE_FILTER = 14;
const ESL_MONSTER_ATTACK_FILTER = 0;
const ESL_DELETE_MONSTER_FILTER = 7;
const ESL_MONSTER_MOVE_FILTER = 2;
const ESL_CURSOR_FILTER = 9;
const MONSTER_MOVE_FILTER_KEY = (EDT_SPECIAL_LOCATIONS << 24) | ESL_MONSTER_MOVE_FILTER;
const ESL_INDIRECT_ACTIONS = 5;
const INDIRECT_ACTIONS_KEY = (EDT_SPECIAL_LOCATIONS << 24) | ESL_INDIRECT_ACTIONS;

/**
 * `EX_AMPERSAND`'s unpacking of `I_Indirect` (`doc/CSBwin-src/DSA.cpp:2350-2369`): the
 * operation a parameter record's first word names, and the one it runs. `I_FilteredCast`
 * is here though no operation packs it: it has no case of its own in `EX_AMPERSAND`.
 */
const INDIRECT_OPERATIONS: ReadonlyMap<number, StkOp> = new Map([
  [StkOp.I_DEL, StkOp.DEL],
  [StkOp.I_DEL_MON, StkOp.DEL_MON],
  [StkOp.I_INS_MON, StkOp.INS_MON],
  [StkOp.I_ADD, StkOp.ADD],
  [StkOp.I_CREATE_CLOUD, StkOp.CREATE_CLOUD],
  [StkOp.I_CAST, StkOp.CAST],
  [StkOp.I_FILTERED_CAST, StkOp.FILTERED_CAST],
  [StkOp.I_TELEPORT_PARTY, StkOp.TELEPORT_PARTY],
  [StkOp.I_MONSTER_STORE, StkOp.MONSTER_STORE],
  [StkOp.I_CHAR_STORE, StkOp.CHAR_STORE],
  [StkOp.I_CAUSE_POISON, StkOp.CAUSE_POISON],
  [StkOp.I_MOVE, StkOp.MOVE],
  [StkOp.I_COPY, StkOp.COPY],
  [StkOp.I_CELL_STORE, StkOp.CELL_STORE],
  [StkOp.I_THROW, StkOp.THROW],
  [StkOp.I_SWAP_CHARACTER, StkOp.SWAP_CHARACTER],
]);

/**
 * `sizeof(ATTACKPARAMETERS)` — what `SetupDSAParam` writes into `pDSAparameters[0]`
 * (`doc/CSBwin-src/Attack.cpp:1361`). It is a byte count where every other filter
 * stores a word count, which is CSBWin's own inconsistency; since `PARAM_FETCH`
 * clamps its request to 100 first, an over-large count behaves as "all of them".
 */
const PARTY_ATTACK_PARAM_SIZEOF = 124;
/** The `ATTACKPARAMETERS` words, `sizeof(ATTACKPARAMETERS) / 4`. */
const PARTY_ATTACK_PARAM_WORDS = PARTY_ATTACK_PARAM_SIZEOF / 4;

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

/** `DSAVARS` (`doc/CSBwin-src/CSB.h:2877-2882`): a DSA run's variables. */
export class DsaVars {
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
  /**
   * `numText` and `textStrings` (`doc/CSBwin-src/DSA.cpp:126-127`): the run's ten texts,
   * which `&TEXT@` and `&CHARNAME@` set, none until the first is.
   */
  private texts: Array<string | null> | null = null;

  /** `trace` says what CSBWin's `NoValue` asks in its message box. */
  constructor(public vars: DsaVars, private readonly trace: (line: string) => void) {}

  /** `DSADBANK::SetText` (`doc/CSBwin-src/DSA.cpp:194-205`): an index past 9 sets nothing. */
  setText(text: string, index: number): void {
    if (index > 9) return;
    this.texts ??= new Array<string | null>(10).fill(null);
    this.texts[index] = text;
  }

  /**
   * `DSADBANK::GetText` (`doc/CSBwin-src/DSA.cpp:207-212`): "" for a text never set. An
   * index past 9 reads past CSBWin's array once any text is set; here it reads "".
   */
  getText(index: number): string {
    if (!this.texts) return '';
    return this.texts[index >>> 0] ?? '';
  }

  /**
   * `DSADBANK::Var(i)` (`doc/CSBwin-src/DSA.cpp:141`): a variable not well defined, never
   * set or past a short `&PARAM@`, is zeroed by the read (`NoValue`).
   */
  getVar(index: number): number {
    if (index < 0 || index >= this.vars.values.length) return 0;
    if (this.vars.definedFlags[index] !== DsaVarType.WellDefined) {
      this.noValue(index);
      return 0;
    }
    return this.vars.values[index] ?? 0;
  }

  /**
   * `DSADBANK::NoValue` (`doc/CSBwin-src/DSA.cpp:227-238`): the variable is zeroed, and
   * the message box CSBWin raises, until its player answers "yes" to suppress it, is a
   * trace each time.
   */
  private noValue(index: number): void {
    this.vars.values[index] = 0;
    this.trace(`DSA variable[${index}] used without having been assigned a value.`);
  }

  setVar(index: number, value: number): void {
    if (index < 0 || index >= this.vars.values.length) return;
    this.vars.values[index] = value | 0;
    this.vars.definedFlags[index] = DsaVarType.WellDefined;
  }

  /**
   * `DSADBANK::SetVarBit` (`doc/CSBwin-src/DSA.cpp:143`): a variable not well defined is
   * zeroed (`NoValue`) before the bit goes in, and is still not well defined after.
   * `&CELL@`, its one caller, has set the variable to 0 first.
   */
  setVarBit(index: number, bitmask: number): void {
    if (index < 0 || index >= this.vars.values.length) return;
    if (this.vars.definedFlags[index] !== DsaVarType.WellDefined) this.noValue(index);
    this.vars.values[index] = (this.vars.values[index] ?? 0) | bitmask;
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

/**
 * The timer a filter site hands `ProcessDSAFilter`: the filter's square on its level, with
 * function and position 0 (`doc/CSBwin-src/CSBCode.cpp:8683-8689`, `Sound.cpp:724-727`).
 */
function filterTimer(position: Position): TimerEntry {
  return {
    index: -1,
    time: 0,
    level: position.z & 0xff,
    function: 0,
    uByte5: 0,
    uByte6: position.x & 0xff,
    uByte7: position.y & 0xff,
    uByte8: 0,
    uByte9: 0,
    sequence: 0,
    timerWord8: 0,
    timerWord6: 0,
  };
}

/**
 * `MONSTERMOVEFILTERLOCATION` (`doc/CSBwin-src/CSB.h:441-447`): where a level's monster
 * move filter is, and when it runs. `partyLevelOnly` is the record's bit 18, or 0xffff
 * when there is no record; `filterObj` is the first type-47 actuator at `locr`, or
 * `OBJECT_ID_EOF`.
 */
interface MonsterMoveFilterLocation {
  locr: LocationRel;
  maxDistance: number;
  partyLevelOnly: number;
  filterObj: ObjectID;
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

/** `teleporterBit` (`doc/CSBwin-src/DSA.cpp:2208`): `ExamineCell`'s bit for a teleporter's `what`. */
const TELEPORTER_BIT = [11, 15, 13, 17];

/** `JUMP*`'s transfer, which `execute` takes as `EX_JUMP`'s (`doc/CSBwin-src/DSA.cpp:4737-4745`). */
interface GearJump {
  state: number;
  col: number;
}

/** `talents`' offset in a `CHARDESC`, a longword `swapCharacter` leaves little-endian. */
const CHARDESC_TALENTS = 276;

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
  private parameters: Int32Array = new Int32Array(101);
  private adjustSkillsParameters = new Int32Array(5);
  /**
   * `globalVariables` — where a dungeon's DSAs keep their puzzle progress, so a read
   * has to carry them (`getGlobalVariables` / `setGlobalVariables`). Its length is
   * `numGlobalVariables`: a game read takes both from its `EXPOOL`
   * (`readGlobalVariables`), and a save puts them back (`Expool.storeGlobalVariables`).
   */
  private globalVariables: Int32Array;
  /**
   * `monsterMoveFilterActive` (`doc/CSBwin-src/data.cpp:85`), which `ProcessDSAFilter`
   * sets while the monster move filter runs (`Monster.cpp:3229`, `:3355`) and
   * `&MONL&D` reads: before a group's turn and after it.
   */
  monsterMoveFilterActive = false;
  /**
   * `monsterMoveFilterCache` (`doc/CSBwin-src/Monster.cpp:3059`): each level's
   * `MONSTERMOVEFILTERLOCATION` once a turn on it has looked, and the dungeon's, which
   * every level without a key of its own copies. Nothing empties it (`Clear`,
   * `CSB.h:458`, has no body and no caller), so it holds for as long as the system lives.
   */
  private readonly monsterMoveFilterLocations = new Map<number, MonsterMoveFilterLocation>();
  private monsterMoveFilterGlobal: MonsterMoveFilterLocation | null = null;
  /** `SoundFilter`'s `filterActive` (`doc/CSBwin-src/Sound.cpp:672`): its DSAs are running. */
  private soundFilterActive = false;
  /**
   * `actionNameDSA` (`doc/CSBwin-src/CSBCode.cpp:8631`): `OBJECT_ID_NULL` until
   * `actionNameFilter` first looks, then the filter's DSA, or `OBJECT_ID_EOF` for none, for
   * as long as the system lives. `actionNameFilterPos` is `actionNameFilterLocr` (`:8630`).
   */
  private actionNameDsa: ObjectID = OBJECT_ID_NULL;
  private actionNameFilterPos: Position | null = null;
  /**
   * `parameterMessageSequence` (`doc/CSBwin-src/data.cpp:88`): the `uByte5` of the next
   * `TT_ParameterMessage` timer, so that two set at one time run in the order they were
   * set (`TIMER::operator<`, `Timer.cpp:779-791`). Back to 0 at every `d.Time++`
   * (`CSBCode.cpp:676`, `Attack.cpp:2210`) and at a load (`SaveGame.cpp:1625`).
   */
  parameterMessageSequence = 0;
  /**
   * `disableSaves` (`doc/CSBwin-src/data.cpp:58`), which `&DISABLESAVES` sets: while it
   * holds, nothing saves the game (`GameSaves`). A read takes it from its `EXPOOL` record
   * (`readDisableSaves`), and a save writes that record (`Expool.writeDisableSaves`).
   */
  disableSaves = false;
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
    this.globalVariables = Int32Array.from(readGlobalVariables(ctx.state.dungeon));
  }

  setParameters(count: number, values: ArrayLike<number>): void {
    const n = Math.min(Math.max(count, 0), 100);
    this.parameters[0] = n;
    for (let i = 0; i < n; i++) {
      this.parameters[1 + i] = values[i] ?? 0;
    }
  }

  /**
   * What a room timer leaves in the DSA parameters before it reaches its square's DSAs
   * (`ProcessTT_FALSEWALL`, `doc/CSBwin-src/Timer.cpp:1399-1407`; `ProcessTT_OPENROOM`,
   * `:1699-1707`; `ProcessTT_STONEROOM`, `:2178-2186`): a parameter message's own, which
   * leave `EXPOOL`, with a count of -1 when the record is gone (`EXPOOL::Read`'s -1); a
   * count of 0 for any other timer. The words past the count stay as they were.
   */
  readRoomTimerParameters(timer: TimerEntry): void {
    if (timer.function !== TimerFunction.TT_PARAMETER_MESSAGE) {
      this.parameters[0] = 0;
      return;
    }
    const record = this.dungeon.readExpoolRecord(messageParametersKey(timer.index));
    this.parameters[0] = record === null ? -1 : record.length;
    record?.forEach((value, i) => { this.parameters[1 + i] = value; });
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

  /**
   * The DSAs of the filter at special location `esl`, as CSBWin's looping filter sites run
   * them (`SoundFilter`'s, `doc/CSBwin-src/Sound.cpp:681-748`, is one): `EXPOOL`'s record
   * `(EDT_SpecialLocations << 24) | esl` names the location, and every type-47 actuator on
   * its square runs in turn, a filter call apiece (`ProcessDSAFilter`), on a timer that
   * names the square with function and position 0, and on the current parameters: a site
   * with a `NEWDSAPARAMETERS` calls this inside `newDsaParameters`. `each` sets a DSA's
   * parameters, calls `run`, and reads back what it needs. False when none ran. A site
   * that `break`s once its DSA has run (`KillCharacter`'s, `Character.cpp:2586`) passes
   * `firstOnly`, and only the first runs. Each DSA has its `DSAVARS` (`Sound.cpp:721`),
   * which every `run` of it shares: `SetPossession` calls one DSA twice, the second time
   * with timer function 0 after the first's 1 (`Character.cpp:2975-2986`).
   */
  private forEachFilterDsa(esl: number, each: (run: (timerFunction?: number) => void) => void, firstOnly = false): boolean {
    const special = this.dungeon.getSpecialLocation((EDT_SPECIAL_LOCATIONS << 24) | esl);
    if (special === null) return false;
    return this.forEachDsaAt(locationRelFromInteger(special), each, firstOnly);
  }

  /**
   * `forEachFilterDsa` at a location the site has found by other means: the spell
   * filter's is the dungeon's `SpellFilterLocation`, not an `EXPOOL` record. False when the
   * location is not in the dungeon, or no DSA ran.
   */
  private forEachDsaAt(
    locrFilter: LocationRel,
    each: (run: (timerFunction?: number) => void) => void,
    firstOnly = false,
  ): boolean {
    if (!this.dungeon.isValidLocation(locrFilter)) return false;
    const filterPos = new Position(locrFilter.x, locrFilter.y, locrFilter.l);
    const timer = filterTimer(filterPos);
    let found = false;
    for (let rn = this.dungeon.findFirstObject(filterPos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (this.dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec || getActuatorType(rec) !== 47) continue;
      found = true;
      const vars = new DsaVars();
      each((timerFunction = 0) => {
        timer.uByte9 = timerFunction;
        this.processTimer6Internal(rn, timer, filterPos, true, vars);
      });
      if (firstOnly) break;
    }
    return found;
  }

  /**
   * `SoundFilter` (`doc/CSBwin-src/Sound.cpp:670-756`), which `QueueSound` calls with the
   * volume it chose, -1 for a sound out of earshot (`doc/CSBwin-src/CSBCode.cpp:1877`), and
   * the sound's square on its level. Every DSA at `ESL_SOUNDFILTER`'s location runs, and
   * plays the sound if it pleases (`&SOUND`). 0 when one ran, and the sound is theirs; 1
   * when none did; 2 while they run, so a sound queued meanwhile plays on.
   *
   * The nine parameters (`:730-739`): the sound's ordinal plus 1, the volume, the squared
   * distance to the party, the level, x and y, `gameVolume`, `NoSound`, and the distance in
   * hundredths, three Newton steps from the larger of `dx` and `dy`. The port has no volume
   * menu and no recording's `#NoSound` (`doc/CSBwin-src/Recording.cpp:321`): its page sets
   * its own volume, so the two are CSBWin's defaults, `VOLUME_FULL` (0) and false
   * (`doc/CSBwin-src/data.cpp:249`, `:277`).
   */
  soundFilter(soundNumber: number, highVolume: number, level: number, x: number, y: number): number {
    if (this.soundFilterActive) return 2;
    const party = this.ctx.party.state.position;
    const dx = Math.abs(party.x - x);
    const dy = Math.abs(party.y - y);
    const distanceSquared = dx * dx + dy * dy;
    let distance100 = 100 * (dx > dy ? dx : dy);
    if (distanceSquared > 0) {
      const d2 = distanceSquared * 10000;
      for (let i = 0; i < 3; i++) distance100 = Math.trunc((distance100 + Math.trunc(d2 / distance100)) / 2);
    }
    this.newDsaParameters(() => this.forEachFilterDsa(ESL_SOUND_FILTER, (run) => {
      this.setParameters(9, [
        soundNumber + 1, highVolume, distanceSquared, level, x, y, VOLUME_FULL, 0, distance100,
      ]);
      this.soundFilterActive = true;
      run();
    }));
    if (!this.soundFilterActive) return 1;
    this.soundFilterActive = false;
    return 0;
  }

  /**
   * The feeding filter (`doc/CSBwin-src/Character.cpp:4288-4344`), which `_FeedCharacter`
   * runs once it has worked out what the object is worth, and before anything changes:
   * every DSA at `ESL_FEEDINGFILTER`'s location in turn, each on the block as the DSA
   * before it left it, a count of 27 and the block's longwords (`:4333-4336`). Back comes
   * the block, which is what the feeding then does. `_FeedCharacter` has no
   * `NEWDSAPARAMETERS`, so the DSAs run on the caller's parameters and leave them theirs.
   */
  feedingFilter(fp: FeedParameters): FeedParameters {
    let block = fp;
    this.forEachFilterDsa(ESL_FEEDING_FILTER, (run) => {
      this.setParameters(FEED_PARAMETER_WORDS, feedParametersToWords(block));
      run();
      block = feedParametersFromWords((i) => this.getParameter(i));
    });
    return block;
  }

  /**
   * `CursorFilter` (`doc/CSBwin-src/MoveObject.cpp:797-865`), which a site calls before
   * it does something to the object on the cursor: every DSA at `ESL_CURSORFILTER`'s
   * location in turn, each on the packet as the DSA before it left it, a count of 6 and
   * the packet's six words (`:846-847`). Back comes the whole packet, into `cfp`
   * (`:849`); a site that can be cancelled reads its `type` against
   * `CursorFilterType.Cancel`. There is no `NEWDSAPARAMETERS`, so the DSAs run on the
   * caller's parameters and leave them theirs.
   */
  cursorFilter(cfp: CursorFilterPacket): void {
    this.forEachFilterDsa(ESL_CURSOR_FILTER, (run) => {
      this.setParameters(6, [cfp.object, cfp.type, cfp.p1, cfp.p2, cfp.p3, cfp.p4]);
      run();
      cfp.object = this.getParameter(0);
      cfp.type = this.getParameter(1);
      cfp.p1 = this.getParameter(2);
      cfp.p2 = this.getParameter(3);
      cfp.p3 = this.getParameter(4);
      cfp.p4 = this.getParameter(5);
    });
  }

  /**
   * The character death filter (`doc/CSBwin-src/Character.cpp:2535-2589`), which
   * `KillCharacter` runs before it touches the champion: the first DSA at
   * `ESL_CHARDEATHFILTER`'s location, on parameters of its own, a count of 1 and the
   * champion's index. Nothing comes back.
   */
  charDeathFilter(chIdx: number): void {
    this.newDsaParameters(() => this.forEachFilterDsa(ESL_CHAR_DEATH_FILTER, (run) => {
      this.setParameters(1, [chIdx]);
      run();
    }, true));
  }

  /**
   * The equip filter (`doc/CSBwin-src/Character.cpp:2917-2998`), which
   * `CHARDESC::SetPossession` runs before it writes slot `slot` of champion `chIdx`: the
   * first DSA at `ESL_EQUIPFILTER`'s location, on parameters of its own, a count of 4 and
   * the champion's index, the slot, an object and 0, set once (`:2968-2971`). It runs
   * twice on the same variables and parameters, only the object (`pDSAparameters[3]`) set
   * again: with timer function 1 for `leaving`, what the slot holds, and with 0 for
   * `arriving`, each when it is not `RNnul` (`:2975-2986`). Nothing comes back.
   */
  equipFilter(chIdx: number, slot: number, leaving: ObjectID, arriving: ObjectID): void {
    this.newDsaParameters(() => this.forEachFilterDsa(ESL_EQUIP_FILTER, (run) => {
      this.setParameters(4, [chIdx, slot, 0, 0]);
      if (leaving !== OBJECT_ID_NULL) {
        this.parameters[3] = leaving;
        run(1);
      }
      if (arriving !== OBJECT_ID_NULL) {
        this.parameters[3] = arriving;
        run(0);
      }
    }, true));
  }

  /**
   * `CallPartyMoveFilter` (`doc/CSBwin-src/CSBCode.cpp:7788-7848`), which `_TurnParty`,
   * `MoveParty` and `TraverseStairway` run before the party moves: the first DSA at
   * `ESL_PARTYMOVEFILTER`'s location, on parameters of its own, a count of 13 and the
   * block's longwords (`:7835-7836`). Back comes the block, all of it (`:7839`), which
   * the move then obeys; `pmd` when no DSA stands there.
   */
  partyMoveFilter(pmd: PartyMoveData): PartyMoveData {
    let block = pmd;
    this.newDsaParameters(() => this.forEachFilterDsa(ESL_PARTY_MOVE_FILTER, (run) => {
      this.setParameters(PARTY_MOVE_DATA_WORDS, partyMoveDataToWords(block));
      run();
      block = partyMoveDataFromWords((i) => this.getParameter(i));
    }, true));
    return block;
  }

  /**
   * The monster attack filter (`doc/CSBwin-src/Monster.cpp:1125-1171`), which
   * `MonsterAttacks` runs once the block is filled and before it acts on it: every DSA at
   * `ESL_MONSTERATTACKFILTER`'s location in turn, each on the block as the DSA before it
   * left it, a count of 20 and the block's longwords (`:1164-1165`), and on parameters of
   * its own, a `NEWDSAPARAMETERS` apiece (`:1153`). Back comes the whole block, into `p`
   * (`:1167`).
   */
  monsterAttackFilter(p: AttackParameters): void {
    this.forEachFilterDsa(ESL_MONSTER_ATTACK_FILTER, (run) => this.newDsaParameters(() => {
      this.setParameters(ATTACK_PARAMETER_WORDS, attackParametersToWords(p));
      run();
      attackParametersFromWords(p, (i) => this.getParameter(i));
    }));
  }

  /**
   * The delete monster filter (`doc/CSBwin-src/Code11f52.cpp:965-1019`), which
   * `ProcessMonsterDeleteFilter` runs once it has counted the kill: every DSA at
   * `ESL_DELETEMONSTERFILTER`'s location in turn, each on the block as the DSA before it
   * left it, a count of 8 and the block's longwords (`:1011-1012`). Back comes the whole
   * block, into `p` (`:1014`). The function has one `NEWDSAPARAMETERS` (`:928`), so the
   * DSAs run on parameters of their own, which they share.
   */
  deleteMonsterFilter(p: DeleteMonsterParameters): void {
    this.newDsaParameters(() => this.forEachFilterDsa(ESL_DELETE_MONSTER_FILTER, (run) => {
      this.setParameters(DELETE_MONSTER_PARAMETER_WORDS, deleteMonsterParametersToWords(p));
      run();
      deleteMonsterParametersFromWords(p, (i) => this.getParameter(i));
    }));
  }

  /**
   * `MONSTERMOVEFILTERCACHE::GetLocation` (`doc/CSBwin-src/Monster.cpp:3077-3166`): the
   * level's own record, keyed with `(level + 1) << 8`, and failing that the dungeon's,
   * looked up once. The record's bits 0-17 are the location, bit 18 `partyLevelOnly` and
   * bits 19-23 `maxDistance`. A level with a record of its own keeps it even when no
   * type-47 actuator stands there, and then has no filter.
   */
  private monsterMoveFilterLocation(level: number): MonsterMoveFilterLocation {
    const cached = this.monsterMoveFilterLocations.get(level);
    if (cached) return cached;
    const fromRecord = (record: number | null): MonsterMoveFilterLocation => {
      if (record === null) {
        return { locr: { l: 0, x: 0, y: 0, p: 0 }, maxDistance: 0, partyLevelOnly: 0xffff, filterObj: OBJECT_ID_EOF };
      }
      const locr = locationRelFromInteger(record & 0x03ffff);
      const filterObj = this.dungeon.isValidLocation(locr)
        ? this.findFirstDsaActuator(new Position(locr.x, locr.y, locr.l))
        : OBJECT_ID_EOF;
      return { locr, maxDistance: (record & 0xf80000) >>> 19, partyLevelOnly: (record & 0x040000) >>> 18, filterObj };
    };
    let location = fromRecord(this.dungeon.getSpecialLocation((MONSTER_MOVE_FILTER_KEY | ((level + 1) << 8)) >>> 0));
    if (location.partyLevelOnly === 0xffff) {
      this.monsterMoveFilterGlobal ??= fromRecord(this.dungeon.getSpecialLocation(MONSTER_MOVE_FILTER_KEY));
      location = { ...this.monsterMoveFilterGlobal };
    }
    this.monsterMoveFilterLocations.set(level, location);
    return location;
  }

  /**
   * The monster move filter before a group's turn (`doc/CSBwin-src/Monster.cpp:3311-3357`),
   * which `ProcessTimers29to41` runs once it has cleared `monsterMoveInhibit`, for the
   * group `monster` at `mapX, mapY` on `level`, whose timer function is `timerFunction`.
   * It runs when that function is above 0, so never for a reaction (`TT_M1` to `TT_M3`),
   * when the level's location has a DSA, when the group is on the party's level or the
   * location's `partyLevelOnly` is 0, and when the group is within `maxDistance` of the
   * party, squared distances compared.
   *
   * Only `filterObj` runs, on parameters of its own, a count of 7: the level, the group's
   * square, the group, and the party's level and square (`:3340-3347`). Its timer has
   * function and position 0, the level, and the group's square with x in `uByte7` and y
   * in `uByte6` (`:3324-3329`), the other way round from every other filter's, so the
   * DSA's master stands at `(y, x)` (`ProcessDSATimer6`, `DSA.cpp:5408-5413`). The timer,
   * the group, its square and the DSA's variables go into `mmr`, the turn's record, for
   * the post-move filter, which runs only when this one did.
   */
  monsterMoveFilter(
    level: number,
    mapX: number,
    mapY: number,
    monster: ObjectID,
    timerFunction: number,
    mmr: MmRecord,
  ): void {
    const mmfloc = this.monsterMoveFilterLocation(level);
    const party = this.ctx.party.state.position;
    const partyX = party.x | 0;
    const partyY = party.y | 0;
    if (timerFunction <= 0 || mmfloc.filterObj === OBJECT_ID_EOF) return;
    if (mmfloc.partyLevelOnly !== 0 && level !== (party.z | 0)) return;
    if ((mapX - partyX) * (mapX - partyX) + (mapY - partyY) * (mapY - partyY) > mmfloc.maxDistance * mmfloc.maxDistance) return;
    // The group's square the other way round: x in `uByte7`, y in `uByte6`.
    mmr.timer = filterTimer(new Position(mapY, mapX, level));
    mmr.objMonster = monster;
    mmr.locr = { l: level, x: mapX, y: mapY, p: 0 };
    mmr.finalLocr = { ...mmr.locr };
    mmr.calledPreMoveFilter = true;
    this.newDsaParameters(() => {
      this.setParameters(7, [level, mapX, mapY, monster, party.z | 0, partyX, partyY]);
      this.runMonsterMoveFilter(mmfloc, mmr);
    });
  }

  /**
   * `ProcessPostMonsterMoveFilter` (`doc/CSBwin-src/Monster.cpp:3169-3233`), which every
   * `return` of `ProcessTimers29to41` runs, from `:3373` to `:4448`: the same DSA again,
   * when the pre-move filter ran, on the record's timer with function 1, so the DSA's
   * column 1, and the record's variables.
   *
   * Its parameters, a count of 9: where the group ended (`finalLocr`, level -1 once it
   * has left the dungeon), the group, the party's level and square, and the two words of
   * the turn's flags. `MonMove_differentCell` is set first when the group ended on
   * another square than its turn began on.
   */
  postMonsterMoveFilter(mmr: MmRecord): void {
    if (!mmr.calledPreMoveFilter || !mmr.timer) return;
    const mmfloc = this.monsterMoveFilterLocation(mmr.locr.l);
    this.newDsaParameters(() => {
      const { locr, finalLocr } = mmr;
      if (locr.l !== finalLocr.l || locr.x !== finalLocr.x || locr.y !== finalLocr.y) {
        mmr.setflg(MonsterEvents.MonMove_differentCell);
      }
      mmr.timer!.function = 1;
      mmr.timer!.uByte9 = 1;
      mmr.timer!.uByte8 = 0;
      const party = this.ctx.party.state.position;
      this.setParameters(9, [
        finalLocr.l, finalLocr.x, finalLocr.y, mmr.objMonster,
        party.z | 0, party.x | 0, party.y | 0, mmr.flgs[0]!, mmr.flgs[1]!,
      ]);
      this.runMonsterMoveFilter(mmfloc, mmr);
    });
  }

  /** `ProcessDSAFilter` on the level's filter DSA, the record's timer and variables. */
  private runMonsterMoveFilter(mmfloc: MonsterMoveFilterLocation, mmr: MmRecord): void {
    const filterPos = new Position(mmfloc.locr.x, mmfloc.locr.y, mmfloc.locr.l);
    this.monsterMoveFilterActive = true;
    this.processTimer6Internal(mmfloc.filterObj, mmr.timer!, filterPos, true, mmr.dsaVars);
    this.monsterMoveFilterActive = false;
  }

  /**
   * The damage filter (`doc/CSBwin-src/Character.cpp:2829-2893`), which `DamageCharacter`
   * runs on the damage it is about to add to `d.PendingDamage`: the first DSA at
   * `ESL_DAMAGECHARFILTER`'s location, on parameters of its own, a count of 7 and the
   * champion's index and fingerprint, the damage asked for, the damage worked out, the
   * wound mask, the kind, and 0 (`:2876-2883`). Back comes word 3, the damage worked out,
   * as a whole longword, of which `DamageCharacter` uses the low word (`:2886`, `:2900`);
   * `dealt` when no DSA stands there.
   */
  damageCharFilter(chIdx: number, fingerprint: number, damage: number, dealt: number, mask: number, kind: number): number {
    let result = dealt;
    this.newDsaParameters(() => this.forEachFilterDsa(ESL_DAMAGE_CHAR_FILTER, (run) => {
      this.setParameters(7, [chIdx, fingerprint, damage, dealt, mask, kind, 0]);
      run();
      result = this.getParameter(3);
    }, true));
    return result;
  }

  /**
   * `ActionNameFilter` (`doc/CSBwin-src/CSBCode.cpp:8634-8713`), which `DrawLegalAttackTypes`
   * calls for each option it offers (`:8777`): champion `charIndex`'s option
   * `actionNumber`, of `numAttackOption`, whose attack type is `attackType`. The first
   * type-47 actuator at `ESL_ACTIONNAMEFILTER`'s location runs, and only it (`:8669-8670`),
   * found at the first call and kept from then on (`actionNameDsa`).
   *
   * Its five parameters (`:8691-8696`): the champion, the option, -1, the option count and
   * the attack type. Back come parameter 4, the option's attack type from now on, as an
   * `i8` (`:8699`), and parameter 2, which below 0x10000 names a global text to show
   * instead of the attack's name, if there is such a record (`:8700-8711`); `name` is null
   * otherwise. Null when there is no DSA.
   *
   * The `NEWDSAPARAMETERS` is in the block that looks for the DSA (`:8653`), and gone when
   * it runs, so the DSA runs on the caller's parameters and leaves them its own.
   */
  actionNameFilter(
    charIndex: number,
    actionNumber: number,
    numAttackOption: number,
    attackType: number,
  ): { attackType: number; name: string | null } | null {
    if (this.actionNameDsa === OBJECT_ID_NULL) {
      this.actionNameDsa = OBJECT_ID_EOF;
      const special = this.dungeon.getSpecialLocation((EDT_SPECIAL_LOCATIONS << 24) | ESL_ACTION_NAME_FILTER);
      if (special !== null) {
        const locr = locationRelFromInteger(special);
        if (this.dungeon.isValidLocation(locr)) {
          this.actionNameFilterPos = new Position(locr.x, locr.y, locr.l);
          this.actionNameDsa = this.findFirstDsaActuator(this.actionNameFilterPos);
        }
      }
    }
    const filterPos = this.actionNameFilterPos;
    if (this.actionNameDsa === OBJECT_ID_EOF || filterPos === null) return null;
    this.setParameters(5, [charIndex, actionNumber, -1, numAttackOption, attackType]);
    this.processTimer6Internal(this.actionNameDsa, filterTimer(filterPos), filterPos, true, new DsaVars());
    const textIndex = this.getParameter(2) >>> 0;
    return {
      attackType: (this.getParameter(4) << 24) >> 24,
      name: textIndex < 0x10000 ? this.globalText(textIndex) : null,
    };
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
    const encounterLoc = locationRelToInteger({
      l: options.position.z & 0x3f,
      x: options.position.x & 0x1f,
      y: options.position.y & 0x1f,
      p: options.posInCell & 0x3,
    });
    let result = 0;
    this.newDsaParameters(() => this.forEachFilterDsa(ESL_MISSILE_ENCOUNTER_FILTER, (run) => {
      this.setParameters(7, [
        0,
        options.type | 0,
        encounterLoc,
        options.missile | 0,
        options.projectile | 0,
        options.direction | 0,
        options.index | 0,
      ]);
      run();
      result = this.getParameter(0);
    }, true));
    return result;
  }

  /**
   * The viewing filter at one of `DescribeObject`'s sites: every type-47 actuator at
   * `ESL_VIEWINGFILTER`'s location runs in turn, a filter call apiece
   * (`doc/CSBwin-src/Character.cpp:3476-3518`, `:3736-3770`). No parameter comes back
   * into the mask, which only `&DESCRIBE` changes (`ModifyDescription`, `:3797-3830`).
   * At the scroll site, an object a DSA names in parameter 1 becomes the loop's own `obj`,
   * so the loop goes on down that object's chain, and is drawn if it is a scroll
   * (`:3509-3518`). `TAG019036`'s site runs them as the description's does, with
   * parameter 0 always 0 (`:4566-4569`). Null when no DSA stands there.
   */
  processViewingFilter(options: ViewingFilterOptions): ViewingFilterResult | null {
    const special = this.dungeon.getSpecialLocation(VIEWING_FILTER_KEY);
    if (special === null) return null;
    const locrFilter = locationRelFromInteger(special);
    if (!this.dungeon.isValidLocation(locrFilter)) return null;
    const filterPos = new Position(locrFilter.x, locrFilter.y, locrFilter.l);
    const timer = filterTimer(filterPos);

    const scrollSite = options.site === ViewingFilterSite.SCROLL;
    const descriptionSite = options.site === ViewingFilterSite.DESCRIPTION;
    const objectParameter = options.site === ViewingFilterSite.ATTRIBUTES ? -1 : options.objectId | 0;
    return this.newDsaParameters(() => {
      const ctx: ViewingFilterContext = {
        phraseMask: options.phraseMask | 0,
        phraseTextOverrides: Array.from({ length: 8 }, () => null),
        phraseColorOverrides: Array.from({ length: 8 }, () => null),
      };
      this.viewingFilterContext = ctx;
      let found = false;
      let scroll = options.objectId;
      try {
        for (let rn = this.dungeon.findFirstObject(filterPos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
          if (this.dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
          const rec = this.dungeon.getActuatorRecord(rn);
          if (!rec || getActuatorType(rec) !== 47) continue;
          found = true;
          this.setParameters(3, [
            descriptionSite ? ctx.phraseMask : 0,
            objectParameter,
            options.selectedCharacter | 0,
          ]);
          this.processTimer6Internal(rn, timer, filterPos, true, new DsaVars());
          if (!scrollSite) continue;
          const named = this.getParameter(1);
          if (!this.isValidObjectId(named)) continue;
          rn = named;
          if (this.dungeon.rnMaps.dbType(rn) === DBType.SCROLL) scroll = rn;
        }
      } finally {
        this.viewingFilterContext = null;
      }
      if (!found) return null;
      return {
        phraseMask: ctx.phraseMask,
        objectId: scroll,
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
    let chIdx = options.chIdx | 0;
    let skillNumber = options.skillNumber | 0;
    let experience = options.experience | 0;
    let why = options.why | 0;

    const found = this.newDsaParameters(() => this.forEachFilterDsa(ESL_ADJUST_SKILLS_FILTER, (run) => {
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
      run();
      chIdx = this.getParameter(0);
      skillNumber = this.getParameter(1);
      experience = this.getParameter(2);
      why = this.getParameter(3);
    }));

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
    const actuator = this.findFirstDsaActuator(position);
    return actuator === OBJECT_ID_EOF ? null : { position, actuator };
  }

  /**
   * `SetupDSAParam`'s part in the DSA parameters (`doc/CSBwin-src/Attack.cpp:1358-1360`):
   * `_Attack` lays its `ATTACKPARAMETERS` over the current array, with no
   * `NEWDSAPARAMETERS`, so at every attack, filter or none, the count becomes 124 and
   * the 31 words 0. The words past them keep what they held.
   */
  setupAttackParameters(): void {
    this.parameters[0] = PARTY_ATTACK_PARAM_SIZEOF;
    this.parameters.fill(0, 1, 1 + PARTY_ATTACK_PARAM_WORDS);
  }

  /**
   * The attack's words, which CSBWin writes into the current array as it goes: the port
   * keeps them in `AttackSystem`'s `PartyAttackParameters`, and copies them in before a
   * party attack filter runs and when the attack is over, where a DSA can read them.
   */
  storeAttackParameters(words: ArrayLike<number>): void {
    for (let i = 0; i < PARTY_ATTACK_PARAM_WORDS; i++) this.parameters[1 + i] = words[i] ?? 0;
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
    const timer = filterTimer(filter.position);
    timer.uByte9 = msg & 0xff;
    this.storeAttackParameters(words);
    this.processTimer6Internal(filter.actuator, timer, filter.position, true, new DsaVars());

    const out = new Array<number>(words.length);
    for (let i = 0; i < words.length; i++) out[i] = this.getParameter(i);
    return out;
  }

  processSpellFilter(params: SpellParameters): SpellParameters | null {
    const location = this.dungeon.getSpellFilterLocation();
    if ((location & 0x80000000) === 0) return null;
    let updated: SpellParameters = { ...params };

    const found = this.newDsaParameters(() => this.forEachDsaAt(locationRelFromInteger(location & 0x7fffffff), (run) => {
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
      run();
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
    }));

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

  /** The DSA global variables, all `numGlobalVariables`, for the state a read restores (`RuntimeSave.ts`). */
  getGlobalVariables(): number[] {
    return Array.from(this.globalVariables);
  }

  /** `globalVariables[index]`, or null at or past `numGlobalVariables` (`SubstituteGlobalVariable`). */
  getGlobalVariable(index: number): number | null {
    return index >= 0 && index < this.globalVariables.length ? this.globalVariables[index]! : null;
  }

  /** The DSA global variables, and their number, `numGlobalVariables`. */
  setGlobalVariables(values: readonly number[]): void {
    this.globalVariables = Int32Array.from(values, (value) => value | 0);
  }

  private processTimer6Internal(
    rn: ObjectID,
    timer: TimerEntry,
    location: Position,
    filter: boolean,
    vars: DsaVars,
  ): boolean {
    const action = this.ctx.systems.timer.getTimerAction(timer);
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
    // An `OVERRIDE` no operation used dies with its run (`doc/CSBwin-src/DSA.cpp:5416`),
    // and a run nested in another's clears the caller's.
    this.overrideP = false;

    const bank = new DsaBank(vars, (line) => this.ctx.host.trace(line));
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
              this.queueDsaSwitchAction(delay, action, target.l, target.x, target.y, target.p, morD);
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
            // `DSA.cpp:1268-1275`.
            if (index >= this.globalVariables.length) {
              this.ctx.host.trace('Global Store to non-existent variable');
            } else {
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
            if (index >= this.globalVariables.length) this.ctx.host.trace('Gloal fetch from non-existent variable');
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
            const jump = this.executeAmpersand(subcode, bank, exPkt);
            if (jump) {
              transferState = jump.state;
              transferCol = jump.col;
            }
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

  private executeAmpersand(subcode: number, bank: DsaBank, exPkt: ExecutionPacket): GearJump | void {
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
        this.noFilter(bank);
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
      case StkOp.DEL_MON: {
        // `doc/CSBwin-src/DSA.cpp:2496-2503`, `EX_DELMON` (`:1741-1748`).
        this.noFilter(bank);
        const indx = bank.stack.pop();
        const locr = locationRelFromInteger(bank.stack.pop());
        this.ctx.systems.monsterDamage.deleteMonsterInGroup(locr, indx >>> 0);
        break;
      }
      case StkOp.INS_MON: {
        // `DSA.cpp:2504-2511`, `EX_INSMON` (`:1750-1757`).
        this.noFilter(bank);
        const posMask = bank.stack.pop();
        const locr = locationRelFromInteger(bank.stack.pop());
        this.ctx.systems.monsterDamage.insertMonsterInGroup(locr, posMask >>> 0);
        break;
      }
      case StkOp.ADD: {
        const objId = bank.stack.pop();
        const location = bank.stack.pop();
        const posMask = bank.stack.pop() & 0xf;
        this.noFilter(bank);
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
          // `CURSORFILTER_DSA_ADD` for the copy, which cannot cancel; `ObjectToCursor`
          // then fills the hand, whatever the filter put there (`DSA.cpp:2062-2071`).
          this.cursorFilter({ object: cloned, type: CursorFilterType.DSA_ADD, p1: 0, p2: 0, p3: 0, p4: 0 });
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
      case StkOp.TELEPORT_PARTY: {
        const location = bank.stack.pop();
        this.noFilter(bank);
        const locr = locationRelFromInteger(location);
        if (!this.dungeon.isValidLocation(locr)) break;
        this.teleportParty(locr);
        break;
      }
      case StkOp.MESSAGE: {
        // `STKOP_Message` (`doc/CSBwin-src/DSA.cpp:3045-3089`): a `TT_ParameterMessage`
        // timer to the target, and the first `numParam` DSA parameters in `EXPOOL` under
        // its index, for the DSAs it reaches (`readRoomTimerParameters`).
        const delay = bank.stack.pop() >>> 0;
        const numParam = bank.stack.pop() >>> 0;
        const msgType = bank.stack.pop();
        const target = locationRelFromInteger(bank.stack.pop());
        if (numParam > 29) break;
        if (this.overrideP) {
          target.p = this.overridePos & 3;
          this.overrideP = false;
        }
        const actionTime = (this.ctx.state.tickCount + delay) >>> 0;
        const timer = this.timers.createTimerWithUByte5(
          TimerFunction.TT_PARAMETER_MESSAGE, target.x, target.y, target.p, msgType, actionTime, target.l,
          this.parameterMessageSequence++,
        );
        this.dungeon.writeExpoolRecord(messageParametersKey(timer.index), Array.from(this.parameters.subarray(1, 1 + numParam)));
        break;
      }
      case StkOp.SOUND: {
        // `STKOP_Sound` (`doc/CSBwin-src/DSA.cpp:4612-4624`).
        bank.stack.pop(); // flags, which `PlayCustomSound` does not use
        const volume = bank.stack.pop();
        const soundNum = bank.stack.pop();
        this.ctx.sounds.playCustomSound(soundNum, volume);
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
        this.noFilter(bank);
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
        this.noFilter(bank);
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
        // `i`, `n` and `j` are `ui32` (`doc/CSBwin-src/DSA.cpp:2956-2985`), so the count is
        // compared unsigned: a count of -1, a parameter message whose record is gone, is
        // never short, and the words are copied as they stand.
        const index = bank.stack.pop() >>> 0;
        let n = bank.stack.pop() >>> 0;
        if (n > 100) {
          this.ctx.host.trace('DSA &PARAM@ too many parameters');
          break;
        }
        const paramCount = (this.parameters[0] ?? 0) >>> 0;
        if (n > paramCount) {
          this.ctx.host.trace('DSA &PARAM@ non-existent parameter');
          for (let j = paramCount; j < n; j++) {
            // `pdsaDbank->Var(j)` (`doc/CSBwin-src-20230608/DSA.cpp:2978`): a read of the
            // parameter's number, where the variable marked is `index + j`.
            bank.getVar(j);
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
        // `doc/CSBwin-src/DSA.cpp:3000-3020`, signed.
        const index = bank.stack.pop();
        const n = bank.stack.pop();
        if (n > 100) {
          this.ctx.host.trace('DSA &PARAM! too many parameters');
          break;
        }
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
        // `Var(arrayIndex+j, 0)` (doc/CSBwin-src/DSA.cpp:3690-3693): every variable of the
        // array is well defined from here, so `SetVarBit` below never zeroes one.
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
          // `Var(arrayIndex+1, Var(arrayIndex+1) | bit)` for these four; `SetVarBit` for a
          // pit, a false wall and a door (doc/CSBwin-src/DSA.cpp:3704-3810).
          case RoomType.STONE:
            if (cellFlag & 0x8) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x01);
            if (cellFlag & 0x4) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x02);
            if (cellFlag & 0x2) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x04);
            if (cellFlag & 0x1) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x08);
            break;
          case RoomType.OPEN:
            if (cellFlag & 0x08) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x01);
            break;
          case RoomType.TELEPORTER: {
            if (cellFlag & 0x08) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x08);
            if (cellFlag & 0x04) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x04);
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
            if (cellFlag & 0x04) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x04);
            if (cellFlag & 0x08) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x08);
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
            bank.setVar(arrayIndex + 1, 0);
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
        this.noFilter(bank);
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
        // Popped `unsigned int` and capped at 3, no action (`doc/CSBwin-src/DSA.cpp:4935-4943`).
        const s = Math.min(bank.stack.pop() >>> 0, 3);
        const c = Math.min(bank.stack.pop() >>> 0, 3);
        const t = Math.min(bank.stack.pop() >>> 0, 3);
        const modifier = this.ctx.systems.timer.timerTypeModifier;
        modifier[0] = s;
        modifier[1] = c;
        modifier[2] = t;
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
      case StkOp.MON_POSS:
        this.monPoss(bank);
        break;
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
      case StkOp.MONSTER_FETCH:
        this.monsterFetch(bank);
        break;
      case StkOp.MONSTER_STORE:
        this.monsterStore(bank);
        break;
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
        } else {
          // Bit 16 is a fingerprint in the wings (`GetFromWings`, testing only), where
          // nobody leaves the record `memset` to zero. An index of 0x20000 or more
          // without bit 16 reads nobody, as does `d.PendingDamage[charIdx]` past its
          // four (`DEBT.md` H).
          const inWings = (charIdx & 0x10000) !== 0;
          const character = inWings ? getFromWings(this.dungeon, charIdx & 0xffff, true) : null;
          const pc = inWings ? character && wingsChampion(character) : this.getChampion(party, charIdx);
          if (pc) {
            result[0] = pc.facing;
            result[1] = pc.food;
            result[2] = Math.max(pc.attributes.health - (inWings ? 0 : party.pendingDamage[charIdx] ?? 0), 0);
            // `pc->load`, which the port sums from a party champion's possessions
            // (`DEBT.md` H), and the record holds for one in the wings.
            result[3] = inWings ? pc.load : this.ctx.systems.characterStats.characterLoad(pc);
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
        // `DSA.cpp:4242-4290`. Bit 16 is a fingerprint in the wings.
        const party = this.ctx.party.state;
        let charIdx = bank.stack.pop();
        if (charIdx === 4) charIdx = party.cursorOwner;
        if (charIdx >= 0 && charIdx & 0x10000) {
          const character = getFromWings(this.dungeon, charIdx & 0xffff, true);
          bank.stack.push(character ? readU32LE(character, CHARDESC_TALENTS) : 0);
          break;
        }
        const pc = this.getChampion(party, charIdx);
        bank.stack.push(pc ? pc.talents : 0);
        break;
      }
      case StkOp.TALENTS_STORE: {
        // `DSA.cpp:4291-4347`. Bit 16 is a fingerprint in the wings, whose copy is saved
        // back when the talents change.
        const party = this.ctx.party.state;
        let charIdx = bank.stack.pop();
        const newTalents = bank.stack.pop() >>> 0;
        if (charIdx === 4) charIdx = party.cursorOwner;
        if (charIdx >= 0 && charIdx & 0x10000) {
          const character = getFromWings(this.dungeon, charIdx & 0xffff, true);
          if (character && readU32LE(character, CHARDESC_TALENTS) !== newTalents) {
            writeU32LE(character, CHARDESC_TALENTS, newTalents);
            saveToWings(this.dungeon, character);
          }
          break;
        }
        const pc = this.getChampion(party, charIdx);
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
        if (val === 4 && locateInWings(this.dungeon, fingerPrint) !== null) val = 5;
        bank.stack.push(val);
        break;
      }
      case StkOp.SWAP_CHARACTER: {
        // `DSA.cpp:4413-4425`.
        this.noFilter(bank);
        const fingerPrint = bank.stack.pop();
        const index = bank.stack.pop();
        bank.stack.push(swapCharacter(this.ctx, index, fingerPrint));
        break;
      }
      case StkOp.CHAR_STORE:
        this.charStore(bank);
        break;
      case StkOp.SAY: {
        // `DSA.cpp:3137-3160`: the first text of the square, at any corner.
        const color = bank.stack.pop();
        const locr = locationRelFromInteger(bank.stack.pop());
        if (!this.dungeon.isValidLocation(locr)) break;
        let rn = this.dungeon.findFirstObject(new Position(locr.x, locr.y, locr.l));
        while (rn !== OBJECT_ID_EOF && this.dungeon.rnMaps.dbType(rn) !== DBType.TEXT) {
          rn = this.dungeon.getDBRecordLink(rn);
        }
        if (rn === OBJECT_ID_EOF) break;
        const record = this.dungeon.getTextRecord(rn);
        if (!record) break;
        const text = this.dungeon.decodeTextString(record, 0x8002, this.ctx.tables.textDecode, 999) ?? '';
        printWithSubstitution(this.ctx, text, color);
        break;
      }
      case StkOp.DISCARD_TEXT:
        // `DSA.cpp:3161-3167`.
        this.ctx.host.messages.discardText();
        break;
      case StkOp.TEXT_FETCH: {
        // `DSA.cpp:3168-3193`.
        const textIndex = bank.stack.pop() >>> 0;
        const objIndex = bank.stack.pop();
        if (textIndex > 9) break;
        if (!this.isValidObjectId(objIndex)) break;
        if (this.dungeon.rnMaps.dbType(objIndex) !== DBType.TEXT) break;
        const record = this.dungeon.getTextRecord(objIndex);
        if (!record) break;
        bank.setText(this.dungeon.decodeTextString(record, 0x8002, this.ctx.tables.textDecode, 999) ?? '', textIndex);
        break;
      }
      case StkOp.GLOBAL_TEXT_STORE: {
        // `DSA.cpp:3194-3202`.
        const globalIndex = bank.stack.pop();
        const localIndex = bank.stack.pop();
        this.setGlobalText(bank.getText(localIndex), globalIndex);
        break;
      }
      case StkOp.CHAR_NAME_FETCH: {
        // `DSA.cpp:3204-3237`: the first champion with the fingerprint, else the one in
        // the wings (`LocateInWings`).
        // `SetText(pName, 8, index)` copies nine bytes, the name's eight and a ninth:
        // only a name of eight letters, which runs on into the title, would show it.
        const index = bank.stack.pop() & 0xffff;
        const fingerprint = bank.stack.pop() & 0xffff;
        const party = this.ctx.party.state;
        const charIdx = findChampionByFingerprint(party, fingerprint);
        const inWings = charIdx >= 0 ? null : locateInWings(this.dungeon, fingerprint);
        const name = charIdx >= 0 ? party.champions[charIdx]!.name : inWings ? decodeCharField(inWings.subarray(0, 8)) : '';
        bank.setText(name.slice(0, 8), index);
        break;
      }
      case StkOp.TEXT_SAY: {
        // `DSA.cpp:3239-3252`.
        const color = bank.stack.pop();
        const index = bank.stack.pop();
        printWithSubstitution(this.ctx, bank.getText(index), color);
        break;
      }
      case StkOp.EXPERIENCE_PLUS: {
        // `DSA.cpp:4542-4557`. A negative index reads nobody (`DEBT.md` H).
        const experience = bank.stack.pop();
        const skillnum = bank.stack.pop();
        const charnum = bank.stack.pop();
        const champ = this.getChampion(this.ctx.party.state, charnum);
        if (champ && champ.attributes.health > 0) addToSkill(this.ctx, charnum, skillnum, experience);
        break;
      }
      case StkOp.MON_BLK: {
        // `DSA.cpp:4625-4638`.
        const flags = bank.stack.pop();
        const inhibit = this.ctx.systems.monsterAI.monsterMoveInhibit;
        inhibit[0] = flags & 1;
        inhibit[1] = flags & 2;
        inhibit[2] = flags & 4;
        inhibit[3] = flags & 8;
        break;
      }
      case StkOp.MON_LAND_D:
        this.monLandD(bank);
        break;
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
      case StkOp.THROW: {
        // `DSA.cpp:4558-4582`.
        const delta = bank.stack.pop();
        const damage = bank.stack.pop();
        const range = bank.stack.pop();
        const direction = bank.stack.pop();
        const launchLocation = locationRelFromInteger(bank.stack.pop());
        const objectLocation = locationRelFromInteger(bank.stack.pop());
        const objectType = bank.stack.pop();
        this.noFilter(bank);
        this.ctx.systems.timer.throwMissile(objectType, launchLocation, direction, objectLocation, range, damage,
          delta, this.ctx.state.tickCount);
        break;
      }
      case StkOp.CAST:
      case StkOp.FILTERED_CAST:
        // `DSA.cpp:3091-3106`.
        this.noFilter(bank);
        this.ctx.systems.magic.dsaCastSpell(subcode === StkOp.FILTERED_CAST);
        break;
      case StkOp.GET_SKIN: {
        // `DSA.cpp:3107-3121`: `y` in bits 0-4, `x` in 5-9, the level in 10-15.
        const loc = bank.stack.pop();
        bank.stack.push(this.dungeon.skinCache.GetSkin((loc >> 10) & 63, (loc >> 5) & 31, loc & 31));
        break;
      }
      case StkOp.SET_SKIN: {
        // `DSA.cpp:3122-3135`: the location, then the skin, of which `SetSkin` takes the
        // low byte.
        const loc = bank.stack.pop();
        const skin = bank.stack.pop();
        this.dungeon.skinCache.SetSkin((loc >> 10) & 63, (loc >> 5) & 31, loc & 31, skin & 0xff);
        break;
      }
      case StkOp.CREATE_CLOUD:
        this.createCloud(bank);
        break;
      case StkOp.MISSILE_INFO_FETCH:
        this.missileInfoFetch(bank);
        break;
      case StkOp.MISSILE_INFO_STORE:
        this.missileInfoStore(bank);
        break;
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
      case StkOp.LOC_TO_ABS_COORD: {
        // `doc/CSBwin-src/DSA.cpp:3253-3269`, `LOCATIONABS::operator =` (`:320-327`): the
        // level's offsets added, read past the descriptors for a level that is not there.
        const locr = locationRelFromInteger(bank.stack.pop());
        const descriptor = this.dungeon.getMap(locr.l)?.descriptor;
        bank.stack.push(locr.l);
        bank.stack.push(locr.x + (descriptor?.offsetX ?? 0));
        bank.stack.push(locr.y + (descriptor?.offsetY ?? 0));
        bank.stack.push(locr.p);
        break;
      }
      case StkOp.FETCH_EX_CELL_FLG: {
        // `doc/CSBwin-src/DSA.cpp:3270-3297`: the cell's bit of each of the eight flags,
        // flag 0 in bit 0, all clear without a record of eight.
        const locr = locationRelFromInteger(bank.stack.pop());
        const record = this.dungeon.locateExpoolRecord(extendedCellFlagsKey(locr));
        let flags = 0;
        if (record && record.length >= 8) {
          const mask = (1 << locr.y) >>> 0;
          for (let i = 0; i < 8; i++) {
            if (((record[i]! & mask) >>> 0) !== 0) flags |= 0x100;
            flags >>>= 1;
          }
        }
        bank.stack.push(flags);
        break;
      }
      case StkOp.STORE_EX_CELL_FLG: {
        // `doc/CSBwin-src/DSA.cpp:3298-3327`: the record is taken out, its cell's bits
        // set from the low eight of `flags`, and written back; a missing or short record
        // starts at zero.
        const loc = bank.stack.pop();
        let flags = bank.stack.pop() >>> 0;
        const locr = locationRelFromInteger(loc);
        const key = extendedCellFlagsKey(locr);
        const read = this.dungeon.readExpoolRecord(key);
        const record = read && read.length >= 8 ? read.slice(0, 8) : new Array<number>(8).fill(0);
        const mask = (1 << locr.y) >>> 0;
        for (let i = 0; i < 8; i++) {
          record[i] = (record[i]! & ~mask) >>> 0;
          if (flags & 1) record[i] = (record[i]! | mask) >>> 0;
          flags >>>= 1;
        }
        this.dungeon.writeExpoolRecord(key, record);
        break;
      }
      case StkOp.MULTIPLIER_FETCH: {
        // `doc/CSBwin-src/DSA.cpp:3974-3990`: `level` is signed, so a negative one reads
        // before the descriptors, and 1 past the last.
        const level = bank.stack.pop();
        if (level < this.dungeon.getMapCount()) {
          bank.stack.push(this.dungeon.getMap(level)?.descriptor.difficulty ?? 0);
        } else {
          bank.stack.push(1);
        }
        break;
      }
      case StkOp.PARTY_DISTANCE: {
        // `doc/CSBwin-src/DSA.cpp:4057-4073`: steps on the party's level, minus the levels
        // between otherwise.
        const locr = locationRelFromInteger(bank.stack.pop());
        const party = this.ctx.party.state.position;
        if (party.z === locr.l) {
          bank.stack.push(Math.abs(party.x - locr.x) + Math.abs(party.y - locr.y));
        } else {
          bank.stack.push(-Math.abs(party.z - locr.l));
        }
        break;
      }
      case StkOp.JUMP_GEAR: {
        // `doc/CSBwin-src/DSA.cpp:4737-4745`: the state, then the column, from the stack.
        const state = bank.stack.pop();
        const col = bank.stack.pop();
        return { state, col };
      }
      case StkOp.GOSUB_GEAR: {
        // `doc/CSBwin-src/DSA.cpp:4746-4767`: `EX_GOSUB`'s call, the master's program.
        const state = bank.stack.pop();
        const msg = bank.stack.pop();
        this.execute({
          ...exPkt,
          curState: state,
          column: msg,
          subroutineLevel: exPkt.subroutineLevel + 1,
          slave: exPkt.master,
        }, bank);
        break;
      }
      case StkOp.THIS_CELL:
        this.examineCell(4, 4, bank);
        break;
      case StkOp.THIS_DSA_ID:
        // `doc/CSBwin-src/DSA.cpp:4822-4828`: the slave's RN, `ConvertToInteger`.
        bank.stack.push(exPkt.rnSlave);
        break;
      case StkOp.NEIGHBORS:
        this.examineCell(0, 3, bank);
        break;
      case StkOp.BIT_COUNT: {
        // `doc/CSBwin-src/DSA.cpp:4832-4849`.
        const v = bank.stack.pop() >>> 0;
        let count = 0;
        for (let shift = 0; shift < 32; shift += 4) count += BIT_COUNTS[(v >>> shift) & 0x0f]!;
        bank.stack.push(count);
        break;
      }
      case StkOp.VSET:
        this.vset(bank);
        break;
      case StkOp.OVERLAY: {
        // `doc/CSBwin-src/DSA.cpp:2919-2930`.
        const onum = bank.stack.pop();
        const p4 = bank.stack.pop();
        const p3 = bank.stack.pop();
        const p2 = bank.stack.pop();
        const p1 = bank.stack.pop();
        this.ctx.overlay.SelectOverlay(onum, p1, p2, p3, p4, this.ctx.state.tickCount);
        break;
      }
      case StkOp.PALETTE: {
        // `doc/CSBwin-src/DSA.cpp:2932-2944`.
        const density = bank.stack.pop();
        const onum = bank.stack.pop();
        bank.stack.pop(); // p2, which `SetOverlayPalette` does not read
        bank.stack.pop(); // p1, nor this
        this.ctx.overlay.SetOverlayPalette(onum, density);
        break;
      }
      case StkOp.JITTER: {
        // `doc/CSBwin-src/DSA.cpp:4903-4930`.
        const yOverlay = bank.stack.pop();
        const xOverlay = bank.stack.pop();
        const yGraphic = bank.stack.pop();
        const xGraphic = bank.stack.pop();
        this.ctx.overlay.Jitter(xGraphic, yGraphic, xOverlay, yOverlay);
        break;
      }
      case StkOp.DISABLE_SAVES:
        // `doc/CSBwin-src/DSA.cpp:2945-2955`.
        this.disableSaves = bank.stack.pop() !== 0;
        break;
      case StkOp.DSA_INFO_FETCH: {
        // `doc/CSBwin-src/DSA.cpp:2439-2470`: a type-47 actuator's selector, state and
        // parameters, -1 for each otherwise.
        let dsaType = -1;
        let dsaState = -1;
        let dsaPA = -1;
        let dsaPB = -1;
        const n = bank.stack.pop();
        if (this.isValidObjectId(n) && this.dungeon.rnMaps.dbType(n) === DBType.ACTUATOR) {
          const rec = this.dungeon.getActuatorRecord(n);
          if (rec && getActuatorType(rec) === 47) {
            dsaType = getActuatorDsaSelector(rec);
            dsaState = getActuatorDsaState(rec);
            dsaPA = getActuatorParameterA(rec);
            dsaPB = getActuatorParameterB(rec);
          }
        }
        bank.stack.push(dsaType);
        bank.stack.push(dsaState);
        bank.stack.push(dsaPA);
        bank.stack.push(dsaPB);
        break;
      }
      case StkOp.I_INDIRECT: {
        // `doc/CSBwin-src/DSA.cpp:2345-2391`: the parameter record `indirect` packed, back
        // on the stack, in the variables and in the parameters, and its operation run. A
        // record that names none does nothing. A count past the array reads outside
        // CSBWin's, where the port reads 0 and stops at 100.
        const operation = INDIRECT_OPERATIONS.get(this.parameters[1] ?? 0);
        if (operation === undefined) return;
        const p = this.parameters;
        const word = (k: number): number => p[1 + k] ?? 0;
        let r = 1;
        let n = Math.min(word(r++) >>> 0, 100);
        r += n;
        for (let i = 0; i < n; i++) bank.stack.push(word(--r));
        r += n;
        if (word(r++) !== 0) {
          n = Math.min(word(2) >>> 0, 100);
          let indx = word(3);
          for (let i = 0; i < n; i++) bank.setVar(indx++, word(r++));
        }
        n = Math.min(word(r++) >>> 0, 100);
        for (let i = 0; i < n; i++) p[1 + i] = word(r++);
        return this.executeAmpersand(operation, bank, exPkt);
      }
      // `DSA.cpp:4957-4971`: each `I_` operation's operands, sent to the DSA at
      // `ESL_INDIRECTACTIONS` (`indirect`).
      case StkOp.I_DEL: this.indirect(bank, subcode, false, 2, 0); break;
      case StkOp.I_DEL_MON: this.indirect(bank, subcode, false, 2, 0); break;
      case StkOp.I_INS_MON: this.indirect(bank, subcode, false, 2, 0); break;
      case StkOp.I_ADD: this.indirect(bank, subcode, false, 3, 0); break;
      case StkOp.I_CREATE_CLOUD: this.indirect(bank, subcode, false, 3, 0); break;
      case StkOp.I_CAST: this.indirect(bank, subcode, false, 0, 13); break;
      case StkOp.I_TELEPORT_PARTY: this.indirect(bank, subcode, false, 1, 0); break;
      case StkOp.I_MONSTER_STORE: this.indirect(bank, subcode, true, 3, 0); break;
      case StkOp.I_CHAR_STORE: this.indirect(bank, subcode, true, 3, 0); break;
      case StkOp.I_CAUSE_POISON: this.indirect(bank, subcode, false, 2, 0); break;
      case StkOp.I_MOVE: this.indirect(bank, subcode, false, 10, 0); break;
      case StkOp.I_COPY: this.indirect(bank, subcode, false, 2, 0); break;
      case StkOp.I_CELL_STORE: this.indirect(bank, subcode, true, 3, 0); break;
      case StkOp.I_THROW: this.indirect(bank, subcode, false, 7, 0); break;
      case StkOp.I_SWAP_CHARACTER: this.indirect(bank, subcode, false, 2, 0); break;
      case StkOp.I_DELAY:
        // `DSA.cpp:4972-4978`: the delay of the next `indirect`, this run only.
        bank.indirectActionDelay = bank.stack.pop();
        break;
      default:
        if (!this.warnedOps.has(subcode)) {
          this.warnedOps.add(subcode);
          this.ctx.host.trace(`Unimplemented DSA & opcode ${subcode}`);
        }
        break;
    }
  }

  /**
   * `Indirect` (`doc/CSBwin-src/DSA.cpp:2093-2192`): an `I_` operation's operands in a
   * parameter record, `[type, numVar, the numVar popped, array, its variables, numParam,
   * the first numParam DSA parameters]`, which a `TT_ParameterMessage` timer takes to the
   * DSA at `ESL_INDIRECTACTIONS`, corner 0, message type 0, due now or `&%DELAY` ticks on.
   * That DSA's `&%INDIRECT` unpacks and runs it. In a dungeon with no such location it does
   * nothing, not even pop. An array of `array` is the variables from the second word
   * popped on, as many as the first, and none past 20; a record of more than 29 words is
   * sent nowhere, once its operands are popped.
   *
   * CSBWin looks the location up at the first call of the process and keeps what it found
   * (`indirectLocChecked`, a function `static`); the port looks it up in the world each
   * time, which differs only after a load of another dungeon.
   */
  private indirect(bank: DsaBank, type: number, array: boolean, numVar: number, numParam: number): void {
    const location = this.dungeon.getSpecialLocation(INDIRECT_ACTIONS_KEY);
    if (location === null) return;
    const indirectLocr = locationRelFromInteger(location);
    const record = [type, numVar];
    for (let i = 0; i < numVar; i++) record.push(bank.stack.pop());
    record.push(array ? 1 : 0);
    if (array) {
      const n = record[2]! >>> 0;
      if (n > 20) return;
      for (let j = 0; j < n; j++) record.push(bank.getVar((record[3]! + j) | 0));
    }
    record.push(numParam);
    for (let i = 0; i < numParam; i++) record.push(this.parameters[1 + i] ?? 0);
    if (record.length > 29) return;
    let actionTime = this.ctx.state.tickCount;
    if (bank.indirectActionDelay > 0) {
      actionTime += bank.indirectActionDelay;
      bank.indirectActionDelay = -1;
    }
    const timer = this.timers.createTimerWithUByte5(
      TimerFunction.TT_PARAMETER_MESSAGE, indirectLocr.x, indirectLocr.y, 0, 0, actionTime, indirectLocr.l,
      this.parameterMessageSequence++,
    );
    this.dungeon.writeExpoolRecord(messageParametersKey(timer.index), record);
  }

  /**
   * `NOFILTER` (`doc/CSBwin-src/DSA.cpp:457-462`): an operation that changes the dungeon,
   * run from a filter, warns the dungeon's author.
   */
  /**
   * `ExamineCell` (`doc/CSBwin-src/DSA.cpp:2210-2320`), `&THISCELL` and `&NEIGHBORS`:
   * a result bit for each cell from `first` to `last` (0 to 3 the four neighbours, north
   * first and clockwise; 4 the cell itself) that has one of the mask's bits of what it is
   * (0 to 24) and one of what is on it (29 to 31).
   */
  private examineCell(first: number, last: number, bank: DsaBank): void {
    const criteriaMask = bank.stack.pop() >>> 0;
    const locr = locationRelFromInteger(bank.stack.pop());
    let resultBit = 1;
    let result = 0;
    for (let i = first; i <= last; i++) {
      const cellLocr = { ...locr };
      let cellBits = 0;
      switch (i) {
        case 0: cellLocr.y--; break;
        case 1: cellLocr.x++; break;
        case 2: cellLocr.y++; break;
        case 3: cellLocr.x--; break;
      }
      if (!this.dungeon.isValidLocation(cellLocr)) {
        cellBits |= (1 << 0) | (1 << 31);
      } else {
        const cellPos = new Position(cellLocr.x, cellLocr.y, cellLocr.l);
        const cf = this.dungeon.getCellFlag(cellPos);
        switch ((cf >> 5) & 7) {
          case RoomType.STONE:
            cellBits |= (1 << 1) | (1 << 31);
            break;
          case RoomType.OPEN:
            cellBits |= 1 << 19;
            cellBits |= this.cellContents(cellLocr);
            break;
          case RoomType.PIT:
            if (cf & 1) cellBits |= 1 << 4; // a false pit
            else if (cf & 0x8) cellBits |= 1 << 2; // open
            else cellBits |= 1 << 3;
            cellBits |= this.cellContents(cellLocr);
            break;
          case RoomType.DOOR:
            cellBits = 1 << ((cf & 7) > 5 ? 9 : (cf & 7) + 5);
            cellBits |= this.cellContents(cellLocr);
            break;
          case RoomType.TELEPORTER: {
            const rn = this.findFirstTeleporter(cellPos);
            if (rn !== OBJECT_ID_EOF) {
              const what = this.dungeon.getTeleporterRecord(rn)?.scope ?? 0;
              const bit = TELEPORTER_BIT[what & 3]! + ((cf & 8) !== 0 ? 0 : 1);
              cellBits |= 1 << bit;
            }
            cellBits |= this.cellContents(cellLocr);
            break;
          }
          case RoomType.FALSEWALL:
            if (cf & 0x04) cellBits |= 1 << 22;
            else if (cf & 0x01) cellBits |= 1 << 20;
            else cellBits |= 1 << 21;
            cellBits |= this.cellContents(cellLocr);
            break;
          case RoomType.STAIRS:
            if (cf & 0x04) cellBits |= 1 << 23;
            else cellBits |= 1 << 24;
            cellBits |= this.cellContents(cellLocr);
            break;
        }
      }
      if ((criteriaMask & cellBits & 0x01ffffff) !== 0 && (criteriaMask & cellBits & 0xe0000000) !== 0) {
        result |= resultBit;
      }
      resultBit <<= 1;
    }
    bank.stack.push(result);
  }

  /** `Contents` (`doc/CSBwin-src/DSA.cpp:2200-2205`): the party, else a monster, else nothing. */
  private cellContents(locr: LocationRel): number {
    const party = this.ctx.party.state.position;
    if (party.z === locr.l && party.x === locr.x && party.y === locr.y) return 1 << 29;
    if (this.dungeon.findFirstMonster(new Position(locr.x, locr.y, locr.l)) !== OBJECT_ID_EOF) return 1 << 30;
    return 0x80000000 | 0;
  }

  /**
   * `&VSET` (`doc/CSBwin-src/DSA.cpp:4850-4897`): `n` variables from `dst` set to `-src`
   * for a negative `src`, to `src - 100` past 99, and otherwise copied from the variables
   * at `src`, their states with them. `n` and `dst` are unsigned, `src` signed. A count
   * whose sum with `dst` or `src` wraps past 2^32 runs CSBWin past its 100 variables; the
   * port stops at the last (`DEBT.md` H, "An index CSBWin does not bound reads nobody").
   */
  private vset(bank: DsaBank): void {
    let n = bank.stack.pop() >>> 0;
    const dst = bank.stack.pop() >>> 0;
    const src = bank.stack.pop() | 0;
    if (dst > 99) return;
    if (dst + n > 100) n = 100 - dst;
    const { values, definedFlags } = bank.vars;
    if (src < 0 || src > 99) {
      const value = src < 0 ? -src : src - 100;
      for (let i = 0; i < n && dst + i < 100; i++) values[dst + i] = value;
      definedFlags.fill(DsaVarType.WellDefined, dst, Math.min(100, dst + n));
    } else {
      if (src + n > 100) n = 100 - src;
      values.copyWithin(dst, src, Math.min(100, src + n));
      definedFlags.copyWithin(dst, src, Math.min(100, src + n));
    }
  }

  private noFilter(bank: DsaBank): void {
    if (bank.filter) this.ctx.host.trace('Filter Modifying Dungeon');
  }

  /**
   * `STKOP_CreateCloud` (`doc/CSBwin-src/DSA.cpp:2740-2787`): a cloud of one of five
   * spells, or a Fluxcage, made at a location of any level, as a missile's would be. A
   * type with no spell is "Illegal cloud type", and makes nothing. CSBWin does not check
   * the location, and runs `LoadLevel` and `AddObjectToRoom` off their tables for one
   * past the dungeon; the port makes nothing there.
   */
  private createCloud(bank: DsaBank): void {
    const size = bank.stack.pop();
    const type = bank.stack.pop();
    const locr = locationRelFromInteger(bank.stack.pop());
    this.noFilter(bank);
    let spellObj: ObjectID = OBJECT_ID_EOF;
    switch (type) {
      case 0: spellObj = RN_FIREBALL; break;
      case 3: spellObj = RN_DISPELL_MISSILE; break;
      case 4: spellObj = RN_ZO_SPELL; break;
      case 7: spellObj = RN_POISON_CLOUD; break;
      case 40: spellObj = RN_MONSTER_DEATH; break;
      case 50: spellObj = RN_FLUX_CAGE; break;
      default:
        this.ctx.host.trace(`Illegal cloud type ${type}`);
        break;
    }
    if (spellObj === OBJECT_ID_EOF) return;
    if (!this.dungeon.isValidLocation(locr)) return;
    const at = new Position(locr.x, locr.y, locr.l);
    if (spellObj === RN_FLUX_CAGE) {
      this.ctx.systems.missileEncounter.createFluxcage(at, this.ctx.state.tickCount);
    } else {
      this.ctx.systems.missileEncounter.createCloud(spellObj, sw(size), locr.x, locr.y, at, locr.p);
    }
  }

  /**
   * `STKOP_MissileInfoFetch` (`doc/CSBwin-src/DSA.cpp:2795-2823`): a missile's contents,
   * range, damage and direction, the last from its timer's `timerWord8` bits 10-11; -1 for
   * each when the slot is not a missile. CSBWin reads the timer slot the missile names
   * whatever it holds; the port finds no timer there only for a record no launch made,
   * and leaves the direction -1.
   */
  private missileInfoFetch(bank: DsaBank): void {
    let contents = -1;
    let range = -1;
    let damage = -1;
    let direction = -1;
    const k = bank.stack.pop();
    if (this.isValidObjectId(k) && this.dungeon.rnMaps.dbType(k) === DBType.MISSILE) {
      const missile = this.dungeon.getMissileRecord(k);
      if (missile) {
        contents = missile.projectileObject & 0xffff;
        range = missile.rangeRemaining;
        damage = missile.damageRemaining;
        const word8 = this.timers.getTimerWord8(missile.timerIndex);
        if (word8 !== null) direction = (word8 >> 10) & 3;
      }
    }
    bank.stack.push(contents);
    bank.stack.push(range);
    bank.stack.push(damage);
    bank.stack.push(direction);
  }

  /**
   * `STKOP_MissileInfoStore` (`doc/CSBwin-src/DSA.cpp:2824-2851`): a missile's range and
   * damage, cut to their bytes, and its timer's direction. The three values are popped
   * only when the slot is valid, so an invalid one leaves them on the stack.
   */
  private missileInfoStore(bank: DsaBank): void {
    const k = bank.stack.pop();
    if (!this.isValidObjectId(k)) return;
    const direction = bank.stack.pop();
    const damage = bank.stack.pop();
    const range = bank.stack.pop();
    if (this.dungeon.rnMaps.dbType(k) !== DBType.MISSILE) return;
    const missile = this.dungeon.getMissileRecord(k);
    if (!missile) return;
    missile.rangeRemaining = range & 0xff;
    missile.damageRemaining = damage & 0xff;
    const timer = this.timers.getTimer(missile.timerIndex);
    if (timer) timer.timerWord8 = ((timer.timerWord8 & ~(0x3 << 10)) | ((direction & 3) << 10)) & 0xffff;
  }

  /**
   * `STKOP_MonPoss` (`doc/CSBwin-src/DSA.cpp:3358-3388`): the slot of the group's
   * `possindex`th possession, counted from 0, or -1 past the last. When the slot popped is
   * no group, `object` keeps the default `RN`, `RNnul`, and its integer 0xffff is pushed.
   */
  private monPoss(bank: DsaBank): void {
    let possIndex = bank.stack.pop() >>> 0;
    const idx = bank.stack.pop();
    let object: ObjectID = OBJECT_ID_NULL;
    if (this.isValidObjectId(idx) && this.dungeon.rnMaps.dbType(idx) === DBType.CREATURE) {
      const monster = this.dungeon.getCreatureRecord(idx)!;
      for (object = monster.possession; possIndex > 0 && object !== OBJECT_ID_EOF;
        object = this.dungeon.getDBRecordLink(object)) {
        possIndex--;
      }
    }
    bank.stack.push(object === OBJECT_ID_EOF ? -1 : object);
  }

  /**
   * `STKOP_MonsterFetch` (`doc/CSBwin-src/DSA.cpp:3992-4056`): up to `num` of eight words
   * about the group at a slot, into the variables from `index` on: how many it is, its
   * type, the four hit points, the flags (1 invisible, 2 drawn as size 4, 4 unique, 8
   * poisoned, each through its gated `DB4` accessor) and the alternate graphics. A slot
   * that is no group reads zeros, and -1 for the type.
   */
  private monsterFetch(bank: DsaBank): void {
    const num = bank.stack.pop() >>> 0;
    const index = bank.stack.pop() >>> 0;
    const id = bank.stack.pop();
    const result = new Int32Array(8);
    result[1] = -1;
    if (this.isValidObjectId(id) && this.dungeon.rnMaps.dbType(id) === DBType.CREATURE) {
      const monster = this.dungeon.getCreatureRecord(id)!;
      result[0] = (monster.numMonM1 & 0x3) + 1;
      result[1] = monster.creatureType;
      for (let i = 0; i < 4; i++) result[2 + i] = monster.hp[i] ?? 0;
      if (monsterInvisible(this.ctx.rules, monster)) result[6] |= 1;
      if (monsterDrawAsSize4(this.ctx.rules, monster)) result[6] |= 2;
      if (monsterUnique(this.ctx.rules, monster)) result[6] |= 4;
      if (monsterPoisoned(this.ctx.rules, monster)) result[6] |= 8;
      result[7] = monster.alternateGraphics;
    }
    const n = Math.min(8, num);
    for (let i = 0; i < n; i++) bank.setVar(index + i, result[i]!);
  }

  /**
   * `STKOP_MonsterStore` (`doc/CSBwin-src/DSA.cpp:4075-4126`): the hit points, flags and
   * alternate graphics `&MONSTER@` reads, written back from the variables from `index`
   * on, as far as `num` reaches; the count and the type are not. The flags are written
   * whatever the design options. `num` is unsigned, so `num - 2` of 0 or 1 lets all four
   * hit points be written.
   */
  private monsterStore(bank: DsaBank): void {
    const num = bank.stack.pop() >>> 0;
    const index = bank.stack.pop() >>> 0;
    const id = bank.stack.pop();
    this.noFilter(bank);
    if (!this.isValidObjectId(id)) return;
    if (this.dungeon.rnMaps.dbType(id) !== DBType.CREATURE) return; // "Not a Monster"
    const monster = this.dungeon.getCreatureRecord(id)!;
    for (let i = 0; i < 4 && i < ((num - 2) >>> 0); i++) monster.hp[i] = bank.getVar(index + i + 2) & 0xffff;
    if (num > 6) {
      const flags = bank.getVar(index + 6);
      monster.invisible = (flags & 1) !== 0;
      monster.drawAsSize4 = (flags & 2) !== 0;
      monster.unique = (flags & 4) !== 0;
      monster.poisoned = (flags & 8) !== 0;
    }
    if (num > 7) monster.alternateGraphics = bank.getVar(index + 7) & 7;
  }

  /**
   * `STKOP_MonLandD` (`doc/CSBwin-src/DSA.cpp:4768-4790`): in the monster move filter, the
   * group's location as `1024 * level + 32 * x + y` and its distance to the party less
   * one, from the filter's parameters, into variables `idx` and `idx + 1`. Outside that
   * filter it does nothing, not even pop.
   */
  private monLandD(bank: DsaBank): void {
    if (!this.monsterMoveFilterActive) return;
    const idx = bank.stack.pop() >>> 0;
    if (idx > 98) return;
    const p = this.parameters;
    bank.setVar(idx, 1024 * p[1]! + 32 * p[2]! + p[3]!);
    const distance = Math.abs(p[2]! - p[6]!) + Math.abs(p[3]! - p[7]!);
    bank.setVar(idx + 1, distance - 1);
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

  /**
   * `FindMaster` (`doc/CSBwin-src/DSA.cpp:534-547`). CSBWin implements no slave DSA: a
   * DSA is its own master unless its `LocalState()` is 3 (`IsMaster`, `Data.h:2464-2467`),
   * and for one that is, it warns and runs the slave as its master all the same. The
   * slave's master coordinates are then left unset, so the port takes the timer's, as
   * for a master. No dungeon here has a DSA whose local state is 3.
   */
  private findMaster(slave: DsaDefinition, rnSlave: ObjectID, x: number, y: number, locrSlave: LocationRel): {
    rn: ObjectID;
    locr: LocationRel;
  } {
    if (slave.localState !== 3) {
      return { rn: rnSlave, locr: { l: locrSlave.l, x, y, p: locrSlave.p } };
    }
    this.ctx.host.trace('Slave DSA Not Implemented');
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

  /**
   * `QueueDSASwitchAction` (`doc/CSBwin-src/DSA.cpp:485-532`): a set, clear or toggle
   * (`tmrAct` 0, 1, 2) sent `delay` ticks on to a cell, as the timer its room type takes
   * (`'M'`), or as a `TT_DESSAGE` (`'D'`). A DSA's `MESSAGE` sends it, and so does a
   * portrait the Hall of Champions disables (`PortraitTranslateDisable`,
   * `CSBCode.cpp:6589-6612`).
   */
  queueDsaSwitchAction(
    delay: number,
    tmrAct: number,
    level: number,
    targetX: number,
    targetY: number,
    targetPos: number,
    morD: 'M' | 'D',
  ): void {
    const actionTime = (this.ctx.state.tickCount + delay) >>> 0;

    if (morD === 'M') {
      const map = this.dungeon.getMap(level);
      if (!map) return;
      const cellFlag = map.cellFlags[targetX]?.[targetY];
      if (cellFlag === undefined) return;
      const roomType = (cellFlag >> 5) & 0x7;
      if (roomType !== RoomType.STONE && roomType !== RoomType.FALSEWALL) {
        targetPos = 0;
      }
      const mapping = this.byte1596[roomType];
      if (mapping === 0) {
        this.ctx.host.trace(`Illegal DSA timer target (${targetX},${targetY}) L${level}`);
        return;
      }
      this.timers.createTimer(mapping, targetX, targetY, targetPos, tmrAct, actionTime, level);
      return;
    }

    this.timers.createTimer(TimerFunction.TT_DESSAGE, targetX, targetY, targetPos, tmrAct, actionTime, level);
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
      return;
    }
    if (locrInt === -2) {
      ctx.phraseMask &= ~(1 << index);
      return;
    }
    // Every text at the location sets the phrase, so the last wins, and an empty one
    // enables it too. CSBWin checks no `IsValid`: `FindFirstObject` finds nothing off the
    // level's cells, and the port nothing on a level that does not exist, where CSBWin
    // reads past its tables.
    const locr = locationRelFromInteger(locrInt);
    const pos = new Position(locr.x, locr.y, locr.l);
    for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const { category, position } = this.dungeon.rnMaps.decode(rn);
      if (category !== DBType.TEXT) continue;
      if (position !== locr.p) continue;
      const record = this.dungeon.getTextRecord(rn)!;
      ctx.phraseTextOverrides[index] = GetText(this.dungeon.getData(), record.textOffset, this.ctx.tables.textDecode);
      ctx.phraseMask |= 1 << index;
    }
  }

  /** `RN::checkIndirectIndex(i)` (`doc/CSBwin-src/data.cpp:529-534`): a slot of the maps. */
  /**
   * `SetGlobalText` (`doc/CSBwin-src/CSBCode.cpp:5295-5307`): the text, at most 99 bytes
   * and its zero, as the `EXPOOL` record `(EDT_GlobalText << 24) | index`, four bytes to a
   * longword in memory order. The record is `(len + 4) / 4` longwords; CSBWin fills the
   * bytes past the zero from an uninitialised buffer, the port with zeros. A new record
   * goes in front of the old, which stays in the pool.
   */
  /**
   * `(char *)pRecord` of the `EXPOOL`'s global text `index`, as the action name filter reads
   * it (`doc/CSBwin-src/CSBCode.cpp:8702-8710`): its bytes, in memory order, up to the first
   * 0. Null when there is no such record, or an empty one.
   */
  private globalText(index: number): string | null {
    const record = this.dungeon.locateExpoolRecord(((EDT_GLOBAL_TEXT << 24) | (index & 0xffff)) >>> 0);
    if (record === null || record.length === 0) return null;
    let text = '';
    for (let b = 0; b < record.length * 4; b++) {
      const c = ((record[b >> 2] ?? 0) >>> (8 * (b & 3))) & 0xff;
      if (c === 0) break;
      text += String.fromCharCode(c);
    }
    return text;
  }

  private setGlobalText(text: string, index: number): void {
    const len = Math.min(text.length, 99);
    const record = new Array<number>(Math.floor((len + 4) / 4)).fill(0);
    for (let i = 0; i < len; i++) record[i >> 2] = (record[i >> 2]! | ((text.charCodeAt(i) & 0xff) << (8 * (i & 3)))) >>> 0;
    this.dungeon.writeExpoolRecord(((EDT_GLOBAL_TEXT << 24) | (index & 0xffff)) >>> 0, record);
  }

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
      if (party.objectInHand === OBJECT_ID_NULL) return null;
      // `CURSORFILTER_DSA_DEL`, which cannot cancel; `RemoveObjectFromHand` then takes
      // whatever the hand holds once it returns (`doc/CSBwin-src/DSA.cpp:1657-1665`).
      this.cursorFilter({ object: party.objectInHand, type: CursorFilterType.DSA_DEL, p1: 0, p2: 0, p3: 0, p4: 0 });
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
    if (doit) {
      // `CURSORFILTER_DSA_MoveFrom`, which cannot cancel. The object moved is the one
      // found before it, and the hand is emptied of whatever it holds after
      // (`doc/CSBwin-src/MoveObject.cpp:130-143`).
      this.cursorFilter({ object: obj, type: CursorFilterType.DSA_MoveFrom, p1: 0, p2: 0, p3: 0, p4: 0 });
      party.objectInHand = OBJECT_ID_NULL;
    }
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
    if (doit) {
      // `CURSORFILTER_DSA_MoveTo`, which cannot cancel (`doc/CSBwin-src/MoveObject.cpp:449-455`).
      if (object !== OBJECT_ID_NULL) {
        this.cursorFilter({ object, type: CursorFilterType.DSA_MoveTo, p1: 0, p2: 0, p3: 0, p4: 0 });
      }
      party.objectInHand = object;
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
