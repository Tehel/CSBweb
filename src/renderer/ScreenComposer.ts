/**
 * The 320x200 screen composed, without the DOM: the interface and its viewport, the
 * screen's palette-index buffer they draw into, the order the panels are drawn in, and
 * the palettes each pixel is converted through, into an RGBA image of `ImageData`'s
 * shape. `GameScreen` puts each frame on the canvas; a tool can compose into a buffer of
 * its own.
 *
 * Each frame composed is handed to `ScreenOutput.show`, which shows it.
 */

import type { IndexedBitmap } from './csbwin/CanvasBlitter';
import {
  clearIndex,
  vblFlashButn,
  createPaletteIndexViewportBuffer,
  updateImageDataFromIndex,
  updateImageDataFromIndexWithViewportPalette,
  reconvertThroughPalette,
  type RgbaImage,
} from './csbwin/CanvasBlitter';
import { PresentedFrame, type PresentedFrameCapture } from './csbwin/PresentedFrame';
import { CreateOverlayTable, OVERLAY_TABLE_SIZE, overlayDrawsNothing, UpdateViewportArea } from './csbwin/OverlayScreen';
import { die } from '../engine/Die';
import { flashedButton } from '../engine/LoopState';
import {
  VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT,
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  VIEWPORT_X,
  VIEWPORT_Y,
} from './ViewportGraphics';
import type { ViewportRenderer } from './ViewportRenderer';
import { createScreenUI, type ScreenUIDeps } from './ScreenUI';
import { LEFT_HANDED_VIEWPORT, leftHandedLayout, leftHandedX, makeLeftHanded, rightHandedX, type LeftHandedLayout } from './LeftHanded';
import type { ScreenIndexBuffer, UIHooks, UIState } from './ui/UIState';
import { drawStaticUIFrame } from './ui/Draw';
import { drawCursorItem } from './ui/Mouse';
import { drawSpellControls, drawSpellPanel } from './ui/MagicPanel';
import { drawAttackPanel } from './ui/Attack';
import { drawReincarnateScreen } from './ui/ReIncarnate';
import { drawInventoryBackground, drawInventoryScreen } from './ui/Inventory';
import { drawHeldObjectName, drawPartyStatus } from './ui/Character';
import { drawHintOracleButton } from './ui/HintOracleButton';
import { displayFrozenScreen, displaySleepScreen, drawMessageLines, shadeRectIndex } from './ui/Draw';
import type { ScrollingText } from './csbwin/ScrollingText';

/**
 * What the interface asks of the page: `UIState`'s hooks out, documented there, but the
 * composer's own two. The engine the interface reaches through `ui.ctx`.
 */
export type ScreenHooks = Omit<UIHooks, 'getGraphicBitmap' | 'renderLastFrame'>;

/** What the composer reads: the interface's, but the screen, which is its own, and the message area. */
export type ScreenComposerDeps = Omit<ScreenUIDeps, 'screen' | 'gameState' | 'rules' | 'trace'> & {
  /**
   * The message area, CSBWin's global `scrollingText` (`doc/CSBwin-src/CSBCode.cpp:1362`):
   * the one the engine writes through its host's `messages`.
   */
  messages: ScrollingText;
};

/** Where a composed frame goes. */
export interface ScreenOutput {
  /** The RGBA image each frame is converted into. */
  readonly image: RgbaImage;
  /** `image` holds a new frame; `withCursor` when it is the adventure's, the cursor drawn on it. */
  show(withCursor: boolean): void;
}

/** The viewport's rectangle of the screen, ends inclusive, as the conversion takes it. */
const VIEWPORT_SPAN = {
  x1: VIEWPORT_X,
  y1: VIEWPORT_Y,
  x2: VIEWPORT_X + VIEWPORT_WIDTH - 1,
  y2: VIEWPORT_Y + VIEWPORT_HEIGHT - 1,
} as const;

