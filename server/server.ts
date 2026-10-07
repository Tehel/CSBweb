/**
 * The deployed game's server (PLAN.md Phase 17, step 3): `node server/server.ts`, on Node
 * 24, which strips the types. No dependency: `node:http` serves the page, the game files
 * and the API (`app.ts`).
 *
 *   PORT            the port to listen on (8080; 0 picks a free one)
 *   DIST_DIR        the built page (the checkout's `dist/`)
 *   GAMEFILES_DIR   the data sets and their manifest (the checkout's `static/gamefiles/`)
 *
 * It checks the files before it listens, and exits with 1 on a manifest that does not
 * parse or a folder it names that is missing. It logs to stdout, and on SIGTERM or SIGINT
 * stops listening, lets the requests in flight finish, and exits with 0.
 */
import { join } from 'node:path';

import { checkFiles, createAppServer, type ServerOptions } from './app.ts';

/** How long a shutdown waits for the requests in flight before it closes their sockets. */
const SHUTDOWN_GRACE_MS = 5000;

const ROOT = join(import.meta.dirname, '..');
const options: ServerOptions = {
    distDir: process.env.DIST_DIR ?? join(ROOT, 'dist'),
    gamefilesDir: process.env.GAMEFILES_DIR ?? join(ROOT, 'static', 'gamefiles'),
};
const port = Number(process.env.PORT ?? 8080);

let ids: string;
try {
    ids = checkFiles(options).dataSets.map((set) => set.id).join(', ');
} catch (error) {
    console.error(`Not starting: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}

const server = createAppServer(options);
server.listen(port, () => {
    const address = server.address();
    const bound = typeof address === 'object' && address !== null ? address.port : port;
    console.log(`Listening on port ${bound}: ${options.distDir}, and ${options.gamefilesDir} (${ids})`);
});

function shutDown(signal: string): void {
    console.log(`${signal}: shutting down`);
    server.close(() => {
        console.log('Stopped');
        process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS).unref();
}
process.once('SIGTERM', () => shutDown('SIGTERM'));
process.once('SIGINT', () => shutDown('SIGINT'));
