/**
 * Game constants
 *
 * Based on CSBWin and static/js/mediaindex.js
 */

import type { Palette } from './types';

/**
 * Default palette (from graphics.dat)
 * This is the main game palette used for most graphics
 */
export const DEFAULT_PALETTE: Palette = [
    0x000, // 0: Black
    0x666, // 1: Gray
    0x444, // 2: Dark gray
    0x642, // 3: Brown
    0x420, // 4: Dark brown
    0x644, // 5: Light brown
    0x664, // 6: Tan
    0x777, // 7: White
    0x200, // 8: Dark red
    0x722, // 9: Pink
    0x040, // 10: Dark green
    0x363, // 11: Purple
    0x006, // 12: Dark blue
    0x377, // 13: Light blue
    0x770, // 14: Yellow
    0x555  // 15: Medium gray
];

/**
 * Viewport dimensions (from CSBWin)
 * Original Dungeon Master viewport
 */
export const VIEWPORT_WIDTH = 112;
export const VIEWPORT_HEIGHT = 136;

/**
 * Standard display dimensions (scaled for modern screens)
 */
export const DISPLAY_WIDTH = 640;
export const DISPLAY_HEIGHT = 400;

/**
 * Game timing constants (from CSBWin)
 */
export const VBL_FREQUENCY = 60; // Vertical blank interrupts per second
export const TICKS_PER_SECOND = 4; // Normal game speed: 15 VBL per tick = 4 ticks/sec
export const TICK_INTERVAL_MS = 1000 / TICKS_PER_SECOND; // 250ms per tick

/**
 * Maximum values
 */
export const MAX_MAPS = 64;      // Maximum dungeon levels
export const MAX_WIDTH = 32;     // Maximum map width
export const MAX_HEIGHT = 32;    // Maximum map height
export const MAX_CHAMPIONS = 4;  // Party size

/**
 * Graphics.dat item indices
 * Selected subset from mediaindex.js (563 total items)
 */
export const GraphicIndex = {
    CREDIT: 0,
    TITLE: 1,
    TITLE_BACKGROUND: 2,

    // Fonts
    FONT_MAIN: 557,

    // UI elements
    PORTRAITS: 558,
    ITEMS: 559,

    // Palettes
    PALETTES: 562
} as const;

/**
 * Sound indices (graphics.dat SND1 items)
 * Based on static/js/mediaindex.js sound table.
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
 * Database record sizes (in bytes)
 * From DUNGEON_DAT_FORMAT.md
 */
export const DB_RECORD_SIZE = {
    DOOR: 4,
    TELEPORTER: 6,
    TEXT: 4,
    ACTUATOR: 8,
    CREATURE: 16,
    WEAPON: 4,
    CLOTHING: 4,
    SCROLL: 4,
    POTION: 4,
    CHEST: 8,
    MISC: 4,
    MISSILE: 8,
    CLOUD: 4
} as const;

/**
 * Dungeon.dat file structure offsets
 */
export const DUNGEON_HEADER_SIZE = 44;          // Header size in bytes
export const MAP_DESCRIPTOR_SIZE = 16;          // Map descriptor size in bytes
export const OBJECT_COUNTS_OFFSET = 0x0C;       // Offset to object counts array
export const OBJECT_COUNTS_SIZE = 16 * 2;       // 16 words

/**
 * Text encoding (5-bit character codes)
 * From DUNGEON_DAT_FORMAT.md
 */
export const TEXT_CHAR_A = 0;                   // 'A'
export const TEXT_CHAR_Z = 25;                  // 'Z'
export const TEXT_CHAR_SPACE = 26;
export const TEXT_CHAR_PERIOD = 27;
export const TEXT_CHAR_SEPARATOR = 28;
export const TEXT_CHAR_ESCAPE1 = 29;
export const TEXT_CHAR_ESCAPE2 = 30;
export const TEXT_CHAR_END = 31;

/**
 * Creature types (from CSBWin Monster.cpp)
 */
export enum CreatureType {
    GIANT_SCORPION = 0,     // Giggler
    SWAMP_SLIME = 1,
    MUMMY = 2,
    BLACK_FLAME = 3,
    SKELETON = 4,
    COUATL = 5,
    VEXIRK = 6,
    MAGENTA_WORM = 7,
    TROLIN = 8,             // Ant Man in CSB
    GIANT_WASP = 9,         // Muncher in CSB
    ANIMATED_ARMOUR = 10,   // Deth Knight in CSB
    MATERIALIZER = 11,
    WATER_ELEMENTAL = 12,
    OITU = 13,
    DEMON = 14,
    LORD_CHAOS = 15,
    RED_DRAGON = 16
    // ... more in CSB (27 total)
}

/**
 * Weapon types (partial list from CSBWin)
 */
export enum WeaponType {
    TORCH = 0,
    FLAMITT = 1,
    STAFF_OF_CLAWS = 2,
    STORM_RING = 3,
    RA_KEY = 4,
    DAGGER = 5,
    SWORD = 6,
    // ... (46 types in DM)
}

/**
 * Potion types (from CSBWin)
 */
export enum PotionType {
    MON_POTION = 0,
    MANA_POTION = 1,
    MAGIC_POTION = 2,       // Strength
    DEXTERITY_POTION = 3,
    SHIELD_POTION = 4,
    WISDOM_POTION = 5,
    VITALITY_POTION = 6,
    ANTI_VENOM = 7,
    // ... (20+ types)
}
