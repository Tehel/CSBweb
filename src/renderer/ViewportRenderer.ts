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
import type { CSBGraphicsLoader } from '../data/CSBGraphicsLoader';
import { InterpreterContext } from './bytecode/BytecodeInterpreter';
import { DrawViewport } from './DrawViewport';
import { DungeonState } from '../engine/DungeonState';
import type { IndexedBitmap } from './csbwin/CanvasBlitter';
import {
  clearIndex,
  createPaletteIndexViewportBuffer,
  drawRectOutlineIndex,
  flashRectIndex,
  fillRectIndex,
  tag0088b2Index,
  updateImageDataFromIndex,
} from './csbwin/CanvasBlitter';
import { extractViewportTables } from './csbwin/ViewportTables';
import { extractObjectTables } from './csbwin/ObjectTables';
import { extractUITables, type UITables } from './csbwin/UITables';
import { drawTextLineIndex, drawTextLineIndexRaw, loadFontData, type FontData } from './csbwin/TextRenderer';
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
import { getOrSet, Position } from '@/core';

export enum UIMode {
  Adventure = 'adventure',
  Sleeping = 'sleeping',
  Frozen = 'frozen',
}

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
  private screenImageData: ImageData | null = null; // RGBA staging for present
  private screenIndexBuffer: ReturnType<typeof createPaletteIndexViewportBuffer> | null = null;
  private palette: number[] | null = null;
  private initialized: boolean = false;

  private wallBitmapSets: Map<number, WallBitmapSet> = new Map();
  private graphicCache: Map<string, IndexedBitmap> = new Map();
  private mirrorWallRectF2?: { x1: number; x2: number; y1: number; y2: number };
  private mirrorWallRectF3?: { x1: number; x2: number; y1: number; y2: number };
  private uiTables: UITables | null = null;
  private fontData: FontData | null = null;
  private messageLines: string[] = [];
  private partyState: PartyState | null = null;
  private hoverPoint: { x: number; y: number } | null = null;
  private showAttackPanel: boolean = false;
  private lastFlashToggleMs: number = 0;
  private flashOn: boolean = false;
  private magicCasterIndex: number = -1;
  private showSpellHighlights: boolean = false;
  private primaryButtons: UITables['graphic231']['buttons']['Buttons17196'] | null = null;
  private secondaryButtons: UITables['graphic231']['buttons']['Buttons17304'] | null = null;
  private mouseQueue: Array<{ num: number; x: number; y: number }> = [];
  private mouseQStart: number = 0;
  private mouseQEnd: number = 0;
  private lastMagicButtonId: number = 0;
  private uiMode: UIMode = UIMode.Adventure;
  private floorCeilingCache: Map<number, FloorCeiling> = new Map();

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
    this.screenImageData = this.screenCtx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);

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
    this.uiTables = extractUITables(this.graphicsLoader);
    this.fontData = loadFontData(this.graphicsLoader);

    const viewportIndexBuffer = createPaletteIndexViewportBuffer(VIEWPORT_WIDTH, VIEWPORT_HEIGHT, 0);
    this.screenIndexBuffer = createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0);
    const mouseQueueLength = 8;
    this.mouseQueue = Array.from({ length: mouseQueueLength }, () => ({ num: 0, x: 0, y: 0 }));
    this.mouseQStart = 0;
    this.mouseQEnd = mouseQueueLength - 1;
    this.updateButtonLists();

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
      getGraphicBitmap: (n: number) => this.getGraphicBitmap(n),
      graphicCache: this.graphicCache,
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

  getUITables(): UITables | null {
    return this.uiTables;
  }

  setMessageLines(lines: string[]): void {
    this.messageLines = lines.slice(0, 4);
  }

  setPartyState(state: PartyState | null): void {
    this.partyState = state;
    if (state) {
      this.magicCasterIndex = state.magicCasterIndex ?? -1;
    }
  }

  setHoverPoint(point: { x: number; y: number } | null): void {
    this.hoverPoint = point;
  }

  setShowAttackPanel(show: boolean): void {
    this.showAttackPanel = show;
  }

  isAttackPanelVisible(): boolean {
    return this.showAttackPanel;
  }

  setUIMode(mode: UIMode): void {
    this.uiMode = mode;
    this.updateButtonLists();
  }

  enqueueMouseClick(x: number, y: number, buttons: number): void {
    const mouseQueueLength = this.mouseQueue.length;
    const numEnt = (this.mouseQEnd - this.mouseQStart + 1 + mouseQueueLength) % mouseQueueLength;
    if (numEnt >= mouseQueueLength - 2) return;

    let id = this.searchButtonList(this.primaryButtons, x, y, buttons);
    if (id === 0) {
      id = this.searchButtonList(this.secondaryButtons, x, y, buttons);
    }
    if (id === 0) return;

    this.mouseQEnd = (this.mouseQEnd + 1) % mouseQueueLength;
    this.mouseQueue[this.mouseQEnd] = { num: id, x, y };
  }

  enqueueMouseUnclick(): void {
    const mouseQueueLength = this.mouseQueue.length;
    const numEnt = (this.mouseQEnd - this.mouseQStart + 1 + mouseQueueLength) % mouseQueueLength;
    if (numEnt >= mouseQueueLength - 1) return;

    this.mouseQEnd = (this.mouseQEnd + 1) % mouseQueueLength;
    this.mouseQueue[this.mouseQEnd] = { num: 0xadd, x: 0, y: 0 };
  }

  processMouseQueue(): void {
    const mouseQueueLength = this.mouseQueue.length;
    const nextEnd = (this.mouseQEnd + 1) % mouseQueueLength;
    if (nextEnd === this.mouseQStart) return;

    const entry = this.mouseQueue[this.mouseQStart];
    this.mouseQStart = (this.mouseQStart + 1) % mouseQueueLength;
    if (entry.num === 0xadd) return;

    this.handleMouseButton(entry.num, entry.x, entry.y);
  }

  /**
   * Render the viewport for a given party position and facing
   */
  render(position: Position, facing: number): void {
    const { x, y, z } = position;
    if (!this.initialized || !this.context || !this.canvas || !this.screenCtx || !this.screenImageData || !this.palette) {
      throw new Error('Renderer not initialized. Call initialize() first.');
    }

    if (!this.context.viewportIndexBuffer) throw new Error('Missing viewportIndexBuffer');

    // Clear execution log
    this.context.executionLog = [];

    // Select current wall + floor/ceiling style based on map descriptor (CSBWin LEVELDESC.word14 bits).
    const map = this.dungeonState.getMap(z);
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

    // CSBWin: `d.UseMirrorImages = (x + y + facing) & 1` (Viewport.cpp:6740)
    const useMirrorImages = ((x + y + facing) & 1) !== 0;
    this.context.useMirrorImages = useMirrorImages;

    // Compose floor/ceiling background (CSBWin: FloorAndCeilingOnly + conditional Mirror).
    const fc = this.getFloorCeiling(backgroundGraphicSet);
    this.context.viewportIndexBuffer.pixels.set(useMirrorImages ? fc.mirrored : fc.normal);

    // Select bitmaps set for this frame (CSBWin: mirrors swap some pointers when `UseMirrorImages != 0`).
    const wb = this.getBitmapsSet(wallGraphicSet);
    this.context.wallBitmaps = useMirrorImages ? wb.wallMirrored : wb.wall;
    this.context.doorBitmaps = wb.doors;

    // Per-frame context for opcodes that need global state (CSBWin Interpret() params).
    this.context.frameFacing = facing;

    // Execute the main viewport drawing function (writes to index buffer via interpreter)
    DrawViewport(this.context, this.dungeonState, position, facing);

    this.presentViewport();
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

  private getGraphicBitmap(graphicNum: number, format: ImageFormat = ImageFormat.IMG1): IndexedBitmap | null {
    if (graphicNum < 0) return null;
    const key = `${graphicNum}-${format}`;
    const cached = this.graphicCache.get(key);
    if (cached) return cached;
    try {
      const decoded = this.graphicsLoader.getImage(graphicNum, format);
      const pixels = decoded.pixels instanceof Uint8Array ? decoded.pixels : Uint8Array.from(decoded.pixels as ArrayLike<number>);
      const bmp: IndexedBitmap = { width: decoded.width, height: decoded.height, pixels };
      this.graphicCache.set(key, bmp);
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
    if (!this.context?.viewportIndexBuffer || !this.screenCtx || !this.screenImageData || !this.palette || !this.screenIndexBuffer) return;

    clearIndex(this.screenIndexBuffer, 0);
    this.drawStaticUIFrame();
    this.blitViewportToScreen();
    this.drawPartyStatus();
    this.drawAttackButtons();
    this.drawAttackPanel();
    this.drawSpellPanel();
    this.drawSpellControls();
    this.drawMessageLines();
    this.drawHoverHighlights();

    updateImageDataFromIndex(this.screenImageData, this.screenIndexBuffer, this.palette);
    this.screenCtx.putImageData(this.screenImageData, 0, 0);
  }

  private drawStaticUIFrame(): void {
    if (!this.uiTables || !this.screenIndexBuffer) return;

    const ui = this.uiTables.graphic232;
    fillRectIndex(this.screenIndexBuffer, ui.wRectPos1780, 0);
    fillRectIndex(this.screenIndexBuffer, ui.wRectPos1788, 0);
    fillRectIndex(this.screenIndexBuffer, ui.wRectPos1796, 0);

    const movementGraphic = this.getGraphicBitmap(13);
    if (!movementGraphic) return;
    const rect = ui.word28;
    tag0088b2Index(
      movementGraphic,
      this.screenIndexBuffer,
      {
        x1: rect.x1,
        y1: rect.y1,
        x2: rect.x2,
        y2: rect.y2,
        srcX: 0,
        srcY: 0,
        srcStride: movementGraphic.width,
        srcWidth: movementGraphic.width,
        srcHeight: movementGraphic.height,
      },
      -1
    );
  }

  private drawMessageLines(): void {
    if (!this.uiTables || !this.fontData || !this.screenIndexBuffer) return;
    if (this.messageLines.length === 0) return;

    const baseY = 177;
    const lineHeight = 7;
    const color = 15;

    for (let i = 0; i < this.messageLines.length; i++) {
      const text = this.messageLines[i];
      const y = baseY + i * lineHeight;
      drawTextLineIndex(this.screenIndexBuffer, this.fontData, 0, y, color, null, text);
    }
  }

  private drawPartyStatus(): void {
    if (!this.uiTables || !this.screenIndexBuffer || !this.partyState || !this.fontData) return;

    const ui = this.uiTables.graphic232;
    const party = this.partyState;
    const facing = party.facing | 0;

    for (let chIdx = 0; chIdx < 4; chIdx++) {
      const baseX = 69 * chIdx;
      fillRectIndex(
        this.screenIndexBuffer,
        { x1: baseX, y1: 0, x2: baseX + 66, y2: 28 },
        12
      );

      const nameRect = { x1: baseX, y1: 0, x2: baseX + 42, y2: 6 };
      fillRectIndex(this.screenIndexBuffer, nameRect, 1);

      const champion =
        party.champions.find((c) => c.partyPosition === chIdx) ??
        party.champions[chIdx] ??
        null;

      if (champion) {
        drawTextLineIndex(this.screenIndexBuffer, this.fontData, baseX + 1, 5, 13, 1, champion.name);
      }

      if (champion && champion.alive === false) {
        const deadGraphic = this.getGraphicBitmap(8);
        if (deadGraphic) {
          tag0088b2Index(
            deadGraphic,
            this.screenIndexBuffer,
            {
              x1: baseX,
              y1: 0,
              x2: baseX + 66,
              y2: 28,
              srcX: 0,
              srcY: 0,
              srcStride: deadGraphic.width,
              srcWidth: deadGraphic.width,
              srcHeight: deadGraphic.height,
            },
            -1
          );
        }
      }

      if (champion) {
        this.drawLifeBars(chIdx, champion);
      }

      if (champion && typeof champion.portraitGraphic === 'number') {
        const portraitGraphic = this.getGraphicBitmap(champion.portraitGraphic);
        if (portraitGraphic) {
          tag0088b2Index(
            portraitGraphic,
            this.screenIndexBuffer,
            {
              x1: baseX + 7,
              y1: 0,
              x2: baseX + 38,
              y2: 28,
              srcX: 0,
              srcY: 0,
              srcStride: portraitGraphic.width,
              srcWidth: portraitGraphic.width,
              srcHeight: portraitGraphic.height,
            },
            -1
          );
        }
      }

      const charPos = champion?.partyPosition ?? chIdx;
      const dir = (charPos + 4 - facing) & 3;
      const posRect = ui.wRectPos1454[dir];
      const color = ui.byte1386[chIdx] ?? 13;
      fillRectIndex(this.screenIndexBuffer, posRect, color);

      const indicator = this.getGraphicBitmap(28);
      if (indicator) {
        const champFacing = champion?.facing ?? facing;
        const srcX = ((champFacing + 4 - facing) & 3) * 19;
        tag0088b2Index(
          indicator,
          this.screenIndexBuffer,
          {
            x1: posRect.x1,
            y1: posRect.y1,
            x2: posRect.x2,
            y2: posRect.y2,
            srcX,
            srcY: 0,
            srcStride: indicator.width,
            srcWidth: 19,
            srcHeight: indicator.height,
          },
          12
        );
      }
    }

    this.drawTopBarHandIcons();
  }

  private drawTopBarHandIcons(): void {
    if (!this.uiTables || !this.screenIndexBuffer || !this.partyState) return;
    const iconSlots = this.uiTables.graphic232.iconDisplay;
    const word612 = this.uiTables.graphic232.word612;

    for (let chIdx = 0; chIdx < 4; chIdx++) {
      const champion =
        this.partyState.champions.find((c) => c.partyPosition === chIdx) ??
        this.partyState.champions[chIdx] ??
        null;
      const alive = champion ? champion.alive !== false : false;
      if (!alive) continue;

      for (let hand = 0; hand <= 1; hand++) {
        const slot = 2 * chIdx + hand;
        const icon = iconSlots[slot];
        if (!icon) continue;

        const rect = { x1: icon.pixelX, y1: icon.pixelY, x2: icon.pixelX + 15, y2: icon.pixelY + 15 };
        const objectIndex =
          hand === 1
            ? typeof champion?.weaponHand === 'number'
              ? (champion.weaponHand | 0)
              : -1
            : typeof champion?.shieldHand === 'number'
              ? (champion.shieldHand | 0)
              : -1;

        if (objectIndex >= 0) {
          this.drawObjectIcon(rect, objectIndex, word612);
        } else {
          fillRectIndex(this.screenIndexBuffer, rect, 0);
        }
      }
    }
  }

  private drawAttackButtons(): void {
    if (!this.screenIndexBuffer || !this.partyState || !this.uiTables) return;

    const buttonHeightTop = 86;
    const buttonHeightBottom = 120;
    const word612 = this.uiTables.graphic232.word612;

    for (let chIdx = 0; chIdx < 4; chIdx++) {
      const champion =
        this.partyState.champions.find((c) => c.partyPosition === chIdx) ??
        this.partyState.champions[chIdx] ??
        null;

      const x1 = 22 * chIdx + 233;
      const x2 = x1 + 19;
      const alive = champion ? champion.alive !== false : false;
      const fillColor = alive ? 4 : 0;

      fillRectIndex(this.screenIndexBuffer, { x1, y1: buttonHeightTop, x2, y2: buttonHeightBottom }, fillColor);

      if (alive) {
        const iconRect = { x1: x1 + 2, y1: 95, x2: x2 - 2, y2: 110 };
        const iconIndex = typeof champion?.weaponHand === 'number' ? (champion.weaponHand | 0) : -1;
        if (iconIndex >= 0) {
          this.drawObjectIconMask(iconRect, iconIndex, word612, this.uiTables.graphic230.shrinkColorMap);
        } else {
          fillRectIndex(this.screenIndexBuffer, iconRect, 8);
        }
      }
    }
  }

  private drawObjectIcon(rect: { x1: number; y1: number; x2: number; y2: number }, objectNameIndex: number, word612: number[]): void {
    if (!this.screenIndexBuffer) return;
    if (objectNameIndex < 0) return;
    if (word612.length === 0) return;

    let group = 0;
    while (group < word612.length && objectNameIndex >= word612[group]) {
      group++;
    }
    group -= 1;
    if (group < 0) return;

    const graphicIndex = 42 + group;
    const graphic = this.getGraphicBitmap(graphicIndex);
    if (!graphic) return;

    const offset = objectNameIndex - word612[group];
    const srcX = (offset & 15) << 4;
    const srcY = offset & 0xff0;

    tag0088b2Index(
      graphic,
      this.screenIndexBuffer,
      {
        x1: rect.x1,
        y1: rect.y1,
        x2: rect.x2,
        y2: rect.y2,
        srcX,
        srcY,
        srcStride: graphic.width,
        srcWidth: graphic.width,
        srcHeight: graphic.height,
      },
      -1
    );
  }

  private drawObjectIconMask(
    rect: { x1: number; y1: number; x2: number; y2: number },
    objectNameIndex: number,
    word612: number[],
    colorMap: number[]
  ): void {
    if (!this.screenIndexBuffer) return;
    if (objectNameIndex < 0) return;
    if (word612.length === 0 || colorMap.length === 0) return;

    let group = 0;
    while (group < word612.length && objectNameIndex >= word612[group]) {
      group++;
    }
    group -= 1;
    if (group < 0) return;

    const graphicIndex = 42 + group;
    const graphic = this.getGraphicBitmap(graphicIndex);
    if (!graphic) return;

    const offset = objectNameIndex - word612[group];
    const srcX = (offset & 15) << 4;
    const srcY = offset & 0xff0;

    const dst = this.screenIndexBuffer;
    const dstStride = dst.width;
    const srcStride = graphic.width;
    const maxW = Math.min(16, rect.x2 - rect.x1 + 1);
    const maxH = Math.min(16, rect.y2 - rect.y1 + 1);

    for (let y = 0; y < maxH; y++) {
      const sy = srcY + y;
      if (sy < 0 || sy >= graphic.height) continue;
      const dstRow = (rect.y1 + y) * dstStride;
      for (let x = 0; x < maxW; x++) {
        const sx = srcX + x;
        if (sx < 0 || sx >= srcStride) continue;
        const pixel = graphic.pixels[sy * srcStride + sx] & 0x0f;
        const mapped = colorMap[pixel] ?? 0;
        if (mapped !== 0) continue; // leave cyan background for mapped pixels (ex: color 12 -> 40)
        dst.pixels[dstRow + rect.x1 + x] = 0; // black mask for non-mapped pixels
      }
    }
  }

  private drawAttackPanel(): void {
    if (!this.uiTables || !this.screenIndexBuffer || !this.fontData || !this.partyState) return;
    if (!this.showAttackPanel) return;

    fillRectIndex(this.screenIndexBuffer, this.uiTables.graphic232.word20, 0);

    const active = this.partyState.champions.find((c) => c.alive !== false);
    if (!active) return;

    const panelGraphic = this.getGraphicBitmap(10);
    if (panelGraphic) {
      const rect = this.uiTables.graphic230.wRectPos20202;
      tag0088b2Index(
        panelGraphic,
        this.screenIndexBuffer,
        {
          x1: rect.x1,
          y1: rect.y1,
          x2: rect.x2,
          y2: rect.y2,
          srcX: 0,
          srcY: 0,
          srcStride: panelGraphic.width,
          srcWidth: panelGraphic.width,
          srcHeight: panelGraphic.height,
        },
        -1
      );
    }

    drawTextLineIndex(this.screenIndexBuffer, this.fontData, 235, 83, 0, 4, active.name);
    drawTextLineIndex(this.screenIndexBuffer, this.fontData, 241, 93, 4, 0, 'ATTACK 1');
    drawTextLineIndex(this.screenIndexBuffer, this.fontData, 241, 105, 4, 0, 'ATTACK 2');
    drawTextLineIndex(this.screenIndexBuffer, this.fontData, 241, 117, 4, 0, 'ATTACK 3');
  }

  private drawSpellControls(): void {
    if (!this.uiTables || !this.screenIndexBuffer || !this.fontData || !this.partyState) return;

    const rect = this.uiTables.graphic230.word20242;
    fillRectIndex(this.screenIndexBuffer, rect, 0);

    this.partyState.champions.forEach(champion => {
      if (!champion || !champion.alive || champion.attributes?.maxMana === 0) return;
      const pos = champion.partyPosition;
      const isCaster = pos === this.magicCasterIndex;
      const isAfterCaster = pos > this.magicCasterIndex;
      const x = rect.x1 + pos * 14 + (isAfterCaster ? 33 : 0);
      const rct = {
        x1: x,
        x2: x + (isCaster ? 44 : 11),
        y1: rect.y1,
        y2: rect.y2 - (isCaster ? 0 : 1)
      };
      fillRectIndex(this.screenIndexBuffer!, rct, 4);
      if (isCaster) drawTextLineIndex(this.screenIndexBuffer!, this.fontData!, x + 2, rect.y2-1, 0, 4, champion.name);
    });
  }

  private drawSpellPanel(): void {
    if (!this.uiTables || !this.screenIndexBuffer || !this.fontData || !this.partyState) return;

    const rect = this.uiTables.graphic232.word12;

    fillRectIndex(this.screenIndexBuffer, rect, 0);
    if (this.magicCasterIndex < 0) return;

    let panelGraphic = this.getGraphicBitmap(9);
    if (panelGraphic) {
      tag0088b2Index(
        panelGraphic,
        this.screenIndexBuffer,
        {
          x1: rect.x1,
          y1: rect.y1,
          x2: rect.x2,
          y2: rect.y2,
          srcX: 0,
          srcY: 0,
          srcStride: panelGraphic.width,
          srcWidth: panelGraphic.width,
          srcHeight: panelGraphic.height,
        },
        -1
      );
    }

    const panelOverlay = this.getGraphicBitmap(11);
    if (panelOverlay) {
      tag0088b2Index(
        panelOverlay,
        this.screenIndexBuffer,
        {
          x1: rect.x1,
          y1: rect.y1,
          x2: rect.x2,
          y2: rect.y2,
          srcX: 0,
          srcY: 4,
          srcStride: panelOverlay.width,
          srcWidth: panelOverlay.width,
          srcHeight: panelOverlay.height,
        },
        0
      );
    }

    const caster =
      this.partyState.champions.find((c) => c.partyPosition === this.magicCasterIndex) ??
      this.partyState.champions[this.magicCasterIndex];
    if (!caster || caster.alive === false) return;

    const incantationIndex = caster.incantationIndex ?? 0;
    this.drawSpellMenuCharacters(incantationIndex);
    this.drawMagicSelection(caster.incantation ?? []);
  }

  private drawSpellMenuCharacters(groupIndex: number): void {
    if (!this.screenIndexBuffer || !this.fontData) return;
    const base = 96 + 6 * (groupIndex & 3);
    const y = 58;

    for (let i = 0; i < 6; i++) {
      const x = 224 + 14 * (i + 1);
      const ch = String.fromCharCode(base + i);
      drawTextLineIndexRaw(this.screenIndexBuffer, this.fontData, x, y, 4, 0, ch);
    }
  }

  private drawMagicSelection(incantation: number[]): void {
    if (!this.screenIndexBuffer || !this.fontData) return;
    const y = 70;

    for (let i = 0; i < 4; i++) {
      const x = 231 + 9 * (i + 1);
      const code = incantation[i] ?? 0;
      const ch = code === 0 ? ' ' : String.fromCharCode(code);
      drawTextLineIndexRaw(this.screenIndexBuffer, this.fontData, x, y, 4, 0, ch);
    }
  }

  private drawLifeBars(chIdx: number, champion: PartyState['champions'][number]): void {
    if (!this.uiTables || !this.screenIndexBuffer || !champion.alive) return;
    const offsets = this.uiTables.graphic232.word1526[chIdx];
    const masks = this.uiTables.graphic232.word1502[chIdx];
    if (!offsets || !masks) return;

    const heights = [
      this.computeBarHeight(champion.attributes?.health ?? 0, champion.attributes?.maxHealth ?? 0, false),
      this.computeBarHeight(champion.attributes?.stamina ?? 0, champion.attributes?.maxStamina ?? 0, false),
      this.computeBarHeight(champion.attributes?.mana ?? 0, champion.attributes?.maxMana ?? 0, true),
    ];

    const fillColor = this.getLifeBarColor(chIdx);
    const emptyColor = 12;
    const baseY = 2;

    for (let bar = 0; bar < 3; bar++) {
      const offsetBytes = offsets[bar] ?? 0;
      const startX = Math.floor(offsetBytes / 8) * 16;
      const mask1 = masks[bar * 2] ?? 0;
      const mask2 = masks[bar * 2 + 1] ?? 0;
      const height = heights[bar] ?? 0;

      for (let row = 0; row <= 24; row++) {
        const filled = height > (24 - row);
        const color = filled ? fillColor : emptyColor;
        const y = baseY + row;
        this.drawMaskedBarRow(startX, y, mask1, color);
        this.drawMaskedBarRow(startX + 16, y, mask2, color);
      }
    }
  }

  private drawMaskedBarRow(xBase: number, y: number, mask: number, color: number): void {
    if (!this.screenIndexBuffer) return;
    if (mask === 0) return;
    const width = this.screenIndexBuffer.width;
    const height = this.screenIndexBuffer.height;
    if (y < 0 || y >= height) return;

    const row = y * width;
    const bits = mask & 0xffff;
    for (let bit = 0; bit < 16; bit++) {
      if ((bits & (1 << (15 - bit))) === 0) continue;
      const x = xBase + bit;
      if (x < 0 || x >= width) continue;
      this.screenIndexBuffer.pixels[row + x] = color & 0x0f;
    }
  }

  private computeBarHeight(current: number, max: number, allowOverMax: boolean): number {
    if (current <= 0 || max <= 0) return 0;
    if (allowOverMax && current > max) return 25;
    return Math.min(25, Math.ceil((25 * current) / max));
  }

  private getLifeBarColor(chIdx: number): number {
    let d6 = 0;
    let d7 = 0;
    if (chIdx >= 3) {
      d6 = 0x80000000 | 0;
      d7 = (d6 + 1) | 0;
    } else if (chIdx >= 2) {
      d6 = 0;
      d7 = 0x80000000 | 0;
    } else if (chIdx >= 1) {
      d6 = 0x80000001 | 0;
      d7 = (d6 - 1) | 0;
    } else {
      d6 = 0x80000001 | 0;
      d7 = 1;
    }
    const bit0 = (d6 & 0xffff) !== 0 ? 1 : 0;
    const bit1 = d6 < 0 ? 1 : 0;
    const bit2 = (d7 & 0xffff) !== 0 ? 1 : 0;
    const bit3 = d7 < 0 ? 1 : 0;
    return bit0 | (bit1 << 1) | (bit2 << 2) | (bit3 << 3);
  }

  private getFlashPhase(): boolean {
    const now = Date.now();
    if (now - this.lastFlashToggleMs >= 200) {
      this.lastFlashToggleMs = now;
      this.flashOn = !this.flashOn;
    }
    return this.flashOn;
  }

  private searchButtonList(
    list: UITables['graphic231']['buttons']['buttons17196'] | null,
    x: number,
    y: number,
    buttons: number
  ): number {
    if (!list || list.length === 0) return 0;
    for (const entry of list) {
      if (entry.word0 === 0) break;
      if (x >= entry.xMin && x < entry.xMax && y >= entry.yMin && y < entry.yMax) {
        if ((buttons & entry.button) !== 0) return entry.word0;
      }
    }
    return 0;
  }

  private handleMouseButton(id: number, x: number, y: number): void {
    if (id === 100) {
      this.handleMagicClick(x, y);
    }
  }

  private handleMagicClick(clickX: number, clickY: number): void {
    if (!this.partyState) return;

    const champions = this.partyState.champions;
    const slots = new Array(4).fill(null).map((_, idx) => {
      return (
        champions.find((champion) => champion.partyPosition === idx) ??
        champions[idx] ??
        null
      );
    });
    const numCharacters = slots.filter((champion) => champion !== null).length;
    if (numCharacters === 0) return;

    let casterIndex = this.magicCasterIndex;
    if (casterIndex < 0 || casterIndex >= slots.length || slots[casterIndex]?.alive === false) {
      casterIndex = slots.findIndex((champion) => champion && champion.alive !== false);
    }
    if (casterIndex < 0) return;

    if (clickY <= 48) {
      let target = -1;
      if (casterIndex === 0) {
        if ((clickX >= 280 && clickX <= 291) || clickX === 513) target = 1;
        else if ((clickX >= 294 && clickX <= 305) || clickX === 514) target = 2;
        else if ((clickX >= 308 && clickX <= 319) || clickX === 515) target = 3;
      } else if (casterIndex === 1) {
        if ((clickX >= 233 && clickX <= 244) || clickX === 512) target = 0;
        else if ((clickX >= 294 && clickX <= 305) || clickX === 514) target = 2;
        else if ((clickX >= 308 && clickX <= 319) || clickX === 515) target = 3;
      } else if (casterIndex === 2) {
        if ((clickX >= 233 && clickX <= 244) || clickX === 512) target = 0;
        else if ((clickX >= 247 && clickX <= 258) || clickX === 513) target = 1;
        else if ((clickX >= 308 && clickX <= 319) || clickX === 515) target = 3;
      } else if (casterIndex === 3) {
        if ((clickX >= 247 && clickX <= 258) || clickX === 513) target = 1;
        else if ((clickX >= 261 && clickX <= 272) || clickX === 514) target = 2;
        else if (clickX <= 244 || clickX === 512) target = 0;
      }

      if (target >= 0 && target < numCharacters) {
        const next = slots[target];
        if (next && next.alive !== false) {
          this.magicCasterIndex = target;
          if (this.partyState) {
            this.partyState.magicCasterIndex = target;
          }
        }
      }
      return;
    }

    if (!this.uiTables) return;
    const magicButton = this.searchButtonList(this.uiTables.graphic231.buttons.buttons18060, clickX, clickY, 2);
    if (magicButton !== 0) {
      this.lastMagicButtonId = magicButton;
      this.applyMagicSelection(magicButton);
    }
  }

  private applyMagicSelection(buttonId: number): void {
    if (!this.partyState || !this.uiTables) return;

    let casterIdx = this.magicCasterIndex;
    if (casterIdx < 0) {
      const fallback = this.partyState.champions.find((c) => c.alive !== false);
      casterIdx = fallback ? fallback.partyPosition : -1;
      if (casterIdx >= 0) {
        this.magicCasterIndex = casterIdx;
        this.partyState.magicCasterIndex = casterIdx;
      }
    }
    if (casterIdx < 0) return;
    const champion =
      this.partyState.champions.find((c) => c.partyPosition === casterIdx) ??
      this.partyState.champions[casterIdx];
    if (!champion || champion.alive === false) return;

    const incantation = champion.incantation ? [...champion.incantation] : [0, 0, 0, 0];
    let incantationIndex = champion.incantationIndex ?? 0;

    if (buttonId === 108) {
      if (incantation[0] === 0) return;
      for (let i = 0; i < incantation.length; i++) {
        incantation[i] = 0;
      }
      incantationIndex = 0;
      champion.incantation = incantation;
      champion.incantationIndex = incantationIndex;
      return;
    }

    const button = buttonId - 101;
    if (button < 0) return;

    if (button >= 6) {
      const length = incantation.findIndex((v) => v === 0);
      const actualLen = length === -1 ? incantation.length : length;
      if (actualLen === 0) return;
      incantationIndex = (incantationIndex + 3) & 3;
      incantation[incantationIndex] = 0;
      champion.incantation = incantation;
      champion.incantationIndex = incantationIndex;
      return;
    }

    const pos = incantationIndex & 3;
    const baseMana = this.uiTables.graphic230.spellBaseMana;
    const scaleMana = this.uiTables.graphic230.spellFirstRuneScale;
    let manaCost = baseMana[pos * 6 + button] ?? 0;
    if (pos !== 0) {
      const firstRune = (incantation[0] ?? 0) - 96;
      const scale = scaleMana[firstRune] ?? 0;
      manaCost = (manaCost * scale) >> 3;
    }

    const mana = champion.attributes?.mana ?? 0;
    if (manaCost > mana) return;
    if (champion.attributes) {
      champion.attributes.mana = Math.max(0, mana - manaCost);
    }

    const runeChar = 96 + pos * 6 + button;
    incantation[pos] = runeChar;
    if (pos + 1 < incantation.length) incantation[pos + 1] = 0;
    incantationIndex = (pos + 1) & 3;
    champion.incantation = incantation;
    champion.incantationIndex = incantationIndex;
  }

  private updateButtonLists(): void {
    if (!this.uiTables) return;
    const buttons = this.uiTables.graphic231.buttons;
    switch (this.uiMode) {
      case UIMode.Sleeping:
        this.primaryButtons = buttons.buttons17796;
        this.secondaryButtons = null;
        break;
      case UIMode.Frozen:
        this.primaryButtons = buttons.buttons17832;
        this.secondaryButtons = null;
        break;
      case UIMode.Adventure:
      default:
        this.primaryButtons = buttons.buttons17196;
        this.secondaryButtons = buttons.buttons17304;
        break;
    }
  }

  private drawHoverHighlights(): void {
    if (!this.uiTables || !this.screenIndexBuffer || !this.hoverPoint) return;
    const { x, y } = this.hoverPoint;

    // move arrows
    // for (const btn of this.uiTables.graphic231.moveButtons) {
    //   if (this.pointInRect(x, y, btn.x1, btn.y1, btn.x2, btn.y2)) {
    //     drawRectOutlineIndex(this.screenIndexBuffer, { x1: btn.x1, y1: btn.y1, x2: btn.x2, y2: btn.y2 }, 15);
    //   }
    // }

    // // attack buttons
    // for (let chIdx = 0; chIdx < 4; chIdx++) {
    //   const x1 = 22 * chIdx + 233;
    //   const x2 = x1 + 19;
    //   const y1 = 86;
    //   const y2 = 120;
    //   if (this.pointInRect(x, y, x1, y1, x2, y2)) {
    //     drawRectOutlineIndex(this.screenIndexBuffer, { x1, y1, x2, y2 }, 8);
    //   }
    // }

    const buttonGroups = Object.values(this.uiTables.graphic231.buttons);
    for (const group of buttonGroups) {
      for (const btn of group) {
        if (this.pointInRect(x, y, btn.xMin, btn.yMin, btn.xMax, btn.yMax)) {
          drawRectOutlineIndex(
            this.screenIndexBuffer,
            { x1: btn.xMin, y1: btn.yMin, x2: btn.xMax, y2: btn.yMax },
            15
          );
        }
      }
    }
  }

  private pointInRect(x: number, y: number, x1: number, y1: number, x2: number, y2: number): boolean {
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  }

  private blitViewportToScreen(): void {
    if (!this.context?.viewportIndexBuffer || !this.screenIndexBuffer) return;

    const src = this.context.viewportIndexBuffer;
    const dst = this.screenIndexBuffer;
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
