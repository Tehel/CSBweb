/**
 * The monster AI state machine.
 *
 * Ports `doc/CSBwin-src/Monster.cpp`'s `InitialChecks` (:2734) and
 * `ProcessTimers29to41` (:3243) together with the helper chain they were factored
 * into — `Set_Monster_Timer` (:1341), `SetMonsterTimerB` (:1264),
 * `EnsureI60NonZero` (:1385), `Increment_Time_By_W52_Plus_Random` (:1399),
 * `Delete_Timers_Maybe_Set_Fear` (:1416), `MaybeDelTimers_Fear6_TurnIndividuals`
 * (:1440), `Turn_Monsters_As_Group` (:1561) and `StartBGroupTimer` (:1591).
 *
 * Those helpers exist because Paul Stevens unwound a pile of `goto`s in the original
 * disassembly, and his comment says so at each one. They are kept as separate
 * functions here for the same reason: the control flow only makes sense against
 * CSBWin's if you can see the same seams.
 *
 * **Everything CSBWin keeps in `d.` globals is gathered into `AiScratch`.** The AI
 * reads and writes about a dozen of them across nested calls — `d.monsterX`,
 * `d.OrthogonalDistance2Party`, `d.DirectionHasBeenTested[]`, `d.FluxCages[]`,
 * `monsterMoveInhibit[]` — and passing them explicitly is the only way to keep the
 * port readable without inventing a global of our own.
 */
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../core/types';
import type { CsbRandom } from '../core/random';
import type { CreatureRecord, Item16Record } from '../data/dungeonTypes';
import { SMS_ATTACKING } from '../data/dungeonTypes';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import { TimerFunction, type TimerEntry, type TimerQueue } from './TimerQueue';
import { StateOfFear } from './monsterTypes';
import { MonsterDamageResult } from './MonsterDamage';
import {
  DELTA_X,
  DELTA_Y,
  distanceBetweenPoints,
  getPrimaryAndSecondaryDirection,
  type MoveProbeState,
  type TurnState,
} from './MonsterPerception';
import type { MonsterDesc } from '../data/tables/MonsterDesc';
import {
  monsterDelayFromMoveToAttack,
  monsterHorizontalSize,
  monsterInvincible,
  monsterSee360,
  monsterSmellingDistance,
  monsterWord14_12_15,
  monsterWord20_0_3,
  monsterWord2Bit3,
  monsterWord2Bit4,
} from '../data/tables/MonsterDesc';
import { setPackedBits } from './MonsterSystem';
import { ordinalOfMonsterAtPosition } from './monsterPosition';
import { MmRecord, MonsterEvents } from './MmRecord';

/**
 * The values CSBWin passes by reference through the `Try_*` chain.
 *
 * Each helper takes some of these `&` and some by value; where CSBWin copies, the
 * caller here copies too, so a `Set_Monster_Timer` deep in the chain cannot reach
 * back and change a caller's `timePerMove`.
 */
export interface AiFrame {
  /** `timer_70` — always by reference. */
  timer: TimerEntry;
  /** `i_60` — the time of the group's alternate event. */
  i60: number;
  /** `w_54` — ticks since the last update, or -1 once a move has been deferred. */
  sinceLastUpdate: number;
  /** `timePerMove`, which several paths shorten as the monster hurries. */
  timePerMove: number;
  /** `bool_36` — "a move actually happened this turn". */
  bool36: boolean;
  /** `D5` — the direction the group ended up moving. */
  d5: number;
  /** `d.SecondaryDirection`. */
  secondaryDirection: number;
}

/** The values CSBWin passes as `const` for the whole turn. */
export interface AiConst {
  monsterRn: ObjectID;
  monster: CreatureRecord;
  slot: Item16Record;
  slotIndex: number;
  desc: MonsterDesc;
  mapX: number;
  mapY: number;
  level: number;
  timeUntilAlternateUpdate: number;
  indexOfLastMonster: number;
  horizSize: number;
  invincible: boolean;
  xDistance: number;
  yDistance: number;
  /** `attackDistance` — not const in practice; a few paths overwrite it. */
  attackDistance: number;
  /** `timeFunc`, rewritten into its negative form by the 29/30/31 branches. */
  timerFunction: number;
  fearFactorIs6: boolean;
  processingATimer: boolean;
  /** `&mmr`, the turn's record. */
  mmr: MmRecord;
}

/**
 * The `d.` globals the AI threads through its call chain.
 *
 * Named after CSBWin's fields so the two can be read side by side.
 */
export interface AiScratch extends MoveProbeState, TurnState {
  /** `d.monsterX` / `d.monsterY` — the group whose turn it is. */
  monsterX: number;
  monsterY: number;
  /** `d.OrthogonalDistance2Party`. */
  orthogonalDistanceToParty: number;
  /** `d.PrimaryDirectionToParty` / `d.SecondaryDirectionToParty`. */
  primaryDirectionToParty: number;
  secondaryDirectionToParty: number;
  /** `d.LastMonsterMoved` — `PossibleMove` consults it for teleporter legality. */
  lastMonsterMoved: ObjectID;
}

export function makeAiScratch(): AiScratch {
  return {
    directionHasBeenTested: new Uint8Array(4),
    monsterMoveInhibit: new Uint8Array(4),
    fluxCages: new Uint8Array(4),
    fluxCageCount: 0,
    partyX: 0,
    partyY: 0,
    monsterX: 0,
    monsterY: 0,
    orthogonalDistanceToParty: 0,
    primaryDirectionToParty: 0,
    secondaryDirectionToParty: 0,
    lastMonsterMoved: OBJECT_ID_EOF,
    lastPairTurnTime: -1,
    lastPairTurnSlot: -1,
  };
}

/** What `InitialChecks` decides. */
export interface InitialChecksResult {
  /** True when the timer has been dealt with and the AI must not run. */
  handled: boolean;
  /** `w_54` — how long since this group's last update, in ticks, modulo 256. */
  sinceLastUpdate: number;
  /** `timePerMove`, with CSBWin's 255 → 100 substitution applied. */
  timePerMove: number;
  /** `attackDistance`, which CSBWin patched to start at 24. See the note below. */
  attackDistance: number;
  /** The timer being built up for re-queueing. */
  timer: TimerEntry;
  /** The rewritten function code — negatives become TT_29/30/31. */
  timerFunction: number;
}

export class MonsterAI {
  private scratch = makeAiScratch();

  private readonly dungeon: DungeonState;
  private readonly random: CsbRandom;
  private readonly timers: TimerQueue;

  constructor(private readonly ctx: GameContext) {
    this.dungeon = ctx.dungeon;
    this.random = ctx.random;
    this.timers = ctx.timers;
  }

  /**
   * `monsterMoveInhibit[4]` (`doc/CSBwin-src/data.cpp:97`), north, east, south and west,
   * which `&MONBLK` sets and each group's turn clears before its move filter.
   */
  get monsterMoveInhibit(): Uint8Array {
    return this.scratch.monsterMoveInhibit;
  }

  /** `d.PrimaryDirectionToParty`, for `MonsterAttacks`. */
  get primaryDirectionToParty(): number {
    return this.scratch.primaryDirectionToParty;
  }

  /** `d.OrthogonalDistance2Party`, for `MonsterAttacks`. */
  get orthogonalDistanceToParty(): number {
    return this.scratch.orthogonalDistanceToParty;
  }

  /**
   * `ProcessTimers29to41` (`doc/CSBwin-src/Monster.cpp:3243`) — one monster group's
   * turn, from the top, with `mmr`, the record its monster move filter reads, and which
   * the turn hands down to every move, blow and missile that can take the group away.
   * Every `return` of CSBWin's turn runs the post-move filter first (`:3381` to
   * `:4461`), so the port runs it once the turn is over, however it ended.
   */
  processTimers29to41(options: {
    mapX: number;
    mapY: number;
    level: number;
    timerFunction: number;
    timeUntilAlternateUpdate: number;
  }): void {
    const mmr = new MmRecord();
    this.turn(options, mmr);
    this.ctx.systems.dsa.postMonsterMoveFilter(mmr);
  }

