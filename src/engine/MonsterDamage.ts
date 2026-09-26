/**
 * Hurting and killing monsters.
 *
 * Ports `DamageMonster` (`doc/CSBwin-src/Code11f52.cpp:1054`) and the helpers it
 * needs: `DeleteMonster` (:1026), `DropMonsterRemains` (:830),
 * `CreateAndDropObject` (:684), and the four packed-byte accessors
 * `MonsterPositionByte` / `SetMonsterPositionByte` / `MonsterFacingByte` /
 * `SetMonsterFacingByte` (:176-248).
 *
 * This sits underneath almost everything else about monsters. Four callers want it:
 * the missile system (which had a 35-line stand-in for it until now), the monster AI
 * gate `InitialChecks` (`doc/CSBwin-src/Monster.cpp:2813`), the champion melee path
 * (`doc/CSBwin-src/Attack.cpp:503`), and cloud damage (`doc/CSBwin-src/Timer.cpp:524`).
 *
 * The hard part is not the arithmetic — it is what happens when *one* member of a
 * group dies while others live. CSBWin compacts the survivors down over the dead
 * member's slot, which means the HP array, both packed 2-bit bytes, the per-member
 * status bytes **and the pending AI timers** all have to be renumbered together. Get
 * the timer renumbering wrong and a surviving monster inherits a dead one's turn.
 */
