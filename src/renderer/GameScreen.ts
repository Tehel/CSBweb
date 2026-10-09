/**
 * The 320x200 screen, and the DM interface on it.
 *
 * It owns the canvas and the interface's state (`ui/UIState.ts`), puts the viewport that
 * `ViewportRenderer` draws on the screen with every panel around it, converts the
 * palette indices to RGBA once per frame, and hosts the two modal screens (the save menu
 * and Reincarnate). The page reaches the interface only through it: the mouse and key
 * entry points below, whose work is in the `ui/` modules.
 *
 * What the interface asks of the engine comes in whole at construction, as
 * `GameScreenHooks`, the way `GameHost` gathers what the engine asks of the page.
 */

import type { GraphicsLoader } from '../data/GraphicsLoader';
import type { Champion, PartyState } from '../engine/gameTypes';
import type { CSBGraphicsLoader } from '../data/CSBGraphicsLoader';
import type { ScrollingText } from './csbwin/ScrollingText';
import type { GameContext } from '../engine/GameContext';
import type { IndexedBitmap } from './csbwin/CanvasBlitter';
import {
  clearIndex,
  vblFlashButn,
  createPaletteIndexViewportBuffer,
  updateImageDataFromIndex,
  updateImageDataFromIndexWithViewportPalette,
  reconvertThroughPalette,
} from './csbwin/CanvasBlitter';
import { PresentedFrame, type PresentedFrameCapture } from './csbwin/PresentedFrame';
import { CreateOverlayTable, OVERLAY_TABLE_SIZE, overlayDrawsNothing, UpdateViewportArea } from './csbwin/OverlayScreen';
import { die } from '../engine/Die';
import type { GraphicsTables } from '../data/tables/GraphicsTables';
import type { UIButton, UITables } from '../data/tables/UITables';
import { flashedButton } from '../engine/LoopState';
import { loadFontData, type FontData } from './csbwin/TextRenderer';
import { ImageFormat } from '../core/imageDecoder';
import {
  VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT,
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  VIEWPORT_X,
  VIEWPORT_Y,
  getCachedGraphicBitmap,
} from './ViewportGraphics';
import { Position } from '../core/types';
import { ViewportRenderer } from './ViewportRenderer';
import { createUIState, initializePlayState, UIMode, type ScreenIndexBuffer, type UIState } from './ui/UIState';
import { drawStaticUIFrame } from './ui/Draw';
import {
  drawCursorItem,
  marchingOrderPointerMoved,
  handleMouseButton,
  handleInventoryToggle,
  handleMouseUnclick,
  releaseEyeOrMouth,
  searchMouseButtons,
  syncInventoryButtons,
  tag02076e,
  tag0207cc,
  updateButtonLists,
} from './ui/Mouse';
import { drawSpellControls, drawSpellPanel } from './ui/MagicPanel';
import { attackPanelTick, closeAttackMenu, drawAttackPanel } from './ui/Attack';
import { handleUIKey, tableKeyButton } from './ui/Keyboard';
import {
  drawReincarnateScreen,
  isReincarnateScreenOpen,
  openReincarnateScreen,
  reincarnateClick,
  reincarnateKey,
} from './ui/ReIncarnate';
import {
  askBeginAdventure,
  closeSaveMenu,
  drawSaveMenu,
  isSaveMenuOpen,
  openSaveMenu,
  saveMenuClick,
  saveMenuDrop,
  saveMenuKey,
  saveMenuPointer,
  saveMenuWheel,
  type SaveMenuMode,
} from './ui/SaveMenu';
import { doMenu, drawMenuPress, menuButtonList, type MenuPress } from './ui/Menu';
import type { SaveEntry } from '../data/saves';
import type { ImportedFile } from '../engine/GameSaves';
import { drawCharacterStateEyePanel, drawInventoryBackground, drawInventoryScreen, repackOpenChest, syncOpenChest } from './ui/Inventory';
import { drawCharacterState, drawHeldObjectName, drawPartyStatus, getChampionPortrait } from './ui/Character';
import { closeHintOracle, drawHintOracleButton, openHintOracle, type HintOracleFiles } from './ui/HintOracleButton';
import { displayFrozenScreen, displaySleepScreen, drawMessageLines, shadeRectIndex } from './ui/Draw';

/**
 * What the interface asks of the page. Each is one of `UIState`'s hooks out, documented
 * there. The engine the interface reaches through `ui.ctx`.
 */
