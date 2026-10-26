/**
 * Blocks 7-14 of a CSBWin save: the dungeon image, written.
 *
 * `src/data/CsbwinDungeonImage.ts` is the reader; this is the inverse, block by block,
 * in `SaveGame`'s own write order (`doc/CSBwin-src/SaveGame.cpp:1234-1319`):
 *
 * | # | what | size | written at |
 * | --- | --- | --- | --- |
 * | 7 | `d.dungeonDatIndex` | 44 | `:1236` |
 * | 8 | `d.pLevelDescriptors` | 16 x `NumLevel` | `:1242` |
 * | 9 | `d.objectListIndex` | 2 x `numColumnPointers` | `:1252` |
 * | 10 | `d.objectList` | 2 x `ObjectListLength()` | `:1262` |
 * | 11 | `d.indirectTextIndex` | 4 x `NumWordsInTextArray()` | `:1271` |
 * | 12 | `sizeOfCompressedText` + the text | 4 + 2 x size | `:1280`, `:1286` |
 * | 13 | all sixteen databases | `DBSize(n)` x `dbEntrySizes[n]` | `:1297-1313` |
 * | 14 | `d.cellFlagArray` | `cellflagArraySize` | `:1314` |
 *
 * All eight are written. Four of them — 7, 8, 9 and 14 — hold no object reference and are
 * byte-identical to the file they came from. Blocks 10 and 13 are full of RNs, and an RN
 * in a save is a slot number in an index whose numbering is ours rather than CSBWin's
 * (`src/data/CsbwinObjectIndex.ts`), so those two cannot be byte-identical and are held
 * up against the file a different way — see `tools/checks/dungeon-image-blocks.ts`.
 *
 * Every word is **big-endian**. `SaveGame` runs `DUNGEONDATINDEX::Swap`,
 * `swapLevelDescriptors` and `swapPointer10454` over each section immediately before
 * `WriteAndChecksum` and again immediately after (`:1234-1260`), and those helpers are
 * `LE16` per field — a byte swap on the little-endian build CSBWin ships as. The cell
 * flags are bytes and have no order at all.
 */
import { writeU16BE, writeU32LE } from '../core/bytes';
import { EXPOOL_RECORD_SIZE } from './CsbwinExpool';
import { levelCellOffsets } from './DungeonLoader';
import { dbEntrySize, type DatabaseShape } from './DungeonImageLayout';
import { DBType } from '../core/types';
import type { DungeonData, DungeonHeader, MapData, MapDescriptor } from './dungeonTypes';
import { databaseOf } from './dungeonTypes';
import { databaseCodec } from './DatabaseCodecs';

/** `sizeof(DUNGEONDATINDEX)` — six words plus `dbSizes[16]`. */
export const DUNGEON_IMAGE_HEADER_SIZE = 44;

/** `sizeof(LEVELDESC)`. */
export const LEVEL_DESCRIPTOR_SIZE = 16;

/**
 * Block 7 — `DUNGEONDATINDEX` (`doc/CSBwin-src/CSB.h:2120-2145`), 22 big-endian words.
 *
 * The six named ones are `sentinel`, `word2` (`LegacyCellFlagArraySize`), `word4` (whose
 * **high** byte is `NumLevel` — `BITS8_15(word4)` — and whose low byte CSBWin never
 * names), `word6` (`NumWordsInTextArray`), `word8` (the starting party position) and
 * `word10` (`ObjectListLength`). Then `dbSizes[16]`.
 *
 * `word2` is carried rather than recomputed. In the committed saves it is **0** — the real
 * length lives in the Extended Features block's `cellFlagArraySize`, and `ReadDatabases`
 * falls back to `LegacyCellFlagArraySize` only when that is zero
 * (`doc/CSBwin-src/SaveGame.cpp:2624-2627`) — but a file may fill both, so neither value
 * can be derived from the other.
 */
