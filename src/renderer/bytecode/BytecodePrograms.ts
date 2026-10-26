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

const StdDrawF0Stone: number[] = [
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

const StdDrawF0Open: number[] = [
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

const StdDrawF0Pit: number[] = [
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

const StdDrawF0Teleporter: number[] = [
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

const StdDrawF0StairFacing: number[] = [
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

const StdDrawF0StairEdge: number[] = [
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

const StdDrawF0DoorEdge: number[] = [
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

const StdDrawF0DoorFacing: number[] = [
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

const StdDrawF0L1Stone: number[] = [
  Opcode.StdWallBitmapF0L1,
  Opcode.StdWallRectangleF0L1,
  Opcode.StdBltShape,
  Opcode.Return,
];

const StdDrawF0L1Open: number[] = [
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

const StdDrawF0L1Pit: number[] = [
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

const StdDrawF0L1Teleporter: number[] = [
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

const StdDrawF0L1StairFacing: number[] = [
  Opcode.Return,
];

const StdDrawF0L1StairEdge: number[] = [
  Opcode.StdStairEdgeGraphicF0L1,
  Opcode.StdStairEdgeRectF0L1,
  Opcode.StdGraphicToViewport,
  Opcode.Return,
];

const StdDrawF0L1DoorEdge: number[] = [
  Opcode.F0L1,
  Opcode.F0L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0L1,
  Opcode.F0L1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.Return,
];

const StdDrawF0L1DoorFacing: number[] = [
  Opcode.Return,
];

// =============================================================================
// F0R1 PROGRAMS (distance 0 - right side)
// =============================================================================

const StdDrawF0R1Stone: number[] = [
  Opcode.StdWallBitmapF0R1,
  Opcode.StdWallRectangleF0R1,
  Opcode.StdBltShape,
  Opcode.Return,
];

const StdDrawF0R1Open: number[] = [
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

const StdDrawF0R1Pit: number[] = [
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

const StdDrawF0R1Teleporter: number[] = [
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

const StdDrawF0R1StairFacing: number[] = [
  Opcode.Return,
];

const StdDrawF0R1StairEdge: number[] = [
  Opcode.StdStairEdgeGraphicF0R1,
  Opcode.StdStairEdgeRectF0R1,
  Opcode.StdMirrorGraphicToViewport,
  Opcode.Return,
];

const StdDrawF0R1DoorEdge: number[] = [
  Opcode.F0R1,
  Opcode.F0R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.F0R1,
  Opcode.F0R1xy,
  Opcode.StdDrawCeilingPit,
  Opcode.Return,
];

const StdDrawF0R1DoorFacing: number[] = [
  Opcode.Return,
];

// =============================================================================
// F1 PROGRAMS (distance 1 - center)
// =============================================================================

const StdDrawF1Stone: number[] = [
  Opcode.SeeThroughWalls, Opcode.JumpZ, 28,
    Opcode.Literal, 1, Opcode.StdAllocateDerivedGraphic,
    Opcode.StdBitmapViewport,                  // source
    Opcode.Literal, 1,                         // destination = derived graphic 1
    Opcode.StdSeeThruWallsRect,                // destination rectangle
    Opcode.StdSeeThruWallsRectUByte4,          // Source X
    Opcode.StdSeeThruWallsRectUByte6,          // Source Y
    Opcode.Literal, 112,                       // Source Width
    Opcode.Literal, 48,                        // destination width
    Opcode.MinusOne,                           // Transparent color
      Opcode.StdBltToDerivedGraphic,
    Opcode.StdHoleInWallBitmap,                // source
    Opcode.Literal, 1,                         // destination = derived graphic 1
    Opcode.StdSeeThruWallsRect,                // destination rectangle
    Opcode.Zero,                               // Source X
    Opcode.Zero,                               // Source Y
    Opcode.Literal, 48,                        // Source Width
    Opcode.Literal, 48,                        // Destination width
    Opcode.Literal, 10,                        // Transparent color
      Opcode.StdBltToDerivedGraphic,
  Opcode.StdWallBitmapF1, Opcode.StdWallRectangleF1, Opcode.StdBltShape,
  Opcode.F1, Opcode.wallDecorationFront, Opcode.WallF1Front, Opcode.StdDrawWallDecoration,
  Opcode.F1, Opcode.wallDecorationFront, Opcode.HasDecoration, Opcode.JumpZ, 1, Opcode.LeaveMortarJoint,
  Opcode.F1, Opcode.wallDecorationFront, Opcode.WallF1Front, Opcode.StdDrawWallText,
  Opcode.Alcove,
    Opcode.JumpZ, 5,
      Opcode.F1Contents, Opcode.F1xy, Opcode.F1, Opcode.DrawOrder00, Opcode.StdDrawRoomObjects,
  Opcode.SeeThroughWalls, Opcode.JumpZ, 16,
    Opcode.Literal, 1,                         // Source
    Opcode.StdBitmapViewport,                  // Destination
    Opcode.StdSeeThruWallsRect2,               // Destination Rectangle
    Opcode.Zero,                               // Source X
    Opcode.Zero,                               // Source Y
    Opcode.Literal, 48,                        // Source Width
    Opcode.Literal, 112,                       // Destination Width
    Opcode.Literal, 9,                         // Transparent color
      Opcode.StdBltFromDerivedGraphic,
    Opcode.Literal, 1, Opcode.StdDeleteDerivedGraphic,
  Opcode.Return,
];

const StdDrawF1Open: number[] = [
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

const StdDrawF1Pit: number[] = [
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

const StdDrawF1Teleporter: number[] = [
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

const StdDrawF1StairFacing: number[] = [
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

const StdDrawF1StairEdge: number[] = [
  Opcode.Return,
];

const StdDrawF1DoorEdge: number[] = [
  Opcode.Return,
];

const StdDrawF1DoorFacing: number[] = [
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

const StdDrawF1L1Stone: number[] = [
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

const StdDrawF1L1Open: number[] = [
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

const StdDrawF1L1Pit: number[] = [
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

const StdDrawF1L1Teleporter: number[] = [
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

const StdDrawF1L1StairFacing: number[] = [
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

const StdDrawF1L1StairEdge: number[] = [
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

const StdDrawF1L1DoorEdge: number[] = [
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

const StdDrawF1L1DoorFacing: number[] = [
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

const StdDrawF1R1Stone: number[] = [
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

const StdDrawF1R1Open: number[] = [
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

const StdDrawF1R1Pit: number[] = [
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

const StdDrawF1R1Teleporter: number[] = [
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

const StdDrawF1R1StairFacing: number[] = [
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

const StdDrawF1R1StairEdge: number[] = [
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

const StdDrawF1R1DoorEdge: number[] = [
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

const StdDrawF1R1DoorFacing: number[] = [
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

const StdDrawF2Stone: number[] = [
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

const StdDrawF2Open: number[] = [
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

const StdDrawF2Pit: number[] = [
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

const StdDrawF2Teleporter: number[] = [
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

const StdDrawF2StairFacing: number[] = [
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

const StdDrawF2StairEdge: number[] = [
  Opcode.Return,
];

const StdDrawF2DoorEdge: number[] = [
  Opcode.Return,
];

const StdDrawF2DoorFacing: number[] = [
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

const StdDrawF2L1Stone: number[] = [
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

const StdDrawF2L1Open: number[] = [
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

const StdDrawF2L1Pit: number[] = [
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

const StdDrawF2L1Teleporter: number[] = [
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

const StdDrawF2L1StairFacing: number[] = [
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

const StdDrawF2L1StairEdge: number[] = [
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

const StdDrawF2L1DoorEdge: number[] = [
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

const StdDrawF2L1DoorFacing: number[] = [
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

const StdDrawF2R1Stone: number[] = [
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

const StdDrawF2R1Open: number[] = [
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

const StdDrawF2R1Pit: number[] = [
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

const StdDrawF2R1Teleporter: number[] = [
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

const StdDrawF2R1StairFacing: number[] = [
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

const StdDrawF2R1StairEdge: number[] = [
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

const StdDrawF2R1DoorEdge: number[] = [
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

const StdDrawF2R1DoorFacing: number[] = [
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

const StdDrawF3Stone: number[] = [
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

const StdDrawF3Open: number[] = [
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

const StdDrawF3Pit: number[] = [
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

const StdDrawF3Teleporter: number[] = [
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

const StdDrawF3StairFacing: number[] = [
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

const StdDrawF3StairEdge: number[] = [
  Opcode.Return,
];

const StdDrawF3DoorEdge: number[] = [
  Opcode.Return,
];

const StdDrawF3DoorFacing: number[] = [
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

const StdDrawF3L1Stone: number[] = [
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

const StdDrawF3L1Open: number[] = [
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

const StdDrawF3L1Pit: number[] = [
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

const StdDrawF3L1Teleporter: number[] = [
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

const StdDrawF3L1StairFacing: number[] = [
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

const StdDrawF3L1StairEdge: number[] = [
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

const StdDrawF3L1DoorEdge: number[] = [
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

const StdDrawF3L1DoorFacing: number[] = [
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

const StdDrawF3L2Stone: number[] = [
  Opcode.StdWallBitmapF3L2,
  Opcode.StdWallRectangleF3L2,
  Opcode.StdBltShape,
  Opcode.Return,
];

// =============================================================================
// F3R1 PROGRAMS (distance 3 - right side)
// =============================================================================

const StdDrawF3R1Stone: number[] = [
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

const StdDrawF3R1Open: number[] = [
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

const StdDrawF3R1Pit: number[] = [
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

const StdDrawF3R1Teleporter: number[] = [
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

const StdDrawF3R1StairFacing: number[] = [
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

const StdDrawF3R1StairEdge: number[] = [
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

const StdDrawF3R1DoorEdge: number[] = [
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

const StdDrawF3R1DoorFacing: number[] = [
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

const StdDrawF3R2Stone: number[] = [
  Opcode.StdWallBitmapF3R2,
  Opcode.StdWallRectangleF3R2,
  Opcode.StdBltShape,
  Opcode.Return,
];

// =============================================================================
// F4 PROGRAMS (distance 4 - center)
// =============================================================================

const StdDrawF4Any: number[] = [
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

const StdDrawF4L1Any: number[] = [
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

const StdDrawF4R1Any: number[] = [
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

/** An empty slot: the cell draws nothing for that room type. */
const NOP = null;

/**
 * CSBWin's `pStdDrawCode[21][8]` (`doc/CSBwin-src/Viewport.cpp:1952-2201`): the program
 * for each relative cell, in `DrawViewport`'s cell order, and each `GraphicRoomType`.
 */
export const pStdDrawCode: readonly (readonly (readonly number[] | null)[])[] = [
  [ // F4L2
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
  ],
  [ // F4R2
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
  ],
  [ // F3L2
    StdDrawF3L2Stone,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
  ],
  [ // F3R2
    StdDrawF3R2Stone,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
  ],
  [ // F4L1
    StdDrawF4L1Any,
    StdDrawF4L1Any,
    StdDrawF4L1Any,
    StdDrawF4L1Any,
    StdDrawF4L1Any,
    StdDrawF4L1Any,
    StdDrawF4L1Any,
    StdDrawF4L1Any,
  ],
  [ // F4R1
    StdDrawF4R1Any,
    StdDrawF4R1Any,
    StdDrawF4R1Any,
    StdDrawF4R1Any,
    StdDrawF4R1Any,
    StdDrawF4R1Any,
    StdDrawF4R1Any,
    StdDrawF4R1Any,
  ],
  [ // F4
    StdDrawF4Any,
    StdDrawF4Any,
    StdDrawF4Any,
    StdDrawF4Any,
    StdDrawF4Any,
    StdDrawF4Any,
    StdDrawF4Any,
    StdDrawF4Any,
  ],
  [ // F3L1
    StdDrawF3L1Stone,
    StdDrawF3L1Open,
    StdDrawF3L1Pit,
    StdDrawF3L1Teleporter,
    StdDrawF3L1DoorEdge,
    StdDrawF3L1DoorFacing,
    StdDrawF3L1StairEdge,
    StdDrawF3L1StairFacing,
  ],
  [ // F3R1
    StdDrawF3R1Stone,
    StdDrawF3R1Open,
    StdDrawF3R1Pit,
    StdDrawF3R1Teleporter,
    StdDrawF3R1DoorEdge,
    StdDrawF3R1DoorFacing,
    StdDrawF3R1StairEdge,
    StdDrawF3R1StairFacing,
  ],
  [ // F3
    StdDrawF3Stone,
    StdDrawF3Open,
    StdDrawF3Pit,
    StdDrawF3Teleporter,
    StdDrawF3DoorEdge,
    StdDrawF3DoorFacing,
    StdDrawF3StairEdge,
    StdDrawF3StairFacing,
  ],
  [ // F2L2
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
  ],
  [ // F2R2
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
    NOP,
  ],
  [ // F2L1
    StdDrawF2L1Stone,
    StdDrawF2L1Open,
    StdDrawF2L1Pit,
    StdDrawF2L1Teleporter,
    StdDrawF2L1DoorEdge,
    StdDrawF2L1DoorFacing,
    StdDrawF2L1StairEdge,
    StdDrawF2L1StairFacing,
  ],
  [ // F2R1
    StdDrawF2R1Stone,
    StdDrawF2R1Open,
    StdDrawF2R1Pit,
    StdDrawF2R1Teleporter,
    StdDrawF2R1DoorEdge,
    StdDrawF2R1DoorFacing,
    StdDrawF2R1StairEdge,
    StdDrawF2R1StairFacing,
  ],
  [ // F2
    StdDrawF2Stone,
    StdDrawF2Open,
    StdDrawF2Pit,
    StdDrawF2Teleporter,
    StdDrawF2DoorEdge,
    StdDrawF2DoorFacing,
    StdDrawF2StairEdge,
    StdDrawF2StairFacing,
  ],
  [ // F1L1
    StdDrawF1L1Stone,
    StdDrawF1L1Open,
    StdDrawF1L1Pit,
    StdDrawF1L1Teleporter,
    StdDrawF1L1DoorEdge,
    StdDrawF1L1DoorFacing,
    StdDrawF1L1StairEdge,
    StdDrawF1L1StairFacing,
  ],
  [ // F1R1
    StdDrawF1R1Stone,
    StdDrawF1R1Open,
    StdDrawF1R1Pit,
    StdDrawF1R1Teleporter,
    StdDrawF1R1DoorEdge,
    StdDrawF1R1DoorFacing,
    StdDrawF1R1StairEdge,
    StdDrawF1R1StairFacing,
  ],
  [ // F1
    StdDrawF1Stone,
    StdDrawF1Open,
    StdDrawF1Pit,
    StdDrawF1Teleporter,
    StdDrawF1DoorEdge,
    StdDrawF1DoorFacing,
    StdDrawF1StairEdge,
    StdDrawF1StairFacing,
  ],
  [ // F0L1
    StdDrawF0L1Stone,
    StdDrawF0L1Open,
    StdDrawF0L1Pit,
    StdDrawF0L1Teleporter,
    StdDrawF0L1DoorEdge,
    StdDrawF0L1DoorFacing,
    StdDrawF0L1StairEdge,
    StdDrawF0L1StairFacing,
  ],
  [ // F0R1
    StdDrawF0R1Stone,
    StdDrawF0R1Open,
    StdDrawF0R1Pit,
    StdDrawF0R1Teleporter,
    StdDrawF0R1DoorEdge,
    StdDrawF0R1DoorFacing,
    StdDrawF0R1StairEdge,
    StdDrawF0R1StairFacing,
  ],
  [ // F0
    StdDrawF0Stone,
    StdDrawF0Open,
    StdDrawF0Pit,
    StdDrawF0Teleporter,
    StdDrawF0DoorEdge,
    StdDrawF0DoorFacing,
    StdDrawF0StairEdge,
    StdDrawF0StairFacing,
  ],
];
