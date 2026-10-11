/**
 * The game's input path: where a pointer event or a key goes once the page has read it.
 *
 * The page's listeners (`src/ui/events.ts`) hand over a screen point and a button, or a
 * key press, and nothing else of the DOM. From here a click is the dialog's
 * (`src/renderer/ui/Dialog.ts`), a modal screen's, or a button searched in the
 * interface's lists and queued on the game's one mouse queue; a key is the dialog's, a
 * modal screen's, a key table's button queued the same way (`TAG0196da`), a panel key
 * (`handleUIKey`), or one of the port's own keys
 * (`portKeyAction`). Esc and a double click on the message area open the settings
 * (`src/renderer/ui/SettingsDialog.ts`). The queued buttons come back through `Game.handleMouseEvents` in
 * their turn, and `install` hands them to the interface's dispatcher, `handleMouseButton`.
 */
import type { Game } from '../engine/Game';
import type { GameScreen } from './GameScreen';
import { MESSAGE_AREA } from './csbwin/ScrollingText';
import { portKeyAction } from './ui/Keyboard';
import { nowMs } from './ui/UIState';

/** How soon after a click on the message area a second one opens the settings, in milliseconds. */
export const MESSAGE_DOUBLE_CLICK_MS = 500;

/** What the input path asks of the page. */
export interface GameInputHost {
  readonly game: Game;
  readonly screen: GameScreen;
  /**
   * Compose the screen again after an input that changed it. Never a `DrawViewport`: the
   * view is the tick's, and an input that changes it brings the tick on (`d.clockTick = 1`).
   */
  refreshScreen(): void;
  onQuickSave(): void;
  onQuickLoad(): void;
}

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
}

export class GameInput {
  /** A click of the dialog's has its button held: the moves are its drag, until the release. */
  private dragging = false;
  /** When the last click on the message area that hit no button came, or `null`. */
  private messageClickMs: number | null = null;

  constructor(private readonly host: GameInputHost) {}

  /**
   * Once `MainLoop` has returned, `_ShowCredits` has emptied every button list and key
   * table (`doc/CSBwin-src/Code1f9e6.cpp:116-121`) and owns the screen: the adventure's
   * handlers neither act nor draw.
   */
  private ended(): boolean {
    return this.host.game.mainLoopHasReturned();
  }

  /**
   * The Hint Oracle is up: it reads the canvas through a host of its own
   * (`runHintOracle`, `src/renderer/intro/BootSequence.ts`), and the adventure's handlers
   * neither act nor draw until it closes.
   */
  private oracleUp(): boolean {
    return this.host.screen.isHintOracleUp();
  }

