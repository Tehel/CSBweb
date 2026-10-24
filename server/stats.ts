/**
 * The statistics (`doc/STATISTICS.md`): the store's `events` table (`store.ts`), and the
 * aggregates `api/stats` answers. No address and nothing the server has not checked is
 * stored (`events.ts`).
 *
 * The aggregates are kept as the events arrive, in four tables beside the log, so that an
 * answer is a few indexed queries rather than a pass over every event: `games`, a row per
 * game (a set's playthrough), `deaths`, the lost games per square, `picks`, each game's
 * champions by their mirror's name, and `sessions`, the sessions per set and week. A store
 * without them is given them, filled once from its `events`. The answers are cached
 * (`AnswerCache`).
 *
 * A `session` is never a row of `events`: no player and no time is kept of it, which
 * would be the player's habits. It counts in `sessions`, and raises its game's `played`.
 */
import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { CheckedChampion, CheckedEvent } from './events.ts';

const EVENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY,
    time        INTEGER NOT NULL,  -- ms since the epoch, the server's clock, to TIME_GRAIN
    player      TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    data_set    TEXT    NOT NULL,
    playthrough INTEGER NOT NULL,
    build       TEXT    NOT NULL,
    payload     TEXT    NOT NULL   -- JSON, as events.ts rebuilt it
);
CREATE INDEX IF NOT EXISTS events_by_type ON events (type, data_set, playthrough);
`;

/**
 * A game's `started` and `won` once each, its first: a later one, as a reload of an earlier
 * save sends, is not a row and changes nothing (`StatsStore.record`). A `lost` is every one.
 */
const ONCE_SCHEMA = `
CREATE UNIQUE INDEX events_once ON events (type, data_set, playthrough) WHERE type IN ('started', 'won');
`;

/**
 * The grain of every time the store keeps, in ms: an event's, and a game's start and win,
 * each rounded down to it. The answers count days and weeks, which it changes nothing of.
 * A time names the ten seconds an event arrived in, not the one request of nginx's access
 * log (`doc/DEPLOYMENT.md`), which keeps every request's address, to the second.
 */
export const TIME_GRAIN = 10_000;

/**
 * The rows the log holds at most, past which only a `session` is kept: about 300 bytes
 * each, the aggregates included (`tools/checks/stats.ts`), so some 150 MB, in each of the
 * nightly backups too (`doc/DEPLOYMENT.md`), on a disk the server may share.
 */
export const MAX_EVENTS = 500_000;

const AGGREGATES_SCHEMA = `
CREATE TABLE games (
    data_set    TEXT    NOT NULL,
    playthrough INTEGER NOT NULL,
    player      TEXT    NOT NULL,  -- its first event's, for counting: never answered
    started     INTEGER,           -- its first started's time
    won         INTEGER,           -- its first won's time, and that won's:
    game_time   INTEGER,           --   game clock, in ticks
    play_time   INTEGER,           --   play time, in ms
    champions   TEXT,              --   party, JSON
    PRIMARY KEY (data_set, playthrough)
);
CREATE INDEX games_by_game_time ON games (data_set, game_time) WHERE won IS NOT NULL;
CREATE TABLE deaths (
    data_set TEXT    NOT NULL,
    level    INTEGER NOT NULL,
    x        INTEGER NOT NULL,
    y        INTEGER NOT NULL,
    count    INTEGER NOT NULL,
    PRIMARY KEY (data_set, level, x, y)
) WITHOUT ROWID;
`;

/** `picks`, which a store made before its `slot` is given again, from the log. */
const PICKS_SCHEMA = `
CREATE TABLE picks (
    data_set    TEXT    NOT NULL,
    playthrough INTEGER NOT NULL,
    name        TEXT    NOT NULL,  -- the mirror's: a reincarnated champion's hero
    slot        INTEGER NOT NULL,  -- the party's, in the event that made the row
    PRIMARY KEY (data_set, playthrough, name)
) WITHOUT ROWID;
`;

/** The statements that make `picks`' rows (`StatsStore.pickParty`). */
interface PickStatements {
    /** A champion who joined in the page: their mirror's name is known. */
    joined: StatementSync;
    /** A champion read from a save, `id` null: only where their slot has no row. */
    read: StatementSync;
}

/** What a store made before the sessions is given: `games.played`, and `sessions`. */
const SESSIONS_SCHEMA = `
ALTER TABLE games ADD COLUMN played INTEGER;  -- the largest play time reported, in ms
CREATE TABLE sessions (
    data_set TEXT    NOT NULL,
    week     TEXT    NOT NULL,  -- its Monday, YYYY-MM-DD, UTC
    count    INTEGER NOT NULL,
    PRIMARY KEY (data_set, week)
) WITHOUT ROWID;
`;

/** The Monday that starts the week of `time`, a column, as `YYYY-MM-DD`, UTC. */
const week = (time: string) => `date(${time} / 1000, 'unixepoch', 'weekday 0', '-6 days')`;

/**
 * The page's VBLs a second, `VBL_FREQUENCY` (`src/core/constants.ts`): not imported, as the
 * server's image holds only `src/data/DataSets.ts` of the page's modules (`Dockerfile`).
 */
const VBL_FREQUENCY = 60;
/** The fastest wins a set's answer lists. */
export const FASTEST_WINS = 10;
/** The champions a set's answer lists. */
export const TOP_CHAMPIONS = 20;
/**
 * The squares a level's answer lists, the most died on first: a whole level of 32x32, where
 * parties die on far fewer, and a bound on the answer wherever `lost` events placed them.
 */
export const DEATH_SQUARES = 1024;
/** The levels a `lost` event can name (`events.ts`), and so the level answers there can be. */
export const LEVELS = 256;
/**
 * The ticks a won game's clock may run past its play time's VBLs. A tick falls due at most
 * once a VBL, asleep (`d.Speed` 0, `LoopState.speed`), and every 15 awake; the game's
 * opening tick comes before its first VBL, and a due tick waits while the game is frozen,
 * which the play time leaves out (`Game.playTime`). A second's slack holds them.
 */
const CLOCK_SLACK_TICKS = VBL_FREQUENCY;

/** A set as the answers name it: the `data_sets` table's id and name. */
export interface StatsSet {
    id: string;
    name: string;
}

/** `api/stats`: every public set, and their totals. Aggregates only. */
export interface StatsSummary {
    /** Distinct players of the sets' games, ever. */
    players: number;
    /** The time played, in ms: the sum of each game's largest play time reported (`games.played`). */
    playTime: number;
    sessions: number;
    started: number;
    won: number;
    /** Sessions and games started per week (from Monday, UTC), all sets together, the weeks with one. */
    weeks: { week: string; sessions: number; started: number }[];
    /** Each set, by play time, decreasing, then by games started, decreasing, then by name. */
    sets: (StatsSet & { playTime: number; sessions: number; started: number; won: number; deaths: number })[];
}

/** A won game as a set's answer lists it. */
export interface Win {
    /** Its day, `YYYY-MM-DD`, UTC. */
    day: string;
    /** The game clock, in ticks, and the play time, in ms, the page sent. */
    gameTime: number;
    playTime: number;
    champions: CheckedChampion[];
}

/** `api/stats/<set>/<level>`: the lost games on each of a set's level's squares. */
export interface LevelStats extends StatsSet {
    level: number;
    /** The most first, at most `DEATH_SQUARES`, then by x and y. */
    deaths: { x: number; y: number; count: number }[];
}

/** `api/stats/<set>`: one set's aggregates. Never an event, a player or a playthrough. */
export interface SetStats extends StatsSet {
    players: number;
    /** The time played, in ms, as the summary's. */
    playTime: number;
    sessions: number;
    started: number;
    won: number;
    /** The games a champion was ever in a party of. */
    parties: number;
    /** The lost games, every one: a party may die several times in a game. */
    died: number;
    /**
     * The fastest wins by game clock, then the earlier, then the game first received, of the
     * games whose start was received and whose clock its play time could have run
     * (`CLOCK_SLACK_TICKS`).
     */
    fastest: Win[];
    /** The lost games on each level, by level: its squares are the level's answer. */
    levels: { level: number; count: number }[];
    /** The games a champion was in a party of, and won, by their mirror's name (`picks`), the most first. */
    champions: { name: string; games: number; won: number }[];
    /** Sessions, games started and games won per week, the weeks with one. */
    weeks: { week: string; sessions: number; started: number; won: number }[];
}

export class StatsStore {
    private readonly db: DatabaseSync;
    private readonly insert: StatementSync;
    private readonly addGame: StatementSync;
    private readonly start: StatementSync;
    private readonly win: StatementSync;
    private readonly die: StatementSync;
    private readonly picks: PickStatements;
    private readonly play: StatementSync;
    private readonly session: StatementSync;
    private readonly maxEvents: number;
    /** The log's rows. */
    private rows: number;

    constructor(db: DatabaseSync, maxEvents = MAX_EVENTS) {
        this.db = db;
        this.maxEvents = maxEvents;
        this.db.exec(EVENTS_SCHEMA);
        const kept = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'games'").get() !== undefined;
        const played = kept && this.db.prepare("SELECT 1 FROM pragma_table_info('games') WHERE name = 'played'").get() !== undefined;
        const slotted = kept && this.db.prepare("SELECT 1 FROM pragma_table_info('picks') WHERE name = 'slot'").get() !== undefined;
        const once = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'events_once'").get() !== undefined;
        this.coarsenTimes(kept);
        let wonTwice = false;
        if (!once) wonTwice = this.keepFirsts();
        if (!kept) this.db.exec(AGGREGATES_SCHEMA + PICKS_SCHEMA);
        if (kept && (!slotted || wonTwice)) {
            this.transaction(() => {
                this.db.exec(`DROP TABLE picks; ${PICKS_SCHEMA}`);
                this.fillPicks();
            });
        }
        if (!played) {
            this.transaction(() => {
                this.db.exec(SESSIONS_SCHEMA);
                if (kept) this.fillPlayed();
            });
        }
        this.insert = this.db.prepare(
            'INSERT INTO events (time, player, type, data_set, playthrough, build, payload) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING');
        this.addGame = this.db.prepare('INSERT INTO games (data_set, playthrough, player) VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
        this.start = this.db.prepare('UPDATE games SET started = MIN(IFNULL(started, ?1), ?1) WHERE data_set = ?2 AND playthrough = ?3');
        this.win = this.db.prepare(
            'UPDATE games SET won = ?, game_time = ?, play_time = ?, champions = ? WHERE data_set = ? AND playthrough = ? AND won IS NULL');
        this.die = this.db.prepare(
            'INSERT INTO deaths (data_set, level, x, y, count) VALUES (?, ?, ?, ?, 1) ON CONFLICT DO UPDATE SET count = count + 1');
        this.picks = this.preparePicks();
        this.play = this.db.prepare('UPDATE games SET played = MAX(IFNULL(played, ?1), ?1) WHERE data_set = ?2 AND playthrough = ?3');
        this.session = this.db.prepare(`
            INSERT INTO sessions (data_set, week, count) VALUES (?1, ${week('?2')}, 1) ON CONFLICT DO UPDATE SET count = count + 1`);
        if (!kept) this.fillAggregates();
        this.rows = (this.db.prepare('SELECT COUNT(*) AS rows FROM events').get() as { rows: number }).rows;
    }

    /**
     * `event`, received at `received` (ms since the epoch), kept at its `TIME_GRAIN`: in the
     * log and its aggregates, or a `session` in its aggregates alone.
     * A game's second `started` or `won` is taken and changes nothing (`ONCE_SCHEMA`). False
     * when the log is full, at `maxEvents` rows, and `event` is not a `session`: nothing of it
     * is kept.
     */
    record(event: CheckedEvent, received: number): boolean {
        if (event.type !== 'session' && this.rows >= this.maxEvents) return false;
        const time = received - received % TIME_GRAIN;
        let added = 0;
        this.transaction(() => {
            if (event.type !== 'session') {
                added = Number(this.insert.run(time, event.player, event.type, event.set, event.playthrough, event.build, JSON.stringify(event.payload)).changes);
                if (added === 0) return;
            }
            this.keep(event, time);
        });
        this.rows += added;
        return true;
    }

    /** The answer to `api/stats` for `sets`, the public ones: nothing of any other set. */
    summary(sets: readonly StatsSet[]): StatsSummary {
        const ids = JSON.stringify(sets.map((set) => set.id));
        const of = 'data_set IN (SELECT value FROM json_each(?))';
        const { players } = this.db.prepare(`SELECT COUNT(DISTINCT player) AS players FROM games WHERE ${of}`).get(ids) as { players: number };
        const weeks = this.db.prepare(`
            SELECT week, SUM(sessions) AS sessions, SUM(started) AS started FROM (
                SELECT week, count AS sessions, 0 AS started FROM sessions WHERE ${of}
                UNION ALL
                SELECT ${week('started')}, 0, 1 FROM games WHERE ${of} AND started IS NOT NULL)
            GROUP BY 1 ORDER BY 1`).all(ids, ids) as StatsSummary['weeks'];
        const games = new Map((this.db.prepare(`
            SELECT data_set AS id, IFNULL(SUM(played), 0) AS playTime, COUNT(started) AS started, COUNT(won) AS won FROM games
            WHERE ${of} GROUP BY 1`).all(ids) as { id: string; playTime: number; started: number; won: number }[]).map((row) => [row.id, row]));
        const sessions = new Map((this.db.prepare(`SELECT data_set AS id, SUM(count) AS sessions FROM sessions WHERE ${of} GROUP BY 1`)
            .all(ids) as { id: string; sessions: number }[]).map((row) => [row.id, row.sessions]));
        const deaths = new Map((this.db.prepare(`SELECT data_set AS id, SUM(count) AS deaths FROM deaths WHERE ${of} GROUP BY 1`)
            .all(ids) as { id: string; deaths: number }[]).map((row) => [row.id, row.deaths]));
        const rows = sets.map(({ id, name }) => ({
            id, name, playTime: games.get(id)?.playTime ?? 0, sessions: sessions.get(id) ?? 0,
            started: games.get(id)?.started ?? 0, won: games.get(id)?.won ?? 0, deaths: deaths.get(id) ?? 0,
        }));
        rows.sort((a, b) => b.playTime - a.playTime || b.started - a.started || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        const sum = (key: 'playTime' | 'sessions' | 'started' | 'won') => rows.reduce((total, row) => total + row[key], 0);
        return { players, playTime: sum('playTime'), sessions: sum('sessions'), started: sum('started'), won: sum('won'), weeks, sets: rows };
    }

    /** The answer to `api/stats/<set>`. */
    setStats({ id, name }: StatsSet): SetStats {
        const totals = this.db.prepare(`
            SELECT COUNT(DISTINCT player) AS players, IFNULL(SUM(played), 0) AS playTime,
                   (SELECT IFNULL(SUM(count), 0) FROM sessions WHERE data_set = ?1) AS sessions,
                   COUNT(started) AS started, COUNT(won) AS won FROM games WHERE data_set = ?1`)
            .get(id) as { players: number; playTime: number; sessions: number; started: number; won: number };
        const { parties } = this.db.prepare('SELECT COUNT(DISTINCT playthrough) AS parties FROM picks WHERE data_set = ?').get(id) as { parties: number };
        const levels = this.db.prepare('SELECT level, SUM(count) AS count FROM deaths WHERE data_set = ? GROUP BY 1 ORDER BY 1')
            .all(id) as SetStats['levels'];
        const fastest = this.db.prepare(`
            SELECT date(won / 1000, 'unixepoch') AS day, game_time AS gameTime, play_time AS playTime, champions FROM games
            WHERE data_set = ? AND won IS NOT NULL AND started IS NOT NULL
              AND game_time * 1000 <= play_time * ${VBL_FREQUENCY} + ${CLOCK_SLACK_TICKS * 1000}
            ORDER BY game_time, won, rowid LIMIT ${FASTEST_WINS}`).all(id).map((row) => ({
            day: row.day as string, gameTime: row.gameTime as number, playTime: row.playTime as number,
            champions: JSON.parse(row.champions as string) as CheckedChampion[],
        }));
        const champions = this.db.prepare(`
            SELECT p.name AS name, COUNT(*) AS games, COUNT(g.won) AS won FROM picks p
            JOIN games g ON g.data_set = p.data_set AND g.playthrough = p.playthrough
            WHERE p.data_set = ? GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${TOP_CHAMPIONS}`).all(id) as SetStats['champions'];
        const weeks = this.db.prepare(`
            SELECT week, SUM(sessions) AS sessions, SUM(started) AS started, SUM(won) AS won FROM (
                SELECT week, count AS sessions, 0 AS started, 0 AS won FROM sessions WHERE data_set = ?1
                UNION ALL
                SELECT ${week('started')}, 0, 1, 0 FROM games WHERE data_set = ?1 AND started IS NOT NULL
                UNION ALL
                SELECT ${week('won')}, 0, 0, 1 FROM games WHERE data_set = ?1 AND won IS NOT NULL)
            GROUP BY 1 ORDER BY 1`).all(id) as SetStats['weeks'];
        const died = levels.reduce((sum, level) => sum + level.count, 0);
        return { id, name, ...totals, parties, died, fastest, levels, champions, weeks };
    }

    /** The answer to `api/stats/<set>/<level>`. */
    levelStats({ id, name }: StatsSet, level: number): LevelStats {
        const deaths = this.db.prepare(`SELECT x, y, count FROM deaths WHERE data_set = ? AND level = ? ORDER BY count DESC, x, y LIMIT ${DEATH_SQUARES}`)
            .all(id, level) as LevelStats['deaths'];
        return { id, name, level, deaths };
    }

    /**
     * The aggregates `event` adds to. A `session` counts in its week, and raises its game's
     * play time where the game has a row: it makes none, as that would keep its player.
     */
    private keep(event: Pick<CheckedEvent, 'type' | 'player' | 'set' | 'playthrough' | 'payload'>, time: number): void {
        const { set, playthrough, payload } = event;
        if (event.type === 'session') {
            this.session.run(set, time);
            this.play.run(payload.playTime as number, set, playthrough);
            return;
        }
        this.addGame.run(set, playthrough, event.player);
        if (event.type === 'started') {
            this.start.run(time, set, playthrough);
            return;
        }
        const champions = payload.champions as CheckedChampion[];
        this.pickParty(this.picks, set, playthrough, champions);
        if (event.type === 'won') this.win.run(time, payload.gameTime as number, payload.playTime as number, JSON.stringify(champions), set, playthrough);
        if (event.type === 'lost') this.die.run(set, payload.level as number, payload.x as number, payload.y as number);
        if (event.type === 'won' || event.type === 'lost') this.play.run(payload.playTime as number, set, playthrough);
    }

    private preparePicks(): PickStatements {
        return {
            joined: this.db.prepare('INSERT INTO picks (data_set, playthrough, name, slot) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'),
            read: this.db.prepare(`
                INSERT INTO picks (data_set, playthrough, name, slot) SELECT ?1, ?2, ?3, ?4
                WHERE NOT EXISTS (SELECT 1 FROM picks WHERE data_set = ?1 AND playthrough = ?2 AND slot = ?4)
                ON CONFLICT DO NOTHING`),
        };
    }

    /**
     * A game's party, in the order of its slots, its picks: each champion by their mirror's
     * name, a reincarnated one's `hero`, so that a name typed at REINCARNATE counts as the
     * champion it renamed. A champion read from a save (`id` null) carries no `hero`, and may
     * carry a typed name: they count only where their slot has no pick, their join, if it
     * was seen, having named them already.
     */
    private pickParty(picks: PickStatements, set: string, playthrough: number, champions: CheckedChampion[]): void {
        champions.forEach((champion, slot) => {
            (champion.id === null ? picks.read : picks.joined).run(set, playthrough, champion.hero ?? champion.name, slot);
        });
    }

    /**
     * A store made before `ONCE_SCHEMA` is given it: of each game's `started` and `won`
     * events, the first alone is kept, which the aggregates kept already, but a later win's
     * party, among the picks. Whether a `won` was dropped, so that the picks are made again.
     */
    private keepFirsts(): boolean {
        let wonTwice = false;
        this.transaction(() => {
            const later = (type: string) => Number(this.db.prepare(`
                DELETE FROM events WHERE type = ?1 AND id NOT IN (SELECT MIN(id) FROM events WHERE type = ?1 GROUP BY data_set, playthrough)`)
                .run(type).changes);
            later('started');
            wonTwice = later('won') > 0;
            this.db.exec(ONCE_SCHEMA);
        });
        return wonTwice;
    }

    /** `picks` filled from the log, in the order its events arrived, its own statements on a table new in this transaction. */
    private fillPicks(): void {
        const picks = this.preparePicks();
        for (const row of this.db.prepare("SELECT data_set, playthrough, payload FROM events WHERE type IN ('party', 'won', 'lost') ORDER BY id").iterate()) {
            const { champions } = JSON.parse(row.payload as string) as { champions: CheckedChampion[] };
            this.pickParty(picks, row.data_set as string, row.playthrough as number, champions);
        }
    }

    /** A store made before `TIME_GRAIN`: its times rounded down to it, which changes no answer. */
    private coarsenTimes(kept: boolean): void {
        const coarse = (time: string) => `${time} = ${time} - ${time} % ${TIME_GRAIN}`;
        this.transaction(() => {
            this.db.exec(`UPDATE events SET ${coarse('time')} WHERE time % ${TIME_GRAIN} <> 0`);
            if (kept) this.db.exec(`UPDATE games SET ${coarse('started')}, ${coarse('won')} WHERE started % ${TIME_GRAIN} <> 0 OR won % ${TIME_GRAIN} <> 0`);
        });
    }

    /** The new tables filled from the log, in the order its events arrived. */
    private fillAggregates(): void {
        this.transaction(() => {
            for (const row of this.db.prepare('SELECT time, player, type, data_set, playthrough, payload FROM events ORDER BY id').iterate()) {
                this.keep({
                    type: row.type as CheckedEvent['type'], player: row.player as string, set: row.data_set as string,
                    playthrough: row.playthrough as number, payload: JSON.parse(row.payload as string) as CheckedEvent['payload'],
                }, row.time as number);
            }
        });
    }

    /**
     * A store made before the sessions: each game's play time, the largest of its `won` and
     * `lost` events', from the log. It had no session to count.
     */
    private fillPlayed(): void {
        this.db.exec(`
            UPDATE games SET played = (
                SELECT MAX(json_extract(payload, '$.playTime')) FROM events e
                WHERE e.type IN ('won', 'lost') AND e.data_set = games.data_set AND e.playthrough = games.playthrough)`);
    }

    private transaction(change: () => void): void {
        this.db.exec('BEGIN');
        try {
            change();
            this.db.exec('COMMIT');
        } catch (error) {
            // An I/O error, a full disk or memory has rolled it back already, and a
            // `ROLLBACK` would throw over `error`.
            if (this.db.isTransaction) this.db.exec('ROLLBACK');
            throw error;
        }
    }
}

/** How long `api/stats`'s answers are kept, and what their `Cache-Control` says. */
export const STATS_CACHE_MS = 30_000;

/**
 * Answers kept for `lifetime` ms by key, so that a loop of requests costs a lookup: the
 * summary's, and each public set's and its `LEVELS` levels'. Each miss drops the expired ones.
 */
export class AnswerCache {
    private readonly answers = new Map<string, { body: string; expires: number }>();
    private readonly lifetime: number;
    private readonly now: () => number;

    constructor(lifetime: number, now: () => number) {
        this.lifetime = lifetime;
        this.now = now;
    }

    get(key: string, make: () => string): string {
        const now = this.now();
        const kept = this.answers.get(key);
        if (kept !== undefined && kept.expires > now) return kept.body;
        for (const [other, answer] of this.answers) if (answer.expires <= now) this.answers.delete(other);
        const body = make();
        this.answers.set(key, { body, expires: now + this.lifetime });
        return body;
    }
}
