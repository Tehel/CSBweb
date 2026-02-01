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
    Position,
    Direction,
    DBType
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
    startPosition: Position;    // 0x08: Party start position (decoded)
    facing: Direction;
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
 * Database record: Actuator/Sensor (8 or 10 bytes with BigActuators)
 */
export interface ActuatorRecord {
    nextObject: ObjectID;       // +0x00
    word2: ui16;                // +0x02 raw actuator word2 (type + value)
    word4: ui16;                // +0x04 raw actuator word4 (behavior)
    word6: ui16;                // +0x06 raw actuator word6 (target/local)
    word8?: ui16;               // +0x08 raw actuator word8 (BigActuators only)
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
    litTorch: boolean;          // bit 15 (torches)
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
    rangeRemaining: ui8;        // +0x04
    damageRemaining: ui8;       // +0x05
    timerIndex: ui16;           // +0x06
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

export interface DsaAction {
    column: ui32;
    program: Uint16Array;
}

export interface DsaState {
    actions: DsaAction[];
}

export interface DsaDefinition {
    description: string;
    state: ui16;
    localState: ui8;
    groupId: ui8;
    numStates: ui32;
    firstDisplayedState: ui32;
    states: Array<DsaState | null>;
}

export interface DsaIndex {
    entries: Array<DsaDefinition | null>;
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
    position: Position;
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
    timerWord8Table?: ui16[];   // Save-game timerWord8 table (by timer index)
    item16?: Item16Record[];    // Save-game runtime monster state
    dsaLevelIndex?: number[][]; // Extended-feature DSA mapping [level][selector]
    dsaIndex?: DsaIndex;        // Extended-feature DSA programs (DSAIndex)
    specialLocations?: Record<number, number>; // EXPOOL special locations (EDT_SpecialLocations)
    extendedWallDecorations?: boolean; // Extended-feature flag
    bigActuators?: boolean;     // Extended-feature flag
    spellFilterLocation?: number; // Extended-feature spell filter location
    presetHeroes?: PresetHero[]; // Preset champions extracted from dungeon data
}

export interface HeroInventoryItem {
    rn: ObjectID;
    position: ui8;
    category: DBType;
    index: ui16;
    record: DatabaseRecord | null;
    containedItems?: HeroInventoryItem[];
}

export interface PresetHero {
    textRecordIndex: ui16;
    textOffset: ui16;
    portraitIndex: ui16;
    name: string;
    title: string;
    gender: string;
    health: ui16;
    stamina: ui16;
    mana: ui16;
    luck: ui8;
    strength: ui8;
    dexterity: ui8;
    wisdom: ui8;
    vitality: ui8;
    antiMagic: ui8;
    antiFire: ui8;
    fighter: Record<string, ui8>;
    ninja: Record<string, ui8>;
    priest: Record<string, ui8>;
    wizard: Record<string, ui8>;
    location: { map: ui8; x: ui8; y: ui8; wall: ui8 };
    inventory: HeroInventoryItem[];
}