  private turn(
    options: {
      mapX: number;
      mapY: number;
      level: number;
      timerFunction: number;
      timeUntilAlternateUpdate: number;
    },
    mmr: MmRecord,
  ): void {
    const { mapX, mapY, level, timerFunction, timeUntilAlternateUpdate } = options;
    const party = this.ctx.party.state;
    const s = this.scratch;

    // "Clear all modifications to monster behaviour. The Monster Movement filter may
    // set some of these things." (doc/CSBwin-src/Monster.cpp:3306-3313)
    s.monsterMoveInhibit.fill(0);

    const monsterRn = this.dungeon.findFirstMonster(new Position(mapX, mapY, level));

    this.trace(
      `MonsterAI [0x${(monsterRn === OBJECT_ID_EOF ? 0xffff : monsterRn).toString(16).padStart(4, '0')}] ` +
        `${String(level).padStart(2, '0')}(${mapX},${mapY})@${this.ctx.state.tickCount} ` +
        `Perform Initial Checks-timeFunc=${TimerFunction[timerFunction] ?? timerFunction}, ` +
        `timeUntilAlternateUpdate=${timeUntilAlternateUpdate}`,
    );

    // "Now let the Monster Movement Filter DSA do its thing" (doc/CSBwin-src/Monster.cpp:3319-3365).
    this.ctx.systems.dsa.monsterMoveFilter(level, mapX, mapY, monsterRn, timerFunction, mmr);

    const checks = this.initialChecks(monsterRn, mapX, mapY, level, timerFunction, timeUntilAlternateUpdate, mmr);
    if (checks.handled) return;

    const monster = this.dungeon.getCreatureRecord(monsterRn);
    if (!monster) return;
    const desc = this.ctx.tables.monsterDesc[monster.creatureType];
    if (!desc) return;

    // The rest of the prologue: distances and direction to the party, and the
    // per-turn direction flags (doc/CSBwin-src/Monster.cpp:3392-3404).
    s.monsterX = mapX;
    s.monsterY = mapY;
    s.partyX = party.position.x | 0;
    s.partyY = party.position.y | 0;
    s.directionHasBeenTested.fill(0);
    s.orthogonalDistanceToParty = distanceBetweenPoints(mapX, mapY, s.partyX, s.partyY);
    const dirs = getPrimaryAndSecondaryDirection(this.random, mapX, mapY, s.partyX, s.partyY);
    s.primaryDirectionToParty = dirs.primary;
    s.secondaryDirectionToParty = dirs.secondary;

    const invincible = monsterInvincible(desc);
    const fearFactor = monster.fear;
    const indexOfLastMonster = monster.numMonM1 & 0x3;
    const horizSize = monsterHorizontalSize(desc);

    this.trace(
      `      MAI Passed. Invincible=${invincible ? 1 : 0} fearFactor=${fearFactor} ` +
        `w_54=${checks.sinceLastUpdate} indexOfLastMonster=${indexOfLastMonster} horizSize=${horizSize}`,
    );

    const slot = this.dungeon.getAttachedItem16(monster);
    if (!slot) return;

    const xDistance = Math.abs(mapX - s.partyX);
    const yDistance = Math.abs(mapY - s.partyY);

    const frame: AiFrame = {
      timer: checks.timer,
      i60: 0,
      sinceLastUpdate: checks.sinceLastUpdate,
      timePerMove: checks.timePerMove,
      bool36: false,
      d5: 0,
      secondaryDirection: s.secondaryDirectionToParty,
    };

    const c: AiConst = {
      monsterRn,
      monster,
      slot,
      slotIndex: monster.groupIndex,
      desc,
      mapX,
      mapY,
      level,
      timeUntilAlternateUpdate,
      indexOfLastMonster,
      horizSize,
      invincible,
      xDistance,
      yDistance,
      attackDistance: checks.attackDistance,
      timerFunction: timerFunction,
      fearFactorIs6: false,
      processingATimer: true,
      mmr,
    };

    this.dispatch(frame, c, fearFactor);
  }

  /**
   * The `timeFunc` dispatch at the heart of `ProcessTimers29to41`
   * (`doc/CSBwin-src/Monster.cpp:3417-4475`).
   *
   * Three shapes of turn, in the order CSBWin tests them:
   *
   * - **29, 30, 31** — a *reaction*. The group was attacked (31), damaged (30) or
   *   hurt by a cloud or door (29). Each rewrites `timeFunc` into its negative twin
   *   so that everything downstream can tell a reaction from a scheduled turn.
   * - **32-36** — the "A" family: the group or one member is part-way through
   *   something and this is the earlier of its two scheduled times.
   * - **37-41** — the "B" family, the ordinary turn. 37 is the group as a whole;
   *   38-41 are individual members, which only exist in fear state 6.
   */
  private dispatch(frame: AiFrame, c: AiConst, fearFactor: number): void {
    const fn = c.timerFunction;

    if (fn === TimerFunction.TT_31) {
      // The party ran into us, or attacked us.
      c.mmr.setflg(MonsterEvents.TT29to41_TT31);
      c.timerFunction = TimerFunction.TT_M1;
      if (fearFactor !== StateOfFear.StateOfFear6 && fearFactor !== StateOfFear.StateOfFear5) {
        // CSBWin names the flag for the other branch (`doc/CSBwin-src/Monster.cpp:3427`).
        c.mmr.setflg(MonsterEvents.TT29to41_fear5or6);
        this.trace('      MAI timeFunc 31.  FearFactor not 5 or 6. So Delete all timers and set fear to 6.');
        this.timers.deleteMonsterMovementTimers(c.mapX, c.mapY, c.level, (line) => this.trace(line));
        this.maybeDelTimersFear6TurnIndividuals(
          c.monster, c.slot, c.slotIndex, frame.timer, c.timeUntilAlternateUpdate,
          c.timerFunction, c.mapX, c.mapY, c.level, c.desc,
          c.indexOfLastMonster, c.horizSize, true, c.mmr,
        );
        return;
      }
      this.trace('      MAI timeFunc 31.  FearFactor is 5 or 6.');
      this.rememberPartyPosition(c.slot);
      return;
    }

    if (fn === TimerFunction.TT_30) {
      c.mmr.setflg(MonsterEvents.TT29to41_TT30);
      c.timerFunction = TimerFunction.TT_M2;
      if (fearFactor === StateOfFear.StateOfFear6 || fearFactor === StateOfFear.StateOfFear5) {
        this.trace('      MAI timeFunc 30.  FearFactor is 5 or 6.');
        c.mmr.setflg(MonsterEvents.TT29to41_fear5or6doNothing);
        return;
      }
      const fearIs2or3 = fearFactor === StateOfFear.StateOfFear2 || fearFactor === StateOfFear.StateOfFear3;
      if (fearIs2or3 || this.random.zeroTo3() !== 0) {
        const seen = this.blocked(c, -1);
        this.trace(`      MAI timeFunc 31. FearFactor 2 or 3 or random. Block=${seen}`);
        if (seen === 0) {
          frame.bool36 = false;
          c.fearFactorIs6 = false;
          this.turnMonstersAsGroup(
            c.slot, c.slotIndex, frame.d5, c.indexOfLastMonster, c.horizSize,
            frame.bool36, frame.sinceLastUpdate, c.mmr,
          );
          c.mmr.setflg(MonsterEvents.TT29to41_TT30turnAsGroup);
          if (c.timerFunction < TimerFunction.TT_M1) {
            if (!frame.bool36) return;
            c.mmr.setflg(MonsterEvents.TT29to41_TT30deleteTimersMaybeSetFear);
            this.deleteTimersMaybeSetFear(c.monster, c.slotIndex, c.mapX, c.mapY, c.level, c.fearFactorIs6);
          }
          c.mmr.setflg(MonsterEvents.TT29to41_TT30IncrementTimeByW52PlusRandom);
          this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
          this.startBGroupTimer(
            frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, true, c.mapX, c.mapY,
          );
          return;
        }
        if (fearIs2or3) return;
        if (this.random.zeroTo3() !== 0) return;
      }
      c.fearFactorIs6 = fearFactor === StateOfFear.StateOfFear6;
      frame.bool36 = false;
      c.mmr.setflg(MonsterEvents.TT29to41_TT30TryDirectionsD5toD4);
      this.tryDirectionsD5ToD4(frame, c);
      return;
    }

    if (fn === TimerFunction.TT_29) {
      c.mmr.setflg(MonsterEvents.TT29to41_TT29);
      this.trace('      MAI timeFunc 29.');
      c.timerFunction = TimerFunction.TT_M3;
      c.fearFactorIs6 = fearFactor === StateOfFear.StateOfFear6;
      frame.bool36 = false;
      this.tryDirectionsD5ToD4(frame, c);
      return;
    }

    if (fn <= TimerFunction.TT_MONSTER_A3) {
      this.processATimer(frame, c, fearFactor);
      return;
    }

    // The B family.
    c.processingATimer = false;
    this.trace('      MAI timeFunc>=37.');
    if (c.timeUntilAlternateUpdate !== 0) frame.i60 = this.ctx.state.tickCount;

    if (fn !== TimerFunction.TT_MONSTER_BGROUP) {
      this.processIndividualBTimer(frame, c, fearFactor);
      return;
    }
    this.processGroupBTimer(frame, c, fearFactor);
  }

