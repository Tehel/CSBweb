/**
 * Bytecode Interpreter Prototype - Direct port from CSBWin
 *
 * This is a mechanical port of the Interpret() function from CSBWin's Viewport.cpp
 * The goal is to execute bytecode programs exactly as CSBWin does.
 */

import { Opcode } from './Opcodes';
import { SummarizeRoomData } from './Types';
import {
  bltShapeToViewportIndex,
  tag0088b2Index,
  tag008c98Index,
  type IndexedBitmap,
  type PaletteIndexViewportBuffer
} from '../csbwin/CanvasBlitter';
import type { DungeonState } from '../../engine/DungeonState';
import type { CreatureRecord } from '../../data/dungeonTypes';
import type { ObjectTables } from '../csbwin/ObjectTables';
import type { CSBGraphicsLoader, ExtendedFloorDecoration } from '../../data/CSBGraphicsLoader';
import { decodeObjectID, DBType, OBJECT_ID_EOF, type ObjectID } from '../../core/types';

const IDENTITY_COLOR_MAP = new Uint8Array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]);

/**
 * Execution context - simulates CSBWin's global state
 */
export interface InterpreterContext {
  // Graphics data
  wallBitmaps: any[]; // IndexedBitmap in browser, mock in tests
  doorBitmaps?: any[]; // IndexedBitmap[8] in browser (pDoorBitmaps[0..7])
  wallRectangles: RectPos[];
  floorBitmap?: ImageData;   // Floor graphic (optional)
  ceilingBitmap?: ImageData; // Ceiling graphic (optional)

  // Additional CSBWin viewport rectangle tables (from `graphics.dat` item 0x22e)
  floorPitRectangles?: RectPos[];
  ceilingPitRectangles?: RectPos[];
  teleporterRectangles?: RectPos[];
  stairEdgeRectangles?: RectPos[];
  stairFacingDownRectangles?: RectPos[];
  stairFacingUpRectangles?: RectPos[];
  doorTrackTopRectangles?: RectPos[];
  doorFrameRectangles?: RectPos[];
  doorRects?: {
    F1R1: RectPos[];
    F1: RectPos[];
    F1L1: RectPos[];
    F2R1: RectPos[];
    F2: RectPos[];
    F2L1: RectPos[];
    F3R1: RectPos[];
    F3: RectPos[];
    F3L1: RectPos[];
  };
  seeThruWallsRect?: RectPos;
  seeThruWallsRect2?: RectPos;
  seeThruDoorEdgeRect?: RectPos;

  // Current per-frame style context (CSBWin LEVELDESC.word14 bits)
  wallGraphicSet?: number;
  backgroundGraphicSet?: number;

  // Basic graphics resolver (CSBWin `GetBasicGraphicAddress(n)` used by `GraphicToViewport`)
  getGraphicBitmap?: (graphicNum: number) => IndexedBitmap | null;
  graphicCache?: Map<string, IndexedBitmap>;

  // CSBWin object rendering tables (graphics.dat 0x22e + 0x22f)
  objectTables?: ObjectTables;
  csbGraphics?: CSBGraphicsLoader;
  dungeonState?: DungeonState;
  frameFacing?: number;
  frameMapIndex?: number;
  doorGraphics?: number[][]; // d.DoorGraphic[3][2] resolved for current level (Code390e.cpp:180+)
  numWallDecoration?: number; // d.NumWallDecoration (CSBCode.cpp:5798)
  useMirrorImages?: boolean; // d.UseMirrorImages (Viewport.cpp:6740)

  // Viewport canvas for drawing
  viewportContext: CanvasRenderingContext2D;
  viewportIndexBuffer?: PaletteIndexViewportBuffer;
  seeThroughWalls?: boolean; // d.SeeThruWalls (Viewport.cpp:2639)
  facingAlcove?: boolean;
  facingViAltar?: boolean;
  facingWaterFountain?: boolean;

  // Room data for all 21 cells
  roomData: SummarizeRoomData[];

  // Per-frame wall decoration hit rects (viewport coordinates)
  wallDecorationRects?: RectPos[];
  doorSwitchRects?: RectPos[];
  viewportObjectButtons?: RectPos[];
  viewportObjectRNs?: ObjectID[];

  // Monster attack animation state hook (used for sound triggers)
  onMonsterAttackState?: (monster: CreatureRecord, index: number, soundOrdinal: number, isAttacking: boolean) => void;

}

/**
 * Rectangle position - port from CSB.h RectPos union
 */
export interface RectPos {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  // Source clipping (from byte variant)
  srcWidth?: number;
  srcHeight?: number;
  srcX?: number;
  srcY?: number;
  srcStride?: number;
}

/**
 * CSBWin `RECT_POINTERS` enum (Viewport.cpp:788+).
 *
 * These values are what CSBWin pushes on the stack for "Std*Rectangle*" opcodes,
 * then resolves with `StdRectanglePointers(pop())`.
 */
enum StdRectPtr {
  RECT_StdWallRectangleF3L2 = 0,
  RECT_StdWallRectangleF3L1,
  RECT_StdWallRectangleF3,
  RECT_StdWallRectangleF3R1,
  RECT_StdWallRectangleF3R2,
  RECT_StdWallRectangleF2L1,
  RECT_StdWallRectangleF2,
  RECT_StdWallRectangleF2R1,
  RECT_StdWallRectangleF1L1,
  RECT_StdWallRectangleF1,
  RECT_StdWallRectangleF1R1,
  RECT_StdWallRectangleF0L1,
  RECT_StdWallRectangleF0,
  RECT_StdWallRectangleF0R1,

  RECT_StdFloorPitRectangleF3L1,
  RECT_StdFloorPitRectangleF3,
  RECT_StdFloorPitRectangleF3R1,
  RECT_StdFloorPitRectangleF2L1,
  RECT_StdFloorPitRectangleF2,
  RECT_StdFloorPitRectangleF2R1,
  RECT_StdFloorPitRectangleF1L1,
  RECT_StdFloorPitRectangleF1,
  RECT_StdFloorPitRectangleF1R1,
  RECT_StdFloorPitRectangleF0L1,
  RECT_StdFloorPitRectangleF0,
  RECT_StdFloorPitRectangleF0R1,

  RECT_StdStairFacingDownRectangleF3L1,
  RECT_StdStairFacingDownRectangleF3,
  RECT_StdStairFacingDownRectangleF3R1,
  RECT_StdStairFacingDownRectangleF2L1,
  RECT_StdStairFacingDownRectangleF2,
  RECT_StdStairFacingDownRectangleF2R1,
  RECT_StdStairFacingDownRectangleF1L1,
  RECT_StdStairFacingDownRectangleF1,
  RECT_StdStairFacingDownRectangleF1R1,
  RECT_StdStairFacingDownRectangleF0L,
  RECT_StdStairFacingDownRectangleF0R,

  RECT_StdStairFacingUpRectangleF3L1,
  RECT_StdStairFacingUpRectangleF3,
  RECT_StdStairFacingUpRectangleF3R1,
  RECT_StdStairFacingUpRectangleF2L1,
  RECT_StdStairFacingUpRectangleF2,
  RECT_StdStairFacingUpRectangleF2R1,
  RECT_StdStairFacingUpRectangleF1L1,
  RECT_StdStairFacingUpRectangleF1,
  RECT_StdStairFacingUpRectangleF1R1,
  RECT_StdStairFacingUpRectangleF0L,
  RECT_StdStairFacingUpRectangleF0R,

  RECT_StdTeleporterRectangleF3L1,
  RECT_StdTeleporterRectangleF3,
  RECT_StdTeleporterRectangleF3R1,
  RECT_StdTeleporterRectangleF2L1,
  RECT_StdTeleporterRectangleF2,
  RECT_StdTeleporterRectangleF2R1,
  RECT_StdTeleporterRectangleF1L1,
  RECT_StdTeleporterRectangleF1,
  RECT_StdTeleporterRectangleF1R1,
  RECT_StdTeleporterRectangleF0L1,
  RECT_StdTeleporterRectangleF0,
  RECT_StdTeleporterRectangleF0R1,

  RECT_StdStairEdgeRectangleF2L1,
  RECT_StdStairEdgeRectangleF2R1,
  RECT_StdStairEdgeUpRectangleF1L1,
  RECT_StdStairEdgeUpRectangleF1R1,
  RECT_StdStairEdgeDownRectangleF1L1,
  RECT_StdStairEdgeDownRectangleF1R1,
  RECT_StdStairEdgeRectangleF0L,
  RECT_StdStairEdgeRectangleF0R,

  RECT_StdDoorFacingTopTrackRectF2L1,
  RECT_StdDoorFacingTopTrackRectF2,
  RECT_StdDoorFacingTopTrackRectF2R1,
  RECT_StdDoorFacingTopTrackRectF1L1,
  RECT_StdDoorFacingTopTrackRectF1,
  RECT_StdDoorFacingTopTrackRectF1R1,
  RECT_StdDoorEdgeFrameRectF0,

  RECT_StdDoorRectsF3L1,
  RECT_StdDoorRectsF3,
  RECT_StdDoorRectsF3R1,
  RECT_StdDoorRectsF2L1,
  RECT_StdDoorRectsF2,
  RECT_StdDoorRectsF2R1,
  RECT_StdDoorRectsF1L1,
  RECT_StdDoorRectsF1,
  RECT_StdDoorRectsF1R1,
  RECT_StdDoorRectsF0,

  RECT_StdDoorFacingFrameRectF3L1,
  RECT_StdDoorFacingFrameRectF3R1,
  RECT_StdDoorFacingFrameRightRectF1,
  RECT_StdDoorFacingFrameLeftRectF1,
  RECT_StdDoorFacingFrameRightRectF2,
  RECT_StdDoorFacingFrameLeftRectF2,
  RECT_StdDoorFacingFrameRightRectF3,
  RECT_StdDoorFacingFrameLeftRectF3,

  RECT_StdSeeThruWallsRect,
  RECT_StdSeeThruWallsRect2,
}

/**
 * CSBWin `BITMAP_POINTERS` enum (Viewport.cpp:892+).
 */
enum StdBitmapPtr {
  BMP_StdWallBitmapF3L2 = 1000,
  BMP_StdWallBitmapF3L1,
  BMP_StdWallBitmapF3,
  BMP_StdWallBitmapF3R1,
  BMP_StdWallBitmapF3R2,
  BMP_StdWallBitmapF2L1,
  BMP_StdWallBitmapF2,
  BMP_StdWallBitmapF2R1,
  BMP_StdWallBitmapF1L1,
  BMP_StdWallBitmapF1,
  BMP_StdWallBitmapF1R1,
  BMP_StdWallBitmapF0L1,
  BMP_StdWallBitmapF0R1,

  BMP_StdDoorFacingFrameLeftBitmapF3L1,
  BMP_StdDoorFacingFrameLeftBitmapF3,
  BMP_StdDoorFacingFrameLeftBitmapF3R1,
  BMP_StdDoorFacingFrameLeftBitmapF2,
  BMP_StdDoorFacingFrameLeftBitmapF1,
  BMP_StdDoorFacingFrameRightBitmapF1,
  BMP_StdDoorEdgeFrameBitmapF0,
  BMP_StdDoorFacingTopTrackBitmapF2,
  BMP_StdDoorFacingTopTrackBitmapF1,

  BMP_StdBitmapViewport,
  BMP_StdHoleInWallBitmap,
}

enum SideOfDoor {
  NotADoor = 0,
  FarSide = 1,
  NearSide = 2,
}

/**
 * Bytecode interpreter - direct port from CSBWin Viewport.cpp
 *
 * This function executes a bytecode program by iterating through
 * the opcode array and dispatching to handler functions.
 */
export class BytecodeInterpreter {
  private context: InterpreterContext;
  private pc: number = 0;  // Program counter
  private program: number[] = [];
  private stack: number[] = [];
  private mirrorCache = new WeakMap<IndexedBitmap, IndexedBitmap>();
  private flipCache = new WeakMap<IndexedBitmap, IndexedBitmap>();
  private graphicRandomState = 12345;
  private removeMortarJoint = true;
  private hasAlcove = 0;

  constructor(context: InterpreterContext) {
    this.context = context;
  }

  /**
   * Execute a bytecode program
   * Direct port of Interpret() from Viewport.cpp line ~6794
   */
  public interpret(program: number[], cellNum: number): void {
    this.program = program;
    this.pc = 0;
    this.stack = [];
    this.removeMortarJoint = true;
    this.hasAlcove = 0;

    void cellNum;
    // Executing program for cell ${cellNum}

    // Main interpreter loop
    while (this.pc < this.program.length) {
      const opcode = this.program[this.pc];
      this.pc++;

      // Dispatch to opcode handler
      if (!this.executeOpcode(opcode)) {
        break;  // Return opcode
      }
    }
  }

