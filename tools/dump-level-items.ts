import { readFileSync, writeFileSync } from 'node:fs';
import { DescIndexOfRecord } from '../src/engine/objectIndex';
import { resolve } from 'node:path';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { DungeonState } from '../src/engine/DungeonState';
import { DBType, decodeObjectID, OBJECT_ID_EOF } from '../src/core/types';
import { Position } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import type { ContainerRecord, DatabaseRecord, DungeonData } from '../src/data/dungeonTypes';

interface ToolOptions {
  file: string;
  graphics: string;
  out: string;
  map: number;
  all: boolean;
}

interface DumpItem {
  rn: ObjectID;
  map: number;
  x: number;
  y: number;
  position: number;
  category: DBType;
  index: number;
  objDescIndex: number | null;
  objectType: number | null;
  name: string | null;
  record: DatabaseRecord | null;
  containedItems?: DumpItem[];
}

const GRAPHIC_OBJECT_NAMES = 0x22c;
const GRAPHIC_22F = 0x22f;

const ABS_22F_START = 10340;
const ABS_OBJDESC = 8382;

const OBJDESC_COUNT = 180;
const OBJDESC_STRIDE = 6;

function parseArgs(argv: string[]): ToolOptions {
  const options: ToolOptions = {
    file: 'static/gamefiles/dm-atari/dungeon.dat',
    graphics: 'static/gamefiles/dm-atari/graphics.dat',
    out: 'tools/output/level0-items.json',  // tools/output is gitignored
    map: 0,
    all: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') {
      options.file = argv[i + 1] ?? options.file;
      i++;
      continue;
    }
    if (arg === '--out' || arg === '-o') {
      options.out = argv[i + 1] ?? options.out;
      i++;
      continue;
    }
    if (arg === '--graphics' || arg === '-g') {
      options.graphics = argv[i + 1] ?? options.graphics;
      i++;
      continue;
    }
    if (arg === '--map' || arg === '-m') {
      options.map = parseInt(argv[i + 1] ?? `${options.map}`, 10);
      i++;
      continue;
    }
    if (arg === '--all') {
      options.all = true;
    }
  }

  return options;
}

function readU16BE(raw: Uint8Array, off: number): number {
  const hi = raw[off] ?? 0;
  const lo = raw[off + 1] ?? 0;
  return (hi << 8) | lo;
}

function parseObjectNames(raw: Uint8Array): string[] {
  const names: string[] = [];
  let cursor = 0;
  let current = '';
  while (cursor < raw.length && names.length < 199) {
    const value = raw[cursor++] ?? 0;
    current += String.fromCharCode(value & 0x7f);
    if ((value & 0x80) !== 0) {
      names.push(current);
      current = '';
    }
  }
  return names;
}

function parseObjDescObjectType(raw: Uint8Array): number[] {
  const start = ABS_22F_START - ABS_OBJDESC;
  const end = start + OBJDESC_COUNT * OBJDESC_STRIDE;
  if (start < 0 || end > raw.length) {
    throw new Error('graphics.dat item 0x22f too small for ObjDesc[180]');
  }
  const out: number[] = [];
  for (let i = 0; i < OBJDESC_COUNT; i++) {
    const base = start + i * OBJDESC_STRIDE;
    out.push(readU16BE(raw, base));
  }
  return out;
}

/** `DescIndex` as the engine has it, with `null` for -1 and for a missing record. */
function getObjDescIndex(category: DBType, record: DatabaseRecord | null): number | null {
  if (!record) return null;
  const descIndex = DescIndexOfRecord(category, record);
  return descIndex === -1 ? null : descIndex;
}

