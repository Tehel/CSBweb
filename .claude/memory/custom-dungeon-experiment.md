---
name: custom-dungeon-experiment
description: ~/dev/dmmap-cartographer, its own repository beside this one, holds an original dungeon built on CSBweb; its DESIGN.md is the authority on it
metadata:
  type: project
---

"The Cartographer's Debt", an original 10-level DM dungeon designed with the author, lives
in its own repository, `~/dev/dmmap-cartographer`, beside this one. Its `CLAUDE.md`
orients a session there; `DESIGN.md` holds the decisions, `FORMAT.md` the source format
and the build. Its pipeline imports CSBweb's `src/` and `tools/` by relative path
(`../DMweb/...`) and runs inside this checkout (its `pipeline/dmweb.ts` moves there, where
`tools/lib/game.ts` reads the game files).

**Why:** the dungeon is outside the debt priority by the author's choice, and its history
is its own.

**How to apply:** a change in CSBweb that the dungeon needs (such as the builder's
`EXPOOL` special locations, or `writeHeroText` for a renamed hero) is a general fix or
feature of CSBweb's tools, made here as its own commit under this repository's rules.
Moving or renaming something the pipeline imports (`tools/lib/dungeonBuilder.ts`,
`tools/lib/game.ts`, `tools/lib/graphicsDat.ts`, `tools/lib/wallDecorationArt.ts`) breaks
it: check with `npm run check` there. To see a build in a browser without the form, put its
record into a throwaway dev server's `csbweb-saves`/`dataSets` store (never :9000).
