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
import { monsterHorizontalSize, monsterInvincible } from '../renderer/csbwin/ObjectTables';

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
  trace?: (line: string) => void;
}

export class MonsterAI {
  private scratch = makeAiScratch();

  constructor(private deps: MonsterAiDeps) {}

  /**
   * `ProcessTimers29to41`'s prologue plus `InitialChecks`.
   *
   * Only the gate is ported so far; the decision body that follows it is still to
   * come. See PLAN.md Phase 12 step 3.
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

    // ⏳ The decision body — the TT_31/TT_30/TT_29 dispatch and the
    // `Try_To_Move` / `Try_Preferred_Direction_Then_Others` /
    // `Try_Directions_D5_To_D4` / `Standard_Finish` / `Process_Invincible` chain
    // (doc/CSBwin-src/Monster.cpp:3405-4462) — is not ported yet. Until it is, a
    // group that gets this far simply keeps its turn coming round: reschedule the
    // group timer so the AI stays alive rather than stopping dead.
    this.rescheduleGroupTimer(checks, timeUntilAlternateUpdate);
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

  /**
   * Keep a group's turn coming round while the decision body is unported.
   *
   * ⏳ Temporary. `ProcessTimers29to41` always ends by scheduling the group's next
   * event through one of the `Set_Monster_Timer` paths; until those are in, this
   * stands in for them so the AI does not silently stop after one tick.
   */
  private rescheduleGroupTimer(checks: InitialChecksResult, timeUntilAlternateUpdate: number): void {
    const timer = checks.timer;
    timer.function = TimerFunction.TT_MONSTER_BGROUP;
    timer.uByte8 = timeUntilAlternateUpdate & 0xff;
    this.incrementTimeByTimePerMovePlusRandom(timer, checks.timePerMove);
    this.deps.timers.addTimer(timer);
  }

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
