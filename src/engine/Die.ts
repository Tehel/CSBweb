/**
 * `die(errorNum, msg)` (`doc/CSBwin-src/CSBCode.cpp:96-122`): CSBWin's "System Error"
 * message box, then the program's end. The page ends its game instead, and prints the
 * message on the canvas (`showFatalMessage`, `src/ui/fatalMessage.ts`).
 */
import type { GameHost } from './GameHost';

/** What `die` throws: nothing in the boot or the loop catches it short of the page. */
export class Die extends Error {
  constructor(readonly errorNum: number, msg: string) {
    super(`System Error  0x${(errorNum >>> 0).toString(16).padStart(8, '0')}\n${msg}`);
  }
}

/**
 * `die` from the engine: the page is told first (`GameHost.die`), so the game ends even
 * where a caller catches the throw as a failed read (the save menu's), and then the
 * engine stops where it stands.
 */
export function die(host: GameHost, errorNum: number, msg: string): never {
  const error = new Die(errorNum, msg);
  host.die(error);
  throw error;
}
