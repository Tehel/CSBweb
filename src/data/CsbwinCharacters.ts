/**
 * Unpack block 4 of a CSBWin save: the four champions, and the party state beside them.
 *
 * The block is 3328 bytes — `CHARDESC[4]` at 800 bytes each, then **128 bytes of
 * party-wide state** that merely happens to sit next to them in `Data.h`. The struct
 * comments bracket the span exactly: `// 3328 bytes read into byte16482`
 * (`doc/CSBwin-src/Data.h:780`) opens it and
 * `///////////// End of Character portion of save file /////////////` (`:798`) closes
 * it. So the footprint trail and the shield timers are part of the *character* block.
 *
 * Every field below is `CHARDESC` (`doc/CSBwin-src/CSB.h:2542-2653`) read at its
 * declared offset, with two corrections that struct does not state:
 *
 * - `title` runs 8..27 — **20 bytes**, not the declared 16. `AddCharacter` refuses a
 *   title character only at `D6W >= 19` and then writes `title[D6W] = 0`, so index 19
 *   is a legal write (`doc/CSBwin-src/Character.cpp:579-588`), and `facing` at 28
 *   closes the span. `title[16]`, `wordx24` and `FILL26[2]` are one field.
 * - `name` and `title` are plain `char` arrays and are **not** byte-swapped;
 *   `swapCharacter` lists every field it swaps and they are not among them
 *   (`doc/CSBwin-src/SaveGame.cpp:498-529`).
 * - Nor are the four words after `shieldStrength`: `talents`, `fingerPrint`,
 *   `causeOfDamage` and `monsterCausingDamage` keep the memory order of the
 *   little-endian build, so the file holds them **little-endian**. Everything else here
 *   is big-endian.
 * - `portrait[1]` at 336 is really 464 bytes — `FILL337[800-337]` is the rest of it —
 *   and holds the champion's portrait **bitmap**. See `readPortrait` below.
 */
import { CHARFLAG_MALE, getChampionPossession } from '../core/charDesc';
import type { Champion, PartyState, Skill, VacantCharacter } from '../engine/gameTypes';
import type { Attribute, Attributes } from '../engine/attributes';
import { OBJECT_ID_NULL, type i8, type i16, type ui8, type ObjectID } from '../core/types';
import { CHARDESC_SIZE, decodeCharField, encodeCharField } from './CsbwinSaveInfo';
import {
  readI16BE, readI32BE, readI8, readU16BE, readU16LE, readU32LE, readU8, writeU16LE, writeU32LE,
} from '../core/bytes';

/** The seven `ATTRIBUTE` triples start here, three bytes each, `FILL91` after them. */
const ATTRIBUTES_OFFSET = 70;
/** `SKILL skills92[20]`: `i16 tempAdjust` + `i32 experience`, six bytes each. */
const SKILLS_OFFSET = 92;
const SKILL_SIZE = 6;
/** `RN possessions[30]`, two bytes each. */
const POSSESSIONS_OFFSET = 212;
/**
 * `i8 portrait[1]` at 336 (`doc/CSBwin-src/CSB.h:2652`), with `FILL337[800-337]` after
 * it: 464 bytes, which is exactly `32*29/2` — the champion carries their **portrait
 * bitmap**, not an index to one. `AddCharacter` blits it out of basic graphic 26 for a
 * standard hero and out of `GetExternalPortraitAddress` for `charID > 23`
 * (`doc/CSBwin-src/Character.cpp:487-509`), and `CharacterPortraitToStatusBox` blits it
 * straight back to the status box at 16 bytes per line (`:4661-4673`).
 */
const PORTRAIT_OFFSET = 336;
/** 32 pixels wide, 29 rows, four bitplanes: 16 bytes per line, 464 in all. */
export const PORTRAIT_WIDTH = 32;
export const PORTRAIT_HEIGHT = 29;
const PORTRAIT_BYTES_PER_LINE = (PORTRAIT_WIDTH / 16) * 8;


