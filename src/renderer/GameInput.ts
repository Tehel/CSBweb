/**
 * The game's input path: where a pointer event or a key goes once the page has read it.
 *
 * The page's listeners (`src/ui/events.ts`) hand over a point of the canvas and a button,
 * or a key press, and nothing else of the DOM. While an owner holds the input (`take`) it
 * has all of it: a pre-game screen's host while it has the canvas
 * (`src/renderer/intro/BootSequence.ts`), the title and the entrance, the credits and the
 * Hint Oracle, or nobody while the page loads (`NO_INPUT`). Otherwise it is the
 * adventure's. The point is made CSBWin's screen's first,
 * which it is but on the left-handed screen (`GameScreen.screenPoint`). From here a click is the dialog's
 * (`src/renderer/ui/Dialog.ts`), a modal screen's, or a button searched in the
 * interface's lists and queued on the game's one mouse queue; a key is the dialog's, a
 * modal screen's, a key table's button queued the same way (`TAG0196da`), a panel key
 * (`panelKey`), or one of the port's own keys
 * (`portKeyAction`). Esc and a double click on the message area open the settings
 * (`src/renderer/ui/SettingsDialog.ts`); the MAP key and a long press there, the map
 * (`src/renderer/ui/MapDialog.ts`); the CHAMPIONS key and a long press on a champion's
 * stat bars, the champions (`src/renderer/ui/ChampionDialog.ts`). The queued buttons come back through `Game.handleMouseEvents` in
 * their turn, and `install` hands them to the interface's dispatcher, `handleMouseButton`.
 *
 * What changes the game goes through its input boundary (`Game.input`, `InputBoundary`):
 * a click and a key queued, and the Reincarnate screen's and the panel keys, which
 * `install` gives it to apply. A dialog's own clicks and keys are the page's; what they
 * change of the game takes the boundary's other doors (the clock, a save, a setting).
 */
import type { Game } from '../engine/Game';
import type { GameScreen } from './GameScreen';
import { MESSAGE_AREA } from './csbwin/ScrollingText';
import { keyAction, panelKey, panelKeyAction, portKeyAction, tableKeyButton } from './ui/Keyboard';
import { handleMouseUnclick, searchMouseButtons } from './ui/Mouse';
import { isReincarnateScreenOpen, reincarnateClick, reincarnateKey } from './ui/ReIncarnate';
import { BARS_LONG_PRESS_MS, MESSAGE_DOUBLE_CLICK_MS, MESSAGE_LONG_PRESS_MS, isDialogOpen } from './ui/Dialog';
import { openSettingsDialog } from './ui/SettingsDialog';
import { openMapDialog } from './ui/MapDialog';
import { championBarsAt, openChampionDialog } from './ui/ChampionDialog';
import { nowMs, type UIState } from './ui/UIState';

/**
 * What the input path asks of the screen: its interface's state, which the input acts on
 * through the `ui/` modules, and what the screen keeps of its own, the pointer's place,
 * the deferred flags of a button handled and the wheel's change to a dialog.
 */
export type InputScreen = Pick<GameScreen, 'ui' | 'screenPoint' | 'setHoverPoint' | 'handleMouseButton' | 'handleDialogWheel'>;

/** What the input path asks of the page. */
export interface GameInputHost {
  readonly game: Game;
  readonly screen: InputScreen;
  /**
   * Compose the screen again after an input that changed it. Never a `DrawViewport`: the
   * view is the tick's, and an input that changes it brings the tick on (`d.clockTick = 1`).
   */
  refreshScreen(): void;
  onQuickSave(): void;
  onQuickLoad(): void;
  /**
   * The page's `?dev`: the move down and up keys take the party a level down (1) or up
   * (-1) whatever is there (`Game.devChangeLevel`), in any dungeon. Absent, they are the
   * 3D movement's, in a dungeon that sets it (`translateKey`).
   */
  onDevLevel?: ((delta: 1 | -1) => void) | null;
}

/**
 * What holds the input whole while it has it (`GameInput.take`): every event is its own,
 * and none the adventure's. Its points are the canvas's, as the page reads them, never
 * moved for the left-handed screen, which only play has.
 */
