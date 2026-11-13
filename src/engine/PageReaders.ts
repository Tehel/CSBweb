/**
 * The page's readers the server uses, which `vite build --ssr` bundles from this module
 * alone into one that imports nothing (`server/app.ts` → `READERS_MODULE`): the check of a
 * player's own set and the reader of a dungeon's walls (`LocalDataSetCheck.ts`), the
 * reader of a shared recording's package, which checks its form (`RecordingPackage.ts`),
 * and the merge of a set's own achievements file with the build's common one, and those
 * across games its players' proofs' figures make yes, the server reading each set's file
 * from its folder (`achievementFiles.ts`, `server/setAchievements.ts`), with the common
 * file's text and the family a set's file declares (`familyOf`), which the check of a set's
 * own achievements reads.
 */
export { checkLocalDataSet, readDungeonWalls } from './LocalDataSetCheck';
export { readRecordingPackage } from './RecordingPackage';
export { achievementDefs, achievementsAcross, commonAchievementsText, familyOf } from '../ui/achievementFiles';