/** Everything in one `CHARDESC` that this port has somewhere to put. */
interface CsbwinCharacter {
  champion: Champion;
  /** `charFlags`, kept raw: the caller needs bit 4 for gender and 0x400 for "moved". */
  charFlags: i16;
  /** True when the slot holds a champion at all — an unused one is all zeroes. */
  occupied: boolean;
}

function readAttributes(block: Uint8Array, base: number): Attributes {
  const stats: Attribute[] = [];
  for (let i = 0; i < 7; i++) {
    const at = base + ATTRIBUTES_OFFSET + i * 3;
    stats.push({ maximum: readU8(block, at), current: readU8(block, at + 1), minimum: readU8(block, at + 2) });
  }
  return stats as Attributes;
}

function readSkills(block: Uint8Array, base: number): Skill[] {
  const skills: Skill[] = [];
  for (let i = 0; i < 20; i++) {
    const at = base + SKILLS_OFFSET + i * SKILL_SIZE;
    skills.push({ tempAdjust: readI16BE(block, at), experience: readI32BE(block, at + 2) });
  }
  return skills;
}

/**
 * The thirty `RN possessions[30]` slots.
 *
 * Every one of them is an **indirect-index slot number**, not a packed RN:
 * `ConvertCharacters` rewrites all thirty through `ConvertListOfObjects` the moment an
 * original dungeon is read (`doc/CSBwin-src/SaveGame.cpp:2258-2276`), so from then on
 * that is what a champion carries, as in this port. Read as packed RNs, the slots would
 * be categories 0 and 1 with indices far past those databases.
 */
function readPossessions(block: Uint8Array, base: number): ObjectID[] {
  const slots: ObjectID[] = [];
  for (let i = 0; i < 30; i++) {
    const rn = readU16BE(block, base + POSSESSIONS_OFFSET + i * 2);
    // `RNeof` (0xfffe) and `RNnul` (0xffff) both mean "empty slot" here; the port keeps
    // only `RNnul`, which is what the writer puts back.
    if (rn === 0xffff || rn === 0xfffe) {
      slots.push(OBJECT_ID_NULL);
      continue;
    }
    slots.push(rn as ObjectID);
  }
  return slots;
}

/**
 * The portrait bitmap, unpacked from Atari bitplanes into this port's one-byte-per-pixel
 * form.
 *
 * `swapCharacter` lists every field it byte-swaps and the portrait is not among them
 * (`doc/CSBwin-src/SaveGame.cpp:498-529`), so these 464 bytes are the Atari layout the
 * graphics were loaded in: per 16 pixels, four big-endian plane words, plane 0 carrying
 * bit 0 of the colour index and the leftmost pixel in bit 15. That is what `TAG0088b2`
 * reads — `LE16(*puwA0)` over four consecutive words per group
 * (`doc/CSBwin-src/Graphics.cpp:785-800`).
 *
 * Proven, not inferred: `tools/checks/csbwin-load.ts` decodes the four champions of every
 * committed save this way and every one of them matches a cell of basic graphic 26
 * pixel for pixel.
 *
 * Returns `undefined` for an all-zero block, which is a slot `AddCharacter` cleared
 * rather than a champion drawn entirely in colour 0.
 */
function readPortrait(block: Uint8Array, base: number): ui8[] | undefined {
  const at = base + PORTRAIT_OFFSET;
  const pixels: ui8[] = new Array(PORTRAIT_WIDTH * PORTRAIT_HEIGHT).fill(0);
  let any = false;
  for (let y = 0; y < PORTRAIT_HEIGHT; y++) {
    for (let group = 0; group * 16 < PORTRAIT_WIDTH; group++) {
      const word = at + y * PORTRAIT_BYTES_PER_LINE + group * 8;
      const planes = [
        readU16BE(block, word),
        readU16BE(block, word + 2),
        readU16BE(block, word + 4),
        readU16BE(block, word + 6),
      ];
      for (let bit = 0; bit < 16; bit++) {
        let colour = 0;
        for (let plane = 0; plane < 4; plane++) {
          colour |= ((planes[plane]! >> (15 - bit)) & 1) << plane;
        }
        if (colour !== 0) any = true;
        pixels[y * PORTRAIT_WIDTH + group * 16 + bit] = colour;
      }
    }
  }
  return any ? pixels : undefined;
}

