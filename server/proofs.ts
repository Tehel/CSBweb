/**
 * The proofs of the achievements players unlock (`doc/ACHIEVEMENTS.md` → "Proofs"): the
 * store's `proofs` table (`store.ts`), a row per package sent, and `claims`, a row per
 * achievement a package claims, each package kept whole in `PROOFS_DIR` as `<id>.gz` and
 * never served. `app.ts` takes each request, names its asker (`dataSetViewer`) and reads
 * its body; this module decides.
 *
 *   POST PROOFS_ROUTE                 a package sent with the unlocks it claims, queued (`sendProof`)
 *   GET  PROOFS_ROUTE?ids=<id>,<id>…  the verdicts of the asker's proofs among them (`proofsText`)
 *
 * and the verifier's step, the oldest queued proof replayed and its verdict kept
 * (`verifyNext`).
 *
 * A package is a shared recording's (`doc/RECORDING.md` → "Shared recordings"), read with
 * the page's own reader (`readRecordingPackage`), which checks its form alone: the verifier,
 * a service of its own (`verifier.ts`), replays it later. Only a player with a public name
 * sends one (`identity.ts`): the Hall of Fame shows the verified unlocks by that name. Its
 * claims are listed at once, `unverified`, until the replay says. The replay keeps its
 * history's figures beside them (`proof_figures`), which the Hall works the achievements
 * across games out of (`acrossRows`), so a proof may claim nothing.
 *
 * A proof is its sender's alone: the server keeps their `playerId` with it, and answers its
 * verdicts to the browsers their identity links. No answer holds a `playerId` or a
 * playthrough; a proof is named by its id, drawn by the server and answered once, which
 * the page keeps beside the unlocks it claims.
 */
import { randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

import {
    CLAIM_ID, GAME_FILES, MAX_CLAIMS, parseManifest, PROOF_FIELDS, PROOF_ID, type ClaimState, type DataSet, type ProofState, type ProofVerdict,
} from '../src/data/DataSets.ts';
import { manifestText, type DataSetStore } from './dataSets.ts';
import type { IdentityStore } from './identity.ts';
import { MAX_RECORDING_BYTES, MAX_RECORDING_UNZIPPED_BYTES, type ReadRecordingPackage, type SharedPackage } from './recordings.ts';
import type { FileDigestCache } from './setFiles.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS proofs (
    id           TEXT    PRIMARY KEY,  -- its file's name in PROOFS_DIR, without .gz (PROOF_ID)
    data_set     TEXT    NOT NULL,     -- the set it plays (DataSet.id), as its package says
    player       TEXT    NOT NULL,     -- its sender's playerId, never answered
    build        TEXT    NOT NULL,     -- the build that made it
    level        INTEGER NOT NULL,     -- the engine's level it plays at
    size         INTEGER NOT NULL,     -- its file's, in bytes
    sent_at      INTEGER NOT NULL,     -- ms since the epoch
    state        TEXT    NOT NULL CHECK (state IN ('queued', 'checked', 'drifted')),
    reason       TEXT    NOT NULL DEFAULT '',  -- why it drifted
    checked_at   INTEGER,              -- when the verifier replayed it
    playthrough  INTEGER,              -- d.RandomGameID at its point, as its replay read it; never answered
    kept         INTEGER NOT NULL DEFAULT 1    -- 0 once its file is deleted
);
CREATE INDEX IF NOT EXISTS proofs_queue ON proofs (state, sent_at);
CREATE INDEX IF NOT EXISTS proofs_by_player ON proofs (player);
CREATE TABLE IF NOT EXISTS claims (
    proof        TEXT    NOT NULL REFERENCES proofs (id),
    achievement  TEXT    NOT NULL,     -- its id in the set's file (CLAIM_ID)
    state        TEXT    NOT NULL CHECK (state IN ('unverified', 'verified', 'dropped')),
    claimed      INTEGER NOT NULL DEFAULT 1,  -- 0 for an unlock the replay granted unclaimed
    PRIMARY KEY (proof, achievement)
);
CREATE TABLE IF NOT EXISTS proof_figures (
    proof        TEXT    NOT NULL REFERENCES proofs (id),
    key          TEXT    NOT NULL,     -- a figure's key, games(…) or total(…) (GameFigures)
    value        INTEGER NOT NULL,     -- its value at the proof's point, above 0
    PRIMARY KEY (proof, key)
);
`;

/**
 * The columns `proofs` gained after its first deployment, which a table made before them
 * is altered to add, and a new one is too, as `recordings`' are (`recordings.ts`).
 */
const ADDED_COLUMNS: readonly (readonly [string, string])[] = [
    // Its package's path (`ProofPath`): each recording's id and VBLs, as JSON.
    ['path', "TEXT NOT NULL DEFAULT '[]'"],
    // The proof whose package holds its path, once its file was deleted for it (`holdsPath`).
    ['superseded_by', 'TEXT'],
    // When an edit of its set's achievements made it due for another replay (`ProofStore.replayAgain`), or NULL.
    ['due', 'INTEGER'],
];

/** The largest request `POST PROOFS_ROUTE` reads: a package, its claims, and the form around them. */
export const MAX_PROOF_BYTES = MAX_RECORDING_BYTES + 64 * 1024;

/**
 * The most proofs of one identity's browsers the queue holds at once: a player sends one
 * at most every ten minutes of a playthrough, and one at its end.
 */
export const MAX_QUEUED_PER_IDENTITY = 8;

/**
 * A package's path as a proof keeps it (`RecordingPackage.path`): each recording's id and
 * the VBLs it runs in the package, the root first, each branch's parent cut at its child's
 * point and the last at the point shared.
 */
export type ProofPath = readonly (readonly [string, number])[];

/**
 * Whether the path `path` holds the whole of `other`: a later point of the same branch, or
 * the same. Each recording of `other` but its last is one of `path`'s, at the same place,
 * run as far, since a branch cut at the same child is cut at the same point; and its last is
 * `path`'s recording there, run at least as far. A recording is never rewritten under its
 * id, only run further, so the same id is the same game. A path of none holds nothing, nor
 * is held: a row kept before paths were.
 */
export function holdsPath(path: ProofPath, other: ProofPath): boolean {
    if (other.length === 0 || other.length > path.length) return false;
    const last = other.length - 1;
    for (let i = 0; i < last; i++) if (path[i]![0] !== other[i]![0] || path[i]![1] !== other[i]![1]) return false;
    return path[last]![0] === other[last]![0] && path[last]![1] >= other[last]![1];
}

/** A proof's row. */
export interface StoredProof {
    id: string;
    dataSet: string;
    player: string;
    build: string;
    level: number;
    size: number;
    sentAt: number;
    state: ProofState;
    reason: string;
    checkedAt: number | null;
    playthrough: number | null;
    kept: boolean;
    path: ProofPath;
    /** The proof whose package holds this one's path, once its file was deleted for it. */
    supersededBy: string | null;
    /** When an edit of its set's achievements made it due for another replay, or `null`. */
    due: number | null;
}

/**
 * The achievements across games of the set `setId` that `bySet`, each set's playthroughs'
 * figures, make yes (`folderAchievements`, `setAchievements.ts`): a `games(…, in "x")`
 * reads other sets' games.
 */
export type AchievementsAcrossOf = (setId: string, bySet: ReadonlyMap<string, readonly Readonly<Record<string, number>>[]>) => readonly string[];

/** A figure a checked proof keeps, with its proof's set, playthrough and time, and who it is counted for. */
interface FigureRow {
    data_set: string;
    /** The identity, or the browsers, the figure is counted for. */
    owner: string;
    proof: string;
    playthrough: number;
    at: number;
    key: string;
    value: number;
}

/** An achievement across games `acrossRows` works out: of `owner`, in `dataSet`, at the time of the proof that made it yes. */
interface AcrossRow {
    dataSet: string;
    achievement: string;
    owner: string;
    at: number;
}

/**
 * The achievements across games `rows`, the checked proofs' figures in the order they were
 * checked, make yes (`doc/ACHIEVEMENTS.md` → "Across games"): for each owner, its proofs
 * taken in turn, each playthrough of each set at the largest figure any of its proofs
 * reached so far, and each achievement of each set the owner has proofs of at the first
 * proof after which `across` says yes, a proof of another set's among them where the
 * achievement reads that set's games.
 */
function acrossRows(rows: readonly FigureRow[], across: AchievementsAcrossOf): AcrossRow[] {
    const owners = new Map<string, FigureRow[][]>();
    for (const row of rows) {
        const proofs = owners.get(row.owner) ?? [];
        if (proofs.at(-1)?.[0]?.proof !== row.proof) proofs.push([]);
        proofs.at(-1)!.push(row);
        owners.set(row.owner, proofs);
    }
    const out: AcrossRow[] = [];
    for (const proofs of owners.values()) {
        const sets = new Map<string, Map<number, Record<string, number>>>();
        const done = new Set<string>();
        for (const figures of proofs) {
            const { data_set: proved, owner, playthrough, at } = figures[0]!;
            const playthroughs = sets.get(proved) ?? new Map<number, Record<string, number>>();
            const held = playthroughs.get(playthrough) ?? {};
            for (const { key, value } of figures) held[key] = Math.max(held[key] ?? 0, value);
            playthroughs.set(playthrough, held);
            sets.set(proved, playthroughs);
            const bySet = new Map([...sets].map(([set, games]) => [set, [...games.values()]]));
            for (const dataSet of sets.keys()) {
                for (const achievement of across(dataSet, bySet)) {
                    if (done.has(`${dataSet}\u0000${achievement}`)) continue;
                    done.add(`${dataSet}\u0000${achievement}`);
                    out.push({ dataSet, achievement, owner, at });
                }
            }
        }
    }
    return out;
}

/** An achievement of a set verified by an identity with a public name, at the time its first proof was checked (`ProofStore.hall`). */
export interface HallRow {
    dataSet: string;
    achievement: string;
    /** The identity's public id. */
    identity: string;
    name: string;
    at: number;
}

export class ProofStore {
    /** The most the packages kept may take on the disk together, in bytes. */
    readonly diskBytes: number;
    private readonly db: DatabaseSync;
    private readonly insert: StatementSync;
    private readonly insertClaim: StatementSync;
    private readonly row: StatementSync;
    private readonly rowsOf: StatementSync;
    private readonly claimRows: StatementSync;
    private readonly oldestQueued: StatementSync;
    private readonly queuedOf: StatementSync;
    private readonly total: StatementSync;
    private readonly verifiedOf: StatementSync;
    private readonly updateChecked: StatementSync;
    private readonly updateDrifted: StatementSync;
    private readonly updateClaim: StatementSync;
    private readonly grantClaim: StatementSync;
    private readonly updateSuperseded: StatementSync;
    private readonly moveSuperseded: StatementSync;
    private readonly supersededOf: StatementSync;
    private readonly keptOf: StatementSync;
    private readonly oldestDue: StatementSync;
    private readonly markDue: StatementSync;
    private readonly clearDue: StatementSync;
    private readonly deleteFigures: StatementSync;
    private readonly regrantClaim: StatementSync;
    private readonly insertFigure: StatementSync;
    private readonly figuresOf: StatementSync;
    /** `hall`'s, prepared at its first call: it reads `identity.ts`'s tables, made beside these. */
    private hallRows: StatementSync | null = null;
    /** `hall`'s figures, prepared at its first call, as `hallRows`. */
    private hallFigures: StatementSync | null = null;

    constructor(db: DatabaseSync, diskBytes: number) {
        this.db = db;
        this.diskBytes = diskBytes;
        db.exec(SCHEMA);
        const present = new Set((db.prepare('PRAGMA table_info(proofs)').all() as { name: string }[]).map((column) => column.name));
        for (const [column, type] of ADDED_COLUMNS) {
            if (!present.has(column)) db.exec(`ALTER TABLE proofs ADD COLUMN ${column} ${type}`);
        }
        const columns = 'id, data_set, player, build, level, size, sent_at, state, reason, checked_at, playthrough, kept, path, superseded_by, due';
        this.insert = db.prepare(`INSERT INTO proofs (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', '', NULL, NULL, 1, ?, NULL, NULL)`);
        this.insertClaim = db.prepare("INSERT INTO claims (proof, achievement, state) VALUES (?, ?, 'unverified')");
        this.row = db.prepare(`SELECT ${columns} FROM proofs WHERE id = ?`);
        this.rowsOf = db.prepare(`SELECT ${columns} FROM proofs WHERE player IN (SELECT value FROM json_each(?)) ORDER BY sent_at DESC, id`);
        this.claimRows = db.prepare('SELECT achievement, state, claimed FROM claims WHERE proof = ? ORDER BY achievement');
        this.oldestQueued = db.prepare(`SELECT ${columns} FROM proofs WHERE state = 'queued' ORDER BY sent_at, id LIMIT 1`);
        this.queuedOf = db.prepare("SELECT COUNT(*) AS n FROM proofs WHERE state = 'queued' AND player IN (SELECT value FROM json_each(?))");
        this.total = db.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM proofs WHERE kept = 1');
        this.verifiedOf = db.prepare(`SELECT p.data_set, c.achievement, MIN(p.checked_at) AS at FROM claims c JOIN proofs p ON p.id = c.proof
            WHERE c.state = 'verified' AND p.player IN (SELECT value FROM json_each(?)) GROUP BY p.data_set, c.achievement ORDER BY p.data_set, at, c.achievement`);
        this.updateChecked = db.prepare("UPDATE proofs SET state = 'checked', checked_at = ?, playthrough = ? WHERE id = ?");
        this.updateDrifted = db.prepare("UPDATE proofs SET state = 'drifted', checked_at = ?, reason = ? WHERE id = ?");
        this.updateClaim = db.prepare('UPDATE claims SET state = ? WHERE proof = ? AND achievement = ?');
        this.grantClaim = db.prepare("INSERT INTO claims (proof, achievement, state, claimed) VALUES (?, ?, 'verified', 0)");
        this.updateSuperseded = db.prepare('UPDATE proofs SET kept = 0, superseded_by = ? WHERE id = ?');
        this.moveSuperseded = db.prepare('UPDATE proofs SET superseded_by = ? WHERE superseded_by = ?');
        this.supersededOf = db.prepare('SELECT id FROM proofs WHERE superseded_by = ? ORDER BY sent_at, id');
        this.keptOf = db.prepare(`SELECT ${columns} FROM proofs WHERE state = 'checked' AND kept = 1 AND data_set = ? AND playthrough = ? AND id <> ?
            AND player IN (SELECT value FROM json_each(?)) ORDER BY sent_at, id`);
        this.oldestDue = db.prepare(`SELECT ${columns} FROM proofs WHERE state = 'checked' AND kept = 1 AND due IS NOT NULL ORDER BY due, sent_at, id LIMIT 1`);
        this.markDue = db.prepare("UPDATE proofs SET due = ? WHERE data_set = ? AND kept = 1 AND state IN ('queued', 'checked')");
        this.clearDue = db.prepare('UPDATE proofs SET due = NULL WHERE id = ? AND due <= ?');
        this.deleteFigures = db.prepare('DELETE FROM proof_figures WHERE proof = ?');
        this.regrantClaim = db.prepare(`INSERT INTO claims (proof, achievement, state, claimed) VALUES (?, ?, 'verified', 0)
            ON CONFLICT (proof, achievement) DO UPDATE SET state = 'verified'`);
        this.insertFigure = db.prepare('INSERT INTO proof_figures (proof, key, value) VALUES (?, ?, ?)');
        this.figuresOf = db.prepare(`SELECT p.data_set, '' AS owner, p.id AS proof, p.playthrough, p.checked_at AS at, f.key, f.value
            FROM proof_figures f JOIN proofs p ON p.id = f.proof
            WHERE p.state = 'checked' AND p.player IN (SELECT value FROM json_each(?)) ORDER BY p.checked_at, p.id, f.key`);
    }

    /** `proof` queued, with its `claims`, `unverified`. */
    queue(proof: Pick<StoredProof, 'id' | 'dataSet' | 'player' | 'build' | 'level' | 'size' | 'sentAt' | 'path'>, claims: readonly string[]): void {
        this.transaction(() => {
            this.insert.run(proof.id, proof.dataSet, proof.player, proof.build, proof.level, proof.size, proof.sentAt, JSON.stringify(proof.path));
            for (const claim of claims) this.insertClaim.run(proof.id, claim);
        });
    }

    get(id: string): StoredProof | null {
        const row = this.row.get(id) as Record<string, string | number | null> | undefined;
        return row ? proofOf(row) : null;
    }

    /** The proofs `players` sent, the latest first: what a moderator reads of an identity (`identityText`, `identity.ts`). */
    sentBy(players: readonly string[]): StoredProof[] {
        return (this.rowsOf.all(JSON.stringify(players)) as Record<string, string | number | null>[]).map(proofOf);
    }

    /** `id`'s claims, by achievement, and those its replay granted unclaimed among them. */
    claims(id: string): { achievement: string; state: ClaimState; claimed: boolean }[] {
        return (this.claimRows.all(id) as { achievement: string; state: ClaimState; claimed: number }[])
            .map((row) => ({ achievement: row.achievement, state: row.state, claimed: row.claimed === 1 }));
    }

    /**
     * The proof the verifier replays next: the oldest queued, so that a player's proof never
     * waits behind an edit's replays; then the checked one an edit of its set's achievements
     * made due first (`replayAgain`).
     */
    next(): StoredProof | null {
        const row = (this.oldestQueued.get() ?? this.oldestDue.get()) as Record<string, string | number | null> | undefined;
        return row ? proofOf(row) : null;
    }

    /**
     * Each proof of `dataSet` whose package is kept, queued or checked, made due at `at` for
     * a replay against the set's achievements as its folder now holds them: an edit changed
     * them (`edit.ts`). A queued one is replayed again too where its replay began before
     * `at`. A drifted one, which its game files refuse, and one whose file is deleted, are
     * not. How many were.
     */
    replayAgain(dataSet: string, at: number): number {
        return Number(this.markDue.run(at, dataSet).changes);
    }

    /** `id` replayed from `startedAt` on: no longer due, unless an edit made it due after its replay began. */
    replayed(id: string, startedAt: number): void {
        this.clearDue.run(id, startedAt);
    }

    /** The checked proofs of `players` of `dataSet`'s playthrough `playthrough` whose files are kept, but `except`. */
    keptIn(dataSet: string, playthrough: number, except: string, players: readonly string[]): StoredProof[] {
        return (this.keptOf.all(dataSet, playthrough, except, JSON.stringify(players)) as Record<string, string | number | null>[]).map(proofOf);
    }

    /** How many proofs `players` sent are queued. */
    queuedBy(players: readonly string[]): number {
        return (this.queuedOf.get(JSON.stringify(players)) as { n: number }).n;
    }

    /** What the packages kept take together, in bytes. */
    bytes(): number {
        return (this.total.get() as { bytes: number }).bytes;
    }

    /**
     * The achievements a replay verified of the proofs `players` sent, and those across games
     * their figures make yes (`across`), by set, each once, the first verified first.
     */
    verifiedBy(players: readonly string[], across: AchievementsAcrossOf): { dataSet: string; achievement: string }[] {
        const json = JSON.stringify(players);
        const rows = (this.verifiedOf.all(json) as { data_set: string; achievement: string; at: number }[])
            .map((row) => ({ dataSet: row.data_set, achievement: row.achievement, at: row.at }));
        const first = new Map(rows.map((row) => [`${row.dataSet}\u0000${row.achievement}`, row]));
        for (const row of acrossRows(this.figuresOf.all(json) as unknown as FigureRow[], across)) {
            const held = first.get(`${row.dataSet}\u0000${row.achievement}`);
            if (held === undefined) first.set(`${row.dataSet}\u0000${row.achievement}`, row);
            else held.at = Math.min(held.at, row.at);
        }
        return [...first.values()].sort((a, b) => a.dataSet.localeCompare(b.dataSet) || a.at - b.at || a.achievement.localeCompare(b.achievement))
            .map(({ dataSet, achievement }) => ({ dataSet, achievement }));
    }

    /**
     * The Hall of Fame's rows (`fame.ts`): each achievement a replay verified, by set, of each
     * identity with a public name, once, at the first proof of its browsers that verified it,
     * through `identity_players` (a browser linked to another identity since speaks for that
     * one); of the identity `identity` alone where it is given. Its achievements across games
     * are those its checked proofs' figures make yes (`across`, `acrossRows`), at the proof
     * that made each yes. The first verified first, then by identity. An identity a
     * moderator reset, which has no name, is left out.
     */
    hall(identity: string | null, across: AchievementsAcrossOf): HallRow[] {
        this.hallRows ??= this.db.prepare(`SELECT p.data_set, c.achievement, i.id AS identity, i.name, MIN(p.checked_at) AS at
            FROM claims c JOIN proofs p ON p.id = c.proof JOIN identity_players ip ON ip.player = p.player JOIN identities i ON i.id = ip.identity
            WHERE c.state = 'verified' AND p.state = 'checked' AND i.name IS NOT NULL AND (?1 IS NULL OR i.id = ?1)
            GROUP BY p.data_set, c.achievement, i.id ORDER BY at, i.id`);
        this.hallFigures ??= this.db.prepare(`SELECT p.data_set, i.id AS owner, i.name, p.id AS proof, p.playthrough, p.checked_at AS at, f.key, f.value
            FROM proof_figures f JOIN proofs p ON p.id = f.proof JOIN identity_players ip ON ip.player = p.player JOIN identities i ON i.id = ip.identity
            WHERE p.state = 'checked' AND i.name IS NOT NULL AND (?1 IS NULL OR i.id = ?1) ORDER BY p.checked_at, p.id, f.key`);
        const rows = (this.hallRows.all(identity) as { data_set: string; achievement: string; identity: string; name: string; at: number }[])
            .map((row) => ({ dataSet: row.data_set, achievement: row.achievement, identity: row.identity, name: row.name, at: row.at }));
        const figures = this.hallFigures.all(identity) as unknown as (FigureRow & { name: string })[];
        const names = new Map(figures.map((row) => [row.owner, row.name]));
        const first = new Map(rows.map((row) => [`${row.dataSet}\u0000${row.achievement}\u0000${row.identity}`, row]));
        for (const row of acrossRows(figures, across)) {
            const key = `${row.dataSet}\u0000${row.achievement}\u0000${row.owner}`;
            const held = first.get(key);
            if (held === undefined) first.set(key, { dataSet: row.dataSet, achievement: row.achievement, identity: row.owner, name: names.get(row.owner)!, at: row.at });
            else held.at = Math.min(held.at, row.at);
        }
        return [...first.values()].sort((a, b) => a.at - b.at || (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0));
    }

    /**
     * `id` replayed to its point, in the playthrough `playthrough`, the replay having
     * unlocked `unlocked` and its history's figures being `figures`: each claim verified or
     * dropped, each unlock it did not claim granted, verified, and each figure above 0 kept.
     */
    checked(id: string, at: number, playthrough: number, unlocked: ReadonlySet<string>, figures: Readonly<Record<string, number>>): void {
        this.transaction(() => {
            this.updateChecked.run(at, playthrough, id);
            for (const [key, value] of Object.entries(figures)) if (value > 0) this.insertFigure.run(id, key, value);
            const claimed = new Set<string>();
            for (const { achievement } of this.claims(id)) {
                claimed.add(achievement);
                this.updateClaim.run(unlocked.has(achievement) ? 'verified' : 'dropped', id, achievement);
            }
            for (const achievement of unlocked) if (!claimed.has(achievement)) this.grantClaim.run(id, achievement);
        });
    }

    /**
     * `id`, checked before, replayed again against its set's achievements as they now are,
     * its history then holding `unlocked` and `figures`: each claim verified or dropped, an
     * unlock it granted unclaimed kept verified where it still unlocks and dropped where it
     * no longer does, each new unlock granted, verified, and its figures those. Its time is
     * kept: an unlock is dated by its proof's first check. Each proof whose path it holds
     * (`supersede`) has each verified claim it no longer unlocks dropped, since what a later
     * point of the same game does not unlock no earlier point did; one it unlocks is not
     * granted to them, since the earlier point may not have reached it.
     */
    rechecked(id: string, unlocked: ReadonlySet<string>, figures: Readonly<Record<string, number>>): void {
        this.transaction(() => {
            this.deleteFigures.run(id);
            for (const [key, value] of Object.entries(figures)) if (value > 0) this.insertFigure.run(id, key, value);
            const held = new Set<string>();
            for (const { achievement } of this.claims(id)) {
                held.add(achievement);
                this.updateClaim.run(unlocked.has(achievement) ? 'verified' : 'dropped', id, achievement);
            }
            for (const achievement of unlocked) if (!held.has(achievement)) this.regrantClaim.run(id, achievement);
            for (const { id: earlier } of this.supersededOf.all(id) as { id: string }[]) {
                for (const claim of this.claims(earlier)) {
                    if (claim.state === 'verified' && !unlocked.has(claim.achievement)) this.updateClaim.run('dropped', earlier, claim.achievement);
                }
            }
        });
    }

    /** `id` drifted, for `reason`: its claims stay unverified. */
    drifted(id: string, at: number, reason: string): void {
        this.updateDrifted.run(at, reason, id);
    }

    /**
     * `id`'s file deleted, since `by`'s package holds its path (`holdsPath`): those it held
     * are held by `by` now.
     */
    supersede(id: string, by: string): void {
        this.transaction(() => {
            this.updateSuperseded.run(by, id);
            this.moveSuperseded.run(by, id);
        });
    }

    /** The proofs whose files were deleted for `id`'s, which holds their paths. */
    supersededBy(id: string): string[] {
        return (this.supersededOf.all(id) as { id: string }[]).map((row) => row.id);
    }

    private transaction(change: () => void): void {
        this.db.exec('BEGIN');
        try {
            change();
            this.db.exec('COMMIT');
        } catch (error) {
            if (this.db.isTransaction) this.db.exec('ROLLBACK');
            throw error;
        }
    }
}

