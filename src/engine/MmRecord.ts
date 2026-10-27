/**
 * `MMRECORD` (`doc/CSBwin-src/CSB.h:2943-2956`): what one group's turn tells its monster
 * move filter. `ProcessTimers29to41` makes one per turn and hands it down, as `pmmr`, to
 * the `MoveObject`, `DeleteMonster`, `DamageMonster(Group)`, `CreateCloud`,
 * `CheckMoveFromMissile` and `ProcessMissileEncounter` the turn calls, which follow the
 * group through it. Every other caller of those passes `NULL`, and so does the port, by
 * leaving it out.
 */
import { OBJECT_ID_NULL, type LocationRel, type ObjectID } from '../core/types';
import { DsaVars } from './dsa/DsaTypes';
import type { TimerEntry } from './TimerQueue';

/** `MONSTEREVENTS` (`doc/CSBwin-src/CSB.h:2874-2927`): the turn's flags, by bit. */
export enum MonsterEvents {
  MDF6TI_turnMonsterTowardParty = 0,
  TMAG_tunrMonsterGroup = 1,
  TMAG_turnMonsterGroup = 2,
  PIn_turnMonsterGroup = 3,
  PIn_moveTwoSquaresSucceeded = 4,
  PIn_moveTwoSquaresFailed = 5,
  SF_greaterThanSmellingDistance = 6,
  SF_return = 7,
  SF_DeleteTimersMaybeSetFear = 8,
  SF_timeFuncMinusThree = 9,
  SF_TurnMonstersAsGroup = 10,
  SF_IncrementTime = 11,
  PIAF_processInvincible = 13,
  PIAF_standardFinish = 14,
  T524_possibleMove = 15,
  T524_moveSucceeded = 16,
  T524_moveFailed = 17,
  T524_processInvincibleAndFinish = 18,
  T524_mabeDeleteTimersFear6TurnIndividuals = 19,
  T524_ProcessInvincibleAndFinish = 20,
  IC29to41_atLeastOneMemberAlreadyDead = 21,
  IC29to41_damageMonsterSucceeded = 22,
  IC29to41_atLeastOneMemberAlreadDead = 23,
  IC29to41_damageMonsterFailed = 24,
  IC29to41_randomMoveSucceeded = 25,
  IC29to41_randomMoveFailed = 26,
  IC29to41_doNothing = 27,
  IC29to41_exitFalse = 28,
  TT29to41_TT31 = 29,
  TT29to41_fear5or6 = 30,
  TT29to41_TT30 = 31,
  TT29to41_fear5or6doNothing = 32,
  TT29to41_TT30turnAsGroup = 33,
  TT29to41_TT30deleteTimersMaybeSetFear = 34,
  TT29to41_TT30IncrementTimeByW52PlusRandom = 35,
  TT29to41_TT30TryDirectionsD5toD4 = 36,
  TT29to41_TT29 = 37,
  TT29to41_TTmonsterA3 = 38,
  TT29to41_blocked = 39,
  TT29to41_fearNot5or6 = 40,
  TT29to41_MaybeDeleteTimersFear6TurnIndividuals = 41,
  TT29to41_fear0or3 = 42,
  TT29to41_fear6 = 43,
  TT29to41_w30w32GretaterThan3 = 44,
  TT29to41_TTnot37 = 45,
  TT29to41_fear5 = 46,
  TT29to41_attacking = 47,
  TT29to41_notAttacking = 48,
  IC29to41_Not32_33_37_38 = 49,
  MoveObject_NotAllowedOnLevel = 50,
  MonMove_differentCell = 51,
}

export class MmRecord {
  /** `flgs[2]`: the `MonsterEvents` set, 32 to a word. */
  readonly flgs = new Uint32Array(2);
  calledPreMoveFilter = false;
  /** Where the group's turn began, set by the pre-move filter. `LOCATIONREL`'s default has `l` -1. */
  locr: LocationRel = { l: -1, x: 0, y: 0, p: 0 };
  /** Where the group is now: -1 for its level once it has left the dungeon. */
  finalLocr: LocationRel = { l: -1, x: 0, y: 0, p: 0 };
  /** The filter's timer, which the pre-move filter makes and the post-move filter reuses. */
  timer: TimerEntry | null = null;
  objMonster: ObjectID = OBJECT_ID_NULL;
  private vars: DsaVars | null = null;

  /** The DSA variables both filters share, made when the first of them runs. */
  get dsaVars(): DsaVars {
    return (this.vars ??= new DsaVars());
  }

  setflg(f: MonsterEvents): void {
    this.flgs[f >>> 5] = (this.flgs[f >>> 5]! | (1 << (f & 31))) >>> 0;
  }

  getflg(f: MonsterEvents): boolean {
    return (this.flgs[f >>> 5]! & (1 << (f & 31))) !== 0;
  }

  /** `AddObjectToRoom` putting `object` on a square (`doc/CSBwin-src/Code11f52.cpp:467-470`). */
  objectAdded(object: ObjectID, level: number, mapX: number, mapY: number): void {
    if (object === this.objMonster) this.finalLocr = { l: level, x: mapX, y: mapY, p: 0 };
  }

  /** `RemoveObjectFromRoom` taking `object` off its square (`doc/CSBwin-src/CSBCode.cpp:5250-5253`). */
  objectRemoved(object: ObjectID): void {
    if (object === this.objMonster) this.finalLocr = { l: -1, x: 0, y: 0, p: 0 };
  }
}
