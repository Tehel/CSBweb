/**
 * Monsters hitting the party.
 *
 * Ports `MonsterAttacks` (`doc/CSBwin-src/Monster.cpp:944`) and
 * `MonsterDamagesCharacter` (`:4518`), together with the champion-side chain they
 * drive: `DamageCharacter` (`doc/CSBwin-src/Character.cpp:2703`), `KillCharacter`
 * (`:2526`), `Quickness` (`:2209`), `IsCharacterLucky` (`:2165`), the
 * attribute-scaled reduction `TAG016426` (`:2042`), `GetCharacterToDamage`
 * (`doc/CSBwin-src/CSBCode.cpp:6884`), `DetermineAttackOrder`
 * (`doc/CSBwin-src/Character.cpp:384`) and `PoisonCharacter`
 * (`doc/CSBwin-src/CSBCode.cpp:7211`).
 *
 * `MonsterAttacks` is not one attack but a decision about *how* to attack: it fills
 * in an `AttackParameters` block — who to hit, whether to throw a missile instead,
 * what missile, how far, how hard — hands it to the Monster Attack Filter DSA to
 * amend, and only then acts on it. That indirection is the whole reason the block
 * exists as a struct in CSBWin, so it is kept as one here.
 */
import { OBJECT_ID_EOF, Position, type ObjectID } from '../core/types';
import type { CsbRandom } from '../core/random';
import type { CreatureRecord, Item16Record } from '../data/dungeonTypes';
import type { DungeonState } from './DungeonState';
import type { Champion, PartyState } from './gameTypes';
import { MonsterType } from './monsterTypes';
import { setHandOwner } from './Party';
import { getPrimaryAndSecondaryDirection } from './MonsterPerception';
import { adjustSkills, AdjustSkillsWhy, determineMastery } from './skills';
import type { MonsterDesc } from '../renderer/csbwin/ObjectTables';
import type { CharacterStats } from './CharacterStats';
import { monsterWord14_12_15, monsterWord16_8_11, monsterWord2Bit4 } from '../renderer/csbwin/ObjectTables';

/**
 * The missile "projectile" RNs a monster can throw
 * (`doc/CSBwin-src/CSBTypes.h`, used at `doc/CSBwin-src/Monster.cpp:1029-1058`).
 */
export const RN_FIREBALL = 0xff80;
export const RN_POISON_BOLT = 0xff81;
export const RN_LIGHTNING = 0xff82;
export const RN_DISPELL_MISSILE = 0xff83;
export const RN_ZO_SPELL = 0xff84;
export const RN_POISON_CLOUD = 0xff87;
export const RN_POISON = 0xff88;

const THROWABLE: ReadonlySet<number> = new Set([
  RN_FIREBALL, RN_POISON, RN_LIGHTNING, RN_DISPELL_MISSILE,
  RN_ZO_SPELL, RN_POISON_CLOUD, RN_POISON_BOLT,
]);

/** `misc_BonesOfHero` (`doc/CSBwin-src/Objects.h`). */
const MISC_BONES_OF_HERO = 25;

/**
 * `attackParameters` (`doc/CSBwin-src/Monster.cpp:919-941`).
 *
 * Kept as one block because the Monster Attack Filter DSA is handed the whole thing
 * and may rewrite any field before it is acted on
 * (`doc/CSBwin-src/Monster.cpp:1160-1166`).
 */
export interface AttackParameters {
  monsterID: number;
  monsterType: number;
  monsterIndex: number;
  monsterLevel: number;
  monsterX: number;
  monsterY: number;
  monsterPos: number;
  missileOriginPosition: number;
  missileRange: number;
  missileDamage: number;
  missileDecayRate: number;
  directionToParty: number;
  distanceToParty: number;
  missileType: number;
  monsterShouldLaunchMissile: boolean;
  monsterShouldSteal: boolean;
  /** 0-3 a specific champion, 4 the leader, 5 random, 6 closest, -1 none. */
  heroToDamage: number;
  attackSoundOrdinal: number;
  disableTime: number;
  /** CSBWin starts this at -1; only `== 1` suppresses poison. */
  supressPoison: number;
}

