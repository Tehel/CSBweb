/**
 * Unpack block 4 of a CSBWin save: the four champions, and the party state beside them.
 *
 * The block is 3328 bytes — `CHARDESC[4]` at 800 bytes each, then **128 bytes of
 * party-wide state** that merely happens to sit next to them in `Data.h`. The struct
 * comments bracket the span exactly: `// 3328 bytes read into byte16482`
 * (`doc/CSBwin-src/Data.h:765`) opens it and
 * `///////////// End of Character portion of save file /////////////` (`:783`) closes
 * it. So the footprint trail and the shield timers are part of the *character* block.
 *
 * Every field below is `CHARDESC` (`doc/CSBwin-src/CSB.h:2483-2594`) read at its
 * declared offset, with two corrections that struct does not state:
 *
 * - `title` runs 8..27 — **20 bytes**, not the declared 16. `AddCharacter` refuses a
 *   title character only at `D6W >= 19` and then writes `title[D6W] = 0`, so index 19
 *   is a legal write (`doc/CSBwin-src/Character.cpp:578-587`), and `facing` at 28
 *   closes the span. `title[16]`, `wordx24` and `FILL26[2]` are one field.
 * - `name` and `title` are plain `char` arrays and are **not** byte-swapped;
 *   `swapCharacter` lists every field it swaps and they are not among them
 *   (`doc/CSBwin-src/SaveGame.cpp:490-521`). Everything else here is big-endian.
 */
import type { Champion, PartyState, Skill } from '../engine/gameTypes';
import type { Attribute } from '../engine/attributes';
import type { i16, ui8, ui16, ObjectID } from '../core/types';
import { CHARDESC_SIZE, decodeCharField } from './CsbwinSaveInfo';
import type { CsbwinObjectIndex } from './CsbwinObjectIndex';

/** `CHARFLAG_male` — `AddCharacter` ORs it in for an 'M' hero (`Character.cpp:596`). */
const CHARFLAG_MALE = 0x10;

/** The seven `ATTRIBUTE` triples start here, three bytes each, `FILL91` after them. */
const ATTRIBUTES_OFFSET = 70;
/** `SKILL skills92[20]`: `i16 tempAdjust` + `i32 experience`, six bytes each. */
const SKILLS_OFFSET = 92;
const SKILL_SIZE = 6;
/** `RN possessions[30]`, two bytes each. */
const POSSESSIONS_OFFSET = 212;

const u8 = (b: Uint8Array, o: number): number => b[o] ?? 0;
const i8 = (b: Uint8Array, o: number): number => ((b[o] ?? 0) << 24) >> 24;
const u16be = (b: Uint8Array, o: number): number => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const i16be = (b: Uint8Array, o: number): number => (u16be(b, o) << 16) >> 16;
const i32be = (b: Uint8Array, o: number): number =>
  (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) | 0;

/** Everything in one `CHARDESC` that this port has somewhere to put. */
export interface CsbwinCharacter {
  champion: Champion;
  /** `charFlags`, kept raw: the caller needs bit 4 for gender and 0x400 for "moved". */
  charFlags: i16;
  /** True when the slot holds a champion at all — an unused one is all zeroes. */
  occupied: boolean;
}

function readAttributes(block: Uint8Array, base: number): Attribute[] {
  const stats: Attribute[] = [];
  for (let i = 0; i < 7; i++) {
    const at = base + ATTRIBUTES_OFFSET + i * 3;
    stats.push({ maximum: u8(block, at), current: u8(block, at + 1), minimum: u8(block, at + 2) });
  }
  return stats;
}

function readSkills(block: Uint8Array, base: number): Skill[] {
  const skills: Skill[] = [];
  for (let i = 0; i < 20; i++) {
    const at = base + SKILLS_OFFSET + i * SKILL_SIZE;
    skills.push({ tempAdjust: i16be(block, at), experience: i32be(block, at + 2) });
  }
  return skills;
}

/**
 * The thirty `RN possessions[30]` slots.
 *
 * Every one of them is an **indirect-index slot number**, not a packed RN:
 * `ConvertCharacters` rewrites all thirty through `ConvertListOfObjects` the moment an
 * original dungeon is read (`doc/CSBwin-src/SaveGame.cpp:2046-2064`), so from then on
 * that is what a champion carries. `objectIndex` translates them back into this port's
 * form; without it the slots read as categories 0 and 1 with indices far past those
 * databases, which is exactly what this reader used to report.
 */
function readPossessions(
  block: Uint8Array,
  base: number,
  objectIndex?: CsbwinObjectIndex,
): Array<ObjectID | null> {
  const slots: Array<ObjectID | null> = [];
  for (let i = 0; i < 30; i++) {
    const rn = u16be(block, base + POSSESSIONS_OFFSET + i * 2);
    // `RNeof` (0xfffe) and `RNnul` (0xffff) both mean "empty slot" here.
    if (rn === 0xffff || rn === 0xfffe) {
      slots.push(null);
      continue;
    }
    slots.push((objectIndex ? objectIndex.resolve(rn) : rn) as ObjectID);
  }
  return slots;
}

