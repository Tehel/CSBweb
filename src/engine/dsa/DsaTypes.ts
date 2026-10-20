/**
 * What the DSAs share with the rest of the game, apart from the interpreter
 * (`DsaSystem`): the `&` operations, a run's variables, and the viewing and cursor
 * filters' types, which the interface and the tools name without loading it.
 */
import type { ObjectID, Position } from '../../core/types';

/** Which of CSBWin's viewing-filter sites runs the filter (`doc/CSBwin-src/Character.cpp`). */
export enum ViewingFilterSite {
  /** `DescribeObject`'s description (`:3783`): parameter 0 is the phrase mask as it stands. */
  DESCRIPTION,
  /** `DescribeObject`'s scroll (`:3520`): parameter 0 is 0, and a DSA may name another scroll. */
  SCROLL,
  /**
   * `TAG019036`'s, the eye clicked with an empty hand (`:4541-4595`): parameter 0 is 0
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

export enum DsaVarType {
  Undefined = 0,
  WellDefined = 1,
  NonParameter = 2,
}

/** `CURSORFILTER_TYPE` (`doc/CSBwin-src/CSB.h:1398-1517`): what is about to happen to the object. */
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
 * `CURSORFILTER_PACKET` (`doc/CSBwin-src/CSB.h:1520-1529`), six `int`s. `object` is the RN
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

/** `STKOP` (`doc/CSBwin-src/Data.h:1736-1876`): every `&` operation, in CSBWin's order. */
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

/** `DSAVARS` (`doc/CSBwin-src/CSB.h:2936-2941`): a DSA run's variables. */
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
