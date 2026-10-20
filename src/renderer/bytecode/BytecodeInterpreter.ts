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
import { ApplyBackground, ApplyDecoration, ViewportBMP } from './ApplyBackground';
import { readU16LE, readU32LE } from '../../core/bytes';
import {
  tag0088b2Explicit,
  type IndexedBitmap,
  type PaletteIndexViewportBuffer
} from '../csbwin/CanvasBlitter';
import type { AltMonCache } from '../../data/AltMonGraphics';
import { Die } from '../../engine/Die';
import type { DungeonState } from '../../engine/DungeonState';
import type { PartyFootprints } from '../../engine/PartyFootprints';
import type { GameState } from '../../engine/gameTypes';
import type { MonsterDesignOptions } from '../../engine/MonsterSystem';
import type { ObjectTables } from '../../data/tables/ObjectTables';
import type { RectPos } from '../../data/tables/UITables';
import type { CSBGraphicsLoader } from '../../data/CSBGraphicsLoader';
import type { BackgroundLib } from '../../data/BackgroundLib';
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
   * `doc/CSBwin-src/Code51a4.cpp:2774`). Only `_FusionSequence` sets it (`Attack.cpp:2369`).
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
  /**
   * `altMonCache`: the alternate monster graphics `DrawMonster` has read from `csbGraphics`,
   * and the pictures derived from them. Emptied at each game's start (`CleanupAltMonCache`).
   */
  altMonCache?: AltMonCache;
  /**
   * `backgroundLib`: the `CGT_Backgrounds` sections of `csbGraphics` a skin's program draws
   * with. Emptied at each game's start, with `altMonCache` (`CleanupGraphics`,
   * `doc/CSBwin-src/Graphics.cpp:2230-2232`).
   */
  backgroundLib?: BackgroundLib;
  dungeonState?: DungeonState;
  /**
   * The square and facing `DrawViewport` draws from: `IsOdd` reads them as `d.partyLevel`,
   * `d.partyX`, `d.partyY` and `d.partyFacing` (`doc/CSBwin-src/Viewport.cpp:3192`). They
   * are the party's everywhere but in the prison, where nothing is skinned.
   */
  viewParty?: { x: number; y: number; z: number; facing: number };
  /**
   * CSBWin's graphic trace (`GTRACE_*`, on while `traceViewportDrawing` is set): the lines
   * a skin's drawing writes. Absent, as in a game, nothing is traced.
   */
  graphicTrace?: (line: string) => void;
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
   * (302), are set once (`doc/CSBwin-src/CSBCode.cpp:10375-10386`), and the level's own
   * from its `DoorDecorationTOC` (`Code390e.cpp:275-284`), which leaves any slot past
   * the level's count as the last level to fill it left it.
   */
  doorOrnaments?: Array<[number, number]>;
  /**
   * `d.LoadedFloorDecorations[16][2]`: per floor decoration, its first graphic and its
   * rectangle set (`d.Byte4110`). Slot 15, the footprints (graphic 241, set 1), is set
   * once (`doc/CSBwin-src/CSBCode.cpp:10394-10397`), and the level's own from its
   * `FloorDecorationTOC` (`Code390e.cpp:263-274`), at most fifteen of them.
   */
  loadedFloorDecorations?: Array<[number, number]>;
  numWallDecoration?: number; // d.NumWallDecoration (CSBCode.cpp:5863)
  useMirrorImages?: boolean; // d.UseMirrorImages (Viewport.cpp:6747)

  viewportIndexBuffer?: PaletteIndexViewportBuffer;
  seeThroughWalls?: boolean; // d.SeeThruWalls (Viewport.cpp:2646)
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
 * CSBWin's `stack` and `rstack` (`doc/CSBwin-src/Viewport.cpp:2215-2247`): static rings of
 * 256 words, each indexed by a byte that `push` decrements first. They are kept from one
 * `Interpret` to the next, and a program that pops more than it pushed reads what an
 * earlier one left. `pop` and `rpop` return an `i16`; `popRN` reads the word unsigned.
 */
const stack = new Uint16Array(256);
const rstack = new Uint16Array(256);
let sp = 0;
let rsp = 0;

function pop(): number {
  const v = stack[sp]!;
  sp = (sp + 1) & 0xff;
  return (v << 16) >> 16;
}

/** `push(i32 v)`: `stack[--sp] = (i16)v`, the low sixteen bits. */
function push(v: number): void {
  sp = (sp - 1) & 0xff;
  stack[sp] = v;
}

/**
 * `popRN` (`Viewport.cpp:2249-2258`): the word, unsigned. CSBWin checks it with
 * `checkIndirectIndex`; the port passes it on unchecked.
 */
function popRN(): ObjectID {
  const n = stack[sp]!;
  sp = (sp + 1) & 0xff;
  return n as ObjectID;
}

