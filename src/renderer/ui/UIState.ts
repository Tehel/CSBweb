/**
 * Shared state for the DM user interface.
 *
 * CSBWin keeps this in globals that `Mouse.cpp`, `CSBUI.cpp`, `Character.cpp` and
 * `Magic.cpp` all reach into. `ViewportRenderer` owns the single instance and the UI
 * modules take it as their first argument, which keeps each of them a thin, greppable
 * translation of its C++ counterpart instead of another method on a god object.
 */
import type { GraphicsLoader } from '../../data/GraphicsLoader';
import type { DungeonState } from '../../engine/DungeonState';
import type { PartyState } from '../../engine/gameTypes';
import type { ViewingFilterOptions, ViewingFilterResult } from '../../engine/DsaSystem';
import type { InterpreterContext } from '../bytecode/BytecodeInterpreter';
import type { IndexedBitmap, createPaletteIndexViewportBuffer } from '../csbwin/CanvasBlitter';
import type { UIButton, UITables } from '../csbwin/UITables';
import type { ObjectTables } from '../csbwin/ObjectTables';
import type { FontData } from '../csbwin/TextRenderer';
import type { ImageFormat } from '../../core/imageDecoder';
import type { ObjectID, Position } from '../../core/types';

export enum UIMode {
  Adventure = 'adventure',
  Sleeping = 'sleeping',
  Frozen = 'frozen',
}

export type ScreenIndexBuffer = ReturnType<typeof createPaletteIndexViewportBuffer>;

export type ObjectMoveHandler = (
  position: Position,
  object: ObjectID,
  place: boolean,
  unchangedRoom: boolean,
  facing: number,
) => void;

export interface UIState {
  /* ---- data sources ---- */
  readonly graphicsLoader: GraphicsLoader;
  readonly dungeonState: DungeonState;
  context: InterpreterContext | null;
  screenIndexBuffer: ScreenIndexBuffer | null;
  uiTables: UITables | null;
  objectTables: ObjectTables | null;
  fontData: FontData | null;
  partyState: PartyState | null;
  uiMode: UIMode;

  /* ---- interaction state ---- */
  pressingEye: boolean;
  hoverPoint: { x: number; y: number } | null;
  showAttackPanel: boolean;
  openChestId: ObjectID | null;
  openChestContents: Array<ObjectID | null>;
  openChestIconIndex: number | null;
  mouthChewStartMs: number | null;
  mouthChewEndMs: number;
  mouthChewFrameHandle: number | null;
  primaryButtons: UIButton[] | null;   // graphic231 -> buttons17196
  secondaryButtons: UIButton[] | null; // graphic231 -> buttons17304

  /* ---- CSBWin's mouse ring buffer (Mouse.cpp) ---- */
  mouseQueue: Array<{ num: number; x: number; y: number }>;
  mouseQStart: number;
  mouseQEnd: number;

  /* ---- bitmap caches ---- */
  graphicCache: Map<string, IndexedBitmap>;
  cursorArrowBitmap: IndexedBitmap | null;
  cursorHandBitmap: IndexedBitmap | null;
  portraitSheet: IndexedBitmap | null | undefined;
  portraitCache: Map<number, IndexedBitmap>;

  /* ---- hooks out to the engine / host ---- */
  playSound?: (soundId: number, rateIdx?: number, distance?: number) => void;
  onObjectMove?: ObjectMoveHandler;
  onSpellCast?: (chIdx: number, incantation: number[], totalManaCost: number) => number | void;
  viewingFilter?: (options: ViewingFilterOptions) => ViewingFilterResult | null;

  /* ---- back into the renderer ---- */
  getGraphicBitmap(graphicNum: number, format?: ImageFormat): IndexedBitmap | null;
  /** Re-blit the last rendered frame; used by animations that run off the game clock. */
  renderLastFrame(): void;
}

export function createUIState(
  graphicsLoader: GraphicsLoader,
  dungeonState: DungeonState,
  hooks: Pick<UIState, 'getGraphicBitmap' | 'renderLastFrame'>,
): UIState {
  return {
    graphicsLoader,
    dungeonState,
    context: null,
    screenIndexBuffer: null,
    uiTables: null,
    objectTables: null,
    fontData: null,
    partyState: null,
    uiMode: UIMode.Adventure,

    pressingEye: false,
    hoverPoint: null,
    showAttackPanel: false,
    openChestId: null,
    openChestContents: Array(8).fill(null),
    openChestIconIndex: null,
    mouthChewStartMs: null,
    mouthChewEndMs: 0,
    mouthChewFrameHandle: null,
    primaryButtons: null,
    secondaryButtons: null,

    mouseQueue: [],
    mouseQStart: 0,
    mouseQEnd: 0,

    graphicCache: new Map(),
    cursorArrowBitmap: null,
    cursorHandBitmap: null,
    portraitSheet: undefined,
    portraitCache: new Map(),

    getGraphicBitmap: hooks.getGraphicBitmap,
    renderLastFrame: hooks.renderLastFrame,
  };
}

/** CSBWin drives animation off the VBL counter; the browser gives us a wall clock. */
export function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