  /**
   * Timer types 32-36 — the "A" family (`doc/CSBwin-src/Monster.cpp:3615-3762`).
   *
   * The timer flips to its B twin and then, mostly, just reschedules. The interesting
   * cases are being seen by a party that is *adjacent* (break formation) and being in
   * fear state 0 or 3 while seen at range (go to state 7 and charge).
   */
  private processATimer(frame: AiFrame, c: AiConst, fearFactor: number): void {
    c.mmr.setflg(MonsterEvents.TT29to41_TTmonsterA3);
    const flipped = A_TO_B[c.timerFunction];
    if (flipped === undefined) {
      this.trace(`MonsterAI: illegal monster AI timer ${c.timerFunction}`);
      return;
    }
    frame.timer.function = flipped;
    this.trace(`      MAI timeFunc<37. Set New timerFunction to ${TimerFunction[flipped] ?? flipped}`);

    const seen = this.blocked(c, -1);
    this.trace(`      MAI timeFunc<37.  Blocked=${seen}`);
    if (seen !== 0) {
      c.mmr.setflg(MonsterEvents.TT29to41_blocked);
      if (fearFactor !== StateOfFear.StateOfFear6 && fearFactor !== StateOfFear.StateOfFear5) {
        c.mmr.setflg(MonsterEvents.TT29to41_fearNot5or6);
        if (c.xDistance + c.yDistance <= 1) {
          c.mmr.setflg(MonsterEvents.TT29to41_MaybeDeleteTimersFear6TurnIndividuals);
          this.maybeDelTimersFear6TurnIndividuals(
            c.monster, c.slot, c.slotIndex, frame.timer, c.timeUntilAlternateUpdate,
            c.timerFunction, c.mapX, c.mapY, c.level, c.desc,
            c.indexOfLastMonster, c.horizSize, true, c.mmr,
          );
          return;
        }
        // CSBWin's comment on the next line: "The following line makes no sense. But
        // I have studied the original machine language over and over again. This is
        // what it did." The `fearFactor != 7` term cannot fail once the first two
        // have passed, and `tsc` narrows the type enough to say so — hence the
        // widened local, which keeps the test as written rather than dropping it
        // (doc/CSBwin-src/Monster.cpp:3677-3684).
        const fear: number = fearFactor;
        const notSeven = (v: number): boolean => v !== (StateOfFear.StateOfFear7 as number);
        if (
          (fear === StateOfFear.StateOfFear0 || fear === StateOfFear.StateOfFear3) &&
          notSeven(fear)
        ) {
          c.mmr.setflg(MonsterEvents.TT29to41_fear0or3);
          c.monster.fear = StateOfFear.StateOfFear7;
          this.rememberPartyPosition(c.slot);
          frame.timer.time = (frame.timer.time + 1) >>> 0;
          this.startBGroupTimer(
            frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, true, c.mapX, c.mapY,
          );
          return;
        }
      }
      this.rememberPartyPosition(c.slot);
    }

    if (fearFactor === StateOfFear.StateOfFear6) {
      c.mmr.setflg(MonsterEvents.TT29to41_fear6);
      this.trace('      MAI fearFactor==6');
      const member = c.timerFunction - TimerFunction.TT_MONSTER_A0;
      frame.i60 = this.ctx.systems.monsters.nextMonsterUpdateTime(
        c.slot,
        member,
        ((c.slot.singleMonsterStatus[member] ?? 0) & SMS_ATTACKING) !== 0,
        c.mapX,
        c.mapY,
        c.level,
      );
      this.setMonsterTimer(frame.timer, frame.i60, c.timeUntilAlternateUpdate, true);
      return;
    }

    if (c.xDistance > 3 || c.yDistance > 3) {
      c.mmr.setflg(MonsterEvents.TT29to41_w30w32GretaterThan3);
      frame.i60 = this.ctx.state.tickCount + monsterDelayFromMoveToAttack(c.desc);
      this.trace(
        `      MAI fearFactor != 6.  Distance to party > 3.  mt->word20 = ${c.desc.word20}`,
      );
      this.setMonsterTimer(frame.timer, frame.i60, c.timeUntilAlternateUpdate, true);
      return;
    }

    frame.i60 = this.ensureI60NonZero(frame.i60, c.slot, c.mapX, c.mapY, c.level);
    this.setMonsterTimer(frame.timer, frame.i60, c.timeUntilAlternateUpdate, true);
  }

  /**
   * Timer types 38-41 — one member's own turn
   * (`doc/CSBwin-src/Monster.cpp:3784-4119`).
   *
   * A member already attacking simply schedules its next swing. One that is not
   * decides whether it can attack: it must be able to see the party, be facing it (or
   * see in all directions), be within `word14_12_15` cells, be orthogonally aligned,
   * and win a die roll against that same value. Failing any of it, it shuffles
   * position inside the cell, or turns, or gives up and moves.
   */
  private processIndividualBTimer(frame: AiFrame, c: AiConst, fearFactor: number): void {
    c.mmr.setflg(MonsterEvents.TT29to41_TTnot37);
    if (fearFactor === StateOfFear.StateOfFear5) {
      c.mmr.setflg(MonsterEvents.TT29to41_fear5);
      if (c.indexOfLastMonster !== 0) {
        this.ctx.systems.monsters.clearAttackingAndDeleteMovementTimers(c.slotIndex, c.mapX, c.mapY, c.level);
      }
      this.tryToMove(frame, c);
      return;
    }

    const member = c.timerFunction - TimerFunction.TT_MONSTER_B0;
    if (((c.slot.singleMonsterStatus[member] ?? 0) & SMS_ATTACKING) !== 0) {
      // Mid-attack: schedule the follow-through.
      c.mmr.setflg(MonsterEvents.TT29to41_attacking);
      frame.i60 = this.ctx.systems.monsters.nextMonsterUpdateTime(c.slot, member, false, c.mapX, c.mapY, c.level);
      const roll = this.random.zeroTo3();
      const attackTicks = c.desc.attackTicks07 & 0xff;
      frame.timer.time = (frame.timer.time + ((attackTicks + roll - 1) & 0xffff)) >>> 0;
      if (attackTicks > 15) {
        // A slow attack gets a signed jitter, which can pull the time *earlier*.
        frame.timer.time = (frame.timer.time + ((this.random.next() & 7) - 2)) >>> 0;
      }
      frame.timer.function = c.timerFunction;
      this.setMonsterTimer(frame.timer, frame.i60, c.timeUntilAlternateUpdate, false);
      return;
    }

    c.mmr.setflg(MonsterEvents.TT29to41_notAttacking);
    if (member > c.indexOfLastMonster) return;

    const preferredDirection = this.scratch.primaryDirectionToParty;
    let attackDistance = this.blocked(c, member);
    if (attackDistance !== 0) this.rememberPartyPosition(c.slot);

    // A lone monster in an open cell sometimes shuffles to another corner, or spreads
    // to fill the cell (positions = 0xff) (doc/CSBwin-src/Monster.cpp:3860-3907).
    let shuffle = 0;
    if (c.indexOfLastMonster === 0 && c.horizSize !== 2) {
      shuffle = this.random.next() & 0xffff;
      if ((shuffle & 0xc0) === 0) {
        if (c.slot.positions !== 255) {
          if (shuffle & 0x38) {
            c.slot.positions = 0xff;
          } else {
            const turn = shuffle & 1 ? 1 : -1;
            shuffle = (c.slot.positions + turn) & 0x3;
            // CSBWin: "I think there is something wrong with D5 here." The value is
            // reused below as both a position and a bitfield.
          }
        }
        if ((shuffle & 0x38) === 0 && attackDistance !== 1 && c.horizSize === 0) {
          if (this.checkMonsterVersusMissiles(c)) return;
          c.slot.positions = shuffle & 0x3;
        }
      }
    }

    const facingParty =
      monsterSee360(c.desc) || ((c.slot.facings >> (2 * member)) & 0x3) === preferredDirection;

    if (attackDistance !== 0 && facingParty) {
      const reach = monsterWord14_12_15(c.desc);
      if (
        attackDistance <= reach &&
        (c.xDistance === 0 || c.yDistance === 0) &&
        reach <= this.random.below(16) + 1
      ) {
        if (reach === 1 && this.sidestepBeforeMeleeing(frame, c, member, preferredDirection)) return;

        // Attack.
        frame.i60 = this.ctx.systems.monsters.nextMonsterUpdateTime(
          c.slot,
          member,
          this.ctx.systems.monsterAttack.monsterAttacks(c.monsterRn, c.monster, c.mapX, c.mapY, member, {
            level: this.ctx.party.state.position.z,
            primaryDirectionToParty: this.primaryDirectionToParty,
            orthogonalDistanceToParty: this.orthogonalDistanceToParty,
          }),
          c.mapX,
          c.mapY,
          c.level,
        );
        frame.timer.time =
          (frame.timer.time + ((monsterWord20_0_3(c.desc) + this.random.bool()) & 0xffff)) >>> 0;
      } else {
        c.monster.fear = StateOfFear.StateOfFear7;
        if (c.indexOfLastMonster !== 0) {
          this.ctx.systems.monsters.clearAttackingAndDeleteMovementTimers(c.slotIndex, c.mapX, c.mapY, c.level);
        }
        this.d4d0Finish(frame, c);
        return;
      }
    } else {
      const seen = this.blocked(c, -1);
      if (seen !== 0) {
        this.rememberPartyPosition(c.slot);
        const ref = { facings: c.slot.facings };
        this.ctx.systems.monsterPerception.turnMonster(
          this.scratch, c.slotIndex, ref, preferredDirection, member,
          c.indexOfLastMonster !== 0 && c.horizSize === 1, this.ctx.state.tickCount,
        );
        c.slot.facings = ref.facings;
        frame.timer.time = (frame.timer.time + 2) >>> 0;
        frame.i60 = frame.timer.time;
      } else {
        c.monster.fear = StateOfFear.StateOfFear7;
        if (c.indexOfLastMonster !== 0) {
          this.ctx.systems.monsters.clearAttackingAndDeleteMovementTimers(c.slotIndex, c.mapX, c.mapY, c.level);
        }
        this.tryUByte67(frame, c, preferredDirection);
        return;
      }
    }

    frame.timer.function = c.timerFunction;
    this.setMonsterTimer(frame.timer, frame.i60, c.timeUntilAlternateUpdate, false);
    void attackDistance;
  }