function buildDungeonImageHeader(header: DungeonHeader): Uint8Array {
    const buf = new Uint8Array(DUNGEON_IMAGE_HEADER_SIZE);
    writeU16BE(buf, 0, header.randomSeed);
    writeU16BE(buf, 2, header.mapDataSize);
    writeU16BE(buf, 4, ((header.numMaps & 0xff) << 8) | (header.word4Low & 0xff));
    writeU16BE(buf, 6, header.textDataSize);
    writeU16BE(
        buf, 8,
        ((header.facing & 0x03) << 10) |
        ((header.startPosition.y & 0x1f) << 5) |
        (header.startPosition.x & 0x1f),
    );
    writeU16BE(buf, 10, header.objectListSize);
    for (let i = 0; i < 16; i++) writeU16BE(buf, 12 + i * 2, header.objectCounts[i] ?? 0);
    return buf;
}

/** Block 8 — `LEVELDESC[NumLevel]`, the inverse of `DungeonLoader.parseMapDescriptors`. */
function buildLevelDescriptors(descriptors: readonly MapDescriptor[]): Uint8Array {
    const buf = new Uint8Array(descriptors.length * LEVEL_DESCRIPTOR_SIZE);
    descriptors.forEach((d, i) => {
        const at = i * LEVEL_DESCRIPTOR_SIZE;
        writeU16BE(buf, at, d.dataOffset);
        for (let b = 0; b < 4; b++) buf[at + 2 + b] = (d.fill2[b] ?? 0) & 0xff;
        buf[at + 6] = d.offsetX & 0xff;
        buf[at + 7] = d.offsetY & 0xff;
        // word8: bits 11-15 rows-1, 6-10 columns-1, 0-5 level.
        writeU16BE(
            buf, at + 8,
            (((d.height - 1) & 0x1f) << 11) | (((d.width - 1) & 0x1f) << 6) | (d.level & 0x3f),
        );
        // word10: 12-15 random floor decorations, 8-11 floor decorations,
        // 4-7 random wall decorations, 0-3 wall decorations. This port's names for the
        // four are `floorDecorationCount`, `floorGraphicsCount`, `wallDecorationCount`
        // and `wallGraphicsCount`, in that order.
        writeU16BE(
            buf, at + 10,
            ((d.floorDecorationCount & 0xf) << 12) | ((d.floorGraphicsCount & 0xf) << 8) |
            ((d.wallDecorationCount & 0xf) << 4) | (d.wallGraphicsCount & 0xf),
        );
        // word12: 12-15 experience multiplier, 8-11 unnamed, 4-7 monster types,
        // 0-3 door decorations.
        writeU16BE(
            buf, at + 12,
            ((d.difficulty & 0xf) << 12) | ((d.word12Bits8_11 & 0xf) << 8) |
            ((d.creatureTypesAllowed & 0xf) << 4) | (d.doorDecorationCount & 0xf),
        );
        // word14: 12-15 door type 2, 8-11 door type 1, 4-7 wall graphic set,
        // 0-3 background graphic set.
        writeU16BE(
            buf, at + 14,
            ((d.doorType1Index & 0xf) << 12) | ((d.doorType0Index & 0xf) << 8) |
            ((d.mapGraphicsStyle & 0xf) << 4) | (d.floorCeilingStyle & 0xf),
        );
    });
    return buf;
}

/**
 * Block 9 — `d.objectListIndex`, one big-endian word per column of every level.
 *
 * It is saved state and not dungeon structure: `DungeonState.addObjectToCell` and
 * `removeObjectFromCell` rewrite every later entry whenever a cell gains or loses its
 * last object, as CSBWin does (`doc/CSBwin-src/CSBCode.cpp:5276-5289`), which is why
 * CSBWin writes the array into the save beside the object list
 * (`doc/PROVEN_FACTS.md` → "The column index is saved state, not dungeon structure").
 */
function buildColumnIndex(columnIndex: readonly number[]): Uint8Array {
    const buf = new Uint8Array(columnIndex.length * 2);
    for (let i = 0; i < columnIndex.length; i++) writeU16BE(buf, i * 2, columnIndex[i]! & 0xffff);
    return buf;
}

/**
 * How long block 14 is: the far end of the last level's per-level tables.
 *
 * Each level's cells start at its own `LEVELDESC.cellOffset`, unwrapped
 * (`levelCellOffsets`), and are followed
 * immediately by four tables whose lengths the descriptor gives — the monster types,
 * then the wall, floor and door decoration tables, in that order
 * (`SetPartyLevel`, `doc/CSBwin-src/CSBCode.cpp:5843+`). Measured on `dungeon.dat` and on
 * every committed save this lands on 12366, which is exactly what `dungeon.dat`'s
 * `LegacyCellFlagArraySize` and the saves' `cellFlagArraySize` both say.
 */