/** The live part of `incantation`: everything before the terminating zero. */
function incantationPrefix(bytes: ui8[]): ui8[] {
  const end = bytes.indexOf(0);
  return end < 0 ? [...bytes] : bytes.slice(0, end);
}

/** One `CHARDESC`, at `index` within the block. */
export function readCsbwinCharacter(
  block: Uint8Array,
  index: number,
): CsbwinCharacter {
  const base = index * CHARDESC_SIZE;
  const name = decodeCharField(block.subarray(base, base + 8));
  const title = decodeCharField(block.subarray(base + 8, base + 28));
  const titleBytes = Array.from(block.subarray(base + 8, base + 28));
  const incantationBytes = Array.from(block.subarray(base + 34, base + 38));
  const slots = readPossessions(block, base);
  const charFlags = readI16BE(block, base + 48);
  const maxHealth = readI16BE(block, base + 54);

  const champion: Champion = {
    name,
    title,
    // The raw bytes as well, but only when they say more than `title` does — which is
    // exactly the `\0HE DEVIL` case. Keeping them for every champion would be dead
    // weight in the runtime save.
    titleField: titleBytes.some((b, i) => b !== 0 && i >= title.length) ? titleBytes : undefined,
    attributes: {
      health: readI16BE(block, base + 52),
      maxHealth,
      stamina: readI16BE(block, base + 56),
      maxStamina: readI16BE(block, base + 58),
      mana: readI16BE(block, base + 60),
      maxMana: readI16BE(block, base + 62),
      stats: readAttributes(block, base),
    },
    facing: readU8(block, base + 28) as 0 | 1 | 2 | 3,
    partyPosition: readU8(block, base + 29),
    attackType: readI8(block, base + 32),
    // `StrLen(pcA3->incantation)` (`doc/CSBwin-src/Magic.cpp:815`) — a C string, so the
    // first zero ends it. Dropping the zeros instead would bring back the symbols a cast
    // leaves behind it: `CastSpell` clears `incantation[0]` and nothing else (`:954`), so
    // a champion who has just cast holds bytes like `00 69 6f 00`, and has no runes
    // pending in CSBWin.
    incantation: incantationPrefix(incantationBytes),
    // The four bytes as they stand, when the tail past the terminator is not zero —
    // dead to the game, but part of the file. The writer uses them only while they
    // still agree with `incantation`; see `writeCsbwinCharacter`.
    incantationField: incantationBytes.some((b, i) => b !== 0 && i >= incantationPrefix(incantationBytes).length)
      ? incantationBytes
      : undefined,
    damageFromDirection: readU8(block, base + 40),
    maxRecentDamage: readU8(block, base + 41),
    poisonCount: readU8(block, base + 42),
    busyTimerIndex: readI16BE(block, base + 44),
    wounds: readU16BE(block, base + 50),
    attackStatModifier: readI16BE(block, base + 64),
    food: readI16BE(block, base + 66),
    water: readI16BE(block, base + 68),
    skills: readSkills(block, base),
    possessions: slots,
    shieldStrength: readU16BE(block, base + 274),
    fingerprint: readU16LE(block, base + 280),
    // `charFlags` holds the champion's gender and their busy bit. The rest below are
    // carried, not used: the save writer needs every field back, and these have no
    // reader in the engine yet.
    charFlags,
    timerIndex: readI16BE(block, base + 46),
    talents: readU32LE(block, base + 276),
    load: readU16BE(block, base + 272),
    causeOfDamage: readU16LE(block, base + 282),
    monsterCausingDamage: readU16LE(block, base + 284),
    // The champion's own copy of their portrait. Champions this port creates instead
    // carry `portraitGraphic`, the `charID` `AddCharacter` blitted from; a save has only
    // the pixels.
    portrait: readPortrait(block, base),
  };

  // An unused slot is `ClearMemory`'d to 800 zero bytes by `AddCharacter`
  // (`doc/CSBwin-src/Character.cpp:479`), so a blank name and no maximum health is
  // "nobody here" rather than a champion with odd stats.
  const occupied = name.length > 0 || maxHealth > 0;
  return { champion, charFlags, occupied };
}

