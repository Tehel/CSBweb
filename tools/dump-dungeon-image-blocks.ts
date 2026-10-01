/**
 * The whole dungeon image — blocks 7 to 15 — written again, and held up against the
 * bytes CSBWin wrote.
 *
 * The same argument `tools/dump-character-block.ts` makes for block 4 and
 * `tools/dump-save-blocks-vs-file.ts` for blocks 0 and 2-6: parse a **genuine** save into
 * a real `DungeonData`, write each section out of what came back, and compare with the
 * file's own bytes. Nothing here is symmetrical between reader and writer — CSBWin wrote
 * the bytes — so a field packed at the wrong offset, in the wrong width, in the wrong
 * byte order, or one the reader silently drops on the way through, all show up as a diff.
 *
 * **Two of the eight sections cannot be byte-identical, and the reason is not a defect.**
 * An RN in a save file is a slot number in the object indirect index, and that index's
 * numbering is ours rather than CSBWin's (`src/data/CsbwinObjectIndex.ts`:
 * `buildObjectIndirectIndex` gives every record a slot in `DBType` then index order,
 * where CSBWin allocates in the order `ConvertListOfObjects` happens to walk the world).
 * Nothing outside the file refers to a slot number, so a save only has to agree with
 * itself — but it does mean block 10, which is nothing *but* RNs, and the link word of
 * every record in block 13, come out with different numbers in them.
 *
 * So those words are checked a different way, and the check is weaker in kind. For each
 * of them the tool writes the two maps, reads them back through `readObjectIndirectIndex`
 * — which verifies both `FormChecksum`s, so the maps are known to be well-formed — and
 * resolves our word through them. The result must equal what the reader got by resolving
 * *CSBWin's* word through *CSBWin's* maps. That proves the reference still names the same
 * object, and no more: unlike the byte comparisons it would survive a bug that our own
 * encode and resolve share. Every byte that is not an RN is still compared with the file.
 *
 * Block 15 needs no such caveat and gets the strongest check of the lot: the final
 * checksum is computed over the **file's own** image bytes and compared with the word the
 * file ends with, so `buildImageChecksum` is measured against CSBWin arithmetic directly.
 *
 * `dungeon.dat` is checked too, and it is the sharper case twice over. For block 7 a save
 * writes 0 in `LegacyCellFlagArraySize` and 125 in `NumWordsInTextArray` where
 * `dungeon.dat` writes 12366 and 1749, so a writer that hardcoded either would pass on
 * one and fail on the other. And `dungeon.dat` stores **packed** RNs, needing no indirect
 * index at all — so for it every word of blocks 10 and 13 is byte-compared as well, which
 * is the check the saves cannot have.
 *
 * What writing it found, all of it in the record parsers rather than in the writer: the
 * door's `word2` bits 9-15, the teleporter's low `word4` byte, the text record's `word2`
 * bits 1-2, the creature's `word14` bits 4 and 15, the clothing item's `word2` bits
 * 14-15, both scroll forms' leftover bits, the chest's whole `word4` and its two trailing
 * bytes, the misc item's `cursed` and `subType`, and the whole of `EXPOOL`, which had no
 * parser at all. Earlier, on blocks 7 and 8: `LEVELDESC.FILL2[4]`, the low byte of
 * `DUNGEONDATINDEX::word4`, and bits 8-11 of `LEVELDESC.word12`.
 *
 * Run: `npx tsx tools/dump-dungeon-image-blocks.ts [path-or-directory]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DungeonLoader } from '../src/data/DungeonLoader';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { EXPOOL_RECORD_SIZE } from '../src/data/CsbwinExpool';
import {
  DUNGEON_IMAGE_HEADER_SIZE,
  LEVEL_DESCRIPTOR_SIZE,
  buildDungeonImageSections,
  buildImageChecksum,
  cellFlagArraySize,
  databaseRecordSize,
  dungeonImageSectionList,
} from '../src/data/CsbwinDungeonImageWriter';
import {
  buildObjectIndirectIndex,
  formChecksum,
  readObjectIndirectIndex,
} from '../src/data/CsbwinObjectIndex';
import type { CsbwinObjectIndex } from '../src/data/CsbwinObjectIndex';
import { DBType, OBJECT_ID_NULL } from '../src/core/types';
import type { DungeonData } from '../src/data/dungeonTypes';
import { check, finish } from './lib/check';
import { genuineSaves } from './lib/saves';

const DUNGEON = 'static/gamefiles/dm-atari/dungeon.dat';

/** Everything from here up is an `RNVAL` literal, not a slot (`CSBTypes.h:236-250`). */
const RN_LITERAL_FLOOR = 0xff00;

