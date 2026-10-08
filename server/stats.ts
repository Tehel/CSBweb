/**
 * The statistics store (`doc/STATISTICS.md`): one SQLite file, through `node:sqlite`,
 * holding one `events` table, and the aggregates `api/stats` makes of it. No address and
 * nothing the server has not checked is stored (`events.ts`).
 *
 * The file runs in WAL mode. `close` checkpoints the WAL into it, so the file alone is the
 * whole store once the server has stopped. A missing file, or a file without the table, is
 * given the schema.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import type { CheckedChampion, CheckedEvent } from './events.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY,
    time        INTEGER NOT NULL,  -- ms since the epoch, the server's clock
    player      TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    data_set    TEXT    NOT NULL,
    playthrough INTEGER NOT NULL,
    build       TEXT    NOT NULL,
    payload     TEXT    NOT NULL   -- JSON, as events.ts rebuilt it
);
CREATE INDEX IF NOT EXISTS events_by_type ON events (type, data_set, playthrough);
`;

/** The Monday that starts the week of `time`, a column, as `YYYY-MM-DD`, UTC. */
const week = (time: string) => `date(${time} / 1000, 'unixepoch', 'weekday 0', '-6 days')`;

/** What `api/stats` answers: aggregates only, never an event, a player or a playthrough. */
export interface Stats {
    /** Distinct players, ever. */
    players: number;
    /** Per set and week: distinct players, and games started and won. */
    weeks: { set: string; week: string; players: number; started: number; won: number }[];
    /** Per set: the games a champion of each name was in a party of. */
    champions: { set: string; name: string; games: number }[];
    /** Per set: the lost games on each square. */
    deaths: { set: string; level: number; x: number; y: number; count: number }[];
    /**
     * Every won game: its week, the game time (ticks) and the play time (ms) the page sent,
     * the wall time since its `started` (ms, `null` when none was received), and its party.
     */
    wins: { set: string; week: string; gameTime: number; playTime: number; wallTime: number | null; champions: CheckedChampion[] }[];
}

export class StatsStore {
    private readonly db: DatabaseSync;
    private readonly insert: StatementSync;

    constructor(path: string) {
        this.db = new DatabaseSync(path);
        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec(SCHEMA);
        this.insert = this.db.prepare(
            'INSERT INTO events (time, player, type, data_set, playthrough, build, payload) VALUES (?, ?, ?, ?, ?, ?, ?)');
    }

    record(event: CheckedEvent, time: number): void {
        this.insert.run(time, event.player, event.type, event.set, event.playthrough, event.build, JSON.stringify(event.payload));
    }

    stats(): Stats {
        const all = (sql: string) => this.db.prepare(sql).all() as Record<string, unknown>[];
        const { players } = this.db.prepare('SELECT COUNT(DISTINCT player) AS players FROM events').get() as { players: number };
        const weeks = all(`
            SELECT data_set AS "set", ${week('time')} AS week,
                   COUNT(DISTINCT player) AS players,
                   COUNT(DISTINCT CASE WHEN type = 'started' THEN playthrough END) AS started,
                   COUNT(DISTINCT CASE WHEN type = 'won' THEN playthrough END) AS won
            FROM events GROUP BY 1, 2 ORDER BY 2, 1`) as Stats['weeks'];
        const champions = all(`
            SELECT e.data_set AS "set", json_extract(c.value, '$.name') AS name, COUNT(DISTINCT e.playthrough) AS games
            FROM events e, json_each(e.payload, '$.champions') c
            WHERE e.type IN ('party', 'won', 'lost')
            GROUP BY 1, 2 ORDER BY 1, 3 DESC, 2`) as Stats['champions'];
        const deaths = all(`
            SELECT data_set AS "set", json_extract(payload, '$.level') AS level,
                   json_extract(payload, '$.x') AS x, json_extract(payload, '$.y') AS y, COUNT(*) AS count
            FROM events WHERE type = 'lost' GROUP BY 1, 2, 3, 4 ORDER BY 1, 5 DESC, 2, 3, 4`) as Stats['deaths'];
        const wins = all(`
            SELECT w.data_set AS "set", ${week('w.time')} AS week, w.payload AS payload,
                   w.time - (SELECT MIN(s.time) FROM events s
                             WHERE s.type = 'started' AND s.data_set = w.data_set AND s.playthrough = w.playthrough) AS wallTime
            FROM events w WHERE w.type = 'won' ORDER BY w.time`).map((row) => {
            const { gameTime, playTime, champions } = JSON.parse(row.payload as string) as { gameTime: number; playTime: number; champions: CheckedChampion[] };
            return { set: row.set as string, week: row.week as string, gameTime, playTime, wallTime: row.wallTime as number | null, champions };
        });
        return { players, weeks, champions, deaths, wins };
    }

    close(): void {
        if (this.db.isOpen) this.db.close();
    }
}
