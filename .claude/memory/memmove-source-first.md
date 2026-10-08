---
name: memmove-source-first
description: CSBWin's MemMove is (src, dest, count), the reverse of memmove; read a shift's direction from that, not from the C habit
metadata:
  type: project
---

CSBWin's `MemMove(void *src, void *dest, i32 byteCount)` (`doc/CSBwin-src/CSBCode.cpp:834`)
takes its **source first**, the Atari way, and calls `memmove(dest, src, byteCount)`.
`MemMove(&a[i+1], &a[i], n)` therefore moves entries *down*, a removal.

**Why:** `DeleteFootprintEntry` was ported with the arguments read as `memmove`'s, so the
party's trail shifted up and froze on stale squares once it held 24 prints. The port, its
comment and a `PROVEN_FACTS.md` entry all called it a CSBWin bug kept as written, and the
tools only walked trails shorter than the ring. Magic footprints showed nothing and
smelling read a dead trail for the whole of a real game.

**How to apply:** before recording "CSBWin does this backwards, ported as written", check
the helper's own signature. And when a tool covers a ring or a buffer, run it past the
wrap, the state a real game is always in. See [[port-in-dependency-order]].