/** Is this champion male? `charFlags` bit 4 (`CHARFLAG_male`). */
export function isMale(charFlags: number): boolean {
  return (charFlags & CHARFLAG_MALE) !== 0;
}

/**
 * The 128 bytes after the four `CHARDESC`s, laid out by `Data.h:781-797`. Offsets are
 * from the start of block 4, so `4 * 800 = 3200` is `Brightness`.
 */
interface CsbwinPartyTail {
  brightness: i16;
  seeThruWalls: i8;
  magicFootprintsActive: i8;
  partyShield: i16;
  fireShield: i16;
  spellShield: i16;
  numFootprintEnt: number;
  freezeLifeTimer: number;
  indexOfFirstMagicFootprint: number;
  indexOfLastMagicFootprint: number;
  /** `d.PartyFootprints[24]` — bits 0-4 mapX, 5-9 mapY, 10-15 level. */
  footprints: number[];
  /** `d.Byte13220[24]`, which parallels the footprint ring. */
  footprintAges: number[];
  invisible: i8;
}

const TAIL = 4 * CHARDESC_SIZE;
/** Block 4 in full: four `CHARDESC` and the party tail (`doc/CSBwin-src/Data.h:780`). */
export const CHARACTER_BLOCK_SIZE = TAIL + 128;

export function readCsbwinPartyTail(block: Uint8Array): CsbwinPartyTail {
  const footprints: number[] = [];
  for (let i = 0; i < 24; i++) footprints.push(readU16BE(block, TAIL + 14 + i * 2));
  const footprintAges = Array.from(block.subarray(TAIL + 62, TAIL + 86));
  return {
    brightness: readI16BE(block, TAIL + 0),
    seeThruWalls: readI8(block, TAIL + 2),
    magicFootprintsActive: readI8(block, TAIL + 3),
    partyShield: readI16BE(block, TAIL + 4),
    fireShield: readI16BE(block, TAIL + 6),
    spellShield: readI16BE(block, TAIL + 8),
    numFootprintEnt: readU8(block, TAIL + 10),
    freezeLifeTimer: readU8(block, TAIL + 11),
    indexOfFirstMagicFootprint: readU8(block, TAIL + 12),
    indexOfLastMagicFootprint: readU8(block, TAIL + 13),
    footprints,
    footprintAges,
    invisible: readI8(block, TAIL + 86),
  };
}

/**
 * The party's `numCharacter` slots, in party order. A slot inside it is a champion
 * whatever it holds, as `d.NumCharacter` makes it in CSBWin: an unoccupied one is not
 * dropped, so that `handChar` and `MagicCaster` name the same champions.
 */
export function readCsbwinParty(
  block: Uint8Array,
  numCharacter: number,
): CsbwinCharacter[] {
  const out: CsbwinCharacter[] = [];
  for (let i = 0; i < Math.min(4, Math.max(0, numCharacter)); i++) out.push(readCsbwinCharacter(block, i));
  return out;
}

/* ===========================================================================
 * The write side. Every function below is the exact inverse of the one above it.
 * =========================================================================== */

const setU16BE = (b: Uint8Array, o: number, v: number): void => {
  b[o] = (v >> 8) & 0xff;
  b[o + 1] = v & 0xff;
};
const setU32BE = (b: Uint8Array, o: number, v: number): void => {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
};

