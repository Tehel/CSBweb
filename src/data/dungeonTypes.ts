/**
 * Dungeon data structure types
 *
 * Based on CSBWin Data.h and CSB.h
 * Reference: doc/DUNGEON_DAT_FORMAT.md
 */

import type {
    ui8, ui16, ui32,
    ObjectID,
    CellFlag,
    StartPosition,
    Coordinates
} from '../core/types';

/**
 * Dungeon header (44 bytes at offset 0x00)
 * CSB.h DUNGEONDATINDEX structure
 */
export interface DungeonHeader {
    randomSeed: ui16;           // 0x00: Dungeon ID (99=DM, 13=CSB, 8=CSB Prison)
    mapDataSize: ui16;          // 0x02: Total map data size in bytes
    numMaps: ui8;               // 0x04: Number of maps/levels
    textDataSize: ui16;         // 0x06: Text data size in words
    startPosition: StartPosition; // 0x08: Party start position (decoded)
    objectListSize: ui16;       // 0x0A: Object list size in words
    objectCounts: ui16[];       // 0x0C: Object counts [16] by database
}

/**
 * Map descriptor (16 bytes per map)
 * CSB.h LEVELDESC structure
 */
export interface MapDescriptor {
    mapIndex: ui8;              // Map index (0-based)
    dataOffset: ui16;           // Offset in map data section
    offsetX: ui8;               // Map offset X in dungeon
    offsetY: ui8;               // Map offset Y in dungeon
    level: ui8;                 // Level number (0-63)
    width: ui8;                 // Map width (1-32)
    height: ui8;                // Map height (1-32)

    // Graphics counts
    floorDecorationCount: ui8;
    floorGraphicsCount: ui8;
    wallDecorationCount: ui8;
    wallGraphicsCount: ui8;

    // Difficulty and creatures
    difficulty: ui8;            // Map difficulty/depth (0-15)
    creatureTypesAllowed: ui8;  // Creature types bitmask
    doorDecorationCount: ui8;

    // Door and graphics indices
    doorType0Index: ui8;
    doorType1Index: ui8;
    mapGraphicsStyle: ui8;
    floorCeilingStyle: ui8;
}

/**
 * Tile definition (1 byte)
 * Encoded as: [RoomType:3][HasObjects:1][Attributes:4]
 */
export interface TileData {
    cellFlag: CellFlag;         // Raw cell flag byte
    roomType: ui8;              // Room type (bits 5-7)
    hasObjects: boolean;        // Has objects flag (bit 4)
    attributes: ui8;            // Type-specific attributes (bits 0-3)
}

/**
 * Map data (tiles + optional graphics indices)
 */
export interface MapData {
    descriptor: MapDescriptor;
    tiles: TileData[][];        // [x][y] 2D array
    cellFlags: CellFlag[][];    // [x][y] raw cell flags for fast access

    // Extra per-level tables stored after CELLFLAGs in dungeon.dat (CSBWin `SetPartyLevel`, CSBCode.cpp:5778+).
    monsterTypes?: ui8[];           // LEVELDESC.numMonsterType() entries
    wallDecorationTOC?: ui8[];      // LEVELDESC.NumWallDecoration() entries (+1 implicit "far text" in CSBWin)
    floorDecorationTOC?: ui8[];     // LEVELDESC.NumFloorDecorations() entries
    doorDecorationTOC?: ui8[];      // LEVELDESC.NumDoorDecorations() entries
}

/**
 * Database record: Door (4 bytes)
 */
export interface DoorRecord {
    nextObject: ObjectID;       // +0x00: Next object in cell
    destructibleByChop: boolean; // +0x02 bit 8
    destructibleByFireball: boolean; // bit 7
    hasButton: boolean;         // bit 6
    vertical: boolean;          // bit 5: 0=horizontal, 1=vertical
    ornateNumber: ui8;          // bits 4-1
    doorType: ui8;              // bit 0: 0 or 1
}

