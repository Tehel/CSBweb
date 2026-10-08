import type { GraphicsLoader } from '../GraphicsLoader';
import type { MonsterDesc } from './MonsterDesc';
import type { RectPos } from './UITables';
import { readI16BE, readI8, readU16BE } from '../../core/bytes';

export interface GraphicClass {
  objectGraphicIndex: number; // i8
  uByte1: number; // ui8
  widthBytes: number; // ui8 (packed pixels: 1 byte = 2 pixels)
  height: number; // ui8 (pixels)
  byte4: number; // ui8 (flags)
  byte5: number; // ui8 (viewportPosition set index)
}

export type ViewportPositionTable = { x: number; y: number }[][][]; // [3][10][5]

export type MonsterPositionTable = { x: number; y: number }[][][]; // [3][11][5]

/**
 * `WEAPONDESC` (doc/CSBwin-src/CSB.h:1349) — one 6-byte record per weapon type.
 *
 * `uByte1` is a class number that decides which skill a throw draws on
 * (`DetermineThrowingDistance`, doc/CSBwin-src/Character.cpp:2331-2353): 0 or 2 adds
 * mastery of skill 4, below 16 adds skill 10, 16-111 adds skill 11. `uByte2` is added
 * straight to the throwing distance, and `uByte3` is the throw's damage contribution.
 */
export interface WeaponDesc {
  weight: number; // ui8
  uByte1: number; // ui8 — weapon class, selects the skill a throw uses
  uByte2: number; // ui8 — added to throwing distance
  uByte3: number; // ui8 — throw damage contribution
  word4: number; // i16
}

export interface DecorationDesc {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  widthBytes: number;
  height: number;
}

export interface MonsterGraphicDesc {
  word0: number;
  word2: number;
  frontRearByteWidth: number;
  frontRearHeight: number;
  sideByteWidth: number;
  sideHeight: number;
  attackByteWidth: number;
  attackHeight: number;
  uByte10: number;
  uByte11: number;
}

export interface SpecialColorScheme {
  paletteEntries: number[]; // 6 entries (one per viewport palette)
  monsterColorMapMedium: number; // Byte6628
  monsterColorMapFar: number; // Byte6612
}

export interface MissileGraphicDesc {
  uByte0: number;
  uByte1: number;
  widthBytes: number;
  height: number;
  word4: number;
}

export interface ObjectTables {
  graphicClasses: GraphicClass[]; // d.s5604[85]
  viewportPosition: ViewportPositionTable; // d.viewportPosition[3]
  monsterPositions: MonsterPositionTable; // d.s6982[3].s[11]
  monsterDesc: MonsterDesc[]; // d.MonsterDescriptor[27]
  monsterGraphics: MonsterGraphicDesc[]; // d.Item6414[27]
  uByte9672: Uint8Array; // d.uByte9672[8]
  /**
   * `d.DoorCharacteristics[4]` (doc/CSBwin-src/Data.h:1073). A level picks two of
   * these by its `doorType0Index`/`doorType1Index` to form `d.DoorTOC[2]`
   * (doc/CSBwin-src/CSBCode.cpp:5780-5783). The low byte is the force needed to bash
   * the door; bit 8 marks a door monsters may walk through
   * (doc/CSBwin-src/Monster.cpp:320).
   */
  doorCharacteristics: Int16Array;
  /** `d.MonsterDroppings[40]` (doc/CSBwin-src/Data.h:1074). */
  monsterDroppings: Int16Array;
  /**
   * `d.Byte10340[4]` (doc/CSBwin-src/Data.h:1069) — the first four bytes of graphic
   * `0x22f`, holding `0x00 0x55 0xaa 0xff`. Each entry is a facing replicated into
   * all four 2-bit fields, used as the facing byte for a group that has no `ITEM16`
   * and therefore faces one way as a whole (doc/CSBwin-src/Code11f52.cpp:229).
   */
  byte10340: Uint8Array;
  missileGraphics: MissileGraphicDesc[]; // d.struct5688[14]
  smallOffsetIndices: Uint8Array; // d.smallOffsetIndicies[16][2] packed row-major
  smallOffsets: Int8Array; // d.smallOffsets[24]
  specialColors: SpecialColorScheme[]; // d.specialColors[13][7]
  colorMapMedium: Uint8Array; // d.Byte5744[16]
  colorMapFar: Uint8Array; // d.Byte5728[16]
  monsterColorMapMedium: Uint8Array; // d.Byte6628[16]
  monsterColorMapFar: Uint8Array; // d.Byte6612[16]
  cloudColorMap: Uint8Array; // d.Byte5712[16]
  cloudScaleBase: Uint8Array; // d.Byte5696[8]
  cloudScale: Uint8Array; // d.Byte5758[6]
  missileScale: Uint8Array; // d.Byte5752[8]
  cloudPositions7042: Int16Array; // d.Word7042[30]
  cloudPositions7162: Int16Array; // d.Word7162[60]
  cloudPositions7222: Int16Array; // d.Word7222[30]
  // d.Word7246[12], read as 21 words: `DrawClouds` indexes it `[3*(RelativeCellNumber-3)]`
  // for cells 3..9 (`doc/CSBwin-src/Code51a4.cpp:143`), running on into d.Word7222,
  // which follows it in the struct.
  cloudPositions7246: Int16Array;
  cloudUnderPartyRect: RectPos; // d.Word2530, a byte RectPos: `DrawClouds`' cell 12
  objDescGraphicClass: Uint8Array; // d.ObjDesc[180].graphicClass
  objDescAttackClass: Int8Array; // d.ObjDesc[180].attackClass
  objDescWord4: Uint16Array; // d.ObjDesc[180].word4 (carry locations mask)
  objDescObjectType: Uint16Array; // d.ObjDesc[180].objectType (object name index)
  /**
   * `d.Byte7302[16]` (doc/CSBwin-src/Data.h:1099): the extra records a new game gives each
   * database (`doc/CSBwin-src/SaveGame.cpp:2556-2564`), read as unsigned there.
   */
  byte7302: Uint8Array;
  objectNames: string[]; // d.ObjectNames[199]
  weaponWeights: Uint8Array; // d.weapons[46].weight
  /**
   * `d.weapons[46]` — the whole `WEAPONDESC` (doc/CSBwin-src/CSB.h:1349), which
   * `TAG0099d2` (doc/CSBwin-src/Code51a4.cpp:2875) looks up by weapon type. Only
   * `weight` was read before, so everything downstream of `uByte1`/`uByte2`/`uByte3`
   * — throwing distance, throw damage, the throw skill gain — had to be estimated.
   */
  weaponDesc: WeaponDesc[];
  clothingWeights: Uint8Array; // d.ClothingDesc[58].weight
  /**
   * `d.ClothingDesc[58].uByte1` — the armour strength a garment contributes
   * (doc/CSBwin-src/CSB.h:1700, read by `TAG009470`,
   * doc/CSBwin-src/Character.cpp:167).
   */
  clothingArmour: Uint8Array;
  /**
   * `d.ClothingDesc[58].uByte2` — flags. Bit 7 marks a shield, i.e. a garment that
   * counts when held in a hand rather than worn
   * (doc/CSBwin-src/Character.cpp:2415).
   */
  clothingFlags: Uint8Array;
  byte8946: Uint8Array; // d.Byte8946[54]
  foodValue: Int16Array; // d.FoodValue[8]

