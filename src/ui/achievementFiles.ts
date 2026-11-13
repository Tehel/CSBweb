/**
 * The achievements' files the project writes, in the page's build: the common file, and
 * the FTL sets' own, `defs/<name>.txt` (`achievementFileOf`) (`doc/ACHIEVEMENTS.md` → "The file"). The game's
 * page tracks them (`src/main.ts`) and the welcome page's book lists them
 * (`welcomePage.ts`).
 */
import type { AchievementDef } from '../engine/achievements/AchievementFile';
import type { GameFigures } from '../engine/achievements/AchievementState';
import { achievementFileOf, acrossInSets, setAchievementDefs } from '../engine/achievements/PageAchievements';

const FILES = import.meta.glob<string>('../engine/achievements/defs/*.txt', { query: '?raw', import: 'default', eager: true });

/**
 * The achievements of the set `setId`: the common file's merged with the set's own file
 * where the project has one. `null`, and the console says why, where a file does not
 * read: the game plays on with none.
 */
export function achievementDefs(setId: string): AchievementDef[] | null {
    try {
        const common = FILES['../engine/achievements/defs/common.txt'];
        if (common === undefined) throw new Error('the common achievements are not in the build');
        return setAchievementDefs(common, FILES[`../engine/achievements/defs/${achievementFileOf(setId)}.txt`] ?? null);
    } catch (error) {
        console.error('No achievements:', error);
        return null;
    }
}

/** Each set's achievements across games, read once (`achievementsAcross`). */
const ACROSS = new Map<string, readonly AchievementDef[]>();

/**
 * The achievements across games of the set `setId` that `bySet`, each set's playthroughs'
 * figures (`GameFigures`), make yes, in the file's order (`acrossInSets`,
 * `doc/ACHIEVEMENTS.md` → "Across games"): what the book shows and the Hall of Fame works
 * out of the proofs' figures (`server/proofs.ts`). None where the set's files do not read.
 */
export function achievementsAcross(setId: string, bySet: ReadonlyMap<string, readonly GameFigures[]>): string[] {
    let defs = ACROSS.get(setId);
    if (defs === undefined) {
        defs = (achievementDefs(setId) ?? []).filter((def) => def.across);
        ACROSS.set(setId, defs);
    }
    return defs.length === 0 ? [] : acrossInSets(defs, setId, bySet);
}