/* ------------------------------------------------------------------ field names --- */

/** Which `DUNGEONDATINDEX` word an offset falls in (`doc/CSBwin-src/CSB.h:2057-2082`). */
function headerField(i: number): string {
  if (i < 2) return 'sentinel';
  if (i < 4) return 'word2 (LegacyCellFlagArraySize)';
  if (i < 6) return 'word4 (NumLevel)';
  if (i < 8) return 'word6 (NumWordsInTextArray)';
  if (i < 10) return 'word8 (start position)';
  if (i < 12) return 'word10 (ObjectListLength)';
  return `dbSizes[${Math.floor((i - 12) / 2)}]`;
}

/** Which `LEVELDESC` field, and of which level. */
function descriptorField(i: number): string {
  const level = Math.floor(i / LEVEL_DESCRIPTOR_SIZE);
  const within = i % LEVEL_DESCRIPTOR_SIZE;
  const name =
    within < 2 ? 'cellOffset' :
    within < 6 ? 'FILL2' :
    within === 6 ? 'offsetX' :
    within === 7 ? 'offsetY' :
    within < 10 ? 'word8' :
    within < 12 ? 'word10' :
    within < 14 ? 'word12' : 'word14';
  return `level ${level} ${name}`;
}

/**
 * One database's record shape: the byte offset of every field, and which of them are RNs.
 * Transcribed from the `DBn` classes in `doc/CSBwin-src/CSB.h:818-1345`; the offsets are
 * the ones `DungeonLoader` reads and `CsbwinDungeonImageWriter` writes.
 */
interface RecordShape {
  /** Field name by byte offset within the record. */
  fields: Array<[number, string]>;
  /** Byte offsets of the RN words. Offset 0 — the link — is always one of them. */
  rnOffsets: number[];
}

function recordShape(db: number, newScrolls: boolean, bigActuators: boolean): RecordShape {
  switch (db) {
    case DBType.DOOR:
    case DBType.WEAPON:
    case DBType.CLOTHING:
    case DBType.POTION:
    case DBType.MISC:
    case DBType.CLOUD:
    case DBType.TEXT:
      return { fields: [[0, 'link'], [2, 'word2']], rnOffsets: [0] };
    case DBType.TELEPORTER:
      return { fields: [[0, 'link'], [2, 'word2'], [4, 'word4']], rnOffsets: [0] };
    case DBType.ACTUATOR:
      return {
        fields: bigActuators
          ? [[0, 'link'], [2, 'word2'], [4, 'word4'], [6, 'word6'], [8, 'word8']]
          : [[0, 'link'], [2, 'word2'], [4, 'word4'], [6, 'word6']],
        rnOffsets: [0],
      };
    case DBType.CREATURE:
      return {
        fields: [
          [0, 'link'], [2, 'possession2'], [4, 'uByte4'], [5, 'uByte5'],
          [6, 'hitPoints6[0]'], [8, 'hitPoints6[1]'], [10, 'hitPoints6[2]'],
          [12, 'hitPoints6[3]'], [14, 'word14'],
        ],
        rnOffsets: [0, 2],
      };
    case DBType.SCROLL:
      return newScrolls
        ? { fields: [[0, 'link'], [2, 'm_RNtext'], [4, 'm_word4']], rnOffsets: [0, 2] }
        : { fields: [[0, 'link'], [2, 'word2']], rnOffsets: [0] };
    case DBType.CHEST:
      return {
        fields: [[0, 'link'], [2, 'm_contents'], [4, 'm_word4'], [6, 'm_uByte6']],
        rnOffsets: [0, 2],
      };
    case DBType.MISSILE:
      return {
        fields: [
          [0, 'link'], [2, 'm_obj2'], [4, 'm_rangeRemaining'],
          [5, 'm_damageRemaining'], [6, 'm_timerIndex'],
        ],
        rnOffsets: [0, 2],
      };
    case DBType.EXPOOL:
      return { fields: [[0, 'DB11 block']], rnOffsets: [] };
    default:
      return { fields: [[0, '?']], rnOffsets: [] };
  }
}