  /**
   * Execute a single opcode
   * Returns false if execution should stop (Return opcode)
   */
  private executeOpcode(opcode: number): boolean {
    switch (opcode) {
      case Opcode.Return:
        return this.opReturn();

      case Opcode.StdBltShape:
        return this.opStdBltShape();

      case Opcode.StdBltShapeToViewport:
        return this.opStdBltShapeToViewport(false);

      case Opcode.StdMirrorShapeToViewport:
        return this.opStdBltShapeToViewport(true);

      case Opcode.StdGraphicToViewport:
        return this.opStdGraphicToViewport(false);

      case Opcode.StdMirrorGraphicToViewport:
        return this.opStdGraphicToViewport(true);

      case Opcode.JumpZ:
        return this.opJumpZ();

      case Opcode.JumpNZ:
        return this.opJumpNZ();

      case Opcode.Jump:
        return this.opJump();

      case Opcode.Literal:
        return this.opLiteral();

      case Opcode.GetDecoration0:
        return this.opGetDecoration0();

      case Opcode.SeeThroughWalls:
        this.stack.push(this.context.seeThroughWalls ? 1 : 0);
        return true;

      case Opcode.LeaveMortarJoint:
        this.removeMortarJoint = false;
        return true;

      // Bitmap opcodes - push bitmap pointer to stack
      case Opcode.StdWallBitmapF3L2:
      case Opcode.StdWallBitmapF3L1:
      case Opcode.StdWallBitmapF3:
      case Opcode.StdWallBitmapF3R1:
      case Opcode.StdWallBitmapF3R2:
      case Opcode.StdWallBitmapF2L1:
      case Opcode.StdWallBitmapF2:
      case Opcode.StdWallBitmapF2R1:
      case Opcode.StdWallBitmapF1L1:
      case Opcode.StdWallBitmapF1:
      case Opcode.StdWallBitmapF1R1:
      case Opcode.StdWallBitmapF0L1:
      case Opcode.StdWallBitmapF0R1:
        return this.opWallBitmap(opcode);

      // Rectangle opcodes - push rectangle pointer to stack
      case Opcode.StdWallRectangleF3L2:
      case Opcode.StdWallRectangleF3L1:
      case Opcode.StdWallRectangleF3:
      case Opcode.StdWallRectangleF3R1:
      case Opcode.StdWallRectangleF3R2:
      case Opcode.StdWallRectangleF2L1:
      case Opcode.StdWallRectangleF2:
      case Opcode.StdWallRectangleF2R1:
      case Opcode.StdWallRectangleF1L1:
      case Opcode.StdWallRectangleF1:
      case Opcode.StdWallRectangleF1R1:
      case Opcode.StdWallRectangleF0L1:
      case Opcode.StdWallRectangleF0:
      case Opcode.StdWallRectangleF0R1:
        return this.opWallRectangle(opcode);

      // Cell opcodes - push CSBWin relative cell number
      case Opcode.F4L1:
      case Opcode.F4:
      case Opcode.F4R1:
      case Opcode.F3L2:
      case Opcode.F3L1:
      case Opcode.F3:
      case Opcode.F3R1:
      case Opcode.F3R2:
      case Opcode.F2L1:
      case Opcode.F2:
      case Opcode.F2R1:
      case Opcode.F1L1:
      case Opcode.F1:
      case Opcode.F1R1:
      case Opcode.F0L1:
      case Opcode.F0:
      case Opcode.F0R1:
        return this.opCellNumber(opcode);

      // Decoration/condition opcodes
      case Opcode.Alcove:
        return this.opCondition(opcode);

      case Opcode.DoorSwitch:
        return this.opDoorSwitch();

      case Opcode.wallDecorationRight:
      case Opcode.wallDecorationFront:
      case Opcode.wallDecorationLeft:
        return this.opWallDecorationPos(opcode);

      case Opcode.HasDecoration:
        return this.opHasDecoration();

      case Opcode.FloorDecorationGraphicOrdinalF3L1:
      case Opcode.FloorDecorationGraphicOrdinalF3:
      case Opcode.FloorDecorationGraphicOrdinalF3R1:
      case Opcode.FloorDecorationGraphicOrdinalF2L1:
      case Opcode.FloorDecorationGraphicOrdinalF2:
      case Opcode.FloorDecorationGraphicOrdinalF2R1:
      case Opcode.FloorDecorationGraphicOrdinalF1L1:
      case Opcode.FloorDecorationGraphicOrdinalF1:
      case Opcode.FloorDecorationGraphicOrdinalF1R1:
      case Opcode.FloorDecorationGraphicOrdinalF0L1:
      case Opcode.FloorDecorationGraphicOrdinalF0:
      case Opcode.FloorDecorationGraphicOrdinalF0R1:
        return this.opFloorDecorationGraphicOrdinal(opcode);

      // Drawing opcodes
      case Opcode.StdDrawCeilingPit:
      case Opcode.StdDrawSeeThruDoorEdge:
        return this.opDrawAction(opcode);

      case Opcode.StdDrawDoorSwitch:
        return this.opStdDrawDoorSwitch();

      case Opcode.StdDrawFloorDecoration:
        return this.opStdDrawFloorDecoration();

      case Opcode.StdDrawTeleporter:
        return this.opStdDrawTeleporter();

      case Opcode.StdDrawRoomObjects:
        return this.opStdDrawRoomObjects();

      case Opcode.StdDrawDoor:
        return this.opStdDrawDoor();

      case Opcode.StdDrawWallDecoration:
        return this.opStdDrawWallDecoration();

      case Opcode.StdDrawWallText:
        return this.opStdDrawWallText();

      // Floor pit rectangles - push rectangle index
      case Opcode.StdFloorPitRectangleF3L1:
      case Opcode.StdFloorPitRectangleF3:
      case Opcode.StdFloorPitRectangleF3R1:
      case Opcode.StdFloorPitRectangleF2L1:
      case Opcode.StdFloorPitRectangleF2:
      case Opcode.StdFloorPitRectangleF2R1:
      case Opcode.StdFloorPitRectangleF1L1:
      case Opcode.StdFloorPitRectangleF1:
      case Opcode.StdFloorPitRectangleF1R1:
      case Opcode.StdFloorPitRectangleF0L1:
      case Opcode.StdFloorPitRectangleF0:
      case Opcode.StdFloorPitRectangleF0R1:
        return this.opFloorPitRectangle(opcode);

      // Teleporter rectangles - push rectangle index
      case Opcode.StdTeleporterRectangleF3L1:
      case Opcode.StdTeleporterRectangleF3:
      case Opcode.StdTeleporterRectangleF3R1:
      case Opcode.StdTeleporterRectangleF2L1:
      case Opcode.StdTeleporterRectangleF2:
      case Opcode.StdTeleporterRectangleF2R1:
      case Opcode.StdTeleporterRectangleF1L1:
      case Opcode.StdTeleporterRectangleF1:
      case Opcode.StdTeleporterRectangleF1R1:
      case Opcode.StdTeleporterRectangleF0L1:
      case Opcode.StdTeleporterRectangleF0:
      case Opcode.StdTeleporterRectangleF0R1:
        return this.opTeleporterRectangle(opcode);

      // Stair rectangles (facing up)
      case Opcode.StdStairFacingUpRectangleF3L1:
      case Opcode.StdStairFacingUpRectangleF3:
      case Opcode.StdStairFacingUpRectangleF3R1:
      case Opcode.StdStairFacingUpRectangleF2L1:
      case Opcode.StdStairFacingUpRectangleF2:
      case Opcode.StdStairFacingUpRectangleF2R1:
      case Opcode.StdStairFacingUpRectangleF1L1:
      case Opcode.StdStairFacingUpRectangleF1:
      case Opcode.StdStairFacingUpRectangleF1R1:
      case Opcode.StdStairFacingUpRectangleF0L:
      case Opcode.StdStairFacingUpRectangleF0R:
        return this.opStairRectangle(opcode);

      // Stair rectangles (facing down)
      case Opcode.StdStairFacingDownRectangleF3L1:
      case Opcode.StdStairFacingDownRectangleF3:
      case Opcode.StdStairFacingDownRectangleF3R1:
      case Opcode.StdStairFacingDownRectangleF2L1:
      case Opcode.StdStairFacingDownRectangleF2:
      case Opcode.StdStairFacingDownRectangleF2R1:
      case Opcode.StdStairFacingDownRectangleF1L1:
      case Opcode.StdStairFacingDownRectangleF1:
      case Opcode.StdStairFacingDownRectangleF1R1:
      case Opcode.StdStairFacingDownRectangleF0L:
      case Opcode.StdStairFacingDownRectangleF0R:
        return this.opStairRectangle(opcode);

      // Stair graphics (facing up)
      case Opcode.StdStairFacingUpGraphicF3L1:
      case Opcode.StdStairFacingUpGraphicF3:
      case Opcode.StdStairFacingUpGraphicF3R1:
      case Opcode.StdStairFacingUpGraphicF2L1:
      case Opcode.StdStairFacingUpGraphicF2:
      case Opcode.StdStairFacingUpGraphicF2R1:
      case Opcode.StdStairFacingUpGraphicF1L1:
      case Opcode.StdStairFacingUpGraphicF1:
      case Opcode.StdStairFacingUpGraphicF1R1:
      case Opcode.StdStairFacingUpGraphicF0:
        return this.opStairGraphic(opcode);

      // Stair graphics (facing down)
      case Opcode.StdStairFacingDownGraphicF3L1:
      case Opcode.StdStairFacingDownGraphicF3:
      case Opcode.StdStairFacingDownGraphicF3R1:
      case Opcode.StdStairFacingDownGraphicF2L1:
      case Opcode.StdStairFacingDownGraphicF2:
      case Opcode.StdStairFacingDownGraphicF2R1:
      case Opcode.StdStairFacingDownGraphicF1L1:
      case Opcode.StdStairFacingDownGraphicF1:
      case Opcode.StdStairFacingDownGraphicF1R1:
      case Opcode.StdStairFacingDownGraphicF0:
        return this.opStairGraphic(opcode);

      // Stair edge graphics and rectangles
      case Opcode.StdStairEdgeGraphicF2:
      case Opcode.StdStairEdgeGraphicUpF1:
      case Opcode.StdStairEdgeGraphicDownF1:
      case Opcode.StdStairEdgeGraphicF0L1:
      case Opcode.StdStairEdgeGraphicF0R1:
        return this.opStairEdgeGraphic(opcode);

      case Opcode.StdStairEdgeRectF2L1:
      case Opcode.StdStairEdgeRectF2R1:
      case Opcode.StdStairEdgeUpRectF1L1:
      case Opcode.StdStairEdgeUpRectF1R1:
      case Opcode.StdStairEdgeDownRectF1L1:
      case Opcode.StdStairEdgeDownRectF1R1:
      case Opcode.StdStairEdgeRectF0L1:
      case Opcode.StdStairEdgeRectF0R1:
        return this.opStairEdgeRectangle(opcode);

      // Door opcodes (bitmaps, rectangles, states, indices)
      case Opcode.StdDoorEdgeFrameBitmapF0:
      case Opcode.StdDoorFacingFrameLeftBitmapF2:
      case Opcode.StdDoorFacingFrameLeftBitmapF1:
      case Opcode.StdDoorFacingFrameRightBitmapF1:
      case Opcode.StdDoorFacingFrameLeftBitmapF3:
      case Opcode.StdDoorFacingFrameLeftBitmapF3R1:
      case Opcode.StdDoorFacingFrameLeftBitmapF3L1:
      case Opcode.StdDoorFacingTopTrackBitmapF1:
      case Opcode.StdDoorFacingTopTrackBitmapF2:
        return this.opDoorBitmap(opcode);

      case Opcode.F3L1DoorRecordIndex:
      case Opcode.F3DoorRecordIndex:
      case Opcode.F3R1DoorRecordIndex:
      case Opcode.F2L1DoorRecordIndex:
      case Opcode.F2DoorRecordIndex:
      case Opcode.F2R1DoorRecordIndex:
      case Opcode.F1L1DoorRecordIndex:
      case Opcode.F1DoorRecordIndex:
      case Opcode.F1R1DoorRecordIndex:
      case Opcode.F0DoorRecordIndex:
        return this.opDoorRecordIndex(opcode);

      case Opcode.F3L1DoorState:
      case Opcode.F3DoorState:
      case Opcode.F3R1DoorState:
      case Opcode.F2L1DoorState:
      case Opcode.F2DoorState:
      case Opcode.F2R1DoorState:
      case Opcode.F1L1DoorState:
      case Opcode.F1DoorState:
      case Opcode.F1R1DoorState:
      case Opcode.F0DoorState:
        return this.opDoorState(opcode);

      case Opcode.StdDoorGraphicsF3:
      case Opcode.StdDoorGraphicsF2:
      case Opcode.StdDoorGraphicsF1:
        return this.opDoorGraphics(opcode);

      case Opcode.StdDoorRectsF3L1:
      case Opcode.StdDoorRectsF3:
      case Opcode.StdDoorRectsF3R1:
      case Opcode.StdDoorRectsF2L1:
      case Opcode.StdDoorRectsF2:
      case Opcode.StdDoorRectsF2R1:
      case Opcode.StdDoorRectsF1L1:
      case Opcode.StdDoorRectsF1:
      case Opcode.StdDoorRectsF1R1:
      case Opcode.StdDoorRectsF0:
        return this.opDoorRects(opcode);

      case Opcode.StdDoorEdgeFrameRectF0:
      case Opcode.StdDoorFacingTopTrackRectF2L1:
      case Opcode.StdDoorFacingTopTrackRectF2:
      case Opcode.StdDoorFacingTopTrackRectF2R1:
      case Opcode.StdDoorFacingTopTrackRectF1L1:
      case Opcode.StdDoorFacingTopTrackRectF1:
      case Opcode.StdDoorFacingTopTrackRectF1R1:
      case Opcode.StdDoorFacingTopTrackRectF0:
      case Opcode.StdDoorFacingFrameRectF3L1:
      case Opcode.StdDoorFacingFrameRectF3R1:
      case Opcode.StdDoorFacingFrameRightRectF3:
      case Opcode.StdDoorFacingFrameLeftRectF3:
      case Opcode.StdDoorFacingFrameRightRectF2:
      case Opcode.StdDoorFacingFrameLeftRectF2:
      case Opcode.StdDoorFacingFrameRightRectF1:
      case Opcode.StdDoorFacingFrameLeftRectF1:
        return this.opDoorFrameRectangle(opcode);

      // Drawing order opcodes - push draw order value
      case Opcode.DrawOrder00:
      case Opcode.DrawOrder01:
      case Opcode.DrawOrder02:
      case Opcode.DrawOrder18:
      case Opcode.DrawOrder21:
      case Opcode.DrawOrder28:
      case Opcode.DrawOrder32:
      case Opcode.DrawOrder39:
      case Opcode.DrawOrder41:
      case Opcode.DrawOrder49:
      case Opcode.DrawOrder128:
      case Opcode.DrawOrder218:
      case Opcode.DrawOrder321:
      case Opcode.DrawOrder342:
      case Opcode.DrawOrder349:
      case Opcode.DrawOrder412:
      case Opcode.DrawOrder431:
      case Opcode.DrawOrder439:
      case Opcode.DrawOrder3421:
      case Opcode.DrawOrder4312:
        return this.opDrawOrder(opcode);

      // XY position opcodes - push x,y coordinates
      case Opcode.F4L1xy:
      case Opcode.F4xy:
      case Opcode.F4R1xy:
      case Opcode.F3L2xy:
      case Opcode.F3L1xy:
      case Opcode.F3xy:
      case Opcode.F3R1xy:
      case Opcode.F3R2xy:
      case Opcode.F2L1xy:
      case Opcode.F2xy:
      case Opcode.F2R1xy:
      case Opcode.F1L1xy:
      case Opcode.F1xy:
      case Opcode.F1R1xy:
      case Opcode.F0L1xy:
      case Opcode.F0xy:
      case Opcode.F0R1xy:
        return this.opCellXY(opcode);

      // Contents opcodes - push contents/object list
      case Opcode.F4L1Contents:
      case Opcode.F4Contents:
      case Opcode.F4R1Contents:
      case Opcode.F3L2Contents:
      case Opcode.F3L1Contents:
      case Opcode.F3Contents:
      case Opcode.F3R1Contents:
      case Opcode.F3R2Contents:
      case Opcode.F2L1Contents:
      case Opcode.F2Contents:
      case Opcode.F2R1Contents:
      case Opcode.F1L1Contents:
      case Opcode.F1Contents:
      case Opcode.F1R1Contents:
      case Opcode.F0L1Contents:
      case Opcode.F0Contents:
      case Opcode.F0R1Contents:
        return this.opCellContents(opcode);

      // Wall position opcodes (for decorations)
      case Opcode.WallF3L1Front:
      case Opcode.WallF3L1Right:
      case Opcode.WallF3Front:
      case Opcode.WallF3R1Left:
      case Opcode.WallF3R1Front:
      case Opcode.WallF2L1Front:
      case Opcode.WallF2L1Right:
      case Opcode.WallF2Front:
      case Opcode.WallF2R1Left:
      case Opcode.WallF2R1Front:
      case Opcode.WallF1L1Right:
      case Opcode.WallF1Front:
      case Opcode.WallF1R1Left:
        return this.opWallPosition(opcode);

      default:
        console.warn(`WARNING: Unimplemented opcode ${opcode}`)
        return true;
    }
  }

  // ============================================================
  // OPCODE HANDLERS
  // ============================================================

  private opReturn(): boolean {
    return false;  // Stop execution
  }

  private opStdBltShape(): boolean {
    // CSBWin: pop rectangle pointer, pop bitmap pointer, then blit with transparentColor=10.
    const rectanglePtr = this.stack.pop();
    const bitmapPtr = this.stack.pop();

    if (bitmapPtr === undefined || rectanglePtr === undefined) {
      // ERROR: StdBltShape - missing arguments
      return true;
    }

    // StdBltShape(bitmapPtr=${bitmapPtr}, rectPtr=${rectanglePtr})

    const bitmap = this.resolveStdBitmapPointer(bitmapPtr);
    const rectRef = this.resolveStdRectanglePointer(rectanglePtr);
    if (!bitmap) {
      // ERROR: Unknown StdBitmapPointers(${bitmapPtr})
      return true;
    }
    if (!rectRef) {
      // ERROR: Unknown StdRectanglePointers(${rectanglePtr})
      return true;
    }
    if (Array.isArray(rectRef)) {
      // ERROR: StdBltShape expects a single RectPos, got an array
      return true;
    }

    this.blitShapeBitmapToViewport(bitmap, rectRef, false);

    return true;
  }

  private opJumpZ(): boolean {
    // Pop condition from stack
    const condition = this.stack.pop();
    // Next value is jump offset
    const offset = this.program[this.pc];
    this.pc++;

    if (condition === 0) {
      // -> Jumping ${offset} instructions
      this.pc += offset;
    }

    return true;
  }

  private opJumpNZ(): boolean {
    const condition = this.stack.pop();
    const offset = this.program[this.pc];
    this.pc++;

    if (condition !== 0) {
      // -> Jumping ${offset} instructions
      this.pc += offset;
    }

    return true;
  }

  private opJump(): boolean {
    const offset = this.program[this.pc];
    this.pc++;

    // -> Jumping ${offset} instructions
    this.pc += offset;
    return true;
  }

  private opLiteral(): boolean {
    // Next value is the literal to push
    const value = this.program[this.pc];
    this.pc++;

    // Literal(${value})
    this.stack.push(value);

    return true;
  }

  private opWallBitmap(opcode: number): boolean {
    // Push CSBWin BITMAP_POINTERS value (resolved later by StdBitmapPointers).
    const mapping: { [key: number]: number } = {
      [Opcode.StdWallBitmapF3L2]: StdBitmapPtr.BMP_StdWallBitmapF3L2,
      [Opcode.StdWallBitmapF3L1]: StdBitmapPtr.BMP_StdWallBitmapF3L1,
      [Opcode.StdWallBitmapF3]: StdBitmapPtr.BMP_StdWallBitmapF3,
      [Opcode.StdWallBitmapF3R1]: StdBitmapPtr.BMP_StdWallBitmapF3R1,
      [Opcode.StdWallBitmapF3R2]: StdBitmapPtr.BMP_StdWallBitmapF3R2,
      [Opcode.StdWallBitmapF2L1]: StdBitmapPtr.BMP_StdWallBitmapF2L1,
      [Opcode.StdWallBitmapF2]: StdBitmapPtr.BMP_StdWallBitmapF2,
      [Opcode.StdWallBitmapF2R1]: StdBitmapPtr.BMP_StdWallBitmapF2R1,
      [Opcode.StdWallBitmapF1L1]: StdBitmapPtr.BMP_StdWallBitmapF1L1,
      [Opcode.StdWallBitmapF1]: StdBitmapPtr.BMP_StdWallBitmapF1,
      [Opcode.StdWallBitmapF1R1]: StdBitmapPtr.BMP_StdWallBitmapF1R1,
      [Opcode.StdWallBitmapF0L1]: StdBitmapPtr.BMP_StdWallBitmapF0L1,
      [Opcode.StdWallBitmapF0R1]: StdBitmapPtr.BMP_StdWallBitmapF0R1,
    };
    const ptr = mapping[opcode] ?? StdBitmapPtr.BMP_StdWallBitmapF3;
    // WallBitmapPtr[${ptr}]
    this.stack.push(ptr);
    return true;
  }

  private opWallRectangle(opcode: number): boolean {
    // Push CSBWin RECT_POINTERS value (resolved later by StdRectanglePointers)
    const rectPtr = this.getStdWallRectanglePointer(opcode);
    // WallRectanglePtr[${rectPtr}]
    this.stack.push(rectPtr);
    return true;
  }

  private opStdBltShapeToViewport(mirror: boolean): boolean {
    // CSBWin StdBltShapeToViewport / StdMirrorShapeToViewport (Viewport.cpp:2849-2859)
    const rectanglePtr = this.stack.pop();
    const bitmapPtr = this.stack.pop();
    if (bitmapPtr === undefined || rectanglePtr === undefined) {
      // ERROR: ${mirror ? 'StdMirrorShapeToViewport' : 'StdBltShapeToViewport'} - missing arguments
      return true;
    }

    const rectRef = this.resolveStdRectanglePointer(rectanglePtr);
    const bitmap = this.resolveStdBitmapPointer(bitmapPtr);
    if (!rectRef || Array.isArray(rectRef) || !bitmap) {
      // ERROR: Invalid args bitmapPtr=${bitmapPtr} rectPtr=${rectanglePtr}
      return true;
    }

    // ${mirror ? 'StdMirrorShapeToViewport' : 'StdBltShapeToViewport'}(bitmapPtr=${bitmapPtr}, rectPtr=${rectanglePtr})
    this.blitShapeBitmapToViewport(bitmap, rectRef, mirror);
    return true;
  }

  private opStdGraphicToViewport(mirror: boolean): boolean {
    // CSBWin StdGraphicToViewport / StdMirrorGraphicToViewport (Viewport.cpp:2899-2908)
    const rectanglePtr = this.stack.pop();
    const graphicNum = this.stack.pop();
    if (graphicNum === undefined || rectanglePtr === undefined) {
      // ERROR: ${mirror ? 'StdMirrorGraphicToViewport' : 'StdGraphicToViewport'} - missing arguments
      return true;
    }

    const rectRef = this.resolveStdRectanglePointer(rectanglePtr);
    if (!rectRef || Array.isArray(rectRef)) {
      // ERROR: Invalid rectanglePtr=${rectanglePtr}
      return true;
    }

    const getGraphic = this.context.getGraphicBitmap;
    if (!getGraphic) {
      // ERROR: Missing context.getGraphicBitmap
      return true;
    }

    const bitmap = getGraphic(graphicNum);
    if (!bitmap) {
      // ERROR: Could not resolve basic graphic ${graphicNum}
      return true;
    }

    // ${mirror ? 'StdMirrorGraphicToViewport' : 'StdGraphicToViewport'}(graphic=${graphicNum}, rectPtr=${rectanglePtr})
    this.blitShapeBitmapToViewport(bitmap, rectRef, mirror);
    return true;
  }

  private opGetDecoration0(): boolean {
    // CSBWin `GetDecoration0` (Viewport.cpp:2875-2878)
    const relativeCell = this.stack.pop();
    if (relativeCell === undefined) {
      // ERROR: GetDecoration0 - missing relativeCell
      this.stack.push(0);
      return true;
    }
    const v = this.context.roomData[relativeCell]?.decorations[0] ?? 0;
    // GetDecoration0(cell=${relativeCell}) -> ${v}
    this.stack.push(v);
    return true;
  }

