/**
 * The 320x200 screen on the page's canvas, and the DM interface on it.
 *
 * Its `ScreenComposer` holds the interface's state (`ui/UIState.ts`) and composes each
 * frame, the viewport that `ViewportRenderer` draws with every panel around it, into an
 * RGBA image; the screen puts that image on the canvas. It hosts the two modal screens
 * (the save menu and Reincarnate). The page reaches the interface only through it: the
 * mouse and key entry points below, whose work is in the `ui/` modules.
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
  handleMouseUnclick,
  openHintOracle,
  searchMouseButtons,
  syncInventoryButtons,
  setUIMode,
  updateButtonLists,
} from './ui/Mouse';
import { handleUIKey, tableKeyButton } from './ui/Keyboard';
import {
  isReincarnateScreenOpen,
  openReincarnateScreen,
  reincarnateClick,
  reincarnateKey,
} from './ui/ReIncarnate';
import {
  askBeginAdventure,
  closeSaveMenu,
  isSaveMenuOpen,
  openSaveMenu,
  saveMenuDrop,
  saveMenuTakesDrops,
  type SaveMenuMode,
} from './ui/SaveMenu';
import { isDialogOpen, type DialogPoint } from './ui/Dialog';
import { openSettingsDialog } from './ui/SettingsDialog';
import { openMapDialog } from './ui/MapDialog';
import { championBarsAt, openChampionDialog } from './ui/ChampionDialog';
import type { SaveEntry } from '../data/saves';
import type { ImportedFile } from '../engine/GameSaves';

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

  /**
   * Offer a key to the interface's own bindings (`src/renderer/ui/Keyboard.ts`).
   * Returns whether it was claimed. The modal screens must be offered the key first.
   */
  handleUIKey(code: string): boolean {
    return handleUIKey(this.ui, code);
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
    this.composer.presentViewport();
    this.ui.onOpenHintOracle(square);
  }

  /** The Oracle closed: `TAG0207cc`, and the inventory drawn again in the interface's palette. */
  closeHintOracle(): void {
    closeHintOracle(this.ui);
    this.composer.presentViewport();
  }

  isHintOracleUp(): boolean {
    return this.ui.hintOracleUp;
  }

  /** The button-up, `0x0add` (`doc/CSBwin-src/Mouse.cpp:1662-1688`). */
  handleMouseUnclick(): void {
    handleMouseUnclick(this.ui);
  }

  /* The dialog over the game; the slot is `ui/Dialog.ts`. */

  isDialogOpen(): boolean {
    return isDialogOpen(this.ui);
  }

  /**
   * A click while a dialog is up, taken **straight from the DOM event** rather than
   * through the mouse queue. That is CSBWin's modality: `_WaitForMenuSelect` replaces
   * every button list while it runs.
   */
  handleDialogClick(x: number, y: number, buttons: number): void {
    this.ui.dialog?.click(this.ui, x, y, buttons);
  }

  handleDialogKey(key: string, code: string): void {
    this.ui.dialog?.key(this.ui, key, code);
  }

  /** The wheel, while a dialog is up. Nothing is drawn here: the VBL's frame draws what it changed (`takeWheelTurned`). */
  handleDialogWheel(deltaY: number): void {
    if (this.ui.dialog?.wheel(this.ui, deltaY)) this.wheelTurned = true;
  }

  /** The pointer moved with the button of the dialog's click held (`Dialog.drag`). */
  handleDialogDrag(x: number, y: number): void {
    this.ui.dialog?.drag?.(this.ui, x, y);
  }

  /** The button of the dialog's click released (`Dialog.release`). */
  handleDialogRelease(): void {
    this.ui.dialog?.release?.(this.ui);
  }

  /** The settings dialog (`ui/SettingsDialog.ts`): Esc, or a double click on the message area. */
  openSettings(): void {
    openSettingsDialog(this.ui);
  }

  /**
   * The map dialog (`ui/MapDialog.ts`): its key, or a long press on the message area. Says
   * whether it opened, which it does only with MAP VIEW on and no dialog up.
   */
  openMap(): boolean {
    return openMapDialog(this.ui);
  }

  /**
   * The champion dialog (`ui/ChampionDialog.ts`): its key, or a long press on a champion's
   * stat bars, which marks `marked`'s column. Says whether it opened, which it does only
   * with CHAMPION VIEW on and no dialog up.
   */
  openChampions(marked: number | null = null): boolean {
    return openChampionDialog(this.ui, marked);
  }

  /**
   * The champion whose stat bars a left press at `(x, y)` is on, where CHAMPION VIEW holds
   * it back for the long press that opens the champion dialog (`GameInput`). Else -1.
   */
  championBarsAt(x: number, y: number): number {
    return championBarsAt(this.ui, x, y);
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

  /** Whether a file dropped on the page now is the save screen's import: not in RISE's. */
  takesSaveDrops(): boolean {
    return saveMenuTakesDrops(this.ui);
  }

  /** A file dropped on the page while the save screen is up: its import. Says whether it was taken. */
  handleSaveMenuDrop(file: ImportedFile): boolean {
    return saveMenuDrop(this.ui, file);
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

  /**
   * `TAG0196da`'s table half: the button the current key tables bind `code`, a
   * `KeyboardEvent.code`, to, or 0 — and 0 for F1-F4, the port's caster keys
   * (`tableKeyButton`).
   */
  translateKey(code: string): number {
    return tableKeyButton(this.ui, code);
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