/**
 * Database record: Teleporter (6 bytes)
 */
export interface TeleporterRecord {
    nextObject: ObjectID;       // +0x00
    sound: boolean;             // +0x02 bit 15
    scope: ui8;                 // bits 14-13: 0=items, 1=creatures, 2=items+party, 3=all
    absoluteRotation: boolean;  // bit 12: 0=relative, 1=absolute
    rotation: ui8;              // bits 11-10: 0-3 (0°, 90°, 180°, 270°)
    destX: ui8;                 // bits 9-5
    destY: ui8;                 // bits 4-0
    destMap: ui8;               // +0x04 bits 15-8
}

/**
 * Database record: Text (4 bytes)
 */
export interface TextRecord {
    nextObject: ObjectID;       // +0x00
    textOffset: ui16;           // +0x02 bits 15-3 (offset in words)
    visible: boolean;           // bit 0
    textIndex?: ui16;           // CSBWin indirect text index (post-conversion)
}

/**
 * Database record: Actuator/Sensor (8 bytes)
 */
export interface ActuatorRecord {
    nextObject: ObjectID;       // +0x00
    sensorType: ui8;            // +0x02 bits 6-0
    data: ui16;                 // bits 15-7 (type-specific)
    portraitState: ui8;         // bits 11-9 (PORTRAIT_* flags for type 127)
    decorationOrdinal: ui8;     // +0x04 bits 15-12
    targetLocal: boolean;       // bit 11: 0=remote, 1=local
    delay: ui8;                 // bits 10-7
    soundEffect: boolean;       // bit 6
    revertEffect: boolean;      // bit 5
    actionType: ui8;            // bits 4-3: 0=set, 1=clear, 2=toggle, 3=hold
    onceOnly: boolean;          // bit 2
    targetData: ui16;           // +0x06: target location or action
    rawBehavior: ui16;          // original word4 (needed for DSA ParameterA/B)
    rawTarget: ui16;            // original word6 (needed for DSA ParameterA/B)
}

/**
 * Database record: Creature (16 bytes)
 */
export interface CreatureRecord {
    nextObject: ObjectID;       // +0x00
    possession: ObjectID;       // +0x02: Object carried
    creatureType: ui8;          // +0x04: 0-26
    positions: ui8;             // +0x05: 2 bits per creature, 0xFF=centered
    hp: ui16[];                 // +0x06-0x0D: HP for up to 4 creatures
    important: boolean;         // +0x0E bit 10
    facing: ui8;                // bits 9-8: direction
    count: ui8;                 // bits 6-5: count-1 (0-3)
    groupIndex?: ui8;           // Item16 index (runtime, save games only)
}

/**
 * Database record: Weapon (4 bytes)
 */
export interface WeaponRecord {
    nextObject: ObjectID;       // +0x00
    broken: boolean;            // +0x02 bit 14
    charges: ui8;               // bits 13-10
    poisoned: boolean;          // bit 9
    cursed: boolean;            // bit 8
    important: boolean;         // bit 7
    weaponType: ui8;            // bits 6-0
}

/**
 * Database record: Clothing (4 bytes)
 */
export interface ClothingRecord {
    nextObject: ObjectID;       // +0x00
    broken: boolean;            // +0x02 bit 13
    cursed: boolean;            // bit 8
    important: boolean;         // bit 7
    clothingType: ui8;          // bits 6-0
}

/**
 * Database record: Scroll (4 bytes)
 */
export interface ScrollRecord {
    nextObject: ObjectID;       // +0x00
    open: boolean;              // +0x02 bits 15-10: 0=open, 1=closed
    textReference: ui16;        // bits 9-0
}

/**
 * Database record: Potion (4 bytes)
 */
export interface PotionRecord {
    nextObject: ObjectID;       // +0x00
    important: boolean;         // +0x02 bit 15
    potionType: ui8;            // bits 14-8
    power: ui8;                 // bits 7-0
}

