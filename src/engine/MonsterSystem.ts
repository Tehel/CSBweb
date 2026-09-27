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
import { DBType, decodeObjectID, encodeObjectID, OBJECT_ID_EOF, Position, RoomType, withObjectPosition, type ObjectID } from '../core/types';
import type { CsbRandom } from '../core/random';
import type { CreatureRecord, Item16Record } from '../data/dungeonTypes';
import { ITEM16_FREE, SMS_ATTACKING, SMS_MIRROR } from '../data/dungeonTypes';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import { TimerFunction, type TimerEntry, type TimerQueue } from './TimerQueue';
import { MonsterType, StateOfFear } from './monsterTypes';
import type { MonsterDesc } from '../renderer/csbwin/ObjectTables';
import {
  monsterAttackingMirrorOK,
  monsterDelayFromAttackToMove,
  monsterDelayFromMoveToAttack,
  monsterHorizontalSize,
  monsterLevitating,
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

/**
 * `DB4::Unique()` (doc/CSBwin-src/CSB.h:1129) — `drawAsSize4Monsters && BITS13_13(word14)`.
 * `drawAsSize4Monsters` is a design option from a save's extended-features block
 * (`SaveGame.cpp:399-400`) that defaults to `false` (`data.cpp:78`). The port does not
 * model it (DEBT.md G4), so no monster is unique, whatever bit 13 says.
 */
const DRAW_AS_SIZE4_MONSTERS = false;
function monsterUnique(monster: CreatureRecord): boolean {
  return DRAW_AS_SIZE4_MONSTERS && monster.unique;
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

  private readonly dungeon: DungeonState;
  private readonly timers: TimerQueue;
  private readonly random: CsbRandom;

  constructor(private readonly ctx: GameContext) {
    this.dungeon = ctx.dungeon;
    this.timers = ctx.timers;
    this.random = ctx.random;
    this.initializeItem16();
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
    return this.loadedLevel !== null && this.loadedLevel === (this.ctx.party.state.position.z | 0);
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
    slot.uByte4 = (this.ctx.state.tickCount - 127) & 0xff; // about 20 seconds

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
   * `ProcessTimers` (`doc/CSBwin-src/CSBCode.cpp:618-635`). `Game.loadNewPartyLevel` is
   * that call.
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
   * CSBWin's game start does the same, `TAG00bd40()` then `ProcessMonstersOnLevel()`
   * through `LoadPartyLevel(d.partyLevel)` (`doc/CSBwin-src/CSBCode.cpp:10491`, `:795`, `:818`).
   */
  reloadAfterSaveGame(): void {
    const pool = this.pool;
    this.item16QueLen = pool.reduce((n, r) => n + (r.word0 >= 0 ? 1 : 0), 0);
    this.loadedLevel = null;
    this.loadPartyLevel(this.ctx.party.state.position.z | 0);
  }

  /**
   * Re-attach everything once a save is written: `TAG00bd40()` then
   * `ProcessMonstersOnLevel()`, after the file is closed
   * (`doc/CSBwin-src/SaveGame.cpp:1237-1245`). A restore re-attaches the same way
   * (`reloadAfterSaveGame`), so the game played on after a save is the one a load of it
   * gives back: the movement timers re-created and the `singleMonsterStatus` bits
   * re-rolled, drawing from the random stream as the load does.
   */
  reattachAfterSave(): void {
    this.detachAllItem16();
    this.processMonstersOnLevel();
  }

  /** True if the party has changed level since the last `loadPartyLevel`. */
  needsLevelReload(): boolean {
    return this.loadedLevel !== (this.ctx.party.state.position.z | 0);
  }

  /**
   * Run `loadPartyLevel` if, and only if, the party's level is not the one loaded; say
   * whether it ran. A move never needs it (it sets `d.newPartyLevel`); a tool that puts
   * the party on another level by hand does.
   */
  loadPartyLevelIfChanged(): boolean {
    const level = this.ctx.party.state.position.z | 0;
    if (this.loadedLevel === level) return false;
    this.loadPartyLevel(level);
    return true;
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
        this.timers.deleteMonsterMovementTimers(mapX, mapY, level, (line) => this.trace(line));
        this.attachItem16ToMonster(rn, mapX, mapY);
        this.startMonsterMovementTimers(mapX, mapY, level);
      }
    }
  }

  /* ---------------------------------------------------------------- timers ---- */

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
      (this.ctx.state.tickCount + 1) >>> 0,
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
    if (!monster) return this.ctx.state.tickCount;
    const desc = this.getDesc(monster);
    if (!desc) return this.ctx.state.tickCount;

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
              this.ctx.sounds.queueSound(SOUND_ORDINAL_DETH_KNIGHT_FLIP, monsterX, monsterY, 1);
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
    return (this.ctx.state.tickCount + minDelay + this.random.bool()) >>> 0;
  }

  /* ------------------------------------------------------------ moving ------- */

  /**
   * `MoveObject`'s monster branch (`doc/CSBwin-src/Code11f52.cpp:2796-3424`).
   *
   * Moves a group from one square to another (`oldX < 0`: places it from nowhere;
   * `newX < 0`: lifts it off its square and returns 0 before the monster branch, as
   * `DeleteMonster` does, `:3257-3297`, `:1038`), taking the destination through
   * teleporter chains, pit falls and stairs, and keeping the `ITEM16` and the AI timers
   * in step with the result. A group that ends on the square
   * it started on is left alone and the move returns 0 — which is what `WiggleEverything`
   * relies on when it moves a group onto its own square (`Timer.cpp:2446-2450`).
   *
   * A group the fall killed, or one that ends on a level its type may not live on, is
   * deleted before anything else moves (`:3147-3176`): its remains are dropped where it
   * ended, and it is taken off its old square. A group placed from nowhere is not
   * deleted — CSBWin's `DeleteMonster` needs a square — and its record stays allocated.
   *
   * A group that does not levitate is lifted and set down through
   * `PlaceOrRemoveObjectInRoom` (`:3287`, `:3392`), so it presses and
   * releases pressure pads: leaving, `unchangedRoom` is whether the party stands on the
   * square; arriving, it is always false. A levitating one uses `RemoveObjectFromRoom`
   * / `AddObjectToRoom` (`:3274`, `:3386`) and presses nothing. The group
   * leaves its square before the destination is checked, so a group that goes into
   * abeyance has released its pad (`:3257-3296`, `:3335-3358`).
   *
   * Nothing here touches the group's other AI timers when its `ITEM16` did not
   * change: the AI caller re-aims only the timer it is processing (`Monster.cpp:1711`,
   * `:2105`, `:2440`, `:2908`), and a DSA's cell move re-aims the rest itself
   * (`MoveObject.cpp:539-571`, `DsaSystem.findCellDestination`). Nor does it touch the
   * `ITEM16`'s `uByte10`/`uByte11` — only `AttachItem16ToMonster` sets them
   * (`CSBCode.cpp:6088-6090`), and a frightened group heads back there
   * (`Monster.cpp:2273-2277`) — or its `ubPrevX`/`ubPrevY`, which the AI caller sets.
   *
   * The stairs turn the group's corner (`:3124-3130`). CSBWin keeps the corner beside the
   * record, so the turn follows the group wherever it goes, and the group is set down,
   * or parked, under the turned ID here. A caller still holding the ID it passed reaches
   * the same group through `rnEquals`. `cornerAfter` is a DSA's `object.pos(p)` after its
   * `MoveObject` (`MoveObject.cpp:538`), which overrides the turn the same way. Nothing
   * reads a group's corner in between: the pads read it only in a stone cell.
   *
   * Returns `code`, CSBWin's return value, and `position`, its `d.NewX`, `d.NewY` and
   * `d.NewLevel` (`:3174-3176`) — where the group ended up. Every caller that goes on
   * after a move does so only when `code` is 0 (`Monster.cpp:1711`, `:2105`, `:2440`,
   * `:2908`, `MoveObject.cpp:547`, `Monster.cpp:222`):
   *
   * - 0: the group is on the square it was sent to, or the one a pit dropped it on,
   *   and its `ITEM16` did not change.
   * - 1: it is gone (a missile killed it on the way out, the fall killed it, the level
   *   refused it, the square was taken and it went into abeyance); or it teleported;
   *   or it left the party's level, or arrived on it from nowhere.
   * - `LOCAL_14` > 1: `TeleportMonster`'s `groupIndex + 2` for a fear-state-6 group
   *   (`:2377-2384`), or a teleport onto the party's level (1) plus the attach
   *   (`LOCAL_14++`, `:3376`). Either way `ClearAttacking_DeleteMovementTimers` runs on
   *   `d.Item16[LOCAL_14 - 2]` (`:3411-3413`) — slot 0 in the second case, a CSBWin
   *   quirk kept as it is.
   */
  moveMonster(
    monsterRn: ObjectID,
    oldX: number,
    oldY: number,
    newX: number,
    newY: number,
    level: number,
    cornerAfter?: number,
  ): { code: number; position: Position } {
    const requested = new Position(newX, newY, level);
    const monster = this.dungeon.getCreatureRecord(monsterRn);
    if (!monster) return { code: 0, position: requested };

    const party = this.ctx.party.state.position;
    const partyLevel = party.z | 0;
    const fromDungeon = oldX >= 0;
    // "Proper level && oldX >= 0 means an ITEM16 exists"
    // (doc/CSBwin-src/Code11f52.cpp:2864).
    const item16Attached = level === partyLevel && fromDungeon;
    // `Levitating(objD7)` (`:2841`, `:2417-2437`): a flying monster.
    const desc = this.ctx.tables.monsterDesc[monster.creatureType];
    const levitated = desc !== undefined && monsterLevitating(desc);

    // A monster leaving a square may run into a missile sitting in it (`:2843-2849`).
    if (fromDungeon && level === partyLevel) {
      const hit = this.ctx.systems.missileEncounter.checkMonsterMoveFromMissile(
        new Position(oldX, oldY, level),
        newX >= 0 ? requested : null,
        monsterRn,
      );
      if (hit) return { code: 1, position: requested };
    }

    // Lifted and not set down again (`:3297`).
    if (newX < 0) {
      if (fromDungeon) this.liftMonster(monsterRn, oldX, oldY, level, levitated);
      return { code: 0, position: requested };
    }

    // Follow teleporters and fall down pits, exactly as the party does.
    const resolved = this.ctx.systems.worldMove.resolveMonsterDestination(requested, monsterRn, oldX, oldY);

    const destination = resolved.position;
    const destLevel = destination.z | 0;
    let code = resolved.code;
    const placed = withObjectPosition(monsterRn, cornerAfter ?? resolved.corner);

    // Killed by the fall, or not allowed where it landed: gone (`:3147-3176`).
    // `ProcessMonsterDeleteFilter` is not ported (DEBT.md G2), so `dropResidue` is its
    // default, `0 < 2`.
    if (resolved.groupDied || !this.dungeon.monsterAllowedOnLevel(monster.creatureType, destLevel)) {
      this.ctx.systems.monsterDamage.flushPendingDroppings(monster.creatureType, destLevel, destination.x, destination.y);
      this.ctx.systems.monsterDamage.dropMonsterRemains(
        destLevel, destination.x, destination.y, placed, 2, fromDungeon ? level : -1, true,
      );
      if (fromDungeon) this.ctx.systems.monsterDamage.deleteMonster(level, oldX, oldY);
      return { code: 1, position: destination };
    }

    // Still on the square it started on, in the same corner: nothing is lifted, pressed
    // or set down (`:3183-3213`). Only the stairs turn a monster's corner (`:3124-3130`),
    // and they always take it to another square, so the square alone decides.
    if (destLevel === level && destination.x === oldX && destination.y === oldY) {
      return { code: 0, position: destination };
    }

    if (fromDungeon) this.liftMonster(placed, oldX, oldY, level, levitated);

    // The destination is unusable if the party is standing there or another monster
    // already is. CSBWin then parks the group on a TT_60/TT_61 timer to retry.
    const blockedByParty =
      destLevel === partyLevel &&
      destination.x === (party.x | 0) &&
      destination.y === (party.y | 0);
    const occupant = this.dungeon.findFirstMonster(destination);
    if (blockedByParty || occupant !== OBJECT_ID_EOF) {
      if (fromDungeon) this.timers.deleteMonsterMovementTimers(oldX, oldY, level, (line) => this.trace(line));
      if (item16Attached) this.detachItem16(monster.groupIndex);
      this.createMovementTimer(placed, destination, resolved.audible);
      return { code: 1, position: destination };
    }

    // Crossing on or off the party's level detaches or attaches the slot (`:3364-3378`).
    if (item16Attached && destLevel !== partyLevel) {
      this.detachItem16(monster.groupIndex);
      code = 1;
    } else if (destLevel === partyLevel && !item16Attached) {
      this.attachItem16ToMonster(placed, destination.x, destination.y);
      code++;
    }

    // Set it down (`:3384-3399`): "Not current room. Room changed."
    this.dungeon.addObjectToCell(destination, placed);
    if (!levitated) this.ctx.systems.actuators.triggerObjectMove(destination, placed, true, false, this.ctx.party.state.facing);

    // A freshly attached group, or one placed from nowhere, needs its first timer.
    if (code !== 0 || !fromDungeon) {
      this.startMonsterMovementTimers(destination.x, destination.y, destLevel);
    }

    if (fromDungeon) {
      if (code > 1) {
        this.clearAttackingAndDeleteMovementTimers(code - 2, oldX, oldY, level);
      } else if (code !== 0) {
        this.timers.deleteMonsterMovementTimers(oldX, oldY, level, (line) => this.trace(line));
      }
    }

    return { code, position: destination };
  }

  /**
   * The removal half of `MoveObject` for a group (`doc/CSBwin-src/Code11f52.cpp:3257-3296`):
   * a levitating group through `RemoveObjectFromRoom`, any other through
   * `PlaceOrRemoveObjectInRoom` with `unchangedRoom` = "the party stands here".
   */
  private liftMonster(monsterRn: ObjectID, oldX: number, oldY: number, level: number, levitated: boolean): void {
    const old = new Position(oldX, oldY, level);
    this.dungeon.removeObjectFromCell(old, monsterRn);
    if (levitated) return;
    const party = this.ctx.party.state.position;
    const partyThere = level === (party.z | 0) && oldX === (party.x | 0) && oldY === (party.y | 0);
    this.ctx.systems.actuators.triggerObjectMove(old, monsterRn, false, partyThere, this.ctx.party.state.facing);
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
    this.timers.deleteMonsterMovementTimers(mapX, mapY, level, (line) => this.trace(line));
  }

  /**
   * `CreateMovementTimer` (`doc/CSBwin-src/Code11f52.cpp:2446`) — park a monster that
   * could not be placed, to retry later.
   *
   * With 31 or more timers of the same kind already waiting on that square, the object
   * is deleted instead — unless it is a monster that is `Unique()` or carries something
   * (`:2473-2512`). CSBWin's `static bool error` only guarded a message box that is
   * commented out, so nothing of it is ported.
   */
  createMovementTimer(monsterRn: ObjectID, destination: Position, audible: boolean): void {
    const tt = audible ? TimerFunction.TT_61 : TimerFunction.TT_60;
    let count = 0;
    for (const timer of this.timers.getTimers()) {
      if (timer.function !== tt) continue;
      if (timer.uByte6 !== destination.x) continue;
      if (timer.uByte7 !== destination.y) continue;
      if (timer.level !== destination.z) continue;
      count++;
    }
    if (count >= 31) {
      let delObj = true;
      if (decodeObjectID(monsterRn).category === DBType.CREATURE) {
        const monster = this.dungeon.getCreatureRecord(monsterRn);
        if (monster && (monsterUnique(monster) || monster.possession !== OBJECT_ID_EOF)) delObj = false;
      }
      if (delObj) {
        this.dungeon.deleteDBEntry(monsterRn);
        return;
      }
    }
    this.timers.createTimer(
      tt,
      destination.x,
      destination.y,
      0,
      0,
      (this.ctx.state.tickCount + 5) >>> 0,
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
    const partyLevel = this.ctx.party.state.position.z | 0;
    const party = this.ctx.party.state.position;

    let triedWander = false;
    for (;;) {
      const free =
        !(level === partyLevel && (party.x | 0) === mapX && (party.y | 0) === mapY) &&
        this.dungeon.findFirstMonster(new Position(mapX, mapY, level)) === OBJECT_ID_EOF;
      if (free) {
        if (timer.function === TimerFunction.TT_61) {
          this.ctx.sounds.queueSound(SOUND_ORDINAL_TELEPORT, mapX, mapY, 1);
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
   * Placement is left to `moveMonster`, which is what attaches the `ITEM16`. This
   * returns null whenever `MoveObject` returned non-zero (`Monster.cpp:222-231`): the
   * destination was occupied and the group went into abeyance — or the group was
   * placed on the party's level, where the attach alone makes the value 1. Only a
   * group made on another level gets the teleport sound from here.
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

    if (!this.dungeon.monsterAllowedOnLevel(monsterType, options.level)) return null;

    this.ensureItem16Available();
    if (this.isItem16PoolFull()) return null;

    const desc = this.ctx.tables.monsterDesc[monsterType];
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

    // `MoveObject` returns 1 for a group placed on the party's level, which the attach
    // makes non-zero (`Code11f52.cpp:3376`), so that is `RNnul` too, with no sound: a
    // generator queues its own when it is audible (`Timer.cpp:1797-1800`).
    const placed = this.moveMonster(rn, -1, 0, options.mapX, options.mapY, options.level);
    if (placed.code !== 0) return null;
    this.ctx.sounds.queueSound(SOUND_ORDINAL_TELEPORT, options.mapX, options.mapY, 1);
    return rn;
  }

  /** `FindEmptyDB4Entry` (`doc/CSBwin-src/CSBCode.cpp:4974`) — a free creature record. */
  private findEmptyCreatureEntry(): ObjectID | null {
    const index = this.dungeon.findEmptyDBEntry('creatures', {
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
    return index === null ? null : encodeObjectID(0, DBType.CREATURE, index);
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
    this.ctx.sounds.queueSound(SOUND_ORDINAL_TELEPORT, mapX, mapY, 1);
  }

  private getDesc(monster: CreatureRecord): MonsterDesc | null {
    return this.ctx.tables.monsterDesc[monster.creatureType] ?? null;
  }

  private trace(line: string): void {
    this.ctx.host.trace(line);
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
