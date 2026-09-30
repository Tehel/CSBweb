/**
 * The dungeon view: `DrawViewport` and everything set up around it for one frame.
 *
 * It owns the interpreter context, the level's wall, door and floor/ceiling bitmaps, and
 * the viewport's palettes with the level's monster colours applied. It draws into
 * `buffer`, the 224x136 viewport; putting that on the screen, with the interface around
 * it, is `GameScreen`'s.
 */

import type { GraphicsLoader } from '../data/GraphicsLoader';
import type { MapData } from '../data/dungeonTypes';
import type { CSBGraphicsLoader } from '../data/CSBGraphicsLoader';
import { DrawViewport } from './DrawViewport';
import {
  PRISON_LEVEL_INDEX,
  PRISON_PARTY_POSITION,
  createPrisonDungeonState,
  prisonPartyPosition,
} from './intro/PrisonLevel';
import type { DungeonState } from '../engine/DungeonState';
import type { PartyFootprints } from '../engine/PartyFootprints';
import type { InterpreterContext } from './bytecode/BytecodeInterpreter';
import type { IndexedBitmap, PaletteIndexViewportBuffer } from './csbwin/CanvasBlitter';
import { createPaletteIndexViewportBuffer, cropBitmap, mirrorBitmap, tag0088b2Index } from './csbwin/CanvasBlitter';
import { extractViewportTables } from '../data/tables/ViewportTables';
import { extractObjectTables, type ObjectTables } from '../data/tables/ObjectTables';
import {
  initializeFloorCeilingIndexed,
  initializeDoorBitmapsIndexed,
  initializeWallBitmapsIndexed,
  VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT,
} from './ViewportGraphics';
import { getOrSet, Position } from '@/core';
import { OBJECT_ID_EOF } from '../core/types';

type IndexedBitmapSet = IndexedBitmap[]

export interface WallBitmapSet {
  wall: IndexedBitmapSet;
  wallMirrored: IndexedBitmapSet;
  doors: IndexedBitmapSet;
}

// Full-viewport (224×136) palette-index templates.
// `ceilingMirrored` corresponds to CSBWin `(x+y+facing)&1 == 0` path (Viewport.cpp:6752-6754).
// `floorMirrored` corresponds to CSBWin `(x+y+facing)&1 == 1` path (Viewport.cpp:6741-6744).
export interface FloorCeiling {
  normal: Uint8Array;
  mirrored: Uint8Array;
}

export interface ViewportRendererDeps {
  graphicsLoader: GraphicsLoader;
  dungeonState: DungeonState;
  /** `d.PartyFootprints`, whose magic prints `SummarizeRoomInfo` shows. */
  footprints?: PartyFootprints;
  csbGraphicsLoader?: CSBGraphicsLoader;
  /** `graphic232.palette552`: the viewport's palettes, one per light level. */
  palette552: number[][];
  /** The screen's graphics cache, which the interpreter shares with the interface. */
  graphicCache: Map<string, IndexedBitmap>;
  getGraphicBitmap: (graphicNum: number) => IndexedBitmap | null;
}

export class ViewportRenderer {
  /** What `DrawViewport` and the bytecode interpreter read and write, CSBWin's `d.` for them. */
  readonly context: InterpreterContext;
  /** The viewport, 224x136 palette indices: `d.pViewportBMP`. */
  readonly buffer: PaletteIndexViewportBuffer;
  readonly objectTables: ObjectTables;
  /**
   * The viewport's palettes, one per light level, with the current level's monster colours
   * applied; `null` when `graphics.dat` has none.
   */
  readonly viewportPalettes: number[][] | null;

  private readonly graphicsLoader: GraphicsLoader;
  private readonly dungeonState: DungeonState;
  private readonly baseViewportPalettes: number[][] | null;
  private readonly mirrorWallRectF2?: { x1: number; x2: number; y1: number; y2: number };
  private readonly mirrorWallRectF3?: { x1: number; x2: number; y1: number; y2: number };
  private lastPaletteLevel: number | null = null;
  private wallBitmapSets: Map<number, WallBitmapSet> = new Map();
  private floorCeilingCache: Map<number, FloorCeiling> = new Map();