export function cellFlagArraySize(maps: readonly MapData[]): number {
    const cellOffsets = levelCellOffsets(maps.map((map) => map.descriptor));
    let end = 0;
    maps.forEach((map, level) => {
        end = Math.max(end, cellOffsets[level]! + mapCellFlagLength(map));
    });
    return end;
}

function mapCellFlagLength(map: MapData): number {
    const { width, height } = map.descriptor;
    return width * height +
        (map.monsterTypes?.length ?? 0) +
        (map.wallDecorationTOC?.length ?? 0) +
        (map.floorDecorationTOC?.length ?? 0) +
        (map.doorDecorationTOC?.length ?? 0);
}

/**
 * Block 14 — `d.cellFlagArray`, one byte per cell in `[x][y]` order, each level at its
 * descriptor's `cellOffset` unwrapped (`levelCellOffsets`), each followed by its four
 * per-level tables.
 *
 * The size is the caller's, not this function's, because the Extended Features block
 * declares it and the two must agree; `cellFlagArraySize` computes the value to declare.
 */
export function buildCellFlagArray(maps: readonly MapData[], size: number): Uint8Array {
    const buf = new Uint8Array(size);
    const cellOffsets = levelCellOffsets(maps.map((map) => map.descriptor));
    maps.forEach((map, level) => {
        let at = cellOffsets[level]!;
        const { width, height } = map.descriptor;
        if (at + mapCellFlagLength(map) > size) {
            throw new Error(
                `level ${map.descriptor.level} runs past the ${size}-byte cell flag array`,
            );
        }
        for (let x = 0; x < width; x++) {
            const flags = map.cellFlags[x]!;
            for (let y = 0; y < height; y++) buf[at++] = flags[y]! & 0xff;
        }
        for (const table of [
            map.monsterTypes, map.wallDecorationTOC, map.floorDecorationTOC, map.doorDecorationTOC,
        ]) {
            for (const value of table ?? []) buf[at++] = value & 0xff;
        }
    });
    return buf;
}

/**
 * Block 10 — `d.objectList`, `ObjectListLength` big-endian words, every one an RN.
 *
 * There is nothing else in the section: the per-cell chains *are* this array, indexed
 * through block 9's column index, and each entry either names an object or is one of the
 * `RNVAL` literals (`RNeof` 0xfffe closes a chain, `RNnul` 0xffff is nothing).
 *
 * An RN is written as the world holds it: a slot of its object indirect index
 * (`src/data/CsbwinObjectIndex.ts`), or a packed RN for a world read without its
 * conversions (`DungeonImageOptions.noConvert`).
 */
function buildObjectList(objectList: readonly number[]): Uint8Array {
    const buf = new Uint8Array(objectList.length * 2);
    for (let i = 0; i < objectList.length; i++) writeU16BE(buf, i * 2, objectList[i]! & 0xffff);
    return buf;
}

/**
 * Block 11 — `d.indirectTextIndex`, `NumWordsInTextArray` **little-endian** longwords.
 *
 * Little-endian alone in a big-endian image: `SwapIndirectTextIndex` applies `BE32`
 * (`doc/CSBwin-src/SaveGame.cpp:175-182`), which is the identity on the little-endian
 * build CSBWin ships as, so the array keeps native PC order. Each entry is a word offset
 * into the compressed text.
 *
 * `NumWordsInTextArray` — header `word6` — counts **index entries** here, not text words:
 * `ConvertToIndirectText` overwrites it with the index length when it converts
 * (`doc/CSBwin-src/SaveGame.cpp:2486`). That is why a save says 125 where `dungeon.dat`
 * says 1749.
 */
function buildIndirectTextIndex(indirectTextIndex: readonly number[]): Uint8Array {
    const buf = new Uint8Array(indirectTextIndex.length * 4);
    for (let i = 0; i < indirectTextIndex.length; i++) writeU32LE(buf, i * 4, indirectTextIndex[i]! >>> 0);
    return buf;
}

