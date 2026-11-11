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
 * A package is a shared recording's (`doc/RECORDING.md` → "Shared recordings"), read with
 * the page's own reader (`readRecordingPackage`), which checks its form alone: the verifier,
 * a service of its own (`verifier.ts`), replays it later. Only a player with a public name
 * sends one (`identity.ts`): the Hall of Fame shows the verified unlocks by that name. Its
 * claims are listed at once, `unverified`, until the replay says.
 *
 * A proof is its sender's alone: the server keeps their `playerId` with it, and answers its
 * verdicts to the browsers their identity links. No answer holds a `playerId` or a
 * playthrough; a proof is named by its id, drawn by the server and answered once, which
 * the page keeps beside the unlocks it claims.
 */
import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

import {
    CLAIM_ID, MAX_CLAIMS, PROOF_FIELDS, PROOF_ID, type ClaimState, type ProofState, type ProofVerdict,
} from '../src/data/DataSets.ts';
import type { DataSetStore } from './dataSets.ts';
import type { IdentityStore } from './identity.ts';
import { MAX_RECORDING_BYTES, MAX_RECORDING_UNZIPPED_BYTES, type ReadRecordingPackage, type SharedPackage } from './recordings.ts';

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
`;

/**
 * The columns `proofs` gained after its first deployment, which a table made before them
 * is altered to add, and a new one is too, as `recordings`' are (`recordings.ts`).
 */
const ADDED_COLUMNS: readonly (readonly [string, string])[] = [];

/** The largest request `POST PROOFS_ROUTE` reads: a package, its claims, and the form around them. */
export const MAX_PROOF_BYTES = MAX_RECORDING_BYTES + 64 * 1024;

/**
 * The most proofs of one identity's browsers the queue holds at once: a player sends one
 * at most every ten minutes of a playthrough, and one at its end.
 */
export const MAX_QUEUED_PER_IDENTITY = 8;

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
}

export class ProofStore {
    /** The most the packages kept may take on the disk together, in bytes. */
    readonly diskBytes: number;
    private readonly db: DatabaseSync;
    private readonly insert: StatementSync;
    private readonly insertClaim: StatementSync;
    private readonly row: StatementSync;
    private readonly claimRows: StatementSync;
    private readonly oldestQueued: StatementSync;
    private readonly queuedOf: StatementSync;
    private readonly total: StatementSync;
    private readonly verifiedOf: StatementSync;
    private readonly verifiedElsewhere: StatementSync;
    private readonly updateChecked: StatementSync;
    private readonly updateDrifted: StatementSync;
    private readonly updateClaim: StatementSync;
    private readonly grantClaim: StatementSync;
    private readonly updateKept: StatementSync;

    constructor(db: DatabaseSync, diskBytes: number) {
        this.db = db;
        this.diskBytes = diskBytes;
        db.exec(SCHEMA);
        const present = new Set((db.prepare('PRAGMA table_info(proofs)').all() as { name: string }[]).map((column) => column.name));
        for (const [column, type] of ADDED_COLUMNS) {
            if (!present.has(column)) db.exec(`ALTER TABLE proofs ADD COLUMN ${column} ${type}`);
        }
        const columns = 'id, data_set, player, build, level, size, sent_at, state, reason, checked_at, playthrough, kept';
        this.insert = db.prepare(`INSERT INTO proofs (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', '', NULL, NULL, 1)`);
        this.insertClaim = db.prepare("INSERT INTO claims (proof, achievement, state) VALUES (?, ?, 'unverified')");
        this.row = db.prepare(`SELECT ${columns} FROM proofs WHERE id = ?`);
        this.claimRows = db.prepare('SELECT achievement, state, claimed FROM claims WHERE proof = ? ORDER BY achievement');
        this.oldestQueued = db.prepare(`SELECT ${columns} FROM proofs WHERE state = 'queued' ORDER BY sent_at, id LIMIT 1`);
        this.queuedOf = db.prepare("SELECT COUNT(*) AS n FROM proofs WHERE state = 'queued' AND player IN (SELECT value FROM json_each(?))");
        this.total = db.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM proofs WHERE kept = 1');
        this.verifiedOf = db.prepare(`SELECT p.data_set, c.achievement, MIN(p.checked_at) AS at FROM claims c JOIN proofs p ON p.id = c.proof
            WHERE c.state = 'verified' AND p.player IN (SELECT value FROM json_each(?)) GROUP BY p.data_set, c.achievement ORDER BY p.data_set, at, c.achievement`);
        this.verifiedElsewhere = db.prepare(`SELECT 1 FROM claims c JOIN proofs p ON p.id = c.proof
            WHERE c.state = 'verified' AND c.achievement = ? AND p.data_set = ? AND p.playthrough = ? AND p.id <> ? AND p.player IN (SELECT value FROM json_each(?)) LIMIT 1`);
        this.updateChecked = db.prepare("UPDATE proofs SET state = 'checked', checked_at = ?, playthrough = ? WHERE id = ?");
        this.updateDrifted = db.prepare("UPDATE proofs SET state = 'drifted', checked_at = ?, reason = ? WHERE id = ?");
        this.updateClaim = db.prepare('UPDATE claims SET state = ? WHERE proof = ? AND achievement = ?');
        this.grantClaim = db.prepare("INSERT INTO claims (proof, achievement, state, claimed) VALUES (?, ?, 'verified', 0)");
        this.updateKept = db.prepare('UPDATE proofs SET kept = 0 WHERE id = ?');
    }

    /** `proof` queued, with its `claims`, `unverified`. */
    queue(proof: Pick<StoredProof, 'id' | 'dataSet' | 'player' | 'build' | 'level' | 'size' | 'sentAt'>, claims: readonly string[]): void {
        this.transaction(() => {
            this.insert.run(proof.id, proof.dataSet, proof.player, proof.build, proof.level, proof.size, proof.sentAt);
            for (const claim of claims) this.insertClaim.run(proof.id, claim);
        });
    }

    get(id: string): StoredProof | null {
        const row = this.row.get(id) as Record<string, string | number | null> | undefined;
        return row ? proofOf(row) : null;
    }

    /** `id`'s claims, by achievement, and those its replay granted unclaimed among them. */
    claims(id: string): { achievement: string; state: ClaimState; claimed: boolean }[] {
        return (this.claimRows.all(id) as { achievement: string; state: ClaimState; claimed: number }[])
            .map((row) => ({ achievement: row.achievement, state: row.state, claimed: row.claimed === 1 }));
    }

    /** The proof the verifier replays next: the oldest queued. */
    next(): StoredProof | null {
        const row = this.oldestQueued.get() as Record<string, string | number | null> | undefined;
        return row ? proofOf(row) : null;
    }

    /** How many proofs `players` sent are queued. */
    queuedBy(players: readonly string[]): number {
        return (this.queuedOf.get(JSON.stringify(players)) as { n: number }).n;
    }

    /** What the packages kept take together, in bytes. */
    bytes(): number {
        return (this.total.get() as { bytes: number }).bytes;
    }

    /** The achievements a replay verified of the proofs `players` sent, by set, each once, the first verified first. */
    verifiedBy(players: readonly string[]): { dataSet: string; achievement: string }[] {
        return (this.verifiedOf.all(JSON.stringify(players)) as { data_set: string; achievement: string }[])
            .map((row) => ({ dataSet: row.data_set, achievement: row.achievement }));
    }

    /**
     * Whether another proof of `players`' verified `achievement` in the playthrough
     * `playthrough` of `dataSet` already: what makes a proof's unlock not its own.
     */
    verifiedBefore(achievement: string, dataSet: string, playthrough: number, except: string, players: readonly string[]): boolean {
        return this.verifiedElsewhere.get(achievement, dataSet, playthrough, except, JSON.stringify(players)) !== undefined;
    }

    /**
     * `id` replayed to its point, in the playthrough `playthrough`, the replay having
     * unlocked `unlocked`: each claim verified or dropped, and each unlock it did not claim
     * granted, verified.
     */
    checked(id: string, at: number, playthrough: number, unlocked: ReadonlySet<string>): void {
        this.transaction(() => {
            this.updateChecked.run(at, playthrough, id);
            const claimed = new Set<string>();
            for (const { achievement } of this.claims(id)) {
                claimed.add(achievement);
                this.updateClaim.run(unlocked.has(achievement) ? 'verified' : 'dropped', id, achievement);
            }
            for (const achievement of unlocked) if (!claimed.has(achievement)) this.grantClaim.run(id, achievement);
        });
    }

    /** `id` drifted, for `reason`: its claims stay unverified. */
    drifted(id: string, at: number, reason: string): void {
        this.updateDrifted.run(at, reason, id);
    }

    /** `id`'s file deleted. */
    dropFile(id: string): void {
        this.updateKept.run(id);
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
        kept: row.kept === 1,
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

/** The claims `text` lists: 1 to `MAX_CLAIMS` distinct ids of `CLAIM_ID`'s form, or `null`. */
function claimsOf(text: string): string[] | null {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        return null;
    }
    if (!Array.isArray(json) || json.length === 0 || json.length > MAX_CLAIMS) return null;
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
 *        list of 1 to `MAX_CLAIMS` distinct ids of `CLAIM_ID`'s form
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
        return refuse(400, `The form is not a file, ${PROOF_FIELDS.package}, and ${PROOF_FIELDS.claims}, a list of 1 to ${MAX_CLAIMS} achievements' ids.`);
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
    options.proofs.queue({ id, dataSet: pkg.dataSet, player: playerId, build: pkg.build, level: pkg.level, size: bytes.length, sentAt: options.now() }, claims);
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
        verdicts.push({ id, state: proof.state, ...(proof.state === 'drifted' ? { reason: proof.reason } : {}), claims });
    }
    return JSON.stringify({ proofs: verdicts });
}
