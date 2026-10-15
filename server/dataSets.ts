/**
 * The data sets the site offers (`doc/DEPLOYMENT.md` → "The game files and the
 * manifest"): the store's `data_sets` table (`store.ts`), one row per set, and
 * `data_set_defaults`, one row naming the default set. `api/data-sets` and `api/event` read them at
 * each request (`app.ts`), so a set added while the server runs is offered at once.
 *
 * A set is approved or pending. An approved set is offered to everyone; a pending one, a
 * player's, published by `publish.ts` (`DataSetStore.publish`), to its owner and the
 * moderators only (`manifestText`). A moderator approves, rejects, hides and shows a set
 * (`moderate.ts`). A published set's row keeps its dungeon's walls, which
 * `api/data-set-walls` answers (`wallsText`), so that the page can name the set a save
 * dropped in another is of. Ownership, and
 * moderation, rest on the `playerId` alone, a secret (`src/ui/gameEvents.ts`), so no answer
 * holds one.
 *
 * A new server's tables are empty, and it answers no set until rows are written: the site's
 * by hand (`doc/DEPLOYMENT.md`), a player's by a publish. The server reads no manifest.
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
    default_set  TEXT    NOT NULL REFERENCES data_sets (id)
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
    ['walls', 'TEXT'],  // a JSON DataSetWalls, NULL for the site's and until `fillWalls` reads it
    ['thumbnail_as_title', 'INTEGER NOT NULL DEFAULT 0'],  // DataSet's flag, 0 or 1
];

type Flag = 'csbGraphics' | 'miniDat' | 'hintOracle' | 'dmRules' | 'thumbnailAsTitle' | 'hidden';

/** `DataSet`'s flags and their columns, in the manifest's order. */
const FLAG_COLUMNS: readonly (readonly [Flag, string])[] = [
    ['csbGraphics', 'csb_graphics'], ['miniDat', 'mini_dat'], ['hintOracle', 'hint_oracle'], ['dmRules', 'dm_rules'],
    ['thumbnailAsTitle', 'thumbnail_as_title'], ['hidden', 'hidden'],
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

/**
 * A dungeon's walls, as the page's check reads them from its `dungeon.dat` (`DungeonWalls`,
 * `src/data/DungeonSignature.ts`): each level's width and height, and its digest.
 */
export interface DataSetWalls {
    shapes: readonly (readonly [number, number])[];
    signature: readonly string[];
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
    thumbnailAsTitle: boolean;
    walls: DataSetWalls;
}

/** Everyone: no `playerId`, not a moderator. */
export const ANYONE: DataSetViewer = { playerId: null, moderator: false };

/** Both tables, read. */
export interface StoredDataSets {
    /** In the table's order. */
    dataSets: StoredDataSet[];
    /** `data_set_defaults`'s default set, `null` while it has no row. */
    defaultId: string | null;
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
    private readonly wallsRows: StatementSync;
    private readonly wallsMissing: StatementSync;
    private readonly updateWalls: StatementSync;
    private readonly updateApproved: StatementSync;
    private readonly updateHidden: StatementSync;
    private readonly deleteRow: StatementSync;

    constructor(db: DatabaseSync) {
        this.db = db;
        db.exec(SCHEMA);
        const columns = new Set((db.prepare('PRAGMA table_info(data_sets)').all() as { name: string }[]).map((column) => column.name));
        for (const [column, type] of ADDED_COLUMNS) {
            if (!columns.has(column)) db.exec(`ALTER TABLE data_sets ADD COLUMN ${column} ${type}`);
        }
        // The FTL logo's folder, which the defaults named before the logo was the page's own (`src/assets/`).
        const defaultsColumns = (db.prepare('PRAGMA table_info(data_set_defaults)').all() as { name: string }[]).map((column) => column.name);
        if (defaultsColumns.includes('swoosh')) db.exec('ALTER TABLE data_set_defaults DROP COLUMN swoosh');
        const flags = FLAG_COLUMNS.map(([, column]) => column);
        this.count = db.prepare('SELECT COUNT(*) AS n FROM data_sets');
        this.hasRow = db.prepare('SELECT 1 FROM data_sets WHERE id = ?');
        this.rows = db.prepare(`SELECT id, name, description, authors, dir, status, owner, ${flags.join(', ')} FROM data_sets ORDER BY position`);
        this.defaults = db.prepare('SELECT default_set FROM data_set_defaults');
        this.insert = db.prepare(
            `INSERT INTO data_sets (id, name, description, authors, dir, position, status, owner, ${flags.join(', ')}) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ${flags.map(() => '?').join(', ')})`);
        this.insertDefaults = db.prepare('INSERT INTO data_set_defaults (only, default_set) VALUES (1, ?)');
        this.insertPublished = db.prepare(
            `INSERT INTO data_sets (id, name, dir, position, status, owner, description, authors, walls, ${flags.join(', ')}) `
            + `VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM data_sets), 'pending', ?, ?, ?, ?, ${flags.map(() => '?').join(', ')})`);
        this.wallsRows = db.prepare('SELECT id, walls FROM data_sets WHERE walls IS NOT NULL');
        this.wallsMissing = db.prepare('SELECT id, dir FROM data_sets WHERE owner IS NOT NULL AND walls IS NULL ORDER BY position');
        this.updateWalls = db.prepare('UPDATE data_sets SET walls = ? WHERE id = ?');
        this.updateApproved = db.prepare("UPDATE data_sets SET status = 'approved' WHERE id = ?");
        this.updateHidden = db.prepare('UPDATE data_sets SET hidden = ? WHERE id = ?');
        this.deleteRow = db.prepare('DELETE FROM data_sets WHERE id = ?');
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
     * says it is pending, in the manifest's order, and `data_set_defaults` where it names a
     * default. All of it or nothing. The server never
     * calls it: the dev server's store (`vite.config.mts`) and `tools/fill-data-sets.ts` do.
     */
    fill(manifest: DataSetManifest): void {
        if (!this.isEmpty()) throw new Error('the data_sets table is not empty');
        this.db.exec('BEGIN');
        try {
            manifest.dataSets.forEach((set, position) => {
                this.insert.run(set.id, set.name, set.description, JSON.stringify(set.authors), set.dir, position, set.pending ? 'pending' : 'approved', ...FLAG_COLUMNS.map(([flag]) => (set[flag] ? 1 : 0)));
            });
            if (manifest.defaultSet) this.insertDefaults.run(manifest.defaultSet.id);
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
        const flags: Record<Flag, boolean> = { csbGraphics: set.csbGraphics, miniDat: false, hintOracle: set.hintOracle, dmRules: set.dmRules,
            thumbnailAsTitle: set.thumbnailAsTitle, hidden: false };
        this.insertPublished.run(set.id, set.name, set.id, owner, set.description, JSON.stringify(set.authors), wallsJson(set.walls),
            ...FLAG_COLUMNS.map(([flag]) => (flags[flag] ? 1 : 0)));
    }

    /** The walls each set keeps, by its id: the published sets', once read. */
    walls(): Map<string, DataSetWalls> {
        const rows = this.wallsRows.all() as { id: string; walls: string }[];
        return new Map(rows.map((row) => [row.id, JSON.parse(row.walls) as DataSetWalls]));
    }

    /** The sets with an owner whose walls are not kept yet, in the list's order: what `fillWalls` reads. */
    missingWalls(): { id: string; dir: string }[] {
        return this.wallsMissing.all() as { id: string; dir: string }[];
    }

    setWalls(id: string, walls: DataSetWalls): void {
        this.updateWalls.run(wallsJson(walls), id);
    }

    /** `id`'s row made approved (`moderate.ts`). */
    approve(id: string): void {
        this.updateApproved.run(id);
    }

    /** `id`'s row hidden, or shown (`moderate.ts`). */
    setHidden(id: string, hidden: boolean): void {
        this.updateHidden.run(hidden ? 1 : 0, id);
    }

    /** `id`'s row deleted (`moderate.ts`, which deletes its folder after). */
    remove(id: string): void {
        this.deleteRow.run(id);
    }

    read(): StoredDataSets {
        const defaults = this.defaults.get() as { default_set: string } | undefined;
        const dataSets = (this.rows.all() as Record<string, string | number | null>[]).map((row): StoredDataSet => {
            const set: StoredDataSet = {
                id: row.id as string, name: row.name as string, description: row.description as string,
                authors: JSON.parse(row.authors as string) as string[], dir: row.dir as string,
                csbGraphics: false, miniDat: false, hintOracle: false, dmRules: false, thumbnailAsTitle: false, hidden: false,
                pending: row.status === 'pending', owner: row.owner as string | null,
            };
            for (const [flag, column] of FLAG_COLUMNS) set[flag] = row[column] === 1;
            return set;
        });
        return { dataSets, defaultId: defaults?.default_set ?? null };
    }
}

/**
 * The answer to `api/data-sets` for `viewer`: the sets of `stored` they may see, as a
 * manifest `parseManifest` reads. Everyone sees the approved sets, a player also their own
 * pending ones, and a moderator every set. A pending set says `"status": "pending"`, and no
 * set says its owner. A `dir` is left out where it is the id, a flag where it is false, and
 * the description and the authors where they are empty, as the repository's manifest does. A moderator's answer says `"moderator": true`, so that
 * the page shows them the hidden sets too: it tells them nothing they do not hold. A table
 * with no set answers an empty list, and one with no `data_set_defaults` row `null` for the
 * default, which the page takes (`parseManifest`).
 */
export function manifestText(stored: StoredDataSets, viewer: DataSetViewer): string {
    const dataSets = visibleSets(stored, viewer).map((set) => {
        const entry: Record<string, string | readonly string[] | boolean> = { id: set.id, name: set.name };
        if (set.description !== '') entry.description = set.description;
        if (set.authors.length > 0) entry.authors = set.authors;
        if (set.dir !== set.id) entry.dir = set.dir;
        for (const [flag] of FLAG_COLUMNS) if (set[flag]) entry[flag] = true;
        if (set.pending) entry.status = 'pending';
        return entry;
    });
    return JSON.stringify({ default: stored.defaultId, ...(viewer.moderator ? { moderator: true } : {}), dataSets });
}

/**
 * The answer to `api/data-set-walls` for `viewer`: `{"dataSets": [{"id", "name", "shapes",
 * "signature"}]}`, the walls of each set of `stored` they may see, as `manifestText` offers
 * it, that keeps them (`walls`), in the table's order. The page reads it with
 * `parsePublishedDungeons` (`src/data/DungeonSignature.ts`).
 */
export function wallsText(stored: StoredDataSets, walls: ReadonlyMap<string, DataSetWalls>, viewer: DataSetViewer): string {
    const dataSets = visibleSets(stored, viewer).flatMap((set) => {
        const kept = walls.get(set.id);
        return kept ? [{ id: set.id, name: set.name, shapes: kept.shapes, signature: kept.signature }] : [];
    });
    return JSON.stringify({ dataSets });
}

/** The sets of `stored` that `viewer` may see: the approved ones, their own pending ones, and every one for a moderator. */
function visibleSets(stored: StoredDataSets, viewer: DataSetViewer): StoredDataSet[] {
    return stored.dataSets.filter((set) => !set.pending || viewer.moderator
        || (viewer.playerId !== null && set.owner !== null && samePlayerId(set.owner, viewer.playerId)));
}

/** `walls` as its column keeps them: nothing but the shapes and the signature. */
function wallsJson(walls: DataSetWalls): string {
    return JSON.stringify({ shapes: walls.shapes, signature: walls.signature });
}

/** Whether two `playerId`s are the same, compared in a time that does not say how much of them matches. */
export function samePlayerId(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
