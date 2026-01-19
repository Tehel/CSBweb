/**
 * Type definitions for bytecode interpreter
 * Port from CSBWin CSB.h
 */

/**
 * RN - Record Number (reference to dungeon data)
 * In CSBWin this is typedef ui16 RN
 */
export type RN = number;

/**
 * Room type enumeration
 * From CSB.h ROOMTYPE enum
 */
export enum RoomType {
  STONE = 0,        // Wall
  OPEN = 1,         // Floor
  PIT = 2,          // Pit
  STAIRS = 3,       // Stairs
  DOOR = 4,         // Door
  TELEPORTER = 5,   // Teleporter
  FALSEWALL = 6,    // False wall
  EMPTY = 7,        // Empty (DM2)

  // Extra values used by CSBWin rendering logic (CSB.h ROOMTYPE)
  DOOR_EDGE = 16,    // Door seen on edge
  DOOR_FACING = 17,  // Door seen on flat side
  STAIR_EDGE = 18,   // Stairway at right angle to facing
  STAIR_FACING = 19, // Stairway in direction facing
  EXTERIOR = 20,     // Exterior wall of dungeon
}

/**
 * Graphic room type - used for rendering decisions
 */
export enum GraphicRoomType {
  STONE = 0,
  OPEN = 1,
  PIT = 2,
  TELEPORTER = 3,
  DOOR_EDGE = 4,
  DOOR_FACING = 5,
  STAIR_EDGE = 6,
  STAIR_FACING = 7,
}

/**
 * Summary of room data for one cell
 * Direct port from CSB.h SUMMARIZEROOMDATA (line 663)
 */
export interface SummarizeRoomData {
  x: number;
  y: number;
  relativeCellNumber: number;
  skinNumber: number;
  roomType: RoomType;
  championPortraitOrdinal: number;
  graphicRoomType: GraphicRoomType;
  rn2: RN;
  decorations: [number, number, number];  // right, front, left
  text: [RN, RN, RN];                    // right, front, left
}