export interface MonsterAttackTables {
  monsterDesc?: ArrayLike<MonsterDesc>;
  monsterAttackSounds?: ArrayLike<number>;
  /** `d.uByte590[4]` — wound-location bitmasks. */
  uByte590?: ArrayLike<number>;
  /** `d.Byte586[8][4]` — attack order by side. */
  byte586?: ArrayLike<ArrayLike<number>>;
  /** `d.ClothingDesc[58].uByte1` — armour strength per garment. */
  clothingArmour?: ArrayLike<number>;
  /** `d.ClothingDesc[58].uByte2` — flags; bit 7 marks a shield. */
  clothingFlags?: ArrayLike<number>;
  /** `d.Byte1412[6]` — per-body-part shield weighting. */
  byte1412?: ArrayLike<number>;
}

export interface MonsterAttackHooks {
  queueSound?: (ordinal: number, mapX: number, mapY: number, deltaTime: number) => void;
  /** `LaunchMissile` (`doc/CSBwin-src/Magic.cpp:40`). */
  launchMissile?: (options: {
    projectile: number;
    mapX: number;
    mapY: number;
    posInCell: number;
    direction: number;
    range: number;
    damage: number;
    decayRate: number;
    level: number;
    startTime: number;
  }) => void;
  /** `StealFromCharacter` (`doc/CSBwin-src/Monster.cpp:239`) — the giggler. */
  stealFromCharacter?: (monster: CreatureRecord, chIdx: number) => void;
  /** `MonsterAttackFilter` — a DSA may rewrite the whole parameter block. */
  attackFilter?: (params: AttackParameters) => AttackParameters | null;
  /** Called when a champion dies, after bones and possessions are dealt with. */
  onChampionDied?: (chIdx: number) => void;
  /** Register the bones↔champion mapping (`expool.AddChampionBonesRecord`). */
  registerBones?: (bones: ObjectID, chIdx: number) => void;
  /** `DropAllPossessions` (`doc/CSBwin-src/Character.cpp:2497`). */
  dropAllPossessions?: (chIdx: number) => void;
  /** `WakeUp` (`doc/CSBwin-src/CSBCode.cpp`). */
  wakeUp?: () => void;
  trace?: (line: string) => void;
}

export class MonsterAttack {
  constructor(
    private dungeon: DungeonState,
    private getPartyState: () => PartyState,
    private getTime: () => number,
    private random: CsbRandom,
    private getExperienceMultiplier: () => number,
    private tables?: MonsterAttackTables,
    private hooks?: MonsterAttackHooks,
  ) {}

  setTables(tables: MonsterAttackTables): void {
    this.tables = { ...this.tables, ...tables };
  }

  /**
   * `MonsterAttacks` (`doc/CSBwin-src/Monster.cpp:944`).
   *
   * Returns whether the member is now in its attacking pose, which is what the AI
   * feeds to `NextMonsterUpdateTime` to pick the attack sprite.
   */
  monsterAttacks(
    monsterRn: ObjectID,
    monster: CreatureRecord,
    mapX: number,
    mapY: number,
    monsterIndex: number,
    context: {
      level: number;
      primaryDirectionToParty: number;
      orthogonalDistanceToParty: number;
    },
  ): boolean {
    const party = this.getPartyState();
    if (party.champions.length === 0) return false;

    // `d.LastMonsterAttackTime = d.Time` — this is the real feed for the value that
    // `AdjustSkills` scales experience against; it used to be set from the missile
    // path as a stand-in (PLAN.md Phase 12).
    party.lastMonsterAttackTime = this.getTime() | 0;

    const slot = this.dungeon.getAttachedItem16(monster);
    if (!slot) return false;
    const desc = this.tables?.monsterDesc?.[monster.creatureType];
    if (!desc) return false;

    const p = this.buildAttackParameters(
      monsterRn, monster, slot, desc, mapX, mapY, monsterIndex, context,
    );

    const amended = this.hooks?.attackFilter?.(p) ?? p;

    if (amended.monsterShouldLaunchMissile) {
      if (THROWABLE.has(amended.missileType)) {
        this.hooks?.launchMissile?.({
          projectile: amended.missileType,
          mapX: amended.monsterX,
          mapY: amended.monsterY,
          posInCell: amended.missileOriginPosition,
          direction: amended.directionToParty,
          // `ApplyLimits(20, range, 255)` (doc/CSBwin-src/Monster.cpp:1206).
          range: Math.min(255, Math.max(20, amended.missileRange)),
          damage: amended.missileDamage,
          decayRate: amended.missileDecayRate,
          level: context.level,
          startTime: this.getTime(),
        });
      }
    } else {
      let chIdx = amended.heroToDamage;
      switch (chIdx) {
        case 0: case 1: case 2: case 3:
          break;
        case 4: // party leader
          chIdx = party.selectedCharacterIndex >= 0 ? party.selectedCharacterIndex : 0;
          break;
        case 5: // random live member
          chIdx = this.randomLiveChampion();
          break;
        case 6: // closest
          chIdx = this.getCharacterToDamage(
            amended.monsterX, amended.monsterY, amended.missileOriginPosition,
          );
          if (chIdx < 0) return false;
          break;
        default:
          return false;
      }

      if (amended.monsterShouldSteal) {
        this.hooks?.stealFromCharacter?.(monster, chIdx);
      } else {
        const dealt = 1 + this.monsterDamagesCharacter(monster, chIdx, amended.supressPoison === 1);
        const champ = this.championAt(chIdx);
        // `maxRecentDamage` drives which way the portrait's damage flash points.
        if (champ && dealt > (champ.maxRecentDamage ?? 0)) {
          champ.maxRecentDamage = dealt & 0xff;
          champ.damageFromDirection = (amended.directionToParty + 2) & 0x3;
        }
      }
    }

    if (amended.attackSoundOrdinal !== 0) {
      const ordinal = this.tables?.monsterAttackSounds?.[amended.attackSoundOrdinal - 1] ?? 0;
      if (ordinal) this.hooks?.queueSound?.(ordinal, amended.monsterX, amended.monsterY, 1);
    }
    return true;
  }