/** The record's field that byte `within` belongs to. */
function fieldAt(shape: RecordShape, within: number): string {
  let name = '?';
  for (const [at, field] of shape.fields) if (within >= at) name = field;
  return name;
}

/* ------------------------------------------------------------- section comparison --- */

interface Section {
  name: string;
  mine: Uint8Array;
  /** Absolute offset in the file. */
  at: number;
  field: (within: number) => string;
  /** Byte offsets within `mine` that are not expected to match, and why. */
  exempt?: Set<number>;
  exemptReason?: string;
}

function compareSection(label: string, file: Uint8Array, section: Section): void {
  const theirs = file.subarray(section.at, section.at + section.mine.length);
  check(theirs.length === section.mine.length, `${label}: ${section.name} fits in the file`);

  const diffs = new Map<string, number>();
  let exempted = 0;
  for (let i = 0; i < section.mine.length; i++) {
    if (section.mine[i] === theirs[i]) continue;
    if (section.exempt?.has(i)) { exempted++; continue; }
    const f = section.field(i);
    diffs.set(f, (diffs.get(f) ?? 0) + 1);
  }

  const all = [...diffs].map(([f, n]) => `${f} (${n})`);
  const summary = all.length > 8 ? `${all.slice(0, 8).join(', ')}, +${all.length - 8} more` : all.join(', ');
  const note = exempted > 0 ? `  [${exempted} exempt bytes differ: ${section.exemptReason}]` : '';
  console.log(`    ${section.name.padEnd(28)} ${String(section.mine.length).padStart(6)} b  ` +
    (diffs.size === 0 ? 'identical' : `DIFFERS: ${summary}`) + note);
  check(diffs.size === 0, `${label}: ${section.name} is the file's own bytes${summary ? ` — ${summary}` : ''}`);
}

/* ---------------------------------------------------------------- the image layout --- */

/** Absolute file offsets of the eight sections, in file order. */
interface ImageLayout {
  header: number;
  levelDescriptors: number;
  columnIndex: number;
  objectList: number;
  indirectTextIndex: number;
  text: number;
  databases: number[];
  cellFlags: number;
  /** The byte just past block 14 — where the final checksum word sits. */
  end: number;
}

/**
 * Where every section of `dungeon.dat` starts, computed from the raw header rather than
 * from the loader, so the tool does not take the loader's word for it. The same
 * arithmetic `DungeonLoader.calculateOffsets` does.
 */
function dungeonDatLayout(raw: Uint8Array): ImageLayout {
  const u16 = (o: number) => (raw[o] << 8) | raw[o + 1];
  const numMaps = raw[4];
  let totalColumns = 0;
  for (let i = 0; i < numMaps; i++) totalColumns += ((u16(44 + i * 16 + 8) >> 6) & 0x1f) + 1;
  const levelDescriptors = 44;
  const columnIndex = levelDescriptors + numMaps * 16;
  const objectList = columnIndex + totalColumns * 2;
  const text = objectList + u16(10) * 2;
  let at = text + u16(6) * 2;
  const databases: number[] = [];
  for (let db = 0; db < 16; db++) {
    databases.push(at);
    at += u16(12 + db * 2) * databaseRecordSize(db);
  }
  return {
    header: 0, levelDescriptors, columnIndex, objectList,
    indirectTextIndex: text, text, databases, cellFlags: at, end: raw.length,
  };
}

/* ------------------------------------------------------------------------ the run --- */

