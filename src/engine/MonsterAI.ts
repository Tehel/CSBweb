/**
 * The monster AI state machine.
 *
 * Ports `doc/CSBwin-src/Monster.cpp`'s `InitialChecks` (:2730) and
 * `ProcessTimers29to41` (:3239) together with the helper chain they were factored
 * into — `Set_Monster_Timer` (:1337), `SetMonsterTimerB` (:1260),
 * `EnsureI60NonZero` (:1381), `Increment_Time_By_W52_Plus_Random` (:1395),
 * `Delete_Timers_Maybe_Set_Fear` (:1412), `MaybeDelTimers_Fear6_TurnIndividuals`
 * (:1436), `Turn_Monsters_As_Group` (:1557) and `StartBGroupTimer` (:1587).
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
import { OBJECT_ID_EOF, Position, type ObjectID } from '../core/types';
import type { CsbRandom } from '../core/random';
import type { CreatureRecord, Item16Record } from '../data/dungeonTypes';
import { SMS_ATTACKING } from '../data/dungeonTypes';
import type { DungeonState } from './DungeonState';
import type { PartyState } from './gameTypes';
import { TimerFunction, type TimerEntry, type TimerQueue } from './TimerQueue';
import { StateOfFear } from './monsterTypes';
import type { MonsterSystem } from './MonsterSystem';
import type { MonsterDamage } from './MonsterDamage';
import { MonsterDamageResult } from './MonsterDamage';
import {
  DELTA_X,
  DELTA_Y,
  MonsterPerception,
  distanceBetweenPoints,
  getPrimaryAndSecondaryDirection,
  type MoveProbeState,
  type TurnState,
} from './MonsterPerception';
import type { MonsterDesc } from '../renderer/csbwin/ObjectTables';
import {
  monsterDelayFromAttackToMove,
  monsterDelayFromMoveToAttack,
  monsterHorizontalSize,
  monsterInvincible,
  monsterSee360,
  monsterSmellingDistance,
  monsterWord14_12_15,
  monsterWord20_0_3,
  monsterWord2Bit3,
  monsterWord2Bit4,
} from '../renderer/csbwin/ObjectTables';
import { setPackedBits } from './MonsterSystem';

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

export interface MonsterAiDeps {
  dungeon: DungeonState;
  getPartyState: () => PartyState;
  getTime: () => number;
  random: CsbRandom;
  timers: TimerQueue;
  monsters: MonsterSystem;
  damage: MonsterDamage;
  perception: MonsterPerception;
  monsterDesc: () => ArrayLike<MonsterDesc> | null;
  isGameWon: () => boolean;
  /** `d.CurrentPalette` — the viewport light level, which shortens monster sight. */
  getCurrentPalette?: () => number;
  /**
   * `MonsterAttacks` (`doc/CSBwin-src/Monster.cpp:944`) — resolve one member's attack
   * on the party, returning whether it is now in its attacking pose.
   *
   * ⏳ Not supplied yet; without it a monster reaches the point of attacking and then
   * simply doesn't. Tracked in PLAN.md Phase 12 step 5.
   */
  monsterAttacks?: (
    monsterRn: ObjectID,
    monster: CreatureRecord,
    mapX: number,
    mapY: number,
    member: number,
  ) => boolean;
  trace?: (line: string) => void;
}

export class MonsterAI {
  private scratch = makeAiScratch();

  constructor(private deps: MonsterAiDeps) {}

  /** `d.PrimaryDirectionToParty`, for `MonsterAttacks`. */
  get primaryDirectionToParty(): number {
    return this.scratch.primaryDirectionToParty;
  }

  /** `d.OrthogonalDistance2Party`, for `MonsterAttacks`. */
  get orthogonalDistanceToParty(): number {
    return this.scratch.orthogonalDistanceToParty;
  }

  /**
   * `ProcessTimers29to41` (`doc/CSBwin-src/Monster.cpp:3239`) — one monster group's
   * turn, from the top.
   */
  processTimers29to41(options: {
    mapX: number;
    mapY: number;
    level: number;
    timerFunction: number;
    timeUntilAlternateUpdate: number;
  }): void {
    const { mapX, mapY, level, timerFunction, timeUntilAlternateUpdate } = options;
    const party = this.deps.getPartyState();
    const s = this.scratch;

    // "Clear all modifications to monster behaviour. The Monster Movement filter may
    // set some of these things." (doc/CSBwin-src/Monster.cpp:3298-3305)
    s.monsterMoveInhibit.fill(0);

    const monsterRn = this.deps.monsters.findFirstMonsterAt(new Position(mapX, mapY, level));

    this.trace(
      `MonsterAI [0x${(monsterRn === OBJECT_ID_EOF ? 0xffff : monsterRn).toString(16).padStart(4, '0')}] ` +
        `${String(level).padStart(2, '0')}(${mapX},${mapY})@${this.deps.getTime()} ` +
        `Perform Initial Checks-timeFunc=${TimerFunction[timerFunction] ?? timerFunction}, ` +
        `timeUntilAlternateUpdate=${timeUntilAlternateUpdate}`,
    );

    const checks = this.initialChecks(monsterRn, mapX, mapY, level, timerFunction, timeUntilAlternateUpdate);
    if (checks.handled) return;

    const monster = this.deps.dungeon.getCreatureRecord(monsterRn);
    if (!monster) return;
    const desc = this.deps.monsterDesc()?.[monster.creatureType];
    if (!desc) return;

    // The rest of the prologue: distances and direction to the party, and the
    // per-turn direction flags (doc/CSBwin-src/Monster.cpp:3384-3396).
    s.monsterX = mapX;
    s.monsterY = mapY;
    s.partyX = party.position.x | 0;
    s.partyY = party.position.y | 0;
    s.directionHasBeenTested.fill(0);
    s.orthogonalDistanceToParty = distanceBetweenPoints(mapX, mapY, s.partyX, s.partyY);
    const dirs = getPrimaryAndSecondaryDirection(this.deps.random, mapX, mapY, s.partyX, s.partyY);
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

    const slot = this.deps.dungeon.getAttachedItem16(monster);
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
    };