  /**
   * Fill in the attack parameter block (`doc/CSBwin-src/Monster.cpp:980-1160`).
   *
   * The one piece of real geometry here is `missileOriginPosition`: which corner of
   * the cell the attack comes from. It is the attacking member's own corner, rotated
   * so that "right-hand side of the group as seen facing the party" comes out right.
   */
  private buildAttackParameters(
    monsterRn: ObjectID,
    monster: CreatureRecord,
    slot: Item16Record,
    desc: MonsterDesc,
    mapX: number,
    mapY: number,
    monsterIndex: number,
    context: { level: number; primaryDirectionToParty: number; orthogonalDistanceToParty: number },
  ): AttackParameters {
    const positionsByte = slot.positions & 0xff;
    const monsterPos = (positionsByte >> (2 * monsterIndex)) & 0x3;
    const directionToParty = context.primaryDirectionToParty;

    const rightSideMonster =
      positionsByte === 255
        ? this.random.bool()
        : ((monsterPos + 5 - directionToParty) & 2) / 2;

    const p: AttackParameters = {
      monsterID: monsterRn,
      monsterType: monster.creatureType,
      monsterIndex,
      monsterLevel: context.level,
      monsterX: mapX,
      monsterY: mapY,
      monsterPos,
      missileOriginPosition: (rightSideMonster + directionToParty) & 0x3,
      missileRange: 0,
      missileDamage: desc.dexterity12,
      missileDecayRate: 8,
      directionToParty,
      distanceToParty: context.orthogonalDistanceToParty,
      missileType: this.chooseMissile(monster.creatureType),
      // Only monsters whose `word14_12_15` is above 1 throw anything, and then only
      // at range or on a coin toss (doc/CSBwin-src/Monster.cpp:1025-1027).
      monsterShouldLaunchMissile:
        monsterWord14_12_15(desc) > 1 &&
        (context.orthogonalDistanceToParty > 1 || this.random.bool() !== 0),
      monsterShouldSteal: monster.creatureType === MonsterType.mon_Giggler,
      heroToDamage: -1,
      attackSoundOrdinal: desc.attackSound,
      disableTime: 0,
      supressPoison: -1,
    };

    // `word2Bit4` monsters hit a *random* live champion rather than the nearest.
    if (monsterWord2Bit4(desc)) {
      let target = this.random.zeroTo3();
      let tries = 0;
      while (tries < 4 && (this.championAt(target)?.attributes.health ?? 0) === 0) {
        target = (target + 1) & 0x3;
        tries++;
      }
      // CSBWin's own comment: "For four years we didn't increment heroToDamage!"
      if (tries === 4) p.heroToDamage = -1;
      else p.heroToDamage = target;
    } else {
      p.heroToDamage = this.getCharacterToDamage(mapX, mapY, p.missileOriginPosition);
    }

    // `attack10 / 4 + 1`, then two rounds of `+= Random(range)`.
    let range = Math.trunc(desc.attack10 / 4) + 1;
    range += this.random.below(range);
    range += this.random.below(range);
    p.missileRange = range;

    return p;
  }

