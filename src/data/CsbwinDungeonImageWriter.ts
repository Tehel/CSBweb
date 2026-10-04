/**
 * Blocks 7-14 of a CSBWin save: the dungeon image, written.
 *
 * `src/data/CsbwinDungeonImage.ts` is the reader; this is the inverse, block by block,
 * in `SaveGame`'s own write order (`doc/CSBwin-src/SaveGame.cpp:1166-1221`):
 *
 * | # | what | size | written at |
 * | --- | --- | --- | --- |
 * | 7 | `d.dungeonDatIndex` | 44 | `:1168` |
 * | 8 | `d.pLevelDescriptors` | 16 x `NumLevel` | `:1173` |
 * | 9 | `d.objectListIndex` | 2 x `numColumnPointers` | `:1178` |
 * | 10 | `d.objectList` | 2 x `ObjectListLength()` | `:1183` |
 * | 11 | `d.indirectTextIndex` | 4 x `NumWordsInTextArray()` | `:1188` |
 * | 12 | `sizeOfCompressedText` + the text | 4 + 2 x size | `:1193`, `:1197` |
 * | 13 | all sixteen databases | `DBSize(n)` x `dbEntrySizes[n]` | `:1203-1215` |
 * | 14 | `d.cellFlagArray` | `cellflagArraySize` | `:1216` |
 *
 * All eight are written. Four of them — 7, 8, 9 and 14 — hold no object reference and are
 * byte-identical to the file they came from. Blocks 10 and 13 are full of RNs, and an RN
 * in a save is a slot number in an index whose numbering is ours rather than CSBWin's
 * (`src/data/CsbwinObjectIndex.ts`), so those two cannot be byte-identical and are held
 * up against the file a different way — see `tools/dump-dungeon-image-blocks.ts`.
 *
 * Every word is **big-endian**. `SaveGame` runs `DUNGEONDATINDEX::Swap`,
 * `swapLevelDescriptors` and `swapPointer10454` over each section immediately before
 * `WriteAndChecksum` and again immediately after (`:1166-1181`), and those helpers are
 * `LE16` per field — a byte swap on the little-endian build CSBWin ships as. The cell
 * flags are bytes and have no order at all.
 */
import { writeU16BE, writeU32LE } from '../core/bytes';
import { EXPOOL_RECORD_SIZE } from './CsbwinExpool';
import { DBType, OBJECT_ID_NULL } from '../core/types';
import type {
    ActuatorRecord, ClothingRecord, CloudRecord, ContainerRecord, CreatureRecord, DatabaseRecord,
    DoorRecord, DungeonData, DungeonHeader, MapData, MapDescriptor, MiscRecord,
    MissileRecord, PotionRecord, ScrollRecord, TeleporterRecord, TextRecord, WeaponRecord,
} from './dungeonTypes';

/** `sizeof(DUNGEONDATINDEX)` — six words plus `dbSizes[16]`. */
export const DUNGEON_IMAGE_HEADER_SIZE = 44;

/** `sizeof(LEVELDESC)`. */
export const LEVEL_DESCRIPTOR_SIZE = 16;

const bit = (b: boolean | undefined): number => (b ? 1 : 0);

/**
 * Block 7 — `DUNGEONDATINDEX` (`doc/CSBwin-src/CSB.h:2057-2082`), 22 big-endian words.
 *
 * The six named ones are `sentinel`, `word2` (`LegacyCellFlagArraySize`), `word4` (whose
 * **high** byte is `NumLevel` — `BITS8_15(word4)` — and whose low byte CSBWin never
 * names), `word6` (`NumWordsInTextArray`), `word8` (the starting party position) and
 * `word10` (`ObjectListLength`). Then `dbSizes[16]`.
 *
 * `word2` is carried rather than recomputed. In the committed saves it is **0** — the real
 * length lives in the Extended Features block's `cellFlagArraySize`, and `ReadDatabases`
 * falls back to `LegacyCellFlagArraySize` only when that is zero
 * (`doc/CSBwin-src/SaveGame.cpp:2412-2415`) — but a file may fill both, so neither value
 * can be derived from the other.
 */
