/**
 * Bytecode Interpreter - Direct port from CSBWin
 *
 * This is a mechanical port of the Interpret() function from CSBWin's Viewport.cpp
 * The goal is to execute bytecode programs exactly as CSBWin does.
 */

import { DescIndex } from '../../engine/objectIndex';
import {
  RN_FIREBALL, RN_LIGHTNING, RN_POISON, RN_POISON_BOLT, RN_POISON_CLOUD, isMagicSpellRn,
} from '../../core/spellRn';
import { Opcode } from './Opcodes';
import { SummarizeRoomData } from './Types';
import { ViewportDraw, viewportRandom } from './ViewportDraw';
import { DrawFloorDecorations, DrawWallDecoration, drawWallText } from './DrawDecorations';
import { DrawDoor, DrawDoorSwitch, DrawTeleporter } from './DrawDoor';
import {
  bltShapeToViewportIndex,
  IDENTITY_COLOR_MAP,
  shrinkBlt,
  tag0088b2Explicit,
  type IndexedBitmap,
  type PaletteIndexViewportBuffer
} from '../csbwin/CanvasBlitter';
import type { DungeonState } from '../../engine/DungeonState';
import type { PartyFootprints } from '../../engine/PartyFootprints';
import type { CreatureRecord } from '../../data/dungeonTypes';
import type { ObjectTables } from '../../data/tables/ObjectTables';
import type { RectPos } from '../../data/tables/UITables';
import {
  monsterHasAttackGraphic,
  monsterHasBackGraphic,
  monsterHasSideGraphic,
  monsterHorizontalSize,
  monsterNonAttackingMirrorOK,
  monsterWord4Bit7,
  monsterWord4Bit8,
} from '../../data/tables/MonsterDesc';
import { ordinalAtPositionBytes } from '../../engine/monsterPosition';
import type { CSBGraphicsLoader } from '../../data/CSBGraphicsLoader';
import { decodeObjectID, DBType, OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../../core/types';
import { applyLimits } from '../../core/intCast';

/**
 * `GetGraphicClass` (`doc/CSBwin-src/Code51a4.cpp:2838-2870`): how a flying object is
 * drawn. A negative class `-n` is `d.struct5688[n-1]`, a missile graphic: every spell,
 * and every weapon whose `WEAPONDESC.word4` holds one in `BITS8_12` (a dagger, an arrow,
 * a sword…), which flies as that graphic and not as the object lying on the floor. A
 * class of 0 or more is the object's own `d.ObjDesc` graphic class. `null` is not an
 * object at all, which CSBWin never draws (it would read `d.ObjDesc[-1]`).
 */
export function GetGraphicClass(
  dungeon: DungeonState,
  tables: Pick<ObjectTables, 'objDescGraphicClass' | 'weaponDesc'>,
  rn: ObjectID,
): number | null {
  const category = isMagicSpellRn(rn) ? DBType.CLOUD : decodeObjectID(rn).category;
  if (category === DBType.CLOUD) {
    if (rn === RN_FIREBALL) return -11;
    if (rn === RN_POISON) return -13;
    if (rn === RN_LIGHTNING) return -4;
    if (rn === RN_POISON_BOLT) return -14;
    if (rn === RN_POISON_CLOUD) return -14;
    return -12;
  }
  if (category === DBType.WEAPON) {
    const weapon = dungeon.getWeaponRecord(rn); // TAG0099d2
    const missileGraphic = ((tables.weaponDesc[weapon?.weaponType ?? -1]?.word4 ?? 0) >> 8) & 0x1f;
    if (missileGraphic !== 0) return -missileGraphic;
  }
  const descIndex = DescIndex(dungeon, rn);
  if (descIndex === -1) return null;
  return tables.objDescGraphicClass[descIndex] ?? null;
}

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
  /** The context, bitmap caches and blits the drawing functions share with the machine. */
  readonly draw: ViewportDraw;
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

    // Only the cells 0..9 draw objects, and missiles and clouds are left there too; but a
    // monster is drawn in cells 10 and 11 as well, beside the party
    // (`ProcessOnePosition`, `doc/CSBwin-src/Code51a4.cpp:2223-2224`, `:2254-2258`).
    // CSBWin draws the clouds of cells -3..-1, 10 and 11 as well (`:2769`): `DEBT.md` C94.
    if (relativeCellNumber < 0 || relativeCellNumber > 11) return;
    const objectsDrawn = relativeCellNumber <= 9;

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
      // The last creature in the chain (`objMonster_54`, `Code51a4.cpp:2204-2210`).
      // `invisible()` is gated on `invisibleMonsters`, false in DM (`DEBT.md`, "The
      // monster design options"), so every creature is drawn.
      if (category === DBType.CREATURE) {
        const record = dungeon.getCreatureRecord(rn);
        if (record) {
          monsterRecord = record;
          monsterState = dungeon.getMonsterRenderState(record);
        }
      } else if (category === DBType.MISSILE) {
        missilePresent = true;
      } else if (category === DBType.CLOUD) {
        cloudPresent = true;
      }
    }

    let lastAbsPos = 0;
    if (drawingAlcoveObjects) {
      const relLoc = 4; // niche slot
      const curAbsPos = (facing + 2) & 3;
      lastAbsPos = curAbsPos;
      let currentSmallOffset = 2 + ((curAbsPos & 1) << 3);
      if (objectsDrawn) {
        this.drawObjectsAtPosition(dungeon, tables, firstObject, relativeCellNumber, middleLeftRight, relLoc, curAbsPos, currentSmallOffset, true);
      }
      // No return: an alcove's clouds are drawn too, at `CurAbsPos = (facing+2)&3`
      // (`doc/CSBwin-src/Code51a4.cpp:2180`, `:2768-2773`). The Vi altar's lightning and
      // explosion (cloud types 100 and 101) are a cloud in the altar's alcove.
    }

    // `PositionListIndex`: which nibble is being processed, 1 for the first
    // (`Code51a4.cpp:2189`).
    let positionListIndex = 0;
    while (positionList !== 0) {
      const nibble = positionList & 0xf;
      positionList >>>= 4;
      positionListIndex++;
      if (nibble === 0) continue;

      const relLoc = (nibble - 1) & 0xf; // 0..3
      const curAbsPos = (relLoc + facing) & 3;
      lastAbsPos = curAbsPos;
      let currentSmallOffset = ((curAbsPos & 1) << 3) & 0xf;
      if (objectsDrawn) {
        this.drawObjectsAtPosition(dungeon, tables, firstObject, relativeCellNumber, middleLeftRight, relLoc, curAbsPos, currentSmallOffset, false);
      }

      if (monsterRecord && monsterState) {
        this.drawMonster(
          monsterRecord, monsterState, facing, relativeCellNumber, curAbsPos, relLoc, sideOfDoor,
          middleLeftRight, positionList, positionListIndex,
        );
      }

      if (missilePresent && objectsDrawn) {
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

    if (cloudPresent && objectsDrawn) {
      const fluxcage = this.drawClouds(relativeCellNumber, firstObject, facing, lastAbsPos);
      // `if ((pdb_150!=NULL) && (sideOfDoor!=SOD_FarSideOfDoor) && (d.Word1868==0))`
      // (`doc/CSBwin-src/Code51a4.cpp:2774`).
      if (fluxcage && sideOfDoor !== SideOfDoor.FarSide && !this.context.word1868) {
        const teleporter = this.context.teleporterRectangles?.[relativeCellNumber];
        const wallRect = this.context.wallRectangles[relativeCellNumber];
        if (teleporter && wallRect) {
          const shifted: RectPos = { ...teleporter, x1: (teleporter.x1 | 0) + 1 };
          DrawTeleporter(this.draw, shifted, wallRect);
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

      const descIndex = DescIndex(dungeon, rn);
      if (descIndex === -1) continue;
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

  private decodeMonsterStatus(status: number): { attacking: boolean; mirror: boolean; nibble0: number; nibble3: number } {
    return {
      attacking: (status & 0x80) !== 0,
      mirror: (status & 0x40) !== 0,
      nibble0: status & 0x7,
      nibble3: (status >> 3) & 0x7,
    };
  }

  /**
   * `DrawMonster` (`doc/CSBwin-src/Code51a4.cpp:352-961`), called once per position of the
   * drawing order by `ProcessOnePosition` (`:2259-2295`).
   *
   * The first half decides *where* in the cell the group is drawn — `positionWithinCell`,
   * an index into the monster's `d.s6982` set (`MonsterXYonScreen`) — and it is not the
   * corner a member stands on. For a two-corner monster (`horizontalSize() == 1`, a rat
   * or a worm) the set is 0/1 = the cell's left/right half, 2 = the far middle (seen from
   * the side), 3 = the middle (a lone one seen from the side), 4 = the near middle. Such
   * a monster is drawn only at the position list's last far position or its end, and
   * a pair seen from the front or back is drawn both at once, the second sprite in the
   * other half (`w_94`, `:946-958`).
   *
   * `drawAsSize4()` is gated on `drawAsSize4Monsters`, false in DM (`DEBT.md`, "The
   * monster design options"), so `DrawSize4Index` is never reached.
   */
  private drawMonster(
    monster: CreatureRecord,
    monsterState: { positions: number; facings: number; statuses: Uint8Array },
    facing: number,
    relativeCellNumber: number,
    curAbsPos: number,
    positionWithinCell: number,
    sideOfDoor: SideOfDoor,
    middleLeftRight: number,
    positionList: number,
    positionListIndex: number,
  ): void {
    const tables = this.context.objectTables;
    if (!tables) return;

    // "LOCAL_96 means working on last of far positions."
    const local96 =
      (positionWithinCell <= 1 || positionListIndex === 1) &&
      (positionList === 0 || (positionList & 15) >= 3);

    const pmtDesc = tables.monsterDesc[monster.creatureType];
    if (!pmtDesc) return;
    const monsterSize = monsterHorizontalSize(pmtDesc);

    let rootIndexOfMonsterInGroup = ordinalAtPositionBytes({
      positions: monsterState.positions,
      facings: monsterState.facings,
      numMonM1: monster.numMonM1,
      horizontalSize: monsterSize,
      position: curAbsPos,
    });
    let indexWithinGroup: number;
    if (rootIndexOfMonsterInGroup !== 0) {
      // At least part of a monster is here!
      rootIndexOfMonsterInGroup--;
      indexWithinGroup = rootIndexOfMonsterInGroup;
    } else if (monsterSize === 1) {
      indexWithinGroup = -1;
    } else {
      return;
    }

    const monsterAbsFacing = (monsterState.facings >> (2 * rootIndexOfMonsterInGroup)) & 3;
    const monsterRelFacing = (facing - monsterAbsFacing) & 3; // 0=away, 1=right, 2=toward, 3=left
    let w94 = 0;
    let d4 = monsterState.positions & 0xff;
    // Several monsters that each fill the cell are invisible: "People have taken
    // advantage of this ... uh .. feature." (`:471-484`).
    if (monsterSize === 2 && d4 !== 255) return;
    if (d4 === 255) {
      // Wait until the last minute to draw a centred monster.
      if (positionList !== 0 || sideOfDoor === SideOfDoor.FarSide) return;
      positionWithinCell = monsterSize === 1 && (monsterRelFacing & 1) !== 0 ? 3 : 4;
    } else if (monsterSize === 1 && (local96 || positionList === 0 || indexWithinGroup < 0)) {
      if (local96 && sideOfDoor !== SideOfDoor.NearSide) {
        if (indexWithinGroup >= 0 && (monsterRelFacing & 1) !== 0) positionWithinCell = 2;
        else return;
      } else if (sideOfDoor !== SideOfDoor.FarSide && positionList === 0) {
        if ((monsterRelFacing & 1) !== 0) {
          if (indexWithinGroup >= 0) positionWithinCell = 4;
          else return;
        } else {
          if (indexWithinGroup < 0) indexWithinGroup = 0;
          w94 = monster.numMonM1 & 3;
          d4 = (d4 >> (2 * rootIndexOfMonsterInGroup)) & 3; // position of this monster
          positionWithinCell = d4 === facing || d4 === ((facing - 1) & 3) ? 0 : 1;
        }
      } else {
        return;
      }
    } else if (monsterSize !== 0) {
      return;
    }

    let sms = this.decodeMonsterStatus(monsterState.statuses[indexWithinGroup] ?? 0);
    // To our immediate left or right: our right becomes our left, our left our current cell.
    if (relativeCellNumber > 9) relativeCellNumber--;

    for (;;) {
      this.drawMonsterAt(pmtDesc, sms, monsterRelFacing, relativeCellNumber, positionWithinCell, middleLeftRight);
      if (w94 === 0) break;
      w94 = 0;
      sms = this.decodeMonsterStatus(monsterState.statuses[indexWithinGroup === 0 ? 1 : 0] ?? 0);
      positionWithinCell = positionWithinCell === 1 ? 0 : 1;
    }
  }

  /** The body of `DrawMonster`'s drawing loop (`Code51a4.cpp:569-945`): one sprite. */
  private drawMonsterAt(
    pmtDesc: ObjectTables['monsterDesc'][number],
    sms: { attacking: boolean; mirror: boolean; nibble0: number; nibble3: number },
    monsterRelFacing: number,
    relativeCellNumber: number,
    positionWithinCell: number,
    middleLeftRight: number,
  ): void {
    const tables = this.context.objectTables;
    const getGraphic = this.context.getGraphicBitmap;
    if (!tables || !this.context.viewportIndexBuffer || !getGraphic) return;

    const pI12 = tables.monsterGraphics[pmtDesc.type];
    if (!pI12) return;
    const monsterXYonScreen = tables.monsterPositions[(pI12.uByte10 >> 4) & 15]?.[relativeCellNumber]?.[positionWithinCell];
    if (!monsterXYonScreen || monsterXYonScreen.y === 0) return;

    const hasSide = monsterHasSideGraphic(pmtDesc);
    const hasBack = monsterHasBackGraphic(pmtDesc);
    const hasAttack = monsterHasAttackGraphic(pmtDesc);

    let graphicNum0 = 446 + (pI12.word0 | 0);
    let showBackView = false;
    let showAttackView = false;
    let frontViewMirror = false;
    let srcByteWidth: number;
    let srcHeight: number;
    const showSideView = hasSide && (monsterRelFacing & 1) !== 0;
    if (showSideView) {
      graphicNum0++;
      srcByteWidth = pI12.sideByteWidth;
      srcHeight = pI12.sideHeight;
    } else {
      showBackView = hasBack && monsterRelFacing === 0;
      // The attacking flag is set by the AI, in `NextMonsterUpdateTime`; the renderer
      // only reads it.
      showAttackView = !showBackView && sms.attacking && hasAttack;
      if (showAttackView) {
        srcByteWidth = pI12.attackByteWidth;
        srcHeight = pI12.attackHeight;
        graphicNum0++;
        if (hasSide) graphicNum0++;
        if (hasBack) graphicNum0++;
      } else {
        srcByteWidth = pI12.frontRearByteWidth;
        srcHeight = pI12.frontRearHeight;
        if (showBackView) graphicNum0 += hasSide ? 2 : 1;
        else frontViewMirror = monsterNonAttackingMirrorOK(pmtDesc) && sms.mirror;
      }
    }

    const base = getGraphic(graphicNum0);
    if (!base) return;

    let src = base;
    let dstByteWidth = srcByteWidth;
    let dstHeight = srcHeight;
    let distanceFromUs: number;
    let transparentColor: number;
    let mirror: boolean;
    if (relativeCellNumber >= 6) {
      // Within one cell of us.
      distanceFromUs = 0;
      transparentColor = pI12.uByte10 & 15;
      mirror =
        (showSideView && monsterRelFacing === 1) ||
        (showAttackView && sms.mirror) ||
        (!showSideView && !showBackView && !showAttackView && frontViewMirror);
    } else {
      let b102: boolean;
      let scaleFactor: number;
      let distancePalette: Uint8Array;
      if (relativeCellNumber >= 3) {
        // Exactly two rows ahead.
        distanceFromUs = 1;
        b102 = monsterWord4Bit7(pmtDesc) && !showSideView && !showBackView && !showAttackView;
        distancePalette = tables.monsterColorMapMedium;
        scaleFactor = 20; // 20/32 = 0.625
      } else {
        // Three or more rows ahead.
        b102 = false;
        distanceFromUs = 2;
        frontViewMirror = false;
        distancePalette = tables.monsterColorMapFar;
        scaleFactor = 16; // 16/32 = 0.5
      }
      dstByteWidth = (srcByteWidth * scaleFactor + (scaleFactor >> 1)) >> 5;
      dstHeight = (srcHeight * scaleFactor + (scaleFactor >> 1)) >> 5;
      transparentColor = this.mapColorValue(distancePalette, pI12.uByte10 & 15);
      src = shrinkBlt(base, base.width, base.height, Math.max(1, dstByteWidth * 2), Math.max(1, dstHeight), distancePalette);
      // The last term can never hold, since `frontViewMirror` needs
      // `NonAttackingMirrorOK()`: a front view is not mirrored beyond the first row
      // (`:859-864`). The 68000 code in the comment above it tests `(word4 & 4) != 0`.
      mirror =
        (showSideView && monsterRelFacing === 1) ||
        (showAttackView && sms.mirror) ||
        (b102 && monsterWord4Bit8(pmtDesc)) ||
        (frontViewMirror && !monsterNonAttackingMirrorOK(pmtDesc));
    }
    // CSBWin's `Mirror` moves the row padding to the left and reads past it (`w_90`); the
    // port's bitmaps are unpadded, so there is nothing to skip.
    if (mirror) src = this.draw.getMirroredBitmap(src);

    let d4 = monsterXYonScreen.y + (tables.smallOffsets[sms.nibble3] ?? 0);
    const y2 = Math.min(d4, 135);
    const y1 = Math.max(0, d4 - dstHeight + 1);
    d4 = monsterXYonScreen.x + (tables.smallOffsets[(distanceFromUs << 3) + sms.nibble0] ?? 0);
    if (middleLeftRight === 1) d4 -= 100; // Left side
    else if (middleLeftRight !== 0) d4 += 100; // Right side
    const x2 = applyLimits(0, d4 + dstByteWidth, 223);
    if (x2 === 0) return;
    const x1 = applyLimits(0, d4 - dstByteWidth + 1, 223);
    if (x1 === 223) return;
    const srcX = x1 !== 0 ? 0 : dstByteWidth - d4 - 1;
    // `TAG0088b2(..., srcOffsetX, 0, ...)`: a sprite cut at the top loses its bottom rows.
    this.draw.blitShapeToViewportIndexWithTransparent(src, { x1, y1, x2, y2, srcX, srcY: 0 }, transparentColor);
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

      const graphicClass = GetGraphicClass(dungeon, tables, missile.projectileObject);
      if (graphicClass === null) continue;
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

      const idx = -graphicClass - 1;
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

      // w_112: a missile in the party's own cell is drawn at full size when its size does
      // not follow its range, or when it has just been launched (`Code51a4.cpp:2327-2336`).
      const distanceFromUs = 2 * Math.floor(relativeCellNumber / 3) + Math.floor(relativeLocation / 2);
      let scale = 0;
      if (!((w130 || (missile.rangeRemaining & 0xff) === 255) && relativeCellNumber === 9)) {
        scale = tables.missileScale[distanceFromUs] ?? 0;
        if (!w130) {
          const range = missile.rangeRemaining & 0xff;
          const w192 = Math.max(96, range + 1);
          scale = Math.floor((scale * w192) >> 8);
        }
      }

      const baseGraphicNum = 316 + (md.uByte0 & 0xff) + w128;
      const base = getGraphic(baseGraphicNum);
      if (!base) continue;

      let widthBytes = md.widthBytes;
      let height = md.height;
      let src = base;

      if (scale > 0) {
        widthBytes = Math.max(1, (md.widthBytes * scale + (scale >> 1)) >> 5);
        height = Math.max(1, (md.height * scale + (scale >> 1)) >> 5);
        const dstWidth = widthBytes * 2;
        const colorMap = distanceFromUs >= 2 ? tables.colorMapFar : tables.colorMapMedium;
        src = shrinkBlt(base, base.width, base.height, dstWidth, height, colorMap);
      }

      if (mirror) src = this.draw.getMirroredBitmap(src);
      if (flip) src = this.draw.getFlippedBitmapVertical(src);
      // LOCAL_30, set only for a shrunk missile (`Code51a4.cpp:2470-2473`): CSBWin's rows
      // are padded to 16 pixels and `Mirror` moves the padding to the left, so the blit
      // skips it. Our bitmaps are unpadded: we read LOCAL_30 fewer, as `drawClouds` does.
      const mirrorPad = mirror && scale !== 0 ? 2 * (7 - ((widthBytes - 1) & 7)) : 0;

      // `Code51a4.cpp:2536-2555`.
      const y2 = 47 + (height >> 1);
      const y1 = 47 - (height >> 1) + ((height & 1) === 0 ? 1 : 0);
      const x2 = Math.min(223, centerX + widthBytes);
      const x1 = Math.max(0, centerX - widthBytes + 1);
      const srcX = x1 !== 0 ? mirrorPad : Math.max(mirrorPad, widthBytes - centerX - 1);

      this.draw.blitShapeToViewportIndexWithTransparent(src, { x1, y1, x2, y2, srcX: srcX - mirrorPad }, 10);
    }
  }

  /**
   * `DrawClouds` (`doc/CSBwin-src/Code51a4.cpp:76-321`). Returns whether a Fluxcage stands
   * in the cell (CSBWin returns its record, `pdb_150`).
   */
  private drawClouds(relativeCellNumber: number, firstObject: ObjectID, facing: number, curAbsPos: number): boolean {
    const tables = this.context.objectTables;
    const dungeon = this.context.dungeonState;
    const viewport = this.context.viewportIndexBuffer;
    const getGraphic = this.context.getGraphicBitmap;
    if (!tables || !dungeon || !viewport || !getGraphic) return false;

    const relCell = relativeCellNumber + 3; // RelativeCellNumber
    const relCellGroup = Math.floor(relCell / 3); // RelativeCell_46
    let fluxcage = false;

    for (let rn = firstObject; rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      const { category, position } = decodeObjectID(rn);
      if (category !== DBType.CLOUD) continue;
      const cloud = dungeon.getCloudRecord(rn);
      if (!cloud) continue;

      let d4 = cloud.cloudType | 0; // D4W
      const isSpecial = d4 >= 100; // w_160
      if (isSpecial && (relCell < 3 || relCell > 9 || position !== curAbsPos)) continue;
      let poison = false; // w_162

      let base: IndexedBitmap | null;
      let halfWidth: number; // LOCAL_22
      let height: number; // LOCAL_24
      let px: number; // pw_154[0]
      let py: number; // pw_154[1]

      if (d4 === 100) {
        // Lightning: graphic, size and position all from d.Word7246 (`:139-170`).
        const gc = GetGraphicClass(dungeon, tables, RN_LIGHTNING)!;
        const md = tables.missileGraphics[-gc - 1];
        if (!md) continue;
        base = getGraphic((md.uByte0 & 0xff) + 317);
        if (!base) continue;
        const pw = 3 * (relCell - 3);
        const scale = tables.cloudPositions7246[pw + 2] ?? 0;
        halfWidth = (md.widthBytes * scale + (scale >> 1)) >> 5;
        height = (md.height * scale + (scale >> 1)) >> 5;
        if (relCell !== 9) base = shrinkBlt(base, base.width, base.height, 2 * halfWidth, height, IDENTITY_COLOR_MAP);
        px = tables.cloudPositions7246[pw] ?? 0;
        py = tables.cloudPositions7246[pw + 1] ?? 0;
      } else {
        if (d4 === 0 || d4 === 2 || d4 === 101) {
          d4 = 0;
        } else if (d4 === 6 || d4 === 7) {
          d4 = 2;
        } else if (d4 === 40) {
          poison = true;
          d4 = 3;
        } else if (d4 === 50) {
          if (relCell >= 4) fluxcage = true;
          continue;
        } else {
          d4 = 1;
        }

        // tag006774
        if (relCell === 12) {
          this.drawCloudUnderParty(d4, poison, cloud.value, tables, getGraphic);
          continue;
        }

        let scale: number; // w_156
        if (isSpecial) {
          const pw = 3 * relCell;
          px = tables.cloudPositions7222[pw] ?? 0;
          py = tables.cloudPositions7222[pw + 1] ?? 0;
          scale = tables.cloudPositions7222[pw + 2] ?? 0;
        } else {
          if (cloud.bit7) {
            px = tables.cloudPositions7042[2 * relCell] ?? 0;
            py = tables.cloudPositions7042[2 * relCell + 1] ?? 0;
          } else {
            const side = position === facing || position === ((facing - 1) & 3) ? 0 : 1;
            const pw = 4 * relCell + 2 * side;
            px = tables.cloudPositions7162[pw] ?? 0;
            py = tables.cloudPositions7162[pw + 1] ?? 0;
          }
          const d0 = Math.max(48, cloud.value + 1);
          const d1 = tables.cloudScale[relCellGroup] ?? 0;
          scale = Math.max(4, (d1 * d0) >> 8) & 0xfffe;
        }

        const shape = this.tag005088(d4, scale, tables, getGraphic);
        if (!shape) continue;
        ({ base, halfWidth, height } = shape);
      }

      // tag006932 (`doc/CSBwin-src/Code51a4.cpp:257-313`). Both coin flips come from
      // the viewport's stream, the flip first; `GraphicRandom` is DrawTeleporter's alone.
      const flip = viewportRandom.bool() !== 0; // w_142 → TAG008840
      const mirror = viewportRandom.bool() !== 0; // LOCAL_36 → Mirror
      // LOCAL_30: CSBWin's rows are padded to 16 pixels and `Mirror` moves the padding to
      // the left, so the blit skips it. Our bitmaps are unpadded: we read LOCAL_30 fewer.
      const mirrorPad = mirror ? 2 * (7 - ((halfWidth - 1) & 7)) : 0;

      const y2 = Math.min(135, py + (height >> 1));
      const y1 = Math.max(0, py - (height >> 1) + ((height & 1) === 0 ? 1 : 0));
      if (y1 >= 136) continue;
      const x2 = Math.min(223, px + halfWidth);
      if (x2 < 0) continue;
      const x1 = applyLimits(0, px - halfWidth + 1, 223);
      const srcX = x1 !== 0 ? mirrorPad : Math.max(mirrorPad, halfWidth - px - 1);
      if (!(x2 > x1)) continue;

      let src = base;
      if (mirror) src = this.draw.getMirroredBitmap(src);
      if (flip) src = this.draw.getFlippedBitmapVertical(src);
      this.draw.blitShapeToViewportIndexWithTransparent(src, { x1, y1, x2, y2, srcX: srcX - mirrorPad }, 10);
    }

    return fluxcage;
  }

  /**
   * `TAG005088` (`doc/CSBwin-src/Code51a4.cpp:21-74`): cloud graphic `type` at `scale`/32.
   * The scale is clamped to 32, not the size; full size is the graphic itself, except
   * for type 3 (poison), which is always recoloured through `d.Byte5712`. Types 0-2 are
   * shrunk through `d.IdentityColorMap`, and type 3 borrows type 2's graphic (350).
   */
  private tag005088(
    type: number,
    scale: number,
    tables: ObjectTables,
    getGraphic: (graphicNum: number) => IndexedBitmap | null
  ): { base: IndexedBitmap; halfWidth: number; height: number } | null {
    const p2 = Math.min(32, scale);
    const a0 = tables.cloudScaleBase[2 * type] ?? 0; // d.Byte5696[2*type]
    const a1 = tables.cloudScaleBase[2 * type + 1] ?? 0;
    const halfWidth = Math.trunc((p2 * a0 + Math.trunc(p2 / 2)) / 32); // D6W
    const height = Math.trunc((p2 * a1 + Math.trunc(p2 / 2)) / 32); // D5W
    if (p2 === 32 && type !== 3) {
      const base = getGraphic(type + 348);
      return base ? { base, halfWidth, height } : null;
    }
    // The derived graphic's number, `14*type + P2/2 + 436`, keys our cache.
    const key = `derived:${14 * type + Math.trunc(p2 / 2) + 436}`;
    const cache = this.context.graphicCache;
    let base = cache?.get(key) ?? null;
    if (!base) {
      const src = getGraphic(Math.min(type, 2) + 348);
      if (!src) return null;
      const colorMap = type === 3 ? tables.cloudColorMap : IDENTITY_COLOR_MAP;
      base = shrinkBlt(src, src.width, src.height, 2 * halfWidth, height, colorMap);
      cache?.set(key, base);
    }
    return { base, halfWidth, height };
  }

  /**
   * `DrawClouds`' cell under the party (`doc/CSBwin-src/Code51a4.cpp:178-218`): one of
   * graphics 351-359 (48×31), picked by type and `value >> 5`, the poison one recoloured
   * through `d.Byte5712`, laid over `d.Word2530` by `TAG008c98`
   * (`doc/CSBwin-src/Graphics.cpp:1169`), transparent colour 10.
   *
   * `TAG008c98` fills the rectangle 16 pixels at a time, row by row, from the graphic
   * read as one run of 16-pixel groups: it starts at group `STRandom() & 63` and wraps
   * back to group 0 on reaching group `STRandom0_3() + 87`. Both draws are from the
   * viewport's stream. C++ leaves argument evaluation order unspecified; the port takes
   * right to left, the 68000 original's and the x86 compilers' order, so `STRandom()`
   * is drawn first.
   */
  private drawCloudUnderParty(
    d4: number,
    poison: boolean,
    value: number,
    tables: ObjectTables,
    getGraphic: (graphicNum: number) => IndexedBitmap | null
  ): void {
    if (poison) d4--;
    d4 *= 3;
    const d5 = value >> 5;
    if (d5 !== 0) {
      d4++;
      if (d5 > 3) d4++;
    }
    let src = getGraphic(d4 + 351);
    if (!src) return;
    // CSBWin shrinks 48×32 to 48×32 — a pure recolour. The graphics are 48×31, and
    // `GetBasicGraphicAddress(n, 48, 32)` pads the buffer with a garbage row
    // (`doc/CSBwin-src/Graphics.cpp:2560-2570`), which the tiling never reaches: it wraps
    // within 90 groups, 30 rows. Recolouring at the graphic's own size keeps every row.
    if (poison) src = shrinkBlt(src, src.width, src.height, src.width, src.height, tables.cloudColorMap);

    const start = viewportRandom.next() & 63; // P7
    const wrap = viewportRandom.zeroTo3() + 87; // P6

    const rect = tables.cloudUnderPartyRect; // d.Word2530
    const groupsPerRow = Math.trunc((rect.x2 - rect.x1) / 16) + 1; // w_2
    const rows = rect.y2 - rect.y1 + 1;
    const srcGroupsPerRow = (src.width + 15) >> 4;
    const out = new Uint8Array(groupsPerRow * 16 * rows);
    let group = start;
    for (let k = 0; k < groupsPerRow * rows; k++) {
      const srcRow = Math.floor(group / srcGroupsPerRow);
      const srcCol = (group % srcGroupsPerRow) * 16;
      const dstOff = Math.floor(k / groupsPerRow) * groupsPerRow * 16 + (k % groupsPerRow) * 16;
      for (let i = 0; i < 16; i++) {
        const x = srcCol + i;
        out[dstOff + i] = x < src.width && srcRow < src.height ? src.pixels[srcRow * src.width + x] : 0;
      }
      if (++group === wrap) group = 0;
    }
    const derived: IndexedBitmap = { width: groupsPerRow * 16, height: rows, pixels: out };
    this.draw.blitShapeToViewportIndexWithTransparent(derived, { x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2 }, 10);
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
      out = mirror ? this.draw.getMirroredBitmap(src) : src;
    } else {
      const dstWidthBytes = distanceFromUs === 1 ? ((gc.widthBytes * 20 + 10) >> 5) : ((gc.widthBytes * 16 + 8) >> 5);
      const dstHeight = distanceFromUs === 1 ? ((gc.height * 20 + 10) >> 5) : ((gc.height * 16 + 8) >> 5);
      const dstWidth = dstWidthBytes * 2;
      const colorMap = distanceFromUs === 1 ? tables.colorMapMedium : tables.colorMapFar;
      const scaled = shrinkBlt(src, src.width, src.height, dstWidth, dstHeight, colorMap);
      out = mirror ? this.draw.getMirroredBitmap(scaled) : scaled;
    }

    cache?.set(key, out);
    return out;
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
