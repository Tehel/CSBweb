---
name: one-level-per-deploy
description: a series of behaviour changes deployed together shares one ENGINE_LEVEL; the level being built is named in RECORDING.md's policy (level 6, Conflux's F24 fixes)
metadata:
  type: feedback
---

Only a deployed build records players' games, so a series of commits the author deploys together bumps `ENGINE_LEVEL` once: the first commit bumps, each later one adds its `Behaviour.ts` flag with that level as `until` and bumps nothing. `doc/RECORDING.md` → "The policy" names the level being built; when it is deployed, that line goes.

**Why:** the author asked for it (2026-11-05) while Conflux's partial game (`DEBT.md` F24) turned up DSA fixes one after another; three players had played DSA dungeons since recording was re-enabled, so a flag per fix is still owed, a level per fix is not. The author does not deploy until the series is done.

**How to apply:** before bumping, read the policy's "level being built" line: if it names an undeployed level for the same series, join it. A flag's old-behaviour check then tests the level below it.
