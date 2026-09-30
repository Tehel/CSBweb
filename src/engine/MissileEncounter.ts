/**
 * `MissileEncounter` — a missile meeting something: `ProcessMissileEncounter`
 * (`doc/CSBwin-src/Code11f52.cpp:1711`) with `MissileEncounterFilter` (`:1626`), and its
 * other entry point, `CheckMoveFromMissile` (`:2530`), for a party or a monster that walks
 * into a missile. With them is what an encounter sets off, which `Code11f52.cpp` keeps
 * beside them: `CreateCloud` (`:1376`), `CreateFluxcage` (`:1515`), `HitDoor` (`:2263`) and
 * `DetermineMagicDamage` (`:1557`).
 *
 * The flight is `TimerSystem`'s, as `Timer.cpp` is: `MissileTimer` calls the encounter,
 * and the encounter spends a missile through `ProcessObjectFromMissile` (`Timer.cpp:129`).
 * The port's copy of `d.Time` stays there too, reached through `ctx.systems.timer`, and
 * `missileFilterObject` / `missileFilterTimer` (`Timer.cpp:176-177`) are the timer queue's,
 * whose `getTimer` answers the copy as `GameTimers::pTimer` does. `d.MonsterDamageResult`
 * (`Data.h:851`) is here, where three of its four writers are; the fourth,
 * `CheckMonsterVersusMissiles`, is `MonsterAI`'s.
 */
