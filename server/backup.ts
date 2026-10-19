/**
 * A snapshot of the store (`store.ts`), the statistics and the data sets' tables, taken
 * while the server keeps serving, and a copy of the folders players' sets were uploaded to
 * (`doc/DEPLOYMENT.md` → "Backups"). The VPS's cron runs it in the container:
 *
 *   docker-compose exec -T csbweb node --disable-warning=ExperimentalWarning server/backup.ts
 *
 *   STATS_DB        the store (the checkout's `stats/stats.db`), as `server.ts` reads it
 *   GAMEFILES_DIR   the data sets (the checkout's `static/gamefiles/`), as `server.ts` reads it
 *   BACKUP_DIR      where the snapshot goes (`backups/` beside the store), made when missing
 *
 * A `cp` of the live file is unsafe: its WAL holds committed events the file does not yet,
 * and `node:alpine` has no `sqlite3`. `node:sqlite`'s `backup` copies the database as a
 * connection sees it, WAL included, into one self-contained file.
 *
 * The folders are those of every set of the snapshot's, the site's too, since a moderator's
 * edit writes a set a new one (`edit.ts`), as does a document added or removed (`documents.ts`). A set's folder is complete before its row names
 * it, and never changes after, so each is copied once, into `gamefiles/<dir>/` under
 * `BACKUP_DIR`, through a `.partial` name renamed when whole, and kept: an older snapshot
 * needs the folders of its rows, a deleted set's and an edited set's old one included.
 *
 * It prints one JSON line, and exits with 1 when the store cannot be read or a folder
 * cannot be copied.
 */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const ROOT = join(import.meta.dirname, '..');
const statsDb = process.env.STATS_DB ?? join(ROOT, 'stats', 'stats.db');
const gamefilesDir = process.env.GAMEFILES_DIR ?? join(ROOT, 'static', 'gamefiles');
const dir = process.env.BACKUP_DIR ?? join(dirname(statsDb), 'backups');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(dir, `stats-${stamp}.db`);

/** `path` under `root`, or an error: a row's `dir` names a folder inside the game files. */
function inside(root: string, path: string): string {
    const full = resolve(root, path);
    const rel = relative(root, full);
    if (rel === '' || rel.startsWith('..')) throw new Error(`a set's folder is outside ${root}: ${path}`);
    return full;
}

try {
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(statsDb, { readOnly: true });
    try {
        await backup(db, target);
    } finally {
        db.close();
    }
    const snapshot = new DatabaseSync(target, { readOnly: true });
    let uploaded: string[];
    try {
        uploaded = (snapshot.prepare('SELECT dir FROM data_sets ORDER BY position').all() as { dir: string }[]).map((row) => row.dir);
    } finally {
        snapshot.close();
    }
    const copied: string[] = [];
    const folders = join(dir, 'gamefiles');
    for (const set of uploaded) {
        const copy = inside(folders, set);
        if (existsSync(copy)) continue;
        const from = inside(gamefilesDir, set);
        if (!statSync(from).isDirectory()) throw new Error(`a set's folder is not a folder: ${from}`);
        const partial = `${copy}.partial`;
        rmSync(partial, { recursive: true, force: true });
        mkdirSync(dirname(copy), { recursive: true });
        cpSync(from, partial, { recursive: true });
        renameSync(partial, copy);
        copied.push(set);
    }
    console.log(JSON.stringify({ msg: 'backup_ok', target, bytes: statSync(target).size, folders, copied, kept: uploaded.length - copied.length }));
} catch (error) {
    console.error(JSON.stringify({ msg: 'backup_failed', error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
}
