/**
 * Dungeon.dat loader
 *
 * Complete parser for Dungeon Master dungeon files
 * Based on CSBWin SaveGame.cpp ReadDatabases() function
 * Reference: doc/DUNGEON_DAT_FORMAT.md
 */

import { BinaryFile, Endianness } from '../core/BinaryFile';
import { Direction, DBType, OBJECT_ID_NULL, Position } from '../core/types';
import type { ui8, ui16, ui32, ObjectID, CellFlag } from '../core/types';
import type {
    DungeonData,
    DungeonHeader,
    MapDescriptor,
    MapData,
    Databases,
    DoorRecord,
    TeleporterRecord,
    TextRecord,
    ActuatorRecord,
    CreatureRecord,
    WeaponRecord,
    ClothingRecord,
    ScrollRecord,
    PotionRecord,
    ContainerRecord,
    MiscRecord,
    MissileRecord,
    CloudRecord,
    DatabaseRecord
} from './dungeonTypes';
import { ExpandData } from '../core/compression';
import { readU16BE, readU32BE } from '../core/bytes';
import { EXPOOL_RECORD_SIZE, specialLocationsFromExpool } from './CsbwinExpool';
import { readExtendedFeatures } from './CsbwinExtendedFeatures';
import { CheckCelltypes, ExtendPortraits, convertOriginalDungeon } from './CsbwinDungeonConversions';
import { databaseRecords, rnMapsOf } from './CsbwinObjectIndex';
import type { CsbwinObjectIndex } from './CsbwinObjectIndex';
import {
    DUNGEON_HEADER_SIZE,
    MAP_DESCRIPTOR_SIZE
} from '../core/constants';

/**
 * Dungeon.dat loader class
 */
/**
 * How the image being parsed differs from a plain `dungeon.dat`.
 *
 * A CSBWin **save file** carries the same structure with three differences, all of
 * them declared in its Extended Features block and all of them verified against
 * genuine saves (`doc/PROVEN_FACTS.md` → "The dungeon image layout in a save file").
 * Defaults are `dungeon.dat`, so existing callers are unaffected.
 */
/** The first word of a compressed `dungeon.dat` (`doc/CSBwin-src/SaveGame.cpp:2351`). */
const DUNGEON_COMPRESSED_SIGNATURE = 33028;

export interface DungeonImageOptions {
    /** ACTUATOR records carry a trailing word (`MakeBigActuators` appends two bytes). */
    bigActuators?: boolean;
    /** SCROLL records are 6 bytes with an RN text reference, not 4 with a 10-bit index. */
    newScrolls?: boolean;
    /** The text section is already an indirect index + compressed text, not raw words. */
    indirectText?: boolean;
    /** EXPOOL (db 11) records exist and are 256 bytes each. Saves only. */
    expool?: boolean;
    /**
     * Read the image exactly as it stands, without the three load-time conversions
     * `convertOriginalDungeon` runs (`src/data/CsbwinDungeonConversions.ts`).
     *
     * CSBWin has no such switch — it always converts — and neither does the game. This
     * exists for `tools/dump-dungeon-image-blocks.ts`, which writes `dungeon.dat`'s own
     * sections back out and byte-compares them with the file, and so needs the world in
     * the file's shape rather than in the shape a save is written in.
     */
    noConvert?: boolean;
    /**
     * The image's Extended Features block carried `ExpandedPortraits`, so its mirrors are
     * already in CSBWin's form and `ExtendPortraits` leaves them alone. False for a plain
     * `dungeon.dat` and for a save with no block. `noConvert` skips it as well.
     */
    expandedPortraits?: boolean;
    /**
     * The length of the cell flags, the image's last section: the Extended Features
     * block's when it declares one, else the header's word 2, `LegacyCellFlagArraySize`
     * (`doc/CSBwin-src/SaveGame.cpp:2412-2419`). Defaults to the header's.
     */
    cellFlagArraySize?: number;
    /**
     * The image's object indirect index, which its Extended Features block carries.
     *
     * A `dungeon.dat` stores RNs as `[position:2][category:4][index:10]`, and the load
     * numbers them into slots (`convertObjectReferences`). A CSBWin **save** stores every
     * RN as a slot of this index already (`src/data/CsbwinObjectIndex.ts`), and the world
     * keeps the index as its `RnMaps`.
     */
    objectIndex?: CsbwinObjectIndex;
}

