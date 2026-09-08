import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';

interface ToolOptions {
  graphics: string;
  out: string;
}

interface WeaponDesc {
  weight: number;
  byte1: number;
  byte2: number;
  byte3: number;
  word4: number;
}

interface ClothingDesc {
  weight: number;
  byte1: number;
  byte2: number;
  byte3: number;
}

interface ObjectDefinition {
  objDescIndex: number;
  group: string;
  typeIndex: number;
  objectType: number;
  name: string | null;
  graphicClass: number;
  sprite: {
    objectGraphicIndex: number;
    widthBytes: number;
    height: number;
    byte4: number;
    byte5: number;
  } | null;
  attackClass: number;
  carryMask: number;
  weight: number | null;
  foodValue: number | null;
  weaponDesc?: WeaponDesc;
  clothingDesc?: ClothingDesc;
}

interface DumpPayload {
  graphicsFile: string;
  objectNameCount: number;
  counts: {
    objDesc: number;
    weaponDesc: number;
    clothingDesc: number;
    foodValue: number;
  };
  objects: ObjectDefinition[];
}

const GRAPHIC_OBJECT_NAMES = 0x22c;
const GRAPHIC_22F = 0x22f;

const ABS_22F_START = 10340;
const ABS_OBJDESC = 8382;
const ABS_WEAPONS = 8658;
const ABS_CLOTHING = 8890;
const ABS_FOOD_VALUE = 8962;

const OBJDESC_COUNT = 180;
const OBJDESC_STRIDE = 6;
const WEAPON_COUNT = 46;
const WEAPON_STRIDE = 6;
const CLOTHING_COUNT = 58;
const CLOTHING_STRIDE = 4;
const FOOD_VALUE_COUNT = 8;

function parseArgs(argv: string[]): ToolOptions {
  const options: ToolOptions = {
    graphics: 'static/gamefiles/dm-atari/graphics.dat',
    out: 'tools/output/object-definitions.json',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--graphics' || arg === '-g') {
      options.graphics = argv[i + 1] ?? options.graphics;
      i++;
      continue;
    }
    if (arg === '--out' || arg === '-o') {
      options.out = argv[i + 1] ?? options.out;
      i++;
      continue;
    }
  }

  return options;
}

function readU16BE(raw: Uint8Array, off: number): number {
  const hi = raw[off] ?? 0;
  const lo = raw[off + 1] ?? 0;
  return (hi << 8) | lo;
}