  /**
   * A monster about to melee that is standing in the wrong corner shifts sideways
   * first (`doc/CSBwin-src/Monster.cpp:3939-4013`). Returns true when it did, in
   * which case the turn is over.
   */
  private sidestepBeforeMeleeing(
    frame: AiFrame,
    c: AiConst,
    member: number,
    preferredDirection: number,
  ): boolean {
    if (
      !(
        (!monsterWord2Bit3(c.desc) || this.random.zeroTo3() === 0 || !monsterWord2Bit4(c.desc)) &&
        c.horizSize === 0 &&
        c.slot.positions !== 255
      )
    ) {
      return false;
    }

    let pos = (c.slot.positions >> (2 * member)) & 0x3;
    if (preferredDirection === pos) return false;
    if (pos === ((preferredDirection + 1) & 0x3)) return false;

    if (c.indexOfLastMonster === 0 && this.random.bool() !== 0) {
      // CSBWin has the assignment `pI16A2->uByte3 = 0xff` commented out here, so this
      // branch deliberately does nothing but consume the die roll.
    } else {
      pos = ((preferredDirection & 1) === (pos & 1) ? pos - 1 : pos + 1) & 0x3;
      let ordinal = ordinalOfMonsterAtPosition(this.dungeon, this.ctx.tables.monsterDesc, c.monster, pos);
      if (ordinal !== 0 && this.random.bool() !== 0) {
        pos = (pos + 2) & 0x3;
        ordinal = ordinalOfMonsterAtPosition(this.dungeon, this.ctx.tables.monsterDesc, c.monster, pos);
      }
      if (ordinal === 0) {
        if (this.checkMonsterVersusMissiles(c)) return true;
        // `d.MonsterDamageResult != 1` (`doc/CSBwin-src/Monster.cpp:3980`): a missile that
        // killed some of the group but not all leaves its corners as they were.
        if (this.ctx.systems.missileEncounter.monsterDamageResult !== MonsterDamageResult.SOME_NOT_ALL_MONSTERS_DIED) {
          c.slot.positions = setPackedBits(c.slot.positions, member, pos);
        }
      }
    }

    const delay = Math.max(1, Math.trunc(c.desc.movementTicks06 / 2) + this.random.bool());
    frame.timer.time = (frame.timer.time + delay) >>> 0;
    frame.timer.function = c.timerFunction;
    frame.i60 = this.ensureI60NonZero(frame.i60, c.slot, c.mapX, c.mapY, c.level);
    this.setMonsterTimer(frame.timer, frame.i60, c.timeUntilAlternateUpdate, false);
    return true;
  }

  /**
   * Timer type 37 — the group's ordinary turn
   * (`doc/CSBwin-src/Monster.cpp:4119-4465`).
   *
   * Fear state decides almost everything. States 0, 2 and 3 are the calm ones and can
   * end in a hunt; 5 flees; 7 charges; anything else just waits.
   */
  private processGroupBTimer(frame: AiFrame, c: AiConst, fearFactor: number): void {
    this.trace('      MAI timeFunc=37.');

    if (
      fearFactor !== StateOfFear.StateOfFear0 &&
      fearFactor !== StateOfFear.StateOfFear2 &&
      fearFactor !== StateOfFear.StateOfFear3
    ) {
      this.trace('      MAI fearFactor not 0, 2, or 3');
      if (fearFactor !== StateOfFear.StateOfFear7) {
        if (fearFactor !== StateOfFear.StateOfFear5) {
          this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
          this.startBGroupTimer(
            frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, false, c.mapX, c.mapY,
          );
          return;
        }
        this.tryToMove(frame, c);
        return;
      }
      // State 7: charging.
      const seen = this.blocked(c, -1);
      if (seen !== 0) {
        if (seen <= monsterWord14_12_15(c.desc) && (c.xDistance === 0 || c.yDistance === 0)) {
          this.maybeDelTimersFear6TurnIndividuals(
            c.monster, c.slot, c.slotIndex, frame.timer, c.timeUntilAlternateUpdate,
            c.timerFunction, c.mapX, c.mapY, c.level, c.desc,
            c.indexOfLastMonster, c.horizSize, false, c.mmr,
          );
          return;
        }
        c.attackDistance = seen;
        this.d4d0Finish(frame, c);
        return;
      }
      this.tryUByte67(frame, c, this.scratch.primaryDirectionToParty);
      return;
    }

    const seen = this.blocked(c, -1);
    this.trace(`      MAI fearFactor is 0, 2, or 3.  attackDistance=${seen}`);
    if (seen !== 0) {
      if (seen <= monsterWord14_12_15(c.desc) && (c.xDistance === 0 || c.yDistance === 0)) {
        this.maybeDelTimersFear6TurnIndividuals(
          c.monster, c.slot, c.slotIndex, frame.timer, c.timeUntilAlternateUpdate,
          c.timerFunction, c.mapX, c.mapY, c.level, c.desc,
          c.indexOfLastMonster, c.horizSize, false, c.mmr,
        );
        return;
      }
      if (fearFactor !== StateOfFear.StateOfFear2) {
        c.monster.fear = StateOfFear.StateOfFear7;
        this.rememberPartyPosition(c.slot);
        frame.timer.time = (frame.timer.time + 1) >>> 0;
        this.startBGroupTimer(
          frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, false, c.mapX, c.mapY,
        );
        return;
      }
      this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
      this.startBGroupTimer(
        frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, false, c.mapX, c.mapY,
      );
      return;
    }

    if (fearFactor !== StateOfFear.StateOfFear0) {
      this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
      this.startBGroupTimer(
        frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, false, c.mapX, c.mapY,
      );
      return;
    }

    // Fear state 0 and the party is out of sight: hunt by smell.
    const smelled = this.ctx.systems.monsterPerception.getBestMonsterFacing(c.desc, c.level, c.mapX, c.mapY, {
      partyX: this.scratch.partyX,
      partyY: this.scratch.partyY,
      orthogonalDistanceToParty: this.scratch.orthogonalDistanceToParty,
      primaryDirectionToParty: this.scratch.primaryDirectionToParty,
      secondaryDirectionToParty: this.scratch.secondaryDirectionToParty,
    });
    this.trace(`      MAI fearFactor is 0. Preferred Direction=${smelled.direction}`);
    if (smelled.direction !== 0) {
      frame.secondaryDirection = smelled.secondary;
      this.tryPreferredDirectionThenOthers(frame, c, smelled.direction - 1, false);
      return;
    }

    frame.bool36 = false;
    if (this.random.bool() === 0) {
      this.trace('      MAI No Preferrred Direction.  RandomBool()=0.');
      this.processInvincibleAndFinish(frame, c, 0);
      return;
    }
    this.trace('      MAI No Preferrred Direction.  RandomBool()=1.');
    this.tryDirectionsD5ToD4(frame, c);
  }

  /* ------------------------------------------------------- the Try_* chain ---- */

  /**
   * `Try_Directions_D5_To_D4` (`doc/CSBwin-src/Monster.cpp:2384`).
   *
   * Try all four directions starting from a random one, wrapping round. A direction
   * that would double back to the square just left is skipped three times out of
   * four. If the step would land on the party, that counts as finding it.
   */
  private tryDirectionsD5ToD4(frame: AiFrame, c: AiConst): void {
    const start = this.random.zeroTo3();
    frame.d5 = start;
    let direction = start;

    do {
      const newX = c.mapX + (DELTA_X[direction] ?? 0);
      const newY = c.mapY + (DELTA_Y[direction] ?? 0);

      let skip = false;
      if (c.slot.ubPrevX === newX && c.slot.ubPrevY === newY) {
        // Doubling straight back: only one time in four.
        skip = this.random.zeroTo3() !== 0;
      }

      if (!skip) {
        const probe = this.ctx.systems.monsterPerception.possibleMove(
          c.monsterRn, c.desc, c.level, c.mapX, c.mapY, direction, false, this.scratch,
        );
        if (probe.possible) {
          c.mmr.setflg(MonsterEvents.T524_possibleMove);
          frame.d5 = direction;
          const stays = this.stepOrDefer(frame, c, newX, newY);
          if (frame.bool36) c.mmr.setflg(stays ? MonsterEvents.T524_moveFailed : MonsterEvents.T524_moveSucceeded);
          if (!stays) return;
          c.mmr.setflg(MonsterEvents.T524_processInvincibleAndFinish);
          this.processInvincibleAndFinish(frame, c, direction);
          return;
        }
        if (probe.moveOntoPartyPosition && c.timerFunction !== TimerFunction.TT_M3) {
          // Reaching the party is as good as arriving. The `& 15 != 5` test throttles
          // how often a group re-forms (doc/CSBwin-src/Monster.cpp:2501-2517).
          if (
            (c.timeUntilAlternateUpdate & 15) !== 5 ||
            this.ctx.systems.monsterPerception.findPossibleMove(
              c.monsterRn, c.desc, c.level, c.mapX, c.mapY, false, this.scratch,
            ) === 0 ||
            this.random.bool() !== 0
          ) {
            c.mmr.setflg(MonsterEvents.T524_mabeDeleteTimersFear6TurnIndividuals);
            this.maybeDelTimersFear6TurnIndividuals(
              c.monster, c.slot, c.slotIndex, frame.timer, c.timeUntilAlternateUpdate,
              c.timerFunction, c.mapX, c.mapY, c.level, c.desc,
              c.indexOfLastMonster, c.horizSize, c.processingATimer, c.mmr,
            );
            return;
          }
        }
        if (probe.moveOntoPartyPosition) this.rememberPartyPosition(c.slot);
      }

      direction = (direction + 1) & 0x3;
    } while (start !== direction);

    frame.d5 = direction;
    c.mmr.setflg(MonsterEvents.T524_ProcessInvincibleAndFinish);
    this.processInvincibleAndFinish(frame, c, direction);
  }

