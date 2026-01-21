/**
 * Core type definitions for Dungeon Master
 *
 * Based on CSBWin C++ types (CSBTypes.h)
 */

// Basic integer types (following CSBWin naming)
export type i8 = number;   // signed 8-bit
export type ui8 = number;  // unsigned 8-bit
export type i16 = number;  // signed 16-bit
export type ui16 = number; // unsigned 16-bit
export type i32 = number;  // signed 32-bit
export type ui32 = number; // unsigned 32-bit

/**
 * Direction enum (0=North, 1=East, 2=South, 3=West)
 * Following CSBWin convention
 */
export enum Direction {
    NORTH = 0,
    EAST = 1,
    SOUTH = 2,
    WEST = 3
}

/**
 * Room/Tile type (bits 5-7 of CELLFLAG)
 * CSBTypes.h line ~211
 */
export enum RoomType {
    STONE = 0,      // Wall
    OPEN = 1,       // Floor
    PIT = 2,        // Pit (can fall through)
    STAIRS = 3,     // Stairs up/down
    DOOR = 4,       // Door
    TELEPORTER = 5, // Teleporter
    FALSEWALL = 6,  // Trick wall
    EMPTY = 7       // Empty (DM II only)
}

/**
 * Database type (object category)
 * CSBTypes.h DBTYPE enum line ~213
 */
export enum DBType {
    DOOR = 0,
    TELEPORTER = 1,
    TEXT = 2,
    ACTUATOR = 3,   // Sensors, switches
    CREATURE = 4,   // Monsters
    WEAPON = 5,
    CLOTHING = 6,
    SCROLL = 7,
    POTION = 8,
    CHEST = 9,      // Containers
    MISC = 10,
    EXPOOL = 11,    // Extended pool
    DB12 = 12,      // Unused
    DB13 = 13,      // Unused
    MISSILE = 14,   // Projectiles (save games only)
    CLOUD = 15,     // Clouds (save games only)
    UNKNOWN = 16
}

/**
 * Position within a tile (2 bits)
 * Used in RN object IDs
 */
export enum TilePosition {
    NORTH = 0,      // Top-left
    EAST = 1,       // Top-right
    SOUTH = 2,      // Bottom-left
    WEST = 3        // Bottom-right
}

/**
 * Coordinates in dungeon
 */
export class Position {
    x: ui8;
    y: ui8;
    z: ui8;
    constructor(x: ui8, y: ui8, z: ui8) { this.x = x, this.y = y, this.z = z}

    clone = () => new Position(this.x, this.y, this.z)
    get north() { return new Position(this.x, this.y-1, this.z); }
    get south() { return new Position(this.x, this.y+1, this.z); }
    get east() { return new Position(this.x+1, this.y, this.z); }
    get west() { return new Position(this.x-1, this.y, this.z); }
}

/**
 * Party starting position
 */
export interface PositionOriented extends Position {
    facing: Direction;
}

/**
 * Object ID (Record Name)
 *
 * Encoding (16 bits):
 * - Bits 15-14: Position on tile (TilePosition)
 * - Bits 13-10: Category (DBType)
 * - Bits 9-0:   Index within category (0-1023)
 *
 * Special values:
 * - 0xFFFE: End of linked list
 * - 0xFFFF: Null/empty
 */
export type ObjectID = ui16;

export const OBJECT_ID_EOF = 0xFFFE;
export const OBJECT_ID_NULL = 0xFFFF;

/**
 * Decode an Object ID into its components
 */
export function decodeObjectID(id: ObjectID): {
    position: TilePosition;
    category: DBType;
    index: ui16;
} {
    return {
        position: (id >> 14) & 0x03,
        category: (id >> 10) & 0x0F,
        index: id & 0x3FF
    };
}

/**
 * Encode an Object ID from its components
 */
export function encodeObjectID(position: TilePosition, category: DBType, index: ui16): ObjectID {
    return ((position & 0x03) << 14) |
           ((category & 0x0F) << 10) |
           (index & 0x3FF);
}

/**
 * Cell flags (1 byte per tile)
 * CSBTypes.h CELLFLAG line ~177
 *
 * Bits 7-5: Room type (RoomType)
 * Bit 4:    Has objects (1=yes)
 * Bits 3-0: Type-specific attributes
 */
export type CellFlag = ui8;

/**
 * Extract room type from cell flag
 */
export function getRoomType(cellFlag: CellFlag): RoomType {
    return (cellFlag >> 5) & 0x07;
}

/**
 * Check if cell has objects
 */
export function cellHasObjects(cellFlag: CellFlag): boolean {
    return (cellFlag & 0x10) !== 0;
}

/**
 * Get type-specific attributes from cell flag
 */
export function getCellAttributes(cellFlag: CellFlag): ui8 {
    return cellFlag & 0x0F;
}

/**
 * Color in Atari ST format (12-bit RGB, 4 bits per channel)
 * Format: 0x0RGB where R,G,B are 0-7
 */
export type AtariColor = ui16;

/**
 * RGB color (8-bit per channel)
 */
export interface RGBColor {
    r: ui8;
    g: ui8;
    b: ui8;
}

/**
 * RGBA color (8-bit per channel)
 */
export interface RGBAColor extends RGBColor {
    a: ui8;
}

/**
 * Convert Atari ST color to RGB (0-255 range)
 * Each component 0-7 is multiplied by 36 to get 0-252 range
 */
export function atariToRGB(color: AtariColor): RGBColor {
    return {
        r: ((color >> 8) & 0x7) * 36,
        g: ((color >> 4) & 0x7) * 36,
        b: (color & 0x7) * 36
    };
}

/**
 * Convert Atari ST color to RGBA
 */
export function atariToRGBA(color: AtariColor, alpha: ui8 = 255): RGBAColor {
    const rgb = atariToRGB(color);
    return { ...rgb, a: alpha };
}

/**
 * Palette (16 colors)
 */
export type Palette = AtariColor[];

/**
 * Image dimensions
 */
export interface ImageDimensions {
    width: ui16;
    height: ui16;
}

export function getOrSet<K, V>(map: Map<K,V>, key: K, setter: () => V): V {
    if (!map.has(key)) map.set(key, setter())
    return map.get(key)!
}
