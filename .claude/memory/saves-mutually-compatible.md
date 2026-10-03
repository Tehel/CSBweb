---
name: saves-mutually-compatible
description: Save files are two-way compatible with CSBWin — every CSBWin save imports, every export loads in CSBWin; no port-only file is read
metadata:
  type: feedback
---

The author wants complete mutual compatibility with CSBWin on save files: everything
CSBWin saves, the port must import, and everything the port exports, CSBWin must load.

**Why:** a save is a CSBWin `.dat` and nothing else (`doc/SAVES.md`). A file the port's
old writer made, which CSBWin refuses, was mended on read for one day so the author
could re-save their games, then removed at their request: the reader takes what
CSBWin's takes, not the port's own mistakes.

**How to apply:** a change to the save reader or writer is checked both ways, against
the genuine saves in `tools/fixtures/` and against what CSBWin's `LoadGame` would accept
(slot 0 unused, `checkIndirectIndex`, checksums). Fix a writer bug at the writer; do not
add a reader special case for files CSBWin cannot read unless the author asks for a
temporary one. Related: [[live-tree-is-served]].