  /**
   * `Try_Preferred_Direction_Then_Others` (`doc/CSBwin-src/Monster.cpp:2005`).
   *
   * Four candidate directions in a fixed order: the preferred one, the secondary, the
   * secondary reversed, and the preferred reversed — the last two each behind a die
   * roll. The whole thing is one short-circuiting `&&` chain in CSBWin, and the
   * side effects of each `PossibleMove` matter, so it is kept in that shape.
   */
  private tryPreferredDirectionThenOthers(
    frame: AiFrame,
    c: AiConst,
    preferredDirection: number,
    recognizesFalsePitsAndWalls: boolean,
  ): void {
    const rfpaw = recognizesFalsePitsAndWalls;
    const probe = (dir: number, rec: boolean): boolean =>
      this.ctx.systems.monsterPerception.possibleMove(
        c.monsterRn, c.desc, c.level, c.mapX, c.mapY, dir, rec, this.scratch,
      ).possible;

    let dir = preferredDirection;
    let found = probe(dir, rfpaw);
    if (!found) {
      dir = frame.secondaryDirection;
      found = probe(dir, rfpaw && this.random.bool() !== 0);
    }
    if (!found) {
      dir = (dir + 2) & 0x3;
      found = probe(dir, false);
    }
    if (!found && this.random.zeroTo3() === 0) {
      dir = (preferredDirection + 2) & 0x3;
      found = probe(dir, false);
    }

    if (!found) {
      if (!c.invincible) {
        this.turnMonsterGroup(c.slot, c.slotIndex, preferredDirection, c.indexOfLastMonster, c.horizSize);
        this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
        this.startBGroupTimer(
          frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, c.processingATimer, c.mapX, c.mapY,
        );
        return;
      }
      if (this.processInvincible(frame, c, preferredDirection)) return;
    } else {
      frame.d5 = dir;
      const newX = c.mapX + (DELTA_X[dir] ?? 0);
      const newY = c.mapY + (DELTA_Y[dir] ?? 0);
      if (!this.stepOrDefer(frame, c, newX, newY)) return;
    }

    this.processInvincibleAndFinish(frame, c, preferredDirection);
  }

  /**
   * `Try_To_Move` (`doc/CSBwin-src/Monster.cpp:2160`) — the fleeing path.
   *
   * A monster that can see the party runs *away* from it: the preferred direction is
   * the direction to the party turned 180°, and `timePerMove` is cut by a quarter so
   * it flees faster than it hunts. `uByte5` counts down the panic; when it reaches
   * zero the group calms to fear state 0.
   */
  private tryToMove(frame: AiFrame, c: AiConst): void {
    const seen = this.blocked(c, -1);
    if (seen !== 0) {
      this.rememberPartyPosition(c.slot);
      const dirs = getPrimaryAndSecondaryDirection(
        this.random, c.mapX, c.mapY, this.scratch.partyX, this.scratch.partyY,
      );
      const away = (dirs.primary + 2) & 0x3;
      frame.secondaryDirection = (dirs.secondary + 2) & 0x3;
      frame.timePerMove = frame.timePerMove - Math.trunc(frame.timePerMove / 4);
      this.tryPreferredDirectionThenOthers(frame, c, away, true);
      return;
    }

    c.slot.uByte5 = (c.slot.uByte5 - 1) & 0xff;
    if (c.slot.uByte5 !== 0) {
      if (this.random.bool() !== 0) {
        const anyMove = this.ctx.systems.monsterPerception.findPossibleMove(
          c.monsterRn, c.desc, c.level, c.mapX, c.mapY, false, this.scratch,
        );
        if (anyMove === 0 && c.xDistance + c.yDistance <= 1) {
          // Cornered next to the party: stop panicking.
          c.monster.fear = StateOfFear.StateOfFear0;
          this.turnMonstersAsGroup(
            c.slot, c.slotIndex, frame.d5, c.indexOfLastMonster, c.horizSize, false, frame.sinceLastUpdate, c.mmr,
          );
          if (c.timerFunction < TimerFunction.TT_M1) return;
          this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
          this.startBGroupTimer(
            frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, c.processingATimer, c.mapX, c.mapY,
          );
          return;
        }
        // Head back towards where the group came from.
        const dirs = getPrimaryAndSecondaryDirection(
          this.random, c.mapX, c.mapY, c.slot.uByte10, c.slot.uByte11,
        );
        frame.secondaryDirection = dirs.secondary;
        this.tryPreferredDirectionThenOthers(frame, c, dirs.primary, true);
        return;
      }
      const dirs = getPrimaryAndSecondaryDirection(
        this.random, c.mapX, c.mapY, c.slot.uByte6, c.slot.uByte7,
      );
      frame.secondaryDirection = (dirs.secondary + 2) & 0x3;
      frame.timePerMove = frame.timePerMove - Math.trunc(frame.timePerMove / 4);
      this.tryPreferredDirectionThenOthers(frame, c, (dirs.primary + 2) & 0x3, true);
      return;
    }

    // The panic ran out.
    c.monster.fear = StateOfFear.StateOfFear0;
    this.turnMonstersAsGroup(
      c.slot, c.slotIndex, frame.d5, c.indexOfLastMonster, c.horizSize, false, frame.sinceLastUpdate, c.mmr,
    );
    if (c.timerFunction < TimerFunction.TT_M1) return;
    this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
    this.startBGroupTimer(
      frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, c.processingATimer, c.mapX, c.mapY,
    );
  }

  /**
   * `D4D0Finish` (`doc/CSBwin-src/Monster.cpp:2561`) — close in on the party at
   * double speed.
   */
  private d4d0Finish(frame: AiFrame, c: AiConst): void {
    frame.timePerMove = Math.trunc((frame.timePerMove + 1) / 2);
    this.rememberPartyPosition(c.slot);
    const dirs = getPrimaryAndSecondaryDirection(
      this.random, c.mapX, c.mapY, this.scratch.partyX, this.scratch.partyY,
    );
    frame.secondaryDirection = dirs.secondary;
    this.tryPreferredDirectionThenOthers(frame, c, dirs.primary, true);
  }

  /**
   * `TryUByte67` (`doc/CSBwin-src/Monster.cpp:2629`) — head for the square the group
   * last knew the party to be at. Standing on it already means the trail is cold, so
   * the group calms down.
   */
  private tryUByte67(frame: AiFrame, c: AiConst, preferredDirection: number): void {
    void preferredDirection;
    if (c.mapX === c.slot.uByte6 && c.mapY === c.slot.uByte7) {
      c.monster.fear = StateOfFear.StateOfFear0;
      this.turnMonstersAsGroup(
        c.slot, c.slotIndex, frame.d5, c.indexOfLastMonster, c.horizSize, false, frame.sinceLastUpdate, c.mmr,
      );
      if (c.timerFunction < TimerFunction.TT_M1) return;
      this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
      this.startBGroupTimer(
        frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, c.processingATimer, c.mapX, c.mapY,
      );
      return;
    }
    const dirs = getPrimaryAndSecondaryDirection(
      this.random, c.mapX, c.mapY, c.slot.uByte6, c.slot.uByte7,
    );
    frame.secondaryDirection = dirs.secondary;
    this.tryPreferredDirectionThenOthers(frame, c, dirs.primary, true);
  }

  /**
   * `Process_Invincible` (`doc/CSBwin-src/Monster.cpp:1616`) — Lord Chaos moves *two*
   * squares at a time, and a Fluxcage is what stops him.
   *
   * Returns true when the turn is finished. The `FindPossibleMove` call at the top
   * looks pointless — its result is discarded — but it is what populates
   * `d.FluxCages[]` and `d.FluxCageCount` for the tests below.
   */
  private processInvincible(frame: AiFrame, c: AiConst, preferredDirection: number): boolean {
    this.trace('      MAI Entering Process_Invincible');
    this.ctx.systems.monsterPerception.findPossibleMove(
      c.monsterRn, c.desc, c.level, c.mapX, c.mapY, false, this.scratch,
    );

    const doubleMove = (dir: number): boolean =>
      this.ctx.systems.monsterPerception.possibleDoubleMove(
        c.monsterRn, c.desc, c.level, c.mapX, c.mapY, dir, this.scratch,
      );

    let dir = preferredDirection;
    let ok = doubleMove(dir);
    if (!ok) {
      dir = frame.secondaryDirection;
      ok = doubleMove(dir);
      if (!ok) {
        if (this.scratch.fluxCageCount !== 0) {
          dir = (dir + 2) & 0x3;
          ok = doubleMove(dir);
        }
        if (!ok) {
          if (this.scratch.fluxCageCount < 2) {
            this.turnAndWait(frame, c, preferredDirection);
            return true;
          }
          dir = (preferredDirection + 2) & 0x3;
          ok = doubleMove(dir);
          if (!ok) {
            this.turnAndWait(frame, c, preferredDirection);
            return true;
          }
        }
      }
    }

    frame.d5 = dir;
    const newX = c.mapX + 2 * (DELTA_X[dir] ?? 0);
    const newY = c.mapY + 2 * (DELTA_Y[dir] ?? 0);
    this.ctx.systems.monsters.playTeleportSound(newX, newY, c.level);

    const remaining = frame.timePerMove / 2 - frame.sinceLastUpdate;
    frame.bool36 = remaining <= 0;
    if (frame.bool36) {
      // Any non-zero `MoveObject` ends the turn; otherwise the timer follows the group to
      // `d.NewX, d.NewY` (`doc/CSBwin-src/Monster.cpp:1715-1724`).
      const moved = this.ctx.systems.monsters.moveMonster(c.monsterRn, c.mapX, c.mapY, newX, newY, c.level, undefined, c.mmr);
      if (moved.code !== 0) {
        c.mmr.setflg(MonsterEvents.PIn_moveTwoSquaresSucceeded);
        return true;
      }
      c.mmr.setflg(MonsterEvents.PIn_moveTwoSquaresFailed);
      frame.timer.uByte6 = moved.position.x & 0xff;
      frame.timer.uByte7 = moved.position.y & 0xff;
      c.slot.ubPrevX = c.mapX & 0xff;
      c.slot.ubPrevY = c.mapY & 0xff;
      c.slot.uByte4 = this.ctx.state.tickCount & 0xff;
    } else {
      frame.timePerMove = remaining;
      frame.sinceLastUpdate = -1;
    }
    return false;
  }

