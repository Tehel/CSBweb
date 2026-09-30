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
import {
  bltShapeToViewportIndex,
  cropBitmap,
  IDENTITY_COLOR_MAP,
  mirrorBitmap,
  shrinkBlt,
  tag0088b2Explicit,
  tag0088b2Index,
  tag008c98Index,
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
import type { CSBGraphicsLoader, ExtendedFloorDecoration } from '../../data/CSBGraphicsLoader';
import { decodeObjectID, DBType, OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../../core/types';
import { CsbRandom } from '../../core/random';
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
  private mirrorCache = new WeakMap<IndexedBitmap, IndexedBitmap>();
  private flipCache = new WeakMap<IndexedBitmap, IndexedBitmap>();
  private removeMortarJoint = true;
  private hasAlcove = 0;
  /** The derived graphics a program allocates, by number (CSBWin `AllocateDerivedGraphic`). */
  private derivedGraphics = new Map<number, Uint8Array>();

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
    this.blitShapeBitmapToViewport(bitmap, rect, mirror);
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
    this.blitShapeBitmapToViewport(tempBitmap, trackTop[6], false);
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
    const rectSet = tables.doorSwitchRectSets[setIndex];
    const srcSet = tables.doorSwitchSourceDescSets[setIndex];
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

    let bitmap = cropBitmap(base, srcWidth, srcHeight);
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

    const graphic = getGraphic(doorGraphicNum);
    if (!graphic) {
      // (skip) StdDrawDoor could not load door graphic ${doorGraphicNum}
      return true;
    }

    const s = doorState | 0;
    if (s === 0) return true; // fully open

    // `StdDrawDoor`: door graphic index 0 is F1, nearness 2 (`doc/CSBwin-src/Viewport.cpp:2594-2598`).
    const nearness = 2 - (doorGraphicIndex | 0);

    // `DrawDoor` copies the door's graphic into `tempBitmap` and draws on the copy
    // (`doc/CSBwin-src/CSBCode.cpp:4151-4154`). The port copies only when an ornament is
    // drawn, and again after a mirror or a flip, whose result is cached and shared.
    let bitmap: IndexedBitmap = graphic;
    let ownBitmap = false;
    const drawOrnament = (ornament: number, near: number) => {
      if (ornament === 0) return; // `TAG004b26` returns at once (`:4002`)
      if (!ownBitmap) {
        bitmap = { width: bitmap.width, height: bitmap.height, pixels: bitmap.pixels.slice() };
        ownBitmap = true;
      }
      this.drawDoorOrnament(bitmap, ornament, near);
    };

    drawOrnament(record.ornateNumber, nearness); // `:4155`

    // A "lightning door" (`d.DoorTOC[doorType] & 0x400`) redraws with a random
    // mirror and a random vertical flip every frame it isn't bashed
    // (`doc/CSBwin-src/CSBCode.cpp:4156-4166`) — CSBWin's cheap energy-field
    // shimmer. `STRandomBool()` there reads whatever stream is currently swapped
    // into `d.RandomNumber`, which `DrawViewport` sets to a viewport-only stream for
    // exactly this reason (`doc/CSBwin-src/Viewport.cpp:6706-6707`) — rendering must
    // never perturb the game's own RNG, so this draws from a dedicated instance.
    const isLightningDoor = ((this.context.doorTOC?.[doorType] ?? 0) & 0x400) !== 0;
    if (isLightningDoor && s !== 5) {
      if (BytecodeInterpreter.viewportRandom.bool()) {
        bitmap = this.getMirroredBitmap(bitmap);
        ownBitmap = false;
      }
      if (BytecodeInterpreter.viewportRandom.bool()) {
        bitmap = this.getFlippedBitmapVertical(bitmap);
        ownBitmap = false;
      }
    }

    // The near door under See-Thru-Walls (`:4168-4174`).
    if ((rectPtr | 0) === StdRectPtr.RECT_StdDoorRectsF1 && this.context.seeThroughWalls) drawOrnament(17, 2);

    const blit = (r: RectPos | undefined) => {
      if (!r) return;
      bltShapeToViewportIndex(bitmap, viewport, r);
    };

    if (s === 4 || s === 5) {
      if (s === 5) drawOrnament(16, nearness); // bashed (`:4184`)
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

  /**
   * `TAG004b26` (`doc/CSBwin-src/CSBCode.cpp:3993-4059`): draws door ornament `ornament`,
   * slot `ornament - 1` of `d.Word2514`, onto `door`, a copy of the door's graphic at
   * `nearness` (0 F3, 1 F2, 2 F1), with colour 9 transparent. At F1 the ornament is its
   * graphic; nearer than that it is shrunk from its F1 size to the rectangle's through
   * `d.Byte4172` (F3) or `d.Byte4188` (F2), the derived graphic `68 + 2*slot + nearness`.
   */
  private drawDoorOrnament(door: IndexedBitmap, ornament: number, nearness: number): void {
    const tables = this.context.objectTables;
    const getGraphic = this.context.getGraphicBitmap;
    const slot = this.context.doorOrnaments?.[ornament - 1];
    if (!tables || !getGraphic || !slot) return;
    const [graphicNum, set] = slot;
    const rect = tables.doorOrnamentRectSets[set][nearness];
    const graphic = getGraphic(graphicNum);
    if (!graphic) return;

    let ornamentBitmap = graphic;
    if (nearness !== 2) {
      const cache = this.context.graphicCache;
      const key = `doorOrnament:${graphicNum}:${set}:${nearness}`;
      const cached = cache?.get(key);
      if (cached) {
        ornamentBitmap = cached;
      } else {
        const size = tables.doorOrnamentRectSets[set][2]; // `Byte5058[18*set]`
        const colorMap = nearness === 0 ? tables.doorOrnamentColorMapF3 : tables.doorOrnamentColorMapF2;
        const cropped = cropBitmap(graphic, 2 * size.widthBytes, size.height);
        ornamentBitmap = shrinkBlt(
          cropped,
          cropped.width,
          cropped.height,
          rect.x2 - rect.x1 + 1,
          rect.height,
          colorMap
        );
        cache?.set(key, ornamentBitmap);
      }
    }

    tag0088b2Index(ornamentBitmap, door, { x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2 }, 9);
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
    this.hasAlcove = this.drawWallDecoration(
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
    this.drawWallText(textRN as ObjectID, wallDecorationDrawLocation | 0, this.removeMortarJoint);
    this.removeMortarJoint = true;
    return true;
  }

  /**
   * `DrawWallDecoration` (`doc/CSBwin-src/CSBCode.cpp:3133`) — the picture frame, and
   * then the champion portrait inside it.
   *
   * The two halves are independent: `PORTRAIT_HideGraphic` leaves `graphicOrdinal` at 0
   * with a portrait still to draw, and every other decoration has no portrait, so
   * CSBWin bails only when *both* are absent (`:3191`) and draws the frame only when
   * `graphicIndex >= 0` (`:3673`).
   */
  private drawWallDecoration(
    graphicOrdinal: number,
    relativePosition: number,
    championPortraitOrdinal = 0,
  ): boolean {
    if (graphicOrdinal === 0 && championPortraitOrdinal === 0) return false;

    const isAlcove = graphicOrdinal !== 0
      ? this.drawWallDecorationGraphic(graphicOrdinal, relativePosition)
      : false;

    // `if (relativePosition == 12)` (`:3685`) — only the wall the party stands against
    // is close enough to show a face.
    if (relativePosition === 12) {
      this.drawChampionPortrait(championPortraitOrdinal);
    }
    return isAlcove;
  }

  /**
   * The frame half of `DrawWallDecoration`: everything under CSBWin's
   * `if (graphicIndex >= 0)`.
   */
  private drawWallDecorationGraphic(graphicOrdinal: number, relativePosition: number): boolean {
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
        const fountainIdx = tables.fountainDecorationIndex;
        this.context.facingWaterFountain = decorationIndex === (fountainIdx | 0);
      }
    }

    if (relativePosition >= 10) {
      const bitmap = mirror ? this.getMirroredBitmap(src) : src;
      bltShapeToViewportIndex(bitmap, viewport, { x1, y1, x2, y2 });
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
    const cropped = cropBitmap(src, widthPixels, heightPixels);

    const scaled = this.scaleIndexedBitmap(cropped, finalBitmapWidth + 1, desc.height | 0, colorMap, mirror);

    // `srcOffsetX` (`doc/CSBwin-src/CSBCode.cpp:3538-3562`). Positions 7 and 9 scale the
    // decoration to the width of the F2 *centre* rectangle (`rectSet[8]`, chosen above),
    // which is wider than the slot they are drawn into, because a decoration at the edge
    // of the screen is only partly visible. Which part depends on the side:
    //
    //   - position 9 (F2 front-right) runs off the *right* edge, so it shows its left
    //     end and the offset is 0;
    //   - position 7 (F2 front-left) runs off the *left* edge, so it must show its
    //     **right** end — CSBWin's "Jst ahead to the left. Truncate graphic" (`:3551`).
    //
    // Without this, position 7 drew its left end into a slot flush against the left
    // border: cropped on the wrong side, and with the transparent margin that should
    // have been off-screen left as a visible gap.
    let srcOffsetX = 0;
    if (relativePosition === 7) {
      srcOffsetX = finalBitmapWidth - ((desc.x2 | 0) - (desc.x1 | 0));
    }
    // CSBWin also sets `srcOffsetX = 15 - (finalBitmapWidth & 15)` for the mirrored
    // far-right sidewalls (positions 1 and 6, `:3536`). That is **not** ported, and
    // deliberately: it compensates for `MakeMirror` reversing a byte-aligned buffer of
    // `pWDP->width` bytes, which leaves the image `ceil16(w) - w` pixels from the left.
    // `getMirroredBitmap` reverses the exact `finalBitmapWidth + 1` bitmap, so ours is
    // already flush at 0 and the same offset would shift it wrongly.

    bltShapeToViewportIndex(scaled, viewport, { x1, y1, x2, y2, srcX: srcOffsetX });
    return isAlcove;
  }

  /**
   * The portrait half of `DrawWallDecoration` (`doc/CSBwin-src/CSBCode.cpp:3686-3716`).
   *
   * `championPortraitOrdinal` is 1-based, so 0 means "no portrait" and the ordinal is
   * decremented to CSBWin's `charID` before use. Graphic 26 is a 256x87 sheet of 32x29
   * cells, 8 per row: `srcX = (charID & 7) << 5`, `srcY = 29 * (charID >> 3)`. The
   * transparent colour is **1**, not the 10 that `BltShapeToViewport` uses, so the
   * mirror's glass shows around the head.
   */
  private drawChampionPortrait(championPortraitOrdinal: number): void {
    if (championPortraitOrdinal === 0) return;
    const charID = (championPortraitOrdinal - 1) | 0;

    const viewport = this.context.viewportIndexBuffer;
    const rect = this.context.championPortraitRect;
    const getGraphic = this.context.getGraphicBitmap;
    if (!viewport || !rect || !getGraphic) return;

    if (charID > 23) {
      // `GetExternalPortraitAddress` (`:3706`) — a CSB dungeon may ship its own
      // portraits outside graphic 26. ⏳ Not supported; the shipped DM dungeon uses
      // charIDs 0..23 only.
      return;
    }

    const sheet = getGraphic(26);
    if (!sheet) return;

    tag0088b2Index(
      sheet,
      viewport,
      {
        x1: rect.x1 | 0,
        y1: rect.y1 | 0,
        x2: rect.x2 | 0,
        y2: rect.y2 | 0,
        srcX: (charID & 7) << 5,
        srcY: 29 * (charID >> 3),
        srcStride: sheet.width,
      },
      1,
    );
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

    const cropped = cropBitmap(srcBitmap, widthPixels, heightPixels);
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

    const textBytes = dungeon.decodeWallTextBytes(rec, tables.textDecode);
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

  /**
   * `GraphicRandom` (`doc/CSBwin-src/CSBCode.cpp:564`) keeps its state in a C
   * function-static, which lives for the whole process rather than one call — the
   * source of the teleporter/energy-effect shimmer is this counter advancing frame
   * over frame, not the caller re-seeding it. `DrawViewport` builds a fresh
   * `BytecodeInterpreter` every redraw, so this has to be a class-static, not an
   * instance field, or every frame would replay the same jitter and the effect
   * would render as a frozen pattern instead of animating.
   */
  private static graphicRandomState = 12345;

  /**
   * `viewportRandom` (`doc/CSBwin-src/Viewport.cpp:6706-6707`): CSBWin saves
   * `d.RandomNumber`, swaps this stream in for the duration of `DrawViewport`, and
   * restores the game's own value afterward, so every `STRandomBool()` a drawing
   * function calls — the lightning door's mirror/flip, for one — reads this and
   * never the sequence monster AI and combat depend on. A class-static for the same
   * reason `graphicRandomState` is: it has to survive past the one
   * `BytecodeInterpreter` that calls it, or every frame would reroll from the same
   * point and the effect would never move.
   */
  private static viewportRandom = new CsbRandom(0x34175432); // `Viewport.cpp:6697`

  /**
   * `r = r * ui32(0xbb40e62d) + 11;` is a 32-bit-wraparound multiply in C — free.
   * JS's `*` operator is not: `state` and `0xbb40e62d` are each up to ~2^32, so their
   * exact product needs up to 64 bits, and a float64 mantissa only holds 53. The
   * plain multiply silently rounds away exactly the low bits `>>> 7 % n` reads,
   * which is why this returned the same value on every call — every state ever
   * reached was a multiple of 4096 after the previous rounding, canceling the
   * `% 32` and `% 2` of the teleporter/energy shimmer's jitter. `Math.imul`
   * truncates to 32 bits *before* rounding, matching the C `ui32` multiply exactly.
   * `DrawTeleporter` is its only caller in CSBWin; clouds use `viewportRandom`.
   */
  private graphicRandom(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    BytecodeInterpreter.graphicRandomState = (Math.imul(BytecodeInterpreter.graphicRandomState, 0xbb40e62d) + 11) >>> 0;
    return ((BytecodeInterpreter.graphicRandomState >>> 7) % maxExclusive) >>> 0;
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
        const cropped = cropBitmap(maskGraphic, width, height);
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
    const scaled = shrinkBlt(src, src.width, src.height, dstWidth, dstHeight, colorMap);
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
    if (mirror) src = this.getMirroredBitmap(src);

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
    this.blitShapeToViewportIndexWithTransparent(src, { x1, y1, x2, y2, srcX, srcY: 0 }, transparentColor);
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

      if (mirror) src = this.getMirroredBitmap(src);
      if (flip) src = this.getFlippedBitmapVertical(src);
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

      this.blitShapeToViewportIndexWithTransparent(src, { x1, y1, x2, y2, srcX: srcX - mirrorPad }, 10);
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
      const flip = BytecodeInterpreter.viewportRandom.bool() !== 0; // w_142 → TAG008840
      const mirror = BytecodeInterpreter.viewportRandom.bool() !== 0; // LOCAL_36 → Mirror
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
      if (mirror) src = this.getMirroredBitmap(src);
      if (flip) src = this.getFlippedBitmapVertical(src);
      this.blitShapeToViewportIndexWithTransparent(src, { x1, y1, x2, y2, srcX: srcX - mirrorPad }, 10);
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

    const start = BytecodeInterpreter.viewportRandom.next() & 63; // P7
    const wrap = BytecodeInterpreter.viewportRandom.zeroTo3() + 87; // P6

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
    this.blitShapeToViewportIndexWithTransparent(derived, { x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2 }, 10);
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
      const scaled = shrinkBlt(src, src.width, src.height, dstWidth, dstHeight, colorMap);
      out = mirror ? this.getMirroredBitmap(scaled) : scaled;
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

  private getMirroredBitmap(src: IndexedBitmap): IndexedBitmap {
    const cached = this.mirrorCache.get(src);
    if (cached) return cached;

    const mirrored = mirrorBitmap(src);
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