export type GameScreenHooks = Pick<UIState,
  | 'onReincarnated'
  | 'onListSaves'
  | 'onListEverySave'
  | 'onReadSave'
  | 'onMakeNewAdventure'
  | 'onSaveGame'
  | 'isPrison'
  | 'onExportSave'
  | 'onImportSave'
  | 'onRestoreSave'
  | 'onRestoreFailed'
  | 'onOpenHintOracle'
  | 'onSleepSave'
>;

/** What the screen reads: the graphics, and the game it shows. */
export interface GameScreenDeps {
  graphicsLoader: GraphicsLoader;
  /** The game's one set of `graphics.dat` tables, the one its `GameTables` was built from. */
  tables: GraphicsTables;
  /**
   * The game's `GameContext`, CSBWin's `d.`, which the interface holds as `ui.ctx`: the
   * dungeon, the party's trail (`d.PartyFootprints`, for the magic prints in the
   * viewport) and the systems.
   */
  ctx: GameContext;
  csbGraphicsLoader?: CSBGraphicsLoader;
  /**
   * The message area, CSBWin's global `scrollingText` (`doc/CSBwin-src/CSBCode.cpp:1362`):
   * the one the engine writes through its host's `messages`.
   */
  messages: ScrollingText;
  /** The Hint Oracle's files, where the data set has them (`src/renderer/ui/HintOracleButton.ts`). */
  hintOracle?: HintOracleFiles | null;
}

/** The viewport's rectangle of the screen, ends inclusive, as the conversion takes it. */
const VIEWPORT_SPAN = {
  x1: VIEWPORT_X,
  y1: VIEWPORT_Y,
  x2: VIEWPORT_X + VIEWPORT_WIDTH - 1,
  y2: VIEWPORT_Y + VIEWPORT_HEIGHT - 1,
} as const;