export interface InputOwner {
  mouseMove(canvasX: number, canvasY: number): void;
  /** A button pressed: `button` is `MouseEvent.button`'s number. */
  mouseDown(canvasX: number, canvasY: number, button: number): void;
  mouseUp(): void;
  mouseLeave(): void;
  /** Says whether it took the wheel. */
  wheel(deltaY: number): boolean;
  /** Says whether it took the key, the browser then doing nothing with it. */
  keyDown(press: KeyPress): boolean;
}

/** The owner that takes nothing: the page's while it loads, before the boot's screens or play have the canvas. */
export const NO_INPUT: InputOwner = {
  mouseMove: () => {},
  mouseDown: () => {},
  mouseUp: () => {},
  mouseLeave: () => {},
  wheel: () => false,
  keyDown: () => false,
};

/**
 * A key pressed, as a `KeyboardEvent` has it: `key` is the character it types, which the
 * text screens read, and `code` the physical key, which every binding matches
 * (`src/renderer/ui/Keyboard.ts`).
 */
export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** The key held down, repeating. */
  repeat?: boolean;
}

export class GameInput {
  /** A click of the dialog's has its button held: the moves are its drag, until the release. */
  private dragging = false;
  /** When the last click on the message area that hit no button came, or `null`. */
  private messageClickMs: number | null = null;
  /** The long press on the message area under way: its timer, or `null`. */
  private messagePress: ReturnType<typeof setTimeout> | null = null;
  /** The press on a champion's stat bars held back (`holdBarsPress`), or `null`. */
  private barsPress: { x: number; y: number; chIdx: number; timer: ReturnType<typeof setTimeout> } | null = null;
  /** What holds the input whole (`take`), or `null`: the adventure has it. */
  private owner: InputOwner | null = null;

  constructor(private readonly host: GameInputHost) {}

  /**
   * Give `owner` every event until the returned release, which gives the input back to
   * whoever had it before: the page takes it first while it loads, and a pre-game screen
   * over that, or over play.
   */
  take(owner: InputOwner): () => void {
    const previous = this.owner;
    this.owner = owner;
    return () => {
      this.owner = previous;
    };
  }

  private get ui(): UIState {
    return this.host.screen.ui;
  }

  /**
   * Once `MainLoop` has returned, `_ShowCredits` has emptied every button list and key
   * table (`doc/CSBwin-src/Code1f9e6.cpp:116-121`) and owns the screen: the adventure's
   * handlers neither act nor draw. Nor once an error has ended the game (`Game.die`):
   * F5 and F9 are the browser's again, a reload.
   */
  private ended(): boolean {
    return this.host.game.mainLoopHasReturned() || this.host.game.isDead();
  }

  /**
   * The Hint Oracle is up: it reads the canvas through a host of its own, which holds the
   * input (`runHintOracle`, `src/renderer/intro/BootSequence.ts`), and the adventure's
   * handlers neither act nor draw until it closes, its held presses' timers included.
   */
  private oracleUp(): boolean {
    return this.ui.hintOracleUp;
  }

  /**
   * Hand the game the interface's dispatcher for the buttons it does not handle itself,
   * and its input boundary what the interface applies of the page's changes.
   */
  install(): void {
    const host = this.host;
    host.game.input.setScreen({
      panelKey: (action) => panelKey(this.ui, action),
      reincarnateKey: (key) => { reincarnateKey(this.ui, key); },
      reincarnateClick: (x, y) => { reincarnateClick(this.ui, x, y); },
    });
    host.game.setMouseEventHandlers({
      translate: (x, y, buttons) => searchMouseButtons(this.ui, x, y, buttons),
      button: (num, x, y) => {
        host.screen.handleMouseButton(num, x, y);
        host.refreshScreen();
      },
      unclick: () => {
        handleMouseUnclick(this.ui);
        host.refreshScreen();
      },
    });
  }

