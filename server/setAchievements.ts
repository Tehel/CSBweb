/**
 * Each set's achievements on the server, its own file read from its folder
 * (`ACHIEVEMENTS_FILE`, `doc/ACHIEVEMENTS.md` → "The file") and merged with the common file
 * by the page's readers built for Node (`READERS_MODULE`, `app.ts`): what the Hall of Fame
 * lists (`fame.ts`), PROFILE names (`identity.ts`), and the proofs' figures make yes across
 * games (`ProofStore.hall`). The verifier reads the file through the set's files instead,
 * as the page does (`replayProof`). Nothing here is cached past the call: a file is read
 * once in a call, which may test thousands of figures, and anew at the next, so that an
 * edit of a set's file is read without a restart; the readers keep each text's achievements.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ACHIEVEMENTS_FILE } from '../src/data/DataSets.ts';
import type { DataSetStore } from './dataSets.ts';
import type { FameDef } from './answers.ts';
import type { AchievementDefsOf } from './fame.ts';
import type { AchievementsAcrossOf } from './proofs.ts';

/** The text of each set's own achievements file, by its id, `null` for a set with none. */
export type OwnAchievementsOf = (setId: string) => string | null;

/** The build's achievements of a set whose own file is `own`, its text (`achievementDefs`, `src/ui/achievementFiles.ts`); `null` where they do not read. */
export type BuiltAchievementDefs = (own: string | null) => readonly FameDef[] | null;

/** The build's achievements across games of a set (`achievementsAcross`, `src/ui/achievementFiles.ts`), each set's own file `ownOf`'s. */
export type BuiltAchievementsAcross = (setId: string, ownOf: OwnAchievementsOf, bySet: ReadonlyMap<string, readonly Readonly<Record<string, number>>[]>) => readonly string[];

/** A set's achievements and those across games, by its id, as the API takes them (`ApiOptions`). */
export interface SetAchievements {
    achievementDefs: AchievementDefsOf;
    achievementsAcross: AchievementsAcrossOf;
}

/**
 * The achievements of the sets of `dataSets`, each own file read from its folder under
 * `gamefilesDir` by the build's `built` readers. A set the table does not hold, or whose
 * folder holds no file that reads as text, has none of its own.
 */
export function folderAchievements(
    gamefilesDir: string, dataSets: Pick<DataSetStore, 'read'>, built: { achievementDefs: BuiltAchievementDefs; achievementsAcross: BuiltAchievementsAcross },
): SetAchievements {
    let texts: Map<string, string | null> | null = null;
    let dirs: Map<string, string> | null = null;
    const ownOf: OwnAchievementsOf = (setId) => {
        if (texts === null || dirs === null) {
            texts = new Map();
            dirs = new Map(dataSets.read().dataSets.map((set) => [set.id, set.dir]));
            // Read again at the next call, once this one is done.
            queueMicrotask(() => { texts = null; dirs = null; });
        }
        if (texts.has(setId)) return texts.get(setId)!;
        const dir = dirs.get(setId);
        let text: string | null = null;
        if (dir !== undefined) {
            try {
                text = readFileSync(join(gamefilesDir, dir, ACHIEVEMENTS_FILE), 'utf8');
            } catch {
                text = null;
            }
        }
        texts.set(setId, text);
        return text;
    };
    return {
        achievementDefs: (setId) => built.achievementDefs(ownOf(setId)),
        achievementsAcross: (setId, bySet) => built.achievementsAcross(setId, ownOf, bySet),
    };
}
