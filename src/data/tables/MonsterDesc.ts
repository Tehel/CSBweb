/**
 * CSBWin `MONSTERDESC` — 26 bytes, 27 of them, from `graphics.dat` item `0x22f`
 * (doc/CSBwin-src/CSB.h:2256-2363, `d.MonsterDescriptor[27]` at doc/CSBwin-src/Data.h:1076).
 *
 * `word2`, `word4`, `word14`, `word16`, `word18` and `word20` are the six swapped
 * fields (`fixItem26`, doc/CSBwin-src/CSBCode.cpp:10042) — i.e. big-endian in the
 * file, like everything else of Atari origin. The named bit accessors below are
 * kept as free functions rather than methods so the record stays a plain struct.
 */
export interface MonsterDesc {
  type: number; // uByte0 — the entry's own index, i.e. the monster type number
  attackSound: number; // uByte1 — sound ordinal, non-zero triggers a sound in MonsterAttacks
  word2: number; // size / material / immunity flags
  word4: number; // which graphics exist, and the mirroring rules
  movementTicks06: number; // ticks per move; `255 - this` goes into TIMER.uByte5
  attackTicks07: number;
  defense08: number;
  baseHealth09: number;
  attack10: number;
  poisonAttack11: number;
  dexterity12: number;
  unused13: number;
  word14: number; // sight distance, smelling distance
  word16: number; // bravery and friends
  word18: number; // fire and poison resistance
  word20: number; // the two attack/move delay increments
  uByte22: number[]; // 4 bytes
}

/*
 * `MONSTERDESC.word2` (doc/CSBwin-src/CSB.h:2268-2296).
 */
export const monsterHorizontalSize = (d: MonsterDesc): number => d.word2 & 3;
export const monsterVerticalSize = (d: MonsterDesc): number => (d.word2 & 0x180) >> 7;
export const monsterSee360 = (d: MonsterDesc): boolean => (d.word2 & 0x0004) !== 0;
export const monsterWord2Bit3 = (d: MonsterDesc): boolean => (d.word2 & 0x0008) !== 0;
export const monsterWord2Bit4 = (d: MonsterDesc): boolean => (d.word2 & 0x0010) !== 0;
export const monsterLevitating = (d: MonsterDesc): boolean => (d.word2 & 0x0020) !== 0;
export const monsterNonMaterial = (d: MonsterDesc): boolean => (d.word2 & 0x0040) !== 0;
export const monsterLeavesDroppings = (d: MonsterDesc): boolean => (d.word2 & 0x0200) !== 0;
export const monsterAbsorbsDaggersEtc = (d: MonsterDesc): boolean => (d.word2 & 0x0400) !== 0;
export const monsterSeesInvisible = (d: MonsterDesc): boolean => (d.word2 & 0x0800) !== 0;
export const monsterCanSeeInDark = (d: MonsterDesc): boolean => (d.word2 & 0x1000) !== 0;
export const monsterInvincible = (d: MonsterDesc): boolean => (d.word2 & 0x2000) !== 0;

/*
 * `MONSTERDESC_WORD4` (doc/CSBwin-src/CSB.h:2232-2253).
 */
export const monsterNibble0 = (d: MonsterDesc): number => d.word4 & 3;
export const monsterNibble12 = (d: MonsterDesc): number => (d.word4 >> 12) & 3;
export const monsterNibble14 = (d: MonsterDesc): number => (d.word4 >> 14) & 3;
export const monsterNonAttackingMirrorOK = (d: MonsterDesc): boolean => (d.word4 & 0x0004) !== 0;
export const monsterHasSideGraphic = (d: MonsterDesc): boolean => (d.word4 & 0x0008) !== 0;
export const monsterHasBackGraphic = (d: MonsterDesc): boolean => (d.word4 & 0x0010) !== 0;
export const monsterHasAttackGraphic = (d: MonsterDesc): boolean => (d.word4 & 0x0020) !== 0;
export const monsterWord4Bit7 = (d: MonsterDesc): boolean => (d.word4 & 0x0080) !== 0;
export const monsterWord4Bit8 = (d: MonsterDesc): boolean => (d.word4 & 0x0100) !== 0;
export const monsterAttackingMirrorOK = (d: MonsterDesc): boolean => (d.word4 & 0x0200) !== 0;
export const monsterWord4Bit10 = (d: MonsterDesc): boolean => (d.word4 & 0x0400) !== 0;

/*
 * `word14` / `word16` / `word18` / `word20` bitfields (doc/CSBwin-src/CSB.h:2348-2362).
 * `sightDistance` is halved for each level of darkness by the caller.
 */
export const monsterSightDistance = (d: MonsterDesc): number => d.word14 & 15;
export const monsterSmellingDistance = (d: MonsterDesc): number => (d.word14 >> 8) & 15;
export const monsterWord14_12_15 = (d: MonsterDesc): number => (d.word14 >> 12) & 15;
export const monsterBravery = (d: MonsterDesc): number => (d.word16 >> 4) & 15;
export const monsterWord16_8_11 = (d: MonsterDesc): number => (d.word16 >> 8) & 15;
export const monsterWord16_12_15 = (d: MonsterDesc): number => (d.word16 >> 12) & 15;
export const monsterFireResistance = (d: MonsterDesc): number => (d.word18 >> 4) & 15;
export const monsterPoisonResistance = (d: MonsterDesc): number => (d.word18 >> 8) & 15;
export const monsterWord20_0_3 = (d: MonsterDesc): number => d.word20 & 15;
export const monsterDelayFromMoveToAttack = (d: MonsterDesc): number => (d.word20 >> 4) & 15;
export const monsterDelayFromAttackToMove = (d: MonsterDesc): number => (d.word20 >> 8) & 15;
