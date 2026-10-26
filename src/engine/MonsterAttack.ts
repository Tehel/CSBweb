/**
 * Monsters hitting the party.
 *
 * Ports `MonsterAttacks` (`doc/CSBwin-src/Monster.cpp:948`), `StealFromCharacter`
 * (`:239`) and `MonsterDamagesCharacter` (`:4531`). What the blow then does to the
 * champion is `ChampionDamage`'s.
 *
 * `MonsterAttacks` is not one attack but a decision about *how* to attack: it fills
 * in an `AttackParameters` block — who to hit, whether to throw a missile instead,
 * what missile, how far, how hard — hands it to the Monster Attack Filter DSA to
 * amend, and only then acts on it. That indirection is the whole reason the block
 * exists as a struct in CSBWin, so it is kept as one here.
 */
import { applyLimits, sw } from '../core/intCast';
import { OBJECT_ID_EOF, OBJECT_ID_NULL, type ObjectID } from '../core/types';
import type { CsbRandom } from '../core/random';
import type { CreatureRecord, Item16Record } from '../data/dungeonTypes';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import { getChampionPossession } from '../core/charDesc';
import { getPartyChampion } from './Party';
import { MonsterType, StateOfFear } from './monsterTypes';
import { adjustSkills, AdjustSkillsWhy } from './skills';
import { isAlive, levelDifficulty, masteryOf } from './rules';
import type { MonsterDesc } from '../data/tables/MonsterDesc';
import { monsterWord14_12_15, monsterWord16_8_11, monsterWord2Bit4 } from '../data/tables/MonsterDesc';
import { wakeUp } from './MouseSystem';
import type { AttackParameters } from './filterParameters';

/**
 * The missile "projectile" RNs a monster can throw (`doc/CSBwin-src/CSBTypes.h`, used
 * at `doc/CSBwin-src/Monster.cpp:1045-1080`); `src/core/spellRn.ts` says why they live there.
 */
import {
  RN_DISPELL_MISSILE, RN_FIREBALL, RN_LIGHTNING, RN_POISON,
  RN_POISON_BOLT, RN_POISON_CLOUD, RN_ZO_SPELL,
} from '../core/spellRn';

/**
 * `d.uByte13126[8]`, the slots `StealFromCharacter` tries. CSBWin never writes it, so it
 * is `DBank::Initialize`'s zeroes (see `stealFromCharacter`).
 */
const U_BYTE_13126: ArrayLike<number> = new Uint8Array(8);

const THROWABLE: ReadonlySet<number> = new Set([
  RN_FIREBALL, RN_POISON, RN_LIGHTNING, RN_DISPELL_MISSILE,
  RN_ZO_SPELL, RN_POISON_CLOUD, RN_POISON_BOLT,
]);

export class MonsterAttack {
  private readonly dungeon: DungeonState;
  private readonly random: CsbRandom;

  /**
   * `attackParameters`, the file-scope block `MonsterAttacks` fills in place
   * (`doc/CSBwin-src/Monster.cpp:921-942`), zeroes before the first attack. An attack
   * writes every field again but `disableTime`, which no C++ reads.
   */
  readonly attackParameters: AttackParameters = {
    monsterID: 0, monsterType: 0, monsterIndex: 0, monsterLevel: 0, monsterX: 0, monsterY: 0,
    monsterPos: 0, missileOriginPosition: 0, missileRange: 0, missileDamage: 0, missileDecayRate: 0,
    directionToParty: 0, distanceToParty: 0, missileType: 0, monsterShouldLaunchMissile: 0,
    monsterShouldSteal: 0, heroToDamage: 0, attackSoundOrdinal: 0, disableTime: 0, supressPoison: 0,
  };

  constructor(private readonly ctx: GameContext) {
    this.dungeon = ctx.dungeon;
    this.random = ctx.random;
  }

