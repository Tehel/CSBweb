/**
 * Bytecode Programs - Complete port from CSBWin Viewport.cpp lines 950-2735
 *
 * This is a MECHANICAL LINE-BY-LINE PORT from CSBWin C++ source code.
 * All 168 bytecode programs organized by cell and room type.
 *
 * Source: doc/CSBWIN_VIEWPORT_REFERENCE.md (extracted from CSBWin)
 */

import { Opcode } from './Opcodes';

// =============================================================================
// F0 PROGRAMS (distance 0 - center)
// =============================================================================

export const StdDrawF0Stone: number[] = [
  Opcode.F0,
  Opcode.F0xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0Contents,
  Opcode.F0xy,
  Opcode.F0,
  Opcode.DrawOrder21,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF0Open: number[] = [
  Opcode.F0,
  Opcode.F0xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0Contents,
  Opcode.F0xy,
  Opcode.F0,
  Opcode.DrawOrder21,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF0Pit: number[] = [
  Opcode.F0,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  4,
  Opcode.Literal,
  62,
  Opcode.Jump,
  2,
  Opcode.Literal,
  56,
  Opcode.StdFloorPitRectangleF0,
  Opcode.StdGraphicToViewport,
  Opcode.F0,
  Opcode.F0xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0Contents,
  Opcode.F0xy,
  Opcode.F0,
  Opcode.DrawOrder21,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF0Teleporter: number[] = [
  Opcode.F0,
  Opcode.F0xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0Contents,
  Opcode.F0xy,
  Opcode.F0,
  Opcode.DrawOrder21,
  Opcode.StdDrawRoomObjects,
  Opcode.F0,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  3,
  Opcode.StdTeleporterRectangleF0,
  Opcode.StdWallRectangleF0,
  Opcode.StdDrawTeleporter,
  Opcode.Return,
];

export const StdDrawF0StairFacing: number[] = [
  Opcode.F0,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  8,
  Opcode.StdStairFacingUpGraphicF0,
  Opcode.StdStairFacingUpRectangleF0L,
  Opcode.StdGraphicToViewport,
  Opcode.StdStairFacingUpGraphicF0,
  Opcode.StdStairFacingUpRectangleF0R,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.Jump,
  6,
  Opcode.StdStairFacingDownGraphicF0,
  Opcode.StdStairFacingDownRectangleF0L,
  Opcode.StdGraphicToViewport,
  Opcode.StdStairFacingDownGraphicF0,
  Opcode.StdStairFacingDownRectangleF0R,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.F0,
  Opcode.F0xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0Contents,
  Opcode.F0xy,
  Opcode.F0,
  Opcode.DrawOrder21,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF0StairEdge: number[] = [
  Opcode.F0,
  Opcode.F0xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0Contents,
  Opcode.F0xy,
  Opcode.F0,
  Opcode.DrawOrder21,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF0DoorEdge: number[] = [
  Opcode.SeeThroughWalls,
  Opcode.JumpZ,
  3,
  Opcode.StdDrawSeeThruDoorEdge,
  Opcode.Jump,
  3,
  Opcode.StdDoorEdgeFrameBitmapF0,
  Opcode.StdDoorEdgeFrameRectF0,
  Opcode.StdBltShapeToViewport,
  Opcode.F0,
  Opcode.F0xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0Contents,
  Opcode.F0xy,
  Opcode.F0,
  Opcode.DrawOrder21,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF0DoorFacing: number[] = [
  Opcode.F0,
  Opcode.F0xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0Contents,
  Opcode.F0xy,
  Opcode.F0,
  Opcode.DrawOrder21,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

// =============================================================================
// F0L1 PROGRAMS (distance 0 - left side)
// =============================================================================

export const StdDrawF0L1Stone: number[] = [
  Opcode.StdWallBitmapF0L1,
  Opcode.StdWallRectangleF0L1,
  Opcode.StdBltShape,
  Opcode.Return,
];

export const StdDrawF0L1Open: number[] = [
  Opcode.F0L1Contents,
  Opcode.F0L1xy,
  Opcode.F0L1,
  Opcode.DrawOrder02,
  Opcode.StdDrawRoomObjects,
  Opcode.F0L1,
  Opcode.F0L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.Return,
];

export const StdDrawF0L1Pit: number[] = [
  Opcode.F0L1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  4,
  Opcode.Literal,
  61,
  Opcode.Jump,
  2,
  Opcode.Literal,
  55,
  Opcode.StdFloorPitRectangleF0L1,
  Opcode.StdGraphicToViewport,
  Opcode.F0L1Contents,
  Opcode.F0L1xy,
  Opcode.F0L1,
  Opcode.DrawOrder02,
  Opcode.StdDrawRoomObjects,
  Opcode.F0L1,
  Opcode.F0L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.Return,
];

export const StdDrawF0L1Teleporter: number[] = [
  Opcode.F0L1Contents,
  Opcode.F0L1xy,
  Opcode.F0L1,
  Opcode.DrawOrder02,
  Opcode.StdDrawRoomObjects,
  Opcode.F0L1,
  Opcode.F0L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0L1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  3,
  Opcode.StdTeleporterRectangleF0L1,
  Opcode.StdWallRectangleF0L1,
  Opcode.StdDrawTeleporter,
  Opcode.Return,
];

export const StdDrawF0L1StairFacing: number[] = [
  Opcode.Return,
];

export const StdDrawF0L1StairEdge: number[] = [
  Opcode.StdStairEdgeGraphicF0L1,
  Opcode.StdStairEdgeRectF0L1,
  Opcode.StdGraphicToViewport,
  Opcode.Return,
];

export const StdDrawF0L1DoorEdge: number[] = [
  Opcode.F0L1,
  Opcode.F0L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0L1,
  Opcode.F0L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.Return,
];

export const StdDrawF0L1DoorFacing: number[] = [
  Opcode.Return,
];

// =============================================================================
// F0R1 PROGRAMS (distance 0 - right side)
// =============================================================================

export const StdDrawF0R1Stone: number[] = [
  Opcode.StdWallBitmapF0R1,
  Opcode.StdWallRectangleF0R1,
  Opcode.StdBltShape,
  Opcode.Return,
];

export const StdDrawF0R1Open: number[] = [
  Opcode.F0R1,
  Opcode.F0R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0R1Contents,
  Opcode.F0R1xy,
  Opcode.F0R1,
  Opcode.DrawOrder01,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF0R1Pit: number[] = [
  Opcode.F0R1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  4,
  Opcode.Literal,
  61,
  Opcode.Jump,
  2,
  Opcode.Literal,
  55,
  Opcode.StdFloorPitRectangleF0R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.F0R1,
  Opcode.F0R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0R1Contents,
  Opcode.F0R1xy,
  Opcode.F0R1,
  Opcode.DrawOrder01,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF0R1Teleporter: number[] = [
  Opcode.F0R1,
  Opcode.F0R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0R1Contents,
  Opcode.F0R1xy,
  Opcode.F0R1,
  Opcode.DrawOrder01,
  Opcode.StdDrawRoomObjects,
  Opcode.F0R1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  3,
  Opcode.StdTeleporterRectangleF0R1,
  Opcode.StdWallRectangleF0R1,
  Opcode.StdDrawTeleporter,
  Opcode.Return,
];

export const StdDrawF0R1StairFacing: number[] = [
  Opcode.Return,
];

export const StdDrawF0R1StairEdge: number[] = [
  Opcode.StdStairEdgeGraphicF0R1,
  Opcode.StdStairEdgeRectF0R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.Return,
];

export const StdDrawF0R1DoorEdge: number[] = [
  Opcode.F0R1,
  Opcode.F0R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0R1,
  Opcode.F0R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.Return,
];

export const StdDrawF0R1DoorFacing: number[] = [
  Opcode.Return,
];

// =============================================================================
// F1 PROGRAMS (distance 1 - center)
// =============================================================================

export const StdDrawF1Stone: number[] = [
  Opcode.SeeThroughWalls,
  Opcode.JumpZ,
  28,
  Opcode.Literal,
  1,
  Opcode.StdAllocateDerivedGraphic,
  Opcode.StdBitmapViewport,
  1,
  112,
  48,
  1,
  48,
  48,
  10,
  Opcode.StdWallBitmapF1,
  Opcode.StdWallRectangleF1,
  Opcode.StdBltShape,
  Opcode.F1,
  Opcode.wallDecorationFront,
  Opcode.WallF1Front,
  Opcode.StdDrawWallDecoration,
  Opcode.F1,
  Opcode.wallDecorationFront,
  Opcode.HasDecoration,
  Opcode.JumpZ,
  1,
  Opcode.LeaveMortarJoint,
  Opcode.F1,
  Opcode.wallDecorationFront,
  Opcode.WallF1Front,
  Opcode.StdDrawWallText,
  Opcode.Alcove,
  Opcode.JumpZ,
  5,
  Opcode.F1Contents,
  Opcode.F1xy,
  Opcode.F1,
  Opcode.DrawOrder00,
  Opcode.StdDrawRoomObjects,
  Opcode.SeeThroughWalls,
  Opcode.JumpZ,
  16,
  Opcode.Literal,
  1,
  48,
  112,
  9,
  Opcode.Literal,
  1,
  Opcode.StdDeleteDerivedGraphic,
  Opcode.Return,
];

export const StdDrawF1Open: number[] = [
  Opcode.F1,
  Opcode.FloorDecorationGraphicOrdinalF1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1,
  Opcode.F1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1Contents,
  Opcode.F1xy,
  Opcode.F1,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF1Pit: number[] = [
  Opcode.F1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  4,
  Opcode.Literal,
  60,
  Opcode.Jump,
  2,
  Opcode.Literal,
  54,
  Opcode.StdFloorPitRectangleF1,
  Opcode.StdGraphicToViewport,
  Opcode.F1,
  Opcode.FloorDecorationGraphicOrdinalF1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1,
  Opcode.F1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1Contents,
  Opcode.F1xy,
  Opcode.F1,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF1Teleporter: number[] = [
  Opcode.F1,
  Opcode.FloorDecorationGraphicOrdinalF1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1,
  Opcode.F1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1Contents,
  Opcode.F1xy,
  Opcode.F1,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.F1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  3,
  Opcode.StdTeleporterRectangleF1,
  Opcode.StdWallRectangleF1,
  Opcode.StdDrawTeleporter,
  Opcode.Return,
];

export const StdDrawF1StairFacing: number[] = [
  Opcode.F1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  5,
  Opcode.StdStairFacingUpGraphicF1,
  Opcode.StdStairFacingUpRectangleF1,
  Opcode.StdGraphicToViewport,
  Opcode.Jump,
  3,
  Opcode.StdStairFacingDownGraphicF1,
  Opcode.StdStairFacingDownRectangleF1,
  Opcode.StdGraphicToViewport,
  Opcode.F1,
  Opcode.FloorDecorationGraphicOrdinalF1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1,
  Opcode.F1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1Contents,
  Opcode.F1xy,
  Opcode.F1,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF1StairEdge: number[] = [
  Opcode.Return,
];

export const StdDrawF1DoorEdge: number[] = [
  Opcode.Return,
];

export const StdDrawF1DoorFacing: number[] = [
  Opcode.F1,
  Opcode.FloorDecorationGraphicOrdinalF1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1Contents,
  Opcode.F1xy,
  Opcode.F1,
  Opcode.DrawOrder218,
  Opcode.StdDrawRoomObjects,
  Opcode.StdDoorFacingTopTrackBitmapF1,
  Opcode.StdDoorFacingTopTrackRectF1,
  Opcode.StdBltShapeToViewport,
  Opcode.StdDoorFacingFrameLeftBitmapF1,
  Opcode.StdDoorFacingFrameLeftRectF1,
  Opcode.StdBltShapeToViewport,
  Opcode.StdDoorFacingFrameRightBitmapF1,
  Opcode.StdDoorFacingFrameRightRectF1,
  Opcode.StdBltShapeToViewport,
  Opcode.F1,
  Opcode.DoorSwitch,
  Opcode.JumpZ,
  5,
  Opcode.Literal,
  1,
  Opcode.Literal,
  3,
  Opcode.StdDrawDoorSwitch,
  Opcode.F1DoorRecordIndex,
  Opcode.F1DoorState,
  Opcode.StdDoorGraphicsF1,
  Opcode.StdDoorRectsF1,
  Opcode.StdDrawDoor,
  Opcode.F1Contents,
  Opcode.F1xy,
  Opcode.F1,
  Opcode.DrawOrder349,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

// =============================================================================
// F1L1 PROGRAMS (distance 1 - left side)
// =============================================================================

export const StdDrawF1L1Stone: number[] = [
  Opcode.StdWallBitmapF1L1,
  Opcode.StdWallRectangleF1L1,
  Opcode.StdBltShape,
  Opcode.F1L1,
  Opcode.wallDecorationRight,
  Opcode.WallF1L1Right,
  Opcode.StdDrawWallText,
  Opcode.F1L1,
  Opcode.wallDecorationRight,
  Opcode.WallF1L1Right,
  Opcode.StdDrawWallDecoration,
  Opcode.Return,
];

export const StdDrawF1L1Open: number[] = [
  Opcode.F1L1,
  Opcode.FloorDecorationGraphicOrdinalF1L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1L1,
  Opcode.F1L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1L1Contents,
  Opcode.F1L1xy,
  Opcode.F1L1,
  Opcode.DrawOrder32,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF1L1Pit: number[] = [
  Opcode.F1L1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  4,
  Opcode.Literal,
  59,
  Opcode.Jump,
  2,
  Opcode.Literal,
  53,
  Opcode.StdFloorPitRectangleF1L1,
  Opcode.StdGraphicToViewport,
  Opcode.F1L1,
  Opcode.FloorDecorationGraphicOrdinalF1L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1L1,
  Opcode.F1L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1L1Contents,
  Opcode.F1L1xy,
  Opcode.F1L1,
  Opcode.DrawOrder32,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF1L1Teleporter: number[] = [
  Opcode.F1L1,
  Opcode.FloorDecorationGraphicOrdinalF1L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1L1,
  Opcode.F1L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1L1Contents,
  Opcode.F1L1xy,
  Opcode.F1L1,
  Opcode.DrawOrder32,
  Opcode.StdDrawRoomObjects,
  Opcode.F1L1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  3,
  Opcode.StdTeleporterRectangleF1L1,
  Opcode.StdWallRectangleF1L1,
  Opcode.StdDrawTeleporter,
  Opcode.Return,
];

export const StdDrawF1L1StairFacing: number[] = [
  Opcode.F1L1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  5,
  Opcode.StdStairFacingUpGraphicF1L1,
  Opcode.StdStairFacingUpRectangleF1L1,
  Opcode.StdGraphicToViewport,
  Opcode.Jump,
  3,
  Opcode.StdStairFacingDownGraphicF1L1,
  Opcode.StdStairFacingDownRectangleF1L1,
  Opcode.StdGraphicToViewport,
  Opcode.F1L1,
  Opcode.FloorDecorationGraphicOrdinalF1L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1L1,
  Opcode.F1L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1L1Contents,
  Opcode.F1L1xy,
  Opcode.F1L1,
  Opcode.DrawOrder32,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF1L1StairEdge: number[] = [
  Opcode.F1L1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  5,
  Opcode.StdStairEdgeGraphicUpF1,
  Opcode.StdStairEdgeUpRectF1L1,
  Opcode.StdGraphicToViewport,
  Opcode.Jump,
  3,
  Opcode.StdStairEdgeGraphicDownF1,
  Opcode.StdStairEdgeDownRectF1L1,
  Opcode.StdGraphicToViewport,
  Opcode.F1L1,
  Opcode.FloorDecorationGraphicOrdinalF1L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1L1,
  Opcode.F1L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1L1Contents,
  Opcode.F1L1xy,
  Opcode.F1L1,
  Opcode.DrawOrder32,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF1L1DoorEdge: number[] = [
  Opcode.F1L1,
  Opcode.FloorDecorationGraphicOrdinalF1L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1L1,
  Opcode.F1L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1L1Contents,
  Opcode.F1L1xy,
  Opcode.F1L1,
  Opcode.DrawOrder32,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF1L1DoorFacing: number[] = [
  Opcode.F1L1,
  Opcode.FloorDecorationGraphicOrdinalF1L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1L1Contents,
  Opcode.F1L1xy,
  Opcode.F1L1,
  Opcode.DrawOrder28,
  Opcode.StdDrawRoomObjects,
  Opcode.StdDoorFacingTopTrackBitmapF1,
  Opcode.StdDoorFacingTopTrackRectF1L1,
  Opcode.StdBltShapeToViewport,
  Opcode.F1L1DoorRecordIndex,
  Opcode.F1L1DoorState,
  Opcode.StdDoorGraphicsF1,
  Opcode.StdDoorRectsF1L1,
  Opcode.StdDrawDoor,
  Opcode.F1L1Contents,
  Opcode.F1L1xy,
  Opcode.F1L1,
  Opcode.DrawOrder39,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

// =============================================================================
// F1R1 PROGRAMS (distance 1 - right side)
// =============================================================================

export const StdDrawF1R1Stone: number[] = [
  Opcode.StdWallBitmapF1R1,
  Opcode.StdWallRectangleF1R1,
  Opcode.StdBltShape,
  Opcode.F1R1,
  Opcode.wallDecorationLeft,
  Opcode.WallF1R1Left,
  Opcode.StdDrawWallText,
  Opcode.F1R1,
  Opcode.wallDecorationLeft,
  Opcode.WallF1R1Left,
  Opcode.StdDrawWallDecoration,
  Opcode.Return,
];

export const StdDrawF1R1Open: number[] = [
  Opcode.F1R1,
  Opcode.FloorDecorationGraphicOrdinalF1R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1R1,
  Opcode.F1R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1R1Contents,
  Opcode.F1R1xy,
  Opcode.F1R1,
  Opcode.DrawOrder41,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF1R1Pit: number[] = [
  Opcode.F1R1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  4,
  Opcode.Literal,
  59,
  Opcode.Jump,
  2,
  Opcode.Literal,
  53,
  Opcode.StdFloorPitRectangleF1R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.F1R1,
  Opcode.FloorDecorationGraphicOrdinalF1R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1R1,
  Opcode.F1R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1R1Contents,
  Opcode.F1R1xy,
  Opcode.F1R1,
  Opcode.DrawOrder41,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF1R1Teleporter: number[] = [
  Opcode.F1R1,
  Opcode.FloorDecorationGraphicOrdinalF1R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1R1,
  Opcode.F1R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1R1Contents,
  Opcode.F1R1xy,
  Opcode.F1R1,
  Opcode.DrawOrder41,
  Opcode.StdDrawRoomObjects,
  Opcode.F1R1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  3,
  Opcode.StdTeleporterRectangleF1R1,
  Opcode.StdWallRectangleF1R1,
  Opcode.StdDrawTeleporter,
  Opcode.Return,
];

export const StdDrawF1R1StairFacing: number[] = [
  Opcode.F1R1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  5,
  Opcode.StdStairFacingUpGraphicF1R1,
  Opcode.StdStairFacingUpRectangleF1R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.Jump,
  3,
  Opcode.StdStairFacingDownGraphicF1R1,
  Opcode.StdStairFacingDownRectangleF1R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.F1R1,
  Opcode.FloorDecorationGraphicOrdinalF1R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1R1,
  Opcode.F1R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1R1Contents,
  Opcode.F1R1xy,
  Opcode.F1R1,
  Opcode.DrawOrder41,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF1R1StairEdge: number[] = [
  Opcode.F1R1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  5,
  Opcode.StdStairEdgeGraphicUpF1,
  Opcode.StdStairEdgeUpRectF1R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.Jump,
  3,
  Opcode.StdStairEdgeGraphicDownF1,
  Opcode.StdStairEdgeDownRectF1R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.F1R1,
  Opcode.FloorDecorationGraphicOrdinalF1R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1R1,
  Opcode.F1R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1R1Contents,
  Opcode.F1R1xy,
  Opcode.F1R1,
  Opcode.DrawOrder41,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF1R1DoorEdge: number[] = [
  Opcode.F1R1,
  Opcode.FloorDecorationGraphicOrdinalF1R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1R1,
  Opcode.F1R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F1R1Contents,
  Opcode.F1R1xy,
  Opcode.F1R1,
  Opcode.DrawOrder41,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF1R1DoorFacing: number[] = [
  Opcode.F1R1,
  Opcode.FloorDecorationGraphicOrdinalF1R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F1R1Contents,
  Opcode.F1R1xy,
  Opcode.F1R1,
  Opcode.DrawOrder18,
  Opcode.StdDrawRoomObjects,
  Opcode.StdDoorFacingTopTrackBitmapF1,
  Opcode.StdDoorFacingTopTrackRectF1R1,
  Opcode.StdBltShapeToViewport,
  Opcode.F1R1DoorRecordIndex,
  Opcode.F1R1DoorState,
  Opcode.StdDoorGraphicsF1,
  Opcode.StdDoorRectsF1R1,
  Opcode.StdDrawDoor,
  Opcode.F1R1Contents,
  Opcode.F1R1xy,
  Opcode.F1R1,
  Opcode.DrawOrder49,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

// =============================================================================
// F2 PROGRAMS (distance 2 - center)
// =============================================================================

export const StdDrawF2Stone: number[] = [
  Opcode.StdWallBitmapF2,
  Opcode.StdWallRectangleF2,
  Opcode.StdBltShape,
  Opcode.F2,
  Opcode.wallDecorationFront,
  Opcode.WallF2Front,
  Opcode.StdDrawWallText,
  Opcode.F2,
  Opcode.wallDecorationFront,
  Opcode.WallF2Front,
  Opcode.StdDrawWallDecoration,
  Opcode.Alcove,
  Opcode.JumpZ,
  5,
  Opcode.F2Contents,
  Opcode.F2xy,
  Opcode.F2,
  Opcode.DrawOrder00,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2Open: number[] = [
  Opcode.F2,
  Opcode.FloorDecorationGraphicOrdinalF2,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2,
  Opcode.F2xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2Contents,
  Opcode.F2xy,
  Opcode.F2,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2Pit: number[] = [
  Opcode.F2,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  4,
  Opcode.Literal,
  58,
  Opcode.Jump,
  2,
  Opcode.Literal,
  52,
  Opcode.StdFloorPitRectangleF2,
  Opcode.StdGraphicToViewport,
  Opcode.F2,
  Opcode.FloorDecorationGraphicOrdinalF2,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2,
  Opcode.F2xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2Contents,
  Opcode.F2xy,
  Opcode.F2,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2Teleporter: number[] = [
  Opcode.F2,
  Opcode.FloorDecorationGraphicOrdinalF2,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2,
  Opcode.F2xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2Contents,
  Opcode.F2xy,
  Opcode.F2,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.F2,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  3,
  Opcode.StdTeleporterRectangleF2,
  Opcode.StdWallRectangleF2,
  Opcode.StdDrawTeleporter,
  Opcode.Return,
];

export const StdDrawF2StairFacing: number[] = [
  Opcode.F2,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  5,
  Opcode.StdStairFacingUpGraphicF2,
  Opcode.StdStairFacingUpRectangleF2,
  Opcode.StdGraphicToViewport,
  Opcode.Jump,
  3,
  Opcode.StdStairFacingDownGraphicF2,
  Opcode.StdStairFacingDownRectangleF2,
  Opcode.StdGraphicToViewport,
  Opcode.F2,
  Opcode.FloorDecorationGraphicOrdinalF2,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2,
  Opcode.F2xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2Contents,
  Opcode.F2xy,
  Opcode.F2,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2StairEdge: number[] = [
  Opcode.Return,
];

export const StdDrawF2DoorEdge: number[] = [
  Opcode.Return,
];

export const StdDrawF2DoorFacing: number[] = [
  Opcode.F2,
  Opcode.FloorDecorationGraphicOrdinalF2,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2Contents,
  Opcode.F2xy,
  Opcode.F2,
  Opcode.DrawOrder218,
  Opcode.StdDrawRoomObjects,
  Opcode.StdDoorFacingTopTrackBitmapF2,
  Opcode.StdDoorFacingTopTrackRectF2,
  Opcode.StdBltShapeToViewport,
  Opcode.StdDoorFacingFrameLeftBitmapF2,
  Opcode.StdDoorFacingFrameLeftRectF2,
  Opcode.StdBltShapeToViewport,
  Opcode.StdDoorFacingFrameLeftBitmapF2,
  Opcode.StdDoorFacingFrameRightRectF2,
  Opcode.StdMirrorShapeToViewport,
  Opcode.F2,
  Opcode.DoorSwitch,
  Opcode.JumpZ,
  5,
  Opcode.Literal,
  1,
  Opcode.Literal,
  2,
  Opcode.StdDrawDoorSwitch,
  Opcode.F2DoorRecordIndex,
  Opcode.F2DoorState,
  Opcode.StdDoorGraphicsF2,
  Opcode.StdDoorRectsF2,
  Opcode.StdDrawDoor,
  Opcode.F2Contents,
  Opcode.F2xy,
  Opcode.F2,
  Opcode.DrawOrder349,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

// =============================================================================
// F2L1 PROGRAMS (distance 2 - left side)
// =============================================================================

export const StdDrawF2L1Stone: number[] = [
  Opcode.StdWallBitmapF2L1,
  Opcode.StdWallRectangleF2L1,
  Opcode.StdBltShape,
  Opcode.F2L1,
  Opcode.wallDecorationRight,
  Opcode.WallF2L1Right,
  Opcode.StdDrawWallText,
  Opcode.F2L1,
  Opcode.wallDecorationRight,
  Opcode.WallF2L1Right,
  Opcode.StdDrawWallDecoration,
  Opcode.F2L1,
  Opcode.wallDecorationFront,
  Opcode.WallF2L1Front,
  Opcode.StdDrawWallText,
  Opcode.F2L1,
  Opcode.wallDecorationFront,
  Opcode.WallF2L1Front,
  Opcode.StdDrawWallDecoration,
  Opcode.Alcove,
  Opcode.JumpZ,
  5,
  Opcode.F2L1Contents,
  Opcode.F2L1xy,
  Opcode.F2L1,
  Opcode.DrawOrder00,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2L1Open: number[] = [
  Opcode.F2L1,
  Opcode.FloorDecorationGraphicOrdinalF2L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2L1,
  Opcode.F2L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2L1Contents,
  Opcode.F2L1xy,
  Opcode.F2L1,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2L1Pit: number[] = [
  Opcode.F2L1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  4,
  Opcode.Literal,
  57,
  Opcode.Jump,
  2,
  Opcode.Literal,
  51,
  Opcode.StdFloorPitRectangleF2L1,
  Opcode.StdGraphicToViewport,
  Opcode.F2L1,
  Opcode.FloorDecorationGraphicOrdinalF2L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2L1,
  Opcode.F2L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2L1Contents,
  Opcode.F2L1xy,
  Opcode.F2L1,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2L1Teleporter: number[] = [
  Opcode.F2L1,
  Opcode.FloorDecorationGraphicOrdinalF2L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2L1,
  Opcode.F2L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2L1Contents,
  Opcode.F2L1xy,
  Opcode.F2L1,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.F2L1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  3,
  Opcode.StdTeleporterRectangleF2L1,
  Opcode.StdWallRectangleF2L1,
  Opcode.StdDrawTeleporter,
  Opcode.Return,
];

export const StdDrawF2L1StairFacing: number[] = [
  Opcode.F2L1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  5,
  Opcode.StdStairFacingUpGraphicF2L1,
  Opcode.StdStairFacingUpRectangleF2L1,
  Opcode.StdGraphicToViewport,
  Opcode.Jump,
  3,
  Opcode.StdStairFacingDownGraphicF2L1,
  Opcode.StdStairFacingDownRectangleF2L1,
  Opcode.StdGraphicToViewport,
  Opcode.F2L1,
  Opcode.FloorDecorationGraphicOrdinalF2L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2L1,
  Opcode.F2L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2L1Contents,
  Opcode.F2L1xy,
  Opcode.F2L1,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2L1StairEdge: number[] = [
  Opcode.StdStairEdgeGraphicF2,
  Opcode.StdStairEdgeRectF2L1,
  Opcode.StdGraphicToViewport,
  Opcode.F2L1,
  Opcode.FloorDecorationGraphicOrdinalF2L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2L1,
  Opcode.F2L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2L1Contents,
  Opcode.F2L1xy,
  Opcode.F2L1,
  Opcode.DrawOrder342,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2L1DoorEdge: number[] = [
  Opcode.F2L1,
  Opcode.FloorDecorationGraphicOrdinalF2L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2L1,
  Opcode.F2L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2L1Contents,
  Opcode.F2L1xy,
  Opcode.F2L1,
  Opcode.DrawOrder342,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2L1DoorFacing: number[] = [
  Opcode.F2L1,
  Opcode.FloorDecorationGraphicOrdinalF2L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2L1Contents,
  Opcode.F2L1xy,
  Opcode.F2L1,
  Opcode.DrawOrder218,
  Opcode.StdDrawRoomObjects,
  Opcode.StdDoorFacingTopTrackBitmapF2,
  Opcode.StdDoorFacingTopTrackRectF2L1,
  Opcode.StdBltShapeToViewport,
  Opcode.F2L1DoorRecordIndex,
  Opcode.F2L1DoorState,
  Opcode.StdDoorGraphicsF2,
  Opcode.StdDoorRectsF2L1,
  Opcode.StdDrawDoor,
  Opcode.F2L1,
  Opcode.F2L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2L1Contents,
  Opcode.F2L1xy,
  Opcode.F2L1,
  Opcode.DrawOrder349,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

// =============================================================================
// F2R1 PROGRAMS (distance 2 - right side)
// =============================================================================

export const StdDrawF2R1Stone: number[] = [
  Opcode.StdWallBitmapF2R1,
  Opcode.StdWallRectangleF2R1,
  Opcode.StdBltShape,
  Opcode.F2R1,
  Opcode.wallDecorationLeft,
  Opcode.WallF2R1Left,
  Opcode.StdDrawWallText,
  Opcode.F2R1,
  Opcode.wallDecorationLeft,
  Opcode.WallF2R1Left,
  Opcode.StdDrawWallDecoration,
  Opcode.F2R1,
  Opcode.wallDecorationFront,
  Opcode.WallF2R1Front,
  Opcode.StdDrawWallText,
  Opcode.F2R1,
  Opcode.wallDecorationFront,
  Opcode.WallF2R1Front,
  Opcode.StdDrawWallDecoration,
  Opcode.Alcove,
  Opcode.JumpZ,
  5,
  Opcode.F2R1Contents,
  Opcode.F2R1xy,
  Opcode.F2R1,
  Opcode.DrawOrder00,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2R1Open: number[] = [
  Opcode.F2R1,
  Opcode.FloorDecorationGraphicOrdinalF2R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2R1,
  Opcode.F2R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2R1Contents,
  Opcode.F2R1xy,
  Opcode.F2R1,
  Opcode.DrawOrder4312,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2R1Pit: number[] = [
  Opcode.F2R1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  4,
  Opcode.Literal,
  57,
  Opcode.Jump,
  2,
  Opcode.Literal,
  51,
  Opcode.StdFloorPitRectangleF2R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.F2R1,
  Opcode.FloorDecorationGraphicOrdinalF2R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2R1,
  Opcode.F2R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2R1Contents,
  Opcode.F2R1xy,
  Opcode.F2R1,
  Opcode.DrawOrder4312,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2R1Teleporter: number[] = [
  Opcode.F2R1,
  Opcode.FloorDecorationGraphicOrdinalF2R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2R1,
  Opcode.F2R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2R1Contents,
  Opcode.F2R1xy,
  Opcode.F2R1,
  Opcode.DrawOrder4312,
  Opcode.StdDrawRoomObjects,
  Opcode.F2R1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  3,
  Opcode.StdTeleporterRectangleF2R1,
  Opcode.StdWallRectangleF2R1,
  Opcode.StdDrawTeleporter,
  Opcode.Return,
];

export const StdDrawF2R1StairFacing: number[] = [
  Opcode.F2R1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  5,
  Opcode.StdStairFacingUpGraphicF2R1,
  Opcode.StdStairFacingUpRectangleF2R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.Jump,
  3,
  Opcode.StdStairFacingDownGraphicF2R1,
  Opcode.StdStairFacingDownRectangleF2R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.F2R1,
  Opcode.FloorDecorationGraphicOrdinalF2R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2R1,
  Opcode.F2R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2R1Contents,
  Opcode.F2R1xy,
  Opcode.F2R1,
  Opcode.DrawOrder4312,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2R1StairEdge: number[] = [
  Opcode.StdStairEdgeGraphicF2,
  Opcode.StdStairEdgeRectF2R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.F2R1,
  Opcode.FloorDecorationGraphicOrdinalF2R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2R1,
  Opcode.F2R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2R1Contents,
  Opcode.F2R1xy,
  Opcode.F2R1,
  Opcode.DrawOrder431,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2R1DoorEdge: number[] = [
  Opcode.F2R1,
  Opcode.FloorDecorationGraphicOrdinalF2R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2R1,
  Opcode.F2R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F2R1Contents,
  Opcode.F2R1xy,
  Opcode.F2R1,
  Opcode.DrawOrder431,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF2R1DoorFacing: number[] = [
  Opcode.F2R1,
  Opcode.FloorDecorationGraphicOrdinalF2R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F2R1Contents,
  Opcode.F2R1xy,
  Opcode.F2R1,
  Opcode.DrawOrder128,
  Opcode.StdDrawRoomObjects,
  Opcode.StdDoorFacingTopTrackBitmapF2,
  Opcode.StdDoorFacingTopTrackRectF2R1,
  Opcode.StdBltShapeToViewport,
  Opcode.F2R1DoorRecordIndex,
  Opcode.F2R1DoorState,
  Opcode.StdDoorGraphicsF2,
  Opcode.StdDoorRectsF2R1,
  Opcode.StdDrawDoor,
  Opcode.F2R1Contents,
  Opcode.F2R1xy,
  Opcode.F2R1,
  Opcode.DrawOrder439,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

// =============================================================================
// F3 PROGRAMS (distance 3 - center)
// =============================================================================

export const StdDrawF3Stone: number[] = [
  Opcode.StdWallBitmapF3,
  Opcode.StdWallRectangleF3,
  Opcode.StdBltShape,
  Opcode.F3,
  Opcode.wallDecorationFront,
  Opcode.WallF3Front,
  Opcode.StdDrawWallText,
  Opcode.F3,
  Opcode.wallDecorationFront,
  Opcode.WallF3Front,
  Opcode.StdDrawWallDecoration,
  Opcode.Alcove,
  Opcode.JumpZ,
  5,
  Opcode.F3Contents,
  Opcode.F3xy,
  Opcode.F3,
  Opcode.DrawOrder00,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3Open: number[] = [
  Opcode.F3,
  Opcode.FloorDecorationGraphicOrdinalF3,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3Contents,
  Opcode.F3xy,
  Opcode.F3,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3Pit: number[] = [
  Opcode.F3,
  Opcode.GetDecoration0,
  Opcode.JumpNZ,
  4,
  Opcode.Literal,
  50,
  Opcode.StdFloorPitRectangleF3,
  Opcode.StdGraphicToViewport,
  Opcode.F3,
  Opcode.FloorDecorationGraphicOrdinalF3,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3Contents,
  Opcode.F3xy,
  Opcode.F3,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3Teleporter: number[] = [
  Opcode.F3,
  Opcode.FloorDecorationGraphicOrdinalF3,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3Contents,
  Opcode.F3xy,
  Opcode.F3,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.F3,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  3,
  Opcode.StdTeleporterRectangleF3,
  Opcode.StdWallRectangleF3,
  Opcode.StdDrawTeleporter,
  Opcode.Return,
];

export const StdDrawF3StairFacing: number[] = [
  Opcode.F3,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  5,
  Opcode.StdStairFacingUpGraphicF3,
  Opcode.StdStairFacingUpRectangleF3,
  Opcode.StdGraphicToViewport,
  Opcode.Jump,
  3,
  Opcode.StdStairFacingDownGraphicF3,
  Opcode.StdStairFacingDownRectangleF3,
  Opcode.StdGraphicToViewport,
  Opcode.F3,
  Opcode.FloorDecorationGraphicOrdinalF3,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3Contents,
  Opcode.F3xy,
  Opcode.F3,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3StairEdge: number[] = [
  Opcode.Return,
];

export const StdDrawF3DoorEdge: number[] = [
  Opcode.Return,
];

export const StdDrawF3DoorFacing: number[] = [
  Opcode.F3,
  Opcode.FloorDecorationGraphicOrdinalF3,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3Contents,
  Opcode.F3xy,
  Opcode.F3,
  Opcode.DrawOrder218,
  Opcode.StdDrawRoomObjects,
  Opcode.StdDoorFacingFrameLeftBitmapF3,
  Opcode.StdDoorFacingFrameLeftRectF3,
  Opcode.StdBltShapeToViewport,
  Opcode.StdDoorFacingFrameLeftBitmapF3,
  Opcode.StdDoorFacingFrameRightRectF3,
  Opcode.StdMirrorShapeToViewport,
  Opcode.F3,
  Opcode.DoorSwitch,
  Opcode.JumpZ,
  5,
  Opcode.Literal,
  1,
  Opcode.Literal,
  1,
  Opcode.StdDrawDoorSwitch,
  Opcode.F3DoorRecordIndex,
  Opcode.F3DoorState,
  Opcode.StdDoorGraphicsF3,
  Opcode.StdDoorRectsF3,
  Opcode.StdDrawDoor,
  Opcode.F3Contents,
  Opcode.F3xy,
  Opcode.F3,
  Opcode.DrawOrder349,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

// =============================================================================
// F3L1 PROGRAMS (distance 3 - left side)
// =============================================================================

export const StdDrawF3L1Stone: number[] = [
  Opcode.StdWallBitmapF3L1,
  Opcode.StdWallRectangleF3L1,
  Opcode.StdBltShape,
  Opcode.F3L1,
  Opcode.wallDecorationRight,
  Opcode.WallF3L1Right,
  Opcode.StdDrawWallText,
  Opcode.F3L1,
  Opcode.wallDecorationRight,
  Opcode.WallF3L1Right,
  Opcode.StdDrawWallDecoration,
  Opcode.F3L1,
  Opcode.wallDecorationFront,
  Opcode.WallF3L1Front,
  Opcode.StdDrawWallText,
  Opcode.F3L1,
  Opcode.wallDecorationFront,
  Opcode.WallF3L1Front,
  Opcode.StdDrawWallDecoration,
  Opcode.Alcove,
  Opcode.JumpZ,
  5,
  Opcode.F3L1Contents,
  Opcode.F3L1xy,
  Opcode.F3L1,
  Opcode.DrawOrder00,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3L1Open: number[] = [
  Opcode.F3L1,
  Opcode.FloorDecorationGraphicOrdinalF3L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3L1Contents,
  Opcode.F3L1xy,
  Opcode.F3L1,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3L1Pit: number[] = [
  Opcode.F3L1,
  Opcode.GetDecoration0,
  Opcode.JumpNZ,
  4,
  Opcode.Literal,
  49,
  Opcode.StdFloorPitRectangleF3L1,
  Opcode.StdGraphicToViewport,
  Opcode.F3L1,
  Opcode.FloorDecorationGraphicOrdinalF3L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3L1Contents,
  Opcode.F3L1xy,
  Opcode.F3L1,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3L1Teleporter: number[] = [
  Opcode.F3L1,
  Opcode.FloorDecorationGraphicOrdinalF3L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3L1Contents,
  Opcode.F3L1xy,
  Opcode.F3L1,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.F3L1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  3,
  Opcode.StdTeleporterRectangleF3L1,
  Opcode.StdWallRectangleF3L1,
  Opcode.StdDrawTeleporter,
  Opcode.Return,
];

export const StdDrawF3L1StairFacing: number[] = [
  Opcode.F3L1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  5,
  Opcode.StdStairFacingUpGraphicF3L1,
  Opcode.StdStairFacingUpRectangleF3L1,
  Opcode.StdGraphicToViewport,
  Opcode.Jump,
  3,
  Opcode.StdStairFacingDownGraphicF3L1,
  Opcode.StdStairFacingDownRectangleF3L1,
  Opcode.StdGraphicToViewport,
  Opcode.F3L1,
  Opcode.FloorDecorationGraphicOrdinalF3L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3L1Contents,
  Opcode.F3L1xy,
  Opcode.F3L1,
  Opcode.DrawOrder3421,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3L1StairEdge: number[] = [
  Opcode.F3L1,
  Opcode.FloorDecorationGraphicOrdinalF3L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3L1Contents,
  Opcode.F3L1xy,
  Opcode.F3L1,
  Opcode.DrawOrder321,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3L1DoorEdge: number[] = [
  Opcode.F3L1,
  Opcode.FloorDecorationGraphicOrdinalF3L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3L1Contents,
  Opcode.F3L1xy,
  Opcode.F3L1,
  Opcode.DrawOrder321,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3L1DoorFacing: number[] = [
  Opcode.F3L1,
  Opcode.FloorDecorationGraphicOrdinalF3L1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3L1Contents,
  Opcode.F3L1xy,
  Opcode.F3L1,
  Opcode.DrawOrder218,
  Opcode.StdDrawRoomObjects,
  Opcode.StdDoorFacingFrameLeftBitmapF3L1,
  Opcode.StdDoorFacingFrameRectF3L1,
  Opcode.StdBltShapeToViewport,
  Opcode.F3L1DoorRecordIndex,
  Opcode.F3L1DoorState,
  Opcode.StdDoorGraphicsF3,
  Opcode.StdDoorRectsF3L1,
  Opcode.StdDrawDoor,
  Opcode.F3L1Contents,
  Opcode.F3L1xy,
  Opcode.F3L1,
  Opcode.DrawOrder349,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

// =============================================================================
// F3L2 PROGRAMS (distance 3 - far left corner)
// =============================================================================

export const StdDrawF3L2Stone: number[] = [
  Opcode.StdWallBitmapF3L2,
  Opcode.StdWallRectangleF3L2,
  Opcode.StdBltShape,
  Opcode.Return,
];

// =============================================================================
// F3R1 PROGRAMS (distance 3 - right side)
// =============================================================================

export const StdDrawF3R1Stone: number[] = [
  Opcode.StdWallBitmapF3R1,
  Opcode.StdWallRectangleF3R1,
  Opcode.StdBltShape,
  Opcode.F3R1,
  Opcode.wallDecorationLeft,
  Opcode.WallF3R1Left,
  Opcode.StdDrawWallText,
  Opcode.F3R1,
  Opcode.wallDecorationLeft,
  Opcode.WallF3R1Left,
  Opcode.StdDrawWallDecoration,
  Opcode.F3R1,
  Opcode.wallDecorationFront,
  Opcode.WallF3R1Front,
  Opcode.StdDrawWallText,
  Opcode.F3R1,
  Opcode.wallDecorationFront,
  Opcode.WallF3R1Front,
  Opcode.StdDrawWallDecoration,
  Opcode.Alcove,
  Opcode.JumpZ,
  5,
  Opcode.F3R1Contents,
  Opcode.F3R1xy,
  Opcode.F3R1,
  Opcode.DrawOrder00,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3R1Open: number[] = [
  Opcode.F3R1,
  Opcode.FloorDecorationGraphicOrdinalF3R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3R1Contents,
  Opcode.F3R1xy,
  Opcode.F3R1,
  Opcode.DrawOrder4312,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3R1Pit: number[] = [
  Opcode.F3R1,
  Opcode.GetDecoration0,
  Opcode.JumpNZ,
  4,
  Opcode.Literal,
  49,
  Opcode.StdFloorPitRectangleF3R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.F3R1,
  Opcode.FloorDecorationGraphicOrdinalF3R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3R1Contents,
  Opcode.F3R1xy,
  Opcode.F3R1,
  Opcode.DrawOrder4312,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3R1Teleporter: number[] = [
  Opcode.F3R1,
  Opcode.FloorDecorationGraphicOrdinalF3R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3R1Contents,
  Opcode.F3R1xy,
  Opcode.F3R1,
  Opcode.DrawOrder4312,
  Opcode.StdDrawRoomObjects,
  Opcode.F3R1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  3,
  Opcode.StdTeleporterRectangleF3R1,
  Opcode.StdWallRectangleF3R1,
  Opcode.StdDrawTeleporter,
  Opcode.Return,
];

export const StdDrawF3R1StairFacing: number[] = [
  Opcode.F3R1,
  Opcode.GetDecoration0,
  Opcode.JumpZ,
  5,
  Opcode.StdStairFacingUpGraphicF3R1,
  Opcode.StdStairFacingUpRectangleF3R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.Jump,
  3,
  Opcode.StdStairFacingDownGraphicF3R1,
  Opcode.StdStairFacingDownRectangleF3R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.F3R1,
  Opcode.FloorDecorationGraphicOrdinalF3R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3R1Contents,
  Opcode.F3R1xy,
  Opcode.F3R1,
  Opcode.DrawOrder4312,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3R1StairEdge: number[] = [
  Opcode.F3R1,
  Opcode.FloorDecorationGraphicOrdinalF3R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3R1Contents,
  Opcode.F3R1xy,
  Opcode.F3R1,
  Opcode.DrawOrder412,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3R1DoorEdge: number[] = [
  Opcode.F3R1,
  Opcode.FloorDecorationGraphicOrdinalF3R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3R1Contents,
  Opcode.F3R1xy,
  Opcode.F3R1,
  Opcode.DrawOrder412,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

export const StdDrawF3R1DoorFacing: number[] = [
  Opcode.F3R1,
  Opcode.FloorDecorationGraphicOrdinalF3R1,
  Opcode.StdDrawFloorDecoration,
  Opcode.F3R1Contents,
  Opcode.F3R1xy,
  Opcode.F3R1,
  Opcode.DrawOrder128,
  Opcode.StdDrawRoomObjects,
  Opcode.StdDoorFacingFrameLeftBitmapF3R1,
  Opcode.StdDoorFacingFrameRectF3R1,
  Opcode.StdMirrorShapeToViewport,
  Opcode.F3R1,
  Opcode.DoorSwitch,
  Opcode.JumpZ,
  5,
  Opcode.Literal,
  1,
  Opcode.Literal,
  0,
  Opcode.StdDrawDoorSwitch,
  Opcode.F3R1DoorRecordIndex,
  Opcode.F3R1DoorState,
  Opcode.StdDoorGraphicsF3,
  Opcode.StdDoorRectsF3R1,
  Opcode.StdDrawDoor,
  Opcode.F3R1Contents,
  Opcode.F3R1xy,
  Opcode.F3R1,
  Opcode.DrawOrder439,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

// =============================================================================
// F3R2 PROGRAMS (distance 3 - far right corner)
// =============================================================================

export const StdDrawF3R2Stone: number[] = [
  Opcode.StdWallBitmapF3R2,
  Opcode.StdWallRectangleF3R2,
  Opcode.StdBltShape,
  Opcode.Return,
];

// =============================================================================
// F4 PROGRAMS (distance 4 - center)
// =============================================================================

export const StdDrawF4Any: number[] = [
  Opcode.F4Contents,
  Opcode.F4xy,
  Opcode.F4,
  Opcode.DrawOrder01,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

// =============================================================================
// F4L1 PROGRAMS (distance 4 - left)
// =============================================================================

export const StdDrawF4L1Any: number[] = [
  Opcode.F4L1Contents,
  Opcode.F4L1xy,
  Opcode.F4L1,
  Opcode.DrawOrder01,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

// =============================================================================
// F4R1 PROGRAMS (distance 4 - right)
// =============================================================================

export const StdDrawF4R1Any: number[] = [
  Opcode.F4R1Contents,
  Opcode.F4R1xy,
  Opcode.F4R1,
  Opcode.DrawOrder01,
  Opcode.StdDrawRoomObjects,
  Opcode.Return,
];

// =============================================================================
// PROGRAM LOOKUP TABLE
// =============================================================================

/**
 * Complete lookup table mapping cell/room type to bytecode programs.
 * This replaces CSBWin's pStdDrawCode[21][8] array.
 *
 * Key format: "{CellName}_{RoomType}"
 * Room types: Stone, Open, Pit, Teleporter, StairFacing, StairEdge, DoorEdge, DoorFacing
 */
export const BytecodePrograms: { [key: string]: number[] } = {
  // F0 (distance 0 - center)
  'F0_Stone': StdDrawF0Stone,
  'F0_Open': StdDrawF0Open,
  'F0_Pit': StdDrawF0Pit,
  'F0_Teleporter': StdDrawF0Teleporter,
  'F0_StairFacing': StdDrawF0StairFacing,
  'F0_StairEdge': StdDrawF0StairEdge,
  'F0_DoorEdge': StdDrawF0DoorEdge,
  'F0_DoorFacing': StdDrawF0DoorFacing,

  // F0L1 (distance 0 - left)
  'F0L1_Stone': StdDrawF0L1Stone,
  'F0L1_Open': StdDrawF0L1Open,
  'F0L1_Pit': StdDrawF0L1Pit,
  'F0L1_Teleporter': StdDrawF0L1Teleporter,
  'F0L1_StairFacing': StdDrawF0L1StairFacing,
  'F0L1_StairEdge': StdDrawF0L1StairEdge,
  'F0L1_DoorEdge': StdDrawF0L1DoorEdge,
  'F0L1_DoorFacing': StdDrawF0L1DoorFacing,

  // F0R1 (distance 0 - right)
  'F0R1_Stone': StdDrawF0R1Stone,
  'F0R1_Open': StdDrawF0R1Open,
  'F0R1_Pit': StdDrawF0R1Pit,
  'F0R1_Teleporter': StdDrawF0R1Teleporter,
  'F0R1_StairFacing': StdDrawF0R1StairFacing,
  'F0R1_StairEdge': StdDrawF0R1StairEdge,
  'F0R1_DoorEdge': StdDrawF0R1DoorEdge,
  'F0R1_DoorFacing': StdDrawF0R1DoorFacing,

  // F1 (distance 1 - center)
  'F1_Stone': StdDrawF1Stone,
  'F1_Open': StdDrawF1Open,
  'F1_Pit': StdDrawF1Pit,
  'F1_Teleporter': StdDrawF1Teleporter,
  'F1_StairFacing': StdDrawF1StairFacing,
  'F1_StairEdge': StdDrawF1StairEdge,
  'F1_DoorEdge': StdDrawF1DoorEdge,
  'F1_DoorFacing': StdDrawF1DoorFacing,

  // F1L1 (distance 1 - left)
  'F1L1_Stone': StdDrawF1L1Stone,
  'F1L1_Open': StdDrawF1L1Open,
  'F1L1_Pit': StdDrawF1L1Pit,
  'F1L1_Teleporter': StdDrawF1L1Teleporter,
  'F1L1_StairFacing': StdDrawF1L1StairFacing,
  'F1L1_StairEdge': StdDrawF1L1StairEdge,
  'F1L1_DoorEdge': StdDrawF1L1DoorEdge,
  'F1L1_DoorFacing': StdDrawF1L1DoorFacing,

  // F1R1 (distance 1 - right)
  'F1R1_Stone': StdDrawF1R1Stone,
  'F1R1_Open': StdDrawF1R1Open,
  'F1R1_Pit': StdDrawF1R1Pit,
  'F1R1_Teleporter': StdDrawF1R1Teleporter,
  'F1R1_StairFacing': StdDrawF1R1StairFacing,
  'F1R1_StairEdge': StdDrawF1R1StairEdge,
  'F1R1_DoorEdge': StdDrawF1R1DoorEdge,
  'F1R1_DoorFacing': StdDrawF1R1DoorFacing,

  // F2 (distance 2 - center)
  'F2_Stone': StdDrawF2Stone,
  'F2_Open': StdDrawF2Open,
  'F2_Pit': StdDrawF2Pit,
  'F2_Teleporter': StdDrawF2Teleporter,
  'F2_StairFacing': StdDrawF2StairFacing,
  'F2_StairEdge': StdDrawF2StairEdge,
  'F2_DoorEdge': StdDrawF2DoorEdge,
  'F2_DoorFacing': StdDrawF2DoorFacing,

  // F2L1 (distance 2 - left)
  'F2L1_Stone': StdDrawF2L1Stone,
  'F2L1_Open': StdDrawF2L1Open,
  'F2L1_Pit': StdDrawF2L1Pit,
  'F2L1_Teleporter': StdDrawF2L1Teleporter,
  'F2L1_StairFacing': StdDrawF2L1StairFacing,
  'F2L1_StairEdge': StdDrawF2L1StairEdge,
  'F2L1_DoorEdge': StdDrawF2L1DoorEdge,
  'F2L1_DoorFacing': StdDrawF2L1DoorFacing,

  // F2R1 (distance 2 - right)
  'F2R1_Stone': StdDrawF2R1Stone,
  'F2R1_Open': StdDrawF2R1Open,
  'F2R1_Pit': StdDrawF2R1Pit,
  'F2R1_Teleporter': StdDrawF2R1Teleporter,
  'F2R1_StairFacing': StdDrawF2R1StairFacing,
  'F2R1_StairEdge': StdDrawF2R1StairEdge,
  'F2R1_DoorEdge': StdDrawF2R1DoorEdge,
  'F2R1_DoorFacing': StdDrawF2R1DoorFacing,

  // F3 (distance 3 - center)
  'F3_Stone': StdDrawF3Stone,
  'F3_Open': StdDrawF3Open,
  'F3_Pit': StdDrawF3Pit,
  'F3_Teleporter': StdDrawF3Teleporter,
  'F3_StairFacing': StdDrawF3StairFacing,
  'F3_StairEdge': StdDrawF3StairEdge,
  'F3_DoorEdge': StdDrawF3DoorEdge,
  'F3_DoorFacing': StdDrawF3DoorFacing,

  // F3L1 (distance 3 - left)
  'F3L1_Stone': StdDrawF3L1Stone,
  'F3L1_Open': StdDrawF3L1Open,
  'F3L1_Pit': StdDrawF3L1Pit,
  'F3L1_Teleporter': StdDrawF3L1Teleporter,
  'F3L1_StairFacing': StdDrawF3L1StairFacing,
  'F3L1_StairEdge': StdDrawF3L1StairEdge,
  'F3L1_DoorEdge': StdDrawF3L1DoorEdge,
  'F3L1_DoorFacing': StdDrawF3L1DoorFacing,

  // F3L2 (distance 3 - far left corner)
  'F3L2_Stone': StdDrawF3L2Stone,

  // F3R1 (distance 3 - right)
  'F3R1_Stone': StdDrawF3R1Stone,
  'F3R1_Open': StdDrawF3R1Open,
  'F3R1_Pit': StdDrawF3R1Pit,
  'F3R1_Teleporter': StdDrawF3R1Teleporter,
  'F3R1_StairFacing': StdDrawF3R1StairFacing,
  'F3R1_StairEdge': StdDrawF3R1StairEdge,
  'F3R1_DoorEdge': StdDrawF3R1DoorEdge,
  'F3R1_DoorFacing': StdDrawF3R1DoorFacing,

  // F3R2 (distance 3 - far right corner)
  'F3R2_Stone': StdDrawF3R2Stone,

  // F4 (distance 4 - center)
  'F4_Any': StdDrawF4Any,

  // F4L1 (distance 4 - left)
  'F4L1_Any': StdDrawF4L1Any,

  // F4R1 (distance 4 - right)
  'F4R1_Any': StdDrawF4R1Any,
};