function rpop(): number {
  const v = rstack[rsp]!;
  rsp = (rsp + 1) & 0xff;
  return (v << 16) >> 16;
}

function rpush(v: number): void {
  rsp = (rsp - 1) & 0xff;
  rstack[rsp] = v;
}

/** `(i16)n`: a word of the code read as a signed jump. */
function i16(n: number): number {
  return (n << 16) >> 16;
}

/** The two rings' indexes, `sp` and `rsp`, for the tools that check a program leaves them as it found them. */
export function interpreterStackPointers(): { sp: number; rsp: number } {
  return { sp, rsp };
}

/** The data stack's top `n` words as `pop` reads them, the top first, for the tools. */
export function interpreterStackTop(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (stack[(sp + i) & 0xff]! << 16) >> 16);
}

/**
 * Bytecode interpreter - direct port from CSBWin Viewport.cpp
 *
 * This function executes a bytecode program by iterating through
 * the opcode array and dispatching to handler functions.
 */
/** The most opcodes one `Interpret` runs before it takes its program for one that never returns. */
const INTERPRET_STEP_BUDGET = 1 << 20;

export class BytecodeInterpreter {
  private context: InterpreterContext;
  private pc: number = 0;  // Program counter
  private program: ArrayLike<number> = [];
  /** `cellNum`, the cell `Interpret` draws. */
  private cellNum = 0;
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
   * `Interpret` (`doc/CSBwin-src/Viewport.cpp:2425-2474`, `:3299-3308`): `code` run from
   * word `startAddr` until a `Return` pops the `0xffff` it pushes first. A word below 60000
   * calls a subroutine at that address, its return address on `rstack`. A standard
   * program starts at 0; a skin's is the words of its section (`DrawViewport`). One that
   * has not returned after `INTERPRET_STEP_BUDGET` opcodes, as a skin's that jumps to
   * itself never does, ends in `die`, where CSBWin's never returns.
   */
  public interpret(code: ArrayLike<number>, startAddr: number, cellNum: number): void {
    this.program = code;
    this.pc = startAddr;
    this.cellNum = cellNum;
    this.removeMortarJoint = true;
    this.hasAlcove = 0;
    rpush(0xffff);

    for (let steps = 0; ; steps++) {
      if (steps === INTERPRET_STEP_BUDGET) {
        throw new Die(0, `The viewport program for cell ${cellNum} ran ${steps} opcodes without returning.`);
      }
      // CSBWin reads on past the code's end; the port stops there.
      if (this.pc >= this.program.length) return;
      const opcode = this.program[this.pc]!;
      this.pc++;

      if (!this.executeOpcode(opcode)) return;
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
        push(this.context.seeThroughWalls ? 1 : 0);
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

      // See-Thru-Walls through the F1 wall (Viewport.cpp:2964-3023).
      case Opcode.StdAllocateDerivedGraphic:
        this.allocateDerivedGraphic(pop());
        return true;
      case Opcode.StdBitmapViewport:
        push(StdBitmapPtr.BMP_StdBitmapViewport);
        return true;
      case Opcode.StdSeeThruWallsRect:
        push(StdRectPtr.RECT_StdSeeThruWallsRect);
        return true;
      case Opcode.StdSeeThruWallsRect2:
        push(StdRectPtr.RECT_StdSeeThruWallsRect2);
        return true;
      case Opcode.StdSeeThruWallsRectUByte4:
        push(this.context.seeThruWallsRectUByte4 ?? 0);
        return true;
      case Opcode.StdSeeThruWallsRectUByte6:
        push(this.context.seeThruWallsRectUByte6 ?? 0);
        return true;
      case Opcode.MinusOne:
        push(-1);
        return true;
      case Opcode.Zero:
        push(0);
        return true;
      case Opcode.StdBltToDerivedGraphic:
        return this.opStdBltDerivedGraphic(true);
      case Opcode.StdBltFromDerivedGraphic:
        return this.opStdBltDerivedGraphic(false);
      case Opcode.StdDeleteDerivedGraphic:
        this.derivedGraphics.delete(pop());
        // CSBWin's case has no `break` and falls into `StdHoleInWallBitmap` (Viewport.cpp:3022-3023).
        push(StdBitmapPtr.BMP_StdHoleInWallBitmap);
        return true;
      case Opcode.StdHoleInWallBitmap:
        push(StdBitmapPtr.BMP_StdHoleInWallBitmap);
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

      case Opcode.ToR:
        rpush(pop());
        return true;
      case Opcode.RTo:
        push(rpop());
        return true;
      case Opcode.CurrentSkin:
      case Opcode.SkinNumber:
      case Opcode.CurrentCell:
      case Opcode.WallGraphicID:
      case Opcode.FloorGraphicID:
      case Opcode.MiddleGraphicID:
      case Opcode.CeilingGraphicID:
      case Opcode.WallMaskID:
      case Opcode.FloorMaskID:
      case Opcode.MiddleMaskID:
      case Opcode.CeilingMaskID:
      case Opcode.WallDecorationID:
        return this.opSkinQuery(opcode);
      case Opcode.DrawCustomGraphic:
      case Opcode.CreateVirtualBitmap:
      case Opcode.DrawCustomDecoration:
      case Opcode.CreateVirtualMask:
      case Opcode.CreateVirtualAffineMask:
        return this.opCustomGraphic(opcode);
      case Opcode.GetMaskHeader:
      case Opcode.NeedVirtualMaskQ:
      case Opcode.BitmapInfo:
        return this.opBackgroundQuery(opcode);
      case Opcode.SWAP:
      case Opcode.DROP:
      case Opcode.TwoDrop:
      case Opcode.OVER:
      case Opcode.ROT:
      case Opcode.DUP:
      case Opcode.TwoDup:
      case Opcode.QuestionDUP:
      case Opcode.PICK:
      case Opcode.ROLL:
      case Opcode.PLUS:
      case Opcode.MINUS:
      case Opcode.GEAR:
      case Opcode.SLASH:
      case Opcode.EQUAL:
      case Opcode.LESS:
      case Opcode.GREATER:
      case Opcode.ULESS:
      case Opcode.ZEROEQUAL:
      case Opcode.NOT:
      case Opcode.ZEROLESS:
      case Opcode.ZEROGREATER:
      case Opcode.AND:
      case Opcode.OR:
      case Opcode.LSHIFT:
      case Opcode.IsOdd:
        return this.opStackWord(opcode);

      default:
        if (opcode < 60000) {
          rpush(this.pc);
          this.pc = opcode;
          return true;
        }
        // `InterpretError("Unknown display opcode...")`, and `Interpret` returns.
        console.warn(`WARNING: Unimplemented opcode ${opcode}`);
        return false;
    }
  }

