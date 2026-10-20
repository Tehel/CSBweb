/**
 * `AddCharacter` (`doc/CSBwin-src/Character.cpp:457`) — the Hall of Champions.
 *
 * The engine half: the fingerprint, the champion's corner of the cell, the possession
 * slot chosen for each object lying in the mirror, and the champion record built out of
 * a hero text. `HallOfChampions.addCharacter` drives it;
 * `HallOfChampions.resurrectReincarnateCancel` is the other end
 * (`doc/CSBwin-src/CSBCode.cpp:6674`).
 */

import { DescIndexOfRecord } from './objectIndex';
import { DBType, OBJECT_ID_NULL, type Direction, type ObjectID } from '../core/types';
import type { DatabaseRecord, HeroInventoryItem } from '../data/dungeonTypes';
import type { PresetHero } from '../data/HeroExtractor';
import { sw } from '../core/intCast';
import { CHARFLAG_MALE, emptyPossessions, type Champion } from './gameTypes';
import { makeAddCharacterAttributes } from './attributes';
import { createSkillsFromSubskillLevels } from './skills';
import { getFromWings, type WingsPool } from './Wings';

export interface AddCharacterTables {
  carryLocation: ArrayLike<number>;
  objDescWord4: ArrayLike<number>;
}

/** One object lying in the mirror's cell, as the slot chooser needs to see it. */
export interface AddCharacterItem {
  rn: ObjectID;
  category: DBType;
  record: DatabaseRecord | null;
}

/**
 * `FingerprintExists` (`doc/CSBwin-src/Character.cpp:438-451`): a champion of the party
 * has it, or one in the wings (`GetFromWings`, testing only).
 */
function fingerprintExists(champions: Champion[], pool: WingsPool, fingerprint: number): boolean {
  if (champions.some((champ) => champ.fingerprint === (fingerprint & 0xffff))) return true;
  return getFromWings(pool, fingerprint, true) !== null;
}

/**
 * `AddCharacter`'s fingerprint (`doc/CSBwin-src/Character.cpp:515-519`) —
 * `(partyLevel<<10)|(partyX<<5)|partyY`, bumped until unused. This is the key the
 * champion's bones record resolves through, so it must be derived, not invented.
 */
export function computeChampionFingerprint(
  champions: Champion[],
  pool: WingsPool,
  level: number,
  x: number,
  y: number,
): number {
  let fingerprint = ((level << 10) | (x << 5) | y) & 0xffff;
  while (fingerprintExists(champions, pool, fingerprint)) {
    fingerprint = (fingerprint + 1) & 0xffff;
  }
  return fingerprint;
}

/**
 * `doc/CSBwin-src/Character.cpp:523-529` — the new champion takes the first corner of
 * the cell nobody stands in, counting round from the party's facing.
 */
export function findFreeCharPosition(champions: Champion[], partyFacing: number): number {
  let step = 0;
  while (step < 4 && characterAtPosition(champions, (step + partyFacing) & 3) !== -1) {
    step++;
  }
  return (step + partyFacing) & 3;
}

/**
 * `CharacterAtPosition` (`doc/CSBwin-src/Code11f52.cpp:4084`) — the champion standing
 * in a given corner, or -1.
 *
 * A corner held by a **dead** champion counts as free: CSBWin returns `i` only inside
 * `if (d.CH16482[i].HP() != 0)` and otherwise keeps looking (`:4100-4104`). That is
 * load-bearing in both callers. A new champion may take a corpse's corner; and
 * `BringCharacterToLife` asks this about the champion it is *about to* revive, who is
 * still dead — were they to match themselves, every resurrection would relocate, and
 * a full party of four would send the free-corner search below off the end.
 */
export function characterAtPosition(champions: Champion[], position: number): number {
  for (let i = 0; i < champions.length; i++) {
    const champ = champions[i];
    if (!champ) continue;
    if ((champ.partyPosition | 0) !== position) continue;
    if ((champ.attributes?.health | 0) !== 0) return i;
  }
  return -1;
}

