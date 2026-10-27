/**
 * The tables the port reads from `graphics.dat`'s table items, written back and held up
 * against the items' own bytes, at the offsets CSBWin's own declarations give them.
 *
 * CSBWin reads each table item whole into a span of its `d.` struct
 * (`ReadAndExpandGraphic`, `doc/CSBwin-src/CSBCode.cpp:10248-10321`), so `Data.h`'s
 * declarations of that span are the item's layout. The port reads each table at an
 * offset of its own, worked out by hand from those declarations (`ABS_*` in
 * `src/data/tables/ObjectTables.ts`, the tail walk in `ViewportTables.ts`). This tool
 * works the layout out again, from `Data.h` itself, and proves the port's reads against it:
 *
 * 1. **The layout.** The span between the item's markers is laid out from its declared
 *    types and counts. Its size must be the one `ReadAndExpandGraphic`'s `ASSERT` demands,
 *    read from `CSBCode.cpp`, and every declaration that carries its address, in its name
 *    (`Word7246`) or its comment (`//Byte6652[24]`), must sit where that address puts it.
 *    No field may need padding: a word at an odd offset would mean the C++ is not laid out
 *    the way this reads it.
 * 2. **Every data set.** Each `graphics.dat` the manifest lists holds the item at a size
 *    the `ASSERT` accepts, but where `WIDER` names the one field that is longer.
 * 3. **The round trip.** Every table the port extracted from the item is encoded back,
 *    field by field, and compared with the item's bytes at the `Data.h` field it was read
 *    from. A wrong offset, width, count or byte order is a diff. A table read past its own
 *    field must cite the CSBWin line that reads it that way, and that citation must still
 *    be needed. What no table reads is printed, not failed: the port has no use for it yet.
 *
 * Words are encoded high byte first: CSBWin swaps every word it uses from these items,
 * at load (`swapNwords`, `LE16`, `CSBCode.cpp:10250-10257`) or where it reads them
 * (`LE16(d.specialColors…)`, `CSBCode.cpp:2902`; `LE32(d.Long1812…)`, `Graphics.cpp:356`).
 *
 * Covered: every table item. `0x22e` holds `ViewportTables` and half of `ObjectTables`,
 * `0x22f` the other half, and `0x230` to `0x232` are `UITables`. `Data.h` marks only where
 * `0x22f` starts, so its span ends where the `ASSERT`'s size puts it, and the declaration
 * after it must name that address. Two data sets' items differ from the span, each as
 * `fitLayout` says: `0x231` lacks its last field where it is the short size, and the French
 * 1.3 file's `0x230` has longer attack names.
 *
 * Run: `npm test -- --only=graphics-tables.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { extractGraphicsTables, type GraphicsTables } from '../../src/data/tables/GraphicsTables';
import type { DecorationDesc } from '../../src/data/tables/ObjectTables';
import type { KeyXlate, Rect, RectPos, UIButton } from '../../src/data/tables/UITables';
import { check, finish } from '../lib/check';
import { DATA_SETS } from '../lib/dataSets';

const DATA_H = readFileSync(resolve('doc/CSBwin-src/Data.h'), 'utf8').split('\n');
const CSBCODE = readFileSync(resolve('doc/CSBwin-src/CSBCode.cpp'), 'utf8');

/** Size and alignment of each type the spans declare. */
const TYPES: Record<string, { size: number; align: number }> = {
  i8: { size: 1, align: 1 },
  ui8: { size: 1, align: 1 },
  char: { size: 1, align: 1 },
  i16: { size: 2, align: 2 },
  ui16: { size: 2, align: 2 },
  // Aligned as the 68000 needs it, on a word: `Long1828` sits two bytes into `0x232`.
  i32: { size: 4, align: 2 },
  // `wordRectPos` or `byteRectPos`, eight bytes either way (`CSB.h:1370-1380`).
  RectPos: { size: 8, align: 2 },
  // `ITEM110s s[11]`, ten bytes each (`CSB.h:2434-2442`).
  ITEM110: { size: 110, align: 1 },
  // Two words and eight bytes (`CSB.h:2218-2233`).
  ITEM12: { size: 12, align: 2 },
  // `ITEM100s s[10]`, ten bytes each (`CSB.h:2424-2432`).
  VIEWPORTPOS: { size: 100, align: 1 },
  // Four bytes and a word (`Data.h:169-176`).
  STRUCT5688: { size: 6, align: 2 },
  // Six bytes (`CSB.h:2207-2216`).
  GRAPHIC_CLASS: { size: 6, align: 1 },
  // A `BYTE_RECTANGLE` and two bytes (`Data.h:217-222`, `CSB.h:1389`).
  DECORATION_DESC: { size: 6, align: 1 },
  // Two words and four bytes (`CSB.h:1672-1701`).
  OBJDESC: { size: 6, align: 2 },
  // Four bytes and a word (`CSB.h:1352-1360`).
  WEAPONDESC: { size: 6, align: 2 },
  // Four bytes (`CSB.h:1703-1715`).
  CLOTHINGDESC: { size: 4, align: 1 },
  // Two bytes, two words, eight bytes, four words and four bytes; `word4` is a
  // `MONSTERDESC_WORD4`, one `ui16` (`CSB.h:2295-2316`, `:2319-2422`).
  MONSTERDESC: { size: 26, align: 2 },
  // Eight bytes (`Data.h:225-229`).
  LEGALATTACKS: { size: 8, align: 1 },
  // A long, two bytes and a word (`CSB.h:1786-1798`).
  SPELL: { size: 8, align: 2 },
  // Six words (`CSB.h:1662-1670`).
  btn: { size: 12, align: 2 },
  // Four words (`CSB.h:1654-1660`).
  MOVEBUTN: { size: 8, align: 2 },
  // Two words (`CSB.h:1382-1386`).
  KeyXlate: { size: 4, align: 2 },
  // A word and six bytes (`CSB.h:2196-2205`).
  SOUND: { size: 8, align: 2 },
  // Sixteen words (`CSB.h:2657-2660`).
  PALETTE: { size: 32, align: 2 },
  // Three words (`CSB.h:652-663`).
  ICONDISPLAY: { size: 6, align: 2 },
};