  /**
   * `Process_Invincible_And_Finish` (`doc/CSBwin-src/Monster.cpp:1898`) — an
   * invincible monster keeps trying random double-moves until one works or the loop
   * conditions fail; everything else falls straight through to `Standard_Finish`.
   */
  private processInvincibleAndFinish(frame: AiFrame, c: AiConst, preferredDirection: number): void {
    this.trace('      MAI Entering Process_Invincible_And_Finish');
    let preferred = preferredDirection;
    while (
      !frame.bool36 &&
      frame.sinceLastUpdate !== -1 &&
      c.invincible &&
      (c.timerFunction === TimerFunction.TT_M3 || this.random.zeroTo3() === 0)
    ) {
      preferred = this.random.zeroTo3();
      frame.secondaryDirection = (preferred + 1) & 0x3;
      c.mmr.setflg(MonsterEvents.PIAF_processInvincible);
      if (this.processInvincible(frame, c, preferred)) return;
    }
    c.mmr.setflg(MonsterEvents.PIAF_standardFinish);
    this.standardFinish(frame, c);
  }

  /**
   * `Standard_Finish` (`doc/CSBwin-src/Monster.cpp:1744`) — how nearly every turn
   * ends: maybe turn the group, then schedule the next one.
   */
  private standardFinish(frame: AiFrame, c: AiConst): void {
    this.trace('      MAI Entering Standard_Finish');
    if (!frame.bool36) {
      if (this.random.zeroTo3() !== 0) {
        if (c.attackDistance > monsterSmellingDistance(c.desc)) {
          c.mmr.setflg(MonsterEvents.SF_greaterThanSmellingDistance);
          if (c.timerFunction < TimerFunction.TT_M1 && !frame.bool36) {
            c.mmr.setflg(MonsterEvents.SF_return);
            return;
          }
          this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
          this.startBGroupTimer(
            frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, c.processingATimer, c.mapX, c.mapY,
          );
          return;
        }
      }
      if (c.timerFunction === TimerFunction.TT_M3) {
        c.mmr.setflg(MonsterEvents.SF_timeFuncMinusThree);
        if (c.timerFunction < TimerFunction.TT_M1 && !frame.bool36) return;
        this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
        this.startBGroupTimer(
          frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, c.processingATimer, c.mapX, c.mapY,
        );
        return;
      }
    }

    c.mmr.setflg(MonsterEvents.SF_TurnMonstersAsGroup);
    this.turnMonstersAsGroup(
      c.slot, c.slotIndex, frame.d5, c.indexOfLastMonster, c.horizSize, frame.bool36, frame.sinceLastUpdate, c.mmr,
    );
    if (c.timerFunction < TimerFunction.TT_M1) {
      if (!frame.bool36) return;
      c.mmr.setflg(MonsterEvents.SF_DeleteTimersMaybeSetFear);
      this.deleteTimersMaybeSetFear(c.monster, c.slotIndex, c.mapX, c.mapY, c.level, c.fearFactorIs6);
    }
    c.mmr.setflg(MonsterEvents.SF_IncrementTime);
    this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
    this.startBGroupTimer(
      frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, c.processingATimer, c.mapX, c.mapY,
    );
  }

  /* -------------------------------------------------------------- helpers ---- */

  /**
   * The shared tail of every "found a direction" branch: either take the step now, or
   * note that not enough time has passed and let the caller reschedule.
   *
   * Returns false when the group left the dungeon and the turn must end immediately.
   */
  private stepOrDefer(frame: AiFrame, c: AiConst, newX: number, newY: number): boolean {
    const remaining = frame.timePerMove / 2 - frame.sinceLastUpdate;
    frame.bool36 = remaining <= 0;
    if (!frame.bool36) {
      frame.timePerMove = remaining;
      frame.sinceLastUpdate = -1;
      return true;
    }
    // Any non-zero `MoveObject` ends the turn; otherwise the timer follows the group to
    // `d.NewX, d.NewY` (`doc/CSBwin-src/Monster.cpp:2109-2116`, `:2444-2453`).
    const moved = this.ctx.systems.monsters.moveMonster(c.monsterRn, c.mapX, c.mapY, newX, newY, c.level, undefined, c.mmr);
    if (moved.code !== 0) return false;
    frame.timer.uByte6 = moved.position.x & 0xff;
    frame.timer.uByte7 = moved.position.y & 0xff;
    c.slot.ubPrevX = c.mapX & 0xff;
    c.slot.ubPrevY = c.mapY & 0xff;
    c.slot.uByte4 = this.ctx.state.tickCount & 0xff;
    return true;
  }

  /**
   * `Process_Invincible`'s two dead ends: turn the group to face where it wanted to go,
   * then wait out a move interval (`doc/CSBwin-src/Monster.cpp:1666-1677`, `:1685-1696`).
   */
  private turnAndWait(frame: AiFrame, c: AiConst, preferredDirection: number): void {
    c.mmr.setflg(MonsterEvents.PIn_turnMonsterGroup);
    this.turnMonsterGroup(c.slot, c.slotIndex, preferredDirection, c.indexOfLastMonster, c.horizSize);
    this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
    this.startBGroupTimer(
      frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, c.processingATimer, c.mapX, c.mapY,
    );
  }

  /** `pI16A2->uByte6/7 = d.partyX/Y` — the group's last sighting of the party. */
  private rememberPartyPosition(slot: Item16Record): void {
    slot.uByte6 = this.scratch.partyX & 0xff;
    slot.uByte7 = this.scratch.partyY & 0xff;
  }

  private blocked(c: AiConst, member: number): number {
    return this.ctx.systems.monsterPerception.blocked(c.monster, member, c.level, c.mapX, c.mapY, {
      partyX: this.scratch.partyX,
      partyY: this.scratch.partyY,
      partyInvisible: this.ctx.party.state.invisible !== 0,
      currentPalette: this.ctx.state.currentPalette,
      orthogonalDistanceToParty: this.scratch.orthogonalDistanceToParty,
    });
  }

  /**
   * `CheckMonsterVersusMissiles` (`doc/CSBwin-src/Monster.cpp:4475`) — shifting
   * position inside a cell can walk the monster into a missile already there. Resolves
   * every missile whose corner is the group's positions byte, stopping early if the group
   * is wiped out.
   *
   * Returns true when that wiped out the group, in which case the turn ends. The
   * encounter leaves `d.MonsterDamageResult` in `MissileEncounter.monsterDamageResult`,
   * where the caller reads it.
   */
  private checkMonsterVersusMissiles(c: AiConst): boolean {
    const encounter = this.ctx.systems.missileEncounter;
    const { mapX, mapY, level } = c;
    const position = c.slot.positions;
    encounter.monsterDamageResult = MonsterDamageResult.NO_MONSTER_DIED;
    const cell = new Position(mapX, mapY, level);

    // Restart the scan after each hit: resolving one missile mutates the cell chain.
    for (let guard = 0; guard < 64; guard++) {
      let hitSomething = false;
      for (
        let rn = this.dungeon.findFirstObject(cell);
        rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
        rn = this.dungeon.getDBRecordLink(rn)
      ) {
        const decoded = this.dungeon.rnMaps.decode(rn);
        if (decoded.category !== DBType.MISSILE) continue;
        // The whole positions byte, as both callers pass it (`Monster.cpp:3896`, `:3974`):
        // a corner is 0-3, so a byte with any of bits 2-7 set meets no missile.
        if (decoded.position !== position) continue;
        const missile = this.dungeon.getMissileRecord(rn);
        const timerIndex = missile?.timerIndex;
        if (encounter.processMissileEncounter(-1, mapX, mapY, mapX, mapY, level, position, rn, c.mmr)) {
          if (timerIndex !== undefined) this.timers.deleteTimer(timerIndex);
          hitSomething = true;
          break;
        }
      }
      if (!hitSomething) break;
      if (encounter.groupWasWipedOut()) break;
    }
    return encounter.groupWasWipedOut();
  }

