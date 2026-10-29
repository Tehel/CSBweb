/**
 * The 320x200 screen on the page's canvas, and the DM interface on it.
 *
 * Its `ScreenComposer` holds the interface's state (`ui/UIState.ts`) and composes each
 * frame, the viewport that `ViewportRenderer` draws with every panel around it, into an
 * RGBA image; the screen puts that image on the canvas. The input acts on that state
 * through the `ui/` modules (`GameInput`); what the screen keeps of its own is the
 * pointer's place, the flags a button handled raises for after it, the Hint Oracle's
 * opening and closing, and the viewport's drawing.
 *
 * What the interface asks of the engine comes in whole at construction, as
 * `ScreenHooks`, the way `GameHost` gathers what the engine asks of the page.
 */

import type { IndexedBitmap } from './csbwin/CanvasBlitter';
import { SCREEN_WIDTH, SCREEN_HEIGHT } from './ViewportGraphics';
import { Position } from '../core/types';
import type { ViewportRenderer } from './ViewportRenderer';
import { ScreenComposer, type ScreenComposerDeps, type ScreenHooks } from './ScreenComposer';
import type { Presenter } from './Presenter';
import { initializePlayState, UIMode, type UIState } from './ui/UIState';
import {
  marchingOrderPointerMoved,
  handleMouseButton,
  closeHintOracle,
  openHintOracle,
  stopForHintOracle,
  syncInventoryButtons,
  setUIMode,
  updateButtonLists,
} from './ui/Mouse';
import { openSaveMenu } from './ui/SaveMenu';
import type { DialogPoint } from './ui/Dialog';

export class GameScreen {
  /**
   * Everything the UI modules share. See `ui/UIState.ts`. The engine's host draws on it
   * (`ui/HostDrawing.ts`).
   */
  readonly ui: UIState;
  /** The frames composed, which the pre-game screens draw through too (`BootSequence.ts`). */
  readonly composer: ScreenComposer;
  private readonly viewport: ViewportRenderer;
  /** The pointer has moved since the cursor was last drawn (`takeCursorMoved`). */
  private cursorMoved = false;
  /** The wheel has changed the dialog since it was last drawn (`takeWheelTurned`). */
  private wheelTurned = false;

  /**
   * `presenter` is the page's animation clock, which the interface's animations run on
   * (`ScreenHooks.animate`), and the pre-game screens' VBLs. `presented` is told of every
   * frame put on the canvas, once it is (the CRT effect's, `src/lib/crt.ts`).
   */
  constructor(
    canvas: HTMLCanvasElement,
    deps: ScreenComposerDeps,
    hooks: Omit<ScreenHooks, 'animate'>,
    readonly presenter: Presenter,
    presented: () => void,
  ) {
    const screenCtx = canvas.getContext('2d');
    if (!screenCtx) throw new Error('Failed to create screen 2D context');
    const image = screenCtx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
    this.composer = new ScreenComposer({
      image,
      show: (withCursor) => {
        if (withCursor) this.cursorMoved = false;
        screenCtx.putImageData(image, 0, 0);
        presented();
      },
    }, deps, { ...hooks, animate: (step) => presenter.animate(step) });
    this.viewport = this.composer.viewport;
    this.ui = this.composer.ui;
    updateButtonLists(this.ui);
  }

  /**
   * The point of CSBWin's screen a point of the canvas shows: itself, but on the
   * left-handed screen, whose regions it moves back (`ScreenComposer.screenPoint`). The page hands
   * every pointer event's point through it, so the interface only ever sees CSBWin's.
   */
  screenPoint(x: number, y: number): { x: number; y: number } {
    return this.composer.screenPoint(x, y);
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
      if (this.ui.ctx.systems.mainLoop.input.playing) stopForHintOracle(this.ui);
      else this.openHintOracle();
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
    this.composer.presentViewport();
    this.ui.onOpenHintOracle(square);
  }

  /** The Oracle closed: `TAG0207cc`, and the inventory drawn again in the interface's palette. */
  closeHintOracle(): void {
    closeHintOracle(this.ui);
    this.composer.presentViewport();
  }