  // Wall decorations
  wallDecorationRectSets: DecorationDesc[][]; // d.wallDecorationPosition[8][13]
  wallDecorationRectSetIndex: Uint8Array; // d.Byte4100[60]

  // Wall text helpers (DrawWallDecoration, CSBCode.cpp:3258+)
  wallTextRect: RectPos; // d.Byte4192 rect for mortar joint removal
  wallTextLineY2: Uint8Array; // d.Byte4196[4]
  /**
   * `d.Byte4212[16]`: the bottom of a wall text's plaque seen from afar, by distance and
   * line count, `[3 * wallDecorationDerivedGraphicOffset[relativePosition] + numLine - 1]`
   * for one to three lines (`doc/CSBwin-src-20230608/CSBCode.cpp:3649-3660`).
   */
  wallTextPlaqueY2: Uint8Array;
  /** `d.WallDecorationDerivedGraphicOffset[12]`: which of five distances a relative position is. */
  wallDecorationDerivedGraphicOffset: Uint8Array;

  // Wall decoration alcove markers (CSBCode.cpp:205-219, Data.h:1174-1177)
  alcoveDecorationIndices: Uint8Array; // d.Byte4038[4]
  fountainDecorationIndex: number; // d.Word4040[0]

  // Door switch helpers (DrawDoorSwitch, CSBCode.cpp:4065+)
  doorSwitchRectIndex: Uint8Array; // d.Byte4124[2]
  doorSwitchRectSets: DecorationDesc[][]; // d.Byte5094[?][4]
  doorSwitchSourceDescSets: DecorationDesc[][]; // d.Byte5076[?][4]

  // Door ornaments (TAG004b26, doc/CSBwin-src/CSBCode.cpp:3993-4059)
  /**
   * `d.Byte5070[18*set + 6*nearness]`: where an ornament goes on the door's bitmap, per
   * position set and nearness (0 F3, 1 F2, 2 F1). `Byte5070[12]` is declared short, and
   * `TAG004b26` reads its four 18-byte sets on into `Byte5058[60]`, which follows it
   * (`Data.h:1149-1150`); `Byte5058[18*set]`, the source size of a shrink, is set's F1 entry.
   */
  doorOrnamentRectSets: DecorationDesc[][];
  doorOrnamentRectSetIndex: Uint8Array; // d.Byte4122[12], a door ornament's position set
  doorOrnamentColorMapF3: Uint8Array; // d.Byte4172[16]
  doorOrnamentColorMapF2: Uint8Array; // d.Byte4188[16]

  // Floor decorations (DrawFloorDecorations, CSBCode.cpp:3780+)
  floorDecorationDescSets: DecorationDesc[][]; // d.floorDecorDesc[3][9]
  floorDecorationRectSetIndex: Uint8Array; // d.Byte4110[10]
  relativeCellGraphicIncrement: Uint8Array; // d.RelativeCellGraphicIncrement[10]
  floorColorMapMedium: Uint8Array; // d.MediumColorMapping[16]
  floorColorMapFar: Uint8Array; // d.FarColorMapping[16]

  /** `DecodeText`'s escape strings. */
  textDecode: TextDecodeTables;
}

/**
 * `DecodeText`'s escape strings (`doc/CSBwin-src/CSBCode.cpp:5559-5574`): `d.Byte10080`
 * after code 29, `d.Byte10336` (wall text) or `d.Byte10016` (any other) after 30.
 */
export interface TextDecodeTables {
  byte10080: Uint8Array; // d.Byte10080[64]
  byte10336: Uint8Array; // d.Byte10336[256]
  byte10016: Uint8Array; // d.Byte10016[256]
}

const GRAPHIC_OBJECT_NAMES = 0x22c; // 556
const GRAPHIC_22E_INDEX = 0x22e; // 558
const GRAPHIC_22F_INDEX = 0x22f; // 559