export class ScreenComposer {
  /**
   * Everything the UI modules share. See `ui/UIState.ts`. The engine's host draws on it
   * (`ui/HostDrawing.ts`).
   */
  readonly ui: UIState;
  readonly viewport: ViewportRenderer;
  /** `d.LogicalScreenBase`, the whole screen as palette indices. */
  readonly screen: ScreenIndexBuffer;
  /** What was last shown, as palette indices (`presentedFrame`). */
  private readonly presented = new PresentedFrame(SCREEN_WIDTH, SCREEN_HEIGHT);
  private readonly uiPalette: number[];
  /** `currentOverlay.m_table`, which `UpdateScreenArea` builds again for each frame. */
  private readonly overlayTable = new Uint16Array(OVERLAY_TABLE_SIZE);
  private readonly messages: ScrollingText;
  /** A dungeon view has been drawn, so there is an adventure frame to compose again. */
  private viewportDrawn = false;
  private bootFrameRenderer: (() => void) | null = null;
  /**
   * The left-handed screen the last frame shown was (`LeftHanded.ts`), whose points are
   * moved back (`screenPoint`), or `null` for CSBWin's.
   */
  private shownLeftHanded: LeftHandedLayout | null = null;
  /** A row of the screen, the room `makeLeftHanded` moves the regions through. */
  private readonly rowScratch = new Uint8Array(SCREEN_WIDTH);
  /**
   * The page's own over the adventure's frame, under the cursor and on CSBWin's screen
   * as shown, never moved for the left-handed one: a recording's viewer's strip
   * (`ui/RecordingStrip.ts`), over the message area's top row, whose lines are then
   * drawn lowered (`drawMessageLines`); or `null`.
   */
  overlay: ((ui: UIState) => void) | null = null;

  constructor(private readonly output: ScreenOutput, deps: ScreenComposerDeps, hooks: ScreenHooks) {
    this.messages = deps.messages;
    this.uiPalette = deps.tables.ui.graphic232.palette552[0]!.slice();
    this.screen = createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0);