  // ============================================================
  // OPCODE HANDLERS
  // ============================================================

  /** `Return` (`Viewport.cpp:3024-3028`): back to the caller, or out at the sentinel. */
  private opReturn(): boolean {
    const raddr = rpop() & 0xffff;
    if (raddr === 0xffff) return false;
    this.pc = raddr;
    return true;
  }

  /**
   * The skin's queries (`doc/CSBwin-src/Viewport.cpp:3035-3069`): the cell's skin, another
   * cell's, the cell's number, and the IDs of the skin's definition. A skin number is
   * popped as an `i16` and passed as a `ui32`.
   */
  private opSkinQuery(opcode: number): boolean {
    const roomData = this.context.roomData;
    const lib = this.context.backgroundLib;
    switch (opcode) {
      case Opcode.CurrentSkin:
        push(roomData[this.cellNum]!.skinNumber);
        break;
      case Opcode.SkinNumber: {
        // CSBWin indexes `roomData[21]` with whatever was popped; past it the port reads 0.
        const relativeCell = pop();
        push(roomData[relativeCell]?.skinNumber ?? 0);
        break;
      }
      case Opcode.CurrentCell:
        push(roomData[this.cellNum]!.relativeCellNumber);
        break;
      case Opcode.WallGraphicID:
        push(lib?.GetWallGraphicID(pop() >>> 0) ?? 0);
        break;
      case Opcode.FloorGraphicID:
        push(lib?.GetFloorGraphicID(pop() >>> 0) ?? 0);
        break;
      case Opcode.MiddleGraphicID:
        push(lib?.GetMiddleGraphicID(pop() >>> 0) ?? 0);
        break;
      case Opcode.CeilingGraphicID:
        push(lib?.GetCeilingGraphicID(pop() >>> 0) ?? 0);
        break;
      case Opcode.WallMaskID:
        push(lib?.GetWallMaskID(pop() >>> 0) ?? 0);
        break;
      case Opcode.FloorMaskID:
        push(lib?.GetFloorMaskID(pop() >>> 0) ?? 0);
        break;
      case Opcode.MiddleMaskID:
        push(lib?.GetMiddleMaskID(pop() >>> 0) ?? 0);
        break;
      case Opcode.CeilingMaskID:
        push(lib?.GetCeilingMaskID(pop() >>> 0) ?? 0);
        break;
      case Opcode.WallDecorationID: {
        const wallDecorationNum = pop();
        const skinNum = pop();
        push(lib?.GetWallDecorationID(skinNum >>> 0, wallDecorationNum >>> 0) ?? 0);
        break;
      }
    }
    return true;
  }

