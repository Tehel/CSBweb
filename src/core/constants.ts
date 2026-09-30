/**
 * Game constants
 *
 * Reference: CSBWin (doc/CSBwin-src/)
 */

/**
 * Viewport dimensions (from CSBWin)
 * Original Dungeon Master viewport
 */
export const VIEWPORT_WIDTH = 112;
export const VIEWPORT_HEIGHT = 136;

/**
 * Game timing constants (from CSBWin)
 */
export const VBL_FREQUENCY = 60; // Vertical blank interrupts per second

/**
 * Sound indices (graphics.dat SND1 items)
 * Reference: CSBWin sound table.
 */
export const SoundIndex = {
    FALLING_ITEM: 533,
    SWITCH: 534,
    DOOR: 535,
    WALL_SWITCH: 536,
    FIREBALL_EXPLODE: 537,
    FALL_AND_DIE: 539,
    SWALLOW: 540,
    CHAMP_WOUND_1: 541,
    CHAMP_WOUND_2: 542,
    CHAMP_WOUND_3: 543,
    CHAMP_WOUND_4: 544,
    SPELL_EXPLODE: 545,
    SKELETON_ATTACK: 546,
    TELEPORT: 547,
    WALL_BUMP: 549,
    RAT_ATTACK: 550,
    MUMMY_ATTACK: 551,
    SCREAMER_ATTACK: 552,
    SCORPION_ATTACK: 553,
    WORM_ATTACK: 554,
    GIGGLER: 555
} as const;

/**
 * Dungeon.dat file structure offsets
 */
export const DUNGEON_HEADER_SIZE = 44;          // Header size in bytes
export const MAP_DESCRIPTOR_SIZE = 16;          // Map descriptor size in bytes

/**
 * `POTIONTYPE` (`doc/CSBwin-src/Objects.h:14-37`), transcribed.
 *
 * The names are CSBWin's, spellings included. What was here before was a guess with
 * eight invented members and the wrong values — nothing used it, and the two places
 * that needed a potion type had each written their own local constant.
 */
export enum PotionType {
    MON_POTION_A = 0,
    UM_POTION = 1,
    DES_POTION = 2,
    VEN_POTION = 3,
    SAR_POTION = 4,
    ZO_POTION = 5,
    ROS_POTION = 6,
    KU_POTION = 7,
    DANE_POTION = 8,
    NETA_POTION = 9,
    ANTI_VENIN = 10,
    MON_POTION_B = 11,
    YA_POTION = 12,
    EE_POTION = 13,
    VI_POTION = 14,
    WATER_FLASK = 15,
    KATH_BOMB = 16,
    PEW_BOMB = 17,
    RA_BOMB = 18,
    FUL_BOMB = 19,
    EMPTY_FLASK = 20,
}

/**
 * Misc object types (CSBWin `doc/CSBwin-src/Objects.h:192`).
 * `MISC_BONES_OF_HERO`'s record value is the champion index
 * (`doc/CSBwin-src/Character.cpp:2630`).
 */
export const MISC_BONES_OF_HERO = 5;
