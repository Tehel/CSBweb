---
name: scratch-engine-experiment
description: A throwaway engine experiment: a .mts in the scratchpad importing by absolute path from the repo's cwd, a hook between VBLs through game.input.play, and a recursive state diff from game
metadata:
  type: project
---

- **The script**: outside the repo a `.ts` is compiled as CommonJS and its top-level `await` fails: name it `.mts`, import by absolute path (``await import(`${R}/src/engine/X.ts`)``), and run `npx tsx` with the repo as cwd, since the tools read `tools/data-sets.json` and the gamefiles relative to it ([[scratch-set-cwd]]). A page is `standInPage(set, diskFiles(set))`, a package `readRecordingPackage`, its set `findRecordingSet`, played as `tools/lib/playback.ts` plays it.
- **Between two VBLs**, where the player's cursor (`RecordingPlayer.point`) is consistent: wrap `game.input.play` before `player.start()` so the feed's `afterVbl` calls the hook after the player's own. `Game.script !== null` there is a `LoopScript` holding the loop, which cannot be copied.
- **Two games' states compared**: a recursive walker from `game` (typed arrays element by element, Maps by key, a visited set), skipping `tables`, `host`, `screen`, `ui`, `messages`, `sounds`, `clock`, `input`, the callbacks and the loop's timing fields (`loopTimer`, `vblClockStart`, `vblsPaced`, `atOnce`, `forwarding`). It names every missing field in one run. Harmless noise: the DSA's `parameters`, `MonsterAttack.attackParameters`, the skin cache.

**Why:** each of these cost a round trip in the checkpoint experiment (`git log --grep E44`), and the diff found what a read misses where guessing had not.

**How to apply:** for any "is this state fully restored" question, play the original to the point and the restored one to it in two pages, diff, then play both to the end and compare their files. Related: [[recording-cut-at-save]], [[expool-absent-in-dm]], [[state-drift-under-equal-draws]].
