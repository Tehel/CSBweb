/**
 * The game's input path: where a pointer event or a key goes once the page has read it.
 *
 * The page's listeners (`src/ui/events.ts`) hand over a screen point and a button, or a
 * `KeyboardEvent.key` and its modifiers, and nothing else of the DOM. From here a click is
 * a modal screen's, or a button searched in the interface's lists and queued on the
 * game's one mouse queue; a key is a modal screen's, a key table's button queued the same
 * way (`TAG0196da`), a panel key (`handleUIKey`), or one of the port's own keys
 * (`portKeyAction`). The queued buttons come back through `Game.handleMouseEvents` in
 * their turn, and `install` hands them to the interface's dispatcher, `handleMouseButton`.
 */
import type { Game } from '../engine/Game';
import type { GameScreen } from './GameScreen';
import { portKeyAction } from './ui/Keyboard';

/** What the input path asks of the page. */
export interface GameInputHost {
  readonly game: Game;
  readonly screen: GameScreen;
  /** Draw the screen again after an input that changed it. */
  renderView(): void;
  onQuickSave(): void;
  onQuickLoad(): void;
}

/** A key's modifiers, as a `KeyboardEvent` has them. */
export interface KeyModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export class GameInput {
  constructor(private readonly host: GameInputHost) {}

  /**
   * Once `MainLoop` has returned, `_ShowCredits` has emptied every button list and key
   * table (`doc/CSBwin-src/Code1f9e6.cpp:116-121`) and owns the screen: the adventure's
   * handlers neither act nor draw.
   */
  private ended(): boolean {
    return this.host.game.mainLoopHasReturned();
  }

  /** Hand the game the interface's dispatcher for the buttons it does not handle itself. */
  install(): void {
    const host = this.host;
    host.game.setMouseEventHandlers({
      button: (num, x, y) => {
        host.screen.handleMouseButton(num, x, y);
        host.renderView();
      },
      unclick: () => {
        host.screen.handleMouseUnclick();
        host.renderView();
      },
    });
  }

  mouseMove(x: number, y: number): void {
    if (this.ended()) return;
    const screen = this.host.screen;
    screen.setHoverPoint({ x, y });
    // Cursor tracking only — never a full `renderView()`. That would re-run
    // `DrawViewport` (and its animated-texture randomness) on every pixel of
    // mouse travel; CSBWin's own cursor moves independently of the dungeon
    // redraw, which happens once per game tick, never on a mouse event.
    screen.refreshOverlay();
  }

  /** A button pressed: `button` is `MouseEvent.button`'s number. */
  mouseDown(x: number, y: number, button: number): void {
    if (this.ended()) return;
    const { game, screen } = this.host;
    const buttonMask = button === 2 ? 1 : button === 0 ? 2 : 0;
    // The save/load screen is modal, the way `_WaitForMenuSelect` is modal: it
    // replaces every button list while it runs, so nothing else may see the click
    // (`doc/CSBWIN_MENU_REFERENCE.md`). Handling it here rather than through the
    // game's mouse queue is also what keeps the browser's transient user
    // activation alive — `showDirectoryPicker` refuses without it, and the queue is
    // drained a frame later.
    if (buttonMask !== 0 && screen.isSaveMenuOpen()) {
      screen.handleSaveMenuClick(x, y, buttonMask);
      this.host.renderView();
      return;
    }
    if (buttonMask === 0) return;
    if (screen.isReincarnateScreenOpen()) {
      screen.handleReincarnateClick(x, y);
      this.host.renderView();
      return;
    }
    // Queued, not handled: `Game.handleMouseEvents` takes it off the queue in its turn,
    // behind any key or click already waiting, and hands it to `handleMouseButton`.
    game.onMouseClick(screen.searchMouseButtons(x, y, buttonMask), x, y);
  }

  mouseUp(): void {
    if (this.ended() || this.host.screen.isSaveMenuOpen()) return;
    this.host.game.onMouseUnClick();
  }

  /** The wheel, which only the save/load screen's list takes. Says whether it took it. */
  wheel(deltaY: number): boolean {
    if (this.ended() || !this.host.screen.isSaveMenuOpen()) return false;
    this.host.screen.handleSaveMenuWheel(deltaY);
    return true;
  }

  mouseLeave(): void {
    if (this.ended()) return;
    this.host.screen.setHoverPoint(null);
    this.host.renderView();
  }

  /** A key pressed: `key` is `KeyboardEvent.key`. Says whether the game took it. */
  keyDown(key: string, mods: KeyModifiers): boolean {
    const { game, screen } = this.host;
    // `_ShowCredits` has emptied `d.pKeyXlate1` and `d.pKeyXlate2`
    // (`doc/CSBwin-src/Code1f9e6.cpp:120-121`): no key is the adventure's any more.
    if (this.ended()) return false;
    const modified = mods.ctrlKey || mods.metaKey || mods.altKey;
    // The Reincarnate name-entry screen is modal on the keyboard as well as
    // the mouse (`keyboardMode = 2`, `doc/CSBwin-src/Code13ea4.cpp:38`): while
    // it is up every key is a letter being typed, so none of the panel, movement
    // or debug keys below may see one. 'Q' would otherwise open an attack menu
    // while the player named their champion.
    // The save/load screen takes the keyboard whole, for the reason the
    // Reincarnate screen does: 'S' would otherwise open an attack menu while the
    // player scrolled a list of saves.
    if (screen.isSaveMenuOpen()) {
      if (modified) return false;
      screen.handleSaveMenuKey(key);
      this.host.renderView();
      return true;
    }
    if (screen.isReincarnateScreenOpen()) {
      if (modified) return false;
      screen.handleReincarnateKey(key);
      this.host.renderView();
      return true;
    }
    // The key tables first, `TAG0196da` (doc/CSBwin-src/CSBCode.cpp:8428): awake,
    // `Byte18400` and `Byte18428` bind Ctrl-S, Esc, Insert, Clr/Home and the arrows,
    // and F1-F4, which the port keeps for the caster (`DEBT.md` H); asleep `Byte18440` binds Return and Esc, and frozen `Byte18448` Esc
    // alone (doc/CSBwin-src/Mouse.cpp:1700-1701, :1754-1755). A bound key is queued
    // as its button, like a click.
    if (!mods.metaKey && !mods.altKey) {
      const button = screen.translateKey(key, mods.ctrlKey);
      if (button !== 0) {
        game.enqueueKeyButton(button);
        return true;
      }
    }
    // A browser or OS shortcut keeps its key: nothing below is bound with a
    // modifier, so Ctrl-R still reloads rather than opening a rune keypad.
    if (modified) return false;
    // Asleep or frozen, every key the table does not bind is dead, the movement
    // keys and the panel bindings included.
    if (game.isPartySleeping() || game.isFrozen()) return true;
    // Then the port's own bindings, which claim no other key a table binds: the
    // panel keys, which claim theirs whatever the game state, so the movement keys
    // below never see one.
    if (screen.handleUIKey(key)) {
      this.host.renderView();
      return true;
    }
    const action = portKeyAction(key);
    if (action === null) return false;
    // Not while a script holds the loop: the save could not resume it, and a load
    // would run it on in the loaded world.
    if (action === 'quickSave') {
      if (!game.isRunningScript()) this.host.onQuickSave();
    } else if (action === 'quickLoad') {
      if (!game.isRunningScript()) this.host.onQuickLoad();
    } else {
      game.enqueueMovement(action);
    }
    return true;
  }
}
