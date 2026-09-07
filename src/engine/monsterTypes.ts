/**
 * Shared monster and attack enumerations.
 *
 * Straight transcriptions of CSBWin's enums so the two codebases stay greppable:
 * `MONSTERTYPE` (doc/CSBwin-src/Objects.h:153), `STATE_OF_FEAR`
 * (doc/CSBwin-src/CSBTypes.h:164) and `ATTACKTYPE` (doc/CSBwin-src/CSB.h:574).
 * CSBWin's own gaps and oddities are preserved — the unnamed `mon_5`/`mon_25`, the
 * missing fear state 1, and the three attack types marked "Not in CSB", whose names
 * really are stored as `"X"` in `graphics.dat`.
 */

/** `MONSTERTYPE` — index into `MonsterDescriptor[27]`. */
export enum MonsterType {
  mon_Scorpion = 0,
  mon_SlimeDevil = 1,
  mon_Giggler = 2,
  mon_FlyingEye = 3,
  mon_Hellhound = 4,
  mon_5 = 5,
  mon_Screamer = 6,
  mon_RockPile = 7,
  mon_Rive = 8,
  mon_StoneGolem = 9,
  mon_Mummy = 0x0a,
  mon_BlackFlame = 0x0b,
  mon_Skeleton = 0x0c,
  mon_Couatl = 0x0d,
  mon_Vexirk = 0x0e,
  mon_Worm = 0x0f,
  mon_AntMan = 0x10,
  mon_Muncher = 0x11,
  mon_DethKnight = 0x12,
  mon_Zytaz = 0x13,
  mon_WaterElemental = 0x14,
  mon_Oitu = 0x15,
  mon_Demon = 0x16,
  mon_LordChaos = 0x17,
  mon_Dragon = 0x18,
  mon_25 = 0x19,
  mon_GreyLord = 0x1a,
  mon_undefined = 0x63,
}

/**
 * `STATE_OF_FEAR` — `DB4.word14` bits 0-3.
 *
 * There is no state 1. State 5 is what a giggler is put into after it steals
 * something, and states 4 and above are reset to 0 by `DetachItem16`
 * (doc/CSBwin-src/CSBCode.cpp:6129).
 */
export enum StateOfFear {
  StateOfFear0 = 0,
  StateOfFear2 = 2,
  StateOfFear3 = 3,
  StateOfFear4 = 4,
  StateOfFear5 = 5,
  StateOfFear6 = 6,
  StateOfFear7 = 7,
}

/** `ATTACKTYPE` — index into every 44-entry table in graphic `0x230`. */
export enum AttackType {
  atk_JUGGLE = 0, // Not in CSB
  atk_BLOCK = 1,
  atk_CHOP = 2,
  atk_SPEED = 3, // Not in CSB
  atk_BLOWHORN = 4,
  atk_FLIP = 5,
  atk_PUNCH = 6,
  atk_KICK = 7,
  atk_WARCRY = 8,
  atk_STAB1 = 9,
  atk_CLIMBDOWN = 10,
  atk_FREEZELIFE = 11,
  atk_HIT = 12,
  atk_SWING = 13,
  atk_STAB2 = 14,
  atk_THRUST = 15,
  atk_JAB = 16,
  atk_PARRY = 17,
  atk_HACK = 18,
  atk_BERZERK = 19,
  atk_FIREBALL = 20,
  atk_DISPELL = 21,
  atk_CONFUSE = 22,
  atk_LIGHTNING = 23,
  atk_DISRUPT = 24,
  atk_MELEE = 25,
  atk_PRAY = 26, // Not in CSB
  atk_INVOKE = 27,
  atk_SLASH = 28,
  atk_CLEAVE = 29,
  atk_BASH = 30,
  atk_STUN = 31,
  atk_SHOOT = 32,
  atk_SPELLSHIELD = 33,
  atk_FIRESHIELD = 34,
  atk_FLUXCAGE = 35,
  atk_HEAL = 36,
  atk_CALM = 37,
  atk_LIGHT = 38,
  atk_WINDOW = 39,
  atk_SPIT = 40,
  atk_BRANDISH = 41,
  atk_THROW = 42,
  atk_FUSE = 43,
}

/** `PossibleAttackTypes` marks an absent option with -1, read back as 255. */
export const ATTACK_TYPE_NONE = 255;

/** The attack class `PrepareAttack` falls back to for an empty weapon hand. */
export const ATTACK_CLASS_EMPTY_HAND = 2;
