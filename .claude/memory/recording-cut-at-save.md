---
name: recording-cut-at-save
description: A recording starts exactly at a save on its path from its file plus the state a read loses (`CutState`); what was missing each time a cut drifted, and how to diff one
metadata:
  type: project
---

A path cut at a save (`src/engine/RecordingCut.ts`, `CutState.ts`, `doc/RECORDING.md` → "A path cut at a save") starts from the save's file read into a fresh game, plus `CarriedState.cut`. Each item of it was found by a cut that drifted:

- **At an arbitrary VBL a cut drifts**: the read re-makes monster timers. Only at a save's point after its tail (`saveWritten`) does a read equal the game.
- `interface` (attack menu) and `selected` are needed: DMMovie42's saves and CSBFullRecordingV4's drift without them.
- **`noGameInfo`**: a game read from `dungeon.dat` has no `gameInfo` and saves a size of 0; a read of that save gets "No game information was provided" (`SaveGame.cpp:256`), so every later file (a join's MD5, the shared save) differs. Symptom: a `join` or `save` drift with `byte: null`, gameplay identical.
- **The opening tick and `TAG0138ec`**: `Game.start` makes a tick due and runs the cursor filter, right for a boot read, wrong mid-loop: an F5 cut ran one tick ahead (a `change` drift at a change with no recorded clock, i.e. a VBL mismatch). `Game.resumeAtSavePoint`, set by `setCutState`, skips both.
- `lastInputTime` (one entry a tick) is zeroed by a read; carried though no corpus case needed it.
- The Sleepsave's tail is made inside its VBL and never logged: it can start a cut only at the join of a branch that read it.
- **The player makes each save's file at its tail** (`saveWritten`), as the save did: making a file writes the running world's EXPOOL, so a replay that skipped it made another file later (a kept save's TO drifted, FROM refused) while play matched. `replay-saves-written-over` in the corpus is the author's game that showed it.
- **A new game's start keeps `totalMoveCount`** where not 0 (after a game lost at the entrance), which every file holds.
- **FROM/TO come from the path, not the save rows** (`wayPoints`): players save over the same slot, and F5 always does, so the rows are mostly gone; each logged `saveWritten` tail and each join is a save, labelled by its row, else its tail's `SavedStamp`, else `≈` its time on the path. The disk menu's tail lands VBLs after its point in a browser (written after the async store write), never in tools' in-memory stores.
- **Only at a save's point**: at an arbitrary VBL a read needs everything a checkpoint puts over it (`src/engine/Checkpoint.ts`, `doc/RECORDING.md` → "Checkpoints"), the screen's play state and picking among them. A cut lacks some of it at its save too; the corpus never hit it (`DEBT.md` R20): a fix goes in `CutState` from the checkpoint's parts.

**Why:** the user rejected a viewer-side fast-forward; the cut is made once, at upload (and PLAY `&from=`), checked by replaying the cut package to its end.

**How to apply:** for a new drift, diff `game.ctx` (and `ctx.systems`, sorting Map entries) of the original played to the save plus its tail against the cut's root read with no changes; DSA/monster-AI scratch globals and timer words 6-9 differ harmlessly. Replay costs ~22-33k VBLs/s; DMMovie42's nine cuts are two gate jobs (`recording-cut.ts --saves=`). Related: [[scratch-engine-experiment]], [[expool-absent-in-dm]], [[one-tick-late-is-ordering]], [[possiblemove-globals-outlive-call]], [[long-runs-job-timeout]].
