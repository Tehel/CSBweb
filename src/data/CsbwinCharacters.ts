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
 * - `portrait[1]` at 336 is really 464 bytes — `FILL337[800-337]` is the rest of it —
 *   and holds the champion's portrait **bitmap**. See `readPortrait` below.
 */
import type { Champion, PartyState, Skill } from '../engine/gameTypes';
import type { Attribute } from '../engine/attributes';
import { OBJECT_ID_NULL, type i16, type ui8, type ui16, type ObjectID } from '../core/types';
import { CHARDESC_SIZE, decodeCharField, encodeCharField } from './CsbwinSaveInfo';
import type { CsbwinObjectIndex } from './CsbwinObjectIndex';
import { readI16BE, readI32BE, readI8, readU16BE, readU32BE, readU8 } from '../core/bytes';

/** `CHARFLAG_male` — `AddCharacter` ORs it in for an 'M' hero (`Character.cpp:596`). */
export const CHARFLAG_MALE = 0x10;

/** The seven `ATTRIBUTE` triples start here, three bytes each, `FILL91` after them. */
const ATTRIBUTES_OFFSET = 70;
/** `SKILL skills92[20]`: `i16 tempAdjust` + `i32 experience`, six bytes each. */
const SKILLS_OFFSET = 92;
const SKILL_SIZE = 6;
/** `RN possessions[30]`, two bytes each. */
const POSSESSIONS_OFFSET = 212;
/**
 * `i8 portrait[1]` at 336 (`doc/CSBwin-src/CSB.h:2593`), with `FILL337[800-337]` after
 * it: 464 bytes, which is exactly `32*29/2` — the champion carries their **portrait
 * bitmap**, not an index to one. `AddCharacter` blits it out of basic graphic 26 for a
 * standard hero and out of `GetExternalPortraitAddress` for `charID > 23`
 * (`doc/CSBwin-src/Character.cpp:486-508`), and `CharacterPortraitToStatusBox` blits it
 * straight back to the status box at 16 bytes per line (`:4644-4656`).
 */
const PORTRAIT_OFFSET = 336;
/** 32 pixels wide, 29 rows, four bitplanes: 16 bytes per line, 464 in all. */
export const PORTRAIT_WIDTH = 32;
export const PORTRAIT_HEIGHT = 29;
const PORTRAIT_BYTES_PER_LINE = (PORTRAIT_WIDTH / 16) * 8;


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
    stats.push({ maximum: readU8(block, at), current: readU8(block, at + 1), minimum: readU8(block, at + 2) });
  }
  return stats;
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
 * original dungeon is read (`doc/CSBwin-src/SaveGame.cpp:2046-2064`), so from then on
 * that is what a champion carries. `objectIndex` translates them back into this port's
 * form; without it the slots read as categories 0 and 1 with indices far past those
 * databases, which is exactly what this reader used to report.
 */
function readPossessions(
  block: Uint8Array,
  base: number,
  objectIndex?: CsbwinObjectIndex,
): ObjectID[] {
  const slots: ObjectID[] = [];
  for (let i = 0; i < 30; i++) {
    const rn = readU16BE(block, base + POSSESSIONS_OFFSET + i * 2);
    // `RNeof` (0xfffe) and `RNnul` (0xffff) both mean "empty slot" here; the port keeps
    // only `RNnul`, which is what the writer puts back.
    if (rn === 0xffff || rn === 0xfffe) {
      slots.push(OBJECT_ID_NULL);
      continue;
    }
    slots.push((objectIndex ? objectIndex.resolve(rn) : rn) as ObjectID);
  }
  return slots;
}