    const { ui, viewport } = createScreenUI({
      graphicsLoader: deps.graphicsLoader,
      tables: deps.tables,
      ctx: deps.ctx,
      screen: this.screen,
      csbGraphicsLoader: deps.csbGraphicsLoader,
      hintOracle: deps.hintOracle,
      trace: (line) => deps.ctx.host.trace(line),
    }, {
      ...hooks,
      getGraphicBitmap: (graphicNum) => this.ui.graphics.basicGraphic(graphicNum),
      renderLastFrame: () => this.renderLastFrame(),
    });
    this.viewport = viewport;
    this.ui = ui;
  }

  /**
   * The point of CSBWin's screen a point of the shown frame is: itself, but on the
   * left-handed screen, whose regions it moves back (`LeftHanded.ts`).
   */
  screenPoint(x: number, y: number): { x: number; y: number } {
    const layout = this.shownLeftHanded;
    return layout ? { x: rightHandedX(layout, x, y), y } : { x, y };
  }

  /**
   * The left-handed screen the screen is composed as, or `null`: the setting on, and the
   * data set's tables fitting it (`leftHandedLayout`), but not under a dialog, which takes
   * the whole screen.
   */
  private leftHandedLayout(): LeftHandedLayout | null {
    if (!this.ui.settings.values.leftHanded || this.ui.dialog !== null) return null;
    return leftHandedLayout(this.ui.uiTables);
  }

  /** A dungeon view is in the viewport (`GameScreen.drawViewport`): `renderLastFrame` composes it again from now on. */
  viewportWasDrawn(): void {
    this.viewportDrawn = true;
  }

  /** `ReadAndExpandGraphic(n, …)`. Throws rather than return a blank screen. */
  getBitmap(graphicNum: number): IndexedBitmap {
    const bitmap = this.ui.graphics.basicGraphic(graphicNum);
    if (!bitmap) throw new Error(`graphics.dat item ${graphicNum} did not decode`);
    return bitmap;
  }

  /** The adventure's frame: the interface and every panel over the viewport, the cursor on top, shown. */
  presentViewport(): void {
    clearIndex(this.screen, 0);
    drawStaticUIFrame(this.ui);
    const inventoryOpen = this.ui.partyState.selectedCharacterIndex >= 0;
    // The inventory is drawn into the viewport bitmap (`TAG022a60(17, d.pViewportBMP)`,
    // doc/CSBwin-src/CSBCode.cpp:7552), so the freeze's flood covers it, and nothing draws
    // it again until the thaw's `TAG0207cc` shows it.
    const frozen = this.ui.ctx.loop.gameFrozen;
    // Frozen, no tick runs (doc/CSBwin-src/CSBCode.cpp:775), so nothing draws over "GAME
    // FROZEN". Asleep, the tick draws no viewport (`:647`), and `DisplaySleepScreen` holds
    // it. Both screens stay in the viewport until the next `DrawViewport`.
    if (frozen) displayFrozenScreen(this.ui);
    else if (this.ui.partyState.sleeping) displaySleepScreen(this.ui);
    if (inventoryOpen && !frozen) {
      drawInventoryBackground(this.ui);
      drawHintOracleButton(this.ui);
    } else {
      this.blitViewportToScreen();
    }
    drawPartyStatus(this.ui);
    if (inventoryOpen) {
      if (!frozen) drawInventoryScreen(this.ui);
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
    drawMessageLines(this.ui, this.messages, this.overlay !== null);
    if (this.ui.shadedByTag02076e) {
      // `TAG02076e` shades the movement-arrow area, unless an inventory is open, then the
      // magic and weapon-ready areas (`doc/CSBwin-src/Character.cpp:5143-5157`), until
      // `TAG0207cc` redraws them (`tag02076e` lists the callers).
      if (!inventoryOpen) shadeRectIndex(this.ui, this.ui.uiTables.graphic232.word28, 0);
      shadeRectIndex(this.ui, this.ui.uiTables.graphic232.word12, 0);
      shadeRectIndex(this.ui, this.ui.uiTables.graphic232.word20, 0);
    }
    // The dialog over the game (`ui/Dialog.ts`). The save menu takes the whole screen,
    // cleared, where `_DoMenu` with `I1 == 0` would leave the picture around the viewport.
    this.ui.dialog?.draw(this.ui);
    // The button flash's inversion (`vblFlashButn`), for as long as `d.Word11776` says it
    // stands. The cursor goes over it: the VBL takes the cursor off before a flash right
    // of `x = 192`, where every flashed button is (doc/CSBwin-src/CSBCode.cpp:893-894),
    // and draws it back after (`:1049-1052`).
    const flashed = flashedButton(this.ui.ctx);
    if (flashed) vblFlashButn(this.screen, flashed);
    // The left-handed screen is CSBWin's with its regions moved, and the cursor drawn
    // over it where the pointer is on it.
    const leftHanded = this.leftHandedLayout();
    if (leftHanded) makeLeftHanded(leftHanded, this.screen.pixels, this.rowScratch);
    this.shownLeftHanded = leftHanded;
    this.overlay?.(this.ui);
    const viewportSpan = leftHanded ? LEFT_HANDED_VIEWPORT : VIEWPORT_SPAN;
    drawCursorItem(this.ui, !inventoryOpen, leftHanded ? (x, y) => leftHandedX(leftHanded, x, y) : undefined);

    const image = this.output.image;
    const uiPalette = this.uiPalette;
    // A dialog of the port's own is shown through the interface's palette whole (`Dialog.uiPalette`).
    const uiPaletteOnly = this.ui.dialog?.uiPalette === true;
    const viewportPalette = inventoryOpen || uiPaletteOnly ? uiPalette : (this.getViewportPalette() ?? uiPalette);
    const footprint = this.ui.objectCursorFootprint;
    let throughViewportPalette = false;
    if (!inventoryOpen && viewportPalette !== uiPalette) {
      updateImageDataFromIndexWithViewportPalette(image, this.screen, viewportSpan, viewportPalette, uiPalette);
      if (footprint) reconvertThroughPalette(image, this.screen, footprint, 12, uiPalette);
      throughViewportPalette = true;
    } else {
      updateImageDataFromIndex(image, this.screen, uiPalette);
    }
    const overlaid = !uiPaletteOnly && this.isAdventureVideoMode() && this.drawViewportThroughOverlay(viewportPalette, viewportSpan.x1);
    this.presented.record(
      this.screen.pixels,
      uiPalette,
      throughViewportPalette ? { palette: viewportPalette, span: viewportSpan } : null,
      overlaid ? viewportSpan : null,
      throughViewportPalette || overlaid ? footprint : null,
      12,
    );
    this.output.show(true);
  }

  /**
   * The screen last shown, as palette indices and the palettes they were shown through:
   * the golden frames (`tools/probe-frames.ts`).
   */
  presentedFrame(): PresentedFrameCapture {
    return this.presented.capture(this.output.image.data);
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
   * is shown through the interface palette after, as the straight path shows it. `x0` is
   * the column the viewport is shown at.
   */
  private drawViewportThroughOverlay(viewportPalette: number[], x0: number): boolean {
    const { overlay, overlayPalette, host } = this.ui.ctx;
    if (overlayDrawsNothing(overlay, overlayPalette)) return false;
    const image = this.output.image;
    overlay.current.Allocate();
    CreateOverlayTable(this.overlayTable, viewportPalette, true, overlay, overlayPalette);
    UpdateViewportArea(image.data, this.screen.pixels, this.overlayTable, overlay, true,
      (n) => die(host, n, `You have encountered code at relative address 0x${n.toString(16).padStart(6, '0')} that I thought was unused.`), x0);
    if (this.ui.objectCursorFootprint) {
      reconvertThroughPalette(image, this.screen, this.ui.objectCursorFootprint, 12, this.uiPalette);
    }
    return true;
  }

  /**
   * `d.Palette11946` if `d.DynamicPaletteSwitching` is on, a copy, or `null`: on while the
   * dungeon view is shown, off while an inventory is open (`present`).
   */
  palette11946(): number[] | null {
    if (this.ui.partyState.selectedCharacterIndex >= 0) return null;
    return this.getViewportPalette()?.slice() ?? null;
  }

  /** `d.Palette552[d.CurrentPalette]`, as the VBL handler loads it (`doc/CSBwin-src/CSBCode.cpp:1021-1024`). */
  private getViewportPalette(): number[] | null {
    const palettes = this.viewport.viewportPalettes;
    if (!palettes || palettes.length === 0) return null;
    return palettes[this.ui.ctx.state.currentPalette] ?? null;
  }

  /**
   * The last frame composed again: the pre-game screen's, while one is up
   * (`setBootFrameRenderer`), else the adventure's, once there is one and the Hint Oracle
   * does not hold the screen. The interface's `renderLastFrame`.
   */
  renderLastFrame(): void {
    if (this.renderBootFrame()) return;
    this.renderAdventureFrame();
  }

  /** The pre-game screen's frame composed again, if one is up (`setBootFrameRenderer`). Says whether it was. */
  renderBootFrame(): boolean {
    if (!this.bootFrameRenderer) return false;
    this.bootFrameRenderer();
    return true;
  }

  /** The adventure's frame composed again, once there is one and the Hint Oracle does not hold the screen. */
  renderAdventureFrame(): void {
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

  /** The screen buffer shown through an explicit palette: a pre-game screen's frame. */
  presentScreen(palette: number[], palette11946: number[] | null = null): void {
    const image = this.output.image;
    if (palette11946) {
      updateImageDataFromIndexWithViewportPalette(image, this.screen, VIEWPORT_SPAN, palette11946, palette);
    } else {
      updateImageDataFromIndex(image, this.screen, palette);
    }
    this.presented.record(this.screen.pixels, palette, palette11946 ? { palette: palette11946, span: VIEWPORT_SPAN } : null, null, null, 12);
    this.output.show(false);
    this.shownLeftHanded = null;
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
}
