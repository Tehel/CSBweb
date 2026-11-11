/**
 * What the verifier service replays a proof with (`server/verifier.ts`), which
 * `vite build --ssr --mode verifier` bundles from this module alone into one that imports
 * nothing (`server/app.ts` → `VERIFIER_MODULE`): the replay of a proof
 * (`ProofReplay.ts`), the whole engine and a page without the DOM, and the achievements
 * of the build, the common file's and each FTL set's (`achievementFiles.ts`). The main
 * server never loads it: its readers are `PageReaders.ts`'.
 */
export { replayProof } from './achievements/ProofReplay';
export { achievementDefs } from '../ui/achievementFiles';
