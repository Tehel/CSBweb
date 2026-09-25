/**
 * Object name indices (OBJNI_*).
 *
 * These index CSBWin's object-name table (the "basic object type" / ObjDesc
 * objectType value). CSBWin refers to them by raw number; we name the ones the
 * engine special-cases so the comparisons stay readable and greppable against
 * the C++ source.
 *
 * Single source of truth: previously these were re-declared in ViewportRenderer,
 * Game, skills, DsaSystem and ActuatorSystem, which risked silent divergence.
 */

export const OBJNI_COMPASS_N = 0;
export const OBJNI_FIRST_MODIFIABLE = 0;
export const OBJNI_COMPASS_W = 3;
export const OBJNI_TORCH_A = 4;
export const OBJNI_TORCH_B = 5;
export const OBJNI_TORCH_C = 6;
export const OBJNI_TORCH_D = 7;
export const OBJNI_WATERSKIN = 8;
export const OBJNI_WATER = 9;
export const OBJNI_JEWEL_SYMAL_A = 10;
export const OBJNI_JEWEL_SYMAL_B = 11;
export const OBJNI_ILLUMULET_A = 12;
export const OBJNI_ILLUMULET_B = 13;
export const OBJNI_FLAMITT_A = 14;
export const OBJNI_EYE_OF_TIME_A = 16;
export const OBJNI_STORM_RING_A = 18;
export const OBJNI_STAFF_OF_CLAWS_A = 20;
export const OBJNI_STAFF_OF_CLAWS_C = 22;
export const OBJNI_STORM_A = 23;
export const OBJNI_RA_BLADE_A = 25;
export const OBJNI_THE_FIRESTAFF_A = 27;   // 0x1b
export const OBJNI_THE_FIRESTAFF_B = 28;   // 0x1c
export const OBJNI_OPEN_SCROLL = 30;
export const OBJNI_LAST_MODIFIABLE = 31;
export const OBJNI_SCROLL = 31;
/** The weapons `AdjustStatsForItemCarried` names (`doc/CSBwin-src/Objects.h:479-507`). */
export const OBJNI_SIDE_SPLITTER = 38;     // 0x26
export const OBJNI_VORPAL_BLADE = 40;      // 0x28
export const OBJNI_DRAGON_FANG = 41;       // 0x29
export const OBJNI_MACE_OF_ORDER = 45;     // 0x2d
export const OBJNI_STAFF = 58;             // 0x3a
export const OBJNI_WAND = 59;              // 0x3b
export const OBJNI_TEO_WAND = 60;          // 0x3c
export const OBJNI_YEW_STAFF = 61;         // 0x3d
export const OBJNI_STAFF_OF_IRRA = 62;     // 0x3e
export const OBJNI_CROSS_OF_NETA = 63;     // 0x3f
export const OBJNI_SERPENT_STAFF = 64;     // 0x40
export const OBJNI_DRAGON_SPIT = 65;       // 0x41
export const OBJNI_SCEPTRE_OF_LYF = 66;    // 0x42
/** …and the garments and trinkets (`doc/CSBwin-src/Objects.h:522-583`). */
export const OBJNI_CLOAK_OF_NIGHT = 81;    // 0x51
export const OBJNI_CROWN_OF_NERRA = 104;   // 0x68
export const OBJNI_RABBITS_FOOT = 137;     // 0x89
export const OBJNI_DEXHELM = 140;          // 0x8c
export const OBJNI_FLAMEBAIN = 141;        // 0x8d
export const OBJNI_POWERTOWERS = 142;      // 0x8e
export const OBJNI_CHEST = 144;            // 0x90
export const OBJNI_OPEN_CHEST = 145;       // 0x91
export const OBJNI_BONES_A = 147;          // 0x93
export const OBJNI_ELVEN_BOOTS = 119;      // 0x77
/** `objNI_BootsOfSpeed` (`doc/CSBwin-src/Objects.h:639`). */
export const OBJNI_BOOTS_OF_SPEED = 194;   // 0xc2
export const OBJNI_GEM_OF_AGES = 120;      // 0x78
export const OBJNI_EKKHARD_CROSS = 121;    // 0x79
export const OBJNI_MOONSTONE = 122;        // 0x7a
export const OBJNI_PENDANT_FERAL = 124;    // 0x7c
export const OBJNI_FIRST_FULL_FLASK = 148;
export const OBJNI_LAST_FULL_FLASK = 163;
export const OBJNI_WATER_FLASK = 163;
export const OBJNI_APPLE = 168;
export const OBJNI_DRAGON_STEAK = 175;
/** `objNI_FirstKey` / `objNI_LastKey` (`doc/CSBwin-src/Objects.h:620`, `:636`). */
export const OBJNI_FIRST_KEY = 176;        // 0xb0, objNI_IronKey
export const OBJNI_LAST_KEY = 191;         // 0xbf, objNI_MasterKey
export const OBJNI_EMPTY_FLASK = 195;
export const OBJNI_SPECIAL_C = 201;
export const OBJNI_SPECIAL_D = 202;
export const OBJNI_SPECIAL_E = 203;
export const OBJNI_SPECIAL_F = 204;
export const OBJNI_SPECIAL_G = 205;
export const OBJNI_SPECIAL_H = 206;
export const OBJNI_SPECIAL_J = 208;
export const OBJNI_SPECIAL_N = 212;
export const OBJNI_NOT_AN_OBJECT = 255;
