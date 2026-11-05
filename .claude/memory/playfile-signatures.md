---
name: playfile-signatures
description: a playfile's 0x6666/0x6667/0x666a lines are the first 4 bytes of the graphics/dungeon/CSBgraphics file's MD5 — pick among a run folder's dungeon.dat/.bak/.bak1 without replaying
metadata:
  type: project
---

CSBWin records a file's signature as `x<<16|y` of its `0x6666` (`graphics.dat`), `0x6667` (`dungeon.dat`, and each save it reads) and `0x666a` (`CSBgraphics.dat`) lines: the first four bytes of the file's MD5, read little-endian (`Signature`, `doc/CSBwin-src/data.cpp:1946-1976`). `md5sum` a candidate: line `ec4f 737d` matches an MD5 starting `7d734fec`. A `0x666a` of `0000 0000` does not mean the run had no `CSBgraphics.dat`: Conflux's run has it, and CSBWin parts from that log without the file.

**Why:** run folders hold several versions of their files (Conflux's has `dungeon.dat`, `dungeon.bak`, `dungeon.bak1`, with saves dated two years after the logs); the newest is not the one recorded. The signature settled it in one command where a replay takes an hour.

**How to apply:** before building a set for a CSBWin run, match its files by the log's first signature lines; later `0x6667` lines are the saves read on the way, not the dungeon. See [[csbwin-oracle]], [[custom-dungeon-archives]].