  private opCellNumber(opcode: number): boolean {
    const cell = this.relativeCellFromCellOpcode(opcode);
    // CellNumber(${Opcode[opcode]}) -> ${cell}
    this.stack.push(cell);
    return true;
  }

  private opCondition(opcode: number): boolean {
    if (opcode === Opcode.Alcove) {
      // CSBWin uses the last StdDrawWallDecoration result (Viewport.cpp:2946).
      this.stack.push(this.hasAlcove ? 1 : 0);
      return true;
    }
    // Condition(${Opcode[opcode]}) -> 0
    this.stack.push(0);
    return true;
  }

  private opWallDecorationPos(opcode: number): boolean {
    // CSBWin Viewport.cpp:2641-2643
    const v = opcode === Opcode.wallDecorationFront ? 1 : opcode === Opcode.wallDecorationLeft ? 2 : 0;
    // WallDecorationPos(${Opcode[opcode]}) -> ${v}
    this.stack.push(v);
    return true;
  }

  private opHasDecoration(): boolean {
    // CSBWin Viewport.cpp:2633-2637
    const wallDecorationPos = this.stack.pop();
    const relativeCell = this.stack.pop();
    if (wallDecorationPos === undefined || relativeCell === undefined) {
      // ERROR: HasDecoration - missing arguments
      this.stack.push(0);
      return true;
    }
    const cell = this.context.roomData[relativeCell];
    const has = cell ? (cell.decorations[wallDecorationPos as 0 | 1 | 2] !== 0 ? 1 : 0) : 0;
    // HasDecoration(cell=${relativeCell}, pos=${wallDecorationPos}) -> ${has}
    this.stack.push(has);
    return true;
  }

  private opDoorSwitch(): boolean {
    const relativeCell = this.stack.pop();
    if (relativeCell === undefined) {
      this.stack.push(0);
      return true;
    }
    const doorIndex = this.context.roomData[relativeCell | 0]?.decorations[1] ?? 0;
    const dungeon = this.context.dungeonState;
    if (!dungeon) {
      this.stack.push(0);
      return true;
    }
    const rec = dungeon.getDoorRecordByIndex(doorIndex | 0);
    const hasSwitch = rec?.hasButton ? 1 : 0;
    this.stack.push(hasSwitch);
    return true;
  }

  private opFloorDecorationGraphicOrdinal(opcode: number): boolean {
    const cell = this.relativeCellFromFloorDecorationOpcode(opcode);
    const v = this.context.roomData[cell]?.decorations[2] ?? 0;
    // FloorDecorationGraphicOrdinal(${Opcode[opcode]}) cell=${cell} -> ${v}
    this.stack.push(v);
    return true;
  }

  private opStdDrawFloorDecoration(): boolean {
    // CSBWin StdDrawFloorDecoration: (relativeCell floorGraphicOrdinal ...)
    const floorGraphicOrdinal = this.stack.pop();
    const relativeCell = this.stack.pop();

    if (floorGraphicOrdinal === undefined || relativeCell === undefined) {
      // ERROR: StdDrawFloorDecoration - missing arguments
      return true;
    }

    const floorCell = BytecodeInterpreter.floorDrawingLocations[relativeCell | 0] ?? 0;
    this.drawFloorDecorations(floorGraphicOrdinal | 0, floorCell | 0);
    return true;
  }

  private opDrawAction(opcode: number): boolean {
    void opcode;
    // Pop arguments (varies by opcode)
    // For prototype, just log the call
    // ${opcodeName}(stack size: ${this.stack.length})

    // Clear stack for this drawing operation
    this.stack = [];

    return true;
  }

  private opStdDrawDoorSwitch(): boolean {
    // CSBWin `StdDrawDoorSwitch` (Viewport.cpp:2886-2889, CSBCode.cpp:4065+)
    const distance = this.stack.pop();
    const switchId = this.stack.pop();

    if (distance === undefined || switchId === undefined) {
      // ERROR: StdDrawDoorSwitch - missing arguments
      return true;
    }

    const doorSwitchId = switchId | 0;
    if (doorSwitchId === 0) return true;

    const tables = this.context.objectTables;
    const viewport = this.context.viewportIndexBuffer;
    const getGraphic = this.context.getGraphicBitmap;
    if (!tables || !viewport || !getGraphic) return true;

    const setIndex = tables.doorSwitchRectIndex[doorSwitchId - 1] ?? 0;
    const rectSet = tables.doorSwitchRectSets?.[setIndex];
    const srcSet = tables.doorSwitchSourceDescSets?.[setIndex];
    const distanceIndex = distance | 0;
    if (distanceIndex < 0 || distanceIndex > 3) return true;
    const desc = rectSet?.[distanceIndex];
    if (!desc) return true;

    const graphicNum = 315 + (doorSwitchId - 1);
    const base = getGraphic(graphicNum);
    if (!base) return true;

    const srcDesc = srcSet?.[0] ?? desc;
    const srcWidthBytes = srcDesc.widthBytes | 0;
    const srcWidth = srcWidthBytes > 0 ? srcWidthBytes * 2 : base.width;
    const srcHeight = (srcDesc.height | 0) > 0 ? (srcDesc.height | 0) : base.height;
    const destWidth = (desc.x2 | 0) - (desc.x1 | 0) + 1;
    const rawDestHeight = desc.height | 0;
    const destHeight = rawDestHeight > 0 ? rawDestHeight : (desc.y2 | 0) - (desc.y1 | 0) + 1;
    if (destWidth <= 0 || destHeight <= 0) return true;

    let bitmap = this.cropBitmap(base, srcWidth, srcHeight);
    if (distanceIndex !== 3) {
      const colorMap = distanceIndex === 2 ? tables.colorMapMedium : tables.colorMapFar;
      bitmap = this.scaleIndexedBitmap(bitmap, destWidth, destHeight, colorMap);
    }

    bltShapeToViewportIndex(bitmap, viewport, { x1: desc.x1, y1: desc.y1, x2: desc.x2, y2: desc.y2 });

    if (distanceIndex === 3 && this.context.doorSwitchRects) {
      this.context.doorSwitchRects.push({ x1: desc.x1, y1: desc.y1, x2: desc.x2, y2: desc.y2 });
    }

    return true;
  }

  // ============================================================
  // ROOM OBJECTS (Phase 5)
  // ============================================================

  // CSBWin `objectDrawingLocations[21]` (Viewport.cpp:2419)
  private static readonly objectDrawingLocations: number[] = [0, 0, 0, 0, -2, -1, -3, 1, 2, 0, 0, 0, 4, 5, 3, 7, 8, 6, 10, 11, 9];
  private static readonly floorDrawingLocations: number[] = [
    0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 0, 3, 5, 4, 6, 8, 7, 0, 0, 9,
  ];
  private static readonly MAGIC_SPELL_BASE = 0xff80;
  private static readonly RN_FIREBALL = 0xff80;
  private static readonly RN_POISON = 0xff81;
  private static readonly RN_LIGHTNING = 0xff82;
  private static readonly RN_POISON_BOLT = 0xff86;
  private static readonly RN_POISON_CLOUD = 0xff87;

  private opStdDrawRoomObjects(): boolean {
    const drawOrder = this.stack.pop();
    const relCellRF = this.stack.pop();
    const mapY = this.stack.pop();
    const mapX = this.stack.pop();
    const firstObject = this.stack.pop();

    if (
      drawOrder === undefined ||
      relCellRF === undefined ||
      mapX === undefined ||
      mapY === undefined ||
      firstObject === undefined
    ) {
      // ERROR: StdDrawRoomObjects - missing arguments
      return true;
    }

    const facing = this.context.frameFacing ?? 0;
    const idx = relCellRF | 0;
    const relativeCell = BytecodeInterpreter.objectDrawingLocations[idx] ?? 0;

    // StdDrawRoomObjects(first=${firstObject}, x=${mapX}, y=${mapY}, rf=${relCellRF} -> rel=${relativeCell}, drawOrder=0x${drawOrder.toString(16)})
    this.drawRoomObjects(firstObject as ObjectID, facing, mapX | 0, mapY | 0, relativeCell | 0, drawOrder | 0);
    return true;
  }

  private opStdDrawTeleporter(): boolean {
    // CSBWin `StdDrawTeleporter` (Viewport.cpp:2891-2896)
    const wallRectPtr = this.stack.pop();
    const teleporterRectPtr = this.stack.pop();

    if (wallRectPtr === undefined || teleporterRectPtr === undefined) {
      // ERROR: StdDrawTeleporter - missing arguments
      return true;
    }

    const wallRect = this.resolveStdRectanglePointer(wallRectPtr);
    const teleporterRect = this.resolveStdRectanglePointer(teleporterRectPtr);
    if (!wallRect || Array.isArray(wallRect) || !teleporterRect || Array.isArray(teleporterRect)) {
      // ERROR: StdDrawTeleporter - invalid rectangle pointers
      return true;
    }

    this.drawTeleporter(teleporterRect, wallRect);
    return true;
  }

  private opStdDrawDoor(): boolean {
    // CSBWin `StdDrawDoor` (Viewport.cpp:2589-2610)
    const rectPtr = this.stack.pop();
    const doorGraphicIndex = this.stack.pop();
    const doorState = this.stack.pop();
    const doorRecordIndex = this.stack.pop();

    if (
      rectPtr === undefined ||
      doorGraphicIndex === undefined ||
      doorState === undefined ||
      doorRecordIndex === undefined
    ) {
      // ERROR: StdDrawDoor - missing arguments
      return true;
    }

    const rectRef = this.resolveStdRectanglePointer(rectPtr);
    if (!rectRef || !Array.isArray(rectRef)) {
      // ERROR: StdDrawDoor - expected door rect array from rectPtr=${rectPtr}
      return true;
    }

    const doorGraphics = this.context.doorGraphics;
    const dungeon = this.context.dungeonState;
    if (!doorGraphics || !dungeon) {
      // (skip) StdDrawDoor missing doorGraphics/dungeonState
      return true;
    }

    const record = dungeon.getDoorRecordByIndex(doorRecordIndex | 0);
    if (!record) {
      // (skip) StdDrawDoor invalid doorRecordIndex=${doorRecordIndex}
      return true;
    }

    const doorType = record.doorType & 1;
    const dg = doorGraphics[doorGraphicIndex | 0];
    const doorGraphicNum = dg?.[doorType] ?? -1;
    if (doorGraphicNum < 0) {
      // (skip) StdDrawDoor invalid doorGraphicIndex=${doorGraphicIndex}
      return true;
    }

    const getGraphic = this.context.getGraphicBitmap;
    const viewport = this.context.viewportIndexBuffer;
    if (!getGraphic || !viewport) return true;

    const bitmap = getGraphic(doorGraphicNum);
    if (!bitmap) {
      // (skip) StdDrawDoor could not load door graphic ${doorGraphicNum}
      return true;
    }

    const s = doorState | 0;
    if (s === 0) return true; // fully open

    const blit = (r: RectPos | undefined) => {
      if (!r) return;
      bltShapeToViewportIndex(bitmap, viewport, r);
    };

    if (s === 4 || s === 5) {
      // closed or bashed (CSBWin applies ornament effects; we currently draw the base panel).
      blit(rectRef[0]);
      return true;
    }

    // 1..3: opening/closing
    const modeUp = record.vertical; // CSBWin DB0.mode(): 1=up, 0=sideways
    if (modeUp) {
      blit(rectRef[s]);
    } else {
      blit(rectRef[3 + s]); // left half
      blit(rectRef[6 + s]); // right half
    }

    return true;
  }

  private opStdDrawWallDecoration(): boolean {
    // CSBWin `StdDrawWallDecoration` (Viewport.cpp:2942-2949)
    const wallDecorationDrawLocation = this.stack.pop();
    const wallDecorationPos = this.stack.pop();
    const relativeCell = this.stack.pop();

    if (wallDecorationDrawLocation === undefined || wallDecorationPos === undefined || relativeCell === undefined) {
      // ERROR: StdDrawWallDecoration - missing arguments
      return true;
    }

    const rd = this.context.roomData[relativeCell | 0];
    const graphicOrdinal = rd?.decorations[(wallDecorationPos as 0 | 1 | 2) ?? 0] ?? 0;
    this.hasAlcove = this.drawWallDecoration(graphicOrdinal | 0, wallDecorationDrawLocation | 0) ? 1 : 0;
    return true;
  }

  private opStdDrawWallText(): boolean {
    // CSBWin `StdDrawWallText` (Viewport.cpp:2930-2940)
    const wallDecorationDrawLocation = this.stack.pop();
    const wallDecorationPos = this.stack.pop();
    const relativeCell = this.stack.pop();

    if (wallDecorationDrawLocation === undefined || wallDecorationPos === undefined || relativeCell === undefined) {
      // ERROR: StdDrawWallText - missing arguments
      return true;
    }

    const rd = this.context.roomData[relativeCell | 0];
    const textRN = rd?.text[(wallDecorationPos as 0 | 1 | 2) ?? 0] ?? OBJECT_ID_EOF;
    this.drawWallText(textRN as ObjectID, wallDecorationDrawLocation | 0, this.removeMortarJoint);
    this.removeMortarJoint = true;
    return true;
  }

  private drawWallDecoration(graphicOrdinal: number, relativePosition: number): boolean {
    if (graphicOrdinal === 0) return false;

    const tables = this.context.objectTables;
    const dungeon = this.context.dungeonState;
    const viewport = this.context.viewportIndexBuffer;
    const getGraphic = this.context.getGraphicBitmap;
    const csbGraphics = this.context.csbGraphics;
    if (!tables || !dungeon || !viewport || !getGraphic) return false;

    if ((graphicOrdinal & 0x10000) !== 0) {
      if (!csbGraphics) return false;
      this.drawExtendedWallDecoration(csbGraphics, graphicOrdinal, relativePosition);
      return false;
    }

    const map = dungeon.getMap(this.context.frameMapIndex ?? 0);
    if (!map?.wallDecorationTOC) return false;

    // CSBWin: `graphicIndex = graphicOrdinal-1` (CSBCode.cpp:3179-3183)
    const graphicIndex = (graphicOrdinal - 1) | 0;
    const numWallDecoration = this.context.numWallDecoration ?? 0;
    if (graphicIndex < 0 || graphicIndex > numWallDecoration) return false;

    const decorationIndex = graphicIndex === numWallDecoration ? 0 : (map.wallDecorationTOC[graphicIndex] ?? 0);
    const isAlcove = this.isAlcoveDecorationIndex(decorationIndex, tables);
    const rectSetId = tables.wallDecorationRectSetIndex[decorationIndex] ?? 0;
    const rectSetIndex = rectSetId & 0xff;
    if (rectSetIndex >= tables.wallDecorationRectSets.length) return isAlcove;

    const rectSet = tables.wallDecorationRectSets[rectSetIndex];
    const desc = rectSet?.[relativePosition];
    if (!desc) return isAlcove;

    const x1 = desc.x1 | 0;
    const y1 = desc.y1 | 0;
    const x2 = desc.x2 | 0;
    const y2 = desc.y2 | 0;
    const dstW = x2 - x1 + 1;
    const dstH = y2 - y1 + 1;
    if (dstW <= 0 || dstH <= 0) return isAlcove;

    // CSBWin: `relativePosition % 5 > 1` selects front view; otherwise side view (CSBCode.cpp:3171-3176).
    const frontView = (relativePosition % 5) > 1;
    const graphicNum = 121 + 2 * decorationIndex + (frontView ? 1 : 0);

    const src = getGraphic(graphicNum);
    if (!src) return isAlcove;

    const distanceBand = Math.floor(relativePosition / 5); // 0=F3, 1=F2, 2=F1
    const mirror = relativePosition === 11 || relativePosition === 6 || relativePosition === 1;
    if (relativePosition === 12) {
      if (this.context.viewportObjectButtons?.[5]) {
        const button = this.context.viewportObjectButtons[5];
        button.x1 = x1;
        button.x2 = x2;
        button.y1 = y1;
        button.y2 = y2;
      }
      if (this.context.facingAlcove !== undefined) this.context.facingAlcove = isAlcove;
      if (this.context.facingViAltar !== undefined) this.context.facingViAltar = decorationIndex === 2;
      if (this.context.facingWaterFountain !== undefined) {
        const fountainIdx = tables.fountainDecorationIndex ?? -1;
        this.context.facingWaterFountain = decorationIndex === (fountainIdx | 0);
      }
    }

    if (relativePosition >= 10) {
      const bitmap = mirror ? this.getMirroredBitmap(src) : src;
      bltShapeToViewportIndex(bitmap, viewport, { x1, y1, x2, y2 });
      if (this.context.wallDecorationRects && distanceBand === 2) {
        this.context.wallDecorationRects.push({ x1, y1, x2, y2 });
      }
      return isAlcove;
    }

    const colorMap = distanceBand === 0 ? tables.floorColorMapFar : tables.floorColorMapMedium;
    let pWidthDescriptor = desc;
    let pSrcSizeDescriptor = rectSet?.[12];
    if (relativePosition === 6 || relativePosition === 1) {
      pSrcSizeDescriptor = rectSet?.[11];
    } else if (relativePosition === 5 || relativePosition === 0) {
      pSrcSizeDescriptor = rectSet?.[10];
    }
    if (relativePosition === 7 || relativePosition === 9) {
      pWidthDescriptor = rectSet?.[8] ?? desc;
    }
    const finalBitmapWidth = (pWidthDescriptor.x2 | 0) - (pWidthDescriptor.x1 | 0);
    let widthPixels = src.width | 0;
    let heightPixels = src.height | 0;
    widthPixels = (widthPixels + 15) & ~15;
    let widthBytes = widthPixels >> 1;
    if (pSrcSizeDescriptor) {
      if (widthBytes > (pSrcSizeDescriptor.widthBytes | 0)) widthBytes = pSrcSizeDescriptor.widthBytes | 0;
      if (heightPixels > (pSrcSizeDescriptor.height | 0)) heightPixels = pSrcSizeDescriptor.height | 0;
    }
    widthPixels = widthBytes * 2;
    const cropped = this.cropBitmap(src, widthPixels, heightPixels);

    const scaled = this.scaleIndexedBitmap(cropped, finalBitmapWidth + 1, desc.height | 0, colorMap, mirror);
    bltShapeToViewportIndex(scaled, viewport, { x1, y1, x2, y2 });

    if (this.context.wallDecorationRects && Math.floor(relativePosition / 5) === 2) {
      this.context.wallDecorationRects.push({ x1, y1, x2, y2 });
    }
    return isAlcove;
  }

  private isAlcoveDecorationIndex(decorationIndex: number, tables: ObjectTables): boolean {
    const alcoves = tables.alcoveDecorationIndices;
    for (let i = 0; i < alcoves.length; i++) {
      if ((alcoves[i] ?? 0xff) === decorationIndex) return true;
    }
    return false;
  }

