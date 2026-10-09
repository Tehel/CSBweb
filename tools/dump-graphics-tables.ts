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
 *    the `ASSERT` accepts.
 * 3. **The round trip.** Every table the port extracted from the item is encoded back,
 *    field by field, and compared with the item's bytes at the `Data.h` field it was read
 *    from. A wrong offset, width, count or byte order is a diff. A table read past its own
 *    field must cite the CSBWin line that reads it that way, and that citation must still
 *    be needed. What no table reads is printed, not failed: the port has no use for it yet.
 *
 * Words are encoded high byte first: CSBWin swaps every word it uses from these items,
 * at load (`swapNwords`, `LE16`, `CSBCode.cpp:10250-10257`) or where it reads them
 * (`LE16(d.specialColors…)`, `CSBCode.cpp:2902`).
 *
 * Covered: item `0x22e` (`ViewportTables`, and the half of `ObjectTables` it holds).
 * `PLAN.md` → Phase 15, step 4, has what is left.
 *
 * Run: `npx tsx tools/dump-graphics-tables.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { extractGraphicsTables, type GraphicsTables } from '../src/data/tables/GraphicsTables';
import type { DecorationDesc } from '../src/data/tables/ObjectTables';
import type { RectPos } from '../src/data/tables/UITables';
import { check, finish } from './lib/check';

const DATA_H = readFileSync(resolve('doc/CSBwin-src/Data.h'), 'utf8').split('\n');
const CSBCODE = readFileSync(resolve('doc/CSBwin-src/CSBCode.cpp'), 'utf8');

/** Size and alignment of each type the spans declare. */
const TYPES: Record<string, { size: number; align: number }> = {
  i8: { size: 1, align: 1 },
  ui8: { size: 1, align: 1 },
  char: { size: 1, align: 1 },
  i16: { size: 2, align: 2 },
  ui16: { size: 2, align: 2 },
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
}

/** The address a declaration carries: in its name, or in the first comment that starts with one. */
function addressOf(name: string, comment: string): number | null {
  const own = /(\d{4,5})$/.exec(name);
  if (own) return Number(own[1]);
  for (const part of comment.split('//')) {
    const m = /^\s*(?:[a-z]\w*\s+)?[A-Za-z]+(\d{4,5})\b/.exec(part);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Lay out a graphic's span of `Data.h`, checking it on the way. */
function layoutOf(graphic: number, endMarker: RegExp): Layout {
  const hex = `0x${graphic.toString(16)}`;
  const first = DATA_H.findIndex((l) => l.includes(`Start of graphic ${hex}`));
  check(first >= 0, `Data.h marks the start of graphic ${hex}`);
  const fields = new Map<string, Field>();
  let offset = 0;
  let start: number | null = null;
  for (let i = first + 1; i < DATA_H.length && !endMarker.test(DATA_H[i]); i++) {
    const text = DATA_H[i];
    const cut = text.indexOf('//');
    const code = (cut >= 0 ? text.slice(0, cut) : text).trim();
    if (code === '') continue;
    const m = /^(\w+)\s+(\w+)\s*((?:\[\s*\d+\s*\])*)\s*;$/.exec(code);
    if (!m || !TYPES[m[1]]) {
      check(false, `Data.h:${i + 1}: a declaration this tool can lay out (${code})`);
      continue;
    }
    const [, type, name, dims] = m;
    const count = [...dims.matchAll(/\d+/g)].reduce((n, d) => n * Number(d[0]), 1);
    const { size, align } = TYPES[type];
    check(offset % align === 0, `Data.h:${i + 1}: ${name} needs no padding (offset ${offset}, ${type})`);
    const address = addressOf(name, cut >= 0 ? text.slice(cut) : '');
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
  const asserted = [...CSBCODE.matchAll(new RegExp(`GraphicDecompressedSizes\\[${hex}\\]\\s*==\\s*0x([0-9a-f]+)`, 'gi'))]
    .map((a) => parseInt(a[1], 16));
  check(asserted.length > 0, `CSBCode.cpp asserts the size of graphic ${hex}`);
  check(asserted.includes(offset), `graphic ${hex}: Data.h's span is ${offset} bytes, a size CSBCode.cpp asserts (${asserted.join(', ')})`);
  console.log(`graphic ${hex}: ${fields.size} fields, ${offset} bytes from address ${start}`);
  return { graphic, fields, size: offset };
}

