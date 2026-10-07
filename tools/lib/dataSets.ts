/**
 * The page's data sets, as the tools see them: `static/gamefiles/manifest.json`, read from
 * disk and parsed by the page's own parser (`src/data/DataSets.ts`), every folder under
 * `static/gamefiles`.
 *
 * Usage:
 *
 *   import { DATA_SETS, DEFAULT_DATA_SET, dataSetNamed } from './lib/dataSets';
 *   readFileSync(`${dataSetNamed('csb').dir}/dungeon.dat`)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MANIFEST_NAME, parseManifest, type DataSet, type DataSetManifest } from '../../src/data/DataSets';

/** The folder the page's `gamefiles/` is served from. */
export const GAMEFILES_DIR = 'static/gamefiles';

export const MANIFEST: DataSetManifest = parseManifest(readFileSync(join(GAMEFILES_DIR, MANIFEST_NAME), 'utf8'), GAMEFILES_DIR);
export const DATA_SETS = MANIFEST.dataSets;
export const DEFAULT_DATA_SET = MANIFEST.defaultSet;

/** The set `id` names. A tool asks for a set it needs, so an unknown one throws. */
export function dataSetNamed(id: string): DataSet {
  const set = DATA_SETS.find((s) => s.id === id);
  if (!set) throw new Error(`${MANIFEST_NAME} has no data set '${id}'`);
  return set;
}
