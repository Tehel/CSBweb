/**
 * The achievements a player has unlocked, as the page keeps them (`doc/ACHIEVEMENTS.md` →
 * "The page"): a row per data set, achievement and playthrough, written as the tracker
 * unlocks one (`PageAchievements`), and how far its proof has got on the server
 * ("Proofs", `PageProofs`).
 *
 * **Nothing in this file touches the DOM**: the rows and their order are pure, so the
 * tools assert them headlessly over `memoryAchievementStore`.
 */

import type { ClaimState, ProofVerdict } from '../DataSets';

/**
 * How far an unlock's proof has got (`doc/ACHIEVEMENTS.md` → "Proofs"): `unverified` until a
 * replay of a proof that claims it says, `verified` once one unlocked it, `dropped` where
 * every proof that claimed it was replayed and none did. The server's verdict of a claim
 * (`ClaimState`).
 */
export type AchievementProof = ClaimState;

/** One achievement unlocked in one playthrough of one data set. */
export interface AchievementRow {
    /** The data set, its `DataSet.id`. */
    dataSet: string;
    /** The achievement's id in the set's file (`[id]`). */
    id: string;
    /** The playthrough that unlocked it, `d.RandomGameID` (`SaveEntry.playthrough`). */
    playthrough: number;
    /** Milliseconds since the epoch: when it was unlocked. */
    unlockedAt: number;
    /** Milliseconds the player had spent in the game then: the tracker's VBLs counted (`Unlock.vbls`). */
    playTime: number;
    /** The game's clock then, `d.Time`. */
    gameTime: number;
    /** The party then, champion names in order, which names the playthrough in a list. */
    champions: string[];
    proof: AchievementProof;
    /** The proofs sent that claim it (`PROOF_ID`), the first first; none on a row written before they were sent. */
    proofs?: string[];
    /** Why the last proof that claimed it drifted, where one did and none verified it. */
    drift?: string;
}

export interface AchievementStore {
    /** One data set's rows, or every set's for `null`, the earliest unlocked first. */
    list(dataSet: string | null): Promise<AchievementRow[]>;
    /**
     * `row` kept, unless the store holds one of its set, id and playthrough already: the
     * first unlock stays, and a branch that unlocks it again changes nothing. Says whether
     * it was kept.
     */
    unlock(row: AchievementRow): Promise<boolean>;
    /** `rows` written over the rows of their set, id and playthrough: their proofs, and their verdicts. */
    update(rows: readonly AchievementRow[]): Promise<void>;
}

/**
 * The rows of `rows` a proof of the playthrough `playthrough` of `dataSet` claims, its
 * history `unlocked` (`AchievementTracker.unlocked`): those that history holds and no
 * replay has judged, verified or dropped. An unlock of a branch the game left is on no path
 * it can send; one a replay dropped, the same game's later path would not unlock either.
 */
export function claimableRows(rows: readonly AchievementRow[], dataSet: string, playthrough: number, unlocked: ReadonlySet<string>): AchievementRow[] {
    return rows.filter((row) => row.dataSet === dataSet && row.playthrough === playthrough && row.proof === 'unverified' && unlocked.has(row.id));
}

/** The proofs of `rows` still awaiting a verdict: those of every row neither verified nor dropped, each once. */
export function pendingProofs(rows: readonly AchievementRow[]): string[] {
    return [...new Set(rows.filter((row) => row.proof === 'unverified').flatMap((row) => row.proofs ?? []))];
}

/**
 * The rows of `rows` that `verdicts` change, changed: a row is `verified` once a proof that
 * claims it verified it, `dropped` once every proof that claims it was replayed to its point
 * and none did, and `unverified` with the reason where one drifted and none verified it.
 */
export function judgedRows(rows: readonly AchievementRow[], verdicts: readonly ProofVerdict[]): AchievementRow[] {
    const byId = new Map(verdicts.map((verdict) => [verdict.id, verdict]));
    const changed: AchievementRow[] = [];
    for (const row of rows) {
        if (row.proof !== 'unverified' || !row.proofs?.length) continue;
        const known = row.proofs.map((id) => byId.get(id));
        const states = known.map((verdict) => verdict?.claims[row.id]);
        const drifted = known.filter((verdict) => verdict?.state === 'drifted').pop();
        const proof: AchievementProof = states.includes('verified') ? 'verified'
            : known.every((verdict) => verdict?.state === 'checked') && states.every((state) => state === 'dropped') ? 'dropped' : 'unverified';
        const drift = proof === 'unverified' ? drifted?.reason : undefined;
        if (proof === row.proof && drift === row.drift) continue;
        const { drift: _old, ...rest } = row;
        changed.push({ ...rest, proof, ...(drift !== undefined ? { drift } : {}) });
    }
    return changed;
}

/** The earliest unlocked first, and of two at once the one of the lower id. */
export function sortAchievementRows(rows: AchievementRow[]): AchievementRow[] {
    return [...rows].sort((a, b) => a.unlockedAt - b.unlockedAt || a.id.localeCompare(b.id) || a.playthrough - b.playthrough);
}

/** A store in memory, which keeps a clone of what it is given, as IndexedDB does. */
export function memoryAchievementStore(): AchievementStore & { rows: AchievementRow[] } {
    const rows: AchievementRow[] = [];
    return {
        rows,
        list: async (dataSet) => sortAchievementRows(rows.filter((row) => dataSet === null || row.dataSet === dataSet))
            .map((row) => structuredClone(row)),
        unlock: async (row) => {
            if (rows.some((held) => held.dataSet === row.dataSet && held.id === row.id && held.playthrough === row.playthrough)) return false;
            rows.push(structuredClone(row));
            return true;
        },
        update: async (changed) => {
            for (const row of changed) {
                const at = rows.findIndex((held) => held.dataSet === row.dataSet && held.id === row.id && held.playthrough === row.playthrough);
                if (at >= 0) rows[at] = structuredClone(row);
            }
        },
    };
}