/**
 * Block 12 — `d.sizeOfCompressedText` then the text itself.
 *
 * The size is one **little-endian** longword, for the same reason as block 11: it goes
 * out through `BE32` (`doc/CSBwin-src/SaveGame.cpp:1279-1284`). The text words that
 * follow are written with **no swap at all** (`:1289-1292`) — they are the Atari-era 5-bit
 * text array, which is never swapped on the way in either, so they are big-endian in
 * memory and big-endian in the file.
 */
function buildCompressedText(compressedText: readonly number[]): Uint8Array {
    const buf = new Uint8Array(4 + compressedText.length * 2);
    writeU32LE(buf, 0, compressedText.length >>> 0);
    for (let i = 0; i < compressedText.length; i++) writeU16BE(buf, 4 + i * 2, compressedText[i]! & 0xffff);
    return buf;
}

/**
 * The raw text section of a `dungeon.dat`, which has no indirect index: `textDataSize`
 * big-endian words, and no size longword in front of them.
 *
 * `ConvertToIndirectText` is what turns this into blocks 11 and 12, and it runs once when
 * an original dungeon is read (`doc/CSBwin-src/SaveGame.cpp:2433-2488`), so no save ever
 * carries this form. It is here so that the writer is the exact inverse of the reader on
 * both kinds of image, which is what lets `dungeon.dat` be a test case.
 */
function buildTextWords(textWords: readonly number[]): Uint8Array {
    const buf = new Uint8Array(textWords.length * 2);
    for (let i = 0; i < textWords.length; i++) writeU16BE(buf, i * 2, textWords[i]! & 0xffff);
    return buf;
}

/** How the databases of the image being written differ from a plain `dungeon.dat`. */
type DatabaseWriteOptions = Pick<DatabaseShape, 'bigActuators' | 'newScrolls'>;


/**
 * Block 13 — all sixteen databases, back to back, in `DBType` order
 * (`doc/CSBwin-src/SaveGame.cpp:1297-1313`).
 *
 * Each record goes out through its database's codec (`src/data/DatabaseCodecs.ts`), the
 * inverse of the one `DungeonLoader` reads it with.
 *
 * Three of the sixteen have no codec:
 *
 * - **11, `EXPOOL`.** Written from `dungeon.expool`, the blocks the world holds. The key
 *   of each champion bones record is the bones' RN (`src/data/CsbwinExpool.ts`). The DSA
 *   global variables and the 24 overlay palette records are written into it just before
 *   the image, as `SaveGame` does (`doc/CSBwin-src/SaveGame.cpp:1206-1231`, `src/engine/SaveGameFile.ts`).
 * - **12 and 13**, which `CSB.h` marks `//Not used`. Empty in every file here.
 */
function buildDatabases(
    dungeon: DungeonData,
    options: DatabaseWriteOptions = {},
): Uint8Array {
    const sections: Uint8Array[] = [];
    for (let db = 0; db < 16; db++) sections.push(buildDatabase(dungeon, db, options));
    const total = sections.reduce((n, s) => n + s.length, 0);
    const buf = new Uint8Array(total);
    let at = 0;
    for (const section of sections) { buf.set(section, at); at += section.length; }
    return buf;
}

/** One database's records. */
function buildDatabase(
    dungeon: DungeonData,
    db: number,
    options: DatabaseWriteOptions = {},
): Uint8Array {
    const size = dbEntrySize(db, options);
    const declared = dungeon.header.objectCounts[db] ?? 0;

    if (db === DBType.EXPOOL) {
        const expool = dungeon.expool ?? new Uint8Array(0);
        if (expool.length !== declared * EXPOOL_RECORD_SIZE) {
            throw new Error(
                `EXPOOL is ${expool.length} bytes, the header declares ` +
                `${declared} records (${declared * EXPOOL_RECORD_SIZE} bytes)`,
            );
        }
        return expool.slice();
    }
    if (size === 0 || declared === 0) {
        if (declared !== 0) {
            throw new Error(`database ${db} declares ${declared} records and has no record size`);
        }
        return new Uint8Array(0);
    }

    const database = databaseOf(dungeon.databases, db as DBType);
    const codec = databaseCodec(db as DBType);
    if (!database || !codec) throw new Error(`database ${db} has no records in this port`);
    const records = database.records;
    if (records.length !== declared) {
        throw new Error(
            `database ${db} holds ${records.length} records, the header declares ${declared}`,
        );
    }

    const buf = new Uint8Array(declared * size);
    for (let i = 0; i < declared; i++) codec.write(buf, i * size, records[i]!, options);
    return buf;
}