// Absolute offsets in CSBWin's `d` struct (doc/CSBwin-src/Data.h).
// We compute offsets within the decompressed 0x22e blob using known deltas from `wallRectangles` (at 3074).
const ABS_WALL_RECTANGLES = 3074;
const ABS_WORD7246 = 7246;
const ABS_WORD7222 = 7222;
const ABS_WORD2530 = 2530; // Word2530[2], the last 4 bytes of graphic 0x22e (Data.h:1316)
const ABS_WORD7162 = 7162;
const ABS_WORD7042 = 7042;
const ABS_S6982 = 6982; // ITEM110[3]
const ABS_SMALL_OFFSETS = 6652; // smallOffsets[24]
const ABS_SPECIAL_COLORS = 6596; // specialColors[13][7]
const ABS_MONSTER_COLOR_MAP_MEDIUM = 6628; // Byte6628[16]
const ABS_MONSTER_COLOR_MAP_FAR = 6612; // Byte6612[16]
const ABS_ITEM6414 = 6414; // Item6414[27]
const ABS_VIEWPORT_POSITION = 6090; // viewportPosition[3]
const ABS_SMALL_OFFSET_INDICES = 5790; // smallOffsetIndicies[16][2]
const ABS_BYTE5758 = 5758; // Byte5758[6]
const ABS_BYTE5752 = 5752; // Byte5752[8]
const ABS_COLOR_MAP_FAR = 5728; // Byte5728[16]
const ABS_COLOR_MAP_MEDIUM = 5744; // Byte5744[16]
const ABS_CLOUD_COLOR_MAP = 5712; // Byte5712[16]
const ABS_CLOUD_SCALE_BASE = 5696; // Byte5696[8]
const ABS_STRUCT5688 = 5688; // struct5688[14] (unused for now, but keeps deltas documented)
const ABS_GRAPHIC_CLASS = 5604; // s5604[85]
const ABS_WALL_DECORATION_POSITION = 4836; // wallDecorationPosition[8][13] (8*13*6 bytes)
const ABS_WALL_DECORATION_RECT_SET_INDEX = 4100; // Byte4100[60]
const ABS_WALL_TEXT_RECT = 4192; // Byte4192 (RectPos x1,x2,y1,y2)
const ABS_WALL_TEXT_LINE_Y2 = 4196; // Byte4196[4]
const ABS_BYTE4212 = 4212; // Byte4212[16]
const ABS_WALL_DECORATION_DERIVED_GRAPHIC_OFFSET = 4024; // WallDecorationDerivedGraphicOffset[12]
const ABS_BYTE4038 = 4038; // Byte4038[4]
const ABS_WORD4040 = 4040; // Word4040[1]
const ABS_BYTE4124 = 4124; // Byte4124[2] (door switch rect set indices)
const ABS_BYTE5094 = 5094; // Byte5094[?] (door switch rectangles)
const ABS_BYTE5076 = 5076; // Byte5076[?] (door switch source desc)
const ABS_BYTE5070 = 5070; // Byte5070[12] and Byte5058[60] after it (door ornament rectangles)
const ABS_BYTE4122 = 4122; // Byte4122[12] (door ornament position sets)
const ABS_BYTE4172 = 4172; // Byte4172[16] (door ornament colour map, F3)
const ABS_BYTE4188 = 4188; // Byte4188[16] (door ornament colour map, F2)
const ABS_FLOOR_DECOR_DESC = 4998; // floorDecorDesc[3][9]
const ABS_FLOOR_DECOR_RECT_SET_INDEX = 4110; // Byte4110[10]
const ABS_REL_CELL_GRAPHIC_INCREMENT = 4034; // RelativeCellGraphicIncrement[10]
const ABS_FLOOR_COLOR_MAP_MEDIUM = 4156; // MediumColorMapping[16]
const ABS_FLOOR_COLOR_MAP_FAR = 4140; // FarColorMapping[16]

// Absolute offsets in CSBWin's `d` struct for graphic 0x22f (doc/CSBwin-src/Data.h).
const ABS_22F_START = 10340; // Byte10340[4] - start of graphic 0x22f
const ABS_OBJDESC = 8382; // ObjDesc[180]
const ABS_BYTE7302 = 7302; // Byte7302[16], right after ObjDesc[180]
const ABS_WEAPONS = 8658; // weapons[46]
const ABS_CLOTHING = 8890; // ClothingDesc[58]
const ABS_FOOD_VALUE = 8962; // FoodValue[8]
const ABS_BYTE8946 = 8946; // Byte8946[54]
const ABS_MONSTER_ATTACK_SOUND = 9672; // uByte9672[8]
const ABS_DOOR_CHARACTERISTICS = 9760; // DoorCharacteristics[4]
const ABS_MONSTER_DROPPINGS = 9752; // MonsterDroppings[40]
const ABS_MONSTER_DESC = 9664; // MonsterDescriptor[27]
const ABS_BYTE10336 = 10336; // Byte10336[256]
const ABS_BYTE10080 = 10080; // Byte10080[64]
const ABS_BYTE10016 = 10016; // Byte10016[256]

function readGraphicClasses22e(raw: Uint8Array, off: number): GraphicClass[] {
  const count = 85;
  const stride = 6;
  const end = off + count * stride;
  if (off < 0 || end > raw.length) throw new Error('graphics.dat item 0x22e too small for s5604[85]');

  const out: GraphicClass[] = [];
  for (let i = 0; i < count; i++) {
    const base = off + i * stride;
    out.push({
      objectGraphicIndex: readI8(raw, base + 0),
      uByte1: raw[base + 1] ?? 0,
      widthBytes: raw[base + 2] ?? 0,
      height: raw[base + 3] ?? 0,
      byte4: raw[base + 4] ?? 0,
      byte5: raw[base + 5] ?? 0,
    });
  }

  return out;
}

function readRectPosByte4(raw: Uint8Array, off: number): RectPos {
  return {
    x1: raw[off + 0] ?? 0,
    x2: raw[off + 1] ?? 0,
    y1: raw[off + 2] ?? 0,
    y2: raw[off + 3] ?? 0,
  };
}