/**
 * The world before anything is read: no level, no record, no text. What `d.Initialize()`
 * leaves CSBWin's `d` with until `_ReadEntireGame` reads `dungeon.dat` or a save
 * (`doc/CSBwin-src/Code1f9e6.cpp:309`, `CSBCode.cpp:10634`). The page builds its `Game`
 * over it, and the boot's read installs the real one (`Game.installWorld`).
 */
export function emptyDungeonData(): DungeonData {
    const database = () => ({ records: [], count: 0 });
    const data: DungeonData = {
        header: {
            randomSeed: 0,
            mapDataSize: 0,
            numMaps: 0,
            word4Low: 0,
            textDataSize: 0,
            startPosition: new Position(0, 0, 0),
            facing: Direction.NORTH,
            objectListSize: 0,
            objectCounts: new Array<ui16>(16).fill(0),
        },
        maps: [],
        databases: {
            doors: database(), teleporters: database(), texts: database(), actuators: database(),
            creatures: database(), weapons: database(), clothing: database(), scrolls: database(),
            potions: database(), containers: database(), misc: database(), missiles: database(),
            clouds: database(),
        },
        objectList: [],
        rnMaps: rnMapsOf(() => data.databases),
        columnIndex: [],
        levelIndex: [],
    };
    return data;
}

export class DungeonLoader {
    private file: BinaryFile;
    private data: DungeonData | null = null;
    private options: DungeonImageOptions = {};

    constructor() {
        this.file = new BinaryFile(Endianness.BIG_ENDIAN); // Atari ST format
    }

    /**
     * Load a `dungeon.dat` from URL, through `loadDungeonDat`.
     */
    async load(url: string): Promise<DungeonData> {
        await this.file.load(url);
        return this.loadDungeonDat(this.file.read(0, this.file.length()));
    }

    /**
     * A new game's `dungeon.dat`, as `ReadDatabases` opens it when the game is not a
     * resumed one (`doc/CSBwin-src/SaveGame.cpp:2346-2374`). `ReadExtendedFeatures` reads
     * a block at the front, if there is one, and returns its size. Behind it, a file whose
     * first word is 33028 is compressed: the long at 2 is the expanded size, the word at 6
     * is `d.Word22592`, and the body goes through `ExpandData`. The body is read from byte
     * 8 plus the block's size, unless the block's `ExtendedFeaturesVersion` is `'@'`, when
     * it is read from byte 8 of the file (`:2362-2369`). Any other file is read as it
     * stands, after the block.
     *
     * The block declares the image's shape (`bigActuators`, `indirectText`, six-byte
     * scrolls from version `'B'`, the cell flags' length) and maps its object references,
     * as a save's does, and the loader reads the image with them. The block itself is
     * kept in `extendedFeatures`, whose rule flags a new game takes (`readRulesOptions`).
     *
     * An enciphered file is read deciphered, from its first byte to its last
     * (`readExtendedFeatures`), and says so in `simpleEncipher`.
     */
    loadDungeonDat(file: Uint8Array): DungeonData {
        const ef = readExtendedFeatures(file);
        const bytes = ef.data;
        const size = ef.offset;
        if (bytes.length - size < 8) throw new Error('dungeon.dat is shorter than 8 bytes');
        const options: DungeonImageOptions = ef.header ? {
            bigActuators: ef.bigActuators,
            newScrolls: ef.version >= 0x42, // 'B'
            indirectText: ef.indirectText,
            expandedPortraits: ef.expandedPortraits,
            expool: true,
            cellFlagArraySize: ef.cellFlagArraySize || undefined,
            objectIndex: ef.objectIndex,
        } : {};
        let data: DungeonData;
        if (readU16BE(bytes, size) !== DUNGEON_COMPRESSED_SIGNATURE) {
            data = this.loadFromArray(bytes.subarray(size), options);
        } else {
            const bodyStart = 8 + (ef.version === 0x40 ? 0 : size); // '@'
            data = this.loadFromArray(ExpandData(bytes.subarray(bodyStart), readU32BE(bytes, size + 2)), options);
            data.word22592 = readU16BE(bytes, size + 6);
        }
        if (ef.header) {
            data.extendedFeatures = ef.header;
            if (ef.simpleEncipher) data.simpleEncipher = true;
            data.extendedWallDecorations = ef.extendedWallDecorations;
            data.spellFilterLocation = ef.spellFilterLocation;
            data.hintKey = ef.header.hintKey;
            if (ef.dsaLevelIndex) data.dsaLevelIndex = ef.dsaLevelIndex;
            if (ef.dsaIndex) data.dsaIndex = ef.dsaIndex;
            const specialLocations = data.expool ? specialLocationsFromExpool(data.expool) : null;
            if (specialLocations) data.specialLocations = specialLocations;
        }
        return data;
    }

