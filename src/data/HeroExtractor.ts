/**
 * The heroes behind a dungeon's mirrors, for the tools and the probe: each type-127
 * actuator, the hero `AddCharacter` would read standing in front of it, and the objects in
 * its wall. The game itself reads the hero at the click (`HallOfChampions.addCharacter`);
 * this is the same reading done ahead, with the same decoder and the same escape tables.
 */
import {
  DBType,
  OBJECT_ID_EOF,
  OBJECT_ID_NULL,
} from '../core/types';
import type { ObjectID, ui8, ui16 } from '../core/types';
import { readHeroText, type HeroText } from '../engine/AddCharacter';
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
