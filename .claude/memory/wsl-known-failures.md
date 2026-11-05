---
name: wsl-known-failures
description: On the author's WSL checkout (2026-11-05), data-set-archive.ts and the frames probe's ABOUT step fail at HEAD too; the probe sometimes times out on the welcome page — not regressions
metadata:
  type: project
---

As of 2026-11-05, on the author's WSL (Ubuntu 22.04) checkout, these fail with the tree at HEAD, unrelated to any change:

- `tools/checks/data-set-archive.ts`: `ENOENT … /tmp/csbweb-archive-*/hand/Set/Kid's notes é (2).txt`, a file name with an accent under /tmp.
- `tools/check-frames.sh`: "the footer's ABOUT opens it" and "a click beside it closes it, and takes #about off the address" (welcome page); and a run sometimes stops early with "timed out waiting for http://localhost:<port>/?dungeon=nowhere".

**Why:** each cost a HEAD comparison in a scratch worktree to rule out the change at hand.

**How to apply:** treat these as known on that machine; if anything else fails, or these fail elsewhere, compare with HEAD (a `git worktree` with `node_modules` and `tools/fixtures/*` symlinked runs the tools). Drop this note once they are fixed. Related: [[frames-on-fresh-ports]].
