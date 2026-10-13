/**
 * The deployed game's server (`doc/DEPLOYMENT.md`, `doc/STATISTICS.md`): `node server/server.ts`,
 * on Node 24, which strips the types. No dependency: `node:http` serves the page, the game
 * files and the API (`app.ts`), and `node:sqlite` keeps the store (`store.ts`): the
 * statistics (`stats.ts`) and the data sets (`dataSets.ts`).
 *
 *   PORT            the port to listen on (8085; 0 picks a free one)
 *   DIST_DIR        the built page (the checkout's `dist/`)
 *   GAMEFILES_DIR   the data sets (the checkout's `static/gamefiles/`)
 *   MANIFEST_FILE   their manifest, its folders relative to GAMEFILES_DIR (the checkout's
 *                   `tools/data-sets.json`; the image's `/data/gamefiles/manifest.json`),
 *                   read only to fill an empty `data_sets` table
 *   STATS_DB        the store's SQLite file (the checkout's `stats/stats.db`), created
 *                   with its folder when missing
 *   MODERATOR_PLAYER_IDS  the moderators' `playerId`s, comma-separated, spaces around a
 *                   comma ignored: to them `api/data-sets` offers every set, pending ones
 *                   included, and says they moderate (`manifestText`); unset or empty
 *                   for no moderator
 *
 * It opens the store and checks the files before it listens, and exits with 1 on an
 * entry of `MODERATOR_PLAYER_IDS` that is not a `playerId`, a store it cannot open, an empty table and
 * a manifest that is missing or does not parse, or a folder the sets name that is missing. It logs to stdout, and on SIGTERM or SIGINT stops
 * listening, lets the requests in flight finish, closes the store, which checkpoints its
 * WAL, and exits with 0.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { checkFiles, createAppServer, type CheckedFiles, type ServerOptions } from './app.ts';
import { DataSetStore } from './dataSets.ts';
import { isPlayerId, RateLimit } from './events.ts';
import { StatsStore } from './stats.ts';
import { openStore } from './store.ts';

/** Events per address and minute: a game sends a few, a party's joins included. */
const EVENTS_PER_MINUTE = 30;

/** How long a shutdown waits for the requests in flight before it closes their sockets. */
const SHUTDOWN_GRACE_MS = 5000;

const ROOT = join(import.meta.dirname, '..');
const options: ServerOptions = {
    distDir: process.env.DIST_DIR ?? join(ROOT, 'dist'),
    gamefilesDir: process.env.GAMEFILES_DIR ?? join(ROOT, 'static', 'gamefiles'),
    manifestFile: process.env.MANIFEST_FILE ?? join(ROOT, 'tools', 'data-sets.json'),
};
const port = Number(process.env.PORT ?? 8085);
const statsDb = process.env.STATS_DB ?? join(ROOT, 'stats', 'stats.db');
const moderatorPlayerIds = (process.env.MODERATOR_PLAYER_IDS ?? '').split(',').map((id) => id.trim()).filter((id) => id !== '');

let db: DatabaseSync;
let dataSets: DataSetStore;
let store: StatsStore;
let checked: CheckedFiles;
try {
    if (!moderatorPlayerIds.every((id) => isPlayerId(id))) throw new Error('MODERATOR_PLAYER_IDS holds an entry that is not a playerId, a lowercase UUID');
    mkdirSync(dirname(statsDb), { recursive: true });
    db = openStore(statsDb);
    dataSets = new DataSetStore(db);
    store = new StatsStore(db);
    checked = checkFiles(options, dataSets);
} catch (error) {
    console.error(`Not starting: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}

const server = createAppServer(options, {
    dataSets,
    moderatorPlayerIds,
    store,
    rules: { hasSet: (id) => dataSets.hasSet(id) },
    rateLimit: new RateLimit(EVENTS_PER_MINUTE, 60_000),
    now: Date.now,
});
server.listen(port, () => {
    const address = server.address();
    const bound = typeof address === 'object' && address !== null ? address.port : port;
    const from = checked.filled ? `the data_sets table, filled from ${options.manifestFile}` : 'the data_sets table';
    console.log(`Listening on port ${bound}: ${options.distDir}, and ${options.gamefilesDir} (${checked.ids.join(', ')}, from ${from}); store in ${statsDb}`);
});

function shutDown(signal: string): void {
    console.log(`${signal}: shutting down`);
    server.close(() => {
        db.close();
        console.log('Stopped');
        process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS).unref();
}
process.once('SIGTERM', () => shutDown('SIGTERM'));
process.once('SIGINT', () => shutDown('SIGINT'));