  /**
   * `MonsterAttacks` (`doc/CSBwin-src/Monster.cpp:948`).
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
    const party = this.ctx.party.state;
    if (party.champions.length === 0) return false;

    // `d.LastMonsterAttackTime = d.Time`, the value `AdjustSkills` scales experience
    // against.
    party.lastMonsterAttackTime = this.ctx.state.tickCount | 0;

    const slot = this.dungeon.getAttachedItem16(monster);
    if (!slot) return false;
    const desc = this.ctx.tables.monsterDesc[monster.creatureType];
    if (!desc) return false;

    if (!this.fillAttackParameters(monsterRn, monster, slot, desc, mapX, mapY, monsterIndex, context)) {
      return false;
    }

    this.ctx.systems.dsa.filters.monsterAttackFilter(this.attackParameters);
    const amended = this.attackParameters;

    if (amended.monsterShouldLaunchMissile !== 0) {
      if (THROWABLE.has(amended.missileType)) {
        // `LaunchMissile` as a monster calls it (`doc/CSBwin-src/Monster.cpp:1198-1207`),
        // on `(RNVAL)attackParameters.missileType` (`:1192`). The projectile is the spell
        // RN itself (`RNFireball` and friends): a spell has no record behind it, so
        // nothing is built for it.
        this.ctx.systems.magic.launchMissile(
          amended.missileType as ObjectID,
          amended.monsterX,
          amended.monsterY,
          context.level,
          amended.missileOriginPosition,
          amended.directionToParty,
          // `ApplyLimits(20, range, 255)` (doc/CSBwin-src/Monster.cpp:1204).
          applyLimits(20, amended.missileRange, 255),
          amended.missileDamage,
          amended.missileDecayRate,
          this.ctx.state.tickCount,
          false,
        );
      }
    } else {
      let chIdx = amended.heroToDamage;
      switch (chIdx) {
        case 0: case 1: case 2: case 3:
          break;
        case 4: // party leader, `d.HandChar` (`doc/CSBwin-src/Monster.cpp:1219-1221`)
          chIdx = party.cursorOwner;
          break;
        case 5: // random live member
          chIdx = this.randomLiveChampion();
          break;
        case 6: // closest
          chIdx = this.ctx.systems.championDamage.getCharacterToDamage(
            amended.monsterX, amended.monsterY, amended.missileOriginPosition,
          );
          if (chIdx < 0) return false;
          break;
        default:
          return false;
      }

      if (amended.monsterShouldSteal !== 0) {
        this.stealFromCharacter(monster, chIdx);
      } else {
        const dealt = 1 + this.monsterDamagesCharacter(monster, chIdx, amended.supressPoison === 1);
        const champ = getPartyChampion(this.ctx.party.state, chIdx);
        // `maxRecentDamage` drives which way the portrait's damage flash points.
        if (champ && dealt > champ.maxRecentDamage) {
          champ.maxRecentDamage = dealt & 0xff;
          champ.damageFromDirection = (amended.directionToParty + 2) & 0x3;
        }
      }
    }

    if (amended.attackSoundOrdinal !== 0) {
      const ordinal = this.ctx.tables.uByte9672[amended.attackSoundOrdinal - 1] ?? 0;
      if (ordinal) this.ctx.sounds.queueSound(ordinal, amended.monsterX, amended.monsterY, 1, context.level);
    }
    return true;
  }

  /**
   * `StealFromCharacter` (`doc/CSBwin-src/Monster.cpp:239`) — the giggler's blow.
   *
   * The less quick the champion, the more tries: `100 - Quickness`, twenty a try, while
   * the champion is not lucky. Each try looks at the slot `d.uByte13126` names (13, the
   * backpack's first slot, meaning a random one of the seventeen), and a filled slot is
   * emptied into the group's possessions. Then, one time in eight, or on a coin toss
   * when something was taken, the group is frightened: fear state 5, and 20-83 in its
   * `ITEM16`'s `uByte5`, as a successful war cry leaves it (`AttackSystem`).
   *
   * `d.uByte13126[8]` is never written in CSBWin: `DBank::Initialize` zeroes all of `d`
   * (`doc/CSBwin-src/CSBCode.cpp:339`), no graphic is loaded over it, and it lies below
   * the 3328 bytes of the save's character block (`Data.h:780-800`). So every try looks at
   * slot 0, the ready hand. `DrawCharacterState` has no counterpart: the panels are drawn
   * from live state.
   */
  private stealFromCharacter(monster: CreatureRecord, chIdx: number): void {
    const champ = getPartyChampion(this.ctx.party.state, chIdx);
    if (!champ) return;
    let w_2 = 0;
    let D7W = sw(100 - sw(this.ctx.systems.championDamage.quickness(champ)));
    let D5W = this.random.below(8);
    while (D7W > 0 && !this.ctx.systems.championDamage.isCharacterLucky(champ, D7W)) {
      let D6W = U_BYTE_13126[D5W]!;
      if (D6W === 13) D6W = sw(D6W + this.random.below(17));
      if (getChampionPossession(champ, D6W) !== OBJECT_ID_NULL) {
        w_2 = 1;
        const objD4 = this.ctx.systems.character.removeCharacterPossession(chIdx, D6W);
        if (monster.possession === OBJECT_ID_EOF) {
          monster.possession = objD4;
        } else {
          this.dungeon.addObjectToChain(objD4, monster.possession);
        }
      }
      D5W = (D5W + 1) & 7;
      D7W = sw(D7W - 20);
    }
    this.random.below(8); // `D0W = STRandom(8)`, overwritten before it is read.
    if (this.random.below(8) === 0 || (w_2 !== 0 && this.random.bool() !== 0)) {
      const pause = this.random.below(64) + 20;
      const slot = this.dungeon.getAttachedItem16(monster);
      if (slot) slot.uByte5 = pause & 0xff;
      monster.fear = StateOfFear.StateOfFear5;
    }
  }

