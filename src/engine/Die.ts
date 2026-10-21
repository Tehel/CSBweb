/**
 * `die(errorNum, msg)` (`doc/CSBwin-src/CSBCode.cpp:96-122`) from the engine, which has a
 * page to tell. What it throws is `Die` (`src/core/Die.ts`).
 */
import { Die } from '../core/Die';
import type { GameHost } from './GameHost';

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
