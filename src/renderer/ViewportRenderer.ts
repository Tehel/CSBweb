/**
 * Viewport Renderer - Integration module
 *
 * This module connects all the pieces together:
 * - Graphics loading
 * - Bytecode interpreter
 * - DrawViewport main loop
 * - Canvas rendering
 */

import { GraphicsLoader } from '../data/GraphicsLoader';
import type { PartyState } from '../engine/gameTypes';
import type { CreatureRecord, MapData } from '../data/dungeonTypes';
import type { CSBGraphicsLoader } from '../data/CSBGraphicsLoader';
import { DrawViewport } from './DrawViewport';
import { DungeonState } from '../engine/DungeonState';
import type { IndexedBitmap } from './csbwin/CanvasBlitter';
import {
  clearIndex,
  createPaletteIndexViewportBuffer,
  tag0088b2Index,
  updateImageDataFromIndex,
  updateImageDataFromIndexWithViewportPalette,
} from './csbwin/CanvasBlitter';
import { extractViewportTables } from './csbwin/ViewportTables';
import { extractObjectTables } from './csbwin/ObjectTables';
import { extractUITables, type UITables } from './csbwin/UITables';
import { loadFontData } from './csbwin/TextRenderer';
import { ImageFormat } from '../core/imageDecoder';
import {
  initializeFloorCeilingIndexed,
  initializeDoorBitmapsIndexed,
  initializeWallBitmapsIndexed,
  VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT,
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  VIEWPORT_X,
  VIEWPORT_Y,
} from './ViewportGraphics';
import { getOrSet, Position } from '@/core';
import { OBJECT_ID_EOF } from '../core/types';
import { createUIState, UIMode, type ObjectMoveHandler, type UIState } from './ui/UIState';
import {
  drawStaticUIFrame,
} from './ui/Draw';
import {
  selectPaletteIndexForLightLevel,
} from './ui/Light';
import {
  ViewportCursorAction,
  hasCursorObject,
  isDoorSwitchHit,
  isWallDecorationHit,
  resolveViewportCursorAction,
  tryPickViewportObject,
  tryUseFrontWallItem,
} from './ui/ViewportPicking';
import {
  drawCursorItem,
  drawHoverHighlights,
  enqueueMouseClick,
  enqueueMouseUnclick,
  processMouseQueue,
  syncInventoryButtons,
  updateButtonLists,
} from './ui/Mouse';
import {
  drawAttackButtons,
  drawAttackPanel,
  drawSpellControls,
  drawSpellPanel,
} from './ui/MagicPanel';
import {
  drawInventoryBackground,
  drawInventoryScreen,
  syncOpenChest,
} from './ui/Inventory';
import {
} from './ui/Feeding';
import {
  drawHeldObjectName,
  drawPartyStatus,
} from './ui/Character';
import {
  drawMessageLines,
  shadeRectIndex,
} from './ui/Draw';
import type { ViewingFilterOptions, ViewingFilterResult } from '../engine/DsaSystem';

type IndexedBitmapSet = IndexedBitmap[]

export { UIMode } from './ui/UIState';

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


/**
 * Main ViewportRenderer class
 * Manages viewport rendering state and provides API for rendering
 */
export class ViewportRenderer {
  private csbGraphicsLoader?: CSBGraphicsLoader;
  private canvas: HTMLCanvasElement | null = null;
  private screenCtx: CanvasRenderingContext2D | null = null;
  private screenImageData: ImageData | null = null; // RGBA staging for present
  private palette: number[] | null = null;
  private uiPalette: number[] | null = null;
  private baseViewportPalettes: number[][] | null = null;
  private viewportPalettes: number[][] | null = null;
  private lastPaletteLevel: number | null = null;
  private initialized: boolean = false;

  private wallBitmapSets: Map<number, WallBitmapSet> = new Map();
  private mirrorWallRectF2?: { x1: number; x2: number; y1: number; y2: number };
  private mirrorWallRectF3?: { x1: number; x2: number; y1: number; y2: number };
  private lastRenderPosition: Position | null = null;
  private lastRenderFacing: number = 0;
  private floorCeilingCache: Map<number, FloorCeiling> = new Map();
  private monsterAttackState: WeakMap<CreatureRecord, boolean[]> = new WeakMap();

  /** Everything the UI modules share. See `ui/UIState.ts`. */
  private readonly ui: UIState;

