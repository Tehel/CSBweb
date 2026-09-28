/**
 * The champion's own attacks.
 *
 * Ports `doc/CSBwin-src/Attack.cpp`: `_Attack` (`:1628`) and everything it dispatches
 * to — `AttackWithPhysicalForce` (`:1048`), `DeterminePhysicalAttackDamage` (`:532`),
 * `WarCryEtc` (`:1409`), `AttackWithSpell` (`:1302`), `FluxCage` (`:1549`),
 * `DetermineAttackOrdinal` (`:22`) and the three filter helpers `SetupDSAParam`
 * (`:1346`), `CallAttackFilter` (`:457`) and `PhysicalAttackFilter` (`:483`).
 *
 * The shape to understand first is the **parameter block**. `_Attack` does not compute
 * a blow and apply it; it fills in an `ATTACKPARAMETERS` (`:412`) describing the blow,
 * hands the block to the Party Attack Filter DSA three times over — before it decides
 * anything (`msg` 0), after the attack type's own code has run (`msg` 1), and after
 * everything has been applied (`msg` 2) — and acts on whatever the block says by the
 * end. A dungeon can therefore rewrite any part of an attack. That is why the block is
 * a struct in CSBWin and stays one here, and why the damage functions *return through
 * it* rather than by value.
 *
 * The other thing worth knowing before reading `determinePhysicalAttackDamage`: it is
 * not one formula. It is a hit check (quickness against the monster's dexterity, with
 * two independent second chances), then a damage roll built from the throwing-distance
 * chain and the monster's defence, then a **second, much noisier fallback roll** taken
 * when the first came out at or below 1 — which is what stops a weak champion against a
 * well-armoured monster from being unable to do anything at all. Every step truncates
 * to a signed 16-bit word, and several steps can leave the running total negative, so
 * the `sw()` calls are load-bearing rather than decoration.
 *
 * Lord Chaos's endgame is here too: `_Fusion` (`:133`), and `_FusionSequence` (`:2220`),
 * which a boxed-in Lord Chaos starts and which holds the main loop to the credits.
 */