    /**
     * Load dungeon from Uint8Array
     */
    loadFromArray(data: Uint8Array, options: DungeonImageOptions = {}): DungeonData {
        this.options = options;
        this.file.loadFromArray(data);
        return this.parse();
    }

    /**
     * Main parsing function
     */
    private parse(): DungeonData {
        // Parse header (44 bytes)
        const header = this.parseHeader();

        // Parse map descriptors
        const mapDescriptors = this.parseMapDescriptors(header.numMaps);

        // Calculate offsets for all sections
        const offsets = this.calculateOffsets(header, mapDescriptors);
        this.compareChecksum(offsets.mapData + (this.options.cellFlagArraySize ?? header.mapDataSize));

        // Parse column index
        const columnIndex = this.parseColumnIndex(offsets.columnIndex, offsets.totalColumns);

        // Parse object list
        const objectList = this.parseObjectList(offsets.objectList, header.objectListSize);

        // Parse text data. In a save it is already in indirect form and must be read as
        // it stands; `buildIndirectText` below is the *conversion*, and running it over
        // an already-converted array would decode the index as if it were text.
        const indirect = this.options.indirectText
            ? this.readIndirectText(offsets.textData, header.textDataSize)
            : null;
        const textWords = indirect ? indirect.compressedText : this.parseTextWords(offsets.textData, header.textDataSize);

        // Parse all databases
        const databases = this.parseDatabases(offsets.databases, header.objectCounts);
        // Database 11 — `EXPOOL` — is kept as its blocks (`DungeonData.expool`).
        const expool = this.readExpool(offsets.databases[11], header.objectCounts[11]);

        // Parse map data (tiles)
        const maps = this.parseMapData(offsets.mapData, mapDescriptors);

        // Build level index
        const levelIndex = this.buildLevelIndex(mapDescriptors);

        const data: DungeonData = {
            header,
            maps,
            databases,
            textWords,
            objectList,
            rnMaps: rnMapsOf(() => data.databases, this.options.objectIndex),
            columnIndex,
            levelIndex,
            item16: [],
            bigActuators: this.options.bigActuators ?? false,
            indirectText: this.options.indirectText ?? false,
            newScrolls: this.options.newScrolls ?? false,
        };
        if (indirect) {
            data.indirectTextIndex = indirect.indirectTextIndex;
            data.compressedText = indirect.compressedText;
        }

        if (expool) data.expool = expool;

        // `ReadDatabases` converts an original dungeon into the shape a save is written
        // in before it returns, so every world this port holds is save-shaped unless a
        // tool has asked for the file's own (`src/data/CsbwinDungeonConversions.ts`).
        if (!this.options.noConvert) {
            convertOriginalDungeon(data, {
                bigActuators: data.bigActuators,
                indirectText: data.indirectText,
                newScrolls: data.newScrolls,
                indirectObjects: this.options.objectIndex !== undefined,
            });
            // Not part of `ReadDatabases`: `_ReadEntireGame` runs these once the whole
            // file is read (`doc/CSBwin-src/SaveGame.cpp:1825-1827`), a save's as a new
            // game's. The `CheckMonsters` between them needs the tables, so `Game` and
            // `applyCsbwinSave` run it (`src/engine/CheckMonsters.ts`).
            CheckCelltypes(data);
            if (!this.options.expandedPortraits) ExtendPortraits(data);
        }

        this.data = data;

        return this.data;
    }

    /**
     * Parse header (44 bytes at offset 0x00)
     * Reference: DUNGEON_DAT_FORMAT.md section "Header Format"
     */
    private parseHeader(): DungeonHeader {
        this.file.seek(0x00);

        const randomSeed = this.file.readU16();
        const mapDataSize = this.file.readU16();
        const numMaps = this.file.readU8();
        // The low byte of `word4`. Unnamed and unread in CSBWin, preserved for the writer.
        const word4Low = this.file.readU8();
        const textDataSize = this.file.readU16();

        // Decode starting position (word at 0x08)
        // Bits 11-10: facing, 9-5: Y coord, 4-0: X coord
        const startPosWord = this.file.readU16();
        const startPosition = new Position(
            startPosWord & 0x1F,              // Bits 4-0
            (startPosWord >> 5) & 0x1F,       // Bits 9-5
            0, // Will be set from map descriptors
        );
        const facing = ((startPosWord >> 10) & 0x03) as Direction;

        const objectListSize = this.file.readU16();

        // Read object counts (16 words)
        const objectCounts: ui16[] = [];
        for (let i = 0; i < 16; i++) {
            objectCounts.push(this.file.readU16());
        }

        return {
            randomSeed,
            mapDataSize,
            numMaps,
            word4Low,
            textDataSize,
            startPosition,
            facing,
            objectListSize,
            objectCounts
        };
    }

