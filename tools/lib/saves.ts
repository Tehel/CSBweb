/**
 * Where the genuine CSBWin saves the tools read are kept: `tools/fixtures`, beside the
 * golden frames.
 *
 * Seven were made to order for a check: a party one step into the dungeon, a door caught
 * in motion, a sword in flight. `csbgame7.dat` is the one save of real play, a party deep
 * in the dungeon with live monsters on its level. A tool asks for a save by its file
 * name, or for all of them.
 *
 * Usage:
 *
 *   import { genuineSaves, savePath } from './lib/saves';
 *   for (const path of genuineSaves()) …
 *   readFileSync(savePath('csbgame4-door-opening.dat'))
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const SAVE_DIR = 'tools/fixtures';

function isSaveFile(name: string): boolean {
  // `:Zone.Identifier` and friends are NTFS alternate-data-stream droppings, not saves.
  return name.toLowerCase().endsWith('.dat') && !name.includes(':');
}

/** The saves of `target`, a directory or one file, as absolute paths in name order. */
export function collectSaves(target: string): string[] {
  const path = resolve(target);
  if (!existsSync(path)) return [];
  if (statSync(path).isDirectory()) {
    return readdirSync(path).filter(isSaveFile).sort().map((n) => join(path, n));
  }
  return [path];
}

/**
 * Every genuine save, in file-name order. With `target`, a tool's optional path
 * argument, the saves of that file or directory instead.
 */
export function genuineSaves(target?: string): string[] {
  return collectSaves(target ?? SAVE_DIR);
}

/** The path of the genuine save called `name`. */
export function savePath(name: string): string {
  const path = resolve(SAVE_DIR, name);
  if (!existsSync(path)) throw new Error(`no save called ${name} in ${SAVE_DIR}`);
  return path;
}