  /**
   * `InitialChecks` (`doc/CSBwin-src/Monster.cpp:2734`).
   *
   * The gate every monster timer passes through. It answers `handled: true` when the
   * timer has been disposed of — re-queued, or deliberately dropped — and the AI
   * proper must not run.
   *
   * Five ways out, in order:
   *
   * 1. Off the party's level, only the group-leader timer types are honoured.
   * 2. No monster at the square at all.
   * 3. A member at zero HP: `DamageMonster` clears it out and the timer is re-queued
   *    for *now*, so the AI reconsiders once the group has shrunk.
   * 4. Off the party's level: take one random step, then sleep proportionally to how
   *    far away the party is.
   * 5. Frozen by FREEZE LIFE, or a negative pseudo-function that needs rewriting into
   *    its positive form.
   */
  initialChecks(
    monsterRn: ObjectID,
    mapX: number,
    mapY: number,
    level: number,
    timerFunction: number,
    timeUntilAlternateUpdate: number,
    mmr: MmRecord,
  ): InitialChecksResult {
    const party = this.ctx.party.state;
    const partyLevel = party.position.z | 0;
    const onPartyLevel = level === partyLevel;

    const blank = (): InitialChecksResult => ({
      handled: true,
      sinceLastUpdate: 0,
      timePerMove: 0,
      attackDistance: 24,
      timer: this.makeTimer(mapX, mapY, level, timerFunction, 0),
      timerFunction,
    });

    // (1) Away from the party's level only the group leader gets a turn.
    if (!onPartyLevel) {
      if (
        timerFunction !== TimerFunction.TT_MONSTER_BGROUP &&
        timerFunction !== TimerFunction.TT_MONSTER_AGROUP &&
        timerFunction !== TimerFunction.TT_MONSTER_B0 &&
        timerFunction !== TimerFunction.TT_MONSTER_A0
      ) {
        mmr.setflg(MonsterEvents.IC29to41_Not32_33_37_38);
        this.trace('Skip monster AI because not party level  and timer is not for group leader');
        return blank();
      }
    }

    // (2)
    if (monsterRn === OBJECT_ID_EOF) return blank();
    const monster = this.dungeon.getCreatureRecord(monsterRn);
    if (!monster) return blank();
    this.scratch.lastMonsterMoved = monsterRn;

    const desc = this.ctx.tables.monsterDesc[monster.creatureType];
    if (!desc) return blank();

    // (3) A member with no hit points is removed before anything else happens. The
    // timer goes back on the queue at the current time so that, if anyone survived,
    // it expires again immediately and we come back here
    // (doc/CSBwin-src/Monster.cpp:2799-2839).
    if (
      timerFunction !== TimerFunction.TT_M1 &&
      timerFunction !== TimerFunction.TT_M2 &&
      timerFunction !== TimerFunction.TT_M3
    ) {
      const numMon = (monster.numMonM1 & 0x3) + 1;
      for (let i = 0; i < numMon; i++) {
        if ((monster.hp[i] ?? 0) !== 0) continue;
        mmr.setflg(MonsterEvents.IC29to41_atLeastOneMemberAlreadyDead);
        const result = this.ctx.systems.monsterDamage.damageMonster(
          monster, i, level, mapX, mapY, 0, true, !onPartyLevel, mmr,
        );
        if (result !== MonsterDamageResult.NO_MONSTER_DIED) {
          mmr.setflg(MonsterEvents.IC29to41_damageMonsterSucceeded);
          const timer = this.makeTimer(mapX, mapY, level, timerFunction, timeUntilAlternateUpdate);
          timer.time = this.ctx.state.tickCount >>> 0;
          timer.uByte5 = 0;
          this.timers.addTimer(timer);
          return blank();
        }
      }
      // CSBWin tests `IC29to41_atLeastOneMemberAlreadDead`, a flag of its own that nothing
      // sets, not the one the loop sets, so `IC29to41_damageMonsterFailed` is never set
      // (`doc/CSBwin-src/Monster.cpp:2839-2840`).
      if (mmr.getflg(MonsterEvents.IC29to41_atLeastOneMemberAlreadDead)) {
        mmr.setflg(MonsterEvents.IC29to41_damageMonsterFailed);
      }
    }

    this.trace('      MAI All memebers of the group are alive');

    // CSBWin initialises `attackDistance` to 24 by a deliberate patch of the Atari
    // binary: on rare paths the variable was read uninitialised, which only made the
    // monster behave slightly oddly but made the two builds impossible to compare
    // (doc/CSBwin-src/Monster.cpp:2857-2870).
    const attackDistance = 24;

    const timer = this.makeTimer(mapX, mapY, level, timerFunction, 0);
    timer.uByte5 = (255 - desc.movementTicks06) & 0xff;

    // (4) Off the party's level: one random step, then a long sleep.
    if (!onPartyLevel) {
      const direction = this.random.zeroTo3();
      const probe = this.ctx.systems.monsterPerception.possibleMove(
        monsterRn, desc, level, mapX, mapY, direction, false, this.scratch,
      );
      this.trace(
        `      MAI Not on party level. PossibleMove(Random()=${direction}) returned ${probe.possible}.`,
      );
      if (probe.possible) {
        const newX = mapX + (DELTA_X[direction] ?? 0);
        const newY = mapY + (DELTA_Y[direction] ?? 0);
        const moved = this.ctx.systems.monsters.moveMonster(monsterRn, mapX, mapY, newX, newY, level, undefined, mmr);
        this.trace(`      MAI MoveObject to (${newX},${newY}) returned ${moved.code}`);
        if (moved.code !== 0) {
          mmr.setflg(MonsterEvents.IC29to41_randomMoveSucceeded);
          this.trace('      MAI Skip monster AI because MoveObject non-zero');
          return blank();
        }
        // `d.NewX, d.NewY` (`doc/CSBwin-src/Monster.cpp:2912-2932`): a pit may have
        // dropped the group a level, and only the square is re-aimed.
        timer.uByte6 = moved.position.x & 0xff;
        timer.uByte7 = moved.position.y & 0xff;
        mmr.setflg(MonsterEvents.IC29to41_randomMoveFailed);
      } else {
        this.trace('      MAI  No attempt to move monster. Que 37 timer');
      }

      timer.function = TimerFunction.TT_MONSTER_BGROUP;
      const levelGap = Math.abs(level - partyLevel);
      const delay = Math.max(levelGap << 4, 2 * desc.movementTicks06);
      timer.time = (timer.time + delay) >>> 0;
      this.timers.addTimer(timer);
      mmr.setflg(MonsterEvents.IC29to41_doNothing);
      return blank();
    }

    // (5) On the party's level from here on.
    if (monsterInvincible(desc) && this.ctx.state.gameWon) {
      // Lord Chaos stops moving once the game is won.
      mmr.setflg(MonsterEvents.IC29to41_doNothing);
      return blank();
    }
    if (monsterInvincible(desc)) {
      this.scratch.fluxCageCount = 0;
      this.scratch.fluxCages.fill(0);
    }

    const slot = this.dungeon.getAttachedItem16(monster);
    let sinceLastUpdate = (this.ctx.state.tickCount & 255) - (slot?.uByte4 ?? 0);
    if (sinceLastUpdate < 0) sinceLastUpdate += 256;

    // A monster that never moves is still given a nominal 100 for the arithmetic that
    // follows (doc/CSBwin-src/Monster.cpp:2994-2998).
    let timePerMove = desc.movementTicks06 & 0xff;
    if (timePerMove === 255) timePerMove = 100;

    if (party.freezeLifeTimer !== 0 && !monsterInvincible(desc)) {
      mmr.setflg(MonsterEvents.IC29to41_doNothing);
      if (timerFunction < TimerFunction.TT_EMPTY) return blank();
      timer.function = timerFunction;
      timer.uByte8 = timeUntilAlternateUpdate & 0xff;
      timer.time = (timer.time + 4) >>> 0;
      this.timers.addTimer(timer);
      return blank();
    }

    if (timerFunction >= TimerFunction.TT_EMPTY) {
      // The only path that lets the AI proper run.
      mmr.setflg(MonsterEvents.IC29to41_exitFalse);
      return {
        handled: false,
        sinceLastUpdate,
        timePerMove,
        attackDistance,
        timer,
        timerFunction,
      };
    }

    // A negative pseudo-function: rewrite it into its positive twin and re-queue.
    switch (timerFunction) {
      case TimerFunction.TT_M3: timer.function = TimerFunction.TT_29; break;
      case TimerFunction.TT_M2: timer.function = TimerFunction.TT_30; break;
      case TimerFunction.TT_M1: timer.function = TimerFunction.TT_31; break;
      default: return blank();
    }
    const delay =
      timerFunction === TimerFunction.TT_M1
        ? 1
        : Math.max(1, Math.trunc((timePerMove + 2) / 4) - sinceLastUpdate);
    timer.time = (timer.time + delay) >>> 0;
    this.trace(`      MAI Change negative timer function to type ${timer.function}`);
    this.timers.addTimer(timer);
    mmr.setflg(MonsterEvents.IC29to41_doNothing);
    return blank();
  }

  /* -------------------------------------------------------- timer helpers ---- */

  /**
   * `SetMonsterTimerB` (`doc/CSBwin-src/Monster.cpp:1264`).
   *
   * The A and B timer families are the same events seen from two sides. If the
   * alternate time is *sooner* than the one already on the timer, the timer flips
   * from its B form to the matching A form, the gap between the two goes into
   * `uByte8`, and the sooner time wins. Otherwise the gap alone is recorded.
   */
  setMonsterTimerB(timer: TimerEntry, altTime: number): void {
    if (altTime < timer.time) {
      const flipped = B_TO_A[timer.function];
      if (flipped === undefined) {
        this.trace(`MonsterAI: illegal monster AI timer ${timer.function}`);
        return;
      }
      timer.function = flipped;
      timer.uByte8 = (timer.time - altTime) & 0xff;
      timer.time = altTime >>> 0;
    } else {
      timer.uByte8 = (altTime - timer.time) & 0xff;
    }
    this.timers.addTimer(timer);
  }

  /**
   * `Set_Monster_Timer` (`doc/CSBwin-src/Monster.cpp:1341`).
   *
   * `processingATimer` selects which of the two events is being scheduled — CSBWin's
   * own comment: when true, `i_60` is the time of the next A event and
   * `timeUntilAlternateUpdate` the delay to the next B; when false the roles swap.
   */
  setMonsterTimer(
    timer: TimerEntry,
    i60: number,
    timeUntilAlternateUpdate: number,
    processingATimer: boolean,
  ): number {
    if (processingATimer) {
      timer.time = (timer.time + (timeUntilAlternateUpdate & 0xffff)) >>> 0;
    } else {
      i60 = (i60 + (timeUntilAlternateUpdate & 0xffff)) >>> 0;
    }
    this.setMonsterTimerB(timer, i60);
    return i60;
  }

  /** `EnsureI60NonZero` (`doc/CSBwin-src/Monster.cpp:1385`). */
  ensureI60NonZero(i60: number, slot: Item16Record, monsterX: number, monsterY: number, level: number): number {
    if (i60 !== 0) return i60;
    return this.ctx.systems.monsters.nextMonsterUpdateTime(slot, -1, false, monsterX, monsterY, level);
  }