  /** Which missile a given monster type throws (`doc/CSBwin-src/Monster.cpp:1029-1058`). */
  private chooseMissile(monsterType: number): number {
    switch (monsterType) {
      case MonsterType.mon_Vexirk:
      case MonsterType.mon_LordChaos:
        if (this.random.bool() !== 0) return RN_FIREBALL;
        switch (this.random.zeroTo3()) {
          case 0: return RN_DISPELL_MISSILE;
          case 1: return RN_LIGHTNING;
          case 2: return RN_POISON_CLOUD;
          default: return RN_ZO_SPELL;
        }
      case MonsterType.mon_SlimeDevil:
        return RN_POISON;
      case MonsterType.mon_FlyingEye:
        return this.random.below(8) !== 0 ? RN_LIGHTNING : RN_ZO_SPELL;
      case MonsterType.mon_Zytaz:
        return this.random.bool() !== 0 ? RN_POISON_CLOUD : RN_FIREBALL;
      case MonsterType.mon_Demon:
      case MonsterType.mon_Dragon:
        return RN_FIREBALL;
      default:
        return 0;
    }
  }

  /**
   * `MonsterDamagesCharacter` (`doc/CSBwin-src/Monster.cpp:4518`).
   *
   * Two chances to avoid the blow entirely before any damage is rolled: being quicker
   * than the monster (and winning a 3-in-4 roll), and being lucky. A sleeping party
   * gets neither — it is woken instead.
   *
   * The damage itself is deliberately convoluted: a base from the monster's `attack10`
   * reduced by twice the champion's Fighter mastery, then halved, then grown by three
   * separate random terms, then quartered, then possibly reduced again. Ported
   * step-for-step because no simpler form would give the same distribution.
   */
  monsterDamagesCharacter(monster: CreatureRecord, chIdx: number, supressPoison: boolean): number {
    const party = this.getPartyState();
    const champ = this.championAt(chIdx);
    if (!champ) return 0;
    if (champ.attributes.health === 0) return 0;
    if (party.sleeping) this.hooks?.wakeUp?.();

    const desc = this.tables?.monsterDesc?.[monster.creatureType];
    if (!desc) return 0;
    const experienceTerm = 2 * this.getExperienceMultiplier();

    // Being attacked trains the Fighter defence skill regardless of the outcome.
    adjustSkills(party.champions, chIdx, 7, monsterWord16_8_11(desc), AdjustSkillsWhy.MonsterDamagesCharacter, {
      time: this.getTime(),
      lastMonsterAttackTime: party.lastMonsterAttackTime,
      experienceMultiplier: this.getExperienceMultiplier(),
      random: this.random,
    });

    if (!party.sleeping) {
      const quickness = this.quickness(champ);
      const monsterRoll = this.random.below(32) + desc.dexterity12 + experienceTerm - 16;
      if (quickness >= monsterRoll && this.random.zeroTo3() !== 0) return 0;
      if (this.isCharacterLucky(champ, 60)) return 0;
    }

    // Where the blow lands. A roll with any of bits 4-6 set walks down `word22`'s
    // nibbles to pick a wound mask; otherwise it is one of the first two body parts
    // (doc/CSBwin-src/Monster.cpp:4546-4560).
    let woundMask: number;
    const roll = this.random.next() & 0xffff;
    if (roll & 0x70) {
      const low = roll & 15;
      let word22 = ((desc.uByte22[0] ?? 0) << 8) | (desc.uByte22[1] ?? 0);
      let index = 0;
      while (low > (word22 & 15)) { word22 >>= 4; index++; }
      woundMask = this.tables?.uByte590?.[index] ?? 0;
    } else {
      woundMask = roll & 1;
    }

    let damage = experienceTerm + this.random.below(16) + desc.attack10;
    damage -= 2 * determineMastery(champ, 7, {});
    if (damage <= 1) {
      if (this.random.bool() !== 0) return 0;
      damage = this.random.zeroTo3() + 2;
    }
    damage = Math.trunc(damage / 2);
    damage = damage + this.random.below(damage) + this.random.zeroTo3();
    damage = damage + this.random.below(damage);
    damage = Math.trunc(damage / 4);
    damage = damage + this.random.zeroTo3() + 1;
    if (this.random.bool() !== 0) {
      damage = damage - (this.random.below(Math.trunc(damage / 2) + 1) - 1);
    }

    const dealt = this.damageCharacter(chIdx, damage, woundMask, desc.uByte22[2] ?? 0);
    if (dealt === 0) return 0;

    // Sound ordinal `chIdx + 9` names *which* champion was hurt.
    this.hooks?.queueSound?.(chIdx + 9, party.position.x, party.position.y, 2);

    const poison = desc.poisonAttack11;
    if (poison !== 0 && this.random.bool() !== 0) {
      const scaled = this.attributeScaledReduction(champ, 4, poison);
      // CSBWin: "There was an impossible jump around the following function call."
      if (!supressPoison) this.poisonCharacter(chIdx, scaled);
    }
    return dealt;
  }