import { DBType, decodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../core/types';
import { div, sw } from '../core/intCast';
import { nameIndexOf, type GameContext } from './GameContext';
import { getChampionPossession, type Champion } from './gameTypes';
import { getPartyChampion } from './Party';
import { MonsterDamageResult } from './MonsterDamage';
import { TimerFunction } from './TimerQueue';
import type { PartyAttackFilter } from './DsaSystem';
import { waitForButtonFlashScript, type LoopScript } from './LoopState';
import { AttackType, MonsterType, StateOfFear } from './monsterTypes';
import { CloudType } from './cloudTypes';
import { ordinalOfMonsterAtPosition } from './monsterPosition';
import { characterAtPosition } from './AddCharacter';
import {
  RN_DISPELL_MISSILE, RN_FIREBALL, RN_LIGHTNING, RN_POISON_BOLT, RN_POISON_CLOUD,
} from '../core/spellRn';
import { DELTA_X, DELTA_Y } from './MonsterPerception';
import { AdjustSkillsWhy, determineMastery } from './skills';
import type { MonsterDesc } from '../renderer/csbwin/ObjectTables';
import {
  monsterBravery,
  monsterNonMaterial,
  monsterWord16_8_11,
} from '../renderer/csbwin/ObjectTables';


/** `testdelay` (`doc/CSBwin-src/Attack.cpp:19`): every `if (testdelay) VBLDelay(MS2VBL(testdelay))`. */
const TEST_DELAY = 500;

/** `MS2VBL(milliseconds)` (`doc/CSBwin-src/Attack.cpp:17`): 16 ms a VBL, truncated. */
function ms2vbl(milliseconds: number): number {
  return Math.trunc(milliseconds / 16);
}

/**
 * `objNI_*` for the three named blades the damage formula singles out
 * (`doc/CSBwin-src/Objects.h:477-484`). The Vorpal Blade is the one that can touch a
 * non-material monster at all; the other two cut through a monster's defence.
 */
const OBJNI_DIAMOND_EDGE = 39;
const OBJNI_VORPAL_BLADE = 40;
const OBJNI_EXECUTIONER = 43;

/** `ATTACKDATATYPE` (`doc/CSBwin-src/Attack.cpp:264`) — which arm of `ATTDEP` is live. */
export enum AttackDataType {
  ADT_Unset = 0,
  ADT_WarCry = 1,
  ADT_Physical = 2,
  ADT_Spell = 3,
  ADT_HitDoor = 4,
  ADT_Shoot = 5,
  ADT_Flip = 6,
  ADT_Shield = 7,
  ADT_FluxCage = 8,
  ADT_Fusion = 9,
  ADT_Heal = 10,
  ADT_Window = 11,
  ADT_ClimbDown = 12,
  ADT_FreezeLife = 13,
  ADT_Light = 14,
  ADT_Throw = 15,
  ADT_Default = 16,
}

/** `misc_MagicalBoxA` / `misc_MagicalBoxB` (`doc/CSBwin-src/Objects.h:229`). */
const MISC_MAGICAL_BOX_A = 42;
const MISC_MAGICAL_BOX_B = 43;

/**
 * `ATTDEP` (`doc/CSBwin-src/Attack.cpp:398`) — the per-attack-type half of the block.
 *
 * A union in C++, so exactly one arm is meaningful at a time and `dataType` says which.
 * Kept as named arms here rather than six raw words, because the physical-attack code
 * is much harder to check against the C++ when written as `attdep[0]`; the marshalling
 * to and from the DSA's flat parameter array picks the live arm from `dataType`.
 */
export interface AttDep {
  warcryetc: { mastery: number; skillIncrement: number; effectiveMastery: number; requiredMastery: number };
  physicalAttack: { monsterDamage: number; staminaAdjust: number; skillAdjust: number; attackedMonsterOrdinal: number };
  spellAttack: { spellRange: number; spellType: number; decrementCharges: number };
  hitDoor: { strength: number };
  shoot: { success: number; range: number; damage: number; decayRate: number };
  flip: { heads: number };
  shield: { mustHaveMana: number; strength: number };
  heal: { HPIncrement: number };
  freezeLife: { oldTime: number; deltaTime: number };
  light: { deltaLight: number; decayRate: number; time: number };
  thro: { side: number; abort: number; facing: number; range: number; damage: number; decayRate: number };
}

/** `ATTACKPARAMETERS` (`doc/CSBwin-src/Attack.cpp:412`). */
export interface PartyAttackParameters {
  charIdx: number;
  attackType: number;
  attackX: number;
  attackY: number;
  /** 0 when there is no monster, otherwise the monster's RN as an integer. */
  monsterUnderAttack: number;
  monsterType: number;
  skillNumber: number;
  staminaCost: number;
  experienceGained: number;
  disableTime: number;
  neededMana: number;
  /** CSBWin's `unused` word, kept so the DSA's parameter offsets line up. */
  unused: number;
  decrementCharges: number;
  activateMonster: number;
  userInfo: number[];
  dataType: AttackDataType;
  attdep: AttDep;
}

function createAttDep(): AttDep {
  return {
    warcryetc: { mastery: 0, skillIncrement: 0, effectiveMastery: 0, requiredMastery: 0 },
    physicalAttack: { monsterDamage: 0, staminaAdjust: 0, skillAdjust: 0, attackedMonsterOrdinal: 0 },
    spellAttack: { spellRange: 0, spellType: 0, decrementCharges: 0 },
    hitDoor: { strength: 0 },
    shoot: { success: 0, range: 0, damage: 0, decayRate: 0 },
    flip: { heads: 0 },
    shield: { mustHaveMana: 0, strength: 0 },
    heal: { HPIncrement: 0 },
    freezeLife: { oldTime: 0, deltaTime: 0 },
    light: { deltaLight: 0, decayRate: 0, time: 0 },
    thro: { side: 0, abort: 0, facing: 0, range: 0, damage: 0, decayRate: 0 },
  };
}

/** `memset(pDSAparameters+1, 0, sizeof(*pParam))` (`doc/CSBwin-src/Attack.cpp:1362`). */
function createAttackParameters(): PartyAttackParameters {
  return {
    charIdx: 0,
    attackType: 0,
    attackX: 0,
    attackY: 0,
    monsterUnderAttack: 0,
    monsterType: 0,
    skillNumber: 0,
    staminaCost: 0,
    experienceGained: 0,
    disableTime: 0,
    neededMana: 0,
    unused: 0,
    decrementCharges: 0,
    activateMonster: 0,
    userInfo: new Array<number>(10).fill(0),
    dataType: AttackDataType.ADT_Unset,
    attdep: createAttDep(),
  };
}

/**
 * The live arm of the union, as the ordered word list the DSA sees at offset 25.
 *
 * Returns an empty list while `dataType` is unset, which is the state of the block at
 * the `msg` 0 filter call. A DSA writing union words there has nowhere to put them —
 * in CSBWin they would land in whichever arm the attack type later selected, which no
 * dungeon can usefully rely on.
 */
function attdepFields(params: PartyAttackParameters): Array<[object, string]> {
  const a = params.attdep;
  const arm = (obj: Record<string, number>, keys: string[]): Array<[object, string]> =>
    keys.map((k) => [obj, k] as [object, string]);
  switch (params.dataType) {
    case AttackDataType.ADT_WarCry:
      return arm(a.warcryetc, ['mastery', 'skillIncrement', 'effectiveMastery', 'requiredMastery']);
    case AttackDataType.ADT_Physical:
      return arm(a.physicalAttack, ['monsterDamage', 'staminaAdjust', 'skillAdjust', 'attackedMonsterOrdinal']);
    case AttackDataType.ADT_Spell:
      return arm(a.spellAttack, ['spellRange', 'spellType', 'decrementCharges']);
    case AttackDataType.ADT_HitDoor:
      return arm(a.hitDoor, ['strength']);
    case AttackDataType.ADT_Shoot:
      return arm(a.shoot, ['success', 'range', 'damage', 'decayRate']);
    case AttackDataType.ADT_Flip:
      return arm(a.flip, ['heads']);
    case AttackDataType.ADT_Shield:
      return arm(a.shield, ['mustHaveMana', 'strength']);
    case AttackDataType.ADT_Heal:
      return arm(a.heal, ['HPIncrement']);
    case AttackDataType.ADT_FreezeLife:
      return arm(a.freezeLife, ['oldTime', 'deltaTime']);
    case AttackDataType.ADT_Light:
      return arm(a.light, ['deltaLight', 'decayRate', 'time']);
    case AttackDataType.ADT_Throw:
      return arm(a.thro, ['side', 'abort', 'facing', 'range', 'damage', 'decayRate']);
    default:
      return [];
  }
}

/** The 31 `i32` words of `ATTACKPARAMETERS`, in declaration order. */
function marshalParameters(params: PartyAttackParameters): number[] {
  const words: number[] = [
    params.charIdx, params.attackType, params.attackX, params.attackY,
    params.monsterUnderAttack, params.monsterType, params.skillNumber,
    params.staminaCost, params.experienceGained, params.disableTime,
    params.neededMana, params.unused, params.decrementCharges, params.activateMonster,
  ];
  for (let i = 0; i < 10; i++) words.push(params.userInfo[i] ?? 0);
  words.push(params.dataType);
  const fields = attdepFields(params);
  for (let i = 0; i < 6; i++) {
    const field = fields[i];
    words.push(field ? (field[0] as Record<string, number>)[field[1]] ?? 0 : 0);
  }
  return words;
}

function unmarshalParameters(params: PartyAttackParameters, words: ArrayLike<number>): void {
  params.charIdx = words[0] | 0;
  params.attackType = words[1] | 0;
  params.attackX = words[2] | 0;
  params.attackY = words[3] | 0;
  params.monsterUnderAttack = words[4] | 0;
  params.monsterType = words[5] | 0;
  params.skillNumber = words[6] | 0;
  params.staminaCost = words[7] | 0;
  params.experienceGained = words[8] | 0;
  params.disableTime = words[9] | 0;
  params.neededMana = words[10] | 0;
  params.unused = words[11] | 0;
  params.decrementCharges = words[12] | 0;
  params.activateMonster = words[13] | 0;
  for (let i = 0; i < 10; i++) params.userInfo[i] = words[14 + i] | 0;
  // dataType is read back before the union arm, since it selects the arm.
  params.dataType = words[24] | 0;
  const fields = attdepFields(params);
  for (let i = 0; i < fields.length; i++) {
    const [obj, key] = fields[i];
    (obj as Record<string, number>)[key] = words[25 + i] | 0;
  }
}

export class AttackSystem {
  constructor(private readonly ctx: GameContext) {}

  /**
   * `d.MonsterUnderAttack`. A global in CSBWin, read directly by
   * `AttackWithPhysicalForce` and `WarCryEtc` rather than through the parameter block,
   * so a filter that rewrites `pParam->monsterUnderAttack` does *not* change which
   * monster those two look at — only which one `PhysicalAttackFilter` damages.
   */
  private monsterUnderAttack: ObjectID = OBJECT_ID_EOF as ObjectID;

  /** `d.attackDamageToDisplay` — what `FlashAttackDamage` shows next. */
  attackDamageToDisplay = 0;

  /** `d.attackDamageToDisplay` — read and cleared by the UI's damage flash. */
  consumeAttackDamageToDisplay(): number {
    const value = this.attackDamageToDisplay;
    this.attackDamageToDisplay = 0;
    return value;
  }

  // ---------------------------------------------------------------- helpers

  private trace(line: string): void {
    this.ctx.host.trace(line);
  }

  private champions(): Champion[] {
    return this.ctx.party.state.champions;
  }

  private nameIndexOf(rn: ObjectID): number {
    if (rn === OBJECT_ID_NULL) return -1;
    return nameIndexOf(this.ctx, rn);
  }

  /** `d.pCurLevelDesc->experienceMultiplier()`. */
  private levelDifficulty(): number {
    const party = this.ctx.party.state;
    return this.ctx.dungeon.getMap(party.position.z)?.descriptor.difficulty ?? 0;
  }

  private descFor(monsterType: number): MonsterDesc | null {
    return this.ctx.tables.monsterDesc[monsterType] ?? null;
  }

  /** `FindFirstMonster(x, y)` on the party's level. */
  private findFirstMonsterAt(mapX: number, mapY: number): ObjectID {
    return this.ctx.dungeon.findFirstMonster(new Position(mapX, mapY, this.ctx.party.state.position.z));
  }

  /**
   * `CharacterAtPosition` (`doc/CSBwin-src/Code11f52.cpp:4046`), shared with
   * `AddCharacter` and the Vi altar rather than kept as a second copy — the two
   * transcriptions had already drifted apart on whether a dead champion holds a corner.
   */
  private characterAtPosition(pos: number): number {
    return characterAtPosition(this.champions(), pos);
  }

  /**
   * `DetermineAttackOrdinal` (`doc/CSBwin-src/Attack.cpp:22`) — which member of the
   * group in front actually takes the blow, 1-based, or 0 if none can be reached.
   *
   * The champion's own corner picks the search order, so the front-left champion
   * naturally hits the monster on the left. CSBWin's loop has no bound: it walks
   * `DetermineAttackOrder`'s four entries until one holds a monster, and would run off
   * the end of the array if none did. It cannot, because the order is a permutation of
   * all four corners and a group always occupies at least one — but the guard is ours.
   */
  determineAttackOrdinal(attackX: number, attackY: number, partyX: number, partyY: number, charPos: number): number {
    const monsterRn = this.findFirstMonsterAt(attackX, attackY);
    if (monsterRn === OBJECT_ID_EOF) return 0;
    const monster = this.ctx.dungeon.getCreatureRecord(monsterRn);
    if (!monster) return 0;

    const order = this.ctx.systems.monsterAttack.determineAttackOrder(attackX, attackY, partyX, partyY, charPos);
    for (const pos of order) {
      const ordinal = ordinalOfMonsterAtPosition(this.ctx.dungeon, this.ctx.tables.monsterDesc, monster, pos);
      if (ordinal !== 0) return ordinal;
    }
    return 0;
  }

  // ------------------------------------------------------------ the filters

  /** `CallAttackFilter` (`doc/CSBwin-src/Attack.cpp:457`). */
  private callAttackFilter(filter: PartyAttackFilter | null, params: PartyAttackParameters, msg: number): void {
    if (!filter) return;
    const words = this.ctx.systems.dsa.callPartyAttackFilter(filter, marshalParameters(params), msg);
    unmarshalParameters(params, words);
    // "Party attack Filter error: Set illegal character index" — CSBWin puts up a
    // message box and carries on with champion 0.
    if (params.charIdx >= this.champions().length) {
      this.trace('Party attack filter set an illegal character index; using 0');
      params.charIdx = 0;
    }
  }

  /**
   * `PhysicalAttackFilter` (`doc/CSBwin-src/Attack.cpp:483`).
   *
   * The one filter call that *applies* what the block says instead of only reading it:
   * every exit from `DeterminePhysicalAttackDamage` runs through here, and the stamina
   * cost, the skill gain and `DamageMonster` all happen on this side of the DSA. So a
   * filter that zeroes `monsterDamage` really does make the blow harmless.
   */
  private physicalAttackFilter(filter: PartyAttackFilter | null, params: PartyAttackParameters): void {
    params.dataType = AttackDataType.ADT_Physical;
    this.callAttackFilter(filter, params, 1);
    if (params.monsterUnderAttack === 0) return;
    const monsterRn = params.monsterUnderAttack as ObjectID;
    const phys = params.attdep.physicalAttack;

    if (phys.staminaAdjust !== 0) {
      this.ctx.systems.monsterAttack.adjustStamina(params.charIdx, phys.staminaAdjust);
    }
    if (phys.skillAdjust !== 0) {
      this.ctx.systems.magic.applySpellSkillGain(params.charIdx, params.skillNumber, phys.skillAdjust, AdjustSkillsWhy.PhysicalAttack);
    }

    const monster = this.ctx.dungeon.getCreatureRecord(monsterRn);
    if (!monster) return;
    const result = this.ctx.systems.monsterDamage.damageMonster(
      monster,
      phys.attackedMonsterOrdinal - 1,
      this.ctx.party.state.position.z,
      params.attackX,
      params.attackY,
      phys.monsterDamage,
      true,
      false,
    );
    this.trace(`w_2 = DamageMonster() --> ${phys.monsterDamage}`);
    if (result !== MonsterDamageResult.NO_MONSTER_DIED) {
      // Deliberately deferred to the end of `_Attack`: activating the group here would
      // re-enter the Monster Move Filter while the Party Attack Filter is still live.
      params.activateMonster = 1;
    }
  }

  // ------------------------------------------------------- physical attacks

  /**
   * `DeterminePhysicalAttackDamage` (`doc/CSBwin-src/Attack.cpp:532`).
   *
   * Returns the damage dealt, which is also left in
   * `params.attdep.physicalAttack.monsterDamage`. Every early exit still costs 2 or 3
   * stamina and still calls the filter, so a miss is not free.
   *
   * `p7` is `Byte20002[attackType]` and `p8` is `Byte19958[attackType]`: `p7` only ever
   * appears as `75 - p7`, the luck threshold for a second chance at hitting, and `p8`
   * scales the throwing distance into raw damage.
   */
  private determinePhysicalAttackDamage(
    params: PartyAttackParameters,
    filter: PartyAttackFilter | null,
    p7: number,
    p8: number,
    vorpalOrDisrupt: boolean,
  ): number {
    const random = this.ctx.random;
    const champ = getPartyChampion(this.ctx.party.state, params.charIdx);
    const phys = params.attdep.physicalAttack;

    this.trace(
      `Entering DeterminePhysicalAttackDamage(char=${params.charIdx},monster,P7=${p7},P8=${p8},` +
        `skillNumber=${params.skillNumber})`,
    );

    if (params.charIdx >= this.champions().length || !champ) {
      this.physicalAttackFilter(filter, params);
      return 0;
    }
    if ((champ.attributes.health | 0) === 0) {
      this.trace('Character is dead.  Return 0');
      this.physicalAttackFilter(filter, params);
      return 0;
    }

    const levelDifficulty = this.levelDifficulty();
    const monster = this.ctx.dungeon.getCreatureRecord(params.monsterUnderAttack as ObjectID);
    const desc = monster ? this.descFor(monster.creatureType) : null;
    if (!desc) {
      this.physicalAttackFilter(filter, params);
      return 0;
    }
    const nonMaterial = monsterNonMaterial(desc);
    const weaponNI = this.nameIndexOf(getChampionPossession(champ, 1));

    // A non-material monster cannot be touched at all except by the Vorpal Blade or a
    // DISRUPT: the whole formula is skipped and only the stamina is spent.
    if (nonMaterial && !vorpalOrDisrupt) {
      this.trace('pi26 word2 &0x40 != 0  and  w_4 == 0');
      phys.monsterDamage = 0;
      phys.staminaAdjust = 2 + random.bool();
      this.physicalAttackFilter(filter, params);
      return phys.monsterDamage;
    }

    this.trace('pi26 word2 &0x40 == 0  or  vorpalOrDisrupt');

    // --- Did it connect? Quickness against the monster's dexterity, then two
    //     independent second chances: a flat 1-in-4, then Luck.
    const quickness = this.ctx.systems.monsterAttack.quickness(champ);
    let required = sw(random.below(32) + desc.dexterity12 + levelDifficulty - 16);
    let luckyHit = false;
    this.trace(`character's quickenss = ${quickness}`);
    this.trace(`required quickness = ${required}`);
    if (quickness <= required) {
      luckyHit = random.zeroTo3() === 0;
      if (!luckyHit && !this.ctx.systems.monsterAttack.isCharacterLucky(champ, 75 - p7)) {
        this.trace('Attack failed.  Quickness too small. Luck(1/4) failed.  Return 0');
        phys.staminaAdjust = 2 + random.bool();
        this.physicalAttackFilter(filter, params);
        return 0;
      }
    }
    this.trace(
      `Attack was successful because ${
        quickness > required ? "Character's quickness is great enough" : luckyHit ? 'Lucky Hit (1 chance in 4)' : 'IsCharacterLucky returned true'
      }`,
    );

    // --- The damage roll proper.
    const throwingDistance = this.ctx.systems.characterStats.determineThrowingDistance(
      champ, 1, this.ctx.party.state.sleeping,
    );
    let d7 = sw(throwingDistance);
    let d6 = 0;
    this.trace(`D7W = Throwing distance=${d7}`);

    if (throwingDistance !== 0) {
      d7 = sw(d7 + random.below(div(d7, 2) + 1));
      d7 = sw(div(d7 * p8, 32));
      let d4 = sw(random.below(32) + desc.defense08 + levelDifficulty);
      // The two blades that cut through armour.
      if (weaponNI === OBJNI_DIAMOND_EDGE) d4 = sw(d4 - div(d4, 4));
      else if (weaponNI === OBJNI_EXECUTIONER) d4 = sw(d4 - div(d4, 8));
      d7 = sw(d7 + random.below(32) - d4);
      d6 = d7;
      this.trace(`D7W = ${d7}, D4W = ${d4}, D6W = ${d6}`);
    }

    // --- The fallback roll, taken when the first came out at or below 1. Without it a
    //     champion who cannot out-roll the monster's defence could never hurt it.
    if (throwingDistance === 0 || d6 <= 1) {
      d7 = random.zeroTo3();
      this.trace(`Attack may fail.  D7W = random(4) = ${d7}`);
      if (d7 === 0) {
        this.trace('Attack failed because we were not Lucky (D7W==0)');
        phys.staminaAdjust = 2 + random.bool();
        this.physicalAttackFilter(filter, params);
        return 0;
      }
      d6 = sw(d6 + sw(random.below(16)));
      if (d6 > 0 || random.bool() !== 0) {
        d7 = sw(d7 + random.zeroTo3());
        if (random.zeroTo3() === 0) {
          d7 = sw(d7 + Math.max(0, random.below(16) + d6));
        }
      }
    }

    // --- Both roads meet here: halve, add noise, halve twice more.
    d7 = div(d7, 2);
    const spread = d7 === 0 ? 0 : sw(random.below(d7));
    d7 = sw(d7 + random.zeroTo3() + spread);
    if (d7 !== 0) d7 = sw(d7 + random.below(d7));
    d7 = div(d7, 4);
    d7 = sw(d7 + random.zeroTo3() + 1);

    // The Vorpal Blade is built for non-material monsters, so against anything solid it
    // does half damage — and a halved blow that rounds to nothing misses outright.
    if (weaponNI === OBJNI_VORPAL_BLADE && !nonMaterial) {
      d7 = sw(div(d7, 2));
      if (d7 === 0) {
        this.trace('Attack failed because Vorpal, i26 word 2 bit 6=0, and D7W=0');
        phys.staminaAdjust = 2 + random.bool();
        this.physicalAttackFilter(filter, params);
        return 0;
      }
    }

    // A flat +10 for mastery of the attack's own skill, on a 1-in-64-scaled roll.
    const mastery = sw(this.masteryOf(champ, params.skillNumber));
    if (sw(random.below(64)) < mastery) {
      d7 += 10;
      this.trace(`Add 10 to D7W because Mastery(${params.skillNumber})=${mastery} --> ${d7}`);
    }
    if (d7 < 0) d7 = 0;

    phys.monsterDamage = d7;
    // The skill gain scales with the damage *and* with the monster's own experience
    // bits, so hitting something dangerous teaches more.
    phys.skillAdjust = sw(div(d7 * monsterWord16_8_11(desc), 16) + 3);
    phys.staminaAdjust = 4 + random.zeroTo3();
    this.physicalAttackFilter(filter, params);
    this.trace(`PhysicalAttack returning D7W = ${phys.monsterDamage}`);
    return phys.monsterDamage;
  }

  /** `AttackWithPhysicalForce` (`doc/CSBwin-src/Attack.cpp:1048`). */
  private attackWithPhysicalForce(params: PartyAttackParameters, filter: PartyAttackFilter | null): number {
    const party = this.ctx.party.state;
    const tables = this.ctx.tables;
    const champ = getPartyChampion(this.ctx.party.state, params.charIdx);
    const phys = params.attdep.physicalAttack;

    this.trace(`Enter AttackWithPhysicalForce (attackType=${params.attackType}, skillNumber=${params.skillNumber})`);
    this.ctx.sounds.queueSound(16, party.position.x, party.position.y, 1, party.position.z);

    if (this.monsterUnderAttack === OBJECT_ID_EOF) {
      this.trace('No monster in attacked square.  Return 0');
      this.physicalAttackFilter(filter, params);
      return 0;
    }

    phys.monsterDamage = 0;
    phys.staminaAdjust = 0;
    phys.skillAdjust = 0;
    phys.attackedMonsterOrdinal = this.determineAttackOrdinal(
      params.attackX, params.attackY, party.position.x, party.position.y, champ?.partyPosition ?? 0,
    );
    if (phys.attackedMonsterOrdinal === 0) {
      this.trace('No monster can be attacked. Return 0.');
      this.physicalAttackFilter(filter, params);
      return 0;
    }

    // A champion in the back rank cannot swing past the one in front. The two cases
    // that need checking are the champion whose corner is 2 or 3 steps clockwise of
    // the direction being attacked; the intervening corner is 1 or 2 steps along.
    if (champ) {
      const relative = sw((champ.partyPosition + 4 - (champ.facing ?? party.facing)) & 3);
      let step = 0;
      if (relative === 2) step = 2;
      if (relative === 2 || relative === 3) {
        step++;
        if (this.characterAtPosition((champ.partyPosition + step) & 3) !== -1) {
          this.attackDamageToDisplay = -1; // "CAN'T REACH"
          this.trace('Attempt to attack through party member.  Return 0');
          this.physicalAttackFilter(filter, params);
          return 0;
        }
      }
    }

    const monster = this.ctx.dungeon.getCreatureRecord(this.monsterUnderAttack);
    const desc = monster ? this.descFor(monster.creatureType) : null;
    if (params.attackType === AttackType.atk_DISRUPT) {
      if (!desc || !monsterNonMaterial(desc)) {
        this.trace('DISRUPT but monsterDesc bit 6 word2 = 0. Return 0');
        this.physicalAttackFilter(filter, params);
        return 0;
      }
    }

    const p7 = (tables.byte20002[params.attackType] ?? 0) & 0xff;
    const p8 = (tables.byte19958[params.attackType] ?? 0) & 0xff;
    this.trace(`D6W=Byte20002[attackType=${params.attackType}]=${p7}`);
    this.trace(`D7W=Byte19958[attackType=${params.attackType}]=${p8}`);

    const weaponNI = this.nameIndexOf(champ ? getChampionPossession(champ, 1) : OBJECT_ID_NULL);
    const vorpalOrDisrupt = weaponNI === OBJNI_VORPAL_BLADE || params.attackType === AttackType.atk_DISRUPT;
    if (vorpalOrDisrupt) this.trace('VorpalBlade or DISRUPT.');

    this.attackDamageToDisplay = this.determinePhysicalAttackDamage(params, filter, p7, p8, vorpalOrDisrupt);
    return 1;
  }

  // ------------------------------------------------------- the shout attacks

  /**
   * `WarCryEtc` (`doc/CSBwin-src/Attack.cpp:1409`) — WARCRY, CALM, BRANDISH, BLOWHORN
   * and CONFUSE, all of which frighten rather than wound.
   *
   * Each has its own base mastery and skill reward; the champion's mastery of skill 14
   * is added, a random draw against the total is compared with the monster's bravery,
   * and on success the group is knocked into fear state 5 for a while. Bravery 15 means
   * the monster cannot be frightened at all.
   */
  private warCryEtc(params: PartyAttackParameters, filter: PartyAttackFilter | null): number {
    const random = this.ctx.random;
    const wc = params.attdep.warcryetc;
    params.dataType = AttackDataType.ADT_WarCry;
    let success = 0;
    this.trace("Entering 'WarCryEtc' for skill 14(WARCRY, CALM, BRANDISH, BLOWHORN).");

    if (this.monsterUnderAttack === OBJECT_ID_EOF) {
      // "We promised to always call" the filter.
      this.callAttackFilter(filter, params, 1);
      return 0;
    }

    switch (params.attackType) {
      case AttackType.atk_WARCRY: wc.mastery = 3; wc.skillIncrement = 12; break;
      case AttackType.atk_CALM: wc.mastery = 7; wc.skillIncrement = 35; break;
      case AttackType.atk_BRANDISH: wc.mastery = 6; wc.skillIncrement = 30; break;
      case AttackType.atk_BLOWHORN: wc.mastery = 6; wc.skillIncrement = 20; break;
      case AttackType.atk_CONFUSE: wc.mastery = 12; wc.skillIncrement = 45; break;
      default: break;
    }

    const champ = getPartyChampion(this.ctx.party.state, params.charIdx);
    wc.mastery = sw(wc.mastery + sw(champ ? this.masteryOf(champ, 14) : 0));

    const monster = this.ctx.dungeon.getCreatureRecord(this.monsterUnderAttack);
    const desc = monster ? this.descFor(monster.creatureType) : null;
    wc.effectiveMastery = sw(random.below(wc.mastery));
    wc.requiredMastery = desc ? monsterBravery(desc) : 15;
    this.trace(`effectiveMastery = ${wc.effectiveMastery}, requiredMastery = ${wc.requiredMastery}`);

    this.callAttackFilter(filter, params, 1);

    if (wc.requiredMastery > wc.effectiveMastery || wc.requiredMastery === 15) {
      wc.skillIncrement = div(wc.skillIncrement, 2);
      this.trace('Attack Failed and Divide skillIncrement by 2');
    } else if (monster && desc) {
      const level = this.ctx.party.state.position.z;
      const slotIndex = monster.groupIndex & 0xff;
      // A group already in fear state 6 has broken formation to attack; frightening it
      // has to stop the attack and restart its movement timers from scratch.
      if ((monster.fear & 0xf) === StateOfFear.StateOfFear6) {
        this.ctx.systems.monsters.clearAttackingAndDeleteMovementTimers(slotIndex, params.attackX, params.attackY, level);
        this.ctx.systems.monsters.startMonsterMovementTimers(params.attackX, params.attackY, level);
      }
      monster.fear = (monster.fear & ~0xf) | StateOfFear.StateOfFear5;
      // How long the fright lasts: worse bravery means longer, and a slow monster
      // recovers in fewer of its own turns.
      const pause = div(sw(4 * (16 - wc.requiredMastery)), desc.movementTicks06);
      const slot = this.ctx.dungeon.getItem16Record(slotIndex);
      if (slot) slot.uByte5 = pause & 0xff;
      success = 1;
    }

    this.ctx.systems.magic.applySpellSkillGain(params.charIdx, 14, wc.skillIncrement, AdjustSkillsWhy.WarCryEtc);
    return success;
  }

  // ---------------------------------------------------------------- spells

  /** `AttackWithSpell` (`doc/CSBwin-src/Attack.cpp:1302`). */
  private attackWithSpell(
    params: PartyAttackParameters,
    filter: PartyAttackFilter | null,
    range: number,
    projectile: number,
  ): number {
    const champ = getPartyChampion(this.ctx.party.state, params.charIdx);
    if (!champ) return 0;
    this.setCharToPartyFacing(champ);

    // Not enough mana: the spell still goes off, but scaled back proportionally and
    // never shorter than two cells.
    let neededMana = params.neededMana;
    const mana = champ.attributes.mana | 0;
    if (mana < neededMana) {
      range = div(range * mana, neededMana);
      if (range < 2) range = 2;
      neededMana = mana;
    }

    params.dataType = AttackDataType.ADT_Spell;
    params.attdep.spellAttack.spellRange = range;
    params.attdep.spellAttack.spellType = projectile;
    params.neededMana = neededMana;
    params.attdep.spellAttack.decrementCharges = 1;
    this.callAttackFilter(filter, params, 1);

    const success = this.ctx.systems.magic.characterThrowsSpell(
      params.charIdx,
      params.attdep.spellAttack.spellType,
      params.attdep.spellAttack.spellRange,
      params.neededMana,
    );
    if (success === 0) params.experienceGained = div(params.experienceGained, 2);
    if (params.attdep.spellAttack.decrementCharges !== 0) {
      this.decrementChargesRemaining(params.charIdx);
    }
    return success;
  }

  /**
   * `DecrementChargesRemaining` (`doc/CSBwin-src/Attack.cpp:1245`) — spend one charge
   * of whatever is in the fighting hand. Three record types keep their count in three
   * different fields, and a count of zero is left alone rather than wrapping.
   */
  decrementChargesRemaining(chIdx: number): void {
    const champ = getPartyChampion(this.ctx.party.state, chIdx);
    const obj = champ ? getChampionPossession(champ, 1) : OBJECT_ID_NULL;
    if (obj === OBJECT_ID_NULL) return;
    const dungeon = this.ctx.dungeon;
    switch (decodeObjectID(obj).category) {
      case DBType.WEAPON: {
        const rec = dungeon.getWeaponRecord(obj);
        if (rec && rec.charges !== 0) rec.charges = rec.charges - 1;
        break;
      }
      case DBType.CLOTHING: {
        const rec = dungeon.getClothingRecord(obj);
        if (rec && rec.charges !== 0) rec.charges = rec.charges - 1;
        break;
      }
      case DBType.MISC: {
        const rec = dungeon.getMiscRecord(obj);
        if (rec && (rec.specialState ?? 0) !== 0) rec.specialState = (rec.specialState ?? 0) - 1;
        break;
      }
      default:
        break;
    }
  }

  /** `SetCharToPartyFacing` (`doc/CSBwin-src/Attack.cpp:1288`). */
  private setCharToPartyFacing(champ: Champion): void {
    const party = this.ctx.party.state;
    if (champ.facing !== party.facing) champ.facing = party.facing;
  }

  /**
   * `MagicShield` (`doc/CSBwin-src/Attack.cpp:1190`): the spell or fire shield, from the
   * shield attacks and from `CastSpell`'s fire shield. Returns CSBWin's `D6W`.
   */
  applyMagicShield(champion: Champion, isSpellShield: boolean, strength: number, mustHaveMana: number): number {
    const party = this.ctx.party.state;
    let fullStrength = strength | 0;
    // CSBWin's `D6W`: 1 normally, 0 when the champion could not pay the full four
    // mana and got half a shield for whatever was left. `_Attack` reads it to decide
    // whether the cast counts.
    let raised = 1;
    if (mustHaveMana !== 0) {
      const mana = champion.attributes.mana | 0;
      if (mana === 0) return 0;
      if (mana < 4) {
        fullStrength = Math.trunc(fullStrength / 2);
        champion.attributes.mana = 0;
        raised = 0;
      } else {
        champion.attributes.mana = mana - 4;
      }
    }
    let add = Math.trunc(fullStrength / 32);
    if (isSpellShield) {
      if (party.spellShield > 50) add = Math.trunc(add / 4);
      party.spellShield = party.spellShield + add;
      this.ctx.systems.magic.queueUtilityTimer(TimerFunction.TT_77, fullStrength, add);
    } else {
      if (party.fireShield > 50) add = Math.trunc(add / 4);
      party.fireShield = party.fireShield + add;
      this.ctx.systems.magic.queueUtilityTimer(TimerFunction.TT_78, fullStrength, add);
    }
    return raised;
  }

  // -------------------------------------------------------------- fluxcage

  /** `IsCellFluxcage` (`doc/CSBwin-src/Attack.cpp:57`). */
  isCellFluxcage(mapX: number, mapY: number): boolean {
    const party = this.ctx.party.state;
    const position = new Position(mapX, mapY, party.position.z);
    const roomType = (this.ctx.dungeon.getCellFlag(position) & 0xff) >> 5;
    if (roomType === RoomType.STONE || roomType === RoomType.STAIRS) return false;
    for (
      let rn = this.ctx.dungeon.findFirstObject(position);
      rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
      rn = this.ctx.dungeon.getDBRecordLink(rn)
    ) {
      if (decodeObjectID(rn).category !== DBType.CLOUD) continue;
      const cloud = this.ctx.dungeon.getCloudRecord(rn);
      if (cloud && cloud.cloudType === CloudType.CT_FLUXCAGE) return true;
    }
    return false;
  }

  /** `IsLordChaosHere` (`doc/CSBwin-src/Attack.cpp:87`). */
  isLordChaosHere(mapX: number, mapY: number): boolean {
    const rn = this.findFirstMonsterAt(mapX, mapY);
    if (rn === OBJECT_ID_EOF) return false;
    const monster = this.ctx.dungeon.getCreatureRecord(rn);
    return !!monster && monster.creatureType === MonsterType.mon_LordChaos;
  }

  /** `legalXY` (`doc/CSBwin-src/Attack.cpp:99`), on the party's level. */
  private legalXY(x: number, y: number): boolean {
    const map = this.ctx.dungeon.getMap(this.ctx.party.state.position.z);
    if (!map) return false;
    if (y < 0 || y >= map.descriptor.height) return false;
    if (x < 0 || x >= map.descriptor.width) return false;
    return true;
  }

  /** `(GetCellFlags(x, y) & 255) >> 5` on the party's level; off the map, stone. */
  private roomTypeAt(x: number, y: number): number {
    return (this.ctx.dungeon.getCellFlag(new Position(x, y, this.ctx.party.state.position.z)) & 255) >> 5;
  }

  /** `IsCellWall` (`doc/CSBwin-src/Attack.cpp:106`). */
  private isCellWall(x: number, y: number): boolean {
    const cf = this.roomTypeAt(x, y);
    return cf === RoomType.STONE || cf === RoomType.FALSEWALL;
  }

  /** `IsCellOpenOrPit` (`doc/CSBwin-src/Attack.cpp:113`). */
  private isCellOpenOrPit(x: number, y: number): boolean {
    const cf = this.roomTypeAt(x, y);
    return cf === RoomType.OPEN || cf === RoomType.PIT;
  }

  /**
   * `IsCellOccupied` (`doc/CSBwin-src/Attack.cpp:120`): a monster, or the party. The level
   * loaded during an attack is the party's, so `d.LoadedLevel == d.partyLevel` holds.
   */
  private isCellOccupied(x: number, y: number): boolean {
    if (this.findFirstMonsterAt(x, y) !== OBJECT_ID_EOF) return true;
    const party = this.ctx.party.state.position;
    return party.x === x && party.y === y;
  }

  /**
   * `_Fusion` (`doc/CSBwin-src/Attack.cpp:133`), the `NewFusion` branch, which the
   * `#define` just above it makes the live one (`:161-213`): a dispell cloud on the square
   * in front, and if Lord Chaos stands there, his escape. The four directions are
   * shuffled (`:163-171`); he steps to the first square next to him
   * that is open or a pit, unoccupied, and neither a Fluxcage nor a wall, and failing
   * that, to the first square two away in a direction whose near square is neither a
   * Fluxcage nor a wall, which may be occupied, and whose far square is on the map, open
   * or a pit, unoccupied and not a Fluxcage (`:172-212`). So he can jump over the party.
   * A `MoveObject` that leaves him in the dungeon (0) starts his movement timers there,
   * and he is gone. Nowhere to go, he is toast (`:213`), and `_FusionSequence` starts
   * (`:259`).
   */
  private fusion(attackX: number, attackY: number): void {
    const level = this.ctx.party.state.position.z;
    const x = sw(attackX);
    const y = sw(attackY);
    const map = this.ctx.dungeon.getMap(level);
    if (!map) return;
    if (x < 0 || x >= map.descriptor.width) return;
    if (y < 0 || y >= map.descriptor.height) return;
    this.ctx.systems.missileEncounter.createCloud(RN_DISPELL_MISSILE, 0xff, x, y, new Position(x, y, level), 0xff);
    if (!this.isLordChaosHere(x, y)) return;
    const lordChaos = this.findFirstMonsterAt(x, y);
    const direction = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
      const j = this.ctx.random.below(i + 1);
      const temp = direction[i]!;
      direction[i] = direction[j]!;
      direction[j] = temp;
    }
    const x1: number[] = [], y1: number[] = [], x2: number[] = [], y2: number[] = [];
    const fluxCageOrWall: boolean[] = [], empty1: boolean[] = [], empty2: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const dx = DELTA_X[direction[i]!]!;
      const dy = DELTA_Y[direction[i]!]!;
      x1[i] = x + dx;
      y1[i] = y + dy;
      x2[i] = x + 2 * dx;
      y2[i] = y + 2 * dy;
      fluxCageOrWall[i] = this.isCellFluxcage(x1[i]!, y1[i]!) || this.isCellWall(x1[i]!, y1[i]!);
      empty1[i] = this.isCellOpenOrPit(x1[i]!, y1[i]!) && !this.isCellOccupied(x1[i]!, y1[i]!);
      empty2[i] = this.legalXY(x2[i]!, y2[i]!)
        && this.isCellOpenOrPit(x2[i]!, y2[i]!)
        && !this.isCellOccupied(x2[i]!, y2[i]!)
        && !this.isCellFluxcage(x2[i]!, y2[i]!);
    }
    const monsters = this.ctx.systems.monsters;
    for (let i = 0; i < 4; i++) {
      if (!fluxCageOrWall[i] && empty1[i]) {
        if (monsters.moveMonster(lordChaos, x, y, x1[i]!, y1[i]!, level).code === 0) {
          monsters.startMonsterMovementTimers(x1[i]!, y1[i]!, level);
          return;
        }
      }
    }
    for (let i = 0; i < 4; i++) {
      if (!fluxCageOrWall[i] && empty2[i]) {
        if (monsters.moveMonster(lordChaos, x, y, x2[i]!, y2[i]!, level).code === 0) {
          monsters.startMonsterMovementTimers(x2[i]!, y2[i]!, level);
          return;
        }
      }
    }
    // "Sorry, Mr. Chaos.  You are toast."
    this.ctx.systems.mainLoop.runScript(this.fusionSequence());
  }

  /**
   * `_FusionSequence` (`doc/CSBwin-src/Attack.cpp:2220`), the end of the game, which holds
   * the main loop to the credits (`LoopScript`): the game won, the light and the shields
   * up, Lord Chaos made all but unkillable and turned to face the party, the Fluxcages on
   * the party's square and his taken away, six fireballs of growing size and six dispells
   * on him, his flicker between `mon_25` and `mon_LordChaos`, a last fireball and dispell,
   * the Grey Lord in his place, every other monster on the level deleted, the texts of
   * cell (0, 0) whose first letters run on from "A", in that order and each for 780 VBLs,
   * "THE END.", and after `VBLDelay(600)` the credits, with `d.CanRestartFromSavegame`
   * cleared. Each step shows through `_ProcessTimersViewportAndSound`, which also runs the
   * timers. An open inventory is hidden first, and once the Grey Lord stands there
   * `d.Word1868` takes the shimmer off the Fluxcages still around him.
   */
  private *fusionSequence(): LoopScript {
    const mainLoop = this.ctx.systems.mainLoop;
    const encounter = this.ctx.systems.missileEncounter;
    const party = this.ctx.party.state;
    const level = party.position.z;
    this.ctx.state.gameWon = true;
    if (party.selectedCharacterIndex >= 0) this.ctx.host.showHideInventory(4);
    yield* waitForButtonFlashScript(this.ctx);
    party.brightness = 200;
    // `SelectPaletteForLightLevel()`: the screen picks the palette from `d.Brightness`
    // whenever it draws (`selectPaletteIndexForLightLevel`).
    party.partyShield = 100;
    party.spellShield = 100;
    party.fireShield = 100;
    // `MarkAllPortraitsChanged()`: the screen draws every portrait on every frame.
    yield* mainLoop.processTimersViewportAndSound();
    const w4 = sw(party.position.x + DELTA_X[party.facing & 3]!);
    const w6 = sw(party.position.y + DELTA_Y[party.facing & 3]!);
    const monster = this.ctx.dungeon.getCreatureRecord(this.findFirstMonsterAt(w4, w6));
    if (!monster) throw new Error('_FusionSequence: no monster in front of the party');
    monster.hp[0] = 10000;
    const monsterDamage = this.ctx.systems.monsterDamage;
    monsterDamage.setMonsterPositionByte(monster, 255, level, false);
    monsterDamage.setMonsterFacingByte(monster, (party.facing + 2) & 3, level, false);
    const squares: Array<[number, number]> = [[party.position.x, party.position.y], [w4, w6]];
    for (const [x, y] of squares) {
      while (this.removeFluxcage(x, y, level)) { /* the next one */ }
    }
    yield* mainLoop.processTimersViewportAndSound();
    const at = new Position(w4, w6, level);
    for (let size = 55; size <= 255; size += 40) {
      encounter.createCloud(RN_FIREBALL, size, w4, w6, at, 255);
      yield* mainLoop.processTimersViewportAndSound();
      yield ms2vbl(TEST_DELAY);
    }
    this.ctx.sounds.queueSound(17, w4, w6, 1, party.position.z);
    monster.creatureType = MonsterType.mon_25;
    yield* mainLoop.processTimersViewportAndSound();
    yield ms2vbl(TEST_DELAY);
    for (let size = 55; size <= 255; size += 40) {
      encounter.createCloud(RN_DISPELL_MISSILE, size, w4, w6, at, 255);
      yield* mainLoop.processTimersViewportAndSound();
      yield ms2vbl(TEST_DELAY);
    }
    for (let d6 = 3; d6 !== 0; d6--) {
      for (let d7 = 4; d7 !== 0; d7--) {
        this.ctx.sounds.queueSound(17, w4, w6, 1, party.position.z);
        monster.creatureType = (d7 & 1) !== 0 ? MonsterType.mon_25 : MonsterType.mon_LordChaos;
        for (let d5 = d6 - 1; d5 !== 0; d5--) {
          yield* mainLoop.processTimersViewportAndSound();
          yield ms2vbl(TEST_DELAY);
        }
      }
    }
    yield* mainLoop.processTimersViewportAndSound();
    yield ms2vbl(400);
    encounter.createCloud(RN_FIREBALL, 0xff, w4, w6, at, 255);
    yield* mainLoop.processTimersViewportAndSound();
    yield ms2vbl(800);
    encounter.createCloud(RN_DISPELL_MISSILE, 0xff, w4, w6, at, 255);
    yield* mainLoop.processTimersViewportAndSound();
    yield ms2vbl(800);
    monster.creatureType = MonsterType.mon_GreyLord;
    yield* mainLoop.processTimersViewportAndSound();
    yield ms2vbl(TEST_DELAY);
    this.ctx.state.word1868 = true;
    yield* mainLoop.processTimersViewportAndSound();
    yield ms2vbl(TEST_DELAY);
    const map = this.ctx.dungeon.getMap(level)!;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        if (this.findFirstMonsterAt(x, y) === OBJECT_ID_EOF) continue;
        if (x === w4 && y === w6) continue;
        // `ProcessMonsterDeleteFilter(…, DMW_Fusion)` first, which is not ported (`DEBT.md` G2).
        monsterDamage.deleteMonster(level, x, y);
      }
    }
    yield* mainLoop.processTimersViewportAndSound();
    yield ms2vbl(TEST_DELAY);
    // The texts of cell (0, 0), `obj_26`. CSBWin's array holds eight, and a ninth text
    // would run past it; no dungeon we load has any there.
    const dungeon = this.ctx.dungeon;
    const texts: ObjectID[] = [];
    for (let rn = dungeon.findFirstObject(new Position(0, 0, level)); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      if (decodeObjectID(rn).category === DBType.TEXT) texts.push(rn);
    }
    const messages = this.ctx.host.messages;
    let letter = 'A'.charCodeAt(0);
    for (let n = texts.length; n !== 0; n--) {
      for (const rn of texts) {
        // `DecodeText(…, 0x8001, 200)` puts a linefeed in front, so the letter is the second
        // byte, and the text is printed from there with the letter turned into a linefeed.
        const text = dungeon.decodeTextString(dungeon.getTextRecord(rn)!, 0x8001, this.ctx.tables.textDecode, 200);
        if (text === null || text.charCodeAt(1) !== letter) continue;
        // `TAG00187e()` (`doc/CSBwin-src/Hint.cpp:1816`) resets the hint oracle's `f.`
        // state, which only the oracle reads.
        messages.printLines(15, '\n' + text.slice(2), this.ctx.state.tickCount);
        yield* mainLoop.processTimersViewportAndSound();
        yield 780;
        letter++;
        break;
      }
    }
    messages.printLines(0, '\n', this.ctx.state.tickCount);
    messages.printLines(15, 'THE END.', this.ctx.state.tickCount);
    messages.printLines(0, '\n', this.ctx.state.tickCount);
    yield 600;
    mainLoop.clearCanRestartFromSavegame();
    yield* mainLoop.showCreditsAndEnd();
  }

  /**
   * One pass of `_FusionSequence`'s cage removal (`doc/CSBwin-src/Attack.cpp:2288-2302`):
   * the first Fluxcage from the square's first drawable object on
   * (`FindFirstDrawableObject`, `CSBCode.cpp:5140`) taken out of the square
   * (`RemoveObjectFromRoom`). Says whether there was one.
   */
  private removeFluxcage(x: number, y: number, level: number): boolean {
    const dungeon = this.ctx.dungeon;
    const position = new Position(x, y, level);
    let rn = dungeon.findFirstObject(position);
    while (rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL && decodeObjectID(rn).category < DBType.CREATURE) {
      rn = dungeon.getDBRecordLink(rn);
    }
    for (; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = dungeon.getDBRecordLink(rn)) {
      if (decodeObjectID(rn).category !== DBType.CLOUD) continue;
      if (dungeon.getCloudRecord(rn)?.cloudType !== CloudType.CT_FLUXCAGE) continue;
      dungeon.removeObjectFromCell(position, rn);
      return true;
    }
    return false;
  }

  /**
   * `FluxCage` (`doc/CSBwin-src/Attack.cpp:1549`).
   *
   * Drops a Fluxcage in the cell, then looks for Lord Chaos in any of the four
   * neighbours. If he is there and three of *his* four neighbours are already caged, he
   * is boxed in and the group is flagged for activation — which is how the fusion
   * sequence is meant to start.
   *
   * ⚠️ CSBWin's `cageCount` tests `(LCX, LCY-1)` twice and never looks south, which
   * Paul Stevens' rewritten version preserves from the original. Kept as written: it is
   * the behaviour the real game has.
   */
  private fluxCage(mapX: number, mapY: number, params: PartyAttackParameters): void {
    const party = this.ctx.party.state;
    const position = new Position(mapX, mapY, party.position.z);
    const roomType = (this.ctx.dungeon.getCellFlag(position) >> 5) & 7;
    if (roomType === RoomType.STONE || roomType === RoomType.STAIRS) return;
    const cage = this.ctx.systems.missileEncounter.createFluxcage(position, this.ctx.state.tickCount);
    if (cage === null) return;

    const neighbours: Array<[number, number]> = [
      [mapX, mapY - 1], [mapX + 1, mapY], [mapX, mapY + 1], [mapX - 1, mapY],
    ];
    for (const [lcx, lcy] of neighbours) {
      if (!this.isLordChaosHere(lcx, lcy)) continue;
      const cageCount =
        (this.isCellFluxcage(lcx, lcy - 1) ? 1 : 0) +
        (this.isCellFluxcage(lcx + 1, lcy) ? 1 : 0) +
        (this.isCellFluxcage(lcx, lcy - 1) ? 1 : 0) +
        (this.isCellFluxcage(lcx - 1, lcy) ? 1 : 0);
      if (cageCount === 3) {
        params.activateMonster = 1;
        params.attackX = lcx;
        params.attackY = lcy;
      }
      break;
    }
  }

  private masteryOf(champ: Champion, skill: number): number {
    return determineMastery(champ, skill, {
      partySleeping: this.ctx.party.state.sleeping,
      getObjectNameIndex: (objectId: ObjectID) => {
        const value = this.nameIndexOf(objectId as ObjectID);
        return value >= 0 ? value : null;
      },
    });
  }

  // ----------------------------------------------------------------- _Attack

  /**
   * `_Attack` (`doc/CSBwin-src/Attack.cpp:1628`) — one champion's one blow, from the
   * button press to the skill award.
   *
   * Returns CSBWin's `successfulAttack`, which the UI stores but does not use for much;
   * the observable results are all side effects. The order at the end matters and is
   * easy to get wrong: the busy timer, the stamina and the experience are applied
   * *after* the `msg` 2 filter call and after the attack type's own code, and the
   * monster group is woken **last of all** — after the Party Attack Filter is finished
   * with — because activating it re-enters the Monster Move Filter.
   */
  attack(initialChIdx: number, initialAttackType: number): number {
    const party = this.ctx.party.state;
    const champions = this.champions();
    if (initialChIdx >= champions.length) return 0;
    const pChar = champions[initialChIdx];
    if (!pChar) return 0;
    if ((pChar.attributes.health | 0) === 0) return 0;

    const filter = this.ctx.systems.dsa.findPartyAttackFilter();
    const params = createAttackParameters();
    params.charIdx = initialChIdx;
    params.attackType = initialAttackType;

    const facing = (pChar.facing ?? party.facing) & 3;
    params.attackX = party.position.x + DELTA_X[facing];
    params.attackY = party.position.y + DELTA_Y[facing];

    const tables = this.ctx.tables;
    const attackName = tables.attackNames[initialAttackType] ?? String(initialAttackType);
    this.trace(
      `${pChar.name} attacks from ${party.position.z}(${party.position.x},${party.position.y})` +
        ` to ${party.position.z}(${params.attackX},${params.attackY}); attack type = ` +
        `${initialAttackType} = ${attackName}`,
    );

    this.monsterUnderAttack = this.findFirstMonsterAt(params.attackX, params.attackY);
    if (this.monsterUnderAttack !== OBJECT_ID_EOF) {
      params.monsterUnderAttack = this.monsterUnderAttack;
      const monster = this.ctx.dungeon.getCreatureRecord(this.monsterUnderAttack);
      params.monsterType = monster ? monster.creatureType : MonsterType.mon_undefined;
    } else {
      params.monsterUnderAttack = 0;
      params.monsterType = MonsterType.mon_undefined;
    }

    params.disableTime = (tables.byte19914[initialAttackType] ?? 0) & 0xff;
    params.skillNumber = (tables.skillNumber[initialAttackType] ?? 0) & 0xff;
    params.staminaCost = ((tables.byte20046[initialAttackType] ?? 0) & 0xff) + this.ctx.random.bool();
    params.experienceGained = (tables.experienceForAttacking[initialAttackType] ?? 0) & 0xff;
    params.activateMonster = 0;
    this.trace(`Skill number required = ${params.skillNumber}, staminaCost = ${params.staminaCost}, experienceGained = ${params.experienceGained}`);

    const cellFlag = this.ctx.dungeon.getCellFlag(new Position(params.attackX, params.attackY, party.position.z));
    let successfulAttack = 1;

    // The five wizard skills pay mana, and a master pays less — down to one point.
    if (
      params.skillNumber === 16 || params.skillNumber === 17 || params.skillNumber === 18 ||
      params.skillNumber === 19 || params.skillNumber === 3
    ) {
      params.neededMana = sw(7 - Math.min(6, this.masteryOf(pChar, params.skillNumber)));
    } else {
      params.neededMana = 0;
    }

    this.callAttackFilter(filter, params, 0);
    // A filter may cancel the whole attack by making the type negative.
    if (params.attackType < 0) return 0;

    switch (params.attackType) {
      case AttackType.atk_LIGHTNING:
        successfulAttack = this.attackWithSpell(params, filter, 180, RN_LIGHTNING);
        break;
      case AttackType.atk_DISPELL:
        successfulAttack = this.attackWithSpell(params, filter, 150, RN_DISPELL_MISSILE);
        break;
      case AttackType.atk_FIREBALL:
        successfulAttack = this.attackWithSpell(params, filter, 150, RN_FIREBALL);
        break;
      case AttackType.atk_SPIT:
        successfulAttack = this.attackWithSpell(params, filter, 250, RN_FIREBALL);
        break;

      case AttackType.atk_BASH:
      case AttackType.atk_HACK:
      case AttackType.atk_BERZERK:
      case AttackType.atk_KICK:
      case AttackType.atk_SWING:
      case AttackType.atk_CHOP:
        // These six can be aimed at a door instead of a monster: any door that is shut,
        // breakable or not — `HitDoor` checks breakability, and the blow is a hit either
        // way (CSBWin's own "breakable" comment is wrong). Anything else falls through
        // to the melee code.
        if (((cellFlag & 0xff) >> 5) === RoomType.DOOR && (cellFlag & 7) === 4) {
          this.ctx.sounds.queueSound(16, party.position.x, party.position.y, 1, party.position.z);
          params.dataType = AttackDataType.ADT_HitDoor;
          params.disableTime = 6;
          params.attdep.hitDoor.strength =
            this.ctx.systems.characterStats.determineThrowingDistance(pChar, 1, party.sleeping);
          this.callAttackFilter(filter, params, 1);
          this.ctx.systems.missileEncounter.hitDoor(
            new Position(params.attackX, params.attackY, party.position.z),
            params.attdep.hitDoor.strength,
            false, // not a ZO spell
            2, // delay
          );
          this.ctx.sounds.queueSound(4, party.position.x, party.position.y, 2, party.position.z);
          break;
        }
        // NOTE: fallthrough, exactly as CSBWin (`doc/CSBwin-src/Attack.cpp:1804`).
        successfulAttack = this.finishPhysicalAttack(params, filter);
        break;

      case AttackType.atk_DISRUPT:
      case AttackType.atk_JAB:
      case AttackType.atk_PARRY:
      case AttackType.atk_STAB2:
      case AttackType.atk_STAB1:
      case AttackType.atk_STUN:
      case AttackType.atk_THRUST:
      case AttackType.atk_MELEE:
      case AttackType.atk_SLASH:
      case AttackType.atk_CLEAVE:
      case AttackType.atk_PUNCH:
        successfulAttack = this.finishPhysicalAttack(params, filter);
        break;

      case AttackType.atk_CONFUSE:
        this.decrementChargesRemaining(params.charIdx);
        // NOTE: fallthrough (`doc/CSBwin-src/Attack.cpp:1826`).
        successfulAttack = this.warCryEtc(params, filter);
        break;
      case AttackType.atk_WARCRY:
      case AttackType.atk_CALM:
      case AttackType.atk_BRANDISH:
      case AttackType.atk_BLOWHORN:
        successfulAttack = this.warCryEtc(params, filter);
        break;

      case AttackType.atk_SHOOT:
        successfulAttack = this.attackWithShoot(params, filter, pChar);
        break;

      case AttackType.atk_FLIP:
        params.dataType = AttackDataType.ADT_Flip;
        params.attdep.flip.heads = this.ctx.random.bool();
        this.callAttackFilter(filter, params, 1);
        this.ctx.systems.magic.emitSpellMessage(params.attdep.flip.heads !== 0 ? 'IT COMES UP HEADS' : 'IT COMES UP TAILS');
        break;

      case AttackType.atk_SPELLSHIELD:
      case AttackType.atk_FIRESHIELD: {
        params.attdep.shield.mustHaveMana = 1;
        params.attdep.shield.strength = 0x118;
        params.dataType = AttackDataType.ADT_Shield;
        this.callAttackFilter(filter, params, 1);
        // `MagicShield` (`doc/CSBwin-src/Attack.cpp:1190`) — returns its `D6W`.
        const shielded = this.champions()[params.charIdx];
        const raised = shielded
          ? this.applyMagicShield(
            shielded,
            params.attackType === AttackType.atk_SPELLSHIELD,
            params.attdep.shield.strength,
            params.attdep.shield.mustHaveMana,
          )
          : 0;
        // `MagicShield` returns 0 when the champion was down to its last three mana and
        // got only half a shield for them: a botched cast, so most of the reward goes.
        if (raised === 0) {
          params.experienceGained = div(params.experienceGained, 4);
          params.disableTime = div(params.disableTime, 2);
        } else {
          this.decrementChargesRemaining(params.charIdx);
        }
        break;
      }

      case AttackType.atk_INVOKE: {
        const range = this.ctx.random.below(128) + 100;
        let projectile: number;
        switch (this.ctx.random.below(6)) {
          case 0: projectile = RN_POISON_BOLT; break;
          case 1: projectile = RN_POISON_CLOUD; break;
          case 2: projectile = RN_DISPELL_MISSILE; break;
          default: projectile = RN_FIREBALL; break;
        }
        successfulAttack = this.attackWithSpell(params, filter, range, projectile);
        break;
      }

      case AttackType.atk_FLUXCAGE:
        this.setCharToPartyFacing(pChar);
        this.fluxCage(params.attackX, params.attackY, params);
        params.dataType = AttackDataType.ADT_FluxCage;
        this.callAttackFilter(filter, params, 1);
        break;

      case AttackType.atk_FUSE:
        this.setCharToPartyFacing(pChar);
        params.attackX = party.position.x + DELTA_X[party.facing & 3];
        params.attackY = party.position.y + DELTA_Y[party.facing & 3];
        params.dataType = AttackDataType.ADT_Fusion;
        this.callAttackFilter(filter, params, 1);
        this.fusion(params.attackX, params.attackY);
        // `_FusionSequence` has started: `Fusion(_8_, …)` never returns in CSBWin
        // (`doc/CSBwin-src/Attack.cpp:1971`), so none of the attack's tail runs.
        if (this.ctx.systems.mainLoop.isRunningScript()) return successfulAttack;
        break;

      case AttackType.atk_HEAL: {
        params.dataType = AttackDataType.ADT_Heal;
        let neededHP = (pChar.attributes.maxHealth | 0) - (pChar.attributes.health | 0);
        if (neededHP > 0) {
          if ((pChar.attributes.mana | 0) !== 0) {
            successfulAttack = 1;
            params.attdep.heal.HPIncrement = sw(Math.min(10, this.masteryOf(pChar, 13)));
            params.experienceGained = 2;
            this.callAttackFilter(filter, params, 1);
            // Two mana per helping, and the experience grows with every helping — so a
            // badly hurt champion earns much more from one HEAL than a scratched one.
            do {
              const step = sw(Math.min(neededHP, params.attdep.heal.HPIncrement));
              pChar.attributes.health = (pChar.attributes.health | 0) + step;
              params.experienceGained += 2;
              pChar.attributes.mana = (pChar.attributes.mana | 0) - 2;
              if ((pChar.attributes.mana | 0) < 0) break;
              neededHP -= step;
            } while (neededHP !== 0);
            if ((pChar.attributes.mana | 0) < 0) pChar.attributes.mana = 0;
          }
        } else {
          successfulAttack = 0;
          params.attdep.heal.HPIncrement = 0;
          this.callAttackFilter(filter, params, 1);
        }
        break;
      }

      case AttackType.atk_WINDOW: {
        const duration = sw(this.ctx.random.below(this.masteryOf(pChar, params.skillNumber) + 8) + 5);
        // `d.SeeThruWalls++` plus the `TT_73` timer (`doc/CSBwin-src/Attack.cpp:2016`).
        this.ctx.party.state.seeThruWalls = this.ctx.party.state.seeThruWalls + 1;
        this.ctx.systems.magic.queueUtilityTimer(TimerFunction.TT_73, duration, 0);
        params.dataType = AttackDataType.ADT_Window;
        this.callAttackFilter(filter, params, 1);
        this.decrementChargesRemaining(params.charIdx);
        break;
      }

      case AttackType.atk_CLIMBDOWN: {
        params.attackX = party.position.x + DELTA_X[party.facing & 3];
        params.attackY = party.position.y + DELTA_Y[party.facing & 3];
        const target = new Position(params.attackX, params.attackY, party.position.z);
        const roomType = (this.ctx.dungeon.getCellFlag(target) & 0xff) >> 5;
        // Climbing down is only possible into an empty pit; anything in it and the
        // party stays put, and does not even lose a turn.
        if (roomType === RoomType.PIT && this.findFirstMonsterAt(params.attackX, params.attackY) === OBJECT_ID_EOF) {
          this.climbDownIntoPit(target);
        } else {
          params.disableTime = 0;
        }
        params.dataType = AttackDataType.ADT_ClimbDown;
        this.callAttackFilter(filter, params, 1);
        break;
      }

      case AttackType.atk_FREEZELIFE: {
        // A magical box is consumed outright and is worth far more than the ordinary
        // charge-spending path; the two boxes differ tenfold.
        let delta = 0;
        const held = getChampionPossession(pChar, 1);
        const misc = held !== OBJECT_ID_NULL && decodeObjectID(held).category === DBType.MISC
          ? this.ctx.dungeon.getMiscRecord(held)
          : null;
        if (misc) {
          if (misc.miscType === MISC_MAGICAL_BOX_A) delta = 30;
          if (misc.miscType === MISC_MAGICAL_BOX_B) delta = 125;
        }
        if (delta !== 0 && held !== OBJECT_ID_NULL) {
          this.ctx.systems.character.removeCharacterPossession(params.charIdx, 1);
          this.ctx.dungeon.deleteDBEntry(held);
        } else {
          delta = 70;
          this.decrementChargesRemaining(params.charIdx);
        }
        params.dataType = AttackDataType.ADT_FreezeLife;
        params.attdep.freezeLife.oldTime = party.freezeLifeTimer;
        if (party.freezeLifeTimer + delta > 200) delta = 200 - party.freezeLifeTimer;
        if (delta < 0) delta = 0;
        params.attdep.freezeLife.deltaTime = delta;
        this.callAttackFilter(filter, params, 1);
        party.freezeLifeTimer = Math.min(255, party.freezeLifeTimer + params.attdep.freezeLife.deltaTime) & 0xff;
        break;
      }

      case AttackType.atk_LIGHT:
        params.dataType = AttackDataType.ADT_Light;
        params.attdep.light.deltaLight = this.ctx.tables.word1074[2] ?? 0;
        params.attdep.light.time = 2500;
        params.attdep.light.decayRate = -2;
        this.callAttackFilter(filter, params, 1);
        // `d.Brightness += delta`, then `SetBrightnessTimer(decayRate, time)`.
        party.brightness = sw(party.brightness + params.attdep.light.deltaLight);
        this.ctx.systems.magic.setBrightnessTimer(params.attdep.light.decayRate, params.attdep.light.time);
        this.decrementChargesRemaining(params.charIdx);
        break;

      case AttackType.atk_THROW: {
        this.setCharToPartyFacing(pChar);
        const pos = pChar.partyPosition;
        const side = pos === ((party.facing + 1) & 3) || pos === ((party.facing + 2) & 3) ? 1 : 0;
        params.dataType = AttackDataType.ADT_Throw;
        params.disableTime = -1;
        params.attdep.thro.side = side;
        params.attdep.thro.abort = 0;
        params.attdep.thro.facing = party.facing;
        params.attdep.thro.range = -1;
        params.attdep.thro.damage = -1;
        params.attdep.thro.decayRate = -1;
        this.callAttackFilter(filter, params, 1);
        if (params.attdep.thro.abort === 0) {
          successfulAttack = this.ctx.systems.mouse.throwFromWeaponHand({
            chIdx: params.charIdx,
            side: params.attdep.thro.side,
            disableTime: params.disableTime,
            range: params.attdep.thro.range,
            damage: params.attdep.thro.damage,
            decayRate: params.attdep.thro.decayRate,
          });
        } else {
          successfulAttack = 0;
        }
        if (successfulAttack !== 0) {
          // `ThrowByCharacter` has already set the busy timer. Its `uByte6` is what
          // refills the hand when the timer expires, so it is written here and
          // `disableTime` is zeroed — a second `DisableCharacterAction` below would
          // clear that byte and the champion's hand would never be refilled.
          if (params.disableTime > 255) params.disableTime = 255;
          this.setBusyTimerRefill(params.charIdx, params.disableTime < 0 ? 2 : params.disableTime);
          params.disableTime = 0;
        }
        break;
      }

      default:
        params.dataType = AttackDataType.ADT_Default;
        this.callAttackFilter(filter, params, 1);
        break;
    }

    this.callAttackFilter(filter, params, 2);
    if (params.disableTime !== 0) {
      this.ctx.systems.magic.disableCharacterAction(params.charIdx, params.disableTime);
    }
    if (params.staminaCost !== 0) {
      this.ctx.systems.monsterAttack.adjustStamina(params.charIdx, params.staminaCost);
    }
    if (params.experienceGained !== 0) {
      this.ctx.systems.magic.applySpellSkillGain(params.charIdx, params.skillNumber, params.experienceGained, AdjustSkillsWhy.Attack);
    }
    if (params.activateMonster !== 0) {
      // `ProcessTimers29to41(x, y, TT_M1, 0)` — wake the group we just hit.
      this.ctx.systems.monsterAI.processTimers29to41({
        mapX: params.attackX,
        mapY: params.attackY,
        level: party.position.z,
        timerFunction: TimerFunction.TT_M1,
        timeUntilAlternateUpdate: 0,
      });
    }
    return successfulAttack;
  }

  /** The melee tail shared by the two arms of `_Attack`'s fallthrough. */
  private finishPhysicalAttack(params: PartyAttackParameters, filter: PartyAttackFilter | null): number {
    const successfulAttack = this.attackWithPhysicalForce(params, filter);
    // A missed swing still tires the champion but teaches half as much and frees them
    // again twice as fast.
    if (successfulAttack === 0) {
      params.experienceGained = div(params.experienceGained, 2);
      params.disableTime = div(params.disableTime, 2);
    }
    return successfulAttack;
  }

  /**
   * `atk_SHOOT` (`doc/CSBwin-src/Attack.cpp:1841`) — a bow or a sling, which fires
   * whatever is in the *shield* hand.
   *
   * The ammunition has to match: weapon classes 16-31 need `uByte1 == 10` (arrows),
   * 32-47 need `uByte1 == 11` (slingstones). Getting it wrong flashes "NEED AMMO" and
   * costs nothing.
   *
   * ⚠️ CSBWin overwrites the damage it just computed with the weapon's class byte —
   * `pParam->attdep.shoot.damage = D4W` immediately after
   * `= 2 * (pWeapon_18->word4 + w_42)` (`:1905-1906`). It is plainly a bug, and it is
   * what the real game does, so it is kept: a shot's damage is the weapon class, not
   * the mastery-scaled figure.
   */
  private attackWithShoot(
    params: PartyAttackParameters,
    filter: PartyAttackFilter | null,
    pChar: Champion,
  ): number {
    const party = this.ctx.party.state;
    params.dataType = AttackDataType.ADT_Shoot;
    params.attdep.shoot.success = 0;

    const needAmmo = (): number => {
      this.attackDamageToDisplay = -2; // "NEED AMMO"
      params.experienceGained = 0;
      this.callAttackFilter(filter, params, 1);
      return 0;
    };

    const ammo = getChampionPossession(pChar, 0);
    if (ammo === OBJECT_ID_NULL || decodeObjectID(ammo).category !== DBType.WEAPON) return needAmmo();

    const weapon = getChampionPossession(pChar, 1);
    const launcherDesc = weapon !== OBJECT_ID_NULL ? this.ctx.systems.characterStats.weaponDescFor(weapon) ?? null : null;
    const ammoDesc = this.ctx.systems.characterStats.weaponDescFor(ammo) ?? null;
    if (!launcherDesc || !ammoDesc) return needAmmo();

    let weaponClass = launcherDesc.uByte1;
    if (weaponClass >= 16 && weaponClass <= 31) {
      if (ammoDesc.uByte1 !== 10) return needAmmo();
      weaponClass -= 16;
    } else if (weaponClass >= 32 && weaponClass <= 47) {
      if (ammoDesc.uByte1 !== 11) return needAmmo();
      weaponClass -= 32;
    }

    this.setCharToPartyFacing(pChar);
    const projectile = this.ctx.systems.character.removeCharacterPossession(params.charIdx, 0);
    this.ctx.sounds.queueSound(16, party.position.x, party.position.y, 1, party.position.z);
    const mastery = sw(this.masteryOf(pChar, 11));
    params.attdep.shoot.range = launcherDesc.uByte3 + ammoDesc.uByte3;
    params.attdep.shoot.damage = 2 * (launcherDesc.word4 + mastery);
    params.attdep.shoot.damage = weaponClass; // See the ⚠️ above.
    params.attdep.shoot.success = 1;
    this.callAttackFilter(filter, params, 1);
    if (projectile === OBJECT_ID_NULL) return 1;
    this.ctx.systems.magic.launchObject(
      params.charIdx,
      projectile,
      params.attdep.shoot.range,
      params.attdep.shoot.damage,
      params.attdep.shoot.damage,
    );
    return 1;
  }

  /**
   * `atk_CLIMBDOWN` (`doc/CSBwin-src/Attack.cpp:2033`) — into the pit deliberately,
   * which means falling all the way down whatever chain of pits is below.
   *
   * CSBWin sets `d.SupressPitDamage` around the move (`Attack.cpp:2031`), so the
   * *first* drop of a controlled descent costs stamina instead of blood. Only the
   * first: the flag is cleared by the fall itself, so a rope onto a stack of pits
   * still hurts for every pit after the one climbed into.
   */
  private climbDownIntoPit(target: Position): void {
    const party = this.ctx.party.state;
    const worldMove = this.ctx.systems.worldMove;
    worldMove.withSupressedPitDamage(() =>
      worldMove.moveParty(party.position.x, party.position.y, target.x, target.y),
    );
  }

  /** The busy timer's `uByte6`, which decides which slot refills the hand (`TT_11`). */
  private setBusyTimerRefill(chIdx: number, value: number): void {
    const champion = this.ctx.party.state.champions[chIdx];
    const index = champion?.busyTimerIndex ?? -1;
    if (index < 0) return;
    const timer = this.ctx.timers.getTimer(index);
    if (timer) timer.uByte6 = value & 0xff;
  }
}