  /** The wheel, while a dialog is up. Nothing is drawn here: the VBL's frame draws what it changed (`takeWheelTurned`). */
  handleDialogWheel(deltaY: number): void {
    if (this.ui.dialog?.wheel(this.ui, deltaY)) this.wheelTurned = true;
  }

  /** Before a compose: the game's party, which may be another game's since the last. */
  syncParty(): void {
    // Another party is another game, loaded or begun, which CSBWin draws afresh: nothing
    // `TAG02076e` shaded survives it (a quick-load over a sleeping party, which no
    // `TAG0207cc` follows).
    // Nor does a champion in hand (`d.Word23144 = 0`, `doc/CSBwin-src/CSBCode.cpp:10609`).
    const generation = this.ui.ctx.party.generation;
    if (generation !== this.ui.partyGeneration) {
      this.ui.shadedByTag02076e = false;
      this.ui.arrowCursorShape = false;
      this.ui.word23144 = 0;
    }
    this.ui.partyGeneration = generation;
    syncInventoryButtons(this.ui);
  }

  /**
   * Where the pointer is, `d.CurMouseX` and `d.CurMouseY`. Nothing is drawn from here:
   * the cursor is the VBL's to draw (`takeCursorMoved`).
   */
  setHoverPoint(point: { x: number; y: number } | null): void {
    const at = this.ui.hoverPoint;
    if (point?.x !== at?.x || point?.y !== at?.y) this.cursorMoved = true;
    this.ui.hoverPoint = point;
    this.ui.dialog?.pointer(this.ui, point);
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

  /** Whether the wheel has changed the dialog since it was last drawn: a redraw is due. */
  takeWheelTurned(): boolean {
    const turned = this.wheelTurned;
    this.wheelTurned = false;
    return turned;
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
    this.composer.presentViewport();
  }

  setUIMode(mode: UIMode): void {
    setUIMode(this.ui, mode);
  }

  /**
   * A game set up again after a lost one (`doc/CSBwin-src/Code1f9e6.cpp:309-318`): the
   * screen's state as a new game has it, and the adventure's button lists and key tables,
   * with no animation of the lost game left to draw.
   */
  initializePlayState(): void {
    // `Cleanup(false)`'s `backgroundLib.Cleanup` and `CleanupAltMonCache`, before the game
    // that follows a lost one (`doc/CSBwin-src/Code1f9e6.cpp:302`, `Graphics.cpp:2230-2232`).
    // The first game starts with the screen's own, empty.
    this.viewport.context.backgroundLib.Cleanup();
    this.viewport.context.altMonCache.CleanupAltMonCache();
    this.presenter.cancel();
    initializePlayState(this.ui);
    this.setUIMode(UIMode.Adventure);
  }

  /**
   * An animation's frame (`Presenter.animate`): the pre-game screen's while one is up,
   * else the adventure's through `refreshScreen`'s guards, while `MainLoop` runs and over
   * the game's party.
   */
  animationFrame(mainLoopHasReturned: boolean): void {
    if (this.composer.renderBootFrame() || mainLoopHasReturned) return;
    this.syncParty();
    this.composer.renderAdventureFrame();
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
    this.ui.picking = this.viewport.draw(position, facing, this.seeThroughWalls(), word1868);
    this.composer.viewportWasDrawn();
    if (!this.ui.hintOracleUp) this.composer.presentViewport();
  }

  /** `d.SeeThruWalls`, as `ViewportRenderer.draw` reads it. */
  private seeThroughWalls(): boolean {
    return this.ui.partyState.seeThruWalls !== 0;
  }

  /* ------------------------------------------------ the pre-game screens ---- */

  /** The entrance's view through the doorway: `ViewportRenderer.renderPrisonInterior`. */
  renderPrisonInterior(): IndexedBitmap {
    const { view, picking } = this.viewport.renderPrisonInterior(this.seeThroughWalls());
    this.ui.picking = picking;
    return view;
  }

  /**
   * The pointer over a pre-game screen's dialog, or off the canvas: the dialog is drawn
   * again, and presented, when that changes it (the chooser's import hint,
   * `saveMenuPointer`). Says whether it was.
   */
  moveDialogPointer(point: DialogPoint): boolean {
    if (!this.ui.dialog?.pointer(this.ui, point)) return false;
    this.composer.renderLastFrame();
    return true;
  }
}