  /**
   * `DamageCharacter` (`doc/CSBwin-src/Character.cpp:2703`).
   *
   * `kind` is CSBWin's `P4`, and it selects how the blow is mitigated: 1 fire,
   * 5 spell, 6 wisdom-scaled, 2 half armour, anything else full armour. Zero skips
   * mitigation and wounds entirely.
   *
   * Armour is the average of `armourStrength` over every body part the blow could
   * land on, which then scales the damage by `130 - armour`.
   */
  damageCharacter(chIdx: number, damage: number, woundMask: number, kind: number): number {
    const party = this.getPartyState();
    if (chIdx === -1) return 0;
    const champ = this.championAt(chIdx);
    if (!champ) return 0;
    if (champ.attributes.health === 0) return 0;
    let dealt = damage;
    if (dealt <= 0) return 0;

    if (kind !== 0) {
      // Average the armour over every body part the blow could land on.
      let parts = 0;
      let armourTotal = 0;
      for (let part = 0; part <= 5; part++) {
        if ((woundMask & (1 << part)) === 0) continue;
        parts++;
        // `P4 == 4` sets bit 15 of the index, which halves the shield term and makes
        // `TAG009470` scale rather than take the raw strength
        // (doc/CSBwin-src/Character.cpp:2729-2741).
        armourTotal += this.armourStrength(champ, part, kind === 4);
      }
      const armour = parts !== 0 ? Math.trunc(armourTotal / parts) : 0;

      if (kind === 6) {
        const margin = 115 - champ.attributes.wisdom;
        dealt = margin <= 0 ? 0 : scaledMultiply(dealt, 6, margin);
      } else {
        if (kind === 5) {
          dealt = this.attributeScaledReduction(champ, 5, dealt) - (party.spellShield ?? 0);
        } else if (kind === 1) {
          dealt = this.attributeScaledReduction(champ, 6, dealt) - (party.fireShield ?? 0);
        }
        if (dealt <= 0) return 0;
        dealt = scaledMultiply(dealt, 6, 130 - armour);
      }
      if (dealt <= 0) return 0;

      // Wounds. The threshold starts at a vitality-scaled random value and doubles
      // each time, so a big hit marks several body parts
      // (doc/CSBwin-src/Character.cpp:2789-2803).
      let threshold = this.attributeScaledReduction(champ, 4, this.random.below(128) + 10);
      if (dealt > threshold) {
        do {
          const bit = 1 << this.random.below(8);
          champ.wounds = ((champ.wounds ?? 0) | (bit & woundMask)) & 0xffff;
          threshold <<= 1;
          if (dealt <= threshold) break;
        } while (threshold !== 0);
      }
      if (party.sleeping) this.hooks?.wakeUp?.();
    }

    if (dealt <= 0) return 0;

    const health = champ.attributes.health | 0;
    if (dealt >= health) {
      champ.attributes.health = 0;
      this.killCharacter(chIdx);
    } else {
      champ.attributes.health = health - dealt;
    }
    return dealt;
  }

