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
import { DBType, decodeObjectID, encodeObjectID, OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../core/types';
import type { CsbRandom } from '../core/random';
import type { CreatureRecord, Item16Record } from '../data/dungeonTypes';
import { ITEM16_FREE, SMS_ATTACKING, SMS_MIRROR } from '../data/dungeonTypes';
import type { DungeonState } from './DungeonState';
import type { PartyState } from './gameTypes';
import { TimerFunction, type TimerEntry, type TimerQueue } from './TimerQueue';
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
  /**
   * `CheckMoveFromMissile` (`doc/CSBwin-src/Code11f52.cpp`) — a monster leaving a
   * square may be struck by a missile sitting in it. Returns true if that removed
   * the monster from the dungeon.
   */
  checkMoveFromMissile?: (from: Position, to: Position, monsterRn: ObjectID) => boolean;
  /**
   * Take a monster's intended destination through the cell's effects — teleporter
   * chains and pit falls — the way the party's move is resolved. `code` carries
   * `TeleportMonster`'s return value (`groupIndex + 2` for a fear-6 group, else 1,
   * or 0 for no teleport), and `audible` whether the teleporter buzzed.
   */
  resolveMonsterDestination?: (
    destination: Position,
    monsterRn: ObjectID,
  ) => { position: Position; code: number; audible: boolean };
  /** `QueueSound(ordinal, mapX, mapY, deltaTime)` (`doc/CSBwin-src/CSBCode.cpp:1819`). */
  queueSound?: (ordinal: number, mapX: number, mapY: number, deltaTime: number) => void;
  /** Dev-only AI trace sink; mirrors CSBWin's `AITraceActive` output. */
  trace?: (line: string) => void;
}

export class MonsterSystem {
  /** `d.ITEM16QueLen` — how many slots are in use. */
  private item16QueLen = 0;

  /** The same counter, for `GAMEBLOCK2` offset 30 (`doc/CSBwin-src/SaveGame.cpp:1028`). */
  getItem16QueLen(): number {
    return this.item16QueLen;
  }

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

