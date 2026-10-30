---
name: shared-bugs-stay
description: Don't audit ReDMCSB's Atari bug list again; a bug CSBWin shares stays unless game-breaking, for CSBWin's recordings and CSBWin-tested dungeons
metadata:
  type: project
---

ReDMCSB's 93 known Atari bugs were once checked one by one (`DEBT.md` F25) and the work
was dropped on 2026-10-30: it never ends, and fixing a bug CSBWin shares desyncs every
CSBWin `playfile.log` that meets it (F24) and can break a puzzle a fan dungeon tested in
CSBWin relies on. The rule is now `DEBT.md` H, "The Atari's bugs that CSBWin shares stay":
only a game-breaking one (crash, hang, corrupted data, object cloned or lost) is fixed,
found through play or a CSBWin recording. BUG0_21's CSB 2.1 step energy was reverted for
that reason; BUG0_46 (walking into your own shot) is kept as a known quirk.

**Why:** the author wants the historic CSBWin recordings importable, which needs every
bug their replay depends on.
**How to apply:** don't propose fixing a non-game-breaking bug CSBWin has, nor
re-auditing the list; before any fix that changes play, ask whether a CSBWin run could
meet it. See [[saves-mutually-compatible]].