function readSpecialColors22e(raw: Uint8Array, off: number): SpecialColorScheme[] {
  const rows = 13;
  const cols = 7;
  const stride = cols * 2;
  const end = off + rows * stride;
  if (off < 0 || end > raw.length) throw new Error('graphics.dat item 0x22e too small for specialColors[13][7]');

  const out: SpecialColorScheme[] = [];
  for (let r = 0; r < rows; r++) {
    const base = off + r * stride;
    const paletteEntries: number[] = [];
    for (let i = 0; i < 6; i++) {
      paletteEntries.push(readU16BE(raw, base + i * 2));
    }
    const monsterColorMapMedium = raw[base + 12] ?? 0;
    const monsterColorMapFar = raw[base + 13] ?? 0;
    out.push({ paletteEntries, monsterColorMapMedium, monsterColorMapFar });
  }
  return out;
}

function readViewportPosition22e(raw: Uint8Array, off: number): ViewportPositionTable {
  const sets = 3;
  const relCells = 10;
  const positions = 5;
  const bytesPerRelCell = 10; // 5 pairs
  const bytesPerSet = relCells * bytesPerRelCell; // 100
  const end = off + sets * bytesPerSet;
  if (off < 0 || end > raw.length) throw new Error('graphics.dat item 0x22e too small for viewportPosition[3]');

  const table: ViewportPositionTable = new Array(sets);
  for (let s = 0; s < sets; s++) {
    table[s] = new Array(relCells);
    for (let rc = 0; rc < relCells; rc++) {
      table[s][rc] = new Array(positions);
      const base = off + s * bytesPerSet + rc * bytesPerRelCell;
      for (let p = 0; p < positions; p++) {
        const x = raw[base + p * 2] ?? 0;
        const y = raw[base + p * 2 + 1] ?? 0;
        table[s][rc][p] = { x, y };
      }
    }
  }
  return table;
}

function readMonsterPositions22e(raw: Uint8Array, off: number): MonsterPositionTable {
  const sets = 3;
  const relCells = 11;
  const positions = 5;
  const bytesPerRelCell = 10; // 5 pairs
  const bytesPerSet = relCells * bytesPerRelCell; // 110
  const end = off + sets * bytesPerSet;
  if (off < 0 || end > raw.length) throw new Error('graphics.dat item 0x22e too small for s6982[3]');

  const table: MonsterPositionTable = new Array(sets);
  for (let s = 0; s < sets; s++) {
    table[s] = new Array(relCells);
    for (let rc = 0; rc < relCells; rc++) {
      table[s][rc] = new Array(positions);
      const base = off + s * bytesPerSet + rc * bytesPerRelCell;
      for (let p = 0; p < positions; p++) {
        const x = raw[base + p * 2] ?? 0;
        const y = raw[base + p * 2 + 1] ?? 0;
        table[s][rc][p] = { x, y };
      }
    }
  }
  return table;
}

function readMonsterGraphics22e(raw: Uint8Array, off: number): MonsterGraphicDesc[] {
  const count = 27;
  const stride = 12;
  const end = off + count * stride;
  if (off < 0 || end > raw.length) throw new Error('graphics.dat item 0x22e too small for Item6414[27]');

  const out: MonsterGraphicDesc[] = [];
  for (let i = 0; i < count; i++) {
    const base = off + i * stride;
    out.push({
      word0: readU16BE(raw, base + 0),
      word2: readU16BE(raw, base + 2),
      frontRearByteWidth: raw[base + 4] ?? 0,
      frontRearHeight: raw[base + 5] ?? 0,
      sideByteWidth: raw[base + 6] ?? 0,
      sideHeight: raw[base + 7] ?? 0,
      attackByteWidth: raw[base + 8] ?? 0,
      attackHeight: raw[base + 9] ?? 0,
      uByte10: raw[base + 10] ?? 0,
      uByte11: raw[base + 11] ?? 0,
    });
  }
  return out;
}

function readMissileGraphics22e(raw: Uint8Array, off: number): MissileGraphicDesc[] {
  const count = 14;
  const stride = 6;
  const end = off + count * stride;
  if (off < 0 || end > raw.length) throw new Error('graphics.dat item 0x22e too small for struct5688[14]');

  const out: MissileGraphicDesc[] = [];
  for (let i = 0; i < count; i++) {
    const base = off + i * stride;
    out.push({
      uByte0: raw[base + 0] ?? 0,
      uByte1: raw[base + 1] ?? 0,
      widthBytes: raw[base + 2] ?? 0,
      height: raw[base + 3] ?? 0,
      word4: readU16BE(raw, base + 4),
    });
  }
  return out;
}

function readObjDescGraphicClass22f(raw: Uint8Array): Uint8Array {
  const start = ABS_22F_START - ABS_OBJDESC;
  const count = 180;
  const stride = 6;
  const end = start + count * stride;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for ObjDesc[180]');

  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = raw[start + i * stride + 2] ?? 0; // graphicClass byte
  }
  return out;
}

function readByte7302_22f(raw: Uint8Array): Uint8Array {
  const start = ABS_22F_START - ABS_BYTE7302;
  if (start < 0 || start + 16 > raw.length) throw new Error('graphics.dat item 0x22f too small for Byte7302[16]');
  return raw.slice(start, start + 16);
}

function readObjDescAttackClass22f(raw: Uint8Array): Int8Array {
  const start = ABS_22F_START - ABS_OBJDESC;
  const count = 180;
  const stride = 6;
  const end = start + count * stride;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for ObjDesc[180].attackClass');

  const out = new Int8Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = readI8(raw, start + i * stride + 3);
  }
  return out;
}

function readObjDescObjectType22f(raw: Uint8Array): Uint16Array {
  const start = ABS_22F_START - ABS_OBJDESC;
  const count = 180;
  const stride = 6;
  const end = start + count * stride;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for ObjDesc[180].objectType');

  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = readU16BE(raw, start + i * stride + 0);
  }
  return out;
}