interface Subject {
  label: string;
  bytes: Uint8Array;
  dungeon: DungeonData;
  base: number;
  layout: ImageLayout;
  /** Null for `dungeon.dat`, which stores packed RNs and has no indirect index. */
  index: CsbwinObjectIndex | null;
  encode: (rn: number) => number;
  options: { indirectText: boolean; bigActuators: boolean; newScrolls: boolean };
  declaredCellFlagSize: number;
  /** Whether the file ends with `WriteAndChecksum`'s word. `dungeon.dat` does not. */
  hasChecksum: boolean;
}

/**
 * Build the two maps for this world, serialise them exactly as the Extended Features
 * block carries them, and read them back through `readObjectIndirectIndex` — which dies
 * unless both `FormChecksum`s agree, so what comes back is known to be well-formed.
 * Every RN this run writes is resolved through *that*, not through the builder.
 */
function roundTripIndex(dungeon: DungeonData): { encode: (rn: number) => number; index: CsbwinObjectIndex } {
  const writer = buildObjectIndirectIndex(dungeon);
  const length = writer.length;
  const indexBytes = new Uint8Array(length * 2);
  for (let i = 0; i < length; i++) {
    indexBytes[i * 2] = writer.indexMap[i] & 0xff;
    indexBytes[i * 2 + 1] = (writer.indexMap[i] >> 8) & 0xff;
  }
  const blob = new Uint8Array(length * 3);
  blob.set(writer.typeMap, 0);
  blob.set(indexBytes, length);
  const index = readObjectIndirectIndex(
    blob, 0, length, formChecksum(writer.typeMap), formChecksum(indexBytes),
  );
  return { encode: (rn: number) => writer.encode(rn), index };
}

function compare(s: Subject): void {
  const built = buildDungeonImageSections(s.dungeon, { ...s.options, encode: s.encode });

  // The length the Extended Features block declares — a check in its own right, since
  // getting it wrong moves nothing in *this* file but would truncate or overrun ours.
  check(cellFlagArraySize(s.dungeon.maps) === s.declaredCellFlagSize,
    `${s.label}: the cell flag array measures ${s.declaredCellFlagSize} bytes, as the file declares`);

  /* ---- the sections that hold no RN: every byte compared ---- */

  const sections: Section[] = [
    { name: 'block 7  image header', mine: built.header, at: s.base + s.layout.header, field: headerField },
    {
      name: 'block 8  level descriptors', mine: built.levelDescriptors,
      at: s.base + s.layout.levelDescriptors, field: descriptorField,
    },
    {
      name: 'block 9  column index', mine: built.columnIndex,
      at: s.base + s.layout.columnIndex, field: (i) => `column ${Math.floor(i / 2)}`,
    },
    {
      name: 'block 14 cell flags', mine: built.cellFlags,
      at: s.base + s.layout.cellFlags, field: (i) => `+${i}`,
    },
  ];
  if (s.options.indirectText) {
    sections.push({
      name: 'block 11 indirect text ix', mine: built.indirectTextIndex,
      at: s.base + s.layout.indirectTextIndex, field: (i) => `entry ${Math.floor(i / 4)}`,
    });
    sections.push({
      name: 'block 12 compressed text', mine: built.text, at: s.base + s.layout.text,
      field: (i) => (i < 4 ? 'sizeOfCompressedText' : `word ${Math.floor((i - 4) / 2)}`),
    });
  } else {
    sections.push({
      name: 'block 12 text array', mine: built.text, at: s.base + s.layout.text,
      field: (i) => `word ${Math.floor(i / 2)}`,
    });
  }
  for (const section of sections) compareSection(s.label, s.bytes, section);

  /* ---- block 10: the object list, which is nothing but RNs ---- */

  compareObjectList(s, built.objectList);

  /* ---- block 13: every non-RN byte against the file, every RN resolved ---- */

  compareDatabases(s, built.databases);

  /* ---- structure: our eight sections have to land exactly where the file's do ---- */

  const parts = dungeonImageSectionList(built);
  const names = ['7 header', '8 descriptors', '9 columns', '10 object list',
    '11 text index', '12 text', '13 databases', '14 cell flags'];
  const expected = [
    s.layout.header, s.layout.levelDescriptors, s.layout.columnIndex, s.layout.objectList,
    s.layout.indirectTextIndex, s.layout.text, s.layout.databases[0], s.layout.cellFlags,
  ];
  let at = s.layout.header;
  parts.forEach((part, i) => {
    check(at === expected[i],
      `${s.label}: block ${names[i]} starts at ${expected[i]} — we put it at ${at}`);
    at += part.length;
  });
  check(at === s.layout.cellFlags + built.cellFlags.length, `${s.label}: the image closes on block 14`);
  check(at === s.layout.end,
    `${s.label}: the image we build is ${at - s.layout.header} bytes, the file's is ${s.layout.end - s.layout.header}`);

  /* ---- block 15: the closing checksum, measured on CSBWin's own bytes ---- */

  if (s.hasChecksum) {
    const theirImage = s.bytes.subarray(s.base + s.layout.header, s.base + s.layout.end);
    const sum = buildImageChecksum(theirImage);
    const theirs = s.bytes.subarray(s.base + s.layout.end, s.base + s.layout.end + 2);
    const ok = sum[0] === theirs[0] && sum[1] === theirs[1];
    console.log(`    ${'block 15 checksum'.padEnd(28)} ${'2'.padStart(6)} b  ` +
      (ok ? 'identical' : `DIFFERS: ours ${hex(sum)}, file ${hex(theirs)}`));
    check(ok, `${s.label}: block 15 is the checksum of the file's own image bytes`);
  }
}

