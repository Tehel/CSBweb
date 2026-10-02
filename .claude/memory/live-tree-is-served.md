---
name: live-tree-is-served
description: The author's dev server serves the working tree, so an edit runs in their browser at once — mutate in a scratch worktree, and bump the store's version last
metadata:
  type: feedback
---

A Vite dev server is usually up on :9000 over the working tree, with the author's own
browser on it. Every saved edit reaches that browser by hot reload, against the author's
real IndexedDB saves.

**Why:** the store's upgrade runs once, in whichever page first opens the database at
the new version, and cannot be run again. A mutation left in the tree for a few seconds
to prove a check fails (the fold word of `rescrambleBlock1` skipped) could have been the
code that stamped the author's saves.

**How to apply:** prove a check by mutation in a worktree of the scratchpad
(`git worktree add`, with `node_modules` symlinked in), never in the live tree. When a
change bumps `DB_VERSION` (`src/data/saves/idb.ts`), write and test what the upgrade
calls first, and make the bump the last edit. The IndexedDB half no Node tool runs: a
one-off CDP script against a headless Chrome with a profile of its own can stage an old
store on `/package.json` (same origin, no app), load the app, and read the rows back.
See [[stage-explicitly]].