import { decodeObjectID, encodeObjectID, DBType, Direction, OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../core/types';
import { PotionType } from '../core/constants';
import type { CsbRandom } from '../core/random';
import { sw } from '../core/intCast';
import {
  RN_DISPELL_MISSILE, RN_FIREBALL, RN_LIGHTNING, RN_MONSTER_DEATH, RN_POISON,
  RN_POISON_BOLT, RN_POISON_CLOUD, RN_ZO_SPELL, RN_FFE4,
  isMagicSpellRn, isNonPhysicalSpellRn,
} from '../core/spellRn';
import type { MissileRecord } from '../data/dungeonTypes';
import { ActuatorAction } from '../data/actuatorHelpers';
import { monsterAbsorbsDaggersEtc, monsterFireResistance, monsterNonMaterial } from '../data/tables/MonsterDesc';
import { characterAtPosition } from './AddCharacter';
import { CloudType } from './cloudTypes';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import { MonsterDamageResult } from './MonsterDamage';
import { MonsterType } from './monsterTypes';
import { ordinalOfMonsterAtPosition } from './monsterPosition';
import { DescIndex, IsAKey } from './objectIndex';
import { TimerFunction, type TimerQueue } from './TimerQueue';
import { setDoorState, type MissileDropTarget } from './TimerSystem';

const WEAPON_DAGGER = 8;
const WEAPON_ARROW = 27;
const WEAPON_SLAYER = 28;
const WEAPON_POISON_DART = 31;
const WEAPON_THROWING_STAR = 32;

/**
 * The wound mask a missile carries, a literal at `DamageCharacter(objectPos, D5W, 12,
 * …)` (`doc/CSBwin-src/Code11f52.cpp:2046`). Bits 2 and 3 are the torso and the legs.
 *
 * (The champion *wound sound*, ordinal `chIdx + 9`, belongs to the monster's melee
 * attack — `doc/CSBwin-src/Monster.cpp:4584`, ported in `MonsterAttack`. A missile
 * strike queues no sound of its own.)
 */
const MISSILE_WOUND_MASK = 12;

export class MissileEncounter {
  private readonly dungeon: DungeonState;
  private readonly timers: TimerQueue;
  private readonly random: CsbRandom;

  constructor(private readonly ctx: GameContext) {
    this.dungeon = ctx.dungeon;
    this.timers = ctx.timers;
    this.random = ctx.random;
  }

  /**
   * `d.MonsterDamageResult` — the result of the most recent `DamageMonster` call.
   *
   * CSBWin keeps this in globals because `CheckMoveFromMissile` needs to know whether
   * the encounter it just resolved wiped out the whole group, and the call chain
   * between them does not carry a return value
   * (`doc/CSBwin-src/Code11f52.cpp:2742`).
   */
  monsterDamageResult: MonsterDamageResult = MonsterDamageResult.NO_MONSTER_DIED;

  /**
   * Whether the last `DamageMonster` wiped out the whole group.
   *
   * A method rather than an inline comparison because the field changes inside
   * `processMissileEncounter`, which `tsc`'s narrowing does not see through: after the
   * reset beside a call, it would narrow the field to `NO_MONSTER_DIED` and reject the
   * comparison.
   */
  groupWasWipedOut(): boolean {
    return (this.monsterDamageResult as number) === MonsterDamageResult.ALL_MONSTERS_DIED;
  }

  private checkMoveFromMissile(oldPos: Position, newPos: Position | null, movedObject: ObjectID | null): void {
    const party = this.ctx.party.state;
    const movedObjectType = movedObject === null ? -2 : -1;
    const whoLeavesCell = [0, 0, 0, 0];
    const whoLeavesNewCell = [0, 0, 0, 0];

    if (movedObject === null) {
      for (const champion of party.champions) {
        // `CharacterAtPosition`, which skips a champion whose `HP()` is 0
        // (`doc/CSBwin-src/Code11f52.cpp:2566`, `:4064`).
        if ((champion.attributes.health | 0) === 0) continue;
        const pos = champion.partyPosition & 0x3;
        whoLeavesCell[pos] = (pos + 1) & 0xff;
      }
    } else {
      const decoded = decodeObjectID(movedObject);
      if (decoded.category !== DBType.CREATURE) return;
      if (oldPos.z !== party.position.z) return;
      const monster = this.dungeon.getCreatureRecord(movedObject);
      if (!monster) return;
      const hasHp = (monster.hp ?? []).some((hp) => (hp ?? 0) > 0);
      if (!hasHp) return;
      for (let pos = 0; pos < 4; pos++) {
        if (ordinalOfMonsterAtPosition(this.dungeon, this.ctx.tables.monsterDesc, monster, pos) !== 0) {
          whoLeavesCell[pos] = (pos + 1) & 0xff;
        }
      }
    }

    let numCellsToTry = 1;
    const sameLevelNewPos = newPos && newPos.z === oldPos.z ? newPos : null;
    if (sameLevelNewPos) {
      const distanceTraveled = Math.abs(oldPos.x - sameLevelNewPos.x) + Math.abs(oldPos.y - sameLevelNewPos.y);
      if (distanceTraveled === 1) {
        const headPosLeft = this.primaryDirectionFromMove(oldPos, sameLevelNewPos);
        const headPosRight = (headPosLeft + 1) & 0x3;
        const tailPosLeft = (headPosLeft + 3) & 0x3;
        const tailPosRight = (headPosLeft + 2) & 0x3;

        if (whoLeavesCell[headPosLeft]) {
          whoLeavesNewCell[tailPosLeft] = whoLeavesCell[headPosLeft];
          numCellsToTry = 2;
        } else {
          whoLeavesCell[headPosLeft] = whoLeavesCell[tailPosLeft];
        }

        if (whoLeavesCell[headPosRight]) {
          whoLeavesNewCell[tailPosRight] = whoLeavesCell[headPosRight];
          numCellsToTry = 2;
        } else {
          whoLeavesCell[headPosRight] = whoLeavesCell[tailPosRight];
        }
      }
    }

    let missileX = oldPos.x;
    let missileY = oldPos.y;
    const level = oldPos.z;

    for (let cellIdx = 0; cellIdx < numCellsToTry; cellIdx++) {
      let timerDeleted = true;
      while (timerDeleted) {
        timerDeleted = false;
        const missiles = this.findMissilesAt(new Position(missileX, missileY, level));
        for (const missileRn of missiles) {
          const missile = this.dungeon.getMissileRecord(missileRn);
          if (!missile) continue;
          const timer = this.timers.getTimer(missile.timerIndex);
          if (!timer) continue;
          if (timer.function === TimerFunction.TT_MISSILE0) continue;
          const missilePos = decodeObjectID(missileRn).position & 0x3;
          const leaving = whoLeavesCell[missilePos];
          if (leaving === 0) continue;

          const hit = this.processMissileEncounter(
            movedObjectType,
            oldPos.x,
            oldPos.y,
            missileX,
            missileY,
            level,
            (leaving - 1) & 0xff,
            missileRn,
          );

          if (hit) {
            this.timers.deleteTimer(missile.timerIndex);
            if (this.groupWasWipedOut()) {
              // The whole group died to the missile, so the thing being moved no
              // longer exists (doc/CSBwin-src/Code11f52.cpp:2740-2746).
              this.movedObjectWasDestroyed = true;
              return;
            }
            timerDeleted = true;
            break;
          }
        }
      }

      if (numCellsToTry > 1 && cellIdx === 0 && sameLevelNewPos) {
        missileX = sameLevelNewPos.x;
        missileY = sameLevelNewPos.y;
        for (let i = 0; i < 4; i++) whoLeavesCell[i] = whoLeavesNewCell[i];
      }
    }
  }

  /**
   * Set by `checkMoveFromMissile` when the encounter destroyed the group that was
   * being moved — CSBWin's `return 1` from `CheckMoveFromMissile`.
   */
  private movedObjectWasDestroyed = false;

  /**
   * `CheckMoveFromMissile` for the party leaving a square. Its `return 1` reads the
   * global `d.MonsterDamageResult` for the party too (`Code11f52.cpp:2743`), so it
   * answers true when a missile the party met wiped out a group on the way.
   */
  checkPartyMoveFromMissile(from: Position, to: Position | null): boolean {
    this.movedObjectWasDestroyed = false;
    this.checkMoveFromMissile(from, to, null);
    return this.movedObjectWasDestroyed;
  }

  /** `CheckMoveFromMissile` for a monster leaving a square. */
  checkMonsterMoveFromMissile(from: Position, to: Position | null, monsterRn: ObjectID): boolean {
    this.movedObjectWasDestroyed = false;
    this.monsterDamageResult = MonsterDamageResult.NO_MONSTER_DIED;
    this.checkMoveFromMissile(from, to, monsterRn);
    return this.movedObjectWasDestroyed;
  }

  /**
   * `ProcessMissileEncounter` (`doc/CSBwin-src/Code11f52.cpp:1711`). CSBWin works on
   * `d.LoadedLevel` (`missileLocr.l = d.LoadedLevel`, `:1765`, and every map lookup after
   * it), which this takes as `level`: the missile timer's level, the level of the move
   * `checkMoveFromMissile` checks, or the level of the monster whose turn it is.
   */
  processMissileEncounter(
    cellType: number,
    objX: number,
    objY: number,
    missileX: number,
    missileY: number,
    level: number,
    objectPos: number,
    missileRn: ObjectID,
  ): boolean {
    const missile = this.dungeon.getMissileRecord(missileRn);
    if (!missile) return false;
    const position = new Position(missileX, missileY, level);
    const filterProjectile = (missile.projectileObject & 0xffff) as ObjectID;
    // `d.MonsterDamageResult = NO_MONSTER_DIED;` (`doc/CSBwin-src/Code11f52.cpp:1770`).
    this.monsterDamageResult = MonsterDamageResult.NO_MONSTER_DIED;
    // `RNprojectile` stays the potion all through the switch below: a Ven or Ful potion
    // becomes its cloud (`obj_26`) only in the shared tail (`:2060-2063`), so the blow it
    // lands first — on a champion, a monster or a door — is a thrown object's.
    const projectile = (missile.projectileObject & 0xffff) as ObjectID;
    const projectileDbType = isMagicSpellRn(projectile)
      ? DBType.CLOUD
      : decodeObjectID(projectile).category;

    let convertedPotion = false;
    let convertedPower = 0;
    let convertedProjectile = projectile;

    if (projectileDbType === DBType.POTION) {
      const potion = this.dungeon.getPotionRecord(projectile);
      if (potion) {
        if ((potion.potionType | 0) === PotionType.VEN_POTION) {
          convertedProjectile = RN_POISON_CLOUD;
          convertedPower = potion.power & 0xff;
          convertedPotion = true;
        } else if ((potion.potionType | 0) === PotionType.FUL_BOMB) {
          convertedProjectile = RN_FIREBALL;
          convertedPower = potion.power & 0xff;
          convertedPotion = true;
        }
      }
    }

    const tailProjectile = convertedPotion ? (convertedProjectile & 0xffff) as ObjectID : projectile;

    const nonPoisonSpell =
      projectileDbType === DBType.CLOUD &&
      projectile !== RN_POISON &&
      projectile !== RN_POISON_BOLT;

    let absorbedMonster: ObjectID | null = null;
    switch (cellType) {
      case RoomType.FALSEWALL:
        if (this.missileEncounterFilter(3, position, objectPos, missileRn, filterProjectile, -1) === 1) {
          return false;
        }
        break;
      case RoomType.STONE:
        if (this.missileEncounterFilter(4, position, objectPos, missileRn, filterProjectile, -1) === 1) {
          return false;
        }
        break;
      case RoomType.EXTERIOR:
        this.missileEncounterFilter(6, position, objectPos, missileRn, filterProjectile, -1);
        break;
      case RoomType.DOOR: {
        // `doc/CSBwin-src/Code11f52.cpp:1844-1935`.
        const map = this.dungeon.getMap(position.z);
        if (!map) return false;
        const cellFlag = map.cellFlags[objX]?.[objY] ?? 0;
        const doorState = cellFlag & 0x7;
        const doorRn = this.dungeon.findFirstDoor(new Position(objX, objY, position.z));
        const door = doorRn !== OBJECT_ID_EOF ? this.dungeon.getDoorRecordByIndex(decodeObjectID(doorRn).index) : null;
        if (!door) return false;

        // A Zo spell at a door that is not broken works its button, if it has one, and
        // is spent either way.
        if (doorState !== 5 && projectile === RN_ZO_SPELL) {
          if (door.hasButton) {
            this.timers.createTimer(TimerFunction.TT_DOOR, objX, objY, 0, ActuatorAction.TOGGLE, (this.ctx.state.tickCount + 1) >>> 0, position.z);
          }
          break;
        }
        if (doorState === 5 || doorState <= 1) return false;
        // `D0B = BITS8_15(d.DoorTOC[doorType]); if (D0W & 2)` — bit 1 of the high byte
        // marks a door missiles can pass: a non-physical spell always does, a thrown
        // object if it still has range to beat `STRandom(128)`, fits in a pouch and is
        // not a key.
        const tocHigh = (this.dungeon.doorTOC(position.z, door.doorType, this.ctx.tables.doorCharacteristics) >> 8) & 0xff;
        if (tocHigh & 2) {
          let passes: boolean;
          if (projectileDbType === DBType.CLOUD) {
            passes = isNonPhysicalSpellRn(projectile);
          } else {
            const w72 = this.random.below(128);
            passes =
              (missile.rangeRemaining & 0xff) > w72 &&
              (this.objDescWord4(projectile) & 0x100) !== 0 &&
              !IsAKey(this.dungeon, this.ctx.tables, this.ctx.party.state.facing, projectile);
          }
          if (passes) return false;
        }
        const force = sw(this.determineMagicDamage(missile, projectile).damage + 1);
        if (this.missileEncounterFilter(2, position, objectPos, missileRn, filterProjectile, -1) === 1) {
          return false;
        }
        this.hitDoor(new Position(objX, objY, position.z), force + this.random.below(force), false, 0);
        break;
      }
      case -2: {
        // `objectPos = CharacterAtPosition(objectPos); if (objectPos < 0) return 0;`
        // (`doc/CSBwin-src/Code11f52.cpp:1948-1952`). The corner the missile arrived at
        // names the champion, and an empty one — or one holding only a corpse, since
        // `CharacterAtPosition` skips the dead — lets the missile fly on. From here on
        // `objectPos` *is* a champion index, including in the filter call below.
        const chIdx = characterAtPosition(this.ctx.party.state.champions, objectPos & 0x3);
        if (chIdx < 0) return false;
        if (this.missileEncounterFilter(7, position, objectPos, missileRn, filterProjectile, chIdx) === 1) {
          return false;
        }
        // `D5W = DetermineMagicDamage(pDBmissile, RNprojectile); D4W = D5W;` — the
        // party is the only arm that sets `D4W`, which is what makes the shared tail
        // at `:2044` a party-only `DamageCharacter`.
        const magic = this.determineMagicDamage(missile, projectile);
        if (magic.damage !== 0) {
          this.applyMissileDamageToParty({
            chIdx,
            damage: magic.damage,
            kind: magic.kind,
            poisonStrength: magic.poisonStrength,
          });
        }
        // The missile is spent either way: a dispel missile does a champion no damage
        // at all (`DetermineMagicDamage` returns 0 for it) and still lands.
        return this.finishMissileEncounter(missileRn, absorbedMonster, position, objectPos, tailProjectile, convertedPotion, convertedPower, nonPoisonSpell, objX, objY);
      }
      case -1: {
        // The monster arm (`doc/CSBwin-src/Code11f52.cpp:1960-2042`).
        const monsterRn = this.dungeon.findFirstMonster(position);
        if (monsterRn === OBJECT_ID_EOF) return false;
        const monster = this.dungeon.getCreatureRecord(monsterRn);
        if (!monster) return false;
        // The member in the corner the missile reached. Nobody there lets it fly on —
        // unless the group is drawn as one full-cell figure, when member 1 takes it.
        let monsterOrdinal = ordinalOfMonsterAtPosition(this.dungeon, this.ctx.tables.monsterDesc, monster, objectPos);
        if (monsterOrdinal === 0) {
          if (!monster.drawAsSize4) return false;
          monsterOrdinal = 1;
        }
        if (this.missileEncounterFilter(1, position, objectPos, missileRn, filterProjectile, monsterOrdinal - 1) === 1) {
          return false;
        }
        const monsterType = monster.creatureType;
        const desc = this.ctx.tables.monsterDesc[monsterType];
        if (!desc) return false;

        // A fireball feeds a Black Flame: `hitPoints6 = Smaller(1000, hp + magic)`, and
        // the missile is simply gone — no damage, no sound, no explosion (`:1976-1996`).
        // CSBWin's potion bookkeeping in this branch is unreachable: `RNprojectile` is
        // the potion itself, never `RNFireball`, while a bomb is in flight.
        if (projectile === RN_FIREBALL && monsterType === MonsterType.mon_BlackFlame) {
          const i = monsterOrdinal - 1;
          const magic = this.determineMagicDamage(missile, projectile);
          monster.hp[i] = sw(Math.min(1000, (monster.hp[i] ?? 0) + magic.damage)) & 0xffff;
          this.ctx.systems.timer.processObjectFromMissile(missileRn, null, position);
          return true;
        }
        if (monsterNonMaterial(desc) && projectile !== RN_DISPELL_MISSILE) return false;

        // `D0L = 64 * (DetermineMagicDamage(...) & 0xffff); D5W = (D0L & 0xffff) / D1W`,
        // with `D1W = defense08`, 0 read as 1 (`:2006-2012`). A blow that rounds to 0
        // skips `DamageMonster` but the missile still lands.
        const magic = this.determineMagicDamage(missile, projectile);
        const defense = desc.defense08 === 0 ? 1 : desc.defense08;
        const blow = sw(Math.trunc(((64 * (magic.damage & 0xffff)) & 0xffff) / defense));
        if (blow !== 0) {
          // `DeterminePoisonDamage(mt_60, d.Word12962)` — the poison strength the
          // `DetermineMagicDamage` call above just set.
          const poison = sw(this.ctx.systems.monsterDamage.determinePoisonDamage(monsterType, magic.poisonStrength));
          const result = this.ctx.systems.monsterDamage.damageMonster(
            monster, monsterOrdinal - 1, position.z, objX, objY, blow + poison, true, false,
          );
          // "At least one monster in group remains": the survivors react.
          if (result !== MonsterDamageResult.ALL_MONSTERS_DIED) {
            this.ctx.systems.monsterAI.processTimers29to41({
              mapX: objX,
              mapY: objY,
              level: position.z,
              timerFunction: TimerFunction.TT_M2,
              timeUntilAlternateUpdate: 0,
            });
          }
          this.monsterDamageResult = result;
          // A dagger, arrow, slayer, poison dart or throwing star sticks in a monster
          // that absorbs them — but only if nobody died of the blow (`:2031-2042`).
          if (
            !nonPoisonSpell &&
            result === MonsterDamageResult.NO_MONSTER_DIED &&
            projectileDbType === DBType.WEAPON &&
            monsterAbsorbsDaggersEtc(desc)
          ) {
            const wt = (this.dungeon.getWeaponRecord(projectile)?.weaponType ?? -1) | 0;
            if (
              wt === WEAPON_DAGGER ||
              wt === WEAPON_ARROW ||
              wt === WEAPON_SLAYER ||
              wt === WEAPON_POISON_DART ||
              wt === WEAPON_THROWING_STAR
            ) {
              absorbedMonster = monsterRn;
            }
          }
        }
        return this.finishMissileEncounter(missileRn, absorbedMonster, position, objectPos, tailProjectile, convertedPotion, convertedPower, nonPoisonSpell, objX, objY);
      }
      default:
        break;
    }

    return this.finishMissileEncounter(missileRn, absorbedMonster, position, objectPos, tailProjectile, convertedPotion, convertedPower, nonPoisonSpell, objX, objY);
  }

  missileEncounterFilter(
    type: number,
    position: Position,
    posInCell: number,
    missile: number,
    projectile: ObjectID,
    index: number,
  ): number {
    // `BITS10_11(missileFilterTimer.timerWord8())` (`doc/CSBwin-src/Code11f52.cpp:1681`): the
    // direction of the last missile `MissileTimer` ran, also for an encounter it did not
    // cause, a party or a monster walking away from a missile.
    const direction = ((this.timers.missileFilterTimer?.timerWord8 ?? 0) >> 10) & 0x3;
    return this.ctx.systems.dsa.processMissileEncounterFilter({
      type,
      position,
      posInCell: posInCell & 0x3,
      missile,
      projectile,
      direction,
      index,
    }) | 0;
  }

  private findMissilesAt(position: Position): ObjectID[] {
    const missiles: ObjectID[] = [];
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category === DBType.MISSILE) missiles.push(rn);
    }
    return missiles;
  }

  private primaryDirectionFromMove(oldPos: Position, newPos: Position): number {
    if (newPos.x > oldPos.x) return Direction.EAST;
    if (newPos.x < oldPos.x) return Direction.WEST;
    if (newPos.y > oldPos.y) return Direction.SOUTH;
    return Direction.NORTH;
  }

  /**
   * The tail of `ProcessMissileEncounter`'s party arm
   * (`doc/CSBwin-src/Code11f52.cpp:2044-2056`):
   *
   * ```cpp
   * if (D4W != 0) {
   *   D0W = DamageCharacter(objectPos, D5W, 12, d.Word12964);
   *   if (D0W != 0 && d.Word12962 != 0 && STRandomBool())
   *     PoisonCharacter(objectPos, d.Word12962);
   * }
   * ```
   *
   * Everything above it — which champion, how much, which mitigation, how much
   * poison — was decided in `determineMagicDamage`; this only applies
   * it. Going through `DamageCharacter` rather than subtracting from `health` is
   * the whole point: it is what runs armour, wounds, the shields, the wake-up, and
   * `KillCharacter`. Until it did, a champion killed by a missile left no bones and
   * no possessions, and a party wiped by one did not lose the game.
   *
   * The **wound mask is 12**, a literal at the call site: bits 2 and 3, the torso
   * and the legs. A missile cannot wound a hand, a head or a foot.
   */
  private applyMissileDamageToParty(options: {
    chIdx: number;
    damage: number;
    kind: number;
    poisonStrength: number;
  }): void {
    // No `d.LastMonsterAttackTime` here: only `MonsterAttacks` sets it
    // (`doc/CSBwin-src/Monster.cpp:982`), and this port does so in `MonsterAttack`.
    const dealt = this.ctx.systems.monsterAttack.damageCharacter(
      options.chIdx,
      options.damage | 0,
      MISSILE_WOUND_MASK,
      options.kind | 0,
    );
    if (dealt === 0) return;
    // `STRandomBool()` — a poisoned missile infects only half the time.
    if ((options.poisonStrength | 0) !== 0 && this.random.bool() !== 0) {
      this.ctx.systems.monsterAttack.poisonCharacter(options.chIdx, options.poisonStrength | 0);
    }
  }

  private finishMissileEncounter(
    missileRn: ObjectID,
    destMonster: ObjectID | null,
    position: Position,
    objectPos: number,
    projectile: ObjectID,
    convertedPotion: boolean,
    convertedPower: number,
    nonPoisonSpell: boolean,
    objX: number,
    objY: number,
  ): boolean {
    const missile = this.dungeon.getMissileRecord(missileRn);
    if (!missile) return false;
    const dest: MissileDropTarget = destMonster !== null ? { monster: destMonster } : null;

    if (nonPoisonSpell || convertedPotion) {
      let size = convertedPotion ? convertedPower : (missile.rangeRemaining & 0xff);
      if (projectile === RN_LIGHTNING) {
        size = Math.floor(size / 2);
        if (size <= 0) {
          this.ctx.systems.timer.processObjectFromMissile(missileRn, dest, position);
          return true;
        }
      }
      const cloudPos = projectile === RN_POISON_CLOUD ? 255 : objectPos & 0xff;
      this.createCloud(projectile, size, objX, objY, position, cloudPos);
    } else {
      this.playMissileImpactSound(projectile, position);
    }

    if (convertedPotion) {
      this.dungeon.deleteDBEntry(missile.projectileObject);
      missile.projectileObject = (projectile & 0xffff) as ObjectID;
    }

    this.ctx.systems.timer.processObjectFromMissile(missileRn, dest, position);
    return true;
  }

  /**
   * The tail of `ProcessMissileEncounter`'s shared ending (`doc/CSBwin-src/
   * Code11f52.cpp:2101-2121`) — the sound for a plain object's impact, when nothing
   * spawned a cloud. These `soundNum` values are **ordinals** into `d.sound1772`
   * (`graphic232`'s sound table), not raw SND item numbers — `queueSound` is what
   * resolves an ordinal to the actual sample and its distance falloff. This used to
   * call `playSound` with a hand-picked `SoundIndex` constant per branch, which
   * silently substituted a *different* sample for the non-weapon, non-poison-bolt
   * case (`SoundIndex.FIREBALL_EXPLODE`, ordinal 5's sound, instead of ordinal 4's) —
   * so a dropped scroll or piece of food played an explosion.
   */
  private playMissileImpactSound(projectile: ObjectID, position: Position): void {
    let soundNum: number;
    if (!isMagicSpellRn(projectile) && decodeObjectID(projectile).category === DBType.WEAPON) {
      soundNum = 0;
    } else if (projectile === RN_POISON_BOLT) {
      soundNum = 13;
    } else {
      soundNum = 4;
    }
    this.ctx.sounds.queueSound(soundNum, position.x, position.y, 1, position.z);
  }

  /**
   * `CreateCloud`'s own sound (`doc/CSBwin-src/Code11f52.cpp:1432-1447`) —
   * `QueueSound(size>80 ? 5 : 20, missileX, missileY, 1)` for a fireball, poison
   * bolt or lightning bolt, `QueueSound(13, ...)` for anything else (skipping a
   * monster-death cloud, which is silent). Ordinals 5 and 20 both resolve to the
   * same SND item — a small blast is the same sample at a shorter falloff distance,
   * not a different one — so this used to substitute `SoundIndex.SPELL_EXPLODE`
   * (ordinal 13's sample) for the small case, turning a modest fireball into
   * whatever ordinal 13 sounds like instead of a quieter version of its own blast.
   */
  private playCloudSound(projectile: ObjectID, size: number, position: Position): void {
    if (projectile === RN_FIREBALL || projectile === RN_POISON || projectile === RN_LIGHTNING) {
      this.ctx.sounds.queueSound(size > 80 ? 5 : 20, position.x, position.y, 1, position.z);
      return;
    }
    if (projectile !== RN_MONSTER_DEATH) {
      this.ctx.sounds.queueSound(13, position.x, position.y, 1, position.z);
    }
  }

  /**
   * Public entry to `CreateCloud` for the monster death cloud
   * (`doc/CSBwin-src/Code11f52.cpp:1376`, called from `DamageMonster`). The cloud
   * machinery lives here because that is where every other cloud is made.
   */
  createDeathCloud(projectile: ObjectID, size: number, position: Position, posInCell: number): void {
    this.createCloud(projectile, size, position.x, position.y, position, posInCell);
  }

  /**
   * `CreateFluxcage` (`doc/CSBwin-src/Code11f52.cpp:1515`).
   *
   * Not `CreateCloud`: a Fluxcage gets no `TT_25` life of its own — it never shrinks
   * and does no damage — only a single `TT_24` that removes it after 100 ticks. It
   * also goes into the cell centred (`RNempty` position) rather than in a corner.
   */
  createFluxcage(position: Position, startTime: number): ObjectID | null {
    const rn = this.createCloudRecord(CloudType.CT_FLUXCAGE, 0, 255);
    if (rn === null) return null;
    if (!this.dungeon.addObjectToCell(position, rn)) {
      this.dungeon.deleteDBEntry(rn as ObjectID);
      return null;
    }
    this.timers.createTimer(
      TimerFunction.TT_24,
      position.x,
      position.y,
      0,
      0,
      (startTime + 100) >>> 0,
      position.z,
      rn,
    );
    return rn as ObjectID;
  }

  /**
   * `CreateCloud` / `TAG00dea8` (`doc/CSBwin-src/Code11f52.cpp:1376`).
   *
   * The cloud is a DB15 record in the cell plus a `TT_25` timer that gives it its
   * life. Without the timer — which is how this stood until now — the record sits in
   * the cell at full size for the rest of the game, rendering a permanent puff and
   * dealing no damage at all.
   *
   * A fireball or a lightning bolt also does its damage *here*, at the moment the
   * cloud appears, not on the timer.
   */
  createCloud(
    projectile: ObjectID,
    size: number,
    objX: number,
    objY: number,
    position: Position,
    posInCell: number,
  ): void {
    if (objX < 0 || objY < 0) return;
    // `P1.GetSpellType()` (doc/CSBwin-src/Code11f52.cpp:1428).
    const rn = this.createCloudRecord(projectile & 0x7f, size, posInCell);
    if (rn === null) return;
    this.playCloudSound(projectile, size, position);
    this.dungeon.addObjectToCell(position, rn);

    // The Vi altar's cloud gets 5 ticks before its first turn; everything else 1.
    const delay = projectile === RN_FFE4 ? 5 : 1;
    this.timers.createTimer(
      TimerFunction.TT_25,
      position.x,
      position.y,
      0,
      0,
      (this.ctx.state.tickCount + delay) >>> 0,
      position.z,
      rn,
    );

    if (projectile !== RN_LIGHTNING && projectile !== RN_FIREBALL) return;

    // A fireball's blast, dealt once. Lightning deals half.
    let damage = Math.trunc(size / 2) + 1;
    damage = damage + this.random.below(damage);
    if (projectile !== RN_FIREBALL) {
      damage = Math.trunc(damage / 2);
      if (damage === 0) return;
    }

    const party = this.ctx.party.state;
    if (position.z === party.position.z && objX === party.position.x && objY === party.position.y) {
      this.ctx.systems.monsterAttack.damageAllCharacters(damage, 63, 1);
      return;
    }

    const monsterRn = this.dungeon.findFirstMonster(new Position(objX, objY, position.z));
    if (monsterRn === OBJECT_ID_EOF) return;
    const monster = this.dungeon.getCreatureRecord(monsterRn);
    if (!monster) return;
    const desc = this.ctx.tables.monsterDesc[monster.creatureType];
    if (!desc) return;
    const fireResistance = monsterFireResistance(desc);
    if (fireResistance === 15) return;
    if (monsterNonMaterial(desc)) damage >>= 2;
    damage -= this.random.below(2 * fireResistance + 1);
    if (damage <= 0) return;
    this.monsterDamageResult =
      this.ctx.systems.monsterDamage.damageMonsterGroup(monster, position.z, objX, objY, damage, true, false);
  }

  private createCloudRecord(cloudType: number, size: number, posInCell: number): ObjectID | null {
    const bit7 = (posInCell & 0xff) === 255;
    // `FindEmptyDB15Entry` (`doc/CSBwin-src/CSBCode.cpp:5073`).
    const index = this.dungeon.findEmptyDBEntry('clouds', {
      nextObject: OBJECT_ID_EOF,
      value: size & 0xff,
      cloudType: cloudType & 0x7f,
      bit7,
    });
    return index === null ? null : encodeObjectID(bit7 ? 0 : (posInCell & 0x3), DBType.CLOUD, index);
  }

  /**
   * `HitDoor` (`doc/CSBwin-src/Code11f52.cpp:2263`) — a blow that may burst a door open.
   *
   * `explosion` picks which of the door's two "destructible by" flags is consulted:
   * a fireball's blast tests `canOpenWithFireball`, an axe blow `canOpenWithAxe`. The
   * force must also beat the door type's entry in `DoorTOC`.
   *
   * With a `delay` — `Attack.cpp`'s melee bash passes 2 (`doc/CSBwin-src/Attack.cpp:1803-1808`)
   * — the door does not shatter now: a `TT_BASH_DOOR` timer at `d.Time + delay` does it.
   * A fireball passes none and the door goes at once.
   */
  hitDoor(position: Position, force: number, explosion: boolean, delay = 0): boolean {
    const doorRn = this.dungeon.findFirstObject(position);
    if (doorRn === OBJECT_ID_EOF) return false;
    const door = this.dungeon.getDoorRecordByIndex(decodeObjectID(doorRn).index);
    if (!door) return false;

    if (explosion ? !door.destructibleByFireball : !door.destructibleByChop) return false;
    const toc = this.dungeon.doorTOC(position.z, door.doorType, this.ctx.tables.doorCharacteristics) & 0xff;
    if (force < toc) return false;

    const map = this.dungeon.getMap(position.z);
    if (!map) return false;
    const cellFlag = map.cellFlags[position.x]?.[position.y];
    if (cellFlag === undefined) return false;
    // Bottom three bits 4 means a closed door; 5 is the shattered state.
    if ((cellFlag & 7) !== 4) return false;
    if (delay !== 0) {
      this.timers.createTimer(TimerFunction.TT_BASH_DOOR, position.x, position.y, 0, 0, (this.ctx.state.tickCount + delay) >>> 0, position.z);
    } else {
      setDoorState(map, position.x, position.y, 5);
    }
    return true;
  }

  /**
   * `DetermineMagicDamage` (`doc/CSBwin-src/Code11f52.cpp:1557`) — how hard a missile
   * lands, and the two globals that go with it.
   *
   * CSBWin returns the damage and leaves `d.Word12962` (a poison strength) and
   * `d.Word12964` (the `DamageCharacter` *kind*, which selects how armour and the
   * shields mitigate) behind in globals; they are returned together here because they
   * are one answer and reading them separately is how they get out of step.
   *
   * The three arms are not variations on one formula:
   *
   * - **A thrown weapon** contributes its `WEAPONDESC.uByte3`, anything else thrown a
   *   random 0-3, and both add half the object's weight. `kind` stays 3.
   * - **Poison cloud** (`RNPoison`) rolls 0-15, keeps that + 10 as the *poison
   *   strength*, and adds a further 0-31 to the damage.
   * - **A non-physical spell** (`>= RNDispellMissile`) sets `kind` 5 and returns
   *   early: 0 damage, except `RNPoisonBolt`, which returns **1** and carries the
   *   missile's whole remaining range as poison. That early return is why a dispel
   *   missile passes through a champion without hurting them.
   * - **Anything else magical** is `2×(0..15) + 10` at `kind` 1, quintupled at `kind`
   *   7 for lightning.
   *
   * The common tail then folds in the remaining range, adds two small random terms,
   * and floors the result at half itself — so a nearly spent missile still stings.
   *
   * Public because CSBWin's is a free function used by both the party and the monster
   * arm, and because `tools/dump-champion-death.ts` reads its three outputs directly —
   * none of them is observable from outside once the damage has been applied.
   */
  determineMagicDamage(
    missile: MissileRecord,
    projectile: ObjectID,
  ): { damage: number; kind: number; poisonStrength: number } {
    let poisonStrength = 0;
    let kind = 3;
    const range = missile.rangeRemaining & 0xff;
    // `if (object.IsMagicSpell()) dbType = dbCLOUD; else dbType = object.dbType();`
    const dbType = isMagicSpellRn(projectile)
      ? DBType.CLOUD
      : decodeObjectID(projectile as ObjectID).category;

    let d6: number;
    if (dbType !== DBType.CLOUD) {
      if (dbType === DBType.WEAPON) {
        d6 = this.ctx.systems.characterStats.weaponDescFor(projectile)?.uByte3 ?? 0;
        kind = 3;
      } else {
        d6 = this.random.zeroTo3();
      }
      d6 = sw(d6 + Math.trunc(this.ctx.systems.characterStats.getObjectWeight(projectile) / 2));
    } else if (projectile === RN_POISON) {
      d6 = this.random.next() & 15;
      poisonStrength = sw(d6 + 10);
      d6 = sw(d6 + this.random.below(32));
    } else if (isNonPhysicalSpellRn(projectile)) {
      kind = 5;
      if (projectile === RN_POISON_BOLT) return { damage: 1, kind, poisonStrength: range };
      return { damage: 0, kind, poisonStrength };
    } else {
      kind = 1;
      d6 = sw(this.random.below(16) + this.random.below(16) + 10);
      if (projectile === RN_LIGHTNING) {
        kind = 7;
        d6 = sw(5 * d6);
      }
    }

    d6 = sw(Math.trunc((d6 + range) / 16) + 1);
    const spread = this.random.below(Math.trunc(d6 / 2) + 1);
    d6 = sw(d6 + this.random.zeroTo3() + spread);
    // `D1W = 32 - damageRemaining/8; D6W = Larger(D6W/2, D6W-D1W)` — the floor at half
    // is what stops a long flight reducing the blow to nothing.
    const falloff = sw(32 - Math.trunc((missile.damageRemaining & 0xff) / 8));
    d6 = sw(Math.max(Math.trunc(d6 / 2), d6 - falloff));
    return { damage: d6, kind, poisonStrength };
  }

  /** `d.ObjDesc[object.DescIndex()].word4` — where the object may be carried. */
  private objDescWord4(rn: ObjectID): number {
    const descIndex = DescIndex(this.dungeon, rn);
    return descIndex === -1 ? 0 : this.ctx.tables.objDescWord4[descIndex] ?? 0;
  }
}