    this.dispatch(frame, c, fearFactor);
  }

  /**
   * The `timeFunc` dispatch at the heart of `ProcessTimers29to41`
   * (`doc/CSBwin-src/Monster.cpp:3409-4462`).
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
      c.timerFunction = TimerFunction.TT_M1;
      if (fearFactor !== StateOfFear.StateOfFear6 && fearFactor !== StateOfFear.StateOfFear5) {
        this.trace('      MAI timeFunc 31.  FearFactor not 5 or 6. So Delete all timers and set fear to 6.');
        this.deps.monsters.deleteMonsterMovementTimers(c.mapX, c.mapY, c.level);
        this.maybeDelTimersFear6TurnIndividuals(
          c.monster, c.slot, c.slotIndex, frame.timer, c.timeUntilAlternateUpdate,
          c.timerFunction, c.mapX, c.mapY, c.level, c.desc,
          c.indexOfLastMonster, c.horizSize, true,
        );
        return;
      }
      this.trace('      MAI timeFunc 31.  FearFactor is 5 or 6.');
      this.rememberPartyPosition(c.slot);
      return;
    }

    if (fn === TimerFunction.TT_30) {
      c.timerFunction = TimerFunction.TT_M2;
      if (fearFactor === StateOfFear.StateOfFear6 || fearFactor === StateOfFear.StateOfFear5) {
        this.trace('      MAI timeFunc 30.  FearFactor is 5 or 6.');
        return;
      }
      const fearIs2or3 = fearFactor === StateOfFear.StateOfFear2 || fearFactor === StateOfFear.StateOfFear3;
      if (fearIs2or3 || this.deps.random.zeroTo3() !== 0) {
        const seen = this.blocked(c, -1);
        this.trace(`      MAI timeFunc 31. FearFactor 2 or 3 or random. Block=${seen}`);
        if (seen === 0) {
          frame.bool36 = false;
          c.fearFactorIs6 = false;
          this.turnMonstersAsGroup(
            c.slot, c.slotIndex, frame.d5, c.indexOfLastMonster, c.horizSize,
            frame.bool36, frame.sinceLastUpdate,
          );
          if (c.timerFunction < TimerFunction.TT_M1) {
            if (!frame.bool36) return;
            this.deleteTimersMaybeSetFear(c.monster, c.slotIndex, c.mapX, c.mapY, c.level, c.fearFactorIs6);
          }
          this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
          this.startBGroupTimer(
            frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, true, c.mapX, c.mapY,
          );
          return;
        }
        if (fearIs2or3) return;
        if (this.deps.random.zeroTo3() !== 0) return;
      }
      c.fearFactorIs6 = fearFactor === StateOfFear.StateOfFear6;
      frame.bool36 = false;
      this.tryDirectionsD5ToD4(frame, c);
      return;
    }

    if (fn === TimerFunction.TT_29) {
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
    if (c.timeUntilAlternateUpdate !== 0) frame.i60 = this.deps.getTime();

    if (fn !== TimerFunction.TT_MONSTER_BGROUP) {
      this.processIndividualBTimer(frame, c, fearFactor);
      return;
    }
    this.processGroupBTimer(frame, c, fearFactor);
  }

  /**
   * Timer types 32-36 — the "A" family (`doc/CSBwin-src/Monster.cpp:3607-3752`).
   *
   * The timer flips to its B twin and then, mostly, just reschedules. The interesting
   * cases are being seen by a party that is *adjacent* (break formation) and being in
   * fear state 0 or 3 while seen at range (go to state 7 and charge).
   */
  private processATimer(frame: AiFrame, c: AiConst, fearFactor: number): void {
    const flipped = A_TO_B[c.timerFunction];
    if (flipped === undefined) {
      console.warn(`MonsterAI: illegal monster AI timer ${c.timerFunction}`);
      return;
    }
    frame.timer.function = flipped;
    this.trace(`      MAI timeFunc<37. Set New timerFunction to ${TimerFunction[flipped] ?? flipped}`);

    const seen = this.blocked(c, -1);
    this.trace(`      MAI timeFunc<37.  Blocked=${seen}`);
    if (seen !== 0) {
      if (fearFactor !== StateOfFear.StateOfFear6 && fearFactor !== StateOfFear.StateOfFear5) {
        if (c.xDistance + c.yDistance <= 1) {
          this.maybeDelTimersFear6TurnIndividuals(
            c.monster, c.slot, c.slotIndex, frame.timer, c.timeUntilAlternateUpdate,
            c.timerFunction, c.mapX, c.mapY, c.level, c.desc,
            c.indexOfLastMonster, c.horizSize, true,
          );
          return;
        }
        // CSBWin's comment on the next line: "The following line makes no sense. But
        // I have studied the original machine language over and over again. This is
        // what it did." The `fearFactor != 7` term cannot fail once the first two
        // have passed, and `tsc` narrows the type enough to say so — hence the
        // widened local, which keeps the test as written rather than dropping it
        // (doc/CSBwin-src/Monster.cpp:3665-3672).
        const fear: number = fearFactor;
        const notSeven = (v: number): boolean => v !== (StateOfFear.StateOfFear7 as number);
        if (
          (fear === StateOfFear.StateOfFear0 || fear === StateOfFear.StateOfFear3) &&
          notSeven(fear)
        ) {
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
      this.trace('      MAI fearFactor==6');
      const member = c.timerFunction - TimerFunction.TT_MONSTER_A0;
      frame.i60 = this.deps.monsters.nextMonsterUpdateTime(
        c.slot,
        member,
        ((c.slot.singleMonsterStatus[member] ?? 0) & SMS_ATTACKING) !== 0,
        c.mapX,
        c.mapY,
      );
      this.setMonsterTimer(frame.timer, frame.i60, c.timeUntilAlternateUpdate, true);
      return;
    }

    if (c.xDistance > 3 || c.yDistance > 3) {
      frame.i60 = this.deps.getTime() + monsterDelayFromMoveToAttack(c.desc);
      this.trace(
        `      MAI fearFactor != 6.  Distance to party > 3. AdditionalDelayAfter(move/attack) = ` +
          `${monsterDelayFromMoveToAttack(c.desc)}, ${monsterDelayFromAttackToMove(c.desc)}`,
      );
      this.setMonsterTimer(frame.timer, frame.i60, c.timeUntilAlternateUpdate, true);
      return;
    }

    frame.i60 = this.ensureI60NonZero(frame.i60, c.slot, c.mapX, c.mapY);
    this.setMonsterTimer(frame.timer, frame.i60, c.timeUntilAlternateUpdate, true);
  }

  /**
   * Timer types 38-41 — one member's own turn
   * (`doc/CSBwin-src/Monster.cpp:3770-4106`).
   *
   * A member already attacking simply schedules its next swing. One that is not
   * decides whether it can attack: it must be able to see the party, be facing it (or
   * see in all directions), be within `word14_12_15` cells, be orthogonally aligned,
   * and win a die roll against that same value. Failing any of it, it shuffles
   * position inside the cell, or turns, or gives up and moves.
   */
  private processIndividualBTimer(frame: AiFrame, c: AiConst, fearFactor: number): void {
    if (fearFactor === StateOfFear.StateOfFear5) {
      if (c.indexOfLastMonster !== 0) {
        this.deps.monsters.clearAttackingAndDeleteMovementTimers(c.slotIndex, c.mapX, c.mapY, c.level);
      }
      this.tryToMove(frame, c);
      return;
    }

    const member = c.timerFunction - TimerFunction.TT_MONSTER_B0;
    if (((c.slot.singleMonsterStatus[member] ?? 0) & SMS_ATTACKING) !== 0) {
      // Mid-attack: schedule the follow-through.
      frame.i60 = this.deps.monsters.nextMonsterUpdateTime(c.slot, member, false, c.mapX, c.mapY);
      const roll = this.deps.random.zeroTo3();
      const attackTicks = c.desc.attackTicks07 & 0xff;
      frame.timer.time = (frame.timer.time + ((attackTicks + roll - 1) & 0xffff)) >>> 0;
      if (attackTicks > 15) {
        // A slow attack gets a signed jitter, which can pull the time *earlier*.
        frame.timer.time = (frame.timer.time + ((this.deps.random.next() & 7) - 2)) >>> 0;
      }
      frame.timer.function = c.timerFunction;
      this.setMonsterTimer(frame.timer, frame.i60, c.timeUntilAlternateUpdate, false);
      return;
    }

    if (member > c.indexOfLastMonster) return;

    const preferredDirection = this.scratch.primaryDirectionToParty;
    let attackDistance = this.blocked(c, member);
    if (attackDistance !== 0) this.rememberPartyPosition(c.slot);

    // A lone monster in an open cell sometimes shuffles to another corner, or spreads
    // to fill the cell (positions = 0xff) (doc/CSBwin-src/Monster.cpp:3846-3893).
    let shuffle = 0;
    if (c.indexOfLastMonster === 0 && c.horizSize !== 2) {
      shuffle = this.deps.random.next() & 0xffff;
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
        reach <= this.deps.random.below(16) + 1
      ) {
        if (reach === 1 && this.sidestepBeforeMeleeing(frame, c, member, preferredDirection)) return;

        // Attack.
        frame.i60 = this.deps.monsters.nextMonsterUpdateTime(
          c.slot,
          member,
          this.deps.monsterAttacks?.(c.monsterRn, c.monster, c.mapX, c.mapY, member) ?? false,
          c.mapX,
          c.mapY,
        );
        frame.timer.time =
          (frame.timer.time + ((monsterWord20_0_3(c.desc) + this.deps.random.bool()) & 0xffff)) >>> 0;
      } else {
        c.monster.fear = StateOfFear.StateOfFear7;
        if (c.indexOfLastMonster !== 0) {
          this.deps.monsters.clearAttackingAndDeleteMovementTimers(c.slotIndex, c.mapX, c.mapY, c.level);
        }
        this.d4d0Finish(frame, c);
        return;
      }
    } else {
      const seen = this.blocked(c, -1);
      if (seen !== 0) {
        this.rememberPartyPosition(c.slot);
        const ref = { facings: c.slot.facings };
        this.deps.perception.turnMonster(
          this.scratch, c.slotIndex, ref, preferredDirection, member,
          c.indexOfLastMonster !== 0 && c.horizSize === 1, this.deps.getTime(),
        );
        c.slot.facings = ref.facings;
        frame.timer.time = (frame.timer.time + 2) >>> 0;
        frame.i60 = frame.timer.time;
      } else {
        c.monster.fear = StateOfFear.StateOfFear7;
        if (c.indexOfLastMonster !== 0) {
          this.deps.monsters.clearAttackingAndDeleteMovementTimers(c.slotIndex, c.mapX, c.mapY, c.level);
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
   * first (`doc/CSBwin-src/Monster.cpp:3925-3999`). Returns true when it did, in
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
        (!monsterWord2Bit3(c.desc) || this.deps.random.zeroTo3() === 0 || !monsterWord2Bit4(c.desc)) &&
        c.horizSize === 0 &&
        c.slot.positions !== 255
      )
    ) {
      return false;
    }

    let pos = (c.slot.positions >> (2 * member)) & 0x3;
    if (preferredDirection === pos) return false;
    if (pos === ((preferredDirection + 1) & 0x3)) return false;

    if (c.indexOfLastMonster === 0 && this.deps.random.bool() !== 0) {
      // CSBWin has the assignment `pI16A2->uByte3 = 0xff` commented out here, so this
      // branch deliberately does nothing but consume the die roll.
    } else {
      pos = ((preferredDirection & 1) === (pos & 1) ? pos - 1 : pos + 1) & 0x3;
      let ordinal = this.ordinalOfMonsterAtPosition(c.monster, pos);
      if (ordinal !== 0 && this.deps.random.bool() !== 0) {
        pos = (pos + 2) & 0x3;
        ordinal = this.ordinalOfMonsterAtPosition(c.monster, pos);
      }
      if (ordinal === 0) {
        if (this.checkMonsterVersusMissiles(c)) return true;
        if (this.lastDamageResult !== MonsterDamageResult.SOME_NOT_ALL_MONSTERS_DIED) {
          c.slot.positions = setPackedBits(c.slot.positions, member, pos);
        }
      }
    }

    const delay = Math.max(1, Math.trunc(c.desc.movementTicks06 / 2) + this.deps.random.bool());
    frame.timer.time = (frame.timer.time + delay) >>> 0;
    frame.timer.function = c.timerFunction;
    frame.i60 = this.ensureI60NonZero(frame.i60, c.slot, c.mapX, c.mapY);
    this.setMonsterTimer(frame.timer, frame.i60, c.timeUntilAlternateUpdate, false);
    return true;
  }

  /**
   * Timer type 37 — the group's ordinary turn
   * (`doc/CSBwin-src/Monster.cpp:4106-4452`).
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
            c.indexOfLastMonster, c.horizSize, false,
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
          c.indexOfLastMonster, c.horizSize, false,
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
    const smelled = this.deps.perception.getBestMonsterFacing(c.desc, c.level, c.mapX, c.mapY, {
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
    if (this.deps.random.bool() === 0) {
      this.trace('      MAI No Preferrred Direction.  RandomBool()=0.');
      this.processInvincibleAndFinish(frame, c, 0);
      return;
    }
    this.trace('      MAI No Preferrred Direction.  RandomBool()=1.');
    this.tryDirectionsD5ToD4(frame, c);
  }

  /* ------------------------------------------------------- the Try_* chain ---- */

  /**
   * `Try_Directions_D5_To_D4` (`doc/CSBwin-src/Monster.cpp:2380`).
   *
   * Try all four directions starting from a random one, wrapping round. A direction
   * that would double back to the square just left is skipped three times out of
   * four. If the step would land on the party, that counts as finding it.
   */
  private tryDirectionsD5ToD4(frame: AiFrame, c: AiConst): void {
    const start = this.deps.random.zeroTo3();
    frame.d5 = start;
    let direction = start;

    do {
      const newX = c.mapX + (DELTA_X[direction] ?? 0);
      const newY = c.mapY + (DELTA_Y[direction] ?? 0);

      let skip = false;
      if (c.slot.ubPrevX === newX && c.slot.ubPrevY === newY) {
        // Doubling straight back: only one time in four.
        skip = this.deps.random.zeroTo3() !== 0;
      }

      if (!skip) {
        const probe = this.deps.perception.possibleMove(
          c.monsterRn, c.desc, c.level, c.mapX, c.mapY, direction, false, this.scratch,
        );
        if (probe.possible) {
          frame.d5 = direction;
          if (!this.stepOrDefer(frame, c, newX, newY)) return;
          this.processInvincibleAndFinish(frame, c, direction);
          return;
        }
        if (probe.moveOntoPartyPosition && c.timerFunction !== TimerFunction.TT_M3) {
          // Reaching the party is as good as arriving. The `& 15 != 5` test throttles
          // how often a group re-forms (doc/CSBwin-src/Monster.cpp:2497-2513).
          if (
            (c.timeUntilAlternateUpdate & 15) !== 5 ||
            this.deps.perception.findPossibleMove(
              c.monsterRn, c.desc, c.level, c.mapX, c.mapY, false, this.scratch,
            ) === 0 ||
            this.deps.random.bool() !== 0
          ) {
            this.maybeDelTimersFear6TurnIndividuals(
              c.monster, c.slot, c.slotIndex, frame.timer, c.timeUntilAlternateUpdate,
              c.timerFunction, c.mapX, c.mapY, c.level, c.desc,
              c.indexOfLastMonster, c.horizSize, c.processingATimer,
            );
            return;
          }
        }
        if (probe.moveOntoPartyPosition) this.rememberPartyPosition(c.slot);
      }

      direction = (direction + 1) & 0x3;
    } while (start !== direction);

    frame.d5 = direction;
    this.processInvincibleAndFinish(frame, c, direction);
  }

  /**
   * `Try_Preferred_Direction_Then_Others` (`doc/CSBwin-src/Monster.cpp:2001`).
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
      this.deps.perception.possibleMove(
        c.monsterRn, c.desc, c.level, c.mapX, c.mapY, dir, rec, this.scratch,
      ).possible;

    let dir = preferredDirection;
    let found = probe(dir, rfpaw);
    if (!found) {
      dir = frame.secondaryDirection;
      found = probe(dir, rfpaw && this.deps.random.bool() !== 0);
    }
    if (!found) {
      dir = (dir + 2) & 0x3;
      found = probe(dir, false);
    }
    if (!found && this.deps.random.zeroTo3() === 0) {
      dir = (preferredDirection + 2) & 0x3;
      found = probe(dir, false);
    }

    if (!found) {
      if (!c.invincible) {
        this.turnMonstersAsGroup(
          c.slot, c.slotIndex, preferredDirection, c.indexOfLastMonster, c.horizSize, true, frame.sinceLastUpdate,
        );
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
   * `Try_To_Move` (`doc/CSBwin-src/Monster.cpp:2156`) — the fleeing path.
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
        this.deps.random, c.mapX, c.mapY, this.scratch.partyX, this.scratch.partyY,
      );
      const away = (dirs.primary + 2) & 0x3;
      frame.secondaryDirection = (dirs.secondary + 2) & 0x3;
      frame.timePerMove = frame.timePerMove - Math.trunc(frame.timePerMove / 4);
      this.tryPreferredDirectionThenOthers(frame, c, away, true);
      return;
    }

    c.slot.uByte5 = (c.slot.uByte5 - 1) & 0xff;
    if (c.slot.uByte5 !== 0) {
      if (this.deps.random.bool() !== 0) {
        const anyMove = this.deps.perception.findPossibleMove(
          c.monsterRn, c.desc, c.level, c.mapX, c.mapY, false, this.scratch,
        );
        if (anyMove === 0 && c.xDistance + c.yDistance <= 1) {
          // Cornered next to the party: stop panicking.
          c.monster.fear = StateOfFear.StateOfFear0;
          this.turnMonstersAsGroup(
            c.slot, c.slotIndex, frame.d5, c.indexOfLastMonster, c.horizSize, false, frame.sinceLastUpdate,
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
          this.deps.random, c.mapX, c.mapY, c.slot.uByte10, c.slot.uByte11,
        );
        frame.secondaryDirection = dirs.secondary;
        this.tryPreferredDirectionThenOthers(frame, c, dirs.primary, true);
        return;
      }
      const dirs = getPrimaryAndSecondaryDirection(
        this.deps.random, c.mapX, c.mapY, c.slot.uByte6, c.slot.uByte7,
      );
      frame.secondaryDirection = (dirs.secondary + 2) & 0x3;
      frame.timePerMove = frame.timePerMove - Math.trunc(frame.timePerMove / 4);
      this.tryPreferredDirectionThenOthers(frame, c, (dirs.primary + 2) & 0x3, true);
      return;
    }

    // The panic ran out.
    c.monster.fear = StateOfFear.StateOfFear0;
    this.turnMonstersAsGroup(
      c.slot, c.slotIndex, frame.d5, c.indexOfLastMonster, c.horizSize, false, frame.sinceLastUpdate,
    );
    if (c.timerFunction < TimerFunction.TT_M1) return;
    this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
    this.startBGroupTimer(
      frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, c.processingATimer, c.mapX, c.mapY,
    );
  }

  /**
   * `D4D0Finish` (`doc/CSBwin-src/Monster.cpp:2557`) — close in on the party at
   * double speed.
   */
  private d4d0Finish(frame: AiFrame, c: AiConst): void {
    frame.timePerMove = Math.trunc((frame.timePerMove + 1) / 2);
    this.rememberPartyPosition(c.slot);
    const dirs = getPrimaryAndSecondaryDirection(
      this.deps.random, c.mapX, c.mapY, this.scratch.partyX, this.scratch.partyY,
    );
    frame.secondaryDirection = dirs.secondary;
    this.tryPreferredDirectionThenOthers(frame, c, dirs.primary, true);
  }

  /**
   * `TryUByte67` (`doc/CSBwin-src/Monster.cpp:2625`) — head for the square the group
   * last knew the party to be at. Standing on it already means the trail is cold, so
   * the group calms down.
   */
  private tryUByte67(frame: AiFrame, c: AiConst, preferredDirection: number): void {
    void preferredDirection;
    if (c.mapX === c.slot.uByte6 && c.mapY === c.slot.uByte7) {
      c.monster.fear = StateOfFear.StateOfFear0;
      this.turnMonstersAsGroup(
        c.slot, c.slotIndex, frame.d5, c.indexOfLastMonster, c.horizSize, false, frame.sinceLastUpdate,
      );
      if (c.timerFunction < TimerFunction.TT_M1) return;
      this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
      this.startBGroupTimer(
        frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, c.processingATimer, c.mapX, c.mapY,
      );
      return;
    }
    const dirs = getPrimaryAndSecondaryDirection(
      this.deps.random, c.mapX, c.mapY, c.slot.uByte6, c.slot.uByte7,
    );
    frame.secondaryDirection = dirs.secondary;
    this.tryPreferredDirectionThenOthers(frame, c, dirs.primary, true);
  }

  /**
   * `Process_Invincible` (`doc/CSBwin-src/Monster.cpp:1612`) — Lord Chaos moves *two*
   * squares at a time, and a Fluxcage is what stops him.
   *
   * Returns true when the turn is finished. The `FindPossibleMove` call at the top
   * looks pointless — its result is discarded — but it is what populates
   * `d.FluxCages[]` and `d.FluxCageCount` for the tests below.
   */
  private processInvincible(frame: AiFrame, c: AiConst, preferredDirection: number): boolean {
    this.trace('      MAI Entering Process_Invincible');
    this.deps.perception.findPossibleMove(
      c.monsterRn, c.desc, c.level, c.mapX, c.mapY, false, this.scratch,
    );

    const doubleMove = (dir: number): boolean =>
      this.deps.perception.possibleDoubleMove(
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
    this.deps.monsters.playTeleportSound(newX, newY);

    const remaining = frame.timePerMove / 2 - frame.sinceLastUpdate;
    frame.bool36 = remaining <= 0;
    if (frame.bool36) {
      const moved = this.deps.monsters.moveMonster(c.monsterRn, c.mapX, c.mapY, newX, newY, c.level);
      if (moved.removed) return true;
      frame.timer.uByte6 = newX & 0xff;
      frame.timer.uByte7 = newY & 0xff;
      c.slot.ubPrevX = c.mapX & 0xff;
      c.slot.ubPrevY = c.mapY & 0xff;
      c.slot.uByte4 = this.deps.getTime() & 0xff;
    } else {
      frame.timePerMove = remaining;
      frame.sinceLastUpdate = -1;
    }
    return false;
  }

  /**
   * `Process_Invincible_And_Finish` (`doc/CSBwin-src/Monster.cpp:1894`) — an
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
      (c.timerFunction === TimerFunction.TT_M3 || this.deps.random.zeroTo3() === 0)
    ) {
      preferred = this.deps.random.zeroTo3();
      frame.secondaryDirection = (preferred + 1) & 0x3;
      if (this.processInvincible(frame, c, preferred)) return;
    }
    this.standardFinish(frame, c);
  }

  /**
   * `Standard_Finish` (`doc/CSBwin-src/Monster.cpp:1740`) — how nearly every turn
   * ends: maybe turn the group, then schedule the next one.
   */
  private standardFinish(frame: AiFrame, c: AiConst): void {
    this.trace('      MAI Entering Standard_Finish');
    if (!frame.bool36) {
      if (this.deps.random.zeroTo3() !== 0) {
        if (c.attackDistance > monsterSmellingDistance(c.desc)) {
          if (c.timerFunction < TimerFunction.TT_M1 && !frame.bool36) return;
          this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
          this.startBGroupTimer(
            frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, c.processingATimer, c.mapX, c.mapY,
          );
          return;
        }
      }
      if (c.timerFunction === TimerFunction.TT_M3) {
        if (c.timerFunction < TimerFunction.TT_M1 && !frame.bool36) return;
        this.incrementTimeByTimePerMovePlusRandom(frame.timer, frame.timePerMove);
        this.startBGroupTimer(
          frame.timer, c.slot, frame.i60, c.timeUntilAlternateUpdate, c.processingATimer, c.mapX, c.mapY,
        );
        return;
      }
    }

    this.turnMonstersAsGroup(
      c.slot, c.slotIndex, frame.d5, c.indexOfLastMonster, c.horizSize, frame.bool36, frame.sinceLastUpdate,
    );
    if (c.timerFunction < TimerFunction.TT_M1) {
      if (!frame.bool36) return;
      this.deleteTimersMaybeSetFear(c.monster, c.slotIndex, c.mapX, c.mapY, c.level, c.fearFactorIs6);
    }
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
    const moved = this.deps.monsters.moveMonster(c.monsterRn, c.mapX, c.mapY, newX, newY, c.level);
    if (moved.removed) return false;
    frame.timer.uByte6 = newX & 0xff;
    frame.timer.uByte7 = newY & 0xff;
    c.slot.ubPrevX = c.mapX & 0xff;
    c.slot.ubPrevY = c.mapY & 0xff;
    c.slot.uByte4 = this.deps.getTime() & 0xff;
    return true;
  }

  /** Turn the group to face where it wanted to go, then wait out a move interval. */
  private turnAndWait(frame: AiFrame, c: AiConst, preferredDirection: number): void {
    this.turnMonstersAsGroup(
      c.slot, c.slotIndex, preferredDirection, c.indexOfLastMonster, c.horizSize, true, frame.sinceLastUpdate,
    );
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
    return this.deps.perception.blocked(c.monster, member, c.level, c.mapX, c.mapY, {
      partyX: this.scratch.partyX,
      partyY: this.scratch.partyY,
      partyInvisible: (this.deps.getPartyState().invisible ?? 0) !== 0,
      currentPalette: this.deps.getCurrentPalette?.() ?? 0,
      orthogonalDistanceToParty: this.scratch.orthogonalDistanceToParty,
    });
  }

  /**
   * `CheckMonsterVersusMissiles` (`doc/CSBwin-src/Monster.cpp:4462`) — shifting
   * position inside a cell can walk the monster into a missile already there.
   *
   * ⏳ **Not ported.** Returns false, i.e. "no missile hit", which is the common case.
   * Tracked in PLAN.md Phase 12.
   */
  private checkMonsterVersusMissiles(c: AiConst): boolean {
    void c;
    this.lastDamageResult = MonsterDamageResult.NO_MONSTER_DIED;
    return false;
  }

  /** `d.MonsterDamageResult`, as the AI sees it. */
  private lastDamageResult = MonsterDamageResult.NO_MONSTER_DIED;

  /**
   * `OrdinalOfMonsterAtPosition` — which group member, 1-based, occupies a corner.
   */
  private ordinalOfMonsterAtPosition(monster: CreatureRecord, position: number): number {
    const render = this.deps.dungeon.getMonsterRenderState(monster);
    const positions = render.positions & 0xff;
    if (positions === 0xff) return 1;
    const desc = this.deps.monsterDesc()?.[monster.creatureType];
    const horizontalSize = desc ? monsterHorizontalSize(desc) : 0;
    const numMonM1 = monster.numMonM1 & 0x3;
    const check = position & 0x3;
    for (let idx = 0; idx <= numMonM1; idx++) {
      const at = (positions >> (idx * 2)) & 0x3;
      if (at === check) return idx + 1;
      if (horizontalSize === 1 && at === ((check + 1) & 0x3)) return idx + 1;
    }
    return 0;
  }

  /**
   * `InitialChecks` (`doc/CSBwin-src/Monster.cpp:2730`).
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
  ): InitialChecksResult {
    const party = this.deps.getPartyState();
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
        this.trace('Skip monster AI because not party level  and timer is not for group leader');
        return blank();
      }
    }

    // (2)
    if (monsterRn === OBJECT_ID_EOF) return blank();
    const monster = this.deps.dungeon.getCreatureRecord(monsterRn);
    if (!monster) return blank();
    this.scratch.lastMonsterMoved = monsterRn;

    const desc = this.deps.monsterDesc()?.[monster.creatureType];
    if (!desc) return blank();

    // (3) A member with no hit points is removed before anything else happens. The
    // timer goes back on the queue at the current time so that, if anyone survived,
    // it expires again immediately and we come back here
    // (doc/CSBwin-src/Monster.cpp:2795-2835).
    if (
      timerFunction !== TimerFunction.TT_M1 &&
      timerFunction !== TimerFunction.TT_M2 &&
      timerFunction !== TimerFunction.TT_M3
    ) {
      const numMon = (monster.numMonM1 & 0x3) + 1;
      for (let i = 0; i < numMon; i++) {
        if ((monster.hp[i] ?? 0) !== 0) continue;
        const result = this.deps.damage.damageMonster(
          monster, i, level, mapX, mapY, 0, true, !onPartyLevel,
        );
        if (result !== MonsterDamageResult.NO_MONSTER_DIED) {
          const timer = this.makeTimer(mapX, mapY, level, timerFunction, timeUntilAlternateUpdate);
          timer.time = this.deps.getTime() >>> 0;
          timer.uByte5 = 0;
          this.deps.timers.addTimer(timer);
          return blank();
        }
      }
    }

    this.trace('      MAI All memebers of the group are alive');

    // CSBWin initialises `attackDistance` to 24 by a deliberate patch of the Atari
    // binary: on rare paths the variable was read uninitialised, which only made the
    // monster behave slightly oddly but made the two builds impossible to compare
    // (doc/CSBwin-src/Monster.cpp:2853-2866).
    const attackDistance = 24;

    const timer = this.makeTimer(mapX, mapY, level, timerFunction, 0);
    timer.uByte5 = (255 - desc.movementTicks06) & 0xff;

    // (4) Off the party's level: one random step, then a long sleep.
    if (!onPartyLevel) {
      const direction = this.deps.random.zeroTo3();
      const probe = this.deps.perception.possibleMove(
        monsterRn, desc, level, mapX, mapY, direction, false, this.scratch,
      );
      this.trace(
        `      MAI Not on party level. PossibleMove(Random()=${direction}) returned ${probe.possible}.`,
      );
      if (probe.possible) {
        const newX = mapX + (DELTA_X[direction] ?? 0);
        const newY = mapY + (DELTA_Y[direction] ?? 0);
        const moved = this.deps.monsters.moveMonster(monsterRn, mapX, mapY, newX, newY, level);
        this.trace(`      MAI MoveObject to (${newX},${newY}) returned ${moved.removed ? 1 : 0}`);
        if (moved.removed) {
          this.trace('      MAI Skip monster AI because MoveObject non-zero');
          return blank();
        }
        timer.uByte6 = newX & 0xff;
        timer.uByte7 = newY & 0xff;
      } else {
        this.trace('      MAI  No attempt to move monster. Que 37 timer');
      }

      timer.function = TimerFunction.TT_MONSTER_BGROUP;
      const levelGap = Math.abs(level - partyLevel);
      const delay = Math.max(levelGap << 4, 2 * desc.movementTicks06);
      timer.time = (timer.time + delay) >>> 0;
      this.deps.timers.addTimer(timer);
      return blank();
    }

    // (5) On the party's level from here on.
    if (monsterInvincible(desc) && this.deps.isGameWon()) {
      // Lord Chaos stops moving once the game is won.
      return blank();
    }
    if (monsterInvincible(desc)) {
      this.scratch.fluxCageCount = 0;
      this.scratch.fluxCages.fill(0);
    }

    const slot = this.deps.dungeon.getAttachedItem16(monster);
    let sinceLastUpdate = (this.deps.getTime() & 255) - (slot?.uByte4 ?? 0);
    if (sinceLastUpdate < 0) sinceLastUpdate += 256;

    // A monster that never moves is still given a nominal 100 for the arithmetic that
    // follows (doc/CSBwin-src/Monster.cpp:2990-2994).
    let timePerMove = desc.movementTicks06 & 0xff;
    if (timePerMove === 255) timePerMove = 100;

    if (party.freezeLifeTimer !== 0 && !monsterInvincible(desc)) {
      if (timerFunction < TimerFunction.TT_EMPTY) return blank();
      timer.function = timerFunction;
      timer.uByte8 = timeUntilAlternateUpdate & 0xff;
      timer.time = (timer.time + 4) >>> 0;
      this.deps.timers.addTimer(timer);
      return blank();
    }

    if (timerFunction >= TimerFunction.TT_EMPTY) {
      // The only path that lets the AI proper run.
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
    this.deps.timers.addTimer(timer);
    return blank();
  }

  /* -------------------------------------------------------- timer helpers ---- */

  /**
   * `SetMonsterTimerB` (`doc/CSBwin-src/Monster.cpp:1260`).
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
        console.warn(`MonsterAI: illegal monster AI timer ${timer.function}`);
        return;
      }
      timer.function = flipped;
      timer.uByte8 = (timer.time - altTime) & 0xff;
      timer.time = altTime >>> 0;
    } else {
      timer.uByte8 = (altTime - timer.time) & 0xff;
    }
    this.deps.timers.addTimer(timer);
  }

  /**
   * `Set_Monster_Timer` (`doc/CSBwin-src/Monster.cpp:1337`).
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

  /** `EnsureI60NonZero` (`doc/CSBwin-src/Monster.cpp:1381`). */
  ensureI60NonZero(i60: number, slot: Item16Record, monsterX: number, monsterY: number): number {
    if (i60 !== 0) return i60;
    return this.deps.monsters.nextMonsterUpdateTime(slot, -1, false, monsterX, monsterY);
  }

  /**
   * `Increment_Time_By_W52_Plus_Random` (`doc/CSBwin-src/Monster.cpp:1395`) — never
   * less than one tick, however fast the monster.
   */
  incrementTimeByTimePerMovePlusRandom(timer: TimerEntry, timePerMove: number): void {
    timer.time = (timer.time + Math.max(1, timePerMove + this.deps.random.zeroTo3() - 1)) >>> 0;
  }

  /** `StartBGroupTimer` (`doc/CSBwin-src/Monster.cpp:1587`). */
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
    const ensured = this.ensureI60NonZero(i60, slot, monsterX, monsterY);
    this.setMonsterTimer(timer, ensured, timeUntilAlternateUpdate, processingATimer);
  }

  /**
   * `Delete_Timers_Maybe_Set_Fear` (`doc/CSBwin-src/Monster.cpp:1412`) — a group that
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
    this.deps.monsters.clearAttackingAndDeleteMovementTimers(slotIndex, mapX, mapY, level);
  }

  /**
   * `Turn_Monsters_As_Group` (`doc/CSBwin-src/Monster.cpp:1557`).
   *
   * `preferredDirection` is replaced by a random one when the group has no reason to
   * face anywhere in particular — CSBWin's `(bool_36 == false) && (w_54 >= 0)`.
   */
  turnMonstersAsGroup(
    slot: Item16Record,
    slotIndex: number,
    preferredDirection: number,
    indexOfLastMonster: number,
    horizSize: number,
    hasPreference: boolean,
    sinceLastUpdate: number,
  ): void {
    let direction = preferredDirection;
    if (!hasPreference && sinceLastUpdate >= 0) direction = this.deps.random.zeroTo3();
    const ref = { facings: slot.facings };
    this.deps.perception.turnMonsterGroup(
      this.scratch, slotIndex, ref, direction, indexOfLastMonster, horizSize === 1, this.deps.getTime(),
    );
    slot.facings = ref.facings;
  }

  /**
   * `MaybeDelTimers_Fear6_TurnIndividuals` (`doc/CSBwin-src/Monster.cpp:1436`).
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
  ): void {
    if (timerFunction === TimerFunction.TT_M2) {
      this.deps.monsters.deleteMonsterMovementTimers(mapX, mapY, level);
    }
    const party = this.deps.getPartyState();
    slot.uByte6 = party.position.x & 0xff;
    slot.uByte7 = party.position.y & 0xff;
    monster.fear = StateOfFear.StateOfFear6;

    this.trace('      MAI Set Fear Factor to 6.  Turn Individuals');
    this.trace('      MAI Set TT_B<n> timer for each Group Member');

    const preferred = this.scratch.primaryDirectionToParty;

    for (let monIdx = indexOfLastMonster; monIdx >= 0; monIdx--) {
      const monsterDirection = (slot.facings >> (2 * monIdx)) & 0x3;
      const turns = preferred !== monsterDirection && (monIdx === 0 || this.deps.random.bool() === 0);
      if (turns) {
        const ref = { facings: slot.facings };
        this.deps.perception.turnMonster(
          this.scratch,
          slotIndex,
          ref,
          preferred,
          monIdx,
          indexOfLastMonster !== 0 && horizSize === 1,
          this.deps.getTime(),
        );
        slot.facings = ref.facings;
        timer.time = (this.deps.getTime() + this.deps.random.zeroTo3() + 2) >>> 0;
      } else {
        timer.time = (this.deps.getTime() + 1) >>> 0;
      }
      if (processingATimer) {
        timer.time =
          (timer.time +
            Math.min(
              this.deps.random.zeroTo3() + Math.trunc((desc.attackTicks07 & 0xff) / 2),
              timeUntilAlternateUpdate,
            )) >>>
          0;
      }
      const perMember = MEMBER_B_TIMER[monIdx];
      if (perMember === undefined) {
        console.warn(`MonsterAI: illegal monster index ${monIdx}`);
        continue;
      }
      timer.function = perMember;
      this.setMonsterTimerB(
        timer,
        this.deps.monsters.nextMonsterUpdateTime(slot, monIdx, false, mapX, mapY),
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
      time: this.deps.getTime() >>> 0,
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
    this.deps.trace?.(line);
  }
}

/** The A→B flip when an "A" timer is processed (`doc/CSBwin-src/Monster.cpp:3611-3620`). */
const A_TO_B: Record<number, number> = {
  [TimerFunction.TT_MONSTER_AGROUP]: TimerFunction.TT_MONSTER_BGROUP,
  [TimerFunction.TT_MONSTER_A0]: TimerFunction.TT_MONSTER_B0,
  [TimerFunction.TT_MONSTER_A1]: TimerFunction.TT_MONSTER_B1,
  [TimerFunction.TT_MONSTER_A2]: TimerFunction.TT_MONSTER_B2,
  [TimerFunction.TT_MONSTER_A3]: TimerFunction.TT_MONSTER_B3,
};

/** `SetMonsterTimerB`'s B→A mapping (`doc/CSBwin-src/Monster.cpp:1267-1273`). */
const B_TO_A: Record<number, number> = {
  [TimerFunction.TT_MONSTER_BGROUP]: TimerFunction.TT_MONSTER_AGROUP,
  [TimerFunction.TT_MONSTER_B0]: TimerFunction.TT_MONSTER_A0,
  [TimerFunction.TT_MONSTER_B1]: TimerFunction.TT_MONSTER_A1,
  [TimerFunction.TT_MONSTER_B2]: TimerFunction.TT_MONSTER_A2,
  [TimerFunction.TT_MONSTER_B3]: TimerFunction.TT_MONSTER_A3,
};

/** Member index → its own B timer (`doc/CSBwin-src/Monster.cpp:1528-1536`). */
const MEMBER_B_TIMER: Record<number, number> = {
  0: TimerFunction.TT_MONSTER_B0,
  1: TimerFunction.TT_MONSTER_B1,
  2: TimerFunction.TT_MONSTER_B2,
  3: TimerFunction.TT_MONSTER_B3,
};
