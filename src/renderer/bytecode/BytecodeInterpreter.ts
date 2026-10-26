/**
 * Bytecode Interpreter - Direct port from CSBWin
 *
 * This is a mechanical port of the Interpret() function from CSBWin's Viewport.cpp
 * The goal is to execute bytecode programs exactly as CSBWin does.
 */

import { Opcode } from './Opcodes';
import type { SummarizeRoomData, ViewportPicking } from './Types';
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
import { Die } from '../../core/Die';
import type { DungeonState } from '../../engine/DungeonState';
import type { PartyFootprints } from '../../engine/PartyFootprints';
import type { GameState } from '../../engine/gameTypes';
import type { MonsterDesignOptions } from '../../engine/monsterTypes';
import type { ObjectTables } from '../../data/tables/ObjectTables';
import type { RectPos } from '../../data/tables/UITables';
import type { CSBGraphicsLoader } from '../../data/CSBGraphicsLoader';
import type { BackgroundLib } from '../../data/BackgroundLib';
import { OBJECT_ID_EOF, Position, RoomType, type ObjectID, getRoomType } from '../../core/types';

/**
 * What `DrawViewport` and the drawing it runs read: CSBWin's `d.` for them. Everything the
 * game always sets is required, so a drawing never stops short for want of it; a tool fills
 * what it leaves out with `viewportContextOf` (`tools/lib/viewportContext.ts`). What the
 * drawing leaves for the interface is `picking`, a new one each frame.
 */
export interface InterpreterContext {
  /** The level's wall bitmaps, mirrored or not (`ViewportRenderer.drawViewportFrame`). */
  wallBitmaps: IndexedBitmap[];
  /** `pDoorBitmaps[0..7]`. */
  doorBitmaps: IndexedBitmap[];