/** Bytes put back at a field of the item, from one table. */
interface Region {
  table: string;
  field: string;
  /** Byte offset within the field. */
  at: number;
  bytes: number[];
  /** The CSBWin read that runs past the field, when this region does. */
  runsOn?: string;
}

const word = (v: number): number[] => [(v >> 8) & 0xff, v & 0xff];
const words = (a: ArrayLike<number>): number[] => Array.from(a).flatMap(word);
const bytes = (a: ArrayLike<number>): number[] => Array.from(a, (b) => b & 0xff);
const rect4 = (r: RectPos): number[] => [r.x1, r.x2, r.y1, r.y2];
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
  put('floorDecorationDescSets', 'floorDecorDesc', o.floorDecorationDescSets.flat().flatMap(decoration));
  put('wallDecorationRectSets', 'wallDecorationPosition', o.wallDecorationRectSets.flat().flatMap(decoration));
  put('wallTextPlaqueY2', 'Byte4212', bytes(o.wallTextPlaqueY2));
  put('wallTextLineY2', 'Byte4196', bytes(o.wallTextLineY2));
  put('wallTextRect', 'Byte4192', rect4(o.wallTextRect));
  put('doorOrnamentColorMapF2', 'Byte4188', bytes(o.doorOrnamentColorMapF2));
  put('doorOrnamentColorMapF3', 'Byte4172', bytes(o.doorOrnamentColorMapF3));
  put('floorColorMapMedium', 'MediumColorMapping', bytes(o.floorColorMapMedium));
  put('floorColorMapFar', 'FarColorMapping', bytes(o.floorColorMapFar));
  put('doorSwitchRectIndex', 'Byte4124', bytes(o.doorSwitchRectIndex));
  put('doorOrnamentRectSetIndex', 'Byte4122', bytes(o.doorOrnamentRectSetIndex));
  put('floorDecorationRectSetIndex', 'Byte4110', bytes(o.floorDecorationRectSetIndex));
  put('wallDecorationRectSetIndex', 'Byte4100', bytes(o.wallDecorationRectSetIndex));
  put('fountainDecorationIndex', 'Word4040', word(o.fountainDecorationIndex));
  put('alcoveDecorationIndices', 'Byte4038', bytes(o.alcoveDecorationIndices));
  put('relativeCellGraphicIncrement', 'RelativeCellGraphicIncrement', bytes(o.relativeCellGraphicIncrement));
  put('wallDecorationDerivedGraphicOffset', 'WallDecorationDerivedGraphicOffset', bytes(o.wallDecorationDerivedGraphicOffset));
  put('cloudUnderPartyRect', 'Word2530', rect4(o.cloudUnderPartyRect));
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
  const layout22e = layoutOf(0x22e, /End graphic 0x22e/);
  check(layout22e.fields.get('wallRectangles')?.offset === 7246 - 3074,
    'Data.h puts wallRectangles at 7246 - 3074, where its commented-out Byte3074 says');

  const manifest = JSON.parse(readFileSync(resolve('static/gamefiles/manifest.json'), 'utf8')) as {
    dataSets: { id: string; dir: string }[];
  };
  let first = true;
  for (const { id, dir } of manifest.dataSets) {
    const graphics = new GraphicsLoader();
    graphics.loadFromArray(new Uint8Array(readFileSync(resolve(`static/gamefiles/${dir}/graphics.dat`))));
    const raw = graphics.getRawGraphic(0x22e);
    check(raw.length === layout22e.size, `${id}: graphic 0x22e is ${raw.length} bytes, Data.h's ${layout22e.size}`);
    const tables = extractGraphicsTables(graphics);
    check(tables.viewport.wallRectanglesOffset === layout22e.fields.get('wallRectangles')?.offset,
      `${id}: ViewportTables puts wallRectangles at Data.h's offset (${tables.viewport.wallRectanglesOffset})`);
    const regions = regions22e(tables);
    const covered = roundTrip(id, layout22e, raw, regions);
    console.log(`${id.padEnd(16)} 0x22e: ${regions.length} tables written back, ${regions.reduce((n, r) => n + r.bytes.length, 0)} bytes`);
    if (first) printUnread(layout22e, covered);
    first = false;
  }
  finish();
}

main();
