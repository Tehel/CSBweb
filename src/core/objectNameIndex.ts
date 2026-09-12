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
export const OBJNI_ILLUMULET_A = 12;
export const OBJNI_ILLUMULET_B = 13;
export const OBJNI_FLAMITT_A = 14;
export const OBJNI_EYE_OF_TIME_A = 16;
export const OBJNI_STORM_RING_A = 18;
export const OBJNI_STAFF_OF_CLAWS_A = 20;
export const OBJNI_STORM_A = 23;
export const OBJNI_RA_BLADE_A = 25;
export const OBJNI_THE_FIRESTAFF_A = 27;   // 0x1b
export const OBJNI_THE_FIRESTAFF_B = 28;   // 0x1c
export const OBJNI_OPEN_SCROLL = 30;
export const OBJNI_LAST_MODIFIABLE = 31;
export const OBJNI_SCROLL = 31;
export const OBJNI_SCEPTRE_OF_LYF = 66;    // 0x42
export const OBJNI_OPEN_CHEST = 145;       // 0x91
export const OBJNI_BONES_A = 147;          // 0x93
export const OBJNI_ELVEN_BOOTS = 119;      // 0x77
export const OBJNI_GEM_OF_AGES = 120;      // 0x78
export const OBJNI_EKKHARD_CROSS = 121;    // 0x79
export const OBJNI_MOONSTONE = 122;        // 0x7a
export const OBJNI_PENDANT_FERAL = 124;    // 0x7c
export const OBJNI_FIRST_FULL_FLASK = 148;
export const OBJNI_LAST_FULL_FLASK = 163;
export const OBJNI_WATER_FLASK = 163;
export const OBJNI_APPLE = 168;
export const OBJNI_DRAGON_STEAK = 175;
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
