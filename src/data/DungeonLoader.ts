/**
 * Dungeon.dat loader
 *
 * Complete parser for Dungeon Master dungeon files
 * Based on CSBWin SaveGame.cpp ReadDatabases() function
 * Reference: doc/DUNGEON_DAT_FORMAT.md
 */

import { BinaryFile, Endianness } from '../core/BinaryFile';
import { Direction, DBType, OBJECT_ID_EOF, OBJECT_ID_NULL } from '../core/types';
import type { ui8, ui16, ObjectID, CellFlag } from '../core/types';
import type {
    DungeonData,
    DungeonHeader,
    MapDescriptor,
    MapData,
    TileData,
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
    CloudRecord
} from './dungeonTypes';
import {
    DUNGEON_HEADER_SIZE,
    MAP_DESCRIPTOR_SIZE,
    DB_RECORD_SIZE
} from '../core/constants';

/**
 * Dungeon.dat loader class
 */
export class DungeonLoader {
    private file: BinaryFile;
    private data: DungeonData | null = null;

    constructor() {
        this.file = new BinaryFile(Endianness.BIG_ENDIAN); // Atari ST format
    }

    /**
     * Load dungeon from URL
     */
    async load(url: string): Promise<DungeonData> {
        await this.file.load(url);
        return this.parse();
    }

    /**
     * Load dungeon from Uint8Array
     */
    loadFromArray(data: Uint8Array): DungeonData {
        this.file.loadFromArray(data);
        return this.parse();
    }

    /**
     * Main parsing function
     */
    private parse(): DungeonData {
        console.log('Parsing dungeon.dat...');

        // Parse header (44 bytes)
        const header = this.parseHeader();
        console.log(`Dungeon: ${header.numMaps} maps, seed ${header.randomSeed}`);

        // Parse map descriptors
        const mapDescriptors = this.parseMapDescriptors(header.numMaps);
        console.log(`Parsed ${mapDescriptors.length} map descriptors`);

        // Calculate offsets for all sections
        const offsets = this.calculateOffsets(header, mapDescriptors);

        // Parse column index
        const columnIndex = this.parseColumnIndex(offsets.columnIndex, offsets.totalColumns);

        // Parse object list
        const objectList = this.parseObjectList(offsets.objectList, header.objectListSize);

        // Parse text data
        const textData = this.parseTextData(offsets.textData, header.textDataSize);
        console.log(`Parsed ${textData.length} text entries`);

        // Parse all databases
        const databases = this.parseDatabases(offsets.databases, header.objectCounts);
        console.log(`Parsed databases: ${header.objectCounts.reduce((a, b) => a + b, 0)} total objects`);

        // Parse map data (tiles)
        const maps = this.parseMapData(offsets.mapData, mapDescriptors);
        console.log(`Parsed ${maps.length} maps with tile data`);

        // Build level index
        const levelIndex = this.buildLevelIndex(mapDescriptors);

        this.data = {
            header,
            maps,
            databases,
            textData,
            objectList,
            columnIndex,
            levelIndex
        };

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
        this.file.skip(1); // padding
        const textDataSize = this.file.readU16();

        // Decode starting position (word at 0x08)
        // Bits 11-10: facing, 9-5: Y coord, 4-0: X coord
        const startPosWord = this.file.readU16();
        const startPosition = {
            x: startPosWord & 0x1F,              // Bits 4-0
            y: (startPosWord >> 5) & 0x1F,       // Bits 9-5
            level: 0, // Will be set from map descriptors
            facing: ((startPosWord >> 10) & 0x03) as Direction
        };

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
            textDataSize,
            startPosition,
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
            const _componentFlags = this.file.readU16(); // Component flags (DM2 only)
            const _unused = this.file.readU16(); // Unused word

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

            // Door and graphics indices
            const doorGraphicsWord = this.file.readU16();
            const doorType1Index = (doorGraphicsWord >> 12) & 0xF;
            const doorType0Index = (doorGraphicsWord >> 8) & 0xF;
            const mapGraphicsStyle = (doorGraphicsWord >> 4) & 0xF;
            const floorCeilingStyle = doorGraphicsWord & 0xF;

            descriptors.push({
                mapIndex: i,
                dataOffset,
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
                doorType0Index,
                doorType1Index,
                mapGraphicsStyle,
                floorCeilingStyle
            });
        }

