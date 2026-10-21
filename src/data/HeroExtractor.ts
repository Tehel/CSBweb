/**
 * The heroes behind a dungeon's mirrors, for the tools and the probe: each type-127
 * actuator, the hero `AddCharacter` would read standing in front of it, and the objects in
 * its wall. The game itself reads the hero at the click (`HallOfChampions.addCharacter`);
 * this is the same reading done ahead, with the same decoder and the same escape tables.
 * And the reading itself, `AddCharacter`'s of a hero text (`readHeroText`), which the
 * engine's `AddCharacter` makes a champion of.
 */
import {
  DBType,
  OBJECT_ID_EOF,
  OBJECT_ID_NULL,
} from '../core/types';
import type { ObjectID, ui8, ui16 } from '../core/types';
import { sw } from '../core/intCast';
import { getActuatorType, getActuatorValue } from './actuatorHelpers';
import { DecodeText } from './DecodeText';
import type {
  ContainerRecord,
  DatabaseRecord,
  DungeonData,
  HeroInventoryItem,
  MapData,
  TextRecord,
} from './dungeonTypes';
import type { TextDecodeTables } from './tables/ObjectTables';
import type { DirectionTables } from '../engine/RelativeXY';

/** A mirror's hero: what its text gives, the portrait it names, and what lies in its wall. */
export interface PresetHero extends HeroText {
  /** The text read, or -1 for none: `legalHero`'s. */
  textRecordIndex: number;
  portraitIndex: ui16;
  location: { map: ui8; x: ui8; y: ui8; wall: ui8 };
  inventory: HeroInventoryItem[];
}

export function extractPresetHeroes(data: DungeonData, tables: TextDecodeTables, directions: DirectionTables): PresetHero[] {
  const heroes: PresetHero[] = [];
  const seen = new Set<string>();

  for (let mapIndex = 0; mapIndex < data.maps.length; mapIndex++) {
    const map = data.maps[mapIndex];
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        for (let rn = findFirstObject(data, map, mapIndex, x, y);
          rn !== OBJECT_ID_EOF;
          rn = getDBRecordLink(data, rn)
        ) {
          const decoded = data.rnMaps.decode(rn);
          if (decoded.category !== DBType.ACTUATOR) continue;
          const actuator = data.databases.actuators.records[decoded.index];
          if (!actuator || getActuatorType(actuator) !== 127) continue;

          // The party clicks the mirror from the cell its wall faces, and `AddCharacter`
          // reads the text in that cell (`doc/CSBwin-src/Character.cpp:536-550`).
          const pos = decoded.position;
          const textRef = firstText(data, map, mapIndex, x + directions.deltaX[pos]!, y + directions.deltaY[pos]!);
          const text = textRef ? DecodeText(data, textRef.record, 0x8002, 990, tables) : null;
          const textRecordIndex = textRef ? textRef.index : -1;

          const key = `${getActuatorValue(actuator)}:${textRecordIndex}`;
          if (seen.has(key)) continue;
          seen.add(key);

          heroes.push({
            ...readHeroText(text),
            textRecordIndex,
            portraitIndex: getActuatorValue(actuator),
            location: { map: mapIndex, x, y, wall: pos },
            inventory: collectHeroInventory(data, map, mapIndex, x, y, pos),
          });
        }
      }
    }
  }

  return heroes;
}

function getObjectListIndex(data: DungeonData, map: MapData, mapIndex: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= map.descriptor.width || y >= map.descriptor.height) return -1;

  const cellFlag = map.cellFlags[x]?.[y] ?? 0;
  if ((cellFlag & 0x10) === 0) return -1;

  const baseCol = data.levelIndex[mapIndex] + x;
  const colBase = data.columnIndex[baseCol] ?? 0;
  let idx = colBase;

  for (let yy = 0; yy < y; yy++) {
    if ((map.cellFlags[x]?.[yy] ?? 0) & 0x10) idx++;
  }

  return idx;
}

function findFirstObject(data: DungeonData, map: MapData, mapIndex: number, x: number, y: number): ObjectID {
  const idx = getObjectListIndex(data, map, mapIndex, x, y);
  if (idx < 0) return OBJECT_ID_EOF;
  return data.objectList[idx] ?? OBJECT_ID_EOF;
}