  /**
   * `KillCharacter` (`doc/CSBwin-src/Character.cpp:2526`) — drop everything, leave
   * bones.
   *
   * The bones record carries `value = 2` to mark it as a *dead champion's* bones
   * rather than an ordinary item, and its position in the cell is the champion's own
   * party position, so the bones appear where the champion stood
   * (`doc/CSBwin-src/Character.cpp:2626-2645`).
   */
  killCharacter(chIdx: number): void {
    const party = this.getPartyState();
    const champ = this.championAt(chIdx);
    if (!champ) return;

    champ.alive = false;
    champ.attributes.health = 0;
    champ.incantation = [];

    this.hooks?.dropAllPossessions?.(chIdx);

    const bones = this.createBonesRecord();
    if (bones !== null) {
      const placed = this.dungeon.addObjectToCell(
        new Position(party.position.x, party.position.y, party.position.z),
        withPosition(bones, champ.partyPosition & 0x3),
      );
      if (placed) this.hooks?.registerBones?.(bones, chIdx);
      else this.dungeon.deleteDBEntry(bones);
    }

    // `KillCharacter` ends by looking for a living party member and handing on what the
    // dead champion held (doc/CSBwin-src/Character.cpp:2670-2694). Without this the
    // cursor stays with a corpse and the whole inventory stops responding, because every
    // inventory click is gated on `d.HandChar != -1`.
    //
    // ⚠️ Two of that block's three outcomes are still missing: `d.GameIsLost = 1` when
    // no champion is left, and moving `d.MagicCaster` off the dead champion. Both belong
    // to champion death proper — PLAN.md Phase 13.
    if (chIdx === (party.cursorOwner ?? -1)) {
      const living = party.champions.findIndex((c) => c.alive !== false);
      if (living >= 0) setHandOwner(party, party.champions[living].partyPosition);
      else setHandOwner(party, -1);
    }

    this.hooks?.onChampionDied?.(chIdx);
  }

  private createBonesRecord(): ObjectID | null {
    const data = this.dungeon.getData();
    const db = data.databases.misc;
    if (db.records.length >= 1024) return null;
    db.records.push({
      nextObject: OBJECT_ID_EOF,
      // `value(2)` marks these as a dead champion's bones.
      specialState: 2,
      important: true,
      miscType: MISC_BONES_OF_HERO,
    });
    db.count++;
    return withPosition(encodeMisc(db.records.length - 1), 0);
  }

  /**
   * `CharacterStats`, for the `DetermineThrowingDistance` term in `TAG01680a` and the
   * load term in `Quickness`. Injected after construction because `Game` builds it
   * from tables that arrive with the graphics.
   */
  private characterStats: CharacterStats | null = null;

  setCharacterStats(stats: CharacterStats): void {
    this.characterStats = stats;
  }

  /**
   * `TAG01680a` (`doc/CSBwin-src/Character.cpp:2391`) — how well one body part is
   * protected, 0 to 100.
   *
   * Three contributions, and they are not the obvious ones:
   *
   * 1. **Shields held in either hand.** Each is weighted by `Byte1412[bodyPart]`,
   *    so a shield protects some parts far better than others, and by whether it is
   *    in the hand the blow came at.
   * 2. **A vitality-scaled random term**, plus the champion's current shield spell,
   *    the party shield, and the temporary modifier the champion's own attack type
   *    imposes. Being mid-swing genuinely leaves you more open.
   * 3. **The garment actually worn on that part**, but only for parts above 1 —
   *    i.e. not the two hands, which are covered by (1).
   *
   * The result is halved and clamped to 0-100 before it reaches the damage scaling.
   *
   * The throwing-distance term in (1) is `DetermineThrowingDistance(chIdx, hand)`
   * (`:2416`) — how well the champion is handling what is in that hand. A shield too
   * heavy for its bearer therefore protects less, which is the same weight-versus-load
   * curve that governs a throw.
   */
  armourStrength(champ: Champion, bodyPart: number, scale: boolean): number {
    let handTotal = 0;
    for (let hand = 0; hand < 2; hand++) {
      const worn = this.clothingTypeIn(champ, hand);
      if (worn === null) continue;
      if (((this.tables?.clothingFlags?.[worn] ?? 0) & 0x80) === 0) continue; // not a shield
      const throwingDistance = this.characterStats?.determineThrowingDistance(
        champ, hand, this.getPartyState().sleeping ?? false,
      ) ?? 0;
      const strength = this.clothingArmourValue(worn, scale) + throwingDistance;
      const weight = this.tables?.byte1412?.[bodyPart] ?? 0;
      const product = (strength * weight) & 0xffff;
      handTotal += product >> (hand === bodyPart ? 4 : 5);
    }

    // Zero to roughly 8 × vitality.
    const spread = Math.trunc(champ.attributes.vitality / 8) + 1;
    let total = (this.random.next() & 0xffff) % spread;
    if (scale) total = Math.trunc(total / 2);

    const party = this.getPartyState();
    total +=
      (champ.attackStatModifier ?? 0) +
      (champ.shieldStrength ?? 0) +
      (party.partyShield ?? 0) +
      handTotal;

    // The garment worn on this part — hands (0 and 1) are the shields handled above.
    if (bodyPart > 1) {
      const worn = this.clothingTypeIn(champ, bodyPart);
      if (worn !== null) total += this.clothingArmourValue(worn, scale);
    }

    return Math.min(100, Math.max(0, total >> 1));
  }

