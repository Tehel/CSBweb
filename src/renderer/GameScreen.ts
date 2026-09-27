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
import type { CharacterStats } from '../engine/CharacterStats';
import type { CSBGraphicsLoader } from '../data/CSBGraphicsLoader';
import type { DungeonState } from '../engine/DungeonState';
import type { IndexedBitmap } from './csbwin/CanvasBlitter';
import {
  clearIndex,
  createPaletteIndexViewportBuffer,
  updateImageDataFromIndex,
  updateImageDataFromIndexWithViewportPalette,
} from './csbwin/CanvasBlitter';
import { extractUITables, type UITables } from './csbwin/UITables';
import { loadFontData, type FontData } from './csbwin/TextRenderer';
import { ImageFormat } from '../core/imageDecoder';
import {
  VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT,
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  VIEWPORT_X,
  VIEWPORT_Y,
} from './ViewportGraphics';
import { Position } from '@/core';
import { ViewportRenderer } from './ViewportRenderer';
import { createUIState, initializePlayState, UIMode, type ScreenIndexBuffer, type UIState } from './ui/UIState';
import { drawStaticUIFrame } from './ui/Draw';
import { selectPaletteIndexForLightLevel } from './ui/Light';
import {
  EmptyHandedViewportTarget,
  ViewportCursorAction,
  hasCursorObject,
  resolveEmptyHandedViewportClick,
  resolveViewportCursorAction,
  tryPickViewportObject,
  tryUseFrontWallItem,
} from './ui/ViewportPicking';
import {
  drawCursorItem,
  marchingOrderPointerMoved,
  drawHoverHighlights,
  handleMouseButton,
  handleMouseUnclick,
  searchMouseButtons,
  syncInventoryButtons,
  tag02076e,
  tag0207cc,
  updateButtonLists,
} from './ui/Mouse';
import { drawSpellControls, drawSpellPanel } from './ui/MagicPanel';
import { attackPanelTick, closeAttackMenu, drawAttackPanel } from './ui/Attack';
import { handleUIKey, keyScanOf, translateKey } from './ui/Keyboard';
import {
  drawReincarnateScreen,
  isReincarnateScreenOpen,
  openReincarnateScreen,
  reincarnateClick,
  reincarnateKey,
} from './ui/ReIncarnate';
import {
  closeSaveMenu,
  drawSaveMenu,
  isSaveMenuOpen,
  openSaveMenu,
  saveMenuClick,
  saveMenuKey,
  saveMenuWheel,
  type SaveMenuMode,
} from './ui/SaveMenu';
import { drawInventoryBackground, drawInventoryScreen, repackOpenChest, syncOpenChest } from './ui/Inventory';
import { drawHeldObjectName, drawPartyStatus, getChampionPortrait } from './ui/Character';
import { displayFrozenScreen, displaySleepScreen, drawMessageLines, shadeRectIndex } from './ui/Draw';

/**
 * What the interface asks of the engine and the page. Each is one of `UIState`'s hooks out,
 * documented there, except `onPaletteSelected`.
 */
export interface GameScreenHooks extends Required<Pick<UIState,
  | 'queueSound'
  | 'viewingFilter'
  | 'onObjectMove'
  | 'onSpellCast'
  | 'onChampionAttack'
  | 'onConsumeAttackDamage'
  | 'applyFeeding'
  | 'onRemoveCharacterPossession'
  | 'onAddCharacterPossession'
  | 'onResurrectReincarnateCancel'
  | 'onReincarnateNamed'
  | 'onSleep'
  | 'setClockTick'
  | 'onWakeUp'
  | 'onFreeze'
  | 'onThaw'
  | 'onCreateSave'
  | 'onSaveWritten'
  | 'onRestoreSave'
  | 'onSetPaused'
>> {
  /**
   * The palette the light level picked, published as CSBWin's `d.CurrentPalette`: the
   * monster AI reads it to shorten how far a monster can see
   * (`doc/CSBwin-src/Monster.cpp:577-581`).
   */
  onPaletteSelected(index: number): void;
}

/** What the screen reads: the graphics, the dungeon, and the engine's load figures. */
export interface GameScreenDeps {
  graphicsLoader: GraphicsLoader;
  dungeonState: DungeonState;
  csbGraphicsLoader?: CSBGraphicsLoader;
  /**
   * The engine's `CharacterStats`, so the load and weight figures the eye panel prints
   * come out of the same code the engine acts on.
   */
  characterStats: CharacterStats;
}