function readObjDescWord4_22f(raw: Uint8Array): Uint16Array {
  const start = ABS_22F_START - ABS_OBJDESC;
  const count = 180;
  const stride = 6;
  const end = start + count * stride;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for ObjDesc[180].word4');

  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = readU16BE(raw, start + i * stride + 4);
  }
  return out;
}

function readObjectNames22c(raw: Uint8Array): string[] {
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

function readWeaponWeights22f(raw: Uint8Array): Uint8Array {
  const start = ABS_22F_START - ABS_WEAPONS;
  const count = 46;
  const stride = 6;
  const end = start + count * stride;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for weapons[46]');

  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = raw[start + i * stride + 0] ?? 0;
  }
  return out;
}

/**
 * The whole `weapons[46]` array — the same 6-byte records `readWeaponWeights22f` takes
 * byte 0 of. `word4` is big-endian, like everything else from the Atari data.
 */
function readWeaponDesc22f(raw: Uint8Array): WeaponDesc[] {
  const start = ABS_22F_START - ABS_WEAPONS;
  const count = 46;
  const stride = 6;
  const end = start + count * stride;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for weapons[46]');

  const out: WeaponDesc[] = [];
  for (let i = 0; i < count; i++) {
    const base = start + i * stride;
    out.push({
      weight: raw[base] ?? 0,
      uByte1: raw[base + 1] ?? 0,
      uByte2: raw[base + 2] ?? 0,
      uByte3: raw[base + 3] ?? 0,
      word4: (((raw[base + 4] ?? 0) << 8) | (raw[base + 5] ?? 0)) << 16 >> 16,
    });
  }
  return out;
}

function readClothingWeights22f(raw: Uint8Array): Uint8Array {
  const start = ABS_22F_START - ABS_CLOTHING;
  const count = 58;
  const stride = 4;
  const end = start + count * stride;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for ClothingDesc[58]');

  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = raw[start + i * stride + 0] ?? 0;
  }
  return out;
}

/** `ClothingDesc[58].uByte1` / `.uByte2`, from the same 4-byte records as the weight. */
function readClothingBytes22f(raw: Uint8Array, byteIndex: number): Uint8Array {
  const start = ABS_22F_START - ABS_CLOTHING;
  const count = 58;
  const stride = 4;
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = raw[start + i * stride + byteIndex] ?? 0;
  return out;
}

function readFoodValue22f(raw: Uint8Array): Int16Array {
  const start = ABS_22F_START - ABS_FOOD_VALUE;
  const count = 8;
  const end = start + count * 2;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for FoodValue[8]');

  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = readI16BE(raw, start + i * 2);
  }
  return out;
}

function readByte8946_22f(raw: Uint8Array): Uint8Array {
  const start = ABS_22F_START - ABS_BYTE8946;
  const count = 54;
  const end = start + count;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for Byte8946[54]');
  return raw.slice(start, end);
}

function readMonsterDesc22f(raw: Uint8Array): MonsterDesc[] {
  const start = ABS_22F_START - ABS_MONSTER_DESC;
  const count = 27;
  const stride = 26;
  const end = start + count * stride;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for MonsterDescriptor[27]');

  const out: MonsterDesc[] = [];
  for (let i = 0; i < count; i++) {
    const base = start + i * stride;
    out.push({
      type: raw[base + 0] ?? 0,
      attackSound: raw[base + 1] ?? 0,
      word2: readU16BE(raw, base + 2),
      word4: readU16BE(raw, base + 4),
      // CSBWin rejects a zero time-per-move and forces it to 1, with a message box
      // (doc/CSBwin-src/CSBCode.cpp:10163-10173). A zero would divide by nothing in
      // NextMonsterUpdateTime, so keep the clamp.
      movementTicks06: Math.max(1, raw[base + 6] ?? 0),
      attackTicks07: raw[base + 7] ?? 0,
      defense08: raw[base + 8] ?? 0,
      baseHealth09: raw[base + 9] ?? 0,
      attack10: raw[base + 10] ?? 0,
      poisonAttack11: raw[base + 11] ?? 0,
      dexterity12: raw[base + 12] ?? 0,
      unused13: raw[base + 13] ?? 0,
      word14: readU16BE(raw, base + 14),
      word16: readU16BE(raw, base + 16),
      word18: readU16BE(raw, base + 18),
      word20: readU16BE(raw, base + 20),
      uByte22: [
        raw[base + 22] ?? 0,
        raw[base + 23] ?? 0,
        raw[base + 24] ?? 0,
        raw[base + 25] ?? 0,
      ],
    });
  }
  return out;
}

function readDoorCharacteristics22f(raw: Uint8Array): Int16Array {
  const start = ABS_22F_START - ABS_DOOR_CHARACTERISTICS;
  const count = 4;
  if (start < 0 || start + count * 2 > raw.length) throw new Error('graphics.dat item 0x22f too small for DoorCharacteristics[4]');
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) out[i] = readI16BE(raw, start + i * 2);
  return out;
}

function readMonsterDroppings22f(raw: Uint8Array): Int16Array {
  const start = ABS_22F_START - ABS_MONSTER_DROPPINGS;
  const count = 40;
  if (start < 0 || start + count * 2 > raw.length) throw new Error('graphics.dat item 0x22f too small for MonsterDroppings[40]');
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) out[i] = readI16BE(raw, start + i * 2);
  return out;
}

function readUByte9672_22f(raw: Uint8Array): Uint8Array {
  const start = ABS_22F_START - ABS_MONSTER_ATTACK_SOUND;
  const count = 8;
  const end = start + count;
  if (start < 0 || end > raw.length) throw new Error('graphics.dat item 0x22f too small for uByte9672[8]');
  return raw.slice(start, end);
}

function readI16Array(raw: Uint8Array, off: number, count: number): Int16Array {
  const end = off + count * 2;
  if (off < 0 || end > raw.length) throw new Error('graphics.dat item 0x22e too small for i16 array');
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) out[i] = readI16BE(raw, off + i * 2);
  return out;
}

