/**
 * Dungeon data structure types
 *
 * Based on CSBWin Data.h and CSB.h
 * Reference: doc/DUNGEON_DAT_FORMAT.md
 */

import type {
    ui8, ui16, ui32, i16,
    ObjectID,
    CellFlag,
    Position,
    Direction,
    DBType
} from '../core/types';
import type { ExtendedFeaturesBlock } from './CsbwinExtendedFeatures';
import type { RnMaps } from '../core/RnMaps';

/**
 * Dungeon header (44 bytes at offset 0x00)
 * CSB.h DUNGEONDATINDEX structure
 */
export interface DungeonHeader {
    randomSeed: ui16;           // 0x00: Dungeon ID (99=DM, 13=CSB, 8=CSB Prison)
    mapDataSize: ui16;          // 0x02: Total map data size in bytes
    numMaps: ui8;               // 0x04: Number of maps/levels — BITS8_15(word4)
    /**
     * The low byte of `DUNGEONDATINDEX::word4`, which CSBWin names nothing and reads
     * nowhere (`doc/CSBwin-src/CSB.h:2057-2068`). Zero in `dungeon.dat` and in every
     * committed save; kept so the header can be written back as it was read.
     */
    word4Low: ui8;
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
    /**
     * `LEVELDESC.FILL2[4]` (`doc/CSBwin-src/CSB.h:2092`) — four bytes between the cell
     * offset and `offsetX` that CSBWin names nothing and never swaps. Zero in
     * `dungeon.dat` and in every committed save, and kept only so that a descriptor can
     * be written back as it was read; do not invent a meaning for it.
     */
    fill2: ui8[];
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
    /**
     * `word12` bits 8-11. CSBWin declares accessors for bits 0-3 (`NumDoorDecorations`),
     * 4-7 (`numMonsterType`) and 12-15 (`experienceMultiplier`) and none for these
     * (`doc/CSBwin-src/CSB.h:2104-2126`) — but they are **not** zero in the data: the
     * fourteen DM levels carry 0, 1, 3 and 4 between them. Preserved, unread.
     */
    word12Bits8_11: ui8;

    // Door and graphics indices
    doorType0Index: ui8;
    doorType1Index: ui8;
    mapGraphicsStyle: ui8;
    floorCeilingStyle: ui8;
}

/**
 * Map data (cell flags + optional graphics indices)
 */
export interface MapData {
    descriptor: MapDescriptor;
    /**
     * [x][y] the cell flag byte, `[RoomType:3][HasObjects:1][Attributes:4]` — the one copy,
     * as CSBWin keeps one byte per cell. Unpack it where it is read (`getRoomType`,
     * `cellHasObjects` in `src/core/types.ts`).
     */
    cellFlags: CellFlag[][];

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
    /**
     * `word2` bits 9-15, which `DB0` marks `????` and declares no accessor for
     * (`doc/CSBwin-src/CSB.h:822-829`). Zero in `dungeon.dat` and in all eight
     * committed saves, but not derivable from anything else, so it is carried rather
     * than assumed. Absent on a record this engine created.
     */
    word2Bits9_15?: ui16;
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
    /**
     * The low byte of `word4`. `DB1` names only `destLevel()` = `BITS8_15(word4)`
     * (`doc/CSBwin-src/CSB.h:863-870`); bits 0-7 have no accessor. Zero everywhere
     * measured, carried so the record can be written back as it was read.
     */
    word4Low?: ui8;
}

/**
 * Database record: Text (4 bytes)
 */
