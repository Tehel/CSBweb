/**
 * A snapshot of the store (`store.ts`), the statistics', the data sets', the recordings' and the identities'
 * tables, taken while the server keeps serving, and a copy of the folders players' sets
 * were uploaded to and of the recordings' packages (`doc/DEPLOYMENT.md` → "Backups"). The server's cron runs it in the container:
 *
 *   docker-compose exec -T csbweb node --disable-warning=ExperimentalWarning server/backup.ts
 *
 *   STATS_DB        the store (the checkout's `stats/stats.db`), as `server.ts` reads it
 *   GAMEFILES_DIR   the data sets (the checkout's `tools/fixtures/gamefiles/`), as `server.ts` reads it
 *   RECORDINGS_DIR  the recordings' packages (`recordings/` beside the store), as `server.ts` reads it
 *   PROOFS_DIR      the proofs' packages (`proofs/` beside the store), as `server.ts` reads it
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
 * A recording's package, `<id>.gz`, is never changed either, and is copied once in the same
 * way, into `recordings/` under `BACKUP_DIR`. A migration of the package's format, the one
 * change it may have, moves the copy aside first (`utils/migrate-recording-packages.ts`),
 * so that the next run copies the new file. A proof's package (`proofs.ts`) is copied once
 * too, into `proofs/` under `BACKUP_DIR`, once the verifier has checked it and kept it; a
 * queued one, which it may yet delete, is not. The copy of one the verifier has deleted
 * since, superseded by a later proof whose package holds its path (`holdsPath`), is
 * deleted: that proof is checked, and copied in the same run, so the backup keeps each
 * branch's latest point as the server does, not every point it passed.
 *
 * It prints one JSON line, and exits with 1 when the store cannot be read or a folder or a
 * package cannot be copied.
 */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const ROOT = join(import.meta.dirname, '..');
const statsDb = process.env.STATS_DB ?? join(ROOT, 'stats', 'stats.db');
const gamefilesDir = process.env.GAMEFILES_DIR ?? join(ROOT, 'tools', 'fixtures', 'gamefiles');
const recordingsDir = process.env.RECORDINGS_DIR ?? join(dirname(statsDb), 'recordings');
const proofsDir = process.env.PROOFS_DIR ?? join(dirname(statsDb), 'proofs');
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
    let packages: string[];
    let proofs: string[];
    let superseded: string[];
    try {
        uploaded = (snapshot.prepare('SELECT dir FROM data_sets ORDER BY position').all() as { dir: string }[]).map((row) => row.dir);
        // A store the server has not opened since it kept recordings has no such table.
        const recordings = snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recordings'").get() !== undefined;
        packages = recordings ? (snapshot.prepare('SELECT id FROM recordings ORDER BY uploaded_at').all() as { id: string }[]).map((row) => `${row.id}.gz`) : [];
        const proofTable = snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'proofs'").get() !== undefined;
        proofs = proofTable ? (snapshot.prepare("SELECT id FROM proofs WHERE state = 'checked' AND kept = 1 ORDER BY sent_at").all() as { id: string }[])
            .map((row) => `${row.id}.gz`) : [];
        // A store the server has not opened since its proofs were superseded has no such column.
        const supersedes = proofTable && (snapshot.prepare('PRAGMA table_info(proofs)').all() as { name: string }[]).some((column) => column.name === 'superseded_by');
        superseded = supersedes ? (snapshot.prepare('SELECT id FROM proofs WHERE superseded_by IS NOT NULL ORDER BY sent_at').all() as { id: string }[])
            .map((row) => `${row.id}.gz`) : [];
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
    /** Each of `files` in `from` copied once into `to`, through a `.partial` name: how many were. */
    const copyOnce = (files: readonly string[], from: string, to: string): number => {
        mkdirSync(to, { recursive: true });
        let count = 0;
        for (const file of files) {
            const copy = inside(to, file);
            if (existsSync(copy)) continue;
            const partial = join(to, `.${file}.partial`);
            cpSync(inside(from, file), partial);
            renameSync(partial, copy);
            count++;
        }
        return count;
    };
    const recordingsCopy = join(dir, 'recordings');
    const recordingsCopied = copyOnce(packages, recordingsDir, recordingsCopy);
    const proofsCopy = join(dir, 'proofs');
    const proofsCopied = copyOnce(proofs, proofsDir, proofsCopy);
    let proofsDeleted = 0;
    for (const file of superseded) {
        const copy = inside(proofsCopy, file);
        if (!existsSync(copy)) continue;
        rmSync(copy);
        proofsDeleted++;
    }
    console.log(JSON.stringify({
        msg: 'backup_ok', target, bytes: statSync(target).size, folders, copied, kept: uploaded.length - copied.length,
        recordings: recordingsCopy, recordingsCopied, recordingsKept: packages.length - recordingsCopied,
        proofs: proofsCopy, proofsCopied, proofsKept: proofs.length - proofsCopied, proofsDeleted,
    }));
} catch (error) {
    console.error(JSON.stringify({ msg: 'backup_failed', error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
}