  /**
   * What a skin's program draws and makes (`Viewport.cpp:3070-3122`, `:3212-3284`).
   * `DrawCustomGraphic` and `DrawCustomDecoration` draw their graphic into the viewport
   * (`ApplyBackground.ts`). The three virtual graphics make a bitmap or a mask in the
   * background library, which the program draws with afterwards, or a transform a
   * `CreateVirtualBitmap` reads (`BackgroundLib`, `CustomBitmap.ts`). CSBWin's `_DEBUG`
   * build also writes each virtual graphic to a file, which the port does not.
   */
  private opCustomGraphic(opcode: number): boolean {
    const trace = this.context.graphicTrace;
    const lib = this.context.backgroundLib;
    switch (opcode) {
      case Opcode.DrawCustomGraphic: {
        const maskNumber = pop();
        const maskID = pop();
        const graphicID = pop();
        const pMask = lib?.GetMask(maskID >>> 0, maskNumber >>> 0, 12) ?? null;
        const pGraphic = lib?.GetBitmap(graphicID >>> 0, 2) ?? null;
        this.applyToViewport((bmp) => ApplyBackground(bmp, pMask, pGraphic?.data ?? null, pGraphic?.bitmapSize ?? 0));
        trace?.(`   DrawCustomGraphic(${graphicID}, ${maskID}, ${maskNumber})`);
        if (pMask !== null) {
          const header = (i: number): number => readU16LE(pMask.data, pMask.offset + 2 * i);
          trace?.(`    dstX=${(header(2) << 16) >> 16}, dstY=${header(3)}, width=${header(4)}, height=${header(5)}`);
        }
        break;
      }
      case Opcode.CreateVirtualBitmap: {
        const maskNumber = pop();
        const maskID = pop();
        const virtualGraphicID = pop();
        const graphicID = pop();
        trace?.(`  CreateVirtualBitmap(${graphicID}, ${virtualGraphicID}, ${maskID}, ${maskNumber}`);
        const pGraphic = lib?.GetBitmap(graphicID >>> 0, 2) ?? null;
        if (pGraphic === null) break; // do nothing
        const pAffineMask = lib!.GetMask(maskID >>> 0, maskNumber >>> 0, 48);
        if (pAffineMask === null) break; // do nothing
        lib!.CreateVirtualBitmap(pGraphic.data, pGraphic.bitmapSize, virtualGraphicID >>> 0, pAffineMask);
        break;
      }
      case Opcode.DrawCustomDecoration: {
        const locationNumber = pop();
        const decorationNumber = pop();
        const decorationID = pop();
        const decoration = lib?.GetDecorationBitmap(decorationID >>> 0, decorationNumber >>> 0, locationNumber >>> 0) ?? null;
        if (decoration === null) break;
        this.applyToViewport((bmp) => ApplyDecoration(bmp, decoration.bitmap, decoration.location, decoration.bitmapSize));
        break;
      }
      case Opcode.CreateVirtualMask: {
        const newMaskNumber = pop();
        const newMaskID = pop();
        const Cyc = pop();
        const Cyy = pop();
        const Cyx = pop();
        const Cxc = pop();
        const Cxy = pop();
        const Cxx = pop();
        // `BACKGROUND_MASK`'s words: `ui16`s, and `dstX` an `i16`.
        const height = pop() & 0xffff;
        const width = pop() & 0xffff;
        const dstY = pop() & 0xffff;
        const dstX = pop();
        const srcY = pop() & 0xffff;
        const srcX = pop() & 0xffff;
        const bMask = { srcX, srcY, dstX, dstY, width, height };
        const aMask = { Cxx, Cxy, Cxc, Cyx, Cyy, Cyc, srcX: 0, srcY: 0, srcWidth: 0, srcHeight: 0, dstWidth: 0, dstHeight: 0 };
        const oldMaskNumber = pop();
        const oldMaskID = pop();
        trace?.(`CreateVirtualMask(${oldMaskID}, ${oldMaskNumber}, bmask, amask, ${newMaskID}, ${newMaskNumber}`);
        trace?.(`   bMask = ${srcX} ${srcY} ${dstX} ${dstY} ${width} ${height}`);
        trace?.(`   aMask = ${Cxx} ${Cxy} ${Cxc} ${Cyx} ${Cyy} ${Cyc}`);
        if (width <= 0) break;
        if ((width & 15) !== 0) break;
        if (!lib) break;
        const pNewMask = lib.CreateNewMask(newMaskID >>> 0, newMaskNumber >>> 0, bMask);
        if (pNewMask === null) break;
        const pOldMask = lib.GetMask(oldMaskID >>> 0, oldMaskNumber >>> 0, 6);
        if (pOldMask === null) break;
        lib.CreateVirtualMask(pOldMask, pNewMask, aMask);
        break;
      }
      case Opcode.CreateVirtualAffineMask: {
        const newMaskNumber = pop();
        const newMaskID = pop();
        const dstHeight = pop();
        const dstWidth = pop();
        const srcHeight = pop();
        const srcWidth = pop();
        const srcY = pop();
        const srcX = pop();
        const Cyc = pop();
        const Cyy = pop();
        const Cyx = pop();
        const Cxc = pop();
        const Cxy = pop();
        const Cxx = pop();
        const aMask = { Cxx, Cxy, Cxc, Cyx, Cyy, Cyc, srcX, srcY, srcWidth, srcHeight, dstWidth, dstHeight };
        trace?.(`CreateVirtualAffineMask (aMask, ${newMaskID} ${newMaskNumber}`);
        trace?.(`    aMask = ${Cxx} ${Cxy} ${Cxc} ${Cyx} ${Cyy} ${Cyc} ${srcX} ${srcY} ${srcWidth} ${srcHeight} ${dstWidth} ${dstHeight}`);
        if (dstWidth <= 0) break;
        if ((dstWidth & 15) !== 0) break;
        lib?.CreateNewAffineMask(newMaskID >>> 0, newMaskNumber >>> 0, aMask);
        break;
      }
    }
    return true;
  }

