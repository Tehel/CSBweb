---
name: expool-absent-in-dm
description: DM's dungeon.dat has no EXPOOL and building a save file creates one; a throwaway file must put the pool back (or delete it) and copy it, not alias it
metadata:
  type: project
---

DM's `dungeon.dat` has no EXPOOL (`data.expool` undefined). `buildSaveFile` creates one (`Expool.setup`) and writes the DSA globals and the overlay palette into it (`SaveGameFile.ts`), so building a file changes the game: every later file holds what it wrote.

**Why:** a checkpoint experiment (`git log --grep E44`) read its own mistakes as drifts three times: the pool kept where there was none, and the copy kept in the checkpoint being the very array handed back to the game, which later saves wrote in place.

**How to apply:** code that builds a file it throws away (a checkpoint, a probe) takes `data.expool?.slice()` and `header.objectCounts[11]` before, and after puts back a fresh `slice()` of its copy, or `delete data.expool` where it was undefined, and the count. A recording's own saves must not do this: the player makes each save's file at its tail on purpose ([[recording-cut-at-save]]). Related: [[scratch-engine-experiment]].
