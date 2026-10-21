/**
 * Monsters hitting the party.
 *
 * Ports `MonsterAttacks` (`doc/CSBwin-src/Monster.cpp:948`) and
 * `MonsterDamagesCharacter` (`:4531`), together with the champion-side chain they
 * drive: `DamageCharacter` (`doc/CSBwin-src/Character.cpp:2708`), `KillCharacter`
 * (`:2531`), `Quickness` (`:2214`), `IsCharacterLucky` (`:2170`), the
 * attribute-scaled reduction `TAG016426` (`:2047`), `GetCharacterToDamage`
 * (`doc/CSBwin-src/CSBCode.cpp:6943`), `DetermineAttackOrder`
 * (`doc/CSBwin-src/Character.cpp:385`) and `PoisonCharacter`
 * (`doc/CSBwin-src/CSBCode.cpp:7270`).
 *
 * `MonsterAttacks` is not one attack but a decision about *how* to attack: it fills
 * in an `AttackParameters` block — who to hit, whether to throw a missile instead,
 * what missile, how far, how hard — hands it to the Monster Attack Filter DSA to
 * amend, and only then acts on it. That indirection is the whole reason the block
 * exists as a struct in CSBWin, so it is kept as one here.
 */
import { characterAtPosition } from './AddCharacter';
import { applyLimits, sw } from '../core/intCast';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, type ObjectID } from '../core/types';
import type { CsbRandom } from '../core/random';
import { MISC_BONES_OF_HERO } from '../core/constants';
import type { CreatureRecord, Item16Record } from '../data/dungeonTypes';
import type { DungeonState } from './DungeonState';
import { nameIndexOf, type GameContext } from './GameContext';
import { CHARFLAG_CHEST_OR_SCROLL, getChampionPossession, type Champion } from './gameTypes';
import { drawCharacterState, getPartyChampion } from './Party';
import { MonsterType, StateOfFear } from './monsterTypes';
import { selectMagicCaster, setHandOwner } from './Party';
import { AttributeIndex, attributeCurrent, championAttribute, setAttributeCurrentWithinLimits } from './attributes';
import { getPrimaryAndSecondaryDirection } from './MonsterPerception';
import { adjustSkills, AdjustSkillsWhy, determineMastery } from './skills';
import type { MonsterDesc } from '../data/tables/MonsterDesc';
import { monsterWord14_12_15, monsterWord16_8_11, monsterWord2Bit4 } from '../data/tables/MonsterDesc';
import { wakeUp } from './LoopState';
import { TimerFunction } from './TimerQueue';
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

  /** The party's level's difficulty, the experience multiplier. */
  private getExperienceMultiplier(): number {
    return this.dungeon.getMap(this.ctx.party.state.position.z)?.descriptor.difficulty ?? 0;
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

    this.ctx.systems.dsa.monsterAttackFilter(this.attackParameters);
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
          chIdx = party.cursorOwner ?? -1;
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
    let D7W = sw(100 - sw(this.quickness(champ)));
    let D5W = this.random.below(8);
    while (D7W > 0 && !this.isCharacterLucky(champ, D7W)) {
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
      while (tries < 4 && (getPartyChampion(this.ctx.party.state, target)?.attributes.health ?? 0) === 0) {
        target = (target + 1) & 0x3;
        tries++;
      }
      // CSBWin's own comment: "For four years we didn't increment heroToDamage!"
      p.heroToDamage = target;
      if (tries === 4) return false;
    } else {
      p.heroToDamage = this.getCharacterToDamage(mapX, mapY, p.missileOriginPosition);
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
    if (champ.attributes.health === 0) return 0;
    if (party.sleeping) wakeUp(this.ctx);

    const desc = this.ctx.tables.monsterDesc[monster.creatureType];
    if (!desc) return 0;
    const experienceTerm = 2 * this.getExperienceMultiplier();

    // Being attacked trains the Fighter defence skill regardless of the outcome.
    adjustSkills(
      this.ctx, chIdx, 7, monsterWord16_8_11(desc), AdjustSkillsWhy.MonsterDamagesCharacter,
      this.getExperienceMultiplier(),
    );

    if (!party.sleeping) {
      const quickness = this.quickness(champ);
      const monsterRoll = this.random.below(32) + desc.dexterity12 + experienceTerm - 16;
      if (quickness >= monsterRoll && this.random.zeroTo3() !== 0) return 0;
      if (this.isCharacterLucky(champ, 60)) return 0;
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
    damage -= 2 * determineMastery(champ, 7, {
      partySleeping: this.ctx.party.state.sleeping,
      getObjectNameIndex: (objectId) => nameIndexOf(this.ctx, objectId),
    });
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
    this.ctx.sounds.queueSound(chIdx + 9, party.position.x, party.position.y, 2, party.position.z);

    const poison = desc.poisonAttack11;
    if (poison !== 0 && this.random.bool() !== 0) {
      const scaled = this.attributeScaledReduction(champ, 4, poison);
      // CSBWin: "There was an impossible jump around the following function call."
      if (!supressPoison) this.poisonCharacter(chIdx, scaled);
    }
    return dealt;
  }

  /**
   * `DamageAllCharacters` (`doc/CSBwin-src/Code11f52.cpp:4416`) — one blow that lands
   * on the whole party, as a fireball or a poison cloud does. Returns how many
   * champions actually took damage.
   *
   * The same eighth-off-the-top spread `DamageMonsterGroup` uses, so the party is hurt
   * unevenly by a single explosion.
   */
  damageAllCharacters(damage: number, woundMask: number, kind: number): number {
    if (damage === 0) return 0;
    const spread = Math.trunc(damage / 8) + 1;
    const base = damage - spread;
    const range = 2 * spread;

    let hurt = 0;
    const party = this.ctx.party.state;
    for (let chIdx = 0; chIdx < party.champions.length; chIdx++) {
      const roll = (this.random.next() & 0xffff) % range;
      if (this.damageCharacter(chIdx, Math.max(1, base + roll), woundMask, kind) !== 0) hurt++;
    }
    return hurt;
  }

  /**
   * `AdjustStamina` (`doc/CSBwin-src/Code11f52.cpp:4451`) — spend or restore stamina.
   *
   * `decrement` is *subtracted*, so a negative value restores. The interesting half is
   * the bottom: stamina never goes below zero, and whatever the decrement overshot by
   * is converted into real damage at half rate — `DamageCharacter(chIdx, over/2, 0, 0)`,
   * with mask and kind both zero, so it bypasses armour and cannot wound. That is how
   * exhaustion kills. The top simply clamps to `MaxStamina`.
   */
  adjustStamina(chIdx: number, decrement: number): void {
    if (chIdx === -1) return;
    const champ = getPartyChampion(this.ctx.party.state, chIdx);
    if (!champ) return;

    const newStamina = (champ.attributes.stamina | 0) - (decrement | 0);
    if (newStamina <= 0) {
      champ.attributes.stamina = 0;
      // `absStamina/2` — C truncation, and `absStamina` is `-newStamina`.
      this.damageCharacter(chIdx, Math.trunc(-newStamina / 2), 0, 0);
      return;
    }
    const maxStamina = champ.attributes.maxStamina | 0;
    champ.attributes.stamina = newStamina > maxStamina ? maxStamina : newStamina;
  }

  /**
   * `DamageCharacter` (`doc/CSBwin-src/Character.cpp:2708`).
   *
   * `kind` is CSBWin's `P4`, and it selects how the blow is mitigated: 1 fire,
   * 5 spell, 6 wisdom-scaled, 2 half armour, anything else full armour. Zero skips
   * mitigation and wounds entirely.
   *
   * Armour is the average of `armourStrength` over every body part the blow could
   * land on, which then scales the damage by `130 - armour`.
   */
  damageCharacter(chIdx: number, damage: number, woundMask: number, kind: number): number {
    const party = this.ctx.party.state;
    // The early guards, in CSBWin's order (`doc/CSBwin-src/Character.cpp:2717-2722`).
    // The recruit standing in a Hall of Champions mirror and a won game both return
    // non-zero, so a caller reading the result sees "damage was dealt".
    let dealt = sw(damage);
    if (chIdx === -1) return 0;
    if (party.potentialChampionIndex === chIdx) return chIdx + 1;
    // `d.Word11694`, only ever set to 1 (`Attack.cpp:2270`, `Timer.cpp:2371`).
    if (this.ctx.state.gameWon) return 1;
    if (dealt <= 0) return 0;
    const champ = getPartyChampion(party, chIdx);
    if (!champ) return 0;
    if (champ.attributes.health === 0) return 0;

    if (kind !== 0) {
      // Average the armour over every body part the blow could land on.
      let parts = 0;
      let armourTotal = 0;
      for (let part = 0; part <= 5; part++) {
        if ((woundMask & (1 << part)) === 0) continue;
        parts++;
        // `P4 == 4` sets bit 15 of the index, which halves the shield term and makes
        // `TAG009470` scale rather than take the raw strength
        // (doc/CSBwin-src/Character.cpp:2734-2746).
        armourTotal += this.armourStrength(champ, part, kind === 4);
      }
      let armour = parts !== 0 ? Math.trunc(armourTotal / parts) : 0;

      if (kind === 6) {
        const margin = 115 - attributeCurrent(champ.attributes.stats[AttributeIndex.Wisdom]);
        dealt = margin <= 0 ? 0 : scaledMultiply(dealt, 6, margin);
      } else {
        if (kind === 5) {
          dealt = sw(this.attributeScaledReduction(champ, 5, dealt) - party.spellShield);
        } else if (kind === 1) {
          dealt = sw(this.attributeScaledReduction(champ, 6, dealt) - party.fireShield);
        } else if (kind === 2) {
          // `P4 == 2` halves the *armour*, not the damage
          // (`doc/CSBwin-src/Character.cpp:2785`) — a pit fall and a poison cloud both
          // get partly through plate. This branch was missing: with the unarmoured
          // fixtures the tools use, `0 >> 1` is still 0, so nothing showed.
          armour >>= 1;
        }
        if (dealt <= 0) return 0;
        // 130 is the neutral point at shift 6 — `dealt * (130 - armour) / 64` — so
        // armour below 65 *amplifies* the blow. That is CSBWin's arithmetic, not a
        // porting slip: an unarmoured champion takes roughly double.
        dealt = scaledMultiply(dealt, 6, 130 - armour);
      }
      if (dealt <= 0) return 0;

      // Wounds. The threshold starts at a vitality-scaled random value and doubles
      // each time, so a big hit marks several body parts
      // (doc/CSBwin-src/Character.cpp:2794-2808).
      let threshold = this.attributeScaledReduction(champ, 4, this.random.below(128) + 10);
      if (dealt > threshold) {
        do {
          const bit = 1 << this.random.below(8);
          // `d.PendingOuches[chIdx] |= D1W` (`:2808`): the tick's
          // `DisplayCharacterDamage` hands them on to `ouches`.
          party.pendingOuches[chIdx] = (party.pendingOuches[chIdx]! | (bit & woundMask)) & 0xffff;
          threshold <<= 1;
          if (dealt <= threshold) break;
        } while (threshold !== 0);
      }
      if (party.sleeping) wakeUp(this.ctx);
    }

    if (dealt <= 0) dealt = 0;

    // The damage filter's DSA may set what is dealt, to anything a word holds
    // (`doc/CSBwin-src/Character.cpp:2834-2898`).
    dealt = sw(this.ctx.systems.dsa.damageCharFilter(chIdx, champ.fingerprint, damage, dealt, woundMask, kind));
    // `d.PendingDamage[chIdx] += D7W` (`:2905`): the HP stay as they are until the tick's
    // `DisplayCharacterDamage`, which takes the sum off, kills, and shows it over the
    // portrait.
    party.pendingDamage[chIdx] = sw(party.pendingDamage[chIdx]! + dealt);
    return dealt;
  }

  /**
   * `DisplayCharacterDamage` (`doc/CSBwin-src/CSBCode.cpp:7143`), once a main-loop tick
   * after `StartQueuedSound` (`:667`): each champion's pending wounds join `ouches`, and
   * the pending damage comes off the HP, killing a champion it would take to 0 or below.
   * A champion who survives has the loss shown over their name, or over their portrait
   * when their inventory is open, until a `TT_12` five ticks on takes it away
   * (`TAG011366`). A second loss before then moves that timer rather than adding one.
   */
  displayCharacterDamage(): void {
    const party = this.ctx.party.state;
    for (let chIdx = 0; chIdx < party.champions.length; chIdx++) {
      const champ = party.champions[chIdx];
      if (!champ) continue;
      const ouches = party.pendingOuches[chIdx]! & 0xffff;
      champ.wounds = (champ.wounds | ouches) & 0xffff;
      party.pendingOuches[chIdx] = 0;
      const damage = sw(party.pendingDamage[chIdx]!);
      if (damage === 0) continue;
      party.pendingDamage[chIdx] = 0;
      if (party.potentialChampionIndex === chIdx) continue;
      const hp = champ.attributes.health | 0;
      if (hp === 0) continue;
      const left = sw(hp - damage);
      if (left <= 0) {
        this.killCharacter(chIdx);
        continue;
      }
      champ.attributes.health = left;
      // `CHARFLAG_statsChanged` / `CHARFLAG_ouches` and the blits of graphic 15 or 16
      // with `TAG014af6(damage, 0, 3)` on it (`:7180-7230`) are the screen's.
      this.ctx.host.displayCharacterDamage(chIdx, damage);
      // The timer that erases it (`:7231-7261`), on `d.partyLevel`.
      const time = (this.ctx.state.tickCount + 5) >>> 0;
      const existing = champ.timerIndex === -1 ? null : this.ctx.timers.getTimer(champ.timerIndex);
      if (existing === null) {
        const entry = this.ctx.timers.createTimerWithUByte5(
          TimerFunction.TT_12, 0, 0, 0, 0, time, party.position.z, chIdx,
        );
        champ.timerIndex = entry.index;
      } else {
        existing.time = time;
        existing.level = party.position.z & 0xff;
        this.ctx.timers.reprioritizeTimer(champ.timerIndex);
      }
    }
  }

  /**
   * `TAG011366` (`doc/CSBwin-src/Timer.cpp:2686`), a `TT_12` coming due: the damage a
   * champion took is no longer shown. The name, or the portrait of an open inventory, is
   * drawn again over it — unless the champion has died since, whose box is the dead one.
   */
  tag011366(chIdx: number): void {
    const champ = getPartyChampion(this.ctx.party.state, chIdx);
    if (!champ) return;
    champ.timerIndex = -1;
    if ((champ.attributes.health | 0) === 0) return;
    this.ctx.host.tag011366(chIdx);
  }

  /**
   * `KillCharacter` (`doc/CSBwin-src/Character.cpp:2531`) — drop everything, leave
   * bones.
   *
   * The bones record carries `value = 2` to mark it as a *dead champion's* bones
   * rather than an ordinary item, and its position in the cell is the champion's own
   * party position, so the bones appear where the champion stood
   * (`doc/CSBwin-src/Character.cpp:2631-2650`).
   */
  killCharacter(chIdx: number): void {
    // The character death filter's DSA, before anything changes (`:2540-2594`).
    this.ctx.systems.dsa.charDeathFilter(chIdx);
    const party = this.ctx.party.state;
    const champ = getPartyChampion(this.ctx.party.state, chIdx);
    if (!champ) return;

    champ.attributes.health = 0;
    champ.incantation = [];
    // A held eye or mouth let go, then `ShowHideInventory(4)`: the inventory closes on a
    // dead champion before its possessions drop (`doc/CSBwin-src/Character.cpp:2602-2627`).
    if (party.selectedCharacterIndex === chIdx) {
      this.ctx.host.releaseEyeOrMouth();
      this.ctx.host.showHideInventory(4);
    }

    this.ctx.systems.character.dropAllPossessions(chIdx);

    // `objD4.pos(charPosition)`, then `MoveObject(objD4, -1, 0, d.partyX, d.partyY)`
    // and `expool.AddChampionBonesRecord(objD4, …)` (`doc/CSBwin-src/Character.cpp:2631-2651`):
    // the bones are set down like the possessions, so over an open pit they fall.
    const bones = this.createBonesRecord();
    if (bones !== null) {
      const objD4 = this.dungeon.rnMaps.setPos(bones, champ.partyPosition & 0x3);
      this.ctx.systems.worldMove.moveObject(objD4, -1, 0, party.position.x, party.position.y, party.position.z);
      // `AddChampionBonesRecord`, whatever the fingerprint (`:2651`): 0 pairs the bones too.
      this.dungeon.addChampionBonesRecord(objD4, champ.fingerprint);
    }

    // `pcA3->facing = (ui8)d.partyFacing`, `maxRecentDamage = 0`
    // (`doc/CSBwin-src/Character.cpp:2655-2656`).
    champ.facing = party.facing;
    champ.maxRecentDamage = 0;
    // `if (pcA3->poisonCount) CurePoison(chIdx)` — a corpse is not poisoned, and the
    // TT_75 timers must not outlive it (`doc/CSBwin-src/Character.cpp:2668-2671`).
    if (champ.poisonCount) this.curePoison(chIdx);

    // `KillCharacter`'s tail (`doc/CSBwin-src/Character.cpp:2675-2699`): find a living
    // party member, and hand on everything the dead champion was holding on to.
    //
    // The search skips the *potential* champion — the one standing in a Hall of
    // Champions mirror who has not been confirmed yet — because they are counted in
    // `d.NumCharacter` but are not really in the party. `potentialChampionIndex` is
    // still always -1 here; Phase 13 step 4 is what sets it.
    const potential = party.potentialChampionIndex;
    let living = -1;
    for (let i = 0; i < party.champions.length; i++) {
      const other = party.champions[i];
      if (!other) continue;
      if (potential === i) continue;
      if ((other.attributes?.health ?? 0) === 0) continue;
      living = i;
      break;
    }

    if (living < 0) {
      // Nobody left. The tick ends the game once its timers have run (`Game.gameTick`).
      party.gameIsLost = true;
      setHandOwner(party, -1, this.ctx.host);
    } else {
      // Both indices are list slots, as `d.HandChar` and `d.MagicCaster` are in CSBWin,
      // and both get the *same* champion.
      if (chIdx === (party.cursorOwner ?? -1)) setHandOwner(party, living, this.ctx.host);
      if (chIdx === (party.magicCasterIndex ?? -1)) selectMagicCaster(party, living);
    }
  }

  private createBonesRecord(): ObjectID | null {
    const rn = this.dungeon.findEmptyDBEntry('misc', {
      nextObject: OBJECT_ID_EOF,
      // `value(2)` marks these as a dead champion's bones.
      specialState: 2,
      important: true,
      miscType: MISC_BONES_OF_HERO,
    }, true); // `FindEmptyDB10Entry(true)` (`doc/CSBwin-src/Character.cpp:2630`)
    return rn === OBJECT_ID_NULL ? null : rn;
  }

  /**
   * `TAG01680a` (`doc/CSBwin-src/Character.cpp:2396`) — how well one body part is
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
   * A wounded part then loses 8 to 11, and a sleeping party's total is halved. The
   * result is halved and clamped to 0-100 before it reaches the damage scaling.
   *
   * The throwing-distance term in (1) is `DetermineThrowingDistance(chIdx, hand)`
   * (`:2421`) — how well the champion is handling what is in that hand. A shield too
   * heavy for its bearer therefore protects less, which is the same weight-versus-load
   * curve that governs a throw.
   */
  armourStrength(champ: Champion, bodyPart: number, scale: boolean): number {
    let handTotal = 0;
    for (let hand = 0; hand < 2; hand++) {
      const obj = getChampionPossession(champ, hand);
      if (obj === OBJECT_ID_NULL || this.dungeon.rnMaps.dbType(obj) !== DBType.CLOTHING) continue;
      const rec = this.dungeon.getClothingRecord(obj);
      if (!rec) continue;
      const worn = rec.clothingType;
      if (((this.ctx.tables.clothingFlags[worn] ?? 0) & 0x80) === 0) continue; // not a shield
      const throwingDistance = this.ctx.systems.characterStats.determineThrowingDistance(
        champ, hand, this.ctx.party.state.sleeping,
      );
      const strength = this.clothingArmourValue(worn, scale) + throwingDistance;
      const weight = this.ctx.tables.byte1412[bodyPart] ?? 0;
      const product = (strength * weight) & 0xffff;
      handTotal += product >> (hand === bodyPart ? 4 : 5);
    }

    // Zero to roughly 8 × vitality.
    const spread = Math.trunc(attributeCurrent(champ.attributes.stats[AttributeIndex.Vitality]) / 8) + 1;
    let total = sw((this.random.next() & 0xffff) % spread);
    if (scale) total = Math.trunc(total / 2);

    const party = this.ctx.party.state;
    total = sw(
      total +
      champ.attackStatModifier +
      champ.shieldStrength +
      party.partyShield +
      handTotal,
    );

    // The garment worn on this part — hands (0 and 1) are the shields handled above.
    if (bodyPart > 1) {
      const obj = getChampionPossession(champ, bodyPart);
      const rec = obj !== OBJECT_ID_NULL && this.dungeon.rnMaps.dbType(obj) === DBType.CLOTHING
        ? this.dungeon.getClothingRecord(obj)
        : null;
      if (rec) total = sw(total + this.clothingArmourValue(rec.clothingType, scale));
    }

    // A wounded part is worth less, and a sleeping party's armour half
    // (`doc/CSBwin-src/Character.cpp:2483-2491`).
    if ((champ.wounds & (1 << bodyPart)) !== 0) total = sw(total - (this.random.zeroTo3() + 8));
    if (party.sleeping) total >>= 1;
    return applyLimits(0, total >> 1, 100);
  }

  /**
   * `TAG009470` (`doc/CSBwin-src/Character.cpp:168`) — a garment's armour value,
   * optionally scaled by its own flags rather than taken raw.
   */
  private clothingArmourValue(clothingType: number, scale: boolean): number {
    const strength = this.ctx.tables.clothingArmour[clothingType] ?? 0;
    if (!scale) return strength;
    const flags = this.ctx.tables.clothingFlags[clothingType] ?? 0;
    return scaledMultiply(strength, 3, (flags & 7) + 4);
  }


  /* ------------------------------------------------------------ champion ---- */

  /**
   * `Quickness` (`doc/CSBwin-src/Character.cpp:2214`) lives in `CharacterStats`, which
   * owns the `MaxLoad` chain; this supplies `d.PartySleeping`.
   */
  quickness(champ: Champion): number {
    return this.ctx.systems.characterStats.quickness(champ, this.ctx.party.state.sleeping);
  }

  /**
   * `IsCharacterLucky` (`doc/CSBwin-src/Character.cpp:2170`).
   *
   * Two ways to be lucky: a flat coin-toss-and-roll that ignores the attribute
   * entirely, or a roll against current Luck. Either way Luck then moves by 2 —
   * *down* when it saved you, up when it did not, so luck is spent.
   *
   * The new value is held between the attribute's own minimum and maximum, so a
   * champion with a high Luck floor cannot spend below it.
   */
  isCharacterLucky(champ: Champion, luckNeeded: number): boolean {
    if (this.random.bool() !== 0 && this.random.below(100) > luckNeeded) return true;
    const luck = champ.attributes.stats[AttributeIndex.Luck];
    const currentLuck = attributeCurrent(luck);
    const roll = currentLuck === 0 ? 0 : this.random.below(currentLuck);
    const lucky = roll > luckNeeded;
    setAttributeCurrentWithinLimits(luck, currentLuck + (lucky ? -2 : 2));
    return lucky;
  }

  /**
   * `TAG016426` (`doc/CSBwin-src/Character.cpp:2047`) — scale a value down by an
   * attribute: `value * (170 - attribute) / 128`.
   *
   * CSBWin carries a long comment here about a genuine FTL bug — the original stored
   * a word and fetched a byte — which Christophe Fontanel confirmed against the Atari
   * binary. Paul Stevens removed the `/256`, and this follows his corrected version.
   */
  attributeScaledReduction(champ: Champion, attrNum: number, value: number): number {
    const attr = championAttribute(champ, attrNum);
    const margin = 170 - attr;
    // A very high attribute (above 154) falls into a separate branch that divides by
    // 8 flat rather than scaling (doc/CSBwin-src/Character.cpp:2065-2067).
    if (margin < 16) return value >> 3;
    return scaledMultiply(value, 7, margin);
  }

  /**
   * `GetCharacterToDamage` (`doc/CSBwin-src/CSBCode.cpp:6943`) — the first live
   * champion in the order an attack from that side reaches the party, or -1.
   *
   * Only adjacent attackers can reach anyone: `xDist + yDist > 1` returns -1.
   */
  getCharacterToDamage(attackerX: number, attackerY: number, attackerAbsPos: number): number {
    const party = this.ctx.party.state;
    if (party.champions.length === 0) return -1;
    const xDist = Math.abs(attackerX - (party.position.x | 0));
    const yDist = Math.abs(attackerY - (party.position.y | 0));
    if (xDist + yDist > 1) return -1;

    const order = this.determineAttackOrder(
      party.position.x | 0, party.position.y | 0, attackerX, attackerY, attackerAbsPos,
    );
    // `CharacterAtPosition`, the first *living* champion in the corner
    // (`doc/CSBwin-src/CSBCode.cpp:6966`): a recruit may stand in a dead one's.
    for (const pos of order) {
      const chIdx = characterAtPosition(party.champions, pos);
      if (chIdx >= 0) return chIdx;
    }
    return -1;
  }

  /**
   * `DetermineAttackOrder` (`doc/CSBwin-src/Character.cpp:385`) — pick one of
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
    const row = this.ctx.tables.byte586[index & 0x7];
    return [row[0], row[1], row[2], row[3]];
  }

  /**
   * `PoisonCharacter` (`doc/CSBwin-src/CSBCode.cpp:7270`).
   *
   * `strength` is a *tick count*, not a dose. Each call deals `Larger(1, strength/64)`
   * unmitigated damage — mask and kind both zero, so armour and wounds are skipped —
   * then, if any ticks remain, raises `poisonCount` and arms a `TT_75` timer 36 ticks
   * out carrying the decremented count. The timer handler drops `poisonCount` again
   * and calls straight back in here, so the count hovers at 1 for the whole illness
   * and the damage arrives in instalments.
   *
   * A champion still standing in a Hall of Champions mirror is immune, because they
   * are not really in the party yet.
   */
  poisonCharacter(chIdx: number, strength: number): void {
    if (chIdx === -1) return;
    const party = this.ctx.party.state;
    if (party.potentialChampionIndex === chIdx) return;
    const champ = getPartyChampion(this.ctx.party.state, chIdx);
    if (!champ) return;

    this.damageCharacter(chIdx, Math.max(1, Math.trunc(strength / 64)), 0, 0);
    // `CHARFLAG_statsChanged` has no counterpart: the panels are drawn from live state.
    if (chIdx === party.selectedCharacterIndex && this.ctx.interface.displayResurrectChestOrScroll === 0) {
      champ.charFlags |= CHARFLAG_CHEST_OR_SCROLL;
    }

    const remaining = strength - 1;
    if (remaining !== 0) {
      champ.poisonCount = Math.min(255, champ.poisonCount + 1);
      this.ctx.systems.timer.schedulePoison(chIdx, remaining, this.ctx.party.state.position.z);
    }
    drawCharacterState(party, chIdx, 0, this.ctx.host);
  }

  /**
   * `CurePoison` (`doc/CSBwin-src/Character.cpp:3012`) — cancel every outstanding
   * `TT_75` for this champion and clear the count. Anti-venin, and `KillCharacter`.
   */
  curePoison(chIdx: number): void {
    if (chIdx === -1) return;
    this.ctx.systems.timer.cancelPoisonTimers(chIdx);
    const champ = getPartyChampion(this.ctx.party.state, chIdx);
    if (champ) champ.poisonCount = 0;
  }

  /** `RanLiveChar` (`doc/CSBwin-src/Monster.cpp:909`). */
  private randomLiveChampion(): number {
    const party = this.ctx.party.state;
    const live: number[] = [];
    party.champions.forEach((ch, i) => {
      if (ch.attributes.health > 0) live.push(i);
    });
    if (live.length === 0) return -1;
    return live[this.random.below(live.length)] ?? -1;
  }
}

/**
 * `ScaledMultiply(value, shift, factor)` — `value * factor >> shift`, i.e. a fixed
 * point multiply. CSBWin's comment reads `D6*D7/64` for shift 6.
 */
function scaledMultiply(value: number, shift: number, factor: number): number {
  return (value * factor) >> shift;
}