  /**
   * Fill in the attack parameter block (`doc/CSBwin-src/Monster.cpp:990-1126`), field by
   * field in CSBWin's order, which is the order of its random draws: whether to launch,
   * then which missile, then whom to hit, then the range. False where CSBWin returns
   * false (`:1096`): a `word2Bit4` monster that finds no live champion, before the range
   * is drawn.
   *
   * The one piece of real geometry here is `missileOriginPosition`: which corner of
   * the cell the attack comes from. It is the attacking member's own corner, rotated
   * so that "right-hand side of the group as seen facing the party" comes out right.
   */
  private fillAttackParameters(
    monsterRn: ObjectID,
    monster: CreatureRecord,
    slot: Item16Record,
    desc: MonsterDesc,
    mapX: number,
    mapY: number,
    monsterIndex: number,
    context: { level: number; primaryDirectionToParty: number; orthogonalDistanceToParty: number },
  ): boolean {
    const p = this.attackParameters;
    p.supressPoison = -1;
    p.monsterType = monster.creatureType;
    p.monsterIndex = monsterIndex;
    p.monsterLevel = context.level;
    p.monsterID = monsterRn;
    p.directionToParty = context.primaryDirectionToParty;
    p.distanceToParty = context.orthogonalDistanceToParty;

    const positionsByte = slot.positions & 0xff;
    p.monsterPos = (positionsByte >> (2 * monsterIndex)) & 0x3;
    const rightSideMonster =
      positionsByte === 255
        ? this.random.bool()
        : ((p.monsterPos + 5 - p.directionToParty) & 2) / 2;
    p.missileOriginPosition = (rightSideMonster + p.directionToParty) & 0x3;
    p.monsterX = mapX;
    p.monsterY = mapY;

    // Only monsters whose `word14_12_15` is above 1 throw anything, and then only
    // at range or on a coin toss (doc/CSBwin-src/Monster.cpp:1039-1041).
    p.monsterShouldLaunchMissile =
      monsterWord14_12_15(desc) > 1 &&
      (context.orthogonalDistanceToParty > 1 || this.random.bool() !== 0) ? 1 : 0;
    p.missileType = this.chooseMissile(monster.creatureType);
    p.monsterShouldSteal = monster.creatureType === MonsterType.mon_Giggler ? 1 : 0;

    // `word2Bit4` monsters hit a *random* live champion rather than the nearest.
    if (monsterWord2Bit4(desc)) {
      let target = this.random.zeroTo3();
      let tries = 0;
      while (tries < 4 && !isAlive(getPartyChampion(this.ctx.party.state, target))) {
        target = (target + 1) & 0x3;
        tries++;
      }
      // CSBWin's own comment: "For four years we didn't increment heroToDamage!"
      p.heroToDamage = target;
      if (tries === 4) return false;
    } else {
      p.heroToDamage = this.ctx.systems.championDamage.getCharacterToDamage(mapX, mapY, p.missileOriginPosition);
    }

    p.attackSoundOrdinal = desc.attackSound;

    // `attack10 / 4 + 1`, then two rounds of `+= Random(range)`.
    let range = Math.trunc(desc.attack10 / 4) + 1;
    range += this.random.below(range);
    range += this.random.below(range);
    p.missileRange = range;
    p.missileDamage = desc.dexterity12;
    p.missileDecayRate = 8;
    return true;
  }

