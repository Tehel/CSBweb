/**
 * The parameter blocks the filters hand their DSAs (`pDSAparameters`), each a C struct
 * the filter copies in a longword at a time and copies back once the DSA has run: the
 * feeding, monster attack, delete monster, party move and spell filters'. Each block's
 * interface sits beside its two codecs, so the filters (`dsa/DsaFilters.ts`) read them
 * without importing the systems that fill them; the spell's is `magicTypes.ts`'s.
 */

import type { SpellParameters } from './magicTypes';

/**
 * `FEEDPARAMETERS` (`doc/CSBwin-src/Character.cpp:3956-3983`).
 *
 * `potionType`/`potionStrength` are marked readonly in CSBWin — the filter may look
 * at them but changing them does nothing, because the switch that reads them has
 * already run.
 */
export interface FeedParameters {
  performFeeding: boolean;
  characterIndex: number;
  objectDB: number;
  objectType: number;
  objectID: number;
  foodValue: number;
  waterValue: number;
  /** Readonly. */
  potionType: number;
  /** Readonly. */
  potionStrength: number;
  strengthAdjust: number;
  dexterityAdjust: number;
  wisdomAdjust: number;
  vitalityAdjust: number;
  antiVenin: boolean;
  staminaAdjust: number;
  shieldStrengthAdjust: number;
  shieldDuration: number;
  manaAdjust: number;
  hitpointAdjust: number;
  healCount: number;
  emptyFlask: boolean;
  emptyHand: boolean;
  chew: boolean;
  /** The sound ordinal, or -1 for silence — CSBWin's `fp.gulp`. */
  gulp: number;
  location: number;
  antiMagicAdjust: number;
  antiFireAdjust: number;
}

/** `FEEDPARAMETERS::Clear` (`doc/CSBwin-src/Character.cpp:3986-4014`). */
export function clearFeedParameters(): FeedParameters {
  return {
    performFeeding: false,
    characterIndex: -1,
    objectDB: -1,
    objectType: -1,
    objectID: -1,
    foodValue: 0,
    waterValue: 0,
    potionType: -1,
    potionStrength: -1,
    strengthAdjust: 0,
    dexterityAdjust: 0,
    wisdomAdjust: 0,
    vitalityAdjust: 0,
    antiVenin: false,
    staminaAdjust: 0,
    shieldStrengthAdjust: 0,
    shieldDuration: 0,
    manaAdjust: 0,
    hitpointAdjust: 0,
    healCount: 0,
    emptyFlask: false,
    emptyHand: false,
    chew: false,
    gulp: -1,
    location: -1,
    antiMagicAdjust: 0,
    antiFireAdjust: 0,
  };
}

/** `sizeof(fp) / 4` (`doc/CSBwin-src/Character.cpp:4351`): the 27 longwords of `FEEDPARAMETERS`. */
export const FEED_PARAMETER_WORDS = 27;

/**
 * `memcpy(pDSAparameters + 1, &fp, sizeof(fp))` (`doc/CSBwin-src/Character.cpp:4350`): the
 * block as the feeding filter's DSA sees it, a longword per field in the struct's order
 * (`:3953-3983`), a `bool32` 1 or 0.
 */
export function feedParametersToWords(fp: FeedParameters): number[] {
  const flag = (value: boolean): number => (value ? 1 : 0);
  return [
    flag(fp.performFeeding), fp.characterIndex, fp.objectDB, fp.objectType, fp.objectID,
    fp.foodValue, fp.waterValue, fp.potionType, fp.potionStrength,
    fp.strengthAdjust, fp.dexterityAdjust, fp.wisdomAdjust, fp.vitalityAdjust,
    flag(fp.antiVenin), fp.staminaAdjust, fp.shieldStrengthAdjust, fp.shieldDuration,
    fp.manaAdjust, fp.hitpointAdjust, fp.healCount,
    flag(fp.emptyFlask), flag(fp.emptyHand), flag(fp.chew), fp.gulp, fp.location,
    fp.antiMagicAdjust, fp.antiFireAdjust,
  ].map((word) => word | 0);
}