/** One `CHARDESC`, at `index` within the block. */
export function readCsbwinCharacter(
  block: Uint8Array,
  index: number,
  objectIndex?: CsbwinObjectIndex,
): CsbwinCharacter {
  const base = index * CHARDESC_SIZE;
  const name = decodeCharField(block.subarray(base, base + 8));
  const title = decodeCharField(block.subarray(base + 8, base + 28));
  const slots = readPossessions(block, base, objectIndex);
  const charFlags = i16be(block, base + 48);
  const maxHealth = i16be(block, base + 54);

  const champion: Champion = {
    name,
    title,
    attributes: {
      health: i16be(block, base + 52),
      maxHealth,
      stamina: i16be(block, base + 56),
      maxStamina: i16be(block, base + 58),
      mana: i16be(block, base + 60),
      maxMana: i16be(block, base + 62),
      stats: readAttributes(block, base),
      // CSBWin keeps no single "experience" number — a champion's standing is the
      // twenty `SKILL` records. This field is the port's own summary and is left at 0
      // rather than invented; `determineMastery` reads the skills directly.
      experience: 0,
      fighter: 0,
      ninja: 0,
      priest: 0,
      wizard: 0,
    },
    // CSBWin has no "alive" flag: a champion is dead when their health is gone
    // (`KillCharacter` zeroes it), and `causeOfDamage` at 282 says how.
    alive: i16be(block, base + 52) > 0,
    facing: u8(block, base + 28) as 0 | 1 | 2 | 3,
    partyPosition: u8(block, base + 29) as ui8,
    attackType: i8(block, base + 32),
    incantation: Array.from(block.subarray(base + 34, base + 38)).filter((c) => c !== 0),
    damageFromDirection: u8(block, base + 40),
    maxRecentDamage: u8(block, base + 41),
    poisonCount: u8(block, base + 42),
    busyTimerIndex: i16be(block, base + 44),
    wounds: u16be(block, base + 50),
    attackStatModifier: i16be(block, base + 64),
    food: i16be(block, base + 66),
    water: i16be(block, base + 68),
    skills: readSkills(block, base),
    actionDisabledUntil: 0,
    // The three named hand fields mirror `possessions`; every writer has to maintain
    // both (PLAN.md carries the debt), so build them from the array here.
    weaponHand: slots[1] ?? null,
    shieldHand: slots[0] ?? null,
    quiver: slots[8] ?? null,
    possessions: slots,
    shieldStrength: u16be(block, base + 274),
    fingerprint: u16be(block, base + 280) as ui16,
  };

  // An unused slot is `ClearMemory`'d to 800 zero bytes by `AddCharacter`
  // (`doc/CSBwin-src/Character.cpp:478`), so a blank name and no maximum health is
  // "nobody here" rather than a champion with odd stats.
  const occupied = name.length > 0 || maxHealth > 0;
  return { champion, charFlags, occupied };
}

/** Is this champion male? `charFlags` bit 4 (`CHARFLAG_male`). */
export function isMale(charFlags: number): boolean {
  return (charFlags & CHARFLAG_MALE) !== 0;
}

/**
 * The 128 bytes after the four `CHARDESC`s, laid out by `Data.h:766-782`. Offsets are
 * from the start of block 4, so `4 * 800 = 3200` is `Brightness`.
 */
export interface CsbwinPartyTail {
  brightness: i16;
  seeThruWalls: number;
  magicFootprintsActive: number;
  partyShield: number;
  fireShield: number;
  spellShield: number;
  numFootprintEnt: number;
  freezeLifeTimer: number;
  indexOfFirstMagicFootprint: number;
  indexOfLastMagicFootprint: number;
  /** `d.PartyFootprints[24]` — bits 0-4 mapX, 5-9 mapY, 10-15 level. */
  footprints: number[];
  /** `d.Byte13220[24]`, which parallels the footprint ring. */
  footprintAges: number[];
  invisible: number;
}

const TAIL = 4 * CHARDESC_SIZE;

export function readCsbwinPartyTail(block: Uint8Array): CsbwinPartyTail {
  const footprints: number[] = [];
  for (let i = 0; i < 24; i++) footprints.push(u16be(block, TAIL + 14 + i * 2));
  const footprintAges = Array.from(block.subarray(TAIL + 62, TAIL + 86));
  return {
    brightness: i16be(block, TAIL + 0),
    seeThruWalls: u8(block, TAIL + 2),
    magicFootprintsActive: u8(block, TAIL + 3),
    partyShield: i16be(block, TAIL + 4),
    fireShield: i16be(block, TAIL + 6),
    spellShield: i16be(block, TAIL + 8),
    numFootprintEnt: u8(block, TAIL + 10),
    freezeLifeTimer: u8(block, TAIL + 11),
    indexOfFirstMagicFootprint: u8(block, TAIL + 12),
    indexOfLastMagicFootprint: u8(block, TAIL + 13),
    footprints,
    footprintAges,
    invisible: u8(block, TAIL + 86),
  };
}

/** Every occupied champion slot, in party order. */
export function readCsbwinParty(
  block: Uint8Array,
  numCharacter: number,
  objectIndex?: CsbwinObjectIndex,
): CsbwinCharacter[] {
  const out: CsbwinCharacter[] = [];
  for (let i = 0; i < Math.min(4, Math.max(0, numCharacter)); i++) {
    const character = readCsbwinCharacter(block, i, objectIndex);
    if (character.occupied) out.push(character);
  }
  return out;
}

export type { PartyState };