        return descriptors;
    }

    /**
     * Calculate offsets for all data sections
     */
    private calculateOffsets(header: DungeonHeader, maps: MapDescriptor[]) {
        const totalColumns = maps.reduce((sum, m) => sum + m.width, 0);

        const columnIndexOffset = DUNGEON_HEADER_SIZE + maps.length * MAP_DESCRIPTOR_SIZE;
        const objectListOffset = columnIndexOffset + totalColumns * 2;
        const textDataOffset = objectListOffset + header.objectListSize * 2;
        const doorsOffset = textDataOffset + header.textDataSize * 2;

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
        return sizes[dbType] || 0;
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
            list.push(this.file.readU16());
        }
        return list;
    }

    /**
     * Parse text data (5-bit encoded)
     * Reference: DUNGEON_DAT_FORMAT.md section "Text Encoding"
     */
    private parseTextData(offset: number, sizeInWords: ui16): string[] {
        this.file.seek(offset);
        const words: ui16[] = [];

        for (let i = 0; i < sizeInWords; i++) {
            words.push(this.file.readU16());
        }

        return this.decodeTextData(words);
    }

    /**
     * Decode 5-bit text encoding
     * Each word contains 3 characters (5 bits each, bit 15 unused)
     */
    private decodeTextData(words: ui16[]): string[] {
        const texts: string[] = [];
        let currentText = '';

        for (const word of words) {
            const char1 = (word >> 10) & 0x1F;
            const char2 = (word >> 5) & 0x1F;
            const char3 = word & 0x1F;

            for (const charCode of [char1, char2, char3]) {
                if (charCode === 31) {
                    // End of text
                    if (currentText.length > 0) {
                        texts.push(currentText);
                        currentText = '';
                    }
                } else if (charCode <= 25) {
                    // A-Z
                    currentText += String.fromCharCode(65 + charCode);
                } else if (charCode === 26) {
                    currentText += ' ';
                } else if (charCode === 27) {
                    currentText += '.';
                } else if (charCode === 28) {
                    currentText += '\n'; // Separator
                } else if (charCode === 29 || charCode === 30) {
                    // Escape codes - not fully implemented yet
                    // TODO: Implement escape code tables
                }
            }
        }

        return texts;
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

    // Database parsers (to be continued in next message due to length)

    private parseDoorDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: DoorRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.file.readU16();
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                destructibleByChop: (attributes & 0x100) !== 0,
                destructibleByFireball: (attributes & 0x80) !== 0,
                hasButton: (attributes & 0x40) !== 0,
                vertical: (attributes & 0x20) !== 0,
                ornateNumber: (attributes >> 1) & 0xF,
                doorType: attributes & 0x1
            });
        }

        return { records, count };
    }

    private parseTeleporterDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: TeleporterRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.file.readU16();
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
                destMap: (destination >> 8) & 0xFF
            });
        }

        return { records, count };
    }

    private parseTextDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: TextRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.file.readU16();
            const textRef = this.file.readU16();

            records.push({
                nextObject,
                textOffset: (textRef >> 3) & 0x1FFF,
                visible: (textRef & 0x1) !== 0
            });
        }

        return { records, count };
    }

    private parseActuatorDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: ActuatorRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.file.readU16();
            const typeData = this.file.readU16();
            const behavior = this.file.readU16();
            const target = this.file.readU16();

            records.push({
                nextObject,
                sensorType: typeData & 0x7F,
                data: (typeData >> 7) & 0x1FF,
                decorationOrdinal: (behavior >> 12) & 0xF,
                targetLocal: (behavior & 0x800) !== 0,
                delay: (behavior >> 7) & 0xF,
                soundEffect: (behavior & 0x40) !== 0,
                revertEffect: (behavior & 0x20) !== 0,
                actionType: (behavior >> 3) & 0x3,
                onceOnly: (behavior & 0x4) !== 0,
                targetData: target
            });
        }

        return { records, count };
    }

    private parseCreatureDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: CreatureRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.file.readU16();
            const possession = this.file.readU16();
            const creatureType = this.file.readU8();
            const positions = this.file.readU8();
            const hp = [
                this.file.readU16(),
                this.file.readU16(),
                this.file.readU16(),
                this.file.readU16()
            ];
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                possession,
                creatureType,
                positions,
                hp,
                important: (attributes & 0x400) !== 0,
                facing: (attributes >> 8) & 0x3,
                count: ((attributes >> 5) & 0x3) + 1
            });
        }

        return { records, count };
    }

    private parseWeaponDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: WeaponRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.file.readU16();
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                broken: (attributes & 0x4000) !== 0,
                charges: (attributes >> 10) & 0xF,
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
            const nextObject = this.file.readU16();
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                broken: (attributes & 0x2000) !== 0,
                cursed: (attributes & 0x100) !== 0,
                important: (attributes & 0x80) !== 0,
                clothingType: attributes & 0x7F
            });
        }

        return { records, count };
    }

    private parseScrollDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: ScrollRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.file.readU16();
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                open: ((attributes >> 10) & 0x3F) === 0,
                textReference: attributes & 0x3FF
            });
        }

        return { records, count };
    }

    private parsePotionDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: PotionRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.file.readU16();
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
            const nextObject = this.file.readU16();
            const containedObject = this.file.readU16();
            const containerType = this.file.readU16();
            this.file.skip(2); // unused

            records.push({
                nextObject,
                containedObject,
                containerType: (containerType >> 1) & 0x3
            });
        }

        return { records, count };
    }

    private parseMiscDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: MiscRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.file.readU16();
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                specialState: (attributes >> 14) & 0x3,
                important: (attributes & 0x80) !== 0,
                miscType: attributes & 0x7F
            });
        }

        return { records, count };
    }

    private parseMissileDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: MissileRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.file.readU16();
            const projectileObject = this.file.readU16();
            const rangeEnergy = this.file.readU8();
            const damageEnergy = this.file.readU8();
            const eventIndex = this.file.readU16();

            records.push({
                nextObject,
                projectileObject,
                rangeEnergy,
                damageEnergy,
                eventIndex
            });
        }

        return { records, count };
    }

    private parseCloudDatabase(offset: number, count: ui16) {
        this.file.seek(offset);
        const records: CloudRecord[] = [];

        for (let i = 0; i < count; i++) {
            const nextObject = this.file.readU16();
            const attributes = this.file.readU16();

            records.push({
                nextObject,
                value: (attributes >> 8) & 0xFF,
                cloudType: attributes & 0x7F
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

            const tiles: TileData[][] = [];
            const cellFlags: CellFlag[][] = [];

            // Read tiles row by row
            for (let x = 0; x < descriptor.width; x++) {
                tiles[x] = [];
                cellFlags[x] = [];

                for (let y = 0; y < descriptor.height; y++) {
                    const cellFlag = this.file.readU8();
                    cellFlags[x][y] = cellFlag;

                    tiles[x][y] = {
                        cellFlag,
                        roomType: (cellFlag >> 5) & 0x7,
                        hasObjects: (cellFlag & 0x10) !== 0,
                        attributes: cellFlag & 0xF
                    };
                }
            }

            maps.push({
                descriptor,
                tiles,
                cellFlags
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