  // CSBWin's viewport rectangle tables (from `graphics.dat` item 0x22e)
  wallRectangles: RectPos[];
  floorPitRectangles: RectPos[];
  ceilingPitRectangles: RectPos[];
  teleporterRectangles: RectPos[];
  stairEdgeRectangles: RectPos[];
  stairFacingDownRectangles: RectPos[];
  stairFacingUpRectangles: RectPos[];
  doorTrackTopRectangles: RectPos[];
  doorFrameRectangles: RectPos[];
  doorRects: {
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
  seeThruWallsRect: RectPos;
  seeThruWallsRect2: RectPos;
  seeThruWallsRectUByte4: number; // d.SeeThruWallsRect.b.uByte4
  seeThruWallsRectUByte6: number; // d.SeeThruWallsRect.b.uByte6
  seeThruDoorEdgeRect: RectPos;
  /** `(RectPos *)d.Byte2546` — where a Hall of Champions portrait lands in the viewport. */
  championPortraitRect: RectPos;
  /**
   * `d.Word1868`: set, a Fluxcage's shimmer is not drawn (`DrawRoomObjects`,
   * `doc/CSBwin-src/Code51a4.cpp:2774`). Only `_FusionSequence` sets it (`Attack.cpp:2369`).
   */
  word1868: boolean;

  // The level's style (CSBWin LEVELDESC.word14 bits)
  wallGraphicSet: number;
  backgroundGraphicSet: number;

  /** CSBWin `GetBasicGraphicAddress(n)`, which `GraphicToViewport` draws with. */
  getGraphicBitmap: (graphicNum: number) => IndexedBitmap | null;
  graphicCache: Map<string, IndexedBitmap>;

  // CSBWin object rendering tables (graphics.dat 0x22e + 0x22f)
  objectTables: ObjectTables;
  /** `CSBgraphics.dat`, absent from a game that has none. */
  csbGraphics?: CSBGraphicsLoader;
  /**
   * `altMonCache`: the alternate monster graphics `DrawMonster` has read from `csbGraphics`,
   * and the pictures derived from them. Emptied at each game's start (`CleanupAltMonCache`).
   */
  altMonCache: AltMonCache;
  /**
   * `backgroundLib`: the `CGT_Backgrounds` sections of `csbGraphics` a skin's program draws
   * with. Emptied at each game's start, with `altMonCache` (`CleanupGraphics`,
   * `doc/CSBwin-src/Graphics.cpp:2230-2232`).
   */
  backgroundLib: BackgroundLib;
  dungeonState: DungeonState;
  /**
   * The square and facing `DrawViewport` draws from: `IsOdd` reads them as `d.partyLevel`,
   * `d.partyX`, `d.partyY` and `d.partyFacing` (`doc/CSBwin-src/Viewport.cpp:3192`). They
   * are the party's everywhere but in the prison, where nothing is skinned.
   */
  viewParty: { x: number; y: number; z: number; facing: number };
  /**
   * CSBWin's graphic trace (`GTRACE_*`, on while `traceViewportDrawing` is set): the lines
   * a skin's drawing writes. Absent, as in a game, nothing is traced.
   */
  graphicTrace?: (line: string) => void;
  /** Where a diagnostic goes, `GameHost.trace`: an unknown opcode, CSBWin's `InterpretError`. */
  trace: (line: string) => void;
  /** `d.PartyFootprints`, which `SummarizeRoomInfo` searches for the magic prints. */
  footprints?: PartyFootprints;
  /** The game's state, whose `tickCount` (`d.Time`) `SummarizeRoomInfo` reads. */
  gameState?: GameState;
  /**
   * `invisibleMonsters` and `drawAsSize4Monsters`, which `DrawRoomObjects` and `DrawMonster`
   * read (`doc/CSBwin-src/Code51a4.cpp:2205`, `:420`). Absent, both are off, as at CSBWin's start.
   */
  rules?: MonsterDesignOptions;
  frameFacing: number;
  frameMapIndex: number;
  doorGraphics: number[][]; // d.DoorGraphic[3][2] resolved for current level (Code390e.cpp:180+)
  doorTOC: number[]; // d.DoorTOC[2], resolved from DoorCharacteristics for the current level
  /**
   * `d.Word2514[17][2]`: per door ornament, its graphic and its position set
   * (`d.Byte4122`). Slots 15 and 16, the bashed door (graphic 301) and See-Thru-Walls
   * (302), are set once (`doc/CSBwin-src/CSBCode.cpp:10375-10386`), and the level's own
   * from its `DoorDecorationTOC` (`Code390e.cpp:275-284`), which leaves any slot past
   * the level's count as the last level to fill it left it.
   */
  doorOrnaments: Array<[number, number]>;
  /**
   * `d.LoadedFloorDecorations[16][2]`: per floor decoration, its first graphic and its
   * rectangle set (`d.Byte4110`). Slot 15, the footprints (graphic 241, set 1), is set
   * once (`doc/CSBwin-src/CSBCode.cpp:10394-10397`), and the level's own from its
   * `FloorDecorationTOC` (`Code390e.cpp:263-274`), at most fifteen of them.
   */
  loadedFloorDecorations: Array<[number, number]>;
  numWallDecoration: number; // d.NumWallDecoration (CSBCode.cpp:5863)
  useMirrorImages: boolean; // d.UseMirrorImages (Viewport.cpp:6747)

  viewportIndexBuffer: PaletteIndexViewportBuffer;
  seeThroughWalls: boolean; // d.SeeThruWalls (Viewport.cpp:2646)

  // Room data for all 21 cells
  roomData: SummarizeRoomData[];

  /** What this frame leaves for the interface to pick from. */
  picking: ViewportPicking;
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

/** The first opcode. A word below it calls the subroutine at that address (`Viewport.cpp:3299-3305`). */
const FIRST_OPCODE = Opcode.Return;

/** The relative cells (`RF4L1`…), as `roomData` and `cellNames` (`src/renderer/DrawViewport.ts`) number them. */
const RF = {
  F3L2: 2, F4L1: 4, F4R1: 5, F4: 6, F3L1: 7, F3R1: 8, F3: 9, F3R2: 10,
  F2L1: 12, F2R1: 13, F2: 14, F1L1: 15, F1R1: 16, F1: 17, F0L1: 18, F0R1: 19, F0: 20,
} as const;

/**
 * The opcodes that push a constant (`Viewport.cpp:2488-2870`): a relative cell, a wall
 * decoration's position, a door's graphics index, a draw order, a `RELATIVE_WALL_NUMBERS`
 * value, or a `BITMAP_POINTERS` or `RECT_POINTERS` value, which `StdBitmapPointers` and
 * `StdRectanglePointers` resolve when an opcode draws with it.
 */
const CONSTANT_OPCODES: ReadonlyArray<readonly [Opcode, number]> = [
  [Opcode.F4L1, RF.F4L1], [Opcode.F4R1, RF.F4R1], [Opcode.F4, RF.F4],
  [Opcode.F3L2, RF.F3L2], [Opcode.F3L1, RF.F3L1], [Opcode.F3R1, RF.F3R1], [Opcode.F3, RF.F3], [Opcode.F3R2, RF.F3R2],
  [Opcode.F2L1, RF.F2L1], [Opcode.F2R1, RF.F2R1], [Opcode.F2, RF.F2],
  [Opcode.F1L1, RF.F1L1], [Opcode.F1R1, RF.F1R1], [Opcode.F1, RF.F1],
  [Opcode.F0L1, RF.F0L1], [Opcode.F0R1, RF.F0R1], [Opcode.F0, RF.F0],

  [Opcode.StdDoorGraphicsF3, 2], [Opcode.StdDoorGraphicsF2, 1], [Opcode.StdDoorGraphicsF1, 0],
  [Opcode.wallDecorationRight, 0], [Opcode.wallDecorationFront, 1], [Opcode.wallDecorationLeft, 2],

  [Opcode.DrawOrder00, 0x00], [Opcode.DrawOrder01, 0x01], [Opcode.DrawOrder02, 0x02],
  [Opcode.DrawOrder18, 0x18], [Opcode.DrawOrder21, 0x21], [Opcode.DrawOrder28, 0x28],
  [Opcode.DrawOrder32, 0x32], [Opcode.DrawOrder39, 0x39], [Opcode.DrawOrder41, 0x41],
  [Opcode.DrawOrder49, 0x49], [Opcode.DrawOrder3421, 0x3421], [Opcode.DrawOrder218, 0x218],
  [Opcode.DrawOrder321, 0x321], [Opcode.DrawOrder349, 0x349], [Opcode.DrawOrder412, 0x412],
  [Opcode.DrawOrder431, 0x431], [Opcode.DrawOrder342, 0x342], [Opcode.DrawOrder4312, 0x4312],
  [Opcode.DrawOrder128, 0x128], [Opcode.DrawOrder439, 0x439],

  // `RELATIVE_WALL_NUMBERS`
  [Opcode.WallF3L1Right, 0], [Opcode.WallF3R1Left, 1], [Opcode.WallF3L1Front, 2], [Opcode.WallF3Front, 3],
  [Opcode.WallF3R1Front, 4], [Opcode.WallF2L1Right, 5], [Opcode.WallF2R1Left, 6], [Opcode.WallF2L1Front, 7],
  [Opcode.WallF2Front, 8], [Opcode.WallF2R1Front, 9], [Opcode.WallF1L1Right, 10], [Opcode.WallF1R1Left, 11],
  [Opcode.WallF1Front, 12],

  [Opcode.StdWallBitmapF3L2, StdBitmapPtr.BMP_StdWallBitmapF3L2],
  [Opcode.StdWallBitmapF3L1, StdBitmapPtr.BMP_StdWallBitmapF3L1],
  [Opcode.StdWallBitmapF3, StdBitmapPtr.BMP_StdWallBitmapF3],
  [Opcode.StdWallBitmapF3R1, StdBitmapPtr.BMP_StdWallBitmapF3R1],
  [Opcode.StdWallBitmapF3R2, StdBitmapPtr.BMP_StdWallBitmapF3R2],
  [Opcode.StdWallBitmapF2L1, StdBitmapPtr.BMP_StdWallBitmapF2L1],
  [Opcode.StdWallBitmapF2, StdBitmapPtr.BMP_StdWallBitmapF2],
  [Opcode.StdWallBitmapF2R1, StdBitmapPtr.BMP_StdWallBitmapF2R1],
  [Opcode.StdWallBitmapF1L1, StdBitmapPtr.BMP_StdWallBitmapF1L1],
  [Opcode.StdWallBitmapF1, StdBitmapPtr.BMP_StdWallBitmapF1],
  [Opcode.StdWallBitmapF1R1, StdBitmapPtr.BMP_StdWallBitmapF1R1],
  [Opcode.StdWallBitmapF0L1, StdBitmapPtr.BMP_StdWallBitmapF0L1],
  [Opcode.StdWallBitmapF0R1, StdBitmapPtr.BMP_StdWallBitmapF0R1],

  [Opcode.StdDoorFacingFrameLeftBitmapF3L1, StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF3L1],
  [Opcode.StdDoorFacingFrameLeftBitmapF3, StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF3],
  [Opcode.StdDoorFacingFrameLeftBitmapF3R1, StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF3R1],
  [Opcode.StdDoorFacingFrameLeftBitmapF2, StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF2],
  [Opcode.StdDoorFacingFrameLeftBitmapF1, StdBitmapPtr.BMP_StdDoorFacingFrameLeftBitmapF1],
  [Opcode.StdDoorFacingFrameRightBitmapF1, StdBitmapPtr.BMP_StdDoorFacingFrameRightBitmapF1],
  [Opcode.StdDoorEdgeFrameBitmapF0, StdBitmapPtr.BMP_StdDoorEdgeFrameBitmapF0],
  [Opcode.StdDoorFacingTopTrackBitmapF2, StdBitmapPtr.BMP_StdDoorFacingTopTrackBitmapF2],
  [Opcode.StdDoorFacingTopTrackBitmapF1, StdBitmapPtr.BMP_StdDoorFacingTopTrackBitmapF1],

  [Opcode.StdBitmapViewport, StdBitmapPtr.BMP_StdBitmapViewport],
  [Opcode.StdHoleInWallBitmap, StdBitmapPtr.BMP_StdHoleInWallBitmap],

  [Opcode.StdWallRectangleF3L2, StdRectPtr.RECT_StdWallRectangleF3L2],
  [Opcode.StdWallRectangleF3L1, StdRectPtr.RECT_StdWallRectangleF3L1],
  [Opcode.StdWallRectangleF3, StdRectPtr.RECT_StdWallRectangleF3],
  [Opcode.StdWallRectangleF3R1, StdRectPtr.RECT_StdWallRectangleF3R1],
  [Opcode.StdWallRectangleF3R2, StdRectPtr.RECT_StdWallRectangleF3R2],
  [Opcode.StdWallRectangleF2L1, StdRectPtr.RECT_StdWallRectangleF2L1],
  [Opcode.StdWallRectangleF2, StdRectPtr.RECT_StdWallRectangleF2],
  [Opcode.StdWallRectangleF2R1, StdRectPtr.RECT_StdWallRectangleF2R1],
  [Opcode.StdWallRectangleF1L1, StdRectPtr.RECT_StdWallRectangleF1L1],
  [Opcode.StdWallRectangleF1, StdRectPtr.RECT_StdWallRectangleF1],
  [Opcode.StdWallRectangleF1R1, StdRectPtr.RECT_StdWallRectangleF1R1],
  [Opcode.StdWallRectangleF0L1, StdRectPtr.RECT_StdWallRectangleF0L1],
  [Opcode.StdWallRectangleF0, StdRectPtr.RECT_StdWallRectangleF0],
  [Opcode.StdWallRectangleF0R1, StdRectPtr.RECT_StdWallRectangleF0R1],

  [Opcode.StdFloorPitRectangleF3L1, StdRectPtr.RECT_StdFloorPitRectangleF3L1],
  [Opcode.StdFloorPitRectangleF3, StdRectPtr.RECT_StdFloorPitRectangleF3],
  [Opcode.StdFloorPitRectangleF3R1, StdRectPtr.RECT_StdFloorPitRectangleF3R1],
  [Opcode.StdFloorPitRectangleF2L1, StdRectPtr.RECT_StdFloorPitRectangleF2L1],
  [Opcode.StdFloorPitRectangleF2, StdRectPtr.RECT_StdFloorPitRectangleF2],
  [Opcode.StdFloorPitRectangleF2R1, StdRectPtr.RECT_StdFloorPitRectangleF2R1],
  [Opcode.StdFloorPitRectangleF1L1, StdRectPtr.RECT_StdFloorPitRectangleF1L1],
  [Opcode.StdFloorPitRectangleF1, StdRectPtr.RECT_StdFloorPitRectangleF1],
  [Opcode.StdFloorPitRectangleF1R1, StdRectPtr.RECT_StdFloorPitRectangleF1R1],
  [Opcode.StdFloorPitRectangleF0L1, StdRectPtr.RECT_StdFloorPitRectangleF0L1],
  [Opcode.StdFloorPitRectangleF0, StdRectPtr.RECT_StdFloorPitRectangleF0],
  [Opcode.StdFloorPitRectangleF0R1, StdRectPtr.RECT_StdFloorPitRectangleF0R1],

  [Opcode.StdTeleporterRectangleF3L1, StdRectPtr.RECT_StdTeleporterRectangleF3L1],
  [Opcode.StdTeleporterRectangleF3, StdRectPtr.RECT_StdTeleporterRectangleF3],
  [Opcode.StdTeleporterRectangleF3R1, StdRectPtr.RECT_StdTeleporterRectangleF3R1],
  [Opcode.StdTeleporterRectangleF2L1, StdRectPtr.RECT_StdTeleporterRectangleF2L1],
  [Opcode.StdTeleporterRectangleF2, StdRectPtr.RECT_StdTeleporterRectangleF2],
  [Opcode.StdTeleporterRectangleF2R1, StdRectPtr.RECT_StdTeleporterRectangleF2R1],
  [Opcode.StdTeleporterRectangleF1L1, StdRectPtr.RECT_StdTeleporterRectangleF1L1],
  [Opcode.StdTeleporterRectangleF1, StdRectPtr.RECT_StdTeleporterRectangleF1],
  [Opcode.StdTeleporterRectangleF1R1, StdRectPtr.RECT_StdTeleporterRectangleF1R1],
  [Opcode.StdTeleporterRectangleF0L1, StdRectPtr.RECT_StdTeleporterRectangleF0L1],
  [Opcode.StdTeleporterRectangleF0, StdRectPtr.RECT_StdTeleporterRectangleF0],
  [Opcode.StdTeleporterRectangleF0R1, StdRectPtr.RECT_StdTeleporterRectangleF0R1],

  [Opcode.StdStairFacingUpRectangleF3L1, StdRectPtr.RECT_StdStairFacingUpRectangleF3L1],
  [Opcode.StdStairFacingUpRectangleF3, StdRectPtr.RECT_StdStairFacingUpRectangleF3],
  [Opcode.StdStairFacingUpRectangleF3R1, StdRectPtr.RECT_StdStairFacingUpRectangleF3R1],
  [Opcode.StdStairFacingUpRectangleF2L1, StdRectPtr.RECT_StdStairFacingUpRectangleF2L1],
  [Opcode.StdStairFacingUpRectangleF2, StdRectPtr.RECT_StdStairFacingUpRectangleF2],
  [Opcode.StdStairFacingUpRectangleF2R1, StdRectPtr.RECT_StdStairFacingUpRectangleF2R1],
  [Opcode.StdStairFacingUpRectangleF1L1, StdRectPtr.RECT_StdStairFacingUpRectangleF1L1],
  [Opcode.StdStairFacingUpRectangleF1, StdRectPtr.RECT_StdStairFacingUpRectangleF1],
  [Opcode.StdStairFacingUpRectangleF1R1, StdRectPtr.RECT_StdStairFacingUpRectangleF1R1],
  [Opcode.StdStairFacingUpRectangleF0L, StdRectPtr.RECT_StdStairFacingUpRectangleF0L],
  [Opcode.StdStairFacingUpRectangleF0R, StdRectPtr.RECT_StdStairFacingUpRectangleF0R],

  [Opcode.StdStairFacingDownRectangleF3L1, StdRectPtr.RECT_StdStairFacingDownRectangleF3L1],
  [Opcode.StdStairFacingDownRectangleF3, StdRectPtr.RECT_StdStairFacingDownRectangleF3],
  [Opcode.StdStairFacingDownRectangleF3R1, StdRectPtr.RECT_StdStairFacingDownRectangleF3R1],
  [Opcode.StdStairFacingDownRectangleF2L1, StdRectPtr.RECT_StdStairFacingDownRectangleF2L1],
  [Opcode.StdStairFacingDownRectangleF2, StdRectPtr.RECT_StdStairFacingDownRectangleF2],
  [Opcode.StdStairFacingDownRectangleF2R1, StdRectPtr.RECT_StdStairFacingDownRectangleF2R1],
  [Opcode.StdStairFacingDownRectangleF1L1, StdRectPtr.RECT_StdStairFacingDownRectangleF1L1],
  [Opcode.StdStairFacingDownRectangleF1, StdRectPtr.RECT_StdStairFacingDownRectangleF1],
  [Opcode.StdStairFacingDownRectangleF1R1, StdRectPtr.RECT_StdStairFacingDownRectangleF1R1],
  [Opcode.StdStairFacingDownRectangleF0L, StdRectPtr.RECT_StdStairFacingDownRectangleF0L],
  [Opcode.StdStairFacingDownRectangleF0R, StdRectPtr.RECT_StdStairFacingDownRectangleF0R],

  [Opcode.StdStairEdgeRectF2L1, StdRectPtr.RECT_StdStairEdgeRectangleF2L1],
  [Opcode.StdStairEdgeRectF2R1, StdRectPtr.RECT_StdStairEdgeRectangleF2R1],
  [Opcode.StdStairEdgeUpRectF1L1, StdRectPtr.RECT_StdStairEdgeUpRectangleF1L1],
  [Opcode.StdStairEdgeUpRectF1R1, StdRectPtr.RECT_StdStairEdgeUpRectangleF1R1],
  [Opcode.StdStairEdgeDownRectF1L1, StdRectPtr.RECT_StdStairEdgeDownRectangleF1L1],
  [Opcode.StdStairEdgeDownRectF1R1, StdRectPtr.RECT_StdStairEdgeDownRectangleF1R1],
  [Opcode.StdStairEdgeRectF0L1, StdRectPtr.RECT_StdStairEdgeRectangleF0L],
  [Opcode.StdStairEdgeRectF0R1, StdRectPtr.RECT_StdStairEdgeRectangleF0R],

  [Opcode.StdDoorRectsF3L1, StdRectPtr.RECT_StdDoorRectsF3L1],
  [Opcode.StdDoorRectsF3, StdRectPtr.RECT_StdDoorRectsF3],
  [Opcode.StdDoorRectsF3R1, StdRectPtr.RECT_StdDoorRectsF3R1],
  [Opcode.StdDoorRectsF2L1, StdRectPtr.RECT_StdDoorRectsF2L1],
  [Opcode.StdDoorRectsF2, StdRectPtr.RECT_StdDoorRectsF2],
  [Opcode.StdDoorRectsF2R1, StdRectPtr.RECT_StdDoorRectsF2R1],
  [Opcode.StdDoorRectsF1L1, StdRectPtr.RECT_StdDoorRectsF1L1],
  [Opcode.StdDoorRectsF1, StdRectPtr.RECT_StdDoorRectsF1],
  [Opcode.StdDoorRectsF1R1, StdRectPtr.RECT_StdDoorRectsF1R1],
  [Opcode.StdDoorRectsF0, StdRectPtr.RECT_StdDoorRectsF0],

  [Opcode.StdDoorFacingTopTrackRectF2L1, StdRectPtr.RECT_StdDoorFacingTopTrackRectF2L1],
  [Opcode.StdDoorFacingTopTrackRectF2, StdRectPtr.RECT_StdDoorFacingTopTrackRectF2],
  [Opcode.StdDoorFacingTopTrackRectF2R1, StdRectPtr.RECT_StdDoorFacingTopTrackRectF2R1],
  [Opcode.StdDoorFacingTopTrackRectF1L1, StdRectPtr.RECT_StdDoorFacingTopTrackRectF1L1],
  [Opcode.StdDoorFacingTopTrackRectF1, StdRectPtr.RECT_StdDoorFacingTopTrackRectF1],
  [Opcode.StdDoorFacingTopTrackRectF1R1, StdRectPtr.RECT_StdDoorFacingTopTrackRectF1R1],
  [Opcode.StdDoorEdgeFrameRectF0, StdRectPtr.RECT_StdDoorEdgeFrameRectF0],
  [Opcode.StdDoorFacingTopTrackRectF0, StdRectPtr.RECT_StdDoorEdgeFrameRectF0],
  [Opcode.StdDoorFacingFrameRectF3L1, StdRectPtr.RECT_StdDoorFacingFrameRectF3L1],
  [Opcode.StdDoorFacingFrameRectF3R1, StdRectPtr.RECT_StdDoorFacingFrameRectF3R1],
  [Opcode.StdDoorFacingFrameRightRectF3, StdRectPtr.RECT_StdDoorFacingFrameRightRectF3],
  [Opcode.StdDoorFacingFrameLeftRectF3, StdRectPtr.RECT_StdDoorFacingFrameLeftRectF3],
  [Opcode.StdDoorFacingFrameRightRectF2, StdRectPtr.RECT_StdDoorFacingFrameRightRectF2],
  [Opcode.StdDoorFacingFrameLeftRectF2, StdRectPtr.RECT_StdDoorFacingFrameLeftRectF2],
  [Opcode.StdDoorFacingFrameRightRectF1, StdRectPtr.RECT_StdDoorFacingFrameRightRectF1],
  [Opcode.StdDoorFacingFrameLeftRectF1, StdRectPtr.RECT_StdDoorFacingFrameLeftRectF1],

  [Opcode.StdSeeThruWallsRect, StdRectPtr.RECT_StdSeeThruWallsRect],
  [Opcode.StdSeeThruWallsRect2, StdRectPtr.RECT_StdSeeThruWallsRect2],
  [Opcode.MinusOne, -1],
  [Opcode.Zero, 0],
];

/** `F4L1xy`…: the cell whose map square each pushes (`Viewport.cpp:2508`). */
const XY_OPCODES: ReadonlyArray<readonly [Opcode, number]> = [
  [Opcode.F4L1xy, RF.F4L1], [Opcode.F4R1xy, RF.F4R1], [Opcode.F4xy, RF.F4],
  [Opcode.F3L2xy, RF.F3L2], [Opcode.F3L1xy, RF.F3L1], [Opcode.F3R1xy, RF.F3R1], [Opcode.F3xy, RF.F3], [Opcode.F3R2xy, RF.F3R2],
  [Opcode.F2L1xy, RF.F2L1], [Opcode.F2R1xy, RF.F2R1], [Opcode.F2xy, RF.F2],
  [Opcode.F1L1xy, RF.F1L1], [Opcode.F1R1xy, RF.F1R1], [Opcode.F1xy, RF.F1],
  [Opcode.F0L1xy, RF.F0L1], [Opcode.F0R1xy, RF.F0R1], [Opcode.F0xy, RF.F0],
];

/** `F4L1Contents`…: the cell whose first object each pushes (`Viewport.cpp:2528`). */
const CONTENTS_OPCODES: ReadonlyArray<readonly [Opcode, number]> = [
  [Opcode.F4L1Contents, RF.F4L1], [Opcode.F4R1Contents, RF.F4R1], [Opcode.F4Contents, RF.F4],
  [Opcode.F3L2Contents, RF.F3L2], [Opcode.F3L1Contents, RF.F3L1], [Opcode.F3R1Contents, RF.F3R1],
  [Opcode.F3Contents, RF.F3], [Opcode.F3R2Contents, RF.F3R2],
  [Opcode.F2L1Contents, RF.F2L1], [Opcode.F2R1Contents, RF.F2R1], [Opcode.F2Contents, RF.F2],
  [Opcode.F1L1Contents, RF.F1L1], [Opcode.F1R1Contents, RF.F1R1], [Opcode.F1Contents, RF.F1],
  [Opcode.F0L1Contents, RF.F0L1], [Opcode.F0R1Contents, RF.F0R1], [Opcode.F0Contents, RF.F0],
];

/** `F3L1DoorRecordIndex`…: the cell whose `decorations[1]`, its door's index, each pushes (`Viewport.cpp:2546`). */
const DOOR_RECORD_INDEX_OPCODES: ReadonlyArray<readonly [Opcode, number]> = [
  [Opcode.F3L1DoorRecordIndex, RF.F3L1], [Opcode.F3DoorRecordIndex, RF.F3], [Opcode.F3R1DoorRecordIndex, RF.F3R1],
  [Opcode.F2L1DoorRecordIndex, RF.F2L1], [Opcode.F2DoorRecordIndex, RF.F2], [Opcode.F2R1DoorRecordIndex, RF.F2R1],
  [Opcode.F1L1DoorRecordIndex, RF.F1L1], [Opcode.F1DoorRecordIndex, RF.F1], [Opcode.F1R1DoorRecordIndex, RF.F1R1],
  [Opcode.F0DoorRecordIndex, RF.F0],
];

/** `F3L1DoorState`…: the cell whose `decorations[0]`, its door's state, each pushes (`Viewport.cpp:2557`). */
const DOOR_STATE_OPCODES: ReadonlyArray<readonly [Opcode, number]> = [
  [Opcode.F3L1DoorState, RF.F3L1], [Opcode.F3DoorState, RF.F3], [Opcode.F3R1DoorState, RF.F3R1],
  [Opcode.F2L1DoorState, RF.F2L1], [Opcode.F2DoorState, RF.F2], [Opcode.F2R1DoorState, RF.F2R1],
  [Opcode.F1L1DoorState, RF.F1L1], [Opcode.F1DoorState, RF.F1], [Opcode.F1R1DoorState, RF.F1R1],
  [Opcode.F0DoorState, RF.F0],
];

/**
 * `FloorDecorationGraphicOrdinalF3L1`…: the cell whose `decorations[2]`, its floor
 * decoration, each pushes (`Viewport.cpp:2724`).
 */
const FLOOR_DECORATION_OPCODES: ReadonlyArray<readonly [Opcode, number]> = [
  [Opcode.FloorDecorationGraphicOrdinalF3L1, RF.F3L1], [Opcode.FloorDecorationGraphicOrdinalF3, RF.F3],
  [Opcode.FloorDecorationGraphicOrdinalF3R1, RF.F3R1], [Opcode.FloorDecorationGraphicOrdinalF2L1, RF.F2L1],
  [Opcode.FloorDecorationGraphicOrdinalF2, RF.F2], [Opcode.FloorDecorationGraphicOrdinalF2R1, RF.F2R1],
  [Opcode.FloorDecorationGraphicOrdinalF1L1, RF.F1L1], [Opcode.FloorDecorationGraphicOrdinalF1, RF.F1],
  [Opcode.FloorDecorationGraphicOrdinalF1R1, RF.F1R1], [Opcode.FloorDecorationGraphicOrdinalF0L1, RF.F0L1],
  [Opcode.FloorDecorationGraphicOrdinalF0, RF.F0], [Opcode.FloorDecorationGraphicOrdinalF0R1, RF.F0R1],
];

/**
 * The stairs' graphics (`Viewport.cpp:2737-2757`, `:2807-2814`), each as its offset from
 * the wall set's first, `90 + 18 * wallGraphicSet` (`Code390e.cpp:117-127`):
 * `StairFacingUpGraphic[6]` to `[0]` at 0 to 6, `StairFacingDownGraphic[6]` to `[0]` at
 * 7 to 13, and `StairEdgeGraphic[3]` to `[0]` at 14 to 17.
 */
const STAIR_GRAPHIC_OPCODES: ReadonlyArray<readonly [Opcode, number]> = [
  [Opcode.StdStairFacingUpGraphicF3L1, 0], [Opcode.StdStairFacingUpGraphicF3R1, 0], [Opcode.StdStairFacingUpGraphicF3, 1],
  [Opcode.StdStairFacingUpGraphicF2L1, 2], [Opcode.StdStairFacingUpGraphicF2R1, 2], [Opcode.StdStairFacingUpGraphicF2, 3],
  [Opcode.StdStairFacingUpGraphicF1L1, 4], [Opcode.StdStairFacingUpGraphicF1R1, 4], [Opcode.StdStairFacingUpGraphicF1, 5],
  [Opcode.StdStairFacingUpGraphicF0, 6],
  [Opcode.StdStairFacingDownGraphicF3L1, 7], [Opcode.StdStairFacingDownGraphicF3R1, 7], [Opcode.StdStairFacingDownGraphicF3, 8],
  [Opcode.StdStairFacingDownGraphicF2L1, 9], [Opcode.StdStairFacingDownGraphicF2R1, 9], [Opcode.StdStairFacingDownGraphicF2, 10],
  [Opcode.StdStairFacingDownGraphicF1L1, 11], [Opcode.StdStairFacingDownGraphicF1R1, 11], [Opcode.StdStairFacingDownGraphicF1, 12],
  [Opcode.StdStairFacingDownGraphicF0, 13],
  [Opcode.StdStairEdgeGraphicF2, 14], [Opcode.StdStairEdgeGraphicUpF1, 15], [Opcode.StdStairEdgeGraphicDownF1, 16],
  [Opcode.StdStairEdgeGraphicF0L1, 17], [Opcode.StdStairEdgeGraphicF0R1, 17],
];

/** The context's lists that `StdRectanglePointers` reads a rectangle of. */
type RectList =
  | 'wallRectangles' | 'floorPitRectangles' | 'teleporterRectangles' | 'stairEdgeRectangles'
  | 'stairFacingDownRectangles' | 'stairFacingUpRectangles' | 'doorTrackTopRectangles' | 'doorFrameRectangles';

/**
 * `StdRectanglePointers` (`Viewport.cpp:2298-2411`) as a table built once, indexed by
 * `RECT_POINTERS`: where each rectangle is in the context. `RECT_StdDoorRectsF0` has none,
 * as CSBWin's returns no `d.DoorRectsF0` (`:2404`).
 */
const STD_RECTANGLE_POINTERS: Array<(context: InterpreterContext) => RectPos | RectPos[] | undefined> = [];

/** The pointers from `first` on, in `RECT_POINTERS`' order: the entries `indexes` of `list`. */
function stdRectangles(first: StdRectPtr, list: RectList, indexes: readonly number[]): void {
  indexes.forEach((index, i) => {
    STD_RECTANGLE_POINTERS[first + i] = (context) => context[list][index];
  });
}

stdRectangles(StdRectPtr.RECT_StdWallRectangleF3L2, 'wallRectangles', [13, 1, 0, 2, 12, 4, 3, 5, 7, 6, 8, 10, 9, 11]);
stdRectangles(StdRectPtr.RECT_StdFloorPitRectangleF3L1, 'floorPitRectangles', [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
stdRectangles(StdRectPtr.RECT_StdStairFacingDownRectangleF3L1, 'stairFacingDownRectangles', [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
stdRectangles(StdRectPtr.RECT_StdStairFacingUpRectangleF3L1, 'stairFacingUpRectangles', [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
stdRectangles(StdRectPtr.RECT_StdTeleporterRectangleF3L1, 'teleporterRectangles', [1, 0, 2, 4, 3, 5, 7, 6, 8, 10, 9, 11]);
stdRectangles(StdRectPtr.RECT_StdStairEdgeRectangleF2L1, 'stairEdgeRectangles', [7, 6, 5, 4, 3, 2, 1, 0]);
stdRectangles(StdRectPtr.RECT_StdDoorFacingTopTrackRectF2L1, 'doorTrackTopRectangles', [5, 4, 3, 2, 1, 0, 6]);
stdRectangles(StdRectPtr.RECT_StdDoorFacingFrameRectF3L1, 'doorFrameRectangles', [7, 6, 0, 1, 2, 3, 4, 5]);
(['F3L1', 'F3', 'F3R1', 'F2L1', 'F2', 'F2R1', 'F1L1', 'F1', 'F1R1'] as const).forEach((name, i) => {
  STD_RECTANGLE_POINTERS[StdRectPtr.RECT_StdDoorRectsF3L1 + i] = (context) => context.doorRects[name];
});
STD_RECTANGLE_POINTERS[StdRectPtr.RECT_StdSeeThruWallsRect] = (context) => context.seeThruWallsRect;
STD_RECTANGLE_POINTERS[StdRectPtr.RECT_StdSeeThruWallsRect2] = (context) => context.seeThruWallsRect2;

/** An opcode's handler, given the machine and the constant its table entry holds. */
type OpcodeHandler = (machine: BytecodeInterpreter, operand: number) => boolean;

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

/** The most opcodes one `Interpret` runs before it takes its program for one that never returns. */
const INTERPRET_STEP_BUDGET = 1 << 20;

/** CSBWin's `Interpret`, the machine that runs a viewport program (`Viewport.cpp:2425-3308`). */
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
   * `Interpret`'s switch (`Viewport.cpp:2486-3307`) as a table built once, indexed by
   * `opcode - FIRST_OPCODE`: each opcode's handler, and the constant it takes.
   */
  private static readonly decode: ReadonlyArray<{ readonly run: OpcodeHandler; readonly operand: number } | undefined> =
    BytecodeInterpreter.buildDecode();

  private static buildDecode(): Array<{ run: OpcodeHandler; operand: number } | undefined> {
    const table: Array<{ run: OpcodeHandler; operand: number } | undefined> = [];
    const on = (opcode: Opcode, run: OpcodeHandler, operand = 0): void => {
      table[opcode - FIRST_OPCODE] = { run, operand };
    };
    const onEach = (opcodes: ReadonlyArray<readonly [Opcode, number]>, run: OpcodeHandler): void => {
      for (const [opcode, operand] of opcodes) on(opcode, run, operand);
    };
    /** The groups whose handler switches on the opcode itself. */
    const onOpcodes = (opcodes: readonly Opcode[], run: OpcodeHandler): void => {
      for (const opcode of opcodes) on(opcode, run, opcode);
    };

    onEach(CONSTANT_OPCODES, (_, value) => { push(value); return true; });
    onEach(XY_OPCODES, (m, cell) => m.opCellXY(cell));
    onEach(CONTENTS_OPCODES, (m, cell) => m.opCellContents(cell));
    onEach(DOOR_STATE_OPCODES, (m, cell) => m.opCellDecoration(cell, 0));
    onEach(DOOR_RECORD_INDEX_OPCODES, (m, cell) => m.opCellDecoration(cell, 1));
    onEach(FLOOR_DECORATION_OPCODES, (m, cell) => m.opCellDecoration(cell, 2));
    onEach(STAIR_GRAPHIC_OPCODES, (m, offset) => m.opStairGraphic(offset));

    on(Opcode.Return, (m) => m.opReturn());
    on(Opcode.JumpZ, (m) => m.opJumpZ());
    on(Opcode.JumpNZ, (m) => m.opJumpNZ());
    on(Opcode.Jump, (m) => m.opJump());
    on(Opcode.Literal, (m) => m.opLiteral());
    on(Opcode.ToR, () => { rpush(pop()); return true; });
    on(Opcode.RTo, () => { push(rpop()); return true; });

    on(Opcode.StdBltShape, (m) => m.opStdBltShape());
    on(Opcode.StdBltShapeToViewport, (m) => m.opStdBltShapeToViewport(false));
    on(Opcode.StdMirrorShapeToViewport, (m) => m.opStdBltShapeToViewport(true));
    on(Opcode.StdGraphicToViewport, (m) => m.opStdGraphicToViewport(false));
    on(Opcode.StdMirrorGraphicToViewport, (m) => m.opStdGraphicToViewport(true));
    on(Opcode.StdDrawCeilingPit, (m) => m.opStdDrawCeilingPit());
    on(Opcode.StdDrawSeeThruDoorEdge, (m) => m.opStdDrawSeeThruDoorEdge());
    on(Opcode.StdDrawDoorSwitch, (m) => m.opStdDrawDoorSwitch());
    on(Opcode.StdDrawFloorDecoration, (m) => m.opStdDrawFloorDecoration());
    on(Opcode.StdDrawTeleporter, (m) => m.opStdDrawTeleporter());
    on(Opcode.StdDrawRoomObjects, (m) => m.opStdDrawRoomObjects());
    on(Opcode.StdDrawDoor, (m) => m.opStdDrawDoor());
    on(Opcode.StdDrawWallDecoration, (m) => m.opStdDrawWallDecoration());
    on(Opcode.StdDrawWallText, (m) => m.opStdDrawWallText());

    on(Opcode.GetDecoration0, (m) => m.opGetDecoration0());
    on(Opcode.HasDecoration, (m) => m.opHasDecoration());
    on(Opcode.DoorSwitch, (m) => m.opDoorSwitch());
    // The last `StdDrawWallDecoration`'s result (`Viewport.cpp:2639`).
    on(Opcode.Alcove, (m) => { push(m.hasAlcove ? 1 : 0); return true; });
    on(Opcode.SeeThroughWalls, (m) => { push(m.context.seeThroughWalls ? 1 : 0); return true; });
    on(Opcode.LeaveMortarJoint, (m) => { m.removeMortarJoint = false; return true; });

    // See-Thru-Walls through the F1 wall (`Viewport.cpp:2964-3023`).
    on(Opcode.StdAllocateDerivedGraphic, (m) => { m.allocateDerivedGraphic(pop()); return true; });
    on(Opcode.StdSeeThruWallsRectUByte4, (m) => { push(m.context.seeThruWallsRectUByte4); return true; });
    on(Opcode.StdSeeThruWallsRectUByte6, (m) => { push(m.context.seeThruWallsRectUByte6); return true; });
    on(Opcode.StdBltToDerivedGraphic, (m) => m.opStdBltDerivedGraphic(true));
    on(Opcode.StdBltFromDerivedGraphic, (m) => m.opStdBltDerivedGraphic(false));
    on(Opcode.StdDeleteDerivedGraphic, (m) => {
      m.derivedGraphics.delete(pop());
      // CSBWin's case has no `break` and falls into `StdHoleInWallBitmap` (Viewport.cpp:3022-3023).
      push(StdBitmapPtr.BMP_StdHoleInWallBitmap);
      return true;
    });

    onOpcodes([
      Opcode.CurrentSkin, Opcode.SkinNumber, Opcode.CurrentCell, Opcode.WallGraphicID, Opcode.FloorGraphicID,
      Opcode.MiddleGraphicID, Opcode.CeilingGraphicID, Opcode.WallMaskID, Opcode.FloorMaskID, Opcode.MiddleMaskID,
      Opcode.CeilingMaskID, Opcode.WallDecorationID,
    ], (m, opcode) => m.opSkinQuery(opcode));
    onOpcodes([
      Opcode.DrawCustomGraphic, Opcode.CreateVirtualBitmap, Opcode.DrawCustomDecoration, Opcode.CreateVirtualMask,
      Opcode.CreateVirtualAffineMask,
    ], (m, opcode) => m.opCustomGraphic(opcode));
    onOpcodes([Opcode.GetMaskHeader, Opcode.NeedVirtualMaskQ, Opcode.BitmapInfo], (m, opcode) => m.opBackgroundQuery(opcode));
    onOpcodes([
      Opcode.SWAP, Opcode.DROP, Opcode.TwoDrop, Opcode.OVER, Opcode.ROT, Opcode.DUP, Opcode.TwoDup, Opcode.QuestionDUP,
      Opcode.PICK, Opcode.ROLL, Opcode.PLUS, Opcode.MINUS, Opcode.GEAR, Opcode.SLASH, Opcode.EQUAL, Opcode.LESS,
      Opcode.GREATER, Opcode.ULESS, Opcode.ZEROEQUAL, Opcode.NOT, Opcode.ZEROLESS, Opcode.ZEROGREATER, Opcode.AND,
      Opcode.OR, Opcode.LSHIFT, Opcode.IsOdd,
    ], (m, opcode) => m.opStackWord(opcode));
    return table;
  }

  /**
   * One opcode, through `decode`; false when `Interpret` returns. A word below
   * `FIRST_OPCODE` calls the subroutine at that address (`Viewport.cpp:3299-3305`).
   */
  private executeOpcode(opcode: number): boolean {
    if (opcode < FIRST_OPCODE) {
      rpush(this.pc);
      this.pc = opcode;
      return true;
    }
    const decoded = BytecodeInterpreter.decode[opcode - FIRST_OPCODE];
    if (decoded === undefined) {
      // `InterpretError("Unknown display opcode\nCode = %d.")`, and `Interpret` returns.
      this.context.trace(`Unknown display opcode ${opcode}`);
      return false;
    }
    return decoded.run(this, decoded.operand);
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
        push(lib.GetWallGraphicID(pop() >>> 0));
        break;
      case Opcode.FloorGraphicID:
        push(lib.GetFloorGraphicID(pop() >>> 0));
        break;
      case Opcode.MiddleGraphicID:
        push(lib.GetMiddleGraphicID(pop() >>> 0));
        break;
      case Opcode.CeilingGraphicID:
        push(lib.GetCeilingGraphicID(pop() >>> 0));
        break;
      case Opcode.WallMaskID:
        push(lib.GetWallMaskID(pop() >>> 0));
        break;
      case Opcode.FloorMaskID:
        push(lib.GetFloorMaskID(pop() >>> 0));
        break;
      case Opcode.MiddleMaskID:
        push(lib.GetMiddleMaskID(pop() >>> 0));
        break;
      case Opcode.CeilingMaskID:
        push(lib.GetCeilingMaskID(pop() >>> 0));
        break;
      case Opcode.WallDecorationID: {
        const wallDecorationNum = pop();
        const skinNum = pop();
        push(lib.GetWallDecorationID(skinNum >>> 0, wallDecorationNum >>> 0));
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
        const pMask = lib.GetMask(maskID >>> 0, maskNumber >>> 0, 12);
        const pGraphic = lib.GetBitmap(graphicID >>> 0, 2);
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
        const pGraphic = lib.GetBitmap(graphicID >>> 0, 2);
        if (pGraphic === null) break; // do nothing
        const pAffineMask = lib.GetMask(maskID >>> 0, maskNumber >>> 0, 48);
        if (pAffineMask === null) break; // do nothing
        lib.CreateVirtualBitmap(pGraphic.data, pGraphic.bitmapSize, virtualGraphicID >>> 0, pAffineMask);
        break;
      }
      case Opcode.DrawCustomDecoration: {
        const locationNumber = pop();
        const decorationNumber = pop();
        const decorationID = pop();
        const decoration = lib.GetDecorationBitmap(decorationID >>> 0, decorationNumber >>> 0, locationNumber >>> 0);
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
        lib.CreateNewAffineMask(newMaskID >>> 0, newMaskNumber >>> 0, aMask);
        break;
      }
    }
    return true;
  }

  /** Runs a drawing on the viewport as CSBWin's `d.pViewportBMP` bytes, and writes them back. */
  private applyToViewport(draw: (viewportBMP: ViewportBMP) => void): void {
    const viewportBMP = new ViewportBMP(this.context.viewportIndexBuffer);
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
        const pMask = lib.GetMask(maskID >>> 0, maskNumber >>> 0, 12);
        if (pMask === null) break;
        // `BACKGROUND_MASK` (`CSB.h:330-339`): srcX, srcY, dstX, dstY, width, height.
        for (let i = 0; i < 6; i++) push(readU16LE(pMask.data, pMask.offset + 2 * i));
        break;
      }
      case Opcode.NeedVirtualMaskQ: {
        const maskNumber = pop();
        const maskID = pop();
        const pMask = lib.MaskExists(maskID >>> 0, maskNumber >>> 0);
        push(pMask === null ? 1 : 0);
        break;
      }
      case Opcode.BitmapInfo: {
        let width = 0;
        let height = 0;
        const graphicID = pop();
        const pGraphic = lib.GetBitmap(graphicID >>> 0, 4);
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
        push((party.z + party.x + party.y + party.facing) & 1);
        break;
      }
    }
    return true;
  }

  private opStdBltShape(): boolean {
    // CSBWin: pop rectangle pointer, pop bitmap pointer, then blit with transparentColor=10.
    const rectanglePtr = pop();
    const bitmapPtr = pop();

    const bitmap = this.resolveStdBitmapPointer(bitmapPtr);
    const rectRef = this.resolveStdRectanglePointer(rectanglePtr);
    if (!bitmap || !rectRef || Array.isArray(rectRef)) return true;
    this.draw.blitShapeBitmapToViewport(bitmap, rectRef, false);
    return true;
  }

  private opJumpZ(): boolean {
    const condition = pop();
    const offset = i16(this.program[this.pc]!);
    this.pc++;

    if (condition === 0) {
      this.pc += offset;
    }

    return true;
  }

  private opJumpNZ(): boolean {
    const condition = pop();
    const offset = i16(this.program[this.pc]!);
    this.pc++;

    if (condition !== 0) {
      this.pc += offset;
    }

    return true;
  }

  private opJump(): boolean {
    const offset = i16(this.program[this.pc]!);
    this.pc++;

    this.pc += offset;
    return true;
  }

  private opLiteral(): boolean {
    const value = this.program[this.pc]!;
    this.pc++;

    push(value);

    return true;
  }

  private opStdBltShapeToViewport(mirror: boolean): boolean {
    // CSBWin StdBltShapeToViewport / StdMirrorShapeToViewport (Viewport.cpp:2856-2866)
    const rectanglePtr = pop();
    const bitmapPtr = pop();
    const rectRef = this.resolveStdRectanglePointer(rectanglePtr);
    const bitmap = this.resolveStdBitmapPointer(bitmapPtr);
    if (!rectRef || Array.isArray(rectRef) || !bitmap) {
      return true;
    }

    this.draw.blitShapeBitmapToViewport(bitmap, rectRef, mirror);
    return true;
  }

  private opStdGraphicToViewport(mirror: boolean): boolean {
    // CSBWin StdGraphicToViewport / StdMirrorGraphicToViewport (Viewport.cpp:2906-2915)
    const rectanglePtr = pop();
    const graphicNum = pop();
    const rectRef = this.resolveStdRectanglePointer(rectanglePtr);
    if (!rectRef || Array.isArray(rectRef)) {
      return true;
    }

    const bitmap = this.context.getGraphicBitmap(graphicNum);
    if (!bitmap) {
      return true;
    }

    this.draw.blitShapeBitmapToViewport(bitmap, rectRef, mirror);
    return true;
  }

  private opGetDecoration0(): boolean {
    // CSBWin `GetDecoration0` (Viewport.cpp:2882-2885)
    const relativeCell = pop();
    const v = this.context.roomData[relativeCell]?.decorations[0] ?? 0;
    push(v);
    return true;
  }

  private opHasDecoration(): boolean {
    // CSBWin Viewport.cpp:2640-2644
    const wallDecorationPos = pop();
    const relativeCell = pop();
    const cell = this.context.roomData[relativeCell];
    const has = cell ? (cell.decorations[wallDecorationPos as 0 | 1 | 2] !== 0 ? 1 : 0) : 0;
    push(has);
    return true;
  }

  private opDoorSwitch(): boolean {
    const relativeCell = pop();
    const doorIndex = this.context.roomData[relativeCell | 0]?.decorations[1] ?? 0;
    const rec = this.context.dungeonState.getDoorRecordByIndex(doorIndex | 0);
    const hasSwitch = rec?.hasButton ? 1 : 0;
    push(hasSwitch);
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
    const level = this.context.frameMapIndex;

    const relIndex = relCellRF | 0;
    const relativeCell = BytecodeInterpreter.objectDrawingLocations[relIndex] ?? 0;

    const posAbove = dungeon.incrementLevel(new Position(mapX | 0, mapY | 0, level | 0), -1);
    if (!posAbove) return true;
    const aboveMap = dungeon.getMap(posAbove.z);
    if (!aboveMap) return true;

    const cellFlag = aboveMap.cellFlags[posAbove.x]?.[posAbove.y] ?? 0;
    const roomType = getRoomType(cellFlag);
    if (roomType !== RoomType.PIT) return true;
    if ((cellFlag & 0x08) === 0) return true;

    const cell2graphic = [0, 0, 0, 64, 63, 63, 66, 65, 65, 68, 67, 67];
    const cell2rect = [0, 0, 0, 7, 8, 6, 4, 5, 3, 1, 2, 0];
    const cell2mirror = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    if (relativeCell < 0 || relativeCell >= cell2graphic.length) return true;

    const rect = this.context.ceilingPitRectangles[cell2rect[relativeCell] ?? 0];
    if (!rect) return true;

    const bitmap = this.context.getGraphicBitmap(cell2graphic[relativeCell] ?? 0);
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
    const doorEdge = this.context.doorBitmaps[1];
    const hole = this.context.getGraphicBitmap(41);
    const rect = this.context.seeThruDoorEdgeRect;
    const trackTop = this.context.doorTrackTopRectangles;
    if (!doorEdge || !hole || !trackTop[0] || !trackTop[6]) return true;
    const tempBitmap: IndexedBitmap = { width: doorEdge.width, height: doorEdge.height, pixels: doorEdge.pixels.slice(0, 1968 * 2) };
    tag0088b2Explicit(
      hole.pixels,
      tempBitmap.pixels,
      rect,
      trackTop[0].x1 - this.context.seeThruWallsRectUByte4,
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
  // ROOM OBJECTS
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

    const facing = this.context.frameFacing;
    const idx = relCellRF | 0;
    const relativeCell = BytecodeInterpreter.objectDrawingLocations[idx] ?? 0;

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
      return true;
    }

    // `d.DoorGraphic[doorGraphicIndex]`; index 0 is F1, nearness 2 (`doc/CSBwin-src/Viewport.cpp:2598-2605`).
    const graphicIndex = doorGraphicIndex | 0;
    DrawDoor(this.draw, doorRecordIndex | 0, doorState | 0, this.context.doorGraphics[graphicIndex], 2 - graphicIndex, rectRef);
    return true;
  }

  private opStdDrawWallDecoration(): boolean {
    // CSBWin `StdDrawWallDecoration` (Viewport.cpp:2949-2956)
    const wallDecorationDrawLocation = pop();
    const wallDecorationPos = pop();
    const relativeCell = pop();

    const rd = this.context.roomData[relativeCell | 0];
    const graphicOrdinal = rd?.decorations[wallDecorationPos as 0 | 1 | 2] ?? 0;
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
    const textRN = rd?.text[wallDecorationPos as 0 | 1 | 2] ?? OBJECT_ID_EOF;
    drawWallText(this.draw, textRN, wallDecorationDrawLocation | 0, this.removeMortarJoint);
    this.removeMortarJoint = true;
    return true;
  }

  // ============================================================
  // HELPER FUNCTIONS
  // ============================================================

  /** `F4L1xy`…: the cell's map square. */
  private opCellXY(cell: number): boolean {
    const rd = this.context.roomData[cell];
    push(rd?.x ?? 0);
    push(rd?.y ?? 0);
    return true;
  }

  /** `F4L1Contents`…: the cell's first object. */
  private opCellContents(cell: number): boolean {
    push(this.context.roomData[cell]?.rn2 ?? 0);
    return true;
  }

  /** A door's state (`decorations[0]`), its record index (`[1]`), or a floor decoration (`[2]`). */
  private opCellDecoration(cell: number, index: 0 | 1 | 2): boolean {
    push(this.context.roomData[cell]?.decorations[index] ?? 0);
    return true;
  }

  /** A stair graphic of the level's wall set (`STAIR_GRAPHIC_OPCODES`). */
  private opStairGraphic(offset: number): boolean {
    push(90 + this.context.wallGraphicSet * 18 + offset);
    return true;
  }

  /** `StdRectanglePointers`, through `STD_RECTANGLE_POINTERS`. Public so that `tools/` can stand in fixed rectangles for a context without them. */
  resolveStdRectanglePointer(ptr: number): RectPos | RectPos[] | null {
    return STD_RECTANGLE_POINTERS[ptr]?.(this.context) ?? null;
  }

  private resolveStdBitmapPointer(ptr: number): IndexedBitmap | null {
    // Port of CSBWin `StdBitmapPointers()` (Viewport.cpp:2261+).
    const wall = this.context.wallBitmaps;
    const door = this.context.doorBitmaps;

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
        return this.context.viewportIndexBuffer;
      case StdBitmapPtr.BMP_StdHoleInWallBitmap:
        return this.context.getGraphicBitmap(41);

      default:
        return null;
    }
  }
}