function computeOffsetFromWall(wallRectanglesOffset: number, absField: number): number {
  return wallRectanglesOffset - (absField - ABS_WALL_RECTANGLES);
}

/** `d.Byte4100[60]`, from `graphics.dat` item 0x22e. */
export function readWallDecorationRectSetIndex(raw22e: Uint8Array, wallRectanglesOffset: number): Uint8Array {
  const off = computeOffsetFromWall(wallRectanglesOffset, ABS_WALL_DECORATION_RECT_SET_INDEX);
  return raw22e.slice(off, off + 60);
}

/** `sets` x `entries` 6-byte decoration descriptors (`x1 x2 y1 y2 widthBytes height`) at `off`. */
function readDecorationDescSets(
  raw: Uint8Array,
  off: number,
  sets: number,
  entries: number,
  name = 'decoration desc sets',
): DecorationDesc[][] {
  const stride = 6;
  const end = off + sets * entries * stride;
  if (off < 0 || end > raw.length) throw new Error(`graphics.dat item 0x22e too small for ${name}`);

  const out: DecorationDesc[][] = new Array(sets);
  for (let s = 0; s < sets; s++) {
    out[s] = new Array(entries);
    for (let i = 0; i < entries; i++) {
      const base = off + (s * entries + i) * stride;
      out[s][i] = {
        x1: raw[base + 0] ?? 0,
        x2: raw[base + 1] ?? 0,
        y1: raw[base + 2] ?? 0,
        y2: raw[base + 3] ?? 0,
        widthBytes: raw[base + 4] ?? 0,
        height: raw[base + 5] ?? 0,
      };
    }
  }
  return out;
}