  constructor(deps: ViewportRendererDeps) {
    this.graphicsLoader = deps.graphicsLoader;
    this.dungeonState = deps.dungeonState;

    // Extract CSBWin viewport tables from graphics.dat item 0x22e
    const viewportTables = extractViewportTables(this.graphicsLoader);
    console.log(`Extracted wallRectangles[14] from 0x22e at offset 0x${viewportTables.wallRectanglesOffset.toString(16)}`);
    this.objectTables = extractObjectTables(this.graphicsLoader, viewportTables.wallRectanglesOffset);
    this.mirrorWallRectF2 = viewportTables.mirrorWallRectF2;
    this.mirrorWallRectF3 = viewportTables.mirrorWallRectF3;
    if (deps.palette552.length > 0) {
      this.baseViewportPalettes = deps.palette552.map((pal) => pal.slice());
      this.viewportPalettes = deps.palette552.map((pal) => pal.slice());
    } else {
      this.baseViewportPalettes = null;
      this.viewportPalettes = null;
    }

    this.buffer = createPaletteIndexViewportBuffer(VIEWPORT_WIDTH, VIEWPORT_HEIGHT, 0);
    this.context = {
      wallBitmaps: [],
      doorBitmaps: [],
      wallRectangles: viewportTables.wallRectangles,
      floorPitRectangles: viewportTables.floorPitRect,
      ceilingPitRectangles: viewportTables.ceilingPit,
      teleporterRectangles: viewportTables.teleporterRectangles,
      stairEdgeRectangles: viewportTables.stairEdgeRect,
      stairFacingDownRectangles: viewportTables.stairFacingDownRect,
      stairFacingUpRectangles: viewportTables.stairFacingUpRect,
      doorTrackTopRectangles: viewportTables.doorTrackTopRect,
      doorFrameRectangles: viewportTables.doorFrameRect,
      doorRects: viewportTables.doorRects,
      seeThruWallsRect: viewportTables.seeThruWallsRect,
      seeThruWallsRect2: viewportTables.seeThruWallsRect2,
      seeThruWallsRectUByte4: viewportTables.seeThruWallsRectUByte4,
      seeThruWallsRectUByte6: viewportTables.seeThruWallsRectUByte6,
      seeThruDoorEdgeRect: viewportTables.seeThruDoorEdgeRect,
      championPortraitRect: viewportTables.championPortraitRect,
      wallGraphicSet: 0,
      backgroundGraphicSet: 0,
      getGraphicBitmap: deps.getGraphicBitmap,
      graphicCache: deps.graphicCache,
      objectTables: this.objectTables,
      csbGraphics: deps.csbGraphicsLoader,
      dungeonState: this.dungeonState,
      footprints: deps.footprints,
      viewportIndexBuffer: this.buffer,
      seeThroughWalls: false,
      roomData: [],
      doorOrnaments: Array.from({ length: 17 }, (_, i): [number, number] => (i >= 15 ? [i + 286, 1] : [0, 0])),
    };
  }

  /**
   * The level the party is on, for the monster colours: re-applied only when it changes,
   * whether or not the view is drawn (it is not while the party sleeps).
   */
  selectLevel(z: number): void {
    if (this.lastPaletteLevel === z) return;
    this.applyMonsterPaletteOverrides(this.dungeonState.getMap(z));
    this.lastPaletteLevel = z;
  }

  /**
   * One frame of the dungeon seen from `position`. `seeThroughWalls` is CSBWin's
   * `d.SeeThruWalls`, read as a boolean each frame:
   * `case SeeThroughWalls: push(d.SeeThruWalls?1:0);` (doc/CSBwin-src/Viewport.cpp:2638).
   * The engine maintains the counter (`Magic.cpp:1314` increments it, TT_73 decrements
   * it — see `TimerSystem.processSeeThruWallsTimer`). `word1868` is `d.Word1868`, which
   * hides the Fluxcages' shimmer (`InterpreterContext.word1868`).
   */
  draw(position: Position, facing: number, seeThroughWalls: boolean, word1868: boolean): void {
    this.context.word1868 = word1868;
    this.drawViewportFrame(this.dungeonState, position, facing, this.dungeonState.getMap(position.z), seeThroughWalls);
  }

  private resetViewportPalettes(): void {
    if (!this.baseViewportPalettes || !this.viewportPalettes) return;
    const count = Math.min(this.baseViewportPalettes.length, this.viewportPalettes.length);
    for (let i = 0; i < count; i++) {
      const base = this.baseViewportPalettes[i];
      if (!base) continue;
      const target = this.viewportPalettes[i];
      if (!target) {
        this.viewportPalettes[i] = base.slice();
        continue;
      }
      for (let j = 0; j < base.length; j++) target[j] = base[j];
    }
  }