/**
 * The portrait bitmap, unpacked from Atari bitplanes into this port's one-byte-per-pixel
 * form.
 *
 * `swapCharacter` lists every field it byte-swaps and the portrait is not among them
 * (`doc/CSBwin-src/SaveGame.cpp:490-521`), so these 464 bytes are the Atari layout the
 * graphics were loaded in: per 16 pixels, four big-endian plane words, plane 0 carrying
 * bit 0 of the colour index and the leftmost pixel in bit 15. That is what `TAG0088b2`
 * reads — `LE16(*puwA0)` over four consecutive words per group
 * (`doc/CSBwin-src/Graphics.cpp:764-779`).
 *
 * Proven, not inferred: `tools/dump-csbwin-load.ts` decodes the four champions of every
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
          colour |= ((planes[plane] >> (15 - bit)) & 1) << plane;
        }
        if (colour !== 0) any = true;
        pixels[y * PORTRAIT_WIDTH + group * 16 + bit] = colour as ui8;
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
  objectIndex?: CsbwinObjectIndex,
): CsbwinCharacter {
  const base = index * CHARDESC_SIZE;
  const name = decodeCharField(block.subarray(base, base + 8));
  const title = decodeCharField(block.subarray(base + 8, base + 28));
  const titleBytes = Array.from(block.subarray(base + 8, base + 28)) as ui8[];
  const incantationBytes = Array.from(block.subarray(base + 34, base + 38)) as ui8[];
  const slots = readPossessions(block, base, objectIndex);
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
    alive: readI16BE(block, base + 52) > 0,
    facing: readU8(block, base + 28) as 0 | 1 | 2 | 3,
    partyPosition: readU8(block, base + 29) as ui8,
    attackType: readI8(block, base + 32),
    // `StrLen(pcA3->incantation)` (`doc/CSBwin-src/Magic.cpp:812`) — a C string, so the
    // first zero ends it. This used to filter the zeros *out*, which resurrected the
    // symbols a cast leaves behind it: `CastSpell` clears `incantation[0]` and nothing
    // else (`:951`), so a champion who has just cast holds bytes like `00 69 6f 00` and
    // was being restored with two runes pending that CSBWin does not see.
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
    actionDisabledUntil: 0,
    possessions: slots,
    shieldStrength: readU16BE(block, base + 274),
    fingerprint: readU16BE(block, base + 280) as ui16,
    // Carried, not used: the save writer needs every field back, and these have no
    // reader in the engine yet. `charFlags` is where the champion's gender lives.
    charFlags,
    timerIndex: readI16BE(block, base + 46),
    incantationCursor: readU8(block, base + 33),
    talents: readU32BE(block, base + 276),
    load: readU16BE(block, base + 272),
    causeOfDamage: readU16BE(block, base + 282),
    monsterCausingDamage: readU16BE(block, base + 284),
    // The champion's own copy of their portrait. Champions this port creates instead
    // carry `portraitGraphic`, the graphic-26 cell `AddCharacter` blitted from; a save
    // has only the pixels, and for an externally supplied portrait that is all there
    // ever was.
    portrait: readPortrait(block, base),
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
/** Block 4 in full: four `CHARDESC` and the party tail (`doc/CSBwin-src/Data.h:765`). */
export const CHARACTER_BLOCK_SIZE = TAIL + 128;

export function readCsbwinPartyTail(block: Uint8Array): CsbwinPartyTail {
  const footprints: number[] = [];
  for (let i = 0; i < 24; i++) footprints.push(readU16BE(block, TAIL + 14 + i * 2));
  const footprintAges = Array.from(block.subarray(TAIL + 62, TAIL + 86));
  return {
    brightness: readI16BE(block, TAIL + 0),
    seeThruWalls: readU8(block, TAIL + 2),
    magicFootprintsActive: readU8(block, TAIL + 3),
    partyShield: readI16BE(block, TAIL + 4),
    fireShield: readI16BE(block, TAIL + 6),
    spellShield: readI16BE(block, TAIL + 8),
    numFootprintEnt: readU8(block, TAIL + 10),
    freezeLifeTimer: readU8(block, TAIL + 11),
    indexOfFirstMagicFootprint: readU8(block, TAIL + 12),
    indexOfLastMagicFootprint: readU8(block, TAIL + 13),
    footprints,
    footprintAges,
    invisible: readU8(block, TAIL + 86),
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
 * pixels — it carries `portraitGraphic`, the graphic-26 cell, because the engine holds
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
          planes[plane] |= ((colour >> plane) & 1) << (15 - bit);
        }
      }
      const word = at + y * PORTRAIT_BYTES_PER_LINE + group * 8;
      for (let plane = 0; plane < 4; plane++) setU16BE(block, word + plane * 2, planes[plane]);
    }
  }
}

/** What the packer needs that a `Champion` does not carry. */
export interface CsbwinCharacterWriteOptions {
  /**
   * `CHARDESC.load`, in tenths of a kilogram. CSBWin keeps it incrementally; this port
   * re-sums it (`CharacterStats.characterLoad`), so a live game passes that function
   * here. Without it the champion's own `load` is written — what the save it came from
   * said — and failing that, 0.
   */
  load?: (champion: Champion) => number;
  /**
   * `CHARDESC.portrait` for a champion the engine created, which carries
   * `portraitGraphic` and no pixels. A live game passes the renderer's cell lookup;
   * without it such a champion is written with a blank portrait.
   */
  portraitOf?: (champion: Champion) => ui8[] | undefined;
  /**
   * One packed RN as the indirect slot number a file wants — the inverse of the
   * `objectIndex.resolve` the reader applies to the same thirty words
   * (`doc/PROVEN_FACTS.md` → "An RN in a save file is an indirect index"). A live game
   * passes `buildObjectIndirectIndex(dungeon).encode`, and it must be the **same** index
   * whose maps go into block 0 and whose slot numbers go into the dungeon image.
   *
   * Without it the slots are written as this port's packed `[pos][db][idx]` ids, which
   * is what `tools/dump-character-block.ts` compares against a file byte for byte —
   * that tool reads its champions without an index, so the two forms coincide.
   */
  encodeRN?: (rn: number) => number;
}