export interface TextRecord {
    nextObject: ObjectID;       // +0x00
    /**
     * `DB2::index()` — `word2` bits 3-15 (`doc/CSBwin-src/CSB.h:988-1002`). **One word
     * with two meanings**, exactly as CSBWin has it: a word offset into `textWords`
     * before `ConvertToIndirectText` has run, an entry number in `indirectTextIndex`
     * after. `textStart` (`src/data/CsbwinDungeonConversions.ts`) is the one place that
     * tells the two apart; nothing else may read this and assume either.
     * There is no second field for the converted form: a save arrives already
     * converted, so one written only by the conversion would never be set for a save.
     */
    textOffset: ui16;           // +0x02 bits 15-3
    visible: boolean;           // bit 0
    /**
     * `word2` bits 1-2. `DB2` accesses bit 0 (`show`) and bits 3-15 (`index`) and
     * nothing between (`doc/CSBwin-src/CSB.h:990-1002`). Zero everywhere measured.
     */
    word2Bits1_2?: ui8;
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
/**
 * CSBWin `DB4` (doc/CSBwin-src/CSB.h:1075-1139). Sixteen bytes.
 *
 * Two fields are dual-purpose:
 *
 * - `uByte4` packs `monsterType()` in bits 0-4 and `alternateGraphics()` in bits
 *   5-7, so the type must be masked before it indexes `MonsterDescriptor[27]`.
 * - `groupIndex` (`uByte5`) is the `ITEM16` slot index while the group is on the
 *   party's level, and *is* the four packed 2-bit positions otherwise. The two
 *   readings are swapped by `AttachItem16ToMonster` / `DetachItem16`
 *   (doc/CSBwin-src/CSBCode.cpp:6087 and :6127); `Blocked()` picks between them
 *   with a bare `groupIndex() < d.MaxITEM16` test (doc/CSBwin-src/Monster.cpp:531),
 *   which works because `MoveObject` parks an off-level monster's index at 0xd8 or
 *   0xff (doc/CSBwin-src/MoveObject.cpp:517-518).
 *
 * `numMonM1` is CSBWin's own spelling and, like CSBWin, holds the group size *minus
 * one*: every reader adds the one.
 */
export interface CreatureRecord {
    nextObject: ObjectID;       // +0x00
    possession: ObjectID;       // +0x02: head of the carried-object chain
    creatureType: ui8;          // +0x04 bits 0-4: MONSTERTYPE, 0-26
    alternateGraphics: ui8;     // +0x04 bits 5-7
    groupIndex: ui8;            // +0x05: ITEM16 index, or the packed positions byte
    hp: ui16[];                 // +0x06-0x0D: hit points for up to 4 creatures
    fear: ui8;                  // +0x0E bits 0-3: STATE_OF_FEAR
    numMonM1: ui8;              // bits 5-6: group size minus one (0-3)
    facing: ui8;                // bits 8-9: direction
    important: boolean;         // bit 10
    invisible: boolean;         // bit 11 (gated on the InvisibleMonsters option)
    drawAsSize4: boolean;       // bit 12 (gated on the DrawAsSize4Monsters option)
    unique: boolean;            // bit 13: the designer tracks this monster by its ID
    poisoned: boolean;          // bit 14: DSAs only
    /**
     * `word14` bits 4, 7 and 15 — the three `DB4` declares no accessor for
     * (`doc/CSBwin-src/CSB.h:1096-1139`, which names bits 0-3, 5-6 and 8-14). Bits 4
     * and 7 are **not** zero: `dungeon.dat`'s `creature[38]` holds `word14 = 0x490`,
     * and so does every save that still carries it. Nothing here reads them.
     */
    word14Bit4?: ui8;
    word14Bit7?: ui8;
    word14Bit15?: ui8;
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
    charges: ui8;               // bits 12-9 (doc/CSBwin-src/CSB.h:1186)
    cursed: boolean;            // bit 8
    important: boolean;         // bit 7
    clothingType: ui8;          // bits 6-0
    /**
     * `word2` bits 14-15, unnamed in `DB6` (`doc/CSBwin-src/CSB.h:1176-1192`).
     * Zero everywhere measured.
     */
    word2Bits14_15?: ui8;
}

/**
 * Database record: Scroll (4 bytes)
 */
export interface ScrollRecord {
    nextObject: ObjectID;       // +0x00
    open: boolean;              // +0x02 bits 15-10: 0=open, 1=closed
    textReference: ui16;        // bits 9-0
    /**
     * The whole `DB7::m_RNtext` of the six-byte form (`doc/CSBwin-src/CSB.h:1195-1216`),
     * where `textReference` keeps only its record index. Absent in the four-byte form,
     * which has no RN at all.
     */
    textObject?: ObjectID;
    /**
     * Six-byte form: `m_word4` bits 1-15, which the struct comment calls "unused" and
     * `convertScrolls` never initialises — it writes bit 0 alone over whatever the
     * record already held (`doc/CSBwin-src/SaveGame.cpp:2144-2166`), so these bits are
     * allocation debris and carry arbitrary values in a genuine save. Carried verbatim.
     */
    word4Bits1_15?: ui16;
    /**
     * Four-byte form: `word2` bits 10-15, the old scroll's `b10_15()`
     * (`doc/CSBwin-src/CSB.h:1199-1206`). `open` is `b10_15 == 0`, so the six bits are
     * not recoverable from it; `dungeon.dat` has records with bit 10 set.
     */
    word2Bits10_15?: ui8;
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
    /**
     * The whole `DB9::m_word4` (`doc/CSBwin-src/CSB.h:1250-1263`), of which
     * `containerType` is bits 1-2. The other bits are not zero — bits 0 and 3-7 are
     * used across `dungeon.dat` and the saves — and CSBWin names none of them.
     */
    word4?: ui16;
    /** `DB9::m_uByte6[2]`, the two bytes that close the eight-byte record. */
    uByte6?: ui8[];
}

/**
 * Database record: Miscellaneous (4 bytes)
 */
export interface MiscRecord {
    nextObject: ObjectID;       // +0x00
    specialState: ui8;          // +0x02 bits 15-14 (waterskin/compass)
    important: boolean;         // bit 7
    miscType: ui8;              // bits 6-0
    /** `DB10::cursed()` — bit 8 (`doc/CSBwin-src/CSB.h:1300-1301`). Nothing reads it here. */
    cursed?: boolean;
    /** `DB10::subType()` — bits 9-13 (`doc/CSBwin-src/CSB.h:1304-1305`). */
    subType?: ui8;
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
 *
 * CSBWin `ITEM16` (doc/CSBwin-src/CSB.h:2190-2227). Sixteen bytes, one slot per
 * monster group that lives on the loaded level; `AttachItem16ToMonster` hands a
 * group its slot and `DetachItem16` gives it back (doc/CSBwin-src/CSBCode.cpp:6024
 * and :6117). A free slot is marked by `word0 < 0`.
 *
 * Everything past `singleMonsterStatus` is the movement state the AI needs, which
 * is why the port carries the whole record rather than the three render fields.
 */
export interface Item16Record {
    word0: i16;                 // +0x00: DB4 index of the group, or -1 when the slot is free
    facings: ui8;               // +0x02: 2 bits per creature (facing)
    positions: ui8;             // +0x03: 2 bits per creature, 0xFF=centered
    uByte4: ui8;                // +0x04: low byte of the next-update time (d.Time - 127 at attach)
    uByte5: ui8;                // +0x05: pause/countdown (a giggler gets STRandom(64)+20)
    uByte6: ui8;                // +0x06: mapX of the square being approached
    uByte7: ui8;                // +0x07: mapY of the square being approached
    ubPrevX: ui8;               // +0x08: previous mapX
    ubPrevY: ui8;               // +0x09: previous mapY
    uByte10: ui8;               // +0x0A: mapX when attached (AttachItem16ToMonster only)
    uByte11: ui8;               // +0x0B: mapY when attached (AttachItem16ToMonster only)
    singleMonsterStatus: ui8[]; // +0x0C: 4 bytes (attacking/mirror/offset nibbles)
}

/** A free `ITEM16` slot is flagged by a negative `word0` (CSBWin `CSBCode.cpp:6210`). */
export const ITEM16_FREE = -1;

/**
 * `SINGLE_MONSTER_STATUS` bit accessors (doc/CSBwin-src/CSB.h:2171-2188).
 *
 * Bit 7 = attacking, bit 6 = mirror the sprite, bits 0-2 and 3-5 are the two
 * signed 2-bit screen offsets the viewport applies while the monster walks.
 */
export const SMS_ATTACKING = 0x80;
export const SMS_MIRROR = 0x40;

/**
 * Save-game timer record (runtime)
 */
/**
 * One CSBWin `TIMER` (`doc/CSBwin-src/CSB.h:1799-2052`), and the whole of it.
 *
 * Every field is kept, `time` and the target included: a save that restored only the
 * action word would leave a door caught mid-close where it was, a fuse not burning and a
 * pending actuator action lost.
 *
 * The struct is 10, 12 or 16 bytes depending on two Extended Features flags, and the
 * shorter forms are not truncations but earlier versions that CSBWin converts on load
 * (`ConvertToSequencedTimers` / `ConvertToExtendedTimers`,
 * `doc/CSBwin-src/Timer.cpp:2878-2919`). This is the converted, 16-byte reading:
 *
 * ```
 *  0  ui32 m_time            big-endian. In the 16-byte form the whole 32 bits are the
 *                            time; in the shorter forms the top 8 bits are the level
 *                            and the bottom 24 the time.
 *  4  ui8  timerFunction     TIMERTYPE
 *  5  ui8  m_timerUByte5     commonly 0; a champion index for 11/12/13/72/75
 *  6  ui8  m_timerUByte6     commonly mapX
 *  7  ui8  m_timerUByte7     commonly mapY
 *  8  ui8  m_timerUByte8
 *  9  ui8  m_timerUByte9     commonly the action: set / clear / toggle
 * 10  ui16 m_timerSequence   big-endian; breaks ties between equal times
 * 12  ui8  m_timerLevel      the dungeon level this timer refers to
 * 13  ui8  unused13[3]
 * ```
 *
 * Bytes 6-7 and 8-9 are read *both* ways depending on the function: `timerObj6` and
 * `timerObj8` are RNs, `timerWord6`/`timerWord8` are 16-bit words, and `swapTimers`
 * switches on the function code to decide which (`doc/CSBwin-src/SaveGame.cpp:565-607`).
 * Both readings are kept here so a consumer does not have to re-derive them.
 */
export interface TimerRecord {
    /** `m_time`. Absolute game ticks, on the same clock as `GAMEBLOCK2.Time`. */
    time: ui32;
    /** `m_timerLevel`, or the top byte of `m_time` in the pre-extended forms. */
    level: ui8;
    /** `timerFunction` — a `TIMERTYPE`. */
    function: ui8;
    uByte5: ui8;
    uByte6: ui8;
    uByte7: ui8;
    uByte8: ui8;
    uByte9: ui8;
    /** `m_timerSequence`. Zero in a file written before sequenced timers. */
    sequence: ui16;
    /** Bytes 8-9 as one word: for a missile, bits 0-4 x, 5-9 y, 10-11 direction, 12-15 delta energy. */
    timerWord8: ui16;
    /** Bytes 6-7 as one word. Signed — `timerWord6()` returns `i16`. */
    timerWord6: number;
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
    /** What each RN names: `dataTypeMap` and `dataIndexMap` (`src/core/RnMaps.ts`). */
    rnMaps: RnMaps;
    columnIndex: ui16[];        // Column index for object lookup
    levelIndex: ui16[];         // Level index for object lookup
    item16?: Item16Record[];    // Save-game runtime monster state
    dsaLevelIndex?: number[][]; // Extended-feature DSA mapping [level][selector]
    dsaIndex?: DsaIndex;        // Extended-feature DSA programs (DSAIndex)
    /**
     * Database 11 — `EXPOOL` — as `objectCounts[11]` blocks of 256 bytes, the file's own
     * big-endian (`DB11`, `doc/CSBwin-src/CSB.h:1280-1288`), which `Expool`
     * (`src/data/CsbwinExpool.ts`) reads and writes in place. The champion bones records
     * are the ones play writes; the special locations are read out of it at the load,
     * below. The DSA global variables and the 24 overlay palette records `SaveGame`
     * deposits there just before the image (`doc/CSBwin-src/SaveGame.cpp:1141-1162`) are
     * carried as the file had them, and this port does not maintain them.
     */
    expool?: Uint8Array;
    specialLocations?: Record<number, number>; // EXPOOL special locations (EDT_SpecialLocations)
    extendedWallDecorations?: boolean; // Extended-feature flag
    /**
     * The three shape flags, all of them set by `convertOriginalDungeon`
     * (`src/data/CsbwinDungeonConversions.ts`) or by a save load. Together they say
     * whether this world is `dungeon.dat`-shaped or save-shaped, which is what the
     * image writer and the Extended Features header both have to declare.
     *
     * `bigActuators` — ACTUATOR records carry `word8` (`EF_FLAGS.BigActuators`).
     */
    bigActuators?: boolean;
    /** The text is an indirect index + compressed text (`EF_FLAGS.IndirectText`). */
    indirectText?: boolean;
    /** SCROLL records are six bytes with an RN (`ExtendedFeaturesVersion >= 'B'`). */
    newScrolls?: boolean;
    /**
     * `d.Word22592` as a compressed `dungeon.dat` gives it, its word 6
     * (`doc/CSBwin-src/SaveGame.cpp:2358`); unset for a plain one, whose new game keeps
     * the 13 `_ReadEntireGame` sets (`newGameBlock1`, `src/engine/GameContext.ts`).
     */
    word22592?: number;
    spellFilterLocation?: number; // Extended-feature spell filter location
    /**
     * The Extended Features block a `dungeon.dat` opens with, when it has one (the DM
     * Windows package's). A new game read from it takes its rule flags
     * (`readRulesOptions`, `src/data/CsbwinExtendedFeatures.ts`).
     */
    extendedFeatures?: ExtendedFeaturesBlock;
    /** The file was enciphered (`readExtendedFeatures`' `simpleEncipher`). */
    simpleEncipher?: boolean;
}

export interface HeroInventoryItem {
    rn: ObjectID;
    position: ui8;
    category: DBType;
    index: ui16;
    record: DatabaseRecord | null;
    containedItems?: HeroInventoryItem[];
}

