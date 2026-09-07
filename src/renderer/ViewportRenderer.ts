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
  drawRectOutlineIndex,
  fillRectIndex,
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
import { DBType, decodeObjectID, OBJECT_ID_EOF, RoomType, type ObjectID } from '../core/types';
import { updateHover } from '@/ui';
import { createUIState, UIMode, type ObjectMoveHandler, type UIState } from './ui/UIState';
import {
  drawAttackButtons,
  drawAttackPanel,
  drawSpellControls,
  drawSpellPanel,
  handleMagicClick,
} from './ui/MagicPanel';
import {
  searchButtonList,
  pointInRect,
} from './ui/HitTest';
import {
  drawInventoryBackground,
  drawInventoryScreen,
  getActiveChestView,
  getEyeRect,
  syncOpenChest,
} from './ui/Inventory';
import {
  handleMouthPress,
} from './ui/Feeding';
import {
  canPlaceInSlot,
  drawHeldObjectName,
  drawPartyStatus,
  getChampionPossession,
  setChampionPossession,
} from './ui/Character';
import {
  getBaseObjectNameIndex,
  isLikelyObjectRecord,
  normalizeObjectValue,
  resolveObjectNameIndex,
} from './ui/Objects';
import {
  drawMessageLines,
  drawObjectIconAt,
  shadeRectIndex,
} from './ui/Draw';
import { GraphicRoomType } from './bytecode/Types';
import type { ViewingFilterOptions, ViewingFilterResult } from '../engine/DsaSystem';
import {
    OBJNI_BONES_A,
    OBJNI_EMPTY_FLASK,
    OBJNI_TORCH_A,
    OBJNI_TORCH_D,
    OBJNI_WATER,
    OBJNI_WATERSKIN,
} from '../core/objectNameIndex';

type IndexedBitmapSet = IndexedBitmap[]
type ViewportCursorAction =
  | { kind: 'throw'; side: 0 | 1 }
  | { kind: 'drop'; pos: number; viAltar?: boolean }
  | { kind: 'wall' };

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