  private drawExtendedWallDecoration(
    csbGraphics: CSBGraphicsLoader,
    graphicOrdinal: number,
    relativePosition: number
  ): void {
    const tables = this.context.objectTables;
    const viewport = this.context.viewportIndexBuffer;
    if (!tables || !viewport) return;

    const id = graphicOrdinal & 0xffff;
    if (id === 0) return;

    const ext = csbGraphics.getWallDecoration(id);
    if (!ext) return;

    const desc = ext.desc[relativePosition];
    if (!desc) return;

    const dstW = (desc.x2 | 0) - (desc.x1 | 0) + 1;
    const dstH = (desc.y2 | 0) - (desc.y1 | 0) + 1;
    if (dstW <= 0 || dstH <= 0) return;

    const frontView = (relativePosition % 5) > 1;
    const srcBitmap = frontView ? ext.frontBitmap : ext.sideBitmap;

    if (relativePosition >= 10) {
      const mirror = relativePosition === 11;
      const bitmap = mirror ? this.getMirroredBitmap(srcBitmap) : srcBitmap;
      bltShapeToViewportIndex(bitmap, viewport, { x1: desc.x1, y1: desc.y1, x2: desc.x2, y2: desc.y2 });
      return;
    }

    const farRightSidewall = relativePosition === 6 || relativePosition === 1;
    const pWDP = desc;
    let pWidthDescriptor = pWDP;
    let pSrcSizeDescriptor = ext.desc[12];
    if (farRightSidewall) {
      pSrcSizeDescriptor = ext.desc[11];
    } else if (relativePosition === 5 || relativePosition === 0) {
      pSrcSizeDescriptor = ext.desc[10];
    }
    if (relativePosition === 7 || relativePosition === 9) {
      pWidthDescriptor = ext.desc[8];
    }

    const finalBitmapWidth = (pWidthDescriptor.x2 | 0) - (pWidthDescriptor.x1 | 0);
    const sourceRect = frontView ? ext.desc[12] : ext.desc[11];
    let widthPixels = (sourceRect.x2 | 0) - (sourceRect.x1 | 0) + 1;
    let heightPixels = sourceRect.height | 0;
    widthPixels = (widthPixels + 15) & ~15;
    let widthBytes = widthPixels >> 1;
    if (widthBytes > (pSrcSizeDescriptor.widthBytes | 0)) widthBytes = pSrcSizeDescriptor.widthBytes | 0;
    if (heightPixels > (pSrcSizeDescriptor.height | 0)) heightPixels = pSrcSizeDescriptor.height | 0;
    widthPixels = widthBytes * 2;

    const cropped = this.cropBitmap(srcBitmap, widthPixels, heightPixels);
    const distanceBand = relativePosition <= 4 ? 0 : 1;
    const colorMap = distanceBand === 0 ? tables.floorColorMapFar : tables.floorColorMapMedium;
    let derived = this.scaleIndexedBitmap(cropped, finalBitmapWidth + 1, pWDP.height | 0, colorMap);

    let srcOffsetX = 0;
    if (farRightSidewall) {
      derived = this.getMirroredBitmap(derived);
      srcOffsetX = 15 - (finalBitmapWidth & 15);
    } else if (relativePosition === 7) {
      const w = (pWDP.x2 | 0) - (pWDP.x1 | 0);
      srcOffsetX = finalBitmapWidth - w;
    }

    const rect: RectPos = {
      x1: pWDP.x1,
      y1: pWDP.y1,
      x2: pWDP.x2,
      y2: pWDP.y2,
      srcX: srcOffsetX,
      srcY: 0,
    };
    bltShapeToViewportIndex(derived, viewport, rect);

    if (this.context.wallDecorationRects && Math.floor(relativePosition / 5) === 2) {
      this.context.wallDecorationRects.push({ x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2 });
    }
  }

  private drawWallText(textRN: ObjectID, relativePosition: number, removeMortarJoint: boolean): void {
    if (textRN === OBJECT_ID_EOF) return;

    const tables = this.context.objectTables;
    const dungeon = this.context.dungeonState;
    const viewport = this.context.viewportIndexBuffer;
    const getGraphic = this.context.getGraphicBitmap;
    if (!tables || !dungeon || !viewport || !getGraphic) return;

    // CSBWin draws real text only on the front wall immediately in front of the party (relativePosition==12).
    if (relativePosition !== 12) {
      const numWallDecoration = this.context.numWallDecoration ?? 0;
      this.drawWallDecoration(numWallDecoration + 1, relativePosition);
      return;
    }

    const rec = dungeon.getTextRecord(textRN);
    if (!rec) return;

    const textBytes = dungeon.decodeWallTextBytes(rec, tables ? {
      escape1: tables.textEscape1,
      escape2Other: tables.textEscape2Other,
      escape2Wall: tables.textEscape2Wall,
    } : undefined);
    if (!textBytes) return;

    const font = getGraphic(120);
    if (!font) return;

    if (removeMortarJoint) {
      const wall = this.context.wallBitmaps?.[2];
      const wallRect = this.context.wallRectangles?.[6];
      const wallTextRect = tables.wallTextRect;
      if (wall && wallRect && wallTextRect) {
        const rect: RectPos = {
          x1: wallTextRect.x1,
          x2: wallTextRect.x2,
          y1: wallTextRect.y1,
          y2: wallTextRect.y2,
          srcX: 94,
          srcY: 28,
          srcStride: wallRect.srcStride,
          srcWidth: wallRect.srcWidth,
          srcHeight: wallRect.srcHeight,
        };
        tag0088b2Index(wall, viewport, rect, -1);
      }
    }

    let idx = 0;
    let lineIdx = 0;
    while (idx < textBytes.length && lineIdx < tables.wallTextLineY2.length) {
      let lineStart = idx;
      let lineLen = 0;
      while (idx < textBytes.length && textBytes[idx] < 0x80) {
        lineLen++;
        idx++;
      }
      if (lineLen === 0) {
        const term = textBytes[idx] ?? 0x81;
        idx++;
        lineIdx++;
        if (term === 0x81) break;
        continue;
      }

      if (lineLen > 18) lineLen = 18;
      const y2 = tables.wallTextLineY2[lineIdx] ?? 60;
      let x = 112 - 4 * lineLen;

      for (let i = 0; i < lineLen; i++) {
        const code = textBytes[lineStart + i] ?? 0;
        const rect = { x1: x, y1: y2 - 7, x2: x + 7, y2, srcX: 8 * code, srcY: 0, srcWidth: 8, srcHeight: 8 };
        bltShapeToViewportIndex(font, viewport, rect);
        x += 8;
      }

      const term = textBytes[idx] ?? 0x81;
      idx++;
      lineIdx++;
      if (term === 0x81) break;
    }
  }

  private drawFloorDecorations(graphicOrdinal: number, relativeCell: number): void {
    const tables = this.context.objectTables;
    const dungeon = this.context.dungeonState;
    const viewport = this.context.viewportIndexBuffer;
    const getGraphic = this.context.getGraphicBitmap;
    const csbGraphics = this.context.csbGraphics;
    if (!tables || !dungeon || !viewport || !getGraphic) return;

    const map = dungeon.getMap(this.context.frameMapIndex ?? 0);
    if (!map?.floorDecorationTOC) return;

    const drawFootprints = (graphicOrdinal & 0x8000) !== 0;
    const extFloorDecoration = (graphicOrdinal & 0x4000) !== 0;
    let ordinal = graphicOrdinal & 0x7fff;

    if (extFloorDecoration) {
      if (csbGraphics) {
        const ext = csbGraphics.getFloorDecoration(ordinal & 0x7fff);
        if (ext) {
          this.drawExtendedFloorDecoration(ext, relativeCell);
          if (drawFootprints) this.drawFloorDecorations(16, relativeCell);
          return;
        }
      }
      ordinal = 0;
    }

    if (ordinal === 0 && !drawFootprints) return;

    const drawSingle = (ord: number) => {
      if (ord === 0) return;
      const graphicIndex = (ord - 1) | 0;
      if (graphicIndex < 0 || graphicIndex >= map.floorDecorationTOC!.length) return;
      if (relativeCell < 0 || relativeCell >= tables.floorDecorationDescSets[0].length) return;

      const tocValue = map.floorDecorationTOC![graphicIndex] ?? 0;
      const rectSetIndex = tables.floorDecorationRectSetIndex[tocValue] ?? 0;
      const rectSet = tables.floorDecorationDescSets[rectSetIndex];
      const desc = rectSet?.[relativeCell];
      if (!desc) return;

      const baseGraphic = 247 + 6 * tocValue;
      const cellIncrement = tables.relativeCellGraphicIncrement[relativeCell] ?? 0;
      const graphicNum = baseGraphic + cellIncrement;
      const bitmap = getGraphic(graphicNum);
      if (!bitmap) return;

      const srcWidth = (desc.widthBytes | 0) * 2;
      const srcHeight = desc.height | 0;
      if (srcWidth <= 0 || srcHeight <= 0) return;

      let mirror = relativeCell === 8 || relativeCell === 5 || relativeCell === 2;
      if (
        graphicIndex === 15 &&
        (this.context.useMirrorImages ?? false) &&
        (relativeCell === 7 || relativeCell === 4 || relativeCell !== 1)
      ) {
        mirror = true;
      }

      const rect: RectPos = {
        x1: desc.x1,
        y1: desc.y1,
        x2: desc.x2,
        y2: desc.y2,
        srcX: 0,
        srcY: 0,
        srcWidth,
        srcHeight,
      };
      this.blitShapeBitmapToViewport(bitmap, rect, mirror);
    };

    if (ordinal !== 0) drawSingle(ordinal);
    if (drawFootprints) drawSingle(16);
  }

  private drawExtendedFloorDecoration(ext: ExtendedFloorDecoration, relativeCell: number): void {
    const tables = this.context.objectTables;
    const viewport = this.context.viewportIndexBuffer;
    if (!tables || !viewport) return;

    if (relativeCell < 0 || relativeCell >= ext.desc.length) return;

    const desc = ext.desc;
    const displayDesc = desc[relativeCell];
    if (!displayDesc) return;

    const baseBitmap = ext.bitmap;
    let bitmap = baseBitmap;
    const map = relativeCell < 3 ? tables.floorColorMapFar : tables.floorColorMapMedium;

    if (relativeCell < 6) {
      if (relativeCell < 3) {
        const target = displayDesc;
        const targetWidth = (target.x2 | 0) - (target.x1 | 0) + 1;
        bitmap = this.scaleIndexedBitmap(baseBitmap, targetWidth, target.height | 0, map);
      } else {
        const target = desc[4];
        const targetWidth = (target.x2 | 0) - (target.x1 | 0) + 1;
        bitmap = this.scaleIndexedBitmap(baseBitmap, targetWidth, target.height | 0, map);
      }
    }

    const facing = this.context.frameFacing ?? 0;
    const mirrorFlags = ext.mirrorFlags & 0xffff;
    const useMirror = (((mirrorFlags >>> (facing + 9)) ^ (mirrorFlags >>> relativeCell)) & 1) !== 0;
    if (useMirror) bitmap = this.getMirroredBitmap(bitmap);

    let srcOffsetX = 0;
    if (relativeCell === 6) {
      const fullWidth = (desc[7].x2 | 0) - (desc[7].x1 | 0) + 1;
      const partialWidth = (displayDesc.x2 | 0) - (displayDesc.x1 | 0) + 1;
      srcOffsetX = fullWidth - partialWidth;
    } else if (relativeCell === 3) {
      const fullWidth = (desc[4].x2 | 0) - (desc[4].x1 | 0) + 1;
      const partialWidth = (desc[3].x2 | 0) - (desc[3].x1 | 0) + 1;
      srcOffsetX = fullWidth - partialWidth;
    }

    const rect: RectPos = {
      x1: displayDesc.x1,
      y1: displayDesc.y1,
      x2: displayDesc.x2,
      y2: displayDesc.y2,
      srcX: srcOffsetX,
      srcY: 0,
    };
    bltShapeToViewportIndex(bitmap, viewport, rect);
  }

  private graphicRandom(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    this.graphicRandomState = (this.graphicRandomState * 0xbb40e62d + 11) >>> 0;
    return ((this.graphicRandomState >>> 7) % maxExclusive) >>> 0;
  }

