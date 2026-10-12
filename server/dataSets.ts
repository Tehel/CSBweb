/**
 * The data sets the site offers (`doc/DEPLOYMENT.md` → "The game files and the
 * manifest"): the store's `data_sets` table (`store.ts`), one row per set, and
 * `data_set_defaults`, one row naming the default set and the FTL logo's folder. `api/data-sets` and `api/event` read them at
 * each request (`app.ts`), so a set added while the server runs is offered at once.
 *
 * An empty table is filled once, at start-up, from the manifest (`checkFiles`, `app.ts`),
 * every set approved and the author's. After that the server reads no manifest file.
 */
import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { DataSet, DataSetManifest } from '../src/data/DataSets.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS data_sets (
    id           TEXT    PRIMARY KEY,  -- the page's ?dungeon=
    name         TEXT    NOT NULL,
    dir          TEXT    NOT NULL,     -- its folder, relative to GAMEFILES_DIR
    position     INTEGER NOT NULL UNIQUE,  -- its place in the list, ascending
    status       TEXT    NOT NULL CHECK (status IN ('approved', 'pending')),
    owner        TEXT,                 -- its uploader's playerId, NULL for the author's
    csb_graphics INTEGER NOT NULL DEFAULT 0,  -- DataSet's flags, 0 or 1
    mini_dat     INTEGER NOT NULL DEFAULT 0,
    hint_oracle  INTEGER NOT NULL DEFAULT 0,
    dm_rules     INTEGER NOT NULL DEFAULT 0,
    hidden       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS data_set_defaults (
    only         INTEGER PRIMARY KEY CHECK (only = 1),
    default_set  TEXT    NOT NULL REFERENCES data_sets (id),
    swoosh       TEXT                  -- the FTL logo's folder, relative to GAMEFILES_DIR, or NULL
);
`;

type Flag = 'csbGraphics' | 'miniDat' | 'hintOracle' | 'dmRules' | 'hidden';

/** `DataSet`'s flags and their columns, in the manifest's order. */
const FLAG_COLUMNS: readonly (readonly [Flag, string])[] = [
    ['csbGraphics', 'csb_graphics'], ['miniDat', 'mini_dat'], ['hintOracle', 'hint_oracle'], ['dmRules', 'dm_rules'], ['hidden', 'hidden'],
];

export type DataSetStatus = 'approved' | 'pending';

/** A row: the set, its folder relative to `GAMEFILES_DIR`, and who may see it. */
export interface StoredDataSet extends DataSet {
    status: DataSetStatus;
    /** Its uploader's `playerId`, `null` for the author's. */
    owner: string | null;
}

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

    constructor(db: DatabaseSync) {
        this.db = db;
        db.exec(SCHEMA);
        const flags = FLAG_COLUMNS.map(([, column]) => column);
        this.count = db.prepare('SELECT COUNT(*) AS n FROM data_sets');
        this.hasRow = db.prepare('SELECT 1 FROM data_sets WHERE id = ?');
        this.rows = db.prepare(`SELECT id, name, dir, status, owner, ${flags.join(', ')} FROM data_sets ORDER BY position`);
        this.defaults = db.prepare('SELECT default_set, swoosh FROM data_set_defaults');
        this.insert = db.prepare(
            `INSERT INTO data_sets (id, name, dir, position, status, owner, ${flags.join(', ')}) VALUES (?, ?, ?, ?, 'approved', NULL, ${flags.map(() => '?').join(', ')})`);
        this.insertDefaults = db.prepare('INSERT INTO data_set_defaults (only, default_set, swoosh) VALUES (1, ?, ?)');
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
     * `GAMEFILES_DIR` (`parseManifest(text, '')`): every set approved and the author's, in
     * the manifest's order. All of it or nothing.
     */
    fill(manifest: DataSetManifest): void {
        if (!this.isEmpty()) throw new Error('the data_sets table is not empty');
        this.db.exec('BEGIN');
        try {
            manifest.dataSets.forEach((set, position) => {
                this.insert.run(set.id, set.name, set.dir, position, ...FLAG_COLUMNS.map(([flag]) => (set[flag] ? 1 : 0)));
            });
            this.insertDefaults.run(manifest.defaultSet.id, manifest.swooshDir);
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    read(): StoredDataSets {
        const defaults = this.defaults.get() as { default_set: string; swoosh: string | null } | undefined;
        if (defaults === undefined) throw new Error('the data_set_defaults table names no default set');
        const dataSets = (this.rows.all() as Record<string, string | number | null>[]).map((row): StoredDataSet => {
            const set: StoredDataSet = {
                id: row.id as string, name: row.name as string, dir: row.dir as string,
                csbGraphics: false, miniDat: false, hintOracle: false, dmRules: false, hidden: false,
                status: row.status as DataSetStatus, owner: row.owner as string | null,
            };
            for (const [flag, column] of FLAG_COLUMNS) set[flag] = row[column] === 1;
            return set;
        });
        return { dataSets, defaultId: defaults.default_set, swooshDir: defaults.swoosh };
    }
}

/**
 * The answer to `api/data-sets`: the approved sets of `stored`, as a manifest
 * `parseManifest` reads. A `dir` is left out where it is the id, and a flag where it is
 * false, as the repository's manifest does.
 */
export function manifestText(stored: StoredDataSets): string {
    const dataSets = stored.dataSets.filter((set) => set.status === 'approved').map((set) => {
        const entry: Record<string, string | boolean> = { id: set.id, name: set.name };
        if (set.dir !== set.id) entry.dir = set.dir;
        for (const [flag] of FLAG_COLUMNS) if (set[flag]) entry[flag] = true;
        return entry;
    });
    return JSON.stringify({ default: stored.defaultId, swoosh: stored.swooshDir, dataSets });
}
