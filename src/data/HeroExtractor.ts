import {
  DBType,
  decodeObjectID,
  OBJECT_ID_EOF,
  OBJECT_ID_NULL,
} from '../core/types';
import type { ObjectID, ui16 } from '../core/types';
import { getActuatorType, getActuatorValue } from './actuatorHelpers';
import { textStart } from './CsbwinDungeonConversions';
import type {
  ContainerRecord,
  DatabaseRecord,
  DungeonData,
  HeroInventoryItem,
  MapData,
  PresetHero,
  TextRecord,
} from './dungeonTypes';

const DELTA_X = [0, 1, 0, -1];
const DELTA_Y = [-1, 0, 1, 0];

export function extractPresetHeroes(data: DungeonData): PresetHero[] {
  if (!data.textWords || data.textWords.length === 0) return [];

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
          const decoded = decodeObjectID(rn);
          if (decoded.category !== DBType.ACTUATOR) continue;
          const actuator = data.databases.actuators.records[decoded.index];
          if (!actuator || getActuatorType(actuator) !== 127) continue;

          const pos = decoded.position;
          const textRef = scanTextRecords(data, map, mapIndex, x + DELTA_X[pos], y + DELTA_Y[pos], pos)
          if (!textRef) continue;

          // Through `textStart`, because `DB2::index()` is an entry number in the
          // indirect index once `ConvertToIndirectText` has run and a word offset
          // before it (`src/data/CsbwinDungeonConversions.ts`).
          const start = textStart(data, textRef.record.textOffset);
          if (!start) continue;
          const text = decodeHeroText(start.words, start.at);
          if (!text) continue;

          const heroBase = parseHeroDefinition(text);
          if (!heroBase) continue;

          const key = `${getActuatorValue(actuator)}:${textRef.index}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const inventory = collectHeroInventory(data, map, mapIndex, x, y, decoded.position);

          heroes.push({
            ...heroBase,
            textRecordIndex: textRef.index,
            textOffset: textRef.record.textOffset,
            portraitIndex: getActuatorValue(actuator),
            location: { map: mapIndex, x, y, wall: decoded.position },
            inventory,
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
  const decoded = decodeObjectID(rn);
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

function scanTextRecords(
  data: DungeonData,
  map: MapData,
  mapIndex: number,
  x: number,
  y: number,
  wallPos: number,
): { index: ui16; record: TextRecord } | null {
  let fallback: { index: ui16; record: TextRecord } | null = null;

  for (let rn = findFirstObject(data, map, mapIndex, x, y);
    rn !== OBJECT_ID_EOF;
    rn = getDBRecordLink(data, rn)
  ) {
    const decoded = decodeObjectID(rn);
    if (decoded.category !== DBType.TEXT) continue;
    const record = data.databases.texts.records[decoded.index];
    if (!record) continue;

    const entry = { index: decoded.index, record };
    if (!fallback) fallback = entry;
    if (decoded.position === wallPos) return entry;
  }

  return fallback;
}

function decodeHeroText(words: readonly ui16[], startWord: number): string | null {
  if (startWord < 0 || startWord >= words.length) return null;

  let wordIndex = startWord;
  let word = 0;
  let bitPos = 0;
  let out = '';

  for (;;) {
    if (bitPos === 0) {
      word = words[wordIndex++] ?? 0;
    }

    let code: number;
    if (bitPos === 0) code = (word >> 10) & 0x1f;
    else if (bitPos === 1) code = (word >> 5) & 0x1f;
    else code = word & 0x1f;
    bitPos = (bitPos + 1) % 3;

    if (code === 31) break;
    if (code < 26) {
      out += String.fromCharCode(65 + code);
      continue;
    }
    if (code === 26) {
      out += ' ';
      continue;
    }
    if (code === 27) {
      out += '.';
      continue;
    }
    if (code === 28) {
      out += '|';
      continue;
    }
    if (code === 30) {
      out += '%';
      continue;
    }
    return null;
  }

  return out.replace(/%(.)/g, (match, code) => {
    if (code === 'B') return '';
    if (code === 'C') return 'THE ';
    if (code === 'D') return 'YOU ';
    return match;
  });
}

function parseHeroDefinition(text: string): Omit<PresetHero, 'textRecordIndex' | 'textOffset' | 'portraitIndex' | 'location' | 'inventory'> | null {
  const parts = text.split('|');
  if (parts.length !== 7 || parts[2] !== '') return null;

  const stats = parts[4] ?? '';
  const attrs = parts[5] ?? '';
  const skills = parts[6] ?? '';

  // `doc/CSBwin-src/Character.cpp:602-641` clamps each to MAXHP/MAXSTAMINA/MAXMANA and
  // marks the hero illegal when it had to; we treat the overflow as a rejection, since
  // an illegal hero is not one this extractor should offer at all.
  const health = capped(statNumbers(stats.slice(0, 4)), 999);
  const stamina = capped(statNumbers(stats.slice(4, 8)), 9999);
  const mana = capped(statNumbers(stats.slice(8, 12)), 900);

  const luck = statNumbers(attrs.slice(0, 2));
  const strength = statNumbers(attrs.slice(2, 4));
  const dexterity = statNumbers(attrs.slice(4, 6));
  const wisdom = statNumbers(attrs.slice(6, 8));
  const vitality = statNumbers(attrs.slice(8, 10));
  const antiMagic = statNumbers(attrs.slice(10, 12));
  const antiFire = statNumbers(attrs.slice(12, 14));

  if (
    health === null ||
    stamina === null ||
    mana === null ||
    luck === null ||
    strength === null ||
    dexterity === null ||
    wisdom === null ||
    vitality === null ||
    antiMagic === null ||
    antiFire === null
  ) {
    return null;
  }

  return {
    name: parts[0] ?? '',
    title: parts[1] ?? '',
    gender: parts[3] ?? '',
    health,
    stamina,
    mana,
    luck,
    strength,
    dexterity,
    wisdom,
    vitality,
    antiMagic,
    antiFire,
    fighter: skillNumbers(skills.slice(0, 4), ['Swing', 'Thrust', 'Club', 'Parry']),
    ninja: skillNumbers(skills.slice(4, 8), ['Steal', 'Fight', 'Throw', 'Shoot']),
    priest: skillNumbers(skills.slice(8, 12), ['Identify', 'Heal', 'Influence', 'Defend']),
    wizard: skillNumbers(skills.slice(12, 16), ['Fire', 'Air', 'Earth', 'Water']),
    // `doc/CSBwin-src/Character.cpp:682-687` — three `GetOneValue` reads follow the
    // sixteen skill letters. The third, `randomPoints`, is parsed by CSBWin and then
    // never used: `_ResurrectReincarnateCancel` hardcodes twelve points
    // (`doc/CSBwin-src/CSBCode.cpp:6779`), so it is not carried here.
    reincarnateAttributePenalty: oneValueOr(skills, 16, 16, 2),
    reincarnateStatPenalty: oneValueOr(skills, 17, 16, 8),
  };
}

/**
 * `GetOneValue` (`doc/CSBwin-src/Character.cpp:433-437`) plus the caller's range check:
 * a letter outside 'A'..'Z' yields 0xff, and anything above `limit` falls back.
 */
function oneValueOr(text: string, offset: number, limit: number, fallback: number): number {
  const ch = text.charCodeAt(offset);
  const value = Number.isNaN(ch) || ch < 65 || ch > 90 ? 0xff : ch - 65;
  return value > limit ? fallback : value;
}

/**
 * `DecodeCharacterValue` (`doc/CSBwin-src/Character.cpp:414-431`) — one hex nibble per
 * character, each of which must be 'A'..'P'. Anything else returns -1, which makes
 * `AddCharacter` mark the hero illegal and fall back to its built-in `legalHero`.
 */
function statNumbers(value: string): number | null {
  if (value.length === 0) return null;
  let result = 0;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 80) return null;
    result = (result << 4) + (code - 65);
  }
  return result;
}

function capped(value: number | null, limit: number): number | null {
  if (value === null || value > limit) return null;
  return value;
}

function skillNumbers(value: string, names: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < names.length; i++) {
    const code = value.charCodeAt(i) - 65;
    out[names[i]] = code >= 0 ? code : 0;
  }
  return out;
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
    const decoded = decodeObjectID(rn);
    if (decoded.category < DBType.WEAPON || decoded.category > DBType.MISC) continue;
    if (decoded.position !== position) continue;
    items.push(buildInventoryItem(data, rn, new Set<ObjectID>()));
  }
  return items;
}

function buildInventoryItem(data: DungeonData, rn: ObjectID, visited: Set<ObjectID>): HeroInventoryItem {
  const decoded = decodeObjectID(rn);
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