interface Field {
  name: string;
  type: string;
  size: number;
  offset: number;
  /** The `d.` address the declaration names, if it names one. */
  address: number | null;
  line: number;
}

interface Layout {
  graphic: number;
  fields: Map<string, Field>;
  size: number;
  /** The sizes `CSBCode.cpp` asserts the item may have. */
  asserted: number[];
}

/**
 * The address a declaration carries: in its name, or in the first comment that starts with
 * one, named (`//Byte6652[24]`) or bare (`//9760`).
 */
function addressOf(name: string, comment: string): number | null {
  const own = /(\d{2,5})$/.exec(name);
  if (own) return Number(own[1]);
  for (const part of comment.split('//')) {
    const m = /^\s*(?:[a-z]\w*\s+)?[A-Za-z]*(\d{3,5})\b/.exec(part);
    if (m) return Number(m[1]);
  }
  return null;
}

/** A declaration of `Data.h`, split from its comment; null for a line that declares nothing. */
function declarationAt(i: number): { type: string; name: string; dims: string; comment: string } | null {
  const text = DATA_H[i];
  const cut = text.indexOf('//');
  const code = (cut >= 0 ? text.slice(0, cut) : text).trim();
  if (code === '') return null;
  const comment = cut >= 0 ? text.slice(cut) : '';
  // `#define FILL(a,b) i8 fill##a[a-b];` (`Data.h:213`).
  const fill = /^FILL\((\d+),(\d+)\)$/.exec(code);
  if (fill) return { type: 'i8', name: `fill${fill[1]}`, dims: `[${Number(fill[1]) - Number(fill[2])}]`, comment };
  const m =/^(\w+)\s+(\w+)\s*((?:\[\s*\d+\s*\])*)\s*;$/.exec(code);
  if (!m) {
    check(false, `Data.h:${i + 1}: a declaration this tool can lay out (${code})`);
    return null;
  }
  return { type: m[1], name: m[2], dims: m[3], comment };
}

/**
 * Lay out a graphic's span of `Data.h`, checking it on the way. The span runs from the
 * graphic's start marker to `endMarker`, or, without one, until it holds the size
 * `CSBCode.cpp` asserts.
 */
function layoutOf(graphic: number, startMarker: string, endMarker?: RegExp): Layout {
  const hex = `0x${graphic.toString(16)}`;
  const asserted = [...CSBCODE.matchAll(new RegExp(`GraphicDecompressedSizes\\[${hex}\\]\\s*==\\s*0x([0-9a-f]+)`, 'gi'))]
    .map((a) => parseInt(a[1], 16));
  check(asserted.length > 0, `CSBCode.cpp asserts the size of graphic ${hex}`);
  check(endMarker !== undefined || asserted.length === 1, `graphic ${hex}: one asserted size to end its span at`);
  const first = DATA_H.findIndex((l) => l.includes(startMarker));
  check(first >= 0, `Data.h marks the start of graphic ${hex} (${startMarker})`);
  const fields = new Map<string, Field>();
  let offset = 0;
  let start: number | null = null;
  let i = first + 1;
  for (; i < DATA_H.length; i++) {
    if (endMarker ? endMarker.test(DATA_H[i]) : offset >= asserted[0]) break;
    const decl = declarationAt(i);
    if (!decl) continue;
    const { type, name, dims } = decl;
    if (!TYPES[type]) {
      check(false, `Data.h:${i + 1}: ${type} is a type this tool can lay out (${name})`);
      continue;
    }
    const count = [...dims.matchAll(/\d+/g)].reduce((n, d) => n * Number(d[0]), 1);
    const { size, align } = TYPES[type];
    check(offset % align === 0, `Data.h:${i + 1}: ${name} needs no padding (offset ${offset}, ${type})`);
    const address = addressOf(name, decl.comment);
    if (start === null) {
      check(address !== null, `Data.h:${i + 1}: the span's first field, ${name}, names its address`);
      start = address ?? 0;
    }
    if (address !== null) {
      check(start - address === offset, `Data.h:${i + 1}: ${name} at ${offset}, where its address ${address} puts it (${start - address})`);
    }
    fields.set(name, { name, type, size: size * count, offset, address, line: i + 1 });
    offset += size * count;
  }
  if (!endMarker) {
    // The span ends at the asserted size only if the next declaration starts there.
    while (i < DATA_H.length && declarationAt(i) === null) i++;
    const next = declarationAt(i);
    const address = next ? addressOf(next.name, next.comment) : null;
    check(start !== null && address === start - offset,
      `Data.h:${i + 1}: the declaration after graphic ${hex}'s span names its end, address ${(start ?? 0) - offset} (${next?.name}, ${address})`);
  }
  check(asserted.includes(offset), `graphic ${hex}: Data.h's span is ${offset} bytes, a size CSBCode.cpp asserts (${asserted.join(', ')})`);
  console.log(`graphic ${hex}: ${fields.size} fields, ${offset} bytes from address ${start}`);
  return { graphic, fields, size: offset, asserted };
}

