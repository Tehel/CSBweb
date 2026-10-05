---
name: csbwin-binary-newer-than-source
description: The author plays CSBWin 20230608, newer than doc/CSBwin-src (latest dated comment 20150806); an observation that contradicts the source may be a version difference
metadata:
  type: project
---

The author checks behaviour in a CSBWin build dated 20230608. `doc/CSBwin-src/` is older:
its latest dated comment is `20150806` (`SaveGame.cpp:1462`). So what the author sees in
CSBWin can differ from the source for reasons of version alone.

**Why:** CLAUDE.md makes `doc/CSBwin-src/` the specification, but the author's play-testing
is the only check against a running CSBWin, and the two are not the same program.

**How to apply:** when an observation agrees with the source, cite the source and go on.
When it contradicts the source, don't port the observation and don't dismiss it: write
both into the debt entry (the source's lines, what the 2023 build does) and ask the author
which to follow, as a decision for them ([[port-in-dependency-order]] still applies to what
gets ported first).