  /**
   * The pointer's place, and no redraw: CSBWin's `checkVBL` notes where the mouse is
   * (`doc/CSBwin-src/system.cpp:596-616`) and its VBL handler draws the cursor, so the
   * page's frame paints it (`GameScreen.takeCursorMoved`). A mouse reports its moves
   * faster than the screen is composed, and a redraw for each leaves the browser no time
   * to show any.
   */
  mouseMove(canvasX: number, canvasY: number): void {
    if (this.owner) {
      this.owner.mouseMove(canvasX, canvasY);
      return;
    }
    if (this.ended() || this.oracleUp()) return;
    const { x, y } = this.host.screen.screenPoint(canvasX, canvasY);
    this.host.screen.setHoverPoint({ x, y });
    if (this.dragging) this.ui.dialog?.drag?.(this.ui, x, y);
    if (this.messagePress !== null && !inMessageArea(x, y)) this.releaseMessagePress();
    if (this.barsPress !== null && championBarsAt(this.ui, x, y) !== this.barsPress.chIdx) this.queueBarsPress();
  }

  /**
   * A button pressed: `button` is `MouseEvent.button`'s number. `touch`, a finger's or a
   * stylus's, is first seen as it presses, so in play the press puts the cursor where it is.
   */
  mouseDown(canvasX: number, canvasY: number, button: number, touch = false): void {
    if (this.owner) {
      this.owner.mouseDown(canvasX, canvasY, button);
      return;
    }
    if (touch) this.mouseMove(canvasX, canvasY);
    if (this.ended() || this.oracleUp()) return;
    const { x, y } = this.host.screen.screenPoint(canvasX, canvasY);
    const { game } = this.host;
    const ui = this.ui;
    const buttonMask = button === 2 ? 1 : button === 0 ? 2 : 0;
    // A dialog is modal, the way `_WaitForMenuSelect` is modal: it replaces every
    // button list while it runs, so nothing else may see the click
    // (`doc/CSBWIN_MENU_REFERENCE.md`).
    if (buttonMask !== 0 && isDialogOpen(ui)) {
      this.dragging = true;
      ui.dialog?.click(ui, x, y, buttonMask);
      this.host.refreshScreen();
      return;
    }
    if (buttonMask === 0) return;
    // The Reincarnate name-entry screen reads the mouse itself and does its own geometry
    // (`doc/CSBwin-src/Code13ea4.cpp:118-224`): it never consults a button list, and while
    // it is up nothing else may act on a click.
    if (isReincarnateScreenOpen(ui)) {
      game.input.apply({ kind: 'reincarnateClick', x, y });
      this.host.refreshScreen();
      return;
    }
    if (buttonMask === 2) {
      const chIdx = championBarsAt(ui, x, y);
      if (chIdx >= 0) {
        this.messageClickMs = null;
        this.holdBarsPress(x, y, chIdx);
        return;
      }
      const free = this.messageAreaFree(x, y);
      if (this.messageAreaDoubleClick(free)) {
        openSettingsDialog(ui);
        this.host.refreshScreen();
        return;
      }
      if (free) this.holdMessagePress();
    }
    // Queued, not handled: `Game.handleMouseEvents` takes it off the queue in its turn,
    // behind any key or click already waiting, matches it to the button the screen has
    // there then, and hands it to `handleMouseButton`.
    game.onMouseClick(x, y, buttonMask);
  }

  /**
   * Whether a left click at `(x, y)` is on the message area and hits no button of the
   * lists in force (`searchMouseButtons`): what the settings' double click and the map's
   * long press count. Such a click is nothing to the game, and is queued as any click is,
   * so neither gesture holds a click back. Only two things take a left click there
   * (`tools/checks/settings-dialog.ts`): the freeze, on the pixel x 0, y 198 of
   * `Buttons17196`, and frozen, the thaw, `Buttons17832`'s whole screen. So a frozen
   * game's first click thaws it, as CSBWin's does, and opens nothing.
   */
  private messageAreaFree(x: number, y: number): boolean {
    return inMessageArea(x, y) && searchMouseButtons(this.ui, x, y, 2) === 0;
  }