export function buildDungeonImageHeader(header: DungeonHeader): Uint8Array {
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
export function buildLevelDescriptors(descriptors: readonly MapDescriptor[]): Uint8Array {
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
 * last object, as CSBWin does (`doc/CSBwin-src/CSBCode.cpp:5211-5224`), which is why
 * CSBWin writes the array into the save beside the object list
 * (`doc/PROVEN_FACTS.md` → "The column index is saved state, not dungeon structure").
 */
export function buildColumnIndex(columnIndex: readonly number[]): Uint8Array {
    const buf = new Uint8Array(columnIndex.length * 2);
    for (let i = 0; i < columnIndex.length; i++) writeU16BE(buf, i * 2, columnIndex[i] & 0xffff);
    return buf;
}

/**
 * How long block 14 is: the far end of the last level's per-level tables.
 *
 * Each level's cells start at its own `LEVELDESC.cellOffset` and are followed
 * immediately by four tables whose lengths the descriptor gives — the monster types,
 * then the wall, floor and door decoration tables, in that order
 * (`SetPartyLevel`, `doc/CSBwin-src/CSBCode.cpp:5778+`). Measured on `dungeon.dat` and on
 * every committed save this lands on 12366, which is exactly what `dungeon.dat`'s
 * `LegacyCellFlagArraySize` and the saves' `cellFlagArraySize` both say.
 */
export function cellFlagArraySize(maps: readonly MapData[]): number {
    let end = 0;
    for (const map of maps) {
        end = Math.max(end, map.descriptor.dataOffset + mapCellFlagLength(map));
    }
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
 * descriptor's `cellOffset`, each followed by its four per-level tables.
 *
 * The size is the caller's, not this function's, because the Extended Features block
 * declares it and the two must agree; `cellFlagArraySize` computes the value to declare.
 */
export function buildCellFlagArray(maps: readonly MapData[], size: number): Uint8Array {
    const buf = new Uint8Array(size);
    for (const map of maps) {
        let at = map.descriptor.dataOffset;
        const { width, height } = map.descriptor;
        if (at + mapCellFlagLength(map) > size) {
            throw new Error(
                `level ${map.descriptor.level} runs past the ${size}-byte cell flag array`,
            );
        }
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) buf[at++] = map.cellFlags[x][y] & 0xff;
        }
        for (const table of [
            map.monsterTypes, map.wallDecorationTOC, map.floorDecorationTOC, map.doorDecorationTOC,
        ]) {
            for (const value of table ?? []) buf[at++] = value & 0xff;
        }
    }
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
export function buildObjectList(objectList: readonly number[]): Uint8Array {
    const buf = new Uint8Array(objectList.length * 2);
    for (let i = 0; i < objectList.length; i++) writeU16BE(buf, i * 2, objectList[i] & 0xffff);
    return buf;
}

/**
 * Block 11 — `d.indirectTextIndex`, `NumWordsInTextArray` **little-endian** longwords.
 *
 * Little-endian alone in a big-endian image: `SwapIndirectTextIndex` applies `BE32`
 * (`doc/CSBwin-src/SaveGame.cpp:174-181`), which is the identity on the little-endian
 * build CSBWin ships as, so the array keeps native PC order. Each entry is a word offset
 * into the compressed text.
 *
 * `NumWordsInTextArray` — header `word6` — counts **index entries** here, not text words:
 * `ConvertToIndirectText` overwrites it with the index length when it converts
 * (`doc/CSBwin-src/SaveGame.cpp:2274`). That is why a save says 125 where `dungeon.dat`
 * says 1749.
 */
export function buildIndirectTextIndex(indirectTextIndex: readonly number[]): Uint8Array {
    const buf = new Uint8Array(indirectTextIndex.length * 4);
    for (let i = 0; i < indirectTextIndex.length; i++) writeU32LE(buf, i * 4, indirectTextIndex[i] >>> 0);
    return buf;
}

/**
 * Block 12 — `d.sizeOfCompressedText` then the text itself.
 *
 * The size is one **little-endian** longword, for the same reason as block 11: it goes
 * out through `BE32` (`doc/CSBwin-src/SaveGame.cpp:1192-1194`). The text words that
 * follow are written with **no swap at all** (`:1197`) — they are the Atari-era 5-bit
 * text array, which is never swapped on the way in either, so they are big-endian in
 * memory and big-endian in the file.
 */
export function buildCompressedText(compressedText: readonly number[]): Uint8Array {
    const buf = new Uint8Array(4 + compressedText.length * 2);
    writeU32LE(buf, 0, compressedText.length >>> 0);
    for (let i = 0; i < compressedText.length; i++) writeU16BE(buf, 4 + i * 2, compressedText[i] & 0xffff);
    return buf;
}

/**
 * The raw text section of a `dungeon.dat`, which has no indirect index: `textDataSize`
 * big-endian words, and no size longword in front of them.
 *
 * `ConvertToIndirectText` is what turns this into blocks 11 and 12, and it runs once when
 * an original dungeon is read (`doc/CSBwin-src/SaveGame.cpp:2221-2276`), so no save ever
 * carries this form. It is here so that the writer is the exact inverse of the reader on
 * both kinds of image, which is what lets `dungeon.dat` be a test case.
 */
export function buildTextWords(textWords: readonly number[]): Uint8Array {
    const buf = new Uint8Array(textWords.length * 2);
    for (let i = 0; i < textWords.length; i++) writeU16BE(buf, i * 2, textWords[i] & 0xffff);
    return buf;
}

/** How the databases of the image being written differ from a plain `dungeon.dat`. */
export interface DatabaseWriteOptions {
    /** ACTUATOR records are 10 bytes, not 8 (`MakeBigActuators`). */
    bigActuators?: boolean;
    /** SCROLL records are 6 bytes with an RN text reference, not 4 with a 10-bit index. */
    newScrolls?: boolean;
}

/**
 * `dbEntrySizes` (`doc/CSBwin-src/SaveGame.cpp:2571-2575` for the ACTUATOR special case,
 * `:2189-2200` for SCROLL). Databases 12 and 13 are `//Not used` in `CSB.h` and have no
 * record size; both are empty in every file this project holds.
 */
export function databaseRecordSize(db: number, options: DatabaseWriteOptions = {}): number {
    const sizes = [4, 6, 4, 8, 16, 4, 4, 4, 4, 8, 4, EXPOOL_RECORD_SIZE, 0, 0, 8, 4];
    if (db === DBType.ACTUATOR && options.bigActuators) return 10;
    if (db === DBType.SCROLL && options.newScrolls) return 6;
    return sizes[db] ?? 0;
}

/**
 * Block 13 — all sixteen databases, back to back, in `DBType` order
 * (`doc/CSBwin-src/SaveGame.cpp:1203-1215`).
 *
 * This is the inverse of `DungeonLoader`'s thirteen record parsers, field for field and
 * bit for bit against the `DBn` classes in `doc/CSBwin-src/CSB.h:818-1345`. Writing it
 * is what found the bits those parsers were dropping — the door's `word2` bits 9-15, the
 * chest's whole `word4` and its two trailing bytes, the misc item's `cursed` and
 * `subType`, the new scroll's uninitialised `word4` debris, and four more; all are
 * carried on the record now and named in `src/data/dungeonTypes.ts`.
 *
 * Three of the sixteen have no record parser:
 *
 * - **11, `EXPOOL`.** Written from `dungeon.expool`, the blocks the world holds. The key
 *   of each champion bones record is the bones' RN (`src/data/CsbwinExpool.ts`). The DSA
 *   global variables and the 24 overlay palette records are written into it just before
 *   the image, as `SaveGame` does (`:1141-1164`, `src/engine/SaveGameFile.ts`).
 * - **12 and 13**, which `CSB.h` marks `//Not used`. Empty in every file here.
 */
export function buildDatabases(
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

/** One database's records. Exported so a tool can compare them a section at a time. */
export function buildDatabase(
    dungeon: DungeonData,
    db: number,
    options: DatabaseWriteOptions = {},
): Uint8Array {
    const size = databaseRecordSize(db, options);
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

    const records = databaseRecords(dungeon, db);
    if (records.length !== declared) {
        throw new Error(
            `database ${db} holds ${records.length} records, the header declares ${declared}`,
        );
    }

    const buf = new Uint8Array(declared * size);
    for (let i = 0; i < declared; i++) {
        writeRecord(buf, i * size, db, records[i], options);
    }
    return buf;
}

/** The records of one database, by `DBType`, or `null` for the three with no parser. */
function databaseRecords(dungeon: DungeonData, db: number): DatabaseRecord[] {
    const d = dungeon.databases;
    switch (db) {
        case DBType.DOOR: return d.doors.records;
        case DBType.TELEPORTER: return d.teleporters.records;
        case DBType.TEXT: return d.texts.records;
        case DBType.ACTUATOR: return d.actuators.records;
        case DBType.CREATURE: return d.creatures.records;
        case DBType.WEAPON: return d.weapons.records;
        case DBType.CLOTHING: return d.clothing.records;
        case DBType.SCROLL: return d.scrolls.records;
        case DBType.POTION: return d.potions.records;
        case DBType.CHEST: return d.containers.records;
        case DBType.MISC: return d.misc.records;
        case DBType.MISSILE: return d.missiles.records;
        case DBType.CLOUD: return d.clouds.records;
        default: throw new Error(`database ${db} has no records in this port`);
    }
}

/**
 * One record, at `at`. Each branch is the exact inverse of the matching
 * `DungeonLoader.parse*Database` and of the `DBn` bitfield comments in `CSB.h`.
 *
 * A **free** record's secondary RN — a creature's possessions, a chest's contents, a
 * missile's flying object, a scroll's text — cannot be reproduced, and deliberately so:
 * `DeleteDBEntry` writes `RNnul` over the link and frees the indirect slot but leaves the
 * rest of the record alone (`doc/CSBwin-src/data.cpp:993-1015`), so a free record
 * routinely still points at a slot that has since been freed. `readRNOfRecord` reads
 * those and drops them, which is the only reading that does not make a perfectly good
 * save unreadable, and this writes `RNnul` back where the file holds the stale slot.
 * `tools/dump-dungeon-image-blocks.ts` exempts exactly those words, by name.
 */
function writeRecord(
    buf: Uint8Array,
    at: number,
    db: number,
    record: DatabaseRecord,
    options: DatabaseWriteOptions,
): void {
    const link = (record as { nextObject: number }).nextObject;
    writeU16BE(buf, at, link & 0xffff);

    switch (db) {
        case DBType.DOOR: {
            const r = record as DoorRecord;
            // `DB0::word2` (`doc/CSBwin-src/CSB.h:822-845`).
            writeU16BE(buf, at + 2,
                ((r.word2Bits9_15 ?? 0) << 9) | (bit(r.destructibleByChop) << 8) |
                (bit(r.destructibleByFireball) << 7) | (bit(r.hasButton) << 6) |
                (bit(r.vertical) << 5) | ((r.ornateNumber & 0xf) << 1) | (r.doorType & 1));
            return;
        }
        case DBType.TELEPORTER: {
            const r = record as TeleporterRecord;
            // `DB1::word2` and `word4` (`doc/CSBwin-src/CSB.h:849-895`).
            writeU16BE(buf, at + 2,
                (bit(r.sound) << 15) | ((r.scope & 3) << 13) | (bit(r.absoluteRotation) << 12) |
                ((r.rotation & 3) << 10) | ((r.destY & 0x1f) << 5) | (r.destX & 0x1f));
            writeU16BE(buf, at + 4, ((r.destMap & 0xff) << 8) | (r.word4Low ?? 0));
            return;
        }
        case DBType.TEXT: {
            const r = record as TextRecord;
            // `DB2::word2` — `index()` is bits 3-15, `show()` bit 0
            // (`doc/CSBwin-src/CSB.h:988-1002`).
            writeU16BE(buf, at + 2,
                ((r.textOffset & 0x1fff) << 3) | ((r.word2Bits1_2 ?? 0) << 1) | bit(r.visible));
            return;
        }
        case DBType.ACTUATOR: {
            const r = record as ActuatorRecord;
            // `DB3` keeps all four words raw here; every accessor is a bitfield of them.
            writeU16BE(buf, at + 2, r.word2 & 0xffff);
            writeU16BE(buf, at + 4, r.word4 & 0xffff);
            writeU16BE(buf, at + 6, r.word6 & 0xffff);
            if (options.bigActuators) writeU16BE(buf, at + 8, (r.word8 ?? 0) & 0xffff);
            return;
        }
        case DBType.CREATURE: {
            const r = record as CreatureRecord;
            // `DB4` (`doc/CSBwin-src/CSB.h:1075-1139`).
            writeU16BE(buf, at + 2, writtenSecondary(r.possession, link));
            buf[at + 4] = ((r.alternateGraphics & 7) << 5) | (r.creatureType & 0x1f);
            buf[at + 5] = r.groupIndex & 0xff;
            for (let h = 0; h < 4; h++) writeU16BE(buf, at + 6 + h * 2, (r.hp[h] ?? 0) & 0xffff);
            writeU16BE(buf, at + 14,
                ((r.word14Bit15 ?? 0) << 15) | (bit(r.poisoned) << 14) | (bit(r.unique) << 13) |
                (bit(r.drawAsSize4) << 12) | (bit(r.invisible) << 11) | (bit(r.important) << 10) |
                ((r.facing & 3) << 8) | ((r.word14Bit7 ?? 0) << 7) | ((r.numMonM1 & 3) << 5) |
                ((r.word14Bit4 ?? 0) << 4) | (r.fear & 0xf));
            return;
        }
        case DBType.WEAPON: {
            const r = record as WeaponRecord;
            // `DB5::word2` (`doc/CSBwin-src/CSB.h:1141-1174`).
            writeU16BE(buf, at + 2,
                (bit(r.litTorch) << 15) | (bit(r.broken) << 14) | ((r.charges & 0xf) << 10) |
                (bit(r.poisoned) << 9) | (bit(r.cursed) << 8) | (bit(r.important) << 7) |
                (r.weaponType & 0x7f));
            return;
        }
        case DBType.CLOTHING: {
            const r = record as ClothingRecord;
            // `DB6::word2` (`doc/CSBwin-src/CSB.h:1176-1192`).
            writeU16BE(buf, at + 2,
                ((r.word2Bits14_15 ?? 0) << 14) | (bit(r.broken) << 13) | ((r.charges & 0xf) << 9) |
                (bit(r.cursed) << 8) | (bit(r.important) << 7) | (r.clothingType & 0x7f));
            return;
        }
        case DBType.SCROLL: {
            const r = record as ScrollRecord;
            if (options.newScrolls) {
                // `DB7` in its six-byte form: link, an RN to the text record, then a word
                // whose bit 0 is `open` (`doc/CSBwin-src/CSB.h:1195-1216`). The text RN
                // is a secondary reference and follows the free-record rule above.
                const text = r.textObject;
                if (text === undefined) throw new Error('a four-byte scroll cannot be written as a six-byte one');
                writeU16BE(buf, at + 2, writtenSecondary(text, link));
                writeU16BE(buf, at + 4, ((r.word4Bits1_15 ?? 0) << 1) | bit(r.open));
                return;
            }
            // The four-byte form: bits 0-9 a text index, 10-15 the `b10_15()` the new
            // form's `open` was derived from.
            writeU16BE(buf, at + 2,
                ((r.word2Bits10_15 ?? (r.open ? 0 : 1)) << 10) | (r.textReference & 0x3ff));
            return;
        }
        case DBType.POTION: {
            const r = record as PotionRecord;
            // `DB8::word2` (`doc/CSBwin-src/CSB.h:1218-1234`).
            writeU16BE(buf, at + 2,
                (bit(r.important) << 15) | ((r.potionType & 0x7f) << 8) | (r.power & 0xff));
            return;
        }
        case DBType.CHEST: {
            const r = record as ContainerRecord;
            // `DB9` (`doc/CSBwin-src/CSB.h:1236-1250`): link, contents, `m_word4`,
            // `m_uByte6[2]`. `containerType` is bits 1-2 of `m_word4`; the rest of that
            // word is carried, because it is not zero and CSBWin names none of it.
            writeU16BE(buf, at + 2, writtenSecondary(r.containedObject, link));
            writeU16BE(buf, at + 4, (r.word4 ?? ((r.containerType & 3) << 1)) & 0xffff);
            buf[at + 6] = (r.uByte6?.[0] ?? 0) & 0xff;
            buf[at + 7] = (r.uByte6?.[1] ?? 0) & 0xff;
            return;
        }
        case DBType.MISC: {
            const r = record as MiscRecord;
            // `DB10::word2` (`doc/CSBwin-src/CSB.h:1265-1305`).
            writeU16BE(buf, at + 2,
                ((r.specialState & 3) << 14) | ((r.subType ?? 0) << 9) | (bit(r.cursed) << 8) |
                (bit(r.important) << 7) | (r.miscType & 0x7f));
            return;
        }
        case DBType.MISSILE: {
            const r = record as MissileRecord;
            // `DB14` (`doc/CSBwin-src/CSB.h:1317-1328`).
            writeU16BE(buf, at + 2, writtenSecondary(r.projectileObject, link));
            buf[at + 4] = r.rangeRemaining & 0xff;
            buf[at + 5] = r.damageRemaining & 0xff;
            writeU16BE(buf, at + 6, r.timerIndex & 0xffff);
            return;
        }
        case DBType.CLOUD: {
            const r = record as CloudRecord;
            // `DB15::word2` (`doc/CSBwin-src/CSB.h:1330-1345`).
            writeU16BE(buf, at + 2,
                ((r.value & 0xff) << 8) | (bit(r.bit7) << 7) | (r.cloudType & 0x7f));
            return;
        }
        default:
            throw new Error(`database ${db} has no record writer`);
    }
}

/**
 * A record's second RN. `RNnul` when the record is free, for the reason `writeRecord`
 * gives — the reader dropped whatever the file held there.
 */
function writtenSecondary(rn: number, link: number): number {
    if (link === OBJECT_ID_NULL) return OBJECT_ID_NULL;
    return rn & 0xffff;
}

/** Every section of the image, in file order. Blocks 7-14. */
export interface DungeonImageSections {
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
export interface DungeonImageWriteOptions extends DatabaseWriteOptions {
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
 * from zero and adds that into a running total (`doc/CSBwin-src/SaveGame.cpp:679-698`),
 * which is the same thing as summing every byte of blocks 7-14 into a `ui16`. The word
 * is then written through `LE16` (`:1220-1222`) — a byte swap on the little-endian build
 * — so it lands **big-endian**, like the rest of the image.
 *
 * Nothing before block 7 is in it: the running total is set to 0 immediately after the
 * EXPOOL side-writes and just before the header goes out (`:1166`).
 */
export function buildImageChecksum(image: Uint8Array): Uint8Array {
    let sum = 0;
    for (let i = 0; i < image.length; i++) sum = (sum + image[i]) & 0xffff;
    const buf = new Uint8Array(2);
    writeU16BE(buf, 0, sum);
    return buf;
}
