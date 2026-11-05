---
name: recording-cut-at-save
description: A recording can start exactly at a save on its path — its file plus a little interface state — but not at an arbitrary VBL; measured on DMMovie42's nine saves
metadata:
  type: project
---

Measured 2026-11-05 for sharing part of a recording (a package whose root starts at a save on the path, not at the root):

- **At an arbitrary VBL, the save file read into a fresh game drifts** at the first check: the read detaches and re-attaches every monster, so their timers are re-made at `d.Time` (function 37) and the ITEM16 group indices and facings differ.
- **At a real save point, after its tail (`saveWritten`, `reattachAfterSave`), the world, monsters and timers equal a fresh read of the save's file.** What differs: `ctx.interface` (the attack menu: `attackingCharacterOrdinal`, `possibleAttackTypes`, `word20248`, `word20252`, `byte20256`), `party.state.selectedCharacterIndex`, champions' `load`, `ctx.smartDiscard`'s sweep, `state.watchdogTime`, the mouse queue's indices, the message area.
- Read the file into a fresh game, set the `CarriedState` and copy those over (class instances field by field: `structuredClone` loses `SmartDiscard`'s `objlist` methods). Then play the changes after the `saveWritten` change, skipping it, since the read stands in for the tail. All nine saves of `DMMovie42.L4.gz` played to the game's end. Leaving out `interface` or `selected` drifts; the others weren't needed in these nine saves but differ, so carry them.
- Not yet tried: the Sleepsave (`inVbl`) and the disk menu's saves under a held clock.
- Headless replay without drawing runs ~33k VBLs/s (100k VBLs in ~3 s), so an hour of play takes ~6.5 s to replay.

**Why:** the user rejected a viewer-side fast-forward to the chosen start (30 s of waiting before a win sequence); the cut is made once, at upload, and checked by replaying the cut package to its end before sending.

**How to apply:** the method is to play a corpus package cut at a save (`changes.slice(0, k)`, `vbls` = that change's `vbl`), take `saveFileOf` + `carriedStateOf`, play the rest in a fresh `standPage` game with the state copied in `RecordingPlayer.onBegin`. Related: [[one-tick-late-is-ordering]], [[monster-groups-in-tools]].
