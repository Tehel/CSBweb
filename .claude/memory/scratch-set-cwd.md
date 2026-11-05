---
name: scratch-set-cwd
description: play a run on a candidate data set without touching the served tree — the tools read tools/data-sets.json and tools/fixtures/gamefiles relative to the working directory
metadata:
  type: project
---

The tools resolve `MANIFEST_FILE` (`tools/data-sets.json`) and `GAMEFILES_DIR` (`tools/fixtures/gamefiles`) relative to the working directory (`tools/lib/dataSets.ts`), and the stock files too (`STOCK_DIR`, `tools/lib/game.ts`). So a set that is not in the manifest can be tried from a scratch folder: `cwd/tools/fixtures/gamefiles/` holding a symlink to each of the repository's set folders plus the candidate's own folder, and `cwd/tools/data-sets.json` the repository's with a row for it. Then `cd <cwd> && npx tsx <repo>/tools/play-csbwin-log.ts <playfile> --set=<id>` (imports resolve from the script's path).

**Why:** the dev server reads the same manifest at each request, so a row added in the tree shows up on the author's page ([[live-tree-is-served]]); a scratch folder keeps the experiment out of it. Conflux's partial game (`DEBT.md` F24) was tried so before deciding its set.

**How to apply:** for any "does this run play on these files?" question before a set is decided. `npm test -- --only=` does not take a working directory: run the tool with `npx tsx`, which skips the type check, so the result is a diagnostic, not evidence.