function readI8(raw: Uint8Array, off: number): number {
  const v = raw[off] ?? 0;
  return v >= 0x80 ? v - 0x100 : v;
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

function parseWeaponDesc(raw: Uint8Array): WeaponDesc[] {
  const start = ABS_22F_START - ABS_WEAPONS;
  const end = start + WEAPON_COUNT * WEAPON_STRIDE;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for weapons[46]');
  const out: WeaponDesc[] = [];
  for (let i = 0; i < WEAPON_COUNT; i++) {
    const base = start + i * WEAPON_STRIDE;
    out.push({
      weight: raw[base] ?? 0,
      byte1: raw[base + 1] ?? 0,
      byte2: raw[base + 2] ?? 0,
      byte3: raw[base + 3] ?? 0,
      word4: readU16BE(raw, base + 4),
    });
  }
  return out;
}

function parseClothingDesc(raw: Uint8Array): ClothingDesc[] {
  const start = ABS_22F_START - ABS_CLOTHING;
  const end = start + CLOTHING_COUNT * CLOTHING_STRIDE;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for clothing[58]');
  const out: ClothingDesc[] = [];
  for (let i = 0; i < CLOTHING_COUNT; i++) {
    const base = start + i * CLOTHING_STRIDE;
    out.push({
      weight: raw[base] ?? 0,
      byte1: raw[base + 1] ?? 0,
      byte2: raw[base + 2] ?? 0,
      byte3: raw[base + 3] ?? 0,
    });
  }
  return out;
}

function parseFoodValue(raw: Uint8Array): number[] {
  const start = ABS_22F_START - ABS_FOOD_VALUE;
  const end = start + FOOD_VALUE_COUNT * 2;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for FoodValue[8]');
  const out: number[] = [];
  for (let i = 0; i < FOOD_VALUE_COUNT; i++) {
    out.push(readU16BE(raw, start + i * 2));
  }
  return out;
}

function classifyObjDesc(index: number): { group: string; typeIndex: number } {
  if (index === 0) return { group: 'scroll', typeIndex: 0 };
  if (index === 1) return { group: 'chest', typeIndex: 0 };
  if (index >= 2 && index <= 22) return { group: 'potion', typeIndex: index - 2 };
  if (index >= 23 && index <= 68) return { group: 'weapon', typeIndex: index - 23 };
  if (index >= 69 && index <= 126) return { group: 'clothing', typeIndex: index - 69 };
  if (index >= 127 && index <= 179) return { group: 'misc', typeIndex: index - 127 };
  return { group: 'unknown', typeIndex: index };
}

function parseObjectDefinitions(
  raw22f: Uint8Array,
  names: string[],
  graphicClasses: Array<{
    objectGraphicIndex: number;
    widthBytes: number;
    height: number;
    byte4: number;
    byte5: number;
  }>,
  weapons: WeaponDesc[],
  clothing: ClothingDesc[],
  foodValue: number[],
): ObjectDefinition[] {
  const start = ABS_22F_START - ABS_OBJDESC;
  const end = start + OBJDESC_COUNT * OBJDESC_STRIDE;
  if (start < 0 || end > raw22f.length) throw new Error('graphics.dat item 0x22f too small for ObjDesc[180]');

  const out: ObjectDefinition[] = [];
  for (let i = 0; i < OBJDESC_COUNT; i++) {
    const base = start + i * OBJDESC_STRIDE;
    const objectType = readU16BE(raw22f, base);
    const graphicClass = raw22f[base + 2] ?? 0;
    const attackClass = readI8(raw22f, base + 3);
    const carryMask = readU16BE(raw22f, base + 4);

    const groupInfo = classifyObjDesc(i);
    const name = names[objectType] ?? null;
    const graphic = graphicClasses[graphicClass] ?? null;

    let weight: number | null = null;
    let food: number | null = null;
    let weaponDesc: WeaponDesc | undefined;
    let clothingDesc: ClothingDesc | undefined;

    if (groupInfo.group === 'weapon') {
      weaponDesc = weapons[groupInfo.typeIndex];
      weight = weaponDesc?.weight ?? null;
    } else if (groupInfo.group === 'clothing') {
      clothingDesc = clothing[groupInfo.typeIndex];
      weight = clothingDesc?.weight ?? null;
    } else if (groupInfo.group === 'misc') {
      if (groupInfo.typeIndex < foodValue.length) {
        food = foodValue[groupInfo.typeIndex] ?? null;
      }
    }

    out.push({
      objDescIndex: i,
      group: groupInfo.group,
      typeIndex: groupInfo.typeIndex,
      objectType,
      name,
      graphicClass,
      sprite: graphic
        ? {
            objectGraphicIndex: graphic.objectGraphicIndex,
            widthBytes: graphic.widthBytes,
            height: graphic.height,
            byte4: graphic.byte4,
            byte5: graphic.byte5,
          }
        : null,
      attackClass,
      carryMask,
      weight,
      foodValue: food,
      weaponDesc,
      clothingDesc,
    });
  }

  return out;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const graphicsPath = resolve(process.cwd(), options.graphics);
  const graphicsBytes = new Uint8Array(readFileSync(graphicsPath));

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(graphicsBytes);

  const raw22c = graphics.getRawGraphic(GRAPHIC_OBJECT_NAMES);
  const raw22f = graphics.getRawGraphic(GRAPHIC_22F);
  const names = parseObjectNames(raw22c);
  const weapons = parseWeaponDesc(raw22f);
  const clothing = parseClothingDesc(raw22f);
  const foodValue = parseFoodValue(raw22f);

  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const graphicClasses = objectTables.graphicClasses;

  const objects = parseObjectDefinitions(raw22f, names, graphicClasses, weapons, clothing, foodValue);

  const payload: DumpPayload = {
    graphicsFile: options.graphics,
    objectNameCount: names.length,
    counts: {
      objDesc: objects.length,
      weaponDesc: weapons.length,
      clothingDesc: clothing.length,
      foodValue: foodValue.length,
    },
    objects,
  };

  const outPath = resolve(process.cwd(), options.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${objects.length} object definitions to ${options.out}`);
}

main();