  /** Runs a drawing on the viewport as CSBWin's `d.pViewportBMP` bytes, and writes them back. */
  private applyToViewport(draw: (viewportBMP: ViewportBMP) => void): void {
    const viewport = this.context.viewportIndexBuffer;
    if (!viewport) return;
    const viewportBMP = new ViewportBMP(viewport);
    draw(viewportBMP);
    viewportBMP.flush();
  }

  /**
   * What a skin's program reads of the background library (`Viewport.cpp:3194-3205`,
   * `:3212-3215`, `:3285-3297`): a mask's header, whether a mask is missing, and a
   * bitmap's size.
   */
  private opBackgroundQuery(opcode: number): boolean {
    const lib = this.context.backgroundLib;
    switch (opcode) {
      case Opcode.GetMaskHeader: {
        const maskNumber = pop();
        const maskID = pop();
        const pMask = lib?.GetMask(maskID >>> 0, maskNumber >>> 0, 12) ?? null;
        if (pMask === null) break;
        // `BACKGROUND_MASK` (`CSB.h:330-339`): srcX, srcY, dstX, dstY, width, height.
        for (let i = 0; i < 6; i++) push(readU16LE(pMask.data, pMask.offset + 2 * i));
        break;
      }
      case Opcode.NeedVirtualMaskQ: {
        const maskNumber = pop();
        const maskID = pop();
        const pMask = lib?.MaskExists(maskID >>> 0, maskNumber >>> 0) ?? null;
        push(pMask === null ? 1 : 0);
        break;
      }
      case Opcode.BitmapInfo: {
        let width = 0;
        let height = 0;
        const graphicID = pop();
        const pGraphic = lib?.GetBitmap(graphicID >>> 0, 4) ?? null;
        if (pGraphic !== null) {
          width = readU32LE(pGraphic.data, 0);
          // A width of 0 divides by zero in CSBWin; the port leaves the height 0.
          if (width !== 0) height = Math.floor(((pGraphic.bitmapSize - 1) * 8) / width);
        }
        push(width);
        push(height);
        break;
      }
    }
    return true;
  }

  /** The stack words (`Viewport.cpp:3123-3193`), on the ring itself where CSBWin works on it. */
  private opStackWord(opcode: number): boolean {
    let n: number;
    let temp: number;
    switch (opcode) {
      case Opcode.SWAP:
        temp = stack[sp]!;
        stack[sp] = stack[(sp + 1) & 0xff]!;
        stack[(sp + 1) & 0xff] = temp;
        break;
      case Opcode.DROP:
        sp = (sp + 1) & 0xff;
        break;
      case Opcode.TwoDrop:
        sp = (sp + 2) & 0xff;
        break;
      case Opcode.OVER:
        push(stack[(sp + 1) & 0xff]!);
        break;
      case Opcode.ROT:
        temp = stack[(sp + 2) & 0xff]!;
        stack[(sp + 2) & 0xff] = stack[(sp + 1) & 0xff]!;
        stack[(sp + 1) & 0xff] = stack[sp]!;
        stack[sp] = temp;
        break;
      case Opcode.DUP:
        push(stack[sp]!);
        break;
      case Opcode.TwoDup:
        push(stack[(sp + 1) & 0xff]!);
        push(stack[(sp + 1) & 0xff]!);
        break;
      case Opcode.QuestionDUP:
        if (stack[sp] !== 0) push(stack[sp]!);
        break;
      case Opcode.PICK:
        temp = stack[sp]!;
        stack[sp] = stack[(sp + temp) & 0xff]!;
        break;
      case Opcode.ROLL:
        n = pop() - 1;
        temp = stack[(sp + n) & 0xff]!;
        for (let x = n; x > 0; x--) stack[(sp + x) & 0xff] = stack[(sp + x - 1) & 0xff]!;
        stack[sp] = temp;
        break;
      case Opcode.PLUS:
        push(pop() + pop());
        break;
      case Opcode.MINUS:
        n = pop();
        push(pop() - n);
        break;
      case Opcode.GEAR:
        push(pop() * pop());
        break;
      case Opcode.SLASH:
        // C's division, toward zero. By zero CSBWin faults; the port pushes 0.
        n = pop();
        push(Math.trunc(pop() / n));
        break;
      case Opcode.EQUAL:
        push(pop() === pop() ? 1 : 0);
        break;
      case Opcode.LESS:
        n = pop();
        push(n < pop() ? 1 : 0);
        break;
      case Opcode.GREATER:
        n = pop();
        push(n > pop() ? 1 : 0);
        break;
      case Opcode.ULESS:
        n = pop();
        push((n >>> 0) < (pop() >>> 0) ? 1 : 0);
        break;
      case Opcode.ZEROEQUAL:
      case Opcode.NOT:
        push(pop() === 0 ? 1 : 0);
        break;
      case Opcode.ZEROLESS:
        push(pop() < 0 ? 1 : 0);
        break;
      case Opcode.ZEROGREATER:
        push(pop() > 0 ? 1 : 0);
        break;
      case Opcode.AND:
        push(pop() & pop());
        break;
      case Opcode.OR:
        push(pop() | pop());
        break;
      case Opcode.LSHIFT:
        n = pop();
        push(pop() << n);
        break;
      case Opcode.IsOdd: {
        // `d.partyLevel + d.partyX + d.partyY + d.partyFacing`: the view's square and facing.
        const party = this.context.viewParty;
        push(party ? (party.z + party.x + party.y + party.facing) & 1 : 0);
        break;
      }
    }
    return true;
  }