/**
 * `memcpy(&fp, pDSAparameters + 1, sizeof(fp))` (`doc/CSBwin-src/Character.cpp:4353`): the
 * block back from the feeding filter's DSA, `word(i)` its longword `i`. A `bool32` is
 * true when it is not 0, as CSBWin's tests of it read it.
 */
export function feedParametersFromWords(word: (index: number) => number): FeedParameters {
  const w = (index: number): number => word(index) | 0;
  return {
    performFeeding: w(0) !== 0,
    characterIndex: w(1),
    objectDB: w(2),
    objectType: w(3),
    objectID: w(4),
    foodValue: w(5),
    waterValue: w(6),
    potionType: w(7),
    potionStrength: w(8),
    strengthAdjust: w(9),
    dexterityAdjust: w(10),
    wisdomAdjust: w(11),
    vitalityAdjust: w(12),
    antiVenin: w(13) !== 0,
    staminaAdjust: w(14),
    shieldStrengthAdjust: w(15),
    shieldDuration: w(16),
    manaAdjust: w(17),
    hitpointAdjust: w(18),
    healCount: w(19),
    emptyFlask: w(20) !== 0,
    emptyHand: w(21) !== 0,
    chew: w(22) !== 0,
    gulp: w(23),
    location: w(24),
    antiMagicAdjust: w(25),
    antiFireAdjust: w(26),
  };
}

/**
 * `ATTACK_PARAMETERES` (`doc/CSBwin-src/Monster.cpp:921-942`), twenty longwords.
 *
 * Kept as one block because the Monster Attack Filter DSA is handed the whole thing
 * and may rewrite any field before it is acted on
 * (`doc/CSBwin-src/Monster.cpp:1129-1175`). The two flags are CSBWin's `i32`s, tested
 * against 0, and `missileType` its `ui32`, so a value the filter writes is kept as written.
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
  monsterShouldLaunchMissile: number;
  monsterShouldSteal: number;
  /** 0-3 a specific champion, 4 the leader, 5 random, 6 closest, -1 none. */
  heroToDamage: number;
  attackSoundOrdinal: number;
  disableTime: number;
  /** CSBWin starts this at -1; only `== 1` suppresses poison. */
  supressPoison: number;
}

/** `sizeof(attackParameters) / 4` (`doc/CSBwin-src/Monster.cpp:1169`): its 20 longwords. */
export const ATTACK_PARAMETER_WORDS = 20;

/**
 * `memcpy(pDSAparameters + 1, &attackParameters, sizeof(attackParameters))`
 * (`doc/CSBwin-src/Monster.cpp:1168`): the block as the monster attack filter's DSA sees
 * it, a longword per field in the struct's order (`:921-942`).
 */
export function attackParametersToWords(p: AttackParameters): number[] {
  return [
    p.monsterID, p.monsterType, p.monsterIndex, p.monsterLevel, p.monsterX, p.monsterY,
    p.monsterPos, p.missileOriginPosition, p.missileRange, p.missileDamage, p.missileDecayRate,
    p.directionToParty, p.distanceToParty, p.missileType, p.monsterShouldLaunchMissile,
    p.monsterShouldSteal, p.heroToDamage, p.attackSoundOrdinal, p.disableTime, p.supressPoison,
  ].map((word) => word | 0);
}

/**
 * `memcpy(&attackParameters, pDSAparameters + 1, sizeof(attackParameters))`
 * (`doc/CSBwin-src/Monster.cpp:1171`): the block back from the DSA into `p`, `word(i)` its
 * longword `i`, a `ui32` field read unsigned.
 */
