/**
 * The dialog over the game: the one slot a dialog fills while it is up (`UIState.dialog`).
 * The save menu (`SaveMenu.ts`) is the first to use it.
 *
 * A dialog is drawn into the screen over what the screen composed, under the button
 * flash and the cursor (`GameScreen`), and it is modal the way `_WaitForMenuSelect` is
 * (`doc/CSBWIN_MENU_REFERENCE.md` → "The modal loop"): while it is up, every click, key
 * and notch of the wheel is its, taken straight from the page's event rather than
 * through the mouse queue, and no button list or key table of the game sees one
 * (`GameInput`). A key with a modifier is left to the browser.
 *
 * The clock is held while it is up, as `_WaitForMenuSelect` holds it by never returning
 * to the main loop: the loop's pass makes no tick and prints no message, and its VBLs
 * are left out of the play time (`ctx.state.paused`, `Game.runFrame`).
 */
import type { UIState } from './UIState';

/** A point of the screen, or `null` for the pointer off the canvas. */
export type DialogPoint = { x: number; y: number } | null;

export interface Dialog {
  /** Draw it into the screen. */
  draw(ui: UIState): void;
  /** A button pressed: `buttons` is CSBWin's mask, 1 the right button and 2 the left. */
  click(ui: UIState, x: number, y: number, buttons: number): void;
  /** A key pressed with no modifier, as `KeyboardEvent.key` names it. */
  key(ui: UIState, key: string): void;
  /** A notch of the wheel, `WheelEvent.deltaY`. */
  wheel(ui: UIState, deltaY: number): void;
  /** The pointer moved. Says whether the dialog is drawn differently for it. */
  pointer(ui: UIState, point: DialogPoint): boolean;
  /**
   * The pointer moved with the button of a click of the dialog's still held, wherever it
   * is: a captured pointer's moves off the canvas come at its nearest edge.
   */
  drag?(ui: UIState, x: number, y: number): void;
  /** The button of that click released, on the canvas or off it. */
  release?(ui: UIState): void;
}

export function isDialogOpen(ui: UIState): boolean {
  return ui.dialog !== null;
}

/** Put `dialog` up and hold the clock. One dialog is up at a time: the caller checks. */
export function openDialog(ui: UIState, dialog: Dialog): void {
  ui.dialog = dialog;
  ui.ctx.state.paused = true;
}

/** Take the dialog down and let the clock run. */
export function closeDialog(ui: UIState): void {
  ui.dialog = null;
  ui.ctx.state.paused = false;
}