  constructor(graphicsLoader: GraphicsLoader, dungeonState: DungeonState, csbGraphicsLoader?: CSBGraphicsLoader) {
    this.csbGraphicsLoader = csbGraphicsLoader;
    this.ui = createUIState(graphicsLoader, dungeonState, {
      getGraphicBitmap: (graphicNum, format) => this.getGraphicBitmap(graphicNum, format),
      renderLastFrame: () => this.renderLastFrame(),
    });
  }

  /**
   * Initialize the viewport renderer
   * Loads all necessary graphics and sets up the rendering context
   */
  async initialize(canvas: HTMLCanvasElement): Promise<void> {
    if (this.initialized) return;

    console.log('Initializing viewport renderer...');

    // Create full screen canvas (320×200)
    this.canvas = canvas;
    this.screenCtx = this.canvas.getContext('2d');
    if (!this.screenCtx) throw new Error('Failed to create screen 2D context');
    this.screenImageData = this.screenCtx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);

    // Get palette
    const palette = this.ui.graphicsLoader.getPalette(0);
    this.palette = palette;
    console.log('Got palette from graphics loader');

    // Extract CSBWin viewport tables from graphics.dat item 0x22e
    const viewportTables = extractViewportTables(this.ui.graphicsLoader);
    console.log(`Extracted wallRectangles[14] from 0x22e at offset 0x${viewportTables.wallRectanglesOffset.toString(16)}`);
    const objectTables = extractObjectTables(this.ui.graphicsLoader, viewportTables.wallRectanglesOffset);
    this.ui.objectTables = objectTables;
    this.mirrorWallRectF2 = viewportTables.mirrorWallRectF2;
    this.mirrorWallRectF3 = viewportTables.mirrorWallRectF3;
    this.ui.uiTables = extractUITables(this.ui.graphicsLoader);
    const palette552 = this.ui.uiTables.graphic232.palette552;
    if (palette552 && palette552.length > 0) {
      this.baseViewportPalettes = palette552.map((pal) => pal.slice());
      this.viewportPalettes = palette552.map((pal) => pal.slice());
      this.uiPalette = this.baseViewportPalettes[0] ?? this.palette;
    } else {
      this.uiPalette = this.palette;
    }
    this.ui.fontData = loadFontData(this.ui.graphicsLoader);