const POTION_WATER_FLASK = 15;

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
    this.updateButtonLists();

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
    this.syncInventoryButtons();
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
    this.updateButtonLists();
    this.syncInventoryButtons();
  }

  isInventoryOpen(): boolean {
    return (this.ui.partyState?.selectedCharacterIndex ?? -1) >= 0;
  }

  enqueueMouseClick(x: number, y: number, buttons: number): void {
    const mouseQueueLength = this.ui.mouseQueue.length;
    const numEnt = (this.ui.mouseQEnd - this.ui.mouseQStart + 1 + mouseQueueLength) % mouseQueueLength;
    if (numEnt >= mouseQueueLength - 2) return;

    let id = searchButtonList(this.ui.primaryButtons, x, y, buttons);
    if (id === 0) {
      id = searchButtonList(this.ui.secondaryButtons, x, y, buttons);
    }
    if (id === 0) return;

    this.ui.mouseQEnd = (this.ui.mouseQEnd + 1) % mouseQueueLength;
    this.ui.mouseQueue[this.ui.mouseQEnd] = { num: id, x, y };
  }

  enqueueMouseUnclick(): void {
    const mouseQueueLength = this.ui.mouseQueue.length;
    const numEnt = (this.ui.mouseQEnd - this.ui.mouseQStart + 1 + mouseQueueLength) % mouseQueueLength;
    if (numEnt >= mouseQueueLength - 1) return;

    this.ui.mouseQEnd = (this.ui.mouseQEnd + 1) % mouseQueueLength;
    this.ui.mouseQueue[this.ui.mouseQEnd] = { num: 0xadd, x: 0, y: 0 };
  }

  processMouseQueue(): void {
    const mouseQueueLength = this.ui.mouseQueue.length;
    const nextEnd = (this.ui.mouseQEnd + 1) % mouseQueueLength;
    if (nextEnd === this.ui.mouseQStart) return;

    const entry = this.ui.mouseQueue[this.ui.mouseQStart];
    this.ui.mouseQStart = (this.ui.mouseQStart + 1) % mouseQueueLength;
    if (entry.num === 0xadd) {
      this.handleMouseUnclick();
      return;
    }

    this.handleMouseButton(entry.num, entry.x, entry.y);
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

  isWallDecorationHit(x: number, y: number): boolean {
    const rects = this.ui.context?.wallDecorationRects;
    if (!rects || rects.length === 0) return false;
    const vx = x - VIEWPORT_X;
    const vy = y - VIEWPORT_Y;
    for (const rect of rects) {
      if (vx >= rect.x1 && vx <= rect.x2 && vy >= rect.y1 && vy <= rect.y2) return true;
    }
    return false;
  }

  isDoorSwitchHit(x: number, y: number): boolean {
    const rects = this.ui.context?.doorSwitchRects;
    if (!rects || rects.length === 0) return false;
    const vx = x - VIEWPORT_X;
    const vy = y - VIEWPORT_Y;
    for (const rect of rects) {
      if (vx >= rect.x1 && vx <= rect.x2 && vy >= rect.y1 && vy <= rect.y2) return true;
    }
    return false;
  }

  tryPickViewportObject(x: number, y: number): boolean {
    if (!this.ui.partyState || !this.ui.context?.viewportObjectButtons || !this.ui.context.viewportObjectRNs) return false;
    if (normalizeObjectValue(this.ui.partyState.objectInHand) !== null) return false;
    if ((this.ui.partyState.cursorOwner ?? -1) < 0) return false;

    const hit = this.findViewportObjectHit(x, y);
    if (!hit) return false;

    const target = this.getPickupCellForRelativePos(hit.relativeLocation);
    if (!target) return false;
    if (this.isMonsterBlockingPickup(hit.relativeLocation, target)) return false;
    if (!this.ui.dungeonState.removeObjectFromCell(target, hit.rn)) return false;
    this.ui.onObjectMove?.(target, hit.rn, false, false, this.ui.partyState.facing & 0x3);

    this.ui.partyState.objectInHand = hit.rn;
    return true;
  }

  hasCursorObject(): boolean {
    if (!this.ui.partyState) return false;
    return normalizeObjectValue(this.ui.partyState.objectInHand) !== null;
  }

  resolveViewportCursorAction(x: number, y: number): ViewportCursorAction | null {
    if (!this.ui.partyState || !this.ui.uiTables) return null;
    const objectId = normalizeObjectValue(this.ui.partyState.objectInHand);
    if (objectId === null) return null;
    if ((this.ui.partyState.cursorOwner ?? -1) < 0) return null;

    const stoneAhead = this.isFrontCellStoneOrVisibleFalseWall();
    const doorFacingAhead = this.isFrontCellDoorFacing();

    if (stoneAhead) {
      const dropPos = this.findDropAreaHit(x, y, 2);
      if (dropPos !== null) return { kind: 'drop', pos: dropPos };

      if (this.isViewportButtonHit(5, x, y)) {
        if (this.ui.context?.facingAlcove) {
          let viAltar = false;
          if (this.ui.context?.facingViAltar) {
            const objectNameIndex = resolveObjectNameIndex(this.ui, objectId | 0);
            viAltar = objectNameIndex === OBJNI_BONES_A;
          }
          return { kind: 'drop', pos: 4, viAltar };
        }
        return { kind: 'wall' };
      }
      return null;
    }

    const throwSide = this.testThrow(x, y, doorFacingAhead);
    if (throwSide !== null) return { kind: 'throw', side: throwSide };

    const dropPos = this.findDropAreaHit(x, y, 4);
    if (dropPos !== null) return { kind: 'drop', pos: dropPos };
    return null;
  }

  tryUseFrontWallItem(x: number, y: number): boolean {
    if (!this.ui.partyState || !this.ui.context) return false;
    if ((this.ui.partyState.cursorOwner ?? -1) < 0) return false;
    if (!this.isViewportButtonHit(5, x, y)) return false;
    if (this.ui.context.facingAlcove) return false;
    if (!this.ui.context.facingWaterFountain) return false;

    const objectId = normalizeObjectValue(this.ui.partyState.objectInHand);
    if (objectId === null) return false;
    if (!isLikelyObjectRecord(this.ui, objectId)) return false;

    const objectNameIndex = resolveObjectNameIndex(this.ui, objectId | 0);
    if (objectNameIndex < 0) return false;

    if (objectNameIndex >= OBJNI_WATERSKIN && objectNameIndex <= OBJNI_WATER) {
      const misc = this.ui.dungeonState.getMiscRecord(objectId as ObjectID);
      if (!misc) return false;
      misc.specialState = 3;
      return true;
    }

    if (objectNameIndex === OBJNI_EMPTY_FLASK) {
      const potion = this.ui.dungeonState.getPotionRecord(objectId as ObjectID);
      if (!potion) return false;
      potion.potionType = POTION_WATER_FLASK;
      return true;
    }

    return false;
  }

  private findDropAreaHit(x: number, y: number, count: number): number | null {
    const areas = this.ui.uiTables?.graphic231.dropAreas;
    if (!areas || areas.length === 0) return null;
    const max = Math.min(count, areas.length);
    for (let i = 0; i < max; i++) {
      const rect = areas[i];
      if (!rect) continue;
      if (x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2) return i;
    }
    return null;
  }

  private isViewportButtonHit(index: number, x: number, y: number): boolean {
    const buttons = this.ui.context?.viewportObjectButtons;
    if (!buttons || index < 0 || index >= buttons.length) return false;
    const rect = buttons[index];
    if (!rect || rect.x1 === 255) return false;
    const vx = x - VIEWPORT_X;
    const vy = y - VIEWPORT_Y;
    return vx >= rect.x1 && vx <= rect.x2 && vy >= rect.y1 && vy <= rect.y2;
  }

  private testThrow(clickX: number, clickY: number, doorFacing: boolean): 0 | 1 | null {
    if (clickY < 47 || clickY > 102) return null;
    if (clickX <= 111) {
      if (clickX < 32) return null;
      if (clickX < 64 && doorFacing) return null;
      return 0;
    }
    if (clickX > 191) return null;
    if (clickX > 163 && doorFacing) return null;
    return 1;
  }

  private isFrontCellStoneOrVisibleFalseWall(): boolean {
    if (!this.ui.partyState) return false;
    const facing = this.ui.partyState.facing & 0x3;
    const pos = this.ui.partyState.position;
    const target =
      facing === 0 ? pos.north :
      facing === 1 ? pos.east :
      facing === 2 ? pos.south :
      pos.west;
    const map = this.ui.dungeonState.getMap(target.z);
    if (!map) return true;
    if (target.x < 0 || target.y < 0 || target.x >= map.descriptor.width || target.y >= map.descriptor.height) return true;
    const cellFlag = map.cellFlags[target.x]?.[target.y];
    if (cellFlag === undefined) return true;
    const roomType = (cellFlag >> 5) & 0x7;
    if (roomType === RoomType.STONE) return true;
    if (roomType === RoomType.FALSEWALL && (cellFlag & 0x5) === 0) return true;
    return false;
  }

  private isFrontCellDoorFacing(): boolean {
    const rd = this.ui.context?.roomData?.[17];
    return rd?.graphicRoomType === GraphicRoomType.DOOR_FACING;
  }

  private findViewportObjectHit(x: number, y: number): { relativeLocation: number; rn: ObjectID } | null {
    const buttons = this.ui.context?.viewportObjectButtons;
    const rns = this.ui.context?.viewportObjectRNs;
    if (!buttons || !rns) return null;

    const vx = x - VIEWPORT_X;
    const vy = y - VIEWPORT_Y;
    if (vx < 0 || vy < 0 || vx >= VIEWPORT_WIDTH || vy >= VIEWPORT_HEIGHT) return null;

    const max = Math.min(5, buttons.length, rns.length);
    for (let i = 0; i < max; i++) {
      const rect = buttons[i];
      if (!rect || rect.x1 === 255) continue;
      if (vx < rect.x1 || vx > rect.x2 || vy < rect.y1 || vy > rect.y2) continue;
      const rn = rns[i];
      if (normalizeObjectValue(rn) === null) continue;
      return { relativeLocation: i, rn };
    }
    return null;
  }

  private getPickupCellForRelativePos(relativeLocation: number): Position | null {
    if (!this.ui.partyState) return null;
    const facing = this.ui.partyState.facing & 0x3;
    let target = this.ui.partyState.position;
    if (relativeLocation >= 2) {
      target =
        facing === 0 ? target.north :
        facing === 1 ? target.east :
        facing === 2 ? target.south :
        target.west;
    }
    return target;
  }

  private isMonsterBlockingPickup(relativeLocation: number, position: Position): boolean {
    if (!this.ui.partyState || relativeLocation < 2) return false;
    const rn = this.findFirstMonsterAt(position);
    if (rn === OBJECT_ID_EOF) return false;
    const creature = this.ui.dungeonState.getCreatureRecord(rn);
    if (!creature || this.isMonsterLevitating(creature)) return false;
    const monsterCount = Math.max(1, creature.count ?? 1);
    const absPos = (this.ui.partyState.facing + relativeLocation) & 0x3;
    return this.monsterOccupiesPosition(creature.positions, absPos, monsterCount);
  }

  private findFirstMonsterAt(position: Position): ObjectID {
    for (let rn = this.ui.dungeonState.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.ui.dungeonState.getDBRecordLink(rn)) {
      const { category } = decodeObjectID(rn);
      if (category === DBType.CREATURE) return rn;
    }
    return OBJECT_ID_EOF;
  }

  private isMonsterLevitating(creature: CreatureRecord): boolean {
    const desc = this.ui.objectTables?.monsterDesc?.[creature.creatureType];
    if (!desc) return false;
    return (desc.word2 & 0x20) !== 0;
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
    this.drawStaticUIFrame();
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
    this.drawHoverHighlights();
    this.drawCursorItem();

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
    const index = Math.min(this.selectPaletteIndexForLightLevel(), this.viewportPalettes.length - 1);
    return this.viewportPalettes[index] ?? this.viewportPalettes[0] ?? null;
  }

  private selectPaletteIndexForLightLevel(): number {
    if (!this.ui.uiTables || !this.ui.partyState) return 0;
    const { paletteBrightness, word1074 } = this.ui.uiTables.graphic232;
    if (!paletteBrightness || paletteBrightness.length === 0 || !word1074 || word1074.length === 0) return 0;

    const map = this.ui.dungeonState.getMap(this.ui.partyState.position.z);
    const experienceMultiplier = map?.descriptor.difficulty ?? 0;
    if (experienceMultiplier === 0) return 0;

    const torchLight = this.computeTorchLight(word1074);
    const totalLight = (this.ui.partyState.brightness ?? 0) + torchLight;

    if (totalLight <= 0) return paletteBrightness.length - 1;

    let paletteIndex = 0;
    for (let i = 0; i < paletteBrightness.length; i++) {
      if ((paletteBrightness[i] ?? 0) > totalLight) {
        paletteIndex++;
      } else {
        break;
      }
    }

    if (paletteIndex < 0) paletteIndex = 0;
    if (paletteIndex >= paletteBrightness.length) paletteIndex = paletteBrightness.length - 1;
    return paletteIndex;
  }

  private computeTorchLight(word1074: number[]): number {
    if (!this.ui.partyState) return 0;
    const charges = this.collectTorchCharges();

    // CSBWin selection-sort: bring four brightest charges to the front.
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < charges.length; j++) {
        if (charges[j] > charges[i]) {
          const temp = charges[j];
          charges[j] = charges[i];
          charges[i] = temp;
        }
      }
    }

    let total = 0;
    let shift = 6;
    for (let i = 0; i < 5 && i < charges.length; i++) {
      const charge = charges[i] ?? 0;
      if (charge === 0) continue;
      const idx = Math.max(0, Math.min(charge, word1074.length - 1));
      let value = word1074[idx] ?? 0;
      value &= 0xffff;
      value = (value << shift) >>> 0;
      value = (value >>> 6) & 0x3ff;
      total += value;
      shift = Math.max(0, shift - 1);
    }

    return total;
  }

  private collectTorchCharges(): number[] {
    const charges = new Array(8).fill(0);
    if (!this.ui.partyState) return charges;

    let outIndex = 0;
    for (let chIdx = 0; chIdx < 4; chIdx++) {
      const champ = this.ui.partyState.champions[chIdx];
      for (let hand = 0; hand < 2; hand++) {
        if (!champ) {
          charges[outIndex++] = 0;
          continue;
        }
        const objectId = normalizeObjectValue(getChampionPossession(champ, hand));
        if (objectId === null) {
          charges[outIndex++] = 0;
          continue;
        }
        const baseNameIndex = getBaseObjectNameIndex(this.ui, objectId);
        if (baseNameIndex >= OBJNI_TORCH_A && baseNameIndex <= OBJNI_TORCH_D) {
          charges[outIndex++] = this.getTorchCharge(objectId);
        } else {
          charges[outIndex++] = 0;
        }
      }
    }
    return charges;
  }

  private getTorchCharge(objectId: number): number {
    if (!isLikelyObjectRecord(this.ui, objectId)) return 0;
    const weapon = this.ui.dungeonState.getWeaponRecord(objectId as ObjectID);
    if (!weapon) return 0;
    return weapon.charges & 0xf;
  }

  private drawStaticUIFrame(): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer) return;

    const g232 = this.ui.uiTables.graphic232;
    fillRectIndex(this.ui.screenIndexBuffer, g232.wRectPos1780, 0);
    fillRectIndex(this.ui.screenIndexBuffer, g232.wRectPos1788, 0);
    fillRectIndex(this.ui.screenIndexBuffer, g232.wRectPos1796, 0);

    const movementGraphic = this.getGraphicBitmap(13);
    if (!movementGraphic) return;
    const rect = g232.word28;
    tag0088b2Index(
      movementGraphic,
      this.ui.screenIndexBuffer,
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

  private handleMouseButton(id: number, x: number, y: number): void {
    // updateDebug(`handling click on ${id}`)
    if (id === 80 && this.isEyeClick(x, y)) {
      this.handleEyePress();
      return;
    }
    if (id === 70) {
      handleMouthPress(this.ui);
      return;
    }
    if (id === 100) {
      handleMagicClick(this.ui, x, y);
      return;
    }
    if (id === 81) {
      this.handleChestAreaClick(x, y);
      return;
    }
    if (id === 83) {
      if (!this.ui.partyState) return;
      const owner = this.ui.partyState.cursorOwner;
      if (owner >= 0) this.handleInventoryToggle(owner);
      return;
    }
    if (id >= 7 && id <= 11) {
      this.handleInventoryToggle(id - 7);
      return;
    }
    if (id >= 12 && id <= 15) {
      this.handlePartyBlockClick(id - 12, x, y);
      return;
    }
    if (id >= 28 && id <= 65) {
      if ((this.ui.partyState?.cursorOwner ?? -1) >= 0) {
        this.handleClothingClick(id - 20);
      }
      return;
    }
    if (id === 71) {
      this.handleEyePress();
      return;
    }
  }

  private isEyeClick(x: number, y: number): boolean {
    if (!this.ui.partyState || this.ui.partyState.selectedCharacterIndex < 0) return false;
    const rect = getEyeRect(this.ui);
    if (!rect) return false;
    return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
  }

  private handleMouseUnclick(): void {
    if (this.ui.pressingEye) {
      this.ui.pressingEye = false;
    }
  }

  private handleEyePress(): void {
    if (!this.ui.partyState) return;
    if (this.ui.partyState.selectedCharacterIndex < 0) return;
    this.ui.pressingEye = true;
  }

  private renderLastFrame(): void {
    if (!this.lastRenderPosition) return;
    this.render(this.lastRenderPosition, this.lastRenderFacing);
  }

  private handlePartyBlockClick(button: number, x: number, y: number): void {
    if (!this.ui.uiTables || !this.ui.partyState) return;
    if (this.ui.partyState.selectedCharacterIndex === button) {
      const champ =
        this.ui.partyState.champions.find((c) => c.partyPosition === button) ??
        this.ui.partyState.champions[button] ??
        null;
      if (champ && champ.alive === false) return;
      this.ui.partyState.cursorOwner = button;
      return;
    }
    const sub = searchButtonList(this.ui.uiTables.graphic231.buttons.buttons18216, x, y, 2);
    if (sub >= 16 && sub <= 19) {
      this.ui.partyState.cursorOwner = sub - 16;
      return;
    }
    if (sub >= 20 && sub <= 27) {
      if ((this.ui.partyState.cursorOwner ?? -1) >= 0) {
        this.handleClothingClick(sub - 20);
      }
    }
  }

  private handleChestAreaClick(clickX: number, clickY: number): void {
    if (!this.ui.uiTables || !this.ui.partyState) return;
    if ((this.ui.partyState.cursorOwner ?? -1) < 0) return;

    const selected = this.ui.partyState.selectedCharacterIndex ?? -1;
    if (selected < 0) return;
    const champ =
      this.ui.partyState.champions.find((c) => c.partyPosition === selected) ??
      this.ui.partyState.champions[selected] ??
      null;
    if (!champ || champ.alive === false) return;

    const chestView = getActiveChestView(this.ui, champ);
    if (!chestView || chestView.source !== 'hand') return;

    const button = searchButtonList(this.ui.uiTables.graphic231.buttons.buttons18324, clickX, clickY, 2);
    if (button !== 0) {
      this.handleClothingClick(button - 20);
    }
  }

  private handleInventoryToggle(button: number): void {
    if (!this.ui.partyState) return;
    if (button === 4) {
      syncOpenChest(this.ui, null);
      this.ui.partyState.selectedCharacterIndex = -1;
      this.ui.pressingEye = false;
      this.syncInventoryButtons();
      return;
    }
    if (button < 0 || button > 3) return;
    const champ =
      this.ui.partyState.champions.find((c) => c.partyPosition === button) ??
      this.ui.partyState.champions[button] ??
      null;
    if (!champ || champ.alive === false) return;
    const previous = this.ui.partyState.selectedCharacterIndex;
    this.ui.partyState.selectedCharacterIndex =
      this.ui.partyState.selectedCharacterIndex === button ? -1 : button;
    if (this.ui.partyState.selectedCharacterIndex !== previous) {
      syncOpenChest(this.ui, null);
    }
    if (this.ui.partyState.selectedCharacterIndex < 0) {
      this.ui.pressingEye = false;
    }
    this.syncInventoryButtons();
  }

  private syncInventoryButtons(): void {
    if (!this.ui.uiTables || this.ui.uiMode !== UIMode.Adventure) return;
    const buttons = this.ui.uiTables.graphic231.buttons;
    const inventoryOpen = (this.ui.partyState?.selectedCharacterIndex ?? -1) >= 0;
    this.ui.secondaryButtons = inventoryOpen ? buttons.buttons17760 : buttons.buttons17304;
  }

  private handleClothingClick(button: number): void {
    if (!this.ui.partyState || !this.ui.uiTables) return;
    const cursorOwner = this.ui.partyState.cursorOwner ?? -1;
    if (cursorOwner < 0) return;

    let chIdx = -1;
    let slot = -1;
    if (button < 8) {
      chIdx = Math.floor(button / 2);
      if (chIdx >= this.ui.partyState.champions.length) return;
      if (this.ui.partyState.selectedCharacterIndex === chIdx) return;
      const champ =
        this.ui.partyState.champions.find((c) => c.partyPosition === chIdx) ??
        this.ui.partyState.champions[chIdx] ??
        null;
      if (!champ || champ.alive === false) return;
      slot = button & 1;
    } else {
      chIdx = this.ui.partyState.selectedCharacterIndex ?? -1;
      if (chIdx < 0) return;
      slot = button - 8;
    }

    if (slot < 0 || slot >= 38) return;
    const champ =
      this.ui.partyState.champions.find((c) => c.partyPosition === chIdx) ??
      this.ui.partyState.champions[chIdx] ??
      null;
    if (!champ || champ.alive === false) return;

    const chestView = getActiveChestView(this.ui, champ);
    const isChestSlot = slot >= 30;
    if (isChestSlot) {
      if (!chestView) return;
      syncOpenChest(this.ui, chestView);
    }

    const objectInHand = normalizeObjectValue(this.ui.partyState.objectInHand);
    const slotObject = isChestSlot
      ? normalizeObjectValue(this.ui.openChestContents[slot - 30] ?? null)
      : normalizeObjectValue(getChampionPossession(champ, slot));
    if (!objectInHand && !slotObject) return;

    if (objectInHand && !canPlaceInSlot(this.ui, objectInHand, slot)) return;

    if (objectInHand) {
      this.ui.partyState.objectInHand = null;
    }
    if (slotObject) {
      if (isChestSlot) {
        this.ui.openChestContents[slot - 30] = null;
      } else {
        setChampionPossession(this.ui, champ, slot, null);
      }
      this.ui.partyState.objectInHand = slotObject;
    }
    if (objectInHand) {
      if (isChestSlot) {
        this.ui.openChestContents[slot - 30] = objectInHand;
      } else {
        setChampionPossession(this.ui, champ, slot, objectInHand);
      }
    }
  }

  private drawCursorItem(): void {
    if (!this.ui.screenIndexBuffer || !this.ui.uiTables || !this.ui.partyState || !this.ui.hoverPoint) return;
    const objectId = normalizeObjectValue(this.ui.partyState.objectInHand);
    if (objectId === null) {
      this.drawEmptyCursor();
      return;
    }

    const word612 = this.ui.uiTables.graphic232.word612;
    const objectNameIndex = resolveObjectNameIndex(this.ui, objectId | 0);
    if (objectNameIndex < 0) return;

    const baseX = Math.floor(this.ui.hoverPoint.x) - 8;
    const baseY = Math.floor(this.ui.hoverPoint.y) - 8;
    drawObjectIconAt(this.ui, baseX + 2, baseY + 2, objectNameIndex, word612, 12, 0);
    drawObjectIconAt(this.ui, baseX, baseY, objectNameIndex, word612, 12);
  }

  private drawEmptyCursor(): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer || !this.ui.hoverPoint) return;
    const x = Math.floor(this.ui.hoverPoint.x);
    const y = Math.floor(this.ui.hoverPoint.y);
    const useHand = this.shouldUseHandCursor(x, y);
    const bitmap = useHand ? this.getCursorHandBitmap() : this.getCursorArrowBitmap();
    if (!bitmap) return;

    this.drawCursorBitmap(bitmap, x, y, 12);
  }

  private shouldUseHandCursor(x: number, y: number): boolean {
    const cursorOwner = this.ui.partyState?.cursorOwner ?? -1;
    if (cursorOwner < 0) return false;

    if (y >= 169) return false;
    if (x >= 274) return false;

    if (y <= 28) {
      const numChar = this.ui.partyState?.champions.length ?? 0;
      const selectedOrdinal = (this.ui.partyState?.selectedCharacterIndex ?? -1) + 1;
      const charIndex = Math.floor(x / 69);
      const pixelWithin = x - charIndex * 69;
      if (charIndex < numChar && pixelWithin <= 42) {
        if (charIndex + 1 === selectedOrdinal) return false;
        if (y <= 6) return false;
      }
    } else if (x >= 224) {
      return false;
    }

    return true;
  }

  private getCursorArrowBitmap(): IndexedBitmap | null {
    if (!this.ui.uiTables) return null;
    if (this.ui.cursorArrowBitmap) return this.ui.cursorArrowBitmap;
    this.ui.cursorArrowBitmap = this.decodeCursorBitmap(this.ui.uiTables.graphic232.cursorArrow);
    return this.ui.cursorArrowBitmap;
  }

  private getCursorHandBitmap(): IndexedBitmap | null {
    if (!this.ui.uiTables) return null;
    if (this.ui.cursorHandBitmap) return this.ui.cursorHandBitmap;
    this.ui.cursorHandBitmap = this.decodeCursorBitmap(this.ui.uiTables.graphic232.cursorHand);
    return this.ui.cursorHandBitmap;
  }

  private decodeCursorBitmap(raw: Uint8Array): IndexedBitmap | null {
    if (!raw || raw.length < 128) return null;
    const pixels = new Uint8Array(16 * 16);
    for (let row = 0; row < 16; row++) {
      const base = row * 8;
      const p0 = ((raw[base] ?? 0) << 8) | (raw[base + 1] ?? 0);
      const p1 = ((raw[base + 2] ?? 0) << 8) | (raw[base + 3] ?? 0);
      const p2 = ((raw[base + 4] ?? 0) << 8) | (raw[base + 5] ?? 0);
      const p3 = ((raw[base + 6] ?? 0) << 8) | (raw[base + 7] ?? 0);
      for (let col = 0; col < 16; col++) {
        const bit = 15 - col;
        const v =
          ((p0 >> bit) & 1) |
          (((p1 >> bit) & 1) << 1) |
          (((p2 >> bit) & 1) << 2) |
          (((p3 >> bit) & 1) << 3);
        pixels[row * 16 + col] = v & 0x0f;
      }
    }
    return { width: 16, height: 16, pixels };
  }

  private drawCursorBitmap(bitmap: IndexedBitmap, x: number, y: number, transparentColor: number): void {
    if (!this.ui.screenIndexBuffer) return;
    const dst = this.ui.screenIndexBuffer;
    const maxW = bitmap.width;
    const maxH = bitmap.height;
    const tc = transparentColor & 0x0f;

    for (let row = 0; row < maxH; row++) {
      const dy = y + row;
      if (dy < 0 || dy >= dst.height) continue;
      const dstRow = dy * dst.width;
      const srcRow = row * bitmap.width;
      for (let col = 0; col < maxW; col++) {
        const dx = x + col;
        if (dx < 0 || dx >= dst.width) continue;
        const pixel = bitmap.pixels[srcRow + col] & 0x0f;
        if (pixel === tc) continue;
        dst.pixels[dstRow + dx] = pixel;
      }
    }
  }

  private updateButtonLists(): void {
    if (!this.ui.uiTables) return;
    const buttons = this.ui.uiTables.graphic231.buttons;
    switch (this.ui.uiMode) {
      case UIMode.Sleeping:
        this.ui.primaryButtons = buttons.buttons17796;
        this.ui.secondaryButtons = null;
        break;
      case UIMode.Frozen:
        this.ui.primaryButtons = buttons.buttons17832;
        this.ui.secondaryButtons = null;
        break;
      case UIMode.Adventure:
      default:
        this.ui.primaryButtons = buttons.buttons17196;
        this.ui.secondaryButtons = buttons.buttons17304;
        break;
    }
  }

  private drawHoverHighlights() {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer || !this.ui.hoverPoint) return;
    const { x, y } = this.ui.hoverPoint;

    const hovered: string[] = [];
    for (const btn of this.ui.uiTables.graphic231.moveButtons) {
      if (pointInRect(x, y, btn)) {
        // drawRectOutlineIndex(this.ui.screenIndexBuffer, btn, 15);
      }
    }

    const buttonGroups = Object.values(this.ui.uiTables.graphic231.buttons);
    for (const group of buttonGroups) {
      for (const btn of group) {
        if (pointInRect(x, y, btn)) {
          hovered.push(`231: ${btn.name ?? '?'} - ${btn.button} - ${btn.word0}`);
          drawRectOutlineIndex(this.ui.screenIndexBuffer, btn, 9);
        }
      }
    }
    updateHover(hovered.join("<br>"));
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
