/**
 * The verifier (`doc/ACHIEVEMENTS.md` → "Proofs", `doc/DEPLOYMENT.md`): a service of its
 * own, `node server/verifier.ts`, from the same image as the server, which replays the
 * proofs the server queues, one at a time, the oldest first (`verifyNext`, `proofs.ts`),
 * with the page's replay built for Node (`VERIFIER_MODULE`, `app.ts`), and keeps each
 * verdict in the store the server answers them from.
 *
 *   DIST_DIR        the built page, the verifier's module under it (`npm run build`)
 *   GAMEFILES_DIR   the data sets, which a proof is played over, read only
 *   STATS_DB        the store's SQLite file, the server's: the verifier opens it beside the
 *                   server, and waits for its writes (`store.ts`)
 *   PROOFS_DIR      the proofs' packages (`proofs/` beside the store): it deletes those
 *                   that granted nothing of their own
 *
 * A replay takes the whole of a CPU while it runs, so the verifier lowers its own priority
 * to the lowest at start-up (`VERIFIER_NICENESS`), which needs no capability, and the
 * compose file gives it half a CPU (`docker-compose.yaml`): the game's server comes first.
 * With nothing queued it looks again every `IDLE_MS`.
 *
 * It exits with 1 on a store it cannot open or a module that is not built, and logs a line
 * per proof replayed. On SIGTERM or SIGINT it lets the replay under way end, then closes
 * the store and exits with 0: a replay stopped halfway would leave its proof queued all the
 * same, and replayed again at the next start.
 */
import { setPriority } from 'node:os';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { loadVerifierReaders } from './app.ts';
import { DataSetStore } from './dataSets.ts';
import { IdentityStore } from './identity.ts';
import { ProofStore, verifyNext, type VerifierReaders } from './proofs.ts';
import { FileDigestCache } from './setFiles.ts';
import { openStore } from './store.ts';

/** The lowest priority, `nice 19`: a process may always lower its own. */
const VERIFIER_NICENESS = 19;

/** How long the verifier waits with nothing queued before it looks again. */
const IDLE_MS = 10_000;

const ROOT = join(import.meta.dirname, '..');
const distDir = process.env.DIST_DIR ?? join(ROOT, 'dist');
const gamefilesDir = process.env.GAMEFILES_DIR ?? join(ROOT, 'tools', 'fixtures', 'gamefiles');
const statsDb = process.env.STATS_DB ?? join(ROOT, 'stats', 'stats.db');
const proofsDir = process.env.PROOFS_DIR ?? join(dirname(statsDb), 'proofs');

let db: DatabaseSync;
let readers: VerifierReaders;
let options: Parameters<typeof verifyNext>[0];
try {
    setPriority(VERIFIER_NICENESS);
    readers = await loadVerifierReaders(distDir);
    db = openStore(statsDb);
    // The server made the tables; a verifier started first makes them the same way.
    options = {
        proofs: new ProofStore(db, 0), identities: new IdentityStore(db), dataSets: new DataSetStore(db), dir: proofsDir, gamefilesDir,
        digests: new FileDigestCache(), replay: readers.replay, now: Date.now,
    };
} catch (error) {
    console.error(`Not starting: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}

let stopping = false;
let wake: (() => void) | null = null;
function stop(signal: string): void {
    console.log(`${signal}: stopping after the replay under way`);
    stopping = true;
    wake?.();
}
process.once('SIGTERM', () => stop('SIGTERM'));
process.once('SIGINT', () => stop('SIGINT'));

console.log(`Verifying the proofs in ${proofsDir} over ${gamefilesDir}; store in ${statsDb}`);
while (!stopping) {
    const startedAt = Date.now();
    let done: Awaited<ReturnType<typeof verifyNext>>;
    try {
        done = await verifyNext(options);
    } catch (error) {
        // A store that will not write: the proof stays queued, and is tried again.
        console.error('The verifier failed:', error);
        done = null;
    }
    if (done === null) {
        await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, IDLE_MS);
        });
        wake = null;
        continue;
    }
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(done.state === 'drifted'
        ? `proof ${done.id} drifted in ${seconds} s: ${done.reason}`
        : `proof ${done.id} checked in ${seconds} s: verified ${done.verified.join(', ') || 'nothing'}`
            + `${done.dropped.length > 0 ? `, dropped ${done.dropped.join(', ')}` : ''}${done.kept ? '' : ', its file deleted'}`);
}
db.close();
console.log('Stopped');