    const viewportIndexBuffer = createPaletteIndexViewportBuffer(VIEWPORT_WIDTH, VIEWPORT_HEIGHT, 0);
    this.ui.screenIndexBuffer = createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0);
    const mouseQueueLength = 8;
    this.ui.mouseQueue = Array.from({ length: mouseQueueLength }, () => ({ num: 0, x: 0, y: 0 }));
    this.ui.mouseQStart = 0;
    this.ui.mouseQEnd = mouseQueueLength - 1;
    updateButtonLists(this.ui);

    // Create interpreter context
    this.ui.context = {
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
      seeThruDoorEdgeRect: viewportTables.seeThruDoorEdgeRect,
      wallGraphicSet: 0,
      backgroundGraphicSet: 0,
      getGraphicBitmap: (n: number) => this.getGraphicBitmap(n),
      graphicCache: this.ui.graphicCache,
      objectTables,
      csbGraphics: this.csbGraphicsLoader,
      dungeonState: this.ui.dungeonState,
      viewportContext: this.screenCtx,
      viewportIndexBuffer,
      seeThroughWalls: false,
      roomData: [],
      onMonsterAttackState: (monster, index, soundOrdinal, isAttacking) =>
        this.handleMonsterAttackState(monster, index, soundOrdinal, isAttacking),
    };

    this.initialized = true;
    console.log('Viewport renderer initialized successfully');
  }

  getUITables(): UITables | null {
    return this.ui.uiTables;
  }

  /* Mouse entry points for the host page; the work is in `ui/Mouse.ts`. */

  enqueueMouseClick(x: number, y: number, buttons: number): void {
    enqueueMouseClick(this.ui, x, y, buttons);
  }

  enqueueMouseUnclick(): void {
    enqueueMouseUnclick(this.ui);
  }

  processMouseQueue(): void {
    processMouseQueue(this.ui);
  }

  /* Viewport picking entry points; the work is in `ui/ViewportPicking.ts`. */

  isWallDecorationHit(x: number, y: number): boolean {
    return isWallDecorationHit(this.ui, x, y);
  }

  isDoorSwitchHit(x: number, y: number): boolean {
    return isDoorSwitchHit(this.ui, x, y);
  }

  tryPickViewportObject(x: number, y: number): boolean {
    return tryPickViewportObject(this.ui, x, y);
  }

  hasCursorObject(): boolean {
    return hasCursorObject(this.ui);
  }

  resolveViewportCursorAction(x: number, y: number): ViewportCursorAction | null {
    return resolveViewportCursorAction(this.ui, x, y);
  }

  tryUseFrontWallItem(x: number, y: number): boolean {
    return tryUseFrontWallItem(this.ui, x, y);
  }

  setPlaySound(playSound?: (soundId: number, rateIdx?: number, distance?: number) => void): void {
    this.ui.playSound = playSound;
  }

  setViewingFilter(handler?: (options: ViewingFilterOptions) => ViewingFilterResult | null): void {
    this.ui.viewingFilter = handler;
  }

  setObjectMoveHandler(handler?: ObjectMoveHandler): void {
    this.ui.onObjectMove = handler;
  }

  setSpellCastHandler(handler?: (chIdx: number, incantation: number[], totalManaCost: number) => number | void): void {
    this.ui.onSpellCast = handler;
  }

  setPartyState(state: PartyState | null): void {
    this.ui.partyState = state;
    syncInventoryButtons(this.ui);
  }

  setHoverPoint(point: { x: number; y: number } | null): void {
    this.ui.hoverPoint = point;
  }

  setShowAttackPanel(show: boolean): void {
    this.ui.showAttackPanel = show;
  }

  isAttackPanelVisible(): boolean {
    return this.ui.showAttackPanel;
  }

  setUIMode(mode: UIMode): void {
    this.ui.uiMode = mode;
    updateButtonLists(this.ui);
    syncInventoryButtons(this.ui);
  }

  isInventoryOpen(): boolean {
    return (this.ui.partyState?.selectedCharacterIndex ?? -1) >= 0;
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
    const tables = this.ui.objectTables;
    if (!tables || !this.viewportPalettes) return;
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
    if (!this.ui.objectTables || !this.viewportPalettes) return;
    if (!this.ui.objectTables.specialColors || this.ui.objectTables.specialColors.length === 0) return;

    this.resetViewportPalettes();
    this.applySpecialColorScheme(9, 8);
    this.applySpecialColorScheme(10, 12);

    const monsterTypes = map?.monsterTypes ?? [];
    for (const monsterType of monsterTypes) {
      if (monsterType < 0 || monsterType >= this.ui.objectTables.monsterGraphics.length) continue;
      const graphic = this.ui.objectTables.monsterGraphics[monsterType];
      if (!graphic) continue;
      const lowNibble = graphic.uByte11 & 0x0f;
      if (lowNibble !== 0) this.applySpecialColorScheme(9, lowNibble - 1);
      const highNibble = (graphic.uByte11 >> 4) & 0x0f;
      if (highNibble !== 0) this.applySpecialColorScheme(10, highNibble - 1);
    }
  }

  /**
   * Render the viewport for a given party position and facing
   */
  render(position: Position, facing: number): void {
    const { x, y, z } = position;
    if (!this.initialized || !this.ui.context || !this.canvas || !this.screenCtx || !this.screenImageData || !this.palette) {
      throw new Error('Renderer not initialized. Call initialize() first.');
    }

    if (!this.ui.context.viewportIndexBuffer) throw new Error('Missing viewportIndexBuffer');
    this.lastRenderPosition = new Position(x, y, z);
    this.lastRenderFacing = facing;

    // Select current wall + floor/ceiling style based on map descriptor (CSBWin LEVELDESC.word14 bits).
    const map = this.ui.dungeonState.getMap(z);
    const wallGraphicSet = map?.descriptor.mapGraphicsStyle ?? 0;
    const backgroundGraphicSet = map?.descriptor.floorCeilingStyle ?? 0;
    this.ui.context.wallGraphicSet = wallGraphicSet;
    this.ui.context.backgroundGraphicSet = backgroundGraphicSet;
    this.ui.context.frameMapIndex = z;
    this.ui.context.numWallDecoration = map?.descriptor.wallGraphicsCount ?? 0;
    if (this.lastPaletteLevel !== z) {
      this.applyMonsterPaletteOverrides(map);
      this.lastPaletteLevel = z;
    }

    // CSBWin `ReadGraphicsForLevel()` (Code390e.cpp:180-199): DoorGraphic[3][2] is derived from Door1Type/Door2Type.
    const doorType0 = map?.descriptor.doorType0Index ?? 0;
    const doorType1 = map?.descriptor.doorType1Index ?? 0;
    const base0 = 108 + 3 * doorType0;
    const base1 = 108 + 3 * doorType1;
    // DoorGraphic[0]=F1 (nearness=2) = base+2; DoorGraphic[1]=F2 = base+1; DoorGraphic[2]=F3 = base+0
    this.ui.context.doorGraphics = [
      [base0 + 2, base1 + 2],
      [base0 + 1, base1 + 1],
      [base0 + 0, base1 + 0],
    ];

    // CSBWin reads the See-Thru-Walls counter as a boolean each frame:
    // `case SeeThroughWalls: push(d.SeeThruWalls?1:0);` (doc/CSBwin-src/Viewport.cpp:2638).
    // The engine already maintains the counter (`Magic.cpp:1314` increments it, TT_73
    // decrements it — see `TimerSystem.processSeeThruWallsTimer`).
    this.ui.context.seeThroughWalls = (this.ui.partyState?.seeThruWalls ?? 0) !== 0;

    // CSBWin: `d.UseMirrorImages = (x + y + facing) & 1` (Viewport.cpp:6740)
    const useMirrorImages = ((x + y + facing) & 1) !== 0;
    this.ui.context.useMirrorImages = useMirrorImages;

    // Compose floor/ceiling background (CSBWin: FloorAndCeilingOnly + conditional Mirror).
    const fc = this.getFloorCeiling(backgroundGraphicSet);
    this.ui.context.viewportIndexBuffer.pixels.set(useMirrorImages ? fc.mirrored : fc.normal);

    // Select bitmaps set for this frame (CSBWin: mirrors swap some pointers when `UseMirrorImages != 0`).
    const wb = this.getBitmapsSet(wallGraphicSet);
    this.ui.context.wallBitmaps = useMirrorImages ? wb.wallMirrored : wb.wall;
    this.ui.context.doorBitmaps = wb.doors;
    this.ui.context.wallDecorationRects = [];
    this.ui.context.doorSwitchRects = [];
    this.ui.context.viewportObjectButtons = Array.from({ length: 6 }, () => ({ x1: 255, x2: 0, y1: 0, y2: 0 }));
    this.ui.context.viewportObjectRNs = new Array(5).fill(OBJECT_ID_EOF);
    this.ui.context.facingAlcove = false;
    this.ui.context.facingViAltar = false;
    this.ui.context.facingWaterFountain = false;

    // Per-frame context for opcodes that need global state (CSBWin Interpret() params).
    this.ui.context.frameFacing = facing;

    // Execute the main viewport drawing function (writes to index buffer via interpreter)
    DrawViewport(this.ui.context, this.ui.dungeonState, position, facing);

    this.presentViewport();
  }

  private handleMonsterAttackState(
    monster: CreatureRecord,
    index: number,
    soundOrdinal: number,
    isAttacking: boolean
  ): void {
    let entry = this.monsterAttackState.get(monster);
    if (!entry) {
      entry = [];
      this.monsterAttackState.set(monster, entry);
    }
    const prev = entry[index] ?? false;
    entry[index] = isAttacking;
    if (!isAttacking || prev) return;
    if (soundOrdinal <= 0) return;
    this.playMonsterAttackSound(soundOrdinal);
  }

  private playMonsterAttackSound(soundOrdinal: number): void {
    if (!this.ui.playSound) return;
    if (!this.ui.objectTables || !this.ui.uiTables) return;
    // CSBWin: ordinal -> uByte9672 -> sound1772[word0]
    const soundNum = this.ui.objectTables.monsterAttackSounds[soundOrdinal - 1] ?? 0;
    if (!soundNum) return;
    const entry = this.ui.uiTables.graphic232.soundTable[soundNum];
    if (!entry) return;
    const soundId = entry.word0 | 0;
    if (!soundId) return;
    this.ui.playSound(soundId);
  }

  private getBitmapsSet(wallGraphicSet: number): WallBitmapSet {
    return getOrSet(this.wallBitmapSets, wallGraphicSet, () => {
      const wall = initializeWallBitmapsIndexed(this.ui.graphicsLoader, wallGraphicSet);
      const wallMirrored = this.createMirrorModeWallBitmaps(wall);
      const doors = initializeDoorBitmapsIndexed(this.ui.graphicsLoader, wallGraphicSet);
      return { wall, wallMirrored, doors }
    });
  }

  private getFloorCeiling(backgroundGraphicSet: number): FloorCeiling {
    return getOrSet(this.floorCeilingCache, backgroundGraphicSet, () => {
      const { floor, ceiling } = initializeFloorCeilingIndexed(this.ui.graphicsLoader, backgroundGraphicSet);
      const normal = this.buildFloorCeilingTemplate(ceiling, floor, true, false);
      const mirrored = this.buildFloorCeilingTemplate(ceiling, floor, false, true);
      return { normal, mirrored }
    });
  }

  private getGraphicBitmap(graphicNum: number, format: ImageFormat = ImageFormat.IMG1): IndexedBitmap | null {
    if (graphicNum < 0) return null;
    const key = `${graphicNum}-${format}`;
    const cached = this.ui.graphicCache.get(key);
    if (cached) return cached;
    try {
      const decoded = this.ui.graphicsLoader.getImage(graphicNum, format);
      const pixels = decoded.pixels instanceof Uint8Array ? decoded.pixels : Uint8Array.from(decoded.pixels as ArrayLike<number>);
      const bmp: IndexedBitmap = { width: decoded.width, height: decoded.height, pixels };
      this.ui.graphicCache.set(key, bmp);
      return bmp;
    } catch {
      return null;
    }
  }

  private createMirrorModeWallBitmaps(normal: IndexedBitmapSet): IndexedBitmapSet {
    if (normal.length < 7) {
      throw new Error(`Expected 7 wall bitmaps, got ${normal.length}`);
    }

    // CSBWin behavior (Viewport.cpp:6741-6750 + Code390e.cpp:104-113):
    // - When `UseMirrorImages != 0`, F0L1/F0R1 are swapped by using mirrored copies of the opposite side.
    // - Other distances use mirrored copies of their own bitmaps.
    // - Corner bitmaps (index 5/6) are not swapped here.
    const mirror = (b: IndexedBitmap) => this.mirrorIndexedBitmap(b);

    const out = normal.slice();
    out[0] = mirror(normal[1]); // F0R1 becomes mirror of original F0L1
    out[1] = mirror(normal[0]); // F0L1 becomes mirror of original F0R1
    out[2] = mirror(normal[2]); // F1

    const wallRects = this.ui.context?.wallRectangles;
    if (wallRects && this.mirrorWallRectF2 && this.mirrorWallRectF3) {
      const derivedF3 = this.buildMirrorWallBitmap(normal[4], wallRects[0], this.mirrorWallRectF3, 11);
      const derivedF2 = this.buildMirrorWallBitmap(normal[3], wallRects[3], this.mirrorWallRectF2, 8);
      out[4] = derivedF3 ?? mirror(normal[4]);
      out[3] = derivedF2 ?? mirror(normal[3]);
    } else {
      out[4] = mirror(normal[4]);
      out[3] = mirror(normal[3]);
    }
    // out[5]/out[6] remain as-is (F3L2 + its mirror).
    return out;
  }

  private mirrorIndexedBitmap(source: IndexedBitmap): IndexedBitmap {
    const { width, height, pixels } = source;
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        out[row + (width - 1 - x)] = pixels[row + x];
      }
    }
    return { width, height, pixels: out };
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

    const cropped = this.cropIndexedBitmap(source, srcWidth, srcHeight);
    const mirrored = this.mirrorIndexedBitmap(cropped);

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

  private cropIndexedBitmap(source: IndexedBitmap, width: number, height: number): IndexedBitmap {
    const srcW = source.width;
    const srcH = source.height;
    const outW = Math.max(0, width | 0);
    const outH = Math.max(0, height | 0);
    const outPixels = new Uint8Array(outW * outH);
    if (outW === 0 || outH === 0) return { width: outW, height: outH, pixels: outPixels };

    const copyW = Math.min(outW, srcW);
    const copyH = Math.min(outH, srcH);
    for (let y = 0; y < copyH; y++) {
      const srcRow = y * srcW;
      const dstRow = y * outW;
      for (let x = 0; x < copyW; x++) {
        outPixels[dstRow + x] = source.pixels[srcRow + x];
      }
    }
    return { width: outW, height: outH, pixels: outPixels };
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

  private presentViewport(): void {
    if (!this.ui.context?.viewportIndexBuffer || !this.screenCtx || !this.screenImageData || !this.palette || !this.ui.screenIndexBuffer) return;

    clearIndex(this.ui.screenIndexBuffer, 0);
    drawStaticUIFrame(this.ui);
    const inventoryOpen = (this.ui.partyState?.selectedCharacterIndex ?? -1) >= 0;
    if (!inventoryOpen) {
      syncOpenChest(this.ui, null);
    }
    if (inventoryOpen) {
      drawInventoryBackground(this.ui);
    } else {
      this.blitViewportToScreen();
    }
    drawPartyStatus(this.ui);
    if (inventoryOpen) {
      drawInventoryScreen(this.ui);
      if (this.ui.uiTables) shadeRectIndex(this.ui, this.ui.uiTables.graphic232.word28, 0);
    }
    drawAttackButtons(this.ui);
    drawAttackPanel(this.ui);
    drawSpellPanel(this.ui);
    drawSpellControls(this.ui);
    drawHeldObjectName(this.ui);
    drawMessageLines(this.ui);
    drawHoverHighlights(this.ui);
    drawCursorItem(this.ui);

    const uiPalette = this.uiPalette ?? this.palette;
    if (!uiPalette) return;
    const viewportPalette = inventoryOpen ? uiPalette : (this.getViewportPalette() ?? uiPalette);
    if (!inventoryOpen && viewportPalette !== uiPalette) {
      updateImageDataFromIndexWithViewportPalette(
        this.screenImageData,
        this.ui.screenIndexBuffer,
        {
          x1: VIEWPORT_X,
          y1: VIEWPORT_Y,
          x2: VIEWPORT_X + VIEWPORT_WIDTH - 1,
          y2: VIEWPORT_Y + VIEWPORT_HEIGHT - 1,
        },
        viewportPalette,
        uiPalette,
      );
    } else {
      updateImageDataFromIndex(this.screenImageData, this.ui.screenIndexBuffer, uiPalette);
    }
    this.screenCtx.putImageData(this.screenImageData, 0, 0);
  }

  private getViewportPalette(): number[] | null {
    if (!this.viewportPalettes || this.viewportPalettes.length === 0) return null;
    const index = Math.min(selectPaletteIndexForLightLevel(this.ui), this.viewportPalettes.length - 1);
    // Publish it as CSBWin's `d.CurrentPalette`: the monster AI reads the light level
    // to shorten how far a monster can see (`doc/CSBwin-src/Monster.cpp:577-581`).
    this.onPaletteSelected?.(index);
    return this.viewportPalettes[index] ?? this.viewportPalettes[0] ?? null;
  }

  /** Set by the host so the engine learns the current light level. */
  setPaletteSelectedHandler(handler: (index: number) => void): void {
    this.onPaletteSelected = handler;
  }

  private onPaletteSelected?: (index: number) => void;

  private renderLastFrame(): void {
    if (!this.lastRenderPosition) return;
    this.render(this.lastRenderPosition, this.lastRenderFacing);
  }

  private blitViewportToScreen(): void {
    if (!this.ui.context?.viewportIndexBuffer || !this.ui.screenIndexBuffer) return;

    const src = this.ui.context.viewportIndexBuffer;
    const dst = this.ui.screenIndexBuffer;
    const dstX = VIEWPORT_X;
    const dstY = VIEWPORT_Y;

    const maxWidth = Math.min(src.width, dst.width - dstX);
    const maxHeight = Math.min(src.height, dst.height - dstY);

    for (let y = 0; y < maxHeight; y++) {
      const srcRow = y * src.width;
      const dstRow = (dstY + y) * dst.width + dstX;
      dst.pixels.set(src.pixels.subarray(srcRow, srcRow + maxWidth), dstRow);
    }
  }

  // Get the viewport canvas element styling element
  getCanvasStyle(): CSSStyleDeclaration {
    if (!this.canvas) throw new Error('Renderer not initialized');
    return this.canvas.style;
  }
}