  /** Hand the game the interface's dispatcher for the buttons it does not handle itself. */
  install(): void {
    const host = this.host;
    host.game.setMouseEventHandlers({
      translate: (x, y, buttons) => host.screen.searchMouseButtons(x, y, buttons),
      button: (num, x, y) => {
        host.screen.handleMouseButton(num, x, y);
        host.refreshScreen();
      },
      unclick: () => {
        host.screen.handleMouseUnclick();
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
  mouseMove(x: number, y: number): void {
    if (this.ended() || this.oracleUp()) return;
    this.host.screen.setHoverPoint({ x, y });
    if (this.dragging) this.host.screen.handleDialogDrag(x, y);
  }

  /** A button pressed: `button` is `MouseEvent.button`'s number. */
  mouseDown(x: number, y: number, button: number): void {
    if (this.ended() || this.oracleUp()) return;
    const { game, screen } = this.host;
    const buttonMask = button === 2 ? 1 : button === 0 ? 2 : 0;
    // A dialog is modal, the way `_WaitForMenuSelect` is modal: it replaces every
    // button list while it runs, so nothing else may see the click
    // (`doc/CSBWIN_MENU_REFERENCE.md`).
    if (buttonMask !== 0 && screen.isDialogOpen()) {
      this.dragging = true;
      screen.handleDialogClick(x, y, buttonMask);
      this.host.refreshScreen();
      return;
    }
    if (buttonMask === 0) return;
    if (screen.isReincarnateScreenOpen()) {
      screen.handleReincarnateClick(x, y);
      this.host.refreshScreen();
      return;
    }
    if (buttonMask === 2 && this.messageAreaDoubleClick(x, y)) {
      screen.openSettings();
      this.host.refreshScreen();
      return;
    }
    // Queued, not handled: `Game.handleMouseEvents` takes it off the queue in its turn,
    // behind any key or click already waiting, matches it to the button the screen has
    // there then, and hands it to `handleMouseButton`.
    game.onMouseClick(x, y, buttonMask);
  }

  /**
   * Whether a left click on the message area is the second of a double click there, the
   * settings' gesture. A click counts only where it hits no button of the lists in force
   * (`searchMouseButtons`), so the first is nothing to the game, and is queued as any
   * click is, and the gesture holds back no click. Only two things take a left click
   * there (`tools/dump-settings-dialog.ts`): the freeze, on the pixel x 0, y 198 of
   * `Buttons17196`, and frozen, the thaw, `Buttons17832`'s whole screen. So a frozen
   * game's first click thaws it, as CSBWin's does, and opens nothing.
   */
  private messageAreaDoubleClick(x: number, y: number): boolean {
    const inArea = x >= MESSAGE_AREA.x1 && x < MESSAGE_AREA.x2 + 1 && y >= MESSAGE_AREA.y1 && y < MESSAGE_AREA.y2 + 1;
    if (!inArea || this.host.screen.searchMouseButtons(x, y, 2) !== 0) {
      this.messageClickMs = null;
      return false;
    }
    const now = nowMs();
    const second = this.messageClickMs !== null && now - this.messageClickMs <= MESSAGE_DOUBLE_CLICK_MS;
    this.messageClickMs = second ? null : now;
    return second;
  }

  mouseUp(): void {
    const dragged = this.dragging;
    this.dragging = false;
    if (this.ended() || this.oracleUp()) return;
    if (this.host.screen.isDialogOpen()) {
      if (dragged) this.host.screen.handleDialogRelease();
      return;
    }
    this.host.game.onMouseUnClick();
  }

  /** The wheel, which only a dialog takes. Says whether it took it. */
  wheel(deltaY: number): boolean {
    if (this.ended() || !this.host.screen.isDialogOpen()) return false;
    this.host.screen.handleDialogWheel(deltaY);
    return true;
  }

  /** The pointer gone from the canvas: no cursor, from the next VBL's frame, as a move's. */
  mouseLeave(): void {
    if (this.ended() || this.oracleUp()) return;
    this.host.screen.setHoverPoint(null);
  }

  /** A key pressed. Says whether the game took it. */
  keyDown(press: KeyPress): boolean {
    const { game, screen } = this.host;
    const { key, code } = press;
    // `_ShowCredits` has emptied `d.pKeyXlate1` and `d.pKeyXlate2`
    // (`doc/CSBwin-src/Code1f9e6.cpp:120-121`): no key is the adventure's any more.
    if (this.ended()) return false;
    const modified = press.ctrlKey || press.metaKey || press.altKey;
    // The Oracle takes no key (`doc/CSBWIN_HINT_ORACLE_REFERENCE.md` → "Waiting for a
    // button"), and the adventure gets none while it is up; a browser shortcut keeps its.
    if (this.oracleUp()) return !modified;
    // The Reincarnate name-entry screen is modal on the keyboard as well as
    // the mouse (`keyboardMode = 2`, `doc/CSBwin-src/Code13ea4.cpp:38`): while
    // it is up every key is a letter being typed, so none of the panel, movement
    // or debug keys below may see one. 'Q' would otherwise open an attack menu
    // while the player named their champion.
    // A dialog takes the keyboard whole, for the reason the Reincarnate screen
    // does: 'S' would otherwise open an attack menu while the player scrolled the
    // save menu's list.
    if (screen.isDialogOpen()) {
      if (modified) return false;
      screen.handleDialogKey(key);
      this.host.refreshScreen();
      return true;
    }
    if (screen.isReincarnateScreenOpen()) {
      if (modified) return false;
      screen.handleReincarnateKey(key);
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
      screen.openSettings();
      this.host.refreshScreen();
      return true;
    }
    // The key tables first, `TAG0196da` (doc/CSBwin-src/CSBCode.cpp:8515), for a key
    // bound to a keyscan, a move, the freeze or the waking (`keyScanOf`): awake,
    // `Byte18400` and `Byte18428` bind Esc, Insert, Clr/Home and the arrows; asleep
    // `Byte18440` binds Return and Esc, and frozen `Byte18448` Esc alone
    // (doc/CSBwin-src/Mouse.cpp:1839-1840, :1893-1894). A bound key is queued as its
    // button, like a click.
    const button = screen.translateKey(code);
    if (button !== 0) {
      game.enqueueKeyButton(button);
      return true;
    }
    // Asleep or frozen, every key the table does not bind is dead, the panel keys
    // included.
    if (game.isPartySleeping() || game.isFrozen()) return true;
    // Then the panel keys, which claim theirs whatever the game state, and F5 and F9.
    if (screen.handleUIKey(code)) {
      this.host.refreshScreen();
      return true;
    }
    const action = portKeyAction(code);
    if (action === null) return false;
    if (action === 'quickSave') this.host.onQuickSave();
    else this.host.onQuickLoad();
    return true;
  }
}