  /** Whether a free left click on the message area (`free`) is the second of a double click there. */
  private messageAreaDoubleClick(free: boolean): boolean {
    if (!free) {
      this.messageClickMs = null;
      return false;
    }
    const now = nowMs();
    const second = this.messageClickMs !== null && now - this.messageClickMs <= MESSAGE_DOUBLE_CLICK_MS;
    this.messageClickMs = second ? null : now;
    return second;
  }

  /**
   * A free press on the message area: held `MESSAGE_LONG_PRESS_MS`, on the area, it opens
   * the map, where MAP VIEW is on. The press was queued as a click; its release is queued
   * then, as the dialog takes the real one.
   */
  private holdMessagePress(): void {
    this.releaseMessagePress();
    this.messagePress = setTimeout(() => {
      this.messagePress = null;
      if (this.ended() || this.oracleUp() || !openMapDialog(this.ui)) return;
      this.messageClickMs = null;
      this.host.game.onMouseUnClick();
      this.host.refreshScreen();
    }, MESSAGE_LONG_PRESS_MS);
  }

  private releaseMessagePress(): void {
    if (this.messagePress === null) return;
    clearTimeout(this.messagePress);
    this.messagePress = null;
  }

  /**
   * A left press on a champion's stat bars, with CHAMPION VIEW on, is held back, as the
   * long press there is the champions'. Held `BARS_LONG_PRESS_MS`, it opens the champion
   * dialog with that champion's column marked, and is nothing to the game. Released
   * before, moved off the bars or with the pointer gone, it was a click, and is queued
   * then (`queueBarsPress`): the inventory it opens opens late by as long as it was held.
   */
  private holdBarsPress(x: number, y: number, chIdx: number): void {
    this.queueBarsPress();
    const timer = setTimeout(() => {
      this.barsPress = null;
      if (this.ended() || this.oracleUp()) return;
      if (openChampionDialog(this.ui, chIdx)) this.host.refreshScreen();
      else if (!isDialogOpen(this.ui)) this.host.game.onMouseClick(x, y, 2);
    }, BARS_LONG_PRESS_MS);
    this.barsPress = { x, y, chIdx, timer };
  }

  /** The press held back on the bars, a click after all: queued where it was pressed. */
  private queueBarsPress(): void {
    const press = this.barsPress;
    if (press === null) return;
    clearTimeout(press.timer);
    this.barsPress = null;
    if (!this.ended() && !this.oracleUp()) this.host.game.onMouseClick(press.x, press.y, 2);
  }

  mouseUp(): void {
    const dragged = this.dragging;
    this.dragging = false;
    this.releaseMessagePress();
    this.queueBarsPress();
    if (this.owner) {
      this.owner.mouseUp();
      return;
    }
    if (this.ended() || this.oracleUp()) return;
    if (isDialogOpen(this.ui)) {
      if (dragged) this.ui.dialog?.release?.(this.ui);
      return;
    }
    this.host.game.onMouseUnClick();
  }

  /** The wheel, which only a dialog takes. Says whether it took it. */
  wheel(deltaY: number): boolean {
    if (this.owner) return this.owner.wheel(deltaY);
    if (this.ended() || !isDialogOpen(this.ui)) return false;
    this.host.screen.handleDialogWheel(deltaY);
    return true;
  }

  /** The pointer gone from the canvas: no cursor, from the next VBL's frame, as a move's. */
  mouseLeave(): void {
    this.releaseMessagePress();
    this.queueBarsPress();
    if (this.owner) {
      this.owner.mouseLeave();
      return;
    }
    if (this.ended() || this.oracleUp()) return;
    this.host.screen.setHoverPoint(null);
  }

