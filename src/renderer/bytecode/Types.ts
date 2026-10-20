/**
 * Type definitions for bytecode interpreter
 * Port from CSBWin CSB.h
 */

import type { ObjectID, RoomType } from '../../core/types';

/**
 * The `ROOMTYPE` values (CSB.h) only a view's summary holds, beside a cell's own
 * (`RoomType`, `src/core/types.ts`): a door or a stairway seen on its edge or its face.
 */
export enum ViewRoomType {
  DOOR_EDGE = 16,    // Door seen on edge
  DOOR_FACING = 17,  // Door seen on flat side
  STAIR_EDGE = 18,   // Stairway at right angle to facing
  STAIR_FACING = 19, // Stairway in direction facing
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
  roomType: RoomType | ViewRoomType;
  championPortraitOrdinal: number;
  graphicRoomType: GraphicRoomType;
  rn2: ObjectID;
  decorations: [number, number, number];  // right, front, left
  text: [ObjectID, ObjectID, ObjectID];                    // right, front, left
}