function getDBRecordLink(data: DungeonData, rn: ObjectID): ObjectID {
  if (rn === OBJECT_ID_EOF || rn === OBJECT_ID_NULL) return OBJECT_ID_EOF;
  const decoded = data.rnMaps.decode(rn);
  const index = decoded.index;

  switch (decoded.category) {
    case DBType.DOOR:
      return data.databases.doors.records[index]?.nextObject ?? OBJECT_ID_EOF;
    case DBType.TELEPORTER:
      return data.databases.teleporters.records[index]?.nextObject ?? OBJECT_ID_EOF;
    case DBType.TEXT:
      return data.databases.texts.records[index]?.nextObject ?? OBJECT_ID_EOF;
    case DBType.ACTUATOR:
      return data.databases.actuators.records[index]?.nextObject ?? OBJECT_ID_EOF;
    case DBType.CREATURE:
      return data.databases.creatures.records[index]?.nextObject ?? OBJECT_ID_EOF;
    case DBType.WEAPON:
      return data.databases.weapons.records[index]?.nextObject ?? OBJECT_ID_EOF;
    case DBType.CLOTHING:
      return data.databases.clothing.records[index]?.nextObject ?? OBJECT_ID_EOF;
    case DBType.SCROLL:
      return data.databases.scrolls.records[index]?.nextObject ?? OBJECT_ID_EOF;
    case DBType.POTION:
      return data.databases.potions.records[index]?.nextObject ?? OBJECT_ID_EOF;
    case DBType.CHEST:
      return data.databases.containers.records[index]?.nextObject ?? OBJECT_ID_EOF;
    case DBType.MISC:
      return data.databases.misc.records[index]?.nextObject ?? OBJECT_ID_EOF;
    case DBType.MISSILE:
      return data.databases.missiles.records[index]?.nextObject ?? OBJECT_ID_EOF;
    case DBType.CLOUD:
      return data.databases.clouds.records[index]?.nextObject ?? OBJECT_ID_EOF;
    default:
      return OBJECT_ID_EOF;
  }
}

/** The first `dbTEXT` in the cell's chain, at any corner (`Character.cpp:536-542`). */
function firstText(
  data: DungeonData,
  map: MapData,
  mapIndex: number,
  x: number,
  y: number,
): { index: ui16; record: TextRecord } | null {
  for (let rn = findFirstObject(data, map, mapIndex, x, y);
    rn !== OBJECT_ID_EOF;
    rn = getDBRecordLink(data, rn)
  ) {
    const decoded = data.rnMaps.decode(rn);
    if (decoded.category !== DBType.TEXT) continue;
    const record = data.databases.texts.records[decoded.index];
    return record ? { index: decoded.index, record } : null;
  }
  return null;
}

function collectHeroInventory(
  data: DungeonData,
  map: MapData,
  mapIndex: number,
  x: number,
  y: number,
  position: number,
): HeroInventoryItem[] {
  const items: HeroInventoryItem[] = [];
  for (let rn = findFirstObject(data, map, mapIndex, x, y);
    rn !== OBJECT_ID_EOF;
    rn = getDBRecordLink(data, rn)
  ) {
    const decoded = data.rnMaps.decode(rn);
    if (decoded.category < DBType.WEAPON || decoded.category > DBType.MISC) continue;
    if (decoded.position !== position) continue;
    items.push(buildInventoryItem(data, rn, new Set<ObjectID>()));
  }
  return items;
}

function buildInventoryItem(data: DungeonData, rn: ObjectID, visited: Set<ObjectID>): HeroInventoryItem {
  const decoded = data.rnMaps.decode(rn);
  if (visited.has(rn)) {
    return {
      rn,
      position: decoded.position,
      category: decoded.category,
      index: decoded.index,
      record: null,
    };
  }
  visited.add(rn);

  const record = getRecordByType(data, decoded.category, decoded.index);
  const item: HeroInventoryItem = {
    rn,
    position: decoded.position,
    category: decoded.category,
    index: decoded.index,
    record,
  };

  if (decoded.category === DBType.CHEST) {
    const container = record as ContainerRecord | null;
    const start = container?.containedObject ?? OBJECT_ID_NULL;
    if (start !== OBJECT_ID_EOF && start !== OBJECT_ID_NULL) {
      item.containedItems = collectObjectChain(data, start, visited);
    }
  }

  return item;
}

function collectObjectChain(data: DungeonData, start: ObjectID, visited: Set<ObjectID>): HeroInventoryItem[] {
  const out: HeroInventoryItem[] = [];
  for (let rn = start; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = getDBRecordLink(data, rn)) {
    out.push(buildInventoryItem(data, rn, visited));
  }
  return out;
}

function getRecordByType(data: DungeonData, category: DBType, index: number): DatabaseRecord | null {
  switch (category) {
    case DBType.DOOR:
      return data.databases.doors.records[index] ?? null;
    case DBType.TELEPORTER:
      return data.databases.teleporters.records[index] ?? null;
    case DBType.TEXT:
      return data.databases.texts.records[index] ?? null;
    case DBType.ACTUATOR:
      return data.databases.actuators.records[index] ?? null;
    case DBType.CREATURE:
      return data.databases.creatures.records[index] ?? null;
    case DBType.WEAPON:
      return data.databases.weapons.records[index] ?? null;
    case DBType.CLOTHING:
      return data.databases.clothing.records[index] ?? null;
    case DBType.SCROLL:
      return data.databases.scrolls.records[index] ?? null;
    case DBType.POTION:
      return data.databases.potions.records[index] ?? null;
    case DBType.CHEST:
      return data.databases.containers.records[index] ?? null;
    case DBType.MISC:
      return data.databases.misc.records[index] ?? null;
    case DBType.MISSILE:
      return data.databases.missiles.records[index] ?? null;
    case DBType.CLOUD:
      return data.databases.clouds.records[index] ?? null;
    default:
      return null;
  }
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
export const NEOPHYTE_SKILLS = false;

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