/**
 * Database record: Container/Chest (8 bytes)
 */
export interface ContainerRecord {
    nextObject: ObjectID;       // +0x00
    containedObject: ObjectID;  // +0x02: First object inside
    containerType: ui8;         // +0x04 bits 2-1: 0=chest
}

/**
 * Database record: Miscellaneous (4 bytes)
 */
export interface MiscRecord {
    nextObject: ObjectID;       // +0x00
    specialState: ui8;          // +0x02 bits 15-14 (waterskin/compass)
    important: boolean;         // bit 7
    miscType: ui8;              // bits 6-0
}

/**
 * Database record: Missile/Projectile (8 bytes, save games only)
 */
export interface MissileRecord {
    nextObject: ObjectID;       // +0x00
    projectileObject: ObjectID; // +0x02
    rangeEnergy: ui8;           // +0x04
    damageEnergy: ui8;          // +0x05
    eventIndex: ui16;           // +0x06
}

/**
 * Database record: Cloud (4 bytes, save games only)
 */
export interface CloudRecord {
    nextObject: ObjectID;       // +0x00
    value: ui8;                 // +0x02 bits 15-8
    cloudType: ui8;             // bits 6-0
    bit7: boolean;              // bit 7
}

/**
 * Save-game Item16 record (runtime monster state)
 */
export interface Item16Record {
    facings: ui8;               // 2 bits per creature (facing)
    positions: ui8;             // 2 bits per creature, 0xFF=centered
    singleMonsterStatus: ui8[]; // 4 bytes (attacking/mirror/offset nibbles)
}

/**
 * Save-game timer record (runtime)
 */
export interface TimerRecord {
    timerWord8: ui16;           // bits 0-4 x, 5-9 y, 10-11 direction, 12-15 delta energy
}

/**
 * Union type for all database records
 */
export type DatabaseRecord =
    | DoorRecord
    | TeleporterRecord
    | TextRecord
    | ActuatorRecord
    | CreatureRecord
    | WeaponRecord
    | ClothingRecord
    | ScrollRecord
    | PotionRecord
    | ContainerRecord
    | MiscRecord
    | MissileRecord
    | CloudRecord;

/**
 * Database (one per object type)
 */
export interface Database<T = DatabaseRecord> {
    records: T[];
    count: ui16;
}

/**
 * All databases
 */
export interface Databases {
    doors: Database<DoorRecord>;
    teleporters: Database<TeleporterRecord>;
    texts: Database<TextRecord>;
    actuators: Database<ActuatorRecord>;
    creatures: Database<CreatureRecord>;
    weapons: Database<WeaponRecord>;
    clothing: Database<ClothingRecord>;
    scrolls: Database<ScrollRecord>;
    potions: Database<PotionRecord>;
    containers: Database<ContainerRecord>;
    misc: Database<MiscRecord>;
    missiles: Database<MissileRecord>;
    clouds: Database<CloudRecord>;
}

/**
 * Object list entry (for tile)
 */
export interface ObjectListEntry {
    objectID: ObjectID;
    position: Coordinates;
}

/**
 * Complete dungeon data
 */
export interface DungeonData {
    header: DungeonHeader;
    maps: MapData[];
    databases: Databases;
    textWords?: ui16[];         // Raw 5-bit encoded text words
    indirectTextIndex?: ui32[]; // Word offsets into compressedText (CSBWin indirect text)
    compressedText?: ui16[];    // Packed text words after ConvertToIndirectText
    objectList: ObjectID[];     // Object list by tile
    columnIndex: ui16[];        // Column index for object lookup
    levelIndex: ui16[];         // Level index for object lookup
    item16?: Item16Record[];    // Save-game runtime monster state
    timers?: TimerRecord[];     // Save-game timer table
    dsaLevelIndex?: number[][]; // Extended-feature DSA mapping [level][selector]
    extendedWallDecorations?: boolean; // Extended-feature flag
}