/**
 * Pack 32x29 palette indices back into the four interleaved bitplanes `CHARDESC` holds.
 *
 * The inverse of `readPortrait`, byte for byte. A champion the engine created has no
 * pixels — it carries `portraitGraphic`, its `charID`, because the engine holds
 * no graphics to blit from — so the caller must resolve that to pixels first (the
 * renderer's `getPortraitBitmap` does it); here, a missing portrait writes 464 zero
 * bytes, which is what CSBWin's own `ClearMemory` leaves for a slot nobody filled.
 */
export function writePortrait(block: Uint8Array, base: number, pixels?: ui8[]): void {
  if (!pixels || pixels.length !== PORTRAIT_WIDTH * PORTRAIT_HEIGHT) return;
  const at = base + PORTRAIT_OFFSET;
  for (let y = 0; y < PORTRAIT_HEIGHT; y++) {
    for (let group = 0; group * 16 < PORTRAIT_WIDTH; group++) {
      const planes = [0, 0, 0, 0];
      for (let bit = 0; bit < 16; bit++) {
        const colour = pixels[y * PORTRAIT_WIDTH + group * 16 + bit] ?? 0;
        for (let plane = 0; plane < 4; plane++) {
          planes[plane]! |= ((colour >> plane) & 1) << (15 - bit);
        }
      }
      const word = at + y * PORTRAIT_BYTES_PER_LINE + group * 8;
      for (let plane = 0; plane < 4; plane++) setU16BE(block, word + plane * 2, planes[plane]!);
    }
  }
}

/** What the packer needs that a `Champion` does not carry. */
interface CsbwinCharacterWriteOptions {
  /**
   * `CHARDESC.load`, in tenths of a kilogram. CSBWin keeps it incrementally; this port
   * re-sums it, so a live game passes `CharacterStats.characterLoad` here, or
   * `CharacterStats.savedLoad` for a save file, which holds it without the object in hand. Without it the champion's own `load` is written — what the save it came from
   * said — and failing that, 0.
   */
  load?: (champion: Champion) => number;
  /**
   * `CHARDESC.portrait` for a champion the engine created, which carries
   * `portraitGraphic` and no pixels. A live game passes the renderer's cell lookup;
   * without it such a champion is written with a blank portrait.
   */
  portraitOf?: (champion: Champion) => ui8[] | undefined;
}

/**
 * One `CHARDESC`, packed into `block` at `index`.
 *
 * Every field `readCsbwinCharacter` reads is written back at the offset it was read
 * from, plus the six that only the writer needs — `byte30`, `byte31`, `uByte43`, the
 * three `FILL` runs — which CSBWin fills with constants:
 * `pcA3->byte30 = 1; pcA3->byte31 = 2;` (`doc/CSBwin-src/Character.cpp:516-517`) over a
 * record `ClearMemory` has zeroed (`:479`).
 *
 * The possessions are written as the slots they are: the file's RNs are the port's
 * (`doc/PROVEN_FACTS.md` -> "An RN in a save file is an indirect index").
 */
