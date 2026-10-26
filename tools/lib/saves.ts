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
 *
 * And `memoryStore`, a save store in memory, for a tool that runs the page's saves, and
 * `rewriteSaveFile`, a file read and written again through the port's own codecs.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { sortSaveEntries, type SaveEntry, type SaveStore } from '../../src/data/saves/SaveStore';
import { buildExtendedFeaturesPrefix } from '../../src/data/CsbwinExtendedFeatures';
import type { CsbwinObjectIndex } from '../../src/data/CsbwinObjectIndex';
import {
  encodeBlock1,
  encodeBlock2,
  encodeItem16,
  encodeTimerQueue,
  encodeTimers,
  writeSaveFile,
  type SaveFile,
} from '../../src/data/SaveFile';

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

/** What `rewriteSaveFile` encodes: a read file's views, and the two it rebuilds. */
export interface RewrittenViews extends Pick<SaveFile, 'block1' | 'block2' | 'item16' | 'timers' | 'timerQueue'> {
  /** Block 4, written as given. */
  characters: Uint8Array;
  /** The maps block 0 carries; the file's own by default. */
  objectIndex: CsbwinObjectIndex | undefined;
  /** Blocks 7-14, none by default: the file is then its blocks 0-6. */
  image: Uint8Array;
}

/**
 * A save read and written again, each block encoded from what the read says by the
 * port's own codecs, as the port would write the same game: block 0 rebuilt from its
 * header, `numTimer` the queue's length. `changes` replaces any of the views first. The
 * file's own bytes go out only for block 4, which `CsbwinCharacters.ts` reads whole.
 */
export function rewriteSaveFile(save: SaveFile, changes: Partial<RewrittenViews> = {}): Uint8Array {
  const views: RewrittenViews = {
    block1: save.block1,
    block2: save.block2,
    item16: save.item16,
    timers: save.timers,
    timerQueue: save.timerQueue,
    characters: save.blocks.characters,
    objectIndex: save.extended.objectIndex,
    image: new Uint8Array(0),
    ...changes,
  };
  const ef = save.extended;
  const timerSize = ef.extendedTimers ? 16 : ef.sequencedTimers ? 12 : 10;
  return writeSaveFile({
    block0: ef.header
      ? buildExtendedFeaturesPrefix({
        header: ef.header,
        typeMap: views.objectIndex?.typeMap ?? new Uint8Array(0),
        indexMap: views.objectIndex?.indexMap ?? new Uint16Array(0),
        dsaIndex: ef.dsaIndex,
        gameInfo: ef.gameInfo,
        dsaLevelIndex: ef.dsaLevelIndex,
      })
      : new Uint8Array(0),
    block1: encodeBlock1(views.block1),
    block2: encodeBlock2({ ...views.block2, numTimer: views.timerQueue.length }),
    item16: encodeItem16(views.item16),
    characters: views.characters,
    timers: encodeTimers(views.timers, timerSize, views.timerQueue),
    timerQueue: encodeTimerQueue(views.timerQueue, views.block2.maxTimers),
    image: views.image,
  });
}

/**
 * A save store in memory. `onWrite` runs as a write arrives, before it is kept; a store
 * made to `fail` rejects every write; `onList` runs as the store is listed.
 */
export function memoryStore(
  onWrite: () => void = () => {},
  fail = false,
  onList: () => void = () => {},
): SaveStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const entries = new Map<string, SaveEntry>();
  return {
    files,
    list: async (dataSet) => {
      onList();
      return sortSaveEntries([...entries.values()].filter((e) => dataSet === null || e.dataSet === dataSet));
    },
    read: async (id) => {
      const bytes = files.get(id);
      if (!bytes) throw new Error(`no save ${id}`);
      return bytes;
    },
    write: async (written, bytes) => {
      onWrite();
      if (fail) throw new Error('the store is full');
      files.set(written.id, bytes);
      entries.set(written.id, written);
    },
    markUsed: async (id, usedAt) => {
      const held = entries.get(id);
      if (held) entries.set(id, { ...held, usedAt });
    },
    remove: async (id) => {
      files.delete(id);
      entries.delete(id);
    },
  };
}