  private opStdBltShape(): boolean {
    // CSBWin: pop rectangle pointer, pop bitmap pointer, then blit with transparentColor=10.
    const rectanglePtr = pop();
    const bitmapPtr = pop();

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
    const condition = pop();
    // Next value is jump offset
    const offset = i16(this.program[this.pc]!);
    this.pc++;

    if (condition === 0) {
      // -> Jumping ${offset} instructions
      this.pc += offset;
    }

    return true;
  }

  private opJumpNZ(): boolean {
    const condition = pop();
    const offset = i16(this.program[this.pc]!);
    this.pc++;

    if (condition !== 0) {
      // -> Jumping ${offset} instructions
      this.pc += offset;
    }

    return true;
  }

  private opJump(): boolean {
    const offset = i16(this.program[this.pc]!);
    this.pc++;

    // -> Jumping ${offset} instructions
    this.pc += offset;
    return true;
  }

  private opLiteral(): boolean {
    // Next value is the literal to push
    const value = this.program[this.pc]!;
    this.pc++;

    // Literal(${value})
    push(value);

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
    push(ptr);
    return true;
  }

  private opWallRectangle(opcode: number): boolean {
    // Push CSBWin RECT_POINTERS value (resolved later by StdRectanglePointers)
    const rectPtr = this.getStdWallRectanglePointer(opcode);
    // WallRectanglePtr[${rectPtr}]
    push(rectPtr);
    return true;
  }

  private opStdBltShapeToViewport(mirror: boolean): boolean {
    // CSBWin StdBltShapeToViewport / StdMirrorShapeToViewport (Viewport.cpp:2856-2866)
    const rectanglePtr = pop();
    const bitmapPtr = pop();
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
    // CSBWin StdGraphicToViewport / StdMirrorGraphicToViewport (Viewport.cpp:2906-2915)
    const rectanglePtr = pop();
    const graphicNum = pop();
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
    // CSBWin `GetDecoration0` (Viewport.cpp:2882-2885)
    const relativeCell = pop();
    const v = this.context.roomData[relativeCell]?.decorations[0] ?? 0;
    // GetDecoration0(cell=${relativeCell}) -> ${v}
    push(v);
    return true;
  }

  private opCellNumber(opcode: number): boolean {
    const cell = this.relativeCellFromCellOpcode(opcode);
    // CellNumber(${Opcode[opcode]}) -> ${cell}
    push(cell);
    return true;
  }

  private opCondition(opcode: number): boolean {
    if (opcode === Opcode.Alcove) {
      // CSBWin uses the last StdDrawWallDecoration result (Viewport.cpp:2953).
      push(this.hasAlcove ? 1 : 0);
      return true;
    }
    // Condition(${Opcode[opcode]}) -> 0
    push(0);
    return true;
  }

  private opWallDecorationPos(opcode: number): boolean {
    // CSBWin Viewport.cpp:2648-2650
    const v = opcode === Opcode.wallDecorationFront ? 1 : opcode === Opcode.wallDecorationLeft ? 2 : 0;
    // WallDecorationPos(${Opcode[opcode]}) -> ${v}
    push(v);
    return true;
  }