function isItemCategory(category: DBType): boolean {
  return (
    category === DBType.WEAPON ||
    category === DBType.CLOTHING ||
    category === DBType.SCROLL ||
    category === DBType.POTION ||
    category === DBType.CHEST ||
    category === DBType.MISC
  );
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

function collectObjectChain(
  data: DungeonData,
  start: ObjectID,
  visited: Set<ObjectID>,
  objDescObjectType: number[],
  names: string[],
): DumpItem[] {
  const out: DumpItem[] = [];
  for (let rn = start; rn !== OBJECT_ID_EOF; ) {
    if (visited.has(rn)) break;
    visited.add(rn);
    const decoded = decodeObjectID(rn);
    const record = getRecordByType(data, decoded.category, decoded.index);
    const objDescIndex = getObjDescIndex(decoded.category, record);
    const objectType = objDescIndex !== null ? objDescObjectType[objDescIndex] ?? null : null;
    const name = objectType !== null ? names[objectType] ?? null : null;
    const item: DumpItem = {
      rn,
      map: -1,
      x: -1,
      y: -1,
      position: decoded.position,
      category: decoded.category,
      index: decoded.index,
      objDescIndex,
      objectType,
      name,
      record,
    };
    if (decoded.category === DBType.CHEST) {
      const container = record as ContainerRecord | null;
      const contained = container?.containedObject ?? OBJECT_ID_EOF;
      if (contained !== OBJECT_ID_EOF) {
        item.containedItems = collectObjectChain(data, contained, visited, objDescObjectType, names);
      }
    }
    out.push(item);
    if (!record || !('nextObject' in record)) break;
    const next = (record as { nextObject: ObjectID }).nextObject;
    if (next === rn) break;
    rn = next;
  }
  return out;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const filePath = resolve(process.cwd(), options.file);
  const bytes = new Uint8Array(readFileSync(filePath));
  const loader = new DungeonLoader();
  const data = loader.loadFromArray(bytes);
  const graphicsPath = resolve(process.cwd(), options.graphics);
  const graphicsBytes = new Uint8Array(readFileSync(graphicsPath));
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(graphicsBytes);

  const rawNames = graphics.getRawGraphic(GRAPHIC_OBJECT_NAMES);
  const raw22f = graphics.getRawGraphic(GRAPHIC_22F);
  const names = parseObjectNames(rawNames);
  const objDescObjectType = parseObjDescObjectType(raw22f);

  const state = new DungeonState(data);
  const mapIndex = options.map;
  const map = data.maps[mapIndex];

  if (!map) {
    throw new Error(`Map index ${mapIndex} not found.`);
  }

  const items: DumpItem[] = [];
  const visitedContainerItems = new Set<ObjectID>();

  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      const pos = new Position(x, y, mapIndex as number);
      for (let rn = state.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = state.getDBRecordLink(rn)) {
        const decoded = decodeObjectID(rn);
        if (!options.all && !isItemCategory(decoded.category)) continue;

        const record = getRecordByType(data, decoded.category, decoded.index);
        const objDescIndex = getObjDescIndex(decoded.category, record);
        const objectType = objDescIndex !== null ? objDescObjectType[objDescIndex] ?? null : null;
        const name = objectType !== null ? names[objectType] ?? null : null;
        const item: DumpItem = {
          rn,
          map: mapIndex,
          x,
          y,
          position: decoded.position,
          category: decoded.category,
          index: decoded.index,
          objDescIndex,
          objectType,
          name,
          record,
        };

        if (decoded.category === DBType.CHEST) {
          const container = record as ContainerRecord | null;
          const contained = container?.containedObject ?? OBJECT_ID_EOF;
          if (contained !== OBJECT_ID_EOF) {
            item.containedItems = collectObjectChain(
              data,
              contained,
              visitedContainerItems,
              objDescObjectType,
              names,
            );
          }
        }

        items.push(item);
      }
    }
  }

  const outPath = resolve(process.cwd(), options.out);
  writeFileSync(outPath, JSON.stringify({ map: mapIndex, count: items.length, items }, null, 2));
  console.log(`Wrote ${items.length} objects for map ${mapIndex} to ${options.out}`);
}

main();
