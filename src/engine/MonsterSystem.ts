/**
 * Monster group lifecycle: the `ITEM16` pool, and the AI timers that hang off it.
 *
 * Ports the monster-lifecycle half of CSBWin's `CSBCode.cpp` —
 * `AttachItem16ToMonster` (:6024), `DetachItem16` (:6117), `TAG00bd40` (:6141),
 * `ProcessMonstersOnLevel` (:6158), `InitializeItem16` (:6193),
 * `NextMonsterUpdateTime` (:5842) and `StartMonsterMovementTimers` (:5988) — plus
 * `EnsureItem16Available` and `DeleteMonsterMovementTimers` from `Monster.cpp`
 * (:83 and :1297).
 *
 * See `doc/CSBWIN_MONSTERS_REFERENCE.md` for the record layouts and the "Group
 * lifecycle" section that this file implements.
 *
 * The AI itself lives in `MonsterAI.ts`; this module owns only the bookkeeping that
 * decides which groups are *active* and when they next get a turn.
 */
import { DBType, decodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../core/types';
import type { CsbRandom } from '../core/random';
import type { CreatureRecord, Item16Record } from '../data/dungeonTypes';
import { ITEM16_FREE, SMS_ATTACKING, SMS_MIRROR } from '../data/dungeonTypes';
import type { DungeonState } from './DungeonState';
import type { PartyState } from './gameTypes';
import { TimerFunction, type TimerQueue } from './TimerQueue';
import { MonsterType, StateOfFear } from './monsterTypes';
import type { MonsterDesc } from '../renderer/csbwin/ObjectTables';
import {
  monsterAttackingMirrorOK,
  monsterDelayFromAttackToMove,
  monsterDelayFromMoveToAttack,
  monsterHorizontalSize,
  monsterNibble12,
  monsterNibble14,
  monsterNonAttackingMirrorOK,
  monsterWord4Bit10,
} from '../renderer/csbwin/ObjectTables';

/** `d.MaxITEM16` starts at 60 (`doc/CSBwin-src/CSBCode.cpp:6195`). */
const INITIAL_MAX_ITEM16 = 60;

/** `AttachItem16ToMonster` grows the pool by 50 at a time, up to 1050 (`CSBCode.cpp:6055-6078`). */
const ITEM16_GROWTH = 50;
const ITEM16_HARD_MAX = 1050;

/**
 * `EnsureItem16Available` uses a *different* ceiling — 240
 * (`doc/CSBwin-src/Monster.cpp:89`). Preserved rather than reconciled: the two caps
 * are genuinely different numbers in CSBWin.
 */
const ITEM16_SOFT_MAX = 240;

/** Sound ordinal 16, played when a Deth Knight flips its attack sprite (`CSBCode.cpp:5906`). */
const SOUND_ORDINAL_DETH_KNIGHT_FLIP = 16;

/** `soundTELEPORT` (`doc/CSBwin-src/CSB.h:625`). */
const SOUND_ORDINAL_TELEPORT = 17;

/** The out-of-range `groupIndex` sentinels for a monster with no `ITEM16`. */
export const GROUP_INDEX_DETACHED = 0xd8;
export const GROUP_INDEX_DETACHED_SIZE4 = 0xff;

export interface MonsterSystemTables {
  monsterDesc?: ArrayLike<MonsterDesc>;
}

export interface MonsterSystemHooks {
  /** `QueueSound(ordinal, mapX, mapY, deltaTime)` (`doc/CSBwin-src/CSBCode.cpp:1819`). */
  queueSound?: (ordinal: number, mapX: number, mapY: number, deltaTime: number) => void;
  /** Dev-only AI trace sink; mirrors CSBWin's `AITraceActive` output. */
  trace?: (line: string) => void;
}

export class MonsterSystem {
  /** `d.ITEM16QueLen` — how many slots are in use. */
  private item16QueLen = 0;

  /**
   * The level whose monsters currently hold `ITEM16` slots. CSBWin tracks this
   * implicitly through `d.partyLevel`; here it is explicit so that a level change
   * can be detected wherever the party's position is committed.
   */
  private loadedLevel: number | null = null;

  constructor(
    private dungeon: DungeonState,
    private getPartyState: () => PartyState,
    private timers: TimerQueue,
    private getTime: () => number,
    private random: CsbRandom,
    private tables?: MonsterSystemTables,
    private hooks?: MonsterSystemHooks,
  ) {
    this.initializeItem16();
  }

  setTables(tables: MonsterSystemTables): void {
    if (tables.monsterDesc) this.tables = { ...this.tables, monsterDesc: tables.monsterDesc };
  }

  /* ------------------------------------------------------------------ pool ---- */

  /**
   * `InitializeItem16` (`doc/CSBwin-src/CSBCode.cpp:6193`) — allocate the pool with
   * every slot marked free.
   */
  private initializeItem16(): void {
    const pool = this.pool;
    if (pool.length > 0) {
      // A save game supplied the pool; keep it and recount the slots in use.
      this.item16QueLen = pool.reduce((n, r) => n + (r.word0 >= 0 ? 1 : 0), 0);
      return;
    }
    for (let i = 0; i < INITIAL_MAX_ITEM16; i++) pool.push(makeFreeItem16());
    this.item16QueLen = 0;
  }

  private get pool(): Item16Record[] {
    return this.dungeon.getItem16Pool();
  }

  /**
   * `EnsureItem16Available` (`doc/CSBwin-src/Monster.cpp:83`) — grow by 50 when
   * fewer than five slots remain, but only while the loaded level is the party's,
   * and never past 240.
   */
  ensureItem16Available(): void {
    const pool = this.pool;
    if (this.item16QueLen >= pool.length - 5 && this.isPartyLevelLoaded()) {
      if (pool.length < ITEM16_SOFT_MAX) {
        for (let i = 0; i < ITEM16_GROWTH; i++) pool.push(makeFreeItem16());
      }
    }
  }

  /** True when the pool is too full to take another group, as `CreateMonster` tests. */
  isItem16PoolFull(): boolean {
    return this.item16QueLen >= this.pool.length - 5 && this.isPartyLevelLoaded();
  }

  private isPartyLevelLoaded(): boolean {
    return this.loadedLevel !== null && this.loadedLevel === (this.getPartyState().position.z | 0);
  }

  /**
   * `AttachItem16ToMonster` (`doc/CSBwin-src/CSBCode.cpp:6024`).
   *
   * Claims the first free slot, growing the pool by 50 if there is none (capped at
   * 1050 — a different cap from `ensureItem16Available`'s, as in CSBWin). The order
   * of the field assignments matters: the DB4's packed positions byte is copied into
   * the slot *before* `groupIndex` is overwritten with the slot number.
   */
  attachItem16ToMonster(rn: ObjectID, mapX: number, mapY: number): number | null {
    const monster = this.dungeon.getCreatureRecord(rn);
    if (!monster) return null;
    const desc = this.getDesc(monster);
    if (!desc) return null;

    const pool = this.pool;
    let index = pool.findIndex((slot) => slot.word0 < 0);
    if (index < 0) {
      if (pool.length >= ITEM16_HARD_MAX) {
        console.warn('MonsterSystem: ITEM16 pool exhausted; monster left inactive');
        return null;
      }
      index = pool.length;
      for (let i = 0; i < ITEM16_GROWTH; i++) pool.push(makeFreeItem16());
    }

    const slot = pool[index]!;
    this.item16QueLen++;
    slot.word0 = decodeObjectID(rn).index;
    slot.positions = monster.groupIndex; // the packed positions the DB4 was carrying
    monster.groupIndex = index; // …and from here on the DB4 holds the slot number
    slot.uByte10 = mapX & 0xff;
    slot.ubPrevX = mapX & 0xff;
    slot.uByte11 = mapY & 0xff;
    slot.ubPrevY = mapY & 0xff;
    slot.uByte4 = (this.getTime() - 127) & 0xff; // about 20 seconds

    // Every member of the group faces whichever way the DB4 says, and starts with a
    // cleared status byte.
    for (let i = monster.numMonM1 & 0x3; i >= 0; i--) {
      slot.facings = setPackedBits(slot.facings, i, monster.facing & 0x3);
      slot.singleMonsterStatus[i] = 0;
    }

    this.nextMonsterUpdateTime(slot, -1, false, mapX, mapY);
    return index;
  }

  /**
   * `DetachItem16` (`doc/CSBwin-src/CSBCode.cpp:6117`) — hand a slot back, restoring
   * the two packed bytes onto the DB4 and clearing a high fear state.
   */
  detachItem16(index: number): void {
    const pool = this.pool;
    if (index >= pool.length) return;
    const slot = pool[index];
    if (!slot || slot.word0 < 0) return;

    const monster = this.dungeon.getCreatureRecordByIndex(slot.word0);
    this.item16QueLen--;
    if (monster) {
      monster.groupIndex = slot.positions;
      monster.facing = slot.facings & 0x3;
      if (monster.fear >= StateOfFear.StateOfFear4) monster.fear = StateOfFear.StateOfFear0;
    }
    slot.word0 = ITEM16_FREE;
  }

  /** `TAG00bd40` (`doc/CSBwin-src/CSBCode.cpp:6141`) — detach every active group. */
  detachAllItem16(): void {
    const pool = this.pool;
    for (let i = 0; i < pool.length && this.item16QueLen !== 0; i++) {
      if ((pool[i]?.word0 ?? ITEM16_FREE) >= 0) this.detachItem16(i);
    }
  }

  /* ------------------------------------------------------------ level load ---- */

  /**
   * `LoadPartyLevel` (`doc/CSBwin-src/CSBCode.cpp:785`), minus the graphics and
   * palette work this port does elsewhere: detach everything, then re-attach the new
   * level's monsters.
   *
   * CSBWin reaches this from the main loop via `d.newPartyLevel`, which `MoveObject`
   * sets when the party lands on a different level — and it runs *before*
   * `ProcessTimers` (`doc/CSBwin-src/CSBCode.cpp:618-635`). Callers must preserve
   * that ordering.
   */
  loadPartyLevel(level: number): void {
    this.detachAllItem16();
    this.loadedLevel = level | 0;
    this.processMonstersOnLevel();
  }

  /**
   * Re-attach everything after a save game is restored.
   *
   * Restoring replaces the whole `ITEM16` pool, so the in-use count here is stale
   * and the slots the save recorded may not match the level the party is now on.
   * CSBWin has the same problem and solves it the same way — `TAG00bd40()` then
   * `ProcessMonstersOnLevel()` (`doc/CSBwin-src/SaveGame.cpp:1240-1244`).
   */
  reloadAfterSaveGame(): void {
    const pool = this.pool;
    this.item16QueLen = pool.reduce((n, r) => n + (r.word0 >= 0 ? 1 : 0), 0);
    this.loadedLevel = null;
    this.loadPartyLevel(this.getPartyState().position.z | 0);
  }

  /** True if the party has changed level since the last `loadPartyLevel`. */
  needsLevelReload(): boolean {
    return this.loadedLevel !== (this.getPartyState().position.z | 0);
  }

  /** Run `loadPartyLevel` if, and only if, the party's level has changed. */
  loadPartyLevelIfChanged(): void {
    const level = this.getPartyState().position.z | 0;
    if (this.loadedLevel === level) return;
    this.loadPartyLevel(level);
  }

  /**
   * `ProcessMonstersOnLevel` (`doc/CSBwin-src/CSBCode.cpp:6158`).
   *
   * Walks every cell of the loaded level and, for each cell that has objects, finds
   * the **first** monster in the chain and gives it a slot and a timer. It then stops
   * scanning that cell — one active monster group per cell.
   */
  processMonstersOnLevel(): void {
    const level = this.loadedLevel;
    if (level === null) return;
    const map = this.dungeon.getMap(level);
    if (!map) return;

    const { width, height } = map.descriptor;
    for (let mapX = 0; mapX < width; mapX++) {
      for (let mapY = 0; mapY < height; mapY++) {
        const position = new Position(mapX, mapY, level);
        if (!this.dungeon.hasObjects(position)) continue;
        const rn = this.findFirstMonsterAt(position);
        if (rn === OBJECT_ID_EOF) continue;
        this.deleteMonsterMovementTimers(mapX, mapY, level);
        this.attachItem16ToMonster(rn, mapX, mapY);
        this.startMonsterMovementTimers(mapX, mapY, level);
      }
    }
  }

  /**
   * `FindFirstMonster` (`doc/CSBwin-src/Code11f52.cpp:533`) — the first creature in
   * the cell's object chain, or `OBJECT_ID_EOF`.
   */
  findFirstMonsterAt(position: Position): ObjectID {
    for (
      let rn = this.dungeon.findFirstObject(position);
      rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
      rn = this.dungeon.getDBRecordLink(rn)
    ) {
      if (decodeObjectID(rn).category === DBType.CREATURE) return rn;
    }
    return OBJECT_ID_EOF;
  }

  /* ---------------------------------------------------------------- timers ---- */

  /**
   * `DeleteMonsterMovementTimers` (`doc/CSBwin-src/Monster.cpp:1297`) — drop every
   * timer of type 29-41 on this level at this square.
   */
  deleteMonsterMovementTimers(mapX: number, mapY: number, level: number): void {
    this.trace(`      MAI Delete all Monster Timers at (${mapX},${mapY})`);
    const doomed: number[] = [];
    for (const timer of this.timers.getTimers()) {
      if (timer.level !== (level & 0xff)) continue;
      if (timer.function < TimerFunction.TT_FIRST_MONSTER_AI) continue;
      if (timer.function > TimerFunction.TT_LAST_MONSTER_AI) continue;
      if (timer.uByte6 !== (mapX & 0xff)) continue;
      if (timer.uByte7 !== (mapY & 0xff)) continue;
      doomed.push(timer.index);
    }
    for (const index of doomed) this.timers.deleteTimer(index);
  }

  /**
   * `StartMonsterMovementTimers` (`doc/CSBwin-src/CSBCode.cpp:5988`).
   *
   * Schedules the group's first turn as a `TT_MONSTER_Bgroup` at `d.Time + 1`, with
   * `uByte5` holding `255 - timePerMove` — the inverted form the timer queue's
   * ordering rules expect. Any fear state of 4 or more is reset first.
   */
  startMonsterMovementTimers(mapX: number, mapY: number, level: number): void {
    const position = new Position(mapX, mapY, level);
    const rn = this.findFirstMonsterAt(position);
    let uByte5 = 255;

    if (rn !== OBJECT_ID_EOF) {
      const monster = this.dungeon.getCreatureRecord(rn);
      if (monster) {
        if (monster.fear >= StateOfFear.StateOfFear4) monster.fear = StateOfFear.StateOfFear0;
        const desc = this.getDesc(monster);
        if (desc) uByte5 = (255 - desc.movementTicks06) & 0xff;
      }
    }
    // CSBWin asserts here when no monster is found, and leaves uByte5 at 255 — which
    // happened for real in the prison when the last champion starved
    // (doc/CSBwin-src/CSBCode.cpp:6005-6011).

    this.timers.createTimerWithUByte5(
      TimerFunction.TT_MONSTER_BGROUP,
      mapX,
      mapY,
      0, // timerUByte8
      0, // timerUByte9
      (this.getTime() + 1) >>> 0,
      level,
      uByte5,
    );
  }

  /**
   * `NextMonsterUpdateTime` (`doc/CSBwin-src/CSBCode.cpp:5842`).
   *
   * Two jobs at once: it re-rolls each member's `singleMonsterStatus` — the two
   * signed walk offsets, the mirror flag and the attacking flag — and returns the
   * time of the group's next turn.
   *
   * A `monsterIndex` below zero means "every member of the group", and is the only
   * case that loops; a non-negative index touches exactly that one member.
   *
   * Note CSBWin's own naming inversion in the delay choice, preserved here: when
   * `attacking` is true it uses `AdditionalDelayFromAttackToMove`.
   */
  nextMonsterUpdateTime(
    slot: Item16Record,
    monsterIndex: number,
    attacking: boolean,
    monsterX: number,
    monsterY: number,
  ): number {
    const monster = this.dungeon.getCreatureRecordByIndex(slot.word0);
    if (!monster) return this.getTime();
    const desc = this.getDesc(monster);
    if (!desc) return this.getTime();

    const allMembers = monsterIndex < 0;
    let index = allMembers ? monster.numMonM1 & 0x3 : monsterIndex;

    for (;;) {
      let sms = slot.singleMonsterStatus[index] ?? 0;
      // Clear both offset nibbles, then re-roll each from its own 2-bit width.
      sms &= ~0x3f;

      const width12 = monsterNibble12(desc);
      if (width12 !== 0) {
        let value = this.random.below(width12);
        if (this.random.bool()) value = -value & 7;
        sms = (sms & ~0x07) | (value & 0x07);
      }
      const width14 = monsterNibble14(desc);
      if (width14 !== 0) {
        let value = this.random.below(width14);
        if (this.random.bool()) value = -value & 7;
        sms = (sms & ~0x38) | ((value & 0x07) << 3);
      }

      if (attacking) {
        if (monsterAttackingMirrorOK(desc)) {
          const wasAttacking = (sms & SMS_ATTACKING) !== 0;
          if (wasAttacking && monster.creatureType === MonsterType.mon_DethKnight) {
            // A Deth Knight already mid-attack flips its sprite on a coin toss, and
            // makes a noise doing it (doc/CSBwin-src/CSBCode.cpp:5900-5908).
            if (this.random.bool()) {
              sms ^= SMS_MIRROR;
              this.hooks?.queueSound?.(SOUND_ORDINAL_DETH_KNIGHT_FLIP, monsterX, monsterY, 1);
            }
          } else if (!wasAttacking || !monsterWord4Bit10(desc)) {
            sms = this.random.bool() ? sms | SMS_MIRROR : sms & ~SMS_MIRROR;
          }
        } else {
          sms &= ~SMS_MIRROR;
        }
        sms |= SMS_ATTACKING;
      } else {
        if (monsterNonAttackingMirrorOK(desc)) {
          sms = this.random.bool() ? sms | SMS_MIRROR : sms & ~SMS_MIRROR;
        } else {
          sms &= ~SMS_MIRROR;
        }
        sms &= ~SMS_ATTACKING;
      }

      slot.singleMonsterStatus[index] = sms & 0xff;
      if (!allMembers) break;
      index--;
      if (index < 0) break;
    }

    const minDelay = attacking
      ? monsterDelayFromAttackToMove(desc)
      : monsterDelayFromMoveToAttack(desc);
    return (this.getTime() + minDelay + this.random.bool()) >>> 0;
  }

  /* -------------------------------------------------------------------- AI ---- */

  /**
   * `ProcessTimers29to41` (`doc/CSBwin-src/Monster.cpp:3239`) — every monster AI
   * timer arrives here.
   *
   * ⏳ **PLACEHOLDER.** The real port is ~2000 lines of `Monster.cpp`
   * (`InitialChecks`, `Try_To_Move`, `Try_Preferred_Direction_Then_Others`,
   * `Try_Directions_D5_To_D4`, `Standard_Finish`, `Process_Invincible`, …) and lands
   * in the next step of Phase 12. Until then a group gets its slot and its first
   * timer, that timer fires exactly once, and nothing moves. This is deliberately
   * inert rather than approximated — a guessed AI would be worse than none.
   */
  processTimers29to41(options: {
    mapX: number;
    mapY: number;
    level: number;
    timerFunction: number;
    timeUntilAlternateUpdate: number;
  }): void {
    this.trace(
      `MonsterAI ${String(options.level).padStart(2, '0')}` +
        `(${options.mapX},${options.mapY})@${this.getTime()} ` +
        `timeFunc=${options.timerFunction} tuau=${options.timeUntilAlternateUpdate} [not ported]`,
    );
  }

  /* ----------------------------------------------------------------- misc ---- */

  /**
   * The `groupIndex` sentinel for a monster with no `ITEM16` — 0xd8, or 0xff when it
   * fills the whole cell (`doc/CSBwin-src/MoveObject.cpp:517-518`).
   */
  detachedGroupIndexFor(monster: CreatureRecord): number {
    const desc = this.getDesc(monster);
    const fillsCell = desc ? monsterHorizontalSize(desc) === 2 : false;
    return fillsCell ? GROUP_INDEX_DETACHED_SIZE4 : GROUP_INDEX_DETACHED;
  }

  playTeleportSound(mapX: number, mapY: number): void {
    this.hooks?.queueSound?.(SOUND_ORDINAL_TELEPORT, mapX, mapY, 1);
  }

  private getDesc(monster: CreatureRecord): MonsterDesc | null {
    return this.tables?.monsterDesc?.[monster.creatureType] ?? null;
  }

  private trace(line: string): void {
    this.hooks?.trace?.(line);
  }
}

function makeFreeItem16(): Item16Record {
  return {
    word0: ITEM16_FREE,
    facings: 0,
    positions: 0,
    uByte4: 0,
    uByte5: 0,
    uByte6: 0,
    uByte7: 0,
    ubPrevX: 0,
    ubPrevY: 0,
    uByte10: 0,
    uByte11: 0,
    singleMonsterStatus: [0, 0, 0, 0],
  };
}

/**
 * `SetMonsterPositionBits` — replace the `index`th 2-bit field of a packed byte
 * (`doc/CSBwin-src/CSBCode.cpp`, used throughout the monster code).
 */
export function setPackedBits(packed: number, index: number, value: number): number {
  const shift = 2 * (index & 0x3);
  return ((packed & ~(0x3 << shift)) | ((value & 0x3) << shift)) & 0xff;
}
