/**
 * The page's readers the server uses, which `vite build --ssr` bundles from this module
 * alone into one that imports nothing (`server/app.ts` → `READERS_MODULE`): the check of a
 * player's own set and the reader of a dungeon's walls (`LocalDataSetCheck.ts`), the
 * reader of a shared recording's package, which checks its form (`RecordingPackage.ts`),
 * and the build's achievements, which the Hall of Fame lists, and those across games its
 * players' proofs' figures make yes (`achievementFiles.ts`, `server/fame.ts`).
 */
export { checkLocalDataSet, readDungeonWalls } from './LocalDataSetCheck';
export { readRecordingPackage } from './RecordingPackage';
export { achievementDefs, achievementsAcross } from '../ui/achievementFiles';