export class GameScreen {
  /** Everything the UI modules share. See `ui/UIState.ts`. */
  private readonly ui: UIState;
  private readonly viewport: ViewportRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly screenCtx: CanvasRenderingContext2D;
  private readonly screenImageData: ImageData; // RGBA staging for present
  /** What the canvas was last given, as palette indices (`presentedFrame`). */
  private readonly presented = new PresentedFrame(SCREEN_WIDTH, SCREEN_HEIGHT);
  /** `d.LogicalScreenBase`, the whole screen as palette indices. */
  private readonly screen: ScreenIndexBuffer;
  private readonly uiPalette: number[];
  /** `currentOverlay.m_table`, which `UpdateScreenArea` builds again for each frame. */
  private readonly overlayTable = new Uint16Array(OVERLAY_TABLE_SIZE);
  private readonly messages: ScrollingText;
  /** A dungeon view has been drawn, so there is an adventure frame to compose again. */
  private viewportDrawn = false;
  /** The pointer has moved since the cursor was last drawn (`takeCursorMoved`). */
  private cursorMoved = false;
  private bootFrameRenderer: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, deps: GameScreenDeps, hooks: GameScreenHooks) {
    const { graphicsLoader } = deps;
    this.messages = deps.messages;

    this.canvas = canvas;
    const screenCtx = canvas.getContext('2d');
    if (!screenCtx) throw new Error('Failed to create screen 2D context');
    this.screenCtx = screenCtx;
    this.screenImageData = screenCtx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);

    const palette552 = deps.tables.ui.graphic232.palette552;
    const graphicCache = new Map<string, IndexedBitmap>();
    this.viewport = new ViewportRenderer({
      graphicsLoader,
      dungeonState: deps.ctx.dungeon,
      footprints: deps.ctx.footprints,
      gameState: deps.ctx.state,
      rules: deps.ctx.rules,
      csbGraphicsLoader: deps.csbGraphicsLoader,
      viewportTables: deps.tables.viewport,
      objectTables: deps.tables.objects,
      palette552,
      graphicCache,
      getGraphicBitmap: (graphicNum) => this.getGraphicBitmap(graphicNum),
    });
    this.uiPalette = palette552[0].slice();
    this.screen = createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0);

    const ui = createUIState({
      graphicsLoader,
      ctx: deps.ctx,
      context: this.viewport.context,
      screenIndexBuffer: this.screen,
      uiTables: deps.tables.ui,
      objectTables: this.viewport.objectTables,
      fontData: loadFontData(graphicsLoader),
      graphicCache,
    }, {
      getGraphicBitmap: (graphicNum, format) => this.getGraphicBitmap(graphicNum, format),
      renderLastFrame: () => this.renderLastFrame(),
      onReincarnated: hooks.onReincarnated,
      onListSaves: hooks.onListSaves,
      onListEverySave: hooks.onListEverySave,
      onReadSave: hooks.onReadSave,
      onMakeNewAdventure: hooks.onMakeNewAdventure,
      onSaveGame: hooks.onSaveGame,
      isPrison: hooks.isPrison,
      onExportSave: hooks.onExportSave,
      onImportSave: hooks.onImportSave,
      onRestoreSave: hooks.onRestoreSave,
      onRestoreFailed: hooks.onRestoreFailed,
      onOpenHintOracle: hooks.onOpenHintOracle,
      onSleepSave: hooks.onSleepSave,
    });
    ui.hintOracle = deps.hintOracle ?? null;
    this.ui = ui;
    updateButtonLists(ui);
  }

  getUITables(): UITables {
    return this.ui.uiTables;
  }

  /* Mouse entry points for the host page; the work is in `ui/Mouse.ts`. */

  /** The button a click hits, 0 for none: `Game.handleMouseEvents`' translation of a queued click. */
  searchMouseButtons(x: number, y: number, buttons: number): number {
    return searchMouseButtons(this.ui, x, y, buttons);
  }

  /**
   * A click on the Reincarnate name-entry screen. That screen reads the mouse itself and
   * does its own geometry (`doc/CSBwin-src/Code13ea4.cpp:118-224`) — it never consults a
   * button list, and while it is up nothing else may act on a click.
   */
  handleReincarnateClick(x: number, y: number): void {
    reincarnateClick(this.ui, x, y);
  }

  /**
   * Offer a key to the Reincarnate name-entry screen. Returns whether it took it —
   * while that screen is up it takes everything, which is what makes it modal
   * (`keyboardMode = 2`, `doc/CSBwin-src/Code13ea4.cpp:40`).
   */
  handleReincarnateKey(key: string): boolean {
    return reincarnateKey(this.ui, key);
  }

  isReincarnateScreenOpen(): boolean {
    return isReincarnateScreenOpen(this.ui);
  }

  /** `ReIncarnate(pcA3)` (`doc/CSBwin-src/CSBCode.cpp:6797`) — open the screen. */
  openReincarnateScreen(chIdx: number): void {
    openReincarnateScreen(this.ui, chIdx);
  }

  /** `if (d.AttackingCharacterOrdinal == chIdx+1) TAG01b1c0();` — the host's `closeAttackMenuOf`. */
  closeAttackMenuOf(chIdx: number): void {
    if (this.ui.attackingCharacterOrdinal === chIdx + 1) closeAttackMenu(this.ui);
  }

  /** `d.AttackingCharacterOrdinal` — the host's `attackingCharacterOrdinal`. */
  attackingCharacterOrdinal(): number {
    return this.ui.attackingCharacterOrdinal;
  }

  /** `d.PressingEye` — the host's `pressingEye`. */
  pressingEye(): boolean {
    return this.ui.pressingEye;
  }

  /** `d.PressingMouth` — the host's `pressingMouth`. */
  pressingMouth(): boolean {
    return this.ui.pressingMouth;
  }

  /** `d.DisplayResurrectChestOrScroll` — the host's `displayResurrectChestOrScroll`. */
  displayResurrectChestOrScroll(): number {
    return this.ui.displayResurrectChestOrScroll;
  }

  /** `ShowHideInventory` (`doc/CSBwin-src/CSBCode.cpp:7478`) — the host's `showHideInventory`. */
  showHideInventory(chIdx: number): void {
    handleInventoryToggle(this.ui, chIdx);
  }

  /** `KillCharacter`'s release of the eye or the mouth — the host's `releaseEyeOrMouth`. */
  releaseEyeOrMouth(): void {
    releaseEyeOrMouth(this.ui);
  }

  /** `RepackChest` (`doc/CSBwin-src/Character.cpp:3113`) — the host's `repackChest`. */
  repackChest(): void {
    repackOpenChest(this.ui);
  }

  /** `TAG02076e` (`doc/CSBwin-src/Character.cpp:5133`) — the host's `tag02076e`. */
  tag02076e(): void {
    tag02076e(this.ui);
  }

  /** `TAG0207cc` (`doc/CSBwin-src/CSBCode.cpp:10058`) — the host's `tag0207cc`. */
  tag0207cc(): void {
    tag0207cc(this.ui);
  }

  /**
   * Offer a key to the interface's own bindings (`src/renderer/ui/Keyboard.ts`).
   * Returns whether it was claimed. The modal screens must be offered the key first.
   */
  handleUIKey(key: string): boolean {
    return handleUIKey(this.ui, key);
  }

  /**
   * A button `Game.handleMouseEvents` took off the mouse queue and does not handle itself.
   * `DiskMenuNeeded` is raised by the disk icon's handler and acted on by whoever called
   * `HandleMouseEvents` — the main loop in CSBWin (`doc/CSBwin-src/CSBCode.cpp:772`), this
   * method here. The deferral is the whole reason the flag exists. The Oracle's button
   * and the Sleepsave raise flags of their own, acted on here the same way.
   */
  handleMouseButton(num: number, x: number, y: number): void {
    handleMouseButton(this.ui, num, x, y);
    if (this.ui.diskMenuNeeded) {
      this.ui.diskMenuNeeded = false;
      openSaveMenu(this.ui);
    }
    if (this.ui.hintOracleNeeded) {
      this.ui.hintOracleNeeded = false;
      this.openHintOracle();
    }
    if (this.ui.sleepSaveNeeded) {
      this.ui.sleepSaveNeeded = false;
      this.ui.onSleepSave();
    }
  }

  /**
   * The Hint Oracle's button acted on (`src/renderer/ui/HintOracleButton.ts`): `TAG02076e`
   * and the clock stopped, the screen composed once more with them and without the
   * cursor, the screen the Oracle opens over, and then the page runs the Oracle. Until
   * `closeHintOracle`, the screen is the Oracle's, and nothing here draws.
   */
  private openHintOracle(): void {
    const square = openHintOracle(this.ui);
    this.setHoverPoint(null);
    this.presentViewport();
    this.ui.onOpenHintOracle(square);
  }

  /** The Oracle closed: `TAG0207cc`, and the inventory drawn again in the interface's palette. */
  closeHintOracle(): void {
    closeHintOracle(this.ui);
    this.presentViewport();
  }

  isHintOracleUp(): boolean {
    return this.ui.hintOracleUp;
  }

  /** The button-up, `0x0add` (`doc/CSBwin-src/Mouse.cpp:1662-1688`). */
  handleMouseUnclick(): void {
    handleMouseUnclick(this.ui);
  }

  /* The save/load screen; the work is in `ui/SaveMenu.ts`. */

  isSaveMenuOpen(): boolean {
    return isSaveMenuOpen(this.ui);
  }

  /** `loadOnly` is what a title screen wants: the same list with no SAVE button. */
  openSaveMenu(mode: SaveMenuMode = 'full'): void {
    openSaveMenu(this.ui, mode);
  }

  closeSaveMenu(): void {
    closeSaveMenu(this.ui);
  }

  /** The prison's "BEGIN THE ADVENTURE?" (`GameSavesScreen.askBeginAdventure`). */
  askBeginAdventure(source: SaveEntry | null): void {
    askBeginAdventure(this.ui, source);
  }

  /**
   * A click while the save screen is up, taken **straight from the DOM event** rather
   * than through the mouse queue. That is CSBWin's modality: `_WaitForMenuSelect`
   * replaces every button list while it runs.
   */
  handleSaveMenuClick(x: number, y: number, buttons: number): void {
    saveMenuClick(this.ui, x, y, buttons);
  }

  handleSaveMenuKey(key: string): boolean {
    return saveMenuKey(this.ui, key);
  }

  handleSaveMenuWheel(delta: number): boolean {
    return saveMenuWheel(this.ui, delta);
  }

  /** A file dropped on the page while the save screen is up: its import. Says whether it was taken. */
  handleSaveMenuDrop(file: ImportedFile): boolean {
    return saveMenuDrop(this.ui, file);
  }

  /** `CHARDESC.portrait`, as the status box draws it; the won screen draws it too. */
  championPortrait(champion: Champion): IndexedBitmap | null {
    return getChampionPortrait(this.ui, champion);
  }

  /**
   * `AddCharacter`'s portrait blit, deferred to save time.
   *
   * CSBWin copies a cell of basic graphic 26 into the character record the moment a
   * champion joins (`doc/CSBwin-src/Character.cpp:487-496`), so `CHARDESC` always holds
   * pixels. This engine holds no graphics, so a champion it created carries the cell
   * *index* instead and the pixels are resolved here — the save writer asks for them
   * when it packs block 4.
   */
  portraitPixelsFor(champion: Champion): number[] | undefined {
    const bitmap = getChampionPortrait(this.ui, champion);
    return bitmap ? Array.from(bitmap.pixels) : undefined;
  }

  setPartyState(state: PartyState): void {
    // Another party is another game, loaded or begun, which CSBWin draws afresh: nothing
    // `TAG02076e` shaded survives it (a quick-load over a sleeping party, which no
    // `TAG0207cc` follows).
    // Nor does a champion in hand (`d.Word23144 = 0`, `doc/CSBwin-src/CSBCode.cpp:10609`).
    if (state !== this.ui.partyState) {
      this.ui.shadedByTag02076e = false;
      this.ui.arrowCursorShape = false;
      this.ui.word23144 = 0;
    }
    this.ui.partyState = state;
    syncInventoryButtons(this.ui);
  }

  /** The extras setting (`DEBT.md` X), as the page's Extras button leaves it. */
  setExtras(enabled: boolean): void {
    this.ui.ctx.extras = enabled;
  }

  /**
   * Where the pointer is, `d.CurMouseX` and `d.CurMouseY`. Nothing is drawn from here:
   * the cursor is the VBL's to draw (`takeCursorMoved`).
   */
  setHoverPoint(point: { x: number; y: number } | null): void {
    const at = this.ui.hoverPoint;
    if (point?.x !== at?.x || point?.y !== at?.y) this.cursorMoved = true;
    this.ui.hoverPoint = point;
    saveMenuPointer(this.ui, point);
    if (point) marchingOrderPointerMoved(this.ui, Math.floor(point.x), Math.floor(point.y));
  }

  /**
   * Whether the pointer has moved since the cursor was last drawn: a redraw is due.
   * CSBWin's cursor is drawn by the VBL handler and by nothing else
   * (`doc/CSBwin-src/CSBCode.cpp:1050-1053`), where `checkVBL` last found the mouse
   * (`system.cpp:596-616`), so it moves once a VBL at most, however many moves the mouse
   * reports in between.
   */
  takeCursorMoved(): boolean {
    const moved = this.cursorMoved;
    this.cursorMoved = false;
    return moved;
  }

  /**
   * The screen composed again, cursor, hover highlights and every panel, over whatever
   * the viewport already holds: what every redraw but `DrawViewport`'s does. CSBWin's
   * mouse handling never calls `DrawViewport`, and its cursor moves independently of the
   * view, so neither a click nor the pointer's travel runs the bytecode interpreter here,
   * and with it `GraphicRandom` and `viewportRandom`.
   */
  refreshOverlay(): void {
    if (this.ui.hintOracleUp) return;
    this.presentViewport();
  }

  /**
   * `TAG01b29a` (`doc/CSBwin-src/CSBCode.cpp:8904`), which CSBWin's main loop calls
   * once per game tick (`:695`), after the tick's `DrawViewport` (`:648`). The port runs
   * it just before its one redraw of the whole screen, so what it changes on the
   * panels shows in the same frame.
   */
  attackPanelTick(): void {
    attackPanelTick(this.ui);
  }

  /** `DisplayCharacterDamage`'s blit — the host's `displayCharacterDamage`. */
  displayCharacterDamage(chIdx: number, damage: number): void {
    const inventoryOpen = this.ui.partyState.selectedCharacterIndex === chIdx;
    this.ui.characterDamage[chIdx] = { damage, inventoryOpen };
  }

  /** `TAG011366`'s redraw — the host's `tag011366`: the damage shown is drawn over. */
  tag011366(chIdx: number): void {
    this.ui.characterDamage[chIdx] = null;
  }

  /**
   * `DrawCharacterState`'s redraw of the name or the box, and of the open inventory's eye
   * panel — the host's `drawCharacterState`.
   */
  drawCharacterState(chIdx: number, charFlags: number): void {
    drawCharacterState(this.ui, chIdx, charFlags);
    drawCharacterStateEyePanel(this.ui, chIdx, charFlags);
  }

  /** Buttons 147 to 148: `gameFrozen`, the screen's side of it. */
  isFrozen(): boolean {
    return this.ui.uiMode === UIMode.Frozen;
  }

  /**
   * `TAG0196da`'s table half: the button the current key tables bind `key` to, or 0 — and
   * 0 for F1-F4, the port's caster keys (`tableKeyButton`).
   */
  translateKey(key: string, ctrl = false): number {
    return tableKeyButton(this.ui, key, ctrl);
  }

  setUIMode(mode: UIMode): void {
    this.ui.uiMode = mode;
    updateButtonLists(this.ui);
    syncInventoryButtons(this.ui);
  }

  /**
   * A game set up again after a lost one (`doc/CSBwin-src/Code1f9e6.cpp:309-318`): the
   * screen's state as a new game has it, and the adventure's button lists and key tables.
   */
  initializePlayState(): void {
    // `Cleanup(false)`'s `backgroundLib.Cleanup` and `CleanupAltMonCache`, before the game
    // that follows a lost one (`doc/CSBwin-src/Code1f9e6.cpp:302`, `Graphics.cpp:2230-2232`).
    // The first game starts with the screen's own, empty.
    this.viewport.context.backgroundLib?.Cleanup();
    this.viewport.context.altMonCache?.CleanupAltMonCache();
    initializePlayState(this.ui);
    this.setUIMode(UIMode.Adventure);
  }

  isInventoryOpen(): boolean {
    return this.ui.partyState.selectedCharacterIndex >= 0;
  }

  /**
   * `DrawViewport(facing, x, y)` (doc/CSBwin-src/Viewport.cpp:6701) for the party at
   * `position`, then the interface over it. `word1868` is the engine's `d.Word1868`
   * (`GameState.word1868`). CSBWin calls it from the main loop's tick
   * (`CSBCode.cpp:648`), a script's tick (`Attack.cpp:2207`) and the prison door's
   * interior (`renderPrisonInterior`), and the port nowhere else: `DrawViewport` runs
   * `GraphicRandom` and the viewport's own random numbers, so a draw off the tick moves
   * the teleporter's shimmer. Everything else composes the screen again with
   * `refreshOverlay`.
   */
  drawViewport(position: Position, facing: number, word1868: boolean): void {
    this.viewport.selectLevel(position.z);
    this.viewport.draw(position, facing, this.seeThroughWalls(), word1868);
    this.viewportDrawn = true;
    if (!this.ui.hintOracleUp) this.presentViewport();
  }

  /** `d.SeeThruWalls`, as `ViewportRenderer.draw` reads it. */
  private seeThroughWalls(): boolean {
    return this.ui.partyState.seeThruWalls !== 0;
  }

  private getGraphicBitmap(graphicNum: number, format: ImageFormat = ImageFormat.IMG1): IndexedBitmap | null {
    return getCachedGraphicBitmap(this.ui.graphicsLoader, this.ui.graphicCache, graphicNum, format);
  }


  private presentViewport(): void {
    clearIndex(this.screen, 0);
    drawStaticUIFrame(this.ui);
    const inventoryOpen = this.ui.partyState.selectedCharacterIndex >= 0;
    // The inventory is drawn into the viewport bitmap (`TAG022a60(17, d.pViewportBMP)`,
    // doc/CSBwin-src/CSBCode.cpp:7552), so the freeze's flood covers it, and nothing draws
    // it again until the thaw's `TAG0207cc` shows it.
    const frozen = this.isFrozen();
    // Frozen, no tick runs (doc/CSBwin-src/CSBCode.cpp:775), so nothing draws over "GAME
    // FROZEN". Asleep, the tick draws no viewport (`:647`), and `DisplaySleepScreen` holds
    // it. Both screens stay in the viewport until the next `DrawViewport`.
    if (frozen) displayFrozenScreen(this.ui);
    else if (this.ui.partyState.sleeping) displaySleepScreen(this.ui);
    if (!inventoryOpen) {
      syncOpenChest(this.ui, null);
      this.ui.displayResurrectChestOrScroll = 0;
    }
    if (inventoryOpen && !frozen) {
      drawInventoryBackground(this.ui);
      drawHintOracleButton(this.ui);
    } else {
      this.blitViewportToScreen();
    }
    drawPartyStatus(this.ui);
    if (inventoryOpen) {
      // Nothing draws the inventory under the disk menu, which covers the viewport,
      // until `TAG0207cc` shows it again. Drawing it would open the chest again that
      // `TAG02076e` repacked for the save.
      if (!isSaveMenuOpen(this.ui) && !frozen) drawInventoryScreen(this.ui);
      shadeRectIndex(this.ui, this.ui.uiTables.graphic232.word28, 0);
      // `_ReIncarnate` draws over the open inventory rather than replacing it: it
      // blanks the name strip and puts its keyboard where the eye panel was
      // (`doc/CSBwin-src/Code13ea4.cpp:39-50`). So it goes last, and only here.
      if (!frozen) drawReincarnateScreen(this.ui);
    }
    drawAttackPanel(this.ui);
    drawSpellPanel(this.ui);
    drawSpellControls(this.ui);
    drawHeldObjectName(this.ui);
    drawMessageLines(this.ui, this.messages);
    if (this.ui.shadedByTag02076e) {
      // `TAG02076e` shades the movement-arrow area, unless an inventory is open, then the
      // magic and weapon-ready areas (`doc/CSBwin-src/Character.cpp:5143-5157`), until
      // `TAG0207cc` redraws them (`tag02076e` lists the callers).
      if (!inventoryOpen) shadeRectIndex(this.ui, this.ui.uiTables.graphic232.word28, 0);
      shadeRectIndex(this.ui, this.ui.uiTables.graphic232.word12, 0);
      shadeRectIndex(this.ui, this.ui.uiTables.graphic232.word20, 0);
    }
    if (isSaveMenuOpen(this.ui)) {
      // The dialog takes the whole screen, cleared, where `_DoMenu` with `I1 == 0`
      // would leave the picture around the viewport.
      drawSaveMenu(this.ui);
    }
    // The button flash's inversion (`vblFlashButn`), for as long as `d.Word11776` says it
    // stands. The cursor goes over it: the VBL takes the cursor off before a flash right
    // of `x = 192`, where every flashed button is (doc/CSBwin-src/CSBCode.cpp:893-894),
    // and draws it back after (`:1049-1052`).
    const flashed = flashedButton(this.ui.ctx);
    if (flashed) vblFlashButn(this.screen, flashed);
    drawCursorItem(this.ui, !inventoryOpen);
    this.cursorMoved = false;

    const uiPalette = this.uiPalette;
    const viewportPalette = inventoryOpen ? uiPalette : (this.getViewportPalette() ?? uiPalette);
    const footprint = this.ui.objectCursorFootprint;
    let throughViewportPalette = false;
    if (!inventoryOpen && viewportPalette !== uiPalette) {
      updateImageDataFromIndexWithViewportPalette(this.screenImageData, this.screen, VIEWPORT_SPAN, viewportPalette, uiPalette);
      if (footprint) reconvertThroughPalette(this.screenImageData, this.screen, footprint, 12, uiPalette);
      throughViewportPalette = true;
    } else {
      updateImageDataFromIndex(this.screenImageData, this.screen, uiPalette);
    }
    const overlaid = this.isAdventureVideoMode() && this.drawViewportThroughOverlay(viewportPalette);
    this.presented.record(
      this.screen.pixels,
      uiPalette,
      throughViewportPalette ? { palette: viewportPalette, span: VIEWPORT_SPAN } : null,
      overlaid ? VIEWPORT_SPAN : null,
      throughViewportPalette || overlaid ? footprint : null,
      12,
    );
    this.screenCtx.putImageData(this.screenImageData, 0, 0);
  }

  /**
   * The screen the canvas was last given, as palette indices and the palettes they were
   * shown through: the golden frames (`tools/probe-frames.mjs`).
   */
  presentedFrame(): PresentedFrameCapture {
    return this.presented.capture(this.screenImageData.data);
  }

  /**
   * `videoMode == VM_ADVENTURE`, which `display` gives the viewport's `UpdateScreenArea` as
   * `useOverlay` (`doc/CSBwin-src/WinScreen.cpp:1527`). `LoopFlags.videoMode` says where
   * it is set.
   */
  private isAdventureVideoMode(): boolean {
    return this.ui.ctx.loop.videoMode === 'VM_ADVENTURE';
  }

  /**
   * The viewport drawn again, over what the straight path made of it, through
   * `CreateOverlayTable` and `UpdateScreenArea` (`OverlayScreen.ts`), unless they would
   * draw the straight path's picture. `UpdateScreenArea` allocates the overlay's memory
   * first (`doc/CSBwin-src/WinScreen.cpp:1064`). The object in hand of the coloured cursor
   * is shown through the interface palette after, as the straight path shows it.
   */
  private drawViewportThroughOverlay(viewportPalette: number[]): boolean {
    const { overlay, overlayPalette, host } = this.ui.ctx;
    if (overlayDrawsNothing(overlay, overlayPalette)) return false;
    overlay.current.Allocate();
    CreateOverlayTable(this.overlayTable, viewportPalette, true, overlay, overlayPalette);
    UpdateViewportArea(this.screenImageData.data, this.screen.pixels, this.overlayTable, overlay, true,
      (n) => die(host, n, `You have encountered code at relative address 0x${n.toString(16).padStart(6, '0')} that I thought was unused.`));
    if (this.ui.objectCursorFootprint) {
      reconvertThroughPalette(this.screenImageData, this.screen, this.ui.objectCursorFootprint, 12, this.uiPalette);
    }
    return true;
  }

  /**
   * `d.Palette11946` if `d.DynamicPaletteSwitching` is on, a copy, or `null`: on while the
   * dungeon view is shown, off while an inventory is open (`present`).
   */
  palette11946(): number[] | null {
    if (this.isInventoryOpen()) return null;
    return this.getViewportPalette()?.slice() ?? null;
  }

  /** `d.Palette552[d.CurrentPalette]`, as the VBL handler loads it (`doc/CSBwin-src/CSBCode.cpp:1021-1024`). */
  private getViewportPalette(): number[] | null {
    const palettes = this.viewport.viewportPalettes;
    if (!palettes || palettes.length === 0) return null;
    return palettes[this.ui.ctx.state.currentPalette] ?? null;
  }

  private renderLastFrame(): void {
    if (this.bootFrameRenderer) {
      this.bootFrameRenderer();
      return;
    }
    if (this.viewportDrawn && !this.ui.hintOracleUp) this.presentViewport();
  }

  private blitViewportToScreen(): void {
    const src = this.viewport.buffer;
    const dst = this.screen;
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

  /* ------------------------------------------------ the pre-game screens ---- */

  /** The 320x200 screen the intro modules draw into (`d.LogicalScreenBase`). */
  getScreenBuffer(): ScreenIndexBuffer {
    return this.screen;
  }

  /** The font, graphic 0x22d, for the pre-game screens' `TextOutToScreen`. */
  getFontData(): FontData {
    return this.ui.fontData;
  }

  /** `ReadAndExpandGraphic(n, …)`. Throws rather than return a blank screen. */
  getBitmap(graphicNum: number): IndexedBitmap {
    const bitmap = this.getGraphicBitmap(graphicNum);
    if (!bitmap) throw new Error(`graphics.dat item ${graphicNum} did not decode`);
    return bitmap;
  }

  /** Push the screen buffer to the canvas through an explicit palette. */
  presentScreen(palette: number[], palette11946: number[] | null = null): void {
    if (palette11946) {
      updateImageDataFromIndexWithViewportPalette(this.screenImageData, this.screen, VIEWPORT_SPAN, palette11946, palette);
    } else {
      updateImageDataFromIndex(this.screenImageData, this.screen, palette);
    }
    this.presented.record(this.screen.pixels, palette, palette11946 ? { palette: palette11946, span: VIEWPORT_SPAN } : null, null, null, 12);
    this.screenCtx.putImageData(this.screenImageData, 0, 0);
  }

  /** The entrance's view through the doorway: `ViewportRenderer.renderPrisonInterior`. */
  renderPrisonInterior(): IndexedBitmap {
    return this.viewport.renderPrisonInterior(this.seeThroughWalls());
  }

  /**
   * The save/load screen alone on a cleared screen, for the entrance's "Resume": drawn into
   * the screen, which the entrance's host presents with its cursor on it.
   *
   * `_ReadEntireGame` reaches the chooser through `SelectSaveGame(_9_, 1, 1, 1)`
   * (`doc/CSBwin-src/SaveGame.cpp:1688`), whose leading 1 is `_DoMenu`'s `FadeOldScreen` /
   * `ClearOldScreen` pair (`doc/CSBwin-src/Menu.cpp:285-291`): the screen under the chooser
   * is cleared, which `drawSaveMenu` does for either menu.
   */
  drawSaveMenuOnly(): void {
    drawSaveMenu(this.ui);
  }

  /**
   * The pointer over the entrance's chooser, or off the canvas: the chooser is drawn
   * again, and presented, when that brings the import's hint up or takes it down
   * (`saveMenuPointer`). Says whether it was.
   */
  moveSaveMenuPointer(point: { x: number; y: number } | null): boolean {
    if (!saveMenuPointer(this.ui, point)) return false;
    this.renderLastFrame();
    return true;
  }

  /** `_DoMenu`'s drawing into the screen (`ui/Menu.ts`), for a menu a pre-game screen raises. */
  doMenu(title1: string | null, title2: string | null, options: string[], centred: boolean): void {
    doMenu(this.ui, title1, title2, options, centred);
  }

  /** `d.pButn18970[set][count-1]`, the button list `_WaitForMenuSelect` puts up. */
  menuButtonList(count: number, centred: boolean): UIButton[] {
    return menuButtonList(this.ui, count, centred);
  }

  /** One pass of `_WaitForMenuSelect`'s press animation, the one `nowMs` falls in. */
  drawMenuPress(press: MenuPress, nowMs: number): void {
    drawMenuPress(this.ui, press, nowMs);
  }

  /**
   * Redraw hook for while a pre-game screen is up.
   *
   * `ui.renderLastFrame()` normally composes the last adventure frame again; the save/load screen
   * calls it whenever its list changes (`ui/SaveMenu.ts`). During the entrance screen there
   * is no adventure frame to re-run, so the boot sequence installs its own.
   */
  setBootFrameRenderer(render: (() => void) | null): void {
    this.bootFrameRenderer = render;
  }

  /** The canvas's style, for the page's smoothing toggle. */
  getCanvasStyle(): CSSStyleDeclaration {
    return this.canvas.style;
  }
}