/**
 * The data sets whose item is longer than CSBWin's struct, in one field: the French 1.3
 * and German 1.2 files' attack names take 400 bytes, not `AttackNames[300]`'s (`DEBT.md`
 * H, "Word sizes from the file"; `doc/PROVEN_FACTS.md` → "The French 1.3 `graphics.dat`:
 * longer words"; `doc/ATARI_ST_DISK_REFERENCE.md` → "The German 1.2 disk").
 */
const WIDER: Record<string, { graphic: number; field: string; by: number }> = {
  'dm-atari-1.2-de': { graphic: 0x230, field: 'AttackNames', by: 100 },
  'dm-atari-1.3-fr': { graphic: 0x230, field: 'AttackNames', by: 100 },
};

/**
 * The layout of one data set's item, `size` bytes: the span itself, the span without its
 * last field when that is the other size `CSBCode.cpp` asserts (`0x231`'s `0x7d4`, which
 * lacks `Buttons16932`, `CSBCode.cpp:10259-10276`), or a field widened as `WIDER` says.
 */
function fitLayout(id: string, layout: Layout, size: number): Layout {
  const hex = `0x${layout.graphic.toString(16)}`;
  const wider = WIDER[id]?.graphic === layout.graphic ? WIDER[id] : undefined;
  if (wider) {
    const widened = layout.fields.get(wider.field);
    check(widened !== undefined, `${id}: ${wider.field} is a field of graphic ${hex}`);
    const fields = new Map<string, Field>();
    for (const f of layout.fields.values()) {
      if (f === widened) fields.set(f.name, { ...f, size: f.size + wider.by });
      else fields.set(f.name, widened && f.offset > widened.offset ? { ...f, offset: f.offset + wider.by } : f);
    }
    check(size === layout.size + wider.by, `${id}: graphic ${hex} is ${size} bytes, Data.h's ${layout.size} with ${wider.field} ${wider.by} bytes longer`);
    return { ...layout, fields, size };
  }
  const last = [...layout.fields.values()].at(-1);
  if (last && size !== layout.size && size === last.offset && layout.asserted.includes(size)) {
    const fields = new Map(layout.fields);
    fields.delete(last.name);
    return { ...layout, fields, size };
  }
  check(size === layout.size, `${id}: graphic ${hex} is ${size} bytes, Data.h's ${layout.size}`);
  return layout;
}

/** Bytes put back at a field of the item, from one table. */
interface Region {
  table: string;
  field: string;
  /** Byte offset within the field. */
  at: number;
  /** The bytes from `at` on; null where the table holds nothing of the record. */
  bytes: (number | null)[];
  /** The CSBWin read that runs past the field, when this region does. */
  runsOn?: string;
}

const word = (v: number): number[] => [(v >> 8) & 0xff, v & 0xff];
const words = (a: ArrayLike<number>): number[] => Array.from(a).flatMap(word);
const bytes = (a: ArrayLike<number>): number[] => Array.from(a, (b) => b & 0xff);
const long = (v: number): number[] => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const rect4 = (r: RectPos): number[] => [r.x1, r.x2, r.y1, r.y2];
const wordRect = (r: Rect): number[] => words([r.x1, r.x2, r.y1, r.y2]);
/** A byte `RectPos` as `toRectPos` read it: `uByte4` is half both `srcWidth` and `srcStride`. */
const rect8 = (r: RectPos): number[] => [
  ...rect4(r),
  r.srcWidth === r.srcStride ? (r.srcWidth ?? NaN) / 2 : NaN,
  r.srcHeight ?? NaN,
  r.srcX ?? NaN,
  r.srcY ?? NaN,
];
const decoration = (d: DecorationDesc): number[] => [d.x1, d.x2, d.y1, d.y2, d.widthBytes, d.height];