/** Every section of the image, in file order. Blocks 7-14. */
interface DungeonImageSections {
    /** Block 7 — `DUNGEONDATINDEX`, 44 bytes. */
    header: Uint8Array;
    /** Block 8 — `LEVELDESC[NumLevel]`. */
    levelDescriptors: Uint8Array;
    /** Block 9 — `d.objectListIndex`. */
    columnIndex: Uint8Array;
    /** Block 10 — `d.objectList`. */
    objectList: Uint8Array;
    /** Block 11 — `d.indirectTextIndex`. Empty on an image with raw text. */
    indirectTextIndex: Uint8Array;
    /**
     * Block 12 — the text. `sizeOfCompressedText` and the compressed words on a save;
     * on a `dungeon.dat` the raw text array, with no size longword in front of it.
     */
    text: Uint8Array;
    /** Block 13 — all sixteen databases. */
    databases: Uint8Array;
    /** Block 14 — `d.cellFlagArray`. */
    cellFlags: Uint8Array;
}

/** How the image being written differs from a plain `dungeon.dat`. */
interface DungeonImageWriteOptions extends DatabaseWriteOptions {
    /** The text section is an indirect index plus compressed text. Saves only. */
    indirectText?: boolean;
}

/** Blocks 7-14 of one dungeon, each as its own byte range. */
export function buildDungeonImageSections(
    dungeon: DungeonData,
    options: DungeonImageWriteOptions = {},
): DungeonImageSections {
    const size = cellFlagArraySize(dungeon.maps);
    return {
        header: buildDungeonImageHeader(dungeon.header),
        levelDescriptors: buildLevelDescriptors(dungeon.maps.map((m) => m.descriptor)),
        columnIndex: buildColumnIndex(dungeon.columnIndex),
        objectList: buildObjectList(dungeon.objectList),
        indirectTextIndex: options.indirectText
            ? buildIndirectTextIndex(dungeon.indirectTextIndex ?? [])
            : new Uint8Array(0),
        text: options.indirectText
            ? buildCompressedText(dungeon.compressedText ?? [])
            : buildTextWords(dungeon.textWords ?? []),
        databases: buildDatabases(dungeon, options),
        cellFlags: buildCellFlagArray(dungeon.maps, size),
    };
}

/** The eight sections in file order. */
export function dungeonImageSectionList(sections: DungeonImageSections): Uint8Array[] {
    return [
        sections.header, sections.levelDescriptors, sections.columnIndex, sections.objectList,
        sections.indirectTextIndex, sections.text, sections.databases, sections.cellFlags,
    ];
}

/** Blocks 7-14 as one contiguous run of bytes — the whole dungeon image. */
export function buildDungeonImage(
    dungeon: DungeonData,
    options: DungeonImageWriteOptions = {},
): Uint8Array {
    const parts = dungeonImageSectionList(buildDungeonImageSections(dungeon, options));
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
}

/**
 * Block 15 — the one word that closes the file.
 *
 * `WriteAndChecksum` sums the **bytes** of each section it writes into a `ui16` starting
 * from zero and adds that into a running total (`doc/CSBwin-src/SaveGame.cpp:687-706`),
 * which is the same thing as summing every byte of blocks 7-14 into a `ui16`. The word
 * is then written through `LE16` (`:1318-1320`) — a byte swap on the little-endian build
 * — so it lands **big-endian**, like the rest of the image.
 *
 * Nothing before block 7 is in it: the running total is set to 0 immediately after the
 * EXPOOL side-writes and just before the header goes out (`:1234`).
 */
export function buildImageChecksum(image: Uint8Array): Uint8Array {
    let sum = 0;
    for (let i = 0; i < image.length; i++) sum = (sum + image[i]!) & 0xffff;
    const buf = new Uint8Array(2);
    writeU16BE(buf, 0, sum);
    return buf;
}
