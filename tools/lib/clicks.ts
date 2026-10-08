/**
 * A stand-in for the screen's button lists, for a tool that queues clicks with no
 * interface behind them. `Game.handleMouseEvents` matches a queued click to its button
 * only when it comes to it (`MouseEventHandlers.translate`), so a tool says which button
 * is at a point, and that point's click is that button when it is taken. Saying another
 * button at the same point while a click there waits makes it that button: the screen
 * changed under it, as in play.
 */
import type { Game } from '../../src/engine/Game';

export class ButtonsAt {
  private readonly at = new Map<string, number>();

  /** `MouseEventHandlers.translate`: the button last put at (x, y), 0 for none. */
  readonly translate = (x: number, y: number, buttons: number): number =>
    this.at.get(`${x},${y},${buttons}`) ?? 0;

  /** Button `num` put at (x, y) for `buttons`, 0 for none: the screen changed there. */
  put(num: number, x: number, y: number, buttons = 2): void {
    this.at.set(`${x},${y},${buttons}`, num);
  }

  /** Button `num` put at (x, y) for `buttons`, and a click there queued. Says whether it was. */
  click(game: Game, num: number, x: number, y: number, buttons = 2): boolean {
    this.put(num, x, y, buttons);
    return game.onMouseClick(x, y, buttons);
  }
}