/** Item `0x22e`, as `ViewportTables` and `ObjectTables` read it. */
function regions22e(t: GraphicsTables): Region[] {
  const v = t.viewport;
  const o = t.objects;
  const out: Region[] = [];
  const put = (table: string, field: string, b: number[], at = 0, runsOn?: string) =>
    out.push({ table, field, at, bytes: b, runsOn });

  put('teleporterRectangles', 'teleporterRectangles', v.teleporterRectangles.flatMap(rect8));
  for (const [key, rects] of Object.entries(v.doorRects)) put(`doorRects.${key}`, `DoorRects${key}`, rects.flatMap(rect8));
  put('doorTrackTopRect', 'DoorTrackTopRect', v.doorTrackTopRect.flatMap(rect8));
  put('doorFrameRect', 'DoorFrameRect', v.doorFrameRect.flatMap(rect8));
  put('wallRectangles', 'wallRectangles', v.wallRectangles.flatMap(rect8));
  put('mirrorWallRectF2', 'Byte2962', rect4(v.mirrorWallRectF2));
  put('mirrorWallRectF3', 'Byte2958', rect4(v.mirrorWallRectF3));
  put('ceilingPit', 'CeilingPit', v.ceilingPit.flatMap(rect8));
  put('floorPitRect', 'FloorPitRect', v.floorPitRect.flatMap(rect8));
  put('stairEdgeRect', 'StairEdgeRect', v.stairEdgeRect.flatMap(rect8));
  put('stairFacingDownRect', 'StairFacingDownRect', v.stairFacingDownRect.flatMap(rect8));
  put('stairFacingUpRect', 'StairFacingUpRect', v.stairFacingUpRect.flatMap(rect8));
  put('championPortraitRect', 'Byte2546', rect4(v.championPortraitRect));
  put('seeThruDoorEdgeRect', 'uByte2542', rect8(v.seeThruDoorEdgeRect), 0, '(RectPos *)d.uByte2542, Viewport.cpp:2587');
  put('seeThruWallsRect', 'SeeThruWallsRect', rect8(v.seeThruWallsRect));
  put('seeThruWallsRect2', 'SeeThruWallsRect', rect8(v.seeThruWallsRect2), 4, '(RectPos *)&d.SeeThruWallsRect.b.uByte4, Viewport.cpp:2406');
  put('seeThruWallsRectUByte4', 'SeeThruWallsRect', [v.seeThruWallsRectUByte4], 4);
  put('seeThruWallsRectUByte6', 'SeeThruWallsRect', [v.seeThruWallsRectUByte6], 6);

  put('cloudPositions7246', 'Word7246', words(o.cloudPositions7246), 0, '&d.Word7246[3*(RelativeCellNumber-3)], Code51a4.cpp:143');
  put('cloudPositions7222', 'Word7222', words(o.cloudPositions7222));
  put('cloudPositions7162', 'Word7162', words(o.cloudPositions7162));
  put('cloudPositions7042', 'Word7042', words(o.cloudPositions7042));
  put('monsterPositions', 's6982', o.monsterPositions.flat(2).flatMap((p) => [p.x, p.y]));
  put('smallOffsets', 'smallOffsets', bytes(o.smallOffsets));
  put('monsterColorMapMedium', 'Byte6628', bytes(o.monsterColorMapMedium));
  put('monsterColorMapFar', 'Byte6612', bytes(o.monsterColorMapFar));
  put('specialColors', 'specialColors', o.specialColors.flatMap((s) =>
    [...words(s.paletteEntries), s.monsterColorMapMedium, s.monsterColorMapFar]));
  put('monsterGraphics', 'Item6414', o.monsterGraphics.flatMap((m) => [
    ...word(m.word0), ...word(m.word2), m.frontRearByteWidth, m.frontRearHeight,
    m.sideByteWidth, m.sideHeight, m.attackByteWidth, m.attackHeight, m.uByte10, m.uByte11,
  ]));
  put('viewportPosition', 'viewportPosition', o.viewportPosition.flat(2).flatMap((p) => [p.x, p.y]));
  put('smallOffsetIndices', 'smallOffsetIndicies', bytes(o.smallOffsetIndices));
  put('cloudScale', 'Byte5758', bytes(o.cloudScale));
  put('missileScale', 'Byte5752', bytes(o.missileScale));
  put('colorMapMedium', 'Byte5744', bytes(o.colorMapMedium));
  put('colorMapFar', 'Byte5728', bytes(o.colorMapFar));
  put('cloudColorMap', 'Byte5712', bytes(o.cloudColorMap));
  put('cloudScaleBase', 'Byte5696', bytes(o.cloudScaleBase));
  put('missileGraphics', 'struct5688', o.missileGraphics.flatMap((m) =>
    [m.uByte0, m.uByte1, m.widthBytes, m.height, ...word(m.word4)]));
  put('graphicClasses', 's5604', o.graphicClasses.flatMap((g) =>
    [g.objectGraphicIndex & 0xff, g.uByte1, g.widthBytes, g.height, g.byte4, g.byte5]));
  // Both are read 24 bytes a set, from fields of six (`CSBCode.cpp:4142`, `:4164`).
  const doorSwitchRuns = (set: DecorationDesc[][]) => set.length * 24 > 6;
  put('doorSwitchRectSets', 'Byte5094', o.doorSwitchRectSets.flat().flatMap(decoration), 0,
    doorSwitchRuns(o.doorSwitchRectSets) ? 'd.Byte5094 + 24*D4W + 6*D6W, CSBCode.cpp:4142' : undefined);
  put('doorSwitchSourceDescSets', 'Byte5076', o.doorSwitchSourceDescSets.flat().flatMap(decoration), 0,
    doorSwitchRuns(o.doorSwitchSourceDescSets) ? 'd.Byte5076 + 24*D4W, CSBCode.cpp:4164' : undefined);
  put('doorOrnamentRectSets', 'Byte5070', o.doorOrnamentRectSets.flat().flatMap(decoration), 0,
    '(aReg)d.Byte5070 + 18*D4W + 6*D6W, CSBCode.cpp:4073');
  put('floorDecorationDescSets', 'floorDecorDesc', o.floorDecorationDescSets.flat().flatMap(decoration), 0,
    'd.floorDecorDesc[d.LoadedFloorDecorations[graphicIndex][1]][relativeCell], CSBCode.cpp:3957');
  put('wallDecorationRectSets', 'wallDecorationPosition', o.wallDecorationRectSets.flat().flatMap(decoration));
  put('wallTextPlaqueY2', 'Byte4212', bytes(o.wallTextPlaqueY2));
  put('wallTextLineY2', 'Byte4196', bytes(o.wallTextLineY2));
  put('wallTextRect', 'Byte4192', rect4(o.wallTextRect));
  put('doorOrnamentColorMapF2', 'Byte4188', bytes(o.doorOrnamentColorMapF2));
  put('doorOrnamentColorMapF3', 'Byte4172', bytes(o.doorOrnamentColorMapF3));
  put('floorColorMapMedium', 'MediumColorMapping', bytes(o.floorColorMapMedium));
  put('floorColorMapFar', 'FarColorMapping', bytes(o.floorColorMapFar));
  put('doorSwitchRectIndex', 'Byte4124', bytes(o.doorSwitchRectIndex));
  put('doorOrnamentRectSetIndex', 'Byte4122', bytes(o.doorOrnamentRectSetIndex), 0,
    '(UI8)(d.Byte4122[D7W]), D7W a byte, Code390e.cpp:282');
  put('floorDecorationRectSetIndex', 'Byte4110', bytes(o.floorDecorationRectSetIndex), 0,
    '(UI8)(d.Byte4110[D7W]), D7W a byte, Code390e.cpp:270');
  put('wallDecorationRectSetIndex', 'Byte4100', bytes(o.wallDecorationRectSetIndex));
  put('fountainDecorationIndex', 'Word4040', word(o.fountainDecorationIndex));
  put('alcoveDecorationIndices', 'Byte4038', bytes(o.alcoveDecorationIndices));
  put('relativeCellGraphicIncrement', 'RelativeCellGraphicIncrement', bytes(o.relativeCellGraphicIncrement));
  put('wallDecorationDerivedGraphicOffset', 'WallDecorationDerivedGraphicOffset', bytes(o.wallDecorationDerivedGraphicOffset));
  put('cloudUnderPartyRect', 'Word2530', rect4(o.cloudUnderPartyRect));
  return out;
}

