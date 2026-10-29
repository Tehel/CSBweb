/**
 * The server's one SQLite file, `STATS_DB`, through `node:sqlite`: the statistics' `events`
 * table (`stats.ts`), the data sets' tables (`dataSets.ts`) and the shared recordings'
 * (`recordings.ts`), on one connection, so that `backup.ts`'s snapshot holds them all.
 *
 * The file runs in WAL mode. Closing the connection checkpoints the WAL into it, so the file
 * alone is the whole store once the server has stopped. A missing file is made; each
 * table's owner gives it the schema it lacks.
 *
 * SQLite's temporary files are kept in memory: the container's file system is read-only
 * but for the mounted folders (`docker-compose.yaml`), so SQLite finds no folder to make
 * them in, and a statement that needs one, such as a migration's `UPDATE` of many rows in
 * a transaction, fails with a disk I/O error. The store is small enough for memory.
 */
import { DatabaseSync } from 'node:sqlite';

export function openStore(path: string): DatabaseSync {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA temp_store = MEMORY');
    return db;
}
