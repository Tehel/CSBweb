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
import type { CSBGraphicsLoader } from '../data/CSBGraphicsLoader';
import { InterpreterContext } from './bytecode/BytecodeInterpreter';
import { DrawViewport } from './DrawViewport';
import { DungeonState } from '../engine/DungeonState';
import type { IndexedBitmap } from './csbwin/CanvasBlitter';
import { createPaletteIndexViewportBuffer, tag0088b2Index, updateImageDataFromIndex } from './csbwin/CanvasBlitter';
import { extractViewportTables } from './csbwin/ViewportTables';
import { extractObjectTables } from './csbwin/ObjectTables';
import { ImageFormat } from '../core/imageDecoder';
import {
  initializeFloorCeilingIndexed,
  initializeDoorBitmapsIndexed,
  initializeWallBitmapsIndexed,
  createViewportCanvas,
  VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT,
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  VIEWPORT_X,
  VIEWPORT_Y,
} from './ViewportGraphics';

/**
 * Main ViewportRenderer class
 * Manages viewport rendering state and provides API for rendering
 */
export class ViewportRenderer {
  private graphicsLoader: GraphicsLoader;
  private dungeonState: DungeonState;
  private csbGraphicsLoader?: CSBGraphicsLoader;
  private context: InterpreterContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private screenCtx: CanvasRenderingContext2D | null = null;
  private viewportImageData: ImageData | null = null; // RGBA staging for present
  private palette: number[] | null = null;
  private initialized: boolean = false;

  private wallBitmapSets: Map<number, { normal: IndexedBitmap[]; mirrorMode: IndexedBitmap[] }> = new Map();
  private doorBitmapSets: Map<number, IndexedBitmap[]> = new Map();
  private basicGraphicCache: Map<number, IndexedBitmap> = new Map();
  private derivedGraphicCache: Map<string, IndexedBitmap> = new Map();
  private mirrorWallRectF2?: { x1: number; x2: number; y1: number; y2: number };
  private mirrorWallRectF3?: { x1: number; x2: number; y1: number; y2: number };
  private floorCeilingCache: Map<
    number,
    {
      // Full-viewport (224×136) palette-index templates.
      // `ceilingMirrored` corresponds to CSBWin `(x+y+facing)&1 == 0` path (Viewport.cpp:6752-6754).
      // `floorMirrored` corresponds to CSBWin `(x+y+facing)&1 == 1` path (Viewport.cpp:6741-6744).
      ceilingMirrored: Uint8Array;
      floorMirrored: Uint8Array;
    }
  > = new Map();

  constructor(graphicsLoader: GraphicsLoader, dungeonState: DungeonState, csbGraphicsLoader?: CSBGraphicsLoader) {
    this.graphicsLoader = graphicsLoader;
    this.dungeonState = dungeonState;
    this.csbGraphicsLoader = csbGraphicsLoader;
  }

  /**
   * Initialize the viewport renderer
   * Loads all necessary graphics and sets up the rendering context
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('Initializing viewport renderer...');

    // Create full screen canvas (320×200)
    this.canvas = createViewportCanvas();
    this.screenCtx = this.canvas.getContext('2d');
    if (!this.screenCtx) throw new Error('Failed to create screen 2D context');
    this.viewportImageData = this.screenCtx.createImageData(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

    // Get palette
    const palette = this.graphicsLoader.getPalette(0);
    this.palette = palette;
    console.log('Got palette from graphics loader');

    // Extract CSBWin viewport tables from graphics.dat item 0x22e
    const viewportTables = extractViewportTables(this.graphicsLoader);
    console.log(`Extracted wallRectangles[14] from 0x22e at offset 0x${viewportTables.wallRectanglesOffset.toString(16)}`);
    const objectTables = extractObjectTables(this.graphicsLoader, viewportTables.wallRectanglesOffset);
    this.mirrorWallRectF2 = viewportTables.mirrorWallRectF2;
    this.mirrorWallRectF3 = viewportTables.mirrorWallRectF3;

    const viewportIndexBuffer = createPaletteIndexViewportBuffer(VIEWPORT_WIDTH, VIEWPORT_HEIGHT, 0);

    // Create interpreter context
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
      seeThruDoorEdgeRect: viewportTables.seeThruDoorEdgeRect,
      wallGraphicSet: 0,
      backgroundGraphicSet: 0,
      getBasicGraphicBitmap: (n: number) => this.getBasicGraphicBitmap(n),
      derivedGraphicCache: this.derivedGraphicCache,
      objectTables,
      csbGraphics: this.csbGraphicsLoader,
      dungeonState: this.dungeonState,
      viewportContext: this.screenCtx,
      viewportIndexBuffer,
      roomData: [],
      executionLog: [],
    };

    this.initialized = true;
    console.log('Viewport renderer initialized successfully');
  }

  /**
   * Render the viewport for a given party position and facing
   */
  render(facing: number, x: number, y: number, mapIndex: number = 0): void {
    if (!this.initialized || !this.context || !this.canvas || !this.screenCtx || !this.viewportImageData || !this.palette) {
      throw new Error('Renderer not initialized. Call initialize() first.');
    }

    if (!this.context.viewportIndexBuffer) throw new Error('Missing viewportIndexBuffer');

    // Clear execution log
    this.context.executionLog = [];

    // Select current wall + floor/ceiling style based on map descriptor (CSBWin LEVELDESC.word14 bits).
    const map = this.dungeonState.getMap(mapIndex);
    const wallGraphicSet = map?.descriptor.mapGraphicsStyle ?? 0;
    const backgroundGraphicSet = map?.descriptor.floorCeilingStyle ?? 0;
    this.context.wallGraphicSet = wallGraphicSet;
    this.context.backgroundGraphicSet = backgroundGraphicSet;
    this.context.frameMapIndex = mapIndex;
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

    // CSBWin: `d.UseMirrorImages = (x + y + facing) & 1` (Viewport.cpp:6740)
    const useMirrorImages = ((x + y + facing) & 1) !== 0;
    this.context.useMirrorImages = useMirrorImages;

    // Compose floor/ceiling background (CSBWin: FloorAndCeilingOnly + conditional Mirror).
    this.ensureFloorCeilingCache(backgroundGraphicSet);
    const fc = this.floorCeilingCache.get(backgroundGraphicSet)!;
    this.context.viewportIndexBuffer.pixels.set(useMirrorImages ? fc.floorMirrored : fc.ceilingMirrored);

    // Select wall bitmaps for this frame (CSBWin: mirrors swap some pointers when `UseMirrorImages != 0`).
    this.ensureWallBitmaps(wallGraphicSet);
    const wb = this.wallBitmapSets.get(wallGraphicSet)!;
    this.context.wallBitmaps = useMirrorImages ? wb.mirrorMode : wb.normal;

    // Door bitmaps (CSBWin ReadWallBitmaps loads these per wall set)
    this.ensureDoorBitmaps(wallGraphicSet);
    this.context.doorBitmaps = this.doorBitmapSets.get(wallGraphicSet)!;

    // Per-frame context for opcodes that need global state (CSBWin Interpret() params).
    this.context.frameFacing = facing;

    // Execute the main viewport drawing function (writes to index buffer via interpreter)
    DrawViewport(this.context, this.dungeonState, mapIndex, facing, x, y);

    this.presentViewport();
  }