export function attackParametersFromWords(p: AttackParameters, word: (index: number) => number): void {
  const w = (index: number): number => word(index) | 0;
  const u = (index: number): number => word(index) >>> 0;
  p.monsterID = u(0);
  p.monsterType = u(1);
  p.monsterIndex = u(2);
  p.monsterLevel = w(3);
  p.monsterX = w(4);
  p.monsterY = w(5);
  p.monsterPos = w(6);
  p.missileOriginPosition = w(7);
  p.missileRange = w(8);
  p.missileDamage = w(9);
  p.missileDecayRate = w(10);
  p.directionToParty = w(11);
  p.distanceToParty = w(12);
  p.missileType = u(13);
  p.monsterShouldLaunchMissile = w(14);
  p.monsterShouldSteal = w(15);
  p.heroToDamage = w(16);
  p.attackSoundOrdinal = w(17);
  p.disableTime = w(18);
  p.supressPoison = w(19);
}

/**
 * `DELETEMONSTERWHY` (`doc/CSBwin-src/CSB.h:2976-2985`): why a group, or a member of one,
 * leaves the dungeon. The kill statistics count by it.
 */
export enum DeleteMonsterWhy {
  DMW_Unknown = 0,
  DMW_Fusion = 1,
  DMW_MakeRoom = 2,
  DMW_Damage = 3,
  DMW_Movement1 = 4,
  DMW_Movement2 = 5,
}

/**
 * `DELETEMONSTERPARAMETERS` (`doc/CSBwin-src/CSB.h:2996-3010`): what the delete monster
 * filter's DSA reads and may rewrite. `dropResidue` is 0 for the default, 1 to drop the
 * remains, 2 not to; `deathCloud` 0 for the default, 1 to show the cloud, 2 not to;
 * `index` is the member's in its group, -1 for the whole group.
 */
export interface DeleteMonsterParameters {
  monsterID: number;
  level: number;
  x: number;
  y: number;
  why: DeleteMonsterWhy;
  dropResidue: number;
  deathCloud: number;
  index: number;
}

/**
 * `DELETEMONSTERPARAMETERS::DELETEMONSTERPARAMETERS` (`doc/CSBwin-src/Code11f52.cpp:953-959`).
 * The monster and its square are left unset, as CSBWin leaves them, until
 * `ProcessMonsterDeleteFilter` fills them in.
 */
export function deleteMonsterParameters(why: DeleteMonsterWhy, index: number): DeleteMonsterParameters {
  return { monsterID: 0, level: 0, x: 0, y: 0, why, dropResidue: 0, deathCloud: 0, index };
}

/** `sizeof(DELETEMONSTERPARAMETERS) / 4` (`doc/CSBwin-src/Code11f52.cpp:1047`): its 8 longwords. */
export const DELETE_MONSTER_PARAMETER_WORDS = 8;

/**
 * `memcpy(pDSAparameters + 1, pdmp, sizeof (*pdmp))` (`doc/CSBwin-src/Code11f52.cpp:1046`):
 * the block as the delete monster filter's DSA sees it, a longword per field in the
 * class's order (`CSB.h:2999-3006`).
 */
export function deleteMonsterParametersToWords(p: DeleteMonsterParameters): number[] {
  return [p.monsterID, p.level, p.x, p.y, p.why, p.dropResidue, p.deathCloud, p.index].map((word) => word | 0);
}

/**
 * `memcpy(pdmp, pDSAparameters + 1, sizeof (*pdmp))` (`doc/CSBwin-src/Code11f52.cpp:1049`):
 * the block back from the DSA into `p`, `word(i)` its longword `i`.
 */
export function deleteMonsterParametersFromWords(p: DeleteMonsterParameters, word: (index: number) => number): void {
  const w = (index: number): number => word(index) | 0;
  p.monsterID = w(0);
  p.level = w(1);
  p.x = w(2);
  p.y = w(3);
  p.why = w(4);
  p.dropResidue = w(5);
  p.deathCloud = w(6);
  p.index = w(7);
}

