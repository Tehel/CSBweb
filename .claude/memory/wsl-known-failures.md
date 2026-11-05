---
name: wsl-known-failures
description: On the author's WSL checkout (2026-11-05), data-set-archive.ts fails at HEAD too, and the frames probe sometimes times out on the welcome page — not regressions
metadata:
  type: project
---

As of 2026-11-05, on the author's WSL (Ubuntu 22.04) checkout, these fail with the tree at HEAD, unrelated to any change:

- `tools/checks/data-set-archive.ts`: `ENOENT … /tmp/csbweb-archive-*/hand/Set/Kid's notes é (2).txt`, a file name with an accent under /tmp.
- `tools/check-frames.sh`: a run sometimes stops early with "timed out waiting for http://localhost:<port>/?dungeon=nowhere". (Its ABOUT step's failure was a race, the dialog opening at the `hashchange` after the click: the probe now waits for it.)

**Why:** each cost a HEAD comparison in a scratch worktree to rule out the change at hand.

**How to apply:** treat these as known on that machine; if anything else fails, or these fail elsewhere, compare with HEAD (a `git worktree` with `node_modules` and `tools/fixtures/*` symlinked runs the tools). Drop this note once they are fixed. Related: [[frames-on-fresh-ports]].
