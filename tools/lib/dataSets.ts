/**
 * The page's data sets, as the tools see them: the repository's manifest,
 * `tools/data-sets.json`, read from disk and parsed by the page's own parser
 * (`src/data/DataSets.ts`), every folder under `static/gamefiles`. The dev server offers
 * the page the same file (`vite.config.mts`); the deployed server, its own.
 *
 * Usage:
 *
 *   import { DATA_SETS, DEFAULT_DATA_SET, dataSetNamed } from './lib/dataSets';
 *   readFileSync(`${dataSetNamed('csb').dir}/dungeon.dat`)
 */
import { readFileSync } from 'node:fs';

import { parseManifest, type DataSet, type DataSetManifest } from '../../src/data/DataSets';

/** The folder the page's `gamefiles/` is served from. */
export const GAMEFILES_DIR = 'static/gamefiles';
/** The repository's manifest, its folders relative to `GAMEFILES_DIR`. */
export const MANIFEST_FILE = 'tools/data-sets.json';

export const MANIFEST: DataSetManifest = parseManifest(readFileSync(MANIFEST_FILE, 'utf8'), GAMEFILES_DIR);
export const DATA_SETS = MANIFEST.dataSets;
export const DEFAULT_DATA_SET = MANIFEST.defaultSet;

/** The set `id` names. A tool asks for a set it needs, so an unknown one throws. */
export function dataSetNamed(id: string): DataSet {
  const set = DATA_SETS.find((s) => s.id === id);
  if (!set) throw new Error(`${MANIFEST_FILE} has no data set '${id}'`);
  return set;
}
