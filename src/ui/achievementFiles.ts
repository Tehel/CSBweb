/**
 * The achievements' file in the page's build, the common one, and a set's achievements: the
 * common file's merged with the set's own, `achievements.txt` in its folder or its record
 * (`ACHIEVEMENTS_FILE`, `doc/ACHIEVEMENTS.md` → "The file"), whose text the caller reads.
 * The game's page tracks them (`src/main.ts`), the welcome page's book lists them
 * (`welcomePage.ts`), and the server's Hall of Fame, PROFILE and verifier read them through
 * the page's readers built for Node (`server/setAchievements.ts`).
 */
import type { AchievementDef } from '../engine/achievements/AchievementFile';
import type { GameFigures } from '../engine/achievements/AchievementState';
import { acrossInSets, setAchievementDefs, type OwnAchievementsOf } from '../engine/achievements/PageAchievements';

const FILES = import.meta.glob<string>('../engine/achievements/defs/common.txt', { query: '?raw', import: 'default', eager: true });

/** Each own file's achievements, read once, by its text; `NONE`'s, a set's without one. */
const KEPT = new Map<string, AchievementDef[] | null>();
/** The same files' achievements across games, by text. */
const ACROSS = new Map<string, readonly AchievementDef[]>();
const NONE = '';

/**
 * The achievements of a set whose own file is `own`, its text, `null` for none: the common
 * file's merged with it, kept by its text. `null`, and the console says why, where a file
 * does not read: the game plays on with none.
 */
export function achievementDefs(own: string | null): AchievementDef[] | null {
    const key = own ?? NONE;
    if (KEPT.has(key)) return KEPT.get(key)!;
    let defs: AchievementDef[] | null;
    try {
        const common = FILES['../engine/achievements/defs/common.txt'];
        if (common === undefined) throw new Error('the common achievements are not in the build');
        defs = setAchievementDefs(common, own);
    } catch (error) {
        console.error('No achievements:', error);
        defs = null;
    }
    KEPT.set(key, defs);
    return defs;
}

/**
 * The achievements across games of the set `setId` that `bySet`, each set's playthroughs'
 * figures (`GameFigures`), make yes, in the file's order (`acrossInSets`,
 * `doc/ACHIEVEMENTS.md` → "Across games"), each set's own file `ownOf`'s: what the book
 * shows and the Hall of Fame works out of the proofs' figures (`server/proofs.ts`). None
 * where the set's files do not read.
 */
export function achievementsAcross(setId: string, ownOf: OwnAchievementsOf, bySet: ReadonlyMap<string, readonly GameFigures[]>): string[] {
    const own = ownOf(setId);
    let defs = ACROSS.get(own ?? NONE);
    if (defs === undefined) {
        defs = (achievementDefs(own) ?? []).filter((def) => def.across);
        ACROSS.set(own ?? NONE, defs);
    }
    return defs.length === 0 ? [] : acrossInSets(defs, setId, bySet, ownOf);
}