function proofOf(row: Record<string, string | number | null>): StoredProof {
    return {
        id: row.id as string, dataSet: row.data_set as string, player: row.player as string, build: row.build as string,
        level: row.level as number, size: row.size as number, sentAt: row.sent_at as number, state: row.state as ProofState,
        reason: row.reason as string, checkedAt: row.checked_at as number | null, playthrough: row.playthrough as number | null,
        kept: row.kept === 1, path: JSON.parse(row.path as string) as ProofPath, supersededBy: row.superseded_by as string | null,
        due: row.due as number | null,
    };
}

/** The `playerId`s `player` speaks for: their identity's, or theirs alone. */
export function playersOf(identities: IdentityStore, player: string): string[] {
    const identity = identities.of(player);
    return identity === null ? [player] : identities.players(identity.id);
}

/** The status and the JSON body `POST PROOFS_ROUTE` answers with. */
export interface ProofAnswer {
    status: number;
    body: { id: string } | { error: string };
}

/** What `sendProof` needs of the server. */
export interface ProofOptions {
    proofs: ProofStore;
    /** `PROOFS_DIR`: where the packages are kept. */
    dir: string;
    dataSets: DataSetStore;
    identities: IdentityStore;
    readPackage: ReadRecordingPackage;
    /** The clock a proof is dated by. */
    now: () => number;
}