  private applySpecialColorScheme(whichColor: number, schemeIndex: number): void {
    const tables = this.objectTables;
    if (!this.viewportPalettes) return;
    const scheme = tables.specialColors[schemeIndex];
    if (!scheme) return;
    for (let i = 0; i < this.viewportPalettes.length; i++) {
      const palette = this.viewportPalettes[i];
      if (!palette) continue;
      const entry = scheme.paletteEntries[i];
      if (entry !== undefined) palette[whichColor] = entry;
    }
    if (whichColor >= 0 && whichColor < tables.monsterColorMapMedium.length) {
      tables.monsterColorMapMedium[whichColor] = scheme.monsterColorMapMedium;
    }
    if (whichColor >= 0 && whichColor < tables.monsterColorMapFar.length) {
      tables.monsterColorMapFar[whichColor] = scheme.monsterColorMapFar;
    }
  }

  private applyMonsterPaletteOverrides(map?: MapData | null): void {
    if (!this.viewportPalettes) return;
    if (!this.objectTables.specialColors || this.objectTables.specialColors.length === 0) return;

    this.resetViewportPalettes();
    this.applySpecialColorScheme(9, 8);
    this.applySpecialColorScheme(10, 12);

    const monsterTypes = map?.monsterTypes ?? [];
    for (const monsterType of monsterTypes) {
      if (monsterType < 0 || monsterType >= this.objectTables.monsterGraphics.length) continue;
      const graphic = this.objectTables.monsterGraphics[monsterType];
      if (!graphic) continue;
      const lowNibble = graphic.uByte11 & 0x0f;
      if (lowNibble !== 0) this.applySpecialColorScheme(9, lowNibble - 1);
      const highNibble = (graphic.uByte11 >> 4) & 0x0f;
      if (highNibble !== 0) this.applySpecialColorScheme(10, highNibble - 1);
    }
  }

  /**
   * Everything `DrawViewport` needs set up around it, for one frame.
   *
   * Separate from `draw` so the prison-door screen can run the same renderer over its
   * synthetic 5x5 level (`renderPrisonInterior`, `intro/PrisonLevel.ts`) — which is what
   * CSBWin does when it swaps `d.LevelCellFlags` and `d.pCurLevelDesc` and calls
   * `DrawViewport(2, 2, 0)` (`doc/CSBwin-src/CSBCode.cpp:9556-9583`). The palette
   * bookkeeping stays with `selectLevel`: it belongs to the level the party is on.
   */
  private drawViewportFrame(
    dungeonState: DungeonState,
    position: Position,
    facing: number,
    map: MapData | null,
    seeThroughWalls: boolean,
  ): void {
    const { x, y, z } = position;

    // Select current wall + floor/ceiling style based on map descriptor (CSBWin LEVELDESC.word14 bits).
    const wallGraphicSet = map?.descriptor.mapGraphicsStyle ?? 0;
    const backgroundGraphicSet = map?.descriptor.floorCeilingStyle ?? 0;
    this.context.wallGraphicSet = wallGraphicSet;
    this.context.backgroundGraphicSet = backgroundGraphicSet;
    this.context.frameMapIndex = z;
    this.context.numWallDecoration = map?.descriptor.wallGraphicsCount ?? 0;

    // CSBWin `ReadGraphicsForLevel()` (Code390e.cpp:180-199): DoorGraphic[3][2] is derived from Door1Type/Door2Type.
    const doorType0 = map?.descriptor.doorType0Index ?? 0;
    const doorType1 = map?.descriptor.doorType1Index ?? 0;
    const base0 = 108 + 3 * doorType0;
    const base1 = 108 + 3 * doorType1;
    // DoorGraphic[0]=F1 (nearness=2) = base+2; DoorGraphic[1]=F2 = base+1; DoorGraphic[2]=F3 = base+0
    this.context.doorGraphics = [
      [base0 + 2, base1 + 2],
      [base0 + 1, base1 + 1],
      [base0 + 0, base1 + 0],
    ];

    // `d.Word2514[i] = { 303 + DoorDecorationTOC[i], Byte4122[DoorDecorationTOC[i]] }`
    // (`doc/CSBwin-src/Code390e.cpp:275-284`).
    const doorOrnaments = this.context.doorOrnaments!;
    const doorDecorationTOC = map?.doorDecorationTOC ?? [];
    for (let i = 0; i < doorDecorationTOC.length; i++) {
      const decoration = doorDecorationTOC[i];
      doorOrnaments[i] = [303 + decoration, this.objectTables.doorOrnamentRectSetIndex[decoration]];
    }

    // `d.DoorTOC[2] = d.DoorCharacteristics[doorType0Index/doorType1Index]`
    // (`doc/CSBwin-src/CSBCode.cpp:5780-5783`) — the level's two door "types" resolved
    // to their characteristics word, bit 10 of which flags a "lightning door" and
    // drives `DrawDoor`'s per-frame random mirror/flip (`CSBCode.cpp:4156-4166`).
    const doorCharacteristics = this.objectTables.doorCharacteristics;
    this.context.doorTOC = doorCharacteristics
      ? [doorCharacteristics[doorType0] ?? 0, doorCharacteristics[doorType1] ?? 0]
      : [0, 0];

    this.context.seeThroughWalls = seeThroughWalls;

    // CSBWin: `d.UseMirrorImages = (x + y + facing) & 1` (Viewport.cpp:6740)
    const useMirrorImages = ((x + y + facing) & 1) !== 0;
    this.context.useMirrorImages = useMirrorImages;

    // Compose floor/ceiling background (CSBWin: FloorAndCeilingOnly + conditional Mirror).
    const fc = this.getFloorCeiling(backgroundGraphicSet);
    this.buffer.pixels.set(useMirrorImages ? fc.mirrored : fc.normal);

    // Select bitmaps set for this frame (CSBWin: mirrors swap some pointers when `UseMirrorImages != 0`).
    const wb = this.getBitmapsSet(wallGraphicSet);
    this.context.wallBitmaps = useMirrorImages ? wb.wallMirrored : wb.wall;
    this.context.doorBitmaps = wb.doors;
    this.context.doorSwitchRects = [];
    this.context.viewportObjectButtons = Array.from({ length: 6 }, () => ({ x1: 255, x2: 0, y1: 0, y2: 0 }));
    this.context.viewportObjectRNs = new Array(5).fill(OBJECT_ID_EOF);
    this.context.facingAlcove = false;
    this.context.facingViAltar = false;
    this.context.facingWaterFountain = false;

    // Per-frame context for opcodes that need global state (CSBWin Interpret() params).
    this.context.frameFacing = facing;

    // Execute the main viewport drawing function (writes to index buffer via interpreter)
    DrawViewport(this.context, dungeonState, position, facing);
  }