function hex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Block 10. Our slot numbering is our own, so the words differ from the file's and there
 * is nothing to byte-compare; what must hold is that each of our words resolves — through
 * maps that have been serialised and read back — to the object the reader got out of
 * CSBWin's word. Weaker than the sections above, and unavoidably so.
 */
function compareObjectList(s: Subject, mine: Uint8Array): void {
  const list = s.dungeon.objectList;
  check(mine.length === list.length * 2,
    `${s.label}: block 10 is 2 x ObjectListLength (${list.length}) bytes`);

  const theirs = s.bytes.subarray(s.base + s.layout.objectList, s.base + s.layout.objectList + mine.length);
  let wrong = 0;
  let shape = 0;
  let sameBytes = 0;
  for (let i = 0; i < list.length; i++) {
    const our = (mine[i * 2] << 8) | mine[i * 2 + 1];
    const their = (theirs[i * 2] << 8) | theirs[i * 2 + 1];
    if (our === their) sameBytes++;
    // A literal must stay a literal: an encode that mapped a real object onto `RNeof`
    // would resolve back correctly and still corrupt every chain that ends on it.
    if ((our >= RN_LITERAL_FLOOR) !== (their >= RN_LITERAL_FLOOR)) shape++;
    if (resolveOrNull(s.index, our) !== list[i]) wrong++;
  }
  console.log(`    ${'block 10 object list'.padEnd(28)} ${String(mine.length).padStart(6)} b  ` +
    `${list.length} RNs, ${wrong} mis-resolved, ${sameBytes} identical to the file`);
  check(wrong === 0, `${s.label}: block 10 resolves back to the object list, entry for entry (${wrong} wrong)`);
  check(shape === 0, `${s.label}: block 10 writes a literal RNVAL exactly where the file does (${shape} wrong)`);
  if (!s.index) {
    check(sameBytes === list.length,
      `${s.label}: block 10 is the file's own bytes — a packed-RN image needs no index`);
  }
}

function resolveOrNull(index: CsbwinObjectIndex | null, raw: number): number {
  return index ? index.resolve(raw) : raw;
}

/**
 * Block 13. Every byte that is not an RN is compared with the file; every RN is resolved
 * and compared with the reference the reader produced.
 *
 * One class of word is neither, and is exempt by name: **the second RN of a free record**.
 * `DeleteDBEntry` writes `RNnul` over a record's link and frees the indirect slot that
 * named it, but leaves the rest of the record alone (`doc/CSBwin-src/data.cpp:993-1015`),
 * so a deleted record routinely still points its possession or contents chain at a slot
 * that has since been freed or reused.
 * `DungeonLoader.readRNOfRecord` reads those and drops them, because resolving one is
 * meaningless and refusing one would make a perfectly good save unreadable, so the writer
 * has nothing to put back but `RNnul`. CSBWin never looks at them: a free record is
 * reached only by the allocator, which clears it before handing it out. The same
 * treatment `tools/dump-save-blocks-vs-file.ts` gives `TIMER.unused13`.
 */
