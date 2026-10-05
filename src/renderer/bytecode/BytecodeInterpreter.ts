/**
 * Bytecode Interpreter - Direct port from CSBWin
 *
 * This is a mechanical port of the Interpret() function from CSBWin's Viewport.cpp
 * The goal is to execute bytecode programs exactly as CSBWin does.
 */

import { Opcode } from './Opcodes';
import { SummarizeRoomData } from './Types';
import { ViewportDraw } from './ViewportDraw';
import { DrawFloorDecorations, DrawWallDecoration, drawWallText } from './DrawDecorations';
import { DrawDoor, DrawDoorSwitch, DrawTeleporter } from './DrawDoor';
import { DrawRoomObjects } from './DrawRoomObjects';
import {
  tag0088b2Explicit,
  type IndexedBitmap,
  type PaletteIndexViewportBuffer
} from '../csbwin/CanvasBlitter';
import type { DungeonState } from '../../engine/DungeonState';
import type { PartyFootprints } from '../../engine/PartyFootprints';
import type { GameState } from '../../engine/gameTypes';
import type { MonsterDesignOptions } from '../../engine/MonsterSystem';
import type { ObjectTables } from '../../data/tables/ObjectTables';
import type { RectPos } from '../../data/tables/UITables';
import type { CSBGraphicsLoader } from '../../data/CSBGraphicsLoader';
import { OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../../core/types';

/**
 * Execution context - simulates CSBWin's global state
 */
export interface InterpreterContext {
  // Graphics data
  wallBitmaps: IndexedBitmap[];
  doorBitmaps?: IndexedBitmap[]; // pDoorBitmaps[0..7]
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
  seeThruWallsRectUByte4?: number; // d.SeeThruWallsRect.b.uByte4
  seeThruWallsRectUByte6?: number; // d.SeeThruWallsRect.b.uByte6
  seeThruDoorEdgeRect?: RectPos;
  /** `(RectPos *)d.Byte2546` — where a Hall of Champions portrait lands in the viewport. */
  championPortraitRect?: RectPos;
  /**
   * `d.Word1868`: set, a Fluxcage's shimmer is not drawn (`DrawRoomObjects`,
   * `doc/CSBwin-src/Code51a4.cpp:2774`). Only `_FusionSequence` sets it (`Attack.cpp:2367`).
   */
  word1868?: boolean;

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
  /** `d.PartyFootprints`, which `SummarizeRoomInfo` searches for the magic prints. */
  footprints?: PartyFootprints;
  /** The game's state, whose `tickCount` (`d.Time`) `SummarizeRoomInfo` reads. */
  gameState?: GameState;
  /**
   * `invisibleMonsters` and `drawAsSize4Monsters`, which `DrawRoomObjects` and `DrawMonster`
   * read (`doc/CSBwin-src/Code51a4.cpp:2205`, `:420`). Absent, both are off, as at CSBWin's start.
   */
  rules?: MonsterDesignOptions;
  frameFacing?: number;
  frameMapIndex?: number;
  doorGraphics?: number[][]; // d.DoorGraphic[3][2] resolved for current level (Code390e.cpp:180+)
  doorTOC?: number[]; // d.DoorTOC[2], resolved from DoorCharacteristics for the current level
  /**
   * `d.Word2514[17][2]`: per door ornament, its graphic and its position set
   * (`d.Byte4122`). Slots 15 and 16, the bashed door (graphic 301) and See-Thru-Walls
   * (302), are set once (`doc/CSBwin-src/CSBCode.cpp:10251-10262`), and the level's own
   * from its `DoorDecorationTOC` (`Code390e.cpp:275-284`), which leaves any slot past
   * the level's count as the last level to fill it left it.
   */
  doorOrnaments?: Array<[number, number]>;
  /**
   * `d.LoadedFloorDecorations[16][2]`: per floor decoration, its first graphic and its
   * rectangle set (`d.Byte4110`). Slot 15, the footprints (graphic 241, set 1), is set
   * once (`doc/CSBwin-src/CSBCode.cpp:10270-10273`), and the level's own from its
   * `FloorDecorationTOC` (`Code390e.cpp:263-274`), at most fifteen of them.
   */
  loadedFloorDecorations?: Array<[number, number]>;
  numWallDecoration?: number; // d.NumWallDecoration (CSBCode.cpp:5798)
  useMirrorImages?: boolean; // d.UseMirrorImages (Viewport.cpp:6740)

  viewportIndexBuffer?: PaletteIndexViewportBuffer;
  seeThroughWalls?: boolean; // d.SeeThruWalls (Viewport.cpp:2639)
  facingAlcove?: boolean;
  facingViAltar?: boolean;
  facingWaterFountain?: boolean;

  // Room data for all 21 cells
  roomData: SummarizeRoomData[];

  doorSwitchRects?: RectPos[];
  viewportObjectButtons?: RectPos[];
  viewportObjectRNs?: ObjectID[];

  // Monster attack animation state hook (used for sound triggers)

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
  /** The context, bitmap caches and blits the drawing functions share with the machine. */
  private readonly draw: ViewportDraw;
  private removeMortarJoint = true;
  private hasAlcove = 0;
  /** The derived graphics a program allocates, by number (CSBWin `AllocateDerivedGraphic`). */
  private derivedGraphics = new Map<number, Uint8Array>();

  constructor(context: InterpreterContext) {
    this.context = context;
    this.draw = new ViewportDraw(context);
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
        return this.opStdDrawCeilingPit();
      case Opcode.StdDrawSeeThruDoorEdge:
        return this.opStdDrawSeeThruDoorEdge();

      // See-Thru-Walls through the F1 wall (Viewport.cpp:2957-3016).
      case Opcode.StdAllocateDerivedGraphic:
        this.allocateDerivedGraphic(this.stack.pop() ?? 0);
        return true;
      case Opcode.StdBitmapViewport:
        this.stack.push(StdBitmapPtr.BMP_StdBitmapViewport);
        return true;
      case Opcode.StdSeeThruWallsRect:
        this.stack.push(StdRectPtr.RECT_StdSeeThruWallsRect);
        return true;
      case Opcode.StdSeeThruWallsRect2:
        this.stack.push(StdRectPtr.RECT_StdSeeThruWallsRect2);
        return true;
      case Opcode.StdSeeThruWallsRectUByte4:
        this.stack.push(this.context.seeThruWallsRectUByte4 ?? 0);
        return true;
      case Opcode.StdSeeThruWallsRectUByte6:
        this.stack.push(this.context.seeThruWallsRectUByte6 ?? 0);
        return true;
      case Opcode.MinusOne:
        this.stack.push(-1);
        return true;
      case Opcode.Zero:
        this.stack.push(0);
        return true;
      case Opcode.StdBltToDerivedGraphic:
        return this.opStdBltDerivedGraphic(true);
      case Opcode.StdBltFromDerivedGraphic:
        return this.opStdBltDerivedGraphic(false);
      case Opcode.StdDeleteDerivedGraphic:
        this.derivedGraphics.delete(this.stack.pop() ?? 0);
        // CSBWin's case has no `break` and falls into `StdHoleInWallBitmap` (Viewport.cpp:3015-3016).
        this.stack.push(StdBitmapPtr.BMP_StdHoleInWallBitmap);
        return true;
      case Opcode.StdHoleInWallBitmap:
        this.stack.push(StdBitmapPtr.BMP_StdHoleInWallBitmap);
        return true;

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

    this.draw.blitShapeBitmapToViewport(bitmap, rectRef, false);

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
    this.draw.blitShapeBitmapToViewport(bitmap, rectRef, mirror);
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
    this.draw.blitShapeBitmapToViewport(bitmap, rectRef, mirror);
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
    DrawFloorDecorations(this.draw, floorGraphicOrdinal | 0, floorCell | 0);
    return true;
  }

  private opStdDrawCeilingPit(): boolean {
    const mapY = this.stack.pop();
    const mapX = this.stack.pop();
    const relCellRF = this.stack.pop();

    if (mapY === undefined || mapX === undefined || relCellRF === undefined) {
      // ERROR: StdDrawCeilingPit - missing arguments
      return true;
    }

    const dungeon = this.context.dungeonState;
    const getGraphic = this.context.getGraphicBitmap;
    const ceilingRects = this.context.ceilingPitRectangles;
    const level = this.context.frameMapIndex;
    if (!dungeon || !getGraphic || !ceilingRects || level === undefined) return true;

    const relIndex = relCellRF | 0;
    const relativeCell = BytecodeInterpreter.objectDrawingLocations[relIndex] ?? 0;

    const posAbove = dungeon.incrementLevel(new Position(mapX | 0, mapY | 0, level | 0), -1);
    if (!posAbove) return true;
    const aboveMap = dungeon.getMap(posAbove.z);
    if (!aboveMap) return true;

    const cellFlag = aboveMap.cellFlags?.[posAbove.x]?.[posAbove.y] ?? 0;
    const roomType = (cellFlag >> 5) & 0x7;
    if (roomType !== RoomType.PIT) return true;
    if ((cellFlag & 0x08) === 0) return true;

    const cell2graphic = [0, 0, 0, 64, 63, 63, 66, 65, 65, 68, 67, 67];
    const cell2rect = [0, 0, 0, 7, 8, 6, 4, 5, 3, 1, 2, 0];
    const cell2mirror = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    if (relativeCell < 0 || relativeCell >= cell2graphic.length) return true;

    const rect = ceilingRects[cell2rect[relativeCell] ?? 0];
    if (!rect) return true;

    const bitmap = getGraphic(cell2graphic[relativeCell] ?? 0);
    if (!bitmap) return true;

    const mirror = (cell2mirror[relativeCell] ?? 0) !== 0;
    this.draw.blitShapeBitmapToViewport(bitmap, rect, mirror);
    return true;
  }

  /**
   * CSBWin `AllocateDerivedGraphic` (`doc/CSBwin-src/CSBCode.cpp:11211`): a buffer of
   * `GetDerivedGraphicSize(n)` bytes, kept if it already exists. Graphic 1, the only one a
   * program allocates, is 4560 bytes (`CSBCode.cpp:10248`), 96x95 pixels.
   */
  private allocateDerivedGraphic(graphicNum: number): void {
    if (this.derivedGraphics.has(graphicNum)) return;
    const bytes = graphicNum === 1 ? 4560 : 0;
    this.derivedGraphics.set(graphicNum, new Uint8Array(bytes * 2));
  }

  /**
   * CSBWin `StdBltToDerivedGraphic` / `StdBltFromDerivedGraphic` (Viewport.cpp:2965-3014):
   * `TAG0088b2` between a standard bitmap and a derived graphic, every argument off the stack.
   */
  private opStdBltDerivedGraphic(toDerived: boolean): boolean {
    const xparentColor = this.stack.pop() ?? 0;
    const dstWidth = this.stack.pop() ?? 0;
    const srcWidth = this.stack.pop() ?? 0;
    const srcY = this.stack.pop() ?? 0;
    const srcX = this.stack.pop() ?? 0;
    const pDstRect = this.resolveStdRectanglePointer(this.stack.pop() ?? 0);
    const dstPtr = this.stack.pop() ?? 0;
    const srcPtr = this.stack.pop() ?? 0;
    const dst = toDerived ? this.derivedGraphics.get(dstPtr) : this.resolveStdBitmapPointer(dstPtr)?.pixels;
    const src = toDerived ? this.resolveStdBitmapPointer(srcPtr)?.pixels : this.derivedGraphics.get(srcPtr);
    if (!src || !dst || !pDstRect || Array.isArray(pDstRect)) return true;
    tag0088b2Explicit(src, dst, pDstRect, srcX, srcY, srcWidth, dstWidth, xparentColor);
    return true;
  }

  /**
   * CSBWin `StdDrawSeeThruDoorEdge` (`doc/CSBwin-src/Viewport.cpp:2576-2587`): the door edge
   * the party stands in, with the hole of graphic 41 cut through it. CSBWin's own comment
   * says the source X offset "isn't right"; it is ported as it stands.
   */
  private opStdDrawSeeThruDoorEdge(): boolean {
    const doorEdge = this.context.doorBitmaps?.[1];
    const hole = this.context.getGraphicBitmap?.(41);
    const rect = this.context.seeThruDoorEdgeRect;
    const trackTop = this.context.doorTrackTopRectangles;
    if (!doorEdge || !hole || !rect || !trackTop?.[0] || !trackTop[6]) return true;
    const tempBitmap: IndexedBitmap = { width: doorEdge.width, height: doorEdge.height, pixels: doorEdge.pixels.slice(0, 1968 * 2) };
    tag0088b2Explicit(
      hole.pixels,
      tempBitmap.pixels,
      rect,
      trackTop[0].x1 - (this.context.seeThruWallsRectUByte4 ?? 0),
      0,
      48,
      16,
      9,
    );
    this.draw.blitShapeBitmapToViewport(tempBitmap, trackTop[6], false);
    return true;
  }

  private opStdDrawDoorSwitch(): boolean {
    // CSBWin `StdDrawDoorSwitch` (Viewport.cpp:2886-2889)
    const distance = this.stack.pop();
    const switchId = this.stack.pop();

    if (distance === undefined || switchId === undefined) {
      // ERROR: StdDrawDoorSwitch - missing arguments
      return true;
    }

    DrawDoorSwitch(this.draw, switchId | 0, distance | 0);
    return true;
  }

  // ============================================================
  // ROOM OBJECTS (Phase 5)
  // ============================================================

  // CSBWin `objectDrawingLocations[21]` (Viewport.cpp:2419)
  private static readonly objectDrawingLocations: number[] = [0, 0, 0, 0, -2, -1, -3, 1, 2, 0, 0, 0, 4, 5, 3, 7, 8, 6, 10, 11, 9];
  // CSBWin `floorDrawingLocations[21]` (Viewport.cpp:2413)
  private static readonly floorDrawingLocations: number[] = [
    0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 0, 3, 5, 4, 6, 8, 7, 0, 0, 9,
  ];

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
    DrawRoomObjects(this.draw, firstObject as ObjectID, facing, mapX | 0, mapY | 0, relativeCell | 0, drawOrder | 0);
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

    DrawTeleporter(this.draw, teleporterRect, wallRect);
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

    // `d.DoorGraphic[doorGraphicIndex]`; index 0 is F1, nearness 2 (`doc/CSBwin-src/Viewport.cpp:2591-2598`).
    const graphicIndex = doorGraphicIndex | 0;
    DrawDoor(this.draw, doorRecordIndex | 0, doorState | 0, this.context.doorGraphics?.[graphicIndex], 2 - graphicIndex, rectRef);
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
    // CSBWin passes the cell's `championPortraitOrdinal` as the fourth argument
    // (`doc/CSBwin-src/Viewport.cpp:2946-2950`); `SummarizeRoomInfo` set it from the
    // type-127 actuator on the wall the party is facing.
    this.hasAlcove = DrawWallDecoration(
      this.draw,
      graphicOrdinal | 0,
      wallDecorationDrawLocation | 0,
      (rd?.championPortraitOrdinal ?? 0) | 0,
    ) ? 1 : 0;
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
    drawWallText(this.draw, textRN as ObjectID, wallDecorationDrawLocation | 0, this.removeMortarJoint);
    this.removeMortarJoint = true;
    return true;
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
    const wall = this.context.wallBitmaps;
    const door = this.context.doorBitmaps ?? [];

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

      case StdBitmapPtr.BMP_StdBitmapViewport:
        return this.context.viewportIndexBuffer ?? null;
      case StdBitmapPtr.BMP_StdHoleInWallBitmap:
        return this.context.getGraphicBitmap?.(41) ?? null;

      default:
        return null;
    }
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
