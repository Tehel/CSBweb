/**
 * A proof replayed (`doc/ACHIEVEMENTS.md` → "Proofs"): the package of a point a player sent
 * with the unlocks it claims, played from itself alone in a page without the DOM, the
 * achievements' tracker attached, as the verifier service plays it (`server/verifier.ts`).
 *
 * The package is read with the page's reader (`readRecordingPackage`), its set found by its
 * files' digests among the server's (`findRecordingSet`), and its path played to its point
 * as the page plays a cut before it is sent (`playCut`, `src/engine/RecordingCut.ts`), each
 * recording at its own engine level (`RecordingPlayer`). The tracker is a function of what
 * it observes alone, so the replay unlocks what the player's game unlocked, its joins
 * reading the histories their parents kept at their saves (`AchievementTracker`): a path
 * from a new game has its whole history, one from a save that no replay holds a state for
 * has a history of its own from there, as the page's had.
 *
 * `src/engine/VerifierReaders.ts` bundles it for the server, with the achievements of the
 * build (`achievementDefs`).
 *
 * **Nothing in this file touches the DOM.**
 */
import type { DataSetFiles } from '../../data/DataSetFiles';
import type { DataSet } from '../../data/DataSets';
import { findRecordingSet, type SetDigests } from '../../data/RecordingSet';
import { cutPageOf, standInPage } from '../../renderer/StandInPage';
import { cutDriftReason, playCut } from '../RecordingCut';
import { readRecordingPackage, type RecordingPackage } from '../RecordingPackage';
import type { AchievementDef } from './AchievementFile';
import { AchievementTracker } from './AchievementTracker';

/** A set a proof may be played over: the page's set, its files, and their digests. */
export interface ProofSet {
    readonly set: DataSet;
    readonly files: DataSetFiles;
    readonly digests: SetDigests;
}

/** What a proof's replay says. */
export type ProofReplayed =
    /**
     * It played to its point over the set `over`, in the playthrough `playthrough`
     * (`d.RandomGameID` there), and its history then holds `unlocked`, in the file's order.
     */
    | { readonly kind: 'checked'; readonly dataSet: string; readonly over: string; readonly playthrough: number; readonly unlocked: readonly string[] }
    /** It did not: why, as a line says it. */
    | { readonly kind: 'drifted'; readonly reason: string };

/**
 * The package `bytes` hold, read to at most `limit` bytes unzipped, replayed over the set
 * of `sets` whose files have its digests, with the achievements `defsOf` gives its set. A
 * package that does not read, whose files no set has, whose set has no achievements, or
 * that drifts, a later level's among them, or whose game an error ends (`die`), is
 * `drifted`, saying why.
 */
export async function replayProof(
    bytes: Uint8Array, limit: number, sets: readonly ProofSet[], defsOf: (setId: string) => readonly AchievementDef[] | null,
): Promise<ProofReplayed> {
    const drifted = (reason: string): ProofReplayed => ({ kind: 'drifted', reason });
    let pkg: RecordingPackage;
    try {
        pkg = await readRecordingPackage(bytes, limit);
    } catch (error) {
        return drifted(`its package does not read: ${error instanceof Error ? error.message : String(error)}`);
    }
    const found = findRecordingSet(pkg.path, sets.map((one) => one.digests));
    if (found.kind === 'refused') return drifted(found.why);
    const over = sets.find((one) => one.set.id === found.id)!;
    const defs = defsOf(pkg.dataSet);
    if (defs === null || defs.length === 0) return drifted(`${pkg.dataSet} has no achievements`);
    try {
        const page = await standInPage(over.set, over.files);
        const tracker = new AchievementTracker(page.game, defs, page.screen.ui.objectTables.objectNames);
        tracker.attach();
        const drift = await playCut(pkg.path, pkg.shared.kind === 'save' ? pkg.shared : null, async () => cutPageOf(page));
        if (drift) return drifted(cutDriftReason(drift));
        return {
            kind: 'checked', dataSet: pkg.dataSet, over: over.set.id, playthrough: page.game.ctx.state.block1.randomGameID,
            unlocked: defs.filter((def) => tracker.unlocked.has(def.id)).map((def) => def.id),
        };
    } catch (error) {
        return drifted(`it does not play: ${error instanceof Error ? error.message : String(error)}`);
    }
}