/** The claims `text` lists: 0 to `MAX_CLAIMS` distinct ids of `CLAIM_ID`'s form, or `null`. */
function claimsOf(text: string): string[] | null {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        return null;
    }
    if (!Array.isArray(json) || json.length > MAX_CLAIMS) return null;
    if (!json.every((id) => typeof id === 'string' && CLAIM_ID.test(id)) || new Set(json).size !== json.length) return null;
    return json as string[];
}

/** The moves of the page's `?dev`, which earn nothing (`DEV_CHANGES`, `recordings.ts`). */
function playedWithDevMoves(pkg: SharedPackage): boolean {
    return pkg.path.some((recording) => recording.changes.some(({ change }) => change.kind === 'devLevel' || change.kind === 'devMove'));
}

/**
 * `POST PROOFS_ROUTE`: `form`, sent by `playerId`, checked and, where it passes, its
 * package kept and queued, its claims `unverified`. `app.ts` has counted it against its
 * address's rate, named its player and read the form, a body of at most
 * `MAX_PROOF_BYTES`. The rules, in order, each answered with nothing written:
 *
 *   403  a player whose identity has no public name, or who has none
 *   400  a form that is not `PROOF_FIELDS` alone, the package a file and the claims a JSON
 *        list of 0 to `MAX_CLAIMS` distinct ids of `CLAIM_ID`'s form: a proof whose figures
 *        grew claims nothing
 *   413  a package over `MAX_RECORDING_BYTES`
 *   422  a package `readPackage` refuses, saying why; one of a set the site does not
 *        publish, pending or not in the table; one that holds a move of the page's `?dev`
 *   429  a player whose identity's browsers have `MAX_QUEUED_PER_IDENTITY` proofs queued
 *   507  one that would take the packages kept past the disk they may take (`ProofStore.diskBytes`)
 *
 * Then its file, written as `.<id>.partial` and renamed `<id>.gz`, then its row and its
 * claims. 201 answers `{"id": "<id>"}`; a refusal `{"error": "<why>"}`.
 */