/** Item `0x22f`, as `ObjectTables` reads it. */
function regions22f(t: GraphicsTables): Region[] {
  const o = t.objects;
  const out: Region[] = [];
  const put = (table: string, field: string, b: (number | null)[]) => out.push({ table, field, at: 0, bytes: b });
  const each = <T>(n: number, f: (i: number) => T[]): T[] => Array.from({ length: n }, (_, i) => f(i)).flat();

  put('byte10340', 'Byte10340', bytes(o.byte10340));
  put('textDecode.byte10336', 'Byte10336', bytes(o.textDecode.byte10336));
  put('textDecode.byte10080', 'Byte10080', bytes(o.textDecode.byte10080));
  put('textDecode.byte10016', 'Byte10016', bytes(o.textDecode.byte10016));
  put('doorCharacteristics', 'DoorCharacteristics', words(o.doorCharacteristics));
  put('monsterDroppings', 'MonsterDroppings', words(o.monsterDroppings));
  put('uByte9672', 'uByte9672', bytes(o.uByte9672));
  put('monsterDesc', 'MonsterDescriptor', o.monsterDesc.flatMap((m) => [
    m.type, m.attackSound, ...word(m.word2), ...word(m.word4),
    m.movementTicks06, m.attackTicks07, m.defense08, m.baseHealth09,
    m.attack10, m.poisonAttack11, m.dexterity12, m.unused13,
    ...word(m.word14), ...word(m.word16), ...word(m.word18), ...word(m.word20), ...m.uByte22,
  ]));
  put('foodValue', 'FoodValue', words(o.foodValue));
  put('byte8946', 'Byte8946', bytes(o.byte8946));
  put('clothingWeights, clothingArmour, clothingFlags', 'ClothingDesc', each(o.clothingWeights.length, (i) =>
    [o.clothingWeights[i], o.clothingArmour[i], o.clothingFlags[i], null]));
  put('weaponDesc', 'weapons', o.weaponDesc.flatMap((w) => [w.weight, w.uByte1, w.uByte2, w.uByte3, ...word(w.word4)]));
  put('weaponWeights', 'weapons', each(o.weaponWeights.length, (i) => [o.weaponWeights[i], null, null, null, null, null]));
  put('objDesc*', 'ObjDesc', each(o.objDescObjectType.length, (i) => [
    ...word(o.objDescObjectType[i]), o.objDescGraphicClass[i], o.objDescAttackClass[i] & 0xff, ...word(o.objDescWord4[i]),
  ]));
  put('byte7302', 'Byte7302', bytes(o.byte7302));
  put('deltaX', 'DeltaX', words(o.deltaX));
  put('deltaY', 'DeltaY', words(o.deltaY));
  return out;
}