  /**
   * `d.ITEM16QueLen--` for a slot freed elsewhere.
   *
   * `DeleteMonster` (in `MonsterDamage`) releases a slot directly, and the count is
   * owned here, so it tells us rather than reaching into this object's state.
   */
  noteItem16Freed(): void {
    if (this.item16QueLen > 0) this.item16QueLen--;
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
        const rn = this.dungeon.findFirstMonster(position);
        if (rn === OBJECT_ID_EOF) continue;
        this.deleteMonsterMovementTimers(mapX, mapY, level);
        this.attachItem16ToMonster(rn, mapX, mapY);
        this.startMonsterMovementTimers(mapX, mapY, level);
      }
    }
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
    const rn = this.dungeon.findFirstMonster(position);
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

  /* ------------------------------------------------------------ moving ------- */

  /**
   * `MoveObject`'s monster branch (`doc/CSBwin-src/Code11f52.cpp:3325-3424`).
   *
   * Moves a group from one square to another, taking the destination cell's effects
   * — teleporters, pits — through the same resolution the party uses, and keeping the
   * `ITEM16` and the AI timers in step with the result.
   *
   * Returns CSBWin's `LOCAL_14`, whose encoding is worth spelling out because two of
   * its values overlap in meaning:
   *
   * - `removed: true` is CSBWin's `return 1` — the group is no longer in the dungeon,
   *   because the destination was occupied and it has gone into abeyance.
   * - `code === 0` means nothing about the `ITEM16` changed.
   * - `code === 1` means the slot was attached or detached by this move.
   * - `code > 1` comes only from `TeleportMonster`, which returns `groupIndex + 2`
   *   for a fear-state-6 group so the caller can find its slot again
   *   (`doc/CSBwin-src/Code11f52.cpp:2377-2384`).
   */
  moveMonster(
    monsterRn: ObjectID,
    oldX: number,
    oldY: number,
    newX: number,
    newY: number,
    level: number,
  ): { removed: boolean; code: number } {
    const monster = this.dungeon.getCreatureRecord(monsterRn);
    if (!monster) return { removed: false, code: 0 };

    const partyLevel = this.getPartyState().position.z | 0;
    const fromDungeon = oldX >= 0;
    // "Proper level && oldX >= 0 means an ITEM16 exists"
    // (doc/CSBwin-src/Code11f52.cpp:3122).
    const item16Attached = level === partyLevel && fromDungeon;

    // A monster leaving a square may run into a missile sitting in it.
    if (fromDungeon && level === partyLevel) {
      const hit = this.hooks?.checkMoveFromMissile?.(
        new Position(oldX, oldY, level),
        new Position(newX, newY, level),
        monsterRn,
      );
      if (hit) return { removed: true, code: 0 };
    }

    // Follow teleporters and fall down pits, exactly as the party does.
    const resolved = this.hooks?.resolveMonsterDestination?.(
      new Position(newX, newY, level),
      monsterRn,
    ) ?? { position: new Position(newX, newY, level), code: 0, audible: false };

    const destination = resolved.position;
    const destLevel = destination.z | 0;
    let code = resolved.code;

    // The destination is unusable if the party is standing there or another monster
    // already is. CSBWin then parks the group on a TT_60/TT_61 timer to retry.
    const blockedByParty =
      destLevel === partyLevel &&
      destination.x === (this.getPartyState().position.x | 0) &&
      destination.y === (this.getPartyState().position.y | 0);
    const occupant = this.dungeon.findFirstMonster(destination);
    if (blockedByParty || occupant !== OBJECT_ID_EOF) {
      if (fromDungeon) this.deleteMonsterMovementTimers(oldX, oldY, level);
      if (item16Attached) this.detachItem16(monster.groupIndex);
      if (fromDungeon) this.dungeon.removeObjectFromCell(new Position(oldX, oldY, level), monsterRn);
      this.createMovementTimer(monsterRn, destination, resolved.audible);
      return { removed: true, code: 0 };
    }

    // Crossing on or off the party's level attaches or detaches the slot.
    if (item16Attached && destLevel !== partyLevel) {
      this.detachItem16(monster.groupIndex);
      code = 1;
    } else if (destLevel === partyLevel && !item16Attached) {
      this.attachItem16ToMonster(monsterRn, destination.x, destination.y);
      code = 1;
    }

    if (fromDungeon) this.dungeon.removeObjectFromCell(new Position(oldX, oldY, level), monsterRn);
    this.dungeon.addObjectToCell(destination, monsterRn);

    // A freshly attached group, or one placed from nowhere, needs its first timer.
    if (code !== 0 || !fromDungeon) {
      this.startMonsterMovementTimers(destination.x, destination.y, destLevel);
    }

    if (fromDungeon) {
      if (code > 1) {
        // A teleported fear-6 group: stop it attacking and drop its old timers.
        this.clearAttackingAndDeleteMovementTimers(code - 2, oldX, oldY, level);
      } else if (code !== 0) {
        this.deleteMonsterMovementTimers(oldX, oldY, level);
      } else {
        // Same level, still attached: the timers stay but must follow the group to
        // its new square (doc/CSBwin-src/MoveObject.cpp:551-565).
        this.retargetMonsterMovementTimers(oldX, oldY, destination.x, destination.y, level);
      }
    }

    // Keep the slot's idea of where it is in step.
    const slot = this.dungeon.getAttachedItem16(monster);
    if (slot) {
      slot.ubPrevX = slot.uByte10;
      slot.ubPrevY = slot.uByte11;
      slot.uByte10 = destination.x & 0xff;
      slot.uByte11 = destination.y & 0xff;
    }

    return { removed: false, code };
  }

  /**
   * `ClearAttacking_DeleteMovementTimers` (`doc/CSBwin-src/Code11f52.cpp:667`) — a
   * group that has just been teleported is no longer mid-attack.
   */
  clearAttackingAndDeleteMovementTimers(slotIndex: number, mapX: number, mapY: number, level: number): void {
    const slot = this.dungeon.getItem16Record(slotIndex);
    if (slot) {
      for (let i = 0; i < 4; i++) {
        slot.singleMonsterStatus[i] = (slot.singleMonsterStatus[i] ?? 0) & ~SMS_ATTACKING;
      }
    }
    this.deleteMonsterMovementTimers(mapX, mapY, level);
  }

  /**
   * Point a group's existing AI timers at its new square.
   *
   * CSBWin does this in the DSA move path (`doc/CSBwin-src/MoveObject.cpp:551-565`)
   * by rewriting `uByte6`/`uByte7` in place — the timers are addressed by map square,
   * so a group that moved without changing its `ITEM16` would otherwise keep waking
   * up at the square it left.
   */
  private retargetMonsterMovementTimers(
    oldX: number,
    oldY: number,
    newX: number,
    newY: number,
    level: number,
  ): void {
    for (const timer of this.timers.getTimers()) {
      if (timer.level !== (level & 0xff)) continue;
      if (timer.function < TimerFunction.TT_FIRST_MONSTER_AI) continue;
      if (timer.function > TimerFunction.TT_LAST_MONSTER_AI) continue;
      if (timer.uByte6 !== (oldX & 0xff)) continue;
      if (timer.uByte7 !== (oldY & 0xff)) continue;
      timer.uByte6 = newX & 0xff;
      timer.uByte7 = newY & 0xff;
    }
  }

  /**
   * `CreateMovementTimer` (`doc/CSBwin-src/Code11f52.cpp:2446`) — park a monster that
   * could not be placed, to retry later.
   *
   * ⚠️ CSBWin also counts how many are already waiting at that square and, past 31,
   * deletes the monster outright unless it is `Unique()` or carries something
   * (`doc/CSBwin-src/Code11f52.cpp:2474-2510`). That overflow guard is **not** ported
   * — see PLAN.md Phase 12.
   */
  createMovementTimer(monsterRn: ObjectID, destination: Position, audible: boolean): void {
    this.timers.createTimer(
      audible ? TimerFunction.TT_61 : TimerFunction.TT_60,
      destination.x,
      destination.y,
      0,
      0,
      (this.getTime() + 5) >>> 0,
      destination.z,
      monsterRn,
    );
  }

  /**
   * `ProcessTimer60and61` (`doc/CSBwin-src/Timer.cpp:2566`) — retry a parked move.
   *
   * If the square is now free the monster is placed and the timer ends. Otherwise it
   * is rescheduled 5 ticks later — except for Lord Chaos, who gets a 25% chance to
   * wander one square and try there instead, which is how he escapes a corner.
   */
  processAbeyanceTimer(timer: TimerEntry): void {
    const monsterRn = timer.object;
    if (monsterRn === undefined) return;
    const level = timer.level & 0xff;
    let mapX = timer.uByte6;
    let mapY = timer.uByte7;
    const partyLevel = this.getPartyState().position.z | 0;
    const party = this.getPartyState().position;

    let triedWander = false;
    for (;;) {
      const free =
        !(level === partyLevel && (party.x | 0) === mapX && (party.y | 0) === mapY) &&
        this.dungeon.findFirstMonster(new Position(mapX, mapY, level)) === OBJECT_ID_EOF;
      if (free) {
        if (timer.function === TimerFunction.TT_61) {
          this.hooks?.queueSound?.(SOUND_ORDINAL_TELEPORT, mapX, mapY, 1);
        }
        this.moveMonster(monsterRn as ObjectID, -1, 0, mapX, mapY, level);
        return;
      }

      if (triedWander) break;
      triedWander = true;

      const monster = this.dungeon.getCreatureRecord(monsterRn as ObjectID);
      if (!monster || monster.creatureType !== MonsterType.mon_LordChaos) break;
      if (this.random.zeroTo3() !== 0) break; // 25 percent chance of movement

      switch (this.random.zeroTo3()) {
        case 0: mapX--; break;
        case 1: mapX++; break;
        case 2: mapY--; break;
        default: mapY++; break;
      }
      if (!this.openTeleporterPitOrDoor(level, mapX, mapY)) break;
    }

    timer.time = (timer.time + 5) >>> 0;
    this.timers.addTimer(timer);
  }

  /** `OpenTeleporterPitOrDoor` (`doc/CSBwin-src/Timer.cpp:625`). */
  private openTeleporterPitOrDoor(level: number, mapX: number, mapY: number): boolean {
    const map = this.dungeon.getMap(level);
    if (!map) return false;
    if (mapX < 0 || mapY < 0 || mapX >= map.descriptor.width || mapY >= map.descriptor.height) return false;
    const roomType = (this.dungeon.getCellFlag(new Position(mapX, mapY, level)) >> 5) & 0x7;
    return (
      roomType === RoomType.OPEN ||
      roomType === RoomType.TELEPORTER ||
      roomType === RoomType.PIT ||
      roomType === RoomType.DOOR
    );
  }

  /* --------------------------------------------------------------- create ---- */

  /**
   * `CreateMonster` (`doc/CSBwin-src/Monster.cpp:111`) — bring a new group into
   * being, as a creature generator or a DSA does.
   *
   * `value` packs the monster type in bits 0-4 and an alternate-graphic selector in
   * bits 5-6. The group size is clamped by the type's footprint: a two-corner monster
   * can have at most two, a whole-cell monster at most one — CSBWin shows a message
   * box and carries on rather than refusing.
   *
   * Placement is left to `moveMonster`, which is what attaches the `ITEM16`; if the
   * destination turns out to be occupied the group goes straight into abeyance and
   * this returns null.
   */
  createMonster(options: {
    value: number;
    hitPointMultiplier: number;
    numMonM1: number;
    facing: number;
    mapX: number;
    mapY: number;
    level: number;
    invisible: boolean;
    drawAsSize4: boolean;
  }): ObjectID | null {
    const monsterType = options.value & 0x1f;
    const alternateGraphics = (options.value >> 5) & 0x3;

    if (!this.isMonsterAllowedOnLevel(monsterType, options.level)) return null;

    this.ensureItem16Available();
    if (this.isItem16PoolFull()) return null;

    const desc = this.tables?.monsterDesc?.[monsterType];
    if (!desc) return null;

    const rn = this.findEmptyCreatureEntry();
    if (rn === null) return null;
    const monster = this.dungeon.getCreatureRecord(rn);
    if (!monster) return null;

    // Clamp the group to what its footprint allows.
    let numMonM1 = options.numMonM1 & 0x3;
    const horizontalSize = monsterHorizontalSize(desc);
    if (horizontalSize === 1 && numMonM1 > 1) numMonM1 = 1;
    if (horizontalSize === 2 && numMonM1 > 0) numMonM1 = 0;

    monster.creatureType = monsterType;
    monster.alternateGraphics = alternateGraphics;
    monster.possession = OBJECT_ID_EOF;
    monster.important = false;
    monster.facing = options.facing & 0x3;
    monster.numMonM1 = numMonM1;
    monster.invisible = options.invisible;
    monster.drawAsSize4 = options.drawAsSize4;
    monster.fear = StateOfFear.StateOfFear0;
    monster.unique = false;
    monster.poisoned = false;
    monster.hp = [0, 0, 0, 0];

    // A lone monster is centred (0xff); a group gets packed corner positions from a
    // random start, advancing by two for a two-corner monster.
    const isGroup = numMonM1 !== 0;
    let positions = isGroup ? 0 : 255;
    let nextPosition = isGroup ? this.random.zeroTo3() : 0;

    // CSBWin fills from the top index downwards.
    let index = numMonM1;
    for (;;) {
      // `STRandom() % n` here, not `STRandom(n)` — the full 24-bit draw, unmasked
      // (doc/CSBwin-src/Monster.cpp:207).
      const spread = this.random.next() % (Math.trunc(desc.baseHealth09 / 4) + 1);
      monster.hp[index] = (desc.baseHealth09 * options.hitPointMultiplier + spread) & 0xffff;
      if (isGroup) {
        positions = setPackedBits(positions, index, nextPosition);
        nextPosition++;
        if (horizontalSize === 1) nextPosition++;
        nextPosition &= 0x3;
      }
      if (index === 0) break;
      index--;
    }
    monster.groupIndex = positions & 0xff;

    const placed = this.moveMonster(rn, -1, 0, options.mapX, options.mapY, options.level);
    if (placed.removed) return null;
    this.hooks?.queueSound?.(SOUND_ORDINAL_TELEPORT, options.mapX, options.mapY, 1);
    return rn;
  }

  /**
   * `MonsterAllowedOnLevel` — a level lists which creature types may exist on it.
   */
  private isMonsterAllowedOnLevel(monsterType: number, level: number): boolean {
    const map = this.dungeon.getMap(level);
    if (!map) return false;
    for (const entry of map.monsterTypes ?? []) {
      if ((entry & 0xff) === (monsterType & 0xff)) return true;
    }
    return false;
  }

  /**
   * `FindEmptyDB4Entry` — a free creature record.
   *
   * ⚠️ CSBWin reuses freed slots; this appends, as the rest of this port does. See
   * the note on `MonsterDamage.createDroppedRecord`.
   */
  private findEmptyCreatureEntry(): ObjectID | null {
    const data = this.dungeon.getData();
    const db = data.databases.creatures;
    if (db.records.length >= 1024) return null;
    db.records.push({
      nextObject: OBJECT_ID_EOF,
      possession: OBJECT_ID_EOF,
      creatureType: 0,
      alternateGraphics: 0,
      groupIndex: GROUP_INDEX_DETACHED,
      hp: [0, 0, 0, 0],
      fear: StateOfFear.StateOfFear0,
      numMonM1: 0,
      facing: 0,
      important: false,
      invisible: false,
      drawAsSize4: false,
      unique: false,
      poisoned: false,
    });
    db.count++;
    return encodeObjectID(0, DBType.CREATURE, db.records.length - 1) as ObjectID;
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