  private ensureWallBitmaps(wallGraphicSet: number): void {
    if (this.wallBitmapSets.has(wallGraphicSet)) return;
    const normal = initializeWallBitmapsIndexed(this.graphicsLoader, wallGraphicSet);
    const mirrorMode = this.createMirrorModeWallBitmaps(normal);
    this.wallBitmapSets.set(wallGraphicSet, { normal, mirrorMode });
  }

  private ensureDoorBitmaps(wallGraphicSet: number): void {
    if (this.doorBitmapSets.has(wallGraphicSet)) return;
    const door = initializeDoorBitmapsIndexed(this.graphicsLoader, wallGraphicSet);
    this.doorBitmapSets.set(wallGraphicSet, door);
  }

  private ensureFloorCeilingCache(backgroundGraphicSet: number): void {
    if (this.floorCeilingCache.has(backgroundGraphicSet)) return;
    const { floor, ceiling } = initializeFloorCeilingIndexed(this.graphicsLoader, backgroundGraphicSet);
    const ceilingMirrored = this.buildFloorCeilingTemplate(ceiling, floor, true, false);
    const floorMirrored = this.buildFloorCeilingTemplate(ceiling, floor, false, true);
    this.floorCeilingCache.set(backgroundGraphicSet, { ceilingMirrored, floorMirrored });
  }

  private getBasicGraphicBitmap(graphicNum: number): IndexedBitmap | null {
    if (graphicNum < 0) return null;
    if (this.basicGraphicCache.has(graphicNum)) return this.basicGraphicCache.get(graphicNum)!;
    try {
      const decoded = this.graphicsLoader.getImage(graphicNum, ImageFormat.IMG1);
      const pixels = decoded.pixels instanceof Uint8Array ? decoded.pixels : Uint8Array.from(decoded.pixels as ArrayLike<number>);
      const bmp: IndexedBitmap = { width: decoded.width, height: decoded.height, pixels };
      this.basicGraphicCache.set(graphicNum, bmp);
      return bmp;
    } catch {
      return null;
    }
  }

  private createMirrorModeWallBitmaps(normal: IndexedBitmap[]): IndexedBitmap[] {
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

    const wallRects = this.context?.wallRectangles;
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
    if (!this.context?.viewportIndexBuffer || !this.screenCtx || !this.viewportImageData || !this.palette) return;

    this.screenCtx.fillStyle = '#000000';
    this.screenCtx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    updateImageDataFromIndex(this.viewportImageData, this.context.viewportIndexBuffer, this.palette);
    this.screenCtx.putImageData(this.viewportImageData, VIEWPORT_X, VIEWPORT_Y);

    this.screenCtx.strokeStyle = '#333333';
    this.screenCtx.lineWidth = 1;
    this.screenCtx.strokeRect(VIEWPORT_X - 1, VIEWPORT_Y - 1, VIEWPORT_WIDTH + 2, VIEWPORT_HEIGHT + 2);
  }

  /**
   * Get the viewport canvas element
   */
  getCanvas(): HTMLCanvasElement {
    if (!this.canvas) {
      throw new Error('Renderer not initialized');
    }
    return this.canvas;
  }

  /**
   * Get the execution log from the last render
   */
  getExecutionLog(): string[] {
    if (!this.context) {
      return [];
    }
    return this.context.executionLog;
  }

  /**
   * Check if renderer is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Create and initialize a viewport renderer
 */
export async function createViewportRenderer(
  graphicsLoader: GraphicsLoader,
  dungeonState: DungeonState,
  csbGraphicsLoader?: CSBGraphicsLoader
): Promise<ViewportRenderer> {
  const renderer = new ViewportRenderer(graphicsLoader, dungeonState, csbGraphicsLoader);
  await renderer.initialize();
  return renderer;
}