/** Item `0x230`, as `UITables` reads it. */
function regions230(t: GraphicsTables): Region[] {
  const u = t.ui.graphic230;
  const out: Region[] = [];
  const put = (table: string, field: string, b: number[]) => out.push({ table, field, at: 0, bytes: b });

  put('word20242', 'Word20242', wordRect(u.word20242));
  put('wRectPos20234', 'wRectPos20234', wordRect(u.wRectPos20234));
  put('wRectPos20226', 'wRectPos20226', wordRect(u.wRectPos20226));
  put('wRectPos20218', 'wRectPos20218', wordRect(u.wRectPos20218));
  put('wRectPos20210', 'wRectPos20210', wordRect(u.wRectPos20210));
  put('wRectPos20202', 'wRectPos20202', wordRect(u.wRectPos20202));
  put('shrinkColorMap', 'Byte20194', bytes(u.shrinkColorMap));
  put('experienceForAttacking', 'experienceForAttacking', bytes(u.experienceForAttacking));
  put('skillNumber', 'SkillNumber', bytes(u.skillNumber));
  put('byte20090', 'Byte20090', bytes(u.byte20090));
  put('byte20046', 'Byte20046', bytes(u.byte20046));
  put('byte20002', 'Byte20002', bytes(u.byte20002));
  put('byte19958', 'Byte19958', bytes(u.byte19958));
  put('byte19914', 'Byte19914', bytes(u.byte19914));
  // Each name and its terminator: a last name without one would run past the field.
  put('attackNames', 'AttackNames', u.attackNames.flatMap((n) => [...Array.from(n, (c) => c.charCodeAt(0)), 0]));
  put('legalAttacks', 'legalAttacks', u.legalAttacks.flatMap((l) => bytes(l)));
  put('spells', 'Spells', u.spells.flatMap((s) => [...long(s.spellId), s.skillRequired, s.byte5, ...word(s.word6)]));
  put('spellFirstRuneScale', 'Byte19016', bytes(u.spellFirstRuneScale));
  put('spellBaseMana', 'Byte19010', bytes(u.spellBaseMana));
  return out;
}

/** Item `0x231`, as `UITables` reads it. */
function regions231(t: GraphicsTables): Region[] {
  const u = t.ui.graphic231;
  const out: Region[] = [];
  const put = (table: string, field: string, b: number[]) => out.push({ table, field, at: 0, bytes: b });
  const buttons = (list: UIButton[]) => list.flatMap((b) => words([b.word0, b.x1, b.x2, b.y1, b.y2, b.button]));
  // The keys up to the terminating `mouse == 0` both readers stop at (`SwapKeyXlate`,
  // `CSBCode.cpp:10144-10153`, and `TAG0196da`, `:8533`), which must lie in the field.
  const keys = (list: KeyXlate[]) => [...list.flatMap((k) => words([k.mouse, k.keyscan])), 0, 0];

  for (const [key, list] of Object.entries(u.buttons)) {
    // `buttons16932` is empty when the item lacks it, and so is no field of its layout.
    if (list.length > 0) put(`buttons.${key}`, `Buttons${key.slice('buttons'.length)}`, buttons(list));
  }
  put('rect18600', 'Byte18600', wordRect(u.rect18600));
  put('rect18592', 'Byte18592', wordRect(u.rect18592));
  put('rect18584', 'Byte18584', wordRect(u.rect18584));
  put('rect18576', 'Byte18576', wordRect(u.rect18576));
  put('word18568', 'Word18568', words(u.word18568));
  put('word18560', 'Word18560', words(u.word18560));
  put('word18552', 'Word18552', u.word18552.flatMap(wordRect));
  put('moveButtons', 'MoveButn18496', u.moveButtons.flatMap(wordRect));
  put('dropAreas', 'DropAreas', u.dropAreas.flatMap((r) => [r.x1, r.x2, r.y1, r.y2]));
  put('keys.byte18448', 'Byte18448', keys(u.keys.byte18448));
  put('keys.byte18440', 'Byte18440', keys(u.keys.byte18440));
  put('keys.byte18428', 'Byte18428', keys(u.keys.byte18428));
  put('keys.byte18400', 'Byte18400', keys(u.keys.byte18400));
  return out;
}