    /**
     * Parse map descriptors (16 bytes each)
     * Reference: DUNGEON_DAT_FORMAT.md section "Map Descriptors"
     */
    private parseMapDescriptors(numMaps: ui8): MapDescriptor[] {
        const descriptors: MapDescriptor[] = [];
        this.file.seek(DUNGEON_HEADER_SIZE);

        for (let i = 0; i < numMaps; i++) {
            const dataOffset = this.file.readU16();
            // `LEVELDESC.FILL2[4]` — four unnamed bytes CSBWin never swaps or reads.
            const fill2 = [
                this.file.readU8(), this.file.readU8(),
                this.file.readU8(), this.file.readU8(),
            ];

            const offsetX = this.file.readU8();
            const offsetY = this.file.readU8();

            // Map size word (bits 15-11: height-1, 10-6: width-1, 5-0: level)
            const sizeWord = this.file.readU16();
            const height = ((sizeWord >> 11) & 0x1F) + 1;
            const width = ((sizeWord >> 6) & 0x1F) + 1;
            const level = sizeWord & 0x3F;

            // Graphics counts
            const graphicsWord = this.file.readU16();
            const floorDecorationCount = (graphicsWord >> 12) & 0xF;
            const floorGraphicsCount = (graphicsWord >> 8) & 0xF;
            const wallDecorationCount = (graphicsWord >> 4) & 0xF;
            const wallGraphicsCount = graphicsWord & 0xF;

            // Difficulty and creatures
            const difficultyWord = this.file.readU16();
            const difficulty = (difficultyWord >> 12) & 0xF;
            const creatureTypesAllowed = (difficultyWord >> 4) & 0xF;
            const doorDecorationCount = difficultyWord & 0xF;
            const word12Bits8_11 = (difficultyWord >> 8) & 0xF;

            // Door and graphics indices
            const doorGraphicsWord = this.file.readU16();
            const doorType1Index = (doorGraphicsWord >> 12) & 0xF;
            const doorType0Index = (doorGraphicsWord >> 8) & 0xF;
            const mapGraphicsStyle = (doorGraphicsWord >> 4) & 0xF;
            const floorCeilingStyle = doorGraphicsWord & 0xF;

            descriptors.push({
                mapIndex: i,
                dataOffset,
                fill2,
                offsetX,
                offsetY,
                level,
                width,
                height,
                floorDecorationCount,
                floorGraphicsCount,
                wallDecorationCount,
                wallGraphicsCount,
                difficulty,
                creatureTypesAllowed,
                doorDecorationCount,
                word12Bits8_11,
                doorType0Index,
                doorType1Index,
                mapGraphicsStyle,
                floorCeilingStyle
            });
        }

        return descriptors;
    }

    /**
     * `ReadDatabases`' checksum. Every section it reads goes through `FetchDataBytes`,
     * which adds each byte into a `ui16` (`doc/CSBwin-src/CSBCode.cpp:9081-9106`), from
     * the header to the end of the cell flags; then it reads the word after them and
     * fails the read when it differs from the sum (`SaveGame.cpp:2654-2658`). The word
     * goes through `LE16`, a byte swap on the little-endian build, so it is big-endian
     * like the rest of the image. When fewer than two bytes follow, `StreamInput` fails
     * (`CSBCode.cpp:9027-9043`) and nothing is compared: DM's `dungeon.dat` has no word.
     *
     * CSBWin compares once every section is read; comparing before the parsers run
     * fails the same reads, without handing a damaged image to them.
     */
    private compareChecksum(end: number): void {
        const bytes = this.file.read(0, this.file.length());
        if (end + 2 > bytes.length) return;
        let sum = 0;
        for (let i = 0; i < end; i++) sum = (sum + bytes[i]) & 0xffff;
        if (readU16BE(bytes, end) !== sum) throw new Error('dungeon image checksum mismatch');
    }

