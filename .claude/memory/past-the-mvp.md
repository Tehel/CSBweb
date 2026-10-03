---
name: past-the-mvp
description: A CSBWin feature once marked "not wanted" in DEBT.md H is wanted now; read 🚫 "not wanted" as "not yet"
metadata:
  type: feedback
---

The port is past its MVP. A CSBWin feature that a 🚫 entry in `DEBT.md` H calls "not
wanted" was meant as "not yet", and is wanted now (skins and databases past 1024 records
were the first two, now G27 and D16).

**Why:** the author's decision, 2026-10-03: those entries dated from when only the default
dungeon mattered; custom dungeons (Conflux 3.5) now need the full CSBWin feature set.

**How to apply:** when an H entry contradicts an active item, or blocks porting a CSBWin
feature, retire it into the active item rather than keep the divergence. Deliberate
divergences that are not about missing features (the `RandomGameID` draw, `?intro=0`)
stay. See [[port-in-dependency-order]].
