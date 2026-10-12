/**
 * The deployed game's server (`doc/DEPLOYMENT.md`, `doc/STATISTICS.md`): `node server/server.ts`,
 * on Node 24, which strips the types. No dependency: `node:http` serves the page, the game
 * files and the API (`app.ts`), and `node:sqlite` keeps the statistics (`stats.ts`).
 *
 *   PORT            the port to listen on (8085; 0 picks a free one)
 *   DIST_DIR        the built page (the checkout's `dist/`)
 *   GAMEFILES_DIR   the data sets (the checkout's `static/gamefiles/`)
 *   MANIFEST_FILE   their manifest, its folders relative to GAMEFILES_DIR (the checkout's
 *                   `tools/data-sets.json`; the image's `/data/gamefiles/manifest.json`)
 *   STATS_DB        the statistics' SQLite file (the checkout's `stats/stats.db`), created
 *                   with its folder when missing
 *
 * It checks the files and opens the store before it listens, and exits with 1 on a
 * manifest that does not parse, a folder it names that is missing, or a store it cannot
 * open. It logs to stdout, and on SIGTERM or SIGINT stops listening, lets the requests in
 * flight finish, closes the store, which checkpoints its WAL, and exits with 0.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { checkFiles, createAppServer, type CheckedFiles, type ServerOptions } from './app.ts';
import { RateLimit } from './events.ts';
import { StatsStore } from './stats.ts';

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

let checked: CheckedFiles;
let ids: string[];
let store: StatsStore;
try {
    checked = checkFiles(options);
    ids = checked.manifest.dataSets.map((set) => set.id);
    mkdirSync(dirname(statsDb), { recursive: true });
    store = new StatsStore(statsDb);
} catch (error) {
    console.error(`Not starting: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}

const server = createAppServer(options, {
    dataSets: checked.text,
    store,
    rules: { sets: new Set(ids) },
    rateLimit: new RateLimit(EVENTS_PER_MINUTE, 60_000),
    now: Date.now,
});
server.listen(port, () => {
    const address = server.address();
    const bound = typeof address === 'object' && address !== null ? address.port : port;
    console.log(`Listening on port ${bound}: ${options.distDir}, and ${options.gamefilesDir} (${ids.join(', ')}, from ${options.manifestFile}); statistics in ${statsDb}`);
});

function shutDown(signal: string): void {
    console.log(`${signal}: shutting down`);
    server.close(() => {
        store.close();
        console.log('Stopped');
        process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS).unref();
}
process.once('SIGTERM', () => shutDown('SIGTERM'));
process.once('SIGINT', () => shutDown('SIGINT'));