    /**
     * Calculate offsets for all data sections
     */
    private calculateOffsets(header: DungeonHeader, maps: MapDescriptor[]) {
        const totalColumns = maps.reduce((sum, m) => sum + m.width, 0);

        const columnIndexOffset = DUNGEON_HEADER_SIZE + maps.length * MAP_DESCRIPTOR_SIZE;
        const objectListOffset = columnIndexOffset + totalColumns * 2;
        const textDataOffset = objectListOffset + header.objectListSize * 2;
        // In a save the text is already indirect: `NumWordsInTextArray` counts index
        // entries (`ConvertToIndirectText` repurposes it,
        // `doc/CSBwin-src/SaveGame.cpp:2272`), each 4 bytes, then a 4-byte
        // `sizeOfCompressedText` and that many words of text. Both the index and the
        // size word are little-endian, alone in a big-endian image.
        let doorsOffset: number;
        if (this.options.indirectText) {
            const sizeAt = textDataOffset + header.textDataSize * 4;
            const compressedWords = this.file.peekU32LE(sizeAt);
            doorsOffset = sizeAt + 4 + compressedWords * 2;
        } else {
            doorsOffset = textDataOffset + header.textDataSize * 2;
        }

        let offset = doorsOffset;
        const databaseOffsets: number[] = [];

        // Calculate offset for each database
        for (let i = 0; i < 16; i++) {
            databaseOffsets.push(offset);
            const recordSize = this.getDatabaseRecordSize(i);
            offset += header.objectCounts[i] * recordSize;
        }

        const mapDataOffset = offset;

        return {
            columnIndex: columnIndexOffset,
            objectList: objectListOffset,
            textData: textDataOffset,
            databases: databaseOffsets,
            mapData: mapDataOffset,
            totalColumns
        };
    }

    /**
     * Get record size for database type
     */
    private getDatabaseRecordSize(dbType: number): number {
        const sizes = [4, 6, 4, 8, 16, 4, 4, 4, 4, 8, 4, 0, 0, 0, 8, 4];
        // `dbEntrySizes[dbACTUATOR]` is the *big* size in CSBWin; the small one is the
        // special case (`doc/CSBwin-src/SaveGame.cpp:2571-2575`). SCROLL grows the same
        // way from extended-features version 'B' (`:2189-2200`).
        if (dbType === DBType.ACTUATOR && this.options.bigActuators) return 10;
        if (dbType === DBType.SCROLL && this.options.newScrolls) return 6;
        if (dbType === 11 && this.options.expool) return EXPOOL_RECORD_SIZE;
        return sizes[dbType] || 0;
    }

    /**
     * Read one object reference: the object list, each record's link, a chest's
     * contents, a monster's possessions, a missile's flying object. A `dungeon.dat`'s is
     * packed until `convertObjectReferences` numbers it; a save's is a slot already.
     */
    private readRN(): ObjectID {
        return this.file.readU16() as ObjectID;
    }

    /**
     * A second RN inside a record that may be free — a monster's possessions, a chest's
     * contents, a missile's flying object, a scroll's text.
     *
     * CSBWin marks a record deleted by writing `RNnul` over its link and frees the
     * indirect slot that named it in the same breath (`DeleteDBEntry`,
     * `doc/CSBwin-src/data.cpp:993-1015`); everything else in the record is left as it
     * was. So in a save a free record routinely still holds a reference to a slot that
     * has since been freed or reused. CSBWin never looks: a free record is reached only
     * by the allocator, which clears it before handing it out. A free record's other RNs
     * are read as `RNnul`, which is what the record means.
     */
    private readRNOfRecord(link: ObjectID): ObjectID {
        const raw = this.file.readU16();
        if (this.options.objectIndex && link === OBJECT_ID_NULL) return OBJECT_ID_NULL;
        return raw as ObjectID;
    }

    /**
     * Database 11 — `EXPOOL` — as its blocks (`src/data/CsbwinExpool.ts`), as the file
     * has them. A champion bones record is keyed by the bones' RN, a slot like every
     * other RN of the image.
     */
    private readExpool(offset: number, count: ui16): Uint8Array | null {
        if (!this.options.expool || count <= 0) return null;
        const bytes = new Uint8Array(count * EXPOOL_RECORD_SIZE);
        this.file.seek(offset);
        for (let i = 0; i < bytes.length; i++) bytes[i] = this.file.readU8();
        return bytes;
    }

    /**
     * Parse column index
     */
    private parseColumnIndex(offset: number, count: number): ui16[] {
        this.file.seek(offset);
        const index: ui16[] = [];
        for (let i = 0; i < count; i++) {
            index.push(this.file.readU16());
        }
        return index;
    }

    /**
     * Parse object list
     */
    private parseObjectList(offset: number, size: ui16): ObjectID[] {
        this.file.seek(offset);
        const list: ObjectID[] = [];
        for (let i = 0; i < size; i++) {
            list.push(this.readRN());
        }
        return list;
    }

