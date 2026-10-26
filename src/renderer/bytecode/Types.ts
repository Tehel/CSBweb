/**
 * Type definitions for bytecode interpreter
 * Port from CSBWin CSB.h
 */

import { OBJECT_ID_EOF, RoomType, type ObjectID } from '../../core/types';
import type { RectPos } from '../../data/tables/UITables';

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

/**
 * What a frame of the view leaves for the interface to pick from: CSBWin's `d.` the drawing
 * writes and `HandleClickInViewport` reads (`doc/CSBwin-src/Mouse.cpp:1054-1229`).
 * `ViewportRenderer.draw` returns a new one each frame.
 */
export interface ViewportPicking {
  /** Where the nearest door switch was drawn, which a click presses (`DrawDoorSwitch`). */
  doorSwitchRects: RectPos[];
  /**
   * The six viewport buttons: 0-4 the objects drawn in the cells ahead (`DrawRoomObjects`),
   * 5 the front wall's decoration (`DrawWallDecoration`). An `x1` of 255 is none.
   */
  viewportObjectButtons: RectPos[];
  /** The object each of buttons 0-4 picks up, `RNeof` for none. */
  viewportObjectRNs: ObjectID[];
  /** `d.FacingAlcove`, `d.FacingViAltar` and `d.FacingWaterFountain`: the front wall's decoration. */
  facingAlcove: boolean;
  facingViAltar: boolean;
  facingWaterFountain: boolean;
  /** `d.CellTypeJustAhead`: the summary's `roomType` of the cell ahead, F1 (`Viewport.cpp:6789-6792`). */
  cellTypeJustAhead: RoomType | ViewRoomType;
}

/**
 * A frame's picking before anything is drawn: no button, no object, nothing faced, and
 * stone ahead, CSBWin's zeroed `d.CellTypeJustAhead`.
 */
export function emptyViewportPicking(): ViewportPicking {
  return {
    doorSwitchRects: [],
    viewportObjectButtons: Array.from({ length: 6 }, () => ({ x1: 255, x2: 0, y1: 0, y2: 0 })),
    viewportObjectRNs: new Array<ObjectID>(5).fill(OBJECT_ID_EOF),
    facingAlcove: false,
    facingViAltar: false,
    facingWaterFountain: false,
    cellTypeJustAhead: RoomType.STONE,
  };
}
