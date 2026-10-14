/**
 * Fills a store's empty `data_sets` table from a manifest (`DataSetStore.fill`), for a
 * server the repository runs: `npm start`'s store, or `tools/check-image.sh`'s throwaway
 * one. The deployed server's rows are written by hand (`doc/DEPLOYMENT.md`), and the server
 * itself reads no manifest. A table that is not empty is left as it is, and the tool exits
 * with 1, as on a manifest that does not parse. It does not check the folders the manifest
 * names: the server does at start-up, against its `GAMEFILES_DIR`.
 *
 * Usage: npx tsx tools/fill-data-sets.ts [STATS_DB] [manifest]
 *   STATS_DB  the store's file, made with its folder when missing (`stats/stats.db`)
 *   manifest  its folders relative to the server's GAMEFILES_DIR (`tools/data-sets.json`)
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { DataSetStore } from '../server/dataSets.ts';
import { openStore } from '../server/store.ts';
import { parseManifest } from '../src/data/DataSets.ts';
import { MANIFEST_FILE } from './lib/dataSets.ts';

const [statsDb = 'stats/stats.db', manifestFile = MANIFEST_FILE] = process.argv.slice(2);
try {
    const manifest = parseManifest(readFileSync(manifestFile, 'utf8'), '');
    mkdirSync(dirname(statsDb), { recursive: true });
    const db = openStore(statsDb);
    try {
        new DataSetStore(db).fill(manifest);
    } finally {
        db.close();
    }
    console.log(`${statsDb}: ${manifest.dataSets.map((set) => set.id).join(', ')}, from ${manifestFile}`);
} catch (error) {
    console.error(`Not filled: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
