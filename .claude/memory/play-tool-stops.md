---
name: play-tool-stops
description: play-csbwin-log.ts stops three ways and only a DRIFT line is a drift; ENDED null is the VBL limit, a diskMenuSave throw an unplayed disk-menu option
metadata:
  type: project
---

`tools/play-csbwin-log.ts` stops in three ways, and only a `DRIFT line …` is a drift:

- `ENDED null` after `ran N VBLs`: the tool's VBL limit (24 hours of VBLs; it was 8, too
  short for Conflux's 16.5-hour log, `DEBT.md` F24).
- A throw from `diskMenuSave` ("button … in the disk menu, which the port does not play"):
  the log uses a disk-menu option the tool does not handle yet. At the menu's first step,
  0xd2 is "Save and Play", 0xd3 "Save and Quit", 0xd4 "Cancel"; at later steps 0xd2 to
  0xd5 choose the save file (`doc/CSBwin-src/SaveGame.cpp:891-915`). Handle it in
  `tools/lib/csbwinRun.ts` (no behaviour flag: it is the tool's reading of the log), then
  replay.
- Any other throw: the engine's, see [[port-throw-trace-csbwin-first]].

**Why:** Conflux's replay stopped on both of the first two in one session, each looking
like the next drift until the output was read.

**How to apply:** before triaging a stop with the [[csbwin-oracle]], read the last lines of
the tool's output for which of the three it is.