/** Item `0x232`, as `UITables` reads it. */
function regions232(t: GraphicsTables): Region[] {
  const u = t.ui.graphic232;
  const out: Region[] = [];
  const put = (table: string, field: string, b: number[], runsOn?: string) => out.push({ table, field, at: 0, bytes: b, runsOn });

  put('byte1830', 'Byte1830', [...Array.from(u.byte1830, (c) => c.charCodeAt(0)), 0]);
  put('long1828', 'Long1828', u.long1828.flatMap(long));
  put('long1812', 'Long1812', u.long1812.flatMap(long));
  put('wRectPos1796', 'wRectPos1796', wordRect(u.wRectPos1796));
  put('wRectPos1788', 'wRectPos1788', wordRect(u.wRectPos1788));
  put('wRectPos1780', 'wRectPos1780', wordRect(u.wRectPos1780));
  put('sound1772', 'sound1772', u.sound1772.flatMap((s) => [...word(s.word0), s.byte2, s.byte3, s.byte4, s.byte5, s.byte6, s.byte7]));
  put('byte1596', 'Byte1596', bytes(u.byte1596));
  put('dropOrder', 'DropOrder', words(u.dropOrder));
  put('word1526', 'Word1526', words(u.word1526.flat()));
  put('word1502', 'Word1502', words(u.word1502.flat()));
  put('wRectPos1454', 'wRectPos1454', u.wRectPos1454.flatMap(wordRect));
  put('specialChars', 'SpecialChars', bytes(u.specialChars));
  put('byte1414', 'Byte1414', bytes(u.byte1414));
  put('byte1412', 'Byte1412', bytes(u.byte1412));
  put('word1406', 'Word1406', wordRect(u.word1406));
  put('word1398', 'Word1398', wordRect(u.word1398));
  put('byte1390', 'Byte1390', bytes(u.byte1390));
  put('byte1386', 'Byte1386', bytes(u.byte1386));
  put('cursorColorMapLight', 'Byte1382', bytes(u.cursorColorMapLight));
  put('cursorColorMapDark', 'Byte1366', bytes(u.cursorColorMapDark));
  put('cursorHand', 'Byte1350', bytes(u.cursorHand));
  put('cursorArrow', 'Byte1222', bytes(u.cursorArrow));
  put('byte1094', 'Byte1094', wordRect(u.byte1094));
  put('paletteBrightness', 'PaletteBrightness', words(u.paletteBrightness));
  put('word1074', 'Word1074', words(u.word1074));
  put('carryLocation', 'CarryLocation', words(u.carryLocation));
  put('wRectPos966', 'wRectPos966', wordRect(u.wRectPos966));
  put('wRectPos958', 'wRectPos958', wordRect(u.wRectPos958));
  put('wRectPos950', 'wRectPos950', wordRect(u.wRectPos950));
  put('wRectPos942', 'wRectPos942', wordRect(u.wRectPos942));
  put('wRectPos934', 'wRectPos934', wordRect(u.wRectPos934));
  put('wRectPos926', 'wRectPos926', wordRect(u.wRectPos926));
  put('iconDisplay', 'IconDisplay', u.iconDisplay.flatMap((i) => words([i.pixelX, i.pixelY, i.objectType])));
  put('byte640', 'Byte640', bytes(u.byte640), 'd.Byte640[charges], data.cpp:644');
  put('wRectPos624', 'wRectPos624', wordRect(u.wRectPos624));
  put('word612', 'Word612', words(u.word612));
  put('uByte590', 'uByte590', bytes(u.uByte590));
  put('byte586', 'Byte586', bytes(u.byte586.flat()));
  put('palette552', 'Palette552', words(u.palette552.flat()));
  put('palette360', 'Palette360', words(u.palette360));
  put('palette328', 'Palette328', words(u.palette328));
  put('defaultGraphicList', 'DefaultGraphicList', words(u.defaultGraphicList));
  put('identityColorMap', 'IdentityColorMap', bytes(u.identityColorMap));
  for (const n of [140, 132, 124, 116, 108, 100, 92, 84, 76, 68, 60, 52, 44, 36, 28, 20, 12] as const) {
    put(`word${n}`, `Word${n}`, wordRect(u[`word${n}`]));
  }
  return out;
}