/**
 * `AddCharacter`'s possession loop (`doc/CSBwin-src/Character.cpp:731-791`). The slot
 * choice is here; `place` is the `AddCharacterPossession` (`:790`), called for each
 * object as it is chosen, and it must write `possessions`, which the next choice reads.
 * By default it writes the slot and nothing else.
 *
 * The control flow is CSBWin's `switch` with two `goto case9`s and a `switchbreak`
 * label, kept shape-for-shape because the fall-throughs are the behaviour: a scroll or
 * potion whose slot 11 is taken sets slot 6 and then *jumps past it*, so slot 6 is
 * never actually used, and clothing that matches no body slot lands on the neck only if
 * the neck is both legal and free.
 */
export function assignAddCharacterPossessions(
  items: Iterable<AddCharacterItem>,
  tables: AddCharacterTables,
  possessions: ObjectID[],
  place: (rn: ObjectID, slot: number) => void = (rn, slot) => { possessions[slot] = rn; },
): void {
  let nextBackpackSlot = 13;

  for (const item of items) {
    // CSBWin filters on `dbType() > dbACTUATOR` and then falls off the end of the
    // switch for dbCREATURE/dbMISSILE/dbCLOUD, leaving `LOCAL_6` at whatever the
    // previous iteration left it. That is undefined behaviour, not behaviour: we skip
    // those categories instead.
    if (item.category < DBType.WEAPON || item.category > DBType.MISC) continue;

    const carryMask = getCarryMask(item, tables.objDescWord4) ?? 0;
    const neckLegal = (carryMask & getCarryLocation(tables.carryLocation, 10)) !== 0;
    let slot = -1;
    let toCase9 = false;

    switch (item.category) {
      case DBType.CLOTHING: {
        let matched = false;
        for (slot = 2; slot <= 5; slot++) {
          if ((carryMask & getCarryLocation(tables.carryLocation, slot)) !== 0) {
            matched = true;
            break;
          }
        }
        if (matched) break;
        if (neckLegal && possessions[10] === OBJECT_ID_NULL) {
          slot = 10;
          break;
        }
        toCase9 = true;
        break;
      }
      case DBType.WEAPON:
        if (possessions[1] !== OBJECT_ID_NULL) {
          toCase9 = true;
          break;
        }
        slot = 1;
        break;
      case DBType.SCROLL:
      case DBType.POTION:
        if (possessions[11] === OBJECT_ID_NULL) {
          slot = 11;
          break;
        }
        if (possessions[6] === OBJECT_ID_NULL) slot = 6;
        toCase9 = true;
        break;
      default:
        // dbCHEST and dbMISC enter at `case9:` directly.
        toCase9 = true;
        break;
    }

    // `case9:` — neck if it will take the object, otherwise the next backpack slot.
    // Reached again from `switchbreak:` when the chosen slot turns out to be full.
    for (;;) {
      if (toCase9) {
        if (neckLegal && possessions[10] === OBJECT_ID_NULL) {
          slot = 10;
        } else {
          slot = nextBackpackSlot++;
        }
      }
      // `switchbreak:`
      if (slot >= 0 && slot < possessions.length && possessions[slot] !== OBJECT_ID_NULL) {
        toCase9 = true;
        continue;
      }
      break;
    }

    if (slot >= 0 && slot < 30) {
      place(item.rn, slot);
    }
  }
}

/**
 * The same slot choice over a `PresetHero`'s pre-scanned inventory, for the tools. The
 * real Hall of Champions flow goes through `assignAddCharacterPossessions` over the live
 * cell.
 */
export function assignPresetHeroPossessions(
  items: HeroInventoryItem[],
  tables: AddCharacterTables,
): ObjectID[] {
  const possessions = emptyPossessions();
  assignAddCharacterPossessions(items, tables, possessions);
  return possessions;
}

