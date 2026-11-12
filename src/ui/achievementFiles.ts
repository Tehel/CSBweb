/**
 * The achievements' files the project writes, in the page's build: the common file, and
 * the FTL sets' own, `defs/<name>.txt` (`achievementFileOf`) (`doc/ACHIEVEMENTS.md` → "The file"). The game's
 * page tracks them (`src/main.ts`) and the welcome page's book lists them
 * (`welcomePage.ts`).
 */
import type { AchievementDef } from '../engine/achievements/AchievementFile';
import { achievementFileOf, setAchievementDefs } from '../engine/achievements/PageAchievements';

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