function compareDatabases(s: Subject, mine: Uint8Array): void {
  const base = s.base + s.layout.databases[0];
  const theirs = s.bytes.subarray(base, base + mine.length);
  check(theirs.length === mine.length, `${s.label}: block 13 fits in the file`);

  const diffs = new Map<string, number>();
  let rnChecked = 0;
  let rnWrong = 0;
  let staleFree = 0;
  let at = 0;

  for (let db = 0; db < 16; db++) {
    const count = s.dungeon.header.objectCounts[db] ?? 0;
    const size = db === DBType.EXPOOL
      ? EXPOOL_RECORD_SIZE
      : databaseRecordSize(db, s.options);
    if (count === 0 || size === 0) continue;
    check(s.base + s.layout.databases[db] === base + at,
      `${s.label}: database ${db} starts where the file puts it`);

    const shape = recordShape(db, s.options.newScrolls, s.options.bigActuators);
    const rnFields = recordRnValues(s.dungeon, db);

    for (let i = 0; i < count; i++) {
      const rec = at + i * size;
      const rnHere = new Set(shape.rnOffsets);

      for (const off of shape.rnOffsets) {
        const our = (mine[rec + off] << 8) | mine[rec + off + 1];
        const expected = rnFields[i]?.[off];
        if (expected === undefined) continue;
        rnChecked++;
        if (resolveOrNull(s.index, our) !== expected) rnWrong++;
        if (off !== 0 && expected === OBJECT_ID_NULL) {
          const their = (theirs[rec + off] << 8) | theirs[rec + off + 1];
          if (their !== our) staleFree++;
        }
      }

      for (let b = 0; b < size; b++) {
        if (rnHere.has(b) || rnHere.has(b - 1)) continue; // the two bytes of an RN word
        if (mine[rec + b] === theirs[rec + b]) continue;
        const f = `db${db} ${fieldAt(shape, b)}`;
        diffs.set(f, (diffs.get(f) ?? 0) + 1);
      }
    }
    at += count * size;
  }

  check(at === mine.length, `${s.label}: block 13 is the sum of its sixteen databases`);

  const all = [...diffs].map(([f, n]) => `${f} (${n})`);
  const summary = all.length > 8 ? `${all.slice(0, 8).join(', ')}, +${all.length - 8} more` : all.join(', ');
  console.log(`    ${'block 13 databases'.padEnd(28)} ${String(mine.length).padStart(6)} b  ` +
    (diffs.size === 0 ? 'identical bar the RNs' : `DIFFERS: ${summary}`) +
    `  [${rnChecked} RNs resolved, ${staleFree} stale refs in freed records]`);
  check(diffs.size === 0, `${s.label}: block 13's non-RN bytes are the file's own${summary ? ` — ${summary}` : ''}`);
  check(rnWrong === 0, `${s.label}: every RN in block 13 resolves back to the record's own reference (${rnWrong} wrong)`);
  check(rnChecked > 0, `${s.label}: block 13 has RNs to check`);
}