  /**
   * `TAG009470` (`doc/CSBwin-src/Character.cpp:167`) — a garment's armour value,
   * optionally scaled by its own flags rather than taken raw.
   */
  private clothingArmourValue(clothingType: number, scale: boolean): number {
    const strength = this.tables?.clothingArmour?.[clothingType] ?? 0;
    if (!scale) return strength;
    const flags = this.tables?.clothingFlags?.[clothingType] ?? 0;
    return scaledMultiply(strength, 3, (flags & 7) + 4);
  }

  /** The clothing type in a possession slot, or null if it holds something else. */
  private clothingTypeIn(champ: Champion, slot: number): number | null {
    const value = champ.possessions?.[slot];
    if (value === null || value === undefined) return null;
    const rec = this.dungeon.getClothingRecord(value as ObjectID);
    return rec ? rec.clothingType : null;
  }

  /* ------------------------------------------------------------ champion ---- */

  /**
   * `Quickness` (`doc/CSBwin-src/Character.cpp:2209`) — roughly
   * `0.5 * Dexterity * (1 - load/maxLoad/2)`, with random limits near 5 and 95.
   *
   * Delegated to `CharacterStats`, which owns the `MaxLoad` chain. Until that existed
   * the load term was simply missing and a fully-laden champion dodged as well as an
   * empty-handed one.
   */
  quickness(champ: Champion): number {
    const party = this.getPartyState();
    if (this.characterStats) {
      return this.characterStats.quickness(champ, party.sleeping ?? false);
    }
    // No tables yet (a partially constructed engine): the pre-load behaviour.
    let quickness = champ.attributes.dexterity + this.random.below(8);
    if (party.sleeping) quickness = Math.trunc(quickness / 2);
    quickness = Math.trunc(quickness / 2);
    const loLimit = this.random.below(8) + 1;
    const hiLimit = 100 - this.random.below(8);
    return Math.min(hiLimit, Math.max(loLimit, quickness));
  }

  /**
   * `IsCharacterLucky` (`doc/CSBwin-src/Character.cpp:2165`).
   *
   * Two ways to be lucky: a flat coin-toss-and-roll that ignores the attribute
   * entirely, or a roll against current Luck. Either way Luck then moves by 2 —
   * *down* when it saved you, up when it did not, so luck is spent.
   *
   * ⚠️ CSBWin clamps the new value between the attribute's own minimum and maximum;
   * `Champion.luck` here is a plain number with no min/max, so this clamps to 0-255.
   */
  isCharacterLucky(champ: Champion, luckNeeded: number): boolean {
    if (this.random.bool() !== 0 && this.random.below(100) > luckNeeded) return true;
    const currentLuck = champ.attributes.luck | 0;
    const roll = currentLuck === 0 ? 0 : this.random.below(currentLuck);
    const lucky = roll > luckNeeded;
    champ.attributes.luck = Math.min(255, Math.max(0, currentLuck + (lucky ? -2 : 2)));
    return lucky;
  }

  /**
   * `TAG016426` (`doc/CSBwin-src/Character.cpp:2042`) — scale a value down by an
   * attribute: `value * (170 - attribute) / 128`.
   *
   * CSBWin carries a long comment here about a genuine FTL bug — the original stored
   * a word and fetched a byte — which Christophe Fontanel confirmed against the Atari
   * binary. Paul Stevens removed the `/256`, and this follows his corrected version.
   */
  attributeScaledReduction(champ: Champion, attrNum: number, value: number): number {
    const attr = this.attributeByIndex(champ, attrNum);
    const margin = 170 - attr;
    // A very high attribute (above 154) falls into a separate branch that divides by
    // 8 flat rather than scaling (doc/CSBwin-src/Character.cpp:2060-2062).
    if (margin < 16) return value >> 3;
    return scaledMultiply(value, 7, margin);
  }