export function extractObjectTables(graphics: GraphicsLoader, wallRectanglesOffset: number): ObjectTables {
  const raw22c = graphics.getRawGraphic(GRAPHIC_OBJECT_NAMES);
  const raw22e = graphics.getRawGraphic(GRAPHIC_22E_INDEX);
  const raw22f = graphics.getRawGraphic(GRAPHIC_22F_INDEX);

  const word7246Offset = computeOffsetFromWall(wallRectanglesOffset, ABS_WORD7246);
  const word7222Offset = computeOffsetFromWall(wallRectanglesOffset, ABS_WORD7222);
  const word7162Offset = computeOffsetFromWall(wallRectanglesOffset, ABS_WORD7162);
  const word7042Offset = computeOffsetFromWall(wallRectanglesOffset, ABS_WORD7042);
  const monsterPositionsOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_S6982);
  const specialColorsOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_SPECIAL_COLORS);
  const monsterColorMapMediumOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_MONSTER_COLOR_MAP_MEDIUM);
  const monsterColorMapFarOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_MONSTER_COLOR_MAP_FAR);
  const monsterGraphicsOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_ITEM6414);
  const graphicClassOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_GRAPHIC_CLASS);
  const viewportPositionOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_VIEWPORT_POSITION);
  const smallOffsetIndicesOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_SMALL_OFFSET_INDICES);
  const smallOffsetsOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_SMALL_OFFSETS);
  const colorMapMediumOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_COLOR_MAP_MEDIUM);
  const colorMapFarOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_COLOR_MAP_FAR);
  const cloudColorMapOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_CLOUD_COLOR_MAP);
  const cloudScaleBaseOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_CLOUD_SCALE_BASE);
  const cloudScaleOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_BYTE5758);
  const missileScaleOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_BYTE5752);
  const struct5688Offset = computeOffsetFromWall(wallRectanglesOffset, ABS_STRUCT5688);
  const wallDecorationPositionOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_WALL_DECORATION_POSITION);
  const wallDecorationRectSetIndexOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_WALL_DECORATION_RECT_SET_INDEX);
  const wallTextRectOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_WALL_TEXT_RECT);
  const wallTextLineY2Offset = computeOffsetFromWall(wallRectanglesOffset, ABS_WALL_TEXT_LINE_Y2);
  const wallTextPlaqueY2Offset = computeOffsetFromWall(wallRectanglesOffset, ABS_BYTE4212);
  const wallDecorationDerivedGraphicOffsetOffset = computeOffsetFromWall(
    wallRectanglesOffset, ABS_WALL_DECORATION_DERIVED_GRAPHIC_OFFSET);
  const alcoveDecorationIndicesOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_BYTE4038);
  const fountainDecorationIndexOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_WORD4040);
  const doorSwitchRectIndexOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_BYTE4124);
  const doorSwitchRectOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_BYTE5094);
  const doorSwitchSourceDescOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_BYTE5076);
  const doorOrnamentRectOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_BYTE5070);
  const doorOrnamentRectSetIndexOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_BYTE4122);
  const doorOrnamentColorMapF3Offset = computeOffsetFromWall(wallRectanglesOffset, ABS_BYTE4172);
  const doorOrnamentColorMapF2Offset = computeOffsetFromWall(wallRectanglesOffset, ABS_BYTE4188);
  const floorDecorationDescOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_FLOOR_DECOR_DESC);
  const floorDecorationRectSetIndexOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_FLOOR_DECOR_RECT_SET_INDEX);
  const relativeCellGraphicIncrementOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_REL_CELL_GRAPHIC_INCREMENT);
  const floorColorMapMediumOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_FLOOR_COLOR_MAP_MEDIUM);
  const floorColorMapFarOffset = computeOffsetFromWall(wallRectanglesOffset, ABS_FLOOR_COLOR_MAP_FAR);

  if (
    word7246Offset < 0 ||
    word7222Offset < 0 ||
    word7162Offset < 0 ||
    word7042Offset < 0 ||
    monsterPositionsOffset < 0 ||
    specialColorsOffset < 0 ||
    monsterColorMapMediumOffset < 0 ||
    monsterColorMapFarOffset < 0 ||
    monsterGraphicsOffset < 0 ||
    graphicClassOffset < 0 ||
    viewportPositionOffset < 0 ||
    smallOffsetIndicesOffset < 0 ||
    smallOffsetsOffset < 0 ||
    colorMapMediumOffset < 0 ||
    colorMapFarOffset < 0 ||
    cloudColorMapOffset < 0 ||
    cloudScaleBaseOffset < 0 ||
    cloudScaleOffset < 0 ||
    missileScaleOffset < 0 ||
    struct5688Offset < 0 ||
    wallDecorationPositionOffset < 0 ||
    wallDecorationRectSetIndexOffset < 0 ||
    wallTextRectOffset < 0 ||
    wallTextLineY2Offset < 0 ||
    wallTextPlaqueY2Offset < 0 ||
    wallDecorationDerivedGraphicOffsetOffset < 0 ||
    alcoveDecorationIndicesOffset < 0 ||
    fountainDecorationIndexOffset < 0 ||
    doorSwitchRectIndexOffset < 0 ||
    doorSwitchRectOffset < 0 ||
    doorSwitchSourceDescOffset < 0 ||
    doorOrnamentRectOffset < 0 ||
    doorOrnamentRectSetIndexOffset < 0 ||
    doorOrnamentColorMapF3Offset < 0 ||
    doorOrnamentColorMapF2Offset < 0 ||
    floorDecorationDescOffset < 0 ||
    floorDecorationRectSetIndexOffset < 0 ||
    relativeCellGraphicIncrementOffset < 0 ||
    floorColorMapMediumOffset < 0 ||
    floorColorMapFarOffset < 0
  ) {
    throw new Error('graphics.dat item 0x22e layout mismatch (negative computed offsets)');
  }

  const graphicClasses = readGraphicClasses22e(raw22e, graphicClassOffset);
  const viewportPosition = readViewportPosition22e(raw22e, viewportPositionOffset);
  const monsterPositions = readMonsterPositions22e(raw22e, monsterPositionsOffset);
  const monsterGraphics = readMonsterGraphics22e(raw22e, monsterGraphicsOffset);
  const specialColors = readSpecialColors22e(raw22e, specialColorsOffset);
  const missileGraphics = readMissileGraphics22e(raw22e, struct5688Offset);
  const monsterDesc = readMonsterDesc22f(raw22f);
  const doorCharacteristics = readDoorCharacteristics22f(raw22f);
  const monsterDroppings = readMonsterDroppings22f(raw22f);
  // Byte10340[4] is at the very start of the graphic (ABS_22F_START itself).
  const byte10340 = raw22f.slice(0, 4);
  const uByte9672 = readUByte9672_22f(raw22f);
  const smallOffsetIndices = raw22e.slice(smallOffsetIndicesOffset, smallOffsetIndicesOffset + 16 * 2);
  const smallOffsets = Int8Array.from(
    raw22e.slice(smallOffsetsOffset, smallOffsetsOffset + 24).map((b) => (b >= 0x80 ? b - 0x100 : b))
  );
  const colorMapMedium = raw22e.slice(colorMapMediumOffset, colorMapMediumOffset + 16);
  const colorMapFar = raw22e.slice(colorMapFarOffset, colorMapFarOffset + 16);
  const monsterColorMapMedium = raw22e.slice(monsterColorMapMediumOffset, monsterColorMapMediumOffset + 16);
  const monsterColorMapFar = raw22e.slice(monsterColorMapFarOffset, monsterColorMapFarOffset + 16);
  const cloudColorMap = raw22e.slice(cloudColorMapOffset, cloudColorMapOffset + 16);
  const cloudScaleBase = raw22e.slice(cloudScaleBaseOffset, cloudScaleBaseOffset + 8);
  const cloudScale = raw22e.slice(cloudScaleOffset, cloudScaleOffset + 6);
  const missileScale = raw22e.slice(missileScaleOffset, missileScaleOffset + 8);
  const cloudPositions7246 = readI16Array(raw22e, word7246Offset, 21);
  const cloudUnderPartyRect = readRectPosByte4(raw22e, computeOffsetFromWall(wallRectanglesOffset, ABS_WORD2530));
  const cloudPositions7222 = readI16Array(raw22e, word7222Offset, 30);
  const cloudPositions7162 = readI16Array(raw22e, word7162Offset, 60);
  const cloudPositions7042 = readI16Array(raw22e, word7042Offset, 30);

  const objDescGraphicClass = readObjDescGraphicClass22f(raw22f);
  const objDescAttackClass = readObjDescAttackClass22f(raw22f);
  const objDescObjectType = readObjDescObjectType22f(raw22f);
  const objDescWord4 = readObjDescWord4_22f(raw22f);
  const byte7302 = readByte7302_22f(raw22f);
  const objectNames = readObjectNames22c(raw22c);
  const weaponWeights = readWeaponWeights22f(raw22f);
  const clothingWeights = readClothingWeights22f(raw22f);
  const clothingArmour = readClothingBytes22f(raw22f, 1);
  const clothingFlags = readClothingBytes22f(raw22f, 2);
  const foodValue = readFoodValue22f(raw22f);
  const byte8946 = readByte8946_22f(raw22f);
  const weaponDesc = readWeaponDesc22f(raw22f);
  const wallDecorationRectSets = readDecorationDescSets(raw22e, wallDecorationPositionOffset, 8, 13, 'wallDecorationPosition[8][13]');
  const wallDecorationRectSetIndex = readWallDecorationRectSetIndex(raw22e, wallRectanglesOffset);
  const wallTextRect = readRectPosByte4(raw22e, wallTextRectOffset);
  const wallTextLineY2 = raw22e.slice(wallTextLineY2Offset, wallTextLineY2Offset + 4);
  const wallTextPlaqueY2 = raw22e.slice(wallTextPlaqueY2Offset, wallTextPlaqueY2Offset + 16);
  const wallDecorationDerivedGraphicOffset = raw22e.slice(
    wallDecorationDerivedGraphicOffsetOffset, wallDecorationDerivedGraphicOffsetOffset + 12);
  const alcoveDecorationIndices = raw22e.slice(alcoveDecorationIndicesOffset, alcoveDecorationIndicesOffset + 4);
  const fountainDecorationIndex = readI16BE(raw22e, fountainDecorationIndexOffset);
  const doorSwitchRectIndex = raw22e.slice(doorSwitchRectIndexOffset, doorSwitchRectIndexOffset + 2);
  let doorSwitchSetCount = 1;
  for (let i = 0; i < doorSwitchRectIndex.length; i++) {
    const v = doorSwitchRectIndex[i] ?? 0;
    if (v + 1 > doorSwitchSetCount) doorSwitchSetCount = v + 1;
  }
  const doorSwitchRectSets = readDecorationDescSets(raw22e, doorSwitchRectOffset, doorSwitchSetCount, 4);
  const doorSwitchSourceDescSets = readDecorationDescSets(raw22e, doorSwitchSourceDescOffset, doorSwitchSetCount, 4);
  // Four sets: `TAG004b26` asserts the set is below 4 (`CSBCode.cpp:4021`).
  const doorOrnamentRectSets = readDecorationDescSets(raw22e, doorOrnamentRectOffset, 4, 3);
  const doorOrnamentRectSetIndex = raw22e.slice(doorOrnamentRectSetIndexOffset, doorOrnamentRectSetIndexOffset + 12);
  const doorOrnamentColorMapF3 = raw22e.slice(doorOrnamentColorMapF3Offset, doorOrnamentColorMapF3Offset + 16);
  const doorOrnamentColorMapF2 = raw22e.slice(doorOrnamentColorMapF2Offset, doorOrnamentColorMapF2Offset + 16);
  const floorDecorationDescSets = readDecorationDescSets(raw22e, floorDecorationDescOffset, 3, 9, 'floorDecorDesc[3][9]');
  const floorDecorationRectSetIndex = raw22e.slice(
    floorDecorationRectSetIndexOffset,
    floorDecorationRectSetIndexOffset + 10
  );
  const relativeCellGraphicIncrement = raw22e.slice(
    relativeCellGraphicIncrementOffset,
    relativeCellGraphicIncrementOffset + 10
  );
  const floorColorMapMedium = raw22e.slice(floorColorMapMediumOffset, floorColorMapMediumOffset + 16);
  const floorColorMapFar = raw22e.slice(floorColorMapFarOffset, floorColorMapFarOffset + 16);
  const textEscape2WallOffset = ABS_22F_START - ABS_BYTE10336;
  const textEscape1Offset = ABS_22F_START - ABS_BYTE10080;
  const textEscape2OtherOffset = ABS_22F_START - ABS_BYTE10016;

  if (
    textEscape2WallOffset < 0 ||
    textEscape1Offset < 0 ||
    textEscape2OtherOffset < 0 ||
    textEscape2WallOffset + 256 > raw22f.length ||
    textEscape1Offset + 64 > raw22f.length ||
    textEscape2OtherOffset + 256 > raw22f.length
  ) {
    throw new Error('graphics.dat item 0x22f too small for text escape tables');
  }

  const textDecode: TextDecodeTables = {
    byte10080: raw22f.slice(textEscape1Offset, textEscape1Offset + 64),
    byte10336: raw22f.slice(textEscape2WallOffset, textEscape2WallOffset + 256),
    byte10016: raw22f.slice(textEscape2OtherOffset, textEscape2OtherOffset + 256),
  };

  // Sanity checks: these should be tight for DM/CSB distributions.
  for (let i = 0; i < graphicClasses.length; i++) {
    const gc = graphicClasses[i];
    if (gc.byte5 > 2) throw new Error(`graphics.dat 0x22e s5604[${i}].byte5 out of range: ${gc.byte5}`);
  }
  for (let i = 0; i < objDescGraphicClass.length; i++) {
    if (objDescGraphicClass[i] > 84) throw new Error(`graphics.dat 0x22f ObjDesc[${i}].graphicClass out of range`);
  }

  return {
    graphicClasses,
    viewportPosition,
    monsterPositions,
    monsterDesc,
    doorCharacteristics,
    monsterDroppings,
    byte10340,
    monsterGraphics,
    uByte9672,
    missileGraphics,
    smallOffsetIndices,
    smallOffsets,
    specialColors,
    colorMapMedium,
    colorMapFar,
    monsterColorMapMedium,
    monsterColorMapFar,
    cloudColorMap,
    cloudScaleBase,
    cloudScale,
    missileScale,
    cloudPositions7042,
    cloudPositions7162,
    cloudPositions7222,
    cloudPositions7246,
    cloudUnderPartyRect,
    objDescGraphicClass,
    objDescAttackClass,
    objDescWord4,
    objDescObjectType,
    byte7302,
    objectNames,
    weaponWeights,
    clothingWeights,
    clothingArmour,
    clothingFlags,
    foodValue,
    byte8946,
    weaponDesc,
    wallDecorationRectSets,
    wallDecorationRectSetIndex,
    wallTextRect,
    wallTextLineY2,
    wallTextPlaqueY2,
    wallDecorationDerivedGraphicOffset,
    alcoveDecorationIndices,
    fountainDecorationIndex,
    doorSwitchRectIndex,
    doorSwitchRectSets,
    doorSwitchSourceDescSets,
    doorOrnamentRectSets,
    doorOrnamentRectSetIndex,
    doorOrnamentColorMapF3,
    doorOrnamentColorMapF2,
    floorDecorationDescSets,
    floorDecorationRectSetIndex,
    relativeCellGraphicIncrement,
    floorColorMapMedium,
    floorColorMapFar,
    textDecode,
  };
}