/**
 * Hold a table's regions up against the item. Returns the bytes they covered, for the
 * report of what nothing reads.
 */
function roundTrip(set: string, layout: Layout, raw: Uint8Array, regions: Region[]): Uint8Array {
  const hex = `0x${layout.graphic.toString(16)}`;
  const covered = new Uint8Array(raw.length);
  for (const r of regions) {
    const field = layout.fields.get(r.field);
    if (!field) {
      check(false, `${set} ${hex}: ${r.table} names ${r.field}, a field of the span`);
      continue;
    }
    const from = field.offset + r.at;
    const end = from + r.bytes.length;
    const runs = end > field.offset + field.size;
    check(runs === (r.runsOn !== undefined),
      runs ? `${set} ${hex}: ${r.table} reads ${end - field.offset - field.size} bytes past ${r.field} with no CSBWin read cited`
        : `${set} ${hex}: ${r.table} stays inside ${r.field}, so its citation (${r.runsOn}) is stale`);
    check(end <= raw.length, `${set} ${hex}: ${r.table} ends inside the item`);
    const diffs: number[] = [];
    for (let i = 0; i < r.bytes.length; i++) {
      if (r.bytes[i] === null) continue;
      if (r.bytes[i] !== raw[from + i]) diffs.push(from + i);
      covered[from + i] = 1;
    }
    check(diffs.length === 0,
      `${set} ${hex}: ${r.table} writes back as ${r.field}'s bytes (${diffs.length} differ, first at ${diffs[0]})`);
  }
  return covered;
}

/** Every field no region touched, or touched only in part. */
function printUnread(layout: Layout, covered: Uint8Array): void {
  const hex = `0x${layout.graphic.toString(16)}`;
  const lines: string[] = [];
  let unread = 0;
  for (const f of layout.fields.values()) {
    let n = 0;
    for (let i = 0; i < f.size; i++) n += covered[f.offset + i];
    if (n === f.size) continue;
    unread += f.size - n;
    lines.push(`  ${f.name.padEnd(36)} @${String(f.offset).padStart(5)} ${String(f.size).padStart(4)} bytes` +
      (n ? `, ${f.size - n} unread` : ', unread') + `  (Data.h:${f.line})`);
  }
  console.log(`graphic ${hex}: ${layout.size - unread} of ${layout.size} bytes read by a table; the rest:`);
  for (const l of lines) console.log(l);
}

function main(): void {
  const layout22e = layoutOf(0x22e, 'Start of graphic 0x22e', /End graphic 0x22e/);
  check(layout22e.fields.get('wallRectangles')?.offset === 7246 - 3074,
    'Data.h puts wallRectangles at 7246 - 3074, where its commented-out Byte3074 says');
  const layout22f = layoutOf(0x22f, 'Start graphic 0x22f');
  const last22f = [...layout22f.fields.values()].at(-1);
  check(last22f !== undefined && DATA_H[last22f.line - 1].includes('End of 22f'),
    `Data.h's own "End of 22f" sits on the span's last field (${last22f?.name})`);
  const items: [Layout, (t: GraphicsTables) => Region[]][] = [
    [layout22e, regions22e],
    [layout22f, regions22f],
    [layoutOf(0x230, 'Start of graphic 0x230', /Last part of graphic 0x230/), regions230],
    [layoutOf(0x231, 'Start of graphic 0x231', /End of graphic 0x231/), regions231],
    [layoutOf(0x232, 'Start of graphic 0x232', /End of graphic 0x232/), regions232],
  ];

  let first = true;
  for (const { id, dir } of DATA_SETS) {
    const graphics = new GraphicsLoader();
    graphics.loadFromArray(new Uint8Array(readFileSync(resolve(`${dir}/graphics.dat`))));
    const tables = extractGraphicsTables(graphics);
    check(tables.viewport.wallRectanglesOffset === layout22e.fields.get('wallRectangles')?.offset,
      `${id}: ViewportTables puts wallRectangles at Data.h's offset (${tables.viewport.wallRectanglesOffset})`);
    for (const [span, regionsOf] of items) {
      const hex = `0x${span.graphic.toString(16)}`;
      const raw = graphics.getRawGraphic(span.graphic);
      const layout = fitLayout(id, span, raw.length);
      const regions = regionsOf(tables);
      const covered = roundTrip(id, layout, raw, regions);
      const written = regions.reduce((n, r) => n + r.bytes.filter((b) => b !== null).length, 0);
      console.log(`${id.padEnd(16)} ${hex}: ${regions.length} tables written back, ${written} bytes`);
      if (first) printUnread(layout, covered);
    }
    check((tables.ui.graphic231.buttons.buttons16932.length > 0) === (graphics.getRawGraphic(0x231).length === 0x804),
      `${id}: UITables reads Buttons16932 exactly when graphic 0x231 holds it`);
    first = false;
  }
  finish();
}

main();