    /**
     * Parse text data (5-bit encoded)
     * Reference: DUNGEON_DAT_FORMAT.md section "Text Encoding"
     */
    private parseTextWords(offset: number, sizeInWords: ui16): ui16[] {
        this.file.seek(offset);
        const words: ui16[] = [];

        for (let i = 0; i < sizeInWords; i++) {
            words.push(this.file.readU16());
        }

        return words;
    }

    /**
     * The indirect text block of a CSBWin save: `count` 32-bit word offsets, then a
     * 32-bit `sizeOfCompressedText`, then that many 16-bit words of packed text.
     *
     * The index and the size are **little-endian** — alone in an otherwise big-endian
     * image, because their swap helper is a no-op on the shipping build. The text words
     * themselves are big-endian like everything else.
     */
    private readIndirectText(offset: number, count: ui16): {
        indirectTextIndex: ui32[];
        compressedText: ui16[];
    } {
        const indirectTextIndex: ui32[] = [];
        for (let i = 0; i < count; i++) {
            indirectTextIndex.push(this.file.peekU32LE(offset + i * 4));
        }
        const sizeAt = offset + count * 4;
        const sizeOfCompressedText = this.file.peekU32LE(sizeAt);
        const compressedText: ui16[] = [];
        this.file.seek(sizeAt + 4);
        for (let i = 0; i < sizeOfCompressedText; i++) {
            compressedText.push(this.file.readU16());
        }
        return { indirectTextIndex, compressedText };
    }

    /**
     * Parse all databases
     */
    private parseDatabases(offsets: number[], counts: ui16[]): Databases {
        return {
            doors: this.parseDoorDatabase(offsets[DBType.DOOR], counts[DBType.DOOR]),
            teleporters: this.parseTeleporterDatabase(offsets[DBType.TELEPORTER], counts[DBType.TELEPORTER]),
            texts: this.parseTextDatabase(offsets[DBType.TEXT], counts[DBType.TEXT]),
            actuators: this.parseActuatorDatabase(offsets[DBType.ACTUATOR], counts[DBType.ACTUATOR]),
            creatures: this.parseCreatureDatabase(offsets[DBType.CREATURE], counts[DBType.CREATURE]),
            weapons: this.parseWeaponDatabase(offsets[DBType.WEAPON], counts[DBType.WEAPON]),
            clothing: this.parseClothingDatabase(offsets[DBType.CLOTHING], counts[DBType.CLOTHING]),
            scrolls: this.parseScrollDatabase(offsets[DBType.SCROLL], counts[DBType.SCROLL]),
            potions: this.parsePotionDatabase(offsets[DBType.POTION], counts[DBType.POTION]),
            containers: this.parseContainerDatabase(offsets[DBType.CHEST], counts[DBType.CHEST]),
            misc: this.parseMiscDatabase(offsets[DBType.MISC], counts[DBType.MISC]),
            missiles: this.parseMissileDatabase(offsets[DBType.MISSILE], counts[DBType.MISSILE]),
            clouds: this.parseCloudDatabase(offsets[DBType.CLOUD], counts[DBType.CLOUD])
        };
    }

    /**
     * `count` records of database `db` as `DATABASES::Enlarge` clears them
     * (`doc/CSBwin-src/data.cpp:864-875`): every byte 0 and the link `RNnul`, read
     * through the database's own parser as a save's are, in the record shape
     * `bigActuators` and `newScrolls` give. So a cleared record is what a save of it
     * gives back: its other RNs are `RNnul` (`readRNOfRecord`).
     */
    clearedRecords(db: DBType, count: number, shape: { bigActuators?: boolean; newScrolls?: boolean }): DatabaseRecord[] {
        const objectIndex = { length: 0, typeMap: new Uint8Array(0), indexMap: new Uint16Array(0) };
        this.options = { bigActuators: shape.bigActuators, newScrolls: shape.newScrolls, objectIndex };
        const size = this.getDatabaseRecordSize(db);
        const bytes = new Uint8Array(count * size);
        for (let i = 0; i < count; i++) bytes.fill(0xff, i * size, i * size + 2);
        this.file.loadFromArray(bytes);
        const counts = new Array<ui16>(16).fill(0);
        counts[db] = count;
        return [...databaseRecords(this.parseDatabases(new Array<number>(16).fill(0), counts), db)];
    }

    // Database parsers (to be continued in next message due to length)