export async function sendProof(form: FormData, playerId: string, options: ProofOptions): Promise<ProofAnswer> {
    const refuse = (status: number, error: string): ProofAnswer => ({ status, body: { error } });
    if (!options.identities.of(playerId)?.name) return refuse(403, 'Only a player with a public name sends a proof.');
    const fields = [...form.keys()];
    const file = form.get(PROOF_FIELDS.package);
    const text = form.get(PROOF_FIELDS.claims);
    const claims = typeof text === 'string' ? claimsOf(text) : null;
    if (fields.length !== 2 || !(file instanceof File) || claims === null) {
        return refuse(400, `The form is not a file, ${PROOF_FIELDS.package}, and ${PROOF_FIELDS.claims}, a list of 0 to ${MAX_CLAIMS} achievements' ids.`);
    }
    if (file.size > MAX_RECORDING_BYTES) return refuse(413, `The package is larger than ${MAX_RECORDING_BYTES / (1024 * 1024)} MiB.`);

    const bytes = new Uint8Array(await file.arrayBuffer());
    let pkg: SharedPackage;
    try {
        pkg = await options.readPackage(bytes, MAX_RECORDING_UNZIPPED_BYTES);
    } catch (error) {
        return refuse(422, `The package is refused: ${error instanceof Error ? error.message : String(error)}.`);
    }
    const set = options.dataSets.read().dataSets.find((row) => row.id === pkg.dataSet);
    if (!set || set.pending) return refuse(422, 'The site does not publish the set it plays.');
    if (playedWithDevMoves(pkg)) return refuse(422, 'It holds a move of ?dev, which earns nothing.');
    if (options.proofs.queuedBy(playersOf(options.identities, playerId)) >= MAX_QUEUED_PER_IDENTITY) {
        return refuse(429, `${MAX_QUEUED_PER_IDENTITY} of your proofs await the verifier: send this one once it has checked them.`);
    }
    if (options.proofs.bytes() + bytes.length > options.proofs.diskBytes) return refuse(507, 'The site keeps no more proofs.');

    const id = randomBytes(8).toString('hex').toUpperCase();
    const partial = join(options.dir, `.${id}.partial`);
    try {
        await writeFile(partial, bytes, { flag: 'wx' });
        await rename(partial, join(options.dir, `${id}.gz`));
    } catch (error) {
        await rm(partial, { force: true });
        throw error;
    }
    const path: ProofPath = pkg.path.map((recording) => [recording.id, recording.vbls] as const);
    options.proofs.queue({ id, dataSet: pkg.dataSet, player: playerId, build: pkg.build, level: pkg.level, size: bytes.length, sentAt: options.now(), path }, claims);
    console.log(`proof ${id} of '${pkg.dataSet}' queued, ${claims.length} claim(s)`);
    return { status: 201, body: { id } };
}