  /** A key pressed. Says whether the game took it. */
  keyDown(press: KeyPress): boolean {
    if (this.owner) return this.owner.keyDown(press);
    const { game } = this.host;
    const { key, code } = press;
    // `_ShowCredits` has emptied `d.pKeyXlate1` and `d.pKeyXlate2`
    // (`doc/CSBwin-src/Code1f9e6.cpp:120-121`): no key is the adventure's any more.
    if (this.ended()) return false;
    const modified = press.ctrlKey || press.metaKey || press.altKey;
    // The Oracle takes no key (`doc/CSBWIN_HINT_ORACLE_REFERENCE.md` → "Waiting for a
    // button"), and the adventure gets none while it is up; a browser shortcut keeps its.
    if (this.oracleUp()) return !modified;
    const ui = this.ui;
    // Esc held down opens and closes nothing: in fullscreen, where the page locks it, it
    // is how the player leaves (`src/lib/fullscreen.ts`).
    if (code === 'Escape' && press.repeat === true) return !modified;
    // The Reincarnate name-entry screen is modal on the keyboard as well as
    // the mouse (`keyboardMode = 2`, `doc/CSBwin-src/Code13ea4.cpp:38`): while
    // it is up every key is a letter being typed, so none of the panel, movement
    // or debug keys below may see one. 'Q' would otherwise open an attack menu
    // while the player named their champion.
    // A dialog takes the keyboard whole, for the reason the Reincarnate screen
    // does: 'S' would otherwise open an attack menu while the player scrolled the
    // save menu's list.
    if (isDialogOpen(ui)) {
      if (modified) return false;
      ui.dialog?.key(ui, key, code);
      this.host.refreshScreen();
      return true;
    }
    if (isReincarnateScreenOpen(ui)) {
      if (modified) return false;
      game.input.apply({ kind: 'reincarnateKey', key });
      this.host.refreshScreen();
      return true;
    }
    // A browser or OS shortcut keeps its key: no key is bound with a modifier, so
    // Ctrl-R still reloads rather than opening a rune keypad. That leaves out
    // `Byte18400`'s Ctrl-S, as CSBWin's shipped `config.txt` does (`keyScanOf`).
    if (modified) return false;
    // Esc is the settings', in play, asleep and frozen too: the freeze CSBWin's tables
    // bind it to is Pause's (`DEFAULT_KEY_BINDINGS`, `DEBT.md` H).
    if (code === 'Escape') {
      openSettingsDialog(ui);
      this.host.refreshScreen();
      return true;
    }
    // `?dev`'s move down and up, before the tables, awake (`GameInputHost.onDevLevel`).
    const vertical = keyAction(code);
    if (this.host.onDevLevel && (vertical === 'move.down' || vertical === 'move.up') &&
      !game.isPartySleeping() && !game.isFrozen()) {
      this.host.onDevLevel(vertical === 'move.down' ? 1 : -1);
      return true;
    }
    // The key tables first, `TAG0196da` (doc/CSBwin-src/CSBCode.cpp:8515), for a key
    // bound to a keyscan, a move, the freeze or the waking (`keyScanOf`): awake,
    // `Byte18400` and `Byte18428` bind Esc, Insert, Clr/Home and the arrows; asleep
    // `Byte18440` binds Return and Esc, and frozen `Byte18448` Esc alone
    // (doc/CSBwin-src/Mouse.cpp:1839-1840, :1893-1894). A bound key is queued as its
    // button, like a click.
    // F1-F4, the port's caster keys, are 0 there (`tableKeyButton`).
    const button = tableKeyButton(ui, code);
    if (button !== 0) {
      game.enqueueKeyButton(button);
      return true;
    }
    // Asleep or frozen, every key the table does not bind is dead, the panel keys
    // included.
    if (game.isPartySleeping() || game.isFrozen()) return true;
    // Then the panel keys, which claim theirs whatever the game state, and F5 and F9.
    const panel = panelKeyAction(code);
    if (panel !== null) {
      game.input.apply({ kind: 'panelKey', action: panel });
      this.host.refreshScreen();
      return true;
    }
    const action = portKeyAction(code);
    if (action === null) return false;
    if (action === 'quickSave') {
      this.host.onQuickSave();
    } else if (action === 'quickLoad') {
      this.host.onQuickLoad();
    } else if (action === 'map' ? openMapDialog(ui) : openChampionDialog(ui)) {
      this.host.refreshScreen();
    }
    return true;
  }
}

function inMessageArea(x: number, y: number): boolean {
  return x >= MESSAGE_AREA.x1 && x < MESSAGE_AREA.x2 + 1 && y >= MESSAGE_AREA.y1 && y < MESSAGE_AREA.y2 + 1;
}