  /**
   * `Increment_Time_By_W52_Plus_Random` (`doc/CSBwin-src/Monster.cpp:1399`) — never
   * less than one tick, however fast the monster.
   */
  incrementTimeByTimePerMovePlusRandom(timer: TimerEntry, timePerMove: number): void {
    timer.time = (timer.time + Math.max(1, timePerMove + this.random.zeroTo3() - 1)) >>> 0;
  }

  /** `StartBGroupTimer` (`doc/CSBwin-src/Monster.cpp:1591`). */
  startBGroupTimer(
    timer: TimerEntry,
    slot: Item16Record,
    i60: number,
    timeUntilAlternateUpdate: number,
    processingATimer: boolean,
    monsterX: number,
    monsterY: number,
  ): void {
    timer.function = TimerFunction.TT_MONSTER_BGROUP;
    const ensured = this.ensureI60NonZero(i60, slot, monsterX, monsterY, timer.level);
    this.setMonsterTimer(timer, ensured, timeUntilAlternateUpdate, processingATimer);
  }

  /**
   * `Delete_Timers_Maybe_Set_Fear` (`doc/CSBwin-src/Monster.cpp:1416`) — a group that
   * has been driven to fear factor 6 and then bounced is put to 7, the top state.
   */
  deleteTimersMaybeSetFear(
    monster: CreatureRecord,
    slotIndex: number,
    mapX: number,
    mapY: number,
    level: number,
    fearFactorIs6: boolean,
  ): void {
    if (fearFactorIs6) monster.fear = StateOfFear.StateOfFear7;
    this.ctx.systems.monsters.clearAttackingAndDeleteMovementTimers(slotIndex, mapX, mapY, level);
  }

  /**
   * `Turn_Monsters_As_Group` (`doc/CSBwin-src/Monster.cpp:1561`).
   *
   * `preferredDirection` is replaced by a random one when the group has no reason to
   * face anywhere in particular — CSBWin's `(bool_36 == false) && (w_54 >= 0)`.
   */
  private turnMonstersAsGroup(
    slot: Item16Record,
    slotIndex: number,
    preferredDirection: number,
    indexOfLastMonster: number,
    horizSize: number,
    hasPreference: boolean,
    sinceLastUpdate: number,
    mmr: MmRecord,
  ): void {
    let direction = preferredDirection;
    if (!hasPreference && sinceLastUpdate >= 0) direction = this.random.zeroTo3();
    mmr.setflg(MonsterEvents.TMAG_turnMonsterGroup);
    this.turnMonsterGroup(slot, slotIndex, direction, indexOfLastMonster, horizSize);
  }

  /**
   * `TurnMonsterGroup`, which `Try_Preferred_Direction_Then_Others` and `Process_Invincible`
   * call directly, setting no flag.
   */
  private turnMonsterGroup(
    slot: Item16Record,
    slotIndex: number,
    direction: number,
    indexOfLastMonster: number,
    horizSize: number,
  ): void {
    const ref = { facings: slot.facings };
    this.ctx.systems.monsterPerception.turnMonsterGroup(
      this.scratch, slotIndex, ref, direction, indexOfLastMonster, horizSize === 1, this.ctx.state.tickCount,
    );
    slot.facings = ref.facings;
  }

  /**
   * `MaybeDelTimers_Fear6_TurnIndividuals` (`doc/CSBwin-src/Monster.cpp:1440`).
   *
   * The group breaks formation: fear goes to 6, each member turns towards the party
   * (member 0 always, the rest on a coin toss) and each gets its **own** `TT_MONSTER_B<n>`
   * timer. This is the only thing that creates per-member timers, which is why
   * `DamageMonster` only renumbers them in fear state 6.
   */
  maybeDelTimersFear6TurnIndividuals(
    monster: CreatureRecord,
    slot: Item16Record,
    slotIndex: number,
    timer: TimerEntry,
    timeUntilAlternateUpdate: number,
    timerFunction: number,
    mapX: number,
    mapY: number,
    level: number,
    desc: MonsterDesc,
    indexOfLastMonster: number,
    horizSize: number,
    processingATimer: boolean,
    mmr: MmRecord,
  ): void {
    if (timerFunction === TimerFunction.TT_M2) {
      this.timers.deleteMonsterMovementTimers(mapX, mapY, level, (line) => this.trace(line));
    }
    const party = this.ctx.party.state;
    slot.uByte6 = party.position.x & 0xff;
    slot.uByte7 = party.position.y & 0xff;
    monster.fear = StateOfFear.StateOfFear6;

    this.trace('      MAI Set Fear Factor to 6.  Turn Individuals');
    this.trace('      MAI Set TT_B<n> timer for each Group Member');

    const preferred = this.scratch.primaryDirectionToParty;

    for (let monIdx = indexOfLastMonster; monIdx >= 0; monIdx--) {
      const monsterDirection = (slot.facings >> (2 * monIdx)) & 0x3;
      const turns = preferred !== monsterDirection && (monIdx === 0 || this.random.bool() === 0);
      if (turns) {
        mmr.setflg(MonsterEvents.MDF6TI_turnMonsterTowardParty);
        const ref = { facings: slot.facings };
        this.ctx.systems.monsterPerception.turnMonster(
          this.scratch,
          slotIndex,
          ref,
          preferred,
          monIdx,
          indexOfLastMonster !== 0 && horizSize === 1,
          this.ctx.state.tickCount,
        );
        slot.facings = ref.facings;
        timer.time = (this.ctx.state.tickCount + this.random.zeroTo3() + 2) >>> 0;
      } else {
        timer.time = (this.ctx.state.tickCount + 1) >>> 0;
      }
      if (processingATimer) {
        timer.time =
          (timer.time +
            Math.min(
              this.random.zeroTo3() + Math.trunc((desc.attackTicks07 & 0xff) / 2),
              timeUntilAlternateUpdate,
            )) >>>
          0;
      }
      const perMember = MEMBER_B_TIMER[monIdx];
      if (perMember === undefined) {
        this.trace(`MonsterAI: illegal monster index ${monIdx}`);
        continue;
      }
      timer.function = perMember;
      // Each member gets its **own** timer. CSBWin's `SetTimer(&timer)` copies the
      // struct into the queue by value (`doc/CSBwin-src/Timer.cpp`), so the local
      // `timer` it reuses each time round the loop is only a template. Queueing this
      // object itself would put one entry in the queue up to four times and then keep
      // mutating it, which left the queue unsorted and stalled every timer behind it.
      this.setMonsterTimerB(
        timer,
        this.ctx.systems.monsters.nextMonsterUpdateTime(slot, monIdx, false, mapX, mapY, level),
      );
    }
  }

  /** Clear every member's attacking flag without touching the timers. */
  clearAttacking(slot: Item16Record): void {
    for (let i = 0; i < 4; i++) {
      slot.singleMonsterStatus[i] = (slot.singleMonsterStatus[i] ?? 0) & ~SMS_ATTACKING;
    }
  }

  /* -------------------------------------------------------------- internals ---- */

  private makeTimer(
    mapX: number,
    mapY: number,
    level: number,
    functionType: number,
    timeUntilAlternateUpdate: number,
  ): TimerEntry {
    return {
      index: -1,
      time: this.ctx.state.tickCount >>> 0,
      level: level & 0xff,
      function: functionType,
      uByte5: 0,
      uByte6: mapX & 0xff,
      uByte7: mapY & 0xff,
      uByte8: timeUntilAlternateUpdate & 0xff,
      uByte9: 0,
      sequence: 0,
      timerWord8: 0,
      timerWord6: 0,
    };
  }

  private trace(line: string): void {
    this.ctx.host.trace(line);
  }
}

/** The A→B flip when an "A" timer is processed (`doc/CSBwin-src/Monster.cpp:3623-3632`). */
const A_TO_B: Record<number, number> = {
  [TimerFunction.TT_MONSTER_AGROUP]: TimerFunction.TT_MONSTER_BGROUP,
  [TimerFunction.TT_MONSTER_A0]: TimerFunction.TT_MONSTER_B0,
  [TimerFunction.TT_MONSTER_A1]: TimerFunction.TT_MONSTER_B1,
  [TimerFunction.TT_MONSTER_A2]: TimerFunction.TT_MONSTER_B2,
  [TimerFunction.TT_MONSTER_A3]: TimerFunction.TT_MONSTER_B3,
};

/** `SetMonsterTimerB`'s B→A mapping (`doc/CSBwin-src/Monster.cpp:1271-1277`). */
const B_TO_A: Record<number, number> = {
  [TimerFunction.TT_MONSTER_BGROUP]: TimerFunction.TT_MONSTER_AGROUP,
  [TimerFunction.TT_MONSTER_B0]: TimerFunction.TT_MONSTER_A0,
  [TimerFunction.TT_MONSTER_B1]: TimerFunction.TT_MONSTER_A1,
  [TimerFunction.TT_MONSTER_B2]: TimerFunction.TT_MONSTER_A2,
  [TimerFunction.TT_MONSTER_B3]: TimerFunction.TT_MONSTER_A3,
};

/** Member index → its own B timer (`doc/CSBwin-src/Monster.cpp:1532-1540`). */
const MEMBER_B_TIMER: Record<number, number> = {
  0: TimerFunction.TT_MONSTER_B0,
  1: TimerFunction.TT_MONSTER_B1,
  2: TimerFunction.TT_MONSTER_B2,
  3: TimerFunction.TT_MONSTER_B3,
};