/**
 * The answer to `GET PROOFS_ROUTE?ids=<id>,<id>…` for `player`: `{"proofs": [ProofVerdict…]}`,
 * those of `ids` that a browser of `player`'s identity sent, in the order asked, each with
 * its state, why it drifted where it did, and each claim's verdict; an unlock its replay
 * granted unclaimed is among them, verified. An id of none of theirs is left out, as is
 * one asked twice. `null` where `ids` is not 1 to `MAX_CLAIMS` ids of `PROOF_ID`'s form,
 * a comma apart.
 */
export function proofsText(ids: string, player: string, proofs: ProofStore, identities: IdentityStore): string | null {
    const asked = ids.split(',');
    if (asked.length === 0 || asked.length > MAX_CLAIMS || !asked.every((id) => PROOF_ID.test(id))) return null;
    const players = new Set(playersOf(identities, player));
    const verdicts: ProofVerdict[] = [];
    for (const id of new Set(asked)) {
        const proof = proofs.get(id);
        if (!proof || !players.has(proof.player)) continue;
        const claims = Object.fromEntries(proofs.claims(id).map((claim) => [claim.achievement, claim.state]));
        verdicts.push({
            id, state: proof.state, ...(proof.state === 'drifted' ? { reason: proof.reason } : {}),
            ...(proof.state === 'checked' && proof.checkedAt !== null ? { checkedAt: proof.checkedAt } : {}), claims,
        });
    }
    return JSON.stringify({ proofs: verdicts });
}