  private opHasDecoration(): boolean {
    // CSBWin Viewport.cpp:2640-2644
    const wallDecorationPos = pop();
    const relativeCell = pop();
    const cell = this.context.roomData[relativeCell];
    const has = cell ? (cell.decorations[wallDecorationPos as 0 | 1 | 2] !== 0 ? 1 : 0) : 0;
    // HasDecoration(cell=${relativeCell}, pos=${wallDecorationPos}) -> ${has}
    push(has);
    return true;
  }

  private opDoorSwitch(): boolean {
    const relativeCell = pop();
    const doorIndex = this.context.roomData[relativeCell | 0]?.decorations[1] ?? 0;
    const dungeon = this.context.dungeonState;
    if (!dungeon) {
      push(0);
      return true;
    }
    const rec = dungeon.getDoorRecordByIndex(doorIndex | 0);
    const hasSwitch = rec?.hasButton ? 1 : 0;
    push(hasSwitch);
    return true;
  }

  private opFloorDecorationGraphicOrdinal(opcode: number): boolean {
    const cell = this.relativeCellFromFloorDecorationOpcode(opcode);
    const v = this.context.roomData[cell]?.decorations[2] ?? 0;
    // FloorDecorationGraphicOrdinal(${Opcode[opcode]}) cell=${cell} -> ${v}
    push(v);
    return true;
  }

  private opStdDrawFloorDecoration(): boolean {
    // CSBWin StdDrawFloorDecoration: (relativeCell floorGraphicOrdinal ...)
    const floorGraphicOrdinal = pop();
    const relativeCell = pop();

    const floorCell = BytecodeInterpreter.floorDrawingLocations[relativeCell | 0] ?? 0;
    DrawFloorDecorations(this.draw, floorGraphicOrdinal | 0, floorCell | 0);
    return true;
  }

