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
import type { Champion, PartyState } from '../engine/gameTypes';
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
import { extractUITables, Rect, UIButton, type UITables } from './csbwin/UITables';
import { drawTextLineIndex, drawTextLineIndexRaw, loadFontData } from './csbwin/TextRenderer';
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
import { getOrSet, Position, SoundIndex } from '@/core';
import { DBType, decodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, RoomType, type ObjectID } from '../core/types';
import { updateHover } from '@/ui';
import { createUIState, nowMs, UIMode, type ObjectMoveHandler, type UIState } from './ui/UIState';
import {
  applyViewingFilter,
  descIndexForObject,
  drawItemDescriptionLine,
  getAttackClass,
  getBaseObjectNameIndex,
  getDescIndexForObjectType,
  getInventoryPlaceholderIndex,
  getObjectDescriptionLines,
  getObjectDisplayName,
  getObjectWeight,
  getRoleMastery,
  isBaseObjectNameIndex,
  isChestRecord,
  isLikelyObjectRecord,
  normalizeObjectValue,
  normalizeWord6,
  resolveObjectNameIndex,
} from './ui/Objects';
import {
  blitBasicGraphicToViewport,
  computeBarHeight,
  drawFoodWaterBar,
  drawMaskedBarRow,
  drawMessageLines,
  drawObjectIcon,
  drawObjectIconAt,
  drawObjectIconMask,
  drawWoundedOutline,
  pointInRect,
  shadeRectIndex,
} from './ui/Draw';
import { GraphicRoomType } from './bytecode/Types';
import type { TextDecodeTables } from '../engine/DungeonState';
import type { ViewingFilterOptions, ViewingFilterResult } from '../engine/DsaSystem';
import {
    OBJNI_APPLE,
    OBJNI_BONES_A,
    OBJNI_DRAGON_STEAK,
    OBJNI_ELVEN_BOOTS,
    OBJNI_EMPTY_FLASK,
    OBJNI_ILLUMULET_A,
    OBJNI_ILLUMULET_B,
    OBJNI_OPEN_CHEST,
    OBJNI_SPECIAL_C,
    OBJNI_SPECIAL_D,
    OBJNI_SPECIAL_E,
    OBJNI_SPECIAL_G,
    OBJNI_SPECIAL_H,
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
type FeedingOutcome = {
  foodDelta: number;
  waterDelta: number;
  removeFromHand: boolean;
  deleteRecord: boolean;
  chew: boolean;
  playGulp: boolean;
};
type ChestViewSource =
  | { id: ObjectID; source: 'cursor' }
  | { id: ObjectID; source: 'hand'; slot: number };

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

const MAX_LINES_IN_SCROLL = 9;
const POTION_EMPTY_FLASK = 20;
const POTION_WATER_FLASK = 15;
const MAX_SCROLL_LINE_LENGTH = 16;
const ROLE_LABELS = ['FIGHTER', 'NINJA', 'PRIEST', 'WIZARD'];
const CHAR_COLORS = [7, 11, 8, 14];
const MASTERY_LABELS = [
  '',
  '',
  'NEOPHYTE',
  'NOVICE',
  'APPRENTICE',
  'JOURNEYMAN',
  'CRAFTSMAN',
  'ARTISAN',
  'ADEPT',
  'EXPERT',
  '` MASTER',
  'A MASTER',
  'B MASTER',
  'C MASTER',
  'D MASTER',
  'E MASTER',
  'ARCHMASTER',
];
const ATTRIBUTE_LABELS = ['STRENGTH', 'DEXTERITY', 'WISDOM', 'VITALITY', 'ANTI-MAGIC', 'ANTI-FIRE'];

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

    let id = this.searchButtonList(this.ui.primaryButtons, x, y, buttons);
    if (id === 0) {
      id = this.searchButtonList(this.ui.secondaryButtons, x, y, buttons);
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
      this.syncOpenChest(null);
    }
    if (inventoryOpen) {
      this.drawInventoryBackground();
    } else {
      this.blitViewportToScreen();
    }
    this.drawPartyStatus();
    if (inventoryOpen) {
      this.drawInventoryScreen();
      if (this.ui.uiTables) shadeRectIndex(this.ui, this.ui.uiTables.graphic232.word28, 0);
    }
    this.drawAttackButtons();
    this.drawAttackPanel();
    this.drawSpellPanel();
    this.drawSpellControls();
    this.drawHeldObjectName();
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
        const objectId = normalizeObjectValue(this.getChampionPossession(champ, hand));
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

    const ui = this.ui.uiTables.graphic232;
    fillRectIndex(this.ui.screenIndexBuffer, ui.wRectPos1780, 0);
    fillRectIndex(this.ui.screenIndexBuffer, ui.wRectPos1788, 0);
    fillRectIndex(this.ui.screenIndexBuffer, ui.wRectPos1796, 0);

    const movementGraphic = this.getGraphicBitmap(13);
    if (!movementGraphic) return;
    const rect = ui.word28;
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

  private drawInventoryBackground(): void {
    if (!this.ui.screenIndexBuffer) return;
    const bg = this.getGraphicBitmap(17);
    if (!bg) return;
    tag0088b2Index(
      bg,
      this.ui.screenIndexBuffer,
      {
        x1: VIEWPORT_X,
        y1: VIEWPORT_Y,
        x2: VIEWPORT_X + bg.width - 1,
        y2: VIEWPORT_Y + bg.height - 1,
        srcX: 0,
        srcY: 0,
        srcStride: bg.width,
        srcWidth: bg.width,
        srcHeight: bg.height,
      },
      -1
    );
  }

  private drawFoodWaterPanel(champion: Champion): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer) return;
    const ui = this.ui.uiTables.graphic232;
    blitBasicGraphicToViewport(this.ui, 20, ui.wRectPos926, 144, 8);
    blitBasicGraphicToViewport(this.ui, 30, ui.wRectPos950, 48, 12);
    blitBasicGraphicToViewport(this.ui, 31, ui.wRectPos958, 48, 12);
    if ((champion.poisonCount ?? 0) !== 0) {
      blitBasicGraphicToViewport(this.ui, 32, ui.wRectPos966, 96, 12);
    }

    drawFoodWaterBar(this.ui, champion.food ?? 0, 69, 5);
    drawFoodWaterBar(this.ui, champion.water ?? 0, 92, 14);
  }

  private drawAttributePanel(champion: Champion): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer || !this.ui.fontData) return;
    const ui = this.ui.uiTables.graphic232;
    blitBasicGraphicToViewport(this.ui, 20, ui.wRectPos926, 144, 8);

    let lineY = 58;
    for (let role = 0; role < ROLE_LABELS.length; role++) {
      const mastery = getRoleMastery(this.ui, champion, role);
      if (mastery <= 1) continue;
      const masteryLabel = MASTERY_LABELS[mastery] ?? '';
      if (!masteryLabel) continue;
      drawTextLineIndex(
        this.ui.screenIndexBuffer,
        this.ui.fontData,
        VIEWPORT_X + 107,
        VIEWPORT_Y + lineY,
        13,
        null,
        `${masteryLabel} ${ROLE_LABELS[role]}`
      );
      lineY += 7;
    }

    const attrValues = [
      champion.attributes?.strength ?? 0,
      champion.attributes?.dexterity ?? 0,
      champion.attributes?.wisdom ?? 0,
      champion.attributes?.vitality ?? 0,
      champion.attributes?.antiMagic ?? 0,
      champion.attributes?.antiFire ?? 0,
    ];
    const attrMax = attrValues.slice();
    lineY = 86;
    for (let i = 0; i < ATTRIBUTE_LABELS.length; i++) {
      const current = attrValues[i] ?? 0;
      const max = attrMax[i] ?? 0;
      let valueColor = 13;
      if (current < max) valueColor = 8;
      else if (current > max) valueColor = 7;

      drawTextLineIndex(
        this.ui.screenIndexBuffer,
        this.ui.fontData,
        VIEWPORT_X + 107,
        VIEWPORT_Y + lineY,
        13,
        null,
        ATTRIBUTE_LABELS[i] ?? ''
      );
      drawTextLineIndex(
        this.ui.screenIndexBuffer,
        this.ui.fontData,
        VIEWPORT_X + 173,
        VIEWPORT_Y + lineY,
        valueColor,
        null,
        this.formatLifeValue(current)
      );
      drawTextLineIndex(
        this.ui.screenIndexBuffer,
        this.ui.fontData,
        VIEWPORT_X + 191,
        VIEWPORT_Y + lineY,
        13,
        null,
        `/${this.formatLifeValue(max)}`
      );
      lineY += 7;
    }
  }

  private drawObjectInfoPanel(objectId: ObjectID): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer || !this.ui.fontData || !this.ui.objectTables) return;
    if (decodeObjectID(objectId).category === DBType.SCROLL) {
      this.drawScrollPanel(objectId);
      return;
    }
    const ui = this.ui.uiTables.graphic232;
    blitBasicGraphicToViewport(this.ui, 20, ui.wRectPos926, 144, 8);
    blitBasicGraphicToViewport(this.ui, 29, ui.wRectPos942, 32, 12);

    const objectNameIndex = resolveObjectNameIndex(this.ui, objectId | 0);
    if (objectNameIndex >= 0) {
      const iconRect = {
        x1: VIEWPORT_X + 111,
        y1: VIEWPORT_Y + 59,
        x2: VIEWPORT_X + 126,
        y2: VIEWPORT_Y + 74,
      };
      drawObjectIcon(this.ui, iconRect, objectNameIndex, ui.word612);
      const name = getObjectDisplayName(this.ui, objectId, objectNameIndex);
      if (name) {
        drawTextLineIndex(
          this.ui.screenIndexBuffer,
          this.ui.fontData,
          VIEWPORT_X + 133,
          VIEWPORT_Y + 68,
          13,
          null,
          name
        );
      }
    }

    const lines = getObjectDescriptionLines(this.ui, objectId, objectNameIndex);
    const textState = { x: VIEWPORT_X + 108, y: VIEWPORT_Y + 87 };
    for (const line of lines) {
      drawItemDescriptionLine(this.ui, line.text, line.color, textState);
    }
    this.drawInspectArrow(this.ui.pressingEye);
  }

  private drawScrollPanel(objectId: ObjectID): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer || !this.ui.fontData || !this.ui.objectTables) return;
    let scrollId = objectId;
    const filter = applyViewingFilter(this.ui, objectId, 0);
    if (filter) {
      const candidate = filter.objectId | 0;
      if (candidate >= 0 && isLikelyObjectRecord(this.ui, candidate)) {
        const decoded = decodeObjectID(candidate as ObjectID);
        if (decoded.category === DBType.SCROLL) scrollId = candidate as ObjectID;
      }
    }

    const scroll = this.ui.dungeonState.getScrollRecord(scrollId);
    if (!scroll) return;
    const textTables: TextDecodeTables = {
      escape1: this.ui.objectTables.textEscape1,
      escape2Wall: this.ui.objectTables.textEscape2Wall,
      escape2Other: this.ui.objectTables.textEscape2Other,
    };
    const text = this.ui.dungeonState.decodeScrollText(scroll, textTables) ?? '';

    const ui = this.ui.uiTables.graphic232;
    blitBasicGraphicToViewport(this.ui, 23, ui.wRectPos926, 144, 8);

    const { lines, startY } = this.splitScrollLines(text);
    let y = startY;
    for (const line of lines) {
      this.drawScrollLine(y, line);
      y += 7;
    }
    this.drawInspectArrow(this.ui.pressingEye);
  }

  private splitScrollLines(text: string): { lines: string[]; startY: number } {
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 0xff);
    bytes.push(0, 0);

    let cursor = 0;
    while (bytes[cursor] !== 0 && bytes[cursor] !== 10) cursor++;
    const firstLine = this.bytesToString(bytes, 0, cursor);
    bytes[cursor] = 0;
    cursor++;

    let numLines = 1;
    let scan = cursor;
    while (bytes[scan] !== 0) {
      if (bytes[scan] === 10) numLines++;
      scan++;
    }

    const lastIndex = scan - 1;
    if (lastIndex >= 0) {
      if (bytes[lastIndex] !== 10) {
        numLines++;
      } else if (lastIndex - 1 >= 0 && bytes[lastIndex - 1] === 10) {
        numLines--;
      }
    }

    if (numLines > MAX_LINES_IN_SCROLL) numLines = MAX_LINES_IN_SCROLL;
    const startY = 92 - Math.floor((7 * numLines) / 2);

    const lines: string[] = [];
    lines.push(firstLine);
    numLines -= 1;
    if (numLines <= 0) return { lines, startY };

    let lineStart = cursor;
    for (let remaining = numLines; remaining > 0; remaining--) {
      while (bytes[cursor] !== 0 && bytes[cursor] !== 10) cursor++;
      if (bytes[cursor] === 0) {
        bytes[cursor + 1] = 0;
      }
      bytes[cursor] = 0;
      lines.push(this.bytesToString(bytes, lineStart, cursor));
      cursor++;
      lineStart = cursor;
    }

    return { lines, startY };
  }

  private bytesToString(bytes: number[], start: number, end: number): string {
    let out = '';
    for (let i = start; i < end; i++) {
      out += String.fromCharCode(bytes[i] ?? 0);
    }
    return out;
  }

  private drawScrollLine(y: number, text: string): void {
    if (!this.ui.fontData || !this.ui.screenIndexBuffer) return;
    const line = text.length > MAX_SCROLL_LINE_LENGTH ? text.slice(0, MAX_SCROLL_LINE_LENGTH) : text;
    const encoded = this.encodeScrollFontText(line);
    const x = VIEWPORT_X + 162 - Math.floor((line.length * 6) / 2);
    drawTextLineIndexRaw(this.ui.screenIndexBuffer, this.ui.fontData, x, VIEWPORT_Y + y, 0, 15, encoded);
  }

  private encodeScrollFontText(text: string): string {
    const out: number[] = [];
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i) & 0xff;
      if (code >= 65 && code <= 90) {
        code -= 64;
      } else if (code >= 0x7b) {
        code -= 0x60;
      }
      out.push(code);
    }
    return String.fromCharCode(...out);
  }

  private drawEyeIcon(): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer) return;
    const word612 = this.ui.uiTables.graphic232.word612;
    const icon = this.ui.pressingEye ? OBJNI_SPECIAL_E : OBJNI_SPECIAL_D;
    const rect = this.getEyeRect();
    if (!rect) return;
    drawObjectIcon(this.ui, rect, icon, word612);
  }

  private getEyeRect(): Rect | null {
    if (!this.ui.uiTables) return null;
    const rect = this.ui.uiTables.graphic232.word1406;
    return {
      x1: rect.x1 + VIEWPORT_X + 1,
      y1: rect.y1 + VIEWPORT_Y + 1,
      x2: rect.x2 + VIEWPORT_X - 1,
      y2: rect.y2 + VIEWPORT_Y - 1,
    };
  }

  private drawVitalsAndLoad(champion: Champion): void {
    if (!this.ui.fontData || !this.ui.screenIndexBuffer) return;

    const attrs = champion.attributes;
    const health = attrs?.health ?? 0;
    const maxHealth = attrs?.maxHealth ?? 0;
    const stamina = Math.floor((attrs?.stamina ?? 0) / 10);
    const maxStamina = Math.floor((attrs?.maxStamina ?? 0) / 10);
    const mana = attrs?.mana ?? 0;
    const maxMana = attrs?.maxMana ?? 0;

    const baseX = VIEWPORT_X + 54;
    const slashX = VIEWPORT_X + 72;
    const maxX = VIEWPORT_X + 78;
    const labelX = VIEWPORT_X + 4;
    const lineHealth = VIEWPORT_Y + 116;
    const lineStamina = VIEWPORT_Y + 124;
    const lineMana = VIEWPORT_Y + 132;
    const vitalsColor = 13;

    drawTextLineIndex(this.ui.screenIndexBuffer, this.ui.fontData, labelX, lineHealth, vitalsColor, null, 'HEALTH');
    drawTextLineIndex(this.ui.screenIndexBuffer, this.ui.fontData, labelX, lineStamina, vitalsColor, null, 'STAMINA');
    drawTextLineIndex(this.ui.screenIndexBuffer, this.ui.fontData, labelX, lineMana, vitalsColor, null, 'MANA');

    this.drawLifeForceLine(baseX, slashX, maxX, lineHealth, health, maxHealth, vitalsColor);
    this.drawLifeForceLine(baseX, slashX, maxX, lineStamina, stamina, maxStamina, vitalsColor);
    this.drawLifeForceLine(baseX, slashX, maxX, lineMana, mana, maxMana, vitalsColor);

    const loadInfo = this.computeChampionLoad(champion);
    if (!loadInfo) return;
    const { load, maxLoad, color } = loadInfo;
    drawTextLineIndex(
      this.ui.screenIndexBuffer,
      this.ui.fontData,
      VIEWPORT_X + 103,
      lineMana,
      color,
      null,
      'LOAD'
    );
    drawTextLineIndex(
      this.ui.screenIndexBuffer,
      this.ui.fontData,
      VIEWPORT_X + 147,
      lineMana,
      color,
      null,
      `${this.formatLoad(load)}/${this.formatMaxLoad(maxLoad)} KG`
    );
  }

  private drawLifeForceLine(
    xCurrent: number,
    xSlash: number,
    xMax: number,
    y: number,
    current: number,
    max: number,
    color: number
  ): void {
    if (!this.ui.fontData || !this.ui.screenIndexBuffer) return;
    drawTextLineIndex(
      this.ui.screenIndexBuffer,
      this.ui.fontData,
      xCurrent,
      y,
      color,
      null,
      this.formatLifeValue(current)
    );
    drawTextLineIndex(this.ui.screenIndexBuffer, this.ui.fontData, xSlash, y, color, null, '/');
    drawTextLineIndex(
      this.ui.screenIndexBuffer,
      this.ui.fontData,
      xMax,
      y,
      color,
      null,
      this.formatLifeValue(max)
    );
  }

  private formatLifeValue(value: number): string {
    const clamped = Math.max(0, Math.min(9999, Math.floor(value)));
    return String(clamped).padStart(3, ' ');
  }

  private drawPartyStatus(): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer || !this.ui.partyState || !this.ui.fontData) return;

    const ui = this.ui.uiTables.graphic232;
    const party = this.ui.partyState;
    const facing = party.facing | 0;
    const selected = party.selectedCharacterIndex | 0;

    for (let chIdx = 0; chIdx < 4; chIdx++) {
      const baseX = 69 * chIdx;
      fillRectIndex(
        this.ui.screenIndexBuffer,
        { x1: baseX, y1: 0, x2: baseX + 66, y2: 28 },
        12
      );

      const champion =
        party.champions.find((c) => c.partyPosition === chIdx) ??
        party.champions[chIdx] ??
        null;

      if (selected !== chIdx) {
        const nameRect = { x1: baseX, y1: 0, x2: baseX + 42, y2: 6 };
        fillRectIndex(this.ui.screenIndexBuffer, nameRect, 1);
        if (champion) {
          const nameColor = this.ui.partyState.cursorOwner === champion.partyPosition ? 9 : 13;
          drawTextLineIndex(this.ui.screenIndexBuffer, this.ui.fontData, baseX + 1, 5, nameColor, 1, champion.name);
        }
      }

      if (champion && champion.alive === false) {
        const deadGraphic = this.getGraphicBitmap(8);
        if (deadGraphic) {
          tag0088b2Index(
            deadGraphic,
            this.ui.screenIndexBuffer,
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

      if (champion && typeof champion.portraitGraphic === 'number' && selected === chIdx) {
        const portraitGraphic = this.getPortraitBitmap(champion.portraitGraphic);
        if (portraitGraphic) {
          const portraitRect = { x1: baseX + 7, y1: 0, x2: baseX + 38, y2: 28 };
          fillRectIndex(this.ui.screenIndexBuffer, portraitRect, 1);
          tag0088b2Index(
            portraitGraphic,
            this.ui.screenIndexBuffer,
            {
              x1: portraitRect.x1,
              y1: portraitRect.y1,
              x2: portraitRect.x2,
              y2: portraitRect.y2,
              srcX: 0,
              srcY: 0,
              srcStride: portraitGraphic.width,
              srcWidth: portraitGraphic.width,
              srcHeight: portraitGraphic.height,
            },
            1
          );
        }
      }

      if (champion && champion.alive !== false) {
        this.drawShieldDots(baseX, champion);
      }

      const charPos = champion?.partyPosition ?? chIdx;
      const dir = (charPos + 4 - facing) & 3;
      const posRect = ui.wRectPos1454[dir];
      const color = ui.byte1386[chIdx] ?? 13;
      fillRectIndex(this.ui.screenIndexBuffer, posRect, color);

      const indicator = this.getGraphicBitmap(28);
      if (indicator) {
        const champFacing = champion?.facing ?? facing;
        const srcX = ((champFacing + 4 - facing) & 3) * 19;
        tag0088b2Index(
          indicator,
          this.ui.screenIndexBuffer,
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

  private drawHeldObjectName(): void {
    if (!this.ui.uiTables || !this.ui.fontData || !this.ui.screenIndexBuffer) return;

    const objectNames = this.ui.objectTables?.objectNames;
    if (!objectNames || objectNames.length === 0) return;

    const objectId = normalizeObjectValue(this.ui.partyState?.objectInHand);
    let label = '';
    if (objectId !== null) {
      const nameIndex = getBaseObjectNameIndex(this.ui, objectId);
      label = objectNames[nameIndex] ?? '';
    }

    const padded = (label || '').padEnd(14, ' ').slice(0, 14);
    drawTextLineIndex(this.ui.screenIndexBuffer, this.ui.fontData, 0xe9, 0x25, 4, 0, padded);
  }

  private drawShieldDots(baseX: number, champion: Champion): void {
    if (!this.ui.screenIndexBuffer || !this.ui.partyState) return;
    const shields: number[] = [];
    const fireShield = this.ui.partyState.fireShield ?? 0;
    const spellShield = this.ui.partyState.spellShield ?? 0;
    const partyShield = this.ui.partyState.partyShield ?? 0;
    const personalShield = champion.shieldStrength ?? 0;

    if (fireShield > 0) shields.push(38);
    if (spellShield > 0) shields.push(39);
    if (partyShield > 0 || personalShield > 0) shields.push(37);
    if (shields.length === 0) return;

    const rect = { x1: baseX, y1: 0, x2: baseX + 66, y2: 28 };
    for (let i = shields.length - 1; i >= 0; i--) {
      const graphic = this.getGraphicBitmap(shields[i] ?? -1);
      if (!graphic) continue;
      tag0088b2Index(
        graphic,
        this.ui.screenIndexBuffer,
        {
          x1: rect.x1,
          y1: rect.y1,
          x2: rect.x2,
          y2: rect.y2,
          srcX: 0,
          srcY: 0,
          srcStride: graphic.width,
          srcWidth: graphic.width,
          srcHeight: graphic.height,
        },
        10
      );
    }
  }

  private getPortraitBitmap(portraitIndex: number): IndexedBitmap | null {
    if (portraitIndex < 0) return null;
    const cached = this.ui.portraitCache.get(portraitIndex);
    if (cached) return cached;

    const sheet = this.getPortraitSheet();
    if (!sheet) return null;

    const w = 32;
    const h = 29;
    const cols = Math.floor(sheet.width / w);
    const rows = Math.floor(sheet.height / h);
    if (cols <= 0 || rows <= 0) return null;

    const count = cols * rows;
    if (portraitIndex >= count) return null;

    const sx = (portraitIndex % cols) * w;
    const sy = Math.floor(portraitIndex / cols) * h;
    const outPixels = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const srcRow = (sy + y) * sheet.width + sx;
      const dstRow = y * w;
      outPixels.set(sheet.pixels.subarray(srcRow, srcRow + w), dstRow);
    }

    const bmp: IndexedBitmap = { width: w, height: h, pixels: outPixels };
    this.ui.portraitCache.set(portraitIndex, bmp);
    return bmp;
  }

  private getPortraitSheet(): IndexedBitmap | null {
    if (this.ui.portraitSheet !== undefined) return this.ui.portraitSheet;
    const img1 = this.getGraphicBitmap(26, ImageFormat.IMG1);
    if (img1 && img1.width >= 32 && img1.height >= 29) {
      this.ui.portraitSheet = img1;
      return img1;
    }
    const img2 = this.getGraphicBitmap(26, ImageFormat.IMG2);
    if (img2 && img2.width >= 32 && img2.height >= 29) {
      this.ui.portraitSheet = img2;
      return img2;
    }
    this.ui.portraitSheet = null;
    return null;
  }

  private drawTopBarHandIcons(): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer || !this.ui.partyState) return;
    const iconSlots = this.ui.uiTables.graphic232.iconDisplay;
    const word612 = this.ui.uiTables.graphic232.word612;
    const selected = this.ui.partyState.selectedCharacterIndex | 0;

    for (let chIdx = 0; chIdx < 4; chIdx++) {
      const champion =
        this.ui.partyState.champions.find((c) => c.partyPosition === chIdx) ??
        this.ui.partyState.champions[chIdx] ??
        null;
      const alive = champion ? champion.alive !== false : false;
      if (!alive) continue;
      if (selected === chIdx) continue;

      for (let hand = 0; hand <= 1; hand++) {
        const slot = 2 * chIdx + hand;
        const icon = iconSlots[slot];
        if (!icon) continue;

        const rect = { x1: icon.pixelX, y1: icon.pixelY, x2: icon.pixelX + 15, y2: icon.pixelY + 15 };
        const frame = this.getGraphicBitmap(33);
        if (frame) {
          tag0088b2Index(
            frame,
            this.ui.screenIndexBuffer,
            {
              x1: rect.x1 - 1,
              y1: rect.y1 - 1,
              x2: rect.x2 + 1,
              y2: rect.y2 + 1,
              srcX: 0,
              srcY: 0,
              srcStride: frame.width,
              srcHeight: frame.height,
            },
            12
          );
        }
        const objectId =
          hand === 1
            ? typeof champion?.weaponHand === 'number'
              ? (champion.weaponHand | 0)
              : -1
            : typeof champion?.shieldHand === 'number'
              ? (champion.shieldHand | 0)
              : -1;
        const objectNameIndex = objectId >= 0 ? resolveObjectNameIndex(this.ui, objectId) : -1;

        if (objectNameIndex >= 0) {
          drawObjectIcon(this.ui, rect, objectNameIndex, word612);
        } else if (champion) {
          const placeholder = getInventoryPlaceholderIndex(champion, hand);
          drawObjectIcon(this.ui, rect, placeholder, word612);
        }
      }
    }
  }

  private drawInventoryScreen(): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer || !this.ui.partyState) return;
    const selected = this.ui.partyState.selectedCharacterIndex | 0;
    if (selected < 0) return;

    const champion =
      this.ui.partyState.champions.find((c) => c.partyPosition === selected) ??
      this.ui.partyState.champions[selected] ??
      null;
    if (!champion || champion.alive === false) return;

    const iconSlots = this.ui.uiTables.graphic232.iconDisplay;
    const word612 = this.ui.uiTables.graphic232.word612;
    const chestView = this.getActiveChestView(champion);
    this.syncOpenChest(chestView);

    if (this.ui.fontData) {
      const nameColor = this.ui.partyState.cursorOwner === selected ? 9 : 13;
      const nameBaseX = VIEWPORT_X + 2;
      drawTextLineIndex(
        this.ui.screenIndexBuffer,
        this.ui.fontData,
        nameBaseX,
        VIEWPORT_Y + 7,
        nameColor,
        12,
        champion.name
      );
      const title = champion.title ?? '';
      if (title.length > 0) {
        let titleX = nameBaseX + champion.name.length * 6;
        const firstChar = title.charCodeAt(0);
        if (firstChar !== 44 && firstChar !== 59 && firstChar !== 45) {
          titleX += 6;
        }
        drawTextLineIndex(
          this.ui.screenIndexBuffer,
          this.ui.fontData,
          titleX,
          VIEWPORT_Y + 7,
          nameColor,
          12,
          title
        );
      }
    }

    for (let slot = 0; slot < 30; slot++) {
      let objectIndex = this.getInventoryItemIndex(champion, slot);
      if (chestView?.source === 'hand' && chestView.slot === slot) {
        objectIndex = this.getOpenChestIconIndex();
      }
      const rect = this.getInventorySlotRect(iconSlots, slot);
      if (!rect) continue;
      const wounds = champion.wounds ?? 0;
      if (slot <= 5 && (wounds & (1 << slot)) !== 0) {
        drawWoundedOutline(this.ui, rect);
      }
      if (objectIndex >= 0) {
        drawObjectIcon(this.ui, rect, objectIndex, word612);
        continue;
      }
      const placeholder = getInventoryPlaceholderIndex(champion, slot);
      if (placeholder >= 0) {
        drawObjectIcon(this.ui, rect, placeholder, word612);
      }
    }

    if (chestView) {
      this.drawChestPanel(chestView);
    } else if (this.ui.pressingEye) {
      const cursorObject = normalizeObjectValue(this.ui.partyState?.objectInHand);
      if (cursorObject !== null) {
        this.drawObjectInfoPanel(cursorObject);
      } else {
        this.drawAttributePanel(champion);
      }
    } else {
      this.drawFoodWaterPanel(champion);
    }
    this.drawMouthChewAnimation();
    this.drawEyeIcon();
    this.drawVitalsAndLoad(champion);
  }

  private getInventorySlotRect(iconSlots: { pixelX: number; pixelY: number }[], slot: number): Rect | null {
    const icon = iconSlots[8 + slot];
    if (!icon) return null;
    return {
      x1: icon.pixelX + VIEWPORT_X,
      y1: icon.pixelY + VIEWPORT_Y,
      x2: icon.pixelX + VIEWPORT_X + 15,
      y2: icon.pixelY + VIEWPORT_Y + 15,
    };
  }

  private getChestSlotRect(iconSlots: { pixelX: number; pixelY: number }[], slot: number): Rect | null {
    const icon = iconSlots[38 + slot];
    if (!icon) return null;
    return {
      x1: icon.pixelX + VIEWPORT_X,
      y1: icon.pixelY + VIEWPORT_Y,
      x2: icon.pixelX + VIEWPORT_X + 15,
      y2: icon.pixelY + VIEWPORT_Y + 15,
    };
  }

  private getInventoryItemIndex(champion: Champion, slot: number): number {
    const possessions = champion.possessions;
    if (possessions && slot >= 0 && slot < possessions.length) {
      const value = possessions[slot];
      if (typeof value === 'number') return resolveObjectNameIndex(this.ui, value | 0);
    }
    if (slot === 0 && typeof champion.shieldHand === 'number') {
      return resolveObjectNameIndex(this.ui, champion.shieldHand | 0);
    }
    if (slot === 1 && typeof champion.weaponHand === 'number') {
      return resolveObjectNameIndex(this.ui, champion.weaponHand | 0);
    }
    return -1;
  }

  private getOpenChestIconIndex(): number {
    if (this.ui.openChestIconIndex !== null) return this.ui.openChestIconIndex;
    const names = this.ui.objectTables?.objectNames ?? [];
    for (let i = 0; i < names.length; i++) {
      const name = (names[i] ?? '').trim().toUpperCase();
      if (name === 'OPEN CHEST') {
        this.ui.openChestIconIndex = i;
        return i;
      }
    }
    this.ui.openChestIconIndex = OBJNI_OPEN_CHEST;
    return this.ui.openChestIconIndex;
  }

  private getActiveChestView(champion: Champion): ChestViewSource | null {
    if (!this.ui.partyState) return null;

    const cursorObject = normalizeObjectValue(this.ui.partyState.objectInHand);
    if (this.ui.pressingEye && isChestRecord(this.ui, cursorObject)) {
      return { id: cursorObject as ObjectID, source: 'cursor' };
    }

    if (this.ui.pressingEye) return null;
    const handSlot = 1; // CSBWin uses weapon hand for chest display.
    const handObject = normalizeObjectValue(this.getChampionPossession(champion, handSlot));
    if (isChestRecord(this.ui, handObject)) {
      return { id: handObject as ObjectID, source: 'hand', slot: handSlot };
    }
    return null;
  }

  private syncOpenChest(chestView: ChestViewSource | null): void {
    if (!chestView) {
      if (this.ui.openChestId !== null) {
        this.repackOpenChest();
      }
      return;
    }

    if (this.ui.openChestId !== null && this.ui.openChestId === chestView.id) return;
    if (this.ui.openChestId !== null) this.repackOpenChest();
    this.openChest(chestView.id);
  }

  private openChest(chestId: ObjectID): void {
    const chest = this.ui.dungeonState.getContainerRecord(chestId);
    if (!chest) {
      this.ui.openChestId = null;
      this.ui.openChestContents = Array(8).fill(null);
      return;
    }

    this.ui.openChestId = chestId;
    const contents: Array<ObjectID | null> = Array(8).fill(null);
    let cursor = chest.containedObject;
    let index = 0;
    while (cursor !== OBJECT_ID_EOF && cursor !== OBJECT_ID_NULL && index < contents.length) {
      contents[index++] = cursor;
      cursor = this.ui.dungeonState.getDBRecordLink(cursor);
    }
    this.ui.openChestContents = contents;

    for (const item of contents) {
      if (item !== null) {
        this.ui.dungeonState.setDBRecordLink(item, OBJECT_ID_EOF);
      }
    }
    chest.containedObject = OBJECT_ID_EOF;
  }

  private repackOpenChest(): void {
    if (this.ui.openChestId === null) return;
    const chest = this.ui.dungeonState.getContainerRecord(this.ui.openChestId);
    if (!chest) {
      this.ui.openChestId = null;
      this.ui.openChestContents = Array(8).fill(null);
      return;
    }

    chest.containedObject = OBJECT_ID_EOF;
    let previous: ObjectID | null = null;
    for (const item of this.ui.openChestContents) {
      if (item === null) continue;
      this.ui.dungeonState.setDBRecordLink(item, OBJECT_ID_EOF);
      if (previous === null) {
        chest.containedObject = item;
      } else {
        this.ui.dungeonState.setDBRecordLink(previous, item);
      }
      previous = item;
    }

    this.ui.openChestId = null;
    this.ui.openChestContents = Array(8).fill(null);
  }

  private drawChestPanel(chestView: ChestViewSource): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer) return;
    const ui = this.ui.uiTables.graphic232;
    blitBasicGraphicToViewport(this.ui, 25, ui.wRectPos926, 144, 8);
    this.drawInspectArrow(chestView.source === 'cursor');

    const word612 = ui.word612;
    const iconSlots = ui.iconDisplay;
    for (let slot = 0; slot < 8; slot++) {
      const rect = this.getChestSlotRect(iconSlots, slot);
      if (!rect) continue;
      const item = normalizeObjectValue(this.ui.openChestContents[slot] ?? null);
      if (item === null) continue;
      const objectIndex = resolveObjectNameIndex(this.ui, item | 0);
      if (objectIndex >= 0) drawObjectIcon(this.ui, rect, objectIndex, word612);
    }
  }

  private drawInspectArrow(fromEye: boolean): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer) return;
    const ui = this.ui.uiTables.graphic232;
    const graphicIndex = fromEye ? 19 : 18;
    blitBasicGraphicToViewport(this.ui, graphicIndex, ui.wRectPos934, 16, 8);
  }

  private computeChampionLoad(champion: Champion): { load: number; maxLoad: number; color: number } | null {
    if (!this.ui.objectTables) return null;
    const load = this.computeLoadWeight(champion);
    const maxLoad = this.computeMaxLoad(champion);
    const color = this.getLoadColor(load, maxLoad);
    return { load, maxLoad, color };
  }

  private computeLoadWeight(champion: Champion): number {
    if (!this.ui.objectTables) return 0;
    const visited = new Set<number>();
    const items: Array<number | null | undefined> = champion.possessions?.length
      ? champion.possessions
      : [champion.shieldHand, champion.weaponHand, champion.quiver];
    let total = 0;
    for (const item of items) {
      if (typeof item !== 'number') continue;
      total += getObjectWeight(this.ui, item, visited);
    }
    return total;
  }

  private computeMaxLoad(champion: Champion): number {
    const strength = champion.attributes?.strength ?? 0;
    let maxLoad = 8 * strength + 100;
    maxLoad = this.staminaAdjustedAttribute(champion, maxLoad);

    const wounds = champion.wounds ?? 0;
    if (wounds !== 0) {
      const shift = (wounds & 0x10) !== 0 ? 2 : 3;
      maxLoad -= maxLoad >> shift;
    }

    const feetItem = this.getInventoryItemIndex(champion, 5);
    if (feetItem === OBJNI_ELVEN_BOOTS) {
      maxLoad += maxLoad >> 4;
    }

    maxLoad += 9;
    maxLoad -= maxLoad % 10;
    return maxLoad;
  }

  private staminaAdjustedAttribute(champion: Champion, base: number): number {
    const stamina = champion.attributes?.stamina ?? 0;
    const maxStamina = champion.attributes?.maxStamina ?? 0;
    const half = Math.floor(maxStamina / 2);
    if (half <= 0 || stamina >= half) return base;

    const halfBase = Math.floor(base / 2);
    return halfBase + Math.floor((halfBase * stamina) / half);
  }

  private getLoadColor(load: number, maxLoad: number): number {
    if (maxLoad <= 0) return 13;
    if (load > maxLoad) return 8;
    if (load * 8 > maxLoad * 5) return 11;
    return 13;
  }

  private formatLoad(value: number): string {
    const whole = Math.floor(value / 10);
    const frac = Math.abs(value % 10);
    return `${String(whole).padStart(3, ' ')}.${frac}`;
  }

  private formatMaxLoad(value: number): string {
    return String(Math.floor((value + 5) / 10)).padStart(3, ' ');
  }

  private drawAttackButtons(): void {
    if (!this.ui.screenIndexBuffer || !this.ui.partyState || !this.ui.uiTables) return;

    const buttonHeightTop = 86;
    const buttonHeightBottom = 120;
    const word612 = this.ui.uiTables.graphic232.word612;

    for (let chIdx = 0; chIdx < 4; chIdx++) {
      const champion =
        this.ui.partyState.champions.find((c) => c.partyPosition === chIdx) ??
        this.ui.partyState.champions[chIdx] ??
        null;

      const x1 = 22 * chIdx + 233;
      const x2 = x1 + 19;
      const alive = champion ? champion.alive !== false : false;
      const fillColor = alive ? 4 : 0;

      fillRectIndex(this.ui.screenIndexBuffer, { x1, y1: buttonHeightTop, x2, y2: buttonHeightBottom }, fillColor);

      if (alive) {
        const iconRect = { x1: x1 + 2, y1: 95, x2: x2 - 2, y2: 110 };
        const weaponId = typeof champion?.weaponHand === 'number'
          ? (champion.weaponHand | 0)
          : -1;
        let iconIndex = -1;
        if (weaponId < 0) {
          iconIndex = OBJNI_SPECIAL_C;
        } else if (getAttackClass(this.ui, weaponId) !== 0) {
          iconIndex = getBaseObjectNameIndex(this.ui, weaponId);
        }
        if (iconIndex >= 0) {
          drawObjectIconMask(this.ui, iconRect, iconIndex, word612, this.ui.uiTables.graphic230.shrinkColorMap);
        }
      }
    }
  }

  private drawAttackPanel(): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer || !this.ui.fontData || !this.ui.partyState) return;
    if (!this.ui.showAttackPanel) return;

    fillRectIndex(this.ui.screenIndexBuffer, this.ui.uiTables.graphic232.word20, 0);

    const active = this.ui.partyState.champions.find((c) => c.alive !== false);
    if (!active) return;

    const panelGraphic = this.getGraphicBitmap(10);
    if (panelGraphic) {
      const rect = this.ui.uiTables.graphic230.wRectPos20202;
      tag0088b2Index(
        panelGraphic,
        this.ui.screenIndexBuffer,
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

    drawTextLineIndex(this.ui.screenIndexBuffer, this.ui.fontData, 235, 83, 0, 4, active.name);
    drawTextLineIndex(this.ui.screenIndexBuffer, this.ui.fontData, 241, 93, 4, 0, 'ATTACK 1');
    drawTextLineIndex(this.ui.screenIndexBuffer, this.ui.fontData, 241, 105, 4, 0, 'ATTACK 2');
    drawTextLineIndex(this.ui.screenIndexBuffer, this.ui.fontData, 241, 117, 4, 0, 'ATTACK 3');
  }

  private spellControlGetRect(base: Rect, chIdx: number, casterIdx: number): Rect {
      const isCaster = chIdx === casterIdx;
      const isAfterCaster = chIdx > casterIdx;
      const x = base.x1 + chIdx * 14 + (isAfterCaster ? 33 : 0);
      return {
        x1: x,
        x2: x + (isCaster ? 44 : 11),
        y1: base.y1,
        y2: base.y2 - (isCaster ? 0 : 1)
      };
  }

  private drawSpellControls(): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer || !this.ui.fontData || !this.ui.partyState) return;

    const rect = this.ui.uiTables.graphic230.word20242;
    fillRectIndex(this.ui.screenIndexBuffer, rect, 0);

    for (const champion of this.ui.partyState.champions) {
      if (!champion || !champion.alive || champion.attributes.maxMana === 0) continue;
      const rct = this.spellControlGetRect(rect, champion.partyPosition, this.ui.partyState.magicCasterIndex);
      const isCaster = champion.partyPosition === this.ui.partyState.magicCasterIndex;
      fillRectIndex(this.ui.screenIndexBuffer, rct, 4);
      if (isCaster) drawTextLineIndex(this.ui.screenIndexBuffer, this.ui.fontData, rct.x1 + 2, rect.y2-1, 0, 4, champion.name);
    };
  }

  private drawSpellPanel(): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer || !this.ui.fontData || !this.ui.partyState) return;

    const rect = this.ui.uiTables.graphic232.word12;

    fillRectIndex(this.ui.screenIndexBuffer, rect, 0);
    if (this.ui.partyState.magicCasterIndex < 0) return;

    let panelGraphic = this.getGraphicBitmap(9);
    if (panelGraphic) {
      tag0088b2Index(
        panelGraphic,
        this.ui.screenIndexBuffer,
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
        this.ui.screenIndexBuffer,
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
      this.ui.partyState.champions.find((c) => c.partyPosition === this.ui.partyState!.magicCasterIndex) ??
      this.ui.partyState.champions[this.ui.partyState.magicCasterIndex];
    if (!caster || caster.alive === false) return;

    this.drawSpellMenuCharacters(caster.incantation.length);
    this.drawMagicIncantation(caster.incantation);
  }

  private drawSpellMenuCharacters(step: number): void {
    if (!this.ui.screenIndexBuffer || !this.ui.fontData) return;
    const y = 58;
    for (let i=0; i<6; i++) {
      const x = 224 + 14 * (i + 1);
      const ch = String.fromCharCode(96 + 6 * Math.min(step, 3) + i);
      drawTextLineIndexRaw(this.ui.screenIndexBuffer, this.ui.fontData, x, y, 4, 0, ch);
    }
  }

  private drawMagicIncantation(incantation: number[]): void {
    if (!this.ui.screenIndexBuffer || !this.ui.fontData) return;
    const y = 70;
    for (let i=0; i<4; i++) {
      const x = 231 + 9 * (i + 1);
      const ch = (i >= incantation.length) ? ' ' : String.fromCharCode(incantation[i]);
      drawTextLineIndexRaw(this.ui.screenIndexBuffer, this.ui.fontData, x, y, 4, 0, ch);
    }
  }

  private drawLifeBars(chIdx: number, champion: Champion): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer || !champion.alive) return;
    const offsets = this.ui.uiTables.graphic232.word1526[chIdx];
    const masks = this.ui.uiTables.graphic232.word1502[chIdx];
    if (!offsets || !masks) return;

    const heights = [
      computeBarHeight(champion.attributes?.health ?? 0, champion.attributes?.maxHealth ?? 0, false),
      computeBarHeight(champion.attributes?.stamina ?? 0, champion.attributes?.maxStamina ?? 0, false),
      computeBarHeight(champion.attributes?.mana ?? 0, champion.attributes?.maxMana ?? 0, true),
    ];

    for (let bar = 0; bar < 3; bar++) {
      const offsetBytes = offsets[bar] ?? 0;
      const startX = Math.floor(offsetBytes / 8) * 16;
      const mask1 = masks[bar * 2] ?? 0;
      const mask2 = masks[bar * 2 + 1] ?? 0;
      const height = heights[bar] ?? 0;

      for (let row = 0; row <= 24; row++) {
        const filled = height > (24 - row);
        const color = filled ? CHAR_COLORS[chIdx] : 12;
        const y = 2 + row;
        drawMaskedBarRow(this.ui, startX, y, mask1, color);
        drawMaskedBarRow(this.ui, startX + 16, y, mask2, color);
      }
    }
  }

  private searchButtonList(list: UIButton[] | null, x: number, y: number, buttons: number): number {
    if (!list || list.length === 0) return 0;
    for (const entry of list) {
      if (entry.word0 === 0) break;
      if (x >= entry.x1 && x < entry.x2 && y >= entry.y1 && y < entry.y2) {
        if ((buttons & entry.button) !== 0) return entry.word0;
      }
    }
    return 0;
  }

  private handleMouseButton(id: number, x: number, y: number): void {
    // updateDebug(`handling click on ${id}`)
    if (id === 80 && this.isEyeClick(x, y)) {
      this.handleEyePress();
      return;
    }
    if (id === 70) {
      this.handleMouthPress();
      return;
    }
    if (id === 100) {
      this.handleMagicClick(x, y);
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
    const rect = this.getEyeRect();
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

  private handleMouthPress(): void {
    if (!this.ui.partyState || !this.ui.objectTables) return;
    if ((this.ui.partyState.cursorOwner ?? -1) < 0) return;
    const selected = this.ui.partyState.selectedCharacterIndex ?? -1;
    if (selected < 0) return;
    const champ =
      this.ui.partyState.champions.find((c) => c.partyPosition === selected) ??
      this.ui.partyState.champions[selected] ??
      null;
    if (!champ || champ.alive === false) return;

    const objectId = normalizeObjectValue(this.ui.partyState.objectInHand);
    if (objectId === null) return;

    const outcome = this.computeFeedingOutcome(objectId);
    if (!outcome) return;

    if (outcome.removeFromHand) {
      this.ui.partyState.objectInHand = null;
      if (outcome.deleteRecord && isLikelyObjectRecord(this.ui, objectId)) {
        this.ui.dungeonState.deleteDBEntry(objectId as ObjectID);
      }
    }

    champ.food = this.clampFoodWater((champ.food ?? 0) + outcome.foodDelta);
    champ.water = this.clampFoodWater((champ.water ?? 0) + outcome.waterDelta);

    if (outcome.chew) this.startMouthChewAnimation();
    if (outcome.playGulp && this.ui.playSound) this.ui.playSound(SoundIndex.SWALLOW);
  }

  private computeFeedingOutcome(objectId: number): FeedingOutcome | null {
    if (!this.ui.objectTables) return null;
    const isRecord = isLikelyObjectRecord(this.ui, objectId);
    const nameIndex = isRecord ? resolveObjectNameIndex(this.ui, objectId) : getBaseObjectNameIndex(this.ui, objectId);
    if (nameIndex < 0) return null;

    const descIndex = isRecord
      ? descIndexForObject(this.ui, objectId as ObjectID)
      : getDescIndexForObjectType(this.ui, objectId | 0);
    const carryMask = descIndex !== null ? this.ui.objectTables.objDescCarryMask[descIndex] ?? 0 : 0;
    const mouthAllowed = (carryMask & 1) !== 0;

    const isFood = this.isFoodNameIndex(nameIndex);
    const isWater = this.isWaterNameIndex(nameIndex);
    const isWaterFlask = isRecord && this.isWaterFlaskRecord(objectId as ObjectID);

    if (!mouthAllowed && !isFood && !isWater && !isWaterFlask) return null;

    const outcome: FeedingOutcome = {
      foodDelta: 0,
      waterDelta: 0,
      removeFromHand: false,
      deleteRecord: false,
      chew: false,
      playGulp: false,
    };

    if (isWaterFlask) {
      const rec = this.ui.dungeonState.getPotionRecord(objectId as ObjectID);
      if (!rec) return null;
      outcome.waterDelta = 1600;
      outcome.playGulp = true;
      rec.potionType = POTION_EMPTY_FLASK;
      return outcome;
    }

    if (isWater) {
      if (isRecord && decodeObjectID(objectId as ObjectID).category === DBType.MISC) {
        const rec = this.ui.dungeonState.getMiscRecord(objectId as ObjectID);
        const value = rec?.specialState ?? 0;
        if (value > 0) {
          outcome.waterDelta = 800;
          outcome.playGulp = true;
          if (rec) rec.specialState = Math.max(0, value - 1);
        }
      } else {
        outcome.waterDelta = 800;
        outcome.playGulp = true;
        outcome.removeFromHand = true;
        outcome.deleteRecord = isRecord;
      }
      return outcome;
    }

    if (isFood) {
      outcome.foodDelta = this.getFoodValue(nameIndex);
      outcome.removeFromHand = true;
      outcome.deleteRecord = isRecord;
      outcome.chew = true;
      outcome.playGulp = true;
      return outcome;
    }

    return null;
  }

  private isWaterFlaskRecord(objectId: ObjectID): boolean {
    const rec = this.ui.dungeonState.getPotionRecord(objectId);
    return rec?.potionType === POTION_WATER_FLASK;
  }

  private isFoodNameIndex(nameIndex: number): boolean {
    return nameIndex >= OBJNI_APPLE && nameIndex <= OBJNI_DRAGON_STEAK;
  }

  private isWaterNameIndex(nameIndex: number): boolean {
    return nameIndex >= OBJNI_WATERSKIN && nameIndex <= OBJNI_WATER;
  }

  private getFoodValue(nameIndex: number): number {
    const values = this.ui.objectTables?.foodValue;
    if (!values) return 0;
    const offset = nameIndex - OBJNI_APPLE;
    if (offset < 0 || offset >= values.length) return 0;
    return values[offset] ?? 0;
  }

  private clampFoodWater(value: number): number {
    return Math.max(-1023, Math.min(2048, Math.floor(value)));
  }

  private startMouthChewAnimation(): void {
    const now = nowMs();
    const frameMs = (1000 * 8) / 60;
    this.ui.mouthChewStartMs = now;
    this.ui.mouthChewEndMs = now + frameMs * 4;
    this.ensureMouthChewLoop();
  }

  private drawMouthChewAnimation(): void {
    if (!this.ui.uiTables || !this.ui.screenIndexBuffer || !this.ui.objectTables) return;
    if (this.ui.mouthChewStartMs === null) return;
    const now = nowMs();
    if (now >= this.ui.mouthChewEndMs) return;

    const frameMs = (1000 * 8) / 60;
    const frame = Math.floor((now - this.ui.mouthChewStartMs) / frameMs);
    const icon = (frame % 2 === 0) ? OBJNI_SPECIAL_H : OBJNI_SPECIAL_G;
    const mouthRect = this.ui.uiTables.graphic232.word1398;
    const x = VIEWPORT_X + mouthRect.x1 + 1;
    const y = VIEWPORT_Y + mouthRect.y1 + 1;
    drawObjectIconAt(this.ui, x, y, icon, this.ui.uiTables.graphic232.word612, -1);
  }

  private ensureMouthChewLoop(): void {
    if (this.ui.mouthChewFrameHandle !== null) return;
    const schedule = (cb: (time: number) => void): number => {
      if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
      return setTimeout(() => cb(nowMs()), 16) as unknown as number;
    };
    const tick = () => {
      if (this.ui.mouthChewStartMs === null) {
        this.ui.mouthChewFrameHandle = null;
        return;
      }
      const now = nowMs();
      if (now >= this.ui.mouthChewEndMs) {
        this.ui.mouthChewStartMs = null;
        this.ui.mouthChewFrameHandle = null;
        this.renderLastFrame();
        return;
      }
      this.renderLastFrame();
      this.ui.mouthChewFrameHandle = schedule(tick);
    };
    this.ui.mouthChewFrameHandle = schedule(tick);
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
    const sub = this.searchButtonList(this.ui.uiTables.graphic231.buttons.buttons18216, x, y, 2);
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

    const chestView = this.getActiveChestView(champ);
    if (!chestView || chestView.source !== 'hand') return;

    const button = this.searchButtonList(this.ui.uiTables.graphic231.buttons.buttons18324, clickX, clickY, 2);
    if (button !== 0) {
      this.handleClothingClick(button - 20);
    }
  }

  private handleInventoryToggle(button: number): void {
    if (!this.ui.partyState) return;
    if (button === 4) {
      this.syncOpenChest(null);
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
      this.syncOpenChest(null);
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

  private handleMagicClick(clickX: number, clickY: number): void {
    if (!this.ui.uiTables || !this.ui.partyState) return;

    const rect = this.ui.uiTables.graphic230.word20242;
    for (const champion of this.ui.partyState.champions) {
      if (!champion || !champion.alive || champion.attributes?.maxMana === 0) continue;
      const rct = this.spellControlGetRect(rect, champion.partyPosition, this.ui.partyState.magicCasterIndex);
      if (pointInRect(clickX, clickY, rct)) {
        this.ui.partyState.magicCasterIndex = champion.partyPosition;
        break;
      }
    }

    const magicButton = this.searchButtonList(this.ui.uiTables.graphic231.buttons.buttons18060, clickX, clickY, 2);
    if (magicButton !== 0) {
      this.applyMagicSelection(magicButton);
    }
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

    const chestView = this.getActiveChestView(champ);
    const isChestSlot = slot >= 30;
    if (isChestSlot) {
      if (!chestView) return;
      this.syncOpenChest(chestView);
    }

    const objectInHand = normalizeObjectValue(this.ui.partyState.objectInHand);
    const slotObject = isChestSlot
      ? normalizeObjectValue(this.ui.openChestContents[slot - 30] ?? null)
      : normalizeObjectValue(this.getChampionPossession(champ, slot));
    if (!objectInHand && !slotObject) return;

    if (objectInHand && !this.canPlaceInSlot(objectInHand, slot)) return;

    if (objectInHand) {
      this.ui.partyState.objectInHand = null;
    }
    if (slotObject) {
      if (isChestSlot) {
        this.ui.openChestContents[slot - 30] = null;
      } else {
        this.setChampionPossession(champ, slot, null);
      }
      this.ui.partyState.objectInHand = slotObject;
    }
    if (objectInHand) {
      if (isChestSlot) {
        this.ui.openChestContents[slot - 30] = objectInHand;
      } else {
        this.setChampionPossession(champ, slot, objectInHand);
      }
    }
  }

  private getChampionPossession(champion: Champion, slot: number): number | null {
    if (champion.possessions && slot >= 0 && slot < champion.possessions.length) {
      const value = champion.possessions[slot];
      if (typeof value === 'number') return value;
    }
    if (slot === 0 && typeof champion.shieldHand === 'number') return champion.shieldHand;
    if (slot === 1 && typeof champion.weaponHand === 'number') return champion.weaponHand;
    if (slot === 8 && typeof champion.quiver === 'number') return champion.quiver;
    return null;
  }

  private setChampionPossession(champion: Champion, slot: number, value: number | null): void {
    const previous = normalizeObjectValue(this.getChampionPossession(champion, slot));
    const next = normalizeObjectValue(value);
    if (!champion.possessions || champion.possessions.length < 30) {
      const slots = new Array(30).fill(null) as Array<number | null>;
      if (champion.possessions) {
        for (let i = 0; i < champion.possessions.length && i < slots.length; i++) {
          slots[i] = normalizeObjectValue(champion.possessions[i]);
        }
      }
      champion.possessions = slots;
    }
    champion.possessions[slot] = next;
    if (slot === 0) champion.shieldHand = next;
    if (slot === 1) champion.weaponHand = next;
    if (slot === 8) champion.quiver = next;
    this.updateLightForPossessionChange(slot, previous, next);
  }

  private updateLightForPossessionChange(slot: number, previous: number | null, next: number | null): void {
    if (!this.ui.partyState || !this.ui.uiTables) return;
    if (slot !== 0 && slot !== 1 && slot !== 10) return;

    if (slot === 10) {
      const word1074 = this.ui.uiTables.graphic232.word1074;
      const stepValue = word1074[2] ?? 0;
      if (stepValue !== 0) {
        const prevIsIllumulet = previous !== null
          && isBaseObjectNameIndex(this.ui, previous, OBJNI_ILLUMULET_A, OBJNI_ILLUMULET_B);
        const nextIsIllumulet = next !== null
          && isBaseObjectNameIndex(this.ui, next, OBJNI_ILLUMULET_A, OBJNI_ILLUMULET_B);
        const delta = (nextIsIllumulet ? stepValue : 0) - (prevIsIllumulet ? stepValue : 0);
        if (delta !== 0) {
          const current = this.ui.partyState.brightness ?? 0;
          this.ui.partyState.brightness = normalizeWord6(current + delta);
        }
      }
    }

    if (slot === 0 || slot === 1) {
      this.setTorchLitState(previous, false);
      this.setTorchLitState(next, true);
    }
  }

  private setTorchLitState(objectId: number | null, lit: boolean): void {
    if (objectId === null) return;
    if (!isLikelyObjectRecord(this.ui, objectId)) return;
    if (!isBaseObjectNameIndex(this.ui, objectId, OBJNI_TORCH_A, OBJNI_TORCH_A)) return;
    const weapon = this.ui.dungeonState.getWeaponRecord(objectId as ObjectID);
    if (!weapon) return;
    weapon.litTorch = lit;
  }

  private canPlaceInSlot(objectId: number, slot: number): boolean {
    if (!this.ui.objectTables || !this.ui.uiTables) return true;
    const descIndex = isLikelyObjectRecord(this.ui, objectId)
      ? descIndexForObject(this.ui, objectId as ObjectID)
      : getDescIndexForObjectType(this.ui, objectId | 0);
    if (descIndex === null) return true;
    const carryMask = this.ui.objectTables.objDescCarryMask[descIndex] ?? 0;
    const slotMask = this.ui.uiTables.graphic232.carryLocation[slot] ?? 0;
    return (carryMask & slotMask) !== 0;
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

  private applyMagicSelection(buttonId: number): void {
    if (!this.ui.partyState || !this.ui.uiTables) return;
    if (buttonId < 101 || buttonId > 108) return;

    const casterIdx = this.ui.partyState.magicCasterIndex;
    if (casterIdx < 0) return;

    const champion = this.ui.partyState.champions.find((c) => c.partyPosition === casterIdx);
    if (!champion || champion.alive === false) return;

    // buttons: magic runes (101-106), back (107), cast (108)

    // Back
    if (buttonId === 107) {
      if (champion.incantation.length === 0) return;
      champion.incantation.pop();
      return;
    }

    // Cast
    if (buttonId === 108) {
      if (champion.incantation.length === 0) return;
      const totalManaCost = this.computeIncantationManaCost(
        champion.incantation,
        this.ui.uiTables.graphic230.spellBaseMana,
        this.ui.uiTables.graphic230.spellFirstRuneScale,
      );
      const chIdx = this.ui.partyState.champions.indexOf(champion);
      let result: number | void = undefined;
      if (chIdx >= 0) {
        result = this.ui.onSpellCast?.(chIdx, [...champion.incantation], totalManaCost);
      }
      if (result !== 3) {
        champion.incantation = [];
      }
      return;
    }

    // baseMana: [ 1, 2, 3, 4, 5, 6, 2, 3, 4, 5, 6, 7, 4, 5, 6, 7, 7, 9, 2, 2, 3, 4, 6, 7 ]
    // scaleMana: [ 8, 12, 16, 20, 24, 28 ] ( = [ x1, x1.5, x2, x2.5, x3, x3.5 ])

    // Add rune
    const step = champion.incantation.length;
    if (step > 3) return;

    const runeId = buttonId - 101;
    const baseMana = this.ui.uiTables.graphic230.spellBaseMana; // number[24]
    const scaleMana = this.ui.uiTables.graphic230.spellFirstRuneScale; // number[6]

    // compute mana cost: rune base cost * [1, 1.5, 2, 2.5, 3, 3.5][firstRune]
    let manaCost = baseMana[step * 6 + runeId];
    if (step > 0) manaCost = (manaCost * scaleMana[(champion.incantation[0] - 96)]) / 8;
    if (champion.attributes.mana < manaCost) return;

    // apply cost en enqueue rune
    champion.attributes.mana -= manaCost;
    champion.incantation.push(96 + step * 6 + runeId);
  }

  private computeIncantationManaCost(incantation: number[], baseMana: number[], scaleMana: number[]): number {
    if (incantation.length === 0) return 0;
    const powerIndex = Math.max(0, Math.min(5, (incantation[0] ?? 96) - 96));
    let total = 0;
    for (let step = 0; step < incantation.length; step++) {
      const value = incantation[step] ?? 96;
      const runeId = value - 96 - step * 6;
      if (runeId < 0 || runeId > 5) continue;
      let cost = baseMana[step * 6 + runeId] ?? 0;
      if (step > 0) {
        cost = Math.floor((cost * (scaleMana[powerIndex] ?? 0)) / 8);
      }
      total += cost;
    }
    return total;
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