/**
 * A set the verifier may play a proof over, as the page's replay takes it (`ProofSet`,
 * `src/engine/achievements/ProofReplay.ts`): typed here by its shape, as `SharedPackage` is.
 */
export interface VerifierSet {
    readonly set: DataSet;
    readonly files: { read(name: string): Promise<Uint8Array | null>; where(name: string): string };
    readonly digests: { readonly id: string; readonly name: string; readonly files: Readonly<Record<string, string>> };
}

/** What the page's replay says of a proof (`ProofReplayed`). */
export type ProofReplayed =
    | {
        readonly kind: 'checked'; readonly dataSet: string; readonly over: string; readonly playthrough: number;
        readonly unlocked: readonly string[]; readonly figures: Readonly<Record<string, number>>;
    }
    | { readonly kind: 'drifted'; readonly reason: string };

/**
 * The page's replay of a proof, `replayProof`, as `VERIFIER_MODULE` exports it, the set's
 * achievements `defsOf` its own file's text merged with the common one (`app.ts`).
 */
export type BuiltReplayProof = (bytes: Uint8Array, limit: number, sets: readonly VerifierSet[], defsOf: (own: string | null) => unknown) => Promise<ProofReplayed>;

/** What the verifier replays a proof with: the page's replay, over the set's achievements (`loadVerifierReaders`, `app.ts`). */
export interface VerifierReaders {
    replay(bytes: Uint8Array, limit: number, sets: readonly VerifierSet[]): Promise<ProofReplayed>;
}

/**
 * Every set the store holds, as the page reads its manifest, each with its files in its
 * folder under `gamefilesDir` and their digests (`cache`): those a proof may be played over,
 * its own or another whose files have its digests (`findRecordingSet`).
 */
