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
    /**
     * An unlock the server's replay of a proof granted, which no tracker of this browser's
     * unlocked (`grantedRows`): its time is the proof's first check, its play time and game
     * time 0. Shown while the server verifies it.
     */
    granted?: true;
}

/**
 * One playthrough's figures, which the achievements across games read (`GameFigures`,
 * `doc/ACHIEVEMENTS.md` → "Across games"): each key at the largest any of its branches
 * reached.
 */
export interface AchievementFiguresRow {
    /** The data set, its `DataSet.id`. */
    dataSet: string;
    /** The playthrough, `d.RandomGameID`. */
    playthrough: number;
    /** Each `games(…)` key its history met, 1, and each `total(…)` key's count. */
    figures: Record<string, number>;
    /** The proofs this browser sent of the playthrough (`PROOF_ID`), each once, whatever they claimed. */
    proofs?: string[];
}

/** Two figures of one playthrough's branches as one: each key at the larger, as a branch's history only grows. */
export function mergeFigures(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): Record<string, number> {
    const out: Record<string, number> = { ...a };
    for (const [key, v] of Object.entries(b)) out[key] = Math.max(out[key] ?? 0, v);
    return out;
}

/** The figures rows `a` and `b` of one playthrough as one: their figures merged (`mergeFigures`), and their proofs. */
export function mergeFiguresRows(a: AchievementFiguresRow | undefined, b: AchievementFiguresRow): AchievementFiguresRow {
    const proofs = [...new Set([...(a?.proofs ?? []), ...(b.proofs ?? [])])];
    return { dataSet: b.dataSet, playthrough: b.playthrough, figures: a ? mergeFigures(a.figures, b.figures) : { ...b.figures }, ...(proofs.length > 0 ? { proofs } : {}) };
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
    /** One data set's figures, a row per playthrough, or every set's for `null`. */
    figures(dataSet: string | null): Promise<AchievementFiguresRow[]>;
    /** `row` merged into the playthrough's figures, each key at the larger, and its proofs (`mergeFiguresRows`): one transaction. */
    raiseFigures(row: AchievementFiguresRow): Promise<void>;
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
 * Every proof `rows` and `figures` name, each once: those that claimed an unlock, and those
 * the browser sent of a playthrough whatever they claimed. What the page asks the verdicts
 * of where a replay again may have changed them (`refreshVerdicts`).
 */
export function knownProofs(rows: readonly AchievementRow[], figures: readonly AchievementFiguresRow[]): string[] {
    return [...new Set([...rows.flatMap((row) => row.proofs ?? []), ...figures.flatMap((row) => row.proofs ?? [])])];
}

/**
 * The rows of `rows` that `verdicts` change, changed: a row is `verified` once a proof that
 * claims it verified it, `dropped` once every proof that claims it was replayed to its point
 * and none did, and `unverified` with the reason where one drifted and none verified it. A
 * row a verdict judged already is judged again where `verdicts` hold all of its proofs': a
 * replay again against its set's achievements as they now are may turn one verified
 * dropped, or one dropped verified.
 */
export function judgedRows(rows: readonly AchievementRow[], verdicts: readonly ProofVerdict[]): AchievementRow[] {
    const byId = new Map(verdicts.map((verdict) => [verdict.id, verdict]));
    const changed: AchievementRow[] = [];
    for (const row of rows) {
        if (!row.proofs?.length) continue;
        const known = row.proofs.map((id) => byId.get(id));
        if (row.proof !== 'unverified' && known.includes(undefined)) continue;
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

/**
 * The rows `verdicts` add or extend, the playthrough of each proof `figures` and `rows` name:
 * for each achievement a checked proof's replay verified, the proof joins the `proofs` of the
 * playthrough's row of it, and where the playthrough has none, a row is added, `granted`, the
 * unlock the replay granted unclaimed (`doc/ACHIEVEMENTS.md` → "Proofs"), at the proof's
 * first check, its party the playthrough's other rows'. Rows as `judgedRows` then judges
 * them; a proof of no known playthrough adds nothing.
 */
export function grantedRows(
    rows: readonly AchievementRow[], figures: readonly AchievementFiguresRow[], verdicts: readonly ProofVerdict[], dataSet: string,
): AchievementRow[] {
    const playthroughOf = new Map<string, number>();
    for (const row of [...figures, ...rows]) if (row.dataSet === dataSet) for (const id of row.proofs ?? []) playthroughOf.set(id, row.playthrough);
    const out = new Map<string, AchievementRow>();
    const keyOf = (id: string, playthrough: number) => `${playthrough}|${id}`;
    const held = new Map(rows.filter((row) => row.dataSet === dataSet).map((row) => [keyOf(row.id, row.playthrough), row]));
    for (const verdict of verdicts) {
        const playthrough = playthroughOf.get(verdict.id);
        if (playthrough === undefined || verdict.state !== 'checked') continue;
        for (const [id, state] of Object.entries(verdict.claims)) {
            if (state !== 'verified') continue;
            const key = keyOf(id, playthrough);
            const row = out.get(key) ?? held.get(key);
            if (row?.proofs?.includes(verdict.id)) continue;
            const party = rows.find((one) => one.dataSet === dataSet && one.playthrough === playthrough && !one.granted)?.champions ?? [];
            out.set(key, row ? { ...row, proofs: [...(row.proofs ?? []), verdict.id] } : {
                dataSet, id, playthrough, unlockedAt: verdict.checkedAt ?? 0, playTime: 0, gameTime: 0, champions: [...party],
                proof: 'verified', proofs: [verdict.id], granted: true,
            });
        }
    }
    return [...out.values()];
}

/** The earliest unlocked first, and of two at once the one of the lower id. */
export function sortAchievementRows(rows: AchievementRow[]): AchievementRow[] {
    return [...rows].sort((a, b) => a.unlockedAt - b.unlockedAt || a.id.localeCompare(b.id) || a.playthrough - b.playthrough);
}

/** A store in memory, which keeps a clone of what it is given, as IndexedDB does. */
export function memoryAchievementStore(): AchievementStore & { rows: AchievementRow[]; figureRows: AchievementFiguresRow[] } {
    const rows: AchievementRow[] = [];
    const figureRows: AchievementFiguresRow[] = [];
    return {
        rows,
        figureRows,
        figures: async (dataSet) => figureRows.filter((row) => dataSet === null || row.dataSet === dataSet).map((row) => structuredClone(row)),
        raiseFigures: async (row) => {
            const at = figureRows.findIndex((one) => one.dataSet === row.dataSet && one.playthrough === row.playthrough);
            const merged = structuredClone(mergeFiguresRows(figureRows[at], row));
            if (at >= 0) figureRows[at] = merged;
            else figureRows.push(merged);
        },
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