  /** Which missile a given monster type throws (`doc/CSBwin-src/Monster.cpp:1045-1080`). */
  private chooseMissile(monsterType: number): ObjectID {
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
        // `missile = RNnul` (doc/CSBwin-src/Monster.cpp:1045), stored as its integer,
        // 0xffff (`:1080`).
        return OBJECT_ID_NULL;
    }
  }

  /**
   * `MonsterDamagesCharacter` (`doc/CSBwin-src/Monster.cpp:4531`).
   *
   * Two chances to avoid the blow entirely before any damage is rolled: being quicker
   * than the monster (and winning a 3-in-4 roll), and being lucky. A sleeping party is
   * woken first (`Monster.cpp:4544`), so it gets both like anyone else: the
   * `d.PartySleeping == 0` guard around them (`:4549`) is read after `WakeUp`.
   *
   * The damage itself is deliberately convoluted: a base from the monster's `attack10`
   * reduced by twice the champion's Fighter mastery, then halved, then grown by three
   * separate random terms, then quartered, then possibly reduced again. Ported
   * step-for-step because no simpler form would give the same distribution.
   */
  monsterDamagesCharacter(monster: CreatureRecord, chIdx: number, supressPoison: boolean): number {
    const party = this.ctx.party.state;
    const champ = getPartyChampion(this.ctx.party.state, chIdx);
    if (!champ) return 0;
    if (!isAlive(champ)) return 0;
    if (party.sleeping) wakeUp(this.ctx);

    const desc = this.ctx.tables.monsterDesc[monster.creatureType];
    if (!desc) return 0;
    const experienceTerm = 2 * levelDifficulty(this.ctx);

    // Being attacked trains the Fighter defence skill regardless of the outcome.
    adjustSkills(
      this.ctx, chIdx, 7, monsterWord16_8_11(desc), AdjustSkillsWhy.MonsterDamagesCharacter,
      levelDifficulty(this.ctx),
    );

    if (!party.sleeping) {
      const quickness = this.ctx.systems.championDamage.quickness(champ);
      const monsterRoll = this.random.below(32) + desc.dexterity12 + experienceTerm - 16;
      if (quickness >= monsterRoll && this.random.zeroTo3() !== 0) return 0;
      if (this.ctx.systems.championDamage.isCharacterLucky(champ, 60)) return 0;
    }

    // Where the blow lands. A roll with any of bits 4-6 set walks down `word22`'s
    // nibbles to pick a wound mask; otherwise it is one of the first two body parts
    // (doc/CSBwin-src/Monster.cpp:4559-4573).
    let woundMask: number;
    const roll = this.random.next() & 0xffff;
    if (roll & 0x70) {
      const low = roll & 15;
      let word22 = ((desc.uByte22[0] ?? 0) << 8) | (desc.uByte22[1] ?? 0);
      let index = 0;
      while (low > (word22 & 15)) { word22 >>= 4; index++; }
      woundMask = this.ctx.tables.uByte590[index] ?? 0;
    } else {
      woundMask = roll & 1;
    }

    let damage = experienceTerm + this.random.below(16) + desc.attack10;
    // `DetermineMastery(chIdx, 7)`, no flag: the Firestaff in hand counts, and asleep it is 1.
    damage -= 2 * masteryOf(this.ctx, champ, 7);
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

    const dealt = this.ctx.systems.championDamage.damageCharacter(chIdx, damage, woundMask, desc.uByte22[2] ?? 0);
    if (dealt === 0) return 0;

    // Sound ordinal `chIdx + 9` names *which* champion was hurt.
    this.ctx.sounds.queueSound(chIdx + 9, party.position.x, party.position.y, 2, party.position.z);

    const poison = desc.poisonAttack11;
    if (poison !== 0 && this.random.bool() !== 0) {
      const scaled = this.ctx.systems.championDamage.attributeScaledReduction(champ, 4, poison);
      // CSBWin: "There was an impossible jump around the following function call."
      if (!supressPoison) this.ctx.systems.championDamage.poisonCharacter(chIdx, scaled);
    }
    return dealt;
  }


  /** `RanLiveChar` (`doc/CSBwin-src/Monster.cpp:909`). */
  private randomLiveChampion(): number {
    const party = this.ctx.party.state;
    const live: number[] = [];
    party.champions.forEach((ch, i) => {
      if (isAlive(ch)) live.push(i);
    });
    if (live.length === 0) return -1;
    return live[this.random.below(live.length)] ?? -1;
  }
}