  private getBitmapsSet(wallGraphicSet: number): WallBitmapSet {
    return getOrSet(this.wallBitmapSets, wallGraphicSet, () => {
      const wall = initializeWallBitmapsIndexed(this.graphicsLoader, wallGraphicSet);
      const wallMirrored = this.createMirrorModeWallBitmaps(wall);
      const doors = initializeDoorBitmapsIndexed(this.graphicsLoader, wallGraphicSet);
      return { wall, wallMirrored, doors }
    });
  }

  private getFloorCeiling(backgroundGraphicSet: number): FloorCeiling {
    return getOrSet(this.floorCeilingCache, backgroundGraphicSet, () => {
      const { floor, ceiling } = initializeFloorCeilingIndexed(this.graphicsLoader, backgroundGraphicSet);
      const normal = this.buildFloorCeilingTemplate(ceiling, floor, true, false);
      const mirrored = this.buildFloorCeilingTemplate(ceiling, floor, false, true);
      return { normal, mirrored }
    });
  }

  private createMirrorModeWallBitmaps(normal: IndexedBitmapSet): IndexedBitmapSet {
    if (normal.length < 7) {
      throw new Error(`Expected 7 wall bitmaps, got ${normal.length}`);
    }

    // CSBWin behavior (Viewport.cpp:6741-6750 + Code390e.cpp:104-113):
    // - When `UseMirrorImages != 0`, F0L1/F0R1 are swapped by using mirrored copies of the opposite side.
    // - Other distances use mirrored copies of their own bitmaps.
    // - Corner bitmaps (index 5/6) are not swapped here.
    const out = normal.slice();
    out[0] = mirrorBitmap(normal[1]); // F0R1 becomes mirror of original F0L1
    out[1] = mirrorBitmap(normal[0]); // F0L1 becomes mirror of original F0R1
    out[2] = mirrorBitmap(normal[2]); // F1

    const wallRects = this.context.wallRectangles;
    if (wallRects && this.mirrorWallRectF2 && this.mirrorWallRectF3) {
      const derivedF3 = this.buildMirrorWallBitmap(normal[4], wallRects[0], this.mirrorWallRectF3, 11);
      const derivedF2 = this.buildMirrorWallBitmap(normal[3], wallRects[3], this.mirrorWallRectF2, 8);
      out[4] = derivedF3 ?? mirrorBitmap(normal[4]);
      out[3] = derivedF2 ?? mirrorBitmap(normal[3]);
    } else {
      out[4] = mirrorBitmap(normal[4]);
      out[3] = mirrorBitmap(normal[3]);
    }
    // out[5]/out[6] remain as-is (F3L2 + its mirror).
    return out;
  }