/**
 * `PARTYMOVEDATA` (doc/CSBwin-src/CSB.h:4328-4379), the block the party move filter reads
 * and may rewrite (`CallPartyMoveFilter`, `DsaFilters.partyMoveFilter`). The locations are
 * `LOCATIONREL` integers whose position is the party's facing.
 */
export interface PartyMoveData {
  moveType: number;
  flags: number;
  delay: number;
  /** The stamina each champion pays, -1 past the party. */
  staminaAdjustment: number[];
  relDirection: number;
  absDirection: number;
  fromLocation: number;
  toLocation: number;
  fromLocationType: number;
  toLocationType: number;
}

/** `sizeof(PARTYMOVEDATA) / 4` (doc/CSBwin-src/CSBCode.cpp:7922): its 13 longwords. */
export const PARTY_MOVE_DATA_WORDS = 13;

/**
 * `memcpy(pDSAparameters + 1, pmd, sizeof(*pmd))` (doc/CSBwin-src/CSBCode.cpp:7923): the
 * block as the filter's DSA sees it, a longword per field in the struct's order.
 */
export function partyMoveDataToWords(pmd: PartyMoveData): number[] {
  return [
    pmd.moveType, pmd.flags, pmd.delay, ...pmd.staminaAdjustment,
    pmd.relDirection, pmd.absDirection, pmd.fromLocation, pmd.toLocation,
    pmd.fromLocationType, pmd.toLocationType,
  ].map((word) => word | 0);
}

/**
 * `memcpy(pmd, pDSAparameters + 1, sizeof(*pmd))` (doc/CSBwin-src/CSBCode.cpp:7926): the
 * block back from the filter's DSA, `word(i)` its longword `i`.
 */
export function partyMoveDataFromWords(word: (index: number) => number): PartyMoveData {
  const w = (index: number): number => word(index) | 0;
  return {
    moveType: w(0), flags: w(1), delay: w(2),
    staminaAdjustment: [w(3), w(4), w(5), w(6)],
    relDirection: w(7), absDirection: w(8), fromLocation: w(9), toLocation: w(10),
    fromLocationType: w(11), toLocationType: w(12),
  };
}

/** `sizeof(SPELL_PARAMETERS) / 4` (`doc/CSBwin-src/Magic.cpp:914`): its 14 longwords. */
export const SPELL_PARAMETER_WORDS = 14;

/**
 * `memcpy(pDSAparameters + 1, pSpellParameters, sizeof(*pSpellParameters))`
 * (`doc/CSBwin-src/Magic.cpp:913`): the block as the spell filter's DSA sees it, a
 * longword per field in the struct's order (`CSB.h:2835-2855`).
 */
export function spellParametersToWords(p: SpellParameters): number[] {
  return [
    p.action, p.incantation, p.chIdx, p.disableTime, p.missileType, p.locationAbs, p.facing,
    p.skillRequired, p.spellByte5, p.spellClass, p.unused1, p.unused2, p.unused3, p.unused4,
  ].map((word) => word | 0);
}

/**
 * `memcpy(pSpellParameters, pDSAparameters + 1, sizeof(*pSpellParameters))`
 * (`doc/CSBwin-src/Magic.cpp:916`): the block back from the spell filter's DSA, `word(i)`
 * its longword `i`. `DSACastSpell` reads a program's own parameters so (`:1408-1418`).
 */
export function spellParametersFromWords(word: (index: number) => number): SpellParameters {
  const w = (index: number): number => word(index) | 0;
  return {
    action: w(0),
    incantation: w(1),
    chIdx: w(2),
    disableTime: w(3),
    missileType: w(4),
    locationAbs: w(5),
    facing: w(6),
    skillRequired: w(7),
    spellByte5: w(8),
    spellClass: w(9),
    unused1: w(10),
    unused2: w(11),
    unused3: w(12),
    unused4: w(13),
  };
}