  private opStdDrawCeilingPit(): boolean {
    const mapY = pop();
    const mapX = pop();
    const relCellRF = pop();

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
   * CSBWin `AllocateDerivedGraphic` (`doc/CSBwin-src/CSBCode.cpp:11446`): a buffer of
   * `GetDerivedGraphicSize(n)` bytes, kept if it already exists. Graphic 1, the only one a
   * program allocates, is 4560 bytes (`CSBCode.cpp:10372`), 96x95 pixels.
   */
  private allocateDerivedGraphic(graphicNum: number): void {
    if (this.derivedGraphics.has(graphicNum)) return;
    const bytes = graphicNum === 1 ? 4560 : 0;
    this.derivedGraphics.set(graphicNum, new Uint8Array(bytes * 2));
  }

  /**
   * CSBWin `StdBltToDerivedGraphic` / `StdBltFromDerivedGraphic` (Viewport.cpp:2972-3021):
   * `TAG0088b2` between a standard bitmap and a derived graphic, every argument off the stack.
   */
  private opStdBltDerivedGraphic(toDerived: boolean): boolean {
    const xparentColor = pop();
    const dstWidth = pop();
    const srcWidth = pop();
    const srcY = pop();
    const srcX = pop();
    const pDstRect = this.resolveStdRectanglePointer(pop());
    const dstPtr = pop();
    const srcPtr = pop();
    const dst = toDerived ? this.derivedGraphics.get(dstPtr) : this.resolveStdBitmapPointer(dstPtr)?.pixels;
    const src = toDerived ? this.resolveStdBitmapPointer(srcPtr)?.pixels : this.derivedGraphics.get(srcPtr);
    if (!src || !dst || !pDstRect || Array.isArray(pDstRect)) return true;
    tag0088b2Explicit(src, dst, pDstRect, srcX, srcY, srcWidth, dstWidth, xparentColor);
    return true;
  }

  /**
   * CSBWin `StdDrawSeeThruDoorEdge` (`doc/CSBwin-src/Viewport.cpp:2583-2594`): the door edge
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
    // CSBWin `StdDrawDoorSwitch` (Viewport.cpp:2893-2896)
    const distance = pop();
    const switchId = pop();

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
    const drawOrder = pop();
    const relCellRF = pop();
    const mapY = pop();
    const mapX = pop();
    const firstObject = popRN();

    const facing = this.context.frameFacing ?? 0;
    const idx = relCellRF | 0;
    const relativeCell = BytecodeInterpreter.objectDrawingLocations[idx] ?? 0;

    // StdDrawRoomObjects(first=${firstObject}, x=${mapX}, y=${mapY}, rf=${relCellRF} -> rel=${relativeCell}, drawOrder=0x${drawOrder.toString(16)})
    DrawRoomObjects(this.draw, firstObject, facing, mapX | 0, mapY | 0, relativeCell | 0, drawOrder | 0);
    return true;
  }

  private opStdDrawTeleporter(): boolean {
    // CSBWin `StdDrawTeleporter` (Viewport.cpp:2898-2903)
    const wallRectPtr = pop();
    const teleporterRectPtr = pop();

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
    // CSBWin `StdDrawDoor` (Viewport.cpp:2596-2617)
    const rectPtr = pop();
    const doorGraphicIndex = pop();
    const doorState = pop();
    const doorRecordIndex = pop();

    const rectRef = this.resolveStdRectanglePointer(rectPtr);
    if (!rectRef || !Array.isArray(rectRef)) {
      // ERROR: StdDrawDoor - expected door rect array from rectPtr=${rectPtr}
      return true;
    }

    // `d.DoorGraphic[doorGraphicIndex]`; index 0 is F1, nearness 2 (`doc/CSBwin-src/Viewport.cpp:2598-2605`).
    const graphicIndex = doorGraphicIndex | 0;
    DrawDoor(this.draw, doorRecordIndex | 0, doorState | 0, this.context.doorGraphics?.[graphicIndex], 2 - graphicIndex, rectRef);
    return true;
  }

  private opStdDrawWallDecoration(): boolean {
    // CSBWin `StdDrawWallDecoration` (Viewport.cpp:2949-2956)
    const wallDecorationDrawLocation = pop();
    const wallDecorationPos = pop();
    const relativeCell = pop();

    const rd = this.context.roomData[relativeCell | 0];
    const graphicOrdinal = rd?.decorations[(wallDecorationPos as 0 | 1 | 2) ?? 0] ?? 0;
    // CSBWin passes the cell's `championPortraitOrdinal` as the fourth argument
    // (`doc/CSBwin-src/Viewport.cpp:2953-2957`); `SummarizeRoomInfo` set it from the
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
    // CSBWin `StdDrawWallText` (Viewport.cpp:2937-2947)
    const wallDecorationDrawLocation = pop();
    const wallDecorationPos = pop();
    const relativeCell = pop();

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

  /** Public so that `tools/` can stand in fixed rectangles for a context without them. */
  resolveStdRectanglePointer(ptr: number): RectPos | RectPos[] | null {
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
    push(rectPtr);
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
    push(rectPtr);
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
    push(rectPtr);
    return true;
  }

  private opStairGraphic(opcode: number): boolean {
    // Port from CSBWin Viewport.cpp:2737-2757 and Code390e.cpp:117-127.
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
    push(graphicIndex);
    return true;
  }

  private opStairEdgeGraphic(opcode: number): boolean {
    // Port from CSBWin Viewport.cpp:2807-2814 and Code390e.cpp:117-127.
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
    push(graphicIndex);
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
    push(rectPtr);
    return true;
  }

  private opDoorBitmap(opcode: number): boolean {
    // Push CSBWin BITMAP_POINTERS value (Viewport.cpp:2837-2846).
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
    push(ptr);
    return true;
  }

  private opDoorRecordIndex(opcode: number): boolean {
    const cell = this.relativeCellFromDoorOpcode(opcode);
    const v = this.context.roomData[cell]?.decorations[1] ?? 0;
    // DoorRecordIndex(${Opcode[opcode]}) cell=${cell} -> ${v}
    push(v);
    return true;
  }

  private opDoorState(opcode: number): boolean {
    const cell = this.relativeCellFromDoorOpcode(opcode);
    const v = this.context.roomData[cell]?.decorations[0] ?? 0;
    // DoorState(${Opcode[opcode]}) cell=${cell} -> ${v}
    push(v);
    return true;
  }

  private opDoorGraphics(opcode: number): boolean {
    // CSBWin Viewport.cpp:2568-2570
    const graphicsIndex =
      opcode === Opcode.StdDoorGraphicsF3 ? 2 : opcode === Opcode.StdDoorGraphicsF2 ? 1 : 0;
    // DoorGraphics(${Opcode[opcode]})[${graphicsIndex}]
    push(graphicsIndex);
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
    push(rectPtr);
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
    push(rectPtr);
    return true;
  }

  private opDrawOrder(opcode: number): boolean {
    // Port of CSBWin's draw order constant opcodes (Viewport.cpp:2618-2637).
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
    push(drawOrder);
    return true;
  }

  private opCellXY(opcode: number): boolean {
    const cell = this.relativeCellFromXYOpcode(opcode);
    const rd = this.context.roomData[cell];
    const x = rd?.x ?? 0;
    const y = rd?.y ?? 0;
    // CellXY(${Opcode[opcode]}) cell=${cell} -> (x=${x}, y=${y})
    push(x);
    push(y);
    return true;
  }

  private opCellContents(opcode: number): boolean {
    const cell = this.relativeCellFromContentsOpcode(opcode);
    const v = this.context.roomData[cell]?.rn2 ?? 0;
    // CellContents(${Opcode[opcode]}) cell=${cell} -> ${v}
    push(v);
    return true;
  }

  private opWallPosition(opcode: number): boolean {
    // CSBWin Viewport.cpp:2652-2664 maps these to RELATIVE_WALL_NUMBERS values.
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
    push(v);
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