export async function verifierSets(dataSets: DataSetStore, gamefilesDir: string, cache: FileDigestCache): Promise<VerifierSet[]> {
    const viewer = { playerId: null, moderator: { playerId: '', name: 'the verifier' } };
    const manifest = parseManifest(manifestText(dataSets.read(), viewer), gamefilesDir);
    const sets: VerifierSet[] = [];
    for (const set of manifest.dataSets) {
        const files: Record<string, string> = {};
        for (const name of [...GAME_FILES].sort()) {
            const digest = await cache.digest(join(set.dir, name));
            if (digest !== null) files[name] = digest;
        }
        sets.push({
            set,
            files: {
                read: (name) => readFile(join(set.dir, name)).then((bytes) => new Uint8Array(bytes), () => null),
                where: (name) => join(set.dir, name),
            },
            digests: { id: set.id, name: set.name, files },
        });
    }
    return sets;
}

/** What `verifyNext` needs. */
export interface VerifyOptions {
    proofs: ProofStore;
    identities: IdentityStore;
    dataSets: DataSetStore;
    /** `PROOFS_DIR`. */
    dir: string;
    gamefilesDir: string;
    digests: FileDigestCache;
    replay: VerifierReaders['replay'];
    now: () => number;
}

/** What `verifyNext` did. */
export interface Verified {
    id: string;
    /**
     * Its replay's outcome: `checked` or `drifted`. A replay again that drifts leaves the
     * proof checked, its verdict as its last replay left it.
     */
    state: Exclude<ProofState, 'queued'>;
    /** Whether it was checked before, and replayed again against its set's achievements as they now are. */
    again: boolean;
    reason: string;
    verified: string[];
    dropped: string[];
    /** The proofs whose files it deleted, since its package holds their paths (`holdsPath`). */
    superseded: string[];
    /** Whether its file is kept: not where a kept proof's package holds its path. */
    kept: boolean;
}

/**
 * The verifier's step: the next proof (`ProofStore.next`) replayed (`replay`) and its verdict
 * kept, or `null` where none is due.
 *
 * - **A queued proof**, played to its point, is `checked`: each claim the replay unlocked
 *   verified and each other dropped, an unlock it did not claim granted, verified, and its
 *   history's figures kept. Then the latest point of each branch is what is kept: each
 *   checked proof of its identity's browsers in the same playthrough whose path its package
 *   holds (`holdsPath`) has its file deleted, the proof it is superseded by noted; and its
 *   own is deleted where a kept one holds its path. Where it drifts, or its file is gone, it
 *   is `drifted`, the reason kept, its claims unverified and its file kept.
 * - **A checked proof an edit made due** (`replayAgain`) is replayed against its set's
 *   achievements as they now are (`rechecked`): its claims, its grants and its figures follow
 *   them, and those of the proofs it superseded lose what it no longer unlocks. Where it no
 *   longer plays, an edit of the set's game files among the causes, its last verdict stays.
 *
 * Either way it is no longer due, unless an edit made it due once its replay had begun.
 */
export async function verifyNext(options: VerifyOptions): Promise<Verified | null> {
    const { proofs } = options;
    const proof = proofs.next();
    if (proof === null) return null;
    const again = proof.state === 'checked';
    const startedAt = options.now();
    const path = join(options.dir, `${proof.id}.gz`);
    let replayed: ProofReplayed;
    try {
        const bytes = new Uint8Array(await readFile(path));
        replayed = await options.replay(bytes, MAX_RECORDING_UNZIPPED_BYTES, await verifierSets(options.dataSets, options.gamefilesDir, options.digests));
    } catch (error) {
        replayed = { kind: 'drifted', reason: `it does not play: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (replayed.kind === 'checked' && replayed.dataSet !== proof.dataSet) {
        replayed = { kind: 'drifted', reason: `its package plays ${replayed.dataSet}, not ${proof.dataSet}` };
    }
    if (replayed.kind === 'checked' && again && replayed.playthrough !== proof.playthrough) {
        replayed = { kind: 'drifted', reason: `its replay reads the playthrough ${replayed.playthrough}, not its first replay's` };
    }
    const done = { id: proof.id, again, superseded: [] as string[] };
    if (replayed.kind === 'drifted') {
        if (!again) proofs.drifted(proof.id, options.now(), replayed.reason);
        proofs.replayed(proof.id, startedAt);
        return { ...done, state: 'drifted', reason: replayed.reason, verified: [], dropped: [], kept: true };
    }
    const unlocked = new Set(replayed.unlocked);
    if (again) proofs.rechecked(proof.id, unlocked, replayed.figures);
    else proofs.checked(proof.id, options.now(), replayed.playthrough, unlocked, replayed.figures);
    proofs.replayed(proof.id, startedAt);
    const dropped = proofs.claims(proof.id).filter((claim) => claim.state === 'dropped').map((claim) => claim.achievement);
    let kept = true;
    if (!again) {
        const others = proofs.keptIn(proof.dataSet, replayed.playthrough, proof.id, playersOf(options.identities, proof.player));
        for (const other of others.filter((one) => holdsPath(proof.path, one.path))) {
            await rm(join(options.dir, `${other.id}.gz`), { force: true });
            proofs.supersede(other.id, proof.id);
            done.superseded.push(other.id);
        }
        const holder = others.find((one) => !done.superseded.includes(one.id) && holdsPath(one.path, proof.path));
        if (holder) {
            await rm(path, { force: true });
            proofs.supersede(proof.id, holder.id);
            kept = false;
        }
    }
    return { ...done, state: 'checked', reason: '', verified: [...replayed.unlocked], dropped, kept };
}