  private cropBitmap(src: IndexedBitmap, width: number, height: number): IndexedBitmap {
    const w = Math.min(width, src.width);
    const h = Math.min(height, src.height);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const srcRow = y * src.width;
      const dstRow = y * w;
      out.set(src.pixels.subarray(srcRow, srcRow + w), dstRow);
    }
    return { width: w, height: h, pixels: out };
  }

  private drawTeleporter(teleporterRect: RectPos, wallRect: RectPos): void {
    const viewport = this.context.viewportIndexBuffer;
    const getGraphic = this.context.getGraphicBitmap;
    if (!viewport || !getGraphic) return;

    const overlayGraphic = getGraphic((teleporterRect.x1 | 0) + 73);
    if (!overlayGraphic) return;

    let mask: IndexedBitmap | null = null;
    if (teleporterRect.y2 !== 0xff) {
      const maskGraphic = getGraphic(((teleporterRect.y2 | 0) & 0x7f) + 69);
      if (maskGraphic) {
        const widthBytes = Math.max(0, Math.floor((teleporterRect.srcWidth ?? 0) / 2));
        const height = teleporterRect.srcHeight ?? maskGraphic.height;
        const width = widthBytes * 2;
        const cropped = this.cropBitmap(maskGraphic, width, height);
        mask = (teleporterRect.y2 & 0x80) !== 0 ? this.getMirroredBitmap(cropped) : cropped;
      }
    }

    const jitterX = (teleporterRect.x2 | 0) + this.graphicRandom(2);
    const jitterY = this.graphicRandom(32);
    const srcOffsetX = teleporterRect.srcX ?? 0;
    const srcOffsetY = teleporterRect.srcY ?? 0;

    tag008c98Index(
      overlayGraphic,
      viewport,
      mask,
      wallRect,
      jitterX,
      jitterY,
      teleporterRect.y1 | 0,
      srcOffsetX,
      srcOffsetY
    );
  }

  private scaleIndexedBitmap(
    src: IndexedBitmap,
    dstWidth: number,
    dstHeight: number,
    colorMap?: Uint8Array,
    mirror?: boolean
  ): IndexedBitmap {
    const map = colorMap && colorMap.length >= 16 ? colorMap : IDENTITY_COLOR_MAP;
    const scaled = this.shrinkBltIndexedBitmap(src, dstWidth, dstHeight, map);
    return mirror ? this.getMirroredBitmap(scaled) : scaled;
  }

  private mapColorValue(colorMap: Uint8Array, index: number): number {
    // CSBWin ShrinkBLT expects color-map entries scaled by 10 (Graphics.cpp:406-476).
    const raw = colorMap[index] ?? index;
    return Math.floor(raw / 10);
  }

  private drawRoomObjects(
    firstObject: ObjectID,
    facing: number,
    mapX: number,
    mapY: number,
    relativeCellNumber: number,
    drawingOrder: number
  ): void {
    if (firstObject === OBJECT_ID_EOF) return;

    const dungeon = this.context.dungeonState;
    const tables = this.context.objectTables;
    if (!dungeon || !tables) {
      // (skip) missing dungeonState/objectTables
      return;
    }

    // Non-floor-relative cells do not draw generic objects (CSBWin ProcessOnePosition default-case checks 0..9).
    if (relativeCellNumber < 0 || relativeCellNumber > 9) return;

    // CSBWin encodes door-side metadata in bit 3 (DrawRoomObjects, Code51a4.cpp:2655-2670).
    let positionList = drawingOrder & 0xffff;
    let sideOfDoor = SideOfDoor.NotADoor;
    if ((positionList & 0x8) !== 0) {
      sideOfDoor = (positionList & 1) !== 0 ? SideOfDoor.NearSide : SideOfDoor.FarSide;
      positionList = (positionList >> 4) & 0x0fff;
    }

    const drawingAlcoveObjects = positionList === 0;
    const middleLeftRight = ((relativeCellNumber + 3) % 3 + 3) % 3;
    let monsterRecord: CreatureRecord | null = null;
    let monsterState: { positions: number; facings: number; statuses: Uint8Array } | null = null;
    let missilePresent = false;
    let cloudPresent = false;

    for (let rn = firstObject; rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      const { category } = decodeObjectID(rn);
      if (category === DBType.CREATURE && !monsterRecord) {
        monsterRecord = dungeon.getCreatureRecord(rn);
        if (monsterRecord) {
          monsterState = dungeon.getMonsterRenderState(monsterRecord);
        }
      } else if (category === DBType.MISSILE) {
        missilePresent = true;
      } else if (category === DBType.CLOUD) {
        cloudPresent = true;
      }
    }

    if (drawingAlcoveObjects) {
      const relLoc = 4; // niche slot
      const curAbsPos = (facing + 2) & 3;
      let currentSmallOffset = 2 + ((curAbsPos & 1) << 3);
      this.drawObjectsAtPosition(dungeon, tables, firstObject, relativeCellNumber, middleLeftRight, relLoc, curAbsPos, currentSmallOffset, true);
      return;
    }

    let centeredMonsterDrawn = false;
    let lastAbsPos = 0;
    while (positionList !== 0) {
      const nibble = positionList & 0xf;
      positionList >>>= 4;
      if (nibble === 0) continue;

      const relLoc = (nibble - 1) & 0xf; // 0..3
      const curAbsPos = (relLoc + facing) & 3;
      lastAbsPos = curAbsPos;
      let currentSmallOffset = ((curAbsPos & 1) << 3) & 0xf;
      this.drawObjectsAtPosition(dungeon, tables, firstObject, relativeCellNumber, middleLeftRight, relLoc, curAbsPos, currentSmallOffset, false);

      if (monsterRecord && monsterState) {
        const monsterCount = Math.max(1, monsterRecord.count ?? 1);
        if (this.isCenteredPositions(monsterState.positions)) {
          if (!centeredMonsterDrawn && positionList === 0 && sideOfDoor !== SideOfDoor.FarSide) {
            this.drawMonster(monsterRecord, monsterState, facing, relativeCellNumber, 4, middleLeftRight, curAbsPos);
            centeredMonsterDrawn = true;
          }
        } else if (this.monsterOccupiesPosition(monsterState.positions, curAbsPos, monsterCount)) {
          this.drawMonster(monsterRecord, monsterState, facing, relativeCellNumber, relLoc, middleLeftRight, curAbsPos);
        }
      }

      if (missilePresent && relativeCellNumber <= 9) {
        this.drawMissilesAtPosition(
          dungeon,
          tables,
          firstObject,
          curAbsPos,
          facing,
          mapX,
          mapY,
          relativeCellNumber,
          relLoc,
          middleLeftRight
        );
      }
    }

    if (cloudPresent) {
      const fluxcage = this.drawClouds(relativeCellNumber, firstObject, facing, lastAbsPos);
      if (fluxcage && sideOfDoor !== SideOfDoor.FarSide) {
        const teleporter = this.context.teleporterRectangles?.[relativeCellNumber];
        const wallRect = this.context.wallRectangles[relativeCellNumber];
        if (teleporter && wallRect) {
          const shifted: RectPos = { ...teleporter, x1: (teleporter.x1 | 0) + 1 };
          this.drawTeleporter(shifted, wallRect);
        }
      }
    }
  }

  private drawObjectsAtPosition(
    dungeon: DungeonState,
    tables: ObjectTables,
    firstObject: ObjectID,
    relativeCellNumber: number,
    middleLeftRight: number,
    relativeLocationWithinCell: number,
    curAbsPos: number,
    currentSmallOffset: number,
    drawingAlcoveObjects: boolean
  ): void {
    const viewportSetCount = tables.viewportPosition.length;

    for (let rn = firstObject; rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      const { category, position } = decodeObjectID(rn);
      if (position !== curAbsPos) continue;

      if (
        category === DBType.DOOR ||
        category === DBType.TELEPORTER ||
        category === DBType.TEXT ||
        category === DBType.ACTUATOR ||
        category === DBType.CREATURE ||
        category === DBType.MISSILE ||
        category === DBType.CLOUD
      ) {
        continue;
      }

      const descIndex = this.descIndexForObject(dungeon, rn);
      if (descIndex === null) continue;
      const graphicClassIndex = tables.objDescGraphicClass[descIndex] ?? 0;
      const gc = tables.graphicClasses[graphicClassIndex];
      if (!gc) continue;

      let graphicNum = 360 + (gc.objectGraphicIndex & 0xff);
      const local34 = drawingAlcoveObjects && (gc.byte4 & 0x10) !== 0 && middleLeftRight === 0;
      if (local34) graphicNum++;

      const vpSet = gc.byte5;
      if (vpSet >= viewportSetCount) continue;
      const vp = tables.viewportPosition[vpSet]?.[relativeCellNumber]?.[relativeLocationWithinCell];
      if (!vp || vp.y === 0) continue;

      const rightSideOfCell = ((relativeLocationWithinCell + 1) & 2) !== 0;
      const local36 = (gc.byte4 & 1) !== 0 && !local34 && (middleLeftRight === 2 || (middleLeftRight === 0 && rightSideOfCell));

      const r = this.drawSingleObject(
        tables,
        graphicNum,
        gc,
        relativeCellNumber,
        relativeLocationWithinCell,
        currentSmallOffset,
        local36,
        drawingAlcoveObjects,
        vp.x,
        vp.y,
        middleLeftRight,
        false,
        rn
      );
      currentSmallOffset = r.nextSmallOffset;
    }
  }

  private descIndexForObject(dungeon: DungeonState, rn: ObjectID): number | null {
    const { category } = decodeObjectID(rn);
    switch (category) {
      case DBType.SCROLL:
        return 0;
      case DBType.CHEST: {
        const rec = dungeon.getContainerRecord(rn);
        return rec ? 1 + (rec.containerType & 0xff) : null;
      }
      case DBType.POTION: {
        const rec = dungeon.getPotionRecord(rn);
        return rec ? 2 + (rec.potionType & 0xff) : null;
      }
      case DBType.WEAPON: {
        const rec = dungeon.getWeaponRecord(rn);
        return rec ? 23 + (rec.weaponType & 0xff) : null;
      }
      case DBType.CLOTHING: {
        const rec = dungeon.getClothingRecord(rn);
        return rec ? 69 + (rec.clothingType & 0xff) : null;
      }
      case DBType.MISC: {
        const rec = dungeon.getMiscRecord(rn);
        return rec ? 127 + (rec.miscType & 0xff) : null;
      }
      default:
        return null;
    }
  }

  private drawSingleObject(
    tables: ObjectTables,
    graphicNum: number,
    gc: ObjectTables['graphicClasses'][number],
    relativeCellNumber: number,
    relativeLocationWithinCell: number,
    currentSmallOffset: number,
    mirror: boolean,
    drawingAlcoveObjects: boolean,
    baseX: number,
    baseY2: number,
    middleLeftRight: number,
    drawingMissiles: boolean,
    objRn: ObjectID
  ): { nextSmallOffset: number } {
    const viewport = this.context.viewportIndexBuffer;
    const getGraphic = this.context.getGraphicBitmap;
    if (!viewport || !getGraphic) return { nextSmallOffset: currentSmallOffset };

    const nearSideOfCell = relativeLocationWithinCell >= 2;

    let distanceFromUs = 0;
    if (relativeCellNumber === 9 || (relativeCellNumber >= 6 && nearSideOfCell)) distanceFromUs = 0;
    else if (relativeCellNumber >= 6 || (relativeCellNumber >= 3 && nearSideOfCell)) distanceFromUs = 1;
    else distanceFromUs = 2;
    const touchable = distanceFromUs === 0 && middleLeftRight === 0 && !drawingMissiles;

    const src = getGraphic(graphicNum);
    if (!src) return { nextSmallOffset: currentSmallOffset };

    const scaled = this.getDerivedObjectBitmap(tables, graphicNum, src, gc, distanceFromUs, mirror);
    if (!scaled) return { nextSmallOffset: currentSmallOffset };

    const widthBytes =
      distanceFromUs === 0
        ? gc.widthBytes
        : distanceFromUs === 1
          ? ((gc.widthBytes * 20 + 10) >> 5)
          : ((gc.widthBytes * 16 + 8) >> 5);
    const height =
      distanceFromUs === 0
        ? gc.height
        : distanceFromUs === 1
          ? ((gc.height * 20 + 10) >> 5)
          : ((gc.height * 16 + 8) >> 5);

    let xCenter = baseX;
    let y2 = baseY2;

    // Apply CSBWin "small offsets" to shift items slightly based on distance and position.
    const idxBase = ((distanceFromUs & 0xffff) << 3) & 0xff;
    const oi = currentSmallOffset & 0xf;
    const offXIndex = tables.smallOffsetIndices[oi * 2 + 0] ?? 0;
    const offYIndex = tables.smallOffsetIndices[oi * 2 + 1] ?? 0;
    xCenter += tables.smallOffsets[idxBase + offXIndex] ?? 0;
    y2 += tables.smallOffsets[idxBase + offYIndex] ?? 0;

    // Advance small-offset state (DrawSingleObject, Code51a4.cpp:1925-1940).
    currentSmallOffset = (currentSmallOffset + 1) | 0;
    if (drawingAlcoveObjects) {
      if (currentSmallOffset >= 14) currentSmallOffset = 2;
    } else {
      currentSmallOffset &= 15;
    }

    let x1 = xCenter - widthBytes + 1;
    let x2 = xCenter + widthBytes;
    let y1 = y2 - (height - 1);
    if (y2 > 135) y2 = 135;

    let srcX = 0;
    let srcY = 0;
    if (x1 < 0) {
      srcX = -x1;
      x1 = 0;
    }
    if (y1 < 0) {
      srcY = -y1;
      y1 = 0;
    }
    if (x2 > 223) x2 = 223;
    if (y2 > 135) y2 = 135;

    if (touchable && this.context.viewportObjectButtons && this.context.viewportObjectRNs) {
      const button = this.context.viewportObjectButtons[relativeLocationWithinCell];
      if (button) {
        if (button.x1 === 255) {
          button.x1 = x1;
          button.x2 = x2;
          button.y1 = y1;
          button.y2 = y2;

          let height32 = button.y2 - button.y1;
          if (height32 < 14) {
            height32 >>= 1;
            button.y1 += height - 7;
            if (height32 < 4) {
              button.y2 -= height32 - 3;
            }
          }
        } else {
          button.x1 = Math.min(button.x1, x1);
          button.x2 = Math.max(button.x2, x2);
          button.y1 = Math.min(button.y1, y1);
          button.y2 = Math.max(button.y2, y2);
        }
        if (relativeLocationWithinCell < this.context.viewportObjectRNs.length) {
          this.context.viewportObjectRNs[relativeLocationWithinCell] = objRn;
        }
      }
    }

    bltShapeToViewportIndex(scaled, viewport, { x1, y1, x2, y2, srcX, srcY });
    return { nextSmallOffset: currentSmallOffset };
  }

  private isCenteredPositions(positions: number): boolean {
    return (positions & 0xff) === 0xff;
  }

  private monsterIndexAtPosition(positions: number, curAbsPos: number, count: number): number {
    if (this.isCenteredPositions(positions)) return 0;
    for (let i = 0; i < count; i++) {
      if (((positions >> (2 * i)) & 0x3) === curAbsPos) return i;
    }
    return -1;
  }

  private monsterOccupiesPosition(positions: number, curAbsPos: number, count: number): boolean {
    return this.monsterIndexAtPosition(positions, curAbsPos, count) >= 0;
  }

  private decodeMonsterStatus(status: number): { attacking: boolean; mirror: boolean; nibble0: number; nibble3: number } {
    return {
      attacking: (status & 0x80) !== 0,
      mirror: (status & 0x40) !== 0,
      nibble0: status & 0x7,
      nibble3: (status >> 3) & 0x7,
    };
  }

  private drawMonster(
    monster: CreatureRecord,
    monsterState: { positions: number; facings: number; statuses: Uint8Array },
    facing: number,
    relativeCellNumber: number,
    positionWithinCell: number,
    middleLeftRight: number,
    curAbsPos: number
  ): void {
    const tables = this.context.objectTables;
    const viewport = this.context.viewportIndexBuffer;
    const getGraphic = this.context.getGraphicBitmap;
    if (!tables || !viewport || !getGraphic) return;

    const mt = monster.creatureType | 0;
    const desc = tables.monsterDesc[mt];
    const graphic = tables.monsterGraphics[mt];
    if (!desc || !graphic) return;

    const hasSide = (desc.word4 & 0x0008) !== 0;
    const hasBack = (desc.word4 & 0x0010) !== 0;
    const hasAttack = (desc.word4 & 0x0020) !== 0;
    const monsterCount = Math.max(1, monster.count ?? 1);
    const indexWithinGroup = this.monsterIndexAtPosition(monsterState.positions, curAbsPos, monsterCount);
    if (indexWithinGroup < 0) return;

    const absFacing = (monsterState.facings >> (2 * indexWithinGroup)) & 0x3;
    const relFacing = (facing - absFacing) & 0x3;
    const status = monsterState.statuses[indexWithinGroup] ?? 0;
    const sms = this.decodeMonsterStatus(status);

    const showSide = hasSide && (relFacing & 1) !== 0;
    const showBack = hasBack && relFacing === 0;
    const showAttack = hasAttack && !showBack && sms.attacking;
    this.context.onMonsterAttackState?.(monster, indexWithinGroup, desc.attackSound ?? 0, showAttack);

    let graphicNum = 446 + (graphic.word0 | 0);
    let widthBytes = graphic.frontRearByteWidth;
    let height = graphic.frontRearHeight;
    let mirror = false;

    if (showSide) {
      graphicNum += 1;
      widthBytes = graphic.sideByteWidth;
      height = graphic.sideHeight;
      mirror = relFacing === 1;
    } else if (showBack) {
      graphicNum += hasSide ? 2 : 1;
      mirror = false;
    } else if (showAttack) {
      graphicNum += 1;
      if (hasSide) graphicNum += 1;
      if (hasBack) graphicNum += 1;
      widthBytes = graphic.attackByteWidth;
      height = graphic.attackHeight;
      mirror = sms.mirror;
    } else if ((desc.word4 & 0x0004) !== 0 && sms.mirror) {
      mirror = true;
    }

    const base = getGraphic(graphicNum);
    if (!base) return;

    const positionGroup = (graphic.uByte10 >> 4) & 0x7;
    const posSet = tables.monsterPositions[positionGroup]?.[relativeCellNumber]?.[positionWithinCell];
    if (!posSet || posSet.y === 0) return;

    let xCenter = posSet.x;
    let y2 = posSet.y;
    if (middleLeftRight === 1) xCenter -= 100;
    else if (middleLeftRight === 2) xCenter += 100;

    const distanceFromUs = relativeCellNumber >= 6 ? 0 : relativeCellNumber >= 3 ? 1 : 2;
    const baseTransparent = graphic.uByte10 & 0x0f;

    let src = base;
    let transparentColor = baseTransparent;
    let scaledWidthBytes = widthBytes;
    let scaledHeight = height;

    if (distanceFromUs > 0) {
      const scale = distanceFromUs === 1 ? 20 : 16;
      scaledWidthBytes = Math.floor((widthBytes * scale + (scale >> 1)) >> 5);
      scaledHeight = Math.floor((height * scale + (scale >> 1)) >> 5);
      const dstWidth = Math.max(1, scaledWidthBytes * 2);
      const dstHeight = Math.max(1, scaledHeight);
      const colorMap = distanceFromUs === 1 ? tables.monsterColorMapMedium : tables.monsterColorMapFar;
      src = this.shrinkChunky(base, dstWidth, dstHeight, colorMap);
      transparentColor = this.mapColorValue(colorMap, baseTransparent);
    }

    if (mirror) src = this.getMirroredBitmap(src);

    const xOffset = tables.smallOffsets[(distanceFromUs << 3) + sms.nibble0] ?? 0;
    const yOffset = tables.smallOffsets[sms.nibble3] ?? 0;
    xCenter += xOffset;
    y2 += yOffset;

    let x1 = xCenter - scaledWidthBytes + 1;
    let x2 = xCenter + scaledWidthBytes;
    let y1 = y2 - (scaledHeight - 1);
    if (y2 > 135) y2 = 135;

    let srcX = 0;
    let srcY = 0;
    if (x1 < 0) {
      srcX = -x1;
      x1 = 0;
    }
    if (y1 < 0) {
      srcY = -y1;
      y1 = 0;
    }
    if (x2 > 223) x2 = 223;
    if (y2 > 135) y2 = 135;

    this.blitShapeToViewportIndexWithTransparent(src, { x1, y1, x2, y2, srcX, srcY }, transparentColor);
  }

  private drawMissilesAtPosition(
    dungeon: DungeonState,
    tables: ObjectTables,
    firstObject: ObjectID,
    curAbsPos: number,
    facing: number,
    mapX: number,
    mapY: number,
    relativeCellNumber: number,
    relativeLocation: number,
    middleLeftRight: number,
  ): void {
    const viewport = this.context.viewportIndexBuffer;
    const getGraphic = this.context.getGraphicBitmap;
    if (!viewport || !getGraphic) return;

    const vp = tables.viewportPosition[0]?.[relativeCellNumber]?.[relativeLocation];
    const centerX = vp?.x ?? 0;
    if (centerX === 0) return;

    for (let rn = firstObject; rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      const { category, position } = decodeObjectID(rn);
      if (category !== DBType.MISSILE || position !== curAbsPos) continue;
      const missile = dungeon.getMissileRecord(rn);
      if (!missile) continue;

      const graphicClass = this.getGraphicClassForObject(missile.projectileObject, dungeon, tables);
      if (graphicClass === -1) continue;
      if (graphicClass >= 0) {
        const gc = tables.graphicClasses[graphicClass];
        if (!gc) continue;
        const graphicNum = 360 + (gc.objectGraphicIndex & 0xff);
        this.drawSingleObject(
          tables,
          graphicNum,
          gc,
          relativeCellNumber,
          relativeLocation,
          0,
          false,
          false,
          centerX,
          47,
          middleLeftRight,
          true,
          rn
        );
        continue;
      }

      const idx = Math.max(0, -graphicClass - 1);
      const md = tables.missileGraphics[idx];
      if (!md) continue;

      const word4 = md.word4 & 0xffff;
      const w126 = word4 & 0x3;
      const w130 = (word4 & 0x100) === 0;
      const w140 = w126 === 0;
      const w138 = w140 ? ((mapX + mapY) & 1) : 0;

      const timerWord8 = dungeon.getTimerWord8(missile.timerIndex);
      if (timerWord8 === null) continue;
      const w124 = (timerWord8 >> 10) & 0x3;

      let w128 = 0;
      let mirror = false;
      let flip = false;

      if (w126 === 3) {
        w128 = 0;
        mirror = false;
        flip = false;
      } else if (((w124 & 1) !== (facing & 1))) {
        w128 = w126 === 2 ? 1 : 2;
        if (w140) {
          mirror = relativeLocation === 0 || relativeLocation === 3;
          flip = w138 !== 0;
          if (!flip) mirror = !mirror;
        } else {
          flip = false;
          mirror = ((facing + 1) & 3) === w124;
        }
      } else {
        if (w126 >= 2 || (w126 === 1 && w124 !== facing) || (w140 && w138 !== 0)) w128 = 0;
        else w128 = 1;

        flip = w140 && relativeLocation < 2;
        if (word4 !== 0) {
          let cond = false;
          if (middleLeftRight === 2) cond = true;
          else if (middleLeftRight === 0) cond = relativeLocation === 1 || relativeLocation === 2;
          mirror = !cond;
        }
      }

      const distanceFromUs = 2 * Math.floor(relativeCellNumber / 3) + Math.floor(relativeLocation / 2);
      let scale = tables.missileScale[distanceFromUs] ?? 0;
      if (!w130) {
        const range = missile.rangeRemaining & 0xff;
        const w192 = Math.max(96, range + 1);
        scale = Math.floor((scale * w192) >> 8);
      }

      const baseGraphicNum = 316 + (md.uByte0 & 0xff) + w128;
      const base = getGraphic(baseGraphicNum);
      if (!base) continue;

      let widthBytes = md.widthBytes;
      let height = md.height;
      let src = base;

      if (scale > 0) {
        widthBytes = Math.max(1, Math.floor((md.widthBytes * scale + (scale >> 1)) >> 5));
        height = Math.max(1, Math.floor((md.height * scale + (scale >> 1)) >> 5));
        const dstWidth = widthBytes * 2;
        const colorMap = distanceFromUs >= 2 ? tables.colorMapFar : tables.colorMapMedium;
        src = this.shrinkChunky(base, dstWidth, height, colorMap);
      }

      if (mirror) src = this.getMirroredBitmap(src);
      if (flip) src = this.getFlippedBitmapVertical(src);

      let x1 = centerX - widthBytes + 1;
      let x2 = centerX + widthBytes;
      let y2 = 47 + (height >> 1);
      let y1 = 47 - (height >> 1);
      if (y2 > 135) y2 = 135;
      if (y1 < 0) y1 = 0;

      let srcX = 0;
      let srcY = 0;
      if (x1 < 0) {
        srcX = -x1;
        x1 = 0;
      }
      if (x2 > 223) x2 = 223;

      this.blitShapeToViewportIndexWithTransparent(src, { x1, y1, x2, y2, srcX, srcY }, 10);
    }
  }

  private drawClouds(relativeCellNumber: number, firstObject: ObjectID, facing: number, curAbsPos: number): boolean {
    const tables = this.context.objectTables;
    const dungeon = this.context.dungeonState;
    const viewport = this.context.viewportIndexBuffer;
    const getGraphic = this.context.getGraphicBitmap;
    if (!tables || !dungeon || !viewport || !getGraphic) return false;

    let relCell = relativeCellNumber + 3;
    let relCellGroup = Math.floor(relCell / 3);
    let fluxcage = false;

    for (let rn = firstObject; rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      const { category, position } = decodeObjectID(rn);
      if (category !== DBType.CLOUD) continue;
      const cloud = dungeon.getCloudRecord(rn);
      if (!cloud) continue;

      let cloudType = cloud.cloudType | 0;
      const isSpecial = cloudType >= 100;
      if (isSpecial && (relCell < 3 || relCell > 9 || position !== curAbsPos)) continue;

      let typeIndex = 0;
      let specialPos: { x: number; y: number; scale: number } | null = null;

      if (cloudType === 0 || cloudType === 2 || cloudType === 101) {
        typeIndex = 0;
      } else if (cloudType === 6 || cloudType === 7) {
        typeIndex = 2;
      } else if (cloudType === 40) {
        typeIndex = 3;
      } else if (cloudType === 100) {
        typeIndex = 4;
      } else if (cloudType === 50) {
        if (relCell >= 4) fluxcage = true;
        continue;
      } else {
        typeIndex = 1;
      }

      if (isSpecial && cloudType !== 100) {
        const baseIdx = relCell * 3;
        const px = tables.cloudPositions7222[baseIdx + 0] ?? 0;
        const py = tables.cloudPositions7222[baseIdx + 1] ?? 0;
        const scale = tables.cloudPositions7222[baseIdx + 2] ?? 0;
        specialPos = { x: px, y: py, scale };
      }

      if (relCell === 12) {
        const baseGraphic = getGraphic(351 + typeIndex);
        if (!baseGraphic) continue;
        const rect: RectPos = { x1: 64, y1: 106, x2: 159, y2: 135 };
        this.blitShapeToViewportIndexWithTransparent(baseGraphic, rect, 10);
        continue;
      }

      let width = 0;
      let height = 0;
      let base: IndexedBitmap | null = null;

      if (cloudType === 100) {
        const md = tables.missileGraphics[3];
        if (!md) continue;
        base = getGraphic((md.uByte0 & 0xff) + 317);
        if (!base) continue;
        const idx = Math.max(0, relCell - 3);
        const scale = tables.cloudPositions7246[idx * 3 + 2] ?? 0;
        width = Math.floor((md.widthBytes * scale + (scale >> 1)) >> 5) * 2;
        height = Math.floor((md.height * scale + (scale >> 1)) >> 5);
        if (relCell !== 9) base = this.shrinkChunky(base, width, height, tables.colorMapMedium);
      } else {
        const scaleBase = tables.cloudScaleBase;
        const idx = Math.min(3, Math.max(0, typeIndex));
        const baseX = scaleBase[idx * 2] ?? 0;
        const baseY = scaleBase[idx * 2 + 1] ?? 0;
        const clamp = (v: number) => Math.max(1, Math.min(32, v));
        const scale = specialPos
          ? specialPos.scale
          : cloud.value > 0
            ? Math.max(4, ((tables.cloudScale[relCellGroup] ?? 0) * Math.max(48, cloud.value + 1)) >> 8)
            : 32;
        width = clamp(((scale * baseX + (scale >> 1)) >> 5) * 2);
        height = clamp((scale * baseY + (scale >> 1)) >> 5);

        const baseGraphicNum = typeIndex === 3 ? 351 + typeIndex : 348 + Math.min(typeIndex, 2);
        base = getGraphic(baseGraphicNum);
        if (!base) continue;

        if (scale !== 32 || typeIndex === 3) {
          const colorMap = typeIndex === 3 ? tables.cloudColorMap : undefined;
          base = colorMap ? this.shrinkChunky(base, width, height, colorMap) : this.shrinkChunky(base, width, height, tables.colorMapMedium);
        }
      }

      if (!base || width <= 0 || height <= 0) continue;

      const mirror = this.graphicRandom(2) !== 0;
      const flip = this.graphicRandom(2) !== 0;
      let src = base;
      if (mirror) src = this.getMirroredBitmap(src);
      if (flip) src = this.getFlippedBitmapVertical(src);

      let px = 0;
      let py = 0;
      if (specialPos) {
        px = specialPos.x;
        py = specialPos.y;
      } else if (cloud.bit7) {
        const posIndex = relCell * 2;
        px = tables.cloudPositions7042[posIndex + 0] ?? 0;
        py = tables.cloudPositions7042[posIndex + 1] ?? 0;
      } else {
        const side = position === facing || position === ((facing - 1) & 3) ? 0 : 1;
        const baseIndex = relCell * 4 + side * 2;
        px = tables.cloudPositions7162[baseIndex + 0] ?? 0;
        py = tables.cloudPositions7162[baseIndex + 1] ?? 0;
      }

      let x1 = Math.max(0, px - (width >> 1) + 1);
      let x2 = Math.min(223, px + (width >> 1));
      let y2 = Math.min(135, py + (height >> 1));
      let y1 = Math.max(0, py - (height >> 1));

      if (x2 <= x1 || y2 <= y1) continue;
      this.blitShapeToViewportIndexWithTransparent(src, { x1, y1, x2, y2 }, 10);
    }

    return fluxcage;
  }

  private getGraphicClassForObject(rn: ObjectID, dungeon: DungeonState, tables: ObjectTables): number {
    if (rn >= BytecodeInterpreter.MAGIC_SPELL_BASE) {
      switch (rn) {
        case BytecodeInterpreter.RN_FIREBALL:
          return -11;
        case BytecodeInterpreter.RN_POISON:
          return -13;
        case BytecodeInterpreter.RN_LIGHTNING:
          return -4;
        case BytecodeInterpreter.RN_POISON_BOLT:
        case BytecodeInterpreter.RN_POISON_CLOUD:
          return -14;
        default:
          return -12;
      }
    }

    const descIndex = this.descIndexForObject(dungeon, rn);
    if (descIndex === null) return -1;
    return tables.objDescGraphicClass[descIndex] ?? -1;
  }

  private getDerivedObjectBitmap(
    tables: ObjectTables,
    graphicNum: number,
    src: IndexedBitmap,
    gc: ObjectTables['graphicClasses'][number],
    distanceFromUs: number,
    mirror: boolean
  ): IndexedBitmap | null {
    const cache = this.context.graphicCache;
    const key = `obj:${graphicNum}:${distanceFromUs}:${mirror ? 1 : 0}`;
    if (cache) {
      const cached = cache.get(key);
      if (cached) return cached;
    }

    let out: IndexedBitmap;
    if (distanceFromUs === 0) {
      out = mirror ? this.getMirroredBitmap(src) : src;
    } else {
      const dstWidthBytes = distanceFromUs === 1 ? ((gc.widthBytes * 20 + 10) >> 5) : ((gc.widthBytes * 16 + 8) >> 5);
      const dstHeight = distanceFromUs === 1 ? ((gc.height * 20 + 10) >> 5) : ((gc.height * 16 + 8) >> 5);
      const dstWidth = dstWidthBytes * 2;
      const colorMap = distanceFromUs === 1 ? tables.colorMapMedium : tables.colorMapFar;
      const scaled = this.shrinkChunky(src, dstWidth, dstHeight, colorMap);
      out = mirror ? this.getMirroredBitmap(scaled) : scaled;
    }

    cache?.set(key, out);
    return out;
  }

  private shrinkChunky(src: IndexedBitmap, dstWidth: number, dstHeight: number, colorMap: Uint8Array): IndexedBitmap {
    const map = colorMap && colorMap.length >= 16 ? colorMap : IDENTITY_COLOR_MAP;
    return this.shrinkBltIndexedBitmap(src, dstWidth, dstHeight, map);
  }

  private shrinkBltIndexedBitmap(
    src: IndexedBitmap,
    dstWidth: number,
    dstHeight: number,
    colorMap: Uint8Array
  ): IndexedBitmap {
    const out = new Uint8Array(dstWidth * dstHeight);
    const srcW = src.width | 0;
    const srcH = src.height | 0;
    const srcPx = src.pixels;

    if (dstWidth <= 0 || dstHeight <= 0 || srcW <= 0 || srcH <= 0) {
      return { width: dstWidth, height: dstHeight, pixels: out };
    }

    const stepX = ((Math.floor(((srcW << 10) >>> 0) / dstWidth) & 0xffff) << 6) >>> 0;
    const stepY = ((Math.floor(((srcH << 10) >>> 0) / dstHeight) & 0xffff) << 6) >>> 0;
    const startX = ((stepX >>> 1) + 0x7fff) >>> 0;
    let accY = ((stepY >>> 1) + 0x7fff) >>> 0;

    for (let y = 0; y < dstHeight; y++) {
      const srcY = accY >>> 16;
      const rowY = srcY >= srcH ? srcH - 1 : srcY;
      const srcRow = rowY * srcW;
      const dstRow = y * dstWidth;
      let accX = startX;

      for (let x = 0; x < dstWidth; x++) {
        const srcX = accX >>> 16;
        const colX = srcX >= srcW ? srcW - 1 : srcX;
        const v = srcPx[srcRow + colX] & 0x0f;
        out[dstRow + x] = this.mapColorValue(colorMap, v);
        accX = (accX + stepX) >>> 0;
      }

      accY = (accY + stepY) >>> 0;
    }

    return { width: dstWidth, height: dstHeight, pixels: out };
  }

  // ============================================================
  // HELPER FUNCTIONS
  // ============================================================

  private getStdWallRectanglePointer(opcode: number): StdRectPtr {
    // Direct port of CSBWin's opcode→RECT_POINTERS mapping (Viewport.cpp:2304+).
    const mapping: { [key: number]: StdRectPtr } = {
      [Opcode.StdWallRectangleF3L2]: StdRectPtr.RECT_StdWallRectangleF3L2,
      [Opcode.StdWallRectangleF3L1]: StdRectPtr.RECT_StdWallRectangleF3L1,
      [Opcode.StdWallRectangleF3]: StdRectPtr.RECT_StdWallRectangleF3,
      [Opcode.StdWallRectangleF3R1]: StdRectPtr.RECT_StdWallRectangleF3R1,
      [Opcode.StdWallRectangleF3R2]: StdRectPtr.RECT_StdWallRectangleF3R2,
      [Opcode.StdWallRectangleF2L1]: StdRectPtr.RECT_StdWallRectangleF2L1,
      [Opcode.StdWallRectangleF2]: StdRectPtr.RECT_StdWallRectangleF2,
      [Opcode.StdWallRectangleF2R1]: StdRectPtr.RECT_StdWallRectangleF2R1,
      [Opcode.StdWallRectangleF1L1]: StdRectPtr.RECT_StdWallRectangleF1L1,
      [Opcode.StdWallRectangleF1]: StdRectPtr.RECT_StdWallRectangleF1,
      [Opcode.StdWallRectangleF1R1]: StdRectPtr.RECT_StdWallRectangleF1R1,
      [Opcode.StdWallRectangleF0L1]: StdRectPtr.RECT_StdWallRectangleF0L1,
      [Opcode.StdWallRectangleF0]: StdRectPtr.RECT_StdWallRectangleF0,
      [Opcode.StdWallRectangleF0R1]: StdRectPtr.RECT_StdWallRectangleF0R1,
    };
    return mapping[opcode] ?? StdRectPtr.RECT_StdWallRectangleF3;
  }

  private resolveStdRectanglePointer(ptr: number): RectPos | RectPos[] | null {
    // Direct port of CSBWin's StdRectanglePointers() (Viewport.cpp:2298+),
    // but returning TS references instead of raw pointers.
    switch (ptr) {
      case StdRectPtr.RECT_StdWallRectangleF3L2:
        return this.context.wallRectangles[13];
      case StdRectPtr.RECT_StdWallRectangleF3L1:
        return this.context.wallRectangles[1];
      case StdRectPtr.RECT_StdWallRectangleF3:
        return this.context.wallRectangles[0];
      case StdRectPtr.RECT_StdWallRectangleF3R1:
        return this.context.wallRectangles[2];
      case StdRectPtr.RECT_StdWallRectangleF3R2:
        return this.context.wallRectangles[12];
      case StdRectPtr.RECT_StdWallRectangleF2L1:
        return this.context.wallRectangles[4];
      case StdRectPtr.RECT_StdWallRectangleF2:
        return this.context.wallRectangles[3];
      case StdRectPtr.RECT_StdWallRectangleF2R1:
        return this.context.wallRectangles[5];
      case StdRectPtr.RECT_StdWallRectangleF1L1:
        return this.context.wallRectangles[7];
      case StdRectPtr.RECT_StdWallRectangleF1:
        return this.context.wallRectangles[6];
      case StdRectPtr.RECT_StdWallRectangleF1R1:
        return this.context.wallRectangles[8];
      case StdRectPtr.RECT_StdWallRectangleF0L1:
        return this.context.wallRectangles[10];
      case StdRectPtr.RECT_StdWallRectangleF0:
        return this.context.wallRectangles[9];
      case StdRectPtr.RECT_StdWallRectangleF0R1:
        return this.context.wallRectangles[11];

      case StdRectPtr.RECT_StdFloorPitRectangleF3L1:
        return this.context.floorPitRectangles?.[11] ?? null;
      case StdRectPtr.RECT_StdFloorPitRectangleF3:
        return this.context.floorPitRectangles?.[10] ?? null;
      case StdRectPtr.RECT_StdFloorPitRectangleF3R1:
        return this.context.floorPitRectangles?.[9] ?? null;
      case StdRectPtr.RECT_StdFloorPitRectangleF2L1:
        return this.context.floorPitRectangles?.[8] ?? null;
      case StdRectPtr.RECT_StdFloorPitRectangleF2:
        return this.context.floorPitRectangles?.[7] ?? null;
      case StdRectPtr.RECT_StdFloorPitRectangleF2R1:
        return this.context.floorPitRectangles?.[6] ?? null;
      case StdRectPtr.RECT_StdFloorPitRectangleF1L1:
        return this.context.floorPitRectangles?.[5] ?? null;
      case StdRectPtr.RECT_StdFloorPitRectangleF1:
        return this.context.floorPitRectangles?.[4] ?? null;
      case StdRectPtr.RECT_StdFloorPitRectangleF1R1:
        return this.context.floorPitRectangles?.[3] ?? null;
      case StdRectPtr.RECT_StdFloorPitRectangleF0L1:
        return this.context.floorPitRectangles?.[2] ?? null;
      case StdRectPtr.RECT_StdFloorPitRectangleF0:
        return this.context.floorPitRectangles?.[1] ?? null;
      case StdRectPtr.RECT_StdFloorPitRectangleF0R1:
        return this.context.floorPitRectangles?.[0] ?? null;

      case StdRectPtr.RECT_StdTeleporterRectangleF3L1:
        return this.context.teleporterRectangles?.[1] ?? null;
      case StdRectPtr.RECT_StdTeleporterRectangleF3:
        return this.context.teleporterRectangles?.[0] ?? null;
      case StdRectPtr.RECT_StdTeleporterRectangleF3R1:
        return this.context.teleporterRectangles?.[2] ?? null;
      case StdRectPtr.RECT_StdTeleporterRectangleF2L1:
        return this.context.teleporterRectangles?.[4] ?? null;
      case StdRectPtr.RECT_StdTeleporterRectangleF2:
        return this.context.teleporterRectangles?.[3] ?? null;
      case StdRectPtr.RECT_StdTeleporterRectangleF2R1:
        return this.context.teleporterRectangles?.[5] ?? null;
      case StdRectPtr.RECT_StdTeleporterRectangleF1L1:
        return this.context.teleporterRectangles?.[7] ?? null;
      case StdRectPtr.RECT_StdTeleporterRectangleF1:
        return this.context.teleporterRectangles?.[6] ?? null;
      case StdRectPtr.RECT_StdTeleporterRectangleF1R1:
        return this.context.teleporterRectangles?.[8] ?? null;
      case StdRectPtr.RECT_StdTeleporterRectangleF0L1:
        return this.context.teleporterRectangles?.[10] ?? null;
      case StdRectPtr.RECT_StdTeleporterRectangleF0:
        return this.context.teleporterRectangles?.[9] ?? null;
      case StdRectPtr.RECT_StdTeleporterRectangleF0R1:
        return this.context.teleporterRectangles?.[11] ?? null;

      case StdRectPtr.RECT_StdStairFacingDownRectangleF3L1:
        return this.context.stairFacingDownRectangles?.[10] ?? null;
      case StdRectPtr.RECT_StdStairFacingDownRectangleF3:
        return this.context.stairFacingDownRectangles?.[9] ?? null;
      case StdRectPtr.RECT_StdStairFacingDownRectangleF3R1:
        return this.context.stairFacingDownRectangles?.[8] ?? null;
      case StdRectPtr.RECT_StdStairFacingDownRectangleF2L1:
        return this.context.stairFacingDownRectangles?.[7] ?? null;
      case StdRectPtr.RECT_StdStairFacingDownRectangleF2:
        return this.context.stairFacingDownRectangles?.[6] ?? null;
      case StdRectPtr.RECT_StdStairFacingDownRectangleF2R1:
        return this.context.stairFacingDownRectangles?.[5] ?? null;
      case StdRectPtr.RECT_StdStairFacingDownRectangleF1L1:
        return this.context.stairFacingDownRectangles?.[4] ?? null;
      case StdRectPtr.RECT_StdStairFacingDownRectangleF1:
        return this.context.stairFacingDownRectangles?.[3] ?? null;
      case StdRectPtr.RECT_StdStairFacingDownRectangleF1R1:
        return this.context.stairFacingDownRectangles?.[2] ?? null;
      case StdRectPtr.RECT_StdStairFacingDownRectangleF0L:
        return this.context.stairFacingDownRectangles?.[1] ?? null;
      case StdRectPtr.RECT_StdStairFacingDownRectangleF0R:
        return this.context.stairFacingDownRectangles?.[0] ?? null;

      case StdRectPtr.RECT_StdStairFacingUpRectangleF3L1:
        return this.context.stairFacingUpRectangles?.[10] ?? null;
      case StdRectPtr.RECT_StdStairFacingUpRectangleF3:
        return this.context.stairFacingUpRectangles?.[9] ?? null;
      case StdRectPtr.RECT_StdStairFacingUpRectangleF3R1:
        return this.context.stairFacingUpRectangles?.[8] ?? null;
      case StdRectPtr.RECT_StdStairFacingUpRectangleF2L1:
        return this.context.stairFacingUpRectangles?.[7] ?? null;
      case StdRectPtr.RECT_StdStairFacingUpRectangleF2:
        return this.context.stairFacingUpRectangles?.[6] ?? null;
      case StdRectPtr.RECT_StdStairFacingUpRectangleF2R1:
        return this.context.stairFacingUpRectangles?.[5] ?? null;
      case StdRectPtr.RECT_StdStairFacingUpRectangleF1L1:
        return this.context.stairFacingUpRectangles?.[4] ?? null;
      case StdRectPtr.RECT_StdStairFacingUpRectangleF1:
        return this.context.stairFacingUpRectangles?.[3] ?? null;
      case StdRectPtr.RECT_StdStairFacingUpRectangleF1R1:
        return this.context.stairFacingUpRectangles?.[2] ?? null;
      case StdRectPtr.RECT_StdStairFacingUpRectangleF0L:
        return this.context.stairFacingUpRectangles?.[1] ?? null;
      case StdRectPtr.RECT_StdStairFacingUpRectangleF0R:
        return this.context.stairFacingUpRectangles?.[0] ?? null;

      case StdRectPtr.RECT_StdStairEdgeRectangleF2L1:
        return this.context.stairEdgeRectangles?.[7] ?? null;
      case StdRectPtr.RECT_StdStairEdgeRectangleF2R1:
        return this.context.stairEdgeRectangles?.[6] ?? null;
      case StdRectPtr.RECT_StdStairEdgeDownRectangleF1L1:
        return this.context.stairEdgeRectangles?.[3] ?? null;
      case StdRectPtr.RECT_StdStairEdgeUpRectangleF1L1:
        return this.context.stairEdgeRectangles?.[5] ?? null;
      case StdRectPtr.RECT_StdStairEdgeDownRectangleF1R1:
        return this.context.stairEdgeRectangles?.[2] ?? null;
      case StdRectPtr.RECT_StdStairEdgeUpRectangleF1R1:
        return this.context.stairEdgeRectangles?.[4] ?? null;
      case StdRectPtr.RECT_StdStairEdgeRectangleF0L:
        return this.context.stairEdgeRectangles?.[1] ?? null;
      case StdRectPtr.RECT_StdStairEdgeRectangleF0R:
        return this.context.stairEdgeRectangles?.[0] ?? null;

      case StdRectPtr.RECT_StdDoorFacingTopTrackRectF2L1:
        return this.context.doorTrackTopRectangles?.[5] ?? null;
      case StdRectPtr.RECT_StdDoorFacingTopTrackRectF2:
        return this.context.doorTrackTopRectangles?.[4] ?? null;
      case StdRectPtr.RECT_StdDoorFacingTopTrackRectF2R1:
        return this.context.doorTrackTopRectangles?.[3] ?? null;
      case StdRectPtr.RECT_StdDoorFacingTopTrackRectF1L1:
        return this.context.doorTrackTopRectangles?.[2] ?? null;
      case StdRectPtr.RECT_StdDoorFacingTopTrackRectF1:
        return this.context.doorTrackTopRectangles?.[1] ?? null;
      case StdRectPtr.RECT_StdDoorFacingTopTrackRectF1R1:
        return this.context.doorTrackTopRectangles?.[0] ?? null;
      case StdRectPtr.RECT_StdDoorEdgeFrameRectF0:
        return this.context.doorTrackTopRectangles?.[6] ?? null;

      case StdRectPtr.RECT_StdDoorFacingFrameRectF3L1:
        return this.context.doorFrameRectangles?.[7] ?? null;
      case StdRectPtr.RECT_StdDoorFacingFrameRectF3R1:
        return this.context.doorFrameRectangles?.[6] ?? null;
      case StdRectPtr.RECT_StdDoorFacingFrameRightRectF1:
        return this.context.doorFrameRectangles?.[0] ?? null;
      case StdRectPtr.RECT_StdDoorFacingFrameLeftRectF1:
        return this.context.doorFrameRectangles?.[1] ?? null;
      case StdRectPtr.RECT_StdDoorFacingFrameRightRectF2:
        return this.context.doorFrameRectangles?.[2] ?? null;
      case StdRectPtr.RECT_StdDoorFacingFrameLeftRectF2:
        return this.context.doorFrameRectangles?.[3] ?? null;
      case StdRectPtr.RECT_StdDoorFacingFrameRightRectF3:
        return this.context.doorFrameRectangles?.[4] ?? null;
      case StdRectPtr.RECT_StdDoorFacingFrameLeftRectF3:
        return this.context.doorFrameRectangles?.[5] ?? null;

      case StdRectPtr.RECT_StdDoorRectsF3L1:
        return this.context.doorRects?.F3L1 ?? null;
      case StdRectPtr.RECT_StdDoorRectsF3:
        return this.context.doorRects?.F3 ?? null;
      case StdRectPtr.RECT_StdDoorRectsF3R1:
        return this.context.doorRects?.F3R1 ?? null;
      case StdRectPtr.RECT_StdDoorRectsF2L1:
        return this.context.doorRects?.F2L1 ?? null;
      case StdRectPtr.RECT_StdDoorRectsF2:
        return this.context.doorRects?.F2 ?? null;
      case StdRectPtr.RECT_StdDoorRectsF2R1:
        return this.context.doorRects?.F2R1 ?? null;
      case StdRectPtr.RECT_StdDoorRectsF1L1:
        return this.context.doorRects?.F1L1 ?? null;
      case StdRectPtr.RECT_StdDoorRectsF1:
        return this.context.doorRects?.F1 ?? null;
      case StdRectPtr.RECT_StdDoorRectsF1R1:
        return this.context.doorRects?.F1R1 ?? null;
      case StdRectPtr.RECT_StdDoorRectsF0:
        return null; // CSBWin's StdRectanglePointers does not return d.DoorRectsF0 (Viewport.cpp:2404).

      case StdRectPtr.RECT_StdSeeThruWallsRect:
        return this.context.seeThruWallsRect ?? null;
      case StdRectPtr.RECT_StdSeeThruWallsRect2:
        return this.context.seeThruWallsRect2 ?? null;

      default:
        return null;
    }
  }

  private resolveStdBitmapPointer(ptr: number): IndexedBitmap | null {
    // Port of CSBWin `StdBitmapPointers()` (Viewport.cpp:2261+).
    const wall = this.context.wallBitmaps as unknown as IndexedBitmap[];
    const door = (this.context.doorBitmaps ?? []) as unknown as IndexedBitmap[];

    switch (ptr) {
      case StdBitmapPtr.BMP_StdWallBitmapF3L2:
        return wall[5] ?? null;
      case StdBitmapPtr.BMP_StdWallBitmapF3L1:
      case StdBitmapPtr.BMP_StdWallBitmapF3:
      case StdBitmapPtr.BMP_StdWallBitmapF3R1:
        return wall[4] ?? null;
      case StdBitmapPtr.BMP_StdWallBitmapF3R2:
        return wall[6] ?? null;
      case StdBitmapPtr.BMP_StdWallBitmapF2L1:
      case StdBitmapPtr.BMP_StdWallBitmapF2:
      case StdBitmapPtr.BMP_StdWallBitmapF2R1:
        return wall[3] ?? null;
      case StdBitmapPtr.BMP_StdWallBitmapF1L1:
      case StdBitmapPtr.BMP_StdWallBitmapF1:
      case StdBitmapPtr.BMP_StdWallBitmapF1R1:
        return wall[2] ?? null;
      case StdBitmapPtr.BMP_StdWallBitmapF0L1:
        return wall[1] ?? null;
      case StdBitmapPtr.BMP_StdWallBitmapF0R1:
        return wall[0] ?? null;

      case StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF3L1:
      case StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF3R1:
        return door[5] ?? null;
      case StdBitmapPtr.BMP_StdDoorFacingTopTrackBitmapF1:
        return door[6] ?? null;
      case StdBitmapPtr.BMP_StdDoorFacingTopTrackBitmapF2:
        return door[7] ?? null;
      case StdBitmapPtr.BMP_StdDoorEdgeFrameBitmapF0:
        return door[1] ?? null;
      case StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF3:
        return door[4] ?? null;
      case StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF2:
        return door[3] ?? null;
      case StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF1:
        return door[2] ?? null;
      case StdBitmapPtr.BMP_StdDoorFacingFrameRightBitmapF1:
        return door[0] ?? null;

      default:
        return null;
    }
  }

  private getMirroredBitmap(src: IndexedBitmap): IndexedBitmap {
    const cached = this.mirrorCache.get(src);
    if (cached) return cached;

    const { width, height, pixels } = src;
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) out[row + (width - 1 - x)] = pixels[row + x];
    }
    const mirrored = { width, height, pixels: out };
    this.mirrorCache.set(src, mirrored);
    return mirrored;
  }

  private getFlippedBitmapVertical(src: IndexedBitmap): IndexedBitmap {
    const cached = this.flipCache.get(src);
    if (cached) return cached;

    const { width, height, pixels } = src;
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const srcRow = y * width;
      const dstRow = (height - 1 - y) * width;
      out.set(pixels.subarray(srcRow, srcRow + width), dstRow);
    }
    const flipped = { width, height, pixels: out };
    this.flipCache.set(src, flipped);
    return flipped;
  }

  private blitShapeToViewportIndexWithTransparent(
    bitmap: IndexedBitmap,
    rect: RectPos,
    transparentColor: number,
    mirror: boolean = false
  ): void {
    if (!this.context.viewportIndexBuffer) return;
    const src = mirror ? this.getMirroredBitmap(bitmap) : bitmap;
    tag0088b2Index(src, this.context.viewportIndexBuffer, rect, transparentColor);
  }

  private blitShapeBitmapToViewport(bitmap: IndexedBitmap, rect: RectPos, mirror: boolean): void {
    // -> Blitting ${mirror ? 'mirrored ' : ''}bitmap ${bitmap.width}x${bitmap.height} to rect (${rect.x1}, ${rect.y1}, ${rect.x2}, ${rect.y2}

    if (!this.context.viewportIndexBuffer) {
      // ERROR: Missing viewportIndexBuffer
      return;
    }

    const src = mirror ? this.getMirroredBitmap(bitmap) : bitmap;
    bltShapeToViewportIndex(src, this.context.viewportIndexBuffer, rect);
  }

  private opFloorPitRectangle(opcode: number): boolean {
    const mapping: { [key: number]: StdRectPtr } = {
      [Opcode.StdFloorPitRectangleF3L1]: StdRectPtr.RECT_StdFloorPitRectangleF3L1,
      [Opcode.StdFloorPitRectangleF3]: StdRectPtr.RECT_StdFloorPitRectangleF3,
      [Opcode.StdFloorPitRectangleF3R1]: StdRectPtr.RECT_StdFloorPitRectangleF3R1,
      [Opcode.StdFloorPitRectangleF2L1]: StdRectPtr.RECT_StdFloorPitRectangleF2L1,
      [Opcode.StdFloorPitRectangleF2]: StdRectPtr.RECT_StdFloorPitRectangleF2,
      [Opcode.StdFloorPitRectangleF2R1]: StdRectPtr.RECT_StdFloorPitRectangleF2R1,
      [Opcode.StdFloorPitRectangleF1L1]: StdRectPtr.RECT_StdFloorPitRectangleF1L1,
      [Opcode.StdFloorPitRectangleF1]: StdRectPtr.RECT_StdFloorPitRectangleF1,
      [Opcode.StdFloorPitRectangleF1R1]: StdRectPtr.RECT_StdFloorPitRectangleF1R1,
      [Opcode.StdFloorPitRectangleF0L1]: StdRectPtr.RECT_StdFloorPitRectangleF0L1,
      [Opcode.StdFloorPitRectangleF0]: StdRectPtr.RECT_StdFloorPitRectangleF0,
      [Opcode.StdFloorPitRectangleF0R1]: StdRectPtr.RECT_StdFloorPitRectangleF0R1,
    };
    const rectPtr = mapping[opcode] ?? StdRectPtr.RECT_StdFloorPitRectangleF0;
    // FloorPitRectanglePtr(${Opcode[opcode]})[${rectPtr}]
    this.stack.push(rectPtr);
    return true;
  }

  private opTeleporterRectangle(opcode: number): boolean {
    const mapping: { [key: number]: StdRectPtr } = {
      [Opcode.StdTeleporterRectangleF3L1]: StdRectPtr.RECT_StdTeleporterRectangleF3L1,
      [Opcode.StdTeleporterRectangleF3]: StdRectPtr.RECT_StdTeleporterRectangleF3,
      [Opcode.StdTeleporterRectangleF3R1]: StdRectPtr.RECT_StdTeleporterRectangleF3R1,
      [Opcode.StdTeleporterRectangleF2L1]: StdRectPtr.RECT_StdTeleporterRectangleF2L1,
      [Opcode.StdTeleporterRectangleF2]: StdRectPtr.RECT_StdTeleporterRectangleF2,
      [Opcode.StdTeleporterRectangleF2R1]: StdRectPtr.RECT_StdTeleporterRectangleF2R1,
      [Opcode.StdTeleporterRectangleF1L1]: StdRectPtr.RECT_StdTeleporterRectangleF1L1,
      [Opcode.StdTeleporterRectangleF1]: StdRectPtr.RECT_StdTeleporterRectangleF1,
      [Opcode.StdTeleporterRectangleF1R1]: StdRectPtr.RECT_StdTeleporterRectangleF1R1,
      [Opcode.StdTeleporterRectangleF0L1]: StdRectPtr.RECT_StdTeleporterRectangleF0L1,
      [Opcode.StdTeleporterRectangleF0]: StdRectPtr.RECT_StdTeleporterRectangleF0,
      [Opcode.StdTeleporterRectangleF0R1]: StdRectPtr.RECT_StdTeleporterRectangleF0R1,
    };
    const rectPtr = mapping[opcode] ?? StdRectPtr.RECT_StdTeleporterRectangleF0;
    // TeleporterRectanglePtr(${Opcode[opcode]})[${rectPtr}]
    this.stack.push(rectPtr);
    return true;
  }

  private opStairRectangle(opcode: number): boolean {
    const mapping: { [key: number]: StdRectPtr } = {
      // Facing up
      [Opcode.StdStairFacingUpRectangleF3L1]: StdRectPtr.RECT_StdStairFacingUpRectangleF3L1,
      [Opcode.StdStairFacingUpRectangleF3]: StdRectPtr.RECT_StdStairFacingUpRectangleF3,
      [Opcode.StdStairFacingUpRectangleF3R1]: StdRectPtr.RECT_StdStairFacingUpRectangleF3R1,
      [Opcode.StdStairFacingUpRectangleF2L1]: StdRectPtr.RECT_StdStairFacingUpRectangleF2L1,
      [Opcode.StdStairFacingUpRectangleF2]: StdRectPtr.RECT_StdStairFacingUpRectangleF2,
      [Opcode.StdStairFacingUpRectangleF2R1]: StdRectPtr.RECT_StdStairFacingUpRectangleF2R1,
      [Opcode.StdStairFacingUpRectangleF1L1]: StdRectPtr.RECT_StdStairFacingUpRectangleF1L1,
      [Opcode.StdStairFacingUpRectangleF1]: StdRectPtr.RECT_StdStairFacingUpRectangleF1,
      [Opcode.StdStairFacingUpRectangleF1R1]: StdRectPtr.RECT_StdStairFacingUpRectangleF1R1,
      [Opcode.StdStairFacingUpRectangleF0L]: StdRectPtr.RECT_StdStairFacingUpRectangleF0L,
      [Opcode.StdStairFacingUpRectangleF0R]: StdRectPtr.RECT_StdStairFacingUpRectangleF0R,

      // Facing down
      [Opcode.StdStairFacingDownRectangleF3L1]: StdRectPtr.RECT_StdStairFacingDownRectangleF3L1,
      [Opcode.StdStairFacingDownRectangleF3]: StdRectPtr.RECT_StdStairFacingDownRectangleF3,
      [Opcode.StdStairFacingDownRectangleF3R1]: StdRectPtr.RECT_StdStairFacingDownRectangleF3R1,
      [Opcode.StdStairFacingDownRectangleF2L1]: StdRectPtr.RECT_StdStairFacingDownRectangleF2L1,
      [Opcode.StdStairFacingDownRectangleF2]: StdRectPtr.RECT_StdStairFacingDownRectangleF2,
      [Opcode.StdStairFacingDownRectangleF2R1]: StdRectPtr.RECT_StdStairFacingDownRectangleF2R1,
      [Opcode.StdStairFacingDownRectangleF1L1]: StdRectPtr.RECT_StdStairFacingDownRectangleF1L1,
      [Opcode.StdStairFacingDownRectangleF1]: StdRectPtr.RECT_StdStairFacingDownRectangleF1,
      [Opcode.StdStairFacingDownRectangleF1R1]: StdRectPtr.RECT_StdStairFacingDownRectangleF1R1,
      [Opcode.StdStairFacingDownRectangleF0L]: StdRectPtr.RECT_StdStairFacingDownRectangleF0L,
      [Opcode.StdStairFacingDownRectangleF0R]: StdRectPtr.RECT_StdStairFacingDownRectangleF0R,
    };
    const rectPtr = mapping[opcode] ?? StdRectPtr.RECT_StdStairFacingUpRectangleF0L;
    // StairRectanglePtr(${Opcode[opcode]})[${rectPtr}]
    this.stack.push(rectPtr);
    return true;
  }

  private opStairGraphic(opcode: number): boolean {
    // Port from CSBWin Viewport.cpp:2730-2750 and Code390e.cpp:117-127.
    const wallSet = this.context.wallGraphicSet ?? 0;
    const base = 90 + wallSet * 18;
    const up = (i: number) => base + i; // up[6]=base+0 ... up[0]=base+6
    const down = (i: number) => base + 7 + i; // down[6]=base+7 ... down[0]=base+13

    let graphicIndex = base;
    switch (opcode) {
      // Facing down
      case Opcode.StdStairFacingDownGraphicF3L1:
      case Opcode.StdStairFacingDownGraphicF3R1:
        graphicIndex = down(0);
        break;
      case Opcode.StdStairFacingDownGraphicF3:
        graphicIndex = down(1);
        break;
      case Opcode.StdStairFacingDownGraphicF2L1:
      case Opcode.StdStairFacingDownGraphicF2R1:
        graphicIndex = down(2);
        break;
      case Opcode.StdStairFacingDownGraphicF2:
        graphicIndex = down(3);
        break;
      case Opcode.StdStairFacingDownGraphicF1L1:
      case Opcode.StdStairFacingDownGraphicF1R1:
        graphicIndex = down(4);
        break;
      case Opcode.StdStairFacingDownGraphicF1:
        graphicIndex = down(5);
        break;
      case Opcode.StdStairFacingDownGraphicF0:
        graphicIndex = down(6);
        break;

      // Facing up
      case Opcode.StdStairFacingUpGraphicF3L1:
      case Opcode.StdStairFacingUpGraphicF3R1:
        graphicIndex = up(0);
        break;
      case Opcode.StdStairFacingUpGraphicF3:
        graphicIndex = up(1);
        break;
      case Opcode.StdStairFacingUpGraphicF2L1:
      case Opcode.StdStairFacingUpGraphicF2R1:
        graphicIndex = up(2);
        break;
      case Opcode.StdStairFacingUpGraphicF2:
        graphicIndex = up(3);
        break;
      case Opcode.StdStairFacingUpGraphicF1L1:
      case Opcode.StdStairFacingUpGraphicF1R1:
        graphicIndex = up(4);
        break;
      case Opcode.StdStairFacingUpGraphicF1:
        graphicIndex = up(5);
        break;
      case Opcode.StdStairFacingUpGraphicF0:
        graphicIndex = up(6);
        break;
    }

    // StairGraphic(${Opcode[opcode]}) -> ${graphicIndex}
    this.stack.push(graphicIndex);
    return true;
  }

  private opStairEdgeGraphic(opcode: number): boolean {
    // Port from CSBWin Viewport.cpp:2800-2807 and Code390e.cpp:117-127.
    const wallSet = this.context.wallGraphicSet ?? 0;
    const base = 90 + wallSet * 18;
    const edge = (i: number) => base + 14 + i; // edge[3]=base+14 ... edge[0]=base+17 (reverse mapped below)

    let graphicIndex = base;
    switch (opcode) {
      case Opcode.StdStairEdgeGraphicF2:
        graphicIndex = edge(0); // StairEdgeGraphic[3]
        break;
      case Opcode.StdStairEdgeGraphicUpF1:
        graphicIndex = edge(1); // StairEdgeGraphic[2]
        break;
      case Opcode.StdStairEdgeGraphicDownF1:
        graphicIndex = edge(2); // StairEdgeGraphic[1]
        break;
      case Opcode.StdStairEdgeGraphicF0L1:
      case Opcode.StdStairEdgeGraphicF0R1:
        graphicIndex = edge(3); // StairEdgeGraphic[0]
        break;
    }

    // StairEdgeGraphic(${Opcode[opcode]}) -> ${graphicIndex}
    this.stack.push(graphicIndex);
    return true;
  }

  private opStairEdgeRectangle(opcode: number): boolean {
    const mapping: { [key: number]: StdRectPtr } = {
      [Opcode.StdStairEdgeRectF2L1]: StdRectPtr.RECT_StdStairEdgeRectangleF2L1,
      [Opcode.StdStairEdgeRectF2R1]: StdRectPtr.RECT_StdStairEdgeRectangleF2R1,
      [Opcode.StdStairEdgeUpRectF1L1]: StdRectPtr.RECT_StdStairEdgeUpRectangleF1L1,
      [Opcode.StdStairEdgeUpRectF1R1]: StdRectPtr.RECT_StdStairEdgeUpRectangleF1R1,
      [Opcode.StdStairEdgeDownRectF1L1]: StdRectPtr.RECT_StdStairEdgeDownRectangleF1L1,
      [Opcode.StdStairEdgeDownRectF1R1]: StdRectPtr.RECT_StdStairEdgeDownRectangleF1R1,
      [Opcode.StdStairEdgeRectF0L1]: StdRectPtr.RECT_StdStairEdgeRectangleF0L,
      [Opcode.StdStairEdgeRectF0R1]: StdRectPtr.RECT_StdStairEdgeRectangleF0R,
    };
    const rectPtr = mapping[opcode] ?? StdRectPtr.RECT_StdStairEdgeRectangleF0L;
    // StairEdgeRectanglePtr(${Opcode[opcode]})[${rectPtr}]
    this.stack.push(rectPtr);
    return true;
  }

  private opDoorBitmap(opcode: number): boolean {
    // Push CSBWin BITMAP_POINTERS value (Viewport.cpp:2830-2839).
    const mapping: { [key: number]: number } = {
      [Opcode.StdDoorFacingFrameLeftBitmapF3L1]: StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF3L1,
      [Opcode.StdDoorFacingFrameLeftBitmapF3]: StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF3,
      [Opcode.StdDoorFacingFrameLeftBitmapF3R1]: StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF3R1,
      [Opcode.StdDoorFacingFrameLeftBitmapF2]: StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF2,
      [Opcode.StdDoorFacingFrameLeftBitmapF1]: StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF1,
      [Opcode.StdDoorFacingFrameRightBitmapF1]: StdBitmapPtr.BMP_StdDoorFacingFrameRightBitmapF1,
      [Opcode.StdDoorEdgeFrameBitmapF0]: StdBitmapPtr.BMP_StdDoorEdgeFrameBitmapF0,
      [Opcode.StdDoorFacingTopTrackBitmapF2]: StdBitmapPtr.BMP_StdDoorFacingTopTrackBitmapF2,
      [Opcode.StdDoorFacingTopTrackBitmapF1]: StdBitmapPtr.BMP_StdDoorFacingTopTrackBitmapF1,
    };
    const ptr = mapping[opcode] ?? StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF1;
    // DoorBitmapPtr(${Opcode[opcode]}) -> ${ptr}
    this.stack.push(ptr);
    return true;
  }

  private opDoorRecordIndex(opcode: number): boolean {
    const cell = this.relativeCellFromDoorOpcode(opcode);
    const v = this.context.roomData[cell]?.decorations[1] ?? 0;
    // DoorRecordIndex(${Opcode[opcode]}) cell=${cell} -> ${v}
    this.stack.push(v);
    return true;
  }

  private opDoorState(opcode: number): boolean {
    const cell = this.relativeCellFromDoorOpcode(opcode);
    const v = this.context.roomData[cell]?.decorations[0] ?? 0;
    // DoorState(${Opcode[opcode]}) cell=${cell} -> ${v}
    this.stack.push(v);
    return true;
  }

  private opDoorGraphics(opcode: number): boolean {
    // CSBWin Viewport.cpp:2561-2563
    const graphicsIndex =
      opcode === Opcode.StdDoorGraphicsF3 ? 2 : opcode === Opcode.StdDoorGraphicsF2 ? 1 : 0;
    // DoorGraphics(${Opcode[opcode]})[${graphicsIndex}]
    this.stack.push(graphicsIndex);
    return true;
  }

  private opDoorRects(opcode: number): boolean {
    const mapping: { [key: number]: StdRectPtr } = {
      [Opcode.StdDoorRectsF3L1]: StdRectPtr.RECT_StdDoorRectsF3L1,
      [Opcode.StdDoorRectsF3]: StdRectPtr.RECT_StdDoorRectsF3,
      [Opcode.StdDoorRectsF3R1]: StdRectPtr.RECT_StdDoorRectsF3R1,
      [Opcode.StdDoorRectsF2L1]: StdRectPtr.RECT_StdDoorRectsF2L1,
      [Opcode.StdDoorRectsF2]: StdRectPtr.RECT_StdDoorRectsF2,
      [Opcode.StdDoorRectsF2R1]: StdRectPtr.RECT_StdDoorRectsF2R1,
      [Opcode.StdDoorRectsF1L1]: StdRectPtr.RECT_StdDoorRectsF1L1,
      [Opcode.StdDoorRectsF1]: StdRectPtr.RECT_StdDoorRectsF1,
      [Opcode.StdDoorRectsF1R1]: StdRectPtr.RECT_StdDoorRectsF1R1,
      [Opcode.StdDoorRectsF0]: StdRectPtr.RECT_StdDoorRectsF0,
    };
    const rectPtr = mapping[opcode] ?? StdRectPtr.RECT_StdDoorRectsF1;
    // DoorRectsPtr(${Opcode[opcode]})[${rectPtr}]
    this.stack.push(rectPtr);
    return true;
  }

  private opDoorFrameRectangle(opcode: number): boolean {
    const mapping: { [key: number]: StdRectPtr } = {
      // Door track top (and door edge frame at F0)
      [Opcode.StdDoorFacingTopTrackRectF2L1]: StdRectPtr.RECT_StdDoorFacingTopTrackRectF2L1,
      [Opcode.StdDoorFacingTopTrackRectF2]: StdRectPtr.RECT_StdDoorFacingTopTrackRectF2,
      [Opcode.StdDoorFacingTopTrackRectF2R1]: StdRectPtr.RECT_StdDoorFacingTopTrackRectF2R1,
      [Opcode.StdDoorFacingTopTrackRectF1L1]: StdRectPtr.RECT_StdDoorFacingTopTrackRectF1L1,
      [Opcode.StdDoorFacingTopTrackRectF1]: StdRectPtr.RECT_StdDoorFacingTopTrackRectF1,
      [Opcode.StdDoorFacingTopTrackRectF1R1]: StdRectPtr.RECT_StdDoorFacingTopTrackRectF1R1,
      [Opcode.StdDoorEdgeFrameRectF0]: StdRectPtr.RECT_StdDoorEdgeFrameRectF0,
      [Opcode.StdDoorFacingTopTrackRectF0]: StdRectPtr.RECT_StdDoorEdgeFrameRectF0,

      // Door facing frames
      [Opcode.StdDoorFacingFrameRectF3L1]: StdRectPtr.RECT_StdDoorFacingFrameRectF3L1,
      [Opcode.StdDoorFacingFrameRectF3R1]: StdRectPtr.RECT_StdDoorFacingFrameRectF3R1,
      [Opcode.StdDoorFacingFrameRightRectF3]: StdRectPtr.RECT_StdDoorFacingFrameRightRectF3,
      [Opcode.StdDoorFacingFrameLeftRectF3]: StdRectPtr.RECT_StdDoorFacingFrameLeftRectF3,
      [Opcode.StdDoorFacingFrameRightRectF2]: StdRectPtr.RECT_StdDoorFacingFrameRightRectF2,
      [Opcode.StdDoorFacingFrameLeftRectF2]: StdRectPtr.RECT_StdDoorFacingFrameLeftRectF2,
      [Opcode.StdDoorFacingFrameRightRectF1]: StdRectPtr.RECT_StdDoorFacingFrameRightRectF1,
      [Opcode.StdDoorFacingFrameLeftRectF1]: StdRectPtr.RECT_StdDoorFacingFrameLeftRectF1,
    };
    const rectPtr = mapping[opcode] ?? StdRectPtr.RECT_StdDoorFacingFrameRightRectF1;
    // DoorFrameRectanglePtr(${Opcode[opcode]})[${rectPtr}]
    this.stack.push(rectPtr);
    return true;
  }

  private opDrawOrder(opcode: number): boolean {
    // Port of CSBWin's draw order constant opcodes (Viewport.cpp:2611-2630).
    const drawOrderMap: { [key: number]: number } = {
      [Opcode.DrawOrder00]: 0x00,
      [Opcode.DrawOrder01]: 0x01,
      [Opcode.DrawOrder02]: 0x02,
      [Opcode.DrawOrder18]: 0x18,
      [Opcode.DrawOrder21]: 0x21,
      [Opcode.DrawOrder28]: 0x28,
      [Opcode.DrawOrder32]: 0x32,
      [Opcode.DrawOrder39]: 0x39,
      [Opcode.DrawOrder41]: 0x41,
      [Opcode.DrawOrder49]: 0x49,
      [Opcode.DrawOrder3421]: 0x3421,
      [Opcode.DrawOrder218]: 0x218,
      [Opcode.DrawOrder321]: 0x321,
      [Opcode.DrawOrder349]: 0x349,
      [Opcode.DrawOrder412]: 0x412,
      [Opcode.DrawOrder431]: 0x431,
      [Opcode.DrawOrder342]: 0x342,
      [Opcode.DrawOrder4312]: 0x4312,
      [Opcode.DrawOrder128]: 0x128,
      [Opcode.DrawOrder439]: 0x439,
    };

    const drawOrder = drawOrderMap[opcode] ?? 0;
    // DrawOrder(${drawOrder})
    this.stack.push(drawOrder);
    return true;
  }

  private opCellXY(opcode: number): boolean {
    const cell = this.relativeCellFromXYOpcode(opcode);
    const rd = this.context.roomData[cell];
    const x = rd?.x ?? 0;
    const y = rd?.y ?? 0;
    // CellXY(${Opcode[opcode]}) cell=${cell} -> (x=${x}, y=${y})
    this.stack.push(x);
    this.stack.push(y);
    return true;
  }

  private opCellContents(opcode: number): boolean {
    const cell = this.relativeCellFromContentsOpcode(opcode);
    const v = this.context.roomData[cell]?.rn2 ?? 0;
    // CellContents(${Opcode[opcode]}) cell=${cell} -> ${v}
    this.stack.push(v);
    return true;
  }

  private opWallPosition(opcode: number): boolean {
    // CSBWin Viewport.cpp:2645-2657 maps these to RELATIVE_WALL_NUMBERS values.
    const mapping: { [key: number]: number } = {
      [Opcode.WallF3L1Right]: 0,
      [Opcode.WallF3R1Left]: 1,
      [Opcode.WallF3L1Front]: 2,
      [Opcode.WallF3Front]: 3,
      [Opcode.WallF3R1Front]: 4,
      [Opcode.WallF2L1Right]: 5,
      [Opcode.WallF2R1Left]: 6,
      [Opcode.WallF2L1Front]: 7,
      [Opcode.WallF2Front]: 8,
      [Opcode.WallF2R1Front]: 9,
      [Opcode.WallF1L1Right]: 10,
      [Opcode.WallF1R1Left]: 11,
      [Opcode.WallF1Front]: 12,
    };
    const v = mapping[opcode] ?? 0;
    // WallPosition(${Opcode[opcode]}) -> ${v}
    this.stack.push(v);
    return true;
  }

  private relativeCellFromCellOpcode(opcode: number): number {
    // Matches the `cellNames` order in `src/renderer/DrawViewport.ts`.
    switch (opcode) {
      case Opcode.F4L1:
        return 4;
      case Opcode.F4R1:
        return 5;
      case Opcode.F4:
        return 6;
      case Opcode.F3L2:
        return 2;
      case Opcode.F3L1:
        return 7;
      case Opcode.F3R1:
        return 8;
      case Opcode.F3:
        return 9;
      case Opcode.F3R2:
        return 10;
      case Opcode.F2L1:
        return 12;
      case Opcode.F2R1:
        return 13;
      case Opcode.F2:
        return 14;
      case Opcode.F1L1:
        return 15;
      case Opcode.F1R1:
        return 16;
      case Opcode.F1:
        return 17;
      case Opcode.F0L1:
        return 18;
      case Opcode.F0R1:
        return 19;
      case Opcode.F0:
        return 20;
      default:
        return 0;
    }
  }

  private relativeCellFromContentsOpcode(opcode: number): number {
    const map: { [key: number]: number } = {
      [Opcode.F4L1Contents]: 4,
      [Opcode.F4R1Contents]: 5,
      [Opcode.F4Contents]: 6,
      [Opcode.F3L2Contents]: 2,
      [Opcode.F3L1Contents]: 7,
      [Opcode.F3R1Contents]: 8,
      [Opcode.F3Contents]: 9,
      [Opcode.F3R2Contents]: 10,
      [Opcode.F2L1Contents]: 12,
      [Opcode.F2R1Contents]: 13,
      [Opcode.F2Contents]: 14,
      [Opcode.F1L1Contents]: 15,
      [Opcode.F1R1Contents]: 16,
      [Opcode.F1Contents]: 17,
      [Opcode.F0L1Contents]: 18,
      [Opcode.F0R1Contents]: 19,
      [Opcode.F0Contents]: 20,
    };
    return map[opcode] ?? 0;
  }

  private relativeCellFromXYOpcode(opcode: number): number {
    const map: { [key: number]: number } = {
      [Opcode.F4L1xy]: 4,
      [Opcode.F4R1xy]: 5,
      [Opcode.F4xy]: 6,
      [Opcode.F3L2xy]: 2,
      [Opcode.F3L1xy]: 7,
      [Opcode.F3R1xy]: 8,
      [Opcode.F3xy]: 9,
      [Opcode.F3R2xy]: 10,
      [Opcode.F2L1xy]: 12,
      [Opcode.F2R1xy]: 13,
      [Opcode.F2xy]: 14,
      [Opcode.F1L1xy]: 15,
      [Opcode.F1R1xy]: 16,
      [Opcode.F1xy]: 17,
      [Opcode.F0L1xy]: 18,
      [Opcode.F0R1xy]: 19,
      [Opcode.F0xy]: 20,
    };
    return map[opcode] ?? 0;
  }

  private relativeCellFromDoorOpcode(opcode: number): number {
    const map: { [key: number]: number } = {
      [Opcode.F3L1DoorRecordIndex]: 7,
      [Opcode.F3DoorRecordIndex]: 9,
      [Opcode.F3R1DoorRecordIndex]: 8,
      [Opcode.F2L1DoorRecordIndex]: 12,
      [Opcode.F2DoorRecordIndex]: 14,
      [Opcode.F2R1DoorRecordIndex]: 13,
      [Opcode.F1L1DoorRecordIndex]: 15,
      [Opcode.F1DoorRecordIndex]: 17,
      [Opcode.F1R1DoorRecordIndex]: 16,
      [Opcode.F0DoorRecordIndex]: 20,

      [Opcode.F3L1DoorState]: 7,
      [Opcode.F3DoorState]: 9,
      [Opcode.F3R1DoorState]: 8,
      [Opcode.F2L1DoorState]: 12,
      [Opcode.F2DoorState]: 14,
      [Opcode.F2R1DoorState]: 13,
      [Opcode.F1L1DoorState]: 15,
      [Opcode.F1DoorState]: 17,
      [Opcode.F1R1DoorState]: 16,
      [Opcode.F0DoorState]: 20,
    };
    return map[opcode] ?? 0;
  }

  private relativeCellFromFloorDecorationOpcode(opcode: number): number {
    const map: { [key: number]: number } = {
      [Opcode.FloorDecorationGraphicOrdinalF3L1]: 7,
      [Opcode.FloorDecorationGraphicOrdinalF3]: 9,
      [Opcode.FloorDecorationGraphicOrdinalF3R1]: 8,
      [Opcode.FloorDecorationGraphicOrdinalF2L1]: 12,
      [Opcode.FloorDecorationGraphicOrdinalF2]: 14,
      [Opcode.FloorDecorationGraphicOrdinalF2R1]: 13,
      [Opcode.FloorDecorationGraphicOrdinalF1L1]: 15,
      [Opcode.FloorDecorationGraphicOrdinalF1]: 17,
      [Opcode.FloorDecorationGraphicOrdinalF1R1]: 16,
      [Opcode.FloorDecorationGraphicOrdinalF0L1]: 18,
      [Opcode.FloorDecorationGraphicOrdinalF0]: 20,
      [Opcode.FloorDecorationGraphicOrdinalF0R1]: 19,
    };
    return map[opcode] ?? 0;
  }
}