/**
 * One `CHARDESC`, packed into `block` at `index`.
 *
 * Every field `readCsbwinCharacter` reads is written back at the offset it was read
 * from, plus the six that only the writer needs — `byte30`, `byte31`, `uByte43`, the
 * three `FILL` runs — which CSBWin fills with constants:
 * `pcA3->byte30 = 1; pcA3->byte31 = 2;` (`doc/CSBwin-src/Character.cpp:515-516`) over a
 * record `ClearMemory` has zeroed (`:478`).
 *
 * **Possessions go out through `options.encodeRN`.** In a save the thirty slots are
 * indirect slot numbers resolved through `dataTypeMap`/`dataIndexMap`
 * (`doc/PROVEN_FACTS.md` -> "An RN in a save file is an indirect index"), so a caller
 * writing a real file passes `buildObjectIndirectIndex(dungeon).encode` — the same index
 * whose maps go into block 0 and whose numbering the dungeon image uses. Left out, the
 * slots are written as this port's packed `[pos][db][idx]` ids, which is the right thing
 * for a block whose champions were read without an index: it round-trips byte for byte,
 * and that is what `tools/dump-character-block.ts` proves the packing with.
 */
export function writeCsbwinCharacter(
  block: Uint8Array,
  index: number,
  champion: Champion,
  options: CsbwinCharacterWriteOptions = {},
): void {
  const base = index * CHARDESC_SIZE;

  block.set(encodeCharField(champion.name ?? '', 8), base);
  // The raw bytes when the title carries more than its decoded string does — but only
  // while the two still agree. A champion renamed since the save was read (the
  // reincarnate screen does exactly that) must be written from the *string*, or the
  // rename would be silently dropped. Same rule for the incantation below.
  const title = champion.titleField;
  if (title && title.length === 20 && decodeCharField(Uint8Array.from(title)) === (champion.title ?? '')) {
    block.set(Uint8Array.from(title), base + 8);
  } else {
    block.set(encodeCharField(champion.title ?? '', 20), base + 8);
  }

  block[base + 28] = (champion.facing ?? 0) & 0xff;
  block[base + 29] = champion.partyPosition & 0xff;
  block[base + 30] = 1;
  block[base + 31] = 2;
  block[base + 32] = champion.attackType & 0xff;
  block[base + 33] = (champion.incantationCursor ?? (champion.incantation?.length ?? 0)) & 3;
  const incantation = champion.incantationField;
  const live = champion.incantation ?? [];
  const keepRaw = incantation?.length === 4
    && incantationPrefix(incantation).length === live.length
    && incantationPrefix(incantation).every((b, i) => b === live[i]);
  for (let i = 0; i < 4; i++) {
    block[base + 34 + i] = ((keepRaw ? incantation![i] : live[i] ?? 0) ?? 0) & 0xff;
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
    setU16BE(block, at, champion.skills?.[i]?.tempAdjust ?? 0);
    setU32BE(block, at + 2, champion.skills?.[i]?.experience ?? 0);
  }

  for (let i = 0; i < 30; i++) {
    // An empty slot is `RNnul`, which is what every empty slot holds in all twelve
    // committed saves.
    const rn = champion.possessions[i] ?? OBJECT_ID_NULL;
    setU16BE(block, base + POSSESSIONS_OFFSET + i * 2, options.encodeRN ? options.encodeRN(rn) : rn);
  }

  setU16BE(block, base + 272, options.load?.(champion) ?? champion.load);
  setU16BE(block, base + 274, champion.shieldStrength);
  setU32BE(block, base + 276, champion.talents);
  setU16BE(block, base + 280, champion.fingerprint ?? 0);
  setU16BE(block, base + 282, champion.causeOfDamage);
  setU16BE(block, base + 284, champion.monsterCausingDamage);

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
 * Slots past the party are left as `ClearMemory` leaves them — 800 zero bytes — which
 * is what `AddCharacter` guarantees and what every committed save holds.
 */
export function buildCsbwinCharacterBlock(
  champions: Champion[],
  tail: CsbwinPartyTail,
  options: CsbwinCharacterWriteOptions = {},
): Uint8Array {
  const block = new Uint8Array(CHARACTER_BLOCK_SIZE);
  for (let i = 0; i < Math.min(4, champions.length); i++) {
    writeCsbwinCharacter(block, i, champions[i], options);
  }
  writeCsbwinPartyTail(block, tail);
  return block;
}

export type { PartyState };
