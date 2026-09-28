---
name: stage-explicitly
description: Never `git add -A` — NOTES.md is the author's and changes while a session runs
metadata:
  type: feedback
---

Stage commits by explicit path, never with `git add -A` or `git add .`.

**Why:** `NOTES.md` is the author's scratchpad and they edit it *while a session is
running*; a blanket add once swept their in-progress edits into a commit. Excluding one
path is not enough, because the hazard is whatever the author happens to be editing.

**How to apply:** stage the files the change touched. If the set is large, read
`git status --short` and pick from it, skipping anything not yours — `NOTES.md` above
all, and untracked game data under `static/gamefiles/` (e.g. `csbgame*.dat` saves).
