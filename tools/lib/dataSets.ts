/**
 * The page's data sets, as the tools see them: the repository's manifest,
 * `tools/data-sets.json`, read from disk and parsed by the page's own parser
 * (`src/data/DataSets.ts`), every folder under `tools/fixtures/gamefiles`. The dev server offers
 * the page the same file (`vite.config.mts`); the deployed server, its own.
 *
 * Usage:
 *
 *   import { DATA_SETS, STOCK_DATA_SET, dataSetNamed } from './lib/dataSets';
 *   readFileSync(`${dataSetNamed('csb').dir}/dungeon.dat`)
 */
import { readFileSync } from 'node:fs';

import type { DataSetFiles } from '../../src/data/DataSetFiles';
import { parseManifest, type DataSet, type DataSetManifest } from '../../src/data/DataSets';

/** The folder the page's `gamefiles/` is served from. */
export const GAMEFILES_DIR = 'tools/fixtures/gamefiles';
/** The repository's manifest, its folders relative to `GAMEFILES_DIR`. */
export const MANIFEST_FILE = 'tools/data-sets.json';

export const MANIFEST: DataSetManifest = parseManifest(readFileSync(MANIFEST_FILE, 'utf8'), GAMEFILES_DIR);
export const DATA_SETS = MANIFEST.dataSets;

/** The set `id` names. A tool asks for a set it needs, so an unknown one throws. */
export function dataSetNamed(id: string): DataSet {
  const set = DATA_SETS.find((s) => s.id === id);
  if (!set) throw new Error(`${MANIFEST_FILE} has no data set '${id}'`);
  return set;
}

/**
 * The set the tools play where they name none: `dm-atari`, the stock files
 * (`STOCK_DIR`, `./game.ts`). Not the manifest's default, which is the set the welcome
 * page selects on a first visit.
 */
export const STOCK_DATA_SET: DataSet = dataSetNamed('dm-atari');

/** `set`'s folder on disk, as `folderFiles` serves it to the page. */
export function diskFiles(set: DataSet): DataSetFiles {
  return {
    async read(name) {
      try {
        return new Uint8Array(readFileSync(`${set.dir}/${name}`));
      } catch {
        return null;
      }
    },
    where: (name) => `${set.dir}/${name}`,
  };
}
