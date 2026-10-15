/**
 * The deployed game's server (`doc/DEPLOYMENT.md`, `doc/STATISTICS.md`): `node server/server.ts`,
 * on Node 24, which strips the types. No dependency: `node:http` serves the page, the game
 * files and the API (`app.ts`), and `node:sqlite` keeps the store (`store.ts`): the
 * statistics (`stats.ts`) and the data sets (`dataSets.ts`).
 *
 *   PORT            the port to listen on (8085; 0 picks a free one)
 *   DIST_DIR        the built page (the checkout's `dist/`), and the page's check built for
 *                   Node, `server/LocalDataSets.js` under it (`npm run build`)
 *   GAMEFILES_DIR   the data sets (the checkout's `static/gamefiles/`)
 *   FILES_DIR       the files shared by link, under `files/` (the checkout's `files/`, which
 *                   git ignores): a folder that is not there is not checked, and serves nothing
 *   STATS_DB        the store's SQLite file (the checkout's `stats/stats.db`), created
 *                   with its folder when missing, its `data_sets` table then empty
 *                   (`tools/fill-data-sets.ts` fills the checkout's)
 *   MODERATOR_PLAYER_IDS  the moderators' `playerId`s, comma-separated, spaces around a
 *                   comma ignored: to them `api/data-sets` offers every set, pending ones
 *                   included, and says they moderate (`manifestText`); unset or empty
 *                   for no moderator
 *
 * It opens the store, checks the files and loads the page's check of a player's set and
 * its reader of a dungeon's walls (`loadPageReaders`) before it listens, and reads the
 * walls of a published set whose row keeps none (`fillWalls`), logging a `dungeon.dat`
 * that does not read. It exits with 1 on an entry of
 * `MODERATOR_PLAYER_IDS` that is not a `playerId`, a store it cannot open, a game files'
 * folder or a folder the sets name that is missing, or a check that is not built. It logs to stdout, and on SIGTERM or SIGINT stops
 * listening, lets the requests in flight finish, closes the store, which checkpoints its
 * WAL, and exits with 0.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { checkFiles, createAppServer, fillWalls, loadPageReaders, type PageReaders, type ServerOptions } from './app.ts';
import { DataSetStore } from './dataSets.ts';
import { isPlayerId, RateLimit } from './events.ts';
import { StatsStore } from './stats.ts';
import { openStore } from './store.ts';

/** Events per address and minute: a game sends a few, a party's joins included. */
const EVENTS_PER_MINUTE = 30;

/** Publishes per address and hour, refused ones included: a player publishes a set now and then. */
const PUBLISHES_PER_HOUR = 5;

/** How long a shutdown waits for the requests in flight before it closes their sockets. */
const SHUTDOWN_GRACE_MS = 5000;

const ROOT = join(import.meta.dirname, '..');
const options: ServerOptions = {
    distDir: process.env.DIST_DIR ?? join(ROOT, 'dist'),
    gamefilesDir: process.env.GAMEFILES_DIR ?? join(ROOT, 'static', 'gamefiles'),
    filesDir: process.env.FILES_DIR ?? join(ROOT, 'files'),
};
const port = Number(process.env.PORT ?? 8085);
const statsDb = process.env.STATS_DB ?? join(ROOT, 'stats', 'stats.db');
const moderatorPlayerIds = (process.env.MODERATOR_PLAYER_IDS ?? '').split(',').map((id) => id.trim()).filter((id) => id !== '');

let db: DatabaseSync;
let dataSets: DataSetStore;
let store: StatsStore;
let ids: string[];
let readers: PageReaders;
try {
    if (!moderatorPlayerIds.every((id) => isPlayerId(id))) throw new Error('MODERATOR_PLAYER_IDS holds an entry that is not a playerId, a lowercase UUID');
    mkdirSync(dirname(statsDb), { recursive: true });
    db = openStore(statsDb);
    dataSets = new DataSetStore(db);
    store = new StatsStore(db);
    ids = checkFiles(options, dataSets);
    readers = await loadPageReaders(options.distDir);
} catch (error) {
    console.error(`Not starting: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}

const walls = await fillWalls(options.gamefilesDir, dataSets, readers.readDungeonWalls);
if (walls.filled.length > 0) console.log(`Read the walls of ${walls.filled.join(', ')}`);
if (walls.failed.length > 0) console.error(`No walls for ${walls.failed.join(', ')}: their dungeon.dat does not read`);

const server = createAppServer(options, {
    checkDataSet: readers.checkDataSet,
    dataSets,
    moderatorPlayerIds,
    store,
    rules: { hasSet: (id) => dataSets.hasSet(id) },
    rateLimit: new RateLimit(EVENTS_PER_MINUTE, 60_000),
    publishRateLimit: new RateLimit(PUBLISHES_PER_HOUR, 3_600_000),
    now: Date.now,
});
server.listen(port, () => {
    const address = server.address();
    const bound = typeof address === 'object' && address !== null ? address.port : port;
    console.log(`Listening on port ${bound}: ${options.distDir}, and ${options.gamefilesDir} (${ids.join(', ') || 'no set'}, from the data_sets table); store in ${statsDb}; shared files in ${options.filesDir}`);
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
