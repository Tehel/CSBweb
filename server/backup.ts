/**
 * A snapshot of the statistics store, taken while the server keeps serving
 * (`doc/DEPLOYMENT.md` → "Backups"). The VPS's cron runs it in the container:
 *
 *   docker-compose exec -T csbweb node --disable-warning=ExperimentalWarning server/backup.ts
 *
 *   STATS_DB     the store (the checkout's `stats/stats.db`), as `server.ts` reads it
 *   BACKUP_DIR   where the snapshot goes (`backups/` beside the store), made when missing
 *
 * A `cp` of the live file is unsafe: its WAL holds committed events the file does not yet,
 * and `node:alpine` has no `sqlite3`. `node:sqlite`'s `backup` copies the database as a
 * connection sees it, WAL included, into one self-contained file. It prints one JSON line,
 * and exits with 1 when the store cannot be read.
 */
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const ROOT = join(import.meta.dirname, '..');
const statsDb = process.env.STATS_DB ?? join(ROOT, 'stats', 'stats.db');
const dir = process.env.BACKUP_DIR ?? join(dirname(statsDb), 'backups');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(dir, `stats-${stamp}.db`);

try {
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(statsDb, { readOnly: true });
    try {
        await backup(db, target);
    } finally {
        db.close();
    }
    console.log(JSON.stringify({ msg: 'backup_ok', target, bytes: statSync(target).size }));
} catch (error) {
    console.error(JSON.stringify({ msg: 'backup_failed', error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
}
