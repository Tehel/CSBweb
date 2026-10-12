/**
 * The server's one SQLite file, `STATS_DB`, through `node:sqlite`: the statistics' `events`
 * table (`stats.ts`) and the data sets' tables (`dataSets.ts`), on one connection, so that
 * `backup.ts`'s snapshot holds both.
 *
 * The file runs in WAL mode. Closing the connection checkpoints the WAL into it, so the file
 * alone is the whole store once the server has stopped. A missing file is made; each
 * table's owner gives it the schema it lacks.
 */
import { DatabaseSync } from 'node:sqlite';

export function openStore(path: string): DatabaseSync {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    return db;
}