export function writeCsbwinCharacter(
  block: Uint8Array,
  index: number,
  champion: Champion,
  options: CsbwinCharacterWriteOptions = {},
): void {
  const base = index * CHARDESC_SIZE;

  block.set(encodeCharField(champion.name, 8), base);
  // The raw bytes when the title carries more than its decoded string does — but only
  // while the two still agree. A champion renamed since the save was read (the
  // reincarnate screen does exactly that) must be written from the *string*, or the
  // rename would be silently dropped. Same rule for the incantation below.
  const title = champion.titleField;
  if (title && title.length === 20 && decodeCharField(Uint8Array.from(title)) === champion.title) {
    block.set(Uint8Array.from(title), base + 8);
  } else {
    block.set(encodeCharField(champion.title, 20), base + 8);
  }

  block[base + 28] = champion.facing & 0xff;
  block[base + 29] = champion.partyPosition & 0xff;
  block[base + 30] = 1;
  block[base + 31] = 2;
  block[base + 32] = champion.attackType & 0xff;
  // `byte33`, the index of the next rune. Every CSBWin writer of it keeps it at
  // `strlen(incantation) & 3` — the add (`doc/CSBwin-src/CSBCode.cpp:9089-9093`), the
  // backspace (`Magic.cpp:817-820`), the cast (`:954-955`) and the two resets
  // (`Character.cpp:2653-2654`, `:5318-5319`) — so it is derived, never carried.
  block[base + 33] = champion.incantation.length & 3;
  const incantation = champion.incantationField;
  const live = champion.incantation;
  const keepRaw = incantation?.length === 4
    && incantationPrefix(incantation).length === live.length
    && incantationPrefix(incantation).every((b, i) => b === live[i]);
  for (let i = 0; i < 4; i++) {
    block[base + 34 + i] = ((keepRaw ? incantation[i] : live[i] ?? 0) ?? 0) & 0xff;
  }
  block[base + 40] = champion.damageFromDirection & 0xff;
  block[base + 41] = champion.maxRecentDamage & 0xff;
  block[base + 42] = champion.poisonCount & 0xff;
  setU16BE(block, base + 44, champion.busyTimerIndex);
  setU16BE(block, base + 46, champion.timerIndex);
  setU16BE(block, base + 48, champion.charFlags);
  setU16BE(block, base + 50, champion.wounds);
  setU16BE(block, base + 52, champion.attributes.health);
  setU16BE(block, base + 54, champion.attributes.maxHealth);
  setU16BE(block, base + 56, champion.attributes.stamina);
  setU16BE(block, base + 58, champion.attributes.maxStamina);
  setU16BE(block, base + 60, champion.attributes.mana);
  setU16BE(block, base + 62, champion.attributes.maxMana);
  setU16BE(block, base + 64, champion.attackStatModifier);
  setU16BE(block, base + 66, champion.food);
  setU16BE(block, base + 68, champion.water);

  for (let i = 0; i < 7; i++) {
    const at = base + ATTRIBUTES_OFFSET + i * 3;
    const stat = champion.attributes.stats[i];
    block[at] = (stat?.maximum ?? 0) & 0xff;
    block[at + 1] = (stat?.current ?? 0) & 0xff;
    block[at + 2] = (stat?.minimum ?? 0) & 0xff;
  }

  for (let i = 0; i < 20; i++) {
    const at = base + SKILLS_OFFSET + i * SKILL_SIZE;
    setU16BE(block, at, champion.skills[i]?.tempAdjust ?? 0);
    setU32BE(block, at + 2, champion.skills[i]?.experience ?? 0);
  }

  for (let i = 0; i < 30; i++) {
    // An empty slot is `RNnul`, which is what every empty slot holds in every
    // committed save.
    const rn = getChampionPossession(champion, i);
    setU16BE(block, base + POSSESSIONS_OFFSET + i * 2, rn);
  }

  setU16BE(block, base + 272, options.load?.(champion) ?? champion.load);
  setU16BE(block, base + 274, champion.shieldStrength);
  // Little-endian: `swapCharacter` stops at `shieldStrength`.
  writeU32LE(block, base + 276, champion.talents);
  writeU16LE(block, base + 280, champion.fingerprint);
  writeU16LE(block, base + 282, champion.causeOfDamage);
  writeU16LE(block, base + 284, champion.monsterCausingDamage);

  writePortrait(block, base, champion.portrait ?? options.portraitOf?.(champion));
}