  /** CSBWin's attribute order: Luck, Strength, Dexterity, Wisdom, Vitality, AntiMagic, AntiFire. */
  private attributeByIndex(champ: Champion, index: number): number {
    const a = champ.attributes;
    switch (index) {
      case 0: return a.luck;
      case 1: return a.strength;
      case 2: return a.dexterity;
      case 3: return a.wisdom;
      case 4: return a.vitality;
      case 5: return a.antiMagic;
      case 6: return a.antiFire;
      default: return 0;
    }
  }

  /**
   * `GetCharacterToDamage` (`doc/CSBwin-src/CSBCode.cpp:6884`) — the first live
   * champion in the order an attack from that side reaches the party, or -1.
   *
   * Only adjacent attackers can reach anyone: `xDist + yDist > 1` returns -1.
   */
  getCharacterToDamage(attackerX: number, attackerY: number, attackerAbsPos: number): number {
    const party = this.getPartyState();
    if (party.champions.length === 0) return -1;
    const xDist = Math.abs(attackerX - (party.position.x | 0));
    const yDist = Math.abs(attackerY - (party.position.y | 0));
    if (xDist + yDist > 1) return -1;

    const order = this.determineAttackOrder(
      party.position.x | 0, party.position.y | 0, attackerX, attackerY, attackerAbsPos,
    );
    for (const pos of order) {
      const champ = party.champions.find((ch) => ch.partyPosition === pos);
      if (champ && champ.alive !== false && champ.attributes.health > 0) {
        return party.champions.indexOf(champ);
      }
    }
    return -1;
  }

  /**
   * `DetermineAttackOrder` (`doc/CSBwin-src/Character.cpp:384`) — pick one of
   * `Byte586`'s eight orderings from the attack direction and which side of the cell
   * it came from.
   *
   * A north or south attack bumps `attackerPos` by one first, which is what makes the
   * left/right split come out on the correct axis.
   */
  determineAttackOrder(
    victimX: number,
    victimY: number,
    attackerX: number,
    attackerY: number,
    attackerPos: number,
  ): number[] {
    const dirs = getPrimaryAndSecondaryDirection(this.random, victimX, victimY, attackerX, attackerY);
    const attackFromDirection = dirs.primary;
    let pos = attackerPos;
    if ((attackFromDirection & 1) === 0) pos++;
    const index = 2 * attackFromDirection + (Math.trunc(pos / 2) & 1);
    const row = this.tables?.byte586?.[index & 0x7];
    if (!row) return [0, 1, 2, 3];
    return [row[0] ?? 0, row[1] ?? 0, row[2] ?? 0, row[3] ?? 0];
  }

  /** `PoisonCharacter` (`doc/CSBwin-src/CSBCode.cpp:7211`). */
  poisonCharacter(chIdx: number, strength: number): void {
    const champ = this.championAt(chIdx);
    if (!champ) return;
    if (strength <= 0) return;
    champ.poisonCount = Math.min(255, (champ.poisonCount ?? 0) + strength);
  }

  /** `RanLiveChar` (`doc/CSBwin-src/Monster.cpp:905`). */
  private randomLiveChampion(): number {
    const party = this.getPartyState();
    const live: number[] = [];
    party.champions.forEach((ch, i) => {
      if (ch.attributes.health > 0) live.push(i);
    });
    if (live.length === 0) return -1;
    return live[this.random.below(live.length)] ?? -1;
  }

  private championAt(chIdx: number): Champion | null {
    if (chIdx < 0) return null;
    return this.getPartyState().champions[chIdx] ?? null;
  }
}

/**
 * `ScaledMultiply(value, shift, factor)` — `value * factor >> shift`, i.e. a fixed
 * point multiply. CSBWin's comment reads `D6*D7/64` for shift 6.
 */
export function scaledMultiply(value: number, shift: number, factor: number): number {
  return (value * factor) >> shift;
}

function encodeMisc(index: number): ObjectID {
  // DBType.MISC is 10; the position bits are set separately.
  return ((10 << 10) | (index & 0x3ff)) as ObjectID;
}

function withPosition(rn: ObjectID, position: number): ObjectID {
  return (((position & 0x3) << 14) | (rn & 0x3fff)) as ObjectID;
}