    private parseDoorDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: DoorRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.readRN();
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                destructibleByChop: (attributes & 0x100) !== 0,
                destructibleByFireball: (attributes & 0x80) !== 0,
                hasButton: (attributes & 0x40) !== 0,
                vertical: (attributes & 0x20) !== 0,
                ornateNumber: (attributes >> 1) & 0xF,
                doorType: attributes & 0x1,
                word2Bits9_15: (attributes >> 9) & 0x7f
            });
        }

        return { records, count };
    }

    private parseTeleporterDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: TeleporterRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.readRN();
            const attributes = this.file.readU16();
            const destination = this.file.readU16();

            records.push({
                nextObject,
                sound: (attributes & 0x8000) !== 0,
                scope: (attributes >> 13) & 0x3,
                absoluteRotation: (attributes & 0x1000) !== 0,
                rotation: (attributes >> 10) & 0x3,
                destY: (attributes >> 5) & 0x1F,
                destX: attributes & 0x1F,
                destMap: (destination >> 8) & 0xFF,
                word4Low: destination & 0xff
            });
        }

        return { records, count };
    }

    private parseTextDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: TextRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.readRN();
            const textRef = this.file.readU16();

            records.push({
                nextObject,
                textOffset: (textRef >> 3) & 0x1FFF,
                visible: (textRef & 0x1) !== 0,
                word2Bits1_2: (textRef >> 1) & 0x3
            });
        }

        return { records, count };
    }

    private parseActuatorDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: ActuatorRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.readRN();
            const word2 = this.file.readU16();
            const word4 = this.file.readU16();
            const word6 = this.file.readU16();
            const word8 = this.options.bigActuators ? this.file.readU16() : undefined;

            records.push({
                nextObject,
                word2,
                word4,
                word6,
                word8
            });
        }

        return { records, count };
    }

    private parseCreatureDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: CreatureRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.readRN();
            const possession = this.readRNOfRecord(nextObject);
            const uByte4 = this.file.readU8();
            const groupIndex = this.file.readU8();
            const hp = [
                this.file.readU16(),
                this.file.readU16(),
                this.file.readU16(),
                this.file.readU16()
            ];
            const word14 = this.file.readU16();

            records.push({
                nextObject,
                possession,
                // DB4::monsterType() masks to 5 bits; the top three are the alternate
                // graphic selector (doc/CSBwin-src/CSB.h:1113-1116).
                creatureType: uByte4 & 0x1f,
                alternateGraphics: (uByte4 >> 5) & 0x7,
                groupIndex,
                hp,
                fear: word14 & 0xf,
                numMonM1: (word14 >> 5) & 0x3,
                facing: (word14 >> 8) & 0x3,
                important: (word14 & 0x400) !== 0,
                invisible: (word14 & 0x800) !== 0,
                drawAsSize4: (word14 & 0x1000) !== 0,
                unique: (word14 & 0x2000) !== 0,
                poisoned: (word14 & 0x4000) !== 0,
                word14Bit4: (word14 >> 4) & 1,
                word14Bit7: (word14 >> 7) & 1,
                word14Bit15: (word14 >> 15) & 1
            });
        }

        return { records, count };
    }

    private parseWeaponDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: WeaponRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.readRN();
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                broken: (attributes & 0x4000) !== 0,
                charges: (attributes >> 10) & 0xF,
                litTorch: (attributes & 0x8000) !== 0,
                poisoned: (attributes & 0x200) !== 0,
                cursed: (attributes & 0x100) !== 0,
                important: (attributes & 0x80) !== 0,
                weaponType: attributes & 0x7F
            });
        }

        return { records, count };
    }

    private parseClothingDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: ClothingRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.readRN();
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                broken: (attributes & 0x2000) !== 0,
                charges: (attributes >> 9) & 0xF,
                cursed: (attributes & 0x100) !== 0,
                important: (attributes & 0x80) !== 0,
                clothingType: attributes & 0x7F,
                word2Bits14_15: (attributes >> 14) & 0x3
            });
        }

        return { records, count };
    }

    private parseScrollDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: ScrollRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.readRN();
            if (this.options.newScrolls) {
                // `DB7` (`doc/CSBwin-src/CSB.h:1195-1216`): link, then an RN to the text
                // record, then a word whose bit 0 is "open". The RN's record index is
                // exactly what the old 10-bit field held, so storing that keeps every
                // reader of `textReference` unchanged.
                const textRn = this.readRNOfRecord(nextObject);
                const flags = this.file.readU16();
                const index = this.options.objectIndex;
                records.push({
                    nextObject,
                    open: (flags & 0x1) !== 0,
                    textReference: index && textRn < index.length ? index.indexMap[textRn] : textRn & 0x3FF,
                    textObject: textRn,
                    word4Bits1_15: (flags >> 1) & 0x7fff
                });
                continue;
            }
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                open: ((attributes >> 10) & 0x3F) === 0,
                textReference: attributes & 0x3FF,
                word2Bits10_15: (attributes >> 10) & 0x3F
            });
        }

        return { records, count };
    }

    private parsePotionDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: PotionRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.readRN();
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                important: (attributes & 0x8000) !== 0,
                potionType: (attributes >> 8) & 0x7F,
                power: attributes & 0xFF
            });
        }

        return { records, count };
    }

    private parseContainerDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: ContainerRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.readRN();
            const containedObject = this.readRNOfRecord(nextObject);
            const word4 = this.file.readU16();
            // `DB9::m_uByte6[2]` — the two bytes that close the record. Zero in every file
            // here, but no more derivable than `FILL2`.
            const uByte6 = [this.file.readU8(), this.file.readU8()];

            records.push({
                nextObject,
                containedObject,
                containerType: (word4 >> 1) & 0x3,
                word4,
                uByte6
            });
        }

        return { records, count };
    }

    private parseMiscDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: MiscRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.readRN();
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                specialState: (attributes >> 14) & 0x3,
                important: (attributes & 0x80) !== 0,
                miscType: attributes & 0x7F,
                cursed: (attributes & 0x100) !== 0,
                subType: (attributes >> 9) & 0x1F
            });
        }

        return { records, count };
    }

    private parseMissileDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: MissileRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.readRN();
            const projectileObject = this.readRNOfRecord(nextObject);
            const rangeRemaining = this.file.readU8();
            const damageRemaining = this.file.readU8();
            const timerIndex = this.file.readU16();

            records.push({
                nextObject,
                projectileObject,
                rangeRemaining,
                damageRemaining,
                timerIndex
            });
        }

        return { records, count };
    }

    private parseCloudDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: CloudRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.readRN();
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                value: (attributes >> 8) & 0xFF,
                cloudType: attributes & 0x7F,
                bit7: (attributes & 0x80) !== 0
            });
        }

        return { records, count };
    }

    /**
     * Parse map tile data
     */
    private parseMapData(offset: number, descriptors: MapDescriptor[]): MapData[] {
        const maps: MapData[] = [];

        for (const descriptor of descriptors) {
            this.file.seek(offset + descriptor.dataOffset);

            const cellFlags: CellFlag[][] = [];

            // Read the cell flags column by column
            for (let x = 0; x < descriptor.width; x++) {
                cellFlags[x] = [];

                for (let y = 0; y < descriptor.height; y++) {
                    cellFlags[x][y] = this.file.readU8();
                }
            }

            // Extra per-level tables follow immediately after the CELLFLAG array in dungeon.dat.
            // CSBWin: `SetPartyLevel()` reads them from `EndOfCELLFLAGS + numMonsterType` (CSBCode.cpp:5778+).
            const numMonsterType = descriptor.creatureTypesAllowed;
            const numWallDecoration = descriptor.wallGraphicsCount; // LEVELDESC.NumWallDecoration()
            const numFloorDecorations = descriptor.floorGraphicsCount; // LEVELDESC.NumFloorDecorations()
            const numDoorDecorations = descriptor.doorDecorationCount; // LEVELDESC.NumDoorDecorations()

            const monsterTypes: ui8[] = [];
            for (let i = 0; i < numMonsterType; i++) monsterTypes.push(this.file.readU8());

            const wallDecorationTOC: ui8[] = [];
            for (let i = 0; i < numWallDecoration; i++) wallDecorationTOC.push(this.file.readU8());

            const floorDecorationTOC: ui8[] = [];
            for (let i = 0; i < numFloorDecorations; i++) floorDecorationTOC.push(this.file.readU8());

            const doorDecorationTOC: ui8[] = [];
            for (let i = 0; i < numDoorDecorations; i++) doorDecorationTOC.push(this.file.readU8());

            maps.push({
                descriptor,
                cellFlags,
                monsterTypes,
                wallDecorationTOC,
                floorDecorationTOC,
                doorDecorationTOC
            });
        }

        return maps;
    }

    /**
     * Build level index for object lookup
     */
    private buildLevelIndex(descriptors: MapDescriptor[]): ui16[] {
        const index: ui16[] = [];
        let columnOffset = 0;

        for (const desc of descriptors) {
            index.push(columnOffset);
            columnOffset += desc.width;
        }

        return index;
    }

    /**
     * Get loaded dungeon data
     */
    getData(): DungeonData | null {
        return this.data;
    }
}
