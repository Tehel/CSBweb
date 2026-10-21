/**
 * `die(errorNum, msg)` (`doc/CSBwin-src/CSBCode.cpp:96-122`): CSBWin's "System Error"
 * message box, then the program's end. The page ends its game instead, and prints the
 * message on the canvas (`showFatalMessage`, `src/ui/fatalMessage.ts`). The engine's
 * `die` tells the page first (`src/engine/Die.ts`); a reader throws this alone.
 */

/** What `die` throws: nothing in the boot or the loop catches it short of the page. */
export class Die extends Error {
  constructor(readonly errorNum: number, msg: string) {
    super(`System Error  0x${(errorNum >>> 0).toString(16).padStart(8, '0')}\n${msg}`);
  }
}