/** The RN each record of `db` holds, by byte offset — what our written words must resolve to. */
function recordRnValues(dungeon: DungeonData, db: number): Array<Record<number, number>> {
  const d = dungeon.databases;
  const link = (r: { nextObject: number }) => ({ 0: r.nextObject });
  switch (db) {
    case DBType.DOOR: return d.doors.records.map(link);
    case DBType.TELEPORTER: return d.teleporters.records.map(link);
    case DBType.TEXT: return d.texts.records.map(link);
    case DBType.ACTUATOR: return d.actuators.records.map(link);
    case DBType.WEAPON: return d.weapons.records.map(link);
    case DBType.CLOTHING: return d.clothing.records.map(link);
    case DBType.POTION: return d.potions.records.map(link);
    case DBType.MISC: return d.misc.records.map(link);
    case DBType.CLOUD: return d.clouds.records.map(link);
    case DBType.CREATURE:
      return d.creatures.records.map((r) => ({ 0: r.nextObject, 2: r.possession }));
    case DBType.CHEST:
      return d.containers.records.map((r) => ({ 0: r.nextObject, 2: r.containedObject }));
    case DBType.MISSILE:
      return d.missiles.records.map((r) => ({ 0: r.nextObject, 2: r.projectileObject }));
    case DBType.SCROLL:
      return d.scrolls.records.map((r) => {
        const rn: Record<number, number> = { 0: r.nextObject };
        if (r.textObject !== undefined) rn[2] = r.textObject;
        return rn;
      });
    default: return [];
  }
}

/* --------------------------------------------------------------------------- main --- */

function main(): void {
  /* ---- dungeon.dat, whose header differs from a save's in two words ---- */

  const raw = new Uint8Array(readFileSync(resolve(DUNGEON)));
  // `noConvert`, because this subject's whole point is to write `dungeon.dat`'s own
  // sections back out and compare them with the file. Every other world in this port is
  // converted on load into the shape a save is written in
  // (`src/data/CsbwinDungeonConversions.ts`), which would make the comparison
  // meaningless: the text would be an indirect index, the actuators ten bytes and the
  // scrolls six. `tools/dump-dungeon-conversions.ts` is where the converted form of the
  // same file is checked.
  const dungeon = new DungeonLoader().loadFromArray(raw, { noConvert: true });
  const layout = dungeonDatLayout(raw);
  check(dungeon.maps.length === raw[4], 'dungeon.dat: the loader read every level');
  console.log(`dungeon.dat  (${dungeon.maps.length} levels, cell flags at ${layout.cellFlags})`);
  compare({
    label: 'dungeon.dat', bytes: raw, dungeon, base: 0, layout,
    // `dungeon.dat` stores packed RNs: no indirect index, and the identity for `encode`.
    index: null, encode: (rn) => rn,
    options: { indirectText: false, bigActuators: false, newScrolls: false },
    // It has no Extended Features block, so its own header is the authority:
    // `ReadDatabases` falls back to `LegacyCellFlagArraySize` when `cellflagArraySize`
    // is 0 (`doc/CSBwin-src/SaveGame.cpp:2412-2415`).
    declaredCellFlagSize: dungeon.header.mapDataSize,
    // `dungeon.dat` is not a save and carries no `WriteAndChecksum` word.
    hasChecksum: false,
  });

  /* ---- and every committed save ---- */

  const saves = genuineSaves(process.argv[2]);
  check(saves.length > 0, 'there should be save files to read');
  for (const path of saves) {
    const name = path.split('/').pop() ?? path;
    const bytes = new Uint8Array(readFileSync(path));
    const { dungeon: world, save } = loadCsbwinWorld(bytes);
    const parsed = save.imageLayout!;
    const base = save.dungeonImageOffset!;
    const declared = save.cellFlagArraySize ?? 0;
    const options = {
      indirectText: save.indirectText ?? false,
      bigActuators: save.bigActuators ?? false,
      newScrolls: (save.version ?? 0) >= 0x42,
    };
    const { encode, index } = roundTripIndex(world);
    console.log(`${name}  (image at ${base}, cell flags at ${parsed.cellFlags}, index ${index.length} slots)`);
    compare({
      label: name, bytes, dungeon: world, base, index, encode, options,
      layout: {
        header: 0,
        levelDescriptors: DUNGEON_IMAGE_HEADER_SIZE,
        columnIndex: parsed.columnIndex - base,
        objectList: parsed.objectList - base,
        indirectTextIndex: parsed.text - base,
        text: parsed.text - base + (world.indirectTextIndex?.length ?? 0) * 4,
        databases: parsed.databases.map((o) => o - base),
        cellFlags: parsed.cellFlags - base,
        end: parsed.cellFlags - base + declared,
      },
      declaredCellFlagSize: declared,
      hasChecksum: true,
    });
  }

  finish();
}

main();