/** The `Champion` fields `addCharacterDefaults` initializes. */
type ChampionDefaults = Pick<
  Champion,
  | 'busyTimerIndex' | 'attackType' | 'attackStatModifier'
  | 'wounds' | 'poisonCount' | 'maxRecentDamage' | 'damageFromDirection' | 'shieldStrength'
  | 'charFlags' | 'timerIndex' | 'talents' | 'causeOfDamage' | 'monsterCausingDamage' | 'load'
  | 'title' | 'facing' | 'fingerprint'
>;

/**
 * What `AddCharacter` gives every `CHARDESC` before it reads the hero: the whole record
 * cleared, `ClearMemory((ui8 *)pcA3, 800)` (`doc/CSBwin-src/Character.cpp:482`), then its
 * constant stores (`:513-522`). The one initializer of these fields:
 * `createChampionFromPreset` and the tools' champion builders spread it, and
 * `Party.setState` fills an older save's gaps from it.
 */
export function addCharacterDefaults(): ChampionDefaults {
  return {
    busyTimerIndex: -1, // `pcA3->busyTimer = -1` (`:521`)
    attackType: -1, // `pcA3->attackType = -1` (`:520`)
    attackStatModifier: 0, // `word64`, cleared
    wounds: 0, // `ouches`, cleared
    poisonCount: 0,
    maxRecentDamage: 0,
    damageFromDirection: 0, // `facing3`, cleared here; `AddCharacter` sets it at `:532`
    shieldStrength: 0,
    // `CHARFLAG_positionChanged` (`:531`) is a redraw flag, which the port does not model;
    // `createChampionFromPreset` ORs in `CHARFLAG_male` (`:595`).
    charFlags: 0,
    timerIndex: -1, // `pcA3->timerIndex = -1` (`:522`)
    talents: 0, // `pcA3->talents = 0` (`:513`)
    causeOfDamage: 0,
    monsterCausingDamage: 0,
    load: 0,
    title: '', // read off the hero text (`:586-591`); `createChampionFromPreset` sets it
    // Cleared here. `AddCharacter` then sets `d.partyFacing` (`:523`), and so does
    // `HallOfChampions.addCharacter`.
    facing: 0,
    // Cleared here. `AddCharacter` computes it (`:514-517`), and so do
    // `HallOfChampions.addCharacter` and `HallOfChampions.addChampion`.
    fingerprint: 0,
  };
}

/**
 * What `AddCharacter` reads off a hero text (`doc/CSBwin-src/Character.cpp:558-702`):
 * the fields it stores in the `CHARDESC`, and the two reincarnation penalties it leaves in
 * file-scope globals for `_ResurrectReincarnateCancel`.
 */
export interface HeroText {
  name: string;
  title: string;
  male: boolean;
  health: number;
  stamina: number;
  mana: number;
  /** `Attributes[0..6]`, in their order: Luck first. */
  luck: number;
  strength: number;
  dexterity: number;
  wisdom: number;
  vitality: number;
  antiMagic: number;
  antiFire: number;
  /** The sixteen skill letters, `'A'` as 0: each sets `skills92[4..19]` to `125 << level`. */
  skillLevels: number[];
  /**
   * `reincarnateAttributePenalty` / `reincarnateStatPenalty` (`:683-686`): the sixteenths
   * the Reincarnate button charges, read after the skill letters. A text that stops at the
   * skills, as every shipped DM hero's does, reads 0xff for both, out of range, so 2 and 8.
   */
  reincarnateAttributePenalty: number;
  reincarnateStatPenalty: number;
  talents: number;
  /** The text failed a check, and these are `legalHero`'s fields instead. */
  illegal: boolean;
}

/**
 * `legalHero` (`doc/CSBwin-src/Character.cpp:476-477`): the hero read when the party's
 * cell holds no text, and read again in place of a text that fails a check.
 */
