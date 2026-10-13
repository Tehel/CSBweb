/**
 * The data sets the site offers (`doc/DEPLOYMENT.md` → "The game files and the
 * manifest"): the store's `data_sets` table (`store.ts`), one row per set, and
 * `data_set_defaults`, one row naming the default set and the FTL logo's folder. `api/data-sets` and `api/event` read them at
 * each request (`app.ts`), so a set added while the server runs is offered at once.
 *
 * A set is approved or pending. An approved set is offered to everyone; a pending one, a
 * player's, published by `publish.ts` (`DataSetStore.publish`), to its owner and the
 * moderators only (`manifestText`). Ownership, and
 * moderation, rest on the `playerId` alone, a secret (`src/ui/gameEvents.ts`), so no answer
 * holds one.
 *
 * An empty table is filled once, at start-up, from the manifest (`checkFiles`, `app.ts`),
 * every set the site's, with no owner, and approved unless it says `"status": "pending"`. After that the
 * server reads no manifest file.
 */
import { timingSafeEqual } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { DataSet, DataSetManifest } from '../src/data/DataSets.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS data_sets (
    id           TEXT    PRIMARY KEY,  -- the page's ?dungeon=
    name         TEXT    NOT NULL,
    dir          TEXT    NOT NULL,     -- its folder, relative to GAMEFILES_DIR
    position     INTEGER NOT NULL UNIQUE,  -- its place in the list, ascending
    status       TEXT    NOT NULL CHECK (status IN ('approved', 'pending')),
    owner        TEXT,                 -- its uploader's playerId, NULL for the site's
    csb_graphics INTEGER NOT NULL DEFAULT 0,  -- DataSet's flags, 0 or 1
    mini_dat     INTEGER NOT NULL DEFAULT 0,
    hint_oracle  INTEGER NOT NULL DEFAULT 0,
    dm_rules     INTEGER NOT NULL DEFAULT 0,
    hidden       INTEGER NOT NULL DEFAULT 0
    -- and ADDED_COLUMNS
);
CREATE TABLE IF NOT EXISTS data_set_defaults (
    only         INTEGER PRIMARY KEY CHECK (only = 1),
    default_set  TEXT    NOT NULL REFERENCES data_sets (id),
    swoosh       TEXT                  -- the FTL logo's folder, relative to GAMEFILES_DIR, or NULL
);
`;

/**
 * The columns `data_sets` gained after its first deployment, which a table made before
 * them is altered to add (`ALTER TABLE … ADD COLUMN`), and a new one is too, so that both
 * are the same table. A published set's (`server/publish.ts`); the site's are empty.
 */
const ADDED_COLUMNS: readonly (readonly [string, string])[] = [
    ['description', "TEXT NOT NULL DEFAULT ''"],
    ['authors', "TEXT NOT NULL DEFAULT '[]'"],  // a JSON list of strings
];

type Flag = 'csbGraphics' | 'miniDat' | 'hintOracle' | 'dmRules' | 'hidden';

/** `DataSet`'s flags and their columns, in the manifest's order. */
const FLAG_COLUMNS: readonly (readonly [Flag, string])[] = [
    ['csbGraphics', 'csb_graphics'], ['miniDat', 'mini_dat'], ['hintOracle', 'hint_oracle'], ['dmRules', 'dm_rules'], ['hidden', 'hidden'],
];

/**
 * A row: the set, its folder relative to `GAMEFILES_DIR`, and who may see it: everyone, or
 * while it is `pending` (the `status` column's `'pending'`), its owner and the moderators.
 */
export interface StoredDataSet extends DataSet {
    /** Its uploader's `playerId`, `null` for the site's: the manifest's, uploaded by hand. */
    owner: string | null;
}

/** Who asks `api/data-sets`. */
export interface DataSetViewer {
    /** Their `playerId`, from the request's `PLAYER_ID_HEADER`, or `null` for none or a malformed one. */
    playerId: string | null;
    /** Whether that id is a moderator's, one of the server's `MODERATOR_PLAYER_IDS`. */
    moderator: boolean;
}

/** A player's set, as `publish` stores it: its folder is its id. */
export interface PublishedDataSet {
    id: string;
    name: string;
    description: string;
    authors: readonly string[];
    csbGraphics: boolean;
    hintOracle: boolean;
    dmRules: boolean;
}

/** Everyone: no `playerId`, not a moderator. */
export const ANYONE: DataSetViewer = { playerId: null, moderator: false };

/** Both tables, read. */
export interface StoredDataSets {
    /** In the table's order. */
    dataSets: StoredDataSet[];
    defaultId: string;
    swooshDir: string | null;
}

export class DataSetStore {
    private readonly db: DatabaseSync;
    private readonly count: StatementSync;
    private readonly hasRow: StatementSync;
    private readonly rows: StatementSync;
    private readonly defaults: StatementSync;
    private readonly insert: StatementSync;
    private readonly insertDefaults: StatementSync;
    private readonly insertPublished: StatementSync;

    constructor(db: DatabaseSync) {
        this.db = db;
        db.exec(SCHEMA);
        const columns = new Set((db.prepare('PRAGMA table_info(data_sets)').all() as { name: string }[]).map((column) => column.name));
        for (const [column, type] of ADDED_COLUMNS) {
            if (!columns.has(column)) db.exec(`ALTER TABLE data_sets ADD COLUMN ${column} ${type}`);
        }
        const flags = FLAG_COLUMNS.map(([, column]) => column);
        this.count = db.prepare('SELECT COUNT(*) AS n FROM data_sets');
        this.hasRow = db.prepare('SELECT 1 FROM data_sets WHERE id = ?');
        this.rows = db.prepare(`SELECT id, name, dir, status, owner, ${flags.join(', ')} FROM data_sets ORDER BY position`);
        this.defaults = db.prepare('SELECT default_set, swoosh FROM data_set_defaults');
        this.insert = db.prepare(
            `INSERT INTO data_sets (id, name, dir, position, status, owner, ${flags.join(', ')}) VALUES (?, ?, ?, ?, ?, NULL, ${flags.map(() => '?').join(', ')})`);
        this.insertDefaults = db.prepare('INSERT INTO data_set_defaults (only, default_set, swoosh) VALUES (1, ?, ?)');
        this.insertPublished = db.prepare(
            `INSERT INTO data_sets (id, name, dir, position, status, owner, description, authors, ${flags.join(', ')}) `
            + `VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM data_sets), 'pending', ?, ?, ?, ${flags.map(() => '?').join(', ')})`);
    }

    isEmpty(): boolean {
        return (this.count.get() as { n: number }).n === 0;
    }

    /** Whether `id` is a set of the table's, pending or not: `api/event`'s known sets. */
    hasSet(id: string): boolean {
        return this.hasRow.get(id) !== undefined;
    }

    /**
     * Fills the empty tables from `manifest`, parsed with its folders relative to
     * `GAMEFILES_DIR` (`parseManifest(text, '')`): every set the site's, approved unless it
     * says it is pending, in the manifest's order. All of it or nothing.
     */
    fill(manifest: DataSetManifest): void {
        if (!this.isEmpty()) throw new Error('the data_sets table is not empty');
        this.db.exec('BEGIN');
        try {
            manifest.dataSets.forEach((set, position) => {
                this.insert.run(set.id, set.name, set.dir, position, set.pending ? 'pending' : 'approved', ...FLAG_COLUMNS.map(([flag]) => (set[flag] ? 1 : 0)));
            });
            this.insertDefaults.run(manifest.defaultSet.id, manifest.swooshDir);
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    /**
     * Adds `set`, published by `owner`, as a pending row last in the list, its folder its id,
     * with no `mini.dat` and not hidden. Throws where the id is taken.
     */
    publish(set: PublishedDataSet, owner: string): void {
        const flags: Record<Flag, boolean> = { csbGraphics: set.csbGraphics, miniDat: false, hintOracle: set.hintOracle, dmRules: set.dmRules, hidden: false };
        this.insertPublished.run(set.id, set.name, set.id, owner, set.description, JSON.stringify(set.authors),
            ...FLAG_COLUMNS.map(([flag]) => (flags[flag] ? 1 : 0)));
    }

    read(): StoredDataSets {
        const defaults = this.defaults.get() as { default_set: string; swoosh: string | null } | undefined;
        if (defaults === undefined) throw new Error('the data_set_defaults table names no default set');
        const dataSets = (this.rows.all() as Record<string, string | number | null>[]).map((row): StoredDataSet => {
            const set: StoredDataSet = {
                id: row.id as string, name: row.name as string, dir: row.dir as string,
                csbGraphics: false, miniDat: false, hintOracle: false, dmRules: false, hidden: false,
                pending: row.status === 'pending', owner: row.owner as string | null,
            };
            for (const [flag, column] of FLAG_COLUMNS) set[flag] = row[column] === 1;
            return set;
        });
        return { dataSets, defaultId: defaults.default_set, swooshDir: defaults.swoosh };
    }
}

/**
 * The answer to `api/data-sets` for `viewer`: the sets of `stored` they may see, as a
 * manifest `parseManifest` reads. Everyone sees the approved sets, a player also their own
 * pending ones, and a moderator every set. A pending set says `"status": "pending"`, and no
 * set says its owner. A `dir` is left out where it is the id, and a flag where it is false,
 * as the repository's manifest does. A moderator's answer says `"moderator": true`, so that
 * the page shows them the hidden sets too: it tells them nothing they do not hold.
 */
export function manifestText(stored: StoredDataSets, viewer: DataSetViewer): string {
    const visible = (set: StoredDataSet) => !set.pending || viewer.moderator
        || (viewer.playerId !== null && set.owner !== null && samePlayerId(set.owner, viewer.playerId));
    const dataSets = stored.dataSets.filter(visible).map((set) => {
        const entry: Record<string, string | boolean> = { id: set.id, name: set.name };
        if (set.dir !== set.id) entry.dir = set.dir;
        for (const [flag] of FLAG_COLUMNS) if (set[flag]) entry[flag] = true;
        if (set.pending) entry.status = 'pending';
        return entry;
    });
    return JSON.stringify({ default: stored.defaultId, swoosh: stored.swooshDir, ...(viewer.moderator ? { moderator: true } : {}), dataSets });
}

/** Whether two `playerId`s are the same, compared in a time that does not say how much of them matches. */
export function samePlayerId(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
