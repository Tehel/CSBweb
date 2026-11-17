---
name: custom-dungeon-experiment
description: dungeons/ (git-ignored) holds an original dungeon being designed with the author; its DESIGN.md is the authority on it
metadata:
  type: project
---

`dungeons/cartographer/` is "The Cartographer's Debt", an original 10-level DM dungeon
designed with the author since 2026-11-17: an experiment, git-ignored in CSBweb, to get
its own repository later, played as a local data set and published only when the author
is satisfied. `DESIGN.md` there holds the decisions (✅), drafts (📝) and open questions
(❓); `RESEARCH.md` the forum's likes and dislikes the design rules come from;
`FORMAT.md` the source format and the build (`pipeline/`, a text source compiled through
`tools/lib/dungeonBuilder.ts`, checked, and written as a local set's files).

**Why:** it is outside the debt priority by the author's choice; its files are not in git,
so a session must read them from disk.

**How to apply:** a session on the dungeon starts by reading `DESIGN.md`; decisions go
there, not into CSBweb's docs. Engine facts it relies on still cite CSBWin, in its
"Engine facts". The pipeline imports CSBweb and changes none of it: a general fix it
needs is its own commit to CSBweb. To see a build in a browser without the form, put
its record into a throwaway dev server's `csbweb-saves`/`dataSets` store (never :9000).