const LEGAL_HERO = Uint8Array.from(
  'BOGUS\nILLEGAL HERO\n\nM\nAABBAABBAABB\nABABABABABABAB\nCCCCCCCCCCCCCCCC\0',
  (c) => c.charCodeAt(0),
);
const MAXHP = 999; // `doc/CSBwin-src/CSB.h:2511-2513`
const MAXSTAMINA = 9999;
const MAXMANA = 900;
/** `neophyteSkills` (`doc/CSBwin-src/data.cpp:91`) is only set by a recording's playback. */
const NEOPHYTE_SKILLS = false;

/**
 * `AddCharacter`'s reading of a hero text (`doc/CSBwin-src/Character.cpp:558-702`), over
 * the bytes `DecodeText(…, 0x8002, 990)` made of it, or `legalHero`'s when the cell had no
 * text (`null`). `for (illegalHero=true; illegalHero; A2=legalHero)`: a text that fails any
 * check is read no further and `legalHero` is read in its place. CSBWin reads on past a
 * clamped HP, stamina or mana before it retries, but the retry writes every field again, so
 * stopping at the first failure gives the same champion.
 */
export function readHeroText(text: Uint8Array | null): HeroText {
  for (let A2 = text ?? LEGAL_HERO; ; A2 = LEGAL_HERO) {
    const hero = readHeroTextOnce(A2);
    if (hero) return { ...hero, illegal: A2 !== text };
  }
}

function readHeroTextOnce(buf: Uint8Array): Omit<HeroText, 'illegal'> | null {
  let a = 0;
  const next = (): number => buf[a++] ?? 0; // past the NUL, a byte the loops still end on
  // The name, to the first line break, at most seven characters (`:559-568`).
  let name = '';
  for (let c = next(); c !== 10; c = next()) {
    if (name.length >= 7) return null;
    name += String.fromCharCode(c);
  }
  // The title runs to the second line break, its two lines joined with nothing between
  // them (CSB's "SPELLWEAVER OF KE" and "LT"), at most nineteen characters (`:571-591`).
  let title = '';
  for (let lines = 0; ;) {
    const c = next();
    if (c === 10) {
      if (lines !== 0) break;
      lines = 1;
    } else {
      if (title.length >= 19) return null;
      title += String.fromCharCode(c);
    }
  }
  // `:592-601`
  const gender = next();
  if (gender !== 0x4d && gender !== 0x46) return null; // 'M', 'F'
  a++;
  // `:602-641`: each of the three is illegal past its maximum, and as -1 (a letter
  // outside 'A'..'P'); `(unsigned)` makes any negative value the first.
  const health = DecodeCharacterValue(buf, a, 4);
  if (health < 0 || health > MAXHP) return null;
  a += 4;
  const stamina = DecodeCharacterValue(buf, a, 4);
  if (stamina < 0 || stamina > MAXSTAMINA) return null;
  a += 4;
  const mana = DecodeCharacterValue(buf, a, 4);
  if (mana < 0 || mana > MAXMANA) return null;
  a += 5;
  // `:642-657`: two letters each, above 224 held at 224.
  const attributes: number[] = [];
  for (let i = 0; i <= 6; i++) {
    const value = DecodeCharacterValue(buf, a, 2);
    if (value === -1) return null;
    attributes.push(Math.min(value, 224));
    a += 2;
  }
  a++;
  // `:662-681`: 'A' is no experience, 'B'..'R' are levels 1 to 17, anything else illegal.
  const skillLevels: number[] = [];
  for (let i = 0; i < 16; i++) {
    const level = (next() << 24 >> 24) - 0x41; // `*(A2++)` is a signed char
    if (((level > 0) || NEOPHYTE_SKILLS) && level <= 17) skillLevels.push(level);
    else if (level === 0) skillLevels.push(0);
    else return null;
  }
  // `:682-689`. `randomPoints` is read and never used: `_ResurrectReincarnateCancel`
  // hardcodes twelve points (`doc/CSBwin-src/CSBCode.cpp:6838`).
  const getOneValue = (): number => {
    const c = buf[a] ?? 0;
    if (c < 0x41 || c > 0x5a) return 0xff;
    a++;
    return c - 0x41;
  };
  let reincarnateAttributePenalty = getOneValue();
  if (reincarnateAttributePenalty > 16) reincarnateAttributePenalty = 2;
  let reincarnateStatPenalty = getOneValue();
  if (reincarnateStatPenalty > 16) reincarnateStatPenalty = 8;
  getOneValue();
  const talents = DecodeCharacterValue(buf, a, 8, true) >>> 0; // `ui32 talents`

  const [luck, strength, dexterity, wisdom, vitality, antiMagic, antiFire] = attributes as
    [number, number, number, number, number, number, number];
  return {
    name, title, male: gender === 0x4d,
    health, stamina, mana,
    luck, strength, dexterity, wisdom, vitality, antiMagic, antiFire,
    skillLevels, reincarnateAttributePenalty, reincarnateStatPenalty, talents,
  };
}