/** The 128 bytes after the four `CHARDESC`s. The inverse of `readCsbwinPartyTail`. */
export function writeCsbwinPartyTail(block: Uint8Array, tail: CsbwinPartyTail): void {
  setU16BE(block, TAIL + 0, tail.brightness);
  block[TAIL + 2] = tail.seeThruWalls & 0xff;
  block[TAIL + 3] = tail.magicFootprintsActive & 0xff;
  setU16BE(block, TAIL + 4, tail.partyShield);
  setU16BE(block, TAIL + 6, tail.fireShield);
  setU16BE(block, TAIL + 8, tail.spellShield);
  block[TAIL + 10] = tail.numFootprintEnt & 0xff;
  block[TAIL + 11] = tail.freezeLifeTimer & 0xff;
  block[TAIL + 12] = tail.indexOfFirstMagicFootprint & 0xff;
  block[TAIL + 13] = tail.indexOfLastMagicFootprint & 0xff;
  for (let i = 0; i < 24; i++) setU16BE(block, TAIL + 14 + i * 2, tail.footprints[i] ?? 0);
  for (let i = 0; i < 24; i++) block[TAIL + 62 + i] = (tail.footprintAges[i] ?? 0) & 0xff;
  block[TAIL + 86] = tail.invisible & 0xff;
  // `Byte13195[41]` at 87..127 closes the block and is zero in every committed save.
}

/**
 * The whole of block 4: `CHARDESC[4]` then the 128-byte party tail, 3328 bytes.
 *
 * A slot past the party holds what `PartyState.vacantCharacters` says CSBWin holds
 * there, and without one the 800 zero bytes `DBank::Initialize` leaves
 * (`doc/CSBwin-src/CSBCode.cpp:333-340`), which is what every committed save with fewer
 * than four champions holds.
 */
export function buildCsbwinCharacterBlock(
  champions: Champion[],
  tail: CsbwinPartyTail,
  options: CsbwinCharacterWriteOptions = {},
  vacantCharacters: readonly VacantCharacter[] = [],
): Uint8Array {
  const block = new Uint8Array(CHARACTER_BLOCK_SIZE);
  for (let i = 0; i < Math.min(4, champions.length); i++) {
    writeCsbwinCharacter(block, i, champions[i]!, options);
  }
  for (let i = champions.length; i < 4; i++) {
    const vacant = vacantCharacters[i];
    if (vacant instanceof Uint8Array) block.set(vacant.subarray(0, CHARDESC_SIZE), i * CHARDESC_SIZE);
    else if (vacant) writeCsbwinCharacter(block, i, vacant, options);
  }
  writeCsbwinPartyTail(block, tail);
  return block;
}

/** The bytes from `at` reversed in place, `n` of them. */
function reverseBytes(record: Uint8Array, at: number, n: number): void {
  for (let i = 0; i < n / 2; i++) {
    const b = record[at + i]!;
    record[at + i] = record[at + n - 1 - i]!;
    record[at + n - 1 - i] = b;
  }
}

/**
 * `swapCharacter` (`doc/CSBwin-src/SaveGame.cpp:498-529`) on one 800-byte `CHARDESC`: the
 * fields the file holds big-endian reversed in place, from `busyTimer` at 44 to
 * `shieldStrength` at 274. It turns the file's form into the little-endian build's memory
 * and back, so it is its own inverse.
 */
export function swapCharacter(record: Uint8Array): void {
  for (let at = 44; at < 70; at += 2) reverseBytes(record, at, 2);
  for (let j = 0; j < 20; j++) {
    reverseBytes(record, SKILLS_OFFSET + j * SKILL_SIZE, 2);
    reverseBytes(record, SKILLS_OFFSET + j * SKILL_SIZE + 2, 4);
  }
  for (let j = 0; j < 30; j++) reverseBytes(record, POSSESSIONS_OFFSET + j * 2, 2);
  reverseBytes(record, 272, 2);
  reverseBytes(record, 274, 2);
}

/** `Possession(index)` of a slot past the party: the record's own word, as CSBWin reads it. */
export function vacantPossession(vacant: VacantCharacter, index: number): ObjectID {
  if (vacant instanceof Uint8Array) return readU16BE(vacant, POSSESSIONS_OFFSET + index * 2) as ObjectID;
  return getChampionPossession(vacant, index);
}

export type { PartyState };