export class GameScreen {
  /** Everything the UI modules share. See `ui/UIState.ts`. */
  private readonly ui: UIState;
  private readonly viewport: ViewportRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly screenCtx: CanvasRenderingContext2D;
  private readonly screenImageData: ImageData; // RGBA staging for present
  /** `d.LogicalScreenBase`, the whole screen as palette indices. */
  private readonly screen: ScreenIndexBuffer;
  private readonly uiPalette: number[];
  private readonly onPaletteSelected: (index: number) => void;
  private lastRenderPosition: Position | null = null;
  private lastRenderFacing: number = 0;
  private bootFrameRenderer: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, deps: GameScreenDeps, hooks: GameScreenHooks) {
    const { graphicsLoader } = deps;
    const ui = createUIState(graphicsLoader, deps.dungeonState, {
      getGraphicBitmap: (graphicNum, format) => this.getGraphicBitmap(graphicNum, format),
      renderLastFrame: () => this.renderLastFrame(),
    });
    this.ui = ui;
    ui.characterStats = deps.characterStats;
    ui.queueSound = hooks.queueSound;
    ui.viewingFilter = hooks.viewingFilter;
    ui.onObjectMove = hooks.onObjectMove;
    ui.onSpellCast = hooks.onSpellCast;
    ui.onChampionAttack = hooks.onChampionAttack;
    ui.onConsumeAttackDamage = hooks.onConsumeAttackDamage;
    ui.applyFeeding = hooks.applyFeeding;
    ui.onRemoveCharacterPossession = hooks.onRemoveCharacterPossession;
    ui.onAddCharacterPossession = hooks.onAddCharacterPossession;
    ui.onResurrectReincarnateCancel = hooks.onResurrectReincarnateCancel;
    ui.onReincarnateNamed = hooks.onReincarnateNamed;
    ui.onSleep = hooks.onSleep;
    ui.setClockTick = hooks.setClockTick;
    ui.onWakeUp = hooks.onWakeUp;
    ui.onFreeze = hooks.onFreeze;
    ui.onThaw = hooks.onThaw;
    ui.onCreateSave = hooks.onCreateSave;
    ui.onSaveWritten = hooks.onSaveWritten;
    ui.onRestoreSave = hooks.onRestoreSave;
    ui.onSetPaused = hooks.onSetPaused;
    this.onPaletteSelected = hooks.onPaletteSelected;

    this.canvas = canvas;
    const screenCtx = canvas.getContext('2d');
    if (!screenCtx) throw new Error('Failed to create screen 2D context');
    this.screenCtx = screenCtx;
    this.screenImageData = screenCtx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);

    ui.uiTables = extractUITables(graphicsLoader);
    const palette552 = ui.uiTables.graphic232.palette552;
    this.viewport = new ViewportRenderer({
      graphicsLoader,
      dungeonState: deps.dungeonState,
      csbGraphicsLoader: deps.csbGraphicsLoader,
      palette552,
      graphicCache: ui.graphicCache,
      getGraphicBitmap: (graphicNum) => this.getGraphicBitmap(graphicNum),
      viewportContext: screenCtx,
    });
    ui.objectTables = this.viewport.objectTables;
    this.uiPalette = palette552[0]?.slice() ?? graphicsLoader.getPalette(0);
    ui.fontData = loadFontData(graphicsLoader);

    this.screen = createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0);
    ui.screenIndexBuffer = this.screen;
    updateButtonLists(ui);
    ui.context = this.viewport.context;
  }

  getUITables(): UITables | null {
    return this.ui.uiTables;
  }

  /* Mouse entry points for the host page; the work is in `ui/Mouse.ts`. */

  /** The button a click hits, 0 for none; the host queues it with `Game.onMouseClick`. */
  searchMouseButtons(x: number, y: number, buttons: number): number {
    return searchMouseButtons(this.ui, x, y, buttons);
  }

  /**
   * A click on the Reincarnate name-entry screen. That screen reads the mouse itself and
   * does its own geometry (`doc/CSBwin-src/Code13ea4.cpp:114-212`) — it never consults a
   * button list, and while it is up nothing else may act on a click.
   */
  handleReincarnateClick(x: number, y: number): void {
    reincarnateClick(this.ui, x, y);
  }

  /**
   * Offer a key to the Reincarnate name-entry screen. Returns whether it took it —
   * while that screen is up it takes everything, which is what makes it modal
   * (`keyboardMode = 2`, `doc/CSBwin-src/Code13ea4.cpp:38`).
   */
  handleReincarnateKey(key: string): boolean {
    return reincarnateKey(this.ui, key);
  }

  isReincarnateScreenOpen(): boolean {
    return isReincarnateScreenOpen(this.ui);
  }

  /** `ReIncarnate(pcA3)` (`doc/CSBwin-src/CSBCode.cpp:6738`) — open the screen. */
  openReincarnateScreen(chIdx: number): void {
    openReincarnateScreen(this.ui, chIdx);
  }

  /** `if (d.AttackingCharacterOrdinal == chIdx+1) TAG01b1c0();` — the host's `closeAttackMenuOf`. */
  closeAttackMenuOf(chIdx: number): void {
    if (this.ui.attackingCharacterOrdinal === chIdx + 1) closeAttackMenu(this.ui);
  }

  /** `RepackChest` (`doc/CSBwin-src/Character.cpp:3108`) — the host's `repackChest`. */
  repackChest(): void {
    repackOpenChest(this.ui);
  }

  /** `TAG02076e` (`doc/CSBwin-src/Character.cpp:5108`) — the host's `tag02076e`. */
  tag02076e(): void {
    tag02076e(this.ui);
  }

  /** `TAG0207cc` (`doc/CSBwin-src/CSBCode.cpp:9934`) — the host's `tag0207cc`. */
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
   * `HandleMouseEvents` — the main loop in CSBWin (`doc/CSBwin-src/CSBCode.cpp:762`), this
   * method here. The deferral is the whole reason the flag exists.
   */
  handleMouseButton(num: number, x: number, y: number): void {
    handleMouseButton(this.ui, num, x, y);
    if (this.ui.diskMenuNeeded) {
      this.ui.diskMenuNeeded = false;
      openSaveMenu(this.ui);
    }
  }

  /** The button-up, `0x0add` (`doc/CSBwin-src/Mouse.cpp:1523-1549`). */
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

  /**
   * A click while the save screen is up, taken **straight from the DOM event** rather
   * than through the mouse queue. That is CSBWin's modality — `_WaitForMenuSelect`
   * replaces every button list while it runs — and it is also what preserves the
   * transient user activation `showDirectoryPicker` demands.
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

  /**
   * `AddCharacter`'s portrait blit, deferred to save time.
   *
   * CSBWin copies a cell of basic graphic 26 into the character record the moment a
   * champion joins (`doc/CSBwin-src/Character.cpp:486-495`), so `CHARDESC` always holds
   * pixels. This engine holds no graphics, so a champion it created carries the cell
   * *index* instead and the pixels are resolved here — the save writer asks for them
   * when it packs block 4.
   */
  portraitPixelsFor(champion: Champion): number[] | undefined {
    const bitmap = getChampionPortrait(this.ui, champion);
    return bitmap ? Array.from(bitmap.pixels) : undefined;
  }

  /* Viewport picking entry points; the work is in `ui/ViewportPicking.ts`. */

  resolveEmptyHandedViewportClick(x: number, y: number): EmptyHandedViewportTarget | null {
    return resolveEmptyHandedViewportClick(this.ui, x, y);
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

  setPartyState(state: PartyState | null): void {
    // Another party is another game, loaded or begun, which CSBWin draws afresh: nothing
    // `TAG02076e` shaded survives it (a quick-load over a sleeping party, which no
    // `TAG0207cc` follows).
    // Nor does a champion in hand (`d.Word23144 = 0`, `doc/CSBwin-src/CSBCode.cpp:10485`).
    if (state !== this.ui.partyState) {
      this.ui.shadedByTag02076e = false;
      this.ui.word23144 = 0;
    }
    this.ui.partyState = state;
    syncInventoryButtons(this.ui);
  }

  setHoverPoint(point: { x: number; y: number } | null): void {
    this.ui.hoverPoint = point;
    if (point) marchingOrderPointerMoved(this.ui, Math.floor(point.x), Math.floor(point.y));
  }

  /**
   * Recomposite the screen — cursor, hover highlights, every UI panel — over
   * whatever the viewport buffer already holds, without calling `DrawViewport`
   * again.
   *
   * `render()` always redraws the dungeon view itself, which in CSBWin happens once
   * per game tick (`doc/CSBwin-src/CSBCode.cpp:638`) — never in response to the
   * mouse. Nothing in CSBWin's own mouse handling calls `DrawViewport`; the cursor
   * is a hardware/software sprite tracked independently of it. This is the
   * equivalent for mousemove: it exists so the custom-drawn cursor can follow the
   * pointer at input rate without also re-running the bytecode interpreter — and
   * with it `BytecodeInterpreter.graphicRandom`/`viewportRandom` — on every pixel of
   * mouse travel, which turned a teleporter's or a lightning door's shimmer into
   * something that changed only when the mouse moved and far too fast otherwise.
   */
  refreshOverlay(): void {
    this.presentViewport();
  }

  /**
   * `TAG01b29a` (`doc/CSBwin-src/CSBCode.cpp:8799`), which CSBWin's main loop calls
   * once per game tick just before drawing (`:685`).
   */
  attackPanelTick(): void {
    attackPanelTick(this.ui);
  }

  /** Buttons 147 to 148: `gameFrozen`, the screen's side of it. */
  isFrozen(): boolean {
    return this.ui.uiMode === UIMode.Frozen;
  }

  /** `TAG0196da`'s table half: the button the current key tables bind `key` to, or 0. */
  translateKey(key: string): number {
    return translateKey(this.ui, keyScanOf(key));
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
    initializePlayState(this.ui);
    this.setUIMode(UIMode.Adventure);
  }

  isInventoryOpen(): boolean {
    return (this.ui.partyState?.selectedCharacterIndex ?? -1) >= 0;
  }

  /** The screen for the party at `position`: the dungeon view, then the interface over it. */
  render(position: Position, facing: number): void {
    const { x, y, z } = position;
    this.lastRenderPosition = new Position(x, y, z);
    this.lastRenderFacing = facing;

    this.viewport.selectLevel(z);
    // Frozen, no tick runs (doc/CSBwin-src/CSBCode.cpp:765), so nothing draws over "GAME
    // FROZEN". `if (d.PartySleeping != 0) goto tag000730;` — no `DrawViewport` while the
    // party sleeps (`:637`); `DisplaySleepScreen` holds the viewport.
    if (this.isFrozen()) displayFrozenScreen(this.ui);
    else if (this.ui.partyState?.sleeping) displaySleepScreen(this.ui);
    else this.viewport.draw(position, facing, this.seeThroughWalls());
    this.presentViewport();
  }

  /** `d.SeeThruWalls`, as `ViewportRenderer.draw` reads it. */
  private seeThroughWalls(): boolean {
    return (this.ui.partyState?.seeThruWalls ?? 0) !== 0;
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

  private presentViewport(): void {
    clearIndex(this.screen, 0);
    drawStaticUIFrame(this.ui);
    const inventoryOpen = (this.ui.partyState?.selectedCharacterIndex ?? -1) >= 0;
    // The inventory is drawn into the viewport bitmap (`TAG022a60(17, d.pViewportBMP)`,
    // doc/CSBwin-src/CSBCode.cpp:7493), so the freeze's flood covers it, and nothing draws
    // it again until the thaw's `TAG0207cc` shows it.
    const frozen = this.isFrozen();
    if (!inventoryOpen) {
      syncOpenChest(this.ui, null);
      this.ui.displayResurrectChestOrScroll = 0;
    }
    if (inventoryOpen && !frozen) {
      drawInventoryBackground(this.ui);
    } else {
      this.blitViewportToScreen();
    }
    drawPartyStatus(this.ui);
    if (inventoryOpen) {
      // Nothing draws the inventory under the disk menu, which covers the viewport,
      // until `TAG0207cc` shows it again. Drawing it would open the chest again that
      // `TAG02076e` repacked for the save.
      if (!isSaveMenuOpen(this.ui) && !frozen) drawInventoryScreen(this.ui);
      if (this.ui.uiTables) shadeRectIndex(this.ui, this.ui.uiTables.graphic232.word28, 0);
      // `_ReIncarnate` draws over the open inventory rather than replacing it: it
      // blanks the name strip and puts its keyboard where the eye panel was
      // (`doc/CSBwin-src/Code13ea4.cpp:39-50`). So it goes last, and only here.
      if (!frozen) drawReincarnateScreen(this.ui);
    }
    drawAttackPanel(this.ui);
    drawSpellPanel(this.ui);
    drawSpellControls(this.ui);
    drawHeldObjectName(this.ui);
    drawMessageLines(this.ui);
    if ((this.ui.shadedByTag02076e || isSaveMenuOpen(this.ui)) && this.ui.uiTables) {
      // `TAG02076e` shades the movement-arrow area, unless an inventory is open, then the
      // magic and weapon-ready areas (`doc/CSBwin-src/Character.cpp:5118-5132`), until
      // `TAG0207cc` redraws them (`tag02076e` lists the callers). The load-only save
      // screen, which calls no `TAG02076e`, draws over the same interface and shades it too.
      if (!inventoryOpen) shadeRectIndex(this.ui, this.ui.uiTables.graphic232.word28, 0);
      shadeRectIndex(this.ui, this.ui.uiTables.graphic232.word12, 0);
      shadeRectIndex(this.ui, this.ui.uiTables.graphic232.word20, 0);
    }
    if (isSaveMenuOpen(this.ui)) {
      // The screen goes over the viewport, which is where `_DoMenu` leaves it when
      // `I1 == 0`.
      drawSaveMenu(this.ui);
    }
    drawHoverHighlights(this.ui);
    drawCursorItem(this.ui, !inventoryOpen);

    const uiPalette = this.uiPalette;
    const viewportPalette = inventoryOpen ? uiPalette : (this.getViewportPalette() ?? uiPalette);
    if (!inventoryOpen && viewportPalette !== uiPalette) {
      updateImageDataFromIndexWithViewportPalette(
        this.screenImageData,
        this.screen,
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
      updateImageDataFromIndex(this.screenImageData, this.screen, uiPalette);
    }
    this.screenCtx.putImageData(this.screenImageData, 0, 0);
  }

  /**
   * `d.Palette11946` if `d.DynamicPaletteSwitching` is on, a copy, or `null`: on while the
   * dungeon view is shown, off while an inventory is open (`present`).
   */
  palette11946(): number[] | null {
    if (this.isInventoryOpen()) return null;
    return this.getViewportPalette()?.slice() ?? null;
  }

  private getViewportPalette(): number[] | null {
    const palettes = this.viewport.viewportPalettes;
    if (!palettes || palettes.length === 0) return null;
    const index = Math.min(selectPaletteIndexForLightLevel(this.ui), palettes.length - 1);
    this.onPaletteSelected(index);
    return palettes[index] ?? palettes[0] ?? null;
  }

  private renderLastFrame(): void {
    if (this.bootFrameRenderer) {
      this.bootFrameRenderer();
      return;
    }
    if (!this.lastRenderPosition) return;
    this.render(this.lastRenderPosition, this.lastRenderFacing);
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
    if (!this.ui.fontData) throw new Error('Screen not initialized');
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
      const viewport = { x1: VIEWPORT_X, y1: VIEWPORT_Y, x2: VIEWPORT_X + VIEWPORT_WIDTH - 1, y2: VIEWPORT_Y + VIEWPORT_HEIGHT - 1 };
      updateImageDataFromIndexWithViewportPalette(this.screenImageData, this.screen, viewport, palette11946, palette);
    } else {
      updateImageDataFromIndex(this.screenImageData, this.screen, palette);
    }
    this.screenCtx.putImageData(this.screenImageData, 0, 0);
  }

  /** The entrance's view through the doorway: `ViewportRenderer.renderPrisonInterior`. */
  renderPrisonInterior(): IndexedBitmap {
    return this.viewport.renderPrisonInterior(this.seeThroughWalls());
  }

  /**
   * The save/load screen alone on a cleared screen, for the entrance's "Resume".
   *
   * `_ReadEntireGame` reaches the chooser through `SelectSaveGame(_9_, 1, 1, 1)`
   * (`doc/CSBwin-src/SaveGame.cpp:1563`), whose leading 1 is `_DoMenu`'s `FadeOldScreen` /
   * `ClearOldScreen` pair (`doc/CSBwin-src/Menu.cpp:285-291`) — so unlike the in-game disk
   * icon, this one does not sit over the picture behind it.
   */
  presentSaveMenuOnly(palette: number[]): void {
    clearIndex(this.screen, 0);
    drawSaveMenu(this.ui);
    this.presentScreen(palette);
  }

  /**
   * Redraw hook for while a pre-game screen is up.
   *
   * `ui.renderLastFrame()` normally re-runs the last adventure frame; the save/load screen
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