/**
 * `DecodeCharacterValue` (`doc/CSBwin-src/Character.cpp:415-432`): `num` letters 'A'..'P',
 * a nibble each. Any other letter is -1, but a NUL ends a truncatable value early, and
 * that value is returned without `sw`.
 */
function DecodeCharacterValue(buf: Uint8Array, at: number, num: number, allowTruncation = false): number {
  let result = 0;
  do {
    result <<= 4;
    const c = buf[at] ?? 0;
    if (c < 0x41 || c > 0x50) {
      if (allowTruncation && c === 0) return result;
      return -1;
    }
    result += c - 0x41;
    at++;
    num--;
  } while (num !== 0);
  return sw(result);
}

/** `createChampionFromHeroText` with the portrait the preset hero's mirror names, for the tools. */
export function createChampionFromPreset(
  hero: PresetHero,
  partyPosition: number,
  possessions?: ObjectID[],
): Champion {
  return createChampionFromHeroText(hero, hero.portraitIndex, partyPosition, possessions);
}

/** The champion record `AddCharacter` fills from a hero text, with portrait `charID`. */
export function createChampionFromHeroText(
  hero: HeroText,
  charID: number,
  partyPosition: number,
  possessions?: ObjectID[],
): Champion {
  const maxHealth = hero.health;
  const maxStamina = hero.stamina;
  const maxMana = hero.mana;
  const slots = possessions ?? emptyPossessions();
  // `:662-701`, with `neophyteSkills` off: a level-0 letter leaves the skill at nothing.
  const skills = createSkillsFromSubskillLevels(hero.skillLevels, NEOPHYTE_SKILLS);

  return {
    ...addCharacterDefaults(),
    name: hero.name,
    title: hero.title,
    attributes: {
      health: maxHealth,
      maxHealth,
      stamina: maxStamina,
      maxStamina,
      mana: maxMana,
      maxMana,
      // `AddCharacter` reads the seven attributes off the mirror's text in this
      // order and gives each the same Maximum and Current
      // (`doc/CSBwin-src/Character.cpp:641-660`).
      stats: makeAddCharacterAttributes([
        hero.luck,
        hero.strength,
        hero.dexterity,
        hero.wisdom,
        hero.vitality,
        hero.antiMagic,
        hero.antiFire,
      ]),
    },
    // `if (D0W == 'M') pcA3->charFlags |= CHARFLAG_male;` (`Character.cpp:592-601`).
    charFlags: hero.male ? CHARFLAG_MALE : 0,
    talents: hero.talents, // `:689`
    portraitGraphic: charID,
    incantation: [],
    food: 1500,
    water: 1500,
    skills,
    possessions: slots,
    partyPosition,
    facing: (partyPosition & 3) as Direction,
  };
}

function getCarryLocation(carryLocation: ArrayLike<number>, slot: number): number {
  const value = carryLocation[slot];
  return typeof value === 'number' ? value : 0;
}

function getCarryMask(item: AddCharacterItem, masks: ArrayLike<number>): number | null {
  const objDescIndex = DescIndexOfRecord(item.category, item.record);
  if (objDescIndex === -1) return null;
  const mask = masks[objDescIndex];
  return typeof mask === 'number' ? mask : null;
}