import { DBType, decodeObjectID, encodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../core/types';
import type { CsbRandom } from '../core/random';
import type { CreatureRecord } from '../data/dungeonTypes';
import { ITEM16_FREE } from '../data/dungeonTypes';
import { RN_MONSTER_DEATH } from '../core/spellRn';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import { TimerFunction, type TimerQueue } from './TimerQueue';
import { MonsterType, StateOfFear } from './monsterTypes';
import { setPackedBits } from './MonsterSystem';
import type { MonsterDesc } from '../renderer/csbwin/ObjectTables';
import {
  monsterBravery,
  monsterHorizontalSize,
  monsterInvincible,
  monsterPoisonResistance,
  monsterLeavesDroppings,
} from '../renderer/csbwin/ObjectTables';

/** `MONSTER_DAMAGE_RESULT` (`doc/CSBwin-src/CSB.h:2928`). */
export enum MonsterDamageResult {
  NO_MONSTER_DIED = 0,
  SOME_NOT_ALL_MONSTERS_DIED = 1,
  ALL_MONSTERS_DIED = 2,
}

/** HP of `0xffff` marks a member that cannot be damaged at all. */
const HP_INVULNERABLE = 0xffff;

/** `soundMONDEATH` (`doc/CSBwin-src/CSB.h:624`); ordinal 0 is the dropped-weapon clatter. */
const SOUND_ORDINAL_MONSTER_DEATH = 4;
const SOUND_ORDINAL_DROPPED_ITEM = 0;

/**
 * `MonsterDroppings` index per monster type (`doc/CSBwin-src/Code11f52.cpp:700-729`).
 *
 * A monster type absent from this table drops nothing — `CreateAndDropObject`
 * returns immediately on its `default:` branch. Each entry is a start offset into
 * `MonsterDroppings[40]`, and the list at that offset runs until a zero word.
 */
const MONSTER_DROPPINGS_INDEX: Partial<Record<MonsterType, number>> = {
  [MonsterType.mon_Skeleton]: 37,
  [MonsterType.mon_StoneGolem]: 35,
  [MonsterType.mon_AntMan]: 33,
  [MonsterType.mon_DethKnight]: 26,
  [MonsterType.mon_RockPile]: 21,
  [MonsterType.mon_Hellhound]: 18,
  [MonsterType.mon_Screamer]: 15,
  [MonsterType.mon_Worm]: 11,
  [MonsterType.mon_Dragon]: 0,
};

/** Only the Deth Knight's droppings are cursed (`doc/CSBwin-src/Code11f52.cpp:712`). */
const CURSED_DROPPINGS: ReadonlySet<number> = new Set([MonsterType.mon_DethKnight]);

/**
 * `CreateAndDropObject`'s type/index split of a `MonsterDroppings` word
 * (`doc/CSBwin-src/Code11f52.cpp:735-753`). A value below 23 is skipped entirely.
 */
const DROPPING_MISC_BASE = 127;
const DROPPING_CLOTHING_BASE = 69;
const DROPPING_WEAPON_BASE = 23;

export class MonsterDamage {
  private readonly dungeon: DungeonState;
  private readonly timers: TimerQueue;
  private readonly random: CsbRandom;

  constructor(private readonly ctx: GameContext) {
    this.dungeon = ctx.dungeon;
    this.timers = ctx.timers;
    this.random = ctx.random;
  }

  /* ------------------------------------------------- packed byte accessors ---- */

  /**
   * `MonsterPositionByte` (`doc/CSBwin-src/Code11f52.cpp:176`).
   *
   * The four packed 2-bit positions live in the `ITEM16` while the group is on the
   * party's level, and in `DB4.groupIndex` otherwise. `noItem16` forces the DB4
   * reading — callers who know the monster is not attached pass it.
   */
  monsterPositionByte(monster: CreatureRecord, level: number, noItem16: boolean): number {
    if (noItem16) return monster.groupIndex & 0xff;
    if (level === this.ctx.party.state.position.z) {
      const item16 = this.dungeon.getAttachedItem16(monster);
      if (!item16) return 0; // CSBWin asserts then returns 0
      return item16.positions & 0xff;
    }
    return monster.groupIndex & 0xff;
  }

  /** `SetMonsterPositionByte` (`doc/CSBwin-src/Code11f52.cpp:203`). */
  setMonsterPositionByte(monster: CreatureRecord, value: number, level: number, noItem16: boolean): void {
    if (level === this.ctx.party.state.position.z && !noItem16) {
      const item16 = this.dungeon.getAttachedItem16(monster);
      if (item16) item16.positions = value & 0xff;
      return;
    }
    monster.groupIndex = value & 0xff;
  }

  /**
   * `MonsterFacingByte` (`doc/CSBwin-src/Code11f52.cpp:221`).
   *
   * With no `ITEM16` the whole group faces one way, so the byte comes from the
   * 4-entry replication table rather than being packed per member.
   */
  monsterFacingByte(monster: CreatureRecord, level: number, noItem16: boolean): number {
    if (level === this.ctx.party.state.position.z && !noItem16) {
      const item16 = this.dungeon.getAttachedItem16(monster);
      if (!item16) return 0;
      return item16.facings & 0xff;
    }
    return (this.ctx.tables.byte10340[monster.facing & 0x3] ?? 0) & 0xff;
  }

  /** `SetMonsterFacingByte` (`doc/CSBwin-src/Code11f52.cpp:237`). */
  setMonsterFacingByte(monster: CreatureRecord, value: number, level: number, noItem16: boolean): void {
    if (level === this.ctx.party.state.position.z && !noItem16) {
      const item16 = this.dungeon.getAttachedItem16(monster);
      if (item16) item16.facings = value & 0xff;
      return;
    }
    monster.facing = value & 0x3;
  }

  /* ------------------------------------------------------------- droppings ---- */

  /**
   * `CreateAndDropObject` (`doc/CSBwin-src/Code11f52.cpp:684`) — the worm rounds,
   * bones and armour a dying monster leaves behind.
   *
   * Walks that type's `MonsterDroppings` list until a zero word. A word with bit 15
   * set is dropped only on a coin toss. The remaining 15 bits select a database by
   * range — ≥127 misc, ≥69 clothing, ≥23 weapon, below that skipped — and the
   * base is subtracted to give the type within it.
   *
   * Each item lands at `position`, except that a `position` of 255 (a centred
   * monster) or a 1-in-4 roll scatters it to a random corner instead.
   */
  createAndDropObject(
    monsterType: number,
    level: number,
    mapX: number,
    mapY: number,
    position: number,
    soundDelay: number,
  ): void {
    const start = MONSTER_DROPPINGS_INDEX[monsterType as MonsterType];
    if (start === undefined) return; // CSBWin's `default: return`
    const table = this.ctx.tables.monsterDroppings;

    const cursed = CURSED_DROPPINGS.has(monsterType);
    let droppedWeapon = false;

    for (let i = start; i < table.length; i++) {
      const word = table[i] ?? 0;
      if (word === 0) break;
      if ((word & 0x8000) !== 0 && this.random.bool() !== 0) continue;

      const value = word & 0x7fff;
      let category: DBType;
      let type: number;
      if (value >= DROPPING_MISC_BASE) {
        category = DBType.MISC;
        type = value - DROPPING_MISC_BASE;
      } else if (value >= DROPPING_CLOTHING_BASE) {
        category = DBType.CLOTHING;
        type = value - DROPPING_CLOTHING_BASE;
      } else if (value >= DROPPING_WEAPON_BASE) {
        droppedWeapon = true;
        category = DBType.WEAPON;
        type = value - DROPPING_WEAPON_BASE;
      } else {
        continue;
      }

      const rn = this.createDroppedRecord(category, type, cursed);
      if (rn === null) continue;

      const posInCell =
        position === 255 || this.random.zeroTo3() === 0 ? this.random.zeroTo3() : position & 0x3;
      const placed = this.dungeon.addObjectToCell(
        new Position(mapX, mapY, level),
        encodeObjectID(posInCell, category, decodeObjectID(rn).index),
      );
      if (!placed) this.dungeon.deleteDBEntry(rn);
    }

    this.ctx.sounds.queueSound(
      droppedWeapon ? SOUND_ORDINAL_DROPPED_ITEM : SOUND_ORDINAL_MONSTER_DEATH,
      mapX,
      mapY,
      soundDelay,
    );
  }

  /**
   * Allocate a weapon, clothing or misc record for a dropping — `FindEmptyDB5Entry`,
   * `FindEmptyDB6Entry`, `FindEmptyDB10Entry` (`doc/CSBwin-src/CSBCode.cpp:4990-5054`).
   */
  private createDroppedRecord(category: DBType, type: number, cursed: boolean): ObjectID | null {
    switch (category) {
      case DBType.WEAPON: {
        const index = this.dungeon.findEmptyDBEntry('weapons', {
          nextObject: OBJECT_ID_EOF,
          broken: false,
          charges: 0,
          litTorch: false,
          poisoned: false,
          cursed,
          important: false,
          weaponType: type & 0x7f,
        });
        return index === null ? null : encodeObjectID(0, DBType.WEAPON, index);
      }
      case DBType.CLOTHING: {
        const index = this.dungeon.findEmptyDBEntry('clothing', {
          nextObject: OBJECT_ID_EOF,
          broken: false,
          charges: 0,
          cursed,
          important: false,
          clothingType: type & 0x7f,
        });
        return index === null ? null : encodeObjectID(0, DBType.CLOTHING, index);
      }
      case DBType.MISC: {
        const index = this.dungeon.findEmptyDBEntry('misc', {
          nextObject: OBJECT_ID_EOF,
          specialState: 0,
          important: false,
          miscType: type & 0x7f,
        });
        return index === null ? null : encodeObjectID(0, DBType.MISC, index);
      }
      default:
        return null;
    }
  }

  /**
   * `DropMonsterRemains` (`doc/CSBwin-src/Code11f52.cpp:830`) — droppings for every
   * member of the group, then everything the group was carrying.
   *
   * `monsterAttachedToLevel` exists because of a bug CSBWin fixed: when a monster is
   * teleported to a level its type is not allowed on, it dies there, and
   * `d.LoadedLevel` is then the *destination* — so reading the position byte with the
   * loaded level would consult an `ITEM16` that belongs to a different level.
   * Callers who know better pass the source level; -1 means "not attached".
   *
   * `bodyPartSoundDelay < 0` suppresses the droppings and the sound but still drops
   * the possessions.
   */
  dropMonsterRemains(
    level: number,
    mapX: number,
    mapY: number,
    monsterRn: ObjectID,
    bodyPartSoundDelay: number,
    monsterAttachedToLevel: number,
    dropResidue: boolean,
  ): void {
    const monster = this.dungeon.getCreatureRecord(monsterRn);
    if (!monster) return;
    const desc = this.getDesc(monster);

    if (bodyPartSoundDelay >= 0 && dropResidue && desc && monsterLeavesDroppings(desc)) {
      const positions = this.monsterPositionByte(
        monster,
        monsterAttachedToLevel !== -1 ? monsterAttachedToLevel : -1,
        false,
      );
      for (let i = monster.numMonM1 & 0x3; i >= 0; i--) {
        this.createAndDropObject(
          monster.creatureType,
          level,
          mapX,
          mapY,
          positions === 255 ? 255 : (positions >> (2 * i)) & 0x3,
          bodyPartSoundDelay,
        );
      }
    }

    // Everything the group carried falls to the floor, each at a random corner.
    let carried = monster.possession;
    if (carried === OBJECT_ID_EOF || carried === OBJECT_ID_NULL) return;
    let droppedWeapon = false;
    const target = new Position(mapX, mapY, level);
    while (carried !== OBJECT_ID_EOF && carried !== OBJECT_ID_NULL) {
      const next = this.dungeon.getDBRecordLink(carried);
      const { category, index } = decodeObjectID(carried);
      if (category === DBType.WEAPON) droppedWeapon = true;
      const placed = encodeObjectID(this.random.zeroTo3(), category, index);
      this.dungeon.addObjectToCell(target, placed);
      carried = next;
    }
    monster.possession = OBJECT_ID_EOF;

    if (bodyPartSoundDelay >= 0) {
      this.ctx.sounds.queueSound(
        droppedWeapon ? SOUND_ORDINAL_DROPPED_ITEM : SOUND_ORDINAL_MONSTER_DEATH,
        mapX,
        mapY,
        bodyPartSoundDelay,
      );
    }
  }

  /**
   * `DeleteMonster` (`doc/CSBwin-src/Code11f52.cpp:1026`) — remove the whole group
   * from the dungeon and give its `ITEM16` slot back.
   *
   * The HP array is cleared *before* the group is lifted with `MoveObject(obj, x, y,
   * -1, 0)` (`:1037-1038`) — so `CheckMoveFromMissile` finds no hit points and returns
   * at once (`:2593-2596`) — and the lift releases the square's pads. Without the hook
   * (a standalone `MonsterDamage`) the group is only unlinked.
   */
  deleteMonster(level: number, mapX: number, mapY: number): void {
    const position = new Position(mapX, mapY, level);
    const rn = this.dungeon.findFirstMonster(position);
    if (rn === OBJECT_ID_EOF) return;
    const monster = this.dungeon.getCreatureRecord(rn);
    if (!monster) return;

    this.trace(`Deleting monster ${rn.toString(16)} ${level}(${mapX},${mapY})`);
    monster.hp = [0, 0, 0, 0];
    this.ctx.systems.monsters.moveMonster(rn, mapX, mapY, -1, 0, level);
    const groupIndex = monster.groupIndex;
    this.dungeon.deleteDBEntry(rn);

    if (this.ctx.party.state.position.z === level) {
      const slot = this.dungeon.getItem16Record(groupIndex);
      if (slot) {
        slot.word0 = ITEM16_FREE;
        this.ctx.systems.monsters.noteItem16Freed();
      }
    }
    this.timers.deleteMonsterMovementTimers(mapX, mapY, level, (line) => this.trace(line));
  }

  /* ---------------------------------------------------------------- damage ---- */

  /**
   * `DamageMonster` (`doc/CSBwin-src/Code11f52.cpp:1054`).
   *
   * `apply` is CSBWin's `P6`: when zero the group is *not* actually removed and
   * droppings are queued for later instead — that is how a monster killed while
   * being moved gets its remains placed at the destination.
   *
   * `noItem16` says the group has no `ITEM16` attached, which changes where the
   * packed position and facing bytes live.
   */
  /**
   * `DamageMonsterGroup` (`doc/CSBwin-src/Code11f52.cpp:1317`) — one blow that lands on
   * every member of a group, as a cloud or an explosion does.
   *
   * The damage is not shared out evenly: an eighth-plus-one is taken off the top and
   * given back to each member as `STRandom(2 * that)`, so one Screamer can be gutted
   * while the one beside it is scratched. Members are walked from the last down to the
   * first, which is the order `DamageMonster`'s compaction needs.
   */
  damageMonsterGroup(
    monster: CreatureRecord,
    level: number,
    mapX: number,
    mapY: number,
    damage: number,
    apply: boolean,
    noItem16: boolean,
  ): MonsterDamageResult {
    // `d.Word13046 = 0` (`doc/CSBwin-src/Code11f52.cpp:1333`): whatever an earlier call
    // left for `TAG00b522` is forgotten.
    this.pendingDroppings.length = 0;
    if (damage <= 0) return MonsterDamageResult.NO_MONSTER_DIED;

    let allDied = true;
    let anyDied = false;
    const spread = ((damage >> 3) + 1) | 0;
    const base = damage - spread;

    for (let index = monster.numMonM1 & 3; index >= 0; index--) {
      const dealt = base + this.random.below(2 * spread);
      const result = this.damageMonster(monster, index, level, mapX, mapY, dealt, apply, noItem16);
      const died = result !== MonsterDamageResult.NO_MONSTER_DIED;
      allDied = allDied && died;
      anyDied = anyDied || died;
    }

    if (allDied) return MonsterDamageResult.ALL_MONSTERS_DIED;
    if (anyDied) return MonsterDamageResult.SOME_NOT_ALL_MONSTERS_DIED;
    return MonsterDamageResult.NO_MONSTER_DIED;
  }

  /**
   * `DeterminePoisonDamage` (`doc/CSBwin-src/Code11f52.cpp:1358`).
   *
   * Poison resistance 15 means total immunity; otherwise the damage is *multiplied* by
   * eight and divided by resistance-plus-one, so a poison cloud is devastating against
   * something with no resistance and nearly harmless against something with a lot.
   */
  determinePoisonDamage(monsterType: number, damage: number): number {
    if (damage === 0) return 0;
    const desc = this.ctx.tables.monsterDesc[monsterType];
    if (!desc) return 0;
    const resistance = monsterPoisonResistance(desc);
    if (resistance === 15) return 0;
    return Math.trunc((8 * (damage + this.random.zeroTo3())) / (resistance + 1));
  }

  damageMonster(
    monster: CreatureRecord,
    indexInGroup: number,
    level: number,
    attackX: number,
    attackY: number,
    damage: number,
    apply: boolean,
    noItem16: boolean,
  ): MonsterDamageResult {
    const desc = this.getDesc(monster);
    if (!desc) return MonsterDamageResult.NO_MONSTER_DIED;
    if (monsterInvincible(desc)) return MonsterDamageResult.NO_MONSTER_DIED;

    const hp = monster.hp[indexInGroup] ?? 0;
    if (hp === HP_INVULNERABLE) return MonsterDamageResult.NO_MONSTER_DIED;

    if (hp > damage) {
      // Survived. CSBWin only writes back for positive damage, so a zero-damage
      // call is a pure liveness probe — which is exactly how `InitialChecks` uses it.
      if (damage > 0) monster.hp[indexInGroup] = (hp - damage) & 0xffff;
      return MonsterDamageResult.NO_MONSTER_DIED;
    }

    // This member has died.
    const positions = this.monsterPositionByte(monster, level, noItem16);
    const deadPosition = positions === 255 ? 255 : (positions >> (2 * indexInGroup)) & 0x3;
    const numMonM1 = monster.numMonM1 & 0x3;

    // `ProcessMonsterDeleteFilter` (`Code11f52.cpp:926`) is not ported (DEBT.md G2): no DSA

    // may suppress the death cloud (`deathCloud == 2`) or the remains (`dropResidue == 2`),

    // so both are their defaults.

    const showDeathCloud = true;

    const dropResidue = true;

    let result: MonsterDamageResult;

    if (numMonM1 === 0) {
      // The last member of the group.
      if (apply) {
        const rn = this.dungeon.findFirstMonster(new Position(attackX, attackY, level));
        if (rn !== OBJECT_ID_EOF) {
          this.dropMonsterRemains(level, attackX, attackY, rn, 2, level, dropResidue);
        }
        this.deleteMonster(level, attackX, attackY);
      }
      result = MonsterDamageResult.ALL_MONSTERS_DIED;
    } else {
      result = this.killOneOfGroup(
        monster,
        desc,
        indexInGroup,
        level,
        attackX,
        attackY,
        numMonM1,
        deadPosition,
        apply,
        noItem16,
        dropResidue,
      );
    }

    if (showDeathCloud) {
      // Cloud size follows the monster's footprint: one corner, two, or the cell.
      const size = [110, 190, 255][monsterHorizontalSize(desc)] ?? 255;
      if (monster.drawAsSize4) {
        if (numMonM1 === 0) {
          this.ctx.systems.missileEncounter.createDeathCloud(RN_MONSTER_DEATH, 255, new Position(attackX, attackY, level), 255);
        }
      } else {
        this.ctx.systems.missileEncounter.createDeathCloud(RN_MONSTER_DEATH, size, new Position(attackX, attackY, level), deadPosition);
      }
    }

    return result;
  }

  /**
   * One member of a multi-monster group died; compact the survivors down over it.
   *
   * Five parallel things are renumbered together — the HP array, the packed position
   * byte, the packed facing byte, the per-member `singleMonsterStatus` bytes, and the
   * queued AI timers — and `numMonM1` then drops by one
   * (`doc/CSBwin-src/Code11f52.cpp:1121-1240`).
   */
  private killOneOfGroup(
    monster: CreatureRecord,
    desc: MonsterDesc,
    indexInGroup: number,
    level: number,
    attackX: number,
    attackY: number,
    numMonM1: number,
    deadPosition: number,
    apply: boolean,
    noItem16: boolean,
    dropResidue: boolean,
  ): MonsterDamageResult {
    let facings = this.monsterFacingByte(monster, level, noItem16);
    let positions = this.monsterPositionByte(monster, level, noItem16);

    if (monsterLeavesDroppings(desc) && !monster.drawAsSize4) {
      if (apply) {
        if (dropResidue) {
          this.createAndDropObject(monster.creatureType, level, attackX, attackY, deadPosition, 2);
        }
      } else {
        // Deferred: CSBWin stashes the position in `d.Byte13050[d.Word13046++]` and
        // `TAG00b522` drops it once the monster has finished moving.
        this.pendingDroppings.push(deadPosition);
      }
    }

    const onPartyLevel = level === this.ctx.party.state.position.z;
    const item16 = onPartyLevel ? this.dungeon.getAttachedItem16(monster) : null;

    if (monster.fear === StateOfFear.StateOfFear6) {
      this.renumberIndividualTimers(indexInGroup, level, attackX, attackY);
      if (onPartyLevel && item16) {
        // A survivor may take fright. Bravery 15 never does; otherwise the check is
        // against a rising bar as the group thins out.
        const bravery = monsterBravery(desc);
        if (bravery !== 15) {
          const adjusted = bravery + numMonM1 - 1;
          if (adjusted < this.random.below(16)) {
            item16.uByte5 = (this.random.below(100 - 4 * adjusted) + 20) & 0xff;
            monster.fear = StateOfFear.StateOfFear5;
          }
        }
      }
    }

    // Shift every survivor above the dead member down one slot.
    for (let i = indexInGroup; i < numMonM1; i++) {
      const from = i + 1;
      monster.hp[i] = monster.hp[from] ?? 0;
      facings = setPackedBits(facings, i, (facings >> (2 * from)) & 0x3);
      positions = setPackedBits(positions, i, (positions >> (2 * from)) & 0x3);
      if (item16) item16.singleMonsterStatus[i] = item16.singleMonsterStatus[from] ?? 0;
    }

    // CSBWin masks the position byte to 6 bits here, dropping the vacated top field.
    this.setMonsterPositionByte(monster, positions & 0x3f, level, noItem16);
    this.setMonsterFacingByte(monster, facings, level, noItem16);
    monster.numMonM1 = (numMonM1 - 1) & 0x3;

    return MonsterDamageResult.SOME_NOT_ALL_MONSTERS_DIED;
  }

  /**
   * Renumber the per-member AI timers after member `indexInGroup` died.
   *
   * The dead member's own timer is deleted; every timer belonging to a *higher*
   * member index slides down by one, in both the A and B families, and its queue
   * priority is re-evaluated because the function code is part of the sort key
   * (`doc/CSBwin-src/Code11f52.cpp:1152-1196`).
   */
  private renumberIndividualTimers(indexInGroup: number, level: number, mapX: number, mapY: number): void {
    const doomed: number[] = [];
    const renumbered: { index: number; fn: number }[] = [];

    for (const timer of this.timers.getTimers()) {
      if (timer.level !== (level & 0xff)) continue;
      if (timer.uByte6 !== (mapX & 0xff)) continue;
      if (timer.uByte7 !== (mapY & 0xff)) continue;
      const fn = timer.function;
      if (fn < TimerFunction.TT_MONSTER_A0 || fn > TimerFunction.TT_MONSTER_B3) continue;

      const memberIndex =
        fn <= TimerFunction.TT_MONSTER_A3
          ? fn - TimerFunction.TT_MONSTER_A0
          : fn - TimerFunction.TT_MONSTER_B0;

      if (memberIndex === indexInGroup) {
        doomed.push(timer.index);
      } else if (memberIndex > indexInGroup) {
        renumbered.push({ index: timer.index, fn: fn - 1 });
      }
    }

    for (const index of doomed) this.timers.deleteTimer(index);
    for (const { index, fn } of renumbered) {
      const timer = this.timers.getTimer(index);
      if (!timer) continue;
      timer.function = fn;
      this.timers.reprioritizeTimer(index);
    }
  }

  /**
   * `d.Byte13050` / `d.Word13046` — droppings owed by a monster that died while being
   * moved, flushed by `TAG00b522` (`doc/CSBwin-src/Code11f52.cpp:802-822`) once the
   * move completes.
   */
  private pendingDroppings: number[] = [];

  /** `TAG00b522` — drop what `damageMonster(apply=false)` deferred. */
  flushPendingDroppings(monsterType: number, level: number, newX: number, newY: number): void {
    while (this.pendingDroppings.length > 0) {
      const position = this.pendingDroppings.pop()!;
      this.createAndDropObject(monsterType, level, newX, newY, position, 2);
    }
  }

  private getDesc(monster: CreatureRecord): MonsterDesc | null {
    return this.ctx.tables.monsterDesc[monster.creatureType] ?? null;
  }

  private trace(line: string): void {
    this.ctx.host.trace(line);
  }
}