  private buildMirrorWallBitmap(
    source: IndexedBitmap,
    rect: { srcWidth?: number; srcHeight?: number },
    mirrorRect: { x1: number; x2: number; y1: number; y2: number },
    srcOffsetXBytes: number
  ): IndexedBitmap | null {
    const srcWidth = rect.srcWidth ?? source.width;
    const srcHeight = rect.srcHeight ?? source.height;
    if (srcWidth <= 0 || srcHeight <= 0) return null;

    const cropped = cropBitmap(source, srcWidth, srcHeight);
    const mirrored = mirrorBitmap(cropped);

    const dstPixels = new Uint8Array(srcWidth * srcHeight);
    dstPixels.fill(10);
    const dst = { width: srcWidth, height: srcHeight, pixels: dstPixels };

    const srcOffsetX = srcOffsetXBytes;
    const rectPos = {
      x1: mirrorRect.x1,
      y1: mirrorRect.y1,
      x2: mirrorRect.x2,
      y2: mirrorRect.y2,
      srcX: srcOffsetX,
      srcY: 0,
      srcWidth,
      srcHeight,
    };

    tag0088b2Index(mirrored, dst, rectPos, -1);
    return dst;
  }

  private buildFloorCeilingTemplate(
    ceiling: IndexedBitmap,
    floor: IndexedBitmap,
    mirrorCeiling: boolean,
    mirrorFloor: boolean
  ): Uint8Array {
    // CSBWin geometry constants from Viewport.cpp:
    // - Mirror ceiling height = 0x1d (29) (Viewport.cpp:6753)
    // - Mirror floor height   = 0x46 (70) (Viewport.cpp:6743)
    // These match the memory sizes set up in CSBCode.cpp:10122-10123:
    //   3248 (112*29), 4144 (112*37), 7840 (112*70) for (ceiling, black, floor).
    const CEILING_H = 0x1d;
    const FLOOR_H = 0x46;
    const BLACK_H = VIEWPORT_HEIGHT - CEILING_H - FLOOR_H;
    const FLOOR_Y = CEILING_H + BLACK_H;

    const dst = new Uint8Array(VIEWPORT_WIDTH * VIEWPORT_HEIGHT);
    this.blitFullWidthBitmap(dst, 0, CEILING_H, ceiling, mirrorCeiling);
    // Black gap is already 0-filled.
    this.blitFullWidthBitmap(dst, FLOOR_Y, FLOOR_H, floor, mirrorFloor);
    return dst;
  }

  private blitFullWidthBitmap(
    dst: Uint8Array,
    dstY: number,
    dstH: number,
    src: IndexedBitmap,
    mirrorX: boolean
  ): void {
    const copyW = Math.min(src.width, VIEWPORT_WIDTH);
    const copyH = Math.min(src.height, dstH);

    for (let y = 0; y < copyH; y++) {
      const srcRow = y * src.width;
      const dstRow = (dstY + y) * VIEWPORT_WIDTH;
      for (let x = 0; x < copyW; x++) {
        const v = src.pixels[srcRow + x] & 0x0f;
        const dx = mirrorX ? VIEWPORT_WIDTH - 1 - x : x;
        dst[dstRow + dx] = v;
      }
    }
  }

  /**
   * `DrawViewport(2, 2, 0)` over the synthetic prison level — the corridor seen through the
   * doorway on the entrance screen (`doc/CSBwin-src/CSBCode.cpp:9583`). Returns a copy of
   * `d.pViewportBMP`, which the door animation re-blits on every frame.
   *
   * `lastPaletteLevel` is cleared so the first real frame after this re-applies the level's
   * monster palette overrides; this level has none and must not be allowed to stand in for
   * one.
   */
  renderPrisonInterior(seeThroughWalls: boolean): IndexedBitmap {
    const seed = this.dungeonState.getData().header.randomSeed ?? 0;
    const dungeonState = createPrisonDungeonState(seed);
    this.context.word1868 = false;
    this.drawViewportFrame(
      dungeonState,
      prisonPartyPosition(),
      PRISON_PARTY_POSITION.facing,
      dungeonState.getMap(PRISON_LEVEL_INDEX),
      seeThroughWalls,
    );
    this.lastPaletteLevel = null;
    const src = this.buffer;
    return { width: src.width, height: src.height, pixels: Uint8Array.from(src.pixels) };
  }
}
