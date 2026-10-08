---
name: csbwin-binary-newer-than-source
description: doc/CSBwin-src is CSBwin_SRC_20160923 (Version 15.9, behaviourally 15.8); the author plays CSBWin 20230608, whose source is also on the site — diff it before calling an observation a contradiction
metadata:
  type: project
---

`doc/CSBwin-src/` is `CSBwin_SRC_20160923.zip` from dianneandpaul.net/CSBwin/
("Version 15.9", `CSBwin.rc:322`), plus cosmetic edits of the author's in `CSBCode.cpp`,
`RC4.cpp`, `SaveGame.cpp` and `Data.h` (strings inlined, labels renamed). 15.9 is a side
branch off `CSBwin_SRC_20160325` (15.8) whose only change is accessors for a monster's
`word20`, so it behaves as 15.8. The main line went on from 15.8: 20180421, 20190223
(17.7), 20190702, and `CSBwin_SRC_20230608.7z`, the source of the build the author plays.

**Why:** CLAUDE.md makes `doc/CSBwin-src/` the specification, but the author's play-testing
is the only check against a running CSBWin, and the two are seven years apart. Most of
the gap is 64-bit cleanup and translation support; a handful of changes alter behaviour
(the click translated when it is taken, not when it is queued; the wall text plaque's
bottom; `&PARAM@`'s `Var(j)`; the attacker's cyan border; three new extended flags; the
space in a champion's bones).

**How to apply:** when an observation contradicts the source, diff the function against
`doc/CSBwin-src-20230608/` before anything else: the difference may be the version. The
change still to port is `DEBT.md` C156, and C157 makes 2023 the reference, after
which this memory is deleted. If it is, write both into the debt entry and ask the author which to
follow. When nothing differs, the observation is a port bug. ([[port-in-dependency-order]]
still applies to what gets ported first.)
